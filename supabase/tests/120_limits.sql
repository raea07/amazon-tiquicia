-- Limits against abuse and the authorisation gaps of the review of
-- 21 November 2026 (supabase/migrations/20261121083000_limits.sql).
--
-- Each section is named after the finding it proves fixed, starts from the
-- superuser with nobody signed in, and sets up what it needs itself, so it can
-- also be run alone. Each limit is tested at its edge (the last thing allowed
-- and the first refused) and against the honest path.

begin;
\ir _helpers.sql

-- Back to the superuser with nobody signed in.
create function pg_temp.logout() returns void
language sql as $$ select set_config('request.jwt.claims', '', true) $$;

-- Runs a statement that must be refused with the given code.
create function pg_temp.refused(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
end;
$$;

-- Runs a statement the role has no privilege for.
create function pg_temp.denied(p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not denied: %', p_sql;
exception when insufficient_privilege then
  null;
end;
$$;

-- Calls every function of the API whose name starts with a prefix, as the
-- current role, with `p_seller_id` (when it has one) set to the given shop,
-- every argument named in `p_ids` set to that value (real ids of things the
-- account used to reach, so that "not found" proves the access check, not a
-- missing row), and every other argument null. Each must refuse with one of
-- the allowed codes: for an account that lost its access, nothing may come back.
create function pg_temp.all_refused(p_prefix text, p_seller uuid, p_allowed text[], p_except text[] default '{}',
                                    p_ids jsonb default '{}')
returns integer
language plpgsql as $$
declare
  f record;
  v_args text;
  v_count integer := 0;
begin
  for f in
    select p.oid, p.proname, p.proargnames, p.proargtypes, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like p_prefix || '%'
      and not p.proname = any (p_except)
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by p.proname
  loop
    select string_agg(
      case when f.proargnames[i + 1] = 'p_seller_id' and p_seller is not null
           then format('%L::uuid', p_seller)
           when p_ids ? f.proargnames[i + 1]
           then format('%L::%s', p_ids ->> f.proargnames[i + 1], format_type(f.proargtypes[i], null))
           else format('null::%s', format_type(f.proargtypes[i], null)) end, ', ' order by i)
    into v_args
    from generate_series(0, f.pronargs - 1) i;
    begin
      execute format('select public.%I(%s)', f.proname, coalesce(v_args, ''));
      raise exception 'answered: %', f.proname;
    exception when others then
      if not sqlerrm = any (p_allowed) then
        raise exception '% gave "%" (allowed: %)', f.proname, sqlerrm, p_allowed;
      end if;
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- These helpers are called while impersonating, so the API roles need to
-- reach the temporary schema.
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.refused(text, text), pg_temp.denied(text),
  pg_temp.all_refused(text, uuid, text[], text[], jsonb), pg_temp.remember(text, text), pg_temp.offer(text, text)
  to authenticated, anon;

-- Sets a limit for the rest of this transaction.
create function pg_temp.set_limit(p_key text, p_value integer) returns void
language sql as $$
  update public.app_settings set value = to_jsonb(p_value) where key = p_key;
$$;

select pg_temp.remember('uid_central', (select id::text from auth.users where email = 'central@yuntera.example'));
select pg_temp.remember('uid_comprador', (select id::text from auth.users where email = 'comprador@yuntera.example'));
select pg_temp.remember('uid_comprador2', (select id::text from auth.users where email = 'comprador2@yuntera.example'));
select pg_temp.remember('uid_comprador3', (select id::text from auth.users where email = 'comprador3@yuntera.example'));
select pg_temp.remember('uid_repartidor', (select id::text from auth.users where email = 'repartidor@yuntera.example'));
select pg_temp.remember('uid_sendero', (select id::text from auth.users where email = 'sendero@yuntera.example'));
select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('sendero', (select id::text from public.sellers where slug = 'tienda-sendero'));
select pg_temp.remember('bazar', (select id::text from public.sellers where slug = 'bazar-nuevo'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('product', (select id::text from public.products where slug = 'licuadora-volcan-600w'));
select pg_temp.remember('product2', (select id::text from public.products where slug = 'hamaca-algodon-doble'));
select pg_temp.remember('product3', (select id::text from public.products where slug = 'audifonos-inalambricos-nimbo-aire'));
select pg_temp.remember('draft_product', (select id::text from public.products where status = 'pending_review' limit 1));

-- ═══ FA-4: a driver who is not active gets no recipient's data ══════════════

select pg_temp.login('repartidor@yuntera.example');
do $$
declare
  d jsonb := public.driver_today();
begin
  -- The honest path: an active driver sees today's stops, with what is needed at the door.
  assert jsonb_array_length(d -> 'routes') >= 1
     and (d #>> '{routes,0,stops,0,recipient_name}') is not null, 'an active driver sees their stops';
end
$$;
reset role; select pg_temp.logout();

update public.drivers set status = 'suspended'
where user_id = current_setting('t.uid_repartidor')::uuid;
select pg_temp.remember('carlos_ids', (
  select jsonb_build_object('p_route_id', r.id, 'p_stop_id', s.id)::text
  from public.routes r join public.route_stops s on s.route_id = r.id
  where r.code = 'R-1001' order by s.sequence limit 1));

select pg_temp.login('repartidor@yuntera.example');
do $$
declare
  d jsonb := public.driver_today();
  n integer;
begin
  assert d #>> '{driver,status}' = 'suspended', 'they still see their own record';
  assert d -> 'routes' = '[]'::jsonb, format('FA-4: a suspended driver gets no routes: %s', d -> 'routes');
  assert position('María' in d::text) = 0 and position('+5068888' in d::text) = 0,
    'and no recipient''s name or phone anywhere in the answer';
  -- Every other driver function refuses, also when given the driver's own
  -- route and stop (R-1001, which they completed earlier).
  n := pg_temp.all_refused('driver_', null,
         array['route_not_found', 'stop_not_found', 'forbidden', 'not_a_driver'], array['driver_today'],
         current_setting('t.carlos_ids')::jsonb);
  assert n >= 5, format('the driver functions were tried (%s)', n);
  assert (select count(*) from public.route_stops) = 0, 'and the table shows nothing either';
end
$$;
reset role; select pg_temp.logout();

-- ═══ FA-M2: their unfinished routes go back to dispatch ════════════════════

-- Setup: Luis (an active driver) gets an assigned route that has not started,
-- and Carlos's route in progress has one stop done and one to go. Then
-- Carlos is deactivated.
update public.drivers set status = 'active'
where user_id in (select id from auth.users where email in ('repartidor@yuntera.example', 'repartidor2@yuntera.example'));

select pg_temp.login('central@yuntera.example');
select pg_temp.remember('assigned_route', public.ops_create_route(
  (now() at time zone 'America/Costa_Rica')::date, current_setting('t.depot')::uuid,
  jsonb_build_array(jsonb_build_object('shipment_id',
    (select id from public.shipments where tracking_code = 'YT500013'), 'sequence', 1)),
  (select id from public.drivers where full_name = 'Carlos Méndez Porras'))::text);
reset role; select pg_temp.logout();

-- The route with the stops of the seed's route R-1003 still to do (the
-- section above sent it back to dispatch): Carlos drives it again.
select pg_temp.remember('live_route', (
  select s.route_id::text from public.route_stops s join public.routes r on r.id = s.route_id
  where s.status = 'pending' and s.cod_amount_minor = 2340000
    and r.status in ('draft', 'assigned', 'in_progress')));
select pg_temp.login('central@yuntera.example');
do $$
begin
  if (select status from public.routes where id = current_setting('t.live_route')::uuid) = 'draft' then
    perform public.ops_assign_route(current_setting('t.live_route')::uuid,
      (select id from public.drivers where full_name = 'Carlos Méndez Porras'));
  end if;
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login('repartidor@yuntera.example');
do $$
begin
  if (select status from public.routes where id = current_setting('t.live_route')::uuid) = 'assigned' then
    perform public.driver_start_route(current_setting('t.live_route')::uuid);
  end if;
end
$$;
reset role; select pg_temp.logout();
select pg_temp.remember('first_stop', (
  select s.id::text from public.route_stops s
  where s.route_id = current_setting('t.live_route')::uuid and s.cod_amount_minor = 0));
select pg_temp.remember('first_pin', (
  select o.delivery_pin from public.route_stops s join public.shipments sh on sh.id = s.shipment_id
  join public.orders o on o.id = sh.order_id where s.id = current_setting('t.first_stop')::uuid));

select pg_temp.login('repartidor@yuntera.example');
do $$
begin
  assert (public.driver_complete_stop(current_setting('t.first_stop')::uuid,
            current_setting('t.first_pin'), 'María') ->> 'ok')::boolean, 'one stop delivered';
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('central@yuntera.example');
select public.ops_set_driver_status(
  (select id from public.drivers where full_name = 'Carlos Méndez Porras'), 'offboarded');
do $$
declare
  v_carlos uuid := (select id from public.drivers where full_name = 'Carlos Méndez Porras');
  v_luis uuid := (select id from public.drivers where full_name = 'Luis Alvarado Cruz');
  v_assigned public.routes%rowtype;
  v_live public.routes%rowtype;
  v_new public.routes%rowtype;
  v_released jsonb := public.ops_released_routes();
begin
  select * into v_assigned from public.routes where id = current_setting('t.assigned_route')::uuid;
  assert v_assigned.status = 'draft' and v_assigned.driver_id is null
     and v_assigned.released_from_driver_id = v_carlos and v_assigned.release_reason = 'driver_offboarded',
    format('FA-M2: the route not started is back in dispatch: %s', row_to_json(v_assigned));

  select * into v_live from public.routes where id = current_setting('t.live_route')::uuid;
  assert v_live.status = 'completed', 'the route being driven is closed with what was done';
  assert (select count(*) from public.route_stops where route_id = v_live.id) = 1
     and (select status from public.route_stops where route_id = v_live.id) = 'delivered',
    'only the delivered stop stays on it';
  assert exists (select 1 from public.driver_settlements where route_id = v_live.id and driver_id = v_carlos),
    'and the cash count opens for the driver who drove it';

  select * into v_new from public.routes where released_from_route_id = v_live.id;
  assert v_new.status = 'draft' and v_new.driver_id is null
     and (select count(*) from public.route_stops where route_id = v_new.id and status = 'pending') = 1,
    'the stop still to do moved to a new route waiting for a driver';
  assert (select cod_amount_minor from public.route_stops where route_id = v_new.id) = 2340000,
    'with the cash it must collect';

  -- Staff see it happened.
  assert exists (select 1 from jsonb_array_elements(v_released) r
                 where (r ->> 'route_id')::uuid = v_new.id and r ->> 'from_route_code' = v_live.code
                   and (r ->> 'parcels_out')::integer = 1 and r ->> 'from_driver_name' = 'Carlos Méndez Porras')
     and exists (select 1 from jsonb_array_elements(v_released) r
                 where (r ->> 'route_id')::uuid = v_assigned.id and r ->> 'reason' = 'driver_offboarded'),
    format('the dispatch screen lists both: %s', v_released);

  -- And another driver can finish the work.
  perform public.ops_assign_route(v_new.id, v_luis);
  perform public.ops_assign_route(v_assigned.id, v_luis);
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('repartidor2@yuntera.example');
do $$
declare
  v_route uuid := (select id from public.routes where released_from_route_id = current_setting('t.live_route')::uuid);
  v_stop uuid;
  v_pin text;
begin
  assert exists (select 1 from jsonb_array_elements(public.driver_today() -> 'routes') r
                 where (r ->> 'route_id')::uuid = v_route), 'the new driver sees the route';
  perform public.driver_start_route(v_route);
  select id into v_stop from public.route_stops where route_id = v_route;
  perform set_config('t.new_stop', v_stop::text, true);
end
$$;
reset role; select pg_temp.logout();
select pg_temp.remember('new_pin', (
  select o.delivery_pin from public.route_stops s join public.shipments sh on sh.id = s.shipment_id
  join public.orders o on o.id = sh.order_id where s.id = current_setting('t.new_stop')::uuid));
select pg_temp.login('repartidor2@yuntera.example');
do $$
begin
  assert (public.driver_complete_stop(current_setting('t.new_stop')::uuid, current_setting('t.new_pin'),
            'María', 2340000) ->> 'ok')::boolean, 'and delivers it, collecting the cash';
end
$$;
reset role; select pg_temp.logout();

-- ═══ Access ends at once: staff, warehouse workers, shop members ═══════════

-- A staff member switched off has a shopper's access, in every staff function.
select pg_temp.login('central@yuntera.example');
select public.ops_set_staff('comprador2@yuntera.example', 'ops', true);
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
do $$ begin assert public.ops_overview() is not null, 'as ops staff they work'; end $$;
reset role; select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select public.ops_set_staff('comprador2@yuntera.example', 'ops', false);
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  n integer := pg_temp.all_refused('ops_', null, array['forbidden']);
begin
  assert n >= 35, format('every staff function refuses a deactivated member (%s tried)', n);
  perform pg_temp.refused('select public.audit_entries(null, 10)', 'forbidden');
end
$$;
reset role; select pg_temp.logout();

-- A warehouse worker removed from the warehouse. Real ids from their
-- warehouse are passed, so a refusal is the access check, not a missing row.
select pg_temp.remember('depot_ids', jsonb_build_object(
  'p_warehouse_id', current_setting('t.depot'),
  'p_shipment_id', (select id from public.shipments where origin_warehouse_id = current_setting('t.depot')::uuid
                    order by created_at limit 1),
  'p_task_id', (select t.id from public.pick_tasks t join public.shipments sh on sh.id = t.shipment_id
                where sh.origin_warehouse_id = current_setting('t.depot')::uuid limit 1),
  'p_location_id', (select id from public.warehouse_locations
                    where warehouse_id = current_setting('t.depot')::uuid limit 1),
  'p_sku_id', (select sku_id from public.stock_levels
               where warehouse_id = current_setting('t.depot')::uuid limit 1))::text);
select pg_temp.login('bodega@yuntera.example');
do $$ begin assert public.wms_board(current_setting('t.depot')::uuid) is not null, 'at work'; end $$;
reset role; select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select public.ops_set_warehouse_staff(current_setting('t.depot')::uuid, 'bodega@yuntera.example', null);
reset role; select pg_temp.logout();
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  n integer := pg_temp.all_refused('wms_', null,
                 array['forbidden', 'shipment_not_found', 'task_not_found', 'location_not_found',
                       'inbound_line_not_found'], '{}', current_setting('t.depot_ids')::jsonb);
begin
  assert n >= 6, format('every warehouse function refuses (%s tried)', n);
  perform pg_temp.refused(format('select public.wms_board(%L)', current_setting('t.depot')), 'forbidden');
  perform pg_temp.refused(format('select public.wms_locations(%L)', current_setting('t.depot')), 'forbidden');
  assert (select count(*) from public.inbound_shipments) = 0, 'and the tables show nothing';
end
$$;
reset role; select pg_temp.logout();

-- A shop member who is removed. (Joining is by invitation; see DTA-6.) Real
-- ids of the shop's listings, offers, reviews, parcels and warehouse are passed.
select pg_temp.remember('tecnocasa_ids', (
  select jsonb_build_object(
    'p_product_id', o_product, 'p_offer_id', o_id, 'p_sku_id', o_sku,
    'p_review_id', (select r.id from public.reviews r where r.product_id = o_product limit 1),
    'p_shipment_id', (select sh.id from public.shipments sh
                      join public.shipment_items si on si.shipment_id = sh.id
                      join public.order_items i on i.id = si.order_item_id
                      where i.seller_id = current_setting('t.tecnocasa')::uuid limit 1),
    'p_warehouse_id', (select w.id from public.warehouses w
                       where w.seller_id = current_setting('t.tecnocasa')::uuid limit 1),
    'p_user_id', current_setting('t.uid_comprador'))::text
  from (select o.id as o_id, o.sku_id as o_sku, k.product_id as o_product
        from public.offers o join public.skus k on k.id = o.sku_id
        where o.seller_id = current_setting('t.tecnocasa')::uuid
        order by o.created_at limit 1) x));
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.remember('inv_member', public.seller_invite_member(
  current_setting('t.tecnocasa')::uuid, 'comprador3@yuntera.example', 'staff')::text);
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
select public.seller_answer_invitation(current_setting('t.inv_member')::uuid, true);
do $$ begin
  assert public.seller_overview(current_setting('t.tecnocasa')::uuid) is not null, 'a member works';
end $$;
reset role; select pg_temp.logout();
select pg_temp.login('vendedor@yuntera.example');
select public.seller_remove_member(current_setting('t.tecnocasa')::uuid,
  current_setting('t.uid_comprador3')::uuid);
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  n integer := pg_temp.all_refused('seller_', current_setting('t.tecnocasa')::uuid,
                 array['forbidden', 'offer_not_found', 'listing_not_found', 'review_not_found',
                       'shipment_not_found', 'edit_not_found', 'invitation_not_found',
                       'shop_change_not_found', 'owner_only', 'member_not_found', 'not_authenticated',
                       -- Codes of functions that product photos (082700) and
                       -- notifications (082600) add, once merged.
                       'photo_not_found', 'seller_not_found'],
                 array['seller_answer_invitation'], current_setting('t.tecnocasa_ids')::jsonb);
begin
  assert n >= 25, format('every seller function refuses a removed member (%s tried)', n);
  assert (select count(*) from public.seller_private) = 0, 'and the shop''s private details are gone';
end
$$;
reset role; select pg_temp.logout();

-- A suspended shop: reads and finishing what it owes, nothing new in a queue
-- or in front of shoppers.
select pg_temp.login('central@yuntera.example');
select public.ops_set_seller_status(current_setting('t.sendero')::uuid, 'suspended', 'Revisión de documentos.');
reset role; select pg_temp.logout();
select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.sendero')::uuid;
  v_offer uuid := pg_temp.offer('hamaca-algodon-doble');
begin
  assert public.seller_overview(v_seller) is not null, 'a suspended shop still reads its data';
  perform pg_temp.refused(format(
    'select public.seller_create_listing(%L, ''Mesa plegable de teca'', ''hogar'', null, null, 1500000, ''seller'', 2::smallint, 900, 50, 40, 10, true)',
    v_seller), 'shop_not_active');
  perform pg_temp.refused(format(
    'select public.seller_update_listing(%L, ''Hamaca doble de algodón, nueva'', ''hogar'', null, null, 1800, 40, 30, 15)',
    current_setting('t.product2')), 'shop_not_active');
  perform pg_temp.refused(format(
    'select public.seller_create_inbound(%L, %L, %L::jsonb)', current_setting('t.depot'), v_seller,
    jsonb_build_array(jsonb_build_object('sku_id', (select sku_id from public.offers where id = v_offer), 'quantity', 5))),
    'shop_not_active');
  perform pg_temp.refused(format('select public.seller_update_offer(%L, 2900000, ''active'')', v_offer),
    'shop_not_active');
  -- Taking an offer off sale is always possible.
  perform public.seller_update_offer(v_offer, 2900000, 'paused');
  -- A draft can still be prepared.
  assert public.seller_create_listing(v_seller, 'Mesa plegable de teca', 'hogar', null, null, 1500000,
           'seller', 2::smallint, 900, 50, 40, 10, false) ->> 'product_id' is not null, 'a draft is fine';
end
$$;
reset role; select pg_temp.logout();

-- ═══ FA-5: shop registration ═══════════════════════════════════════════════

select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  v_first uuid;
begin
  -- Bazar Nuevo's owner is registered with cédula 109870654 (pending). A
  -- stranger typing it learns nothing: the registration is accepted like any
  -- other, waits for verification, and staff see the clash.
  v_first := public.create_seller('Artesanías del Valle', 'artesanias-del-valle', 'Andrés Mora Chaves',
               'fisica', '109870654', 'andres@correo.example', '+50688881234',
               'San José, Moravia, 200 m norte del parque');
  assert v_first is not null, 'FA-5: the clash is not revealed: the answer is a shop like any other';
  perform set_config('t.squat', v_first::text, true);
  -- One shop waiting for verification per account: the second is refused.
  perform pg_temp.refused(
    'select public.create_seller(''Otra Tienda'', ''otra-tienda-abc'', ''Andrés Mora Chaves'', ''fisica'', ''109870655'', ''andres@correo.example'', ''+50688881234'', ''San José, Moravia, 200 m norte'')',
    'shop_registration_pending');
end
$$;
reset role; select pg_temp.logout();

do $$
begin
  assert (select id_number from public.seller_private where seller_id = current_setting('t.squat')::uuid) = '109870654',
    'the number is stored';
  assert (select status from public.sellers where id = current_setting('t.squat')::uuid) = 'pending',
    'and the shop waits for staff';
end
$$;

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  t record;
begin
  -- Shape and field checks, each a code (no raw constraint error).
  for t in select * from (values
    ('''Mi Tienda'', ''mi-tienda'', ''Sofía Vargas'', ''fisica'', ''12345'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'invalid_identification'),
    ('''Mi Tienda'', ''mi-tienda'', ''Sofía Vargas'', ''juridica'', ''109870654'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'invalid_identification'),
    ('''Mi Tienda'', ''mi-tienda'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''no-es-correo'', ''+50688881234'', ''San José centro, frente al parque''', 'invalid_shop_details'),
    ('''Mi Tienda'', ''mi-tienda'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''88881234'', ''San José centro, frente al parque''', 'invalid_shop_details'),
    ('''Mi Tienda'', ''Mi Tienda!'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'invalid_shop_details'),
    -- Names that imitate the platform or an active shop.
    ('''Yuntera Oficial'', ''yuntera-oficial'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'shop_name_reserved'),
    ('''Y-U-N-T-E-R-A'', ''yuntera-x'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'shop_name_reserved'),
    ('''Soporte'', ''soporte-x'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'shop_name_reserved'),
    ('''Tecno Casa'', ''tecno-casa'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'shop_name_taken'),
    ('''Yuntеra'', ''yuntera-cyr'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'shop_name_invalid'),
    -- An address another shop has.
    ('''Mi Tienda'', ''tecnocasa'', ''Sofía Vargas'', ''fisica'', ''109870611'', ''s@correo.example'', ''+50688881234'', ''San José centro, frente al parque''', 'slug_taken')
  ) v (args, code) loop
    perform pg_temp.refused('select public.create_seller(' || t.args || ')', t.code);
  end loop;
  -- A pending shop's name is not public, so it does not block (nor reveal) anything.
  perform set_config('t.verified_clash', public.create_seller(
    'Bazar Nuevo', 'bazar-nuevo-2', 'Sofía Vargas Rojas', 'juridica', '3101700202',
    's@correo.example', '+50688881234', 'San José centro, frente al parque')::text, true);
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('central@yuntera.example');
do $$
declare
  c jsonb := public.ops_seller_id_clashes();
begin
  assert exists (select 1 from jsonb_array_elements(c) x
                 where (x ->> 'seller_id')::uuid = current_setting('t.squat')::uuid
                   and x #>> '{shared_with,0,trade_name}' = 'Bazar Nuevo'),
    format('staff see the clash: %s', c);
  -- The second shop with TecnoCasa's (verified) number can never be verified.
  perform pg_temp.refused(format('select public.ops_set_seller_status(%L, ''active'')',
    current_setting('t.verified_clash')), 'identification_verified_elsewhere');
  -- The honest path: once staff verify the first registration, the account may register another.
  perform public.ops_set_seller_status(current_setting('t.squat')::uuid, 'active', 'Verificada con Hacienda.');
end
$$;
reset role; select pg_temp.logout();
do $$
begin
  begin
    update public.seller_private set kyc_status = 'verified'
    where seller_id = current_setting('t.verified_clash')::uuid;
    raise exception 'two verified shops with one number';
  exception when unique_violation then null;
  end;
end
$$;
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  perform set_config('t.second_shop', public.create_seller(
    'Otra Tienda', 'otra-tienda-abc', 'Andrés Mora Chaves', 'fisica', '1-0987-0655',
    'andres@correo.example', '+506 8888-1234', 'San José, Moravia, 200 m norte')::text, true);
  assert current_setting('t.second_shop') <> '', 'with the first one decided, a second registration is accepted';
end
$$;
reset role; select pg_temp.logout();
do $$
begin
  assert (select id_number = '109870655' and contact_phone = '+50688881234'
          from public.seller_private where seller_id = current_setting('t.second_shop')::uuid),
    'the number and phone are stored without the separators people type';
end
$$;

-- ═══ FA-6: an unapproved shop cannot fill the review queue or the dock ═════

select pg_temp.login('bazar@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.bazar')::uuid;
begin
  perform pg_temp.refused(format(
    'select public.seller_create_listing(%L, ''Jarrón de cerámica azul'', ''hogar'', null, null, 1200000, ''seller'', 2::smallint, 900, 30, 20, 20, true)',
    v_seller), 'shop_not_approved');
  perform pg_temp.refused(format(
    'select public.seller_create_inbound(%L, %L, ''[{"sku_id": "00000000-0000-4000-8000-000000000001", "quantity": 100000}]''::jsonb)',
    current_setting('t.depot'), v_seller), 'shop_not_approved');
  -- Drafts stay possible, so the shop is ready the day it is approved.
  assert public.seller_create_listing(v_seller, 'Jarrón de cerámica azul', 'hogar', null, null, 1200000,
           'seller', 2::smallint, 900, 30, 20, 20, false) ->> 'product_id' is not null,
    'FA-6: a pending shop keeps drafts';
end
$$;
reset role; select pg_temp.logout();

-- An active shop: caps on listings in review and on drafts, at their edge.
select pg_temp.set_limit('max_listings_in_review_per_seller',
  private.listings_in_review(current_setting('t.tecnocasa')::uuid) + 1);
select pg_temp.set_limit('max_draft_listings_per_seller',
  (select count(*)::integer + 1 from public.products
   where created_by_seller_id = current_setting('t.tecnocasa')::uuid and status = 'draft'));
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  v_sql text := format(
    'select public.seller_create_listing(%L, ''Cargador USB-C de 65 W %%s'', ''electronica'', null, null, 1500000, ''platform'', 0::smallint, 300, 12, 8, 4, %%s)',
    v_seller);
begin
  assert public.seller_create_listing(v_seller, 'Cargador USB-C de 65 W uno', 'electronica', null, null,
           1500000, 'platform', 0::smallint, 300, 12, 8, 4, true) ->> 'product_id' is not null,
    'the last listing under the review cap is accepted';
  perform pg_temp.refused(format(v_sql, 'dos', 'true'), 'too_many_listings_in_review');
  assert public.seller_create_listing(v_seller, 'Cargador USB-C de 65 W tres', 'electronica', null, null,
           1500000, 'platform', 0::smallint, 300, 12, 8, 4, false) ->> 'product_id' is not null,
    'the last draft under the draft cap is accepted';
  perform pg_temp.refused(format(v_sql, 'cuatro', 'false'), 'too_many_draft_listings');
  -- An edit of a published listing also waits for review, so it counts too.
  perform pg_temp.refused(format(
    'select public.seller_update_listing(%L, ''Licuadora Volcán 600 W con vaso de vidrio'', ''hogar'', null, null, 3200, 22, 18, 40)',
    current_setting('t.product')), 'too_many_listings_in_review');
end
$$;
reset role; select pg_temp.logout();
select pg_temp.set_limit('max_listings_in_review_per_seller', 50);
select pg_temp.set_limit('max_draft_listings_per_seller', 200);

-- Inbound shipments: lines, units and open shipments, at their edge.
select pg_temp.remember('tc_sku', (select k.id::text from public.skus k join public.products p on p.id = k.product_id
                                   where p.slug = 'licuadora-volcan-600w' limit 1));
select pg_temp.remember('tc_sku2', (select k.id::text from public.skus k join public.products p on p.id = k.product_id
                                    where p.slug = 'audifonos-inalambricos-nimbo-aire' limit 1));
select pg_temp.set_limit('max_lines_per_inbound', 1);
select pg_temp.set_limit('max_open_inbounds_per_seller',
  (select count(*)::integer + 1 from public.inbound_shipments
   where seller_id = current_setting('t.tecnocasa')::uuid and status in ('draft', 'in_transit', 'receiving')));
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  v_depot uuid := current_setting('t.depot')::uuid;
  v_sku text := current_setting('t.tc_sku');
  v_sku2 text := current_setting('t.tc_sku2');
  v_call text := 'select public.seller_create_inbound(%L, %L, %L::jsonb)';
begin
  perform pg_temp.refused(format(v_call, v_depot, v_seller, jsonb_build_array(
    jsonb_build_object('sku_id', v_sku, 'quantity', 5), jsonb_build_object('sku_id', v_sku2, 'quantity', 5))),
    'invalid_lines');
  perform pg_temp.refused(format(v_call, v_depot, v_seller, jsonb_build_array(
    jsonb_build_object('sku_id', v_sku, 'quantity', 100001))), 'invalid_quantity');
  perform pg_temp.refused(format(v_call, v_depot, v_seller, jsonb_build_array(
    jsonb_build_object('sku_id', v_sku, 'quantity', 2.5))), 'invalid_quantity');
  perform pg_temp.refused(format(v_call, v_depot, v_seller, jsonb_build_array(
    jsonb_build_object('sku_id', 'no-es-un-id', 'quantity', 5))), 'invalid_lines');
  assert public.seller_create_inbound(v_depot, v_seller, jsonb_build_array(
           jsonb_build_object('sku_id', v_sku, 'quantity', 100000))) is not null,
    'the largest line and the last open shipment are accepted';
  perform pg_temp.refused(format(v_call, v_depot, v_seller, jsonb_build_array(
    jsonb_build_object('sku_id', v_sku, 'quantity', 5))), 'too_many_open_inbounds');
end
$$;
reset role; select pg_temp.logout();
select pg_temp.set_limit('max_lines_per_inbound', 100);
select pg_temp.set_limit('max_open_inbounds_per_seller', 50);

-- FA-M3: the same product twice in one shipment is a code, not a raw constraint error.
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format('select public.seller_create_inbound(%L, %L, %L::jsonb)',
  current_setting('t.depot'), current_setting('t.tecnocasa'), jsonb_build_array(
    jsonb_build_object('sku_id', current_setting('t.tc_sku'), 'quantity', 5),
    jsonb_build_object('sku_id', upper(current_setting('t.tc_sku')), 'quantity', 5))), 'invalid_lines');
reset role; select pg_temp.logout();

-- The staff screens show a page, not everything.
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  v_category uuid := (select id from public.categories where slug = 'hogar');
begin
  insert into public.products (slug, title, category_id, status, created_by_seller_id)
  select 'relleno-' || n, 'Producto de relleno ' || n, v_category, 'pending_review', v_seller
  from generate_series(1, 120) n;
  insert into public.inbound_shipments (reference, seller_id, warehouse_id, status, created_by)
  select 'IN-RELLENO-' || n, v_seller, current_setting('t.depot')::uuid, 'in_transit', null
  from generate_series(1, 120) n;
end
$$;
select pg_temp.login('central@yuntera.example');
do $$
declare
  b jsonb := public.wms_board(current_setting('t.depot')::uuid);
begin
  assert (select count(*) from public.ops_listings_for_review()) = 100, 'a page of listings in review';
  assert jsonb_array_length(b -> 'inbound') = 100 and (b ->> 'inbound_total')::integer >= 120,
    format('a page of inbound shipments, and how many there are: %s', b ->> 'inbound_total');
end
$$;
reset role; select pg_temp.logout();

-- ═══ Packages too big for the warehouse (fee tiers) ════════════════════════

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  v_listing jsonb;
begin
  -- 120 cm is the largest side the warehouse takes; 121 cm is refused there.
  v_listing := public.seller_create_listing(v_seller, 'Escalera de aluminio de 120 cm', 'hogar', null, null,
                 4500000, 'platform', 0::smallint, 6000, 120, 40, 10, false);
  assert v_listing ->> 'offer_id' is not null, 'the largest tier is accepted';
  perform set_config('t.big_listing', v_listing ->> 'product_id', true);
  perform pg_temp.refused(format(
    'select public.seller_create_listing(%L, ''Escalera de aluminio de 121 cm'', ''hogar'', null, null, 4500000, ''platform'', 0::smallint, 6000, 121, 40, 10, false)',
    v_seller), 'too_large_for_warehouse');
  -- The seller may still ship it themselves.
  assert public.seller_create_listing(v_seller, 'Escalera de aluminio de 150 cm', 'hogar', null, null,
           4500000, 'seller', 2::smallint, 6000, 150, 40, 10, false) ->> 'offer_id' is not null,
    'a seller-shipped package may be bigger';
  -- Editing the warehouse listing beyond the tier is refused too.
  perform pg_temp.refused(format(
    'select public.seller_update_listing(%L, ''Escalera de aluminio de 130 cm'', ''hogar'', null, null, 6000, 130, 40, 10, null, false)',
    current_setting('t.big_listing')), 'too_large_for_warehouse');
  -- And the general limits hold on creation as on editing: no kind of
  -- delivery carries more than 200 cm a side or 30 kg, and the seller is told
  -- so plainly (package_over_limit), at the edge.
  assert public.seller_create_listing(v_seller, 'Mueble de 200 cm', 'hogar', null, null, 4500000,
           'seller', 2::smallint, 30000, 200, 40, 10, false) ->> 'offer_id' is not null,
    'a seller-shipped package of 200 cm and 30 kg is the largest accepted';
  perform pg_temp.refused(format(
    'select public.seller_create_listing(%L, ''Mueble enorme'', ''hogar'', null, null, 4500000, ''seller'', 2::smallint, 6000, 201, 40, 10, false)',
    v_seller), 'package_over_limit');
  perform pg_temp.refused(format(
    'select public.seller_create_listing(%L, ''Mueble pesado'', ''hogar'', null, null, 4500000, ''seller'', 2::smallint, 30001, 100, 40, 10, false)',
    v_seller), 'package_over_limit');
  perform pg_temp.refused(format(
    'select public.seller_update_listing(%L, ''Escalera de aluminio pesada'', ''hogar'', null, null, 30001, 100, 40, 10, null, false)',
    current_setting('t.big_listing')), 'package_over_limit');
  -- Other mistakes in a listing are still a form error.
  perform pg_temp.refused(format(
    'select public.seller_create_listing(%L, ''Mesa'', ''hogar'', null, null, 4500000, ''seller'', 2::smallint, 6000, 100, 40, 10, false)',
    v_seller), 'invalid_listing');
end
$$;
reset role; select pg_temp.logout();
do $$
begin
  -- Whatever path tries it, a warehouse offer never gets a package that does not fit.
  begin
    update public.offers set fulfillment = 'platform'
    where sku_id = (select k.id from public.skus k join public.products p on p.id = k.product_id
                    where p.title = 'Escalera de aluminio de 150 cm');
    raise exception 'an oversize package was sent to the warehouse';
  exception when others then
    if sqlerrm <> 'too_large_for_warehouse' then raise; end if;
  end;
  begin
    update public.skus set length_cm = 125
    where product_id = current_setting('t.big_listing')::uuid;
    raise exception 'a warehouse package grew beyond the largest tier';
  exception when others then
    if sqlerrm <> 'too_large_for_warehouse' then raise; end if;
  end;
end
$$;

-- ═══ FA-7: content reports and complaints ══════════════════════════════════

select pg_temp.remember('reports_before', (select count(*)::text from public.content_reports));
select pg_temp.remember('outbox_before', (select count(*)::text from private.outbox_events));
select pg_temp.login_anon();
do $$
declare
  v_id uuid;
begin
  -- About things that do not exist, or are not public: refused politely.
  perform pg_temp.refused(format('select public.report_content(''product'', %L, ''unsafe'', null, ''ana@correo.example'')',
    gen_random_uuid()), 'report_target_not_found');
  perform pg_temp.refused(format('select public.report_content(''review'', %L, ''abuse'', null, ''ana@correo.example'')',
    gen_random_uuid()), 'report_target_not_found');
  perform pg_temp.refused(format('select public.report_content(''seller'', %L, ''abuse'', null, ''ana@correo.example'')',
    current_setting('t.bazar')), 'report_target_not_found');
  perform pg_temp.refused(format('select public.report_content(''product'', %L, ''unsafe'', null, ''ana@correo.example'')',
    current_setting('t.draft_product')), 'report_target_not_found');
  -- Bounded and checked input.
  perform pg_temp.refused(format('select public.report_content(''product'', %L, ''unsafe'', %L, ''ana@correo.example'')',
    current_setting('t.product'), repeat('x', 2001)), 'invalid_report');
  perform pg_temp.refused(format('select public.report_content(''product'', %L, ''unsafe'', null, ''victima-sin-arroba'')',
    current_setting('t.product')), 'invalid_contact_email');
  -- The honest path, with the longest details allowed.
  v_id := public.report_content('product', current_setting('t.product')::uuid, 'unsafe', repeat('x', 2000),
                                'Ana@Correo.example');
  -- The same visitor again: the same report, not a second one.
  assert public.report_content('product', current_setting('t.product')::uuid, 'unsafe', 'Otra vez.',
                               'ana@correo.example') = v_id, 'FA-7: a duplicate is counted once';
end
$$;
reset role; select pg_temp.logout();
do $$
begin
  assert (select count(*) from public.content_reports) = current_setting('t.reports_before')::bigint + 1,
    'one report was stored';
  assert (select count(*) from private.outbox_events) = current_setting('t.outbox_before')::bigint + 1
     and not exists (select 1 from private.outbox_events where payload::text like '%correo.example%'),
    'one event, which never carries the e-mail the visitor typed';
end
$$;

-- The visitors' safety valve, at its edge. It never silences the first
-- report about something nobody has reported yet.
select pg_temp.set_limit('visitor_reports_per_hour',
  (select count(*)::integer + 1 from public.content_reports
   where reporter_id is null and created_at > now() - interval '1 hour'));
select pg_temp.login_anon();
do $$
begin
  assert public.report_content('product', current_setting('t.product')::uuid, 'misleading', null,
                               'luis@correo.example') is not null, 'the last report under the valve is accepted';
  perform pg_temp.refused(format('select public.report_content(''product'', %L, ''counterfeit'', null, ''otra@correo.example'')',
    current_setting('t.product')), 'reports_paused');
  assert public.report_content('seller', current_setting('t.tecnocasa')::uuid, 'abuse', null,
                               'otra@correo.example') is not null,
    'with the valve shut, a first report about something else still gets through';
end
$$;
reset role; select pg_temp.logout();
select pg_temp.set_limit('visitor_reports_per_hour', 300);

-- A signed-in account: a cap on open reports, at its edge.
select pg_temp.set_limit('max_open_reports_per_account', 2);
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  v_id uuid;
begin
  v_id := public.report_content('product', current_setting('t.product')::uuid, 'misleading');
  assert public.report_content('product', current_setting('t.product3')::uuid, 'misleading') is not null,
    'the last open report under the cap is accepted';
  perform pg_temp.refused(format('select public.report_content(''seller'', %L, ''abuse'')',
    current_setting('t.tecnocasa')), 'too_many_open_reports');
  assert public.report_content('product', current_setting('t.product')::uuid, 'misleading', 'Más datos.') = v_id,
    'repeating one already open is not a new report';
end
$$;
reset role; select pg_temp.logout();
select pg_temp.set_limit('max_open_reports_per_account', 20);

-- Complaints: a cap on open ones, at its edge; a repeat counted once; every field checked.
select pg_temp.set_limit('max_open_complaints_per_account',
  (select count(*)::integer + 1 from public.complaints c
   join auth.users u on u.id = c.user_id
   where u.email = 'comprador2@yuntera.example' and c.status <> 'resolved'));
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  v_id uuid;
begin
  perform pg_temp.refused('select public.file_complaint(''delivery'', null)', 'invalid_complaint');
  perform pg_temp.refused('select public.file_complaint(''otra cosa'', ''El paquete llegó abierto.'')', 'invalid_complaint');
  perform pg_temp.refused(format('select public.file_complaint(''delivery'', %L)', repeat('x', 4001)), 'invalid_complaint');
  v_id := public.file_complaint('delivery', 'El paquete llegó abierto y faltaba una pieza.');
  assert public.file_complaint('delivery', 'El paquete llegó abierto y faltaba una pieza.') = v_id,
    'the same complaint again is the same complaint';
  perform pg_temp.refused('select public.file_complaint(''product'', ''El color no es el de la foto.'')',
    'too_many_open_complaints');
end
$$;
reset role; select pg_temp.logout();
select pg_temp.set_limit('max_open_complaints_per_account', 5);

-- The care queues carry a page of each queue and the totals.
insert into public.complaints (user_id, category, description)
select current_setting('t.uid_comprador3')::uuid, 'other', 'Queja de relleno número ' || n
from generate_series(1, 120) n;
select pg_temp.login('central@yuntera.example');
do $$
declare
  q jsonb := public.ops_care_queues();
begin
  assert jsonb_array_length(q -> 'complaints') = 100 and (q #>> '{totals,complaints}')::integer >= 120,
    format('a page of complaints, and the total: %s', q -> 'totals');
end
$$;
reset role; select pg_temp.logout();

-- ═══ FA-8: what a visitor sends is bounded ═════════════════════════════════

select pg_temp.login_anon();
do $$
declare
  v_long text := repeat('licuadora ', 20000);
  v_cart jsonb;
  v_start timestamptz;
begin
  -- 20 000 words used to exhaust the stack; now only the first 12 words are searched.
  assert (select count(*) from public.search_products(v_long)) >= 0, 'FA-8: a huge query does not fail';
  assert (select array_agg(slug order by slug) from public.search_products(v_long))
         is not distinct from (select array_agg(slug order by slug) from public.search_products(repeat('licuadora ', 12))),
    'it searches what the first 12 words find';
  assert (select count(*) from public.suggest_products(v_long)) >= 0, 'nor a huge prefix';
  assert (select count(*) from public.search_products('licuadora')) >= 1, 'ordinary searches still work';

  -- A cart is checked for size before anything is priced.
  v_cart := (select jsonb_agg(jsonb_build_object('offer_id', gen_random_uuid(), 'quantity', 1))
             from generate_series(1, 200000));
  v_start := clock_timestamp();
  assert public.checkout_quote(v_cart, '10101') ->> 'issue' = 'too_many_lines', 'too many lines';
  assert clock_timestamp() - v_start < interval '100 milliseconds',
    format('and answered without pricing them (%s)', clock_timestamp() - v_start);
  assert public.checkout_quote('[{"offer_id": "no-es-un-id", "quantity": 1}]', '10101') ->> 'issue' = 'offer_unavailable',
    'a malformed line is an issue, not a raw error';
  assert public.checkout_quote(jsonb_build_array(jsonb_build_object(
           'offer_id', pg_temp.offer('licuadora-volcan-600w'), 'quantity', 1.5)), '10101') ->> 'issue' = 'invalid_quantity',
    'so is a fractional quantity';
  assert public.checkout_quote(jsonb_build_array(jsonb_build_object(
           'offer_id', pg_temp.offer('licuadora-volcan-600w'), 'quantity', 1)), '10101') ->> 'issue' is null,
    'an ordinary cart is priced as before';
end
$$;
reset role; select pg_temp.logout();

-- What the wrappers cut the text to (the helper runs only inside them).
do $$ begin
  assert private.bounded_search_text(repeat('a', 500)) = repeat('a', 200), 'at most 200 characters';
  assert private.bounded_search_text('uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece')
         = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce', 'at most 12 words';
end $$;

-- ═══ FA-9: reviewer names only for reviewers ═══════════════════════════════

select pg_temp.login_anon();
do $$
begin
  assert public.reviewer_display_name(current_setting('t.uid_central')::uuid) = 'Cliente',
    'FA-9: a staff account is not named';
  assert public.reviewer_display_name(current_setting('t.uid_repartidor')::uuid) = 'Cliente',
    'nor a driver';
  assert public.reviewer_display_name(gen_random_uuid()) = 'Cliente',
    'and an id with no account answers the same, so nothing tells them apart';
end
$$;
reset role; select pg_temp.logout();
do $$
begin
  assert public.reviewer_display_name(current_setting('t.uid_comprador')::uuid) = 'María F.',
    'someone with a published review is shown as "María F."';
end
$$;

-- ═══ DTA-6: joining a shop needs the invited person's yes ══════════════════

select pg_temp.login('sendero@yuntera.example');
select pg_temp.denied(format(
  'insert into public.seller_members (seller_id, user_id, role) values (%L, %L, ''admin'')',
  current_setting('t.sendero'), current_setting('t.uid_comprador2')::uuid));
select pg_temp.denied('update public.seller_members set role = ''admin''');
select pg_temp.denied('delete from public.seller_members');
reset role; select pg_temp.logout();

-- The shop is active again for the rest of the suite.
update public.sellers set status = 'active' where id = current_setting('t.sendero')::uuid;

select pg_temp.login('sendero@yuntera.example');
select pg_temp.remember('inv_admin', public.seller_invite_member(
  current_setting('t.sendero')::uuid, 'Comprador2@Yuntera.example', 'admin')::text);
-- An address with no account gets the same answer: inviting is no way to find out who has one.
select pg_temp.remember('inv_nobody', public.seller_invite_member(
  current_setting('t.sendero')::uuid, 'nadie-aqui@yuntera.example', 'staff')::text);
do $$
declare
  t jsonb := public.seller_team(current_setting('t.sendero')::uuid);
begin
  assert current_setting('t.inv_nobody') <> '' and jsonb_array_length(t -> 'invitations') = 2,
    format('the owner sees both invitations waiting: %s', t -> 'invitations');
  assert jsonb_array_length(t -> 'members') = 1, 'nobody joined yet';
  perform pg_temp.refused(format('select public.seller_invite_member(%L, ''sendero@yuntera.example'', ''staff'')',
    current_setting('t.sendero')), 'already_a_member');
  perform pg_temp.refused(format('select public.seller_invite_member(%L, ''no es correo'', ''staff'')',
    current_setting('t.sendero')), 'invalid_invitation_email');
  perform pg_temp.refused(format('select public.seller_invite_member(%L, ''x@correo.example'', ''owner'')',
    current_setting('t.sendero')), 'invalid_member_role');
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  i jsonb := public.my_invitations();
begin
  assert not private.is_seller_member(current_setting('t.sendero')::uuid), 'DTA-6: invited is not a member';
  assert (select count(*) from public.seller_private where seller_id = current_setting('t.sendero')::uuid) = 0,
    'and sees nothing of the shop';
  assert jsonb_array_length(i) = 1 and i #>> '{0,shop,trade_name}' = 'Tienda Sendero'
     and i #>> '{0,role}' = 'admin' and i #>> '{0,invited_by_name}' = 'Diego',
    format('the invited person sees the invitation: %s', i);
end
$$;
reset role; select pg_temp.logout();

-- Someone else cannot answer it.
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format('select public.seller_answer_invitation(%L, true)', current_setting('t.inv_admin')),
  'invitation_not_found');
reset role; select pg_temp.logout();

-- An account created after the invitation, with the address typed, cannot take it.
insert into auth.users (id, email) values (gen_random_uuid(), 'nadie-aqui@yuntera.example');
select pg_temp.login('nadie-aqui@yuntera.example');
do $$
begin
  assert public.my_invitations() = '[]'::jsonb, 'the late account has no invitation';
  perform pg_temp.refused(format('select public.seller_answer_invitation(%L, true)', current_setting('t.inv_nobody')),
    'invitation_not_found');
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert public.seller_answer_invitation(current_setting('t.inv_admin')::uuid, true)
         = current_setting('t.sendero')::uuid, 'accepting answers the shop';
  assert private.is_seller_admin(current_setting('t.sendero')::uuid), 'and makes them an administrator';
  -- An administrator invites staff, but not administrators.
  perform set_config('t.inv_staff', public.seller_invite_member(
    current_setting('t.sendero')::uuid, 'comprador3@yuntera.example', 'staff')::text, true);
  perform pg_temp.refused(format('select public.seller_invite_member(%L, ''x@correo.example'', ''admin'')',
    current_setting('t.sendero')), 'owner_only');
  -- Nor removes the owner, or another administrator.
  perform pg_temp.refused(format('select public.seller_remove_member(%L, %L)', current_setting('t.sendero'),
    current_setting('t.uid_sendero')::uuid), 'owner_only');
end
$$;
reset role; select pg_temp.logout();

-- Declining, and an invitation past its date.
select pg_temp.login('comprador3@yuntera.example');
select public.seller_answer_invitation(current_setting('t.inv_staff')::uuid, false);
do $$ begin
  assert not private.is_seller_member(current_setting('t.sendero')::uuid), 'declining joins nothing';
end $$;
reset role; select pg_temp.logout();
select pg_temp.login('sendero@yuntera.example');
select pg_temp.remember('inv_old', public.seller_invite_member(
  current_setting('t.sendero')::uuid, 'comprador3@yuntera.example', 'staff')::text);
reset role; select pg_temp.logout();
update public.seller_invitations set expires_at = now() - interval '1 minute'
where id = current_setting('t.inv_old')::uuid;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format('select public.seller_answer_invitation(%L, true)', current_setting('t.inv_old')),
  'invitation_not_found');
reset role; select pg_temp.logout();

-- The owner revokes one, which frees a place; the cap on invitations
-- waiting, at its edge, is what is open now.
select pg_temp.set_limit('max_pending_invitations_per_shop',
  (select count(*)::integer from public.seller_invitations i
   where i.seller_id = current_setting('t.sendero')::uuid and private.invitation_open(i)));
select pg_temp.login('sendero@yuntera.example');
do $$
begin
  perform public.seller_revoke_invitation(current_setting('t.inv_nobody')::uuid);
  perform pg_temp.refused(format('select public.seller_revoke_invitation(%L)', current_setting('t.inv_nobody')),
    'invitation_not_found');
  assert public.seller_invite_member(current_setting('t.sendero')::uuid, 'uno@correo.example', 'staff') is not null,
    'the last invitation under the cap';
  perform pg_temp.refused(format('select public.seller_invite_member(%L, ''dos@correo.example'', ''staff'')',
    current_setting('t.sendero')), 'too_many_invitations');
  -- Renewing one already waiting is not a new one.
  assert public.seller_invite_member(current_setting('t.sendero')::uuid, 'uno@correo.example', 'staff') is not null,
    'renewing is fine at the cap';
  -- The owner makes the administrator staff, then removes them: access ends at once.
  perform public.seller_set_member_role(current_setting('t.sendero')::uuid,
    current_setting('t.uid_comprador2')::uuid, 'staff');
  perform public.seller_remove_member(current_setting('t.sendero')::uuid,
    current_setting('t.uid_comprador2')::uuid);
end
$$;
reset role; select pg_temp.logout();
select pg_temp.set_limit('max_pending_invitations_per_shop', 20);
select pg_temp.login('comprador2@yuntera.example');
do $$ begin
  assert not private.is_seller_member(current_setting('t.sendero')::uuid), 'removed means removed';
end $$;
reset role; select pg_temp.logout();

-- ═══ DTA-7: fees are not changed through the API, and are audited ═════════

insert into public.staff_members (user_id, role)
select id, 'catalog' from auth.users where email = 'comprador3@yuntera.example'
on conflict (user_id) do update set role = 'catalog', active = true;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('update public.categories set referral_bps = 0 where slug = ''electronica''');
select pg_temp.denied('update public.categories set default_tax_rate_bps = 0 where slug = ''electronica''');
reset role; select pg_temp.logout();
update public.staff_members set role = 'finance'
where user_id = current_setting('t.uid_comprador3')::uuid;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('update public.fee_fulfillment_tiers set fee_minor = 0');
select pg_temp.denied('update public.fee_schedules set default_referral_bps = 0');
select pg_temp.denied('update public.delivery_zones set shipping_fee_minor = 0');
reset role; select pg_temp.logout();
update public.staff_members set role = 'ops'
where user_id = current_setting('t.uid_comprador3')::uuid;
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('update public.delivery_zones set shipping_fee_minor = 0');
reset role; select pg_temp.logout();
delete from public.staff_members where user_id = current_setting('t.uid_comprador3')::uuid;
do $$
declare
  v_before bigint := (select count(*) from private.audit_log);
begin
  -- A migration (or an administrator in the database) changing a fee leaves a trace.
  update public.categories set referral_bps = referral_bps where slug = 'electronica';
  update public.fee_fulfillment_tiers set fee_minor = fee_minor where id = 'grande';
  update public.delivery_zones set shipping_fee_minor = shipping_fee_minor where id = 'gam-core';
  assert (select count(*) from private.audit_log) = v_before + 3, 'each change is in the audit log';
  assert (select count(*) from private.audit_log where table_name = 'categories') >= 1, 'with its table';
end
$$;

-- ═══ DTA-11, DTA-12: the shop's name, fiscal details and contact ═══════════

select pg_temp.login('sendero@yuntera.example');
select pg_temp.denied(format('update public.sellers set trade_name = ''Yuntera Oficial'' where id = %L',
  current_setting('t.sendero')));
select pg_temp.denied(format('update public.seller_private set tax_regime = ''simplificado'' where seller_id = %L',
  current_setting('t.sendero')));
select pg_temp.denied(format('update public.seller_private set contact_phone = ''+50687654321'' where seller_id = %L',
  current_setting('t.sendero')));
do $$
declare
  v_seller uuid := current_setting('t.sendero')::uuid;
  v_call text := 'select public.seller_request_shop_change(%L, ''shop_name'', %L)';
begin
  perform pg_temp.refused(format(v_call, v_seller, 'Yuntera Oficial'), 'shop_name_reserved');
  perform pg_temp.refused(format(v_call, v_seller, 'TecnoCasa'), 'shop_name_taken');
  perform pg_temp.refused(format(v_call, v_seller, 'Tienda Sendero'), 'shop_change_unchanged');
  perform pg_temp.refused(format('select public.seller_request_shop_change(%L, ''otra cosa'')', v_seller),
    'invalid_change_kind');
  perform set_config('t.name_request',
    public.seller_request_shop_change(v_seller, 'shop_name', 'Sendero Aventura')::text, true);
  perform pg_temp.refused(format(
    'select public.seller_request_shop_change(%L, ''fiscal'', p_tax_regime => ''mixto'', p_fiscal_address => ''Escazú, San Rafael, local 4'')',
    v_seller), 'invalid_fiscal_details');
  perform set_config('t.fiscal_request', public.seller_request_shop_change(v_seller, 'fiscal',
    p_tax_regime => 'simplificado', p_fiscal_address => 'Escazú, San Rafael, Plaza Colonial local 9',
    p_postal_code => '10203', p_economic_activity_code => '523101')::text, true);
  perform pg_temp.refused(format(
    'select public.seller_request_shop_change(%L, ''contact'', p_contact_email => ''nuevo@sendero.example'', p_contact_phone => ''12345'')',
    v_seller), 'invalid_contact_details');
  perform set_config('t.contact_request', public.seller_request_shop_change(v_seller, 'contact',
    p_contact_email => 'Nuevo@Sendero.example', p_contact_phone => '+506 2289 0505')::text, true);
  -- Nothing changed yet.
  assert (select trade_name from public.sellers where id = v_seller) = 'Tienda Sendero', 'DTA-11: the name waits';
  assert (select contact_phone from public.seller_private where seller_id = v_seller) = '+50622890404', 'so does the phone';
  assert jsonb_array_length(public.seller_shop_changes(v_seller) -> 'requests') = 3, 'the seller sees three requests';
end
$$;
reset role; select pg_temp.logout();

-- Staff decide by kind: ops the name and fiscal details, finance the contact.
insert into public.staff_members (user_id, role)
select id, 'finance' from auth.users where email = 'comprador3@yuntera.example'
on conflict (user_id) do update set role = 'finance', active = true;
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  q jsonb := public.ops_shop_change_requests();
begin
  assert jsonb_array_length(q) = 1 and q #>> '{0,kind}' = 'contact', format('finance sees the contact change only: %s', q);
  perform pg_temp.refused(format('select public.ops_decide_shop_change(%L, true)', current_setting('t.name_request')),
    'shop_change_not_found');
  perform pg_temp.refused(format('select public.ops_decide_shop_change(%L, false, ''No.'')', current_setting('t.contact_request')),
    'reason_required');
  perform public.ops_decide_shop_change(current_setting('t.contact_request')::uuid, true);
end
$$;
reset role; select pg_temp.logout();
delete from public.staff_members where user_id = current_setting('t.uid_comprador3')::uuid;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.sendero')::uuid;
  v_verified timestamptz := (select hacienda_verified_at from public.seller_private where seller_id = v_seller);
begin
  perform public.ops_decide_shop_change(current_setting('t.name_request')::uuid, false,
    'El nombre debe coincidir con su inscripción en Hacienda.');
  perform public.ops_decide_shop_change(current_setting('t.fiscal_request')::uuid, true, 'Revisado en Hacienda.');
  perform pg_temp.refused(format('select public.ops_decide_shop_change(%L, true)', current_setting('t.fiscal_request')),
    'shop_change_not_pending');
  assert (select trade_name from public.sellers where id = v_seller) = 'Tienda Sendero', 'a rejected name stays as it was';
  assert (select tax_regime = 'simplificado' and kyc_status = 'verified' and hacienda_verified_at >= v_verified
          from public.seller_private where seller_id = v_seller),
    'DTA-12: approved fiscal details are applied and the verification is dated by whoever approved them';
  assert (select contact_phone = '+50622890505' and contact_email = 'nuevo@sendero.example'
          from public.seller_private where seller_id = v_seller), 'the approved contact is applied';
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.sendero')::uuid;
  c jsonb := public.seller_shop_changes(v_seller);
begin
  assert exists (select 1 from jsonb_array_elements(c -> 'requests') r
                 where r ->> 'kind' = 'shop_name' and r ->> 'status' = 'rejected'
                   and r ->> 'note' like 'El nombre debe coincidir%'), 'the seller reads why';
  -- A change of contact waits while a change of payout account does.
  perform public.seller_request_payout_details(v_seller, 'CR23015108410026012345', 'Sendero Outdoor S.R.L.');
  perform pg_temp.refused(format(
    'select public.seller_request_shop_change(%L, ''contact'', p_contact_email => ''otro@sendero.example'', p_contact_phone => ''+50622890606'')',
    v_seller), 'payout_request_open');
  assert (public.seller_shop_changes(v_seller) ->> 'payout_request_open')::boolean, 'and the screen can say so';
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
do $$
begin
  -- The phone finance calls changed within 30 days, which the bank queue flags.
  assert exists (select 1 from jsonb_array_elements(public.ops_payout_detail_requests()) r
                 where r #>> '{seller,id}' = current_setting('t.sendero')
                   and (r #>> '{signals,contact_changed_recently}')::boolean),
    'the payout-account request is flagged after a change of contact';
end
$$;
reset role; select pg_temp.logout();

-- Nobody decides for a shop they belong to.
select pg_temp.login('sendero@yuntera.example');
select pg_temp.remember('own_shop_request', public.seller_request_shop_change(
  current_setting('t.sendero')::uuid, 'shop_name', 'Sendero Aventura')::text);
reset role; select pg_temp.logout();
insert into public.seller_members (seller_id, user_id, role)
select current_setting('t.sendero')::uuid, id, 'staff' from auth.users where email = 'central@yuntera.example';
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.ops_decide_shop_change(%L, true)', current_setting('t.own_shop_request')),
  'cannot_decide_own_shop');
reset role; select pg_temp.logout();
delete from public.seller_members
where seller_id = current_setting('t.sendero')::uuid
  and user_id = current_setting('t.uid_central')::uuid;

-- ═══ DTA-13: consents are dated by the database and never rewritten ═══════

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  n integer;
begin
  perform pg_temp.denied(
    'insert into public.consents (user_id, purpose, policy_version, granted_at) values (auth.uid(), ''terms'', ''v-fake'', ''2020-01-01'')');
  perform pg_temp.denied('update public.consents set revoked_at = null');
  perform pg_temp.refused('select public.record_consent(''terms'', ''v-fake'')', 'policy_version_outdated');
  perform pg_temp.refused('select public.record_consent(''otra'', ''2026-11'')', 'invalid_consent');
  n := (select count(*) from public.consents where purpose = 'terms');
  perform public.record_consent('terms', '2026-11');
  assert (select count(*) from public.consents where purpose = 'terms') = n,
    'agreeing again to what is agreed adds nothing';
  perform public.record_consent('marketing', '2026-11');
  assert (select granted_at = now() from public.consents where purpose = 'marketing' and revoked_at is null),
    'a consent is dated now';
  assert public.withdraw_consent('marketing') = 1, 'withdrawn';
  assert public.withdraw_consent('marketing') = 0, 'and withdrawing again changes nothing';
end
$$;
reset role; select pg_temp.logout();
do $$
declare
  v_user uuid := current_setting('t.uid_comprador')::uuid;
begin
  insert into public.consents (user_id, purpose, policy_version, granted_at)
  values (v_user, 'location', '2026-11', '2020-01-01');
  assert (select granted_at = now() from public.consents where user_id = v_user and purpose = 'location'),
    'DTA-13: even a direct insert is dated now';
  begin
    update public.consents set revoked_at = null where user_id = v_user and purpose = 'marketing';
    raise exception 'a withdrawal was undone';
  exception when others then
    if sqlerrm <> 'consent_history_locked' then raise; end if;
  end;
  begin
    update public.consents set granted_at = '2019-01-01' where user_id = v_user and purpose = 'terms';
    raise exception 'a consent was back-dated';
  exception when others then
    if sqlerrm <> 'consent_history_locked' then raise; end if;
  end;
  update public.consents set revoked_at = '2019-01-01' where user_id = v_user and purpose = 'location';
  assert (select revoked_at = now() from public.consents where user_id = v_user and purpose = 'location'),
    'a withdrawal is dated now, whatever date was given';
end
$$;

-- ═══ Payout accounts finance never approved ════════════════════════════════

-- TecnoCasa's account predates approvals (no mark): it is not paid.
update public.seller_private set payout_approved_at = null, payout_approved_by = null
where seller_id = current_setting('t.tecnocasa')::uuid;
do $$
begin
  assert exists (
    select 1 from private.payout_candidates(private.cr_local(now())::date + 30, 0, 1) c
    where c.seller_id = current_setting('t.tecnocasa')::uuid and 'no_bank_details' = any (c.reasons)),
    'an account never approved counts as no approved account';
end
$$;
select pg_temp.login('vendedor@yuntera.example');
-- Asking for the same account again is allowed while it was never approved.
select pg_temp.remember('same_account', public.seller_request_payout_details(
  current_setting('t.tecnocasa')::uuid, 'CR26010200009123456789', 'TecnoCasa de Costa Rica S.A.',
  '+50684440202')::text);
reset role; select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select public.ops_decide_payout_details(current_setting('t.same_account')::uuid, true);
reset role; select pg_temp.logout();
do $$
begin
  assert (select payout_approved_at is not null and payout_approved_by is not null
          from public.seller_private where seller_id = current_setting('t.tecnocasa')::uuid),
    'approving marks the account approved';
  assert not exists (
    select 1 from private.payout_candidates(private.cr_local(now())::date + 30, 0, 1) c
    where c.seller_id = current_setting('t.tecnocasa')::uuid and 'no_bank_details' = any (c.reasons)),
    'and it can be paid again';
end
$$;
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format(
  'select public.seller_request_payout_details(%L, ''CR26010200009123456789'', ''TecnoCasa de Costa Rica S.A.'', ''+50684440202'')',
  current_setting('t.tecnocasa')), 'payout_details_unchanged');
reset role; select pg_temp.logout();

-- ═══ Review: a contact change and a payout request never overlap ══════════

-- Whichever comes first holds the other back, so the phone finance calls to
-- confirm a new payout account is never one that is itself being changed.
select pg_temp.remember('cafetal', (select id::text from public.sellers where slug = 'cafetal-los-santos'));
insert into public.staff_members (user_id, role)
select id, 'finance' from auth.users where email = 'comprador3@yuntera.example'
on conflict (user_id) do update set role = 'finance', active = true;

-- Contact first: the payout request is refused while it waits.
select pg_temp.login('cafetal@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.cafetal')::uuid;
begin
  perform set_config('t.cafetal_contact', public.seller_request_shop_change(v_seller, 'contact',
    p_contact_email => 'otro@cafetal.example', p_contact_phone => '+50688887777')::text, true);
  perform pg_temp.refused(format(
    'select public.seller_request_payout_details(%L, ''CR23015108410026012345'', ''Cafetal Los Santos S.A.'')',
    v_seller), 'contact_request_open');
end
$$;
reset role; select pg_temp.logout();

-- A payout request already waiting (sent before this rule, say) holds back
-- approving the contact change; rejecting it stays possible.
insert into public.payout_detail_requests (seller_id, payout_iban, payout_holder_name, requested_by)
values (current_setting('t.cafetal')::uuid, 'CR23015108410026012345', 'Cafetal Los Santos S.A.',
        (select id from auth.users where email = 'cafetal@yuntera.example'));
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  perform pg_temp.refused(format('select public.ops_decide_shop_change(%L, true)', current_setting('t.cafetal_contact')),
    'contact_change_waits_for_payout');
  assert (select contact_phone from public.seller_private where seller_id = current_setting('t.cafetal')::uuid)
         = '+50625460101', 'the phone on file is unchanged';
  perform public.ops_decide_shop_change(current_setting('t.cafetal_contact')::uuid, false,
    'Primero resolvemos el cambio de cuenta bancaria.');
end
$$;
reset role; select pg_temp.logout();
delete from public.payout_detail_requests where seller_id = current_setting('t.cafetal')::uuid;

-- With nothing else waiting, the honest path works in both directions.
select pg_temp.login('cafetal@yuntera.example');
select pg_temp.remember('cafetal_contact2', public.seller_request_shop_change(
  current_setting('t.cafetal')::uuid, 'contact',
  p_contact_email => 'ventas@cafetal.example', p_contact_phone => '+50625460199')::text);
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
select public.ops_decide_shop_change(current_setting('t.cafetal_contact2')::uuid, true);
reset role; select pg_temp.logout();
select pg_temp.login('cafetal@yuntera.example');
do $$
begin
  assert public.seller_request_payout_details(current_setting('t.cafetal')::uuid,
           'CR23015108410026012345', 'Cafetal Los Santos S.A.') is not null,
    'once the contact change is decided, the payout request goes in';
end
$$;
reset role; select pg_temp.logout();
delete from public.staff_members where user_id = current_setting('t.uid_comprador3')::uuid;

-- ═══ Review: a seller sees that an unapproved account blocks the payout ═══

update public.seller_private set payout_approved_at = null, payout_approved_by = null
where seller_id = current_setting('t.tecnocasa')::uuid;
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
begin
  assert public.seller_payouts(v_seller) -> 'blocked_by' ? 'no_bank_details',
    format('the money screen names what blocks the payout: %s', public.seller_payouts(v_seller) -> 'blocked_by');
  assert (public.seller_payout_details(v_seller) #>> '{current,approved}')::boolean = false,
    'and the account screen says the account is not approved';
end
$$;
reset role; select pg_temp.logout();
update public.seller_private set payout_approved_at = now()
where seller_id = current_setting('t.tecnocasa')::uuid;
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
begin
  assert not public.seller_payouts(v_seller) -> 'blocked_by' ? 'no_bank_details', 'an approved account blocks nothing';
  assert (public.seller_payout_details(v_seller) #>> '{current,approved}')::boolean, 'and is shown as approved';
end
$$;
reset role; select pg_temp.logout();

-- ═══ Review: a fiscal change keeps the fields the seller did not send ═════

-- What the DTA-12 section above leaves on file (set here too, so this section
-- can run alone).
update public.seller_private
set tax_regime = 'simplificado', postal_code = '10203', economic_activity_code = '523101'
where seller_id = current_setting('t.sendero')::uuid;

select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.sendero')::uuid;
  c jsonb := public.seller_shop_changes(v_seller);
begin
  assert c #>> '{current,fiscal,postal_code}' = '10203'
     and c #>> '{current,fiscal,economic_activity_code}' = '523101',
    format('the form starts from what is on file: %s', c -> 'current');
  -- Only the address, as the form sends it when nothing else is touched.
  perform set_config('t.fiscal_partial', public.seller_request_shop_change(v_seller, 'fiscal',
    p_fiscal_address => 'Escazú, San Rafael, Plaza Colonial local 5, segundo piso')::text, true);
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select public.ops_decide_shop_change(current_setting('t.fiscal_partial')::uuid, true, 'Revisado en Hacienda.');
reset role; select pg_temp.logout();
do $$
begin
  assert (select postal_code = '10203' and economic_activity_code = '523101' and tax_regime = 'simplificado'
                 and fiscal_address like '%segundo piso'
          from public.seller_private where seller_id = current_setting('t.sendero')::uuid),
    'approving a change of address leaves the postal code, activity code and regime as they were';
end
$$;
-- A staff member of the shop does not get the details on file.
insert into public.seller_members (seller_id, user_id, role)
values (current_setting('t.sendero')::uuid, current_setting('t.uid_comprador')::uuid, 'staff');
select pg_temp.login('comprador@yuntera.example');
do $$ begin
  assert public.seller_shop_changes(current_setting('t.sendero')::uuid) -> 'current' = 'null'::jsonb,
    'staff do not get the fiscal details';
end $$;
reset role; select pg_temp.logout();
delete from public.seller_members
where seller_id = current_setting('t.sendero')::uuid and user_id = current_setting('t.uid_comprador')::uuid;

-- ═══ Review: inviting someone who registers afterwards ═══════════════════

select pg_temp.login('sendero@yuntera.example');
select pg_temp.remember('inv_new_hire', public.seller_invite_member(
  current_setting('t.sendero')::uuid, 'nueva.persona@correo.example', 'staff')::text);
reset role; select pg_temp.logout();
-- They sign up with that address, but have not confirmed it yet: nothing.
insert into auth.users (id, email) values (gen_random_uuid(), 'nueva.persona@correo.example');
select pg_temp.login('nueva.persona@correo.example');
do $$
begin
  assert public.my_invitations() = '[]'::jsonb, 'an unconfirmed address proves nothing';
  perform pg_temp.refused(format('select public.seller_answer_invitation(%L, true)', current_setting('t.inv_new_hire')),
    'invitation_not_found');
end
$$;
reset role; select pg_temp.logout();
update auth.users set email_confirmed_at = now() where email = 'nueva.persona@correo.example';
select pg_temp.login('nueva.persona@correo.example');
do $$
declare
  i jsonb := public.my_invitations();
begin
  assert jsonb_array_length(i) = 1 and i #>> '{0,shop,trade_name}' = 'Tienda Sendero',
    format('once confirmed, the invitation is there: %s', i);
  assert public.seller_answer_invitation(current_setting('t.inv_new_hire')::uuid, true)
         = current_setting('t.sendero')::uuid, 'and they accept it';
  assert private.is_seller_member(current_setting('t.sendero')::uuid), 'and are on the team';
end
$$;
reset role; select pg_temp.logout();
do $$ begin
  assert (select invitee_id = (select id from auth.users where email = 'nueva.persona@correo.example')
          from public.seller_invitations where id = current_setting('t.inv_new_hire')::uuid),
    'the invitation now names the account that took it';
end $$;
select pg_temp.remember('uid_new_hire', (select id::text from auth.users where email = 'nueva.persona@correo.example'));
select pg_temp.login('sendero@yuntera.example');
select public.seller_remove_member(current_setting('t.sendero')::uuid, current_setting('t.uid_new_hire')::uuid);
reset role; select pg_temp.logout();

-- ═══ Review: a removed administrator's invitations end with them ═════════

select pg_temp.login('sendero@yuntera.example');
select pg_temp.remember('inv_admin2', public.seller_invite_member(
  current_setting('t.sendero')::uuid, 'comprador2@yuntera.example', 'admin')::text);
reset role; select pg_temp.logout();
select pg_temp.login('comprador2@yuntera.example');
select public.seller_answer_invitation(current_setting('t.inv_admin2')::uuid, true);
select pg_temp.remember('inv_by_admin', public.seller_invite_member(
  current_setting('t.sendero')::uuid, 'comprador3@yuntera.example', 'staff')::text);
select pg_temp.remember('inv_by_admin2', public.seller_invite_member(
  current_setting('t.sendero')::uuid, 'comprador@yuntera.example', 'staff')::text);
reset role; select pg_temp.logout();
-- Demoted to staff, and then they leave on their own.
select pg_temp.login('sendero@yuntera.example');
select public.seller_set_member_role(current_setting('t.sendero')::uuid,
  current_setting('t.uid_comprador2')::uuid, 'staff');
do $$ begin
  assert not exists (select 1 from jsonb_array_elements(public.seller_team(current_setting('t.sendero')::uuid)
                                                        -> 'invitations') i
                     where (i ->> 'id')::uuid in (current_setting('t.inv_by_admin')::uuid,
                                                   current_setting('t.inv_by_admin2')::uuid)),
    'the owner no longer sees what the former administrator sent';
end $$;
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert public.my_invitations() = '[]'::jsonb, 'the person invited no longer sees it';
  perform pg_temp.refused(format('select public.seller_answer_invitation(%L, true)', current_setting('t.inv_by_admin')),
    'invitation_not_found');
  assert not private.is_seller_member(current_setting('t.sendero')::uuid), 'and cannot join';
end $$;
reset role; select pg_temp.logout();
do $$ begin
  assert (select bool_and(status = 'revoked') from public.seller_invitations
          where id in (current_setting('t.inv_by_admin')::uuid, current_setting('t.inv_by_admin2')::uuid)),
    'both invitations are marked withdrawn';
end $$;
-- Even if one were left pending, an inviter who is gone backs nothing.
update public.seller_invitations set status = 'pending', answered_at = null, answered_by = null
where id = current_setting('t.inv_by_admin')::uuid;
select pg_temp.login('comprador2@yuntera.example');
select public.seller_remove_member(current_setting('t.sendero')::uuid, current_setting('t.uid_comprador2')::uuid);
reset role; select pg_temp.logout();
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format('select public.seller_answer_invitation(%L, true)', current_setting('t.inv_by_admin')),
  'invitation_not_found');
reset role; select pg_temp.logout();

-- ═══ Review: an unapproved shop's listing cannot go on sale ══════════════

update public.sellers set status = 'pending' where id = current_setting('t.bazar')::uuid;
select pg_temp.remember('bazar_listing', (select id::text from public.products where slug = 'lampara-mesa-bambu'));
update public.products set status = 'pending_review' where id = current_setting('t.bazar_listing')::uuid;
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_row record;
begin
  select * into v_row from public.ops_listings_for_review() l
  where l.product_id = current_setting('t.bazar_listing')::uuid;
  assert v_row.seller_status = 'pending', 'the queue says the shop is not verified';
  perform pg_temp.refused(format('select public.ops_review_product(%L, true)', current_setting('t.bazar_listing')),
    'listing_shop_not_active');
end
$$;
reset role; select pg_temp.logout();
select pg_temp.login_anon();
do $$ begin
  assert not exists (select 1 from public.search_products('lampara') s where s.slug = 'lampara-mesa-bambu'),
    'and shoppers do not find it';
end $$;
reset role; select pg_temp.logout();
-- Any other path is held too, not only the console's function.
do $$
begin
  update public.products set status = 'active' where id = current_setting('t.bazar_listing')::uuid;
  raise exception 'a pending shop''s listing went on sale';
exception when others then
  if sqlerrm <> 'listing_shop_not_active' then raise; end if;
end
$$;
update public.sellers set status = 'active' where id = current_setting('t.bazar')::uuid;
select pg_temp.login('central@yuntera.example');
select public.ops_review_product(current_setting('t.bazar_listing')::uuid, true);
reset role; select pg_temp.logout();
do $$ begin
  assert (select status from public.products where id = current_setting('t.bazar_listing')::uuid) = 'active',
    'once the shop is verified the listing is published';
end $$;
update public.sellers set status = 'pending' where id = current_setting('t.bazar')::uuid;

-- ═══ Review: a closed shop only reads ════════════════════════════════════

update public.sellers set status = 'closed' where id = current_setting('t.sendero')::uuid;
select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.sendero')::uuid;
begin
  assert public.seller_overview(v_seller) is not null, 'a closed shop reads its data';
  perform pg_temp.refused(format(
    'select public.seller_save_location(%L, ''Bodega nueva'', ''San José, Escazú, 200 m norte de la iglesia'', ''10201'', 9.92, -84.14)',
    v_seller), 'shop_closed');
  perform pg_temp.refused(format('select public.seller_set_stock(%L, %L, 3)',
    (select id from public.warehouses where seller_id = v_seller limit 1),
    (select sku_id from public.offers where seller_id = v_seller limit 1)), 'shop_closed');
  -- It may still ask for its payout account to be changed, to be paid what it is owed.
  assert public.seller_request_payout_details(v_seller, 'CR05015202001026284066', 'Sendero Outdoor S.R.L.')
         is not null, 'a closed shop can still be paid';
end
$$;
reset role; select pg_temp.logout();
update public.sellers set status = 'active' where id = current_setting('t.sendero')::uuid;

-- ═══ Review: driver_today keeps whatever body it had, behind the gate ════

do $$
begin
  assert (select prosecdef from pg_proc where oid = 'public.driver_today()'::regprocedure), 'the gate is definer';
  assert not has_function_privilege('authenticated', 'private.driver_today_active()', 'execute')
     and not has_function_privilege('anon', 'private.driver_today_active()', 'execute'),
    'the body is reachable only through the gate';
  assert has_function_privilege('authenticated', 'public.driver_today()', 'execute')
     and not has_function_privilege('anon', 'public.driver_today()', 'execute'), 'signed-in only';
end
$$;
update public.drivers set status = 'active' where user_id = current_setting('t.uid_repartidor')::uuid;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.uid_repartidor'), 'role', 'authenticated')::text, true);
do $$ begin
  assert public.driver_today() = private.driver_today_active(), 'an active driver gets the body''s answer unchanged';
end $$;
select pg_temp.logout();

-- ═══ Review: the search wrappers are definer; their bodies are private ═══

do $$
begin
  assert (select bool_and(prosecdef) from pg_proc
          where oid in ('public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer)'::regprocedure,
                        'public.suggest_products(text, integer)'::regprocedure)), 'both wrappers are definer';
  assert not has_function_privilege('anon',
           'private.search_products_unbounded(text, text, bigint, bigint, boolean, boolean, text, integer, integer)', 'execute')
     and not has_function_privilege('authenticated', 'private.suggest_products_unbounded(text, integer)', 'execute'),
    'and the unbounded bodies cannot be called by the API roles';
end
$$;
select pg_temp.login_anon();
do $$ begin
  assert (select count(*) from public.search_products('licuadora')) >= 1, 'a visitor still searches';
  assert (select count(*) from public.suggest_products('licua')) >= 1, 'and gets suggestions';
end $$;
reset role; select pg_temp.logout();

-- ═══ Review (FA-7): nothing is planned for an address a visitor typed ════

-- The notifications tables are not in this branch; a table of the same shape
-- for the recipient shows what the trigger on them does.
create temp table deliveries_probe (recipient text not null, channel text not null);
create trigger probe_no_typed_address before insert on deliveries_probe
  for each row execute function private.drop_typed_address_deliveries();
insert into deliveries_probe values ('report:00000000-0000-4000-8000-000000000001', 'email'),
                                    ('user:00000000-0000-4000-8000-000000000002', 'email');
do $$ begin
  assert (select array_agg(recipient) from deliveries_probe) = array['user:00000000-0000-4000-8000-000000000002'],
    'a delivery to a visitor''s typed address is dropped; one to an account is kept';
end $$;

-- ═══ Identification numbers: the same cases as packages/core ═══════════════

-- packages/core/src/cr/cr.test.ts reads the lines between the markers and runs
-- the same cases through parseIdentification, so both sides agree.
create function pg_temp.check_id(p_type public.identification_type, p_number text, p_valid boolean) returns void
language plpgsql as $$
begin
  assert private.is_valid_identification(p_type, p_number) = p_valid,
    format('%s %s should be %s', p_type, p_number, case when p_valid then 'valid' else 'invalid' end);
end;
$$;
-- BEGIN identification_cases
select pg_temp.check_id('fisica', '109870654', true);
select pg_temp.check_id('fisica', '012345678', false);
select pg_temp.check_id('fisica', '10987065', false);
select pg_temp.check_id('fisica', '1098706541', false);
select pg_temp.check_id('juridica', '3101700202', true);
select pg_temp.check_id('juridica', '2100042005', true);
select pg_temp.check_id('juridica', '6101700202', false);
select pg_temp.check_id('juridica', '310170020', false);
select pg_temp.check_id('dimex', '15520012345', true);
select pg_temp.check_id('dimex', '155200123456', true);
select pg_temp.check_id('dimex', '05520012345', false);
select pg_temp.check_id('dimex', '1552001234', false);
select pg_temp.check_id('nite', '1234567890', true);
select pg_temp.check_id('nite', '0123456789', true);
select pg_temp.check_id('nite', '123456789', false);
-- END identification_cases

rollback;
