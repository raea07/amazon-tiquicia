-- Order and operations follow-ups found on the hosted preview on 23 November
-- 2026, after migrations 084000 and 084100 went there.
--
-- What this migration decides, and why:
--
--   1. THE DELIVERY FEE WHEN NOBODY TRIED TO DELIVER. Until now a parcel that
--      came back to the warehouse refunded its goods only: the delivery fee
--      stayed charged even when no driver ever went to the shopper's door
--      (staff took the parcel off a route, or stopped it before it left).
--      The rule now: when receiving a returned parcel cancels the order
--      (wms_receive_returned_shipment, nothing of it delivered and nothing
--      still on its way), and no parcel of the order ever had a real attempt
--      at the door (a stop the driver marked failed, or an attempt counted on
--      the parcel; a stop staff removed is not an attempt), the delivery fee
--      is refunded too. It goes through the one refund register as its own
--      refund (reason `delivery_fee`, one per order): the ledger gives back
--      the shipping revenue and its IVA, the money waits in "owed to the
--      shopper" and goes back by the same way back as every other refund
--      (private.open_gateway_refund: the gateway, a transfer, or a
--      simulation), the payment ends `refunded` once all of it is back, and
--      invoicing credits the delivery fee's document in full, the same credit
--      a whole cancellation makes for it. Where an attempt was made, or a
--      parcel was delivered, the fee stays charged: the service was given.
--      A cash order never paid has nothing to refund. The amount is never
--      more than what is left of the payment (the register's triggers refuse
--      more anyway).
--   2. STAFF STOP A PACKED PARCEL. cancel_order refuses once a parcel is
--      packed. Operations staff can now send a packed parcel, or one ready on
--      a route that has not started, back to the shelves with a reason
--      (ops_recall_shipment): its stop, if any, is removed by
--      ops_remove_route_stop's own rules, the parcel goes to `returning`
--      (two new transitions: packed and ready_for_dispatch to returning, in
--      packages/core/src/lifecycle.ts too) and is marked as recalled, so the
--      warehouse's list says it never left the building. Receiving it is the
--      usual check-in of a returned parcel. Only parcels of a Yuntera
--      warehouse: a seller's own parcel is at the seller's.
--   3. THE SHOPPER'S ORDER LIST gets each order's parcels (status, attempts,
--      recalled), so it no longer says "En camino" for an order whose only
--      parcel was taken off a route or stopped. New column only: the store
--      build of 3f251c3 ignores it.
--   4. WORDS: the console's open routes carry each parcel's attempt count, so
--      a stop staff removed is not read as a failed delivery.
--   5. A DISTRICT MOVED BACK to its canton's zone follows its canton again
--      (its own zone is cleared), and the console says which districts have a
--      zone of their own. Districts whose own zone is their canton's are
--      cleared once, here, with an audit entry each.
--   6. Indexes for the "who" columns 084000 added, and staff can remove a
--      single closed day that belongs to no period (made before 084000).
--   7. An order never moves back a status (private.sync_order_status): a
--      parcel re-planned after a failed attempt and then taken off its route
--      made the target "processing" for an order already "shipped", and the
--      removal failed. The shopper's delivery code is not given while every
--      parcel left to deliver is on its way back to the warehouse, and the
--      order list says whether money is held (`paid`), so a cash order being
--      cancelled is not promised a refund.

-- ═══ 1. Tables and columns ═════════════════════════════════════════════════

-- The register learns a fifth thing it can refund: an order's delivery fee,
-- once (source_id is the order).
alter table private.refunds drop constraint refunds_reason_check;
alter table private.refunds add constraint refunds_reason_check
  check (reason in ('order_cancelled', 'return', 'parcel_returned', 'delivery_fee'));

-- Who stopped a packed parcel before it left, and why.
alter table public.shipments
  add column recalled_at timestamptz,
  add column recalled_by uuid references auth.users (id) on delete set null,
  add column recall_reason text
    check (recall_reason is null or char_length(recall_reason) between 5 and 300);

-- Foreign keys without an index (the hosted performance advisor named the
-- first four, added by 084000; the fifth is this migration's own).
create index route_stops_removed_by_idx on public.route_stops (removed_by);
create index routes_closed_by_idx on public.routes (closed_by);
create index zone_closure_periods_created_by_idx on public.zone_closure_periods (created_by);
create index zone_closure_periods_ended_early_by_idx on public.zone_closure_periods (ended_early_by);
create index shipments_recalled_by_idx on public.shipments (recalled_by);

-- ═══ 2. The parcel lifecycle: stopped before it left ═══════════════════════

-- Replaces the version in 084000. Two transitions are added: a packed parcel,
-- or one planned on a route that has not started, goes back to the shelves
-- (`returning`) when staff stop it (ops_recall_shipment).
-- packages/core/src/lifecycle.ts changes with it (the parity test reads the
-- newest list between the markers).
create or replace function private.shipment_transition_allowed(
  p_from public.shipment_status, p_to public.shipment_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    -- BEGIN shipment_transitions
    ('pending', 'picking'),
    ('pending', 'cancelled'),
    ('picking', 'packed'),
    ('picking', 'pending'),
    ('picking', 'cancelled'),
    ('packed', 'ready_for_dispatch'),
    ('packed', 'returning'),
    ('packed', 'cancelled'),
    ('ready_for_dispatch', 'out_for_delivery'),
    ('ready_for_dispatch', 'packed'),
    ('ready_for_dispatch', 'returning'),
    ('ready_for_dispatch', 'cancelled'),
    ('out_for_delivery', 'delivered'),
    ('out_for_delivery', 'delivery_failed'),
    ('delivery_failed', 'ready_for_dispatch'),
    ('delivery_failed', 'returning'),
    ('returning', 'returned')
    -- END shipment_transitions
  );
$$;

-- ═══ 3. Helpers ════════════════════════════════════════════════════════════

-- An amount of céntimos as a shopper reads it in a note: "₡1 500", "₡12 500,50".
create or replace function private.colones(p_minor bigint) returns text
language sql immutable
set search_path = ''
as $$
  select '₡' || regexp_replace((abs(p_minor) / 100)::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
         || case when abs(p_minor) % 100 <> 0 then ',' || lpad((abs(p_minor) % 100)::text, 2, '0') else '' end;
$$;

-- True when some parcel of the order had a real attempt at the shopper's
-- door: a stop the driver marked failed, or an attempt counted on the parcel
-- (driver_fail_stop counts both). A stop staff removed is neither.
create or replace function private.order_had_door_attempt(p_order_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shipments s
    where s.order_id = p_order_id
      and (s.attempt_count > 0
           or exists (select 1 from public.route_stops rs
                      where rs.shipment_id = s.id and rs.status = 'failed')));
$$;

-- True when the parcel never went out on a route: no step of it ever reached
-- `out_for_delivery` (every status change is written to order_events by
-- private.enforce_shipment_transition). A parcel stopped after a failed
-- attempt, or after staff took it off a route being driven, did leave.
create or replace function private.shipment_never_left(p_shipment_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.order_events e
    where e.shipment_id = p_shipment_id and e.kind = 'shipment_status'
      and e.to_status = 'out_for_delivery');
$$;

-- Replaces the version in 20261121083200_followups.sql
-- (orderStatusFromShipments in packages/core/src/lifecycle.ts says the same).
-- What changed: an order never moves back. Its parcels can go back a step
-- (a parcel re-planned after a failed attempt is ready_for_dispatch again,
-- and taking it off that route makes it packed), which made the target
-- "processing" for an order that reads "shipped"; the loop below walked
-- forward through "delivered" to get there, and the order transition
-- trigger refused it, so ops_remove_route_stop failed for such a parcel.
-- Now a target behind the current status leaves the order where it is.
create or replace function private.sync_order_status(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_current public.order_status;
  v_live integer;
  v_delivered integer;
  v_ended integer;
  v_dispatched integer;
  v_started integer;
  v_target public.order_status;
  -- BEGIN order_progress
  v_progress constant text[] := array['confirmed', 'processing', 'partially_shipped', 'shipped', 'delivered'];
  -- END order_progress
begin
  select status into v_current from public.orders where id = p_order_id for update;
  if v_current in ('pending_payment', 'payment_review', 'cancelled', 'refunded', 'completed') then
    return;
  end if;

  select count(*) filter (where status <> 'cancelled'),
         count(*) filter (where status = 'delivered'),
         count(*) filter (where status in ('delivered', 'returned')),
         count(*) filter (where status in
           ('out_for_delivery', 'delivered', 'delivery_failed', 'returning', 'returned')),
         count(*) filter (where status not in ('pending', 'cancelled'))
  into v_live, v_delivered, v_ended, v_dispatched, v_started
  from public.shipments where order_id = p_order_id;

  if v_live = 0 then
    return;
  end if;

  v_target := case
    when v_delivered > 0 and v_ended = v_live then 'delivered'
    when v_dispatched = v_live then 'shipped'
    when v_dispatched > 0 then 'partially_shipped'
    when v_started > 0 then 'processing'
    else v_current
  end;
  -- Never back: an order that went out stays "on its way" until it ends.
  if array_position(v_progress, v_target::text) < array_position(v_progress, v_current::text) then
    return;
  end if;

  while v_current is distinct from v_target loop
    v_current := case
      when v_current = 'confirmed' then 'processing'
      when v_current = 'processing' and v_target = 'partially_shipped' then 'partially_shipped'
      when v_current = 'processing' then 'shipped'
      when v_current = 'partially_shipped' and v_target = 'delivered' then 'delivered'
      when v_current = 'partially_shipped' then 'shipped'
      when v_current = 'shipped' then 'delivered'
      else v_target
    end;
    update public.orders
    set status = v_current,
        delivered_at = case when v_current = 'delivered' then now() else delivered_at end,
        warranty_until = case
          when v_current = 'delivered' then private.add_business_days(private.cr_local(now())::date, 30)
          else warranty_until
        end,
        withdrawal_deadline = case
          when v_current = 'delivered'
            then greatest(withdrawal_deadline, private.add_business_days(private.cr_local(now())::date, 8))
          else withdrawal_deadline
        end
    where id = p_order_id;
  end loop;
end;
$$;

-- Refunds an order's delivery fee through the register (see the header,
-- point 1). The caller holds the order's row lock and has checked the rule.
-- Answers the refund (its id and amount), or null when there is nothing to
-- refund: no fee, no payment collected, or the fee already refunded.
create or replace function private.refund_delivery_fee(p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_amount bigint;
  v_net bigint;
  v_tx uuid;
  v_refund uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.shipping_minor <= 0 then
    return null;
  end if;
  if not exists (select 1 from public.payments p
                 where p.order_id = p_order_id and p.status in ('captured', 'partially_refunded')) then
    return null;
  end if;
  if exists (select 1 from private.refunds r
             where r.order_id = p_order_id and r.reason in ('delivery_fee', 'order_cancelled')) then
    -- Refunded already: on its own, or with the whole order.
    return null;
  end if;
  -- Never more than what is left of what was collected.
  v_amount := least(v_order.shipping_minor,
                    private.order_collected_minor(p_order_id) - private.refunded_minor(p_order_id));
  if v_amount <= 0 then
    return null;
  end if;
  -- The fee was booked tax-inclusive (private.post_order_capture): the same
  -- split, given back.
  v_net := round(v_amount::numeric * 10000 / 11300)::bigint;

  insert into public.ledger_transactions (kind, order_id, memo, created_by)
  values ('return_refund', p_order_id, 'Envío reembolsado sin intento de entrega, pedido ' || v_order.order_number,
          (select auth.uid()))
  returning id into v_tx;
  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  select v_tx, x.account_id, x.amount
  from (values
    (private.ledger_account('shipping_revenue'), v_net),
    (private.ledger_account('iva_payable'), v_amount - v_net),
    (private.ledger_account('refunds_payable'), -v_amount)
  ) as x (account_id, amount)
  where x.amount <> 0;

  -- The register; its trigger starts the money's way back (gateway_refund_for_register).
  insert into private.refunds (order_id, reason, source_id, amount_minor, ledger_transaction_id, created_by)
  values (p_order_id, 'delivery_fee', p_order_id, v_amount, v_tx, (select auth.uid()))
  returning id into v_refund;

  perform private.emit('refund.requested', jsonb_build_object(
    'order_id', p_order_id, 'refund_id', v_refund, 'reason', 'delivery_fee', 'amount_minor', v_amount));
  return jsonb_build_object('refund_id', v_refund, 'refund_minor', v_amount);
end;
$$;

-- ═══ 4. Receiving a returned parcel ════════════════════════════════════════

-- Replaces the version in 20261121082900_integrity.sql. What changed: when
-- the order ends cancelled and no parcel of it had a real attempt at the
-- door, the delivery fee is refunded too (private.refund_delivery_fee); the
-- shopper's notes say the amounts given back, and a parcel staff stopped
-- before it left is described as such. `order.cancelled` now carries what
-- was really refunded (`amount_minor`), which the shopper's message states.
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
               then 'Su paquete volvió a nuestros estantes sin salir de la bodega'
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
    update public.orders
    set status = 'cancelled', cancelled_at = now(),
        cancel_reason = 'Los paquetes regresaron sin entregarse'
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
      'order_id', v_order.id, 'reason', 'Los paquetes regresaron sin entregarse',
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

-- ═══ 5. Invoicing follows the refunded delivery fee ════════════════════════

-- Replaces the version in 20261121083500_invoicing.sql. A `delivery_fee`
-- refund credits the delivery fee's document in full, with the same credit
-- note (code `credit_code_cancel`) a whole cancellation makes for it: one
-- loop serves both, the cancellation over every document of the order, the
-- delivery fee over that document alone. Nothing else changed.
create or replace function private.invoice_plan_refund(p_event_id bigint, p_refund_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r private.refunds;
  o public.orders;
  v_policy jsonb := private.invoice_policy();
  d public.electronic_invoices;
  v_root record;
  c record;
  v_tax_bps integer;
begin
  select * into r from private.refunds where id = p_refund_id;
  if not found then
    return;
  end if;
  -- A credit note reverses documents: while an earlier event of the same
  -- order (its capture) has not made all of its documents, this one waits,
  -- whatever order the planner meets the jobs in.
  if exists (select 1 from private.outbox_jobs x
             join private.outbox_events e on e.id = x.event_id
             where x.consumer = 'invoice' and x.status <> 'done' and x.event_id < p_event_id
               and e.payload ->> 'order_id' = r.order_id::text) then
    perform private.fail('invoice_waiting');
  end if;
  select * into o from public.orders where id = r.order_id;

  if r.reason in ('order_cancelled', 'delivery_fee') then
    for v_root in
      select e.id from public.electronic_invoices e
      where e.order_id = r.order_id and e.replaces_id is null
        and e.kind = any (case when r.reason = 'order_cancelled' then array['delivery', 'fees']
                               else array['delivery'] end)
      order by e.kind, e.receiver_seller_id nulls first
    loop
      d := private.invoice_current(v_root.id);
      if d.status = 'rejected' then
        perform private.fail('invoice_waiting');
      end if;
      perform private.invoice_create(
        'credit', '03', r.order_id, d.receiver_kind, d.receiver_seller_id, d.receiver, d.lines,
        d.sale_condition, d.payments -> 0 ->> 'code', d.payments -> 0 ->> 'other',
        jsonb_build_array(private.invoice_reference(d, coalesce(v_policy ->> 'credit_code_cancel', '01'),
          case when r.reason = 'order_cancelled'
               then 'Pedido ' || o.order_number || ' cancelado y reembolsado'
               else 'Envío del pedido ' || o.order_number || ' reembolsado: no se intentó la entrega' end)),
        'credit:' || r.id || ':' || v_root.id, p_event_id, d.total_minor, r.id, d.id);
    end loop;
    return;
  end if;

  -- The commission given back per seller, by the formula private.refund_units booked it with.
  for c in
    select i.seller_id,
           sum(round(f.referral_fee_minor::numeric * i.unit_price_minor * u.quantity / f.items_gross_minor))::bigint
             as commission,
           max(s.fee_tax_bps) as tax_bps
    from private.refund_units u
    join public.order_items i on i.id = u.order_item_id
    join public.seller_order_fees f on f.order_id = i.order_id and f.seller_id = i.seller_id
    join public.fee_schedules s on s.version = f.schedule_version
    where u.refund_id = r.id
    group by i.seller_id
    order by i.seller_id
  loop
    if c.commission <= 0 then
      continue;
    end if;
    select e.id into v_root from public.electronic_invoices e
    where e.order_id = r.order_id and e.kind = 'fees' and e.receiver_seller_id = c.seller_id
      and e.replaces_id is null;
    if not found then
      continue;
    end if;
    d := private.invoice_current(v_root.id);
    if d.status = 'rejected' then
      perform private.fail('invoice_waiting');
    end if;
    v_tax_bps := coalesce(c.tax_bps, 1300);
    perform private.invoice_create(
      'credit', '03', r.order_id, 'seller', c.seller_id, d.receiver,
      jsonb_build_array(private.invoice_line(
        1, coalesce(v_policy -> 'cabys' ->> 'commission', '6254400000000'), 'Cm',
        'Devolución de la comisión por productos devueltos, pedido ' || o.order_number,
        c.commission::numeric / 100, private.invoice_tax_code(v_tax_bps))),
      d.sale_condition, d.payments -> 0 ->> 'code', d.payments -> 0 ->> 'other',
      jsonb_build_array(private.invoice_reference(d, coalesce(v_policy ->> 'credit_code_return', '06'),
        'Comisión devuelta por productos devueltos del pedido ' || o.order_number)),
      'credit:' || r.id || ':' || c.seller_id, p_event_id,
      c.commission + round(c.commission::numeric * v_tax_bps / 10000)::bigint, r.id, d.id);
  end loop;
end;
$$;

-- ═══ 6. Staff stop a packed parcel ═════════════════════════════════════════

-- Sends a packed parcel of a Yuntera warehouse, or one planned on a route
-- that has not started, back to the shelves (see the header, point 2). Its
-- stop is removed by ops_remove_route_stop, with the same reason. The
-- warehouse then receives it as a returned parcel
-- (wms_receive_returned_shipment), which refunds and cancels as usual.
create or replace function public.ops_recall_shipment(p_shipment_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := private.clean_label(p_reason);
  v_ship public.shipments%rowtype;
  v_order public.orders%rowtype;
  v_kind public.warehouse_kind;
  v_stop record;
  v_removed jsonb;
  v_before public.shipment_status;
  v_paid boolean;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  -- At least five letters: a reason someone can read later.
  if v_reason is null or char_length(v_reason) > 300
     or char_length(regexp_replace(v_reason, '[^[:alpha:]]', '', 'g')) < 5 then
    perform private.fail('reason_required');
  end if;
  -- The order first, as every function that changes a parcel or its cash does.
  select * into v_ship from public.shipments where id = p_shipment_id;
  if not found then
    perform private.fail('shipment_not_found');
  end if;
  select * into v_order from public.orders where id = v_ship.order_id for update;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.status not in ('packed', 'ready_for_dispatch') then
    perform private.fail('shipment_not_recallable', v_ship.status::text);
  end if;
  -- What it was when staff acted (removing its stop passes it through packed).
  v_before := v_ship.status;
  select w.kind into v_kind from public.warehouses w where w.id = v_ship.origin_warehouse_id;
  if v_kind is distinct from 'platform' then
    -- A seller's own parcel is at the seller's, not on our shelves.
    perform private.fail('shipment_not_recallable', 'seller_parcel');
  end if;

  -- Its live stop, if it is planned on a route.
  select rs.id, rs.status, r.status as route_status, r.code
  into v_stop
  from public.route_stops rs join public.routes r on r.id = rs.route_id
  where rs.shipment_id = v_ship.id and rs.status in ('pending', 'arrived')
    and r.status in ('draft', 'assigned', 'in_progress')
  order by r.service_date desc, rs.id
  limit 1;
  if v_stop.id is not null then
    if v_stop.route_status = 'in_progress' then
      perform private.fail('shipment_on_started_route', v_stop.code);
    end if;
    v_removed := public.ops_remove_route_stop(v_stop.id, v_reason);
    select * into v_ship from public.shipments where id = p_shipment_id;
    -- Its note says the parcel waits for another route: not when it is stopped.
    update public.order_events e
    set note = 'Central quitó el paquete ' || v_ship.tracking_code || ' de la ruta ' || v_stop.code
               || ' para detenerlo.'
    where e.id = (select max(e2.id) from public.order_events e2
                  where e2.shipment_id = v_ship.id and e2.kind = 'note' and not e2.visible_to_customer
                    and e2.note like 'Central quitó el paquete %');
  end if;
  -- Money to give back only when something was paid (a cash order is not, yet).
  v_paid := exists (select 1 from public.payments p
                    where p.order_id = v_order.id and p.status in ('captured', 'partially_refunded'));

  update public.shipments
  set status = 'returning', recalled_at = now(), recalled_by = (select auth.uid()),
      recall_reason = v_reason
  where id = v_ship.id;
  -- The shopper reads what this means for them, not a parcel status.
  update public.order_events e set visible_to_customer = false
  where e.id = (select max(e2.id) from public.order_events e2
                where e2.shipment_id = v_ship.id and e2.kind = 'shipment_status'
                  and e2.to_status = 'returning');
  insert into public.order_events (order_id, shipment_id, kind, note, visible_to_customer, actor_id)
  values
    (v_order.id, v_ship.id, 'note',
     'Detuvimos el envío del paquete ' || v_ship.tracking_code || ': no saldrá de nuestra bodega'
       || case when v_paid then '. Cuando la bodega lo confirme, le devolvemos lo que pagó por él'
               else '. No se le cobró nada por él' end,
     true, (select auth.uid())),
    (v_order.id, v_ship.id, 'note',
     'Central detuvo el paquete ' || v_ship.tracking_code || ' en la bodega: ' || v_reason,
     false, (select auth.uid()));

  -- Cash planned for this parcel's goods is worked out again without them.
  perform private.replan_cod(v_order.id);

  perform private.operations_audit('shipment_recalled', 'shipments', v_ship.id::text,
    jsonb_build_object('tracking_code', v_ship.tracking_code, 'status', v_before,
                       'route', v_stop.code),
    jsonb_build_object('tracking_code', v_ship.tracking_code, 'status', 'returning'));
  return jsonb_build_object(
    'shipment_id', v_ship.id,
    'tracking_code', v_ship.tracking_code,
    'order_number', v_order.order_number,
    'status', 'returning',
    'route_code', v_stop.code);
end;
$$;

-- Parcels on their way back to a warehouse, for the people who receive them
-- there. Replaces the version in integrity: each says whether it never left
-- the building (staff stopped it, ops_recall_shipment).
create or replace function public.wms_returning_shipments(p_warehouse_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shipment_id', s.id, 'tracking_code', s.tracking_code, 'order_number', o.order_number,
      'package_count', s.package_count, 'attempt_count', s.attempt_count,
      'units', (select coalesce(sum(si.quantity), 0) from public.shipment_items si
                where si.shipment_id = s.id),
      'lines', (select count(*) from public.shipment_items si where si.shipment_id = s.id),
      'never_left', s.recalled_at is not null and private.shipment_never_left(s.id),
      'recalled_at', s.recalled_at
    ) order by s.tracking_code)
    from public.shipments s
    join public.orders o on o.id = s.order_id
    where s.origin_warehouse_id = p_warehouse_id and s.status = 'returning'), '[]'::jsonb);
end;
$$;

-- One order in full. Replaces the version in integrity; each parcel now says
-- whether staff stopped it before it left (`recalled`) and, for operations
-- staff, whether they can still stop it (`can_recall`). Nothing else changed.
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
    'cancel_reason', o.cancel_reason,
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

-- ═══ 7. The shopper's order list ═══════════════════════════════════════════

-- Replaces the version in lockdown with one more column: each order's
-- parcels, so the list can say "Entrega reprogramada" or that the order is
-- being cancelled instead of "En camino" (isRescheduledOrder and
-- isOrderBeingStopped in packages/core). The columns before it are
-- unchanged, so the store build of 3f251c3, which parses the rows with its
-- own schema, reads them as before.
drop function public.my_orders(integer, integer);
create function public.my_orders(p_limit integer default 20, p_offset integer default 0)
returns table (order_number text, status public.order_status, placed_at timestamptz,
               total_minor bigint, payment_method public.payment_method, promise_earliest date,
               promise_latest date, delivered_at timestamptz, item_count bigint, first_title text,
               first_image_path text, shipments jsonb, paid boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;

  return query
  select o.order_number, o.status, o.placed_at, o.total_minor, o.payment_method,
         o.promise_earliest, o.promise_latest, o.delivered_at,
         (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id),
         first_item.title, first_item.image_path,
         coalesce((select jsonb_agg(jsonb_build_object(
                    'status', s.status, 'attempt_count', s.attempt_count,
                    'recalled', s.recalled_at is not null) order by s.created_at, s.id)
                   from public.shipments s where s.order_id = o.id), '[]'::jsonb),
         -- Money is held for the shopper (so a cancellation gives some back).
         exists (select 1 from public.payments p where p.order_id = o.id
                 and p.status in ('captured', 'partially_refunded'))
  from public.orders o
  left join lateral (
    select i.title, i.image_path from public.order_items i
    where i.order_id = o.id order by i.line_total_minor desc, i.id limit 1
  ) first_item on true
  where o.user_id = (select auth.uid())
  order by o.placed_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
end;
$$;

-- ═══ 8. The console's open routes ══════════════════════════════════════════

-- Replaces the version in 084000 with one more field per stop: the parcel's
-- attempt count, so a stop staff removed (its parcel delivery_failed with no
-- attempt) is not labelled as a failed delivery.
create or replace function public.ops_open_routes() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := private.cr_today();
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.route order by x.stuck desc, (x.route ->> 'service_date'), (x.route ->> 'code'))
    from (
      select r.id, s.stuck, jsonb_build_object(
        'route_id', r.id,
        'code', r.code,
        'status', r.status,
        'service_date', r.service_date,
        'started_at', r.started_at,
        'driver_name', (select d.full_name from public.drivers d where d.id = r.driver_id),
        'open_stops', s.open_stops,
        'stuck', s.stuck,
        'stuck_reasons', to_jsonb(s.reasons),
        'stops', coalesce((
          select jsonb_agg(jsonb_build_object(
            'stop_id', rs.id,
            'sequence', rs.sequence,
            'status', rs.status,
            'tracking_code', sh.tracking_code,
            'shipment_status', sh.status,
            'attempt_count', sh.attempt_count,
            'order_number', o.order_number,
            'district', (select dd.name from public.districts dd where dd.postal_code = o.ship_postal_code),
            'cash_planned', rs.cod_amount_minor > 0,
            'removed_at', rs.removed_at,
            'removal_reason', rs.removal_reason,
            'not_removable', private.stop_not_removable(rs.status)
          ) order by rs.sequence)
          from public.route_stops rs
          join public.shipments sh on sh.id = rs.shipment_id
          join public.orders o on o.id = sh.order_id
          where rs.route_id = r.id), '[]'::jsonb)
      ) as route
      from public.routes r
      cross join lateral (
        select o.open_stops, cardinality(o.reasons) > 0 as stuck, o.reasons
        from (
          select (select count(*) from public.route_stops rs
                  where rs.route_id = r.id and rs.status in ('pending', 'arrived')) as open_stops,
                 array_remove(array[
                   case when r.service_date < v_today then 'past_date' end,
                   case when exists (select 1 from public.route_stops rs
                                     join public.shipments sh on sh.id = rs.shipment_id
                                     where rs.route_id = r.id and rs.status in ('pending', 'arrived')
                                       and sh.status in ('cancelled', 'returning', 'returned'))
                        then 'cancelled_parcel' end,
                   case when not exists (select 1 from public.route_stops rs
                                         where rs.route_id = r.id and rs.status in ('pending', 'arrived'))
                        then 'no_open_stops' end
                 ], null) as reasons
        ) o
      ) s
      where r.status in ('draft', 'assigned', 'in_progress')
    ) x), '[]'::jsonb);
end;
$$;

-- ═══ 9. Districts that follow their canton ═════════════════════════════════

-- Replaces the version in 084000 with how many districts of each canton have
-- a zone of their own (`own_zone_count`).
create or replace function public.ops_district_cantons() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.code, 'name', c.name, 'province_code', p.code, 'province', p.name,
      'district_count', x.district_count, 'served_count', x.served_count,
      'zones', x.zones, 'own_zone_count', x.own_zone_count
    ) order by p.code, c.code)
    from public.cantons c
    join public.provinces p on p.code = c.province_code
    cross join lateral (
      select count(*) as district_count,
             count(*) filter (where dz.served) as served_count,
             coalesce(jsonb_agg(distinct dz.zone_id) filter (where dz.served), '[]'::jsonb) as zones,
             (select count(*) from public.districts d
              where d.canton_code = c.code and d.zone_id is not null) as own_zone_count
      from private.district_zones() dz where dz.canton_code = c.code
    ) x), '[]'::jsonb);
end;
$$;

-- Replaces the version in 084000: each district also says whether it has a
-- zone of its own (`own_zone`) instead of following its canton's.
create or replace function public.ops_canton_districts(p_canton_code text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.cantons%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  select * into c from public.cantons where code = p_canton_code;
  if not found then
    perform private.fail('canton_not_found');
  end if;
  return jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'province', (select p.name from public.provinces p where p.code = c.province_code),
    'canton_zone_id', c.zone_id,
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'postal_code', d.postal_code,
        'name', d.name,
        'zone_id', dz.zone_id,
        'zone_name', z.name,
        'zone_active', z.active,
        'served', d.served,
        'own_zone', d.zone_id is not null,
        'saved_address_count', (select count(*) from public.addresses a
                                where a.postal_code = d.postal_code and a.deleted_at is null),
        'open_order_count', (select count(*) from public.orders o
                             where o.ship_postal_code = d.postal_code and private.order_is_open(o.status))
      ) order by d.postal_code)
      from public.districts d
      join private.district_zones() dz on dz.postal_code = d.postal_code
      join public.delivery_zones z on z.id = dz.zone_id
      where d.canton_code = c.code), '[]'::jsonb));
end;
$$;

-- Replaces the version in 084000. The one change: a district assigned to its
-- canton's zone follows its canton again (its own zone is cleared) instead of
-- storing that zone on itself, so a district moved away and back is where it
-- started. The audit entry records the own zone it really has afterwards.
create or replace function public.ops_move_districts(p_postal_codes text[], p_zone_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_impact jsonb;
  v_own text;
  r record;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  -- One move at a time, so "left with no districts" is worked out on what is
  -- there, a zone being deleted cannot receive a district, and no zone is
  -- switched on or off meanwhile (zones first, then districts, as
  -- ops_set_zone_active and ops_delete_zone take them).
  perform pg_advisory_xact_lock(hashtext('yuntera.zones'));
  perform pg_advisory_xact_lock(hashtext('yuntera.districts'));
  v_impact := private.district_move_impact(p_postal_codes, p_zone_id);
  if (v_impact ->> 'changing_count')::integer = 0 then
    perform private.fail('district_unchanged');
  end if;
  if (v_impact ->> 'nothing_served_after')::boolean then
    perform private.fail('districts_none_served');
  end if;
  for r in
    select d.postal_code, d.zone_id as own_zone, dz.zone_id, d.served, c.zone_id as canton_zone
    from public.districts d
    join public.cantons c on c.code = d.canton_code
    join private.district_zones() dz on dz.postal_code = d.postal_code
    where d.postal_code in (select jsonb_array_elements_text(v_impact -> 'changing'))
    order by d.postal_code
    for update of d
  loop
    if p_zone_id is null then
      update public.districts set served = false where postal_code = r.postal_code;
      v_own := r.own_zone;
    else
      v_own := case when p_zone_id = r.canton_zone then null else p_zone_id end;
      update public.districts set zone_id = v_own, served = true where postal_code = r.postal_code;
    end if;
    perform private.operations_audit('district_zone', 'districts', r.postal_code,
      jsonb_build_object('zone_id', r.zone_id, 'own_zone_id', r.own_zone, 'served', r.served),
      jsonb_build_object('zone_id', coalesce(p_zone_id, r.zone_id), 'own_zone_id', v_own,
                         'served', p_zone_id is not null));
  end loop;
  return v_impact;
end;
$$;

-- Once: districts that store their canton's zone as their own (moved away
-- and back before this migration; one on the hosted preview, put back by
-- hand) follow their canton again. Nothing changes for any delivery: the
-- zone they belong to is the same. On a fresh database there are none.
do $$
declare
  r record;
begin
  for r in
    select d.postal_code, d.zone_id, d.served
    from public.districts d join public.cantons c on c.code = d.canton_code
    where d.zone_id is not null and d.zone_id = c.zone_id
    order by d.postal_code
    for update of d
  loop
    update public.districts set zone_id = null where postal_code = r.postal_code;
    perform private.operations_audit('district_zone', 'districts', r.postal_code,
      jsonb_build_object('zone_id', r.zone_id, 'own_zone_id', r.zone_id, 'served', r.served),
      jsonb_build_object('zone_id', r.zone_id, 'own_zone_id', null, 'served', r.served,
                         'note', 'follows its canton again (20261121084200)'));
  end loop;
end
$$;

-- ═══ 10. Single closed days outside any period ═════════════════════════════

-- Removes a day closed on its own (zone_closures with no period, made before
-- 084000), today or later: the zone delivers on that day again, and the
-- delivery promise, which reads the table on every call, follows at once.
-- Same role and audit as the closure periods.
create or replace function public.ops_remove_zone_closure_day(p_zone_id text, p_day date)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.zone_closures%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if p_day is null or p_day < private.cr_today() then
    perform private.fail('zone_closure_in_past');
  end if;
  -- The zone's row is the lock for its closures (as ops_open_zone_closure).
  perform 1 from public.delivery_zones where id = p_zone_id for update;
  if not found then
    perform private.fail('zone_not_found');
  end if;
  delete from public.zone_closures z
  where z.zone_id = p_zone_id and z.day = p_day and z.period_id is null
  returning * into c;
  if not found then
    perform private.fail('zone_closure_not_found');
  end if;
  perform private.operations_audit('closure_day_removed', 'zone_closures', c.zone_id || ':' || c.day,
    jsonb_build_object('zone_id', c.zone_id, 'day', c.day, 'reason', c.reason), null);
  return jsonb_build_object('zone_id', c.zone_id, 'day', c.day);
end;
$$;

-- ═══ 11. Grants ════════════════════════════════════════════════════════════

revoke all on function
  private.colones(bigint),
  private.shipment_never_left(uuid),
  private.order_had_door_attempt(uuid),
  private.refund_delivery_fee(uuid)
from public, anon, authenticated;

revoke all on function
  public.ops_recall_shipment(uuid, text),
  public.ops_remove_zone_closure_day(text, date),
  public.my_orders(integer, integer)
from public, anon;

grant execute on function
  public.ops_recall_shipment(uuid, text),
  public.ops_remove_zone_closure_day(text, date),
  public.my_orders(integer, integer)
to authenticated;
