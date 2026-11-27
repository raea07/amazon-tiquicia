-- Orders cancelled before 085000 get the words 085000 would have written
-- (private.reword_old_cancel_reasons, run once by 20261121085000).
--
--   right rows:   a shopper's own cancellation that kept the text they sent
--                 now reads "Cancelado por el cliente"; an order whose
--                 parcels staff all stopped before they left, cancelled at
--                 check-in for "Los paquetes regresaron sin entregarse", now
--                 reads "Los paquetes no salieron de la bodega";
--   wrong rows:   staff's own words on a shopper's order, a parcel that went
--                 out and came back, and an order that is not cancelled keep
--                 what they have;
--   wrong caller: nobody can call it through the API;
--   left behind:  only the reason changes (status, refunds, history, events
--                 stay); a second run changes nothing.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

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

create function pg_temp.check_in(p_shipment uuid) returns void
language plpgsql as $$
begin
  perform pg_temp.act('bodega@yuntera.example');
  perform public.wms_receive_returned_shipment(p_shipment, true, null);
  perform pg_temp.logout();
end;
$$;

create function pg_temp.reason(p_key text) returns text
language sql as $$
  select cancel_reason from public.orders where id = current_setting('t.' || p_key)::uuid;
$$;

grant execute on function pg_temp.remember(text, text), pg_temp.shipment(uuid, public.warehouse_kind)
  to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────

update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;
select pg_temp.shopper('antiguo195@yuntera.example', 'Prueba Antiguo');

-- Own: the shopper cancelled it herself.
select pg_temp.remember('own', pg_temp.place('antiguo195@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'antiguo-195-own')::text);
select pg_temp.pay(current_setting('t.own')::uuid);
select pg_temp.login('antiguo195@yuntera.example');
select public.cancel_order(current_setting('t.own')::uuid, 'Me arrepentí');
reset role;
-- Staffed: staff cancelled it with words of their own.
select pg_temp.remember('staffed', pg_temp.place('antiguo195@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'antiguo-195-staffed')::text);
select pg_temp.pay(current_setting('t.staffed')::uuid);
select pg_temp.login('central@yuntera.example');
select public.cancel_order(current_setting('t.staffed')::uuid, 'Caso 9911, lo vio Ana');
reset role;
-- Stopped: staff stopped the parcel before it left, then it was checked in.
select pg_temp.remember('stopped', pg_temp.packed_order('antiguo195@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'antiguo-195-stopped')::text);
select pg_temp.remember('ship_stopped',
  pg_temp.shipment(current_setting('t.stopped')::uuid, 'platform')::text);
select pg_temp.act('central@yuntera.example');
select public.ops_recall_shipment(current_setting('t.ship_stopped')::uuid, 'Sospecha de fraude, caso 9912');
select pg_temp.logout();
select pg_temp.check_in(current_setting('t.ship_stopped')::uuid);
-- Back: the parcel went out, nobody was home, it came back.
select pg_temp.remember('back', pg_temp.packed_order('antiguo195@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'antiguo-195-back')::text);
select pg_temp.remember('ship_back', pg_temp.shipment(current_setting('t.back')::uuid, 'platform')::text);
do $$
declare
  v_ship uuid := current_setting('t.ship_back')::uuid;
  v_route uuid := pg_temp.route(v_ship);
begin
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_ship), 'nobody_home');
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_ship);
  perform pg_temp.logout();
end $$;
select pg_temp.check_in(current_setting('t.ship_back')::uuid);
-- Open: an order that is not cancelled, with a stray reason on it.
select pg_temp.remember('open', pg_temp.place('antiguo195@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'antiguo-195-open')::text);

-- Put the rows in the shape the functions before 085000 left them.
update public.orders set cancel_reason = 'Me arrepentí' where id = current_setting('t.own')::uuid;
update public.orders set cancel_reason = 'Los paquetes regresaron sin entregarse'
where id = current_setting('t.stopped')::uuid;
update public.orders set cancel_reason = 'Me arrepentí' where id = current_setting('t.open')::uuid;

do $$ begin
  assert pg_temp.reason('staffed') = 'Caso 9911, lo vio Ana', 'fixture: staff''s words';
  assert pg_temp.reason('back') = 'Los paquetes regresaron sin entregarse', 'fixture: out and back';
  assert (select status from public.orders where id = current_setting('t.open')::uuid)
         not in ('cancelled', 'refunded'), 'fixture: the open order is not cancelled';
end $$;

-- ═══ Wrong caller ══════════════════════════════════════════════════════════

do $$ begin
  assert not has_function_privilege('anon', 'private.reword_old_cancel_reasons()', 'execute')
         and not has_function_privilege('authenticated', 'private.reword_old_cancel_reasons()', 'execute'),
    'grants: nobody calls it through the API';
end $$;

-- ═══ The run ═══════════════════════════════════════════════════════════════

create temp table before_run as
  select o.id, o.status, o.total_minor, o.cancelled_at,
         (select count(*) from public.order_events e where e.order_id = o.id) as events,
         (select coalesce(sum(f.amount_minor), 0) from private.refunds f where f.order_id = o.id) as refunded,
         (select count(*) from private.outbox_events x where x.payload ->> 'order_id' = o.id::text) as outbox
  from public.orders o;

do $$
declare
  v integer := private.reword_old_cancel_reasons();
begin
  assert v = 2, format('the run changes the two old rows, changed %s', v);
  assert pg_temp.reason('own') = 'Cancelado por el cliente',
    format('own: the shopper''s cancellation reads as hers, got %s', pg_temp.reason('own'));
  assert pg_temp.reason('stopped') = 'Los paquetes no salieron de la bodega',
    format('stopped: nothing left the warehouse, got %s', pg_temp.reason('stopped'));
  assert pg_temp.reason('staffed') = 'Caso 9911, lo vio Ana', 'staffed: staff''s words stay';
  assert pg_temp.reason('back') = 'Los paquetes regresaron sin entregarse', 'back: the words of today stay';
  assert pg_temp.reason('open') = 'Me arrepentí', 'open: an order that is not cancelled is left alone';
  assert not exists (
    select 1 from public.orders o join before_run b using (id)
    where o.status is distinct from b.status or o.total_minor <> b.total_minor
       or o.cancelled_at is distinct from b.cancelled_at
       or (select count(*) from public.order_events e where e.order_id = o.id) <> b.events
       or (select coalesce(sum(f.amount_minor), 0) from private.refunds f where f.order_id = o.id) <> b.refunded
       or (select count(*) from private.outbox_events x where x.payload ->> 'order_id' = o.id::text) <> b.outbox),
    'only the reason changed: status, money, history and events are as they were';

  -- The shopper now reads her sentence on both.
  perform pg_temp.act('antiguo195@yuntera.example');
  assert public.get_order((select order_number from public.orders where id = current_setting('t.own')::uuid))
         ->> 'cancel_reason' = 'Cancelado por el cliente', 'own: get_order gives her sentence';
  assert public.get_order((select order_number from public.orders where id = current_setting('t.stopped')::uuid))
         ->> 'cancel_reason' = 'Los paquetes no salieron de la bodega', 'stopped: get_order gives the new sentence';
  perform pg_temp.logout();

  assert private.reword_old_cancel_reasons() = 0, 'a second run changes nothing';
end $$;

select 'ok' as reword_old_cancel_reasons;
rollback;
