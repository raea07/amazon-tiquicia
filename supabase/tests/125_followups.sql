-- Follow-ups (20261121083200_followups.sql): one section per item of the
-- brief, each with the right caller, the wrong caller and hostile input, and
-- what the function leaves behind.
--
--   1. picking checks the scanned code
--   2. positions from the drivers' phones
--   3. the district of each stop
--   4. the time an offline action happened
--   5. returns: their own refusal, withdrawing a request, an order's final state
--   6. a fee schedule and the price floor
--   7. messages and the confirmation of a refund
--   8. the network extension's grants

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

create function pg_temp.logout() returns void
language sql as $$ select set_config('request.jwt.claims', '', true) $$;

-- Runs a statement that must be refused with the given code (a refusal by the
-- grants counts as 'forbidden').
create function pg_temp.refused(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception
  when insufficient_privilege then
    if p_code <> 'forbidden' then
      raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
    end if;
  when others then
    if sqlerrm <> p_code and sqlstate <> p_code then
      raise exception 'expected % but got "%" (%) for: %', p_code, sqlerrm, sqlstate, p_sql;
    end if;
end;
$$;
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.refused(text, text) to authenticated, anon;

-- ── Fixtures (as in 115_integrity.sql) ─────────────────────────────────────

create function pg_temp.shopper(p_email text, p_name text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values (gen_random_uuid(), p_email, jsonb_build_object('full_name', p_name), now()) returning id into v_id;
  insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
  select v_id, 'Casa', p_name, a.phone, a.postal_code, a.senas, a.lat, a.lng, true
  from public.addresses a join auth.users u on u.id = a.user_id
  where u.email = 'comprador@yuntera.example' and a.is_default;
  return v_id;
end;
$$;

create function pg_temp.act(p_email text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'role', 'authenticated', 'aal', 'aal2')::text, true);
end;
$$;

create function pg_temp.items(variadic p_lines text[]) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('offer_id', pg_temp.offer(split_part(l, ':', 1)),
                                      'quantity', split_part(l, ':', 2)::integer))
  from unnest(p_lines) l
$$;

create function pg_temp.place(p_email text, p_items jsonb, p_method public.payment_method, p_key text)
returns uuid
language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.act(p_email);
  v_result := public.place_order(p_items,
    (select a.id from public.addresses a join auth.users u on u.id = a.user_id
     where u.email = p_email and a.is_default and a.deleted_at is null),
    p_method, p_key);
  perform pg_temp.logout();
  return (v_result ->> 'order_id')::uuid;
end;
$$;

create function pg_temp.pay(p_order uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select user_id from public.orders where id = p_order), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.confirm_sandbox_payment(p_order);
  perform pg_temp.logout();
end;
$$;

create function pg_temp.item(p_order uuid, p_slug text) returns uuid
language sql as $$
  select i.id from public.order_items i join public.products p on p.id = i.product_id
  where i.order_id = p_order and p.slug = p_slug
$$;

create function pg_temp.shipment(p_order uuid, p_kind public.warehouse_kind) returns uuid
language sql as $$
  select s.id from public.shipments s join public.warehouses w on w.id = s.origin_warehouse_id
  where s.order_id = p_order and w.kind = p_kind order by s.created_at, s.id limit 1
$$;

create function pg_temp.pack(p_shipment uuid) returns void
language plpgsql as $$
declare
  v_kind public.warehouse_kind;
  t record;
begin
  select w.kind into v_kind from public.shipments s join public.warehouses w on w.id = s.origin_warehouse_id
  where s.id = p_shipment;
  if v_kind = 'platform' then
    perform pg_temp.act('bodega@yuntera.example');
    perform public.wms_start_picking(p_shipment);
    for t in select pt.id, pt.quantity, k.code from public.pick_tasks pt
             join public.skus k on k.id = pt.sku_id where pt.shipment_id = p_shipment loop
      perform public.wms_confirm_pick(t.id, t.quantity, null, t.code);
    end loop;
    perform public.wms_pack_shipment(p_shipment, 900, 1::smallint);
  else
    perform pg_temp.act('vendedor@yuntera.example');
    perform public.seller_mark_packed(p_shipment, 900, 1::smallint);
  end if;
  perform pg_temp.logout();
end;
$$;

create function pg_temp.route(variadic p_shipments uuid[]) returns uuid
language plpgsql as $$
declare
  v_route uuid;
begin
  perform pg_temp.act('central@yuntera.example');
  v_route := public.ops_create_route(
    private.cr_local(now())::date, (select id from public.warehouses where code = 'SJO1'),
    (select jsonb_agg(jsonb_build_object('shipment_id', s, 'sequence', n) order by n)
     from unnest(p_shipments) with ordinality as x (s, n)),
    (select d.id from public.drivers d join auth.users u on u.id = d.user_id
     where u.email = 'repartidor@yuntera.example'));
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_start_route(v_route);
  perform pg_temp.logout();
  return v_route;
end;
$$;

create function pg_temp.stop(p_route uuid, p_shipment uuid) returns uuid
language sql as $$
  select id from public.route_stops where route_id = p_route and shipment_id = p_shipment
$$;

create function pg_temp.code(p_order uuid) returns text
language sql as $$ select code from private.delivery_codes where order_id = p_order $$;

create function pg_temp.door(p_stop uuid, p_code text, p_lat double precision default null,
                             p_lng double precision default null) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.act('repartidor@yuntera.example');
  v_result := public.driver_complete_stop(p_stop, p_code, 'Recibe Prueba',
    (select cod_amount_minor from public.route_stops where id = p_stop), null, p_lat, p_lng);
  perform pg_temp.logout();
  return v_result;
end;
$$;

create function pg_temp.deliver(p_order uuid) returns void
language plpgsql as $$
declare
  v_shipments uuid[];
  v_route uuid;
  s uuid;
  v_result jsonb;
begin
  select array_agg(id order by created_at, id) into v_shipments
  from public.shipments where order_id = p_order and status = 'pending';
  foreach s in array v_shipments loop
    perform pg_temp.pack(s);
  end loop;
  v_route := pg_temp.route(variadic v_shipments);
  foreach s in array v_shipments loop
    v_result := pg_temp.door(pg_temp.stop(v_route, s), pg_temp.code(p_order));
    if not (v_result ->> 'ok')::boolean then
      raise exception 'delivery failed: %', v_result;
    end if;
  end loop;
end;
$$;

grant execute on function pg_temp.remember(text, text), pg_temp.offer(text, text),
  pg_temp.item(uuid, text) to authenticated;

select pg_temp.shopper('seguimiento1@yuntera.example', 'Prueba Seguimiento Uno');
select pg_temp.shopper('seguimiento2@yuntera.example', 'Prueba Seguimiento Dos');
select pg_temp.shopper('seguimiento3@yuntera.example', 'Prueba Seguimiento Tres');

-- ═══ 1. Picking checks the scanned code ════════════════════════════════════

-- The same table runs through packages/core/src/scan-codes.ts
-- (scan-codes.test.ts compares the two tables).
create temporary table scan_cases on commit drop as
select c ->> 0 as raw, array(select jsonb_array_elements_text(c -> 1)) as keys
from jsonb_array_elements(
-- BEGIN scan_code_cases
$json$[
  ["  yt-ab12cd34  ", ["YT-AB12CD34"]],
  ["YT-AB12CD34\r\n", ["YT-AB12CD34"]],
  ["yt-ab12 cd34", ["YT-AB12CD34"]],
  ["036000291452", ["00036000291452"]],
  ["0036000291452", ["00036000291452"]],
  ["00036000291452", ["00036000291452"]],
  [" 036000291452\t", ["00036000291452"]],
  ["]E00036000291452", ["00036000291452"]],
  ["(01)00036000291452(17)271231", ["00036000291452"]],
  ["]C10100036000291452\u001d10LOTE7", ["00036000291452"]],
  ["0100036000291452", ["0100036000291452"]],
  ["04252614", ["00000004252614", "00042100005264"]],
  ["96385074", ["00000096385074"]],
  ["0123456789012345678", ["0123456789012345678"]],
  ["'; drop table skus; --", ["';DROPTABLESKUS;--"]],
  ["", []],
  [" \r\n\t", []]
]$json$
-- END scan_code_cases
::jsonb) c;

do $$
declare
  c record;
begin
  for c in select * from scan_cases loop
    assert private.scan_keys(c.raw) = c.keys,
      format('pick_scan_parity: %s gave %s, expected %s', to_jsonb(c.raw), private.scan_keys(c.raw), c.keys);
  end loop;
end
$$;

-- A platform order to pick; the notebook gets a 12-digit barcode for the test.
update public.skus set gtin = '036000291452'
where id = (select k.id from public.skus k join public.products p on p.id = k.product_id
            where p.slug = 'libreta-tapa-dura-a5');
select pg_temp.remember('pick_order', pg_temp.place('seguimiento1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2', 'botella-termica-sendero-750ml:1'), 'card', 'seg-pick-0001')::text);
select pg_temp.pay(current_setting('t.pick_order')::uuid);
do $$
declare
  v_ship uuid := pg_temp.shipment(current_setting('t.pick_order')::uuid, 'platform');
  v_libreta uuid;
  v_botella uuid;
  v_bin integer;
begin
  perform pg_temp.remember('pick_ship', v_ship::text);
  perform pg_temp.act('bodega@yuntera.example');
  perform public.wms_start_picking(v_ship);
  select pt.id into v_libreta from public.pick_tasks pt join public.skus k on k.id = pt.sku_id
  where pt.shipment_id = v_ship and k.gtin = '036000291452';
  select pt.id into v_botella from public.pick_tasks pt
  where pt.shipment_id = v_ship and pt.id <> v_libreta;
  perform pg_temp.remember('pick_libreta', v_libreta::text);
  perform pg_temp.remember('pick_botella', v_botella::text);
  select sum(b.quantity) into v_bin from public.bin_stock b join public.pick_tasks pt
    on pt.sku_id = b.sku_id and pt.seller_id = b.seller_id where pt.id = v_libreta;
  perform pg_temp.remember('pick_bin', v_bin::text);
  perform pg_temp.logout();
end
$$;

-- pick_wrong_caller: a shopper and the driver may not pick.
select pg_temp.act('seguimiento1@yuntera.example');
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1, null, %L)',
  current_setting('t.pick_libreta'), '036000291452'), 'forbidden');
select pg_temp.act('repartidor@yuntera.example');
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1, null, %L)',
  current_setting('t.pick_libreta'), '036000291452'), 'forbidden');
select pg_temp.logout();
-- A visitor has no grant at all.
select pg_temp.login_anon();
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1)', current_setting('t.pick_libreta')),
  'forbidden');
reset role;

-- pick_hostile_input: no code, an empty or huge one, another product's code,
-- an injection attempt. Each is refused with its own code and leaves the line
-- and the shelf as they were.
select pg_temp.act('bodega@yuntera.example');
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1)', current_setting('t.pick_libreta')),
  'scan_required');
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1, null, %L)',
  current_setting('t.pick_libreta'), E' \t\r\n'), 'scan_required');
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1, null, %L)',
  current_setting('t.pick_libreta'), repeat('7', 5000)), 'scan_required');
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1, null, %L)',
  current_setting('t.pick_libreta'), (select k.code from public.skus k join public.products p on p.id = k.product_id
                                      where p.slug = 'botella-termica-sendero-750ml')), 'scanned_wrong_item');
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1, null, %L)',
  current_setting('t.pick_libreta'), '''; update public.pick_tasks set status = ''done''; --'), 'scanned_wrong_item');
-- A wrong check digit is another number, not this product.
select pg_temp.refused(format('select public.wms_confirm_pick(%L, 1, null, %L)',
  current_setting('t.pick_libreta'), '036000291453'), 'scanned_wrong_item');
do $$
begin
  assert (select picked_quantity = 0 and status = 'in_progress' from public.pick_tasks
          where id = current_setting('t.pick_libreta')::uuid), 'pick_hostile_input: the line is untouched';
  assert (select sum(b.quantity) from public.bin_stock b join public.pick_tasks pt
            on pt.sku_id = b.sku_id and pt.seller_id = b.seller_id
          where pt.id = current_setting('t.pick_libreta')::uuid) = current_setting('t.pick_bin')::integer,
    'pick_hostile_input: the shelf is untouched';
end
$$;

-- pick_right_caller: the barcode as a 13-digit EAN with spaces counts for the
-- 12-digit one on file, one unit at a time; the stock code typed in lower case
-- counts too; a line left short needs no scan.
select public.wms_confirm_pick(current_setting('t.pick_libreta')::uuid, 1, null, ' 0036000291452 ');
select public.wms_confirm_pick(current_setting('t.pick_libreta')::uuid, 2, null, '(01)00036000291452');
select public.wms_confirm_pick(current_setting('t.pick_botella')::uuid, 0);
select public.wms_confirm_pick(current_setting('t.pick_botella')::uuid, 1, null,
  lower((select k.code from public.skus k join public.pick_tasks pt on pt.sku_id = k.id
         where pt.id = current_setting('t.pick_botella')::uuid)));
select pg_temp.logout();
do $$
begin
  assert (select picked_quantity = 2 and status = 'done' from public.pick_tasks
          where id = current_setting('t.pick_libreta')::uuid), 'pick_right_caller: barcode spellings accepted';
  assert (select picked_quantity = 1 and status = 'done' from public.pick_tasks
          where id = current_setting('t.pick_botella')::uuid), 'pick_right_caller: stock code in lower case';
  assert (select sum(b.quantity) from public.bin_stock b join public.pick_tasks pt
            on pt.sku_id = b.sku_id and pt.seller_id = b.seller_id
          where pt.id = current_setting('t.pick_libreta')::uuid) = current_setting('t.pick_bin')::integer - 2,
    'pick_right_caller: two units left the shelf';
  assert (select count(*) from public.stock_movements
          where reference_id = current_setting('t.pick_ship')::uuid and reason = 'pick') = 3,
    'pick_right_caller: one movement per confirmation that took units';
end
$$;

-- ═══ 2, 3 and 4. A route for the drivers' tests ══════════════════════════

-- Three parcels of three orders, on a route started two hours ago.
select pg_temp.remember('drv1', pg_temp.place('seguimiento1@yuntera.example',
  pg_temp.items('rompecabezas-volcanes-500:1'), 'card', 'seg-drv-0001')::text);
select pg_temp.remember('drv2', pg_temp.place('seguimiento1@yuntera.example',
  pg_temp.items('balon-futbol-sendero-5:1'), 'card', 'seg-drv-0002')::text);
select pg_temp.remember('drv3', pg_temp.place('seguimiento2@yuntera.example',
  pg_temp.items('hamaca-algodon-doble:1'), 'card', 'seg-drv-0003')::text);
select pg_temp.pay(current_setting('t.drv1')::uuid);
select pg_temp.pay(current_setting('t.drv2')::uuid);
select pg_temp.pay(current_setting('t.drv3')::uuid);
select pg_temp.pack(pg_temp.shipment(current_setting('t.drv1')::uuid, 'platform'));
select pg_temp.pack(pg_temp.shipment(current_setting('t.drv2')::uuid, 'platform'));
select pg_temp.pack(pg_temp.shipment(current_setting('t.drv3')::uuid, 'platform'));
select pg_temp.remember('drv_route', pg_temp.route(
  pg_temp.shipment(current_setting('t.drv1')::uuid, 'platform'),
  pg_temp.shipment(current_setting('t.drv2')::uuid, 'platform'),
  pg_temp.shipment(current_setting('t.drv3')::uuid, 'platform'))::text);
update public.routes set started_at = now() - interval '2 hours'
where id = current_setting('t.drv_route')::uuid;
select pg_temp.remember('stop1', pg_temp.stop(current_setting('t.drv_route')::uuid,
  pg_temp.shipment(current_setting('t.drv1')::uuid, 'platform'))::text);
select pg_temp.remember('stop2', pg_temp.stop(current_setting('t.drv_route')::uuid,
  pg_temp.shipment(current_setting('t.drv2')::uuid, 'platform'))::text);
select pg_temp.remember('stop3', pg_temp.stop(current_setting('t.drv_route')::uuid,
  pg_temp.shipment(current_setting('t.drv3')::uuid, 'platform'))::text);

-- ═══ 2. Positions from the drivers' phones ═════════════════════════════════

-- position_hostile_input: not a number, infinite, off the globe, half a pair,
-- a negative accuracy: refused with a code, never a raw database error.
select pg_temp.act('repartidor@yuntera.example');
select pg_temp.refused('select public.driver_report_position(''NaN''::float8, -84.05)', 'invalid_position');
select pg_temp.refused('select public.driver_report_position(9.93, ''Infinity''::float8)', 'invalid_position');
select pg_temp.refused('select public.driver_report_position(''-Infinity''::float8, -84.05)', 'invalid_position');
select pg_temp.refused('select public.driver_report_position(91, -84.05)', 'invalid_position');
select pg_temp.refused('select public.driver_report_position(9.93, -181)', 'invalid_position');
select pg_temp.refused('select public.driver_report_position(null, -84.05)', 'invalid_position');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, -5)', 'invalid_position');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, ''NaN''::real)', 'invalid_position');
-- A real place far from Costa Rica, and "null island": refused with their own
-- code (they used to answer the table's raw check error), and not stored.
select pg_temp.refused('select public.driver_report_position(40.4168, -3.7038)', 'position_outside_area');
select pg_temp.refused('select public.driver_report_position(0, 0)', 'position_outside_area');
select pg_temp.refused(format('select public.driver_complete_stop(%L, %L, ''Ana'', 0, null, ''NaN''::float8, -84.05)',
  current_setting('t.stop1'), pg_temp.code(current_setting('t.drv1')::uuid)), 'invalid_position');
select pg_temp.refused(format('select public.driver_fail_stop(%L, ''nobody_home'', 9.93, null)',
  current_setting('t.stop2')), 'invalid_position');
select pg_temp.logout();
do $$
begin
  assert not exists (select 1 from public.driver_positions dp join public.drivers d on d.id = dp.driver_id
                     join auth.users u on u.id = d.user_id
                     where u.email = 'repartidor@yuntera.example' and dp.lat > 30),
    'position_hostile_input: nothing from far away was stored';
  assert (select status = 'pending' from public.route_stops where id = current_setting('t.stop1')::uuid),
    'position_hostile_input: the delivery was not recorded with a broken position';
end
$$;

-- position_wrong_caller: a shopper is not a driver.
select pg_temp.act('seguimiento1@yuntera.example');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05)', 'forbidden');
select pg_temp.logout();

-- position_right_caller: inside the country, stored; a delivery whose phone
-- puts it in Madrid is still recorded (the code proves it), with the place
-- kept and flagged for staff.
select pg_temp.act('repartidor@yuntera.example');
select public.driver_report_position(9.9325, -84.0796, 12);
select pg_temp.door(current_setting('t.stop1')::uuid, pg_temp.code(current_setting('t.drv1')::uuid),
  40.4168, -3.7038) ->> 'ok' as position_flagged_delivery;
do $$
begin
  assert (select dp.lat = 9.9325 and dp.received_at is not null from public.driver_positions dp
          join public.drivers d on d.id = dp.driver_id join auth.users u on u.id = d.user_id
          where u.email = 'repartidor@yuntera.example'), 'position_right_caller: stored';
  assert (select status = 'delivered' and pod_outside_area and pod_lat = 40.4168
          from public.route_stops where id = current_setting('t.stop1')::uuid),
    'position_right_caller: delivered, the far position kept and flagged';
end
$$;

-- ═══ 3. The district of each stop ══════════════════════════════════════════

do $$
declare
  v_day jsonb;
  s jsonb;
begin
  perform pg_temp.act('repartidor@yuntera.example');
  v_day := public.driver_today();
  for s in
    select x from jsonb_array_elements(v_day -> 'routes') r, jsonb_array_elements(r -> 'stops') x
    where r ->> 'route_id' = current_setting('t.drv_route')
  loop
    assert s ->> 'district' = (
      select d.name from public.route_stops rs join public.shipments sh on sh.id = rs.shipment_id
      join public.orders o on o.id = sh.order_id join public.districts d on d.postal_code = o.ship_postal_code
      where rs.id = (s ->> 'stop_id')::uuid), format('stop_district_right_caller: %s', s);
    assert s ->> 'canton' = (
      select c.name from public.route_stops rs join public.shipments sh on sh.id = rs.shipment_id
      join public.orders o on o.id = sh.order_id join public.districts d on d.postal_code = o.ship_postal_code
      join public.cantons c on c.code = d.canton_code
      where rs.id = (s ->> 'stop_id')::uuid), format('stop_district_right_caller: canton %s', s);
    -- Nothing more than before about the shopper: no postal code, no order.
    assert not (s ? 'ship_postal_code' or s ? 'order_number' or s ? 'delivery_pin'),
      'stop_district_right_caller: nothing else added';
  end loop;
  perform pg_temp.logout();
end
$$;
-- stop_district_names: the joining words of the names are in lower case.
do $$
begin
  assert (select name from public.cantons where code = '115') = 'Montes de Oca', 'stop_district_names: canton';
  assert (select name from public.districts where postal_code = '60110') = 'Isla del Coco', 'stop_district_names: district';
  assert not exists (select 1 from public.cantons where name ~ ' (De|Del|Y) ')
     and not exists (select 1 from public.districts where name ~ ' (De|Del|Y) '),
    'stop_district_names: none left';
end
$$;
-- stop_district_wrong_caller: a shopper gets no driver's day.
select pg_temp.act('seguimiento1@yuntera.example');
select pg_temp.refused('select public.driver_today()', 'not_a_driver');
select pg_temp.logout();
-- A suspended driver still sees no route (the gate of 083000 is in front).
do $$
declare
  v_day jsonb;
begin
  update public.drivers set status = 'suspended'
  where user_id = (select id from auth.users where email = 'repartidor@yuntera.example');
  perform pg_temp.act('repartidor@yuntera.example');
  v_day := public.driver_today();
  assert jsonb_array_length(v_day -> 'routes') = 0, 'stop_district_wrong_caller: suspended, no routes';
  perform pg_temp.logout();
  raise exception 'undo' using errcode = 'P0002';
exception when sqlstate 'P0002' then
  null; -- the suspension (and the routes it released) is rolled back
end
$$;

-- ═══ 4. The time an offline action happened ════════════════════════════════

-- action_time_hostile_input: from the future, from long ago, infinite.
select pg_temp.act('repartidor@yuntera.example');
select pg_temp.refused(format('select public.driver_arrive(%L, now() + interval ''1 hour'')',
  current_setting('t.stop2')), 'action_time_in_future');
select pg_temp.refused(format('select public.driver_arrive(%L, ''infinity''::timestamptz)',
  current_setting('t.stop2')), 'action_time_in_future');
select pg_temp.refused(format('select public.driver_arrive(%L, now() - interval ''25 hours'')',
  current_setting('t.stop2')), 'action_time_too_old');
select pg_temp.refused(format('select public.driver_fail_stop(%L, ''nobody_home'', null, null, ''-infinity''::timestamptz)',
  current_setting('t.stop2')), 'action_time_too_old');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, 10, now() + interval ''10 minutes'')',
  'action_time_in_future');
select pg_temp.logout();

-- action_time_wrong_caller: a shopper cannot arrive at someone's stop.
select pg_temp.act('seguimiento2@yuntera.example');
select pg_temp.refused(format('select public.driver_arrive(%L)', current_setting('t.stop3')), 'stop_not_found');
select pg_temp.refused(format('select public.driver_fail_stop(%L, ''nobody_home'')', current_setting('t.stop3')),
  'stop_not_found');
select pg_temp.logout();

-- action_time_right_caller: an arrival 90 minutes ago and a failure an hour
-- ago, sent now from a dead zone. Each is stamped with when it happened, the
-- time it was received is kept, and the shopper's history shows the failure
-- at its time. A phone clock a minute fast counts as now; an arrival "before"
-- the route started is moved up to the start.
select pg_temp.act('repartidor@yuntera.example');
select public.driver_arrive(current_setting('t.stop2')::uuid, now() - interval '90 minutes');
select public.driver_fail_stop(current_setting('t.stop2')::uuid, 'nobody_home', 9.9325, -84.0796,
  now() - interval '60 minutes') ->> 'ok' as failed_offline;
select public.driver_arrive(current_setting('t.stop3')::uuid, now() - interval '3 hours');
select pg_temp.logout();
do $$
begin
  assert (select arrived_at = now() - interval '90 minutes' and arrived_received_at = now()
                 and completed_at = now() - interval '60 minutes' and completed_received_at = now()
                 and not pod_outside_area
          from public.route_stops where id = current_setting('t.stop2')::uuid),
    'action_time_right_caller: happened and received both kept';
  assert (select e.created_at = now() - interval '60 minutes' from public.order_events e
          where e.shipment_id = pg_temp.shipment(current_setting('t.drv2')::uuid, 'platform')
            and e.to_status = 'delivery_failed'),
    'action_time_right_caller: the history shows when it happened';
  assert (select arrived_at = r.started_at from public.route_stops rs join public.routes r on r.id = rs.route_id
          where rs.id = current_setting('t.stop3')::uuid),
    'action_time_right_caller: not before the route started';
  assert (select (payload ->> 'occurred_at')::timestamptz = now() - interval '60 minutes'
          from private.outbox_events where topic = 'shipment.delivery_failed'
            and payload ->> 'shipment_id' = pg_temp.shipment(current_setting('t.drv2')::uuid, 'platform')::text),
    'action_time_right_caller: the event says when';
end
$$;
-- A position read earlier than the one on file never overwrites it; one a
-- minute ahead of the database's clock counts as now.
select pg_temp.act('repartidor@yuntera.example');
select public.driver_report_position(9.95, -84.10, 10, now() - interval '3 minutes');
select public.driver_report_position(9.96, -84.11, 10, now() + interval '1 minute');
select pg_temp.logout();
do $$
begin
  assert (select dp.lat = 9.96 and dp.recorded_at = now() from public.driver_positions dp
          join public.drivers d on d.id = dp.driver_id join auth.users u on u.id = d.user_id
          where u.email = 'repartidor@yuntera.example'),
    'action_time_right_caller: the newest position stays, a fast clock counts as now';
end
$$;

-- action_time_clock_skew: the app sends the phone's clock at sending with the
-- time of the action, and only the difference counts. A phone an hour fast
-- that held an action ten minutes is recorded ten minutes ago, not refused.
do $$
begin
  assert private.action_time(now() + interval '50 minutes', null, now() + interval '1 hour')
         = now() - interval '10 minutes', 'action_time_clock_skew: an hour fast';
  assert private.action_time(now() - interval '3 hours 5 minutes', null, now() - interval '3 hours')
         = now() - interval '5 minutes', 'action_time_clock_skew: three hours slow';
  -- Still bounded: never after it was sent, never more than a day held.
  assert private.action_time(now() - interval '2 hours', now() - interval '1 minute', now())
         = now() - interval '1 minute', 'action_time_clock_skew: not before what it follows';
end
$$;
-- action_time_clock_skew_hostile_input: an action after its own sending, held
-- more than a day, or an infinite sending time.
select pg_temp.act('repartidor@yuntera.example');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, 10, now(), now() - interval ''1 second'')',
  'action_time_in_future');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, 10, now() + interval ''5 days'', now() + interval ''6 days 1 second'')',
  'action_time_too_old');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, 10, now(), ''infinity''::timestamptz)',
  'action_time_in_future');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, 10, now(), ''-infinity''::timestamptz)',
  'action_time_in_future');
select pg_temp.logout();
-- action_time_clock_skew_wrong_caller: a shopper still cannot report one.
select pg_temp.act('seguimiento1@yuntera.example');
select pg_temp.refused('select public.driver_report_position(9.93, -84.05, 10, now(), now())', 'forbidden');
select pg_temp.logout();

-- position_older_after_newer: a position read now, then one the queue sends
-- late (read ten minutes ago, from a phone an hour fast): the newer stays.
select pg_temp.act('repartidor@yuntera.example');
select public.driver_report_position(9.97, -84.12, 10, now());
select public.driver_report_position(9.98, -84.13, 10, now() + interval '50 minutes', now() + interval '1 hour');
select pg_temp.logout();
do $$
begin
  assert (select dp.lat = 9.97 and dp.recorded_at = now() from public.driver_positions dp
          join public.drivers d on d.id = dp.driver_id join auth.users u on u.id = d.user_id
          where u.email = 'repartidor@yuntera.example'),
    'position_older_after_newer: an older position does not overwrite a newer one';
end
$$;

-- position_flag_on_board: Central's dispatch board shows the flag of the stop
-- delivered "in Madrid", and when the server received each closing.
select pg_temp.act('central@yuntera.example');
do $$
declare
  v_stop jsonb := (select x from jsonb_array_elements(public.ops_dispatch_board() -> 'routes') r,
                   jsonb_array_elements(r -> 'stops') x
                   where x ->> 'stop_id' = current_setting('t.stop1'));
begin
  assert (v_stop ->> 'pod_outside_area')::boolean and v_stop ? 'completed_received_at',
    format('position_flag_on_board: %s', v_stop);
end
$$;
select pg_temp.logout();

-- ═══ 5. Returns ════════════════════════════════════════════════════════════

-- A two-unit line delivered to seguimiento1.
select pg_temp.remember('ret', pg_temp.place('seguimiento1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'seg-ret-0001')::text);
select pg_temp.pay(current_setting('t.ret')::uuid);
select pg_temp.deliver(current_setting('t.ret')::uuid);
select pg_temp.remember('ret_item', pg_temp.item(current_setting('t.ret')::uuid, 'libreta-tapa-dura-a5')::text);
select pg_temp.remember('ret_number', (select order_number from public.orders where id = current_setting('t.ret')::uuid));

-- return_second_request: a claim for both units, then any more is refused
-- with its own code (it used to answer the cart's `invalid_quantity`).
select pg_temp.login('seguimiento1@yuntera.example');
select pg_temp.remember('ret_claim', public.request_return(current_setting('t.ret_item')::uuid, 'damaged', 2,
  'La tapa llegó doblada y rota.')::text);
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 1)', current_setting('t.ret_item')),
  'units_already_in_return');
-- return_hostile_input: more than were received, none, a negative number.
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 3)', current_setting('t.ret_item')),
  'return_more_than_received');
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 0)', current_setting('t.ret_item')),
  'invalid_quantity');
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', -2)', current_setting('t.ret_item')),
  'invalid_quantity');
-- A quantity at the top of the integer range answers with its code, not an
-- overflow (the sum with the units already in a return used to overflow).
select pg_temp.refused(format('select public.request_return(%L, ''damaged'', 2147483647, ''Llegó roto el empaque y la tapa'')',
  current_setting('t.ret_item')), 'return_more_than_received');
reset role;

-- return_withdraw_wrong_caller: another shopper, a visitor, a made-up id.
select pg_temp.login('seguimiento2@yuntera.example');
select pg_temp.refused(format('select public.withdraw_return_request(%L)', current_setting('t.ret_claim')),
  'return_not_found');
select pg_temp.refused('select public.withdraw_return_request(gen_random_uuid())', 'return_not_found');
select pg_temp.refused('select public.withdraw_return_request(null)', 'return_not_found');
reset role;
select pg_temp.login_anon();
select pg_temp.refused(format('select public.withdraw_return_request(%L)', current_setting('t.ret_claim')),
  'forbidden');
reset role;
-- Staff cannot withdraw it for the shopper either: they decide it instead.
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.withdraw_return_request(%L)', current_setting('t.ret_claim')),
  'return_not_found');
reset role;

-- return_withdraw_right_caller: the shopper withdraws the claim; it is
-- closed as theirs, its units are free again, and withdrawing an approved
-- return is refused.
select pg_temp.login('seguimiento1@yuntera.example');
select public.withdraw_return_request(current_setting('t.ret_claim')::uuid) ->> 'status' as withdrawn;
-- return_withdraw_twice: a second withdrawal (a second tab, a double submit)
-- says the same again instead of "we already reviewed it", and changes nothing.
select pg_temp.remember('ret_wd_again', public.withdraw_return_request(current_setting('t.ret_claim')::uuid)::text);
do $$
declare
  v_list jsonb := public.my_order_returns(current_setting('t.ret_number'));
begin
  assert jsonb_array_length(v_list) = 1
     and v_list #>> '{0,status}' = 'rejected' and v_list #>> '{0,withdrawn_at}' is not null
     and (v_list #> '{0,can_withdraw}')::boolean = false
     and v_list #>> '{0,resolution_note}' = 'Usted retiró esta solicitud.',
    format('return_withdraw_right_caller: %s', v_list);
end
$$;
select pg_temp.remember('ret_wd', public.request_return(current_setting('t.ret_item')::uuid, 'withdrawal', 1)::text);
select pg_temp.refused(format('select public.withdraw_return_request(%L)', current_setting('t.ret_wd')),
  'return_not_withdrawable');
reset role;
do $$
begin
  assert (select status = 'rejected' and withdrawn_at is not null and decided_by is null
          from public.return_requests where id = current_setting('t.ret_claim')::uuid),
    'return_withdraw_right_caller: closed as the shopper''s own doing';
  assert exists (select 1 from private.outbox_events where topic = 'return.withdrawn'
                 and payload ->> 'return_request_id' = current_setting('t.ret_claim')),
    'return_withdraw_right_caller: announced';
  assert exists (select 1 from public.order_events where order_id = current_setting('t.ret')::uuid
                 and note like 'Retiró su solicitud de devolución%'),
    'return_withdraw_right_caller: in the history';
  assert current_setting('t.ret_wd_again')::jsonb ->> 'status' = 'rejected'
     and (current_setting('t.ret_wd_again')::jsonb ->> 'withdrawn_at')::timestamptz
         = (select withdrawn_at from public.return_requests where id = current_setting('t.ret_claim')::uuid),
    format('return_withdraw_twice: %s', current_setting('t.ret_wd_again'));
  assert (select count(*) from public.order_events where order_id = current_setting('t.ret')::uuid
          and note like 'Retiró su solicitud de devolución%') = 1, 'return_withdraw_twice: written once';
  assert (select count(*) from private.outbox_events where topic = 'return.withdrawn'
          and payload ->> 'return_request_id' = current_setting('t.ret_claim')) = 1,
    'return_withdraw_twice: announced once';
end
$$;

-- order_final_state: one parcel delivered (the notebook, from the warehouse),
-- the other (the bulbs, from the seller) fails and comes back. The order is
-- then delivered, not "shipped" for ever; the shopper's account can be
-- deleted as far as orders go; and the seller payouts are decided as before.
select pg_temp.remember('fin', pg_temp.place('seguimiento3@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1', 'bombillo-led-9w-4u:1'), 'card', 'seg-fin-0001')::text);
select pg_temp.pay(current_setting('t.fin')::uuid);
do $$
declare
  v_order uuid := current_setting('t.fin')::uuid;
  v_platform uuid := pg_temp.shipment(v_order, 'platform');
  v_seller uuid := pg_temp.shipment(v_order, 'seller');
  v_route uuid;
  v_result jsonb;
  v_settled_before timestamptz;
begin
  perform pg_temp.pack(v_platform);
  perform pg_temp.pack(v_seller);
  v_route := pg_temp.route(v_platform, v_seller);
  v_result := pg_temp.door(pg_temp.stop(v_route, v_platform), pg_temp.code(v_order));
  assert (v_result ->> 'ok')::boolean, format('order_final_state: delivered %s', v_result);
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_seller), 'nobody_home');
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_seller);
  assert (select status = 'shipped' from public.orders where id = v_order),
    'order_final_state: still on its way back, still shipped';
  assert 'account_has_open_orders' = any (private.account_deletion_blockers(
    (select id from auth.users where email = 'seguimiento3@yuntera.example'))),
    'order_final_state: open while a parcel is on its way back';
  perform pg_temp.act('vendedor@yuntera.example');
  v_result := public.wms_receive_returned_shipment(v_seller, true, null);
  perform pg_temp.logout();
  assert v_result ->> 'order_status' = 'delivered', format('order_final_state: %s', v_result);
  assert (select delivered_at is not null and withdrawal_deadline >= private.cr_local(now())::date
          from public.orders where id = v_order), 'order_final_state: dated, with its withdrawal window';
  assert not ('account_has_open_orders' = any (private.account_deletion_blockers(
    (select id from auth.users where email = 'seguimiento3@yuntera.example')))),
    'order_final_state: no longer blocks deleting the account';
  -- Payouts: each seller's share is settled when that seller's own parcels ended.
  assert private.seller_order_settled_at(v_order, (select seller_id from public.order_items
           where id = pg_temp.item(v_order, 'libreta-tapa-dura-a5')))
         = (select delivered_at from public.shipments where id = v_platform),
    'order_final_state: the warehouse parcel''s seller from its delivery';
  assert private.seller_order_settled_at(v_order, (select seller_id from public.order_items
           where id = pg_temp.item(v_order, 'bombillo-led-9w-4u')))
         = (select updated_at from public.shipments where id = v_seller),
    'order_final_state: the returned parcel''s seller from its check-in';
end
$$;

-- ═══ 6. A fee schedule and the price floor ════════════════════════════════

-- fee_floor_right_caller: a schedule with a much higher commission is
-- switched on. Offers it leaves below the floor are paused, recorded, listed
-- for finance and catalogue staff, and their shops are told once each.
do $$
declare
  v_old text := (select version from public.fee_schedules where active);
  v_paused integer;
begin
  perform pg_temp.remember('fee_old', v_old);
  perform pg_temp.remember('fee_event', (select coalesce(max(id), 0) from private.outbox_events)::text);
  insert into public.fee_schedules
    (version, active, default_referral_bps, min_referral_fee_per_unit_minor, fee_tax_bps, effective_from, notes)
  -- A minimum commission of ₡5 000 a unit: cheap products can no longer pay it.
  select '2026-12-test', false, 4500, 500000, fee_tax_bps, '2026-12-01', 'test'
  from public.fee_schedules where version = v_old;
  insert into public.fee_payment_methods (schedule_version, method, bps, fixed_minor)
  select '2026-12-test', method, bps, fixed_minor from public.fee_payment_methods where schedule_version = v_old;
  insert into public.fee_fulfillment_tiers (schedule_version, id, max_weight_grams, max_longest_side_cm, fee_minor, sort)
  select '2026-12-test', id, max_weight_grams, max_longest_side_cm, fee_minor, sort
  from public.fee_fulfillment_tiers where schedule_version = v_old;
  -- Categories with their own commission keep it; for the test, none does.
  update public.categories set referral_bps = null where referral_bps is not null;
  assert not exists (select 1 from private.fee_floor_breaches), 'fee_floor: nothing paused before';
  update public.fee_schedules set active = false where version = v_old;
  update public.fee_schedules set active = true where version = '2026-12-test';
  select count(*) into v_paused from private.fee_floor_breaches where schedule_version = '2026-12-test';
  assert v_paused > 0, 'fee_floor_right_caller: some offers fell below the floor';
  assert not exists (
    select 1 from private.fee_floor_breaches b join public.offers o on o.id = b.offer_id
    where b.schedule_version = '2026-12-test' and o.status <> 'paused'), 'fee_floor_right_caller: paused';
  assert not exists (
    select 1 from public.offers o join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
    where o.status = 'active'
      and private.worst_unit_payout(o.price_minor, o.fulfillment, p.category_id, k.weight_grams,
                                    greatest(k.length_cm, k.width_cm, k.height_cm)) < 0),
    'fee_floor_right_caller: nothing on sale is below the floor';
  assert (select count(*) from private.outbox_events where topic = 'fees.offers_paused'
          and id > current_setting('t.fee_event')::bigint)
         = (select count(distinct seller_id) from private.fee_floor_breaches where schedule_version = '2026-12-test'),
    'fee_floor_right_caller: one message per shop';
  perform pg_temp.remember('fee_offer', (select b.offer_id from private.fee_floor_breaches b
    join public.offers o on o.id = b.offer_id join public.sellers s on s.id = o.seller_id
    where s.trade_name in ('TecnoCasa', 'Ferretería El Higuerón') order by b.id limit 1)::text);
  perform pg_temp.remember('fee_min', (select min_price_minor from private.fee_floor_breaches
    where offer_id = current_setting('t.fee_offer')::uuid)::text);
end
$$;
select pg_temp.login('central@yuntera.example');
select jsonb_array_length(public.ops_fee_floor_breaches()) > 0 as fee_floor_listed;
do $$
declare
  v_row jsonb := (select x from jsonb_array_elements(public.ops_fee_floor_breaches()) x
                  where x ->> 'offer_id' = current_setting('t.fee_offer'));
begin
  assert v_row ->> 'shop_name' = (select s.trade_name from public.offers o join public.sellers s on s.id = o.seller_id
                                   where o.id = current_setting('t.fee_offer')::uuid) and (v_row ->> 'min_price_minor')::bigint
         > (v_row ->> 'price_minor')::bigint and v_row ->> 'schedule_version' = '2026-12-test',
    format('fee_floor_right_caller: the list says what to charge %s', v_row);
end
$$;
reset role;
-- fee_floor_wrong_caller: a shopper and a seller do not read staff's list.
select pg_temp.login('seguimiento1@yuntera.example');
select pg_temp.refused('select public.ops_fee_floor_breaches()', 'forbidden');
reset role;
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused('select public.ops_fee_floor_breaches()', 'forbidden');
-- fee_floor_hostile_input: putting it back on sale at the old price is
-- refused by the floor; at the price the list gives, it sells again and
-- leaves the list.
select pg_temp.refused(format('select public.seller_update_offer(%L, %s, ''active'')',
  current_setting('t.fee_offer'), (select price_minor from public.offers where id = current_setting('t.fee_offer')::uuid)),
  'price_below_fees');
select public.seller_update_offer(current_setting('t.fee_offer')::uuid,
  ((current_setting('t.fee_min')::bigint + 99) / 100) * 100, 'active');
reset role;
select pg_temp.login('central@yuntera.example');
select not exists (select 1 from jsonb_array_elements(public.ops_fee_floor_breaches()) x
                   where x ->> 'offer_id' = current_setting('t.fee_offer')) as fee_floor_resolved;
reset role;
do $$
begin
  assert (select status = 'active' from public.offers where id = current_setting('t.fee_offer')::uuid),
    'fee_floor_hostile_input: back on sale at a price that covers the fees';
  -- Back to the real schedule for the rest of the suite (rolled back anyway).
  update public.fee_schedules set active = false where version = '2026-12-test';
  update public.fee_schedules set active = true where version = current_setting('t.fee_old');
end
$$;

-- fee_floor_active_amounts: raising the active schedule's own amounts (how a
-- migration would raise commissions) re-checks the offers like switching on
-- a new schedule does.
do $$
declare
  v_version text := (select version from public.fee_schedules where active);
begin
  -- (Section 6 left the cheapest offers paused; this minimum reaches the rest.)
  update public.fee_schedules set min_referral_fee_per_unit_minor = 5000000, default_referral_bps = 4500
  where active;
  assert exists (select 1 from private.fee_floor_breaches where schedule_version = v_version),
    'fee_floor_active_amounts: offers were paused';
  assert not exists (
    select 1 from public.offers o join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
    where o.status = 'active'
      and private.worst_unit_payout(o.price_minor, o.fulfillment, p.category_id, k.weight_grams,
                                    greatest(k.length_cm, k.width_cm, k.height_cm)) < 0),
    'fee_floor_active_amounts: nothing on sale is below the floor';
  raise exception 'undo' using errcode = 'P0002';
exception when sqlstate 'P0002' then
  null;
end
$$;
-- The tax on the fees alone counts too.
do $$
declare
  v_version text := (select version from public.fee_schedules where active);
begin
  update public.fee_schedules set fee_tax_bps = 1000000 where active;
  assert exists (select 1 from private.fee_floor_breaches where schedule_version = v_version),
    'fee_floor_active_amounts: a higher tax on the fees pauses offers too';
  raise exception 'undo' using errcode = 'P0002';
exception when sqlstate 'P0002' then
  null;
end
$$;

-- fee_floor_one_message_per_change: a change that touches two fee tables runs
-- the re-check twice; each shop is still told once, and the message lists
-- and counts what both passes paused.
do $$
declare
  v_version text := (select version from public.fee_schedules where active);
  v_from bigint := (select coalesce(max(id), 0) from private.outbox_events);
  v_seller uuid;
  v_vars jsonb;
begin
  update public.fee_payment_methods set fixed_minor = fixed_minor + 1500000 where schedule_version = v_version;
  assert exists (select 1 from private.fee_floor_breaches where schedule_version = v_version),
    'fee_floor_one_message_per_change: the first pass paused some';
  update public.fee_payment_methods set fixed_minor = fixed_minor + 2000000 where schedule_version = v_version;
  assert (select count(*) from private.outbox_events where topic = 'fees.offers_paused' and id > v_from)
         = (select count(distinct seller_id) from private.fee_floor_breaches where schedule_version = v_version),
    'fee_floor_one_message_per_change: one event per shop';
  assert (select count(*) from private.outbox_events where topic = 'fees.offers_paused' and id > v_from)
         = (select count(distinct payload ->> 'seller_id') from private.outbox_events
            where topic = 'fees.offers_paused' and id > v_from),
    'fee_floor_one_message_per_change: no shop twice';
  -- messages_vars_fees: the variables of that message can be worked out (a
  -- clash of names there once failed every claim of the worker).
  select seller_id into v_seller from private.fee_floor_breaches where schedule_version = v_version
  group by seller_id order by count(*) desc limit 1;
  v_vars := private.notify_vars(jsonb_build_object('seller_id', v_seller, 'schedule_version', v_version,
                                                   'offer_count', 1));
  assert (v_vars ->> 'paused_count')::integer = (select count(*) from private.fee_floor_breaches
           where schedule_version = v_version and seller_id = v_seller)
     and jsonb_array_length(v_vars -> 'paused_offers') = least(20, (v_vars ->> 'paused_count')::integer)
     and v_vars #>> '{paused_offers,0,title}' is not null,
    format('messages_vars_fees: %s', v_vars);
  raise exception 'undo' using errcode = 'P0002';
exception when sqlstate 'P0002' then
  null;
end
$$;

-- ═══ 7. Messages and the confirmation of a refund ══════════════════════════

-- refund_confirmed_sandbox: staff refund the withdrawal of section 5 in
-- sandbox mode. "Refund requested" is announced first, then, at commit,
-- the refund confirms itself (no money moves in sandbox) and "refund
-- completed" follows.
do $$
begin
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_receive_return(current_setting('t.ret_wd')::uuid, true, null);
  perform public.ops_complete_return(current_setting('t.ret_wd')::uuid, null);
  perform pg_temp.logout();
  perform pg_temp.remember('refund_wd', (select id from private.refunds
    where reason = 'return' and source_id = current_setting('t.ret_wd')::uuid)::text);
end
$$;
set constraints all immediate;
set constraints all deferred;
do $$
declare
  v_requested bigint;
  v_completed bigint;
begin
  select id into v_requested from private.outbox_events where topic = 'refund.requested'
    and payload ->> 'refund_id' = current_setting('t.refund_wd');
  select id into v_completed from private.outbox_events where topic = 'refund.completed'
    and payload ->> 'refund_id' = current_setting('t.refund_wd');
  assert v_requested is not null and v_completed > v_requested,
    format('refund_confirmed_sandbox: requested %s then completed %s', v_requested, v_completed);
  assert (select reference = 'sandbox' from private.refund_confirmations
          where refund_id = current_setting('t.refund_wd')::uuid), 'refund_confirmed_sandbox: recorded';
end
$$;

-- refund_confirmed_live: in live mode nothing is announced until the gateway
-- work records the confirmation; a second confirmation does nothing.
select pg_temp.remember('live', pg_temp.place('seguimiento1@yuntera.example',
  pg_temp.items('cafetera-electrica-volcan-12-tazas:1'), 'card', 'seg-live-0001')::text);
select pg_temp.pay(current_setting('t.live')::uuid);
-- Real money: taken by the gateway in live (20261121083400). Simulated money
-- (the sandbox payment above as it stands) is refunded as a simulation in any
-- mode, so it would confirm itself at commit.
update public.payments set provider = 'onvo', environment = 'live', gateway_reference = 'pi_seg_live_0001'
where order_id = current_setting('t.live')::uuid;
select pg_temp.deliver(current_setting('t.live')::uuid);
select pg_temp.login('seguimiento1@yuntera.example');
select pg_temp.remember('live_ret', public.request_return(
  pg_temp.item(current_setting('t.live')::uuid, 'cafetera-electrica-volcan-12-tazas'), 'withdrawal', 1)::text);
reset role;
do $$
begin
  update public.app_settings set value = '"live"' where key = 'payments_mode';
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_receive_return(current_setting('t.live_ret')::uuid, true, null);
  perform public.ops_complete_return(current_setting('t.live_ret')::uuid, null);
  perform pg_temp.logout();
  perform pg_temp.remember('refund_live', (select id from private.refunds
    where reason = 'return' and source_id = current_setting('t.live_ret')::uuid)::text);
end
$$;
set constraints all immediate;
set constraints all deferred;
do $$
begin
  assert not exists (select 1 from private.outbox_events where topic = 'refund.completed'
                     and payload ->> 'refund_id' = current_setting('t.refund_live')),
    'refund_confirmed_live: nothing announced on the booking';
  assert not exists (select 1 from private.refund_confirmations
                     where refund_id = current_setting('t.refund_live')::uuid),
    'refund_confirmed_live: not confirmed';
  assert (select g.channel = 'gateway' and g.status = 'requested' from private.gateway_refunds g
          where g.refund_id = current_setting('t.refund_live')::uuid),
    'refund_confirmed_live: waiting at the gateway';
  assert private.confirm_refund(current_setting('t.refund_live')::uuid, 'gw-ref-123'),
    'refund_confirmed_live: the gateway confirms';
  assert not private.confirm_refund(current_setting('t.refund_live')::uuid, 'gw-ref-123'),
    'refund_confirmed_live: a second confirmation does nothing';
  assert (select count(*) from private.outbox_events where topic = 'refund.completed'
          and payload ->> 'refund_id' = current_setting('t.refund_live')) = 1,
    'refund_confirmed_live: announced once';
  -- The confirmation is the money's: the gateway refund settled with it, once.
  assert (select g.status = 'succeeded' and g.completion_tx is not null from private.gateway_refunds g
          where g.refund_id = current_setting('t.refund_live')::uuid),
    'refund_confirmed_live: the gateway refund completed';
  assert (select count(*) from public.ledger_transactions
          where order_id = current_setting('t.live')::uuid and kind = 'refund_paid') = 1,
    'refund_confirmed_live: the money booked out once';
  update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
end
$$;
-- refund_confirmation_wrong_caller: no API role can confirm a refund.
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select private.confirm_refund(%L, ''x'')', current_setting('t.refund_live')),
  'forbidden');
reset role;
select pg_temp.login_anon();
select pg_temp.refused(format('select private.confirm_refund(%L, ''x'')', current_setting('t.refund_live')),
  'forbidden');
reset role;
-- refund_confirmation_hostile_input: a refund that does not exist.
select pg_temp.refused('select private.confirm_refund(gen_random_uuid(), ''x'')', 'refund_not_found');

-- messages_planned: each new event plans who gets what, as the operations
-- document's table says (packages/notifications/src/docs.test.ts).
create function pg_temp.planned(p_topic text, p_payload jsonb) returns jsonb
language plpgsql as $$
declare
  e private.outbox_events;
begin
  insert into private.outbox_events (topic, payload) values (p_topic, p_payload) returning * into e;
  perform private.notify_plan_event(e);
  return coalesce((select jsonb_agg(jsonb_build_object('template', d.template, 'channel', d.channel,
                                                       'recipient', d.recipient) order by d.template, d.channel)
                   from private.notification_deliveries d where d.event_id = e.id), '[]'::jsonb);
end;
$$;

do $$
declare
  v_order uuid := current_setting('t.ret')::uuid;
  v_shopper text := 'user:' || (select user_id from public.orders where id = current_setting('t.ret')::uuid);
  v_tecnocasa uuid := (select id from public.sellers where trade_name = 'TecnoCasa');
  v_new uuid;
  v jsonb;
begin
  -- A withdrawal of the purchase (approved at once) says what happens next.
  v := pg_temp.planned('return.requested', jsonb_build_object('return_request_id', current_setting('t.ret_wd')));
  assert v @> jsonb_build_array(jsonb_build_object('template', 'return_approved', 'channel', 'email', 'recipient', v_shopper))
     and not v @> '[{"template": "return_received"}]', format('messages_planned: withdrawal %s', v);
  -- A claim waits for review.
  v := pg_temp.planned('return.requested', jsonb_build_object('return_request_id', current_setting('t.ret_claim')));
  assert v @> '[{"template": "return_received", "channel": "email"}]', format('messages_planned: claim %s', v);
  v := pg_temp.planned('return.received', jsonb_build_object('return_request_id', current_setting('t.ret_wd')));
  assert v @> jsonb_build_array(jsonb_build_object('template', 'return_goods_received', 'channel', 'email', 'recipient', v_shopper)),
    format('messages_planned: goods back %s', v);
  v := pg_temp.planned('delivery_code.locked', jsonb_build_object('order_id', v_order));
  assert v @> jsonb_build_array(jsonb_build_object('template', 'delivery_code_locked', 'channel', 'email', 'recipient', v_shopper))
     and v @> '[{"template": "staff_delivery_code_locked", "recipient": "team:support"}]',
    format('messages_planned: code locked %s', v);
  v := pg_temp.planned('delivery_code.released', jsonb_build_object('order_id', v_order));
  assert v @> jsonb_build_array(jsonb_build_object('template', 'delivery_code_released', 'channel', 'email', 'recipient', v_shopper)),
    format('messages_planned: code released %s', v);
  v := pg_temp.planned('seller.change_decided', jsonb_build_object('seller_id', v_tecnocasa,
         'request_id', gen_random_uuid(), 'kind', 'shop_name', 'approved', true));
  assert v @> jsonb_build_array(jsonb_build_object('template', 'seller_change_decided', 'channel', 'email', 'recipient', 'seller:' || v_tecnocasa)),
    format('messages_planned: shop change %s', v);
  v := pg_temp.planned('payout_details.decided', jsonb_build_object('seller_id', v_tecnocasa,
         'request_id', gen_random_uuid(), 'approved', false));
  assert v @> '[{"template": "seller_payout_account_decided", "channel": "email"}]', format('messages_planned: payout account %s', v);
  v := pg_temp.planned('payout.paid', jsonb_build_object('seller_id', v_tecnocasa,
         'payout_id', gen_random_uuid(), 'amount_minor', 1500000));
  assert v @> '[{"template": "seller_payout_paid", "channel": "email"}]', format('messages_planned: payout paid %s', v);
  v := pg_temp.planned('fees.offers_paused', jsonb_build_object('seller_id', v_tecnocasa,
         'schedule_version', '2026-12-test', 'offer_count', 2));
  assert v @> '[{"template": "seller_offers_paused_fees", "channel": "email"}]', format('messages_planned: fees %s', v);

  -- An invitation goes to the invited account's own confirmed address only.
  v := pg_temp.planned('seller.member_invited', jsonb_build_object('invitation_id', gen_random_uuid(),
         'seller_id', v_tecnocasa, 'invitee_id', (select id from auth.users where email = 'seguimiento2@yuntera.example')));
  assert v = jsonb_build_array(jsonb_build_object('template', 'seller_invitation', 'channel', 'email',
         'recipient', 'user:' || (select id from auth.users where email = 'seguimiento2@yuntera.example'))),
    format('messages_planned: invitation %s', v);
  insert into auth.users (id, email) values (gen_random_uuid(), 'sin-confirmar@yuntera.example') returning id into v_new;
  v := pg_temp.planned('seller.member_invited', jsonb_build_object('invitation_id', gen_random_uuid(),
         'seller_id', v_tecnocasa, 'invitee_id', v_new));
  assert v = '[]'::jsonb, format('messages_planned: never to an unconfirmed address %s', v);
  v := pg_temp.planned('seller.member_invited', jsonb_build_object('invitation_id', gen_random_uuid(),
         'seller_id', v_tecnocasa, 'invitee_id', null, 'email', 'escrito-por-alguien@ejemplo.cr'));
  assert v = '[]'::jsonb, format('messages_planned: never to a typed address %s', v);
  assert not exists (select 1 from private.notification_deliveries
                     where recipient not similar to '(user|seller|team|report):%'),
    'messages_planned: only to accounts, shops and team mailboxes';
end
$$;

-- invitation_mail_limit: a shop (one still waiting for approval) renews the
-- same invitation, then revokes it and invites again: the invited account
-- gets one message, not one per call.
select pg_temp.remember('inv_from', (select coalesce(max(id), 0) from private.outbox_events)::text);
select pg_temp.login('bazar@yuntera.example');
select pg_temp.remember('inv1', public.seller_invite_member(
  (select id from public.sellers where trade_name = 'Bazar Nuevo'), 'seguimiento3@yuntera.example', 'staff')::text);
select public.seller_invite_member((select id from public.sellers where trade_name = 'Bazar Nuevo'),
  'seguimiento3@yuntera.example', 'staff') is not null as renewed;
select public.seller_invite_member((select id from public.sellers where trade_name = 'Bazar Nuevo'),
  ' SEGUIMIENTO3@yuntera.example ', 'staff') is not null as renewed_again;
select public.seller_revoke_invitation(current_setting('t.inv1')::uuid);
select public.seller_invite_member((select id from public.sellers where trade_name = 'Bazar Nuevo'),
  'seguimiento3@yuntera.example', 'staff') is not null as invited_again;
reset role;
do $$
declare
  e private.outbox_events;
  v_events integer := 0;
begin
  for e in select * from private.outbox_events where topic = 'seller.member_invited'
           and id > current_setting('t.inv_from')::bigint order by id loop
    perform private.notify_plan_event(e);
    v_events := v_events + 1;
  end loop;
  assert v_events = 4, format('invitation_mail_limit: %s events', v_events);
  assert (select count(*) from private.notification_deliveries
          where template = 'seller_invitation' and channel = 'email'
            and recipient_user_id = (select id from auth.users where email = 'seguimiento3@yuntera.example'))
         = 1, 'invitation_mail_limit: one message for four calls';
  -- Another shop inviting the same account is a different invitation.
  e := null;
  insert into private.outbox_events (topic, payload)
  values ('seller.member_invited', jsonb_build_object('invitation_id', gen_random_uuid(),
          'seller_id', (select id from public.sellers where trade_name = 'TecnoCasa'),
          'invitee_id', (select id from auth.users where email = 'seguimiento3@yuntera.example')))
  returning * into e;
  perform private.notify_plan_event(e);
  assert (select count(*) from private.notification_deliveries
          where template = 'seller_invitation' and channel = 'email'
            and recipient_user_id = (select id from auth.users where email = 'seguimiento3@yuntera.example'))
         = 2, 'invitation_mail_limit: another shop''s invitation goes out';
end
$$;

-- worker_claim_survives_a_bad_message: one delivery whose variables cannot be
-- worked out goes to the dead letters; the worker still gets the rest,
-- among them a fee-pause message to a shop.
do $$
declare
  v_seller uuid := (select id from public.sellers where trade_name = 'TecnoCasa');
  v_user uuid := (select id from auth.users where email = 'seguimiento1@yuntera.example');
  v_bad uuid;
  v_claim jsonb;
begin
  update private.notification_deliveries set status = 'skipped' where status in ('pending', 'sending');
  insert into private.fee_floor_breaches (schedule_version, offer_id, seller_id, price_minor, min_price_minor)
  select '2026-12-claim', o.id, o.seller_id, o.price_minor, o.price_minor + 100000
  from public.offers o where o.seller_id = v_seller limit 2;
  insert into private.notification_deliveries
    (dedupe_key, ordering_key, sequence, channel, template, recipient, recipient_seller_id, audience, context)
  values ('test/fees', 'seller:' || v_seller, 1, 'email', 'seller_offers_paused_fees', 'seller:' || v_seller,
          v_seller, 'seller', jsonb_build_object('seller_id', v_seller, 'schedule_version', '2026-12-claim',
                                                 'offer_count', 2));
  insert into private.notification_deliveries
    (dedupe_key, ordering_key, sequence, channel, template, recipient, recipient_user_id, audience, context)
  values ('test/bad', 'user:' || v_user, 1, 'email', 'order_placed', 'user:' || v_user, v_user, 'shopper',
          jsonb_build_object('order_id', 'not-an-id'))
  returning id into v_bad;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  v_claim := public.worker_notify_claim('w-test', 20, 60);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  assert jsonb_array_length(v_claim) = 1
     and v_claim #>> '{0,template}' = 'seller_offers_paused_fees'
     and (v_claim #>> '{0,vars,paused_count}')::integer = 2,
    format('worker_claim_survives_a_bad_message: %s', v_claim);
  assert (select status = 'dead' and last_error_code = 'render_failed' and last_error = 'SQLSTATE 22P02'
          from private.notification_deliveries where id = v_bad),
    'worker_claim_survives_a_bad_message: the bad one is a dead letter';
  raise exception 'undo' using errcode = 'P0002';
exception when sqlstate 'P0002' then
  null;
end
$$;

-- messages_vars_hostile: what a template is handed never carries a delivery
-- code, an address, an identification number or payment details, even when
-- the event's payload tries to slip them in.
do $$
declare
  v jsonb;
  v_text text;
begin
  v := private.notify_vars(jsonb_build_object('order_id', current_setting('t.ret'),
    'seller_id', (select id from public.sellers where trade_name = 'TecnoCasa'),
    'payout_id', (select id from public.payouts limit 1)));
  v_text := v::text;
  assert v_text not like '%' || pg_temp.code(current_setting('t.ret')::uuid) || '%'
     and v_text not like '%' || (select ship_senas from public.orders where id = current_setting('t.ret')::uuid) || '%'
     and not (v ? 'delivery_pin' or v ? 'ship_senas' or v ? 'account_number' or v ? 'iban'
              or v ? 'bank_reference' or v ? 'id_number' or v ? 'sinpe_reference'),
    format('messages_vars_hostile: %s', v);
end
$$;

-- ═══ 8. The network extension's grants ═════════════════════════════════════

-- net_grants: where the schema exists (the hosted project, and the local shim
-- that copies it), visitors and signed-in users can neither use it, call its
-- request functions nor read its responses.
--
-- On Supabase's platform the grants on schema net (usage to PUBLIC, anon and
-- authenticated; everything on its tables and functions to PUBLIC) were made
-- by the platform's own role, supabase_admin. The migration role is not a
-- member of it, so 083200's revoke runs and changes nothing (runbook,
-- "Migrations 083200 and 083300"). Where a grant made by a role we can act
-- for is left, that is our failure and this fails. Where every grant left was
-- made by a role the current role is not a member of (memberships as granted,
-- pg_auth_members; the platform's migration role is not a superuser, so a
-- superuser's power to act for anyone is deliberately not counted), what can
-- still be guaranteed is asserted, and the rest ends in a "skipped" row that
-- says so: the accepted platform limit and its compensating controls are in
-- docs/05-security-compliance/security-program.md.
create function pg_temp.acts_for(p_grantor oid) returns boolean
language sql stable as $$
  with recursive mine (role_id) as (
    select r.oid from pg_roles r where r.rolname = current_user
    union
    select m.roleid from pg_auth_members m join mine on m.member = mine.role_id
  )
  select exists (select 1 from mine where role_id = p_grantor)
$$;

-- Every privilege on schema net and its objects held by PUBLIC, anon or
-- authenticated, with who granted it.
create temporary table net_grants on commit drop as
select 'schema net'::text as what, a.grantee, a.grantor, a.privilege_type
from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'net'
union all
select format('table net.%I', c.relname), a.grantee, a.grantor, a.privilege_type
from pg_class c, aclexplode(c.relacl) a where c.relnamespace = (select oid from pg_namespace where nspname = 'net')
union all
select format('function net.%I', p.proname), a.grantee, a.grantor, a.privilege_type
from pg_proc p, aclexplode(p.proacl) a where p.pronamespace = (select oid from pg_namespace where nspname = 'net');
delete from net_grants
where not (grantee = 0 or grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')));

select set_config('t.net_skipped', '', true);
do $$
declare
  r text;
  v_ours text;
  v_theirs text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    return;
  end if;

  -- What our own roles granted to the API roles or everyone: nothing, except
  -- PostgreSQL's default EXECUTE for PUBLIC on a function, which cannot be
  -- used without USAGE on the schema (and that is checked here too).
  select string_agg(format('%s %s to %s', g.privilege_type, g.what,
                           case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end), '; ')
  into v_ours from net_grants g
  where pg_temp.acts_for(g.grantor)
    and not (g.grantee = 0 and g.privilege_type = 'EXECUTE' and g.what like 'function %');
  assert v_ours is null, format('net_grants: granted by a role we act for: %s', v_ours);

  -- Nothing of ours calls it on a caller's behalf: no function the API can
  -- reach mentions the schema, and the only functions that do are the
  -- workers' wake-ups (fixed address and token from Vault), which no API role
  -- may execute.
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.prosrc ~ '\mnet\.'),
    'net_grants: a function the API exposes uses schema net';
  select string_agg(p.oid::regprocedure::text, ', ') into v_ours
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prosrc ~ '\mnet\.http_'
    and (p.proname !~ '_kick$'
         or has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'));
  assert v_ours is null, format('net_grants: functions that send requests beyond the wake-ups: %s', v_ours);
  -- The Data API's exposed schemas, where they are readable from SQL.
  assert not exists (select 1 from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c
                     where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%'
                       and 'net' = any (string_to_array(replace(split_part(c, '=', 2), ' ', ''), ','))),
    'net_grants: the Data API exposes schema net';

  select string_agg(x.line, '; ' order by x.line) into v_theirs
  from (select format('%s to %s by %s', g.what,
                      string_agg(distinct case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end,
                                 ', '), g.grantor::regrole) as line
        from net_grants g
        where not (g.grantee = 0 and g.privilege_type = 'EXECUTE' and g.what like 'function %'
                   and pg_temp.acts_for(g.grantor))
        group by g.what, g.grantor) x;
  if v_theirs is not null then
    perform set_config('t.net_skipped', format(
      'net_grants: the full check is not run: every grant left on schema net was made by a role this one '
      || 'is not a member of, so the migration''s revoke cannot remove it (accepted platform limit, '
      || 'security-program.md). Still checked: our roles granted nothing, no exposed function uses it, '
      || 'the API does not expose it. Granted: %s', left(v_theirs, 600)), true);
    return;
  end if;

  -- Where we could revoke (locally, and on a project whose grants we made):
  -- using anything in a schema takes USAGE on it first; without it, an
  -- execute or select privilege (PUBLIC's default execute on functions
  -- included) cannot be used. The extension itself keeps its own rights.
  assert not exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a
                     where n.nspname = 'net' and a.grantee = 0 and a.privilege_type = 'USAGE'),
    'net_grants: everyone (PUBLIC) uses schema net';
  foreach r in array array['anon', 'authenticated'] loop
    assert not has_schema_privilege(r, 'net', 'usage'), format('net_grants: %s uses schema net', r);
    assert not exists (
      select 1 from pg_class c where c.relnamespace = 'net'::regnamespace and c.relkind in ('r', 'v', 'S', 'p')
        and (has_table_privilege(r, c.oid, 'select') or has_table_privilege(r, c.oid, 'insert'))),
      format('net_grants: %s holds a privilege on a table in net', r);
    assert not exists (
      select 1 from pg_proc p, aclexplode(p.proacl) a
      where p.pronamespace = 'net'::regnamespace and a.grantee = r::regrole),
      format('net_grants: %s holds a privilege on a function in net', r);
  end loop;
end
$$;
select pg_temp.login('seguimiento1@yuntera.example');
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') and current_setting('t.net_skipped') = '' then
    begin
      perform net.http_post('https://example.invalid');
      raise exception 'net_grants: a signed-in user sent a request';
    exception when insufficient_privilege then
      null;
    end;
  end if;
end
$$;
reset role;

select 'ok' as followups;
-- Last, so psql and remote-db.sh show it: the part that could not run here, and why.
select current_setting('t.net_skipped') as skipped where current_setting('t.net_skipped') <> '';
rollback;
