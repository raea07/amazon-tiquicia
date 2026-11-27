-- Shopper follow-ups, after wave 7 (084200, 084300).
--
-- What this migration decides, and why:
--
--   1. THE DELIVERY DATE OF A CART ALTERNATIVE. public.cart_alternatives
--      (083600) gives another shop's offer for a cart line that can no longer
--      be bought, without a delivery date, so the shopper app asked for the
--      product page of each such product to show one. Each alternative now
--      carries `promise` ({earliest, latest}, or null), for the district the
--      cart is priced for (the new optional argument `p_postal_code`). It is
--      the product page's own expression for that offer
--      (private.get_product_page: public.delivery_estimate with the offer's
--      handling days, only where the zone delivers), so the cart and the
--      offer's product page give the same date at the same moment; the
--      delivery promise itself (private.compute_promise, mirrored in
--      packages/core/src/promise.ts with a parity test) is not copied.
--      Without a district, or in one that is not served, `promise` is null,
--      as on the product page. The new column comes last and is optional for
--      every client; a caller that sends only the offer ids is answered as
--      before, plus the column (a null promise). The function is dropped and
--      created again because its arguments and its columns change; its
--      grants are given again below (visitors and signed-in people).
--
--   2. ONE REFUND MESSAGE FOR ONE CANCELLATION. Since 084200 an order
--      cancelled because its parcels came back, when nobody went to the door,
--      refunds the goods of the last parcel and the delivery fee as two
--      refunds of the register, booked in the same transaction
--      (wms_receive_returned_shipment, then private.refund_delivery_fee).
--      Each announced itself: the shopper was told twice that a refund
--      started and twice that it arrived, each time with part of the amount.
--      Now the refunds of one order booked by one transaction together with
--      a delivery-fee refund are announced together:
--        * `refund_initiated` once, on the delivery fee's `refund.requested`
--          (always emitted, after the goods' own), naming the total; the
--          goods' event plans nothing;
--        * `refund_completed` once, when the last of them is confirmed (the
--          event of the confirmation with the highest sequence number;
--          confirmations of one order are serialised by the order's lock),
--          naming the same total; the earlier confirmations plan nothing.
--      Both messages carry `amount_minor` (the total) and
--      `delivery_fee_minor`, so the text can say "el envío incluido". Every
--      other refund is announced on its own, as before: goods alone (a
--      parcel of an order that goes on, a return), a fee alone (its goods
--      were settled otherwise), a later separate refund (another
--      transaction), and a refund settled at the door (which announces
--      nothing of this kind and is left out of a group). Planning stays safe
--      to repeat: which event announces depends only on rows that no longer
--      change once those events exist, and each message keeps its per-event
--      key (private.notify_add).
--      What marks "booked together": `private.refunds.booked_xact`, the
--      top-level transaction id that inserted the row (pg_current_xact_id(),
--      the same inside a function's exception block). Rows booked before
--      this migration have none and are announced alone, as they were.
--
--   3. STAFF'S OWN WORDS FOR A CANCELLATION STAY WITH STAFF.
--      public.get_order sent the shopper `cancel_reason` as stored, and
--      when staff cancel that is what they typed (it may name a colleague
--      or a case). The shopper's pages never show it, but the answer
--      reached the phone and anyone calling the API. Now the shopper gets
--      it only when it is one of the three sentences the database writes
--      itself (the sweep, a return, the shopper's own cancellation), and
--      null otherwise; staff get it as stored. The field stays (the store
--      build of 3f251c3 reads it as a string or null). Nothing else of
--      get_order changes.
--
--   4. A CART LINE KEEPS ITS PRODUCT'S NAME WHEN ITS OFFER IS PAUSED.
--      public.cart_lines (082800) gave an offer the caller can no longer
--      see (paused, or its shop not active) nothing but its id, so the web
--      shop and the shopper app could only say "Producto no disponible" and
--      the shopper could not tell which line to remove. The product's own
--      facts (slug, title, variant, first photo) now come through the
--      offer's product whenever the caller may see that product (it is
--      active, or the caller is staff or the product's own seller), which
--      is exactly what its product page shows anyway. The offer's own facts
--      (shop, price, stock, how it is delivered) still come only from an
--      offer the caller may see, and `buyable` is unchanged. An offer of a
--      product that is not public (a listing awaiting review) still comes
--      back with nothing but its id. Columns and their order are unchanged,
--      so every older client reads the answer as before.

-- ═══ 1. The delivery date of a cart alternative ════════════════════════════

drop function public.cart_alternatives(uuid[]);

-- Replaces the version in 20261121083600_seller_listings.sql. Unchanged but
-- for the argument `p_postal_code` and the column `promise` (section 1 of
-- the header). The offer order between the markers is the one
-- packages/core/src/offers.parity.test.ts checks.
create or replace function public.cart_alternatives(p_offer_ids uuid[], p_postal_code text default null)
returns table (offer_id uuid, product_slug text, title text, variant_name text,
               alternative_offer_id uuid, seller_name text, price_minor bigint,
               list_price_minor bigint, available integer, promise jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select req.offer_id, p.slug, p.title, k.variant_name,
         alt.id, alt.trade_name, alt.price_minor, alt.list_price_minor,
         least(alt.available_quantity, 10),
         -- The product page's promise for this offer, in the cart's district.
         (select jsonb_build_object('earliest', e.earliest, 'latest', e.latest)
          from public.delivery_estimate(p_postal_code, alt.handling_days) e
          where e.zone_active)
  from unnest(p_offer_ids[1:60]) with ordinality as req (offer_id, position)
  join public.offers mine on mine.id = req.offer_id
  join public.skus k on k.id = mine.sku_id and k.active
  join public.products p on p.id = k.product_id and p.status = 'active'
  cross join lateral (
    select o.id, s.trade_name, o.price_minor, o.list_price_minor, o.available_quantity,
           o.handling_days
    from public.offers o
    join public.sellers s on s.id = o.seller_id
    where o.sku_id = k.id and o.id <> mine.id and o.status = 'active' and s.status = 'active'
      and o.available_quantity > 0 and o.condition = 'new'
    -- BEGIN offer_order
    order by (o.available_quantity > 0) desc, o.price_minor asc, o.created_at asc, o.id asc
    -- END offer_order
    limit 1
  ) alt
  where private.product_page_open(p.id)
    and not (mine.status = 'active' and mine.available_quantity > 0
             and exists (select 1 from public.sellers ms where ms.id = mine.seller_id and ms.status = 'active'))
  order by req.position;
$$;

-- ═══ 2. Refunds booked together ════════════════════════════════════════════

-- Which transaction booked a refund. Null for the rows that exist now: they
-- were announced, or are about to be, one by one.
alter table private.refunds add column booked_xact xid8;
alter table private.refunds alter column booked_xact set default pg_current_xact_id();

-- The order in which refunds were confirmed. Confirmations of one order are
-- taken one after the other (private.confirm_refund locks the order first),
-- so among an order's refunds the highest number is the last confirmation.
alter table private.refund_confirmations add column seq bigint generated always as identity;

-- How the refund `p_refund_id` is announced (section 2 of the header). Null:
-- on its own, as any refund. Otherwise its group: `announce` (whether this
-- refund's event plans the message), `amount_minor` (the group's total),
-- `delivery_fee_minor` and `refund_count`. `p_completed` is false for
-- `refund.requested` and true for `refund.completed`.
create or replace function private.refund_announcement(p_refund_id uuid, p_completed boolean)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  f private.refunds%rowtype;
  v_fee bigint;
  v_ids uuid[];
  v_total bigint;
  v_last uuid;
begin
  select * into f from private.refunds where id = p_refund_id;
  if not found or f.booked_xact is null then
    return null;
  end if;
  select x.amount_minor into v_fee from private.refunds x
  where x.order_id = f.order_id and x.booked_xact = f.booked_xact and x.reason = 'delivery_fee';
  if not found then
    return null;
  end if;
  -- Booked by the same transaction, for the same order, and sent back the
  -- usual way (a refund settled at the door moved no money and announces
  -- nothing of this kind).
  select array_agg(x.id order by x.id), sum(x.amount_minor) into v_ids, v_total
  from private.refunds x
  where x.order_id = f.order_id and x.booked_xact = f.booked_xact
    and not exists (select 1 from public.ledger_entries e
                    where e.transaction_id = x.ledger_transaction_id
                      and e.account_id = private.ledger_account('driver_cash'));
  if coalesce(cardinality(v_ids), 0) < 2 or not (f.id = any (v_ids)) then
    return null;
  end if;
  if p_completed then
    -- Only once every one of them is confirmed, and only on the last one.
    if (select count(*) from private.refund_confirmations c where c.refund_id = any (v_ids))
       < cardinality(v_ids) then
      return jsonb_build_object('announce', false);
    end if;
    select c.refund_id into v_last from private.refund_confirmations c
    where c.refund_id = any (v_ids)
    order by c.seq desc
    limit 1;
  end if;
  return jsonb_build_object(
    'announce', case when p_completed then f.id = v_last else f.reason = 'delivery_fee' end,
    'amount_minor', v_total,
    'delivery_fee_minor', v_fee,
    'refund_count', cardinality(v_ids));
end;
$$;

-- ═══ 3. The planner ════════════════════════════════════════════════════════

-- Replaces the version in 20261121083700_console_catalogue.sql. Unchanged
-- but for the two refund topics, which ask private.refund_announcement
-- whether this event announces and with what total. The table in
-- docs/06-operations/notifications.md is unchanged (same topics, templates
-- and channels), and the test in packages/notifications that compares the
-- two reads this definition.
create or replace function private.notify_plan_event(p_event private.outbox_events) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id bigint := p_event.id;
  p jsonb := p_event.payload;
  v_order public.orders;
  v_ship public.shipments;
  v_key text;
  v_ctx jsonb;
  v_group jsonb;
  r record;
begin
  if p ? 'order_id' then
    select * into v_order from public.orders where id = (p ->> 'order_id')::uuid;
  elsif p ? 'shipment_id' then
    select * into v_ship from public.shipments where id = (p ->> 'shipment_id')::uuid;
    select * into v_order from public.orders where id = v_ship.order_id;
  elsif p ? 'return_request_id' then
    select o.* into v_order from public.return_requests rr
    join public.order_items i on i.id = rr.order_item_id
    join public.orders o on o.id = i.order_id
    where rr.id = (p ->> 'return_request_id')::uuid;
  end if;
  v_key := case when v_order.id is not null then 'order:' || v_order.id end;
  v_ctx := jsonb_strip_nulls(jsonb_build_object(
    'order_id', v_order.id,
    'shipment_id', p ->> 'shipment_id',
    'route_id', p ->> 'route_id',
    'return_request_id', p ->> 'return_request_id',
    'amount_minor', p -> 'amount_minor'));

  case p_event.topic
    when 'order.placed' then
      perform private.notify_person(v_id, 'order_placed', v_order.user_id,
        array['email', 'push', 'whatsapp'], v_key, v_ctx);
      if v_order.payment_method in ('sinpe_movil', 'bank_transfer') then
        perform private.notify_team(v_id, 'staff_payment_to_confirm', 'finance', v_key, v_ctx);
      end if;

    when 'payment.captured' then
      perform private.notify_person(v_id, 'payment_received', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'order.released' then
      for r in select distinct i.seller_id from public.order_items i where i.order_id = v_order.id
               order by i.seller_id loop
        perform private.notify_shop(v_id, 'seller_new_order', r.seller_id,
          array['email', 'whatsapp', 'push'], v_key, v_ctx || jsonb_build_object('seller_id', r.seller_id));
      end loop;

    when 'order.cancelled' then
      perform private.notify_person(v_id, 'order_cancelled', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);
      for r in select distinct i.seller_id from public.order_items i where i.order_id = v_order.id
               order by i.seller_id loop
        perform private.notify_shop(v_id, 'seller_order_cancelled', r.seller_id,
          array['email', 'push'], v_key, v_ctx || jsonb_build_object('seller_id', r.seller_id));
      end loop;

    when 'refund.requested' then
      -- Refunds booked together with a delivery-fee refund are announced
      -- once, on the fee's event, with their total (see
      -- private.refund_announcement); every other refund on its own.
      v_group := private.refund_announcement((p ->> 'refund_id')::uuid, false);
      if v_group is null or (v_group ->> 'announce')::boolean then
        perform private.notify_person(v_id, 'refund_initiated', v_order.user_id,
          array['email'], v_key, v_ctx || coalesce(v_group - 'announce', '{}'::jsonb));
      end if;

    when 'refund.completed' then
      -- The same refunds are announced once more, when the last of them is
      -- confirmed, with the same total.
      v_group := private.refund_announcement((p ->> 'refund_id')::uuid, true);
      if v_group is null or (v_group ->> 'announce')::boolean then
        perform private.notify_person(v_id, 'refund_completed', v_order.user_id,
          array['email', 'push'], v_key, v_ctx || coalesce(v_group - 'announce', '{}'::jsonb));
      end if;

    when 'shipment.scheduled' then
      perform private.notify_person(v_id, 'shipment_scheduled', v_order.user_id,
        array['email', 'push'], v_key, v_ctx, 'shopper', 'shop', now() + interval '1 day');

    when 'shipment.out_for_delivery' then
      perform private.notify_person(v_id, 'shipment_out_for_delivery', v_order.user_id,
        array['push', 'whatsapp', 'email', 'sms'], v_key, v_ctx, 'shopper', 'shop',
        now() + interval '4 hours');

    when 'shipment.delivered' then
      perform private.notify_person(v_id, 'shipment_delivered', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'shipment.delivery_failed' then
      perform private.notify_person(v_id, 'shipment_delivery_failed', v_order.user_id,
        array['push', 'whatsapp', 'email', 'sms'], v_key, v_ctx || jsonb_build_object('reason', p ->> 'reason'));
      perform private.notify_team(v_id, 'staff_delivery_failed', 'ops', v_key,
        v_ctx || jsonb_build_object('reason', p ->> 'reason'));

    when 'return.requested' then
      -- A withdrawal of the purchase is approved as it is asked: the shopper
      -- is told how the goods are collected, not that it will be reviewed.
      select rr.kind into r from public.return_requests rr
      where rr.id = (p ->> 'return_request_id')::uuid;
      perform private.notify_person(v_id,
        case when r.kind = 'withdrawal' then 'return_approved' else 'return_received' end,
        v_order.user_id, array['email'], v_key, v_ctx);
      perform private.notify_team(v_id, 'staff_return_requested', 'support', v_key, v_ctx);

    when 'return.decided' then
      perform private.notify_person(v_id,
        case when (p ->> 'approved')::boolean then 'return_approved' else 'return_rejected' end,
        v_order.user_id, array['email', 'push'], v_key, v_ctx);

    when 'return.received' then
      perform private.notify_person(v_id, 'return_goods_received', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'delivery_code.locked' then
      perform private.notify_person(v_id, 'delivery_code_locked', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);
      perform private.notify_team(v_id, 'staff_delivery_code_locked', 'support', v_key, v_ctx);

    when 'delivery_code.released' then
      perform private.notify_person(v_id, 'delivery_code_released', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'complaint.filed' then
      select c.user_id, c.order_id into r from public.complaints c where c.id = (p ->> 'complaint_id')::uuid;
      perform private.notify_person(v_id, 'complaint_received', r.user_id, array['email'],
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id', 'order_id', r.order_id)));
      perform private.notify_team(v_id, 'staff_complaint_filed', 'support',
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id', 'order_id', r.order_id)));

    when 'complaint.answered' then
      select c.user_id, c.order_id into r from public.complaints c where c.id = (p ->> 'complaint_id')::uuid;
      perform private.notify_person(v_id, 'complaint_answered', r.user_id, array['email'],
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id',
          'order_id', r.order_id, 'closed', p -> 'closed')));

    when 'content.reported' then
      perform private.notify_team(v_id, 'staff_content_reported', 'trust', 'team:trust',
        jsonb_build_object('report_id', p ->> 'report_id'));

    when 'report.resolved' then
      select cr.reporter_id, cr.reporter_email into r from public.content_reports cr
      where cr.id = (p ->> 'report_id')::uuid;
      if r.reporter_id is not null then
        perform private.notify_person(v_id, 'report_resolved', r.reporter_id, array['email'],
          'user:' || r.reporter_id,
          jsonb_build_object('report_id', p ->> 'report_id', 'actioned', p -> 'actioned'), 'reporter');
      elsif r.reporter_email is not null then
        perform private.notify_add(v_id, 'report_resolved', 'email', 'report:' || (p ->> 'report_id'),
          'reporter', 'report:' || (p ->> 'report_id'),
          jsonb_build_object('report_id', p ->> 'report_id', 'actioned', p -> 'actioned'));
      end if;

    when 'product.reviewed' then
      select pr.created_by_seller_id as seller_id into r from public.products pr
      where pr.id = (p ->> 'product_id')::uuid;
      perform private.notify_shop(v_id,
        case when (p ->> 'approved')::boolean then 'seller_listing_approved' else 'seller_listing_rejected' end,
        r.seller_id, array['email', 'push'], 'seller:' || r.seller_id,
        jsonb_build_object('product_id', p ->> 'product_id', 'seller_id', r.seller_id));

    when 'product.staff_changed' then
      -- Everything the message says comes with the event, as it was decided;
      -- the product's title is read when the message is written.
      perform private.notify_shop(v_id, 'seller_listing_staff_change', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        (p - 'brand_changed') || jsonb_build_object('brand_changed', coalesce(p -> 'brand_changed', 'false')));

    when 'seller.status_changed' then
      perform private.notify_shop(v_id, 'seller_account_status', (p ->> 'seller_id')::uuid,
        array['email'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'status', p ->> 'status', 'note', p ->> 'note'));

    when 'seller.member_invited' then
      -- To the invited account's own, confirmed address; never to what was typed.
      -- At most one message per shop and account in an invitation's life (14
      -- days): renewing an invitation, or revoking and sending it again, emits
      -- the event every time, and without this any shop (one still waiting for
      -- approval too) could send our mail to any account as often as it liked.
      -- The invitation itself still shows in the invited account's seller centre.
      select u.id into r from auth.users u
      where u.id = (p ->> 'invitee_id')::uuid and u.email_confirmed_at is not null and u.deleted_at is null
        and not exists (
          select 1 from private.notification_deliveries d
          where d.template = 'seller_invitation' and d.recipient_user_id = u.id
            and d.context ->> 'seller_id' = p ->> 'seller_id'
            and d.created_at > now() - interval '14 days');
      if r.id is not null then
        perform private.notify_person(v_id, 'seller_invitation', r.id, array['email', 'push'],
          'user:' || r.id,
          jsonb_build_object('invitation_id', p ->> 'invitation_id', 'seller_id', p ->> 'seller_id'),
          'seller', 'seller');
      end if;

    when 'seller.change_decided' then
      perform private.notify_shop(v_id, 'seller_change_decided', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'change_request_id', p ->> 'request_id',
          'change_kind', p ->> 'kind', 'approved', p -> 'approved'));

    when 'payout_details.decided' then
      perform private.notify_shop(v_id, 'seller_payout_account_decided', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'payout_request_id', p ->> 'request_id',
          'approved', p -> 'approved'));

    when 'payout.paid' then
      perform private.notify_shop(v_id, 'seller_payout_paid', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'payout_id', p ->> 'payout_id',
          'amount_minor', p -> 'amount_minor'));

    when 'fees.offers_paused' then
      perform private.notify_shop(v_id, 'seller_offers_paused_fees', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'schedule_version', p ->> 'schedule_version',
          'offer_count', p -> 'offer_count'));

    when 'route.assigned' then
      select d.user_id into r from public.drivers d where d.id = (p ->> 'driver_id')::uuid;
      perform private.notify_person(v_id, 'driver_route_assigned', r.user_id, array['push'],
        'route:' || (p ->> 'route_id'), jsonb_build_object('route_id', p ->> 'route_id'),
        'driver', 'driver');

    else
      null; -- a topic routed here without messages yet: nothing to plan
  end case;
end;
$$;

-- ═══ 4. The cancellation reason a shopper reads ═══════════════════════════

-- One order in full. Replaces the version in 20261121084200_order_followups.sql;
-- one change: `cancel_reason` (header, point 3).
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
        'to_status', e.to_status, 'note', e.note) order by e.created_at, e.id)
      from public.order_events e
      where e.order_id = o.id and (e.visible_to_customer or v_is_staff)), '[]'::jsonb)
  );
end;
$$;

-- ═══ 5. The product of a cart line whose offer is paused ══════════════════

-- Replaces the version in 20261121082800_lockdown.sql. Unchanged but for the
-- join `oa` (any offer with that id), through which the product and the
-- variant are found (section 4 of the header).
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
  -- The offer whatever its state, only to find its product: a paused offer's
  -- line still names a product the caller may see.
  left join public.offers oa on oa.id = req.offer_id
  left join public.products p
    on p.id = (select k2.product_id from public.skus k2 where k2.id = oa.sku_id)
   and (p.status = 'active' or v.staff or p.created_by_seller_id = any (v.sellers))
  left join public.skus k on k.id = oa.sku_id and k.product_id = p.id
  left join public.sellers s
    on s.id = o.seller_id
   and (s.status = 'active' or v.staff or s.id = any (v.sellers))
  -- In the order the cart asked for them, as the earlier version returned them.
  order by req.position;
$$;

-- ═══ 6. Grants ═════════════════════════════════════════════════════════════

revoke all on function private.refund_announcement(uuid, boolean) from public, anon, authenticated;

revoke all on function public.cart_alternatives(uuid[], text) from public;
grant execute on function public.cart_alternatives(uuid[], text) to anon, authenticated;
