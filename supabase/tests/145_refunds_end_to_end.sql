-- One refund of each kind, walked through every piece that touches money
-- going back (docs/04-algorithms/returns-and-refunds.md, "One refund, four
-- pieces"):
--
--   1. the refund register (082900): the refund is booked once, with its
--      ledger entries;
--   2. the gateway refund (083400): its way back, sent once at most, settled
--      once, with the payment's status;
--   3. the recorded confirmation (083200): written once, and the only thing
--      that announces "refund completed", after "refund requested";
--   4. the credit note (083500): planned once per document it reverses,
--      however often the planner runs.
--
-- Kinds: a card in sandbox, cancelled and returned in part; a card and SINPE
-- Móvil through the gateway's test environment; a card in live with one
-- parcel delivered and one back; cash on delivery returned, and refunded at
-- the door; a transfer confirmed by hand and cancelled; live money refunded
-- after the mode went back to sandbox. After each: every ledger transaction
-- sums to zero, what is owed to shoppers equals the refunds not completed,
-- and every seller's balance adds up (check_money).

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

\ir _money_helpers.sql

grant execute on function pg_temp.remember(text, text) to authenticated;

select pg_temp.shopper('devol1@yuntera.example', 'Prueba Devoluciones Uno');
select pg_temp.shopper('devol2@yuntera.example', 'Prueba Devoluciones Dos');

-- ── This suite's own helpers ───────────────────────────────────────────────

-- The invoice planner, as the invoice worker runs it, twice: the second run
-- must find nothing new to make.
create function pg_temp.plan_invoices() returns void
language plpgsql as $$
declare
  v_before integer;
begin
  perform private.invoice_plan(1000);
  perform private.invoice_plan(1000);
  v_before := (select count(*) from public.electronic_invoices);
  perform private.invoice_plan(1000);
  assert (select count(*) from public.electronic_invoices) = v_before, 'a third planning made documents again';
end;
$$;

-- The refund booked for an order (the latest, for orders with two).
create function pg_temp.refund_of(p_order uuid) returns uuid
language sql as $$
  select f.id from private.refunds f where f.order_id = p_order order by f.created_at desc, f.id desc limit 1
$$;

-- What one refund left behind in each of the four pieces.
create function pg_temp.effects(p_refund uuid) returns jsonb
language plpgsql as $$
declare
  f private.refunds;
  g private.gateway_refunds;
  v_requested bigint;
  v_completed bigint;
begin
  -- Deferred work runs as at commit (the confirmation of a simulated refund).
  set constraints all immediate;
  set constraints all deferred;
  select * into f from private.refunds where id = p_refund;
  select * into g from private.gateway_refunds where refund_id = p_refund;
  select min(id) into v_requested from private.outbox_events
  where topic = 'refund.requested' and payload ->> 'refund_id' = p_refund::text;
  select min(id) into v_completed from private.outbox_events
  where topic = 'refund.completed' and payload ->> 'refund_id' = p_refund::text;
  return jsonb_build_object(
    'registered', (select count(*) from private.refunds where id = p_refund),
    'ways_back', (select count(*) from private.gateway_refunds where refund_id = p_refund),
    'channel', g.channel,
    'status', g.status,
    'sent', g.send_count,
    'money_out', (select count(*) from public.ledger_transactions t
                  where t.kind = 'refund_paid' and t.id = g.completion_tx),
    'money_out_all', (select count(*) from public.ledger_transactions t
                      where t.kind = 'refund_paid' and t.order_id = f.order_id
                        and t.id in (select x.completion_tx from private.gateway_refunds x
                                     where x.refund_id = p_refund)),
    'payment', (select p.status from public.payments p where p.order_id = f.order_id
                order by p.created_at limit 1),
    'confirmed', (select count(*) from private.refund_confirmations where refund_id = p_refund),
    'reference', (select reference from private.refund_confirmations where refund_id = p_refund),
    'requested', (select count(*) from private.outbox_events
                  where topic = 'refund.requested' and payload ->> 'refund_id' = p_refund::text),
    'completed', (select count(*) from private.outbox_events
                  where topic = 'refund.completed' and payload ->> 'refund_id' = p_refund::text),
    'in_order', v_completed is null or v_requested is null or v_requested < v_completed,
    'fiscal_events', (select count(*) from private.outbox_events
                      where topic = 'fiscal.refund_booked' and payload ->> 'refund_id' = p_refund::text),
    'credit_notes', (select count(*) from public.electronic_invoices e
                     where e.refund_id = p_refund and e.document_type = '03'));
end;
$$;

-- Asserts that each key given has that value, then that the money adds up.
create function pg_temp.expect(p_label text, p_refund uuid, p_expected jsonb) returns void
language plpgsql as $$
declare
  v jsonb := pg_temp.effects(p_refund);
  k text;
begin
  for k in select jsonb_object_keys(p_expected) loop
    assert v -> k = p_expected -> k,
      format('%s: %s is %s, expected %s (all: %s)', p_label, k, v -> k, p_expected -> k, v);
  end loop;
  perform pg_temp.check_money(p_label);
end;
$$;

-- The credit notes of a refund reverse documents of its own order, one each.
create function pg_temp.credit_notes_match(p_label text, p_refund uuid, p_expected integer) returns void
language plpgsql as $$
declare
  v_order uuid := (select order_id from private.refunds where id = p_refund);
begin
  assert (select count(*) from public.electronic_invoices e
          where e.refund_id = p_refund and e.document_type = '03') = p_expected,
    format('%s: %s credit notes, expected %s', p_label,
           (select count(*) from public.electronic_invoices e where e.refund_id = p_refund), p_expected);
  assert not exists (select 1 from public.electronic_invoices e
                     where e.refund_id = p_refund
                       and (e.order_id <> v_order or e.original_invoice_id is null
                            or (select x.order_id from public.electronic_invoices x
                                where x.id = e.original_invoice_id) <> v_order)),
    format('%s: a credit note reverses another order''s document', p_label);
  assert (select count(*) = count(distinct e.original_invoice_id) from public.electronic_invoices e
          where e.refund_id = p_refund), format('%s: a document credited twice by one refund', p_label);
end;
$$;

-- A card or SINPE Móvil payment through the gateway, in the environment of
-- the current mode: started by the shopper, created by the worker, paid by
-- the gateway's signed notification.
create function pg_temp.gateway_pay(p_email text, p_order uuid, p_payer jsonb default null) returns void
language plpgsql as $$
declare
  v_env text := private.payments_mode();
begin
  perform pg_temp.start(p_email, p_order, p_payer);
  assert pg_temp.create_due() >= 1, 'the worker created the attempt';
  assert pg_temp.apply(jsonb_set(pg_temp.pay_event('evt_pay_' || p_order, 'payment.succeeded', p_order),
                                 '{environment}', to_jsonb(v_env))) = 'applied', 'paid by the gateway';
  assert (select status from public.payments where order_id = p_order) = 'captured', 'captured';
end;
$$;

-- The gateway confirms one refund, twice (webhooks come at least once).
create function pg_temp.gateway_confirms(p_refund uuid) returns void
language plpgsql as $$
declare
  g private.gateway_refunds := (select x from private.gateway_refunds x where x.refund_id = p_refund);
  v_event jsonb;
begin
  v_event := jsonb_set(pg_temp.refund_event('evt_rf_' || g.id, 'refund.succeeded', g.id),
                       '{environment}', to_jsonb(g.environment));
  assert pg_temp.apply(v_event) = 'applied', 'the gateway''s confirmation applies';
  assert pg_temp.apply(v_event) = 'duplicate', 'the same notification again is a duplicate';
  assert pg_temp.apply(jsonb_set(v_event, '{event_id}', to_jsonb('evt_rf2_' || g.id))) = 'duplicate',
    'another notification of the same refund changes nothing';
end;
$$;

-- The gateway's notification of a refund already confirmed: nothing more.
create function pg_temp.gateway_confirms_late(p_refund uuid) returns void
language plpgsql as $$
declare
  g private.gateway_refunds := (select x from private.gateway_refunds x where x.refund_id = p_refund);
begin
  assert pg_temp.apply(jsonb_set(pg_temp.refund_event('evt_rf_late_' || g.id, 'refund.succeeded', g.id),
                                 '{environment}', to_jsonb(g.environment))) = 'duplicate',
    'a late notification of a confirmed refund is a duplicate';
end;
$$;

-- A return of some units of an order's product, decided, received and refunded by staff.
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

-- Finance records the bank transfer that paid a refund back.
create function pg_temp.transfer(p_refund uuid, p_reference text) returns void
language plpgsql as $$
begin
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_record_refund_transfer(
    (select g.id from private.gateway_refunds g where g.refund_id = p_refund), p_reference);
  perform pg_temp.logout();
end;
$$;

-- The documents an order had before a cancellation credits them all.
create function pg_temp.documents(p_order uuid) returns integer
language sql as $$
  select count(*)::integer from public.electronic_invoices e
  where e.order_id = p_order and e.kind in ('delivery', 'fees') and e.replaces_id is null
$$;

select pg_temp.check_money('the seed');
select pg_temp.plan_invoices();

-- ═══ 1. Sandbox: a card, cancelled before packing ═════════════════════════
-- Nothing real moved: the refund settles in its own transaction, and is
-- confirmed and announced at commit, once. A cancellation in sandbox
-- announces no "refund requested" (as before).

select pg_temp.remember('s_cancel', pg_temp.place('devol1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'e2e-s-cancel-01')::text);
select pg_temp.pay(current_setting('t.s_cancel')::uuid);
select pg_temp.plan_invoices();
select pg_temp.remember('s_cancel_docs', pg_temp.documents(current_setting('t.s_cancel')::uuid)::text);
select pg_temp.remember('s_cancel_refund', pg_temp.cancel('devol1@yuntera.example',
  current_setting('t.s_cancel')::uuid)::text);
select pg_temp.plan_invoices();
select pg_temp.expect('sandbox cancellation', current_setting('t.s_cancel_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "simulated", "status": "succeeded", "sent": 0,
  "money_out": 0, "payment": "refunded", "confirmed": 1, "reference": "sandbox",
  "requested": 0, "completed": 1, "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('sandbox cancellation', current_setting('t.s_cancel_refund')::uuid,
  current_setting('t.s_cancel_docs')::integer);
do $$
begin
  assert current_setting('t.s_cancel_docs')::integer >= 2, 'the delivery and the fee documents were made';
  assert (select status from public.orders where id = current_setting('t.s_cancel')::uuid) = 'refunded',
    'sandbox cancellation: the order is refunded';
end
$$;

-- ═══ 2. Sandbox: a card, delivered, one unit of two returned ══════════════

select pg_temp.remember('s_return', pg_temp.place('devol1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'e2e-s-return-01')::text);
select pg_temp.pay(current_setting('t.s_return')::uuid);
select pg_temp.deliver(current_setting('t.s_return')::uuid);
select pg_temp.remember('s_return_refund', pg_temp.return_units('devol1@yuntera.example',
  current_setting('t.s_return')::uuid, 'libreta-tapa-dura-a5', 1)::text);
select pg_temp.plan_invoices();
select pg_temp.expect('sandbox return', current_setting('t.s_return_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "simulated", "status": "succeeded", "sent": 0,
  "money_out": 1, "payment": "partially_refunded", "confirmed": 1, "reference": "sandbox",
  "requested": 1, "completed": 1, "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('sandbox return', current_setting('t.s_return_refund')::uuid, 1);

-- ═══ 3. The gateway's test environment: a card, cancelled ═════════════════
-- Sent once, completed only on the gateway's confirmation (which arrives
-- twice), then confirmed and announced once.

update public.app_settings set value = '"test"' where key = 'payments_mode';
select pg_temp.remember('t_cancel', pg_temp.place('devol2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'e2e-t-cancel-01')::text);
select pg_temp.gateway_pay('devol2@yuntera.example', current_setting('t.t_cancel')::uuid);
select pg_temp.plan_invoices();
select pg_temp.remember('t_cancel_docs', pg_temp.documents(current_setting('t.t_cancel')::uuid)::text);
select pg_temp.remember('t_cancel_refund', pg_temp.cancel('devol2@yuntera.example',
  current_setting('t.t_cancel')::uuid)::text);
select pg_temp.plan_invoices();
-- Booked, owed, not announced: the money has not gone.
select pg_temp.expect('test cancellation, booked', current_setting('t.t_cancel_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "gateway", "status": "requested", "sent": 0,
  "payment": "captured", "confirmed": 0, "requested": 1, "completed": 0, "fiscal_events": 1}');
select pg_temp.credit_notes_match('test cancellation', current_setting('t.t_cancel_refund')::uuid,
  current_setting('t.t_cancel_docs')::integer);
do $$
begin
  assert pg_temp.send_refunds() = 1, 'the worker sends it';
  assert pg_temp.send_refunds() = 0, 'and never again';
end
$$;
select pg_temp.expect('test cancellation, sent', current_setting('t.t_cancel_refund')::uuid, '{
  "status": "sent", "sent": 1, "payment": "captured", "confirmed": 0, "completed": 0}');
select pg_temp.gateway_confirms(current_setting('t.t_cancel_refund')::uuid);
select pg_temp.plan_invoices();
select pg_temp.expect('test cancellation, confirmed', current_setting('t.t_cancel_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "gateway", "status": "succeeded", "sent": 1,
  "money_out": 1, "payment": "refunded", "confirmed": 1, "requested": 1, "completed": 1,
  "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('test cancellation, confirmed', current_setting('t.t_cancel_refund')::uuid,
  current_setting('t.t_cancel_docs')::integer);
do $$
begin
  assert (select status from public.orders where id = current_setting('t.t_cancel')::uuid) = 'refunded',
    'test cancellation: the order is refunded once the money went back';
  assert (select reference from private.refund_confirmations
          where refund_id = current_setting('t.t_cancel_refund')::uuid) like 'rf_%',
    'test cancellation: confirmed with the gateway''s own reference';
end
$$;

-- ═══ 4. The gateway's test environment: SINPE Móvil, returned in part ═════

select pg_temp.remember('t_sinpe', pg_temp.place('devol2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'sinpe_movil', 'e2e-t-sinpe-01')::text);
select pg_temp.gateway_pay('devol2@yuntera.example', current_setting('t.t_sinpe')::uuid,
  '{"kind": "national", "number": "1-1393-1919", "phone": "8888 8888"}');
select pg_temp.deliver(current_setting('t.t_sinpe')::uuid);
select pg_temp.remember('t_sinpe_refund', pg_temp.return_units('devol2@yuntera.example',
  current_setting('t.t_sinpe')::uuid, 'libreta-tapa-dura-a5', 1)::text);
select pg_temp.send_refunds();
select pg_temp.gateway_confirms(current_setting('t.t_sinpe_refund')::uuid);
select pg_temp.plan_invoices();
select pg_temp.expect('test SINPE return', current_setting('t.t_sinpe_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "gateway", "status": "succeeded", "sent": 1,
  "money_out": 1, "payment": "partially_refunded", "confirmed": 1, "requested": 1, "completed": 1,
  "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('test SINPE return', current_setting('t.t_sinpe_refund')::uuid, 1);

-- ═══ 5. Live: a card, one parcel delivered and one back ═══════════════════
-- The order ends delivered (083200); the parcel that came back is refunded
-- through the gateway; its seller's commission is credited.

update public.app_settings set value = '"live"' where key = 'payments_mode';
select pg_temp.remember('l_parcel', pg_temp.place('devol1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1', 'bombillo-led-9w-4u:1'), 'card', 'e2e-l-parcel-01')::text);
select pg_temp.gateway_pay('devol1@yuntera.example', current_setting('t.l_parcel')::uuid);
do $$
declare
  v_order uuid := current_setting('t.l_parcel')::uuid;
  v_platform uuid := pg_temp.shipment(v_order, 'platform');
  v_seller uuid := pg_temp.shipment(v_order, 'seller');
  v_route uuid;
  v_result jsonb;
begin
  perform pg_temp.pack(v_platform);
  perform pg_temp.pack(v_seller);
  v_route := pg_temp.route(v_platform, v_seller);
  v_result := pg_temp.door(pg_temp.stop(v_route, v_platform), pg_temp.code(v_order));
  assert (v_result ->> 'ok')::boolean, format('live parcel: delivered %s', v_result);
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_seller), 'nobody_home');
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_seller);
  perform pg_temp.act('vendedor@yuntera.example');
  v_result := public.wms_receive_returned_shipment(v_seller, true, null);
  perform pg_temp.logout();
  assert v_result ->> 'order_status' = 'delivered', format('live parcel: the order ends delivered %s', v_result);
end
$$;
select pg_temp.remember('l_parcel_refund', pg_temp.refund_of(current_setting('t.l_parcel')::uuid)::text);
do $$
begin
  assert (select reason from private.refunds where id = current_setting('t.l_parcel_refund')::uuid)
         = 'parcel_returned', 'live parcel: the refund is for the parcel that came back';
end
$$;
select pg_temp.send_refunds();
select pg_temp.gateway_confirms(current_setting('t.l_parcel_refund')::uuid);
select pg_temp.plan_invoices();
select pg_temp.expect('live parcel back', current_setting('t.l_parcel_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "gateway", "status": "succeeded", "sent": 1,
  "money_out": 1, "payment": "partially_refunded", "confirmed": 1, "requested": 1, "completed": 1,
  "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('live parcel back', current_setting('t.l_parcel_refund')::uuid, 1);
do $$
begin
  -- Only the seller whose parcel came back is credited.
  assert (select e.receiver_seller_id from public.electronic_invoices e
          where e.refund_id = current_setting('t.l_parcel_refund')::uuid)
         = (select i.seller_id from public.order_items i
            where i.id = pg_temp.item(current_setting('t.l_parcel')::uuid, 'bombillo-led-9w-4u')),
    'live parcel: the credit note is to the seller of the returned parcel';
end
$$;

-- ═══ 6. Live: cash on delivery, the goods returned ═══════════════════════
-- No gateway can send cash back: finance pays it by transfer and records it.
-- The delivery fee is not refunded for a return, so the payment ends
-- partially refunded.

select pg_temp.remember('l_cod', pg_temp.place('devol2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'e2e-l-cod-01')::text);
select pg_temp.deliver(current_setting('t.l_cod')::uuid);
select pg_temp.remember('l_cod_refund', pg_temp.return_units('devol2@yuntera.example',
  current_setting('t.l_cod')::uuid, 'libreta-tapa-dura-a5', 1)::text);
select pg_temp.expect('live cash, booked', current_setting('t.l_cod_refund')::uuid, '{
  "channel": "transfer", "status": "requested", "payment": "captured", "confirmed": 0, "completed": 0}');
do $$
begin
  assert pg_temp.send_refunds() = 0, 'live cash: the worker never sends a transfer refund';
end
$$;
select pg_temp.transfer(current_setting('t.l_cod_refund')::uuid, 'BNCR-145001');
select pg_temp.plan_invoices();
select pg_temp.expect('live cash, paid back', current_setting('t.l_cod_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "transfer", "status": "succeeded", "sent": 0,
  "money_out": 1, "payment": "partially_refunded", "confirmed": 1, "reference": "BNCR-145001",
  "requested": 1, "completed": 1, "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('live cash', current_setting('t.l_cod_refund')::uuid, 1);
do $$
begin
  assert (select count(*) from public.ledger_entries e
          where e.transaction_id = (select g.completion_tx from private.gateway_refunds g
                                    where g.refund_id = current_setting('t.l_cod_refund')::uuid)
            and e.account_id = private.ledger_account('bank_operating')) = 1,
    'live cash: the money left the bank account';
end
$$;
-- Recording it again is refused, and changes nothing.
select pg_temp.act('central@yuntera.example');
select pg_temp.refused(format('select public.ops_record_refund_transfer(%L, ''BNCR-145001'')',
  (select g.id from private.gateway_refunds g where g.refund_id = current_setting('t.l_cod_refund')::uuid)),
  'gateway_refund_state');
select pg_temp.logout();
select pg_temp.expect('live cash, recorded twice', current_setting('t.l_cod_refund')::uuid, '{
  "money_out_all": 1, "confirmed": 1, "completed": 1}');

-- ═══ 7. Live: a transfer confirmed by hand, cancelled ═════════════════════

select pg_temp.remember('l_bank', pg_temp.place('devol1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'bank_transfer', 'e2e-l-bank-01')::text);
select pg_temp.act('central@yuntera.example');
select public.ops_confirm_payment(current_setting('t.l_bank')::uuid, 'BCR-145777');
select pg_temp.logout();
select pg_temp.plan_invoices();
select pg_temp.remember('l_bank_docs', pg_temp.documents(current_setting('t.l_bank')::uuid)::text);
select pg_temp.remember('l_bank_refund', pg_temp.cancel('devol1@yuntera.example',
  current_setting('t.l_bank')::uuid)::text);
select pg_temp.expect('live transfer, booked', current_setting('t.l_bank_refund')::uuid, '{
  "channel": "transfer", "status": "requested", "payment": "captured", "confirmed": 0,
  "requested": 1, "completed": 0}');
select pg_temp.transfer(current_setting('t.l_bank_refund')::uuid, 'BCR-145778');
select pg_temp.plan_invoices();
select pg_temp.expect('live transfer, paid back', current_setting('t.l_bank_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "channel": "transfer", "status": "succeeded", "sent": 0,
  "money_out": 1, "payment": "refunded", "confirmed": 1, "requested": 1, "completed": 1,
  "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('live transfer', current_setting('t.l_bank_refund')::uuid,
  current_setting('t.l_bank_docs')::integer);

-- ═══ 8. Live: cash on delivery, a parcel back before the other arrives ═══
-- The driver collects less at the door: nothing to send, so the refund is
-- confirmed silently (no "refund completed" for money never paid) and the
-- seller's commission is credited.

select pg_temp.remember('l_door', pg_temp.place('devol2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1', 'bombillo-led-9w-4u:1'), 'cash_on_delivery', 'e2e-l-door-01')::text);
do $$
declare
  v_order uuid := current_setting('t.l_door')::uuid;
  v_platform uuid := pg_temp.shipment(v_order, 'platform');
  v_seller uuid := pg_temp.shipment(v_order, 'seller');
  v_route uuid;
  v_result jsonb;
begin
  perform pg_temp.pack(v_platform);
  perform pg_temp.pack(v_seller);
  v_route := pg_temp.route(v_platform, v_seller);
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_seller), 'nobody_home');
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_seller);
  perform pg_temp.act('vendedor@yuntera.example');
  perform public.wms_receive_returned_shipment(v_seller, true, null);
  perform pg_temp.logout();
  v_result := pg_temp.door(pg_temp.stop(v_route, v_platform), pg_temp.code(v_order));
  assert (v_result ->> 'ok')::boolean, format('at the door: delivered %s', v_result);
end
$$;
select pg_temp.plan_invoices();
select pg_temp.remember('l_door_refund', coalesce(pg_temp.refund_of(current_setting('t.l_door')::uuid)::text, ''));
do $$
begin
  assert current_setting('t.l_door_refund') <> '', 'at the door: the parcel back is in the register';
end
$$;
select pg_temp.expect('at the door', current_setting('t.l_door_refund')::uuid, '{
  "registered": 1, "ways_back": 0, "money_out": 0, "confirmed": 1, "reference": "at_door",
  "requested": 0, "completed": 0, "fiscal_events": 1}');

-- ═══ 9. Live money, refunded after the mode went back to sandbox ══════════
-- Leaving live does not make real money simulated: it goes back by transfer.

select pg_temp.remember('l_left', pg_temp.place('devol1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'e2e-l-left-01')::text);
select pg_temp.gateway_pay('devol1@yuntera.example', current_setting('t.l_left')::uuid);
select pg_temp.deliver(current_setting('t.l_left')::uuid);
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
select pg_temp.remember('l_left_refund', pg_temp.return_units('devol1@yuntera.example',
  current_setting('t.l_left')::uuid, 'libreta-tapa-dura-a5', 2)::text);
select pg_temp.expect('live money in sandbox, booked', current_setting('t.l_left_refund')::uuid, '{
  "channel": "transfer", "status": "requested", "payment": "captured", "confirmed": 0, "completed": 0}');
select pg_temp.transfer(current_setting('t.l_left_refund')::uuid, 'BNCR-145002');
select pg_temp.plan_invoices();
select pg_temp.expect('live money in sandbox, paid back', current_setting('t.l_left_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "status": "succeeded", "money_out": 1, "payment": "partially_refunded",
  "confirmed": 1, "requested": 1, "completed": 1, "in_order": true, "fiscal_events": 1}');
select pg_temp.credit_notes_match('live money in sandbox', current_setting('t.l_left_refund')::uuid, 1);

-- ═══ 10. One confirmation, whichever door it comes through ════════════════
-- The confirmation recorded directly (as decision 34 lets a server-side
-- handler do) settles the open gateway refund first; the gateway's own
-- notification afterwards changes nothing.

update public.app_settings set value = '"test"' where key = 'payments_mode';
select pg_temp.remember('t_direct', pg_temp.place('devol2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'e2e-t-direct-01')::text);
select pg_temp.gateway_pay('devol2@yuntera.example', current_setting('t.t_direct')::uuid);
select pg_temp.remember('t_direct_refund', pg_temp.cancel('devol2@yuntera.example',
  current_setting('t.t_direct')::uuid)::text);
select pg_temp.send_refunds();
do $$
begin
  assert private.confirm_refund(current_setting('t.t_direct_refund')::uuid, 'banco-dice-ok'),
    'direct confirmation';
  assert not private.confirm_refund(current_setting('t.t_direct_refund')::uuid, 'banco-dice-ok'),
    'a second confirmation does nothing';
end
$$;
select pg_temp.gateway_confirms_late(current_setting('t.t_direct_refund')::uuid);
select pg_temp.expect('direct confirmation', current_setting('t.t_direct_refund')::uuid, '{
  "registered": 1, "ways_back": 1, "status": "succeeded", "money_out_all": 1, "payment": "refunded",
  "confirmed": 1, "reference": "banco-dice-ok", "requested": 1, "completed": 1, "in_order": true}');
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';

-- ═══ 11. Simulated money on a real project: no documents at all ═══════════
-- With invoicing_policy.simulated_payments false (every real project), an
-- order paid in sandbox gets no document, its job is done, and its
-- cancellation has nothing to credit; real money is documented as before.

update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'false')
where key = 'invoicing_policy';
select pg_temp.remember('s_real', pg_temp.place('devol1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'e2e-s-real-01')::text);
select pg_temp.pay(current_setting('t.s_real')::uuid);
select pg_temp.plan_invoices();
select pg_temp.remember('s_real_refund', pg_temp.cancel('devol1@yuntera.example',
  current_setting('t.s_real')::uuid)::text);
select pg_temp.plan_invoices();
do $$
begin
  assert pg_temp.documents(current_setting('t.s_real')::uuid) = 0, 'simulated money: no document';
  assert not exists (select 1 from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
                     where j.consumer = 'invoice' and j.status <> 'done'
                       and e.payload ->> 'order_id' = current_setting('t.s_real')), 'and no job left waiting';
  assert not exists (select 1 from public.electronic_invoices
                     where refund_id = current_setting('t.s_real_refund')::uuid), 'nothing to credit';
end
$$;
select pg_temp.expect('simulated money, not documented', current_setting('t.s_real_refund')::uuid, '{
  "registered": 1, "channel": "simulated", "confirmed": 1, "completed": 1, "credit_notes": 0}');
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'true')
where key = 'invoicing_policy';

select pg_temp.check_money('the end');
select 'ok' as refunds_end_to_end;
rollback;
