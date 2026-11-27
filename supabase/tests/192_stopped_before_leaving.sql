-- Why an order reads cancelled when its parcels come back
-- (public.wms_receive_returned_shipment and public.get_order, 20261121085000).
--
--   right caller: the warehouse checks the parcels in; when staff stopped
--                 every parcel that came back before it went out, the order
--                 is cancelled for "Los paquetes no salieron de la bodega",
--                 and the shopper and staff read that sentence; when a parcel
--                 went out and came back (a failed attempt at the door), the
--                 order keeps "Los paquetes regresaron sin entregarse", also
--                 when another parcel of it was stopped before it left;
--   wrong caller: a visitor and a shopper cannot check a parcel in; another
--                 shopper cannot read the order; staff's typed reason for the
--                 stop never reaches the shopper;
--   left behind:  the reason on the order and in `order.cancelled`, the
--                 refunds (goods and the delivery fee when nobody went to the
--                 door, goods alone after an attempt), the stop's reason kept
--                 on the parcel for staff.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

create function pg_temp.staff_as_ops() returns void
language sql as $$
  delete from public.staff_members
  where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
  insert into public.staff_members (user_id, role)
  select id, 'ops' from auth.users where email = 'comprador3@yuntera.example';
$$;

-- An order of this suite, paid, with every parcel packed.
create function pg_temp.packed_order(p_email text, p_items jsonb, p_key text) returns uuid
language plpgsql as $$
declare
  v_order uuid := pg_temp.place(p_email, p_items, 'card', p_key);
  s uuid;
begin
  perform pg_temp.pay(v_order);
  for s in select id from public.shipments where order_id = v_order and status = 'pending'
           order by created_at, id loop
    perform pg_temp.pack(s);
  end loop;
  return v_order;
end;
$$;

create function pg_temp.recall(p_shipment uuid, p_reason text) returns void
language plpgsql as $$
begin
  perform pg_temp.act('comprador3@yuntera.example');
  perform public.ops_recall_shipment(p_shipment, p_reason);
  perform pg_temp.logout();
end;
$$;

-- The warehouse checks a parcel in: the Yuntera warehouse's as `bodega`, a
-- seller's own as the seller.
create function pg_temp.check_in(p_shipment uuid) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.act(case when (select w.kind from public.shipments s
                                 join public.warehouses w on w.id = s.origin_warehouse_id
                                 where s.id = p_shipment) = 'platform'
                           then 'bodega@yuntera.example' else 'vendedor@yuntera.example' end);
  v := public.wms_receive_returned_shipment(p_shipment, true, null);
  perform pg_temp.logout();
  return v;
end;
$$;

-- A parcel on a driven route, nobody home, sent back to the warehouse.
create function pg_temp.failed_and_back(p_shipment uuid) returns void
language plpgsql as $$
declare
  v_route uuid := pg_temp.route(p_shipment);
begin
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, p_shipment), 'nobody_home');
  perform pg_temp.act('comprador3@yuntera.example');
  perform public.ops_return_shipment(p_shipment);
  perform pg_temp.logout();
end;
$$;

create function pg_temp.reason_read(p_email text, p_order uuid) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.act(p_email);
  v := public.get_order((select order_number from public.orders where id = p_order)) ->> 'cancel_reason';
  perform pg_temp.logout();
  return v;
end;
$$;

grant execute on function pg_temp.remember(text, text), pg_temp.shipment(uuid, public.warehouse_kind)
  to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────

update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.staff_as_ops();
select pg_temp.shopper('detenido192a@yuntera.example', 'Prueba Detenido Uno');
select pg_temp.shopper('detenido192b@yuntera.example', 'Prueba Detenido Dos');

-- A: one parcel, stopped on the shelf before it left.
select pg_temp.remember('a', pg_temp.packed_order('detenido192a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'det-192-a')::text);
select pg_temp.remember('ship_a', pg_temp.shipment(current_setting('t.a')::uuid, 'platform')::text);
-- B: one parcel that went out, found nobody home and came back.
select pg_temp.remember('b', pg_temp.packed_order('detenido192a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'det-192-b')::text);
select pg_temp.remember('ship_b', pg_temp.shipment(current_setting('t.b')::uuid, 'platform')::text);
-- C: two parcels: the warehouse's stopped before it left, the seller's out and back.
select pg_temp.remember('c', pg_temp.packed_order('detenido192a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1', 'bombillo-led-9w-4u:1'), 'det-192-c')::text);
select pg_temp.remember('ship_c1', pg_temp.shipment(current_setting('t.c')::uuid, 'platform')::text);
select pg_temp.remember('ship_c2', pg_temp.shipment(current_setting('t.c')::uuid, 'seller')::text);

do $$ begin
  assert (select count(*) from public.shipments
          where order_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid,
                             current_setting('t.c')::uuid) and status = 'packed') = 4,
    'fixture: four packed parcels';
  assert current_setting('t.ship_c1') <> current_setting('t.ship_c2'), 'fixture: C has two parcels';
end $$;

-- ═══ Wrong callers of the check-in ═════════════════════════════════════════

select pg_temp.recall(current_setting('t.ship_a')::uuid, 'Sospecha de fraude, caso 7731 de Ana');
select pg_temp.login_anon();
select pg_temp.refused(format('select public.wms_receive_returned_shipment(%L, true, null)',
  current_setting('t.ship_a')), 'forbidden');
reset role;
select pg_temp.login('detenido192a@yuntera.example');
select pg_temp.refused(format('select public.wms_receive_returned_shipment(%L, true, null)',
  current_setting('t.ship_a')), 'forbidden');
reset role;
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.ship_a')::uuid) = 'returning',
    'wrong callers: the parcel is still on its way back';
end $$;

-- ═══ A: stopped before it left ═════════════════════════════════════════════

do $$
declare
  v jsonb;
  o public.orders%rowtype;
  a jsonb;
begin
  v := pg_temp.check_in(current_setting('t.ship_a')::uuid);
  select * into o from public.orders where id = current_setting('t.a')::uuid;
  assert v ->> 'order_status' in ('cancelled', 'refunded')
         and o.cancel_reason = 'Los paquetes no salieron de la bodega',
    format('A: cancelled because nothing left the warehouse, got %s', o.cancel_reason);
  assert (v ->> 'delivery_fee_refund_minor')::bigint = o.shipping_minor and o.shipping_minor > 0
         and (select sum(f.amount_minor) from private.refunds f where f.order_id = o.id) = o.total_minor,
    format('A: everything paid comes back, the delivery fee included %s', v);
  assert exists (select 1 from private.outbox_events e
                 where e.id > current_setting('t.events_from')::bigint and e.topic = 'order.cancelled'
                   and e.payload ->> 'order_id' = o.id::text
                   and e.payload ->> 'reason' = 'Los paquetes no salieron de la bodega'),
    'A: the cancellation event carries the same reason';
  assert exists (select 1 from public.order_events e where e.order_id = o.id and e.visible_to_customer
                 and e.note like 'Su paquete no llegó a salir de nuestra bodega%'),
    'A: the history says the parcel never left';
  assert (select recall_reason from public.shipments where id = current_setting('t.ship_a')::uuid)
         = 'Sospecha de fraude, caso 7731 de Ana',
    'A: staff''s reason stays on the parcel';

  -- The shopper reads the database's sentence, never staff's words.
  perform pg_temp.act('detenido192a@yuntera.example');
  a := public.get_order(o.order_number);
  perform pg_temp.logout();
  assert a ->> 'cancel_reason' = 'Los paquetes no salieron de la bodega',
    format('A: the shopper reads %s', a ->> 'cancel_reason');
  assert position('7731' in a::text) = 0 and position('Sospecha' in a::text) = 0,
    'A: nothing of staff''s reason reaches the shopper';
  -- Staff read it too.
  assert pg_temp.reason_read('central@yuntera.example', o.id) = 'Los paquetes no salieron de la bodega',
    'A: staff read the same reason';
end $$;

-- Another shopper cannot read the order at all.
select pg_temp.act('detenido192b@yuntera.example');
select pg_temp.refused(format('select public.get_order(%L)',
  (select order_number from public.orders where id = current_setting('t.a')::uuid)), 'order_not_found');
select pg_temp.logout();

-- ═══ B: out on a route, nobody home, back ══════════════════════════════════

select pg_temp.failed_and_back(current_setting('t.ship_b')::uuid);
do $$
declare
  v jsonb;
  o public.orders%rowtype;
begin
  v := pg_temp.check_in(current_setting('t.ship_b')::uuid);
  select * into o from public.orders where id = current_setting('t.b')::uuid;
  assert v ->> 'order_status' in ('cancelled', 'refunded')
         and o.cancel_reason = 'Los paquetes regresaron sin entregarse',
    format('B: a parcel that went out keeps the words of today, got %s', o.cancel_reason);
  assert (v ->> 'delivery_fee_refund_minor')::bigint = 0,
    'B: after an attempt at the door the delivery fee stays';
  assert exists (select 1 from private.outbox_events e
                 where e.id > current_setting('t.events_from')::bigint and e.topic = 'order.cancelled'
                   and e.payload ->> 'order_id' = o.id::text
                   and e.payload ->> 'reason' = 'Los paquetes regresaron sin entregarse'),
    'B: the cancellation event carries the reason of today';
  assert pg_temp.reason_read('detenido192a@yuntera.example', o.id) = 'Los paquetes regresaron sin entregarse',
    'B: the shopper reads the reason of today';
end $$;

-- ═══ C: one parcel stopped before it left, the other out and back ══════════

select pg_temp.failed_and_back(current_setting('t.ship_c2')::uuid);
do $$
declare
  v jsonb;
begin
  v := pg_temp.check_in(current_setting('t.ship_c2')::uuid);
  assert (select status from public.orders where id = current_setting('t.c')::uuid) not in ('cancelled', 'refunded')
         and (select cancel_reason from public.orders where id = current_setting('t.c')::uuid) is null,
    'C: one parcel back, the other still on the shelf: the order goes on';
end $$;
select pg_temp.recall(current_setting('t.ship_c1')::uuid, 'El cliente pidió cancelar');
do $$
declare
  v jsonb;
  o public.orders%rowtype;
begin
  v := pg_temp.check_in(current_setting('t.ship_c1')::uuid);
  select * into o from public.orders where id = current_setting('t.c')::uuid;
  assert o.status in ('cancelled', 'refunded') and o.cancel_reason = 'Los paquetes regresaron sin entregarse',
    format('C: a parcel went out, so the reason is that they came back, got %s', o.cancel_reason);
end $$;

-- The new sentence is one the shopper may read; a note of staff's is still not.
do $$
declare
  v_order uuid := current_setting('t.b')::uuid;
begin
  update public.orders set cancel_reason = 'Nota interna: no salieron, decidió Ana' where id = v_order;
  assert pg_temp.reason_read('detenido192a@yuntera.example', v_order) is null,
    'get_order: staff''s own note stays hidden';
  update public.orders set cancel_reason = 'Los paquetes no salieron de la bodega' where id = v_order;
  assert pg_temp.reason_read('detenido192a@yuntera.example', v_order) = 'Los paquetes no salieron de la bodega',
    'get_order: the new sentence reaches the shopper';
end $$;

-- Who may call them is unchanged.
do $$ begin
  assert not has_function_privilege('anon', 'public.wms_receive_returned_shipment(uuid, boolean, text)', 'execute')
         and has_function_privilege('authenticated', 'public.wms_receive_returned_shipment(uuid, boolean, text)', 'execute'),
    'grants: the check-in is for signed-in people only';
  assert not has_function_privilege('anon', 'public.get_order(text)', 'execute')
         and has_function_privilege('authenticated', 'public.get_order(text)', 'execute'),
    'grants: get_order is for signed-in people only';
end $$;

select 'ok' as stopped_before_leaving;
rollback;
