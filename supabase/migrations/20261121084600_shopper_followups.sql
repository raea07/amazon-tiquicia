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

-- ═══ 4. Grants ═════════════════════════════════════════════════════════════

revoke all on function private.refund_announcement(uuid, boolean) from public, anon, authenticated;

revoke all on function public.cart_alternatives(uuid[], text) from public;
grant execute on function public.cart_alternatives(uuid[], text) to anon, authenticated;
