-- Checkout: placing, paying for and cancelling an order.
--
-- These functions are the only way an order comes into existence. Each one is a
-- single transaction: either the order, its lines, its stock reservations, its
-- shipments and its payment record all exist, or none of them do.

insert into public.app_settings (key, value, description) values
  ('order_number_prefix', '"YT"', 'Prefix of order numbers and tracking codes.');

-- ── Internal helpers ───────────────────────────────────────────────────────

-- Hands a paid order to the warehouse: one pick task per line that leaves from a
-- platform warehouse. Seller-origin shipments are prepared by the seller instead.
create or replace function private.release_order_to_fulfillment(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.pick_tasks
    (shipment_id, order_item_id, warehouse_id, sku_id, seller_id, location_id, quantity)
  select s.id, si.order_item_id, s.origin_warehouse_id, i.sku_id, i.seller_id,
         (select b.location_id
          from public.bin_stock b
          join public.warehouse_locations wl on wl.id = b.location_id
          where wl.warehouse_id = s.origin_warehouse_id
            and b.sku_id = i.sku_id and b.seller_id = i.seller_id and b.quantity > 0
          order by b.quantity desc, wl.code
          limit 1),
         si.quantity
  from public.shipments s
  join public.shipment_items si on si.shipment_id = s.id
  join public.order_items i on i.id = si.order_item_id
  join public.warehouses w on w.id = s.origin_warehouse_id
  where s.order_id = p_order_id
    and w.kind = 'platform'
    and not exists (
      select 1 from public.pick_tasks t
      where t.shipment_id = s.id and t.order_item_id = si.order_item_id
    );

  perform private.emit('order.released', jsonb_build_object('order_id', p_order_id));
end;
$$;

-- Marks an order's payment as received and books it. Idempotent.
create or replace function private.capture_payment(
  p_order_id uuid,
  p_provider_reference text,
  p_cash boolean default false
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_payment uuid;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('order_not_found');
  end if;

  select id into v_payment from public.payments
  where order_id = p_order_id and status in ('pending', 'authorized')
  order by created_at limit 1
  for update;
  if v_payment is null then
    return; -- already captured, cancelled or refunded
  end if;
  if v_status in ('cancelled', 'refunded') then
    perform private.fail('order_not_payable', v_status::text);
  end if;

  update public.payments
  set status = 'captured', captured_at = now(), provider_reference = p_provider_reference
  where id = v_payment;

  insert into public.order_events (order_id, kind, to_status, note, actor_id)
  values (p_order_id, 'payment', 'captured', 'Pago recibido', (select auth.uid()));

  perform private.post_order_capture(p_order_id, p_cash);

  if v_status in ('pending_payment', 'payment_review') then
    update public.orders set status = 'confirmed', confirmed_at = now() where id = p_order_id;
    perform private.release_order_to_fulfillment(p_order_id);
  end if;

  perform private.emit('payment.captured', jsonb_build_object('order_id', p_order_id));
  -- The seller's electronic invoice to the shopper is issued from this event.
  perform private.emit('invoice.requested', jsonb_build_object('order_id', p_order_id));
end;
$$;

-- Releases stock, stops fulfilment and settles the payment for a cancelled order.
create or replace function private.cancel_order_internal(p_order_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_paid boolean;
begin
  update public.pick_tasks t
  set status = 'cancelled'
  from public.shipments s
  where s.id = t.shipment_id and s.order_id = p_order_id and t.status in ('open', 'in_progress', 'short');

  update public.shipments
  set status = 'cancelled'
  where order_id = p_order_id and status in ('pending', 'picking', 'packed', 'ready_for_dispatch');

  for r in
    select res.id, res.warehouse_id, res.sku_id, res.seller_id, res.quantity
    from public.inventory_reservations res
    join public.order_items i on i.id = res.order_item_id
    where i.order_id = p_order_id and res.status = 'active'
    order by res.sku_id, res.warehouse_id
    for update of res
  loop
    update public.stock_levels
    set reserved = reserved - r.quantity
    where warehouse_id = r.warehouse_id and sku_id = r.sku_id and seller_id = r.seller_id;
    update public.inventory_reservations
    set status = 'released', resolved_at = now() where id = r.id;
  end loop;

  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 500)
  where id = p_order_id;

  select exists (
    select 1 from public.payments where order_id = p_order_id and status = 'captured'
  ) into v_paid;

  if v_paid then
    if private.setting('payments_mode') = '"sandbox"'::jsonb then
      -- No real money moved: settle the books immediately.
      update public.payments
      set status = 'refunded', refunded_at = now()
      where order_id = p_order_id and status = 'captured';
      perform private.post_order_refund(p_order_id);
      update public.orders set status = 'refunded' where id = p_order_id;
    else
      -- The refund goes back through the gateway, by the same method the shopper paid with.
      perform private.emit('refund.requested', jsonb_build_object('order_id', p_order_id));
    end if;
  else
    update public.payments
    set status = 'cancelled'
    where order_id = p_order_id and status in ('pending', 'authorized');
  end if;

  perform private.emit('order.cancelled',
    jsonb_build_object('order_id', p_order_id, 'reason', p_reason));
end;
$$;

-- ── Place an order ─────────────────────────────────────────────────────────

create or replace function public.place_order(
  p_items jsonb,
  p_address_id uuid,
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_expected_total_minor bigint default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_existing public.orders%rowtype;
  v_addr public.addresses%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_zone_id text;
  v_max_units integer := (private.setting('max_units_per_line'))::integer;
  v_max_lines integer := (private.setting('max_lines_per_order'))::integer;
  v_cod_max bigint := (private.setting('cod_max_order_minor'))::bigint;
  v_prefix text := private.setting('order_number_prefix') #>> '{}';
  v_check record;
  v_shipping bigint;
  v_shipping_tax bigint;
  v_total bigint;
  v_promise record;
  v_order_id uuid;
  v_number text;
  v_pin text;
  v_today date := private.cr_local(now())::date;
  v_line record;
  v_warehouse uuid;
  v_warehouse_seller uuid;
  v_item_id uuid;
  v_shipment uuid;
  v_sinpe_ref text;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;

  -- A retried request returns the order it already created.
  select * into v_existing from public.orders
  where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_id', v_existing.id, 'order_number', v_existing.order_number,
      'status', v_existing.status, 'total_minor', v_existing.total_minor, 'replayed', true);
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('cart_empty');
  end if;

  select * into v_addr from public.addresses
  where id = p_address_id and user_id = v_user and deleted_at is null;
  if not found then
    perform private.fail('address_not_found');
  end if;

  v_zone_id := private.zone_for_postal_code(v_addr.postal_code);
  select * into v_zone from public.delivery_zones where id = v_zone_id;
  if not found or not v_zone.active then
    perform private.fail('zone_not_served', v_addr.postal_code);
  end if;

  -- Pass 1: validate every line and price the order from the database's own
  -- data. Nothing the client says about prices is trusted.
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
  select count(*) as line_count,
         count(*) filter (where quantity is null or quantity <= 0 or quantity > v_max_units) as bad_quantity,
         (array_agg(offer_id) filter (where not coalesce(buyable, false)))[1] as unavailable_offer,
         coalesce(sum(price_minor * quantity) filter (where buyable), 0)::bigint as items_total,
         coalesce(sum(
           price_minor * quantity
           - round((price_minor * quantity)::numeric * 10000 / (10000 + tax_rate_bps))
         ) filter (where buyable), 0)::bigint as items_tax,
         coalesce(max(case when fulfillment = 'seller' then handling_days else 0 end), 0) as handling_days
  into v_check
  from priced;

  if v_check.line_count > v_max_lines then
    perform private.fail('too_many_lines');
  end if;
  if v_check.bad_quantity > 0 then
    perform private.fail('invalid_quantity');
  end if;
  if v_check.unavailable_offer is not null then
    perform private.fail('offer_unavailable', v_check.unavailable_offer::text);
  end if;

  v_shipping := case
    when v_zone.free_shipping_threshold_minor is not null
         and v_check.items_total >= v_zone.free_shipping_threshold_minor then 0
    else v_zone.shipping_fee_minor
  end;
  v_shipping_tax := v_shipping - round(v_shipping::numeric * 10000 / 11300)::bigint;
  v_total := v_check.items_total + v_shipping;

  if p_payment_method = 'cash_on_delivery'
     and (not v_zone.cod_available or v_total > v_cod_max) then
    perform private.fail('cod_not_available');
  end if;

  -- The shopper confirmed a specific total; if a price moved since, say so
  -- instead of charging a different amount.
  if p_expected_total_minor is not null and p_expected_total_minor <> v_total then
    perform private.fail('price_changed', v_total::text);
  end if;

  select * into v_promise from private.compute_promise(v_zone.id, v_check.handling_days);

  v_number := v_prefix || '-' || nextval('private.order_number_seq');
  v_pin := lpad(
    ((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::integer) % 10000)::text, 4, '0');

  insert into public.orders (
    order_number, user_id, status, items_total_minor, shipping_minor, total_minor,
    tax_included_minor, payment_method, zone_id,
    ship_recipient_name, ship_phone, ship_postal_code, ship_senas, ship_lat, ship_lng, ship_plus_code,
    promise_earliest, promise_latest, delivery_pin, withdrawal_deadline, idempotency_key,
    confirmed_at
  ) values (
    v_number, v_user,
    -- Cash on delivery is confirmed at once: there is nothing to wait for.
    case when p_payment_method = 'cash_on_delivery' then 'confirmed' else 'pending_payment' end::public.order_status,
    v_check.items_total, v_shipping, v_total,
    v_check.items_tax + v_shipping_tax, p_payment_method, v_zone.id,
    v_addr.recipient_name, v_addr.phone, v_addr.postal_code, v_addr.senas, v_addr.lat, v_addr.lng,
    v_addr.plus_code,
    v_promise.earliest, v_promise.latest, v_pin, private.add_business_days(v_today, 8),
    p_idempotency_key,
    case when p_payment_method = 'cash_on_delivery' then now() end
  )
  returning id into v_order_id;

  -- Pass 2: reserve stock and write the lines. Lines are taken in a fixed order
  -- so two concurrent checkouts lock stock rows in the same sequence.
  for v_line in
    with requested as (
      select (e ->> 'offer_id')::uuid as offer_id, sum((e ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e
      group by 1
    )
    select r.offer_id, r.quantity, o.price_minor, o.fulfillment, o.seller_id, o.sku_id,
           k.product_id, k.variant_name, k.weight_grams,
           greatest(k.length_cm, k.width_cm, k.height_cm) as longest_side_cm,
           p.title, p.tax_rate_bps, p.category_id,
           (select i.path from public.product_images i
            where i.product_id = p.id order by i.sort, i.id limit 1) as image_path
    from requested r
    join public.offers o on o.id = r.offer_id
    join public.skus k on k.id = o.sku_id
    join public.products p on p.id = k.product_id
    order by o.sku_id, o.seller_id
  loop
    -- Take the units from one stock node that has them all. The WHERE repeats
    -- the availability test so a concurrent order that got there first leaves
    -- this update matching nothing, rather than overselling.
    update public.stock_levels l
    set reserved = l.reserved + v_line.quantity
    where (l.warehouse_id, l.sku_id, l.seller_id) = (
            select l2.warehouse_id, l2.sku_id, l2.seller_id
            from public.stock_levels l2
            join public.warehouses w on w.id = l2.warehouse_id
            where l2.sku_id = v_line.sku_id
              and l2.seller_id = v_line.seller_id
              and w.active
              and w.kind = (case when v_line.fulfillment = 'platform' then 'platform' else 'seller' end)::public.warehouse_kind
              and l2.on_hand - l2.reserved >= v_line.quantity
            order by l2.on_hand - l2.reserved desc, l2.warehouse_id
            limit 1
          )
      and l.on_hand - l.reserved >= v_line.quantity
    returning l.warehouse_id into v_warehouse;

    if v_warehouse is null then
      perform private.fail('insufficient_stock', v_line.offer_id::text);
    end if;

    insert into public.order_items (
      order_id, offer_id, sku_id, product_id, seller_id, category_id, title, variant_name,
      image_path, unit_price_minor, quantity, line_total_minor, tax_rate_bps, tax_minor,
      fulfillment, weight_grams, longest_side_cm
    ) values (
      v_order_id, v_line.offer_id, v_line.sku_id, v_line.product_id, v_line.seller_id,
      v_line.category_id, v_line.title, v_line.variant_name, v_line.image_path,
      v_line.price_minor, v_line.quantity, v_line.price_minor * v_line.quantity,
      v_line.tax_rate_bps,
      (v_line.price_minor * v_line.quantity
        - round((v_line.price_minor * v_line.quantity)::numeric * 10000 / (10000 + v_line.tax_rate_bps)))::bigint,
      v_line.fulfillment, v_line.weight_grams, v_line.longest_side_cm
    )
    returning id into v_item_id;

    insert into public.inventory_reservations (order_item_id, warehouse_id, sku_id, seller_id, quantity)
    values (v_item_id, v_warehouse, v_line.sku_id, v_line.seller_id, v_line.quantity);

    -- One shipment per place the goods leave from.
    select s.id into v_shipment from public.shipments s
    where s.order_id = v_order_id and s.origin_warehouse_id = v_warehouse;
    if v_shipment is null then
      select w.seller_id into v_warehouse_seller from public.warehouses w where w.id = v_warehouse;
      insert into public.shipments (order_id, tracking_code, origin_warehouse_id, seller_id, promise_latest)
      values (v_order_id, v_prefix || nextval('private.tracking_seq'), v_warehouse,
              v_warehouse_seller, v_promise.latest)
      returning id into v_shipment;
    end if;

    insert into public.shipment_items (shipment_id, order_item_id, quantity)
    values (v_shipment, v_item_id, v_line.quantity);

    v_warehouse := null;
    v_shipment := null;
  end loop;

  v_sinpe_ref := case when p_payment_method = 'sinpe_movil' then split_part(v_number, '-', 2) end;
  insert into public.payments (order_id, method, provider, amount_minor, sinpe_reference)
  values (
    v_order_id, p_payment_method,
    case when p_payment_method = 'cash_on_delivery' then 'cash'
         else private.setting('payments_mode') #>> '{}' end,
    v_total, v_sinpe_ref);

  insert into public.order_events (order_id, kind, to_status, note, actor_id)
  values (v_order_id, 'note', null, 'Pedido recibido', v_user);

  perform private.emit('order.placed', jsonb_build_object('order_id', v_order_id));

  if p_payment_method = 'cash_on_delivery' then
    perform private.release_order_to_fulfillment(v_order_id);
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_number,
    'status', case when p_payment_method = 'cash_on_delivery' then 'confirmed' else 'pending_payment' end,
    'total_minor', v_total,
    'shipping_minor', v_shipping,
    'promise_earliest', v_promise.earliest,
    'promise_latest', v_promise.latest,
    'sinpe_reference', v_sinpe_ref,
    'replayed', false);
end;
$$;

-- ── Payment (sandbox) ──────────────────────────────────────────────────────
-- Stands in for the payment gateway during pilots and demos. In production the
-- gateway's signed webhook calls private.capture_payment from a server-side
-- function; this entry point refuses to run unless the platform is in sandbox mode.

create or replace function public.confirm_sandbox_payment(p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if private.setting('payments_mode') is distinct from '"sandbox"'::jsonb then
    perform private.fail('sandbox_disabled');
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found
     or not (v_order.user_id = (select auth.uid()) or private.has_staff_role('ops', 'support', 'finance')) then
    perform private.fail('order_not_found');
  end if;
  if v_order.status <> 'pending_payment' then
    perform private.fail('order_not_payable', v_order.status::text);
  end if;

  perform private.capture_payment(p_order_id, 'sandbox:' || p_order_id, false);
  return jsonb_build_object('order_id', p_order_id, 'status', 'confirmed');
end;
$$;

-- ── Cancel ─────────────────────────────────────────────────────────────────

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

  perform private.cancel_order_internal(
    p_order_id, coalesce(nullif(trim(p_reason), ''), 'Cancelado por el cliente'));

  select status into v_status from public.orders where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', v_status);
end;
$$;

-- Frees stock held by orders that were never paid. Run on a schedule.
create or replace function private.expire_unpaid_orders() returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_minutes integer := (private.setting('reservation_minutes'))::integer;
  v_count integer := 0;
  r record;
begin
  for r in
    select id from public.orders
    where status = 'pending_payment'
      and placed_at < now() - make_interval(mins => v_minutes)
    order by placed_at
    for update skip locked
  loop
    perform private.cancel_order_internal(r.id, 'Pago no recibido a tiempo');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── Seller's view of their sales ───────────────────────────────────────────
-- A seller sees the lines they sold and how the order is progressing, never the
-- shopper's phone or address: Yuntera makes the delivery.

create or replace function public.seller_order_lines(
  p_seller_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  order_item_id uuid,
  order_number text,
  order_status public.order_status,
  placed_at timestamptz,
  promise_latest date,
  title text,
  variant_name text,
  quantity integer,
  unit_price_minor bigint,
  line_total_minor bigint,
  fulfillment public.fulfillment_type,
  shipment_id uuid,
  shipment_status public.shipment_status,
  tracking_code text,
  buyer_first_name text,
  district text,
  canton text
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.is_staff()) then
    perform private.fail('forbidden');
  end if;
  return query
    select i.id, o.order_number, o.status, o.placed_at, o.promise_latest, i.title, i.variant_name,
           i.quantity, i.unit_price_minor, i.line_total_minor, i.fulfillment,
           s.id, s.status, s.tracking_code,
           -- First name and coarse location only: enough to write a thank-you note
           -- and plan stock by region, not enough to contact or find the shopper.
           split_part(trim(o.ship_recipient_name), ' ', 1),
           (select d.name from public.districts d where d.postal_code = o.ship_postal_code),
           (select c.name from public.districts d join public.cantons c on c.code = d.canton_code
            where d.postal_code = o.ship_postal_code)
    from public.order_items i
    join public.orders o on o.id = i.order_id
    left join public.shipment_items si on si.order_item_id = i.id
    left join public.shipments s on s.id = si.shipment_id
    where i.seller_id = p_seller_id
      and o.status not in ('pending_payment', 'payment_review')
    order by o.placed_at desc, i.id
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;
