-- Follow-ups of wave 8, found on the hosted preview and by the outside attack
-- of 27 November 2026 (migrations 084400 to 084600).
--
-- Every function below is a faithful copy of its newest definition, except
-- for the lines named here (node tools/races/faithful-copies.cjs
-- 20261121085000_wave8_followups.sql prints the difference). Each is
-- `create or replace` with the same arguments and columns, so its owner,
-- security definer, empty search path and grants stay as they were.
--
-- What this migration decides, and why:
--
--   1. A CART LINE OF A PRODUCT THE CALLER MAY NOT SEE GIVES ONLY ITS ID.
--      public.cart_lines (084600) took the offer's own facts (shop, price,
--      list price, stock, how it is delivered, handling days) from any active
--      offer, whatever its product: a visitor who knew the id of an active
--      offer of an archived product (or one awaiting review, or taken down)
--      read the shop's name, the price and the delivery method, although the
--      header of 084600 says such a line returns only its id. Now both the
--      product's facts and the offer's facts come only when the caller may
--      see the offer's product, by the rule the product page and the
--      catalogue already use (private.product_page_open: public, or the
--      caller is staff or the product's own shop, and its shop active or
--      another active shop sells it). Otherwise the line is its id,
--      `buyable` false, `available` 0 and every other column null: the
--      answer of a made-up id. A paused offer of a public product still
--      names its product (slug, title, variant, photo) without seller, price
--      or stock, as since 084600. Columns and their order are unchanged; the
--      store build of 3f251c3 reads `available` as a number, so it stays 0.
--      public.checkout_quote had a smaller form of the same leak: the
--      delivery promise counted the handling days of an offer that cannot
--      be bought (private.price_items took the largest over every line), so
--      quoting a hidden seller-delivered offer next to a public one moved the
--      date by its handling days. The handling days now come from the lines
--      that can be bought, as the totals already did; place_order refuses a
--      basket with such a line anyway, so its answers do not change.
--      public.cart_alternatives gives only offers of public products
--      (p.status = 'active' and private.product_page_open) and was left as is.
--
--   2. A PARCEL STAFF STOPPED BEFORE IT LEFT.
--      public.wms_receive_returned_shipment cancelled the order for the
--      reason "Los paquetes regresaron sin entregarse" also when every parcel
--      of it had been stopped by staff in the warehouse and never went out
--      (ops_recall_shipment, 084200), so the shopper read that the parcels
--      came back although nothing ever left. When every parcel of the order
--      that came back was stopped by staff and never went out on a route
--      (recalled_at set and private.shipment_never_left), the order is now
--      cancelled for a reason of its own, "Los paquetes no salieron de la
--      bodega"; a parcel that went out and came back keeps the reason of
--      today. Staff's typed reason stays on the parcel (recall_reason) for
--      staff only. The new sentence is one of the reasons the database
--      writes itself: packages/core/src/cancellation.ts (CANCEL_REASON,
--      with a parity test) and the list public.get_order gives the shopper.
--      The parcel itself said "Devuelto" and its history "Paquete: devuelto"
--      on the shopper's pages: public.get_order now says, for each parcel and
--      each of its history lines, whether staff stopped it before it ever
--      left (`stopped_before_leaving`, a new optional field the store build
--      of 3f251c3 ignores), and the shopper's pages use the words of
--      packages/core/src/parcel-words.ts for it.
--
--   3. A SHOPPER'S OWN CANCELLATION ALWAYS READS AS THEIRS.
--      public.cancel_order stored whatever text the caller sent as the
--      reason. A shopper calling the API with a text of their own had it
--      stored; get_order then gave them null (since 084600 the shopper gets
--      only the database's sentences), and the page used the words of a
--      staff cancellation. When the caller owns the order, the reason is now
--      always "Cancelado por el cliente", whatever was sent, so the shopper's
--      text is never stored nor given back. Staff cancelling someone else's
--      order keep their own words, as before.
--
--   4. A SIMULATED REFUND COMPLETED BEFORE IT WAS REQUESTED.
--      private.gateway_refunds.requested_at defaults to clock_timestamp()
--      (the moment of the insert) and private.settle_gateway_refund wrote
--      completed_at = now() (the start of the transaction). A refund settled
--      in the transaction that opened it, which only the simulation does
--      (private.open_gateway_refund and ops_resolve_payment_review settle a
--      `simulated` refund at once), therefore showed completed_at a few
--      milliseconds before requested_at. A refund through the gateway or by
--      transfer is settled in a later transaction (the worker, the
--      gateway's notice, or finance), which starts after the refund was
--      sent, so its completed_at is later anyway. completed_at is now never
--      earlier than requested_at; for those later settlements nothing
--      changes.

-- ═══ 1. A cart line of a product the caller may not see ════════════════════

-- Replaces the version in 20261121084600_shopper_followups.sql. Two changes
-- (header, point 1): the product is found only when the caller may see it
-- (private.product_page_open, the product page's own rule, instead of a rule
-- of this function's own), and the offer `o` only when its product is one
-- the caller may see. A line of any other offer is its id alone.
create or replace function public.cart_lines(p_offer_ids uuid[])
returns table (offer_id uuid, buyable boolean, product_slug text, title text, variant_name text,
               image_path text, seller_name text, price_minor bigint, list_price_minor bigint,
               available integer, fulfillment public.fulfillment_type, handling_days smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select private.is_staff() as staff,
           coalesce(array(select private.my_seller_ids()), '{}'::uuid[]) as sellers
  )
  select req.offer_id,
         coalesce(o.id is not null and o.status = 'active' and k.active and p.status = 'active'
                  and s.status = 'active' and o.available_quantity > 0, false),
         p.slug, p.title, k.variant_name,
         (select i.path from public.product_images i
          where i.product_id = p.id order by i.sort, i.id limit 1),
         s.trade_name, o.price_minor, o.list_price_minor,
         least(coalesce(o.available_quantity, 0), 10), o.fulfillment, o.handling_days
  from viewer v
  cross join unnest(p_offer_ids[1:60]) with ordinality as req (offer_id, position)
  left join public.offers o
    on o.id = req.offer_id
   and ((o.status = 'active' and exists (
           select 1 from public.sellers so where so.id = o.seller_id and so.status = 'active'))
        or o.seller_id = any (v.sellers) or v.staff)
   -- Since 085000: nothing of an offer whose product the caller may not see.
   and private.product_page_open((select k3.product_id from public.skus k3 where k3.id = o.sku_id))
  -- The offer whatever its state, only to find its product: a paused offer's
  -- line still names a product the caller may see.
  left join public.offers oa on oa.id = req.offer_id
  left join public.products p
    on p.id = (select k2.product_id from public.skus k2 where k2.id = oa.sku_id)
   and private.product_page_open(p.id)
  left join public.skus k on k.id = oa.sku_id and k.product_id = p.id
  left join public.sellers s
    on s.id = o.seller_id
   and (s.status = 'active' or v.staff or s.id = any (v.sellers))
  -- In the order the cart asked for them, as the earlier version returned them.
  order by req.position;
$$;

-- Replaces the version in 20261121081000_checkout.sql. One change (header,
-- point 1): the handling days that set the promise are those of the lines
-- that can be bought, as the totals are.
create or replace function private.price_items(p_items jsonb, p_max_units integer)
returns table (
  line_count bigint,
  bad_quantity bigint,
  unavailable_offer uuid,
  items_total bigint,
  items_tax bigint,
  handling_days integer
)
language sql stable security definer
set search_path = ''
as $$
  with requested as (
    select (e ->> 'offer_id')::uuid as offer_id, sum((e ->> 'quantity')::integer) as quantity
    from jsonb_array_elements(p_items) e
    group by 1
  ),
  priced as (
    select r.offer_id, r.quantity, o.price_minor, o.fulfillment, o.handling_days, p.tax_rate_bps,
           (o.id is not null and o.status = 'active' and k.active
            and p.status = 'active' and s.status = 'active') as buyable
    from requested r
    left join public.offers o on o.id = r.offer_id
    left join public.skus k on k.id = o.sku_id
    left join public.products p on p.id = k.product_id
    left join public.sellers s on s.id = o.seller_id
  )
  select count(*),
         count(*) filter (where quantity is null or quantity <= 0 or quantity > p_max_units),
         (array_agg(offer_id) filter (where not coalesce(buyable, false)))[1],
         coalesce(sum(price_minor * quantity) filter (where buyable), 0)::bigint,
         coalesce(sum(
           price_minor * quantity
           - round((price_minor * quantity)::numeric * 10000 / (10000 + tax_rate_bps))
         ) filter (where buyable), 0)::bigint,
         coalesce(max(case when fulfillment = 'seller' then handling_days else 0 end)
                    filter (where buyable), 0)::integer
  from priced;
$$;

-- ═══ 2. A parcel staff stopped before it left ══════════════════════════════

-- Replaces the version in 20261121084200_order_followups.sql. One change
-- (header, point 2): the reason the order is cancelled for, `v_reason`, is
-- "Los paquetes no salieron de la bodega" when every parcel of the order that
-- came back was stopped by staff before it ever went out, and the reason of
-- today otherwise. The same sentence goes with `order.cancelled`.
create or replace function public.wms_receive_returned_shipment(
  p_shipment_id uuid,
  p_resellable boolean default true,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ship public.shipments%rowtype;
  v_order public.orders%rowtype;
  v_kind public.warehouse_kind;
  v_location uuid;
  v_units jsonb;
  v_refund jsonb;
  v_fee jsonb;
  v_cancelled boolean := false;
  v_reason text;
  r record;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if not found then
    perform private.fail('shipment_not_found');
  end if;
  if not (private.works_at(v_ship.origin_warehouse_id) or private.has_staff_role('ops')
          or (v_ship.seller_id is not null and private.is_seller_member(v_ship.seller_id))) then
    perform private.fail('forbidden');
  end if;
  select * into v_order from public.orders where id = v_ship.order_id for update;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.status <> 'returning' then
    perform private.fail('shipment_not_returning', v_ship.status::text);
  end if;

  select w.kind into v_kind from public.warehouses w where w.id = v_ship.origin_warehouse_id;
  if v_kind = 'platform' then
    select wl.id into v_location from public.warehouse_locations wl
    where wl.warehouse_id = v_ship.origin_warehouse_id and wl.kind = 'returns' and wl.active
    order by wl.code limit 1;
    -- Units put back into a Yuntera warehouse always land on a location the
    -- location screens list and picking can name; without one they would
    -- count in the shop's stock and sit on no shelf.
    if v_location is null and coalesce(p_resellable, true) then
      perform private.fail('returns_location_missing');
    end if;
  end if;

  for r in
    select si.order_item_id, si.quantity, i.sku_id, i.seller_id
    from public.shipment_items si join public.order_items i on i.id = si.order_item_id
    where si.shipment_id = p_shipment_id
    order by i.sku_id, i.seller_id
  loop
    if coalesce(p_resellable, true) then
      perform private.apply_stock_change(
        v_ship.origin_warehouse_id, r.sku_id, r.seller_id, r.quantity, 'return', v_location,
        'shipment', p_shipment_id, coalesce(nullif(trim(p_note), ''), 'Paquete devuelto sin entregar'));
    else
      -- Recorded, never sellable again.
      insert into public.stock_movements
        (warehouse_id, sku_id, seller_id, on_hand_delta, quantity, reason, reference_type,
         reference_id, note, actor_id)
      values
        (v_ship.origin_warehouse_id, r.sku_id, r.seller_id, 0, r.quantity, 'damage', 'shipment',
         p_shipment_id, coalesce(nullif(trim(p_note), ''), 'Paquete devuelto dañado'),
         (select auth.uid()));
    end if;
  end loop;

  update public.shipments set status = 'returned' where id = p_shipment_id;

  -- What was paid for these units goes back to the shopper, unless it was
  -- already settled (at the door of a cash order, when the parcel was on its
  -- way back as the cash was collected). A cash order not paid yet is not
  -- refunded: the cash still to collect drops by these goods instead.
  if exists (select 1 from public.payments p where p.order_id = v_order.id
             and p.status in ('captured', 'partially_refunded'))
     and not exists (select 1 from private.refunds f
                     where f.reason = 'parcel_returned' and f.source_id = p_shipment_id) then
    select jsonb_agg(jsonb_build_object('order_item_id', si.order_item_id, 'quantity', si.quantity))
    into v_units
    from public.shipment_items si where si.shipment_id = p_shipment_id;
    v_refund := private.refund_units(v_order.id, 'parcel_returned', p_shipment_id, v_units);
  end if;

  insert into public.order_events (order_id, shipment_id, kind, note, actor_id)
  values (v_order.id, p_shipment_id, 'note',
          case when v_ship.recalled_at is not null and private.shipment_never_left(p_shipment_id)
               then 'Su paquete no llegó a salir de nuestra bodega'
               else 'Su paquete regresó a nuestra bodega sin entregarse' end
          || case when v_refund is null then ''
                  else '; le devolvemos lo que pagó por él: '
                       || private.colones((v_refund ->> 'refund_minor')::bigint) end,
          (select auth.uid()));

  if not exists (select 1 from public.shipments s where s.order_id = v_order.id
                 and s.status not in ('returned', 'cancelled'))
     and not exists (select 1 from public.shipments s where s.order_id = v_order.id
                     and s.status = 'delivered') then
    -- Nothing reached the shopper and nothing is still on its way.
    -- Since 085000: when staff stopped every parcel that came back before it
    -- went out, nothing ever left the warehouse, and the reason says so.
    v_reason := case
      when not exists (select 1 from public.shipments s where s.order_id = v_order.id
                       and s.status = 'returned'
                       and not (s.recalled_at is not null and private.shipment_never_left(s.id)))
        then 'Los paquetes no salieron de la bodega'
      else 'Los paquetes regresaron sin entregarse' end;
    update public.orders
    set status = 'cancelled', cancelled_at = now(),
        cancel_reason = v_reason
    where id = v_order.id and status not in ('cancelled', 'refunded');
    v_cancelled := found;
    update public.payments set status = 'cancelled'
    where order_id = v_order.id and status in ('pending', 'authorized');
    -- Nobody went to the door: the delivery fee goes back too.
    if v_cancelled and not private.order_had_door_attempt(v_order.id) then
      v_fee := private.refund_delivery_fee(v_order.id);
      if v_fee is not null then
        insert into public.order_events (order_id, kind, note, actor_id)
        values (v_order.id, 'note',
                'Le devolvemos también el envío, ' || private.colones((v_fee ->> 'refund_minor')::bigint)
                || ': no llegamos a intentar la entrega',
                (select auth.uid()));
      end if;
    end if;
    perform private.emit('order.cancelled', jsonb_strip_nulls(jsonb_build_object(
      'order_id', v_order.id, 'reason', v_reason,
      -- What the shopper really gets back, for the message (null: nothing was paid).
      'amount_minor', case when private.order_collected_minor(v_order.id) > 0
                           then private.refunded_minor(v_order.id) end)));
  else
    perform private.replan_cod(v_order.id);
    perform private.sync_order_status(v_order.id);
  end if;

  perform private.emit('shipment.returned', jsonb_build_object(
    'shipment_id', p_shipment_id, 'resellable', coalesce(p_resellable, true)));

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'refund_minor', coalesce((v_refund ->> 'refund_minor')::bigint, 0),
    'delivery_fee_refund_minor', coalesce((v_fee ->> 'refund_minor')::bigint, 0),
    'order_status', (select o.status from public.orders o where o.id = v_order.id));
end;
$$;

-- Replaces the version in 20261121084600_shopper_followups.sql. Two changes:
-- the shopper is given the new reason too (header, point 2); the list is the
-- one packages/core/src/cancellation.ts keeps (CANCEL_REASON). And each parcel
-- and each of its history lines says whether staff stopped it before it ever
-- left (`stopped_before_leaving`, new and optional: the store build of
-- 3f251c3 ignores it), so the shopper's pages do not call it "Devuelto"
-- (packages/core/src/parcel-words.ts).
create or replace function public.get_order(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_is_owner boolean;
  v_is_staff boolean := private.has_staff_role('ops', 'support', 'finance');
  v_is_ops boolean := private.has_staff_role('ops');
begin
  select * into o from public.orders where order_number = p_order_number;
  v_is_owner := found and o.user_id = (select auth.uid());
  if not found or not (v_is_owner or v_is_staff) then
    -- The same answer whether the order does not exist or belongs to someone else.
    perform private.fail('order_not_found');
  end if;

  return jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'placed_at', o.placed_at,
    'confirmed_at', o.confirmed_at,
    'delivered_at', o.delivered_at,
    'cancelled_at', o.cancelled_at,
    -- Since 084600: to the shopper, only a reason the database writes itself
    -- (packages/core/src/cancellation.ts, CANCEL_REASON); what staff typed
    -- when they cancelled is an internal note and reaches staff only.
    'cancel_reason', case when v_is_staff
                            or o.cancel_reason in ('Pago no recibido a tiempo',
                                                   'Los paquetes regresaron sin entregarse',
                                                   'Los paquetes no salieron de la bodega',
                                                   'Cancelado por el cliente')
                          then o.cancel_reason end,
    'items_total_minor', o.items_total_minor,
    'shipping_minor', o.shipping_minor,
    'discount_minor', o.discount_minor,
    'total_minor', o.total_minor,
    'tax_included_minor', o.tax_included_minor,
    'payment_method', o.payment_method,
    'promise_earliest', o.promise_earliest,
    'promise_latest', o.promise_latest,
    'withdrawal_deadline', o.withdrawal_deadline,
    'warranty_until', o.warranty_until,
    -- The code is shown while there is still something to hand over, and only
    -- to the shopper. It is their proof against a parcel being marked
    -- delivered without them, so nobody on the platform's side may read it:
    -- not the driver, and not staff looking at the order.
    -- Since 084200, also not while every parcel left to deliver is on its way
    -- back to the warehouse (returning): nobody will ask for it.
    'delivery_pin', case when v_is_owner
                          and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')
                          and (exists (select 1 from public.shipments s where s.order_id = o.id
                                       and s.status in ('pending', 'picking', 'packed', 'ready_for_dispatch',
                                                        'out_for_delivery', 'delivery_failed'))
                               or not exists (select 1 from public.shipments s where s.order_id = o.id
                                              and s.status <> 'cancelled'))
                         then (select c.code from private.delivery_codes c where c.order_id = o.id) end,
    'can_cancel', v_is_staff and o.status in ('pending_payment', 'payment_review', 'confirmed', 'processing')
                  and not exists (select 1 from public.shipments s where s.order_id = o.id
                                  and s.status not in ('pending', 'picking', 'cancelled'))
                  or (o.status in ('pending_payment', 'payment_review', 'confirmed')
                      and not exists (select 1 from public.shipments s
                                      where s.order_id = o.id and s.status <> 'pending')),
    'address', jsonb_build_object(
      'recipient_name', o.ship_recipient_name, 'phone', o.ship_phone,
      'postal_code', o.ship_postal_code, 'senas', o.ship_senas,
      'lat', o.ship_lat, 'lng', o.ship_lng, 'plus_code', o.ship_plus_code,
      'district', (select d.name from public.districts d where d.postal_code = o.ship_postal_code),
      'canton', (select c.name from public.districts d join public.cantons c on c.code = d.canton_code
                 where d.postal_code = o.ship_postal_code)),
    'payment', (
      select jsonb_build_object(
        'method', p.method, 'status', p.status, 'amount_minor', p.amount_minor,
        'provider', p.provider, 'sinpe_reference', p.sinpe_reference, 'captured_at', p.captured_at)
      from public.payments p where p.order_id = o.id order by p.created_at desc limit 1),
    'items', (
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'variant_name', i.variant_name, 'image_path', i.image_path,
        'product_slug', (select pr.slug from public.products pr where pr.id = i.product_id),
        'seller_name', (select s.trade_name from public.sellers s where s.id = i.seller_id),
        'unit_price_minor', i.unit_price_minor, 'quantity', i.quantity,
        'line_total_minor', i.line_total_minor, 'fulfillment', i.fulfillment,
        'review', (select jsonb_build_object('rating', r.rating, 'title', r.title, 'body', r.body)
                   from public.reviews r where r.order_item_id = i.id),
        'returned_quantity', (select coalesce(sum(rr.quantity), 0) from public.return_requests rr
                              where rr.order_item_id = i.id and rr.status <> 'rejected')
      ) order by i.line_total_minor desc, i.id)
      from public.order_items i where i.order_id = o.id),
    'shipments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'tracking_code', s.tracking_code, 'status', s.status,
        'package_count', s.package_count, 'attempt_count', s.attempt_count,
        'promise_latest', s.promise_latest, 'delivered_at', s.delivered_at,
        'item_ids', (select jsonb_agg(si.order_item_id) from public.shipment_items si
                     where si.shipment_id = s.id),
        -- How many of each line travel in it (a line can be split over parcels).
        'units', (select coalesce(jsonb_agg(jsonb_build_object('order_item_id', si.order_item_id,
                                                               'quantity', si.quantity)
                                            order by si.order_item_id), '[]'::jsonb)
                  from public.shipment_items si where si.shipment_id = s.id),
        -- While a parcel is on the road the shopper sees who is bringing it:
        -- a first name, nothing more.
        'driver_first_name', (
          select split_part(d.full_name, ' ', 1)
          from public.route_stops rs
          join public.routes r on r.id = rs.route_id
          join public.drivers d on d.id = r.driver_id
          where rs.shipment_id = s.id and r.status = 'in_progress' and s.status = 'out_for_delivery'
          limit 1),
        'recalled', s.recalled_at is not null,
        'stopped_before_leaving', s.recalled_at is not null and private.shipment_never_left(s.id),
        -- What ops_recall_shipment accepts: packed or ready in a Yuntera
        -- warehouse, and not on a route being driven.
        'can_recall', v_is_ops and s.status in ('packed', 'ready_for_dispatch')
          and exists (select 1 from public.warehouses w where w.id = s.origin_warehouse_id and w.kind = 'platform')
          and not exists (select 1 from public.route_stops rs join public.routes r on r.id = rs.route_id
                          where rs.shipment_id = s.id and rs.status in ('pending', 'arrived')
                            and r.status = 'in_progress')
      ) order by s.created_at, s.id)
      from public.shipments s where s.order_id = o.id), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', e.created_at, 'kind', e.kind, 'from_status', e.from_status,
        'to_status', e.to_status, 'note', e.note,
        'stopped_before_leaving', e.kind = 'shipment_status' and exists (
          select 1 from public.shipments s
          where s.id = e.shipment_id and s.recalled_at is not null and private.shipment_never_left(s.id)))
        order by e.created_at, e.id)
      from public.order_events e
      where e.order_id = o.id and (e.visible_to_customer or v_is_staff)), '[]'::jsonb)
  );
end;
$$;

-- ═══ 3. A shopper's own cancellation ═══════════════════════════════════════

-- Replaces the version in 20261121082900_integrity.sql. One change (header,
-- point 3): when the caller owns the order, the reason is always the
-- shopper's own sentence, whatever `p_reason` says.
create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_is_staff boolean := private.has_staff_role('ops', 'support');
  v_status public.order_status;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not (v_order.user_id = (select auth.uid()) or v_is_staff) then
    perform private.fail('order_not_found');
  end if;

  if v_order.status not in ('pending_payment', 'payment_review', 'confirmed', 'processing') then
    perform private.fail('too_late_to_cancel', v_order.status::text);
  end if;
  -- Once the warehouse has started on it, only staff can stop it; the shopper
  -- still has the withdrawal right after delivery.
  if not v_is_staff and (
    v_order.status = 'processing'
    or exists (select 1 from public.shipments s where s.order_id = p_order_id and s.status <> 'pending')
  ) then
    perform private.fail('too_late_to_cancel', 'in_preparation');
  end if;
  -- Staff can stop it while it is being picked, not once a parcel is packed.
  if exists (
    select 1 from public.shipments s
    where s.order_id = p_order_id and s.status not in ('pending', 'picking', 'cancelled')
  ) then
    perform private.fail('too_late_to_cancel', 'packed');
  end if;

  -- Since 085000: the shopper's own cancellation reads as theirs; what they
  -- typed is neither stored nor given back. Staff keep their own words.
  perform private.cancel_order_internal(
    p_order_id, case when v_order.user_id = (select auth.uid()) then 'Cancelado por el cliente'
                     else coalesce(nullif(trim(p_reason), ''), 'Cancelado por el cliente') end);

  select status into v_status from public.orders where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', v_status);
end;
$$;

-- ═══ 4. When a refund was completed ════════════════════════════════════════

-- Replaces the version in 20261121083400_payments.sql. One change (header,
-- point 4): completed_at is never earlier than requested_at.
create or replace function private.settle_gateway_refund(
  p_id uuid,
  p_bank_reference text default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  g private.gateway_refunds%rowtype;
  v_reason text;
  v_tx uuid;
  v_number text;
begin
  select * into g from private.gateway_refunds where id = p_id for update;
  if not found or g.status = 'succeeded' then
    return false;
  end if;
  if g.refund_id is not null then
    select reason into v_reason from private.refunds where id = g.refund_id;
    -- A cancelled order's reversal of simulated money already took it out of
    -- the gateway account; every other refund waits in refunds_payable.
    if not (g.channel = 'simulated' and v_reason = 'order_cancelled') then
      select order_number into v_number from public.orders where id = g.order_id;
      insert into public.ledger_transactions (kind, order_id, memo, created_by)
      values ('refund_paid', g.order_id,
              case g.channel when 'transfer' then 'Reembolso transferido, pedido '
                             else 'Reembolso enviado por la pasarela, pedido ' end || v_number,
              (select auth.uid()))
      returning id into v_tx;
      insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
        (v_tx, private.ledger_account('refunds_payable'), g.amount_minor),
        (v_tx, private.ledger_account(case g.channel when 'transfer' then 'bank_operating'
                                                     else 'gateway_clearing' end), -g.amount_minor);
    end if;
  end if;

  update private.gateway_refunds
  -- Since 085000: a refund settled in the transaction that opened it (the
  -- simulation) was requested at clock_timestamp(), after now().
  set status = 'succeeded', completed_at = greatest(now(), g.requested_at), completion_tx = v_tx,
      completed_by = (select auth.uid()),
      bank_reference = coalesce(nullif(trim(p_bank_reference), ''), bank_reference),
      failure_code = null, locked_until = null, locked_by = null
  where id = p_id;

  if g.refund_id is not null then
    perform private.payments_refresh_refund_status(g.order_id);
    insert into public.order_events (order_id, kind, note, actor_id)
    values (g.order_id, 'payment', 'Reembolso completado', (select auth.uid()));
  else
    update private.payment_reviews set status = 'refunded' where id = g.review_id;
  end if;
  return true;
end;
$$;

-- ═══ 5. Orders cancelled before this migration ══════════════════════════════

-- Points 2 and 3 change what the functions write from now on. Orders cancelled
-- before 085000 still carry the old words: a shopper's own cancellation sent
-- with a text of their own kept that text (so the shopper read the words of a
-- staff cancellation), and an order whose parcels staff all stopped before
-- they left kept "Los paquetes regresaron sin entregarse". This gives those
-- orders the reason the functions above would have written, by the same
-- rules: the cancellation whose order_status event was made by the order's
-- own shopper becomes "Cancelado por el cliente" (unless it already holds one
-- of the database's sentences), and a check-in cancellation whose returned
-- parcels were all stopped by staff and never went out becomes "Los paquetes
-- no salieron de la bodega". Nothing else of the order changes (no status,
-- money, event or message). It can run again: a second run changes nothing.
-- Kept as a function, owned by postgres and granted to no one, so a suite
-- can run it on orders made in the old shape.
create function private.reword_old_cancel_reasons() returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_shopper integer;
  v_stopped integer;
begin
  update public.orders o
  set cancel_reason = 'Cancelado por el cliente'
  where o.status in ('cancelled', 'refunded')
    and o.cancel_reason is not null
    and o.cancel_reason not in ('Pago no recibido a tiempo',
                                'Los paquetes regresaron sin entregarse',
                                'Los paquetes no salieron de la bodega',
                                'Cancelado por el cliente')
    and (select e.actor_id from public.order_events e
         where e.order_id = o.id and e.kind = 'order_status' and e.to_status = 'cancelled'
         order by e.created_at, e.id limit 1) = o.user_id;
  get diagnostics v_shopper = row_count;

  update public.orders o
  set cancel_reason = 'Los paquetes no salieron de la bodega'
  where o.status in ('cancelled', 'refunded')
    and o.cancel_reason = 'Los paquetes regresaron sin entregarse'
    and exists (select 1 from public.shipments s
                where s.order_id = o.id and s.status = 'returned')
    and not exists (select 1 from public.shipments s
                    where s.order_id = o.id and s.status = 'returned'
                      and not (s.recalled_at is not null and private.shipment_never_left(s.id)));
  get diagnostics v_stopped = row_count;

  return v_shopper + v_stopped;
end;
$$;

select private.reword_old_cancel_reasons();
