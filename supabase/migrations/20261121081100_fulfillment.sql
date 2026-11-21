-- Fulfilment and delivery: pick, pack, route, deliver, settle.
--
-- Each function is one step a person takes with a phone or scanner in hand. It
-- checks who is asking, checks the step is legal from the current state, and
-- does everything that step implies in one transaction.

insert into public.ledger_accounts (code, name, kind) values
  ('cash_office', 'Efectivo recibido en oficina', 'asset'),
  ('cash_over_short', 'Sobrantes y faltantes de efectivo', 'expense');

-- ── Shared internals ───────────────────────────────────────────────────────

create or replace function private.order_is_payable_for_fulfilment(p_order_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  -- Work may start only on orders that are paid or confirmed cash-on-delivery.
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.status in ('confirmed', 'processing', 'partially_shipped')
  );
$$;

-- Turns a shipment's reservations into real stock leaving the building.
create or replace function private.consume_shipment_stock(p_shipment_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select res.id, res.warehouse_id, res.sku_id, res.seller_id, res.quantity
    from public.inventory_reservations res
    join public.shipment_items si on si.order_item_id = res.order_item_id
    join public.shipments s on s.id = si.shipment_id and s.origin_warehouse_id = res.warehouse_id
    where si.shipment_id = p_shipment_id and res.status = 'active'
    order by res.sku_id, res.warehouse_id
    for update of res
  loop
    update public.stock_levels
    set on_hand = on_hand - r.quantity, reserved = reserved - r.quantity
    where warehouse_id = r.warehouse_id and sku_id = r.sku_id and seller_id = r.seller_id;

    update public.inventory_reservations
    set status = 'consumed', resolved_at = now() where id = r.id;

    insert into public.stock_movements
      (warehouse_id, sku_id, seller_id, on_hand_delta, quantity, reason, reference_type,
       reference_id, actor_id)
    values
      (r.warehouse_id, r.sku_id, r.seller_id, -r.quantity, r.quantity, 'ship', 'shipment',
       p_shipment_id, (select auth.uid()));
  end loop;
end;
$$;

-- ── Warehouse ──────────────────────────────────────────────────────────────

create or replace function public.wms_start_picking(p_shipment_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ship public.shipments%rowtype;
begin
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then
    perform private.fail('shipment_not_found');
  end if;
  if not (private.works_at(v_ship.origin_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  if v_ship.status <> 'pending' then
    perform private.fail('invalid_shipment_state', v_ship.status::text);
  end if;
  if not private.order_is_payable_for_fulfilment(v_ship.order_id) then
    perform private.fail('order_not_ready');
  end if;

  update public.shipments set status = 'picking' where id = p_shipment_id;
  update public.pick_tasks set status = 'in_progress'
  where shipment_id = p_shipment_id and status = 'open';
  perform private.sync_order_status(v_ship.order_id);
end;
$$;

-- Records what was actually taken from the shelf. Picking fewer than asked
-- marks the task short, which blocks packing until someone resolves it.
create or replace function public.wms_confirm_pick(
  p_task_id uuid,
  p_quantity integer,
  p_location_id uuid default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_task public.pick_tasks%rowtype;
  v_location uuid;
begin
  select * into v_task from public.pick_tasks where id = p_task_id for update;
  if not found then
    perform private.fail('task_not_found');
  end if;
  if not (private.works_at(v_task.warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  if v_task.status not in ('open', 'in_progress', 'short') then
    perform private.fail('invalid_task_state', v_task.status::text);
  end if;
  if not exists (
    select 1 from public.shipments s where s.id = v_task.shipment_id and s.status = 'picking'
  ) then
    perform private.fail('shipment_not_picking');
  end if;
  if p_quantity < v_task.picked_quantity or p_quantity > v_task.quantity then
    perform private.fail('invalid_quantity');
  end if;

  v_location := coalesce(p_location_id, v_task.location_id);
  if v_location is not null and p_quantity > v_task.picked_quantity then
    if not exists (
      select 1 from public.warehouse_locations wl
      where wl.id = v_location and wl.warehouse_id = v_task.warehouse_id
    ) then
      perform private.fail('location_not_found');
    end if;

    update public.bin_stock
    set quantity = quantity - (p_quantity - v_task.picked_quantity)
    where location_id = v_location and sku_id = v_task.sku_id and seller_id = v_task.seller_id
      and quantity >= p_quantity - v_task.picked_quantity;
    if not found then
      -- The shelf does not hold what the system thinks: count it before continuing.
      perform private.fail('bin_stock_insufficient');
    end if;

    insert into public.stock_movements
      (warehouse_id, sku_id, seller_id, from_location_id, on_hand_delta, quantity, reason,
       reference_type, reference_id, actor_id)
    values
      (v_task.warehouse_id, v_task.sku_id, v_task.seller_id, v_location, 0,
       p_quantity - v_task.picked_quantity, 'pick', 'shipment', v_task.shipment_id,
       (select auth.uid()));
  end if;

  update public.pick_tasks
  set picked_quantity = p_quantity,
      status = case when p_quantity = quantity then 'done' else 'short' end::public.pick_status,
      picked_by = (select auth.uid()),
      picked_at = now()
  where id = p_task_id;
end;
$$;

create or replace function public.wms_pack_shipment(
  p_shipment_id uuid,
  p_weight_grams integer,
  p_package_count smallint default 1
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ship public.shipments%rowtype;
begin
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then
    perform private.fail('shipment_not_found');
  end if;
  if not (private.works_at(v_ship.origin_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  if v_ship.status <> 'picking' then
    perform private.fail('invalid_shipment_state', v_ship.status::text);
  end if;
  if exists (
    select 1 from public.pick_tasks t
    where t.shipment_id = p_shipment_id and t.status in ('open', 'in_progress', 'short')
  ) then
    perform private.fail('picking_incomplete');
  end if;
  if p_weight_grams is null or p_weight_grams <= 0 or p_package_count < 1 then
    perform private.fail('invalid_package');
  end if;

  perform private.consume_shipment_stock(p_shipment_id);

  update public.shipments
  set status = 'packed', packed_at = now(), weight_grams = p_weight_grams,
      package_count = p_package_count
  where id = p_shipment_id;
  perform private.sync_order_status(v_ship.order_id);
end;
$$;

-- A seller who ships from their own location prepares the parcel themselves and
-- hands it to Yuntera for delivery.
create or replace function public.seller_mark_packed(
  p_shipment_id uuid,
  p_weight_grams integer,
  p_package_count smallint default 1
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ship public.shipments%rowtype;
begin
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found or v_ship.seller_id is null or not private.is_seller_member(v_ship.seller_id) then
    perform private.fail('shipment_not_found');
  end if;
  if v_ship.status <> 'pending' then
    perform private.fail('invalid_shipment_state', v_ship.status::text);
  end if;
  if not private.order_is_payable_for_fulfilment(v_ship.order_id) then
    perform private.fail('order_not_ready');
  end if;
  if p_weight_grams is null or p_weight_grams <= 0 or p_package_count < 1 then
    perform private.fail('invalid_package');
  end if;

  update public.shipments set status = 'picking' where id = p_shipment_id;
  perform private.consume_shipment_stock(p_shipment_id);
  update public.shipments
  set status = 'packed', packed_at = now(), weight_grams = p_weight_grams,
      package_count = p_package_count
  where id = p_shipment_id;
  perform private.sync_order_status(v_ship.order_id);
end;
$$;

-- ── Dispatch ───────────────────────────────────────────────────────────────

-- Saves a planned route. The stop order comes from the planner in
-- packages/core/src/routing.ts (run in the ops console), or from a dispatcher
-- dragging stops by hand; this function validates and records it.
create or replace function public.ops_create_route(
  p_service_date date,
  p_depot_warehouse_id uuid,
  p_stops jsonb,
  p_driver_id uuid default null,
  p_planned_km numeric default null,
  p_planned_minutes integer default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_route uuid;
  v_stop record;
  v_ship public.shipments%rowtype;
  v_order public.orders%rowtype;
  v_cod bigint;
  v_sequence smallint := 0;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if jsonb_typeof(p_stops) is distinct from 'array' or jsonb_array_length(p_stops) = 0 then
    perform private.fail('route_empty');
  end if;
  if p_driver_id is not null and not exists (
    select 1 from public.drivers d where d.id = p_driver_id and d.status = 'active'
  ) then
    perform private.fail('driver_not_available');
  end if;

  insert into public.routes
    (code, service_date, depot_warehouse_id, driver_id, status, planned_km, planned_minutes, created_by)
  values
    ('R-' || nextval('private.route_code_seq'), p_service_date, p_depot_warehouse_id, p_driver_id,
     case when p_driver_id is null then 'draft' else 'assigned' end::public.route_status,
     p_planned_km, p_planned_minutes, (select auth.uid()))
  returning id into v_route;

  for v_stop in
    select (s ->> 'shipment_id')::uuid as shipment_id,
           (s ->> 'eta_minute')::integer as eta_minute,
           row_number() over (order by (s ->> 'sequence')::integer, ord) as position
    from jsonb_array_elements(p_stops) with ordinality as t (s, ord)
    order by position
  loop
    select * into v_ship from public.shipments where id = v_stop.shipment_id for update;
    if not found then
      perform private.fail('shipment_not_found', v_stop.shipment_id::text);
    end if;
    if v_ship.status not in ('packed', 'ready_for_dispatch', 'delivery_failed') then
      perform private.fail('shipment_not_dispatchable', v_ship.tracking_code);
    end if;

    select * into v_order from public.orders where id = v_ship.order_id;

    -- Cash for the whole order is collected once, at the first parcel delivered.
    v_cod := 0;
    if v_order.payment_method = 'cash_on_delivery'
       and exists (select 1 from public.payments p where p.order_id = v_order.id and p.status = 'pending')
       and not exists (
         select 1 from public.route_stops rs
         join public.shipments s2 on s2.id = rs.shipment_id
         where s2.order_id = v_order.id and rs.cod_amount_minor > 0
           and rs.status in ('pending', 'arrived', 'delivered')
       ) then
      v_cod := v_order.total_minor;
    end if;

    v_sequence := v_sequence + 1;
    begin
      insert into public.route_stops
        (route_id, shipment_id, sequence, eta_minute, recipient_name, phone, senas, lat, lng,
         plus_code, package_count, cod_amount_minor)
      values
        (v_route, v_ship.id, v_sequence, v_stop.eta_minute, v_order.ship_recipient_name,
         v_order.ship_phone, v_order.ship_senas, v_order.ship_lat, v_order.ship_lng,
         v_order.ship_plus_code, v_ship.package_count, v_cod);
    exception when unique_violation then
      perform private.fail('shipment_already_routed', v_ship.tracking_code);
    end;

    if v_ship.status <> 'ready_for_dispatch' then
      update public.shipments set status = 'ready_for_dispatch' where id = v_ship.id;
    end if;
  end loop;

  return v_route;
end;
$$;

create or replace function public.ops_assign_route(p_route_id uuid, p_driver_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if not exists (select 1 from public.drivers d where d.id = p_driver_id and d.status = 'active') then
    perform private.fail('driver_not_available');
  end if;
  update public.routes
  set driver_id = p_driver_id, status = 'assigned'
  where id = p_route_id and status in ('draft', 'assigned');
  if not found then
    perform private.fail('route_not_assignable');
  end if;
end;
$$;

-- ── Driver ─────────────────────────────────────────────────────────────────

create or replace function private.maybe_complete_route(p_route_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_driver uuid;
begin
  if exists (
    select 1 from public.route_stops where route_id = p_route_id and status in ('pending', 'arrived')
  ) then
    return false;
  end if;

  update public.routes
  set status = 'completed', completed_at = now()
  where id = p_route_id and status = 'in_progress'
  returning driver_id into v_driver;
  if v_driver is null then
    return false;
  end if;

  -- Open the cash count for this route: what the driver must hand in.
  insert into public.driver_settlements (route_id, driver_id, cod_expected_minor)
  select p_route_id, v_driver, coalesce(sum(cod_collected_minor), 0)
  from public.route_stops where route_id = p_route_id
  on conflict (route_id) do nothing;
  return true;
end;
$$;

create or replace function public.driver_start_route(p_route_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not private.drives_route(p_route_id) then
    perform private.fail('route_not_found');
  end if;
  update public.routes
  set status = 'in_progress', started_at = now()
  where id = p_route_id and status = 'assigned';
  if not found then
    perform private.fail('route_not_startable');
  end if;

  for r in
    select s.id, s.order_id
    from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
    where rs.route_id = p_route_id and rs.status = 'pending' and s.status = 'ready_for_dispatch'
    order by rs.sequence
  loop
    update public.shipments set status = 'out_for_delivery', dispatched_at = now() where id = r.id;
    perform private.sync_order_status(r.order_id);
  end loop;
end;
$$;

create or replace function public.driver_arrive(p_stop_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.route_stops rs
  set status = 'arrived', arrived_at = now()
  where rs.id = p_stop_id and rs.status = 'pending'
    and private.drives_route(rs.route_id)
    and exists (select 1 from public.routes r where r.id = rs.route_id and r.status = 'in_progress');
  if not found then
    perform private.fail('stop_not_found');
  end if;
end;
$$;

-- Completes a delivery. Returns a result object instead of raising for the
-- outcomes a driver can cause at the door (wrong PIN, wrong cash amount), so
-- that failed PIN attempts are counted rather than rolled back.
create or replace function public.driver_complete_stop(
  p_stop_id uuid,
  p_pin text,
  p_recipient_name text,
  p_cod_collected_minor bigint default 0,
  p_photo_path text default null,
  p_lat double precision default null,
  p_lng double precision default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_stop public.route_stops%rowtype;
  v_ship public.shipments%rowtype;
  v_pin text;
  v_route_done boolean;
  c_max_attempts constant smallint := 5;
begin
  select * into v_stop from public.route_stops where id = p_stop_id for update;
  if not found or not private.drives_route(v_stop.route_id) then
    perform private.fail('stop_not_found');
  end if;
  if not exists (select 1 from public.routes r where r.id = v_stop.route_id and r.status = 'in_progress') then
    perform private.fail('route_not_in_progress');
  end if;
  if v_stop.status not in ('pending', 'arrived') then
    perform private.fail('invalid_stop_state', v_stop.status::text);
  end if;

  if v_stop.pin_attempts >= c_max_attempts then
    return jsonb_build_object('ok', false, 'error', 'pin_locked');
  end if;

  select * into v_ship from public.shipments where id = v_stop.shipment_id for update;
  select o.delivery_pin into v_pin from public.orders o where o.id = v_ship.order_id;

  if p_pin is null or p_pin <> v_pin then
    update public.route_stops set pin_attempts = pin_attempts + 1 where id = p_stop_id;
    return jsonb_build_object(
      'ok', false, 'error', 'wrong_pin',
      'attempts_left', c_max_attempts - v_stop.pin_attempts - 1);
  end if;

  if v_stop.cod_amount_minor > 0 and coalesce(p_cod_collected_minor, 0) <> v_stop.cod_amount_minor then
    return jsonb_build_object(
      'ok', false, 'error', 'cod_amount_mismatch', 'expected_minor', v_stop.cod_amount_minor);
  end if;
  if coalesce(char_length(trim(p_recipient_name)), 0) < 2 then
    return jsonb_build_object('ok', false, 'error', 'recipient_required');
  end if;

  update public.route_stops
  set status = 'delivered', completed_at = now(), arrived_at = coalesce(arrived_at, now()),
      pod_recipient_name = trim(p_recipient_name), pod_photo_path = p_photo_path,
      pod_lat = p_lat, pod_lng = p_lng,
      cod_collected_minor = case when cod_amount_minor > 0 then p_cod_collected_minor else 0 end
  where id = p_stop_id;

  update public.shipments set status = 'delivered', delivered_at = now() where id = v_ship.id;

  if v_stop.cod_amount_minor > 0 then
    perform private.capture_payment(v_ship.order_id, 'cod:' || p_stop_id, true);
  end if;

  perform private.sync_order_status(v_ship.order_id);
  perform private.emit('shipment.delivered', jsonb_build_object('shipment_id', v_ship.id));
  v_route_done := private.maybe_complete_route(v_stop.route_id);

  return jsonb_build_object('ok', true, 'route_completed', v_route_done);
end;
$$;

create or replace function public.driver_fail_stop(
  p_stop_id uuid,
  p_reason text,
  p_lat double precision default null,
  p_lng double precision default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_stop public.route_stops%rowtype;
  v_order uuid;
  v_route_done boolean;
begin
  select * into v_stop from public.route_stops where id = p_stop_id for update;
  if not found or not private.drives_route(v_stop.route_id) then
    perform private.fail('stop_not_found');
  end if;
  if not exists (select 1 from public.routes r where r.id = v_stop.route_id and r.status = 'in_progress') then
    perform private.fail('route_not_in_progress');
  end if;
  if v_stop.status not in ('pending', 'arrived') then
    perform private.fail('invalid_stop_state', v_stop.status::text);
  end if;
  if p_reason not in ('nobody_home', 'wrong_address', 'refused', 'cannot_pay', 'unsafe', 'damaged', 'other') then
    perform private.fail('invalid_failure_reason');
  end if;

  update public.route_stops
  set status = 'failed', completed_at = now(), failure_reason = p_reason, pod_lat = p_lat, pod_lng = p_lng
  where id = p_stop_id;

  update public.shipments
  set status = 'delivery_failed', attempt_count = attempt_count + 1
  where id = v_stop.shipment_id
  returning order_id into v_order;

  perform private.sync_order_status(v_order);
  perform private.emit('shipment.delivery_failed',
    jsonb_build_object('shipment_id', v_stop.shipment_id, 'reason', p_reason));
  v_route_done := private.maybe_complete_route(v_stop.route_id);

  return jsonb_build_object('ok', true, 'route_completed', v_route_done);
end;
$$;

create or replace function public.driver_report_position(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_driver uuid := private.my_driver_id();
begin
  if v_driver is null then
    perform private.fail('forbidden');
  end if;
  insert into public.driver_positions (driver_id, lat, lng, accuracy_m, recorded_at)
  values (v_driver, p_lat, p_lng, p_accuracy_m, now())
  on conflict (driver_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at;
end;
$$;

-- ── Cash settlement ────────────────────────────────────────────────────────

create or replace function public.ops_settle_route(
  p_route_id uuid,
  p_handed_minor bigint,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_settlement public.driver_settlements%rowtype;
  v_tx uuid;
  v_diff bigint;
begin
  if not private.has_staff_role('ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  select * into v_settlement from public.driver_settlements where route_id = p_route_id for update;
  if not found then
    perform private.fail('settlement_not_found');
  end if;
  if v_settlement.status <> 'open' then
    perform private.fail('settlement_already_closed');
  end if;
  if p_handed_minor is null or p_handed_minor < 0 then
    perform private.fail('invalid_amount');
  end if;

  v_diff := v_settlement.cod_expected_minor - p_handed_minor;
  if v_diff <> 0 and coalesce(char_length(trim(p_note)), 0) < 5 then
    -- A difference must be explained in writing by whoever counted the cash.
    perform private.fail('note_required_for_difference');
  end if;

  update public.driver_settlements
  set cod_handed_minor = p_handed_minor,
      status = case when v_diff = 0 then 'settled' else 'short' end,
      note = nullif(trim(p_note), ''),
      settled_by = (select auth.uid()),
      settled_at = now()
  where id = v_settlement.id;

  if v_settlement.cod_expected_minor > 0 or p_handed_minor > 0 then
    insert into public.ledger_transactions (kind, memo, created_by)
    values ('cash_settlement', 'Liquidación de efectivo de ruta', (select auth.uid()))
    returning id into v_tx;

    if p_handed_minor > 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('cash_office'), p_handed_minor);
    end if;
    if v_settlement.cod_expected_minor > 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('driver_cash'), -v_settlement.cod_expected_minor);
    end if;
    if v_diff <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('cash_over_short'), v_diff);
    end if;
  end if;
end;
$$;

-- A failed delivery either goes out again (by adding it to a new route) or
-- starts its way back to where it came from.
create or replace function public.ops_return_shipment(p_shipment_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  update public.shipments set status = 'returning'
  where id = p_shipment_id and status = 'delivery_failed';
  if not found then
    perform private.fail('shipment_not_returnable');
  end if;
end;
$$;
