-- Warehouse stock (20261121084300_warehouse_stock.sql): what a location
-- holds, moving stock between locations, correcting a count, what the shop
-- sees and the staff list. For each: the right caller gets what they asked
-- for, every wrong caller is refused, and what is left behind (shelves, the
-- shop's totals, what shoppers can buy, the ledger, the outbox) is what the
-- header of the migration says.
--
-- Who plays whom: bodega is a worker of SJO1; central is an administrator;
-- a worker of another Yuntera warehouse (created here); vendedor is a seller
-- of another shop; repartidor a driver; comprador a shopper; a visitor.
-- The product is the notebook of Tienda Sendero (sendero is its owner),
-- stored in SJO1; the locations, the orders and their shopper are this
-- suite's own. Every check compares with the suite's own fixtures or with
-- what was there before, so it holds on a used database.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

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

create function pg_temp.denied(p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not denied: %', p_sql;
exception when insufficient_privilege then
  null;
end;
$$;

grant execute on function pg_temp.refused_detail(text, text), pg_temp.denied(text),
  pg_temp.remember(text, text) to authenticated, anon;

-- Units of the suite's product on a shelf (superuser only).
create function pg_temp.bin(p_location text) returns integer
language sql as $$
  select coalesce((select b.quantity from public.bin_stock b
                   where b.location_id = current_setting('t.' || p_location)::uuid
                     and b.sku_id = current_setting('t.sku')::uuid
                     and b.seller_id = current_setting('t.seller')::uuid), 0)
$$;

-- The shop's totals in SJO1 and what shoppers can buy, as one text.
create function pg_temp.totals() returns text
language sql as $$
  select format('on_hand=%s reserved=%s available=%s', l.on_hand, l.reserved, o.available_quantity)
  from public.stock_levels l
  join public.offers o on o.sku_id = l.sku_id and o.seller_id = l.seller_id
  where l.warehouse_id = current_setting('t.platform')::uuid
    and l.sku_id = current_setting('t.sku')::uuid and l.seller_id = current_setting('t.seller')::uuid
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────

select pg_temp.remember('platform', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('sku', (select o.sku_id::text from public.offers o where o.id = pg_temp.offer('libreta-tapa-dura-a5')));
select pg_temp.remember('seller', (select o.seller_id::text from public.offers o where o.id = pg_temp.offer('libreta-tapa-dura-a5')));
select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('reception', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.platform')::uuid and code = 'REC-01'));
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.remember('moves_from', (select coalesce(max(id), 0)::text from public.stock_movements));
do $$ begin
  assert current_setting('t.sku') <> '' and current_setting('t.seller') <> '', 'fixture: the notebook';
  assert (select fulfillment from public.offers where id = pg_temp.offer('libreta-tapa-dura-a5')) = 'platform',
    'fixture: stored in a Yuntera warehouse';
end $$;

-- Three locations of the suite's own in SJO1.
select pg_temp.act('central@yuntera.example');
select pg_temp.remember('l1', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-68-01-A', 'storage') ->> 'id');
select pg_temp.remember('l2', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-68-02-A', 'pick') ->> 'id');
select pg_temp.remember('l3', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-68-03-A', 'storage') ->> 'id');
select pg_temp.logout();

-- Another Yuntera warehouse, with a worker and a location of its own.
insert into public.warehouses (code, name, kind, address, postal_code, lat, lng)
values ('ZZ168', 'Bodega de la prueba 168', 'platform', 'Cartago centro', '30101', 9.86, -83.92);
select pg_temp.remember('other_wh', (select id::text from public.warehouses where code = 'ZZ168'));
insert into public.warehouse_locations (warehouse_id, code, kind)
values (current_setting('t.other_wh')::uuid, 'Y-68-09-A', 'storage');
select pg_temp.remember('other_loc', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.other_wh')::uuid and code = 'Y-68-09-A'));
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'otrabodega168@yuntera.example', '{"full_name": "Otra Bodega Prueba"}');
insert into public.warehouse_staff (warehouse_id, user_id, role)
select current_setting('t.other_wh')::uuid, id, 'associate' from auth.users
where email = 'otrabodega168@yuntera.example';

select pg_temp.shopper('stock168@yuntera.example', 'Prueba Existencias Bodega');
select pg_temp.remember('totals_start', pg_temp.totals());

-- ═══ 1. Who may call what ══════════════════════════════════════════════════

do $$
declare
  v_missing text;
begin
  select string_agg(f.fn, ', ') into v_missing
  from unnest(array['wms_stock_locations', 'wms_location_stock', 'wms_find_sku', 'wms_move_stock',
                    'wms_adjust_stock', 'seller_stock_history', 'ops_stock_changes']) f (fn)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f.fn and p.prosecdef
                      and p.proconfig @> array['search_path=""']
                      and has_function_privilege('authenticated', p.oid, 'execute')
                      and not has_function_privilege('anon', p.oid, 'execute'));
  assert v_missing is null, format('who: not as documented: %s', v_missing);
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'wms_adjust_stock') = 1,
    'who: one wms_adjust_stock';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'private'
                       and p.proname in ('location_promised', 'location_picked_item', 'wms_location_json')
                       and (has_function_privilege('authenticated', p.oid, 'execute')
                            or has_function_privilege('anon', p.oid, 'execute'))),
    'who: the private helpers are not callable by the app roles';
end $$;

-- A visitor: no privilege at all.
select pg_temp.login_anon();
do $$ begin
  perform pg_temp.denied(format('select public.wms_stock_locations(%L)', current_setting('t.platform')));
  perform pg_temp.denied(format('select public.wms_location_stock(%L, %L)', current_setting('t.platform'), 'Y-68-01-A'));
  perform pg_temp.denied(format('select public.wms_move_stock(%L, %L, %L, %L, 1)', current_setting('t.l1'),
    current_setting('t.l2'), current_setting('t.sku'), current_setting('t.seller')));
  perform pg_temp.denied(format('select public.wms_adjust_stock(%L, %L, %L, 1, %L)', current_setting('t.l1'),
    current_setting('t.sku'), current_setting('t.seller'), 'Conteo de un visitante'));
  perform pg_temp.denied(format('select public.seller_stock_history(%L)', current_setting('t.seller')));
  perform pg_temp.denied('select public.ops_stock_changes()');
end $$;
reset role;

-- A shopper, a seller of another shop, a driver, a worker of another
-- warehouse: refused, and the shelves untouched.
do $$
declare
  v_who text;
begin
  foreach v_who in array array['comprador@yuntera.example', 'vendedor@yuntera.example',
                               'repartidor@yuntera.example', 'otrabodega168@yuntera.example'] loop
    perform pg_temp.login(v_who);
    perform pg_temp.refused(format('select public.wms_stock_locations(%L)', current_setting('t.platform')), 'forbidden');
    perform pg_temp.refused(format('select public.wms_location_stock(%L, %L)', current_setting('t.platform'), 'Y-68-01-A'), 'forbidden');
    perform pg_temp.refused(format('select public.wms_find_sku(%L, %L)', current_setting('t.platform'), 'YT-X'), 'forbidden');
    perform pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, 5, %L)', current_setting('t.l1'),
      current_setting('t.sku'), current_setting('t.seller'), 'Conteo de quien no debe'), 'forbidden');
    perform pg_temp.refused(format('select public.ops_stock_changes()'), 'forbidden');
    perform pg_temp.refused(format('select public.seller_stock_history(%L)', current_setting('t.seller')), 'forbidden');
    reset role;
  end loop;
end $$;
-- The other warehouse's worker sees their own warehouse, not SJO1's location by code.
select pg_temp.login('otrabodega168@yuntera.example');
do $$ begin
  assert public.wms_location_stock(current_setting('t.other_wh')::uuid, 'Y-68-09-A') ->> 'code' = 'Y-68-09-A',
    'who: a worker opens a location of their own warehouse';
  assert public.wms_location_stock(current_setting('t.other_wh')::uuid, 'Y-68-01-A') is null,
    'who: a code of another warehouse is not found in theirs';
end $$;
reset role;
-- A seller reads their own shop's history only.
select pg_temp.login('vendedor@yuntera.example');
do $$ begin
  assert jsonb_typeof(public.seller_stock_history(current_setting('t.tecnocasa')::uuid)) = 'array',
    'who: a seller reads their own history';
end $$;
reset role;

-- ═══ 2. A count correction that adds units, and what a location holds ═════

-- Refused before anything is written.
select pg_temp.login('bodega@yuntera.example');
select pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, 10, %L)', current_setting('t.l1'),
  current_setting('t.sku'), current_setting('t.seller'), 'abc'), 'invalid_adjustment');
select pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, 10, %L)', current_setting('t.l1'),
  current_setting('t.sku'), current_setting('t.seller'), '12345 67'), 'invalid_adjustment');
select pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, 0, %L)', current_setting('t.l1'),
  current_setting('t.sku'), current_setting('t.seller'), 'Conteo sin diferencia'), 'invalid_adjustment');
-- A product this shop does not sell is never counted into existence.
select pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, 10, %L)', current_setting('t.l1'),
  current_setting('t.sku'), current_setting('t.tecnocasa'), 'Conteo de otra tienda'), 'offer_not_found');
-- The screen's number must still be the shelf's.
do $$ begin
  assert pg_temp.refused_detail(format('select public.wms_adjust_stock(%L, %L, %L, 10, %L, 3)', current_setting('t.l1'),
    current_setting('t.sku'), current_setting('t.seller'), 'Conteo inicial de la prueba'), 'count_changed') = '0',
    'count: refused when the shelf is not what the screen showed';
end $$;
select public.wms_adjust_stock(current_setting('t.l1')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 10, '  Conteo inicial de la prueba  ', 0);
-- The fifth-argument form the typed method has always sent still works.
select public.wms_adjust_stock(current_setting('t.l3')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 2, 'Dos unidades encontradas en el estante');
reset role;

do $$
declare
  m public.stock_movements%rowtype;
begin
  assert pg_temp.bin('l1') = 10 and pg_temp.bin('l3') = 2, 'count: the shelves hold what was counted';
  assert pg_temp.totals() = (select format('on_hand=%s reserved=%s available=%s',
           split_part(split_part(current_setting('t.totals_start'), 'on_hand=', 2), ' ', 1)::integer + 12,
           split_part(split_part(current_setting('t.totals_start'), 'reserved=', 2), ' ', 1),
           split_part(current_setting('t.totals_start'), 'available=', 2)::integer + 12)),
    format('count: the shop owns 12 more and shoppers can buy them: %s -> %s', current_setting('t.totals_start'), pg_temp.totals());
  select * into m from public.stock_movements
  where id > current_setting('t.moves_from')::bigint and to_location_id = current_setting('t.l1')::uuid;
  assert m.reason = 'adjust' and m.reference_type = 'cycle_count' and m.on_hand_delta = 10
         and m.note = 'Conteo inicial de la prueba'
         and m.actor_id = (select id from auth.users where email = 'bodega@yuntera.example'),
    format('count: the ledger row %s', row_to_json(m));
end $$;

-- The location, opened by its code as typed or scanned.
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb;
  i jsonb;
begin
  v := public.wms_location_stock(current_setting('t.platform')::uuid, ' y-68-01-a ');
  assert v ->> 'id' = current_setting('t.l1') and (v ->> 'active')::boolean and (v ->> 'shelf')::boolean
         and v #>> '{warehouse,code}' = 'SJO1' and (v ->> 'units')::integer = 10
         and (v ->> 'free')::integer = 10 and (v ->> 'promised')::integer = 0
         and jsonb_array_length(v -> 'items') = 1,
    format('location: %s', v);
  i := v -> 'items' -> 0;
  assert i ->> 'sku_id' = current_setting('t.sku') and i ->> 'seller_name' = 'Tienda Sendero'
         and i ->> 'title' like 'Libreta%' and (i ->> 'on_shelf')::integer = 10
         and (i ->> 'promised')::integer = 0 and (i ->> 'free')::integer = 10
         and (i ->> 'picked_waiting')::integer = 0,
    format('location: its item %s', i);
  assert v::text !~* '(senas|phone|recipient|delivery_pin|email|full_name)', 'location: no personal data';
  assert public.wms_location_stock(current_setting('t.platform')::uuid, 'NO-EXISTE') is null, 'location: unknown code';
  assert public.wms_location_stock(current_setting('t.platform')::uuid, repeat('A', 41)) is null, 'location: absurd code';
  assert exists (select 1 from jsonb_array_elements(public.wms_stock_locations(current_setting('t.platform')::uuid)) l
                 where l ->> 'id' = current_setting('t.l1') and (l ->> 'units')::integer = 10
                   and (l ->> 'products')::integer = 1 and (l ->> 'active')::boolean),
    'location: in the list';
  -- The reverse: the product's locations, with what is free in each.
  assert exists (select 1 from jsonb_array_elements(public.wms_find_sku(current_setting('t.platform')::uuid,
                   (select code from public.skus where id = current_setting('t.sku')::uuid)) -> 'bins') b
                 where b ->> 'location_id' = current_setting('t.l1') and (b ->> 'quantity')::integer = 10
                   and (b ->> 'free')::integer = 10 and (b ->> 'promised')::integer = 0
                   and (b ->> 'location_active')::boolean and b ->> 'location_kind' = 'storage'),
    'product: its locations';
end $$;
reset role;

-- ═══ 3. Moving stock ═══════════════════════════════════════════════════════

select pg_temp.remember('events_before_move', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.remember('totals_before_move', pg_temp.totals());
select pg_temp.remember('history_before_move', (select count(*)::text from public.stock_movements
  where seller_id = current_setting('t.seller')::uuid and on_hand_delta <> 0));
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.wms_move_stock(current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
    current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 4, ' Reordenar el estante ');
  assert (v ->> 'quantity')::integer = 4 and v #>> '{from,code}' = 'Y-68-01-A'
         and (v #>> '{from,on_shelf}')::integer = 6 and (v #>> '{from,free}')::integer = 6
         and v #>> '{to,code}' = 'Y-68-02-A' and (v #>> '{to,on_shelf}')::integer = 4,
    format('move: the answer %s', v);
  perform pg_temp.remember('move_id', v ->> 'movement_id');
end $$;
reset role;
do $$
declare
  m public.stock_movements%rowtype;
begin
  assert pg_temp.bin('l1') = 6 and pg_temp.bin('l2') = 4, 'move: both shelves';
  assert pg_temp.totals() = current_setting('t.totals_before_move'),
    format('move: the shop''s totals and what shoppers can buy unchanged: %s', pg_temp.totals());
  select * into m from public.stock_movements where id = current_setting('t.move_id')::bigint;
  assert m.reason = 'transfer' and m.on_hand_delta = 0 and m.quantity = 4
         and m.from_location_id = current_setting('t.l1')::uuid and m.to_location_id = current_setting('t.l2')::uuid
         and m.reference_type = 'stock_move' and m.note = 'Reordenar el estante'
         and m.warehouse_id = current_setting('t.platform')::uuid
         and m.actor_id = (select id from auth.users where email = 'bodega@yuntera.example')
         and m.created_at is not null,
    format('move: one ledger row with both sides, who and when %s', row_to_json(m));
  assert (select count(*) from public.stock_movements where id > current_setting('t.moves_from')::bigint
          and reason = 'transfer') = 1, 'move: exactly one row';
  assert (select coalesce(max(id), 0) from private.outbox_events) = current_setting('t.events_before_move')::bigint,
    'move: no event for anyone (the shop is told nothing)';
  assert (select count(*) from public.stock_movements where seller_id = current_setting('t.seller')::uuid
          and on_hand_delta <> 0)::text = current_setting('t.history_before_move'),
    'move: nothing new in what the shop''s history lists';
end $$;

-- Refusals, each with nothing written.
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v_move text := 'select public.wms_move_stock(%L, %L, %L, %L, %s)';
begin
  perform pg_temp.refused(format(v_move, current_setting('t.l1'), current_setting('t.l1'),
    current_setting('t.sku'), current_setting('t.seller'), 1), 'move_same_location');
  perform pg_temp.refused(format(v_move, current_setting('t.l1'), current_setting('t.l2'),
    current_setting('t.sku'), current_setting('t.seller'), 0), 'invalid_quantity');
  perform pg_temp.refused(format(v_move, current_setting('t.l1'), current_setting('t.l2'),
    current_setting('t.sku'), current_setting('t.seller'), -2), 'invalid_quantity');
  assert pg_temp.refused_detail(format(v_move, current_setting('t.l1'), current_setting('t.l2'),
    current_setting('t.sku'), current_setting('t.seller'), 7), 'move_exceeds_free') = '6',
    'move: more than is free, with how many are';
  perform pg_temp.refused(format(v_move, current_setting('t.l1'), current_setting('t.reception'),
    current_setting('t.sku'), current_setting('t.seller'), 1), 'move_target_not_shelf');
  perform pg_temp.refused(format(v_move, current_setting('t.l1'), current_setting('t.other_loc'),
    current_setting('t.sku'), current_setting('t.seller'), 1), 'move_other_warehouse');
  perform pg_temp.refused(format(v_move, current_setting('t.l1'), gen_random_uuid(),
    current_setting('t.sku'), current_setting('t.seller'), 1), 'location_not_found');
  perform pg_temp.refused(format(v_move, current_setting('t.l1'), current_setting('t.l2'),
    current_setting('t.sku'), current_setting('t.tecnocasa'), 1), 'move_nothing_here');
end $$;
reset role;
-- Another warehouse's worker cannot move SJO1's stock.
select pg_temp.login('otrabodega168@yuntera.example');
select pg_temp.refused(format('select public.wms_move_stock(%L, %L, %L, %L, 1)', current_setting('t.l1'),
  current_setting('t.l2'), current_setting('t.sku'), current_setting('t.seller')), 'forbidden');
reset role;
do $$ begin
  assert pg_temp.bin('l1') = 6 and pg_temp.bin('l2') = 4, 'move: the refusals wrote nothing';
end $$;

-- ═══ 4. A move never takes units a pick is waiting for ════════════════════

-- Every other shelf's free units of the product go to L2, so the warehouse
-- holds it in L1, L2 and L3 only (L3's two units stay out of the way below).
select pg_temp.act('central@yuntera.example');
do $$
declare
  b record;
begin
  for b in
    select x.location_id, x.free from (
      select bs.location_id,
             greatest(bs.quantity - private.location_promised(bs.location_id, bs.sku_id, bs.seller_id), 0) as free
      from public.bin_stock bs join public.warehouse_locations wl on wl.id = bs.location_id
      where wl.warehouse_id = current_setting('t.platform')::uuid
        and bs.sku_id = current_setting('t.sku')::uuid and bs.seller_id = current_setting('t.seller')::uuid
        and bs.location_id not in (current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
                                   current_setting('t.l3')::uuid)) x
    where x.free > 0
  loop
    perform public.wms_move_stock(b.location_id, current_setting('t.l2')::uuid,
      current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, b.free);
  end loop;
end $$;
select pg_temp.logout();
select pg_temp.remember('f', (pg_temp.bin('l2') - 4)::text);
-- L1 gets more units than L2 (F + 10 against F + 4).
select pg_temp.act('bodega@yuntera.example');
select public.wms_adjust_stock(current_setting('t.l1')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, current_setting('t.f')::integer + 4, 'Cajas encontradas detrás del estante');
select pg_temp.logout();
do $$ begin
  assert pg_temp.bin('l1') = current_setting('t.f')::integer + 10
         and pg_temp.bin('l2') = current_setting('t.f')::integer + 4, 'fixture: L1 holds more than L2';
end $$;

-- Order A, 7 units, paid: its pick task is sent to L1, the shelf with the
-- most free units.
select pg_temp.remember('order_a', pg_temp.place('stock168@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:7'), 'card', 'stock-168-a')::text);
select pg_temp.pay(current_setting('t.order_a')::uuid);
select pg_temp.remember('ship_a', pg_temp.shipment(current_setting('t.order_a')::uuid, 'platform')::text);
select pg_temp.remember('task_a', (select id::text from public.pick_tasks
  where shipment_id = current_setting('t.ship_a')::uuid));
do $$ begin
  assert (select location_id from public.pick_tasks where id = current_setting('t.task_a')::uuid)
         = current_setting('t.l1')::uuid, 'picking: the task goes to the shelf with the most free units';
end $$;

-- L1 now: F + 10 on the shelf, 7 promised, F + 3 free; L2: F + 4, all free.
-- Order B, 1 unit: L1 still holds the most units, but L2 has the most free:
-- the task goes to L2 (the old rule, most units, sent it to L1).
select pg_temp.remember('order_b', pg_temp.place('stock168@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'stock-168-b')::text);
select pg_temp.pay(current_setting('t.order_b')::uuid);
select pg_temp.remember('ship_b', pg_temp.shipment(current_setting('t.order_b')::uuid, 'platform')::text);
do $$ begin
  assert (select location_id from public.pick_tasks where shipment_id = current_setting('t.ship_b')::uuid)
         = current_setting('t.l2')::uuid, 'picking: a shelf whose units are promised is passed over';
end $$;

select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.wms_location_stock(current_setting('t.platform')::uuid, 'Y-68-01-A');
  assert (v ->> 'promised')::integer = 7 and (v ->> 'free')::integer = current_setting('t.f')::integer + 3
         and (v ->> 'open_tasks')::integer = 1
         and (v #>> '{items,0,promised}')::integer = 7,
    format('promise: the location shows it %s', v);
  assert pg_temp.refused_detail(format('select public.wms_move_stock(%L, %L, %L, %L, %s)',
    current_setting('t.l1'), current_setting('t.l3'), current_setting('t.sku'), current_setting('t.seller'),
    current_setting('t.f')::integer + 4), 'move_exceeds_free') = (current_setting('t.f')::integer + 3)::text,
    'promise: a move never takes the promised units';
end $$;
reset role;

-- The picker finds the 7 units: nothing was stranded.
select pg_temp.act('bodega@yuntera.example');
select public.wms_start_picking(current_setting('t.ship_a')::uuid);
select public.wms_confirm_pick(current_setting('t.task_a')::uuid, 7, null,
  (select code from public.skus where id = current_setting('t.sku')::uuid));
select pg_temp.logout();
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.wms_location_stock(current_setting('t.platform')::uuid, 'Y-68-01-A');
  assert (v ->> 'units')::integer = current_setting('t.f')::integer + 3 and (v ->> 'promised')::integer = 0
         and (v ->> 'picked_units')::integer = 7 and (v #>> '{items,0,picked_waiting}')::integer = 7,
    format('pick: picked units shown apart %s', v);
end $$;
reset role;

-- ═══ 5. Correcting a count that takes units away ══════════════════════════

select pg_temp.remember('events_before_count', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.remember('totals_before_count', pg_temp.totals());
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v_adjust text := 'select public.wms_adjust_stock(%L, %L, %L, %s, %L, %s)';
  v_l2 integer := current_setting('t.f')::integer + 4;
begin
  assert pg_temp.refused_detail(format(v_adjust, current_setting('t.l2'), current_setting('t.sku'),
    current_setting('t.seller'), -1, 'Una unidad no aparece', v_l2 + 1), 'count_changed') = v_l2::text,
    'count: the shelf changed since the screen read it';
  -- Order B waits for one unit at L2: the count may not leave fewer.
  assert pg_temp.refused_detail(format(v_adjust, current_setting('t.l2'), current_setting('t.sku'),
    current_setting('t.seller'), -v_l2, 'No queda ninguna', v_l2), 'adjust_below_promised') = '1',
    'count: never below what an open pick waits for';
  assert pg_temp.refused_detail(format(v_adjust, current_setting('t.l2'), current_setting('t.sku'),
    current_setting('t.seller'), -(v_l2 + 1), 'Más de las que hay', v_l2), 'adjust_below_zero') = v_l2::text,
    'count: never below zero';
end $$;
select public.wms_adjust_stock(current_setting('t.l2')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, -1, 'Una unidad no aparece en el estante',
  current_setting('t.f')::integer + 4);
reset role;
do $$
declare
  m public.stock_movements%rowtype;
begin
  assert pg_temp.bin('l2') = current_setting('t.f')::integer + 3, 'count: the shelf';
  assert pg_temp.totals() = (select format('on_hand=%s reserved=%s available=%s',
           split_part(split_part(current_setting('t.totals_before_count'), 'on_hand=', 2), ' ', 1)::integer - 1,
           split_part(split_part(current_setting('t.totals_before_count'), 'reserved=', 2), ' ', 1),
           split_part(current_setting('t.totals_before_count'), 'available=', 2)::integer - 1)),
    format('count: the shop owns one fewer and shoppers can buy one fewer: %s', pg_temp.totals());
  select * into m from public.stock_movements
  where id > current_setting('t.moves_from')::bigint and from_location_id = current_setting('t.l2')::uuid
    and reference_type = 'cycle_count';
  assert m.reason = 'adjust' and m.on_hand_delta = -1 and m.note = 'Una unidad no aparece en el estante',
    format('count: booked as a correction, not as damage %s', row_to_json(m));
  assert (select coalesce(max(id), 0) from private.outbox_events) = current_setting('t.events_before_count')::bigint,
    'count: no event';
end $$;

-- Never fewer in the warehouse than shoppers already bought (fixture: almost
-- every unit reserved).
update public.stock_levels set reserved = on_hand - 1
where warehouse_id = current_setting('t.platform')::uuid and sku_id = current_setting('t.sku')::uuid
  and seller_id = current_setting('t.seller')::uuid;
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  perform pg_temp.refused_detail(format('select public.wms_adjust_stock(%L, %L, %L, -2, %L)',
    current_setting('t.l1'), current_setting('t.sku'), current_setting('t.seller'), 'Dos unidades rotas'),
    'adjust_below_reserved');
end $$;
reset role;
update public.stock_levels l set reserved = (
  select coalesce(sum(r.quantity), 0) from public.inventory_reservations r
  where r.warehouse_id = l.warehouse_id and r.sku_id = l.sku_id and r.seller_id = l.seller_id and r.status = 'active')
where warehouse_id = current_setting('t.platform')::uuid and sku_id = current_setting('t.sku')::uuid
  and seller_id = current_setting('t.seller')::uuid;

-- Operations staff correct too; and A is packed.
select pg_temp.act('central@yuntera.example');
select public.wms_adjust_stock(current_setting('t.l1')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 1, 'Recuento de operaciones');
select public.wms_pack_shipment(current_setting('t.ship_a')::uuid, 900, 1::smallint);
select pg_temp.logout();

-- ═══ 6. Emptying a location to switch it off ══════════════════════════════

select pg_temp.act('central@yuntera.example');
do $$ begin
  assert pg_temp.refused_detail(format('select public.ops_set_location_active(%L, false)', current_setting('t.l1')),
    'location_has_stock') = (current_setting('t.f')::integer + 4)::text, 'switch off: refused while it holds stock';
end $$;
select pg_temp.logout();
select pg_temp.login('bodega@yuntera.example');
select public.wms_move_stock(current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, current_setting('t.f')::integer + 4);
reset role;
select pg_temp.act('central@yuntera.example');
do $$ begin
  assert not (public.ops_set_location_active(current_setting('t.l1')::uuid, false) ->> 'active')::boolean,
    'switch off: accepted once it is empty';
end $$;
select pg_temp.logout();
-- No stock goes into it, with a clear refusal.
select pg_temp.login('bodega@yuntera.example');
select pg_temp.refused(format('select public.wms_move_stock(%L, %L, %L, %L, 1)', current_setting('t.l2'),
  current_setting('t.l1'), current_setting('t.sku'), current_setting('t.seller')), 'location_inactive');
select pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, 1, %L)', current_setting('t.l1'),
  current_setting('t.sku'), current_setting('t.seller'), 'Una unidad apareció'), 'location_inactive');
reset role;

-- A location switched off that still holds stock (fixture: L3, switched off
-- directly) is listed, and emptied by a move.
update public.warehouse_locations set active = false where id = current_setting('t.l3')::uuid;
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb;
begin
  assert exists (select 1 from jsonb_array_elements(public.wms_stock_locations(current_setting('t.platform')::uuid)) l
                 where l ->> 'id' = current_setting('t.l3') and not (l ->> 'active')::boolean
                   and (l ->> 'units')::integer = 2), 'switched off: listed while it holds stock';
  assert not exists (select 1 from jsonb_array_elements(public.wms_stock_locations(current_setting('t.platform')::uuid)) l
                     where l ->> 'id' = current_setting('t.l1')), 'switched off and empty: not listed';
  v := public.wms_move_stock(current_setting('t.l3')::uuid, current_setting('t.l2')::uuid,
    current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 2);
  assert (v #>> '{from,on_shelf}')::integer = 0, 'switched off: emptied by a move';
  assert not exists (select 1 from jsonb_array_elements(public.wms_stock_locations(current_setting('t.platform')::uuid)) l
                     where l ->> 'id' = current_setting('t.l3')), 'switched off: gone from the list once empty';
end $$;
reset role;
do $$ begin
  -- L2 now holds everything: F + 4, - 1 counted away, + F + 4 from L1, + 2 from L3.
  assert pg_temp.bin('l1') = 0 and pg_temp.bin('l3') = 0
         and pg_temp.bin('l2') = 2 * current_setting('t.f')::integer + 9, 'moves: no unit lost or made';
end $$;

-- ═══ 7. What the shop sees ════════════════════════════════════════════════

select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.seller_stock_history(current_setting('t.seller')::uuid, 200);
  assert exists (select 1 from jsonb_array_elements(v) e where e ->> 'kind' = 'warehouse_count'
                 and (e ->> 'change')::integer = -1 and e ->> 'note' = 'Una unidad no aparece en el estante'
                 and e ->> 'warehouse_name' = 'Centro de distribución Curridabat' and e ->> 'title' like 'Libreta%'),
    'shop: the correction that took a unit away, with its reason';
  assert exists (select 1 from jsonb_array_elements(v) e where e ->> 'kind' = 'warehouse_count'
                 and (e ->> 'change')::integer = 10), 'shop: the correction that added units';
  assert exists (select 1 from jsonb_array_elements(v) e where e ->> 'kind' = 'shipped'
                 and (e ->> 'change')::integer = -7 and e ->> 'note' is null), 'shop: the units that left in an order';
  assert not exists (select 1 from jsonb_array_elements(v) e where (e ->> 'change')::integer = 0),
    'shop: no move and no pick';
  assert v::text !~* '(Kattia|Gabriela|bodega@|central@|Prueba Existencias|stock168|Reordenar)',
    'shop: never who in the warehouse, never the shopper, never a move''s note';
  assert jsonb_array_length(public.seller_stock_history(current_setting('t.seller')::uuid, 1)) = 1, 'shop: the limit';
end $$;
reset role;

-- ═══ 8. The staff list ════════════════════════════════════════════════════

select pg_temp.login('central@yuntera.example');
do $$
declare
  v jsonb;
  e jsonb;
begin
  v := public.ops_stock_changes(500);
  select x into e from jsonb_array_elements(v) x where (x ->> 'id')::bigint = current_setting('t.move_id')::bigint;
  assert e ->> 'kind' = 'move' and e ->> 'actor_name' = 'Kattia Rodríguez Salas' and e ->> 'from_code' = 'Y-68-01-A'
         and e ->> 'to_code' = 'Y-68-02-A' and (e ->> 'quantity')::integer = 4 and e ->> 'note' = 'Reordenar el estante'
         and e ->> 'seller_name' = 'Tienda Sendero' and e ->> 'warehouse_code' = 'SJO1' and e ->> 'at' is not null,
    format('staff: the move %s', e);
  assert exists (select 1 from jsonb_array_elements(v) x where x ->> 'kind' = 'correction'
                 and (x ->> 'change')::integer = -1 and x ->> 'from_code' = 'Y-68-02-A'
                 and x ->> 'note' = 'Una unidad no aparece en el estante'), 'staff: the correction';
  assert exists (select 1 from jsonb_array_elements(v) x where x ->> 'kind' = 'correction'
                 and x ->> 'actor_name' = 'Gabriela Soto Marín' and x ->> 'note' = 'Recuento de operaciones'),
    'staff: a correction by operations';
  assert not exists (select 1 from jsonb_array_elements(v) x where x ->> 'kind' not in ('move', 'correction')),
    'staff: only moves and corrections';
  assert v::text !~* '(Prueba Existencias|stock168|senas|phone)', 'staff: no shopper';
  assert jsonb_array_length(public.ops_stock_changes(2)) = 2, 'staff: the limit';
end $$;
reset role;
-- Staff of another role: not this list.
delete from public.staff_members where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
insert into public.staff_members (user_id, role)
select id, 'catalog' from auth.users where email = 'comprador3@yuntera.example';
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused('select public.ops_stock_changes()', 'forbidden');
select pg_temp.refused(format('select public.wms_stock_locations(%L)', current_setting('t.platform')), 'forbidden');
reset role;

-- ═══ 9. What is left behind ═══════════════════════════════════════════════

do $$ begin
  -- Every move row has both sides and no on-hand change; every correction one side.
  assert not exists (select 1 from public.stock_movements where id > current_setting('t.moves_from')::bigint
                     and reason = 'transfer'
                     and (on_hand_delta <> 0 or from_location_id is null or to_location_id is null)),
    'ledger: moves';
  assert not exists (select 1 from public.stock_movements where id > current_setting('t.moves_from')::bigint
                     and reference_type = 'cycle_count' and (reason <> 'adjust' or on_hand_delta = 0)),
    'ledger: corrections';
  -- The shelves of the product add up with what the ledger says moved in and out of them.
  assert (select sum(b.quantity) from public.bin_stock b where b.location_id in (current_setting('t.l1')::uuid,
            current_setting('t.l2')::uuid, current_setting('t.l3')::uuid)
            and b.sku_id = current_setting('t.sku')::uuid and b.seller_id = current_setting('t.seller')::uuid)
         = (select sum(case when m.to_location_id in (current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
                                                      current_setting('t.l3')::uuid) then m.quantity else 0 end)
                 - sum(case when m.from_location_id in (current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
                                                        current_setting('t.l3')::uuid) then m.quantity else 0 end)
            from public.stock_movements m where m.id > current_setting('t.moves_from')::bigint
              and m.sku_id = current_setting('t.sku')::uuid and m.seller_id = current_setting('t.seller')::uuid),
    'ledger: explains the shelves';
end $$;

select 'ok' as warehouse_stock;
rollback;
