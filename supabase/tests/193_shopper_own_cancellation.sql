-- A shopper's own cancellation (public.cancel_order, 20261121085000).
--
--   right caller: the shopper cancels their own order through the API with a
--                 text of their own, with no text, or with the words their
--                 apps send: the order always reads "Cancelado por el
--                 cliente", and get_order gives them that sentence; staff
--                 cancelling a shopper's order keep their own words, which
--                 the shopper never reads;
--   wrong caller: a visitor and another shopper cannot cancel it; the shopper
--                 cannot once the warehouse started on it;
--   left behind:  the fixed sentence on the order and in `order.cancelled`;
--                 the shopper's text nowhere (not on the order, its history or
--                 its events).

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

select pg_temp.shopper('propia193a@yuntera.example', 'Prueba Propia Uno');
select pg_temp.shopper('propia193b@yuntera.example', 'Prueba Propia Dos');
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));

select pg_temp.remember('typed', pg_temp.place('propia193a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'propia-193-a')::text);
select pg_temp.pay(current_setting('t.typed')::uuid);
select pg_temp.remember('empty', pg_temp.place('propia193a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'propia-193-b')::text);
select pg_temp.remember('apps', pg_temp.place('propia193a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'propia-193-c')::text);
select pg_temp.remember('staffed', pg_temp.place('propia193a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'propia-193-d')::text);
select pg_temp.pay(current_setting('t.staffed')::uuid);
select pg_temp.remember('started', pg_temp.place('propia193a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'propia-193-e')::text);
select pg_temp.pay(current_setting('t.started')::uuid);

-- ═══ Wrong callers ═════════════════════════════════════════════════════════

select pg_temp.login_anon();
select pg_temp.refused(format('select public.cancel_order(%L, %L)', current_setting('t.typed'),
  'Texto de un visitante'), 'forbidden');
reset role;
select pg_temp.login('propia193b@yuntera.example');
select pg_temp.refused(format('select public.cancel_order(%L, %L)', current_setting('t.typed'),
  'Texto de otro cliente'), 'order_not_found');
reset role;
-- Once the warehouse started picking, the shopper cannot.
select pg_temp.act('central@yuntera.example');
select public.wms_start_picking(pg_temp.shipment(current_setting('t.started')::uuid, 'platform'));
select pg_temp.logout();
select pg_temp.login('propia193a@yuntera.example');
select pg_temp.refused(format('select public.cancel_order(%L, %L)', current_setting('t.started'),
  'Ya no lo quiero'), 'too_late_to_cancel');
reset role;
do $$ begin
  assert (select count(*) from public.orders
          where id in (current_setting('t.typed')::uuid, current_setting('t.started')::uuid)
            and cancelled_at is null) = 2,
    'wrong callers: nothing was cancelled';
end $$;

-- ═══ Right caller: the shopper, through the API ════════════════════════════

select pg_temp.login('propia193a@yuntera.example');
select public.cancel_order(current_setting('t.typed')::uuid, 'Me arrepentí, lo vi más barato en otro lado');
select public.cancel_order(current_setting('t.empty')::uuid, null);
select public.cancel_order(current_setting('t.apps')::uuid, 'Cancelado por el cliente');
reset role;

-- Staff cancel another order of hers with their own words.
select pg_temp.login('central@yuntera.example');
select public.cancel_order(current_setting('t.staffed')::uuid, 'Sospecha de fraude, lo vio Ana Mora');
reset role;

do $$
declare
  o public.orders%rowtype;
  a jsonb;
begin
  for o in select * from public.orders
           where id in (current_setting('t.typed')::uuid, current_setting('t.empty')::uuid,
                        current_setting('t.apps')::uuid) loop
    assert o.status in ('cancelled', 'refunded') and o.cancel_reason = 'Cancelado por el cliente',
      format('%s: the shopper''s own cancellation reads as theirs, got %s', o.order_number, o.cancel_reason);
    perform pg_temp.act('propia193a@yuntera.example');
    a := public.get_order(o.order_number);
    perform pg_temp.logout();
    assert a ->> 'cancel_reason' = 'Cancelado por el cliente',
      format('%s: get_order gives the shopper''s sentence, got %s', o.order_number, a ->> 'cancel_reason');
    assert position('arrepentí' in a::text) = 0, format('%s: her text never comes back', o.order_number);
    assert exists (select 1 from private.outbox_events e
                   where e.id > current_setting('t.events_from')::bigint and e.topic = 'order.cancelled'
                     and e.payload ->> 'order_id' = o.id::text
                     and e.payload ->> 'reason' = 'Cancelado por el cliente'),
      format('%s: the event carries the fixed sentence', o.order_number);
  end loop;
  assert not exists (select 1 from public.order_events e where e.note like '%arrepentí%')
         and not exists (select 1 from private.outbox_events e
                         where e.id > current_setting('t.events_from')::bigint and e.payload::text like '%arrepentí%'),
    'her text is stored nowhere';

  -- Staff keep their own words; the shopper reads none of them.
  select * into o from public.orders where id = current_setting('t.staffed')::uuid;
  assert o.cancel_reason = 'Sospecha de fraude, lo vio Ana Mora',
    format('staff: their words are kept, got %s', o.cancel_reason);
  perform pg_temp.act('propia193a@yuntera.example');
  assert public.get_order(o.order_number) -> 'cancel_reason' = 'null'::jsonb,
    'staff: the shopper reads null for staff''s words';
  perform pg_temp.logout();
end $$;

do $$ begin
  assert not has_function_privilege('anon', 'public.cancel_order(uuid, text)', 'execute')
         and has_function_privilege('authenticated', 'public.cancel_order(uuid, text)', 'execute'),
    'grants: cancel_order is for signed-in people only';
end $$;

select 'ok' as shopper_own_cancellation;
rollback;
