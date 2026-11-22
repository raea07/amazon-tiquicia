-- Fixtures and helpers for the suites about money going in and out through
-- the payment gateway (135_payments.sql, 145_refunds_end_to_end.sql):
-- shoppers, orders placed, paid, packed, delivered and returned, the
-- payments worker played by the test, and the money checks that must hold
-- after every block. Included with \ir after _helpers.sql.
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
    -- The picker scans each product's code (083200 checks it).
    for t in select pt.id, pt.quantity, k.code from public.pick_tasks pt
             join public.skus k on k.id = pt.sku_id where pt.shipment_id = p_shipment loop
      perform public.wms_confirm_pick(t.id, t.quantity, null, t.code);
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

