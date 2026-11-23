-- Units that come back from a parcel, against the warehouse's stock tools
-- (20261121084200_order_followups.sql and 20261121084300_warehouse_stock.sql
-- together):
--
--   1. Where they land. A parcel staff stopped (ops_recall_shipment) and a
--      parcel sent back after a failed delivery are checked in
--      (wms_receive_returned_shipment): the units land in the warehouse's
--      returns area (DEV-01), the location screen shows them as free, and the
--      stock adds up after each step: the shop's on-hand units equal the
--      units on every location plus those picked into parcels still being
--      picked, and what open picks wait for is what the location screen says
--      is promised.
--   2. Without a returns area switched on, the check-in is refused
--      (`returns_location_missing`) and changes nothing: before, it added the
--      units to the shop's stock and to no location, so picking could never
--      find them.
--   3. Picking after both migrations: when the product is bought again and
--      the only shelf holding it has all its units promised, the new pick is
--      sent to the returns area, where the units that came back really are
--      free, and the picker takes them there.
--
-- Who plays whom: comprador3 is made operations staff; bodega is a worker of
-- SJO1; repartidor drives; the shopper is this suite's own. The product is
-- the notebook of Tienda Sendero in SJO1. Every check compares with what was
-- there before, so it holds on a used database.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

grant execute on function pg_temp.remember(text, text) to authenticated, anon;

-- Units of the notebook on one location of SJO1.
create function pg_temp.bin(p_location uuid) returns integer
language sql as $$
  select coalesce((select b.quantity from public.bin_stock b
                   where b.location_id = p_location and b.sku_id = current_setting('t.sku')::uuid
                     and b.seller_id = current_setting('t.seller')::uuid), 0)
$$;

-- The stock rule: on hand = every location + picked into parcels still being picked.
-- Answers on_hand minus the other two (0 on a database where it holds).
create function pg_temp.unexplained() returns integer
language sql as $$
  select (select coalesce(sum(l.on_hand), 0) from public.stock_levels l
          where l.warehouse_id = current_setting('t.platform')::uuid
            and l.sku_id = current_setting('t.sku')::uuid and l.seller_id = current_setting('t.seller')::uuid)
       - (select coalesce(sum(b.quantity), 0) from public.bin_stock b
          join public.warehouse_locations wl on wl.id = b.location_id
          where wl.warehouse_id = current_setting('t.platform')::uuid
            and b.sku_id = current_setting('t.sku')::uuid and b.seller_id = current_setting('t.seller')::uuid)
       - (select coalesce(sum(m.quantity), 0) from public.stock_movements m
          join public.shipments s on s.id = m.reference_id
          where m.warehouse_id = current_setting('t.platform')::uuid and m.reason = 'pick'
            and m.reference_type = 'shipment' and s.status = 'picking'
            and m.sku_id = current_setting('t.sku')::uuid and m.seller_id = current_setting('t.seller')::uuid)
$$;

create function pg_temp.reserved() returns integer
language sql as $$
  select coalesce(sum(l.reserved), 0)::integer from public.stock_levels l
  where l.warehouse_id = current_setting('t.platform')::uuid
    and l.sku_id = current_setting('t.sku')::uuid and l.seller_id = current_setting('t.seller')::uuid
$$;

-- What the location screen says a location holds of the notebook, as bodega sees it.
create function pg_temp.screen(p_code text) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.login('bodega@yuntera.example');
  select i into v
  from jsonb_array_elements(public.wms_location_stock(current_setting('t.platform')::uuid, p_code) -> 'items') i
  where i ->> 'sku_id' = current_setting('t.sku') and i ->> 'seller_id' = current_setting('t.seller');
  reset role;
  return v;
end;
$$;

-- Every check of the stock rule at one moment.
create function pg_temp.adds_up(p_label text) returns void
language plpgsql as $$
declare
  r record;
begin
  if pg_temp.unexplained() <> current_setting('t.unexplained')::integer then
    raise exception '%: on hand no longer equals the locations plus picked units (% instead of %)',
      p_label, pg_temp.unexplained(), current_setting('t.unexplained');
  end if;
  -- Promised on each location = what its open picks still wait for.
  for r in
    select wl.code, coalesce(sum(t.quantity - t.picked_quantity), 0)::integer as waiting
    from public.warehouse_locations wl
    left join public.pick_tasks t on t.location_id = wl.id and t.status in ('open', 'in_progress', 'short')
      and t.sku_id = current_setting('t.sku')::uuid and t.seller_id = current_setting('t.seller')::uuid
    where wl.warehouse_id = current_setting('t.platform')::uuid
      and exists (select 1 from public.bin_stock b where b.location_id = wl.id
                  and b.sku_id = current_setting('t.sku')::uuid and b.seller_id = current_setting('t.seller')::uuid
                  and b.quantity > 0)
    group by wl.code
  loop
    if coalesce((pg_temp.screen(r.code) ->> 'promised')::integer, 0) <> r.waiting then
      raise exception '%: % promises % on screen, open picks wait for %', p_label, r.code,
        pg_temp.screen(r.code) ->> 'promised', r.waiting;
    end if;
  end loop;
end;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────

update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;
select pg_temp.remember('platform', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('sku', (select o.sku_id::text from public.offers o where o.id = pg_temp.offer('libreta-tapa-dura-a5')));
select pg_temp.remember('seller', (select o.seller_id::text from public.offers o where o.id = pg_temp.offer('libreta-tapa-dura-a5')));
select pg_temp.remember('sku_code', (select code from public.skus where id = current_setting('t.sku')::uuid));
select pg_temp.remember('dev', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.platform')::uuid and code = 'DEV-01'));
select pg_temp.remember('shelf', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.platform')::uuid and code = 'A-01-02-B'));
-- DEV-01 is the returns area the check-in uses (the first switched on, by code).
update public.warehouse_locations set active = true where id = current_setting('t.dev')::uuid;
update public.warehouse_locations set active = false
where warehouse_id = current_setting('t.platform')::uuid and kind = 'returns' and code < 'DEV-01'
  and not exists (select 1 from public.bin_stock b where b.location_id = warehouse_locations.id and b.quantity > 0);
do $$ begin
  assert (select wl.id from public.warehouse_locations wl
          where wl.warehouse_id = current_setting('t.platform')::uuid and wl.kind = 'returns' and wl.active
          order by wl.code limit 1) = current_setting('t.dev')::uuid, 'fixture: DEV-01 receives returns';
end $$;

delete from public.staff_members where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
insert into public.staff_members (user_id, role)
select id, 'ops' from auth.users where email = 'comprador3@yuntera.example';
select pg_temp.shopper('devuelto169@yuntera.example', 'Prueba Devuelto Estante');

select pg_temp.remember('unexplained', pg_temp.unexplained()::text);
select pg_temp.remember('reserved0', pg_temp.reserved()::text);
select pg_temp.remember('dev0', pg_temp.bin(current_setting('t.dev')::uuid)::text);
select pg_temp.adds_up('start');

-- ═══ 1. A parcel staff stopped ═════════════════════════════════════════════

select pg_temp.remember('order_a', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'dev-169-a')::text);
select pg_temp.pay(current_setting('t.order_a')::uuid);
select pg_temp.remember('ship_a', pg_temp.shipment(current_setting('t.order_a')::uuid, 'platform')::text);
select pg_temp.pack(current_setting('t.ship_a')::uuid);
select pg_temp.adds_up('A packed');
select pg_temp.act('comprador3@yuntera.example');
select public.ops_recall_shipment(current_setting('t.ship_a')::uuid, 'El cliente pidió cancelar');
select pg_temp.logout();
select pg_temp.adds_up('A stopped');

-- ═══ 2. No returns area switched on: refused, nothing changes ══════════════

update public.warehouse_locations set active = false where id = current_setting('t.dev')::uuid;
select pg_temp.remember('on_hand_before', (select on_hand::text from public.stock_levels
  where warehouse_id = current_setting('t.platform')::uuid and sku_id = current_setting('t.sku')::uuid
    and seller_id = current_setting('t.seller')::uuid));
select pg_temp.login('bodega@yuntera.example');
select pg_temp.refused(format('select public.wms_receive_returned_shipment(%L, true, null)', current_setting('t.ship_a')),
  'returns_location_missing');
reset role;
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.ship_a')::uuid) = 'returning',
    'no returns area: the parcel still waits';
  assert (select on_hand::text from public.stock_levels
          where warehouse_id = current_setting('t.platform')::uuid and sku_id = current_setting('t.sku')::uuid
            and seller_id = current_setting('t.seller')::uuid) = current_setting('t.on_hand_before'),
    'no returns area: the shop''s stock did not grow';
  assert not exists (select 1 from private.refunds where order_id = current_setting('t.order_a')::uuid),
    'no returns area: nothing refunded';
end $$;
-- Damaged goods do not go back to a location, so they are still recorded.
select pg_temp.adds_up('A refused');
update public.warehouse_locations set active = true where id = current_setting('t.dev')::uuid;

-- With DEV-01 on again: the units land there and the screen shows them free.
select pg_temp.login('bodega@yuntera.example');
select public.wms_receive_returned_shipment(current_setting('t.ship_a')::uuid, true, null);
reset role;
do $$
declare
  v jsonb := pg_temp.screen('DEV-01');
begin
  assert pg_temp.bin(current_setting('t.dev')::uuid) = current_setting('t.dev0')::integer + 2,
    'A: the two units are in the returns area';
  assert exists (select 1 from public.stock_movements m where m.reference_id = current_setting('t.ship_a')::uuid
                 and m.reason = 'return' and m.to_location_id = current_setting('t.dev')::uuid and m.quantity = 2),
    'A: the ledger says they went to DEV-01';
  assert (v ->> 'on_shelf')::integer = current_setting('t.dev0')::integer + 2
         and (v ->> 'free')::integer = (v ->> 'on_shelf')::integer and (v ->> 'promised')::integer = 0,
    format('A: the location screen shows them free %s', v);
  assert pg_temp.reserved() = current_setting('t.reserved0')::integer, 'A: nothing stays reserved';
end $$;
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  assert exists (select 1 from jsonb_array_elements(public.wms_stock_locations(current_setting('t.platform')::uuid)) l
                 where l ->> 'code' = 'DEV-01' and (l ->> 'units')::integer >= 2 and not (l ->> 'shelf')::boolean),
    'A: the list of locations shows the returns area holding them';
end $$;
reset role;
select pg_temp.adds_up('A received');

-- ═══ 3. A parcel sent back after a failed delivery ═════════════════════════

select pg_temp.remember('order_b', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'dev-169-b')::text);
select pg_temp.pay(current_setting('t.order_b')::uuid);
select pg_temp.remember('ship_b', pg_temp.shipment(current_setting('t.order_b')::uuid, 'platform')::text);
select pg_temp.pack(current_setting('t.ship_b')::uuid);
select pg_temp.remember('route_b', pg_temp.route(current_setting('t.ship_b')::uuid)::text);
select pg_temp.act('repartidor@yuntera.example');
select public.driver_fail_stop(pg_temp.stop(current_setting('t.route_b')::uuid, current_setting('t.ship_b')::uuid), 'nobody_home');
select pg_temp.act('comprador3@yuntera.example');
select public.ops_return_shipment(current_setting('t.ship_b')::uuid);
select pg_temp.logout();
select pg_temp.adds_up('B coming back');
select pg_temp.login('bodega@yuntera.example');
select public.wms_receive_returned_shipment(current_setting('t.ship_b')::uuid, true, null);
reset role;
do $$ begin
  assert pg_temp.bin(current_setting('t.dev')::uuid) = current_setting('t.dev0')::integer + 4,
    'B: two more units in the returns area';
  assert (pg_temp.screen('DEV-01') ->> 'free')::integer = current_setting('t.dev0')::integer + 4,
    'B: free on the location screen';
  assert pg_temp.reserved() = current_setting('t.reserved0')::integer, 'B: nothing stays reserved';
end $$;
select pg_temp.adds_up('B received');

-- ═══ 4. Bought again: the pick goes where the free units are ═══════════════

-- Fixture: the notebook's units on other shelves join A-01-02-B (moves of
-- free units, as the warehouse would make them), then a count leaves one
-- unit there.
select pg_temp.act('bodega@yuntera.example');
do $$
declare
  r record;
begin
  for r in
    select b.location_id, b.quantity - private.location_promised(b.location_id, b.sku_id, b.seller_id) as free
    from public.bin_stock b join public.warehouse_locations wl on wl.id = b.location_id
    where wl.warehouse_id = current_setting('t.platform')::uuid and b.sku_id = current_setting('t.sku')::uuid
      and b.seller_id = current_setting('t.seller')::uuid
      and b.location_id not in (current_setting('t.shelf')::uuid, current_setting('t.dev')::uuid)
  loop
    if r.free > 0 then
      perform public.wms_move_stock(r.location_id, current_setting('t.shelf')::uuid,
        current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, r.free, 'Juntar en un estante');
    end if;
  end loop;
end $$;
select pg_temp.remember('shelf_q', pg_temp.bin(current_setting('t.shelf')::uuid)::text);
select public.wms_adjust_stock(current_setting('t.shelf')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 1 - current_setting('t.shelf_q')::integer,
  'Conteo de la prueba de devoluciones', current_setting('t.shelf_q')::integer)
where current_setting('t.shelf_q')::integer > 1;
select pg_temp.logout();
select pg_temp.adds_up('one unit left on the shelf');

-- X0: three notebooks while the shelf has only one free and the returns
-- area holds more: the whole task goes where it can be filled, and the
-- parcel is packed (a shelf with too few free units would end short).
select pg_temp.remember('order_x0', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:3'), 'card', 'dev-169-x0')::text);
select pg_temp.pay(current_setting('t.order_x0')::uuid);
select pg_temp.remember('ship_x0', pg_temp.shipment(current_setting('t.order_x0')::uuid, 'platform')::text);
do $$ begin
  assert (select t.location_id from public.pick_tasks t where t.shipment_id = current_setting('t.ship_x0')::uuid)
         = current_setting('t.dev')::uuid,
    format('X0: a task of 3 goes to the returns area, which can fill it, not to %s',
      (select wl.code from public.pick_tasks t join public.warehouse_locations wl on wl.id = t.location_id
       where t.shipment_id = current_setting('t.ship_x0')::uuid));
  assert (pg_temp.screen('A-01-02-B') ->> 'free')::integer = 1, 'X0: the shelf keeps its one free unit';
end $$;
select pg_temp.adds_up('X0 released');
select pg_temp.pack(current_setting('t.ship_x0')::uuid);
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.ship_x0')::uuid) = 'packed',
    'X0: packed in full';
  assert pg_temp.bin(current_setting('t.dev')::uuid) = current_setting('t.dev0')::integer + 1,
    'X0: three units left the returns area';
end $$;
select pg_temp.adds_up('X0 packed');

-- X1: the shelf still has a free unit: its pick goes to the shelf.
select pg_temp.remember('order_x1', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'dev-169-x1')::text);
do $$ begin
  assert (select t.location_id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = current_setting('t.order_x1')::uuid) = current_setting('t.shelf')::uuid,
    'X1: a shelf with a free unit is picked first';
  assert (pg_temp.screen('A-01-02-B') ->> 'free')::integer = 0, 'X1: the shelf has nothing free now';
end $$;
select pg_temp.adds_up('X1 released');

-- X2: every unit on the shelf is promised; the units that came back are free.
select pg_temp.remember('order_x2', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'dev-169-x2')::text);
select pg_temp.remember('ship_x2', pg_temp.shipment(current_setting('t.order_x2')::uuid, 'platform')::text);
do $$ begin
  assert (select t.location_id from public.pick_tasks t where t.shipment_id = current_setting('t.ship_x2')::uuid)
         = current_setting('t.dev')::uuid,
    format('X2: the pick goes to the returns area, where the units are free, not to %s',
      (select wl.code from public.pick_tasks t join public.warehouse_locations wl on wl.id = t.location_id
       where t.shipment_id = current_setting('t.ship_x2')::uuid));
  assert (pg_temp.screen('DEV-01') ->> 'promised')::integer = 1, 'X2: the screen shows the unit promised';
end $$;
select pg_temp.adds_up('X2 released');

-- The picker takes it there, and the parcel is packed.
select pg_temp.pack(current_setting('t.ship_x2')::uuid);
do $$ begin
  assert (select status from public.pick_tasks where shipment_id = current_setting('t.ship_x2')::uuid) = 'done',
    'X2: picked in full, not short';
  assert pg_temp.bin(current_setting('t.dev')::uuid) = current_setting('t.dev0')::integer,
    'X2: the unit left the returns area';
  assert (select status from public.shipments where id = current_setting('t.ship_x2')::uuid) = 'packed', 'X2: packed';
end $$;
select pg_temp.adds_up('X2 packed');

-- ═══ 5. Where a task goes when no location can fill it ═════════════════════

-- Fixture (rolled back to the savepoint): the notebook's units on every
-- location of SJO1 are set aside, and a switched-off storage shelf of this
-- suite holds 5. Shelves switched off with stock come from data made outside
-- the functions (ops_set_location_active refuses it); the order between
-- them is still fixed.
savepoint no_location_fills;
update public.stock_levels set on_hand = on_hand + 20
where warehouse_id = current_setting('t.platform')::uuid and sku_id = current_setting('t.sku')::uuid
  and seller_id = current_setting('t.seller')::uuid;
update public.bin_stock b set quantity = 0
from public.warehouse_locations wl
where wl.id = b.location_id and wl.warehouse_id = current_setting('t.platform')::uuid
  and b.sku_id = current_setting('t.sku')::uuid and b.seller_id = current_setting('t.seller')::uuid;
insert into public.warehouse_locations (warehouse_id, code, kind, active)
values (current_setting('t.platform')::uuid, 'Z-69-01-A', 'storage', true);
select pg_temp.remember('off_shelf', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.platform')::uuid and code = 'Z-69-01-A'));
select pg_temp.remember('damaged', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.platform')::uuid and code = 'CUA-01'));
update public.warehouse_locations set active = true where id = current_setting('t.damaged')::uuid;
insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
values (current_setting('t.off_shelf')::uuid, current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 5),
       (current_setting('t.damaged')::uuid, current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 5)
on conflict (location_id, sku_id, seller_id) do update set quantity = excluded.quantity;
-- Switched off once it holds them (stock never lands on a switched-off location).
update public.warehouse_locations set active = false where id = current_setting('t.off_shelf')::uuid;

-- X3: a switched-off shelf and the switched-on damaged area both hold the
-- product: the damaged area is used only when nothing else holds it.
select pg_temp.remember('order_x3', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:3'), 'card', 'dev-169-x3')::text);
select pg_temp.pay(current_setting('t.order_x3')::uuid);
do $$ begin
  assert (select t.location_id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = current_setting('t.order_x3')::uuid) = current_setting('t.off_shelf')::uuid,
    format('X3: the switched-off shelf comes before the damaged area, not %s',
      (select wl.code from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
       join public.warehouse_locations wl on wl.id = t.location_id
       where s.order_id = current_setting('t.order_x3')::uuid));
end $$;

-- X4: the returns area held 2, both now promised to a first order; a second
-- order of 3 finds no location that can fill it, and the switched-on
-- returns area is named ahead of the switched-off shelf.
update public.bin_stock set quantity = 0
where location_id = current_setting('t.damaged')::uuid and sku_id = current_setting('t.sku')::uuid
  and seller_id = current_setting('t.seller')::uuid;
delete from public.pick_tasks t using public.shipments s
where s.id = t.shipment_id and s.order_id = current_setting('t.order_x3')::uuid;
insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
values (current_setting('t.dev')::uuid, current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 2)
on conflict (location_id, sku_id, seller_id) do update set quantity = excluded.quantity;
select pg_temp.remember('order_x4a', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'dev-169-x4a')::text);
select pg_temp.pay(current_setting('t.order_x4a')::uuid);
select pg_temp.remember('order_x4b', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:3'), 'card', 'dev-169-x4b')::text);
select pg_temp.pay(current_setting('t.order_x4b')::uuid);
do $$ begin
  assert (select t.location_id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = current_setting('t.order_x4a')::uuid) = current_setting('t.dev')::uuid,
    'X4: the first order of 2 is filled from the returns area';
  assert (pg_temp.screen('DEV-01') ->> 'free')::integer = 0, 'X4: nothing free in the returns area';
  assert (select t.location_id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = current_setting('t.order_x4b')::uuid) = current_setting('t.dev')::uuid,
    format('X4: the switched-on returns area comes before the switched-off shelf, not %s',
      (select wl.code from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
       join public.warehouse_locations wl on wl.id = t.location_id
       where s.order_id = current_setting('t.order_x4b')::uuid));
end $$;
-- X5: the switched-off shelf holds 3, all promised to an open task; the
-- switched-on damaged area holds 3 free. A task of 3 still names the shelf
-- (a certain short pick, which staff resolve by moving units onto a shelf)
-- rather than the damaged area: those areas only when no shelf, returns or
-- receiving location holds the product (decision 44).
update public.bin_stock set quantity = 0
where location_id = current_setting('t.dev')::uuid and sku_id = current_setting('t.sku')::uuid
  and seller_id = current_setting('t.seller')::uuid;
update public.bin_stock set quantity = 3
where location_id in (current_setting('t.off_shelf')::uuid, current_setting('t.damaged')::uuid)
  and sku_id = current_setting('t.sku')::uuid and seller_id = current_setting('t.seller')::uuid;
update public.pick_tasks t set location_id = current_setting('t.off_shelf')::uuid
from public.shipments s
where s.id = t.shipment_id and s.order_id = current_setting('t.order_x4b')::uuid;
select pg_temp.remember('order_x5', pg_temp.place('devuelto169@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:3'), 'card', 'dev-169-x5')::text);
select pg_temp.pay(current_setting('t.order_x5')::uuid);
do $$ begin
  assert private.location_promised(current_setting('t.off_shelf')::uuid, current_setting('t.sku')::uuid,
           current_setting('t.seller')::uuid) = 6,
    'X5: the switched-off shelf now has 6 promised against 3 on it';
  assert (select t.location_id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = current_setting('t.order_x5')::uuid) = current_setting('t.off_shelf')::uuid,
    format('X5: the switched-off shelf comes before the damaged area even when it cannot fill the task, not %s',
      (select wl.code from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
       join public.warehouse_locations wl on wl.id = t.location_id
       where s.order_id = current_setting('t.order_x5')::uuid));
end $$;
rollback to savepoint no_location_fills;

select 'ok' as returned_stock;
rollback;
