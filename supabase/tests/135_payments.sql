-- Payments through the gateway (20261121083400_payments.sql).
--
-- Who may call each function; the modes and their audited change; a card
-- payment applied once whatever arrives twice, in either order or late; a
-- decline and a new attempt; SINPE Movil with the payer's identification;
-- money that does not match kept for finance and settled by them; a payment
-- racing the order's expiry; paid twice; refunds requested, sent once and
-- completed only when the gateway confirms, partial, failed, retried, with a
-- lost answer, and by transfer for cash on delivery; fees; live mode without
-- the simulation. After each block: the ledger balanced, refunds within what
-- was collected, what is owed to shoppers equal to the refunds not completed,
-- and every seller's balance adding up. Real concurrency (two sessions at
-- once) is in packages/db/src/contract.payments.test.ts.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

-- ── Fixtures, as in 115_integrity.sql ──────────────────────────────────────

create function pg_temp.logout() returns void
language sql as $$ select set_config('request.jwt.claims', '', true) $$;

-- Runs a statement that must be refused with the given code. A refusal by the
-- grants (permission denied) is accepted where p_code is 'forbidden', so the
-- suite holds whether or not direct table privileges have been removed.
create function pg_temp.refused(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception
  when insufficient_privilege then
    if p_code <> 'forbidden' then
      raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
    end if;
  when others then
    if sqlerrm <> p_code and sqlstate <> p_code then
      raise exception 'expected % but got "%" (%) for: %', p_code, sqlerrm, sqlstate, p_sql;
    end if;
end;
$$;
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.refused(text, text) to authenticated, anon;

-- ── Fixtures ───────────────────────────────────────────────────────────────

-- A new shopper with the demo shopper's address as their own default.
create function pg_temp.shopper(p_email text, p_name text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  -- auth.users.id has no default on a hosted project (only in the local shim).
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), p_email, jsonb_build_object('full_name', p_name)) returning id into v_id;
  insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
  select v_id, 'Casa', p_name, a.phone, a.postal_code, a.senas, a.lat, a.lng, true
  from public.addresses a join auth.users u on u.id = a.user_id
  where u.email = 'comprador@yuntera.example' and a.is_default;
  return v_id;
end;
$$;

-- Acts as a user for setup steps (the claims only; the role stays superuser).
create function pg_temp.act(p_email text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'role', 'authenticated')::text, true);
end;
$$;

-- 'slug:quantity' lines as place_order items.
create function pg_temp.items(variadic p_lines text[]) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('offer_id', pg_temp.offer(split_part(l, ':', 1)),
                                      'quantity', split_part(l, ':', 2)::integer))
  from unnest(p_lines) l
$$;

create function pg_temp.place(p_email text, p_items jsonb, p_method public.payment_method, p_key text)
returns uuid
language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.act(p_email);
  v_result := public.place_order(p_items,
    (select a.id from public.addresses a join auth.users u on u.id = a.user_id
     where u.email = p_email and a.is_default and a.deleted_at is null),
    p_method, p_key);
  perform pg_temp.logout();
  return (v_result ->> 'order_id')::uuid;
end;
$$;

create function pg_temp.pay(p_order uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select user_id from public.orders where id = p_order), 'role', 'authenticated')::text, true);
  perform public.confirm_sandbox_payment(p_order);
  perform pg_temp.logout();
end;
$$;

create function pg_temp.item(p_order uuid, p_slug text) returns uuid
language sql as $$
  select i.id from public.order_items i join public.products p on p.id = i.product_id
  where i.order_id = p_order and p.slug = p_slug
$$;

create function pg_temp.shipment(p_order uuid, p_kind public.warehouse_kind) returns uuid
language sql as $$
  select s.id from public.shipments s join public.warehouses w on w.id = s.origin_warehouse_id
  where s.order_id = p_order and w.kind = p_kind order by s.created_at, s.id limit 1
$$;

-- Picks and packs a parcel: the warehouse's as operations staff, a seller's as its member.
create function pg_temp.pack(p_shipment uuid) returns void
language plpgsql as $$
declare
  v_kind public.warehouse_kind;
  t record;
begin
  select w.kind into v_kind from public.shipments s join public.warehouses w on w.id = s.origin_warehouse_id
  where s.id = p_shipment;
  if v_kind = 'platform' then
    perform pg_temp.act('central@yuntera.example');
    perform public.wms_start_picking(p_shipment);
    for t in select id, quantity from public.pick_tasks where shipment_id = p_shipment loop
      perform public.wms_confirm_pick(t.id, t.quantity);
    end loop;
    perform public.wms_pack_shipment(p_shipment, 900, 1::smallint);
  else
    perform pg_temp.act('vendedor@yuntera.example');
    perform public.seller_mark_packed(p_shipment, 900, 1::smallint);
  end if;
  perform pg_temp.logout();
end;
$$;

-- A route for the demo driver with the given parcels, started.
create function pg_temp.route(variadic p_shipments uuid[]) returns uuid
language plpgsql as $$
declare
  v_route uuid;
begin
  perform pg_temp.act('central@yuntera.example');
  v_route := public.ops_create_route(
    private.cr_local(now())::date, (select id from public.warehouses where code = 'SJO1'),
    (select jsonb_agg(jsonb_build_object('shipment_id', s, 'sequence', n) order by n)
     from unnest(p_shipments) with ordinality as x (s, n)),
    (select d.id from public.drivers d join auth.users u on u.id = d.user_id
     where u.email = 'repartidor@yuntera.example'));
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_start_route(v_route);
  perform pg_temp.logout();
  return v_route;
end;
$$;

create function pg_temp.stop(p_route uuid, p_shipment uuid) returns uuid
language sql as $$
  select id from public.route_stops where route_id = p_route and shipment_id = p_shipment
$$;

-- The code the shopper would read out, taken from where it is kept.
create function pg_temp.code(p_order uuid) returns text
language sql as $$ select code from private.delivery_codes where order_id = p_order $$;

create function pg_temp.door(p_stop uuid, p_code text) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.act('repartidor@yuntera.example');
  v_result := public.driver_complete_stop(p_stop, p_code, 'Recibe Prueba',
    (select cod_amount_minor from public.route_stops where id = p_stop));
  perform pg_temp.logout();
  return v_result;
end;
$$;

-- Packs, routes and delivers every parcel of an order.
create function pg_temp.deliver(p_order uuid) returns void
language plpgsql as $$
declare
  v_shipments uuid[];
  v_route uuid;
  s uuid;
  v_result jsonb;
begin
  select array_agg(id order by created_at, id) into v_shipments
  from public.shipments where order_id = p_order and status = 'pending';
  foreach s in array v_shipments loop
    perform pg_temp.pack(s);
  end loop;
  v_route := pg_temp.route(variadic v_shipments);
  foreach s in array v_shipments loop
    v_result := pg_temp.door(pg_temp.stop(v_route, s), pg_temp.code(p_order));
    if not (v_result ->> 'ok')::boolean then
      raise exception 'delivery failed: %', v_result;
    end if;
  end loop;
end;
$$;

-- Moves a return through decision and receipt as central, ready for its refund.
create function pg_temp.receive(p_return uuid) returns void
language plpgsql as $$
begin
  perform pg_temp.act('central@yuntera.example');
  if (select status from public.return_requests where id = p_return) = 'requested' then
    perform public.ops_decide_return(p_return, true, null);
  end if;
  perform public.ops_receive_return(p_return, true, null);
  perform pg_temp.logout();
end;
$$;

-- ── This suite's own helpers ───────────────────────────────────────────────

-- The payments worker: its claims make the request the service_role, as its
-- secret key does through the Data API. (The role itself stays superuser for
-- setup; block A checks that the API roles cannot call these functions.)
create function pg_temp.work() returns void
language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;

create function pg_temp.last_attempt(p_order uuid) returns private.payment_attempts
language sql as $$
  select a from private.payment_attempts a where a.order_id = p_order order by a.created_at desc, a.id limit 1
$$;

-- A payment event as the adapter normalises it, about the order's latest attempt.
create function pg_temp.pay_event(
  p_event_id text,
  p_type text,
  p_order uuid,
  p_amount bigint default null,
  p_currency text default 'CRC',
  p_updated timestamptz default now(),
  p_with_session boolean default true
) returns jsonb
language plpgsql as $$
declare
  a private.payment_attempts;
begin
  a := pg_temp.last_attempt(p_order);
  return jsonb_build_object(
    'provider', 'onvo', 'event_id', p_event_id, 'source', 'webhook', 'environment', 'test',
    'type', p_type, 'provider_type', 'test.' || p_type, 'occurred_at', p_updated,
    'payment', jsonb_build_object(
      'reference', a.intent_reference,
      'session_reference', case when p_with_session then a.session_reference end,
      'status', p_type, 'amount_minor', coalesce(p_amount, a.amount_minor), 'currency', p_currency,
      'updated_at', p_updated,
      'failure_code', case when p_type = 'payment.failed' then 'declined' end,
      'fee_minor', case when p_type = 'payment.succeeded' then 84000 end,
      'metadata', '{}'::jsonb));
end;
$$;

create function pg_temp.apply(p_event jsonb) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.work();
  v := public.worker_payments_event(p_event);
  perform pg_temp.logout();
  return v;
end;
$$;

create function pg_temp.claim() returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.work();
  v := public.worker_payments_claim('test-worker', 50, 60);
  perform pg_temp.logout();
  return v;
end;
$$;

create function pg_temp.report(p_report jsonb) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.work();
  v := public.worker_payments_report('test-worker', p_report);
  perform pg_temp.logout();
  return v;
end;
$$;

-- Plays the worker for every create task due: the gateway answers as ONVO does.
create function pg_temp.create_due() returns integer
language plpgsql as $$
declare
  t jsonb;
  n integer := 0;
begin
  for t in select jsonb_array_elements(pg_temp.claim()) loop
    if t ->> 'kind' = 'create' then
      perform pg_temp.report(jsonb_build_object(
        'kind', 'created', 'attempt_id', t ->> 'attempt_id', 'outcome', 'created',
        'session_reference', case when t ->> 'method' = 'card' then 'cs_' || left(t ->> 'attempt_id', 8) end,
        'intent_reference', 'pi_' || left(t ->> 'attempt_id', 8),
        'checkout_url', case when t ->> 'method' = 'card'
                             then 'https://checkout.onvopay.com/pay/cs_' || left(t ->> 'attempt_id', 8) end,
        'sinpe_destination', case when t ->> 'method' = 'sinpe_movil' then '+50670196686' end,
        'status', case when t ->> 'method' = 'sinpe_movil' then 'processing' else 'open' end));
      n := n + 1;
    else
      -- Anything else claimed here is released for the block that tests it.
      if t ? 'attempt_id' then
        perform pg_temp.report(jsonb_build_object('kind', 'release_attempt', 'attempt_id', t ->> 'attempt_id',
                                                  'retry_after_seconds', 0));
      else
        perform pg_temp.report(jsonb_build_object('kind', 'release_refund',
          'gateway_refund_id', t ->> 'gateway_refund_id', 'retry_after_seconds', 0));
      end if;
    end if;
  end loop;
  return n;
end;
$$;

create function pg_temp.start(p_email text, p_order uuid, p_payer jsonb default null) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.act(p_email);
  v := public.start_payment(p_order, p_payer);
  perform pg_temp.logout();
  return v;
end;
$$;

create function pg_temp.refund_event(p_event_id text, p_type text, p_refund uuid, p_amount bigint default null)
returns jsonb
language sql as $$
  select jsonb_build_object(
    'provider', 'onvo', 'event_id', p_event_id, 'source', 'webhook', 'environment', 'test',
    'type', p_type, 'provider_type', 'test.' || p_type, 'occurred_at', now(),
    'refund', jsonb_build_object(
      'reference', g.provider_refund_reference, 'payment_reference', g.payment_reference,
      'status', p_type, 'amount_minor', coalesce(p_amount, g.amount_minor), 'currency', 'CRC',
      'updated_at', now(), 'failure_code', case when p_type = 'refund.failed' then 'declined' end))
  from private.gateway_refunds g where g.id = p_refund
$$;

-- Plays the worker for every refund task due: ONVO accepts the refund.
create function pg_temp.send_refunds() returns integer
language plpgsql as $$
declare
  t jsonb;
  n integer := 0;
begin
  for t in select jsonb_array_elements(pg_temp.claim()) loop
    if t ->> 'kind' = 'refund' then
      perform pg_temp.report(jsonb_build_object(
        'kind', 'refund_sent', 'gateway_refund_id', t ->> 'gateway_refund_id', 'outcome', 'accepted',
        'provider_refund_reference', 'rf_' || left(t ->> 'gateway_refund_id', 8), 'status', 'pending'));
      n := n + 1;
    elsif t ? 'attempt_id' then
      perform pg_temp.report(jsonb_build_object('kind', 'release_attempt', 'attempt_id', t ->> 'attempt_id',
                                                'retry_after_seconds', 3600));
    else
      perform pg_temp.report(jsonb_build_object('kind', 'release_refund',
        'gateway_refund_id', t ->> 'gateway_refund_id', 'retry_after_seconds', 3600));
    end if;
  end loop;
  return n;
end;
$$;

create function pg_temp.order_refund(p_order uuid) returns uuid
language sql as $$
  select g.id from private.gateway_refunds g where g.order_id = p_order order by g.requested_at desc, g.id limit 1
$$;

-- What must hold after every block: each ledger transaction sums to zero;
-- every refund in the ledger is in the register; no order got back more than
-- was collected; what is owed to shoppers (refunds_payable) is exactly the
-- refunds not yet completed; and each seller's available + pending + in
-- transit is their ledger balance.
create function pg_temp.check_money(p_label text) returns void
language plpgsql as $$
declare
  v_bad text;
  v_owed bigint;
  v_open bigint;
begin
  set constraints all immediate;
  set constraints all deferred;
  select string_agg(transaction_id::text, ', ') into v_bad from (
    select transaction_id from public.ledger_entries group by transaction_id having sum(amount_minor) <> 0) x;
  assert v_bad is null, format('%s: unbalanced ledger transactions %s', p_label, v_bad);
  select string_agg(t.id::text, ', ') into v_bad from public.ledger_transactions t
  where t.kind in ('order_refund', 'return_refund')
    and not exists (select 1 from private.refunds r where r.ledger_transaction_id = t.id);
  assert v_bad is null, format('%s: refunds outside the register %s', p_label, v_bad);
  select string_agg(o.order_number, ', ') into v_bad from public.orders o
  where private.refunded_minor(o.id) > private.order_collected_minor(o.id);
  assert v_bad is null, format('%s: refunded more than collected: %s', p_label, v_bad);
  select string_agg(o.order_number, ', ') into v_bad from public.orders o
  where (select coalesce(sum(g.amount_minor), 0) from private.gateway_refunds g
         where g.order_id = o.id and g.refund_id is not null and g.status = 'succeeded')
        > private.order_collected_minor(o.id);
  assert v_bad is null, format('%s: completed more refunds than collected: %s', p_label, v_bad);

  select -coalesce(sum(e.amount_minor), 0) into v_owed from public.ledger_entries e
  where e.account_id = private.ledger_account('refunds_payable');
  select coalesce(sum(g.amount_minor), 0) into v_open from private.gateway_refunds g
  where g.refund_id is not null and g.status <> 'succeeded';
  assert v_owed = v_open, format('%s: owed to shoppers %s, refunds not completed %s', p_label, v_owed, v_open);

  select string_agg(b.seller_id::text, ', ') into v_bad
  from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days()) b
  where b.available_minor + b.pending_minor + b.in_transit_minor <> b.payable_minor
     or b.payable_minor <> (select coalesce(-sum(e.amount_minor), 0) from public.ledger_entries e
                            join public.ledger_accounts a on a.id = e.account_id where a.seller_id = b.seller_id);
  assert v_bad is null, format('%s: seller balances do not add up: %s', p_label, v_bad);
end;
$$;

grant execute on function pg_temp.remember(text, text) to authenticated;

select pg_temp.shopper('pagos1@yuntera.example', 'Prueba Pagos Uno');
select pg_temp.shopper('pagos2@yuntera.example', 'Prueba Pagos Dos');
select pg_temp.shopper('pagos-finanzas@yuntera.example', 'Prueba Finanzas');
select pg_temp.shopper('pagos-soporte@yuntera.example', 'Prueba Soporte');
insert into public.staff_members (user_id, role)
select id, 'finance' from auth.users where email = 'pagos-finanzas@yuntera.example';
insert into public.staff_members (user_id, role)
select id, 'support' from auth.users where email = 'pagos-soporte@yuntera.example';

select pg_temp.check_money('the seed');

-- ═══ A. Who may call what ══════════════════════════════════════════════════

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.worker_payments_hello(text, text, text, boolean, boolean)',
    'public.worker_payments_claim(text, integer, integer)',
    'public.worker_payments_report(text, jsonb)',
    'public.worker_payments_event(jsonb)'] loop
    assert has_function_privilege('service_role', f, 'execute'), f || ' for the worker';
    assert not has_function_privilege('authenticated', f, 'execute'), f || ' not for signed-in users';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not for visitors';
  end loop;
  foreach f in array array[
    'public.order_payment(text)', 'public.start_payment(uuid, jsonb, text)',
    'public.payment_returned(uuid)', 'public.ops_payment_reviews(boolean)',
    'public.ops_resolve_payment_review(uuid, text, text, text)', 'public.ops_gateway_refunds(boolean)',
    'public.ops_retry_gateway_refund(uuid)', 'public.ops_record_refund_transfer(uuid, text, text)',
    'public.ops_record_payment_fee(uuid, bigint, text)', 'public.ops_payments(date, integer)',
    'public.ops_payment_reconciliation(date)', 'public.ops_payment_settings()',
    'public.ops_set_payments_mode(text, text)',
    'public.ops_set_expected_gateway_fee(public.payment_method, integer, bigint, text)'] loop
    assert has_function_privilege('authenticated', f, 'execute'), f || ' for signed-in users';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not for visitors';
  end loop;
end
$$;

-- A signed-in shopper, even one who forges the worker's claim, is refused.
select pg_temp.login('pagos1@yuntera.example');
select pg_temp.refused('select public.worker_payments_claim(''x'', 1, 60)', 'forbidden');
select pg_temp.refused('select public.worker_payments_event(''{}''::jsonb)', 'forbidden');
select pg_temp.refused('select public.ops_payment_reviews(true)', 'forbidden');
select pg_temp.refused('select public.ops_set_payments_mode(''live'', ''sin razón válida'')', 'forbidden');
reset role;
select pg_temp.login_anon();
select pg_temp.refused('select public.order_payment(''YT-100001'')', 'forbidden');
select pg_temp.refused('select public.worker_payments_hello(''onvo'', ''test'', null, true, true)', 'forbidden');
reset role;
-- Support staff cannot work on finance's screens.
select pg_temp.login('pagos-soporte@yuntera.example');
select pg_temp.refused('select public.ops_gateway_refunds(true)', 'forbidden');
select pg_temp.refused('select public.ops_payment_reconciliation(null)', 'forbidden');
reset role;
-- The worker's functions check the caller themselves too, whatever the grant.
select pg_temp.act('pagos1@yuntera.example');
select pg_temp.refused('select public.worker_payments_claim(''x'', 1, 60)', 'worker_only');
select pg_temp.logout();

-- ═══ B. Modes ══════════════════════════════════════════════════════════════

select pg_temp.refused('update public.app_settings set value = ''"prueba"'' where key = ''payments_mode''',
                       'payments_mode_invalid');
select pg_temp.refused('select public.start_payment(gen_random_uuid())', 'order_not_found');

-- In sandbox the gateway is not used: a shopper cannot start a payment there.
select pg_temp.remember('sandbox_order', pg_temp.place('pagos1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'pay-sandbox-0001')::text);
select pg_temp.act('pagos1@yuntera.example');
select pg_temp.refused(format('select public.start_payment(%L)', current_setting('t.sandbox_order')),
                       'gateway_not_in_use');
do $$
begin
  assert public.order_payment((select order_number from public.orders
                               where id = current_setting('t.sandbox_order')::uuid)) ->> 'stage' = 'simulated',
    'sandbox keeps the simulation';
end
$$;
select pg_temp.logout();

-- Only an administrator, with a reason, and only to an environment the worker
-- reported ready a few minutes ago. (A local stack's worker may have reported
-- already; this suite starts from no report.)
delete from private.payment_gateway_status;
select pg_temp.login('pagos-finanzas@yuntera.example');
select pg_temp.refused('select public.ops_set_payments_mode(''test'', ''Probar la pasarela'')', 'forbidden');
reset role;
select pg_temp.login('central@yuntera.example');
select pg_temp.refused('select public.ops_set_payments_mode(''test'', ''corto'')', 'payments_mode_note_required');
select pg_temp.refused('select public.ops_set_payments_mode(''test'', ''Probar la pasarela de pagos'')',
                       'payments_provider_not_ready');
select pg_temp.refused('select public.ops_set_payments_mode(''otro'', ''Probar la pasarela de pagos'')',
                       'payments_mode_invalid');
reset role;

-- A worker with a live key but no webhook secret is not ready either.
select pg_temp.work();
select public.worker_payments_hello('onvo', 'test', 'acct_1', true, false) ->> 'active' as not_active_in_sandbox;
select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select pg_temp.refused('select public.ops_set_payments_mode(''test'', ''Probar la pasarela de pagos'')',
                       'payments_provider_not_ready');
reset role;
select pg_temp.work();
select public.worker_payments_hello('onvo', 'test', 'acct_1', true, true);
select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select public.ops_set_payments_mode('test', 'Probar la pasarela de pagos') ->> 'mode' as now_test;
reset role;
do $$
begin
  assert private.payments_mode() = 'test', 'the mode changed';
  assert exists (select 1 from private.audit_log where table_name = 'payments_mode'
                 and new_row ->> 'mode' = 'test' and new_row ->> 'note' = 'Probar la pasarela de pagos'
                 and old_row ->> 'mode' = 'sandbox'), 'with its reason in the audit trail';
  assert exists (select 1 from private.audit_log where table_name = 'app_settings' and row_key = 'payments_mode'),
    'and the setting''s own change';
end
$$;

-- The simulation is gone: neither the shopper nor staff can use it.
select pg_temp.act('pagos1@yuntera.example');
select pg_temp.refused(format('select public.confirm_sandbox_payment(%L)', current_setting('t.sandbox_order')),
                       'sandbox_disabled');
select pg_temp.logout();

-- ═══ C. A card payment: duplicates, two kinds of event, reordering ═════════

select pg_temp.remember('card', pg_temp.place('pagos1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'pay-card-0001')::text);
do $$
declare
  p public.payments;
begin
  select * into p from public.payments where order_id = current_setting('t.card')::uuid;
  assert p.provider = 'onvo' and p.environment = 'test', format('the gateway takes it: %s %s', p.provider, p.environment);
end
$$;

-- Not someone else's order, not staff's to start.
select pg_temp.act('pagos2@yuntera.example');
select pg_temp.refused(format('select public.start_payment(%L)', current_setting('t.card')), 'order_not_found');
select pg_temp.act('central@yuntera.example');
select pg_temp.refused(format('select public.start_payment(%L)', current_setting('t.card')), 'order_not_found');
select pg_temp.logout();

do $$
declare
  v jsonb;
  t jsonb;
begin
  v := pg_temp.start('pagos1@yuntera.example', current_setting('t.card')::uuid);
  assert v ->> 'stage' = 'preparing', format('preparing: %s', v ->> 'stage');
  -- A double tap is the same attempt.
  v := pg_temp.start('pagos1@yuntera.example', current_setting('t.card')::uuid);
  assert (select count(*) from private.payment_attempts where order_id = current_setting('t.card')::uuid) = 1,
    'one attempt for two taps';
  -- The worker is given the order's own amount, never one from a client.
  t := (select x from jsonb_array_elements(pg_temp.claim()) x
        where x ->> 'order_id' = current_setting('t.card'));
  assert t ->> 'kind' = 'create' and (t ->> 'amount_minor')::bigint
         = (select total_minor from public.orders where id = current_setting('t.card')::uuid),
    format('create task with the order total: %s', t);
  assert t -> 'customer' ->> 'email' = 'pagos1@yuntera.example', 'and who pays, for the receipt';
  -- A second worker gets nothing while the lease holds.
  assert not exists (select 1 from jsonb_array_elements(pg_temp.claim()) x
                     where x ->> 'attempt_id' = t ->> 'attempt_id'), 'leased once';
  perform pg_temp.report(jsonb_build_object('kind', 'created', 'attempt_id', t ->> 'attempt_id',
    'outcome', 'created', 'session_reference', 'cs_card1', 'checkout_url', 'https://checkout.onvopay.com/pay/cs_card1',
    'status', 'open'));
end
$$;

select pg_temp.act('pagos1@yuntera.example');
do $$
declare
  v jsonb := public.order_payment((select order_number from public.orders where id = current_setting('t.card')::uuid));
begin
  assert v ->> 'stage' = 'pay', format('pay: %s', v);
  assert v -> 'attempt' ->> 'checkout_url' = 'https://checkout.onvopay.com/pay/cs_card1', 'the gateway''s page';
  assert v -> 'attempt' ->> 'session_reference' is null, 'references are for staff';
  -- Back from the gateway's page: only a hint, and a check is due now.
  v := public.payment_returned(current_setting('t.card')::uuid);
  assert v ->> 'stage' = 'confirming' and v ->> 'status' = 'pending', format('still unpaid: %s', v);
end
$$;
select pg_temp.logout();
do $$
begin
  assert (pg_temp.last_attempt(current_setting('t.card')::uuid)).work_after <= now(), 'checked at once';
end
$$;

do $$
declare
  v_order uuid := current_setting('t.card')::uuid;
  v_captures integer;
begin
  -- The intent event first, before the session event told us its id: nothing to do yet.
  assert pg_temp.apply(jsonb_set(pg_temp.pay_event('evt_c_intent', 'payment.succeeded', v_order,
           p_with_session => false), '{payment,reference}', '"pi_card1"')) = 'unmatched', 'unmatched intent';
  assert not exists (select 1 from private.payment_reviews where payment_reference = 'pi_card1'),
    'which is not kept for staff: its session event will name it';
  assert (select status from public.orders where id = v_order) = 'pending_payment', 'still waiting';

  assert pg_temp.apply(jsonb_set(pg_temp.pay_event('evt_c_session', 'payment.succeeded', v_order),
           '{payment,reference}', '"pi_card1"')) = 'applied', 'the session event pays it';
  assert (select status from public.orders where id = v_order) = 'confirmed', 'confirmed';
  assert (select gateway_reference from public.payments where order_id = v_order) = 'pi_card1',
    'refundable against the intent';
  -- The same event again, and the intent's event again: nothing more.
  assert pg_temp.apply(jsonb_set(pg_temp.pay_event('evt_c_session', 'payment.succeeded', v_order),
           '{payment,reference}', '"pi_card1"')) = 'duplicate', 'same id';
  assert pg_temp.apply(pg_temp.pay_event('evt_c_intent2', 'payment.succeeded', v_order,
           p_with_session => false)) = 'duplicate', 'the other event of the same payment';
  -- An older failure arriving late changes nothing.
  assert pg_temp.apply(pg_temp.pay_event('evt_c_old_fail', 'payment.failed', v_order,
           p_updated => now() - interval '1 minute')) = 'stale', 'late failure';
  assert (pg_temp.last_attempt(v_order)).status = 'succeeded', 'still succeeded';
  select count(*) into v_captures from public.ledger_transactions
  where order_id = v_order and kind = 'order_capture';
  assert v_captures = 1, 'booked once';
  assert (select count(*) from private.outbox_events
          where topic = 'payment.captured' and payload ->> 'order_id' = v_order::text) = 1, 'announced once';
  -- The gateway's fee, against the expected one, booked as an expense.
  assert (select reported_fee_minor from private.payment_costs c join public.payments p on p.id = c.payment_id
          where p.order_id = v_order) = 84000, 'fee recorded';
  assert (select expected_fee_minor from private.payment_costs c join public.payments p on p.id = c.payment_id
          where p.order_id = v_order)
         = round((select total_minor from public.orders where id = v_order) * 0.039) + 18000, 'expected fee';
  assert exists (select 1 from public.ledger_transactions where order_id = v_order and kind = 'gateway_fee'),
    'fee booked';
end
$$;
select pg_temp.check_money('C. card payment');

-- ═══ D. A decline, then a new attempt that succeeds ════════════════════════

select pg_temp.remember('declined', pg_temp.place('pagos2@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'pay-decline-0001')::text);
select pg_temp.start('pagos2@yuntera.example', current_setting('t.declined')::uuid) ->> 'stage' as d_preparing;
select pg_temp.create_due() as d_created;
do $$
declare
  v_order uuid := current_setting('t.declined')::uuid;
  v_first private.payment_attempts;
  v jsonb;
begin
  assert pg_temp.apply(pg_temp.pay_event('evt_d_fail', 'payment.failed', v_order)) = 'applied', 'declined';
  v_first := pg_temp.last_attempt(v_order);
  assert v_first.status = 'failed' and v_first.failure_code = 'declined', 'the attempt failed';
  assert (select status from public.orders where id = v_order) = 'pending_payment', 'the order still waits';
  perform pg_temp.act('pagos2@yuntera.example');
  v := public.order_payment((select order_number from public.orders where id = v_order));
  assert v ->> 'stage' = 'failed' and (v ->> 'can_start')::boolean, format('may try again: %s', v);
  perform pg_temp.logout();
  -- Trying again stops the declined one at the gateway, so it cannot be paid as well.
  v := pg_temp.start('pagos2@yuntera.example', v_order);
  assert (select status from private.payment_attempts where id = v_first.id) = 'cancel_requested',
    'the declined attempt is stopped';
  perform pg_temp.create_due();
  assert pg_temp.apply(pg_temp.pay_event('evt_d_ok', 'payment.succeeded', v_order)) = 'applied', 'second pays';
  assert (select status from public.orders where id = v_order) = 'confirmed', 'confirmed';
  assert (select count(*) from private.payment_attempts where order_id = v_order) = 2, 'two attempts';
end
$$;

-- ═══ E. SINPE Móvil: the payer, the transfer, the gateway's confirmation ═══

select pg_temp.remember('sinpe', pg_temp.place('pagos1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:2'), 'sinpe_movil', 'pay-sinpe-0001')::text);
select pg_temp.act('pagos1@yuntera.example');
select pg_temp.refused(format('select public.start_payment(%L)', current_setting('t.sinpe')), 'payer_id_invalid');
select pg_temp.refused(format('select public.start_payment(%L, %L)', current_setting('t.sinpe'),
  '{"kind": "national", "number": "12345"}'), 'payer_id_invalid');
select pg_temp.refused(format('select public.start_payment(%L, %L)', current_setting('t.sinpe'),
  '{"kind": "national", "number": "1-1393-1919", "phone": "2222 1234"}'), 'payer_phone_invalid');
select public.start_payment(current_setting('t.sinpe')::uuid,
  '{"kind": "national", "number": "1-1393-1919", "phone": "8888 8888"}') ->> 'stage' as e_preparing;
select pg_temp.logout();
do $$
declare
  t jsonb;
  a private.payment_attempts;
  v jsonb;
begin
  t := (select x from jsonb_array_elements(pg_temp.claim()) x where x ->> 'order_id' = current_setting('t.sinpe'));
  assert t -> 'payer' = '{"kind": "national", "number": "113931919", "phone": "+50688888888"}'::jsonb,
    format('the payer, as the gateway needs it: %s', t -> 'payer');
  perform pg_temp.report(jsonb_build_object('kind', 'created', 'attempt_id', t ->> 'attempt_id',
    'outcome', 'created', 'intent_reference', 'pi_sinpe1', 'sinpe_destination', '+50670196686',
    'status', 'processing'));
  a := pg_temp.last_attempt(current_setting('t.sinpe')::uuid);
  assert a.status = 'processing' and a.payer_number is null and a.payer_phone is null and a.payer_kind is null,
    'waiting for the transfer, and the payer''s identification is no longer kept';
  perform pg_temp.act('pagos1@yuntera.example');
  v := public.order_payment((select order_number from public.orders where id = current_setting('t.sinpe')::uuid));
  assert v ->> 'stage' = 'transfer' and v -> 'attempt' ->> 'sinpe_destination' = '+50670196686',
    format('instructions: %s', v);
  perform pg_temp.logout();
  -- Finance can no longer confirm it by hand: the gateway does.
  perform pg_temp.act('pagos-finanzas@yuntera.example');
  begin
    perform public.ops_confirm_payment(current_setting('t.sinpe')::uuid, 'BCR-123456');
    raise exception 'confirmed by hand';
  exception when others then
    if sqlerrm <> 'confirmed_by_gateway' then raise; end if;
  end;
  perform pg_temp.logout();
  assert pg_temp.apply(pg_temp.pay_event('evt_e_processing', 'payment.processing', current_setting('t.sinpe')::uuid))
    = 'applied', 'processing';
  assert pg_temp.apply(pg_temp.pay_event('evt_e_ok', 'payment.succeeded', current_setting('t.sinpe')::uuid))
    = 'applied', 'the transfer arrived';
  -- A processing event delivered after the success is stale.
  assert pg_temp.apply(pg_temp.pay_event('evt_e_processing_late', 'payment.processing',
    current_setting('t.sinpe')::uuid, p_updated => now() - interval '10 seconds')) = 'stale', 'reordered';
  assert (select status from public.orders where id = current_setting('t.sinpe')::uuid) = 'confirmed', 'paid';
end
$$;
select pg_temp.check_money('E. SINPE Móvil');

-- ═══ F. Money that does not match is kept for finance ══════════════════════

select pg_temp.remember('wrong', pg_temp.place('pagos2@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'pay-wrong-0001')::text);
select pg_temp.start('pagos2@yuntera.example', current_setting('t.wrong')::uuid) ->> 'stage' as f_preparing;
select pg_temp.create_due() as f_created;
do $$
declare
  v_order uuid := current_setting('t.wrong')::uuid;
begin
  assert pg_temp.apply(pg_temp.pay_event('evt_f_amount', 'payment.succeeded', v_order, p_amount => 100))
    = 'mismatch', 'wrong amount';
  assert (select status from public.orders where id = v_order) = 'pending_payment', 'nothing changes';
  assert exists (select 1 from private.payment_reviews where order_id = v_order and kind = 'amount_mismatch'
                 and amount_minor = 100 and status = 'open'), 'kept for finance';
  assert (pg_temp.last_attempt(v_order)).status = 'review', 'the attempt waits for finance';
  assert not exists (select 1 from public.ledger_transactions where order_id = v_order), 'nothing booked';
  -- A succeeded event naming no attempt of ours.
  assert pg_temp.apply(jsonb_build_object('provider', 'onvo', 'event_id', 'evt_f_unknown', 'source', 'webhook',
    'environment', 'test', 'type', 'payment.succeeded', 'provider_type', 'checkout_session.succeeded',
    'payment', jsonb_build_object('reference', 'pi_nobody', 'session_reference', 'cs_nobody',
      'amount_minor', 5000, 'currency', 'CRC', 'metadata', '{}'::jsonb))) = 'unmatched', 'unknown';
  assert exists (select 1 from private.payment_reviews where payment_reference = 'pi_nobody'
                 and kind = 'unknown_reference'), 'kept for finance';
  -- A test event while the database is in another environment changes nothing.
  assert pg_temp.apply(jsonb_set(pg_temp.pay_event('evt_f_live', 'payment.succeeded', v_order),
           '{environment}', '"live"')) = 'wrong_mode', 'another environment';
  -- And an event that is not an event is refused outright.
  perform pg_temp.work();
  begin
    perform public.worker_payments_event('{"provider": "onvo"}'::jsonb);
    raise exception 'took an event with no id';
  exception when others then
    if sqlerrm <> 'payment_event_invalid' then raise; end if;
  end;
  perform pg_temp.logout();
end
$$;

-- Currency: a payment in dollars is never taken as colones.
select pg_temp.remember('dollars', pg_temp.place('pagos2@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'pay-usd-0001')::text);
select pg_temp.start('pagos2@yuntera.example', current_setting('t.dollars')::uuid) ->> 'stage' as f2_preparing;
select pg_temp.create_due() as f2_created;
do $$
begin
  assert pg_temp.apply(pg_temp.pay_event('evt_f_usd', 'payment.succeeded', current_setting('t.dollars')::uuid,
    p_currency => 'USD')) = 'mismatch', 'wrong currency';
  assert exists (select 1 from private.payment_reviews
                 where order_id = current_setting('t.dollars')::uuid and kind = 'currency_mismatch'), 'kept';
  assert (select status from public.orders where id = current_setting('t.dollars')::uuid) = 'pending_payment',
    'unpaid';
end
$$;

-- Finance closes the amount mismatch by refunding it; the dollar one is
-- dismissed with a note (say, refunded at the gateway's dashboard).
select pg_temp.login('pagos-finanzas@yuntera.example');
select pg_temp.remember('review_amount', (select (r ->> 'id') from jsonb_array_elements(public.ops_payment_reviews(true)) r
  where r ->> 'kind' = 'amount_mismatch' limit 1));
select pg_temp.refused(format('select public.ops_resolve_payment_review(%L, ''accept'', null, ''Aceptar'')',
  current_setting('t.review_amount')), 'payment_review_mismatch');
select pg_temp.refused(format('select public.ops_resolve_payment_review(%L, ''refund'')',
  current_setting('t.review_amount')), 'payment_review_note_required');
select public.ops_resolve_payment_review(current_setting('t.review_amount')::uuid, 'refund', null,
  'Monto distinto al del pedido; se devuelve.') ->> 'status' as f_refunding;
select pg_temp.refused(format('select public.ops_resolve_payment_review(%L, ''dismiss'', null, ''Otra vez'')',
  current_setting('t.review_amount')), 'payment_review_closed');
reset role;
do $$
declare
  g private.gateway_refunds;
begin
  select * into g from private.gateway_refunds where review_id = current_setting('t.review_amount')::uuid;
  assert g.channel = 'gateway' and g.amount_minor = 100 and g.status = 'requested', format('to send: %s', row_to_json(g));
  perform pg_temp.send_refunds();
  perform pg_temp.apply(pg_temp.refund_event('evt_f_rf_ok', 'refund.succeeded', g.id));
  assert (select status from private.payment_reviews where id = g.review_id) = 'refunded', 'refunded';
  assert (select completion_tx from private.gateway_refunds where id = g.id) is null,
    'money never booked is not booked on its way out either';
end
$$;
select pg_temp.check_money('F. mismatches');

-- ═══ G. A payment arriving after the order expired ═════════════════════════

select pg_temp.remember('late', pg_temp.place('pagos1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'sinpe_movil', 'pay-late-0001')::text);
select pg_temp.start('pagos1@yuntera.example', current_setting('t.late')::uuid,
  '{"kind": "legal_entity", "number": "3-101-815764", "phone": "88881111"}') ->> 'stage' as g_preparing;
select pg_temp.create_due() as g_created;
update public.orders set placed_at = now() - interval '40 minutes' where id = current_setting('t.late')::uuid;
select private.expire_unpaid_orders() >= 1 as g_expired;
do $$
declare
  v_order uuid := current_setting('t.late')::uuid;
  t jsonb;
begin
  assert (select status from public.orders where id = v_order) = 'cancelled', 'expired';
  assert (pg_temp.last_attempt(v_order)).status = 'cancel_requested', 'to be stopped at the gateway';
  t := (select x from jsonb_array_elements(pg_temp.claim()) x
        where x ->> 'attempt_id' = (pg_temp.last_attempt(v_order)).id::text);
  assert t ->> 'kind' = 'cancel' and t ->> 'intent_reference' is not null, format('cancel task: %s', t);
  -- The transfer arrived anyway, racing the cancellation.
  assert pg_temp.apply(pg_temp.pay_event('evt_g_late', 'payment.succeeded', v_order)) = 'late', 'late';
  assert (select status from public.orders where id = v_order) = 'cancelled', 'the order stays cancelled';
  assert (select status from public.payments where order_id = v_order) = 'cancelled', 'unpaid';
  assert exists (select 1 from private.payment_reviews where order_id = v_order and kind = 'late'), 'kept';
  assert not exists (select 1 from public.ledger_transactions where order_id = v_order), 'nothing booked';
  -- The cancel's own report comes after: nothing undone.
  assert pg_temp.report(jsonb_build_object('kind', 'cancelled', 'attempt_id', t ->> 'attempt_id', 'ok', false,
    'code', 'payment_intent_unexpected_state')) = 'recorded', 'cancel refused';
  assert (pg_temp.last_attempt(v_order)).status = 'review', 'the attempt stays with finance';
end
$$;
select pg_temp.remember('review_late',
  (select id::text from private.payment_reviews where order_id = current_setting('t.late')::uuid));
select pg_temp.login('pagos-finanzas@yuntera.example');
select pg_temp.refused(format('select public.ops_resolve_payment_review(%L, ''accept'', null, ''Aceptar el pago'')',
  current_setting('t.review_late')), 'payment_review_mismatch');
reset role;

-- ═══ H. Paid twice, and a transfer that matched nothing, attached ══════════

select pg_temp.remember('twice', pg_temp.place('pagos2@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'pay-twice-0001')::text);
select pg_temp.start('pagos2@yuntera.example', current_setting('t.twice')::uuid) ->> 'stage' as h_preparing;
select pg_temp.create_due() as h_created;
do $$
declare
  v_order uuid := current_setting('t.twice')::uuid;
  v_first uuid := (pg_temp.last_attempt(v_order)).id;
begin
  -- The first attempt is declined, the shopper starts a second; both end up paid.
  perform pg_temp.apply(pg_temp.pay_event('evt_h_fail', 'payment.failed', v_order));
  perform pg_temp.start('pagos2@yuntera.example', v_order);
  perform pg_temp.create_due();
  assert pg_temp.apply(pg_temp.pay_event('evt_h_second', 'payment.succeeded', v_order)) = 'applied', 'second';
  assert pg_temp.apply(jsonb_build_object('provider', 'onvo', 'event_id', 'evt_h_first', 'source', 'webhook',
    'environment', 'test', 'type', 'payment.succeeded', 'provider_type', 'checkout_session.succeeded',
    'payment', jsonb_build_object(
      'reference', 'pi_first_' || left(v_first::text, 8),
      'session_reference', (select session_reference from private.payment_attempts where id = v_first),
      'amount_minor', (select amount_minor from private.payment_attempts where id = v_first),
      'currency', 'CRC', 'metadata', '{}'::jsonb))) = 'paid_twice', 'the first, too';
  assert (select count(*) from public.ledger_transactions where order_id = v_order and kind = 'order_capture') = 1,
    'booked once';
  assert exists (select 1 from private.payment_reviews where order_id = v_order and kind = 'paid_twice'), 'kept';
end
$$;

-- A SINPE Móvil transfer from an account the gateway could not tie to a
-- payment (a relative's): finance attaches it to the order it pays.
select pg_temp.remember('attach', pg_temp.place('pagos1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'sinpe_movil', 'pay-attach-0001')::text);
do $$
begin
  assert pg_temp.apply(jsonb_build_object('provider', 'onvo', 'event_id', 'evt_h_transfer', 'source', 'webhook',
    'environment', 'test', 'type', 'transfer.received', 'provider_type', 'mobile_transfer.received',
    'transfer', jsonb_build_object('reference', '0000000000000000000012345', 'payment_reference', null,
      'amount_minor', (select total_minor from public.orders where id = current_setting('t.attach')::uuid),
      'currency', 'CRC', 'description', 'pedido de mi hija'))) = 'unmatched', 'unmatched transfer';
end
$$;
select pg_temp.login('pagos-finanzas@yuntera.example');
select pg_temp.remember('review_transfer', (select r ->> 'id' from jsonb_array_elements(public.ops_payment_reviews(true)) r
  where r ->> 'kind' = 'unmatched_transfer' limit 1));
select pg_temp.refused(format('select public.ops_resolve_payment_review(%L, ''attach'', ''YT-0'', ''Es de este pedido'')',
  current_setting('t.review_transfer')), 'order_not_found');
select public.ops_resolve_payment_review(current_setting('t.review_transfer')::uuid, 'attach',
  (select order_number from public.orders where id = current_setting('t.attach')::uuid),
  'La clienta confirmó que pagó desde la cuenta de su madre.') ->> 'status' as h_attached;
reset role;
do $$
declare
  p public.payments;
begin
  select * into p from public.payments where order_id = current_setting('t.attach')::uuid;
  assert p.status = 'captured' and (select status from public.orders where id = p.order_id) = 'confirmed', 'paid';
  assert p.gateway_reference is null, 'a transfer with no payment at the gateway is refunded by transfer';
end
$$;
select pg_temp.check_money('H. paid twice, attached');

-- ═══ I. Refunds: requested, sent once, completed only on confirmation ══════

-- A full refund: the paid card order of block C is cancelled by its shopper.
select pg_temp.login('pagos1@yuntera.example');
select public.cancel_order(current_setting('t.card')::uuid) ->> 'status' as i_cancelled;
reset role;
do $$
declare
  v_order uuid := current_setting('t.card')::uuid;
  g private.gateway_refunds;
  v jsonb;
  t jsonb;
begin
  select * into g from private.gateway_refunds where order_id = v_order;
  assert g.channel = 'gateway' and g.status = 'requested' and g.payment_reference = 'pi_card1'
         and g.amount_minor = (select total_minor from public.orders where id = v_order),
    format('requested: %s', row_to_json(g));
  -- Requested is not completed: the payment, the order and the shopper's message wait.
  assert (select status from public.payments where order_id = v_order) = 'captured', 'not refunded yet';
  assert (select status from public.orders where id = v_order) = 'cancelled', 'cancelled, not refunded';
  assert not exists (select 1 from private.outbox_events where topic = 'refund.completed'
                     and payload ->> 'order_id' = v_order::text), 'no "completed" message yet';
  assert exists (select 1 from public.ledger_transactions where order_id = v_order and kind = 'refund_pending'),
    'owed to the shopper';
  assert not exists (select 1 from public.ledger_transactions where order_id = v_order and kind = 'refund_paid'),
    'not paid out';
  perform pg_temp.check_money('I. requested');
  perform pg_temp.act('pagos1@yuntera.example');
  v := public.order_payment((select order_number from public.orders where id = v_order));
  assert v -> 'refunds' -> 0 ->> 'status' = 'requested', format('the shopper sees it on its way: %s', v -> 'refunds');
  perform pg_temp.logout();

  -- Sent once: claimed, leased, and the claim again gives nothing.
  t := (select x from jsonb_array_elements(pg_temp.claim()) x where x ->> 'gateway_refund_id' = g.id::text);
  assert t ->> 'kind' = 'refund' and (t ->> 'amount_minor')::bigint = g.amount_minor, format('sent: %s', t);
  assert not exists (select 1 from jsonb_array_elements(pg_temp.claim()) x
                     where x ->> 'gateway_refund_id' = g.id::text), 'not twice';
  assert (select send_count from private.gateway_refunds where id = g.id) = 1, 'counted once';
  perform pg_temp.report(jsonb_build_object('kind', 'refund_sent', 'gateway_refund_id', g.id,
    'outcome', 'accepted', 'provider_refund_reference', 'rf_card1', 'status', 'pending'));
  assert (select status from private.gateway_refunds where id = g.id) = 'sent', 'sent';
  assert pg_temp.apply(pg_temp.refund_event('evt_i_created', 'refund.created', g.id)) = 'applied', 'created';
  assert (select status from public.payments where order_id = v_order) = 'captured', 'still not refunded';

  -- A confirmation for another amount does not complete it.
  assert pg_temp.apply(pg_temp.refund_event('evt_i_wrong', 'refund.succeeded', g.id, 1)) = 'mismatch', 'amount';
  assert (select status from private.gateway_refunds where id = g.id) = 'sent', 'still on its way';

  assert pg_temp.apply(pg_temp.refund_event('evt_i_ok', 'refund.succeeded', g.id)) = 'applied', 'confirmed';
  assert pg_temp.apply(pg_temp.refund_event('evt_i_ok2', 'refund.succeeded', g.id)) = 'duplicate', 'twice';
  assert pg_temp.apply(pg_temp.refund_event('evt_i_fail_late', 'refund.failed', g.id)) = 'stale',
    'a failure after the success changes nothing';
  assert (select status from public.payments where order_id = v_order) = 'refunded', 'refunded';
  assert (select status from public.orders where id = v_order) = 'refunded', 'the order is refunded';
  assert (select count(*) from private.outbox_events where topic = 'refund.completed'
          and payload ->> 'order_id' = v_order::text) = 1, 'the shopper is told once';
  assert (select count(*) from public.ledger_transactions where order_id = v_order and kind = 'refund_paid') = 1,
    'paid out once';
end
$$;
select pg_temp.check_money('I. full refund completed');

-- A partial refund: the SINPE Móvil order of block E is delivered, and one
-- unit comes back.
select pg_temp.deliver(current_setting('t.sinpe')::uuid);
select pg_temp.login('pagos1@yuntera.example');
select pg_temp.remember('return', (public.request_return(
  (select id from public.order_items where order_id = current_setting('t.sinpe')::uuid limit 1),
  'withdrawal', 1)::text));
reset role;
select pg_temp.receive(current_setting('t.return')::uuid);
select pg_temp.login('central@yuntera.example');
select public.ops_complete_return(current_setting('t.return')::uuid) ->> 'refund_minor' as i_partial;
reset role;
do $$
declare
  v_order uuid := current_setting('t.sinpe')::uuid;
  g private.gateway_refunds;
begin
  select * into g from private.gateway_refunds where order_id = v_order;
  assert g.channel = 'gateway' and g.payment_reference = 'pi_sinpe1'
         and g.amount_minor < (select total_minor from public.orders where id = v_order), format('partial, to the gateway: %s', row_to_json(g));
  -- The refund fails at the gateway: nothing completes, finance decides.
  perform pg_temp.send_refunds();
  assert pg_temp.apply(pg_temp.refund_event('evt_i_partial_fail', 'refund.failed', g.id)) = 'applied', 'failed';
  assert (select status from private.gateway_refunds where id = g.id) = 'failed', 'failed';
  assert (select status from public.payments where order_id = v_order) = 'captured', 'not refunded';
  assert not exists (select 1 from private.outbox_events where topic = 'refund.completed'
                     and payload ->> 'order_id' = v_order::text), 'no "completed" message';
  perform pg_temp.check_money('I. partial failed');
end
$$;
select pg_temp.remember('refund_partial', pg_temp.order_refund(current_setting('t.sinpe')::uuid)::text);
select pg_temp.login('pagos-finanzas@yuntera.example');
select public.ops_retry_gateway_refund(current_setting('t.refund_partial')::uuid) ->> 'status' as i_retry;
select pg_temp.refused(format('select public.ops_retry_gateway_refund(%L)', current_setting('t.refund_partial')),
                       'gateway_refund_state');
reset role;
do $$
declare
  v_order uuid := current_setting('t.sinpe')::uuid;
  g uuid := pg_temp.order_refund(v_order);
  t jsonb;
begin
  -- Sent again, and this time the answer is lost: never sent a third time blindly.
  t := (select x from jsonb_array_elements(pg_temp.claim()) x where x ->> 'gateway_refund_id' = g::text);
  perform pg_temp.report(jsonb_build_object('kind', 'refund_sent', 'gateway_refund_id', g, 'outcome', 'unknown',
    'code', 'timeout'));
  assert (select status from private.gateway_refunds where id = g) = 'unknown', 'unknown';
  update private.gateway_refunds set work_after = now() where id = g;
  t := (select x from jsonb_array_elements(pg_temp.claim()) x where x ->> 'gateway_refund_id' = g::text);
  assert t ->> 'kind' = 'refund_check', format('the worker asks first: %s', t);
  -- The gateway holds it (its refunded total covers it): sent, wait for the confirmation.
  perform pg_temp.report(jsonb_build_object('kind', 'refund_checked', 'gateway_refund_id', g,
    'provider_refunded_minor', (select amount_minor from private.gateway_refunds where id = g)));
  assert (select status from private.gateway_refunds where id = g) = 'sent', 'it exists';
  assert (select send_count from private.gateway_refunds where id = g) = 2, 'sent twice in all, never three times';
  -- Its confirmation names it by payment and amount, since we never learnt its id.
  perform pg_temp.apply(jsonb_build_object('provider', 'onvo', 'event_id', 'evt_i_partial_ok', 'source', 'webhook',
    'environment', 'test', 'type', 'refund.succeeded', 'provider_type', 'refund.succeeded',
    'refund', jsonb_build_object('reference', 'rf_found', 'payment_reference', 'pi_sinpe1',
      'amount_minor', (select amount_minor from private.gateway_refunds where id = g), 'currency', 'CRC')));
  assert (select status || ':' || provider_refund_reference from private.gateway_refunds where id = g)
         = 'succeeded:rf_found', 'completed, and its id learnt';
  assert (select status from public.payments where order_id = v_order) = 'partially_refunded', 'partly refunded';
  assert (select count(*) from private.outbox_events where topic = 'refund.completed'
          and payload ->> 'order_id' = v_order::text) = 1, 'the shopper is told';
end
$$;
select pg_temp.check_money('I. partial completed');

-- A lost answer for a refund the gateway never created: safe to send again.
do $$
declare
  g uuid;
begin
  -- The paid-twice money of block H is refunded through the gateway.
  perform pg_temp.act('pagos-finanzas@yuntera.example');
  perform public.ops_resolve_payment_review(
    (select id from private.payment_reviews where kind = 'paid_twice' and order_id = current_setting('t.twice')::uuid),
    'refund', null, 'Pagó dos veces; se devuelve el segundo cobro.');
  perform pg_temp.logout();
  select id into g from private.gateway_refunds
  where review_id = (select id from private.payment_reviews where kind = 'paid_twice'
                     and order_id = current_setting('t.twice')::uuid);
  perform jsonb_array_elements(pg_temp.claim());
  perform pg_temp.report(jsonb_build_object('kind', 'refund_sent', 'gateway_refund_id', g, 'outcome', 'unknown'));
  update private.gateway_refunds set work_after = now() where id = g;
  perform jsonb_array_elements(pg_temp.claim());
  perform pg_temp.report(jsonb_build_object('kind', 'refund_checked', 'gateway_refund_id', g,
    'provider_refunded_minor', 0));
  assert (select status from private.gateway_refunds where id = g) = 'requested', 'not at the gateway: send again';
end
$$;

-- ═══ J. Cash on delivery: refunded by transfer, by finance ═════════════════

select pg_temp.remember('cod', pg_temp.place('pagos2@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'cash_on_delivery', 'pay-cod-0001')::text);
do $$
begin
  assert (select provider from public.payments where order_id = current_setting('t.cod')::uuid) = 'cash',
    'cash never goes through the gateway';
end
$$;
select pg_temp.deliver(current_setting('t.cod')::uuid);
select pg_temp.login('pagos2@yuntera.example');
select pg_temp.remember('cod_return', (public.request_return(
  (select id from public.order_items where order_id = current_setting('t.cod')::uuid limit 1),
  'withdrawal', 1)::text));
reset role;
select pg_temp.receive(current_setting('t.cod_return')::uuid);
select pg_temp.login('central@yuntera.example');
select public.ops_complete_return(current_setting('t.cod_return')::uuid) ->> 'refund_minor' as j_refund;
reset role;
do $$
declare
  g private.gateway_refunds;
begin
  select * into g from private.gateway_refunds where order_id = current_setting('t.cod')::uuid;
  assert g.channel = 'transfer' and g.status = 'requested', format('by transfer: %s', row_to_json(g));
  assert not exists (select 1 from jsonb_array_elements(pg_temp.claim()) x where x ->> 'gateway_refund_id' = g.id::text),
    'the worker never sends it';
end
$$;
select pg_temp.remember('refund_cod', pg_temp.order_refund(current_setting('t.cod')::uuid)::text);
select pg_temp.login('pagos-finanzas@yuntera.example');
select pg_temp.refused(format('select public.ops_record_refund_transfer(%L, ''x'')', current_setting('t.refund_cod')),
                       'bank_reference_invalid');
select public.ops_record_refund_transfer(current_setting('t.refund_cod')::uuid, 'BNCR-778899') ->> 'status' as j_done;
select pg_temp.refused(format('select public.ops_record_refund_transfer(%L, ''BNCR-778899'')',
  current_setting('t.refund_cod')), 'gateway_refund_state');
reset role;
do $$
declare
  v_tx uuid;
begin
  select completion_tx into v_tx from private.gateway_refunds where order_id = current_setting('t.cod')::uuid;
  assert exists (select 1 from public.ledger_entries e where e.transaction_id = v_tx
                 and e.account_id = private.ledger_account('bank_operating') and e.amount_minor < 0),
    'paid out of the bank account';
  assert exists (select 1 from private.outbox_events where topic = 'refund.completed'
                 and payload ->> 'order_id' = current_setting('t.cod')), 'the shopper is told';
end
$$;
select pg_temp.check_money('J. cash on delivery');

-- ═══ K. Fees from the statement; the lists finance reads ═══════════════════

select pg_temp.remember('payment_declined',
  (select id::text from public.payments where order_id = current_setting('t.declined')::uuid));
select pg_temp.remember('payment_cod', (select id::text from public.payments where order_id = current_setting('t.cod')::uuid));
select pg_temp.login('pagos-finanzas@yuntera.example');
do $$
declare
  v_payment uuid := current_setting('t.payment_declined')::uuid;
  v jsonb;
begin
  -- Block D's payment reported its fee: it cannot be entered again.
  begin
    perform public.ops_record_payment_fee(v_payment, 1000, 'Estado de cuenta');
    raise exception 'recorded twice';
  exception when others then
    if sqlerrm <> 'payment_fee_recorded' then raise; end if;
  end;
  begin
    perform public.ops_record_payment_fee(current_setting('t.payment_cod')::uuid, 1000, null);
    raise exception 'a cash payment has no gateway fee';
  exception when others then
    if sqlerrm <> 'payment_not_found' then raise; end if;
  end;
  v := public.ops_payments(null, 200);
  assert exists (select 1 from jsonb_array_elements(v) r where r ->> 'gateway_reference' = 'pi_card1'
                 and (r ->> 'reported_fee_minor')::bigint = 84000), 'the payment with its reference and fee';
  v := public.ops_payment_reconciliation(null);
  assert (v -> 'refunds_completed' ->> 'count')::integer >= 3, format('refunds completed today: %s', v);
  assert (v -> 'reviews_open' ->> 'count')::integer >= 2, 'items waiting for finance';
  assert jsonb_array_length(v -> 'events') > 0, 'events by outcome';
  v := public.ops_gateway_refunds(false);
  assert jsonb_array_length(v) >= 4, 'refunds with their state';
end
$$;
reset role;
select pg_temp.login('central@yuntera.example');
select pg_temp.refused('select public.ops_set_expected_gateway_fee(''card'', 9999, 0, ''Tarifa contratada'')',
                       'payment_fee_invalid');
select public.ops_set_expected_gateway_fee('card', 195, 0, 'Tope del BCCR, pendiente de confirmar')
  -> 'expected_fees' -> 'card' as k_card_fee;
reset role;
do $$
begin
  assert (private.expected_gateway_fee('card', 1000000) ->> 'fee_minor')::bigint = 19500, 'the new expectation';
end
$$;

-- ═══ L. Live: refused while work is open, and no simulation ═══════════════

select pg_temp.work();
select public.worker_payments_hello('onvo', 'live', 'acct_live', true, true) ->> 'active' as l_not_yet;
select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select pg_temp.refused('select public.ops_set_payments_mode(''live'', ''Salimos a producción hoy'')',
                       'payments_work_open');
reset role;
-- Finish what is open (every attempt and gateway refund), then switch.
update private.payment_attempts set status = 'cancelled' where status in ('creating', 'open', 'processing', 'cancel_requested');
update private.gateway_refunds set status = 'failed' where channel = 'gateway' and status <> 'succeeded';
select pg_temp.login('central@yuntera.example');
select public.ops_set_payments_mode('live', 'Salimos a producción hoy') ->> 'mode' as l_live;
reset role;
select pg_temp.remember('live_order', pg_temp.place('pagos2@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'pay-live-0001')::text);
select pg_temp.act('pagos2@yuntera.example');
select pg_temp.refused(format('select public.confirm_sandbox_payment(%L)', current_setting('t.live_order')),
                       'sandbox_disabled');
do $$
declare
  v jsonb := public.order_payment((select order_number from public.orders where id = current_setting('t.live_order')::uuid));
begin
  assert v ->> 'stage' = 'start' and v ->> 'mode' = 'live', format('the gateway, never the simulation: %s', v);
  assert (select environment from public.payments where order_id = current_setting('t.live_order')::uuid) = 'live',
    'a live payment';
end
$$;
select pg_temp.logout();
select pg_temp.check_money('L. live');

rollback;
