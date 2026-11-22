-- Follow-ups found by the reviews of the staff and seller apps and by the
-- tests on the hosted preview. Migrations up to 083100 are applied on a hosted
-- project, so every function changed here is redefined, never edited in place.
--
--   1. Picking checks the scanned code in the database.
--   2. Positions sent by drivers are checked (range, NaN, infinity); one far
--      outside the country is refused as a live position and flagged on a stop.
--   3. Each stop says its district and cantón to the drivers' apps.
--   4. Offline driver actions carry the time they happened; the time the
--      server received them is kept beside it.
--   5. Returns: their own refusal for a unit already in a return, withdrawing
--      a request still waiting for a decision, and a final state for an order
--      with one parcel delivered and another that came back.
--   6. Activating a fee schedule pauses offers it leaves below the price
--      floor, lists them for staff and tells their sellers.
--   7. Messages for events nothing consumed yet, and "refund completed" only
--      on a recorded confirmation that the money moved.
--   8. The network extension's grants to visitors and signed-in users.
--
-- Tests: supabase/tests/125_followups.sql, packages/db/src/contract.followups.test.ts.

-- ═══ 1. Picking: the database compares the scanned code ════════════════════

-- The usual spellings of one product code made comparable. Mirrors
-- cleanScan / codeKeys in packages/core/src/scan-codes.ts; a parity test runs
-- the same table of cases against both (125_followups.sql and
-- scan-codes.test.ts).
--   * control characters (a scanner's Enter, tab, the GS separator) and
--     spaces removed; letters in capitals;
--   * an AIM symbology prefix (]C1, ]E0, …) dropped;
--   * a GS1 element string, printed "(01)…" or sent by a scanner after a GS1
--     AIM prefix or with the GS separator, reduced to its GTIN;
--   * a number of up to 14 digits padded to 14 (a 12-digit UPC-A read as a
--     13-digit EAN or a 14-digit GTIN with leading zeros), plus the UPC-A an
--     8-digit UPC-E stands for.
create or replace function private.scan_clean(p_raw text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_raw, ''), E' \t\r\n');
  v_gs1 boolean;
  m text[];
begin
  v_gs1 := v ~ '^\](C1|d2|Q3|e0)' or position(chr(29) in v) > 0;
  v := regexp_replace(v, '^\][A-Za-z][0-9A-Za-z]', '');
  v := regexp_replace(v, '[[:cntrl:][:space:]]', '', 'g');
  m := regexp_match(v, '^\(01\)([0-9]{14})');
  if m is not null then
    return m[1];
  end if;
  if v_gs1 then
    m := regexp_match(v, '^01([0-9]{14})');
    if m is not null then
      return m[1];
    end if;
  end if;
  return upper(v);
end;
$$;

create or replace function private.gtin_check_digit(p_body text) returns integer
language sql immutable
set search_path = ''
as $$
  select (10 - (coalesce(sum(substr(p_body, length(p_body) - i, 1)::integer
                             * case when i % 2 = 0 then 3 else 1 end), 0) % 10)::integer) % 10
  from generate_series(0, length(p_body) - 1) i;
$$;

create or replace function private.gtin_valid(p_code text) returns boolean
language sql immutable
set search_path = ''
as $$
  select case when p_code ~ '^([0-9]{8}|[0-9]{12,14})$'
              then private.gtin_check_digit(left(p_code, -1)) = right(p_code, 1)::integer
              else false end;
$$;

-- UPC-E (8 digits, number system 0 or 1) written out as its UPC-A, or null.
create or replace function private.upc_e_expand(p_code text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  d text;
  v_last integer;
  v_body text;
  v_upca text;
begin
  if p_code is null or p_code !~ '^[01][0-9]{7}$' then
    return null;
  end if;
  d := substr(p_code, 2, 6);
  v_last := substr(d, 6, 1)::integer;
  v_body := case
    when v_last <= 2 then substr(d, 1, 2) || v_last || '0000' || substr(d, 3, 3)
    when v_last = 3 then substr(d, 1, 3) || '00000' || substr(d, 4, 2)
    when v_last = 4 then substr(d, 1, 4) || '00000' || substr(d, 5, 1)
    else substr(d, 1, 5) || '0000' || v_last
  end;
  v_upca := substr(p_code, 1, 1) || v_body || substr(p_code, 8, 1);
  return case when private.gtin_valid(v_upca) then v_upca end;
end;
$$;

create or replace function private.scan_keys(p_code text) returns text[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := private.scan_clean(p_code);
  v_upca text;
begin
  if v = '' then
    return array[]::text[];
  end if;
  if v !~ '^[0-9]+$' or length(v) > 14 then
    return array[v];
  end if;
  v_upca := case when length(v) = 8 then private.upc_e_expand(v) end;
  return array_remove(array[lpad(v, 14, '0'),
                            case when v_upca is not null and lpad(v_upca, 14, '0') <> lpad(v, 14, '0')
                                 then lpad(v_upca, 14, '0') end], null);
end;
$$;

-- True when the code is the SKU's stock code or barcode, in any usual spelling.
create or replace function private.scan_matches_sku(p_code text, p_sku_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.skus k
    where k.id = p_sku_id
      and private.scan_keys(p_code) && (private.scan_keys(k.code) || coalesce(private.scan_keys(k.gtin), array[]::text[])));
$$;

-- Replaces the version in fulfillment. What changed: the code the worker
-- scanned or typed comes with the call, and taking units off the shelf is
-- refused unless it is this line's product (`scanned_wrong_item`), or when no
-- code came at all (`scan_required`). Confirming fewer units than before is
-- not possible (as before), and confirming no new unit (a line left short)
-- needs no scan. Staff in operations call it the same way.
drop function if exists public.wms_confirm_pick(uuid, integer, uuid);

create or replace function public.wms_confirm_pick(
  p_task_id uuid,
  p_quantity integer,
  p_location_id uuid default null,
  p_code text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_task public.pick_tasks%rowtype;
  v_location uuid;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
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
  if p_quantity is null or p_quantity < v_task.picked_quantity or p_quantity > v_task.quantity then
    perform private.fail('invalid_quantity');
  end if;

  if p_quantity > v_task.picked_quantity then
    -- A unit leaves the shelf only against its own code.
    if p_code is null or char_length(p_code) > 200 or private.scan_clean(p_code) = '' then
      perform private.fail('scan_required');
    end if;
    if not private.scan_matches_sku(p_code, v_task.sku_id) then
      perform private.fail('scanned_wrong_item');
    end if;
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

-- ═══ 2 and 4. What a driver's phone reports: positions and times ═══════════

-- The service area: the same box as driver_positions' own check and
-- CR_BOUNDS in packages/core/src/cr/geo.ts (a parity test compares them).
create or replace function private.inside_service_area(p_lat double precision, p_lng double precision)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_lat between 8.0 and 11.25 and p_lng between -86.0 and -82.5;
$$;

-- A position from a phone: none at all (both null) is fine and answers null;
-- half of one, a number that is not finite (NaN, infinity) or outside the
-- globe is refused (`invalid_position`); otherwise it answers whether it lies
-- in the service area.
create or replace function private.check_position(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision default null
) returns boolean
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_lat is null and p_lng is null then
    return null;
  end if;
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::double precision, 'Infinity', '-Infinity')
     or p_lng in ('NaN'::double precision, 'Infinity', '-Infinity')
     or not (p_lat between -90 and 90) or not (p_lng between -180 and 180)
     or (p_accuracy_m is not null
         and (p_accuracy_m in ('NaN'::double precision, 'Infinity', '-Infinity') or p_accuracy_m < 0)) then
    perform private.fail('invalid_position');
  end if;
  return private.inside_service_area(p_lat, p_lng);
end;
$$;

-- When an action a driver took (possibly without signal) happened. The phone
-- says; the database accepts it only within sane bounds:
--   * none given: now;
--   * with the phone's clock at sending (p_sent_at): the time is taken as the
--     database's now minus how long the phone held it (p_sent_at - p_at), so
--     a phone clock that runs fast or slow does not matter; a time after the
--     sending is refused;
--   * more than two minutes ahead of the database's clock (a phone clock that
--     is wrong, or made up, sent without p_sent_at): refused; up to two
--     minutes ahead counts as now;
--   * more than a day ago: refused (the app keeps stop actions a day);
--   * before what it follows (the route's start, the arrival): moved up to it.
create or replace function private.action_time(
  p_at timestamptz,
  p_not_before timestamptz default null,
  p_sent_at timestamptz default null
) returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  v_at timestamptz := p_at;
begin
  if p_at is null then
    return now();
  end if;
  if p_at = 'infinity'::timestamptz then
    perform private.fail('action_time_in_future');
  end if;
  if p_at = '-infinity'::timestamptz then
    perform private.fail('action_time_too_old');
  end if;
  if p_sent_at is not null then
    if p_sent_at in ('infinity'::timestamptz, '-infinity'::timestamptz) or p_at > p_sent_at then
      perform private.fail('action_time_in_future');
    end if;
    if p_sent_at - p_at > interval '24 hours' then
      perform private.fail('action_time_too_old');
    end if;
    v_at := now() - (p_sent_at - p_at);
  end if;
  if v_at > now() + interval '2 minutes' then
    perform private.fail('action_time_in_future');
  end if;
  if v_at < now() - interval '24 hours' then
    perform private.fail('action_time_too_old');
  end if;
  return greatest(least(v_at, now()), coalesce(p_not_before, '-infinity'::timestamptz));
end;
$$;

alter table public.route_stops
  -- When the server received the arrival and the closing of the stop; the
  -- columns without "received" hold when they happened.
  add column arrived_received_at timestamptz,
  add column completed_received_at timestamptz,
  -- The position the phone gave at the door lies outside the service area: kept,
  -- for staff to look at, never trusted as where the stop is.
  add column pod_outside_area boolean not null default false;

alter table public.driver_positions
  add column received_at timestamptz not null default now();

-- Replaces the version in fulfillment: the time of arrival may come from the
-- phone (p_occurred_at), and the caller is checked first.
drop function if exists public.driver_arrive(uuid);
drop function if exists public.driver_arrive(uuid, timestamptz);

create or replace function public.driver_arrive(
  p_stop_id uuid,
  p_occurred_at timestamptz default null,
  p_sent_at timestamptz default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_stop public.route_stops%rowtype;
  v_started timestamptz;
  v_at timestamptz;
begin
  if private.my_driver_id() is null then
    perform private.fail('stop_not_found');
  end if;
  select * into v_stop from public.route_stops where id = p_stop_id for update;
  if not found or not private.drives_route(v_stop.route_id) then
    perform private.fail('stop_not_found');
  end if;
  select r.started_at into v_started from public.routes r
  where r.id = v_stop.route_id and r.status = 'in_progress';
  if not found or v_stop.status <> 'pending' then
    perform private.fail('stop_not_found');
  end if;
  v_at := private.action_time(p_occurred_at, v_started, p_sent_at);
  update public.route_stops
  set status = 'arrived', arrived_at = v_at, arrived_received_at = now()
  where id = p_stop_id;
end;
$$;

-- Replaces the version in integrity. What changed: the caller is checked
-- first; the position is checked (`invalid_position`), and one outside the
-- service area is kept but flagged. The delivery itself needs signal (the
-- code is checked here), so it happens now.
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
  v_code private.delivery_codes%rowtype;
  v_order_id uuid;
  v_method public.payment_method;
  v_route_done boolean;
  v_attempts smallint;
  v_inside boolean;
  c_max_attempts constant smallint := private.delivery_code_max_attempts();
begin
  if private.my_driver_id() is null then
    perform private.fail('stop_not_found');
  end if;
  v_inside := private.check_position(p_lat, p_lng);
  -- The order first, as every function that changes an order's money does.
  select s.order_id into v_order_id
  from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
  where rs.id = p_stop_id;
  select o.payment_method into v_method from public.orders o where o.id = v_order_id for update;
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

  select * into v_ship from public.shipments where id = v_stop.shipment_id for update;
  select * into v_code from private.delivery_codes where order_id = v_ship.order_id for update;

  if v_code.order_id is null then
    perform private.fail('stop_not_found');
  end if;
  if v_code.locked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'pin_locked');
  end if;

  if p_pin is null or p_pin <> v_code.code then
    v_attempts := v_code.wrong_attempts + 1;
    update public.route_stops set pin_attempts = pin_attempts + 1 where id = p_stop_id;
    update private.delivery_codes
    set wrong_attempts = v_attempts,
        locked_at = case when v_attempts >= c_max_attempts then now() end,
        updated_at = now()
    where order_id = v_ship.order_id;
    insert into private.delivery_code_attempts (order_id, stop_id, driver_id)
    values (v_ship.order_id, p_stop_id, private.my_driver_id());
    if v_attempts >= c_max_attempts then
      insert into public.order_events (order_id, shipment_id, kind, note, visible_to_customer, actor_id)
      values (v_ship.order_id, v_ship.id, 'note',
              'Código de entrega bloqueado tras ' || c_max_attempts
                || ' intentos fallidos. Atención al cliente debe liberarlo.',
              false, (select auth.uid()));
      perform private.emit('delivery_code.locked', jsonb_build_object(
        'order_id', v_ship.order_id, 'stop_id', p_stop_id, 'driver_id', private.my_driver_id(),
        'attempts', v_attempts));
      return jsonb_build_object('ok', false, 'error', 'pin_locked', 'attempts_left', 0);
    end if;
    return jsonb_build_object(
      'ok', false, 'error', 'wrong_pin',
      'attempts_left', greatest(0, c_max_attempts - v_attempts));
  end if;

  if v_method = 'cash_on_delivery' then
    perform private.replan_cod(v_ship.order_id, p_stop_id);
    select * into v_stop from public.route_stops where id = p_stop_id;
  end if;

  if v_stop.cod_amount_minor > 0 and coalesce(p_cod_collected_minor, 0) <> v_stop.cod_amount_minor then
    return jsonb_build_object(
      'ok', false, 'error', 'cod_amount_mismatch', 'expected_minor', v_stop.cod_amount_minor);
  end if;
  if coalesce(char_length(trim(p_recipient_name)), 0) < 2 then
    return jsonb_build_object('ok', false, 'error', 'recipient_required');
  end if;

  update public.route_stops
  set status = 'delivered', completed_at = now(), completed_received_at = now(),
      arrived_at = coalesce(arrived_at, now()),
      pod_recipient_name = trim(p_recipient_name), pod_photo_path = p_photo_path,
      pod_lat = p_lat, pod_lng = p_lng, pod_outside_area = coalesce(not v_inside, false),
      cod_collected_minor = case when cod_amount_minor > 0 then p_cod_collected_minor else 0 end
  where id = p_stop_id;

  update public.shipments set status = 'delivered', delivered_at = now() where id = v_ship.id;

  if v_stop.cod_amount_minor > 0 then
    perform private.capture_payment(v_ship.order_id, 'cod:' || p_stop_id, true);
    perform private.settle_returned_parcels_at_door(v_ship.order_id);
  end if;

  perform private.sync_order_status(v_ship.order_id);
  perform private.emit('shipment.delivered', jsonb_build_object('shipment_id', v_ship.id));
  v_route_done := private.maybe_complete_route(v_stop.route_id);

  return jsonb_build_object('ok', true, 'route_completed', v_route_done);
end;
$$;

-- Replaces the version in integrity. What changed: the caller is checked
-- first; the position is checked and flagged as at the door; and the failure
-- may carry the time it happened (sent later from a dead zone): the stop, the
-- parcel's history and the shopper's timeline show that time, and the time
-- the server received it is kept beside it.
drop function if exists public.driver_fail_stop(uuid, text, double precision, double precision);
drop function if exists public.driver_fail_stop(uuid, text, double precision, double precision, timestamptz);

create or replace function public.driver_fail_stop(
  p_stop_id uuid,
  p_reason text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_occurred_at timestamptz default null,
  p_sent_at timestamptz default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_stop public.route_stops%rowtype;
  v_order uuid;
  v_route_done boolean;
  v_inside boolean;
  v_started timestamptz;
  v_at timestamptz;
begin
  if private.my_driver_id() is null then
    perform private.fail('stop_not_found');
  end if;
  v_inside := private.check_position(p_lat, p_lng);
  select s.order_id into v_order
  from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
  where rs.id = p_stop_id;
  perform 1 from public.orders where id = v_order for update;
  select * into v_stop from public.route_stops where id = p_stop_id for update;
  if not found or not private.drives_route(v_stop.route_id) then
    perform private.fail('stop_not_found');
  end if;
  select r.started_at into v_started from public.routes r
  where r.id = v_stop.route_id and r.status = 'in_progress';
  if not found then
    perform private.fail('route_not_in_progress');
  end if;
  if v_stop.status not in ('pending', 'arrived') then
    perform private.fail('invalid_stop_state', v_stop.status::text);
  end if;
  if p_reason is null
     or p_reason not in ('nobody_home', 'wrong_address', 'refused', 'cannot_pay', 'unsafe', 'damaged', 'other') then
    perform private.fail('invalid_failure_reason');
  end if;
  v_at := private.action_time(p_occurred_at, coalesce(v_stop.arrived_at, v_started), p_sent_at);

  update public.route_stops
  set status = 'failed', completed_at = v_at, completed_received_at = now(),
      failure_reason = p_reason, pod_lat = p_lat, pod_lng = p_lng,
      pod_outside_area = coalesce(not v_inside, false)
  where id = p_stop_id;

  update public.shipments
  set status = 'delivery_failed', attempt_count = attempt_count + 1
  where id = v_stop.shipment_id;
  -- The history shows when it happened, not when the phone found signal.
  update public.order_events e set created_at = v_at
  where e.id = (select max(e2.id) from public.order_events e2
                where e2.shipment_id = v_stop.shipment_id and e2.kind = 'shipment_status'
                  and e2.to_status = 'delivery_failed');

  perform private.replan_cod(v_order);
  perform private.sync_order_status(v_order);
  perform private.emit('shipment.delivery_failed',
    jsonb_build_object('shipment_id', v_stop.shipment_id, 'reason', p_reason, 'occurred_at', v_at));
  v_route_done := private.maybe_complete_route(v_stop.route_id);

  return jsonb_build_object('ok', true, 'route_completed', v_route_done);
end;
$$;

-- Replaces the version in fulfillment. What changed: the position is checked
-- (`invalid_position`); one outside the service area is refused with its own
-- code (`position_outside_area`) instead of the table's raw check error, and
-- not stored: the dispatch map shows where drivers are in Costa Rica, and a
-- reading from far away is a fault or a fake, which the next report replaces.
-- A position may carry the time it was read; an older one than the one on
-- file never overwrites it (a queue sending late).
drop function if exists public.driver_report_position(double precision, double precision, real);
drop function if exists public.driver_report_position(double precision, double precision, real, timestamptz);

create or replace function public.driver_report_position(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real default null,
  p_occurred_at timestamptz default null,
  p_sent_at timestamptz default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_driver uuid := private.my_driver_id();
  v_at timestamptz;
begin
  if v_driver is null then
    perform private.fail('forbidden');
  end if;
  if p_lat is null or p_lng is null then
    perform private.fail('invalid_position');
  end if;
  if not private.check_position(p_lat, p_lng, p_accuracy_m) then
    perform private.fail('position_outside_area');
  end if;
  v_at := private.action_time(p_occurred_at, null, p_sent_at);
  insert into public.driver_positions as dp (driver_id, lat, lng, accuracy_m, recorded_at, received_at)
  values (v_driver, p_lat, p_lng, p_accuracy_m, v_at, now())
  on conflict (driver_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at, received_at = excluded.received_at
    where dp.recorded_at <= excluded.recorded_at;
end;
$$;

-- Replaces the version in api_operations: each stop on the dispatch board
-- also says when the server received its closing (it differs from when it
-- happened when the phone had no signal) and whether the position given at
-- the door lay outside the service area, so Central sees the flag.
create or replace function public.ops_dispatch_board(p_date date default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, private.cr_local(now())::date);
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;

  return jsonb_build_object(
    'date', v_date,
    'depots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'code', w.code, 'name', w.name, 'lat', w.lat, 'lng', w.lng) order by w.code)
      from public.warehouses w where w.kind = 'platform' and w.active), '[]'::jsonb),
    'ready', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shipment_id', sh.id, 'tracking_code', sh.tracking_code, 'status', sh.status,
        'order_number', o.order_number, 'origin_code', w.code, 'origin_kind', w.kind,
        'recipient_name', o.ship_recipient_name, 'lat', o.ship_lat, 'lng', o.ship_lng,
        'canton', (select c.name from public.districts d join public.cantons c on c.code = d.canton_code
                   where d.postal_code = o.ship_postal_code),
        'weight_grams', coalesce(sh.weight_grams, 1000), 'package_count', sh.package_count,
        'promise_latest', sh.promise_latest, 'attempt_count', sh.attempt_count,
        'cash_on_delivery', o.payment_method = 'cash_on_delivery'
      ) order by sh.promise_latest, o.placed_at)
      from public.shipments sh
      join public.orders o on o.id = sh.order_id
      join public.warehouses w on w.id = sh.origin_warehouse_id
      where sh.status in ('packed', 'delivery_failed')
        and not exists (select 1 from public.route_stops rs
                        where rs.shipment_id = sh.id and rs.status in ('pending', 'arrived'))
    ), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'full_name', d.full_name, 'vehicle_type', d.vehicle_type,
        'capacity_kg', d.capacity_kg, 'phone', d.phone,
        'active_routes', (select count(*) from public.routes r
                          where r.driver_id = d.id and r.status in ('assigned', 'in_progress')),
        'position', (select jsonb_build_object('lat', dp.lat, 'lng', dp.lng, 'recorded_at', dp.recorded_at)
                     from public.driver_positions dp where dp.driver_id = d.id)
      ) order by d.full_name)
      from public.drivers d where d.status = 'active'), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route_id', r.id, 'code', r.code, 'status', r.status, 'service_date', r.service_date,
        'driver_name', (select d.full_name from public.drivers d where d.id = r.driver_id),
        'planned_km', r.planned_km, 'planned_minutes', r.planned_minutes,
        'started_at', r.started_at, 'completed_at', r.completed_at,
        'stops', coalesce((
          select jsonb_agg(jsonb_build_object(
            'stop_id', rs.id, 'sequence', rs.sequence, 'status', rs.status,
            'recipient_name', rs.recipient_name, 'lat', rs.lat, 'lng', rs.lng,
            'tracking_code', sh.tracking_code, 'cod_amount_minor', rs.cod_amount_minor,
            'failure_reason', rs.failure_reason, 'completed_at', rs.completed_at,
            'completed_received_at', rs.completed_received_at,
            'pod_outside_area', rs.pod_outside_area
          ) order by rs.sequence)
          from public.route_stops rs join public.shipments sh on sh.id = rs.shipment_id
          where rs.route_id = r.id), '[]'::jsonb)
      ) order by (r.status = 'in_progress') desc, r.code desc)
      from public.routes r
      where r.service_date = v_date or r.status in ('draft', 'assigned', 'in_progress')
    ), '[]'::jsonb)
  );
end;
$$;

-- ═══ 3. The district of each stop, for the drivers' apps ═══════════════════

-- Replaces the body that 083000 moved here (the integrity version): each stop
-- also says its district and cantón, so the driver sees more than the señas.
-- The gate in front of it (public.driver_today) is unchanged.
create or replace function private.driver_today_active() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  d public.drivers%rowtype;
begin
  select * into d from public.drivers where user_id = (select auth.uid());
  if not found then
    perform private.fail('not_a_driver');
  end if;

  return jsonb_build_object(
    'driver', jsonb_build_object(
      'id', d.id, 'full_name', d.full_name, 'status', d.status, 'vehicle_type', d.vehicle_type,
      'plate', d.plate),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route_id', r.id, 'code', r.code, 'status', r.status, 'service_date', r.service_date,
        'planned_km', r.planned_km, 'planned_minutes', r.planned_minutes,
        'started_at', r.started_at, 'completed_at', r.completed_at,
        'depot', (select jsonb_build_object('name', w.name, 'address', w.address, 'lat', w.lat, 'lng', w.lng)
                  from public.warehouses w where w.id = r.depot_warehouse_id),
        'cash_to_hand_in_minor', (select coalesce(sum(rs.cod_collected_minor), 0)
                                  from public.route_stops rs where rs.route_id = r.id),
        'stops', coalesce((
          select jsonb_agg(jsonb_build_object(
            'stop_id', rs.id, 'sequence', rs.sequence, 'status', rs.status,
            'eta_minute', rs.eta_minute, 'recipient_name', rs.recipient_name, 'phone', rs.phone,
            'senas', rs.senas, 'lat', rs.lat, 'lng', rs.lng, 'plus_code', rs.plus_code,
            'district', di.name, 'canton', ca.name,
            'package_count', rs.package_count, 'cod_amount_minor', rs.cod_amount_minor,
            'cod_collected_minor', rs.cod_collected_minor, 'failure_reason', rs.failure_reason,
            'pin_attempts_left', (
              select case when c.locked_at is not null then 0
                          else greatest(0, private.delivery_code_max_attempts() - c.wrong_attempts) end
              from private.delivery_codes c where c.order_id = sh.order_id),
            'tracking_code', sh.tracking_code, 'completed_at', rs.completed_at
          ) order by rs.sequence)
          from public.route_stops rs
          join public.shipments sh on sh.id = rs.shipment_id
          join public.orders o on o.id = sh.order_id
          left join public.districts di on di.postal_code = o.ship_postal_code
          left join public.cantons ca on ca.code = di.canton_code
          where rs.route_id = r.id), '[]'::jsonb)
      ) order by (r.status = 'in_progress') desc, (r.status = 'assigned') desc, r.service_date desc, r.code)
      from public.routes r
      where r.driver_id = d.id
        and (r.status in ('assigned', 'in_progress')
             or (r.status = 'completed' and r.completed_at > now() - interval '24 hours'))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.driver_today_active() from public, anon, authenticated;


-- The names of cantons and districts came in title case from the source
-- ('Montes De Oca'); now that drivers read them on every stop, the joining
-- words go in lower case as Spanish writes them ('Montes de Oca', 'Isla del
-- Coco'). 'La' and 'El' stay: they are part of the name ('San Isidro de El
-- General', 'Valle La Estrella').
update public.cantons
set name = replace(replace(replace(name, ' De ', ' de '), ' Del ', ' del '), ' Y ', ' y ')
where name ~ ' (De|Del|Y) ';
update public.districts
set name = replace(replace(replace(name, ' De ', ' de '), ' Del ', ' del '), ' Y ', ' y ')
where name ~ ' (De|Del|Y) ';

-- ═══ 5. Returns ════════════════════════════════════════════════════════════

-- A shopper may withdraw a request that is still waiting for a decision. It
-- closes like a refusal (its units are free again, every rule that counts
-- open returns sees it closed), marked as the shopper's own doing.
alter table public.return_requests add column withdrawn_at timestamptz;

-- Replaces the version in integrity: a unit already in another return has
-- its own refusal, so the screen can say so.
create or replace function private.return_quantity_within_line() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_bought integer;
begin
  select quantity into v_bought from public.order_items where id = new.order_item_id for update;
  if (select coalesce(sum(r.quantity), 0) from public.return_requests r
      where r.order_item_id = new.order_item_id and r.status <> 'rejected') > v_bought then
    perform private.fail('units_already_in_return');
  end if;
  return null;
end;
$$;

-- Replaces the version in integrity. What changed: asking for units that are
-- already in another return answers `units_already_in_return` (it used to
-- answer the cart's `invalid_quantity`), and asking for more than were
-- received answers `return_more_than_received`.
create or replace function public.request_return(
  p_order_item_id uuid,
  p_kind text,
  p_quantity integer,
  p_reason text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_today date := private.cr_local(now())::date;
  v_delivered integer;
  v_already integer;
  v_id uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  select i.order_id into v_order_id from public.order_items i where i.id = p_order_item_id;
  select * into v_order from public.orders where id = v_order_id for update;
  if not found or v_order.user_id is distinct from v_user then
    perform private.fail('order_item_not_found');
  end if;
  select * into v_item from public.order_items where id = p_order_item_id for update;

  if p_kind is null or p_kind not in ('withdrawal', 'warranty', 'damaged', 'wrong_item') then
    perform private.fail('invalid_return_kind');
  end if;
  if char_length(trim(p_reason)) > 2000 then
    perform private.fail('reason_too_long');
  end if;
  if not private.order_returnable(v_order) then
    perform private.fail('order_not_returnable', v_order.status::text);
  end if;

  v_delivered := private.delivered_units(p_order_item_id);
  if v_delivered = 0 then
    if p_kind = 'withdrawal' then
      perform private.fail('withdraw_before_delivery');
    end if;
    perform private.fail('not_delivered_yet');
  end if;

  select coalesce(sum(quantity), 0) into v_already
  from public.return_requests
  where order_item_id = p_order_item_id and status <> 'rejected';
  if p_quantity is null or p_quantity <= 0 then
    perform private.fail('invalid_quantity');
  end if;
  -- In bigint: a huge quantity must answer with its code, not an overflow.
  if p_quantity::bigint + v_already > v_delivered then
    if v_already > 0 and p_quantity <= v_delivered then
      perform private.fail('units_already_in_return', (v_delivered - v_already)::text);
    end if;
    perform private.fail('return_more_than_received', v_delivered::text);
  end if;

  if p_kind = 'withdrawal' then
    if v_today > v_order.withdrawal_deadline then
      perform private.fail('withdrawal_window_closed', v_order.withdrawal_deadline::text);
    end if;
  else
    if p_kind = 'warranty' and (v_order.warranty_until is null or v_today > v_order.warranty_until) then
      perform private.fail('warranty_expired', coalesce(v_order.warranty_until::text, ''));
    end if;
    if coalesce(char_length(trim(p_reason)), 0) < 10 then
      perform private.fail('reason_required');
    end if;
  end if;

  insert into public.return_requests (order_item_id, user_id, kind, quantity, reason, status, refund_due_on)
  values (p_order_item_id, v_user, p_kind, p_quantity, nullif(trim(p_reason), ''),
          case when p_kind = 'withdrawal' then 'approved' else 'requested' end,
          case when p_kind = 'withdrawal' then v_today + 8 end)
  returning id into v_id;

  perform private.emit('return.requested', jsonb_build_object('return_request_id', v_id));
  return v_id;
end;
$$;

-- The shopper withdraws a request opened by mistake, while it still waits for
-- staff's decision. An approved return (a withdrawal of the purchase is
-- approved at once) is past that point: the goods are then collected, and
-- support is the way to stop it.
create or replace function public.withdraw_return_request(p_return_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order_id uuid;
  v_return public.return_requests%rowtype;
  v_title text;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  select i.order_id into v_order_id
  from public.return_requests r join public.order_items i on i.id = r.order_item_id
  where r.id = p_return_id and r.user_id = v_user;
  if not found then
    -- Someone else's return and one that does not exist look the same.
    perform private.fail('return_not_found');
  end if;
  perform 1 from public.orders where id = v_order_id for update;
  select * into v_return from public.return_requests where id = p_return_id for update;
  -- Already withdrawn (a second tab, a double submit): it is done, say so
  -- again rather than suggest that staff decided it.
  if v_return.withdrawn_at is not null then
    return jsonb_build_object('id', p_return_id, 'status', v_return.status,
                              'withdrawn_at', v_return.withdrawn_at);
  end if;
  if v_return.status <> 'requested' then
    perform private.fail('return_not_withdrawable', v_return.status);
  end if;

  update public.return_requests
  set status = 'rejected', withdrawn_at = now(), resolved_at = now(),
      resolution_note = 'Usted retiró esta solicitud.'
  where id = p_return_id;

  select i.title into v_title from public.order_items i where i.id = v_return.order_item_id;
  insert into public.order_events (order_id, kind, note, actor_id)
  values (v_order_id, 'note',
          'Retiró su solicitud de devolución de ' || v_return.quantity || ' × ' || v_title, v_user);
  perform private.emit('return.withdrawn', jsonb_build_object('return_request_id', p_return_id));

  return jsonb_build_object('id', p_return_id, 'status', 'rejected', 'withdrawn_at', now());
end;
$$;

-- Replaces the version in integrity: says when the shopper withdrew a
-- request, and whether one can still be withdrawn.
create or replace function public.my_order_returns(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where order_number = p_order_number;
  if not found or v_order.user_id is distinct from (select auth.uid()) then
    perform private.fail('order_not_found');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'order_item_id', r.order_item_id, 'kind', r.kind, 'status', r.status,
      'quantity', r.quantity, 'refund_minor', r.refund_minor,
      'resolution_note', r.resolution_note, 'created_at', r.created_at,
      'received_at', r.received_at, 'resolved_at', r.resolved_at,
      'withdrawn_at', r.withdrawn_at, 'can_withdraw', r.status = 'requested'
    ) order by r.created_at, r.id)
    from public.return_requests r
    join public.order_items i on i.id = r.order_item_id
    where i.order_id = v_order.id), '[]'::jsonb);
end;
$$;

-- Replaces the version in orders (orderStatusFromShipments in
-- packages/core/src/lifecycle.ts says the same). What changed: an order whose
-- parcels have all ended, at least one delivered and the others back at the
-- warehouse (returned), is delivered: nothing more can happen to it, as
-- seller payouts already decided (private.seller_order_settled_at treats
-- delivered and returned parcels as ended, from the last one). Before, such
-- an order stayed "shipped" and kept counting as open, which also blocked
-- deleting the account.
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

-- Replaces the version in people_payouts so that the new final state changes
-- no payout: an order that has a parcel back at the warehouse is settled for
-- each seller when that seller's own parcels ended, as before (such an order
-- never had a delivery date until now). Any other order keeps its delivery
-- date, as before.
create or replace function private.seller_order_settled_at(p_order_id uuid, p_seller_id uuid)
returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  with parcels as (
    select distinct sh.id, sh.status, coalesce(sh.delivered_at, sh.updated_at) as ended_at
    from public.shipments sh
    join public.shipment_items si on si.shipment_id = sh.id
    join public.order_items i on i.id = si.order_item_id
    where sh.order_id = p_order_id and i.seller_id = p_seller_id
  )
  select coalesce(
    (select o.delivered_at from public.orders o
     where o.id = p_order_id
       and not exists (select 1 from public.shipments s where s.order_id = o.id and s.status = 'returned')),
    (select max(p.ended_at) filter (where p.status in ('delivered', 'returned'))
     from parcels p
     having count(*) filter (where p.status not in ('delivered', 'returned', 'cancelled')) = 0));
$$;

revoke all on function private.seller_order_settled_at(uuid, uuid) from public, anon, authenticated;

-- Orders already in that situation: delivered as of when their last parcel
-- ended, the time payouts already use for them, with the windows counted from
-- that day (never shorter than before).
do $$
declare
  r record;
  v_ended timestamptz;
  v_window date;
begin
  for r in
    select o.id, o.withdrawal_deadline from public.orders o
    where o.status in ('shipped', 'partially_shipped')
      and exists (select 1 from public.shipments s where s.order_id = o.id and s.status = 'delivered')
      and not exists (select 1 from public.shipments s where s.order_id = o.id
                      and s.status not in ('delivered', 'returned', 'cancelled'))
    order by o.id
  loop
    select max(coalesce(s.delivered_at, s.updated_at)) into v_ended
    from public.shipments s where s.order_id = r.id and s.status in ('delivered', 'returned');
    perform private.sync_order_status(r.id);
    v_window := private.add_business_days(private.cr_local(v_ended)::date, 8);
    update public.orders
    set delivered_at = v_ended,
        warranty_until = private.add_business_days(private.cr_local(v_ended)::date, 30),
        withdrawal_deadline = greatest(r.withdrawal_deadline, v_window)
    where id = r.id and status = 'delivered';
  end loop;
end
$$;

-- ═══ 6. Fees: a new schedule and the price floor ══════════════════════════

-- Offers a fee change left below the floor (a sale would book fees larger
-- than what the seller is paid). They are paused when it happens: a sale at
-- a loss leaves the seller owing money for each unit, which nothing collects,
-- while a paused offer is back on sale the moment its seller sets a price
-- that covers the new fees (the floor is checked then, as for any price).
create table private.fee_floor_breaches (
  id bigint generated always as identity primary key,
  schedule_version text not null,
  offer_id uuid not null references public.offers (id) on delete cascade,
  seller_id uuid not null references public.sellers (id) on delete cascade,
  price_minor bigint not null,
  -- The lowest price that covers the new fees, in céntimos (null: none does).
  min_price_minor bigint,
  paused_at timestamptz not null default now(),
  unique (schedule_version, offer_id)
);

create index fee_floor_breaches_seller_idx on private.fee_floor_breaches (seller_id, paused_at desc);
alter table private.fee_floor_breaches enable row level security;
revoke all on private.fee_floor_breaches from public, anon, authenticated;

-- Checks every offer on sale against the active schedule; pauses those below
-- the floor, records them, and tells each shop once. Returns how many it paused.
create or replace function private.recheck_offers_against_fees() returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_version text;
  r record;
  v_count integer := 0;
  v_offers uuid[] := '{}';
  v_sellers uuid[] := '{}';
begin
  select version into v_version from public.fee_schedules where active;
  if not found then
    return 0;
  end if;

  for r in
    select o.id, o.seller_id, o.price_minor, o.fulfillment, p.category_id, k.weight_grams,
           greatest(k.length_cm, k.width_cm, k.height_cm) as longest
    from public.offers o
    join public.skus k on k.id = o.sku_id
    join public.products p on p.id = k.product_id
    where o.status = 'active'
    order by o.seller_id, o.id
    for update of o
  loop
    if private.worst_unit_payout(r.price_minor, r.fulfillment, r.category_id, r.weight_grams, r.longest) < 0 then
      update public.offers set status = 'paused' where id = r.id;
      insert into private.fee_floor_breaches (schedule_version, offer_id, seller_id, price_minor, min_price_minor)
      values (v_version, r.id, r.seller_id, r.price_minor,
              private.min_price_covering_fees(r.fulfillment, r.category_id, r.weight_grams, r.longest))
      on conflict (schedule_version, offer_id) do update
        set price_minor = excluded.price_minor, min_price_minor = excluded.min_price_minor,
            paused_at = now();
      v_offers := v_offers || r.id;
      v_sellers := v_sellers || r.seller_id;
      v_count := v_count + 1;
    end if;
  end loop;

  -- One message per shop and schedule for this change, however many passes
  -- of the re-check it takes (a migration that touches several fee tables
  -- runs one per statement). Events of this transaction share its now(); the
  -- message lists the shop's paused offers when it is written, after commit,
  -- so a later pass's offers are in it too.
  if v_count > 0 then
    perform private.emit('fees.offers_paused', jsonb_build_object(
      'seller_id', x.seller_id, 'schedule_version', v_version, 'offer_count', x.n))
    from (
      select r2.seller_id, count(*) as n
      from unnest(v_offers, v_sellers) as r2(offer_id, seller_id)
      group by r2.seller_id) x
    where not exists (
      select 1 from private.outbox_events e
      where e.topic = 'fees.offers_paused' and e.created_at = now()
        and e.payload ->> 'seller_id' = x.seller_id::text
        and e.payload ->> 'schedule_version' = v_version)
    order by x.seller_id;
  end if;
  return v_count;
end;
$$;

create or replace function private.fees_changed() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.recheck_offers_against_fees();
  return null;
end;
$$;

-- A schedule switched on, or a change to the active one's amounts or to a
-- category's commission: whatever path (in practice a migration) made it.
create trigger fee_schedules_recheck_offers
  after insert or update of active, default_referral_bps, min_referral_fee_per_unit_minor, fee_tax_bps
  on public.fee_schedules
  for each row when (new.active) execute function private.fees_changed();
create trigger fee_payment_methods_recheck_offers
  after insert or update or delete on public.fee_payment_methods
  for each statement execute function private.fees_changed();
create trigger fee_fulfillment_tiers_recheck_offers
  after insert or update or delete on public.fee_fulfillment_tiers
  for each statement execute function private.fees_changed();
create trigger categories_recheck_offers
  after update of referral_bps on public.categories
  for each statement execute function private.fees_changed();

-- For finance and catalogue staff: offers paused by a fee change that are
-- still paused. Oldest first, at most 200.
create or replace function public.ops_fee_floor_breaches() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('finance', 'catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.row order by x.paused_at, x.id)
    from (
      select b.id, b.paused_at, jsonb_build_object(
        'offer_id', b.offer_id, 'seller_id', b.seller_id, 'shop_name', s.trade_name,
        'product_title', p.title, 'variant_name', k.variant_name, 'sku_code', k.code,
        'schedule_version', b.schedule_version, 'price_minor', o.price_minor,
        'min_price_minor', b.min_price_minor, 'paused_at', b.paused_at) as row
      from private.fee_floor_breaches b
      join public.offers o on o.id = b.offer_id
      join public.skus k on k.id = o.sku_id
      join public.products p on p.id = k.product_id
      join public.sellers s on s.id = b.seller_id
      where o.status = 'paused'
        and b.id = (select max(b2.id) from private.fee_floor_breaches b2 where b2.offer_id = b.offer_id)
      order by b.paused_at, b.id
      limit 200) x), '[]'::jsonb);
end;
$$;

-- ═══ 7. Messages ══════════════════════════════════════════════════════════

insert into private.outbox_routes (topic, consumer) values
  ('return.received', 'notify'),
  ('delivery_code.locked', 'notify'),
  ('delivery_code.released', 'notify'),
  ('seller.member_invited', 'notify'),
  ('seller.change_decided', 'notify'),
  ('payout_details.decided', 'notify'),
  ('payout.paid', 'notify'),
  ('fees.offers_paused', 'notify')
on conflict do nothing;

-- ── "Refund completed" only once the money moved ──

-- A refund is booked (and announced as `refund.requested`) when staff or a
-- function decide it; the money moves outside the database. The message that
-- it is done now waits for a recorded confirmation: in sandbox mode, where no
-- money moves, the refund confirms itself when its transaction commits; in
-- live mode the payment gateway work calls private.confirm_refund when the
-- gateway (or the bank, for a transfer) says the money went out. A refund
-- settled at the door moves no money and is confirmed at once, silently.
-- The register's rows never change (decision 26), so the confirmation is a
-- row of its own, written once per refund.
create table private.refund_confirmations (
  refund_id uuid primary key references private.refunds (id),
  confirmed_at timestamptz not null default now(),
  -- The gateway's or the bank's reference; 'sandbox', 'at_door' or
  -- 'before_confirmations' when no money moved or it was announced before.
  reference text not null check (char_length(reference) between 1 and 200)
);
alter table private.refund_confirmations enable row level security;
revoke all on private.refund_confirmations from public, anon, authenticated;

create trigger refund_confirmations_immutable before update or delete on private.refund_confirmations
  for each row execute function private.forbid_change();

-- Refunds booked before this migration were announced the old way already.
insert into private.refund_confirmations (refund_id, confirmed_at, reference)
select f.id, f.created_at, 'before_confirmations' from private.refunds f
on conflict do nothing;

-- Records that the money of one refund reached the shopper's side, once, and
-- announces it (`refund.completed`). For the gateway integration: call it
-- from the server-side handler of the gateway's refund confirmation (or of a
-- transfer recorded by finance), with the gateway's own reference. Calling it
-- again for the same refund does nothing and answers false.
create or replace function private.confirm_refund(p_refund_id uuid, p_reference text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  f private.refunds%rowtype;
begin
  select * into f from private.refunds where id = p_refund_id;
  if not found then
    perform private.fail('refund_not_found');
  end if;
  insert into private.refund_confirmations (refund_id, reference)
  values (p_refund_id, left(coalesce(nullif(trim(p_reference), ''), 'confirmed'), 200))
  on conflict (refund_id) do nothing;
  if not found then
    return false;
  end if;
  perform private.emit('refund.completed', jsonb_build_object(
    'order_id', f.order_id, 'refund_id', f.id, 'amount_minor', f.amount_minor, 'reason', f.reason));
  return true;
end;
$$;

-- At commit, after the refund's own `refund.requested` event, so the two
-- messages go out in that order.
create or replace function private.refund_confirm_when_nothing_moves() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.ledger_entries e
    where e.transaction_id = new.ledger_transaction_id
      and e.account_id = private.ledger_account('driver_cash')
  ) then
    -- Settled at the door: no money to send, nothing to announce.
    insert into private.refund_confirmations (refund_id, reference)
    values (new.id, 'at_door') on conflict do nothing;
  elsif private.setting('payments_mode') = '"sandbox"'::jsonb then
    perform private.confirm_refund(new.id, 'sandbox');
  end if;
  return null;
end;
$$;

create constraint trigger refunds_confirm_when_nothing_moves
  after insert on private.refunds
  deferrable initially deferred
  for each row execute function private.refund_confirm_when_nothing_moves();

-- Replaces the version in notifications without its payments part: a payment
-- marked refunded is a booking, not proof that money moved, so it no longer
-- announces `refund.completed` (the confirmation above does).
create or replace function private.emit_logistics_events() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'route_stops' then
    perform private.emit('shipment.scheduled',
      jsonb_build_object('shipment_id', new.shipment_id, 'route_id', new.route_id));
  elsif tg_table_name = 'shipments' then
    if new.status = 'out_for_delivery' and old.status is distinct from 'out_for_delivery' then
      perform private.emit('shipment.out_for_delivery', jsonb_build_object(
        'shipment_id', new.id,
        'route_id', (select rs.route_id from public.route_stops rs
                     where rs.shipment_id = new.id and rs.status in ('pending', 'arrived')
                     order by rs.id limit 1)));
    end if;
  elsif tg_table_name = 'routes' then
    if new.driver_id is not null
       and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id) then
      perform private.emit('route.assigned',
        jsonb_build_object('route_id', new.id, 'driver_id', new.driver_id));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_emit_refunded on public.payments;

-- ── The planner ──

-- Replaces the version in notifications. New: a withdrawal of the purchase
-- (approved at once) is answered with what happens next instead of "we will
-- review it"; the goods of a return are back; a delivery code locked (to the
-- shopper and the care team) and released (a NEW code is on the order page,
-- never the code); an invitation to join a shop, to the invited account only
-- (never to the address the inviter typed: the event names an account, and
-- only one whose address is confirmed is written to); a decided change of a
-- shop's details or payout account; a payout paid; offers paused by a fee
-- change.
-- The planner asks whether an account already had a given message (the
-- invitation's limit below); account deletion's cascade uses it as well.
create index if not exists notification_recipient_user_idx
  on private.notification_deliveries (recipient_user_id, template, created_at desc)
  where recipient_user_id is not null;

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
      perform private.notify_person(v_id, 'refund_initiated', v_order.user_id,
        array['email'], v_key, v_ctx);

    when 'refund.completed' then
      perform private.notify_person(v_id, 'refund_completed', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

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

-- Replaces the version in notifications, adding what the new messages need.
-- Still never the delivery code, an address, an identification number or
-- payment details (no account number, no bank reference): messages point to
-- the order page or the seller centre instead.
create or replace function private.notify_vars(p_context jsonb) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb := '{}';
  o public.orders;
  s public.shipments;
begin
  if p_context ? 'order_id' then
    select * into o from public.orders where id = (p_context ->> 'order_id')::uuid;
    if found then
      v := v || jsonb_build_object(
        'order_number', o.order_number,
        'order_status', o.status,
        'total_minor', o.total_minor,
        'payment_method', o.payment_method,
        'paid', exists (select 1 from public.payments pm
                        where pm.order_id = o.id and pm.status in ('captured', 'refunded', 'partially_refunded')),
        'promise_earliest', o.promise_earliest,
        'promise_latest', o.promise_latest,
        'withdrawal_deadline', o.withdrawal_deadline,
        'warranty_until', o.warranty_until,
        'delivered_at', o.delivered_at,
        'cancel_reason', o.cancel_reason,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('title', i.title, 'variant', i.variant_name,
                   'quantity', i.quantity, 'line_total_minor', i.line_total_minor) order by i.title)
          from public.order_items i where i.order_id = o.id), '[]'::jsonb));
    end if;
  end if;

  if p_context ? 'shipment_id' then
    select * into s from public.shipments where id = (p_context ->> 'shipment_id')::uuid;
    if found then
      v := v || jsonb_build_object(
        'tracking_code', s.tracking_code,
        'attempt_count', s.attempt_count,
        'cash_due_minor', (
          select rs.cod_amount_minor from public.route_stops rs
          where rs.shipment_id = s.id order by rs.sequence desc limit 1),
        'service_date', (
          select r.service_date from public.route_stops rs join public.routes r on r.id = rs.route_id
          where rs.shipment_id = s.id order by r.service_date desc limit 1),
        'failure_reason', (
          select rs.failure_reason from public.route_stops rs
          where rs.shipment_id = s.id and rs.status = 'failed' order by rs.completed_at desc nulls last limit 1));
    end if;
  end if;

  if p_context ? 'seller_id' then
    v := v || jsonb_build_object(
      'shop_name', (select sl.trade_name from public.sellers sl where sl.id = (p_context ->> 'seller_id')::uuid));
    if p_context ? 'order_id' then
      v := (v - 'total_minor' - 'payment_method' - 'paid') || (
        select jsonb_build_object('line_count', count(*), 'unit_count', coalesce(sum(i.quantity), 0),
                 'fulfillment', min(i.fulfillment::text),
                 'items', coalesce(jsonb_agg(jsonb_build_object('title', i.title, 'variant', i.variant_name,
                   'quantity', i.quantity, 'line_total_minor', i.line_total_minor) order by i.title), '[]'::jsonb))
        from public.order_items i
        where i.order_id = (p_context ->> 'order_id')::uuid and i.seller_id = (p_context ->> 'seller_id')::uuid);
    end if;
  end if;

  if p_context ? 'return_request_id' then
    v := v || coalesce((
      select jsonb_build_object('return_ref', upper(left(rr.id::text, 8)), 'return_kind', rr.kind,
               'return_quantity', rr.quantity, 'return_status', rr.status,
               'return_title', i.title, 'refund_due_on', rr.refund_due_on,
               'return_restocked', rr.restocked)
      from public.return_requests rr join public.order_items i on i.id = rr.order_item_id
      where rr.id = (p_context ->> 'return_request_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'complaint_id' then
    v := v || coalesce((
      select jsonb_build_object('complaint_ref', upper(left(c.id::text, 8)), 'complaint_status', c.status,
               'complaint_category', c.category, 'complaint_filed_at', c.created_at)
      from public.complaints c where c.id = (p_context ->> 'complaint_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'report_id' then
    v := v || coalesce((
      select jsonb_build_object('report_ref', upper(left(cr.id::text, 8)), 'target_type', cr.target_type,
               'report_reason', cr.reason, 'report_status', cr.status)
      from public.content_reports cr where cr.id = (p_context ->> 'report_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'product_id' then
    v := v || coalesce((
      select jsonb_build_object('product_title', pr.title, 'product_slug', pr.slug,
               'rejection_reason', pr.rejection_reason)
      from public.products pr where pr.id = (p_context ->> 'product_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'route_id' and not (p_context ? 'shipment_id') then
    v := v || coalesce((
      select jsonb_build_object('route_code', r.code, 'service_date', r.service_date,
               'stop_count', (select count(*) from public.route_stops rs where rs.route_id = r.id))
      from public.routes r where r.id = (p_context ->> 'route_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'invitation_id' then
    v := v || coalesce((
      select jsonb_build_object('invitation_role', si.role, 'invitation_expires_at', si.expires_at,
               'invitation_status', si.status)
      from public.seller_invitations si where si.id = (p_context ->> 'invitation_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'change_request_id' then
    v := v || coalesce((
      select jsonb_build_object('decision_note', cr.decision_note)
      from public.seller_change_requests cr where cr.id = (p_context ->> 'change_request_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'payout_request_id' then
    v := v || coalesce((
      select jsonb_build_object('decision_note', pr.decision_note)
      from public.payout_detail_requests pr where pr.id = (p_context ->> 'payout_request_id')::uuid), '{}'::jsonb);
  end if;

  if p_context ? 'payout_id' then
    v := v || coalesce((
      select jsonb_build_object('paid_at', po.paid_at)
      from public.payouts po where po.id = (p_context ->> 'payout_id')::uuid), '{}'::jsonb);
  end if;

  -- The offers of this shop paused by this schedule (the aliases differ from
  -- the variables o and s above: a clash makes every claim fail). The count
  -- is the shop's whole list, not what one pass of the re-check paused.
  if p_context ? 'schedule_version' and p_context ? 'seller_id' then
    v := v || coalesce((
      select jsonb_build_object(
               'paused_offers', coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'variant', x.variant_name,
                                  'min_price_minor', x.min_price_minor) order by x.title)
                                  filter (where x.rn <= 20), '[]'::jsonb),
               'paused_count', count(*))
      from (
        select pr.title, k.variant_name, b.min_price_minor,
               row_number() over (order by pr.title, b.id) as rn
        from private.fee_floor_breaches b
        join public.offers ofr on ofr.id = b.offer_id
        join public.skus k on k.id = ofr.sku_id
        join public.products pr on pr.id = k.product_id
        where b.seller_id = (p_context ->> 'seller_id')::uuid
          and b.schedule_version = p_context ->> 'schedule_version') x),
      jsonb_build_object('paused_offers', '[]'::jsonb, 'paused_count', 0));
  end if;

  return v || (p_context - 'order_id' - 'shipment_id' - 'route_id' - 'seller_id' - 'return_request_id'
                         - 'complaint_id' - 'report_id' - 'product_id' - 'invitation_id'
                         - 'change_request_id' - 'payout_request_id' - 'payout_id');
end;
$$;

-- Replaces the version in notifications. What changed: a delivery whose
-- recipient or variables cannot be worked out (an error in notify_resolve or
-- notify_vars) is set aside as a dead letter ('render_failed') instead of
-- failing the whole claim, which stopped every message for everyone.
create or replace function public.worker_notify_claim(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d private.notification_deliveries;
  v_resolved jsonb;
  v_vars jsonb;
  v_out jsonb := '[]';
begin
  perform private.require_worker();
  if coalesce(char_length(p_worker), 0) not between 1 and 100 then
    perform private.fail('worker_only');
  end if;

  -- Stale news and workers that died with attempts used up.
  update private.notification_deliveries
  set status = 'expired', locked_by = null, locked_until = null, request_body = null
  where status in ('pending', 'sending') and expires_at < now()
    and (status = 'pending' or locked_until < now());
  update private.notification_deliveries
  set status = 'dead', locked_by = null, locked_until = null, request_body = null,
      last_error_code = coalesce(last_error_code, 'lease_expired')
  where status = 'sending' and locked_until < now() and attempts >= max_attempts;

  for d in
    with picked as materialized (
      select x.id
      from private.notification_deliveries x
      where ((x.status = 'pending' and x.available_at <= now())
          or (x.status = 'sending' and x.locked_until < now()))
        and not exists (
          select 1 from private.notify_channel_pauses cp
          where cp.channel = x.channel and cp.paused_until > now())
        and not exists (
          select 1 from private.notification_deliveries e
          where e.ordering_key = x.ordering_key and e.channel = x.channel
            and e.recipient = x.recipient
            and e.sequence < x.sequence
            and e.status in ('pending', 'sending'))
      order by x.available_at, x.sequence
      limit greatest(1, least(p_limit, 100))
      for update of x skip locked)
    update private.notification_deliveries t
    set status = 'sending', attempts = t.attempts + 1, locked_by = p_worker,
        locked_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600)))
    from picked where t.id = picked.id
    returning t.*
  loop
    -- One message that cannot be written (a fault in its data or in the
    -- code that gathers it) goes to the dead letters for staff, with the
    -- error's code only; it must not stop every other message in the batch.
    begin
      v_resolved := private.notify_resolve(d);
      v_vars := private.notify_vars(d.context);
    exception when others then
      update private.notification_deliveries
      set status = 'dead', locked_by = null, locked_until = null, request_body = null,
          last_error_code = 'render_failed', last_error = 'SQLSTATE ' || sqlstate
      where id = d.id;
      continue;
    end;
    if v_resolved ? 'skip' then
      update private.notification_deliveries
      set status = 'skipped', skip_reason = v_resolved ->> 'skip', locked_by = null,
          locked_until = null, request_body = null
      where id = d.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', d.id,
      'channel', d.channel,
      'category', d.category,
      'template', d.template,
      'locale', d.locale,
      'audience', d.audience,
      'generation', d.generation,
      'attempts', d.attempts,
      'request_body', d.request_body,
      'commercial_consent', d.category <> 'marketing'
        or private.commercial_allowed(d.recipient_user_id, d.recipient_seller_id),
      'to', v_resolved -> 'to',
      'vars', v_vars));
  end loop;
  return v_out;
end;
$$;

-- ═══ 8. The network extension's grants ═════════════════════════════════════

-- pg_net (enabled by 082600 to wake the notification worker) lets visitors
-- and signed-in users use its schema `net`: call its request functions and
-- read its responses. The Data API does not expose `net`, so nobody reaches
-- it over HTTP today; this closes it for good. Only private.notify_kick calls
-- it, as the owner of our functions, which keeps its own rights, and the
-- extension's background worker does not use the API roles at all.
--
-- On a hosted project the grants may have been made by the platform's own
-- role, which `postgres` cannot revoke; the revoke then changes nothing and a
-- notice says so, and 125_followups.sql fails there until it is closed. The
-- runbook says what to check.
do $$
declare
  v_left text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    return;
  end if;
  begin
    revoke all on schema net from anon, authenticated;
    revoke all on all tables in schema net from anon, authenticated;
    revoke all on all sequences in schema net from anon, authenticated;
    revoke all on all functions in schema net from anon, authenticated;
  exception when insufficient_privilege then
    raise notice 'Could not revoke the network extension''s grants: %', sqlerrm;
  end;
  select string_agg(r || ' ' || what, ', ') into v_left
  from unnest(array['anon', 'authenticated']) r,
       lateral (select 'usage on schema net' as what where has_schema_privilege(r, 'net', 'usage')) x;
  if v_left is not null then
    raise notice 'Still granted after the revoke: %', v_left;
  end if;
end
$$;

-- ═══ Grants ═══════════════════════════════════════════════════════════════

revoke all on function
  private.scan_clean(text), private.gtin_check_digit(text), private.gtin_valid(text),
  private.upc_e_expand(text), private.scan_keys(text), private.scan_matches_sku(text, uuid),
  private.inside_service_area(double precision, double precision),
  private.check_position(double precision, double precision, double precision),
  private.action_time(timestamptz, timestamptz, timestamptz),
  private.return_quantity_within_line(), private.sync_order_status(uuid),
  private.recheck_offers_against_fees(), private.fees_changed(),
  private.confirm_refund(uuid, text), private.refund_confirm_when_nothing_moves(),
  private.emit_logistics_events(), private.notify_plan_event(private.outbox_events),
  private.notify_vars(jsonb)
from public, anon, authenticated;

revoke all on function
  public.wms_confirm_pick(uuid, integer, uuid, text),
  public.driver_arrive(uuid, timestamptz, timestamptz),
  public.driver_complete_stop(uuid, text, text, bigint, text, double precision, double precision),
  public.driver_fail_stop(uuid, text, double precision, double precision, timestamptz, timestamptz),
  public.driver_report_position(double precision, double precision, real, timestamptz, timestamptz),
  public.request_return(uuid, text, integer, text),
  public.withdraw_return_request(uuid),
  public.my_order_returns(text),
  public.ops_fee_floor_breaches()
from public, anon;

grant execute on function
  public.wms_confirm_pick(uuid, integer, uuid, text),
  public.driver_arrive(uuid, timestamptz, timestamptz),
  public.driver_complete_stop(uuid, text, text, bigint, text, double precision, double precision),
  public.driver_fail_stop(uuid, text, double precision, double precision, timestamptz, timestamptz),
  public.driver_report_position(double precision, double precision, real, timestamptz, timestamptz),
  public.request_return(uuid, text, integer, text),
  public.withdraw_return_request(uuid),
  public.my_order_returns(text),
  public.ops_fee_floor_breaches()
to authenticated;
