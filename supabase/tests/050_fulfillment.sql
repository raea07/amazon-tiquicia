-- Fulfilment and delivery: pick, pack, route, proof of delivery, cash, failures.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

-- The seed leaves these orders at known stages.
select pg_temp.remember('to_pick', (select id::text from public.orders where idempotency_key = 'seed-today-d2'));
select pg_temp.remember('packed', (select id::text from public.orders where idempotency_key = 'seed-today-c1'));
select pg_temp.remember('seller_order', (select id::text from public.orders where idempotency_key = 'seed-today-f1'));
select pg_temp.remember('unpaid', pg_temp.unpaid_order('test-unpaid-050')::text);
select pg_temp.remember('cod_order', (select id::text from public.orders where idempotency_key = 'seed-today-b1'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('carlos', (select id::text from public.drivers where full_name like 'Carlos%'));
select pg_temp.remember('to_pick_shipment',
  (select id::text from public.shipments where order_id = current_setting('t.to_pick')::uuid));
select pg_temp.remember('packed_shipment',
  (select id::text from public.shipments where order_id = current_setting('t.packed')::uuid));
select pg_temp.remember('seller_shipment',
  (select id::text from public.shipments where order_id = current_setting('t.seller_order')::uuid));
-- PINs are known only to the shopper; the test reads them as superuser to play that part.
select pg_temp.remember('packed_pin',
  (select delivery_pin from public.orders where id = current_setting('t.packed')::uuid));
select pg_temp.remember('cod_pin',
  (select delivery_pin from public.orders where id = current_setting('t.cod_order')::uuid));
select pg_temp.remember('cod_total',
  (select total_minor::text from public.orders where id = current_setting('t.cod_order')::uuid));

-- ── Warehouse ──────────────────────────────────────────────────────────────

select pg_temp.login('bodega@yuntera.example');

-- Work cannot start on an order that has not been paid.
do $$
begin
  perform public.wms_start_picking(
    (select id from public.shipments where order_id = current_setting('t.unpaid')::uuid));
  raise exception 'picking started on an unpaid order';
exception when others then
  -- The associate cannot even see it: shipments of unpaid orders have no pick tasks,
  -- and the function refuses on the order's state.
  if sqlerrm <> 'order_not_ready' then raise; end if;
end
$$;

do $$
declare
  v_shipment uuid := current_setting('t.to_pick_shipment')::uuid;
  v_task record;
  v_first uuid;
begin
  -- Packing before picking is refused.
  begin
    perform public.wms_pack_shipment(v_shipment, 1500, 1::smallint);
    raise exception 'packed before picking';
  exception when others then
    if sqlerrm <> 'invalid_shipment_state' then raise; end if;
  end;

  perform public.wms_start_picking(v_shipment);
  assert (select status from public.shipments where id = v_shipment) = 'picking', 'shipment is being picked';
  assert (select bool_and(status = 'in_progress') from public.pick_tasks where shipment_id = v_shipment),
    'its tasks are in progress';

  -- Picking fewer than asked marks the task short, and a short task blocks packing.
  select id, quantity into v_task from public.pick_tasks
  where shipment_id = v_shipment order by quantity desc limit 1;
  v_first := v_task.id;
  perform public.wms_confirm_pick(v_first, v_task.quantity - 1);
  assert (select status from public.pick_tasks where id = v_first) = 'short', 'short pick recorded';
  begin
    perform public.wms_pack_shipment(v_shipment, 1500, 1::smallint);
    raise exception 'packed with a short pick';
  exception when others then
    if sqlerrm <> 'picking_incomplete' then raise; end if;
  end;

  -- More than was asked for is refused.
  begin
    perform public.wms_confirm_pick(v_first, v_task.quantity + 1);
    raise exception 'picked more than ordered';
  exception when others then
    if sqlerrm <> 'invalid_quantity' then raise; end if;
  end;

  -- Finding the missing unit completes the task.
  perform public.wms_confirm_pick(v_first, v_task.quantity);
  for v_task in select id, quantity from public.pick_tasks where shipment_id = v_shipment and status <> 'done' loop
    perform public.wms_confirm_pick(v_task.id, v_task.quantity);
  end loop;
end
$$;
reset role;

-- Stock leaves the building at packing, not before.
select pg_temp.remember('on_hand_before',
  (select sum(l.on_hand)::text from public.stock_levels l
   where (l.sku_id, l.seller_id) in (
     select i.sku_id, i.seller_id from public.order_items i where i.order_id = current_setting('t.to_pick')::uuid)));
select pg_temp.remember('units',
  (select sum(quantity)::text from public.order_items where order_id = current_setting('t.to_pick')::uuid));

select pg_temp.login('bodega@yuntera.example');
do $$
begin
  perform public.wms_pack_shipment(current_setting('t.to_pick_shipment')::uuid, 2300, 1::smallint);
  assert (select status from public.shipments where id = current_setting('t.to_pick_shipment')::uuid) = 'packed',
    'shipment packed';
end
$$;
reset role;

do $$
declare
  v_after integer;
begin
  select sum(l.on_hand) into v_after from public.stock_levels l
  where (l.sku_id, l.seller_id) in (
    select i.sku_id, i.seller_id from public.order_items i where i.order_id = current_setting('t.to_pick')::uuid);
  assert v_after = current_setting('t.on_hand_before')::integer - current_setting('t.units')::integer,
    format('on-hand fell by the units shipped: before %s, after %s', current_setting('t.on_hand_before'), v_after);
  assert not exists (
    select 1 from public.inventory_reservations res join public.order_items i on i.id = res.order_item_id
    where i.order_id = current_setting('t.to_pick')::uuid and res.status <> 'consumed'
  ), 'reservations are consumed';
  assert (select status from public.orders where id = current_setting('t.to_pick')::uuid) = 'processing',
    'the order shows as being prepared';
  assert not exists (select 1 from public.stock_levels where reserved > on_hand), 'invariant holds';
end
$$;

-- A bin that holds less than the system believes stops the pick.
do $$
declare
  v_task uuid;
begin
  -- Empty the bin behind an open task of another order, then try to pick from it.
  select t.id into v_task from public.pick_tasks t
  where t.status = 'in_progress' and t.location_id is not null limit 1;
  if v_task is null then
    return; -- no order mid-pick in the seed; covered when one exists
  end if;
  update public.bin_stock b set quantity = 0
  from public.pick_tasks t where t.id = v_task and b.location_id = t.location_id and b.sku_id = t.sku_id;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = 'bodega@yuntera.example'))::text, true);
  begin
    perform public.wms_confirm_pick(v_task, (select quantity from public.pick_tasks where id = v_task));
    raise exception 'picked from an empty bin';
  exception when others then
    if sqlerrm <> 'bin_stock_insufficient' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- ── Seller-fulfilled parcel ────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
do $$
begin
  perform public.seller_mark_packed(current_setting('t.seller_shipment')::uuid, 3400, 1::smallint);
  raise exception 'a shopper packed a seller''s parcel';
exception when others then
  if sqlerrm <> 'shipment_not_found' then raise; end if;
end
$$;
reset role;

select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  perform public.seller_mark_packed(current_setting('t.seller_shipment')::uuid, 3400, 1::smallint);
  assert (select status from public.shipments where id = current_setting('t.seller_shipment')::uuid) = 'packed',
    'the seller packed their own parcel';
  -- A platform parcel is not theirs to pack.
  begin
    perform public.seller_mark_packed(current_setting('t.packed_shipment')::uuid, 1000, 1::smallint);
    raise exception 'a seller packed a platform parcel';
  exception when others then
    if sqlerrm <> 'shipment_not_found' then raise; end if;
  end;
end
$$;
reset role;

-- ── Dispatch ───────────────────────────────────────────────────────────────

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_route uuid;
begin
  -- A parcel that is not packed cannot be routed.
  begin
    perform public.ops_create_route(
      current_date, current_setting('t.depot')::uuid,
      jsonb_build_array(jsonb_build_object(
        'shipment_id', (select id from public.shipments where order_id = current_setting('t.unpaid')::uuid),
        'sequence', 1)),
      current_setting('t.carlos')::uuid);
    raise exception 'routed an unpacked parcel';
  exception when others then
    if sqlerrm <> 'shipment_not_dispatchable' then raise; end if;
  end;

  v_route := public.ops_create_route(
    current_date, current_setting('t.depot')::uuid,
    jsonb_build_array(
      jsonb_build_object('shipment_id', current_setting('t.packed_shipment'), 'sequence', 2, 'eta_minute', 40),
      jsonb_build_object('shipment_id', current_setting('t.to_pick_shipment'), 'sequence', 1, 'eta_minute', 15)),
    null, 12.4, 80);
  perform set_config('t.route', v_route::text, true);

  assert (select status from public.routes where id = v_route) = 'draft', 'a route without a driver is a draft';
  assert (select array_agg(shipment_id order by sequence) from public.route_stops where route_id = v_route)
       = array[current_setting('t.to_pick_shipment')::uuid, current_setting('t.packed_shipment')::uuid],
    'stops follow the requested sequence';
  assert (select bool_and(status = 'ready_for_dispatch') from public.shipments
          where id in (current_setting('t.packed_shipment')::uuid, current_setting('t.to_pick_shipment')::uuid)),
    'routed parcels are staged for dispatch';
  assert (select bool_and(senas <> '' and phone <> '' and cod_amount_minor = 0)
          from public.route_stops where route_id = v_route),
    'stops carry the door details; prepaid orders collect no cash';

  -- A parcel cannot ride two routes at once.
  begin
    perform public.ops_create_route(
      current_date, current_setting('t.depot')::uuid,
      jsonb_build_array(jsonb_build_object('shipment_id', current_setting('t.packed_shipment'), 'sequence', 1)),
      current_setting('t.carlos')::uuid);
    raise exception 'one parcel on two routes';
  exception when others then
    if sqlerrm <> 'shipment_already_routed' then raise; end if;
  end;
end
$$;
reset role;

-- A driver cannot start a route that has not been assigned to them.
select pg_temp.login('repartidor@yuntera.example');
do $$
begin
  perform public.driver_start_route(current_setting('t.route')::uuid);
  raise exception 'started an unassigned route';
exception when others then
  if sqlerrm <> 'route_not_found' then raise; end if;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
select public.ops_assign_route(current_setting('t.route')::uuid, current_setting('t.carlos')::uuid);
reset role;

-- ── Delivery ───────────────────────────────────────────────────────────────

select pg_temp.remember('stop_ok',
  (select id::text from public.route_stops
   where route_id = current_setting('t.route')::uuid and shipment_id = current_setting('t.packed_shipment')::uuid));
select pg_temp.remember('stop_fail',
  (select id::text from public.route_stops
   where route_id = current_setting('t.route')::uuid and shipment_id = current_setting('t.to_pick_shipment')::uuid));
select pg_temp.remember('cod_stop',
  (select rs.id::text from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
   where s.order_id = current_setting('t.cod_order')::uuid and rs.status = 'pending'));

select pg_temp.login('repartidor@yuntera.example');
do $$
declare
  r jsonb;
  v_wrong text := case when current_setting('t.packed_pin') = '0000' then '1111' else '0000' end;
begin
  -- Delivering before the route is started is refused.
  begin
    perform public.driver_complete_stop(current_setting('t.stop_ok')::uuid, current_setting('t.packed_pin'), 'Sofía');
    raise exception 'delivered before starting the route';
  exception when others then
    if sqlerrm <> 'route_not_in_progress' then raise; end if;
  end;

  perform public.driver_start_route(current_setting('t.route')::uuid);
  assert (select status from public.shipments where id = current_setting('t.packed_shipment')::uuid)
    = 'out_for_delivery', 'parcels are out for delivery';

  -- A wrong PIN is refused and counted; the count survives because nothing is rolled back.
  r := public.driver_complete_stop(current_setting('t.stop_ok')::uuid, v_wrong, 'Sofía Vargas');
  assert r = '{"ok": false, "error": "wrong_pin", "attempts_left": 4}'::jsonb, format('wrong PIN: %s', r);
  assert (select pin_attempts from public.route_stops where id = current_setting('t.stop_ok')::uuid) = 1,
    'attempt counted';
  assert (select status from public.route_stops where id = current_setting('t.stop_ok')::uuid) = 'pending',
    'stop still pending';

  -- The right PIN, with the name of whoever received it.
  r := public.driver_complete_stop(current_setting('t.stop_ok')::uuid, current_setting('t.packed_pin'), ' ');
  assert r ->> 'error' = 'recipient_required', 'a recipient name is required';
  r := public.driver_complete_stop(
    current_setting('t.stop_ok')::uuid, current_setting('t.packed_pin'), 'Sofía Vargas', 0, null, 9.9981, -84.1171);
  assert (r ->> 'ok')::boolean and not (r ->> 'route_completed')::boolean, format('delivered: %s', r);

  -- Delivering the same stop twice is refused.
  begin
    perform public.driver_complete_stop(current_setting('t.stop_ok')::uuid, current_setting('t.packed_pin'), 'Sofía');
    raise exception 'delivered twice';
  exception when others then
    if sqlerrm <> 'invalid_stop_state' then raise; end if;
  end;

  -- Nobody home at the other stop.
  begin
    perform public.driver_fail_stop(current_setting('t.stop_fail')::uuid, 'se me hizo tarde');
    raise exception 'accepted a made-up failure reason';
  exception when others then
    if sqlerrm <> 'invalid_failure_reason' then raise; end if;
  end;
  r := public.driver_fail_stop(current_setting('t.stop_fail')::uuid, 'nobody_home', 9.9189, -84.1399);
  assert (r ->> 'route_completed')::boolean, 'the route closes when no stop is pending';
end
$$;
reset role;

do $$
begin
  assert (select status from public.orders where id = current_setting('t.packed')::uuid) = 'delivered',
    'delivered order';
  assert (select warranty_until > current_date + 30 and delivered_at is not null
          from public.orders where id = current_setting('t.packed')::uuid), 'warranty starts at delivery';
  assert (select withdrawal_deadline >= private.add_business_days(private.cr_local(now())::date, 8)
          from public.orders where id = current_setting('t.packed')::uuid),
    'the withdrawal window restarts at delivery';
  assert (select pod_recipient_name = 'Sofía Vargas' and pod_lat is not null
          from public.route_stops where id = current_setting('t.stop_ok')::uuid), 'proof of delivery recorded';

  assert (select status = 'delivery_failed' and attempt_count = 1
          from public.shipments where id = current_setting('t.to_pick_shipment')::uuid), 'failed attempt recorded';
  assert (select status from public.orders where id = current_setting('t.to_pick')::uuid) = 'shipped',
    'the order is still on its way';
  assert (select status from public.routes where id = current_setting('t.route')::uuid) = 'completed',
    'route completed';
  assert (select cod_expected_minor = 0 and status = 'open'
          from public.driver_settlements where route_id = current_setting('t.route')::uuid),
    'a cash count is opened even when no cash was due';
end
$$;

-- A failed parcel goes out again on a new route.
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_route uuid;
begin
  v_route := public.ops_create_route(
    current_date + 1, current_setting('t.depot')::uuid,
    jsonb_build_array(jsonb_build_object('shipment_id', current_setting('t.to_pick_shipment'), 'sequence', 1)),
    current_setting('t.carlos')::uuid);
  assert (select status from public.shipments where id = current_setting('t.to_pick_shipment')::uuid)
    = 'ready_for_dispatch', 're-attempt staged';
end
$$;
reset role;

-- ── Cash on delivery ───────────────────────────────────────────────────────

select pg_temp.login('repartidor@yuntera.example');
do $$
declare
  r jsonb;
  v_total bigint := current_setting('t.cod_total')::bigint;
begin
  assert (select cod_amount_minor from public.route_stops where id = current_setting('t.cod_stop')::uuid) = v_total,
    'the stop carries the amount to collect';

  -- The exact amount, or nothing: partial cash is not a delivery.
  r := public.driver_complete_stop(
    current_setting('t.cod_stop')::uuid, current_setting('t.cod_pin'), 'María Fernández', v_total - 100000);
  assert r ->> 'error' = 'cod_amount_mismatch' and (r ->> 'expected_minor')::bigint = v_total,
    format('short cash: %s', r);

  r := public.driver_complete_stop(
    current_setting('t.cod_stop')::uuid, current_setting('t.cod_pin'), 'María Fernández', v_total);
  assert (r ->> 'ok')::boolean, format('cash delivery: %s', r);
end
$$;
reset role;

do $$
declare
  v_order uuid := current_setting('t.cod_order')::uuid;
begin
  assert (select status from public.payments where order_id = v_order) = 'captured',
    'cash collected captures the payment';
  assert (select e.amount_minor from public.ledger_entries e
          join public.ledger_transactions t on t.id = e.transaction_id
          join public.ledger_accounts a on a.id = e.account_id
          where t.order_id = v_order and a.code = 'driver_cash') = current_setting('t.cod_total')::bigint,
    'the cash is booked as held by the driver';
  assert exists (select 1 from public.seller_order_fees where order_id = v_order),
    'the seller statement is produced at capture';
end
$$;

-- Five wrong PINs lock the stop.
do $$
declare
  v_stop uuid;
  r jsonb;
  i integer;
begin
  select rs.id into v_stop from public.route_stops rs
  join public.routes rt on rt.id = rs.route_id
  where rt.status = 'in_progress' and rs.status = 'pending' limit 1;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = 'repartidor@yuntera.example'))::text, true);
  for i in 1 .. 5 loop
    r := public.driver_complete_stop(v_stop, 'xxxx', 'Alguien');
    assert r ->> 'error' = 'wrong_pin', format('attempt %s: %s', i, r);
  end loop;
  r := public.driver_complete_stop(v_stop, 'xxxx', 'Alguien');
  assert r ->> 'error' = 'pin_locked', format('sixth attempt: %s', r);
  -- Even the right PIN no longer works once locked: support has to step in.
  r := public.driver_complete_stop(
    v_stop,
    (select o.delivery_pin from public.orders o join public.shipments s on s.order_id = o.id
     join public.route_stops rs on rs.shipment_id = s.id where rs.id = v_stop),
    'Alguien');
  assert r ->> 'error' = 'pin_locked', 'locked means locked';
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- ── Cash settlement ────────────────────────────────────────────────────────

-- Give the test route's settlement an amount to count.
update public.driver_settlements set cod_expected_minor = 2500000
where route_id = current_setting('t.route')::uuid;

select pg_temp.login('central@yuntera.example');
do $$
begin
  -- Handing in less than was collected needs a written explanation.
  begin
    perform public.ops_settle_route(current_setting('t.route')::uuid, 2400000);
    raise exception 'a cash shortage was accepted without a note';
  exception when others then
    if sqlerrm <> 'note_required_for_difference' then raise; end if;
  end;

  perform public.ops_settle_route(
    current_setting('t.route')::uuid, 2400000, 'Faltan ₡1 000; el repartidor dio vuelto de más.');
  assert (select status = 'short' and cod_handed_minor = 2400000 and settled_by is not null
          from public.driver_settlements where route_id = current_setting('t.route')::uuid),
    'shortage recorded against the route';

  begin
    perform public.ops_settle_route(current_setting('t.route')::uuid, 2500000);
    raise exception 'a settlement was counted twice';
  exception when others then
    if sqlerrm <> 'settlement_already_closed' then raise; end if;
  end;
end
$$;
reset role;

do $$
begin
  -- Office cash + shortage = what the driver was holding.
  assert (
    select sum(e.amount_minor) filter (where a.code = 'cash_office') = 2400000
       and sum(e.amount_minor) filter (where a.code = 'cash_over_short') = 100000
       and sum(e.amount_minor) filter (where a.code = 'driver_cash') = -2500000
    from public.ledger_entries e
    join public.ledger_transactions t on t.id = e.transaction_id
    join public.ledger_accounts a on a.id = e.account_id
    where t.kind = 'cash_settlement' and t.memo = 'Liquidación de efectivo de ruta'
      and t.created_at = (select max(created_at) from public.ledger_transactions where kind = 'cash_settlement')
  ), 'the settlement is booked, shortage included';
  assert (select sum(amount_minor) from public.ledger_entries) = 0, 'and the ledger still balances';
end
$$;

-- ── Reviews and returns after delivery ─────────────────────────────────────

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v_item uuid := (select id from public.order_items where order_id = current_setting('t.packed')::uuid limit 1);
  v_product uuid := (select product_id from public.order_items where id = v_item);
  v_count integer := (select rating_count from public.products where id = v_product);
  v_return uuid;
begin
  perform public.submit_review(v_item, 2::smallint, 'No era lo que esperaba', 'El empaque llegó golpeado.');
  assert (select rating_count from public.products where id = v_product) = v_count + 1,
    'a low rating counts like any other';

  -- Withdrawal needs no reason and is approved on the spot, with a refund date.
  v_return := public.request_return(v_item, 'withdrawal', 1);
  -- Costa Rica is UTC−6; computed here because API users cannot call internal helpers.
  assert (select status = 'approved'
                 and refund_due_on = ((now() at time zone 'UTC') - interval '6 hours')::date + 8
          from public.return_requests where id = v_return), 'withdrawal is a right, not a request';

  -- The same unit cannot be returned twice.
  begin
    perform public.request_return(v_item, 'withdrawal', 1);
    raise exception 'returned the same unit twice';
  exception when others then
    if sqlerrm <> 'invalid_quantity' then raise; end if;
  end;
end
$$;
reset role;

-- A review needs a delivery.
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  perform public.submit_review(
    (select id from public.order_items where order_id = current_setting('t.unpaid')::uuid limit 1), 5::smallint);
  raise exception 'reviewed something never received';
exception when others then
  if sqlerrm <> 'not_delivered_yet' then raise; end if;
end
$$;
reset role;

rollback;
