-- Electronic invoices (20261121083500_invoicing.sql).
--
--   1. The arithmetic and the keys against the research note's worked examples.
--   2. Nothing is numbered until the issuer is set up; then each event's
--      documents are made exactly once, numbered with no gaps per counter,
--      with a clave built as the annex defines it.
--   3. The amounts equal the order and the ledger.
--   4. A factura asked for at checkout; credit notes for a cancelled order and
--      for a return, referencing the right document with the right code.
--   5. The worker's functions: right and wrong caller, the signed XML stored
--      once, each documented status, the poll schedule, retries, a pause.
--   6. A rejection: never edited, replaced with a new number; a credit note
--      that waits for the replacement.
--   7. Who reads what: the shopper, a shop's team, finance, nobody else; the
--      second lock (row-level security) says the same.
-- Two planners at once (the gap-free number under concurrency) are in
-- packages/db/src/contract.invoicing.test.ts, which needs two connections.

begin;
\ir _helpers.sql

create function pg_temp.login_worker() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

create function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- The refusal code of a statement, or 'ok'.
create function pg_temp.code_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

do $$
begin
  execute format('grant usage on schema %I to authenticated, anon, service_role',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.code_of(text), pg_temp.remember(text, text)
  to authenticated, anon, service_role;

-- ═══ 1. Arithmetic and keys ═════════════════════════════════════════════════

do $$
begin
  -- research note 3.3, first worked example: tiquete 1532 of 3101123456 at
  -- 21:30 on 21 Nov 2026 in Costa Rica (22 Nov in UTC)
  assert private.invoice_consecutivo(1, 1, '04', 1532) = '00100001040000001532', 'consecutivo';
  assert private.invoice_clave('2026-11-22T03:30:00Z', '3101123456', '00100001040000001532', '1', '48291037')
         = '50621112600310112345600100001040000001532148291037', 'clave, example 1';
  -- second example: factura 27 of 109870654 on 5 Jan 2027
  assert private.invoice_clave('2027-01-05T15:00:00Z', '109870654',
                               private.invoice_consecutivo(1, 1, '01', 27), '1', '00000007')
         = '50605012700010987065400100001010000000027100000007', 'clave, example 2';
  assert substr(private.invoice_clave('2026-12-01T05:59:59Z', '109870654',
                private.invoice_consecutivo(1, 1, '01', 1), '1', '00000001'), 4, 6) = '301126',
    'the clave carries the Costa Rica date, also after 18:00 there';
  assert private.invoice_security_code() ~ '^[0-9]{8}$', 'eight random digits';
  assert private.invoice_poll_delay(0, now()) = interval '5 seconds' and private.invoice_poll_delay(1, now()) = interval '15 seconds'
         and private.invoice_poll_delay(2, now()) = interval '60 seconds', 'Hacienda is asked after 5 s, 15 s, 60 s';
  assert private.invoice_poll_delay(5, now() - interval '2 hours') = interval '5 minutes', 'then every 5 minutes for 3 hours';
  assert private.invoice_poll_delay(5, now() - interval '4 hours') = interval '1 hour', 'then every hour';

  -- research note 3.11: ₡2 500 → 2212.38938 + 287.61062; ₡100 → 88.49558 + 11.50443 = 100.00001
  assert private.invoice_net_of_gross(250000, 1300) = 2212.38938, 'net of ₡2 500';
  assert private.invoice_line(1, '6803000000000', 'Os', 'Entrega', private.invoice_net_of_gross(250000, 1300), '08')
         @> '{"unit_price": "2212.38938", "tax": {"amount": "287.61062", "rate": "13.00"}, "line_total": "2500.00000"}',
    'the delivery line of the validated tiquete';
  assert private.invoice_line(1, '6803000000000', 'Os', 'Entrega', private.invoice_net_of_gross(10000, 1300), '08')
         @> '{"unit_price": "88.49558", "net_tax": "11.50443", "line_total": "100.00001"}',
    'the formula-exact values one unit off the gross';
  assert private.invoice_line(1, '6254400000000', 'Cm', 'Comisión', 2400, '08')
         @> '{"base": "2400.00000", "net_tax": "312.00000", "line_total": "2712.00000"}', 'the commission sample';
  assert private.invoice_summary(jsonb_build_array(
           private.invoice_line(1, '6803000000000', 'Os', 'Entrega', private.invoice_net_of_gross(250000, 1300), '08')))
         = '{"services_taxed": "2212.38938", "services_exempt": null, "services_not_subject": null,
             "goods_taxed": null, "goods_exempt": null, "goods_not_subject": null,
             "total_taxed": "2212.38938", "total_exempt": null, "total_not_subject": null,
             "total_sale": "2212.38938", "total_net": "2212.38938",
             "breakdown": [{"code": "01", "tarifa_code": "08", "amount": "287.61062"}],
             "total_tax": "287.61062", "total": "2500.00000"}'::jsonb,
    'the totals of the validated tiquete';
end
$$;

-- ═══ 2. Planning: not before the issuer is set up, then exactly once ════════

select pg_temp.remember('capture_jobs', (
  select count(*)::text from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
  where j.consumer = 'invoice' and e.topic = 'payment.captured'));

do $$
begin
  assert current_setting('t.capture_jobs')::integer >= 10, 'every captured payment of the seed has an invoice job';
  assert not exists (select 1 from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
                     where j.consumer = 'invoice' and e.topic not in ('payment.captured', 'fiscal.refund_booked')),
    'only the two topics are routed to invoicing';
end
$$;

update public.app_settings set value = jsonb_set(value, '{ready}', 'false') where key = 'invoicing_issuer';
select pg_temp.login_worker();
select pg_temp.remember('planned_unready', public.worker_invoice_plan(1000)::text);
reset role;
do $$
begin
  assert current_setting('t.planned_unready')::integer = 0, 'nothing is planned before the issuer is ready';
  assert not exists (select 1 from public.electronic_invoices), 'no document';
  assert not exists (select 1 from private.fiscal_counters), 'no number taken';
  assert (select count(*) from private.outbox_jobs where consumer = 'invoice' and status = 'pending' and attempts = 0)
         = current_setting('t.capture_jobs')::integer, 'the jobs wait, uncounted';
end
$$;
update public.app_settings set value = jsonb_set(value, '{ready}', 'true') where key = 'invoicing_issuer';

-- A stranger cannot plan, nor can a signed-in person.
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert pg_temp.code_of('select public.worker_invoice_plan(10)') like 'permission denied%',
    'a signed-in person may not call the worker';
end
$$;
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role service_role;
do $$
begin
  assert pg_temp.code_of('select public.worker_invoice_plan(10)') = 'worker_only',
    'the service role without the worker''s claims is refused';
end
$$;
reset role;

select pg_temp.login_worker();
select pg_temp.remember('planned', public.worker_invoice_plan(1000)::text);
select pg_temp.remember('planned_again', public.worker_invoice_plan(1000)::text);
reset role;

do $$
declare
  v_docs integer := (select count(*) from public.electronic_invoices);
  v_fees integer := (select count(*) from public.seller_order_fees f
                     where f.fees_net_minor > 0
                       and exists (select 1 from public.ledger_transactions t
                                   where t.order_id = f.order_id and t.kind = 'order_capture'));
  v_delivery integer := (select count(*) from public.orders o where o.shipping_minor > 0
                         and exists (select 1 from public.ledger_transactions t
                                     where t.order_id = o.id and t.kind = 'order_capture'));
begin
  assert current_setting('t.planned')::integer = current_setting('t.capture_jobs')::integer, 'every job planned';
  assert current_setting('t.planned_again')::integer = 0, 'a second run plans nothing';
  assert (select count(*) from public.electronic_invoices where kind = 'fees') = v_fees,
    format('one fee factura per seller and paid order (%s)', v_fees);
  assert (select count(*) from public.electronic_invoices where kind = 'delivery') = v_delivery,
    format('one delivery document per paid order with shipping (%s)', v_delivery);
  assert v_docs = v_fees + v_delivery, 'and nothing else';
  assert not exists (select 1 from public.electronic_invoices where kind = 'fees' and document_type <> '01'),
    'fees go on a factura';
  assert not exists (select 1 from public.electronic_invoices where kind = 'delivery' and document_type <> '04'),
    'the seed''s shoppers asked for no factura: tiquetes';
  assert not exists (select 1 from public.electronic_invoices where status <> 'pending'), 'all wait for the worker';
end
$$;

-- Planning the same event again changes nothing: no document, no number.
select pg_temp.remember('counter_before', (select sum(last_number)::text from private.fiscal_counters));
update private.outbox_jobs set status = 'pending' where consumer = 'invoice';
select pg_temp.login_worker();
select public.worker_invoice_plan(1000);
reset role;
do $$
begin
  assert (select sum(last_number)::text from private.fiscal_counters) = current_setting('t.counter_before'),
    'a repeated event takes no number';
  assert (select count(*) from public.electronic_invoices) = (select count(distinct dedupe_key) from public.electronic_invoices),
    'and makes no second document';
end
$$;

-- Numbers: per counter 1, 2, 3 … with no gap and no repeat; the clave as the annex defines it.
do $$
declare
  c record;
begin
  for c in
    select e.document_type, count(*) as n, min(e.sequence_number) as lo, max(e.sequence_number) as hi,
           count(distinct e.sequence_number) as distinct_n, max(f.last_number) as counter
    from public.electronic_invoices e
    join private.fiscal_counters f on f.document_type = e.document_type
    group by e.document_type
  loop
    assert c.lo = 1 and c.hi = c.n and c.distinct_n = c.n and c.counter = c.n,
      format('type %s: numbers 1..%s without gaps (%s..%s, counter %s)', c.document_type, c.n, c.lo, c.hi, c.counter);
  end loop;
  assert not exists (
    select 1 from public.electronic_invoices e
    where e.clave <> '506' || to_char((e.issued_at at time zone 'UTC') - interval '6 hours', 'DDMMYY')
                    || lpad(e.issuer ->> 'id_number', 12, '0') || e.consecutivo || '1' || e.security_code
       or e.consecutivo <> '001' || '00001' || e.document_type || lpad(e.sequence_number::text, 10, '0')
       or e.issuer ->> 'id_number' <> '3101123456'
       or e.clave !~ '^[0-9]{50}$'),
    'every clave: 506, the Costa Rica date, the issuer padded to 12, the consecutive number, situation 1, the code';
end
$$;

-- ═══ 3. The amounts equal the order and the ledger ══════════════════════════

do $$
declare
  f record;
  v_capture record;
begin
  for f in
    select s.*, e.lines, e.summary, e.total_minor as doc_total
    from public.seller_order_fees s
    join public.electronic_invoices e on e.dedupe_key = 'fees:' || s.order_id || ':' || s.seller_id
  loop
    assert (select sum((l ->> 'total')::numeric) * 100 from jsonb_array_elements(f.lines) l) = f.fees_net_minor,
      'the factura''s net amounts are the statement''s fees, to the céntimo';
    assert coalesce((select (l ->> 'total')::numeric * 100 from jsonb_array_elements(f.lines) l
                     where l ->> 'unit' = 'Cm'), 0) = f.referral_fee_minor, 'the commission line';
    assert f.doc_total = f.fees_net_minor + f.fees_tax_minor, 'what was charged, in céntimos';
    assert abs((f.summary ->> 'total_tax')::numeric * 100 - f.fees_tax_minor) < 1,
      'the IVA at five decimals is within a céntimo of the IVA the ledger booked';
  end loop;

  -- Over the whole ledger: each revenue account of the captures equals the documents' lines.
  select sum(-x.amount_minor) filter (where a.code = 'commission_revenue') as commission,
         sum(-x.amount_minor) filter (where a.code = 'fulfillment_revenue') as fulfillment,
         sum(-x.amount_minor) filter (where a.code = 'payment_fee_revenue') as payment,
         sum(-x.amount_minor) filter (where a.code = 'shipping_revenue') as shipping
  into v_capture
  from public.ledger_entries x
  join public.ledger_transactions t on t.id = x.transaction_id and t.kind = 'order_capture'
  join public.ledger_accounts a on a.id = x.account_id;
  assert (select sum((l ->> 'total')::numeric) * 100 from public.electronic_invoices e, jsonb_array_elements(e.lines) l
          where e.kind = 'fees' and l ->> 'unit' = 'Cm') = v_capture.commission, 'commission = the ledger';
  assert (select sum((l ->> 'total')::numeric) * 100 from public.electronic_invoices e, jsonb_array_elements(e.lines) l
          where e.kind = 'fees' and l ->> 'cabys' = '6729000000000') = v_capture.fulfillment,
    'warehouse fees = the ledger';
  assert (select sum((l ->> 'total')::numeric) * 100 from public.electronic_invoices e, jsonb_array_elements(e.lines) l
          where e.kind = 'fees' and l ->> 'cabys' = '7119002009900') = v_capture.payment,
    'payment fees = the ledger';
  assert abs((select sum((l ->> 'total')::numeric) * 100 from public.electronic_invoices e,
              jsonb_array_elements(e.lines) l where e.kind = 'delivery') - v_capture.shipping)
         < (select count(*) from public.electronic_invoices where kind = 'delivery'),
    'the delivery fees net of IVA are the ledger''s, within a céntimo each';
  assert not exists (select 1 from public.electronic_invoices e join public.orders o on o.id = e.order_id
                     where e.kind = 'delivery' and (e.total_minor <> o.shipping_minor
                       or (e.summary ->> 'total')::numeric * 100 - o.shipping_minor not between 0 and 1)),
    'each delivery document is what the shopper paid for delivery';
  assert not exists (select 1 from public.electronic_invoices e join public.orders o on o.id = e.order_id
                     where e.kind = 'delivery' and e.payments -> 0 ->> 'code' <> private.invoice_payment_code(o.payment_method)),
    'with how the shopper paid';
  assert not exists (select 1 from public.electronic_invoices e
                     where e.kind = 'fees' and (e.payments -> 0 ->> 'code' <> '99' or e.payments -> 0 ->> 'other' is null)),
    'fees netted from the payout: code 99 with the setting''s text';
  -- Receivers as the annex requires: a factura names its receiver; a tiquete names nobody.
  assert not exists (select 1 from public.electronic_invoices e join public.seller_private p on p.seller_id = e.receiver_seller_id
                     where e.kind = 'fees' and (e.receiver ->> 'id_number' <> p.id_number
                       or e.receiver ->> 'id_type' <> private.invoice_id_code(p.id_type)
                       or e.receiver ->> 'name' <> p.legal_name)), 'the seller''s registered identification';
  assert not exists (select 1 from public.electronic_invoices where document_type = '04' and receiver is not null),
    'a tiquete to an anonymous final consumer has no receiver';
end
$$;

-- ═══ 4. A factura asked for at checkout ═════════════════════════════════════

select pg_temp.remember('libreta', pg_temp.offer('libreta-tapa-dura-a5')::text);
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert pg_temp.code_of($q$select public.set_checkout_invoice_receiver('test-factura-1', 'fisica', '12345', 'María Pérez', null)$q$)
         = 'invoice_receiver_id_invalid', 'a cédula física has nine digits';
  assert pg_temp.code_of($q$select public.set_checkout_invoice_receiver('test-factura-1', 'juridica', '1-0987-0654', 'María Pérez', null)$q$)
         = 'invoice_receiver_id_invalid', 'and a cédula jurídica ten, starting 2 to 5';
  assert pg_temp.code_of($q$select public.set_checkout_invoice_receiver('test-factura-1', 'fisica', '1-0987-0654', 'M', null)$q$)
         = 'invoice_receiver_name_invalid', 'a name';
  assert pg_temp.code_of($q$select public.set_checkout_invoice_receiver('test-factura-1', 'fisica', '1-0987-0654', 'María Pérez', 'no-es-correo')$q$)
         = 'invoice_receiver_email_invalid', 'an e-mail that is one';
  assert public.set_checkout_invoice_receiver('test-factura-1', 'fisica', '1-0987-0654', '  María   Pérez Rojas ', 'maria@example.com')
         = '{"requested": true}', 'saved';
  assert public.set_checkout_invoice_receiver('test-factura-1', 'fisica', '109870654', 'María Pérez Rojas', 'maria@example.com')
         = '{"requested": true}', 'saved again, the same';
  perform pg_temp.remember('factura_order', (public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.libreta')::uuid, 'quantity', 1)),
    (select a.id from public.my_addresses() a where a.is_default), 'sinpe_movil', 'test-factura-1') ->> 'order_id'));
  perform public.confirm_sandbox_payment(current_setting('t.factura_order')::uuid);
  assert pg_temp.code_of($q$select public.set_checkout_invoice_receiver('test-factura-1', 'fisica', '109870654', 'Otra Persona', null)$q$)
         = 'invoice_receiver_locked', 'once paid, the receiver cannot change';
end
$$;
reset role;
select pg_temp.login_anon();
do $$
begin
  assert pg_temp.code_of($q$select public.set_checkout_invoice_receiver('test-factura-2', 'fisica', '109870654', 'Ana', null)$q$)
         like 'permission denied%', 'visitors cannot';
end
$$;
reset role;

select pg_temp.login_worker();
select public.worker_invoice_plan(100);
reset role;
do $$
declare
  d public.electronic_invoices;
  o public.orders;
begin
  select * into o from public.orders where id = current_setting('t.factura_order')::uuid;
  assert o.shipping_minor > 0, 'the test order pays for delivery';
  select * into d from public.electronic_invoices where dedupe_key = 'delivery:' || o.id;
  assert d.document_type = '01', 'a factura, as asked';
  assert d.receiver = '{"name": "María Pérez Rojas", "id_type": "01", "id_number": "109870654",
                        "email": "maria@example.com", "activity_code": null}'::jsonb, 'in her name, tidied';
  assert d.payments -> 0 ->> 'code' = '06', 'paid by SINPE Móvil';
  assert not exists (select 1 from private.invoice_checkout_receivers where idempotency_key = 'test-factura-1'),
    'what she typed lives only in the document now';
  perform pg_temp.remember('factura_id', d.id::text);
end
$$;

-- What someone typed for a factura that was never issued goes with their account.
select pg_temp.login('comprador2@yuntera.example');
select public.set_checkout_invoice_receiver('test-factura-borrar', 'juridica', '3-101-654321', 'Empresa de Prueba S.A.', null);
reset role;
do $$
declare
  v_user uuid := (select id from auth.users where email = 'comprador2@yuntera.example');
begin
  assert exists (select 1 from private.invoice_checkout_receivers where user_id = v_user), 'kept until the order is paid';
  update auth.users set deleted_at = now() where id = v_user;
  assert not exists (select 1 from private.invoice_checkout_receivers where user_id = v_user), 'erased with the account';
  update auth.users set deleted_at = null where id = v_user;
end
$$;

-- ═══ 5. The worker's functions ══════════════════════════════════════════════

-- Older documents are put aside so the steps below handle the new factura alone.
update public.electronic_invoices set next_attempt_at = now() + interval '1 day'
where id <> current_setting('t.factura_id')::uuid;

select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert pg_temp.code_of($q$select public.worker_invoice_claim('w', 10, 60)$q$) like 'permission denied%',
    'only the worker claims';
  assert pg_temp.code_of($q$select public.worker_invoice_record(gen_random_uuid(), 'w', '{"event": "received"}')$q$)
         like 'permission denied%', 'or records';
end
$$;
reset role;

select pg_temp.login_worker();
select pg_temp.remember('claim', public.worker_invoice_claim('worker-a', 10, 60)::text);
select pg_temp.remember('claim_b', public.worker_invoice_claim('worker-b', 10, 60)::text);
reset role;
do $$
declare
  c jsonb := current_setting('t.claim')::jsonb;
begin
  assert jsonb_array_length(c) = 1 and c -> 0 ->> 'id' = current_setting('t.factura_id'), 'the factura is claimed';
  assert c -> 0 ->> 'phase' = 'submit' and (c -> 0 ->> 'submitted_before')::boolean is false, 'to be sent, first time';
  assert c -> 0 -> 'document' ->> 'clave' = (select clave from public.electronic_invoices where id = current_setting('t.factura_id')::uuid),
    'with its clave';
  assert c -> 0 -> 'document' -> 'receiver' ->> 'id_number' = '109870654', 'its receiver';
  assert c -> 0 -> 'document' ->> 'provider_id' = '3101123456', 'and ProveedorSistemas: in-house software, own id';
  assert current_setting('t.claim_b') = '[]', 'a second worker gets nothing while the lease holds';
end
$$;

select pg_temp.login_worker();
do $$
declare
  v_id uuid := current_setting('t.factura_id')::uuid;
  v_clave text := (select clave from public.electronic_invoices where id = v_id);
  v_xml text := '<?xml version="1.0" encoding="UTF-8"?><FacturaElectronica><Clave>' || v_clave
                || '</Clave>' || repeat('<x>firmado</x>', 20) || '</FacturaElectronica>';
  v_sha text := encode(extensions.digest(convert_to(v_xml, 'UTF8'), 'sha256'), 'hex');
begin
  assert pg_temp.code_of(format('select public.worker_invoice_signed(%L, %L, %L, %L)', v_id, 'worker-a', v_xml, repeat('0', 64)))
         = 'invoice_file_invalid', 'a hash that does not match is refused';
  assert public.worker_invoice_signed(v_id, 'worker-b', v_xml, v_sha) is null, 'another worker cannot store it';
  assert public.worker_invoice_signed(v_id, 'worker-a', v_xml, v_sha) = v_xml, 'stored';
  assert public.worker_invoice_signed(v_id, 'worker-a', replace(v_xml, 'firmado', 'otro'),
           encode(extensions.digest(convert_to(replace(v_xml, 'firmado', 'otro'), 'UTF8'), 'sha256'), 'hex')) = v_xml,
    'a second signature is never kept: the first one comes back';
  assert public.worker_invoice_record(v_id, 'worker-b', '{"event": "received", "http_status": 201}') is null,
    'only the lease holder records';
  assert public.worker_invoice_record(v_id, 'worker-a', '{"event": "received", "http_status": 201}') = 'sent',
    '201: received, waiting for the answer';
end
$$;
reset role;

do $$
declare
  d public.electronic_invoices;
begin
  select * into d from public.electronic_invoices where id = current_setting('t.factura_id')::uuid;
  assert d.signed_sha256 is not null and d.made_available_at is not null, 'the receiver can download it already';
  assert d.next_attempt_at between now() + interval '4 seconds' and now() + interval '6 seconds', 'asked again in 5 s';
  assert d.locked_by is null and d.hacienda_state = 'recibido' and d.submitted_at is not null, 'and released';
  assert pg_temp.code_of(format('update private.electronic_invoice_files set content = %L where invoice_id = %L',
                                'otro', d.id)) like 'Rows in electronic_invoice_files are immutable%',
    'the stored XML can never change';
end
$$;

-- Polling: procesando, then 15 s, then 60 s, then aceptado with Hacienda's answer.
update public.electronic_invoices set next_attempt_at = now() where id = current_setting('t.factura_id')::uuid;
select pg_temp.login_worker();
do $$
declare
  v_id uuid := current_setting('t.factura_id')::uuid;
  c jsonb := public.worker_invoice_claim('worker-a', 10, 60);
  v_answer text := '<MensajeHacienda><Clave>x</Clave><Mensaje>1</Mensaje><DetalleMensaje>Aceptado</DetalleMensaje></MensajeHacienda>';
begin
  assert c -> 0 ->> 'phase' = 'poll' and c -> 0 ->> 'signed_xml' like '%firmado%', 'to be asked about, with its bytes';
  assert public.worker_invoice_record(v_id, 'worker-a', '{"event": "answer", "state": "procesando"}') = 'sent', 'procesando';
  assert (select next_attempt_at between now() + interval '14 seconds' and now() + interval '16 seconds'
          from public.electronic_invoices where id = v_id), 'next in 15 s';
  update public.electronic_invoices set next_attempt_at = now() where id = v_id;
  perform public.worker_invoice_claim('worker-a', 10, 60);
  assert public.worker_invoice_record(v_id, 'worker-a', '{"event": "answer", "state": "recibido"}') = 'sent', 'recibido';
  assert (select next_attempt_at between now() + interval '59 seconds' and now() + interval '61 seconds'
          from public.electronic_invoices where id = v_id), 'then in a minute';
  update public.electronic_invoices set next_attempt_at = now() where id = v_id;
  perform public.worker_invoice_claim('worker-a', 10, 60);
  assert pg_temp.code_of(format('select public.worker_invoice_record(%L, %L, %L)', v_id, 'worker-a',
                                '{"event": "answer", "state": "inventado"}')) = 'invoice_outcome_invalid',
    'a state Hacienda does not document is refused';
  assert pg_temp.code_of(format('select public.worker_invoice_record(%L, %L, %L)', v_id, 'worker-a',
                                '{"event": "aprobado"}')) = 'invoice_outcome_invalid', 'and so is an invented event';
  assert public.worker_invoice_record(v_id, 'worker-a', jsonb_build_object(
           'event', 'answer', 'state', 'aceptado', 'response_xml', v_answer,
           'response_sha256', encode(extensions.digest(convert_to(v_answer, 'UTF8'), 'sha256'), 'hex'),
           'message', '1', 'detail', 'Aceptado')) = 'accepted', 'aceptado';
end
$$;
reset role;
do $$
declare
  d public.electronic_invoices := (select e from public.electronic_invoices e where e.id = current_setting('t.factura_id')::uuid);
begin
  assert d.status = 'accepted' and d.accepted_at is not null and d.next_attempt_at is null, 'accepted, nothing more to do';
  assert d.response_sha256 is not null and d.hacienda_message = 'Aceptado', 'with Hacienda''s answer';
  assert (select file_name from private.electronic_invoice_files where invoice_id = d.id and kind = 'response')
         = d.clave || '_respuesta.xml', 'kept as {clave}_respuesta.xml';
end
$$;

-- Retries, the poll schedule after three hours, a configuration pause, a 404, a document held.
select pg_temp.remember('other_id', (select id::text from public.electronic_invoices
                                     where kind = 'fees' and status = 'pending' order by sequence_number limit 1));
update public.electronic_invoices set next_attempt_at = now() where id = current_setting('t.other_id')::uuid;
select pg_temp.login_worker();
do $$
declare
  v_id uuid := current_setting('t.other_id')::uuid;
  d public.electronic_invoices;
begin
  perform public.worker_invoice_claim('worker-a', 10, 60);
  assert public.worker_invoice_record(v_id, 'worker-a',
           '{"event": "retry", "http_status": 503, "code": "http_503", "message": "down", "retry_after": 30}') = 'pending',
    '503: still to be sent';
  select * into d from public.electronic_invoices where id = v_id;
  assert d.next_attempt_at >= now() + interval '23 seconds' and d.attempts = 1, 'after at least Retry-After, ±20 %';
  update public.electronic_invoices set next_attempt_at = now() where id = v_id;
  d := (select e from public.electronic_invoices e where e.id = v_id);
  assert (public.worker_invoice_claim('worker-a', 10, 60) -> 0 ->> 'submitted_before')::boolean,
    'the next attempt asks Hacienda first: the first may have got in';
  assert public.worker_invoice_record(v_id, 'worker-a', '{"event": "unknown_clave", "http_status": 404}') = 'pending',
    '404: Hacienda does not have it';
  assert (select submit_attempts = 0 and next_attempt_at <= now() from public.electronic_invoices where id = v_id),
    'so it is sent straight away';
  perform public.worker_invoice_claim('worker-a', 10, 60);
  assert public.worker_invoice_record(v_id, 'worker-a', '{"event": "config", "http_status": 403, "code": "http_403"}') = 'pending',
    'a gateway 403 is a configuration error';
  update public.electronic_invoices set next_attempt_at = now() where id = v_id;
  assert public.worker_invoice_claim('worker-a', 10, 60) = '[]', 'nothing is claimed while paused';
end
$$;
reset role;
do $$
begin
  assert exists (select 1 from private.invoice_transmission_pause where paused_until > now() + interval '14 minutes'),
    'every send pauses for 15 minutes';
  delete from private.invoice_transmission_pause;
end
$$;
select pg_temp.login_worker();
do $$
declare
  v_id uuid := current_setting('t.other_id')::uuid;
begin
  perform public.worker_invoice_claim('worker-a', 10, 60);
  assert public.worker_invoice_record(v_id, 'worker-a', '{"event": "invalid", "code": "summary_total"}') = 'pending',
    'the worker''s checks refused it';
  assert (select held_reason from public.electronic_invoices where id = v_id) = 'summary_total', 'held for staff';
  update public.electronic_invoices set next_attempt_at = now() where id = v_id;
  assert public.worker_invoice_claim('worker-a', 10, 60) = '[]', 'and not claimed again by itself';
end
$$;
reset role;

-- The callback: only a hint, and only for a document waiting for its answer.
select pg_temp.login_worker();
do $$
begin
  assert public.worker_invoice_hint((select clave from public.electronic_invoices where id = current_setting('t.factura_id')::uuid)) is false,
    'an accepted document is not polled again';
  assert public.worker_invoice_hint('5' || repeat('0', 49)) is false, 'an unknown clave changes nothing';
  perform public.worker_invoice_health('{"environment": "local", "certificate_not_after": "2027-11-22T00:00:00Z"}');
end
$$;
reset role;

-- Staff send a held document again once the cause is fixed.
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  assert pg_temp.code_of(format('select public.ops_invoice_retry(%L)', current_setting('t.other_id'))) = 'forbidden',
    'not a shopper';
end
$$;
reset role;
select pg_temp.login('central@yuntera.example');
select public.ops_set_staff('comprador3@yuntera.example', 'support', true);
reset role;
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  assert pg_temp.code_of(format('select public.ops_invoice_retry(%L)', current_setting('t.other_id'))) = 'forbidden',
    'nor staff outside finance';
  assert pg_temp.code_of('select public.ops_invoices(null, 10)') = 'forbidden', 'who also do not see the documents';
end
$$;
reset role;
select pg_temp.login('central@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.ops_invoices(null, 10);
  assert jsonb_array_length(v -> 'unsent') >= 1, 'the held document is among those not sent';
  assert (v -> 'worker' ->> 'certificate_not_after')::timestamptz = '2027-11-22T00:00:00Z', 'the certificate''s expiry';
  assert jsonb_array_length(v -> 'daily') = 14, 'fourteen days of counts';
  assert (v -> 'counts' ->> 'accepted')::integer = 1, 'one accepted';
  perform public.ops_invoice_retry(current_setting('t.other_id')::uuid);
  assert pg_temp.code_of(format('select public.ops_invoice_retry(%L)', current_setting('t.factura_id')))
         = 'invoice_not_retryable', 'an accepted document is not sent again';
end
$$;
reset role;
do $$
begin
  assert (select held_reason is null and next_attempt_at <= now() from public.electronic_invoices
          where id = current_setting('t.other_id')::uuid), 'released to be sent now';
  assert exists (select 1 from private.audit_log where action = 'invoice_retried'), 'in the audit trail';
end
$$;

-- ═══ 6. A rejection: replaced with a new number, never edited ═══════════════

update public.electronic_invoices set next_attempt_at = now() where id = current_setting('t.other_id')::uuid;
select pg_temp.login_worker();
do $$
declare
  v_id uuid := current_setting('t.other_id')::uuid;
  v_answer text := '<MensajeHacienda><Mensaje>3</Mensaje><DetalleMensaje>El codigo de actividad no esta registrado</DetalleMensaje></MensajeHacienda>';
begin
  perform public.worker_invoice_claim('worker-a', 10, 60);
  perform public.worker_invoice_record(v_id, 'worker-a', '{"event": "received", "http_status": 201}');
  update public.electronic_invoices set next_attempt_at = now() where id = v_id;
  perform public.worker_invoice_claim('worker-a', 10, 60);
  assert public.worker_invoice_record(v_id, 'worker-a', jsonb_build_object(
           'event', 'answer', 'state', 'rechazado', 'response_xml', v_answer,
           'response_sha256', encode(extensions.digest(convert_to(v_answer, 'UTF8'), 'sha256'), 'hex'),
           'message', '3', 'detail', 'El codigo de actividad no esta registrado')) = 'rejected', 'rechazado';
end
$$;
reset role;

-- A cancellation of that order now waits: its credit note must reference the replacement.
select pg_temp.remember('rejected_order', (select order_id::text from public.electronic_invoices
                                           where id = current_setting('t.other_id')::uuid));
select private.post_order_refund(current_setting('t.rejected_order')::uuid);
select pg_temp.login_worker();
select pg_temp.remember('planned_waiting', public.worker_invoice_plan(100)::text);
reset role;
do $$
begin
  assert current_setting('t.planned_waiting')::integer = 0, 'the credit note is not made yet';
  assert exists (select 1 from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
                 where j.consumer = 'invoice' and e.topic = 'fiscal.refund_booked' and j.status = 'pending' and j.attempts = 0),
    'its job waits, uncounted';
end
$$;

select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  assert pg_temp.code_of(format('select public.ops_invoice_replace(%L, false)', current_setting('t.other_id'))) = 'forbidden',
    'a seller cannot replace';
end
$$;
reset role;
select pg_temp.allow_inspection();
select pg_temp.login('central@yuntera.example');
do $$
declare
  old public.electronic_invoices := (select e from public.electronic_invoices e where e.id = current_setting('t.other_id')::uuid);
  v jsonb;
  n public.electronic_invoices;
begin
  v := public.ops_invoices(null, 10);
  assert (v -> 'rejected' -> 0 ->> 'hacienda_message') = 'El codigo de actividad no esta registrado',
    'finance reads Hacienda''s reason';
  assert pg_temp.code_of(format('select public.ops_invoice_replace(%L, true)', old.id)) = 'invoice_not_replaceable_as_ticket',
    'a seller''s factura cannot become a tiquete';
  v := public.ops_invoice_replace(old.id, false);
  select * into n from public.electronic_invoices where id = (v ->> 'id')::uuid;
  assert n.consecutivo <> old.consecutivo and n.sequence_number = (select max(sequence_number) from public.electronic_invoices
                                                                  where document_type = '01'), 'a new number, the next one';
  assert n.clave <> old.clave and n.status = 'pending' and n.replaces_id = old.id, 'a new document';
  assert n.refs @> jsonb_build_array(jsonb_build_object('type', '10', 'number', old.clave, 'code', '16')),
    'that references the rejected one: TipoDocIR 10, Codigo 16';
  assert n.lines = old.lines and n.total_minor = old.total_minor, 'for the same amounts';
  assert (select e.status = 'rejected' and e.replaced_by_id = n.id and e.clave = old.clave and e.lines = old.lines
          from public.electronic_invoices e where e.id = old.id), 'the rejected one is left as it was';
  assert pg_temp.code_of(format('select public.ops_invoice_replace(%L, false)', old.id)) = 'invoice_already_replaced',
    'replaced once';
  assert pg_temp.code_of(format('select public.ops_invoice_replace(%L, false)', current_setting('t.factura_id')))
         = 'invoice_not_rejected', 'an accepted document is reversed with a credit note, not replaced';
  perform pg_temp.remember('replacement_id', n.id::text);
end
$$;
reset role;
select pg_temp.stop_inspection();

-- Now the cancellation's credit notes go out, each against the document that stands.
select pg_temp.login_worker();
select public.worker_invoice_plan(100);
reset role;
do $$
declare
  c record;
  v_n integer := 0;
begin
  for c in
    select n.*, o.clave as original_clave, o.document_type as original_type, o.lines as original_lines,
           o.total_minor as original_total, o.receiver as original_receiver, o.issued_at as original_issued
    from public.electronic_invoices n join public.electronic_invoices o on o.id = n.original_invoice_id
    where n.kind = 'credit' and n.order_id = current_setting('t.rejected_order')::uuid
  loop
    v_n := v_n + 1;
    assert c.document_type = '03', 'a nota de crédito';
    assert c.refs -> 0 ->> 'number' = c.original_clave and c.refs -> 0 ->> 'type' = c.original_type
           and c.refs -> 0 ->> 'code' = '01' and (c.refs -> 0 ->> 'issued_at')::timestamptz = c.original_issued,
      'referencing the original''s clave, type and date, code 01 (annuls)';
    assert c.lines = c.original_lines and c.total_minor = c.original_total and c.receiver is not distinct from c.original_receiver,
      'in full, to the same receiver';
    assert c.refund_id is not null, 'tied to the refund';
  end loop;
  assert v_n = (select count(*) from public.electronic_invoices e
                where e.order_id = current_setting('t.rejected_order')::uuid and e.kind in ('delivery', 'fees')
                  and e.replaces_id is null), 'one per document of the order';
  assert exists (select 1 from public.electronic_invoices where kind = 'credit'
                 and original_invoice_id = current_setting('t.replacement_id')::uuid),
    'the fee factura''s credit note references the replacement, not the rejected one';
end
$$;

-- A return: the commission given back, per seller, as the ledger booked it, code 06.
select pg_temp.remember('return_order', (
  select o.id::text from public.orders o
  where o.status = 'delivered' and exists (select 1 from public.electronic_invoices e where e.order_id = o.id and e.kind = 'fees')
    and not exists (select 1 from private.refunds r where r.order_id = o.id)
  order by o.order_number limit 1));
select pg_temp.remember('return_item', (
  select i.id::text from public.order_items i where i.order_id = current_setting('t.return_order')::uuid
  order by i.unit_price_minor desc, i.id limit 1));
select pg_temp.remember('return_tx', (private.refund_units(
  current_setting('t.return_order')::uuid, 'return', gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('order_item_id', current_setting('t.return_item'), 'quantity', 1))) ->> 'refund_id'));
select pg_temp.login_worker();
select public.worker_invoice_plan(100);
reset role;
do $$
declare
  n public.electronic_invoices;
  v_commission bigint;
  v_tax bigint;
begin
  select * into n from public.electronic_invoices
  where kind = 'credit' and refund_id = current_setting('t.return_tx')::uuid;
  assert found, 'a credit note for the return';
  select sum(x.amount_minor) filter (where a.code = 'commission_revenue'),
         sum(x.amount_minor) filter (where a.code = 'iva_payable')
  into v_commission, v_tax
  from private.refunds r join public.ledger_entries x on x.transaction_id = r.ledger_transaction_id
  join public.ledger_accounts a on a.id = x.account_id
  where r.id = current_setting('t.return_tx')::uuid;
  assert (n.lines -> 0 ->> 'total')::numeric * 100 = v_commission, 'the commission the ledger gave back, to the céntimo';
  assert n.total_minor = v_commission + v_tax, 'and its IVA';
  assert jsonb_array_length(n.lines) = 1 and n.lines -> 0 ->> 'unit' = 'Cm', 'one commission line';
  assert n.refs -> 0 ->> 'code' = '06' and n.refs -> 0 ->> 'type' = '01'
         and n.refs -> 0 ->> 'number' = (select clave from public.electronic_invoices where id = n.original_invoice_id),
    'code 06, referencing the seller''s fee factura';
  assert (select receiver_seller_id from public.electronic_invoices where id = n.original_invoice_id) = n.receiver_seller_id,
    'to that seller';
  assert not exists (select 1 from public.electronic_invoices where kind = 'credit'
                     and refund_id = current_setting('t.return_tx')::uuid and receiver_kind = 'shopper'),
    'the delivery fee is not refunded on a return: its document stands';
end
$$;

-- ═══ 7. Who reads what ══════════════════════════════════════════════════════

select pg_temp.remember('fee_doc', (select id::text from public.electronic_invoices
                                    where kind = 'fees' and order_id = current_setting('t.factura_order')::uuid));
select pg_temp.remember('factura_number', (select order_number from public.orders where id = current_setting('t.factura_order')::uuid));
select pg_temp.remember('fee_shop', (select receiver_seller_id::text from public.electronic_invoices where id = current_setting('t.fee_doc')::uuid));
select pg_temp.login('comprador@yuntera.example');
do $$
declare
  v jsonb := public.my_order_invoices(current_setting('t.factura_number'));
begin
  assert jsonb_array_length(v) = 1 and v -> 0 ->> 'id' = current_setting('t.factura_id'), 'the shopper sees their factura';
  assert (v -> 0 ->> 'has_xml')::boolean and (v -> 0 ->> 'has_response')::boolean, 'with both files';
  assert public.invoice_detail(current_setting('t.factura_id')::uuid) ->> 'clave' is not null, 'and opens it';
  assert public.invoice_file(current_setting('t.factura_id')::uuid, 'xml') ->> 'content' like '%firmado%', 'and downloads it';
  assert public.invoice_file(current_setting('t.factura_id')::uuid, 'response') ->> 'file_name' like '%_respuesta.xml',
    'and Hacienda''s answer';
  assert pg_temp.code_of(format('select public.invoice_detail(%L)', current_setting('t.fee_doc'))) = 'invoice_not_found',
    'but not the platform''s invoice to the seller of the same order';
  assert pg_temp.code_of(format('select public.invoice_file(%L, %L)', current_setting('t.fee_doc'), 'xml')) = 'invoice_not_found',
    'nor its file';
end
$$;
reset role;
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert pg_temp.code_of(format('select public.my_order_invoices(%L)', current_setting('t.factura_number'))) = 'order_not_found',
    'another shopper does not find the order';
  assert pg_temp.code_of(format('select public.invoice_detail(%L)', current_setting('t.factura_id'))) = 'invoice_not_found',
    'nor the document';
  assert pg_temp.code_of(format('select public.invoice_file(%L, %L)', current_setting('t.factura_id'), 'xml')) = 'invoice_not_found',
    'nor its file';
end
$$;
reset role;
select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v_shop uuid := current_setting('t.fee_shop')::uuid;
  v jsonb := public.seller_fee_invoices(v_shop, 50);
begin
  assert exists (select 1 from jsonb_array_elements(v) x where x ->> 'id' = current_setting('t.fee_doc')),
    'the shop sees the platform''s invoice for its fees';
  assert public.invoice_detail(current_setting('t.fee_doc')::uuid) -> 'receiver' ->> 'id_number' is not null, 'opens it';
  assert pg_temp.code_of(format('select public.invoice_detail(%L)', current_setting('t.factura_id'))) = 'invoice_not_found',
    'but not the shopper''s factura';
end
$$;
reset role;
select pg_temp.login('cafetal@yuntera.example');
do $$
declare
  v_shop uuid := current_setting('t.fee_shop')::uuid;
begin
  assert pg_temp.code_of(format('select public.seller_fee_invoices(%L, 10)', v_shop)) = 'forbidden',
    'another shop cannot list them';
  assert pg_temp.code_of(format('select public.invoice_detail(%L)', current_setting('t.fee_doc'))) = 'invoice_not_found',
    'nor open one';
end
$$;
reset role;
select pg_temp.login_anon();
do $$
begin
  assert pg_temp.code_of(format('select public.invoice_detail(%L)', current_setting('t.factura_id'))) like 'permission denied%',
    'visitors reach nothing';
  assert pg_temp.code_of(format('select public.my_order_invoices(%L)', current_setting('t.factura_number'))) like 'permission denied%',
    'nothing at all';
end
$$;
reset role;
select pg_temp.login('central@yuntera.example');
do $$
begin
  assert public.invoice_detail(current_setting('t.fee_doc')::uuid) is not null, 'finance opens everything';
  assert public.invoice_detail(current_setting('t.factura_id')::uuid) is not null, 'both kinds';
  assert jsonb_array_length(public.seller_fee_invoices(
    current_setting('t.fee_shop')::uuid, 10)) >= 1,
    'and any shop''s list';
end
$$;
reset role;

-- The second lock: if a SELECT privilege came back by mistake, row-level
-- security would show each person only what the functions show them.
grant select on public.electronic_invoices to authenticated;
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert (select count(*) from public.electronic_invoices where kind = 'fees') = 0, 'a shopper sees no seller''s invoice';
  assert exists (select 1 from public.electronic_invoices where id = current_setting('t.factura_id')::uuid), 'only their own';
  assert not exists (select 1 from public.electronic_invoices e where e.receiver_kind <> 'shopper'), 'nothing else';
end
$$;
reset role;
select pg_temp.login('cafetal@yuntera.example');
do $$
begin
  assert not exists (select 1 from public.electronic_invoices where id = current_setting('t.fee_doc')::uuid),
    'another shop sees nothing of it';
  assert not exists (select 1 from public.electronic_invoices where receiver_kind = 'shopper'), 'nor any shopper''s';
end
$$;
reset role;
revoke select on public.electronic_invoices from authenticated;

rollback;
