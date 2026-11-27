-- When a refund was requested and completed (private.settle_gateway_refund,
-- 20261121085000). A simulated refund is settled in the transaction that
-- opens it; its requested_at is the moment of the insert (clock_timestamp())
-- and its completed_at was the start of the transaction (now()), a few
-- milliseconds earlier. Every refund of this suite is settled inside its one
-- transaction, which is exactly that case.
--
--   right caller: the shopper cancelling a paid order, and staff stopping a
--                 parcel the warehouse then checks in, get simulated refunds
--                 whose completed_at is never before their requested_at, in
--                 the table and in what public.order_payment shows them;
--   wrong caller: another shopper cannot read the order's payment; nobody
--                 through the API can call the settlement;
--   left behind:  the refunds succeeded, the money checks hold.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

select pg_temp.shopper('reembolso194a@yuntera.example', 'Prueba Reembolso Uno');
select pg_temp.shopper('reembolso194b@yuntera.example', 'Prueba Reembolso Dos');
delete from public.staff_members
where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
insert into public.staff_members (user_id, role)
select id, 'ops' from auth.users where email = 'comprador3@yuntera.example';

-- A: paid, then cancelled by the shopper (one refund of the whole order).
select pg_temp.remember('a', pg_temp.place('reembolso194a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'reembolso-194-a')::text);
select pg_temp.pay(current_setting('t.a')::uuid);
select pg_temp.act('reembolso194a@yuntera.example');
select public.cancel_order(current_setting('t.a')::uuid, null);
select pg_temp.logout();

-- B: paid, packed, stopped by staff and checked in (the goods and the fee).
select pg_temp.remember('b', pg_temp.place('reembolso194a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'reembolso-194-b')::text);
select pg_temp.pay(current_setting('t.b')::uuid);
select pg_temp.pack(pg_temp.shipment(current_setting('t.b')::uuid, 'platform'));
select pg_temp.act('comprador3@yuntera.example');
select public.ops_recall_shipment(pg_temp.shipment(current_setting('t.b')::uuid, 'platform'), 'Prueba de tiempos');
select pg_temp.act('bodega@yuntera.example');
select public.wms_receive_returned_shipment(pg_temp.shipment(current_setting('t.b')::uuid, 'platform'), true, null);
select pg_temp.logout();

do $$
declare
  g record;
  r jsonb;
  n integer := 0;
  v_order uuid;
begin
  for g in select x.* from private.gateway_refunds x
           where x.order_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid) loop
    n := n + 1;
    assert g.channel = 'simulated' and g.status = 'succeeded',
      format('refund %s: simulated and settled (%s, %s)', g.id, g.channel, g.status);
    assert g.completed_at >= g.requested_at,
      format('refund %s: completed %s before it was requested %s', g.id, g.completed_at, g.requested_at);
  end loop;
  assert n = 3, format('fixture: three refunds (the cancellation, the goods, the fee), got %s', n);

  -- What the shopper reads says the same.
  foreach v_order in array array[current_setting('t.a')::uuid, current_setting('t.b')::uuid] loop
    perform pg_temp.act('reembolso194a@yuntera.example');
    for r in select * from jsonb_array_elements(public.order_payment(
               (select order_number from public.orders where id = v_order)) -> 'refunds') loop
      assert (r ->> 'completed_at')::timestamptz >= (r ->> 'requested_at')::timestamptz,
        format('order_payment: completed before requested %s', r);
    end loop;
    perform pg_temp.logout();
  end loop;
end $$;

-- Wrong callers.
select pg_temp.act('reembolso194b@yuntera.example');
select pg_temp.refused(format('select public.order_payment(%L)',
  (select order_number from public.orders where id = current_setting('t.a')::uuid)), 'order_not_found');
select pg_temp.logout();
do $$ begin
  assert not has_function_privilege('anon', 'private.settle_gateway_refund(uuid, text)', 'execute')
         and not has_function_privilege('authenticated', 'private.settle_gateway_refund(uuid, text)', 'execute'),
    'grants: nobody calls the settlement through the API';
  assert (select p.prosecdef and p.proconfig = array['search_path=""']
          from pg_proc p where p.oid = 'private.settle_gateway_refund(uuid, text)'::regprocedure),
    'settlement: a definer with an empty search path';
end $$;

select pg_temp.check_money('after the refunds');

select 'ok' as refund_completed_after_requested;
rollback;
