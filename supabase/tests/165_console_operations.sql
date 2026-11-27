-- Staff operations tools (20261121084000_console_operations.sql): delivery
-- zones, districts, holidays, zone closures, platform settings, warehouse
-- locations and stuck routes. For each: the right caller gets what they asked
-- for, every wrong caller is refused, and what the function leaves behind is
-- what the shop, checkout, the warehouse, the driver and the audit log
-- should see.
--
-- Who plays whom: central is an administrator; comprador3 is given one staff
-- role at a time; comprador is a shopper; the parcels and routes are this
-- suite's own (a shopper it creates, orders it places, packs and routes).
-- Every check compares with the suite's own fixtures or with what was there
-- before, never with whole-database totals, so it holds on a used database.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

create function pg_temp.denied(p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not denied: %', p_sql;
exception when insufficient_privilege then
  null;
end;
$$;

-- Runs a statement that must be refused with `p_code` and returns the detail.
create function pg_temp.refused_detail(p_sql text, p_code text) returns text
language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

-- Every function named, called with nulls: each must refuse with `p_code`
-- (or, for 'denied', for lack of the privilege to call it at all).
create function pg_temp.each_refused(p_functions text[], p_code text) returns integer
language plpgsql as $$
declare
  f record;
  v_args text;
  v_count integer := 0;
begin
  for f in
    select p.proname, p.proargtypes, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (p_functions)
    order by p.proname
  loop
    select string_agg(format('null::%s', format_type(f.proargtypes[i], null)), ', ' order by i)
    into v_args from generate_series(0, f.pronargs - 1) i;
    begin
      execute format('select public.%I(%s)', f.proname, coalesce(v_args, ''));
      raise exception 'answered: %', f.proname;
    exception
      when insufficient_privilege then
        if p_code <> 'denied' then
          raise exception '% was denied (expected %)', f.proname, p_code;
        end if;
      when others then
        if sqlerrm <> p_code then
          raise exception '% gave "%" (expected %)', f.proname, sqlerrm, p_code;
        end if;
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function pg_temp.staff_as(p_role public.staff_role) returns void
language sql as $$
  delete from public.staff_members
  where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
  insert into public.staff_members (user_id, role)
  select id, p_role from auth.users where email = 'comprador3@yuntera.example';
$$;

-- Open orders of a zone, as private.order_is_open counts them (the API
-- roles cannot call the private helpers themselves).
create function pg_temp.open_orders_in(p_zone text) returns bigint
language sql as $$
  select count(*) from public.orders o
  where o.zone_id = p_zone and o.status in ('pending_payment', 'payment_review', 'confirmed',
                                            'processing', 'partially_shipped', 'shipped')
$$;

-- The promise gam-core gives for stock in a Yuntera warehouse to an order
-- placed at 09:00 (Costa Rica) on the day before `p_day`.
create function pg_temp.promise_before(p_day date) returns date
language sql as $$
  select p.latest from private.compute_promise('gam-core', 0,
    ((p_day - 1)::timestamp + interval '15 hours') at time zone 'UTC') p
$$;

grant execute on function pg_temp.refused_detail(text, text), pg_temp.denied(text),
  pg_temp.each_refused(text[], text), pg_temp.remember(text, text), pg_temp.open_orders_in(text),
  pg_temp.items(variadic text[]), pg_temp.offer(text, text) to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────

-- The zones as the seed has them: the two of the Gran Área switched on, every
-- district served. (On a used database staff may have changed them since;
-- this transaction rolls back.)
update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;
update public.delivery_zones
set cutoff_hour = 14, processing_weekdays = '{1,2,3,4,5,6}', delivery_weekdays = '{1,2,3,4,5,6}',
    transit_min_days = 1, transit_max_days = 1
where id = 'gam-core';
select pg_temp.remember('today', private.cr_today()::text);
select pg_temp.remember('audit_from', (select coalesce(max(id), 0)::text from private.audit_log));
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.remember('platform', (select id::text from public.warehouses where code = 'SJO1'));

-- Parcels of this suite's own: a shopper (the demo shopper's address in San
-- Pedro, gam-core), three orders paid or on cash on delivery, packed.
select pg_temp.shopper('opsrutas@yuntera.example', 'Prueba Rutas Operación');
select pg_temp.remember('order_a', pg_temp.place('opsrutas@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ops-165-a')::text);
select pg_temp.remember('order_b', pg_temp.place('opsrutas@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'ops-165-b')::text);
select pg_temp.remember('order_c', pg_temp.place('opsrutas@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ops-165-c')::text);
select pg_temp.pay(current_setting('t.order_a')::uuid);
select pg_temp.pay(current_setting('t.order_c')::uuid);
select pg_temp.remember('ship_a', pg_temp.shipment(current_setting('t.order_a')::uuid, 'platform')::text);
select pg_temp.remember('ship_b', pg_temp.shipment(current_setting('t.order_b')::uuid, 'platform')::text);
select pg_temp.remember('ship_c', pg_temp.shipment(current_setting('t.order_c')::uuid, 'platform')::text);
select pg_temp.pack(current_setting('t.ship_a')::uuid);
select pg_temp.pack(current_setting('t.ship_b')::uuid);
select pg_temp.pack(current_setting('t.ship_c')::uuid);
do $$ begin
  assert (select count(*) from public.shipments
          where id in (current_setting('t.ship_a')::uuid, current_setting('t.ship_b')::uuid,
                       current_setting('t.ship_c')::uuid) and status = 'packed') = 3,
    'fixture: three packed parcels';
end $$;

-- Route one, being driven, with A and B; route two, assigned and not started, with C.
select pg_temp.remember('route_one', pg_temp.route(current_setting('t.ship_a')::uuid,
                                                   current_setting('t.ship_b')::uuid)::text);
select pg_temp.act('central@yuntera.example');
select pg_temp.remember('route_two', public.ops_create_route(
  private.cr_today(), current_setting('t.platform')::uuid,
  jsonb_build_array(jsonb_build_object('shipment_id', current_setting('t.ship_c'))),
  (select d.id from public.drivers d join auth.users u on u.id = d.user_id
   where u.email = 'repartidor@yuntera.example'))::text);
select pg_temp.logout();
select pg_temp.remember('stop_a', pg_temp.stop(current_setting('t.route_one')::uuid, current_setting('t.ship_a')::uuid)::text);
select pg_temp.remember('stop_b', pg_temp.stop(current_setting('t.route_one')::uuid, current_setting('t.ship_b')::uuid)::text);
select pg_temp.remember('stop_c', pg_temp.stop(current_setting('t.route_two')::uuid, current_setting('t.ship_c')::uuid)::text);

-- ═══ 1. Who may call what ══════════════════════════════════════════════════

create temporary table ops_functions (fn text) on commit drop;
insert into ops_functions select unnest(array[
  'ops_delivery_zones', 'ops_create_zone', 'ops_update_zone', 'ops_set_zone_active', 'ops_delete_zone',
  'ops_district_cantons', 'ops_canton_districts', 'ops_district_move_preview', 'ops_move_districts',
  'ops_holidays', 'ops_add_holiday', 'ops_remove_holiday',
  'ops_zone_closures', 'ops_open_zone_closure', 'ops_change_zone_closure_end', 'ops_end_zone_closure',
  'ops_warehouse_locations', 'ops_create_location', 'ops_rename_location', 'ops_set_location_active',
  'ops_open_routes', 'ops_remove_route_stop', 'ops_close_route']);
create temporary table admin_functions (fn text) on commit drop;
insert into admin_functions select unnest(array['ops_settings', 'ops_update_setting']);
grant select on pg_temp.ops_functions, pg_temp.admin_functions to authenticated, anon;

do $$
declare
  v_missing text;
begin
  select string_agg(f.fn, ', ') into v_missing
  from (select fn from pg_temp.ops_functions union all select fn from pg_temp.admin_functions) f
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f.fn and p.prosecdef
                      and has_function_privilege('authenticated', p.oid, 'execute')
                      and not has_function_privilege('anon', p.oid, 'execute'));
  assert v_missing is null, format('who_may_call: not a staff function as documented: %s', v_missing);
end
$$;

select pg_temp.login_anon();
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.ops_functions
                                    union all select fn from pg_temp.admin_functions), 'denied') = 25,
    'who_may_call: a visitor';
end $$;
reset role;

select pg_temp.login('comprador@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.ops_functions
                                    union all select fn from pg_temp.admin_functions), 'forbidden') = 25,
    'who_may_call: a shopper';
end $$;
reset role;

select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.ops_functions
                                    union all select fn from pg_temp.admin_functions), 'forbidden') = 25,
    'who_may_call: support';
end $$;
reset role;
select pg_temp.staff_as('finance');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.ops_functions
                                    union all select fn from pg_temp.admin_functions), 'forbidden') = 25,
    'who_may_call: finance';
end $$;
reset role;
select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.ops_functions
                                    union all select fn from pg_temp.admin_functions), 'forbidden') = 25,
    'who_may_call: catalogue staff';
end $$;
reset role;
-- Operations staff work in operations, but the settings are the administrators'.
select pg_temp.staff_as('ops');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.admin_functions), 'forbidden') = 2,
    'who_may_call: operations staff and the settings';
  perform public.ops_delivery_zones();
  perform public.ops_holidays();
end $$;
reset role;

-- With require_staff_mfa on, operations staff without the second step are
-- refused, as everywhere else.
select pg_temp.logout();
update public.app_settings set value = 'true' where key = 'require_staff_mfa';
select pg_temp.login('comprador3@yuntera.example', 'aal1');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.ops_functions), 'forbidden') = 23,
    'who_may_call: staff without the second factor';
end $$;
reset role;
select pg_temp.logout();
update public.app_settings set value = 'false' where key = 'require_staff_mfa';

-- ═══ 2. Delivery zones ═════════════════════════════════════════════════════

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
  z jsonb;
begin
  v := public.ops_delivery_zones();
  select e into z from jsonb_array_elements(v) e where e ->> 'id' = 'gam-core';
  assert z is not null and (z ->> 'active')::boolean and (z ->> 'district_count')::integer > 0
         and (z ->> 'in_use')::boolean and z -> 'promise' ->> 'latest' is not null,
    format('zones: the list %s', z);

  -- A new zone: switched off, empty, deletable.
  z := public.ops_create_zone(' Prueba-Ops ', 'Zona de prueba', 12, '{1,2,3,4,5}', '{5,1,2,3,4,4}',
                              1, 3, 250000, null, false);
  assert z ->> 'id' = 'prueba-ops' and not (z ->> 'active')::boolean
         and (z ->> 'district_count')::integer = 0 and not (z ->> 'in_use')::boolean
         and z -> 'delivery_weekdays' = '[1,2,3,4,5]'::jsonb,
    format('zones: created %s', z);
end
$$;
select pg_temp.refused($q$select public.ops_create_zone('prueba-ops', 'Otra', 12, '{1}', '{1}', 1, 1, 0)$q$, 'zone_id_taken');
select pg_temp.refused($q$select public.ops_create_zone('Zona Ñ', 'Otra', 12, '{1}', '{1}', 1, 1, 0)$q$, 'zone_id_invalid');
select pg_temp.refused($q$select public.ops_create_zone('otra', 'O', 12, '{1}', '{1}', 1, 1, 0)$q$, 'zone_name_invalid');
select pg_temp.refused($q$select public.ops_create_zone('otra', 'Otra', 3, '{1}', '{1}', 1, 1, 0)$q$, 'zone_cutoff_invalid');
select pg_temp.refused($q$select public.ops_create_zone('otra', 'Otra', 12, '{}', '{1}', 1, 1, 0)$q$, 'zone_weekdays_invalid');
select pg_temp.refused($q$select public.ops_create_zone('otra', 'Otra', 12, '{1}', '{7}', 1, 1, 0)$q$, 'zone_weekdays_invalid');
select pg_temp.refused($q$select public.ops_create_zone('otra', 'Otra', 12, '{1}', '{1}', 3, 2, 0)$q$, 'zone_transit_invalid');
select pg_temp.refused($q$select public.ops_create_zone('otra', 'Otra', 12, '{1}', '{1}', 1, 1, -1)$q$, 'zone_fee_invalid');
select pg_temp.refused($q$select public.ops_create_zone('otra', 'Otra', 12, '{1}', '{1}', 1, 1, 100, 0)$q$, 'zone_threshold_invalid');
-- A name shoppers read: invisible characters alone are no name, and control
-- characters do not reach the screen.
select pg_temp.refused(format($q$select public.ops_create_zone('otra', %L, 12, '{1}', '{1}', 1, 1, 0)$q$,
  '  ' || chr(8203) || chr(8203) || '  '), 'zone_name_invalid');
-- Hangul fillers count as letters but draw nothing; the Arabic letter mark,
-- the grapheme joiner and tag characters are invisible too.
select pg_temp.refused(format($q$select public.ops_create_zone('otra', %L, 12, '{1}', '{1}', 1, 1, 0)$q$,
  chr(12644) || chr(12644) || chr(12644)), 'zone_name_invalid');
select pg_temp.refused(format($q$select public.ops_create_zone('otra', %L, 12, '{1}', '{1}', 1, 1, 0)$q$,
  chr(65440) || chr(4447) || chr(4448) || chr(1564) || chr(847) || chr(917601) || chr(917602)), 'zone_name_invalid');
-- No-break and other Unicode spaces count as spaces: trimmed and collapsed
-- (the helper itself, which only the owner may run).
reset role;
do $$
begin
  if private.clean_label(chr(160) || chr(160) || 'Zona' || chr(8195) || chr(12288) || 'Sur' || chr(160))
     <> 'Zona Sur' then
    raise exception 'clean_label kept Unicode spaces: %', private.clean_label(
      chr(160) || chr(160) || 'Zona' || chr(8195) || chr(12288) || 'Sur' || chr(160));
  end if;
  if private.clean_label('Zona' || chr(12644) || 'Sur') <> 'ZonaSur' then
    raise exception 'clean_label kept a Hangul filler';
  end if;
end;
$$;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused($q$select public.ops_create_zone('otra', '-- 12 --', 12, '{1}', '{1}', 1, 1, 0)$q$, 'zone_name_invalid');
do $$
declare
  z jsonb;
begin
  z := public.ops_create_zone('nombre-raro', 'Zona' || chr(10) || 'Norte' || chr(7) || chr(8203), 12, '{1}', '{1}', 1, 1, 0);
  assert z ->> 'name' = 'Zona Norte', format('zones: the name is cleaned %s', z ->> 'name');
  perform public.ops_delete_zone('nombre-raro');
end
$$;

-- Changing what a zone holds: against the revision it was read at.
reset role;
select pg_temp.remember('core_revision', (select revision::text from public.delivery_zones where id = 'gam-core'));
select pg_temp.remember('core_fee', (select shipping_fee_minor::text from public.delivery_zones where id = 'gam-core'));
select pg_temp.remember('open_order', (
  select o.id::text from public.orders o
  where o.zone_id = 'gam-core' and private.order_is_open(o.status) order by o.placed_at limit 1));
select pg_temp.remember('open_order_promise', (
  select promise_latest::text || '/' || shipping_minor::text from public.orders
  where id = current_setting('t.open_order')::uuid));
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  z jsonb;
  c public.delivery_zones%rowtype;
begin
  select * into c from public.delivery_zones where id = 'gam-core';
  z := public.ops_update_zone('gam-core', c.revision, c.name, c.cutoff_hour, c.processing_weekdays,
         c.delivery_weekdays, c.transit_min_days, c.transit_max_days, c.shipping_fee_minor + 10000,
         c.free_shipping_threshold_minor, c.cod_available);
  assert (z ->> 'revision')::integer = c.revision + 1
         and (z ->> 'shipping_fee_minor')::bigint = c.shipping_fee_minor + 10000,
    format('zones: updated %s', z);
end
$$;
-- A second member of staff who read the same revision is refused, not let
-- to undo the first change.
select pg_temp.refused(format(
  $q$select public.ops_update_zone('gam-core', %s, 'GAM central', 14, '{1,2,3,4,5,6}', '{1,2,3,4,5,6}', 1, 1, 150000, 2500000, true)$q$,
  current_setting('t.core_revision')), 'zone_changed_meanwhile');
do $$
declare
  c public.delivery_zones%rowtype;
begin
  select * into c from public.delivery_zones where id = 'gam-core';
  perform pg_temp.refused(format(
    $q$select public.ops_update_zone('gam-core', %s, %L, %s, %L, %L, %s, %s, %s, %s, %s)$q$,
    c.revision, c.name, c.cutoff_hour, c.processing_weekdays, c.delivery_weekdays, c.transit_min_days,
    c.transit_max_days, c.shipping_fee_minor, coalesce(c.free_shipping_threshold_minor::text, 'null'),
    c.cod_available::text), 'zone_unchanged');
  -- Orders already placed keep their promise and what they were charged.
  assert (select promise_latest::text || '/' || shipping_minor::text from public.orders
          where id = current_setting('t.open_order')::uuid) = current_setting('t.open_order_promise'),
    'zones: an order placed keeps its promise and fee';
end
$$;
reset role;
do $$ begin
  assert exists (select 1 from private.audit_log a
                 where a.id > current_setting('t.audit_from')::bigint and a.table_name = 'delivery_zones'
                   and a.row_key = 'gam-core'
                   and (a.old_row ->> 'shipping_fee_minor')::bigint = current_setting('t.core_fee')::bigint
                   and (a.new_row ->> 'shipping_fee_minor')::bigint = current_setting('t.core_fee')::bigint + 10000),
    'zones: the change is in the audit log, old and new';
end $$;

-- Switched off: no new orders there, orders placed untouched; and on again.
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  z jsonb;
  q jsonb;
  v_open integer := pg_temp.open_orders_in('gam-core');
begin
  z := public.ops_set_zone_active('gam-core', false,
         (select revision from public.delivery_zones where id = 'gam-core'));
  assert not (z ->> 'active')::boolean and (z ->> 'open_order_count')::integer = v_open
         and v_open >= 2,
    format('zones: switched off, %s open orders said', z ->> 'open_order_count');
  q := public.checkout_quote(pg_temp.items('libreta-tapa-dura-a5:1'), '11501');
  assert q ->> 'issue' = 'zone_not_served' and q -> 'promise' = 'null'::jsonb
         and not (q -> 'zone' ->> 'active')::boolean,
    format('zones: the cart says it does not deliver there: %s', q);
  assert (select not e.zone_active from public.delivery_estimate('11501') e),
    'zones: the product page gives no date there';
  assert pg_temp.open_orders_in('gam-core') = v_open,
    'zones: orders placed stay open';
end
$$;
reset role;
select pg_temp.login('opsrutas@yuntera.example');
select pg_temp.refused($q$select public.place_order(pg_temp.items('libreta-tapa-dura-a5:1'),
  (select id from public.addresses where user_id = (select auth.uid()) and is_default), 'card', 'ops-165-off')$q$,
  'zone_not_served');
do $$ begin
  assert (select not a.zone_active from public.my_addresses() a where a.is_default),
    'zones: the saved address cannot be chosen at checkout';
end $$;
reset role;
select pg_temp.login('comprador3@yuntera.example');
-- The other zones off as well (the fixture), then the last one stays on.
reset role;
update public.delivery_zones set active = false where id <> 'gam-extended' and active;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused($q$select public.ops_set_zone_active('gam-extended', false,
  (select revision from public.delivery_zones where id = 'gam-extended'))$q$, 'zone_last_active');
do $$
declare
  z jsonb;
begin
  z := public.ops_set_zone_active('gam-core', true,
         (select revision from public.delivery_zones where id = 'gam-core'));
  assert (z ->> 'active')::boolean, 'zones: switched on again';
  assert (public.checkout_quote(pg_temp.items('libreta-tapa-dura-a5:1'), '11501') ->> 'issue') is null,
    'zones: the cart delivers there again';
end
$$;
select pg_temp.refused($q$select public.ops_set_zone_active('gam-core', true,
  (select revision from public.delivery_zones where id = 'gam-core'))$q$, 'zone_unchanged');
select pg_temp.refused($q$select public.ops_set_zone_active('gam-core', false, 0)$q$, 'zone_changed_meanwhile');
select pg_temp.refused($q$select public.ops_set_zone_active('nada', false, 1)$q$, 'zone_not_found');
-- A zone anything refers to is never deleted.
select pg_temp.refused($q$select public.ops_delete_zone('gam-core')$q$, 'zone_in_use');
-- A zone with no district served is not switched on: it would take no order.
select pg_temp.refused($q$select public.ops_set_zone_active('prueba-ops', true,
  (select revision from public.delivery_zones where id = 'prueba-ops'))$q$, 'zone_has_no_districts');
reset role;
-- Nor does an active zone with no district served count as somewhere the shop
-- still delivers (fixture: the empty zone switched on in the database).
update public.delivery_zones set active = true where id = 'prueba-ops';
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  perform public.ops_set_zone_active('gam-core', false,
    (select revision from public.delivery_zones where id = 'gam-core'));
  perform pg_temp.refused($q$select public.ops_set_zone_active('gam-extended', false,
    (select revision from public.delivery_zones where id = 'gam-extended'))$q$, 'zone_last_active');
  assert exists (select 1 from public.list_districts() l where l.zone_active),
    'zones: the shop still delivers somewhere';
  perform public.ops_set_zone_active('gam-core', true,
    (select revision from public.delivery_zones where id = 'gam-core'));
end $$;
reset role;
update public.delivery_zones set active = false where id = 'prueba-ops';
select pg_temp.login('comprador3@yuntera.example');
reset role;
update public.delivery_zones set active = true where id = 'gam-extended';

-- ═══ 3. Districts ══════════════════════════════════════════════════════════

select pg_temp.remember('addresses_11501', (select count(*)::text from public.addresses
                                            where postal_code = '11501' and deleted_at is null));
select pg_temp.remember('orders_11501', (select count(*)::text from public.orders o
                                         where o.ship_postal_code = '11501' and private.order_is_open(o.status)));
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
  d jsonb;
begin
  v := public.ops_district_cantons();
  assert exists (select 1 from jsonb_array_elements(v) e
                 where e ->> 'code' = '115' and (e ->> 'district_count')::integer > 1
                   and e -> 'zones' ? 'gam-core'),
    'districts: the cantons';
  v := public.ops_canton_districts('115');
  select e into d from jsonb_array_elements(v -> 'districts') e where e ->> 'postal_code' = '11501';
  assert d ->> 'zone_id' = 'gam-core' and (d ->> 'served')::boolean
         and (d ->> 'saved_address_count')::integer = current_setting('t.addresses_11501')::integer
         and (d ->> 'open_order_count')::integer = current_setting('t.orders_11501')::integer,
    format('districts: one district, with what a move touches %s', d);

  -- Before confirming: what a move touches.
  v := public.ops_district_move_preview(array['11501', '11502'], 'prueba-ops');
  assert (v ->> 'changing_count')::integer = 2
         and (v ->> 'saved_address_count')::integer >= current_setting('t.addresses_11501')::integer
         and (v ->> 'open_order_count')::integer >= current_setting('t.orders_11501')::integer
         and v -> 'target' ->> 'id' = 'prueba-ops' and v -> 'zones_left_empty' = '[]'::jsonb,
    format('districts: preview %s', v);

  -- Moved into the new zone, which is switched off: the shop says so.
  v := public.ops_move_districts(array['11501', '11502'], 'prueba-ops');
  assert (v ->> 'changing_count')::integer = 2, 'districts: moved';
  assert (select l.zone_id = 'prueba-ops' and not l.zone_active from public.list_districts() l
          where l.postal_code = '11501'), 'districts: the district list follows';
  assert public.checkout_quote(pg_temp.items('libreta-tapa-dura-a5:1'), '11501') ->> 'issue' = 'zone_not_served',
    'districts: the cart follows';

  -- Moving them back would leave the new zone with no district: said first.
  v := public.ops_district_move_preview(array['11501', '11502'], 'gam-core');
  assert v -> 'zones_left_empty' @> '[{"id": "prueba-ops"}]'::jsonb,
    format('districts: a zone left with no district is named %s', v);
  perform public.ops_move_districts(array['11501', '11502'], 'gam-core');
  assert (select l.zone_id = 'gam-core' and l.zone_active from public.list_districts() l
          where l.postal_code = '11501'), 'districts: moved back';

  -- Marked as not served: it keeps its zone, and reads as not delivered to.
  v := public.ops_move_districts(array['11501'], null);
  assert (select l.zone_id = 'gam-core' and not l.zone_active from public.list_districts() l
          where l.postal_code = '11501'), 'districts: not served';
  assert (select not e.zone_active from public.delivery_estimate('11501') e),
    'districts: no date on the product page';
  v := public.checkout_quote(pg_temp.items('libreta-tapa-dura-a5:1'), '11501');
  assert v ->> 'issue' = 'zone_not_served' and v -> 'zone' ->> 'id' = 'gam-core',
    format('districts: the cart says it does not deliver there %s', v);
end
$$;
reset role;
select pg_temp.login('opsrutas@yuntera.example');
select pg_temp.refused($q$select public.place_order(pg_temp.items('libreta-tapa-dura-a5:1'),
  (select id from public.addresses where user_id = (select auth.uid()) and is_default), 'card', 'ops-165-unserved')$q$,
  'zone_not_served');
do $$ begin
  -- The saved address stays, and cannot be chosen.
  assert (select not a.zone_active from public.my_addresses() a where a.is_default),
    'districts: the saved address stays, not deliverable';
end $$;
reset role;
-- Nor can a seller's pickup point be saved there: our drivers do not go there.
select pg_temp.remember('vendedor_shop', (
  select m.seller_id::text from public.seller_members m join auth.users u on u.id = m.user_id
  where u.email = 'vendedor@yuntera.example' and m.role in ('owner', 'admin') order by m.seller_id limit 1));
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format($q$select public.seller_save_location(%L, 'Bodega Carmen',
  'Avenida segunda, 100 metros norte del parque', '11501', 9.93, -84.05)$q$,
  current_setting('t.vendedor_shop')), 'zone_not_served');
reset role;
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  perform public.ops_move_districts(array['11501'], 'gam-core');
  assert (select l.zone_active from public.list_districts() l where l.postal_code = '11501'),
    'districts: served again';
end $$;
select pg_temp.refused($q$select public.ops_move_districts(array['11501'], 'gam-core')$q$, 'district_unchanged');
select pg_temp.refused($q$select public.ops_move_districts(array[]::text[], 'gam-core')$q$, 'district_selection_invalid');
select pg_temp.refused($q$select public.ops_move_districts(array['99999'], 'gam-core')$q$, 'district_not_found');
select pg_temp.refused($q$select public.ops_move_districts(array['11501'], 'nada')$q$, 'zone_not_found');
select pg_temp.refused($q$select public.ops_canton_districts('999')$q$, 'canton_not_found');
reset role;
-- No move may leave every active zone without a district served (fixture:
-- only 11501 and 11502 served, only gam-core on; put back afterwards).
create temporary table zones_before on commit drop as select id, active from public.delivery_zones;
create temporary table unserved_before on commit drop as select postal_code from public.districts where not served;
update public.districts set served = false where postal_code not in ('11501', '11502') and served;
update public.delivery_zones set active = (id = 'gam-core') where active is distinct from (id = 'gam-core');
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.ops_district_move_preview(array['11501', '11502'], null);
  assert (v ->> 'nothing_served_after')::boolean, format('districts: the preview says nobody could order %s', v);
  perform pg_temp.refused($q$select public.ops_move_districts(array['11501', '11502'], null)$q$,
                          'districts_none_served');
  -- Into a zone that is off, the same.
  perform pg_temp.refused($q$select public.ops_move_districts(array['11501', '11502'], 'prueba-ops')$q$,
                          'districts_none_served');
  -- One of the two is fine: the other still takes orders.
  v := public.ops_district_move_preview(array['11502'], null);
  assert not (v ->> 'nothing_served_after')::boolean, format('districts: one left served %s', v);
  assert (select count(*) from public.list_districts() l where l.zone_active) = 2,
    'districts: nothing changed by the refused moves';
end $$;
reset role;
update public.districts set served = true
where not served and postal_code not in (select postal_code from pg_temp.unserved_before);
update public.delivery_zones z set active = b.active from pg_temp.zones_before b
where b.id = z.id and z.active is distinct from b.active;
select pg_temp.login('comprador3@yuntera.example');
-- The new zone, empty again, can be deleted.
select public.ops_delete_zone('prueba-ops');
reset role;
do $$ begin
  assert not exists (select 1 from public.delivery_zones where id = 'prueba-ops'), 'zones: deleted';
  assert (select count(*) from private.audit_log a
          where a.id > current_setting('t.audit_from')::bigint and a.action = 'district_zone'
            and a.row_key = '11501') = 4
         and exists (select 1 from private.audit_log a
                     where a.id > current_setting('t.audit_from')::bigint and a.action = 'district_zone'
                       and a.row_key = '11501' and a.old_row ->> 'served' = 'true'
                       and a.new_row ->> 'served' = 'false'),
    'districts: each move is in the audit log, old and new';
end $$;

-- ═══ 4. Holidays ═══════════════════════════════════════════════════════════

-- A Wednesday at least five weeks ahead that is not a holiday, has no route
-- and no open order promised, for the plain case; the Thursday before it, for
-- the promised orders; and another Wednesday for a planned route.
select pg_temp.remember('free_day', (
  select d::date::text from generate_series(private.cr_today() + 35, private.cr_today() + 400, interval '1 day') d
  where extract(dow from d) = 3
    and not exists (select 1 from public.holidays h where h.day in (d::date, d::date - 1))
    and private.routes_planned_on(d::date) = 0 and private.orders_promised_on(d::date) = 0
    and private.routes_planned_on(d::date + 14) = 0
    and not exists (select 1 from public.zone_closures c
                    where c.zone_id = 'gam-core' and c.day between d::date - 1 and d::date + 20)
  order by d limit 1));
do $$ begin
  assert pg_temp.promise_before(current_setting('t.free_day')::date) = current_setting('t.free_day')::date,
    'fixture: an order the morning before is promised for the free day';
end $$;
select pg_temp.remember('promised_day', (current_setting('t.free_day')::date + 7)::text);
select pg_temp.remember('route_day', (current_setting('t.free_day')::date + 14)::text);
-- Fixtures: an open order of the suite promised on the promised day, and a
-- route (the suite's not-started one, moved) on the route day.
update public.orders set promise_earliest = current_setting('t.promised_day')::date,
                         promise_latest = current_setting('t.promised_day')::date
where id = current_setting('t.order_c')::uuid;
delete from public.holidays where day in (current_setting('t.promised_day')::date, current_setting('t.route_day')::date);
select pg_temp.remember('route_two_date', (select service_date::text from public.routes where id = current_setting('t.route_two')::uuid));
update public.routes set service_date = current_setting('t.route_day')::date where id = current_setting('t.route_two')::uuid;

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v_day date := current_setting('t.free_day')::date;
  v jsonb;
begin
  v := public.ops_add_holiday(v_day, ' Día de   prueba ');
  assert v ->> 'name' = 'Día de prueba' and (v ->> 'promised_orders')::integer = 0, format('holidays: added %s', v);
  v := public.ops_holidays();
  assert exists (select 1 from jsonb_array_elements(v -> 'holidays') e
                 where (e ->> 'day')::date = v_day and (e ->> 'changeable')::boolean),
    'holidays: listed';
end
$$;
reset role;
do $$ begin
  assert pg_temp.promise_before(current_setting('t.free_day')::date) > current_setting('t.free_day')::date,
    'holidays: the promise moves at once';
end $$;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_add_holiday(%L, 'Otra vez')$q$, current_setting('t.free_day')), 'holiday_exists');
select pg_temp.refused(format($q$select public.ops_add_holiday(%L, 'Hoy')$q$, current_setting('t.today')), 'holiday_in_past');
select pg_temp.refused(format($q$select public.ops_add_holiday(%L, 'Ayer')$q$, current_setting('t.today')::date - 1), 'holiday_in_past');
-- A mistyped year is refused, not stored.
select pg_temp.refused(format($q$select public.ops_add_holiday(%L, 'Lejos')$q$, current_setting('t.today')::date + 800), 'holiday_too_far');
select pg_temp.refused(format($q$select public.ops_add_holiday(%L, 'x')$q$, current_setting('t.promised_day')), 'holiday_name_invalid');
-- A day with routes planned: refused, with how many.
do $$ begin
  assert pg_temp.refused_detail(format($q$select public.ops_add_holiday(%L, 'Con ruta')$q$,
           current_setting('t.route_day')), 'holiday_has_routes') = '1',
    'holidays: a day with a route planned is refused with the count';
end $$;
-- A day with open orders promised: warned with their count, added when confirmed.
do $$
declare
  v_count text;
  v jsonb;
begin
  v_count := pg_temp.refused_detail(format($q$select public.ops_add_holiday(%L, 'Con pedidos')$q$,
               current_setting('t.promised_day')), 'holiday_has_promised_orders');
  assert v_count::integer >= 1, format('holidays: warned with %s', v_count);
  v := public.ops_add_holiday(current_setting('t.promised_day')::date, 'Con pedidos', true);
  assert (v ->> 'promised_orders')::text = v_count, 'holidays: added when confirmed';
  assert (select promise_latest from public.orders where id = current_setting('t.order_c')::uuid)
         = current_setting('t.promised_day')::date,
    'holidays: those orders keep their promise';
end
$$;
-- Removed again (the undo), and the promise is back.
select public.ops_remove_holiday(current_setting('t.free_day')::date);
select pg_temp.refused(format($q$select public.ops_remove_holiday(%L)$q$, current_setting('t.free_day')), 'holiday_not_found');
select pg_temp.refused(format($q$select public.ops_remove_holiday(%L)$q$, current_setting('t.today')), 'holiday_in_past');
reset role;
do $$ begin
  assert pg_temp.promise_before(current_setting('t.free_day')::date) = current_setting('t.free_day')::date,
    'holidays: removed, the promise is back';
  assert exists (select 1 from private.audit_log a
                 where a.id > current_setting('t.audit_from')::bigint and a.table_name = 'holidays'
                   and a.action = 'DELETE' and (a.old_row ->> 'day')::date = current_setting('t.free_day')::date),
    'holidays: in the audit log';
end $$;
update public.routes set service_date = current_setting('t.route_two_date')::date
where id = current_setting('t.route_two')::uuid;

select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_add_holiday(%L, %L)$q$,
  current_setting('t.free_day')::date + 3, chr(8203) || '- - -' || chr(8203)), 'holiday_name_invalid');
reset role;

-- ═══ 5. Zone closures ══════════════════════════════════════════════════════

-- Fixture: the suite's order A promised inside the closure below.
update public.orders set promise_earliest = current_setting('t.free_day')::date + 1,
                         promise_latest = current_setting('t.free_day')::date + 2
where id = current_setting('t.order_a')::uuid;
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v_from date := current_setting('t.free_day')::date;
  c jsonb;
begin
  c := public.ops_open_zone_closure('gam-core', v_from, v_from + 2, 'weather');
  assert c ->> 'state' = 'upcoming' and (c ->> 'revision')::integer = 1
         and (c ->> 'affected_order_count')::integer >= 1
         and c -> 'affected_orders' @> jsonb_build_array(jsonb_build_object(
               'order_number', (select order_number from public.orders where id = current_setting('t.order_a')::uuid))),
    format('closures: opened, with the orders promised inside %s', c);
  perform pg_temp.remember('closure', c ->> 'id');
  assert (select count(*) from public.zone_closures z where z.period_id = (c ->> 'id')::uuid) = 3,
    'closures: its days are closed';

  -- Another zone may close on the same days.
  c := public.ops_open_zone_closure('gam-extended', v_from, v_from + 1, 'other', 'Feria en el centro');
  assert c ->> 'reason' = 'other' and c ->> 'note' = 'Feria en el centro', 'closures: other zone, other reason';
end
$$;
reset role;
do $$ begin
  assert pg_temp.promise_before(current_setting('t.free_day')::date) > current_setting('t.free_day')::date + 2,
    'closures: the promise follows at once';
  -- Nothing is cancelled or re-promised by itself.
  assert (select status = 'shipped' and promise_latest = current_setting('t.free_day')::date + 2
          from public.orders where id = current_setting('t.order_a')::uuid),
    'closures: the order promised inside stays as it was';
end $$;
select pg_temp.login('comprador3@yuntera.example');
-- Overlapping closures of one zone are refused, not merged.
select pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'capacity')$q$,
  current_setting('t.free_day')::date + 2, current_setting('t.free_day')::date + 4), 'zone_closure_overlaps');
select pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'other')$q$,
  current_setting('t.free_day')::date + 10, current_setting('t.free_day')::date + 11), 'zone_closure_note_invalid');
select pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'flood')$q$,
  current_setting('t.free_day')::date + 10, current_setting('t.free_day')::date + 11), 'zone_closure_reason_invalid');
select pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'weather')$q$,
  current_setting('t.today')::date - 1, current_setting('t.today')::date + 1), 'zone_closure_in_past');
select pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'weather')$q$,
  current_setting('t.free_day')::date + 10, current_setting('t.free_day')::date + 9), 'zone_closure_dates_invalid');
select pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'weather')$q$,
  current_setting('t.free_day')::date + 10, current_setting('t.free_day')::date + 50), 'zone_closure_too_long');
-- A mistyped year is refused, not stored.
select pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'weather')$q$,
  current_setting('t.today')::date + 400, current_setting('t.today')::date + 401), 'zone_closure_too_far');
select pg_temp.refused(format($q$select public.ops_open_zone_closure('nada', %L, %L, 'weather')$q$,
  current_setting('t.free_day')::date + 10, current_setting('t.free_day')::date + 11), 'zone_not_found');
do $$
declare
  v_from date := current_setting('t.free_day')::date;
  c jsonb;
begin
  -- The end moved later, against the revision; a second edit from the same
  -- revision is refused.
  c := public.ops_change_zone_closure_end(current_setting('t.closure')::uuid, v_from + 4, 1);
  assert (c ->> 'ends_on')::date = v_from + 4 and (c ->> 'revision')::integer = 2, 'closures: end changed';
  assert (select count(*) from public.zone_closures z where z.period_id = current_setting('t.closure')::uuid) = 5,
    'closures: the days follow';
  perform pg_temp.refused(format($q$select public.ops_change_zone_closure_end(%L, %L, 1)$q$,
    current_setting('t.closure'), v_from + 3), 'zone_closure_changed_meanwhile');
  perform pg_temp.refused(format($q$select public.ops_change_zone_closure_end(%L, %L, 2)$q$,
    current_setting('t.closure'), v_from + 4), 'zone_closure_unchanged');
  perform pg_temp.refused(format($q$select public.ops_change_zone_closure_end(%L, %L, 2)$q$,
    current_setting('t.closure'), v_from + 40), 'zone_closure_too_long');

  -- Ended early before it started: cancelled, the days open again.
  c := public.ops_end_zone_closure(current_setting('t.closure')::uuid, 2);
  assert c ->> 'state' = 'cancelled', format('closures: ended before it started %s', c);
  assert not exists (select 1 from public.zone_closures z where z.period_id = current_setting('t.closure')::uuid),
    'closures: its days are open again';
  perform pg_temp.refused(format($q$select public.ops_end_zone_closure(%L, 3)$q$,
    current_setting('t.closure')), 'zone_closure_over');
  -- It stays on the list for a few days, so it can be closed again from there.
  c := public.ops_zone_closures();
  assert exists (select 1 from jsonb_array_elements(c -> 'closures') e
                 where e ->> 'id' = current_setting('t.closure') and e ->> 'state' = 'cancelled'),
    'closures: a cancelled one is still listed';
  c := public.ops_open_zone_closure('gam-core', v_from, v_from + 4, 'weather');
  assert c ->> 'state' = 'upcoming', format('closures: closed again after cancelling %s', c);
  assert not exists (select 1 from jsonb_array_elements(public.ops_zone_closures() -> 'closures') e
                     where e ->> 'id' = current_setting('t.closure')),
    'closures: once closed again, the cancelled one is no longer offered';
  perform public.ops_end_zone_closure((c ->> 'id')::uuid, (c ->> 'revision')::integer);
  -- A note of invisible characters only is no note.
  perform pg_temp.refused(format($q$select public.ops_open_zone_closure('gam-core', %L, %L, 'other', %L)$q$,
    v_from + 10, v_from + 11, chr(8203) || '...' || chr(8203)), 'zone_closure_note_invalid');
end
$$;
reset role;
-- A closure that started two days ago (the fixture), ended early: from today
-- the zone delivers again; the days already past stay as they were.
insert into public.zone_closure_periods (zone_id, starts_on, ends_on, reason)
values ('gam-core', current_setting('t.today')::date - 2, current_setting('t.today')::date + 2, 'road_closed');
select pg_temp.remember('started', (select id::text from public.zone_closure_periods
                                    where zone_id = 'gam-core' and reason = 'road_closed'
                                      and starts_on = current_setting('t.today')::date - 2
                                    order by created_at desc limit 1));
insert into public.zone_closures (zone_id, day, reason, period_id)
select 'gam-core', d::date, 'road_closed', current_setting('t.started')::uuid
from generate_series(current_setting('t.today')::date - 2, current_setting('t.today')::date + 2, interval '1 day') d
on conflict do nothing;
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v_today date := current_setting('t.today')::date;
  c jsonb;
begin
  c := public.ops_zone_closures();
  assert exists (select 1 from jsonb_array_elements(c -> 'closures') e
                 where e ->> 'id' = current_setting('t.started') and e ->> 'state' = 'current'),
    'closures: the one under way is listed';
  c := public.ops_end_zone_closure(current_setting('t.started')::uuid, 1);
  assert (c ->> 'ends_on')::date = v_today - 1 and (c ->> 'ended_early')::boolean and c ->> 'state' = 'over',
    format('closures: ended early %s', c);
  assert (select count(*) from public.zone_closures z where z.period_id = current_setting('t.started')::uuid) = 2
         and not exists (select 1 from public.zone_closures z
                         where z.period_id = current_setting('t.started')::uuid and z.day >= v_today),
    'closures: today and after are open, the past stays';
  -- And the undo: closed again until tomorrow.
  c := public.ops_change_zone_closure_end(current_setting('t.started')::uuid, v_today + 1, 2);
  assert c ->> 'state' = 'current' and not (c ->> 'ended_early')::boolean
         and (select count(*) from public.zone_closures z
              where z.period_id = current_setting('t.started')::uuid) = 4,
    format('closures: closed again %s', c);
end
$$;
reset role;
do $$ begin
  assert (select count(*) from private.audit_log a
          where a.id > current_setting('t.audit_from')::bigint and a.table_name = 'zone_closure_periods'
            and a.row_key = current_setting('t.closure')) = 3
         and not exists (select 1 from private.audit_log a
                         where a.id > current_setting('t.audit_from')::bigint
                           and a.table_name = 'zone_closure_periods'
                           and coalesce(a.new_row, a.old_row) ? 'note'),
    'closures: each step is in the audit log, without the free text';
end $$;

-- ═══ 6. Settings ═══════════════════════════════════════════════════════════

-- Protected, by name: the payments mode and gateway, everything about
-- invoicing, the staff's second factor, consent versions, the order number
-- prefix, payouts, and the limits also written in the apps.
create temporary table protected_settings (key text) on commit drop;
insert into protected_settings select unnest(array[
  'payments_mode', 'payment_gateway', 'gateway_expected_fees', 'gateway_refund_unknown_hold_minutes',
  'max_payment_attempts_per_order', 'invoicing_issuer', 'invoicing_policy', 'require_staff_mfa',
  'policy_versions', 'order_number_prefix', 'payout_hold_days', 'payout_minimum_minor',
  'reservation_minutes', 'max_units_per_line', 'max_lines_per_order']);
grant select on pg_temp.protected_settings to authenticated;
do $$ begin
  assert (select count(*) from pg_temp.protected_settings p
          join public.app_settings s on s.key = p.key) = 15,
    'settings: fixture, every protected setting exists';
end $$;
select pg_temp.remember('settings_before', (select jsonb_object_agg(key, value)::text from public.app_settings));
select pg_temp.remember('complaints', (select value::text from public.app_settings where key = 'max_open_complaints_per_account'));

select pg_temp.login('central@yuntera.example');
do $$
declare
  v jsonb;
  k text;
begin
  v := public.ops_settings();
  assert jsonb_array_length(v) = (select count(*) from public.app_settings),
    'settings: every setting is listed';
  assert not exists (select 1 from jsonb_array_elements(v) e
                     where e ->> 'key' in (select key from pg_temp.protected_settings)
                       and (e ->> 'editable')::boolean),
    'settings: protected ones are not editable';
  assert exists (select 1 from jsonb_array_elements(v) e
                 where e ->> 'key' = 'max_open_complaints_per_account' and (e ->> 'editable')::boolean
                   and (e ->> 'min_value')::integer = 1 and (e ->> 'max_value')::integer = 50),
    'settings: an operational one, with its range';

  -- No function changes a protected setting: each is refused and stays as it was.
  for k in select key from pg_temp.protected_settings order by key loop
    perform pg_temp.refused(format($q$select public.ops_update_setting(%L, '1', (select value from public.app_settings where key = %L))$q$, k, k),
                            'setting_protected');
  end loop;
end
$$;
select pg_temp.refused($q$select public.ops_update_setting('no_such_setting', '1', null)$q$, 'setting_not_found');
select pg_temp.refused(format($q$select public.ops_update_setting('max_open_complaints_per_account', '0', %L)$q$,
  current_setting('t.complaints')), 'setting_out_of_range');
select pg_temp.refused(format($q$select public.ops_update_setting('max_open_complaints_per_account', '5.5', %L)$q$,
  current_setting('t.complaints')), 'setting_out_of_range');
select pg_temp.refused(format($q$select public.ops_update_setting('max_open_complaints_per_account', '"6"', %L)$q$,
  current_setting('t.complaints')), 'setting_out_of_range');
select pg_temp.refused(format($q$select public.ops_update_setting('max_open_complaints_per_account', %L, %L)$q$,
  current_setting('t.complaints'), current_setting('t.complaints')), 'setting_unchanged');
do $$
declare
  v jsonb;
  v_new integer := case when current_setting('t.complaints')::integer = 6 then 7 else 6 end;
begin
  v := public.ops_update_setting('max_open_complaints_per_account', to_jsonb(v_new),
                                 current_setting('t.complaints')::jsonb);
  assert (v ->> 'value')::integer = v_new, 'settings: changed';
  -- A second administrator who saw the old value is refused.
  perform pg_temp.refused(format($q$select public.ops_update_setting('max_open_complaints_per_account', '9', %L)$q$,
    current_setting('t.complaints')), 'setting_changed_meanwhile');
end
$$;
reset role;
do $$ begin
  assert exists (select 1 from private.audit_log a
                 where a.id > current_setting('t.audit_from')::bigint and a.table_name = 'app_settings'
                   and a.row_key = 'max_open_complaints_per_account'
                   and a.old_row -> 'value' = current_setting('t.complaints')::jsonb
                   and a.new_row -> 'value' <> current_setting('t.complaints')::jsonb),
    'settings: in the audit log, old and new';
  -- Every protected setting holds what it held before the suite.
  assert not exists (select 1 from pg_temp.protected_settings p
                     join public.app_settings s on s.key = p.key
                     where s.value is distinct from (current_setting('t.settings_before')::jsonb -> p.key)),
    'settings: no protected setting changed';
  assert not exists (select 1 from private.audit_log a
                     where a.id > current_setting('t.audit_from')::bigint and a.table_name = 'app_settings'
                       and a.row_key in (select key from pg_temp.protected_settings)
                       and a.actor_id is not null),
    'settings: no protected setting was written by a person';
  -- And no other function of this workstream writes the settings table.
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (select fn from pg_temp.ops_functions)
      and p.prosrc ~* '(update|insert into|delete from)\s+public\.app_settings'),
    'settings: only ops_update_setting writes them';
end $$;

-- ═══ 7. Warehouse locations ════════════════════════════════════════════════

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
  l jsonb;
begin
  v := public.ops_warehouse_locations();
  assert exists (select 1 from jsonb_array_elements(v) w where w ->> 'code' = 'SJO1'
                 and jsonb_array_length(w -> 'locations') > 0),
    'locations: listed';
  assert not exists (select 1 from jsonb_array_elements(v) w where w ->> 'code' = 'HIG-HER'),
    'locations: only Yuntera''s warehouses';

  l := public.ops_create_location(current_setting('t.platform')::uuid, ' z-41-01-a ', 'storage');
  assert l ->> 'code' = 'Z-41-01-A' and (l ->> 'active')::boolean and (l ->> 'units')::integer = 0,
    format('locations: created %s', l);
  perform pg_temp.remember('location', l ->> 'id');
  l := public.ops_create_location(current_setting('t.platform')::uuid, 'Z-41-01-B', 'pick');
  perform pg_temp.remember('location_b', l ->> 'id');
  l := public.ops_rename_location((l ->> 'id')::uuid, 'Z-41-02-B');
  assert l ->> 'code' = 'Z-41-02-B' and l ->> 'previous_code' = 'Z-41-01-B', 'locations: renamed';
end
$$;
select pg_temp.refused(format($q$select public.ops_create_location(%L, 'Z-41-01-A', 'storage')$q$, current_setting('t.platform')), 'location_code_taken');
select pg_temp.refused(format($q$select public.ops_create_location(%L, 'Z4101A', 'storage')$q$, current_setting('t.platform')), 'location_code_invalid');
select pg_temp.refused(format($q$select public.ops_create_location(%L, 'Z-41-03-A', 'packing')$q$, current_setting('t.platform')), 'location_kind_invalid');
select pg_temp.refused(format($q$select public.ops_create_location(%L, 'Z-41-03-A', 'storage')$q$,
  (select id from public.warehouses where code = 'HIG-HER')), 'warehouse_not_found');
select pg_temp.refused(format($q$select public.ops_rename_location(%L, 'Z-41-01-A')$q$, current_setting('t.location_b')), 'location_code_taken');
select pg_temp.refused(format($q$select public.ops_set_location_active(%L, false)$q$,
  (select id from public.warehouse_locations where warehouse_id = current_setting('t.platform')::uuid and code = 'REC-01')),
  'location_not_editable');
reset role;

-- The warehouse offers the new location at once.
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  assert exists (select 1 from public.wms_locations(current_setting('t.platform')::uuid) w
                 where w.code = 'Z-41-01-A'), 'locations: offered to the warehouse';
end $$;
reset role;

-- Holding stock, or named in an open task: not switched off; the refusal says
-- how many units. (Fixtures: stock put there, a pick task pointed at it.)
insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
select current_setting('t.location')::uuid, l.sku_id, l.seller_id, 3
from public.stock_levels l where l.warehouse_id = current_setting('t.platform')::uuid limit 1;
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.refused_detail(format($q$select public.ops_set_location_active(%L, false)$q$,
           current_setting('t.location')), 'location_has_stock') = '3',
    'locations: refused with the units there';
end $$;
reset role;
delete from public.bin_stock where location_id = current_setting('t.location')::uuid;
update public.pick_tasks set location_id = current_setting('t.location')::uuid
where id = (select t.id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
            where s.id = current_setting('t.ship_a')::uuid limit 1);
update public.pick_tasks set status = 'open'
where location_id = current_setting('t.location')::uuid;
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.refused_detail(format($q$select public.ops_set_location_active(%L, false)$q$,
           current_setting('t.location')), 'location_has_open_tasks') = '1',
    'locations: refused while a task names it';
  perform pg_temp.refused(format($q$select public.ops_rename_location(%L, 'Z-41-09-A')$q$,
    current_setting('t.location')), 'location_has_open_tasks');
end $$;
reset role;
update public.pick_tasks set status = 'done' where location_id = current_setting('t.location')::uuid;
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  l jsonb;
begin
  l := public.ops_set_location_active(current_setting('t.location')::uuid, false);
  assert not (l ->> 'active')::boolean, 'locations: switched off';
  perform pg_temp.refused(format($q$select public.ops_set_location_active(%L, false)$q$,
    current_setting('t.location')), 'location_unchanged');
end
$$;
reset role;
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  assert not exists (select 1 from public.wms_locations(current_setting('t.platform')::uuid) w
                     where w.code = 'Z-41-01-A'), 'locations: no longer offered';
end $$;
reset role;
-- And no stock goes into it any more, by any way.
do $$ begin
  perform pg_temp.refused(format(
    $q$insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
       select %L, l.sku_id, l.seller_id, 1 from public.stock_levels l where l.warehouse_id = %L limit 1$q$,
    current_setting('t.location'), current_setting('t.platform')), 'location_not_found');
end $$;
select pg_temp.login('comprador3@yuntera.example');
select public.ops_set_location_active(current_setting('t.location')::uuid, true);
reset role;
-- Units picked from it into a parcel still being picked: not switched off,
-- because cancelling that order puts them back on this shelf. (Fixture: an
-- order of the suite's own, its pick task pointed at the location, picked.)
select pg_temp.remember('order_d', pg_temp.place('opsrutas@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ops-165-d')::text);
select pg_temp.pay(current_setting('t.order_d')::uuid);
select pg_temp.remember('ship_d', pg_temp.shipment(current_setting('t.order_d')::uuid, 'platform')::text);
select pg_temp.act('bodega@yuntera.example');
select public.wms_start_picking(current_setting('t.ship_d')::uuid);
select pg_temp.logout();
update public.pick_tasks set location_id = current_setting('t.location')::uuid
where shipment_id = current_setting('t.ship_d')::uuid;
insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
select current_setting('t.location')::uuid, t.sku_id, t.seller_id, sum(t.quantity)
from public.pick_tasks t where t.shipment_id = current_setting('t.ship_d')::uuid
group by t.sku_id, t.seller_id;
select pg_temp.act('bodega@yuntera.example');
do $$
declare
  t record;
begin
  for t in select pt.id, pt.quantity, k.code from public.pick_tasks pt
           join public.skus k on k.id = pt.sku_id where pt.shipment_id = current_setting('t.ship_d')::uuid loop
    perform public.wms_confirm_pick(t.id, t.quantity, null, t.code);
  end loop;
end $$;
select pg_temp.logout();
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.ship_d')::uuid) = 'picking'
         and (select coalesce(sum(quantity), 0) from public.bin_stock
              where location_id = current_setting('t.location')::uuid) = 0,
    'fixture: D picked from the location, still being picked, the shelf empty';
end $$;
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.refused_detail(format($q$select public.ops_set_location_active(%L, false)$q$,
           current_setting('t.location')), 'location_has_picked_units') = '1',
    'locations: refused while picked units may come back';
  assert (select (l ->> 'picked_units')::integer from jsonb_array_elements(public.ops_warehouse_locations()) w,
          jsonb_array_elements(w -> 'locations') l where l ->> 'id' = current_setting('t.location')) = 1,
    'locations: the screen shows them';
end $$;
reset role;
-- And the order can still be cancelled: the units go back to the shelf.
select private.cancel_order_internal(current_setting('t.order_d')::uuid, 'Cliente pidió cancelar');
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.ship_d')::uuid) = 'cancelled'
         and (select sum(quantity) from public.bin_stock where location_id = current_setting('t.location')::uuid) = 1,
    'locations: the cancelled order put its units back';
end $$;
delete from public.bin_stock where location_id = current_setting('t.location')::uuid;

-- The last storage or picking location of a warehouse stays on (fixture: the
-- others switched off).
update public.warehouse_locations set active = false
where warehouse_id = current_setting('t.platform')::uuid and kind in ('storage', 'pick')
  and id <> current_setting('t.location')::uuid;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_set_location_active(%L, false)$q$, current_setting('t.location')),
  'location_last_active');
reset role;
do $$ begin
  assert (select count(*) from private.audit_log a
          where a.id > current_setting('t.audit_from')::bigint and a.table_name = 'warehouse_locations'
            and a.row_key in (current_setting('t.location'), current_setting('t.location_b'))) = 5,
    'locations: each change is in the audit log';
end $$;

-- ═══ 8. Stuck routes ═══════════════════════════════════════════════════════

select pg_temp.remember('code_a', pg_temp.code(current_setting('t.order_a')::uuid));
select pg_temp.remember('code_b', pg_temp.code(current_setting('t.order_b')::uuid));
select pg_temp.remember('cod_b', (select cod_amount_minor::text from public.route_stops
                                  where id = current_setting('t.stop_b')::uuid));
do $$ begin
  assert current_setting('t.cod_b')::bigint > 0, 'fixture: the cash of B is planned on its stop';
end $$;

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v_doc text;
  v jsonb;
  r jsonb;
begin
  v := public.ops_open_routes();
  select e into r from jsonb_array_elements(v) e where e ->> 'route_id' = current_setting('t.route_one');
  assert r ->> 'status' = 'in_progress' and (r ->> 'open_stops')::integer = 2
         and jsonb_array_length(r -> 'stops') = 2,
    format('routes: listed %s', r);
  -- Never a delivery code, a recipient's name or phone. A code counts as a
  -- value or a number of its own, not as four digits inside an id, a time or
  -- a route code (a random code matched those by chance now and then).
  v_doc := regexp_replace(r::text,
             '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9:.]+([+-][0-9:]+|Z)?)?|R-[0-9]+',
             ' ', 'gi');
  assert v_doc !~ ('(?<![0-9A-Za-z])' || current_setting('t.code_a') || '(?![0-9A-Za-z])')
         and v_doc !~ ('(?<![0-9A-Za-z])' || current_setting('t.code_b') || '(?![0-9A-Za-z])')
         and position('Prueba Rutas' in r::text) = 0 and r::text !~ 'pin|recipient|phone',
    'routes: no delivery code, name or phone';
end
$$;
reset role;
-- A wrong reason, a stop at the door, a stop delivered.
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_remove_route_stop(%L, 'no')$q$, current_setting('t.stop_a')), 'reason_required');
select pg_temp.refused(format($q$select public.ops_remove_route_stop(%L, 'Parada de otra ruta')$q$, gen_random_uuid()), 'stop_not_found');
reset role;
select pg_temp.act('repartidor@yuntera.example');
select public.driver_arrive(current_setting('t.stop_a')::uuid);
select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_remove_route_stop(%L, 'El cliente llamó a cancelar')$q$,
  current_setting('t.stop_a')), 'stop_attempt_in_progress');
reset role;
do $$ begin
  assert (pg_temp.door(current_setting('t.stop_a')::uuid, pg_temp.code(current_setting('t.order_a')::uuid)) ->> 'ok')::boolean,
    'fixture: A delivered';
end $$;
select pg_temp.remember('ledger_before', (select count(*)::text from public.ledger_transactions
  where order_id in (current_setting('t.order_a')::uuid, current_setting('t.order_b')::uuid,
                     current_setting('t.order_c')::uuid)));
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_remove_route_stop(%L, 'Ya no hace falta')$q$,
  current_setting('t.stop_a')), 'stop_already_closed');
-- A route with a stop still out cannot be closed; how many are out is said.
do $$ begin
  assert pg_temp.refused_detail(format($q$select public.ops_close_route(%L, 'Ruta detenida')$q$,
           current_setting('t.route_one')), 'route_has_open_stops') = '1',
    'routes: not closed with a stop out';
end $$;

-- B, cash on delivery, already with the driver: off the route, back to
-- waiting, no attempt counted, nothing told to the shopper as a failure.
do $$
declare
  v jsonb;
begin
  v := public.ops_remove_route_stop(current_setting('t.stop_b')::uuid, '  El camión se varó en la ruta  ');
  assert v ->> 'shipment_status' = 'delivery_failed' and (v ->> 'open_stops')::integer = 0,
    format('routes: B removed %s', v);
end
$$;
reset role;
do $$
declare
  s public.route_stops%rowtype;
begin
  select * into s from public.route_stops where id = current_setting('t.stop_b')::uuid;
  assert s.status = 'skipped' and s.cod_amount_minor = 0 and s.removal_reason = 'El camión se varó en la ruta'
         and s.removed_by = (select id from auth.users where email = 'comprador3@yuntera.example'),
    format('routes: the stop is kept, skipped, with who and why %s', s);
  assert (select attempt_count from public.shipments where id = current_setting('t.ship_b')::uuid) = 0,
    'routes: no attempt counted';
  assert not exists (select 1 from private.outbox_events e
                     where e.id > current_setting('t.events_from')::bigint and e.topic = 'shipment.delivery_failed'
                       and e.payload ->> 'shipment_id' = current_setting('t.ship_b')),
    'routes: the shopper is not told of a failed delivery';
  assert not exists (select 1 from public.order_events e
                     where e.shipment_id = current_setting('t.ship_b')::uuid and e.visible_to_customer
                       and e.to_status = 'delivery_failed'),
    'routes: nor does the order''s history show one';
  assert (select status from public.orders where id = current_setting('t.order_b')::uuid) = 'shipped'
         and (select status from public.payments where order_id = current_setting('t.order_b')::uuid
              order by created_at desc limit 1) = 'pending',
    'routes: the order and its payment are as they were';
end
$$;

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
begin
  -- On dispatch's list again.
  assert exists (select 1 from jsonb_array_elements(public.ops_dispatch_board() -> 'ready') e
                 where e ->> 'shipment_id' = current_setting('t.ship_b')),
    'routes: B waits for a route again';
  v := public.ops_close_route(current_setting('t.route_one')::uuid, 'Camión varado; parada retirada');
  assert v ->> 'status' = 'completed', format('routes: closed %s', v);
end
$$;
select pg_temp.refused(format($q$select public.ops_close_route(%L, 'Otra vez cerrada')$q$, current_setting('t.route_one')), 'route_closed');
select pg_temp.refused(format($q$select public.ops_remove_route_stop(%L, 'Después de cerrar')$q$, current_setting('t.stop_b')), 'route_closed');
-- C, on a route not started: back to packed; the route is cancelled when closed.
do $$
declare
  v jsonb;
begin
  v := public.ops_remove_route_stop(current_setting('t.stop_c')::uuid, 'Cliente pidió otro día');
  assert v ->> 'shipment_status' = 'packed', format('routes: C removed %s', v);
  v := public.ops_close_route(current_setting('t.route_two')::uuid, 'Sin paradas que hacer');
  assert v ->> 'status' = 'cancelled', format('routes: never started, cancelled %s', v);
end
$$;
reset role;
do $$ begin
  assert (select cod_expected_minor from public.driver_settlements where route_id = current_setting('t.route_one')::uuid) = 0,
    'routes: the cash count opens for what was collected (nothing: A was paid by card)';
  assert (select count(*) from public.ledger_transactions
          where order_id in (current_setting('t.order_a')::uuid, current_setting('t.order_b')::uuid,
                             current_setting('t.order_c')::uuid))::text = current_setting('t.ledger_before'),
    'routes: the ledger is untouched';
  assert (select count(*) from private.audit_log a
          where a.id > current_setting('t.audit_from')::bigint
            and a.action in ('stop_removed', 'route_closed')) = 4
         and not exists (select 1 from private.audit_log a
                         where a.id > current_setting('t.audit_from')::bigint
                           and a.action in ('stop_removed', 'route_closed')
                           and (coalesce(a.old_row::text, '') || a.new_row::text) ~ 'Prueba|varó|\+506'),
    'routes: in the audit log, without names, phones or the reason typed';
end $$;

-- The driver sees the stop as skipped on the route they finished.
select pg_temp.login('repartidor@yuntera.example');
do $$
declare
  r jsonb;
begin
  select e into r from jsonb_array_elements(public.driver_today() -> 'routes') e
  where e ->> 'route_id' = current_setting('t.route_one');
  assert r ->> 'status' = 'completed'
         and exists (select 1 from jsonb_array_elements(r -> 'stops') s
                     where s ->> 'stop_id' = current_setting('t.stop_b') and s ->> 'status' = 'skipped'),
    format('routes: the driver sees it skipped %s', r);
  assert not exists (select 1 from jsonb_array_elements(public.driver_today() -> 'routes') e
                     where e ->> 'route_id' = current_setting('t.route_two')),
    'routes: the cancelled route is gone from the driver''s day';
end
$$;
reset role;

-- B goes on a new route, with its cash planned again.
select pg_temp.act('central@yuntera.example');
select pg_temp.remember('route_three', public.ops_create_route(
  private.cr_today(), current_setting('t.platform')::uuid,
  jsonb_build_array(jsonb_build_object('shipment_id', current_setting('t.ship_b'))))::text);
select pg_temp.logout();
do $$ begin
  assert (select rs.cod_amount_minor from public.route_stops rs
          where rs.route_id = current_setting('t.route_three')::uuid)::text = current_setting('t.cod_b'),
    'routes: the cash goes with the parcel to its next route';
end $$;

select 'ok' as console_operations;
rollback;
