-- Simulated or real, decided once (20261121083510_invoicing_fixes.sql).
--
-- Cash on delivery taken in sandbox mode was settled as a simulation by
-- payments and documented as real by invoicing. Now one rule decides, when
-- the money is captured: this suite walks each kind of money through capture,
-- planning and refund, on a project that does not document simulated money
-- (invoicing_policy.simulated_payments false, as on the preview) with the
-- demo issuer set up:
--
--   1. the rule itself, case by case;
--   2. sandbox cash: simulated, its jobs end without a document, never retried;
--   3. cash taken in test mode and a transfer confirmed by hand in test mode:
--      real, documented, refunded by transfer with a credit note;
--   4. simulated money refunded after the mode changed stays simulated; real
--      money refunded after the mode changed is documented as before;
--   5. with the issuer not set up: simulated jobs end at once, real ones wait
--      and are documented in order once it is;
--   6. an order documented while the policy documented simulated money keeps
--      its jobs, so its credit note still follows;
--   7. the sweep ends simulated jobs without a worker;
--   8. the two read functions, for the right caller and the wrong ones;
--   9. the console counts payments, not jobs: a simulated order refunded
--      after it was paid is one payment, a rehearsal's simulated payment is
--      not real money, a refund waiting for its credit note is a refund;
--  10. the backfill reads the mode in force when each payment was captured.
--
-- Everything is asserted on the suite's own orders, or on differences from
-- a count taken before, so it holds on a used database. All rolled back.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

\ir _money_helpers.sql

grant execute on function pg_temp.remember(text, text) to authenticated;

-- The demo issuer set up, and simulated money NOT documented: a real
-- project's setting, which the local seed turns the other way.
select pg_temp.seed_invoicing_settings();
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'false')
where key = 'invoicing_policy';
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';

select pg_temp.shopper('fix152-a@yuntera.example', 'Prueba Arreglos Uno');
select pg_temp.shopper('fix152-b@yuntera.example', 'Prueba Arreglos Dos');

-- The invoice job of one order and topic.
create function pg_temp.job(p_order uuid, p_topic text) returns private.outbox_jobs
language sql as $$
  select j from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
  where j.consumer = 'invoice' and e.topic = p_topic and e.payload ->> 'order_id' = p_order::text
  order by j.event_id desc limit 1
$$;

create function pg_temp.docs(p_order uuid) returns integer
language sql as $$
  select count(*)::integer from public.electronic_invoices e where e.order_id = p_order and e.kind is not null
$$;

create function pg_temp.channel(p_refund uuid) returns text
language sql as $$ select g.channel from private.gateway_refunds g where g.refund_id = p_refund $$;

create function pg_temp.refund_of(p_order uuid) returns uuid
language sql as $$
  select f.id from private.refunds f where f.order_id = p_order order by f.created_at desc, f.id desc limit 1
$$;

create function pg_temp.return_units(p_email text, p_order uuid, p_slug text, p_quantity integer) returns uuid
language plpgsql as $$
declare
  v_return uuid;
begin
  perform pg_temp.act(p_email);
  v_return := public.request_return(pg_temp.item(p_order, p_slug), 'withdrawal', p_quantity);
  perform pg_temp.logout();
  perform pg_temp.receive(v_return);
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_complete_return(v_return);
  perform pg_temp.logout();
  return pg_temp.refund_of(p_order);
end;
$$;

create function pg_temp.cancel(p_email text, p_order uuid) returns uuid
language plpgsql as $$
begin
  perform pg_temp.act(p_email);
  perform public.cancel_order(p_order);
  perform pg_temp.logout();
  return pg_temp.refund_of(p_order);
end;
$$;

create function pg_temp.confirm_by_hand(p_order uuid, p_reference text) returns void
language plpgsql as $$
begin
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_confirm_payment(p_order, p_reference);
  perform pg_temp.logout();
end;
$$;

-- The planner, twice (as the worker runs it every minute).
create function pg_temp.plan() returns void
language sql as $$ select private.invoice_plan(1000); select private.invoice_plan(1000); $$;

-- ═══ 0. What the migration left behind ═════════════════════════════════════

do $$
begin
  assert not exists (select 1 from public.payments
                     where status in ('captured', 'partially_refunded', 'refunded') and simulated is null),
    'every captured payment has its money decided';
  assert not exists (select 1 from public.payments where status in ('pending', 'authorized', 'cancelled', 'failed')
                     and simulated is not null),
    'and no payment that was never captured';
end
$$;

-- ═══ 1. The rule ═══════════════════════════════════════════════════════════

do $$
declare
  c record;
begin
  for c in select * from (values
    -- provider, environment, method, mode at capture, simulated?
    ('sandbox', null, 'card', 'sandbox', true),
    ('sandbox', null, 'sinpe_movil', 'sandbox', true),
    ('sandbox', null, 'card', 'live', true),
    ('sandbox', null, 'bank_transfer', 'sandbox', true),
    ('sandbox', null, 'bank_transfer', 'live', false),
    ('sandbox', null, 'bank_transfer', 'test', false),
    ('cash', null, 'cash_on_delivery', 'sandbox', true),
    ('cash', null, 'cash_on_delivery', 'test', false),
    ('cash', null, 'cash_on_delivery', 'live', false),
    ('cash', 'test', 'cash_on_delivery', 'test', false),
    ('cash', 'test', 'cash_on_delivery', 'sandbox', false),
    ('cash', 'live', 'cash_on_delivery', 'sandbox', false),
    ('manual', 'test', 'bank_transfer', 'test', false),
    ('manual', 'live', 'bank_transfer', 'sandbox', false),
    ('onvo', 'test', 'card', 'test', true),
    ('onvo', 'test', 'sinpe_movil', 'live', true),
    ('onvo', 'live', 'card', 'live', false),
    ('onvo', 'live', 'card', 'sandbox', false),
    ('live', null, 'bank_transfer', 'live', false)
  ) as t (provider, environment, method, mode, simulated) loop
    assert private.payment_money_simulated(c.provider, c.environment, c.method::public.payment_method, c.mode)
           = c.simulated,
      format('%s/%s/%s captured in %s: simulated %s', c.provider, coalesce(c.environment, '-'), c.method,
             c.mode, c.simulated);
  end loop;
  -- Money held for review has no method: the gateway's test money is not real, live money is.
  assert private.payment_money_simulated('onvo', 'test', null, 'live'), 'review money, test';
  assert not private.payment_money_simulated('onvo', 'live', null, 'test'), 'review money, live';
end
$$;

-- ═══ 2. Sandbox cash: simulated, ended without a document ══════════════════

select pg_temp.remember('closed_before', (select count(*)::text from private.outbox_jobs
  where consumer = 'invoice' and status = 'done' and last_error = 'simulated_money'));
select pg_temp.remember('s_cod', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'fix152-s-cod-01')::text);
select pg_temp.deliver(current_setting('t.s_cod')::uuid);
do $$
declare
  p public.payments;
  j private.outbox_jobs;
begin
  select * into p from public.payments where order_id = current_setting('t.s_cod')::uuid;
  assert p.provider = 'cash' and p.environment is null and p.status = 'captured', format('sandbox cash: %s', p);
  assert p.simulated, 'sandbox cash is simulated';
  assert not private.invoice_money_documented(p.order_id), 'and not documented (the preview bug: it was)';
  j := pg_temp.job(p.order_id, 'payment.captured');
  assert j.status = 'pending', 'its job waits until something plans';
  assert private.invoice_job_simulated(j.event_id), 'and is one that can never produce a document';
end
$$;
select pg_temp.plan();
do $$
declare
  j private.outbox_jobs := pg_temp.job(current_setting('t.s_cod')::uuid, 'payment.captured');
begin
  assert j.status = 'done' and j.last_error = 'simulated_money' and j.done_at is not null,
    format('the job ended, visibly: %s', j);
  assert j.attempts = 1, format('once, never retried: %s', j.attempts);
  assert pg_temp.docs(current_setting('t.s_cod')::uuid) = 0, 'no document';
  assert (select count(*) from private.outbox_jobs where consumer = 'invoice' and status = 'done'
          and last_error = 'simulated_money') >= current_setting('t.closed_before')::integer + 1,
    'counted among the jobs closed as simulated';
end
$$;
-- Its return: settled as a simulation, the refund's job ends too.
select pg_temp.remember('s_cod_refund', pg_temp.return_units('fix152-a@yuntera.example',
  current_setting('t.s_cod')::uuid, 'libreta-tapa-dura-a5', 1)::text);
select pg_temp.plan();
do $$
declare
  j private.outbox_jobs := pg_temp.job(current_setting('t.s_cod')::uuid, 'fiscal.refund_booked');
begin
  assert pg_temp.channel(current_setting('t.s_cod_refund')::uuid) = 'simulated', 'refunded as a simulation';
  assert j.status = 'done' and j.last_error = 'simulated_money', format('refund job ended: %s', j);
  assert pg_temp.docs(current_setting('t.s_cod')::uuid) = 0, 'no credit note either';
end
$$;
-- Where the policy documents simulated money (local work, a rehearsal), the same cash is documented.
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'true') where key = 'invoicing_policy';
do $$
begin
  assert private.invoice_money_documented(current_setting('t.s_cod')::uuid), 'documented where the policy says so';
end
$$;
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'false') where key = 'invoicing_policy';

-- ═══ 3. Real money in test mode: documented, refunded by transfer ══════════

update public.app_settings set value = '"test"' where key = 'payments_mode';
select pg_temp.remember('t_cod', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'fix152-t-cod-01')::text);
select pg_temp.deliver(current_setting('t.t_cod')::uuid);
select pg_temp.remember('t_bank', pg_temp.place('fix152-b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'bank_transfer', 'fix152-t-bank-01')::text);
select pg_temp.confirm_by_hand(current_setting('t.t_bank')::uuid, 'BCR-152001');
select pg_temp.plan();
do $$
declare
  p public.payments;
begin
  select * into p from public.payments where order_id = current_setting('t.t_cod')::uuid;
  assert p.provider = 'cash' and p.environment = 'test' and not p.simulated, format('test-mode cash is real: %s', p);
  assert private.invoice_money_documented(p.order_id), 'and documented';
  assert pg_temp.docs(p.order_id) >= 2, format('a tiquete and a fee factura: %s', pg_temp.docs(p.order_id));
  assert (pg_temp.job(p.order_id, 'payment.captured')).last_error is null, 'its job was planned, not closed';
  select * into p from public.payments where order_id = current_setting('t.t_bank')::uuid;
  assert p.provider = 'manual' and p.environment = 'test' and not p.simulated,
    format('a transfer confirmed by hand in test mode is real: %s', p);
  assert pg_temp.docs(p.order_id) >= 2, 'and documented';
end
$$;
select pg_temp.remember('t_cod_docs', pg_temp.docs(current_setting('t.t_cod')::uuid)::text);
select pg_temp.remember('t_cod_refund', pg_temp.return_units('fix152-a@yuntera.example',
  current_setting('t.t_cod')::uuid, 'libreta-tapa-dura-a5', 1)::text);
select pg_temp.remember('t_bank_refund', pg_temp.cancel('fix152-b@yuntera.example',
  current_setting('t.t_bank')::uuid)::text);
select pg_temp.plan();
do $$
begin
  assert pg_temp.channel(current_setting('t.t_cod_refund')::uuid) = 'transfer', 'real cash goes back by transfer';
  assert pg_temp.channel(current_setting('t.t_bank_refund')::uuid) = 'transfer', 'so does a transfer';
  assert exists (select 1 from public.electronic_invoices where refund_id = current_setting('t.t_cod_refund')::uuid
                 and document_type = '03'), 'the return has its credit note';
  assert (select count(*) from public.electronic_invoices where refund_id = current_setting('t.t_bank_refund')::uuid
          and document_type = '03') >= 2, 'the cancellation credits every document';
end
$$;

-- ═══ 4. Refunds after the mode changed ═════════════════════════════════════
-- Money simulated when it was taken stays simulated (it used to become a
-- transfer for finance, for cash and hand-confirmed transfers); real money
-- stays real and is documented as before.

update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
select pg_temp.remember('s_bank', pg_temp.place('fix152-b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'bank_transfer', 'fix152-s-bank-01')::text);
select pg_temp.confirm_by_hand(current_setting('t.s_bank')::uuid, 'DEMO-152002');
select pg_temp.remember('s_cod2', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'fix152-s-cod-02')::text);
select pg_temp.deliver(current_setting('t.s_cod2')::uuid);
update public.app_settings set value = '"live"' where key = 'payments_mode';
select pg_temp.remember('l_cod', pg_temp.place('fix152-b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'fix152-l-cod-01')::text);
select pg_temp.deliver(current_setting('t.l_cod')::uuid);
select pg_temp.plan();
select pg_temp.remember('s_bank_refund', pg_temp.cancel('fix152-b@yuntera.example',
  current_setting('t.s_bank')::uuid)::text);
select pg_temp.remember('s_cod2_refund', pg_temp.return_units('fix152-a@yuntera.example',
  current_setting('t.s_cod2')::uuid, 'libreta-tapa-dura-a5', 1)::text);
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
select pg_temp.remember('l_cod_refund', pg_temp.return_units('fix152-b@yuntera.example',
  current_setting('t.l_cod')::uuid, 'libreta-tapa-dura-a5', 1)::text);
select pg_temp.plan();
do $$
begin
  assert (select simulated from public.payments where order_id = current_setting('t.s_bank')::uuid),
    'a transfer confirmed in sandbox is the demo''s';
  assert pg_temp.channel(current_setting('t.s_bank_refund')::uuid) = 'simulated',
    'and stays simulated after the mode went live';
  assert pg_temp.channel(current_setting('t.s_cod2_refund')::uuid) = 'simulated', 'so does sandbox cash';
  assert pg_temp.docs(current_setting('t.s_bank')::uuid) = 0 and pg_temp.docs(current_setting('t.s_cod2')::uuid) = 0,
    'neither has a document';
  assert not (select simulated from public.payments where order_id = current_setting('t.l_cod')::uuid),
    'cash taken in live is real';
  assert pg_temp.channel(current_setting('t.l_cod_refund')::uuid) = 'transfer',
    'and goes back by transfer after the mode went back to sandbox';
  assert exists (select 1 from public.electronic_invoices where refund_id = current_setting('t.l_cod_refund')::uuid
                 and document_type = '03'), 'with its credit note, as before';
end
$$;

-- ═══ 5. The issuer not set up: simulated jobs end, real ones wait ══════════

update public.app_settings set value = jsonb_set(value, '{ready}', 'false') where key = 'invoicing_issuer';
select pg_temp.remember('state_before', public.ops_invoicing_state()::text)
from (select pg_temp.act('central@yuntera.example')) x;
select pg_temp.logout();
select pg_temp.remember('n_sinpe', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'fix152-n-sinpe-01')::text);
select pg_temp.pay(current_setting('t.n_sinpe')::uuid);
update public.app_settings set value = '"live"' where key = 'payments_mode';
select pg_temp.remember('n_bank', pg_temp.place('fix152-b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'bank_transfer', 'fix152-n-bank-01')::text);
select pg_temp.confirm_by_hand(current_setting('t.n_bank')::uuid, 'BCR-152003');
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
do $$
declare
  b jsonb := current_setting('t.state_before')::jsonb;
  v jsonb;
begin
  perform pg_temp.act('central@yuntera.example');
  v := public.ops_invoicing_state();
  perform pg_temp.logout();
  assert not (v ->> 'issuer_ready')::boolean and v ->> 'payments_mode' = 'sandbox'
     and not (v ->> 'simulated_documented')::boolean, format('state: %s', v);
  assert (v ->> 'waiting_real')::int = (b ->> 'waiting_real')::int + 1, format('one more real payment waits: %s', v);
  assert (v ->> 'waiting_simulated')::int = (b ->> 'waiting_simulated')::int + 1,
    format('one more simulated one waits to end: %s', v);
end
$$;
select pg_temp.plan();
do $$
declare
  b jsonb := current_setting('t.state_before')::jsonb;
  v jsonb;
  j private.outbox_jobs;
begin
  j := pg_temp.job(current_setting('t.n_sinpe')::uuid, 'payment.captured');
  assert j.status = 'done' and j.last_error = 'simulated_money', format('simulated: ended before the issuer: %s', j);
  j := pg_temp.job(current_setting('t.n_bank')::uuid, 'payment.captured');
  assert j.status = 'pending' and j.attempts = 0 and j.last_error is null, format('real: waits, uncounted: %s', j);
  perform pg_temp.act('central@yuntera.example');
  v := public.ops_invoicing_state();
  perform pg_temp.logout();
  assert (v ->> 'waiting_simulated')::int = 0, format('nothing simulated waits after planning: %s', v);
  assert (v ->> 'closed_simulated')::int >= (b ->> 'closed_simulated')::int + 1, format('closed: %s', v);
end
$$;
update public.app_settings set value = jsonb_set(value, '{ready}', 'true') where key = 'invoicing_issuer';
select pg_temp.plan();
do $$
begin
  assert (pg_temp.job(current_setting('t.n_bank')::uuid, 'payment.captured')).status = 'done',
    'once set up, the real payment is planned';
  assert pg_temp.docs(current_setting('t.n_bank')::uuid) >= 2, 'and documented';
  assert pg_temp.docs(current_setting('t.n_sinpe')::uuid) = 0, 'the simulated one never';
end
$$;

-- ═══ 6. Documented while the policy said so: its credit notes still follow ═

update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'true') where key = 'invoicing_policy';
select pg_temp.remember('d_card', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'fix152-d-card-01')::text);
select pg_temp.pay(current_setting('t.d_card')::uuid);
select pg_temp.plan();
select pg_temp.remember('d_card_docs', pg_temp.docs(current_setting('t.d_card')::uuid)::text);
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'false') where key = 'invoicing_policy';
select pg_temp.remember('d_card_refund', pg_temp.cancel('fix152-a@yuntera.example',
  current_setting('t.d_card')::uuid)::text);
do $$
declare
  j private.outbox_jobs := pg_temp.job(current_setting('t.d_card')::uuid, 'fiscal.refund_booked');
begin
  assert current_setting('t.d_card_docs')::int >= 2, 'documented while the policy documented simulated money';
  assert not private.invoice_job_simulated(j.event_id), 'its refund job is not one to end';
  assert private.invoice_close_simulated() >= 0 and (pg_temp.job(current_setting('t.d_card')::uuid,
    'fiscal.refund_booked')).status = 'pending', 'and the close leaves it';
end
$$;
select pg_temp.plan();
do $$
begin
  assert (select count(*) from public.electronic_invoices where refund_id = current_setting('t.d_card_refund')::uuid
          and document_type = '03') = current_setting('t.d_card_docs')::int, 'every document credited';
end
$$;

-- ═══ 7. The sweep ends them without a worker ═══════════════════════════════

select pg_temp.remember('w_sinpe', pg_temp.place('fix152-b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'fix152-w-sinpe-01')::text);
select pg_temp.pay(current_setting('t.w_sinpe')::uuid);
do $$
begin
  assert (pg_temp.job(current_setting('t.w_sinpe')::uuid, 'payment.captured')).status = 'pending', 'waiting';
  perform private.invoice_sweep();
  assert (pg_temp.job(current_setting('t.w_sinpe')::uuid, 'payment.captured')).last_error = 'simulated_money',
    'the sweep ended it';
end
$$;

-- ═══ 8. The read functions: who may call them, and what they say ═══════════

-- A factura asked for at checkout, on an order paid with simulated money and
-- on one not paid yet; an order with free delivery.
select pg_temp.act('fix152-a@yuntera.example');
select public.set_checkout_invoice_receiver('fix152-f-cod-01', 'fisica', '1-0987-0654', 'Ana <Prueba> & "Cía"',
                                            'ana@example.com');
select public.set_checkout_invoice_receiver('fix152-f-sinpe-01', 'fisica', '109870654', 'Ana Prueba', null);
select pg_temp.logout();
select pg_temp.remember('f_cod', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'fix152-f-cod-01')::text);
select pg_temp.remember('f_sinpe', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'fix152-f-sinpe-01')::text);
select pg_temp.pay(current_setting('t.f_sinpe')::uuid);
select pg_temp.remember('free', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('laptop-14-nimbo-libro:1'), 'sinpe_movil', 'fix152-free-01')::text);
select pg_temp.remember('f_cod_number', (select order_number from public.orders where id = current_setting('t.f_cod')::uuid));
select pg_temp.remember('f_sinpe_number', (select order_number from public.orders where id = current_setting('t.f_sinpe')::uuid));
select pg_temp.remember('free_number', (select order_number from public.orders where id = current_setting('t.free')::uuid));
select pg_temp.remember('t_cod_number', (select order_number from public.orders where id = current_setting('t.t_cod')::uuid));

select pg_temp.login('fix152-a@yuntera.example', 'aal2');
do $$
declare
  v jsonb;
begin
  v := public.my_order_invoicing(current_setting('t.f_cod_number'));
  assert v = '{"paid": false, "simulated": true, "documented": false, "issuer_ready": true,
               "delivery_by_platform": true, "factura_requested": true}'::jsonb,
    format('sandbox cash, not paid yet, factura asked for: %s', v);
  v := public.my_order_invoicing(current_setting('t.f_sinpe_number'));
  assert v = '{"paid": true, "simulated": true, "documented": false, "issuer_ready": true,
               "delivery_by_platform": true, "factura_requested": true}'::jsonb,
    format('simulated SINPE, paid, not planned yet: %s', v);
  v := public.my_order_invoicing(current_setting('t.t_cod_number'));
  assert v = '{"paid": true, "simulated": false, "documented": true, "issuer_ready": true,
               "delivery_by_platform": true, "factura_requested": false}'::jsonb,
    format('real cash: %s', v);
  v := public.my_order_invoicing(current_setting('t.free_number'));
  assert (v ->> 'delivery_by_platform')::boolean is false, format('free delivery: nothing of Yuntera''s: %s', v);
end
$$;
reset role;
-- Asked for and issued: a factura in the shopper's name, with real money.
select pg_temp.remember('f_cash_real_key', 'fix152-f-real-01');
update public.app_settings set value = '"live"' where key = 'payments_mode';
select pg_temp.act('fix152-a@yuntera.example');
select public.set_checkout_invoice_receiver('fix152-f-real-01', 'fisica', '109870654', 'Ana Prueba', null);
select pg_temp.logout();
select pg_temp.remember('f_real', pg_temp.place('fix152-a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'bank_transfer', 'fix152-f-real-01')::text);
select pg_temp.confirm_by_hand(current_setting('t.f_real')::uuid, 'BCR-152004');
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
select pg_temp.plan();
select pg_temp.remember('f_real_number', (select order_number from public.orders where id = current_setting('t.f_real')::uuid));
select pg_temp.login('fix152-a@yuntera.example', 'aal2');
do $$
declare
  v jsonb := public.my_order_invoicing(current_setting('t.f_real_number'));
begin
  assert v ->> 'factura_requested' = 'true' and v ->> 'documented' = 'true' and v ->> 'paid' = 'true',
    format('issued factura: %s', v);
  assert exists (select 1 from jsonb_array_elements(public.my_order_invoices(current_setting('t.f_real_number'))) x
                 where x ->> 'document_type' = '01'), 'and it is there';
  -- Planned, the simulated order's job ended and what was typed for it is gone.
  assert public.my_order_invoicing(current_setting('t.f_sinpe_number')) ->> 'factura_requested' = 'false',
    'the factura asked for on simulated money is not kept';
end
$$;
reset role;

-- The wrong callers.
select pg_temp.login('fix152-b@yuntera.example', 'aal2');
select pg_temp.refused(format('select public.my_order_invoicing(%L)', current_setting('t.f_cod_number')),
                       'order_not_found');
select pg_temp.refused('select public.ops_invoicing_state()', 'forbidden');
reset role;
select pg_temp.login('vendedor@yuntera.example', 'aal2');
select pg_temp.refused('select public.ops_invoicing_state()', 'forbidden');
select pg_temp.refused(format('select public.my_order_invoicing(%L)', current_setting('t.f_cod_number')),
                       'order_not_found');
reset role;
select pg_temp.login_anon();
select pg_temp.refused(format('select public.my_order_invoicing(%L)', current_setting('t.f_cod_number')),
                       'forbidden');
select pg_temp.refused('select public.ops_invoicing_state()', 'forbidden');
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.my_order_invoicing(text)', 'execute'), 'visitors: no grant';
  assert not has_function_privilege('anon', 'public.ops_invoicing_state()', 'execute'), 'visitors: no grant';
  assert not has_function_privilege('authenticated', 'private.invoice_close_simulated()', 'execute'),
    'the closing is internal';
  assert not has_function_privilege('authenticated', 'private.payment_simulated(public.payments)', 'execute'),
    'so is the rule';
end
$$;

-- ═══ 9. The console counts payments, not jobs ══════════════════════════════

-- A simulated order paid and then cancelled: two jobs end, one payment.
update public.app_settings set value = jsonb_set(value, '{ready}', 'true') where key = 'invoicing_issuer';
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'false') where key = 'invoicing_policy';
select pg_temp.plan();
select pg_temp.remember('state_c0', public.ops_invoicing_state()::text)
from (select pg_temp.act('central@yuntera.example')) x;
select pg_temp.logout();
select pg_temp.remember('c_sinpe', pg_temp.place('fix152-b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'fix152-c-sinpe-01')::text);
select pg_temp.pay(current_setting('t.c_sinpe')::uuid);
select pg_temp.plan();
select pg_temp.cancel('fix152-b@yuntera.example', current_setting('t.c_sinpe')::uuid);
select pg_temp.plan();
do $$
declare
  b jsonb := current_setting('t.state_c0')::jsonb;
  v jsonb;
begin
  assert (pg_temp.job(current_setting('t.c_sinpe')::uuid, 'fiscal.refund_booked')).last_error = 'simulated_money',
    'the refund''s job ended too';
  perform pg_temp.act('central@yuntera.example');
  v := public.ops_invoicing_state();
  perform pg_temp.logout();
  assert (v ->> 'closed_simulated')::int = (b ->> 'closed_simulated')::int + 1,
    format('paid and refunded, still one payment closed: %s then %s', b, v);
end
$$;

-- A rehearsal (simulated money documented) with the issuer not set up: the
-- simulated payment waits as a rehearsal, not as real money, and its
-- refund's credit note waits on its own line.
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'true') where key = 'invoicing_policy';
update public.app_settings set value = jsonb_set(value, '{ready}', 'false') where key = 'invoicing_issuer';
select pg_temp.remember('state_r0', public.ops_invoicing_state()::text)
from (select pg_temp.act('central@yuntera.example')) x;
select pg_temp.logout();
select pg_temp.remember('r_sinpe', pg_temp.place('fix152-b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'fix152-r-sinpe-01')::text);
select pg_temp.pay(current_setting('t.r_sinpe')::uuid);
select pg_temp.plan();
do $$
declare
  b jsonb := current_setting('t.state_r0')::jsonb;
  v jsonb;
begin
  perform pg_temp.act('central@yuntera.example');
  v := public.ops_invoicing_state();
  perform pg_temp.logout();
  assert (v ->> 'waiting_rehearsal')::int = (b ->> 'waiting_rehearsal')::int + 1,
    format('the simulated payment waits as a rehearsal: %s then %s', b, v);
  assert (v ->> 'waiting_real')::int = (b ->> 'waiting_real')::int,
    format('and is not counted as real money: %s then %s', b, v);
  assert (v ->> 'waiting_simulated')::int = (b ->> 'waiting_simulated')::int, 'nor as one to end';
end
$$;
select pg_temp.cancel('fix152-b@yuntera.example', current_setting('t.r_sinpe')::uuid);
do $$
declare
  b jsonb := current_setting('t.state_r0')::jsonb;
  v jsonb;
begin
  perform pg_temp.act('central@yuntera.example');
  v := public.ops_invoicing_state();
  perform pg_temp.logout();
  assert (v ->> 'waiting_refunds')::int = (b ->> 'waiting_refunds')::int + 1,
    format('its refund waits for its credit note: %s then %s', b, v);
  assert (v ->> 'waiting_rehearsal')::int = (b ->> 'waiting_rehearsal')::int + 1,
    format('and is not another payment: %s then %s', b, v);
end
$$;
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'false') where key = 'invoicing_policy';
update public.app_settings set value = jsonb_set(value, '{ready}', 'true') where key = 'invoicing_issuer';

-- ═══ 10. The backfill: the mode in force at capture, not at migration ═════
-- Payments captured before 083510 were decided with private.payments_mode_at
-- (their captured_at), read from the audit trail of app_settings. A change of
-- the mode recorded in the (rolled back) future stands for "the mode was
-- switched after this cash was taken and before the migration ran".
do $$
declare
  v_now text := private.payments_mode();
  v_next text := case when private.payments_mode() = 'live' then 'test' else 'live' end;
begin
  assert private.payments_mode_at(now() + interval '1 hour') = v_now, 'no change ahead: the current mode';
  insert into private.audit_log (action, table_name, row_key, old_row, new_row, at)
  values ('UPDATE', 'app_settings', 'payments_mode',
          jsonb_build_object('key', 'payments_mode', 'value', to_jsonb(v_now)),
          jsonb_build_object('key', 'payments_mode', 'value', to_jsonb(v_next)),
          now() + interval '2 hours'),
         ('UPDATE', 'app_settings', 'payments_mode',
          jsonb_build_object('key', 'payments_mode', 'value', to_jsonb(v_next)),
          jsonb_build_object('key', 'payments_mode', 'value', '"sandbox"'::jsonb),
          now() + interval '4 hours');
  assert private.payments_mode_at(now() + interval '1 hour') = v_now, 'before the change: the mode it replaced';
  assert private.payments_mode_at(now() + interval '3 hours') = v_next, 'after it: the new mode';
  assert private.payments_mode_at(now() + interval '5 hours') = 'sandbox', 'after the next: that one';
  assert private.payments_mode_at('1900-01-01') = 'sandbox', 'before the setting existed: sandbox';
  -- The backfill's rule for cash taken in sandbox (no environment), with
  -- the mode switched to test or live before the migration: still simulated.
  assert private.payment_money_simulated('cash', null, 'cash_on_delivery',
           private.payments_mode_at(now() + interval '5 hours')),
    'sandbox cash captured while the mode was sandbox stays simulated';
  assert not private.payment_money_simulated('cash', null, 'cash_on_delivery',
           private.payments_mode_at(now() + interval '3 hours')),
    'cash collected while the mode was live is real';
end
$$;

select pg_temp.check_money('the end');
select 'ok' as invoicing_fixes;
rollback;
