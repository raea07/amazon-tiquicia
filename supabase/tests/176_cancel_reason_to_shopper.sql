-- What public.get_order (20261121084600) tells about why an order was
-- cancelled. The shopper reads cancel_reason only when it is one of the three
-- sentences the database writes itself (packages/core/src/cancellation.ts,
-- CANCEL_REASON); what staff typed when they cancelled reaches staff only.
--
--   right caller: staff read their own note as stored; the shopper reads
--                 their own cancellation's fixed sentence;
--   wrong caller: the shopper never reads staff's note (null); another
--                 shopper cannot read the order at all;
--   left behind:  the stored reason is unchanged (only the answer differs).

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

select pg_temp.shopper('motivo176a@yuntera.example', 'Prueba Motivo Uno');
select pg_temp.shopper('motivo176b@yuntera.example', 'Prueba Motivo Dos');

-- Staff cancel a paid order with their own note.
select pg_temp.remember('staffed', pg_temp.place('motivo176a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'motivo-176-a')::text);
select pg_temp.pay(current_setting('t.staffed')::uuid);
select pg_temp.act('central@yuntera.example');
select public.cancel_order(current_setting('t.staffed')::uuid,
  'Sospecha de fraude; lo decidió Ana Mora, soporte');
select pg_temp.logout();

-- The shopper cancels another order themselves (the words their apps send).
select pg_temp.remember('own', pg_temp.place('motivo176a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'motivo-176-b')::text);
select pg_temp.act('motivo176a@yuntera.example');
select public.cancel_order(current_setting('t.own')::uuid, 'Cancelado por el cliente');
select pg_temp.logout();

do $$
declare
  v_staffed text := (select order_number from public.orders where id = current_setting('t.staffed')::uuid);
  v_own text := (select order_number from public.orders where id = current_setting('t.own')::uuid);
  a jsonb;
begin
  -- Wrong caller: the shopper does not read staff's note; the field is there, null.
  perform pg_temp.act('motivo176a@yuntera.example');
  a := public.get_order(v_staffed);
  assert a ? 'cancel_reason' and a -> 'cancel_reason' = 'null'::jsonb,
    format('shopper: staff''s note hidden, got %s', a -> 'cancel_reason');
  assert a ->> 'status' in ('cancelled', 'refunded') and a ->> 'cancelled_at' is not null,
    'shopper: still told the order is cancelled';
  -- Right caller: their own cancellation's fixed sentence.
  a := public.get_order(v_own);
  assert a ->> 'cancel_reason' = 'Cancelado por el cliente',
    format('shopper: own cancellation, got %s', a ->> 'cancel_reason');
  perform pg_temp.logout();

  -- Right caller: staff read the note as stored.
  perform pg_temp.act('central@yuntera.example');
  a := public.get_order(v_staffed);
  assert a ->> 'cancel_reason' = 'Sospecha de fraude; lo decidió Ana Mora, soporte',
    format('staff: note as stored, got %s', a ->> 'cancel_reason');
  perform pg_temp.logout();

  -- Wrong caller: another shopper cannot read the order.
  perform pg_temp.act('motivo176b@yuntera.example');
  begin
    perform public.get_order(v_staffed);
    assert false, 'another shopper read the order';
  exception when others then
    assert sqlerrm like '%order_not_found%', format('another shopper: %s', sqlerrm);
  end;
  perform pg_temp.logout();

  -- Left behind: the stored reason is unchanged.
  assert (select cancel_reason from public.orders where id = current_setting('t.staffed')::uuid)
         = 'Sospecha de fraude; lo decidió Ana Mora, soporte',
    'the stored note is unchanged';
end $$;

-- The two fixed sentences the database writes itself also reach the shopper.
do $$
declare
  v_order uuid := current_setting('t.staffed')::uuid;
  v_number text := (select order_number from public.orders where id = v_order);
  r text;
begin
  foreach r in array array['Pago no recibido a tiempo', 'Los paquetes regresaron sin entregarse'] loop
    update public.orders set cancel_reason = r where id = v_order;
    perform pg_temp.act('motivo176a@yuntera.example');
    assert public.get_order(v_number) ->> 'cancel_reason' = r, format('shopper reads %s', r);
    perform pg_temp.logout();
  end loop;
end $$;

select 'ok' as cancel_reason_to_shopper;
rollback;
