-- Shelf rows left at 0 units. A move that empties a shelf (wms_move_stock),
-- a pick that takes a shelf's last units (wms_confirm_pick) and a correction
-- down to 0 (wms_adjust_stock) leave the bin_stock row at 0 instead of
-- deleting it; the hosted check of wave 7 found two such rows. Nothing
-- deletes bin_stock rows anywhere.
--
-- This suite proves that a 0-unit row does nothing anywhere: every function
-- that reads or writes bin_stock answers for a location holding a 0-unit row
-- exactly as for a location with no row at all. Two of the suite's own shelves
-- are compared: z0 (a 0-unit row of the notebook, left by a move) and zn (no
-- row of it). The readers and rules checked: the location page
-- (wms_location_stock), the location list and its product count
-- (wms_stock_locations), the console's list (ops_warehouse_locations), the
-- product lookup (wms_find_sku), the count's lookup and the count
-- (wms_count_candidates, wms_count_into_location), a correction up and down
-- (wms_adjust_stock), the shelf ranking of picks (release to picking), a move
-- into the shelf, renaming the location (ops_rename_location), switching it
-- off and on (ops_set_location_active), and the conservation check (on hand
-- = the shelves plus the units picked into open parcels).
--
-- Decision (docs/02-architecture/decisions.md, 52): such rows stay. Removing
-- them would need redefinitions of the move, the pick and the correction and
-- a clean-up, against a row that changes no answer.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

-- ── Fixtures ────────────────────────────────────────────────────────────────

select pg_temp.remember('platform', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('offer', pg_temp.offer('libreta-tapa-dura-a5')::text);
select pg_temp.remember('sku', (select o.sku_id::text from public.offers o where o.id = current_setting('t.offer')::uuid));
select pg_temp.remember('seller', (select o.seller_id::text from public.offers o where o.id = current_setting('t.offer')::uuid));
select pg_temp.remember('code', (select code from public.skus where id = current_setting('t.sku')::uuid));
-- The notebook's fullest shelf in SJO1, where the suite's units come from.
select pg_temp.remember('home', (select b.location_id::text from public.bin_stock b
  join public.warehouse_locations l on l.id = b.location_id
  where l.warehouse_id = current_setting('t.platform')::uuid and l.active
    and b.sku_id = current_setting('t.sku')::uuid and b.seller_id = current_setting('t.seller')::uuid
  order by b.quantity desc limit 1));

select pg_temp.act('central@yuntera.example');
select pg_temp.remember('z0', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-74-01-A', 'storage') ->> 'id');
select pg_temp.remember('zn', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-74-02-A', 'storage') ->> 'id');
select pg_temp.logout();

-- The conservation check: on hand = the shelves + the units picked into open parcels.
create function pg_temp.conserved() returns boolean
language sql as $$
  select l.on_hand = (select coalesce(sum(b.quantity), 0) from public.bin_stock b
                        join public.warehouse_locations wl on wl.id = b.location_id
                       where wl.warehouse_id = l.warehouse_id and b.sku_id = l.sku_id and b.seller_id = l.seller_id)
                   + (select coalesce(sum(t.picked_quantity), 0) from public.pick_tasks t
                        join public.shipments s on s.id = t.shipment_id
                       where s.status = 'picking' and t.status <> 'cancelled' and t.warehouse_id = l.warehouse_id
                         and t.sku_id = l.sku_id and t.seller_id = l.seller_id)
  from public.stock_levels l
  where l.warehouse_id = current_setting('t.platform')::uuid
    and l.sku_id = current_setting('t.sku')::uuid and l.seller_id = current_setting('t.seller')::uuid
$$;

-- An answer of a location function with what tells z0 and zn apart (id and code) taken out.
create function pg_temp.bare(p jsonb) returns jsonb
language sql as $$ select p - 'id' - 'code' - 'location_id' - 'location_code' - 'previous_code' $$;

-- ═══ 1. A move that empties a shelf leaves a 0-unit row ═══════════════════

select pg_temp.act('bodega@yuntera.example');
select public.wms_move_stock(current_setting('t.home')::uuid, current_setting('t.z0')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 2, null);
select public.wms_move_stock(current_setting('t.z0')::uuid, current_setting('t.home')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 2, null);
select pg_temp.logout();
do $$ begin
  assert (select quantity from public.bin_stock where location_id = current_setting('t.z0')::uuid
          and sku_id = current_setting('t.sku')::uuid and seller_id = current_setting('t.seller')::uuid) = 0,
    'fixture: the move that emptied z0 left its row at 0';
  assert not exists (select 1 from public.bin_stock where location_id = current_setting('t.zn')::uuid),
    'fixture: zn has no row';
  assert pg_temp.conserved(), 'conservation: holds with a 0-unit row';
end $$;

-- ═══ 2. The readers answer as for no row ══════════════════════════════════

select pg_temp.act('bodega@yuntera.example');
do $$
declare
  v_z0 jsonb := public.wms_location_stock(current_setting('t.platform')::uuid, 'Y-74-01-A');
  v_zn jsonb := public.wms_location_stock(current_setting('t.platform')::uuid, 'Y-74-02-A');
  v_list jsonb := public.wms_stock_locations(current_setting('t.platform')::uuid);
  v_find jsonb := public.wms_find_sku(current_setting('t.platform')::uuid, current_setting('t.code'));
  v_c0 jsonb := public.wms_count_candidates(current_setting('t.z0')::uuid, current_setting('t.code'));
  v_cn jsonb := public.wms_count_candidates(current_setting('t.zn')::uuid, current_setting('t.code'));
begin
  -- The location page: no product listed, 0 units, nothing promised.
  assert v_z0 -> 'items' = '[]'::jsonb and (v_z0 ->> 'units')::int = 0, 'page: the 0-unit row is not listed';
  assert pg_temp.bare(v_z0) = pg_temp.bare(v_zn), format('page: z0 %s <> zn %s', v_z0, v_zn);
  -- The location list: 0 units and 0 products, as for no row.
  assert (select pg_temp.bare(x) from jsonb_array_elements(v_list) x where x ->> 'code' = 'Y-74-01-A')
       = (select pg_temp.bare(x) from jsonb_array_elements(v_list) x where x ->> 'code' = 'Y-74-02-A'),
    'list: z0 and zn are the same';
  assert (select (x ->> 'products')::int + (x ->> 'units')::int from jsonb_array_elements(v_list) x
          where x ->> 'code' = 'Y-74-01-A') = 0, 'list: z0 counts no product';
  -- The product lookup: z0 is not among its shelves.
  assert not exists (select 1 from jsonb_array_elements(v_find -> 'bins') b
                     where b ->> 'location_id' = current_setting('t.z0')), 'find: z0 is not a shelf of it';
  -- The count's lookup: not listed, 0 on the shelf, the same as no row.
  assert v_c0 = v_cn, format('candidates: z0 %s <> zn %s', v_c0, v_cn);
  assert (v_c0 -> 0 -> 'shops' -> 0 ->> 'listed')::boolean = false, 'candidates: not listed';
end $$;
select pg_temp.logout();

select pg_temp.act('central@yuntera.example');
do $$
declare
  v_all jsonb := (select w -> 'locations' from jsonb_array_elements(public.ops_warehouse_locations()) w
                  where w ->> 'code' = 'SJO1');
begin
  assert (select pg_temp.bare(x) from jsonb_array_elements(v_all) x where x ->> 'code' = 'Y-74-01-A')
       = (select pg_temp.bare(x) from jsonb_array_elements(v_all) x where x ->> 'code' = 'Y-74-02-A'),
    'console: z0 and zn are the same';
end $$;
select pg_temp.logout();

-- ═══ 3. Picks are never sent to a 0-unit row ═════════════════════════════

-- Every other shelf of the notebook emptied for a moment (rolled back), so the
-- only rows left are z0 (0 units) and the home shelf with 1: an order of 1 is
-- sent to the home shelf, never to z0.
savepoint picks;
update public.bin_stock b set quantity = case when b.location_id = current_setting('t.home')::uuid then 1 else 0 end
from public.warehouse_locations l
where l.id = b.location_id and l.warehouse_id = current_setting('t.platform')::uuid
  and b.sku_id = current_setting('t.sku')::uuid and b.seller_id = current_setting('t.seller')::uuid
  and b.location_id <> current_setting('t.z0')::uuid;
update public.stock_levels set on_hand = 1 + reserved
where warehouse_id = current_setting('t.platform')::uuid
  and sku_id = current_setting('t.sku')::uuid and seller_id = current_setting('t.seller')::uuid;
select pg_temp.act('comprador@yuntera.example');
select pg_temp.remember('order', public.place_order(
  jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.offer')::uuid, 'quantity', 1)),
  (select a.id from public.addresses a join auth.users u on u.id = a.user_id
    where u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null),
  'cash_on_delivery', 'zero-row-174') ->> 'order_id');
select pg_temp.logout();
do $$ begin
  assert (select array_agg(t.location_id::text) from public.pick_tasks t
          join public.shipments s on s.id = t.shipment_id where s.order_id = current_setting('t.order')::uuid)
       = array[current_setting('t.home')], 'picks: sent to the shelf with the unit, not to the 0-unit row';
end $$;
rollback to savepoint picks;

-- ═══ 4. The writers treat it as no row ═══════════════════════════════════

select pg_temp.act('bodega@yuntera.example');
-- A correction down from 0: refused the same way on both.
select pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, -1, %L, null)',
  current_setting('t.z0'), current_setting('t.sku'), current_setting('t.seller'), 'Conteo de prueba'), 'adjust_below_zero');
select pg_temp.refused(format('select public.wms_adjust_stock(%L, %L, %L, -1, %L, null)',
  current_setting('t.zn'), current_setting('t.sku'), current_setting('t.seller'), 'Conteo de prueba'), 'adjust_below_zero');
-- A correction up from the screen's 0: accepted on both, then back down to 0.
select public.wms_adjust_stock(current_setting('t.z0')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 1, 'Conteo de prueba', 0);
select public.wms_adjust_stock(current_setting('t.zn')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 1, 'Conteo de prueba', 0);
select public.wms_adjust_stock(current_setting('t.z0')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, -1, 'Conteo de prueba', 1);
select public.wms_adjust_stock(current_setting('t.zn')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, -1, 'Conteo de prueba', 1);
-- The count of a product the location does not list: accepted on both.
select public.wms_count_into_location(current_setting('t.z0')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 2, 'Conteo de prueba');
select public.wms_count_into_location(current_setting('t.zn')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 2, 'Conteo de prueba');
-- And a move into it: the same on both.
select public.wms_move_stock(current_setting('t.home')::uuid, current_setting('t.z0')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 1, null);
select public.wms_move_stock(current_setting('t.home')::uuid, current_setting('t.zn')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 1, null);
select pg_temp.logout();
do $$ begin
  assert pg_temp.conserved(), 'conservation: holds after the writes';
  assert (select array_agg(b.quantity order by l.code) from public.bin_stock b
          join public.warehouse_locations l on l.id = b.location_id
          where b.location_id in (current_setting('t.z0')::uuid, current_setting('t.zn')::uuid)
            and b.sku_id = current_setting('t.sku')::uuid) = array[3, 3],
    'writers: the same units on both shelves';
end $$;

-- Empty both again (zn now has a 0-unit row too, from a correction).
select pg_temp.act('bodega@yuntera.example');
select public.wms_adjust_stock(current_setting('t.z0')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, -3, 'Conteo de prueba', 3);
select public.wms_move_stock(current_setting('t.zn')::uuid, current_setting('t.home')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 3, null);
select pg_temp.logout();

-- ═══ 5. Renaming and switching off ═══════════════════════════════════════

select pg_temp.act('central@yuntera.example');
do $$
declare
  v_renamed jsonb := public.ops_rename_location(current_setting('t.z0')::uuid, 'Y-74-03-A');
  v_off jsonb := public.ops_set_location_active(current_setting('t.z0')::uuid, false);
begin
  assert (v_renamed ->> 'units')::int = 0 and v_renamed ->> 'previous_code' = 'Y-74-01-A',
    'rename: a location with a 0-unit row is renamed';
  assert (v_off ->> 'active')::boolean = false, 'switch off: a 0-unit row does not hold it on';
end $$;
select pg_temp.logout();
select pg_temp.act('bodega@yuntera.example');
do $$ begin
  -- A switched-off location with only 0-unit rows leaves the worker's list.
  assert not exists (select 1 from jsonb_array_elements(public.wms_stock_locations(current_setting('t.platform')::uuid)) x
                     where x ->> 'code' = 'Y-74-03-A'), 'list: the switched-off empty location is not listed';
end $$;
-- Nothing can be counted onto it while it is off.
select pg_temp.refused(format('select public.wms_count_into_location(%L, %L, %L, 1, %L)',
  current_setting('t.z0'), current_setting('t.sku'), current_setting('t.seller'), 'Conteo de prueba'), 'location_inactive');
select pg_temp.logout();
select pg_temp.act('central@yuntera.example');
do $$ begin
  assert (public.ops_set_location_active(current_setting('t.z0')::uuid, true) ->> 'active')::boolean,
    'switch on: back on';
end $$;
select pg_temp.logout();
do $$ begin
  assert pg_temp.conserved(), 'conservation: holds at the end';
end $$;

select 'ok' as zero_unit_shelf_rows;
rollback;
