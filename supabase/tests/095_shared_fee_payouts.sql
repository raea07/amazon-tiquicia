-- The two halves of the money path together: an order from three sellers pays
-- the fixed part of the card fee once (20261121082400_fixes.sql), and the
-- shares that follow from it are what the payout run pays each seller
-- (20261121082300_people_payouts.sql). The order goes through payment,
-- picking, packing, a route and delivery with the real functions, then a
-- payout run and "mark paid". After every step that moves money, each
-- transaction in the ledger balances and every seller's available + pending +
-- in transit equals what the ledger says they are owed.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

-- Steps that are not about access run as the test's superuser with a caller's
-- identity in the claims, the way the seed does.
create function pg_temp.act_as(p_email text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else
      json_build_object('sub', (select id from auth.users where email = p_email),
                        'role', 'authenticated')::text end, true);
$$;

create function pg_temp.check_money(p_label text) returns void
language plpgsql as $$
declare
  b record;
  v_ledger bigint;
begin
  assert not exists (
    select 1 from public.ledger_entries group by transaction_id having sum(amount_minor) <> 0
  ), format('%s: a transaction is out of balance', p_label);
  for b in
    select s.slug, x.*
    from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days()) x
    join public.sellers s on s.id = x.seller_id
  loop
    select coalesce(-sum(e.amount_minor), 0) into v_ledger
    from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
    where a.seller_id = b.seller_id;
    assert b.available_minor + b.pending_minor + b.in_transit_minor = v_ledger
       and b.payable_minor = v_ledger,
      format('%s — %s: %s available + %s pending + %s in transit is not the ledger''s %s',
             p_label, b.slug, b.available_minor, b.pending_minor, b.in_transit_minor, v_ledger);
  end loop;
end;
$$;

select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('cafetal', (select id::text from public.sellers where slug = 'cafetal-los-santos'));
select pg_temp.remember('sendero', (select id::text from public.sellers where slug = 'tienda-sendero'));

select pg_temp.check_money('seed');

-- ═══ Payment ═══════════════════════════════════════════════════════════════

-- One line from each of three sellers, all sent from the Yuntera warehouse.
do $$
declare
  r jsonb;
begin
  perform pg_temp.act_as('comprador@yuntera.example');
  r := public.place_order(
    jsonb_build_array(
      jsonb_build_object('offer_id', pg_temp.offer('licuadora-volcan-600w'), 'quantity', 1),
      jsonb_build_object('offer_id', pg_temp.offer('cafe-molido-tarrazu-340g'), 'quantity', 2),
      jsonb_build_object('offer_id', pg_temp.offer('salveque-urbano-sendero-25l'), 'quantity', 1)),
    (select a.id from public.addresses a join auth.users u on u.id = a.user_id
     where u.email = 'comprador@yuntera.example' and a.is_default),
    'card', 'test-shared-fee-payout-001');
  perform public.confirm_sandbox_payment((r ->> 'order_id')::uuid);
  perform set_config('t.order', r ->> 'order_id', true);
  perform pg_temp.act_as(null);
end
$$;
set constraints all immediate;
set constraints all deferred;

do $$
declare
  v_order uuid := current_setting('t.order')::uuid;
  v_bps integer;
  v_fixed bigint;
  v_tx uuid;
begin
  select m.bps, m.fixed_minor into v_bps, v_fixed
  from public.fee_payment_methods m join public.fee_schedules s on s.version = m.schedule_version
  where s.active and m.method = 'card';
  assert v_fixed > 0, 'the card fee has a fixed part';

  assert (select count(distinct seller_id) from public.seller_order_fees where order_id = v_order) = 3,
    'one statement for each of the three sellers';
  assert (select sum(payment_fee_minor - round(items_gross_minor::numeric * v_bps / 10000))
          from public.seller_order_fees where order_id = v_order) = v_fixed,
    'the three sellers together pay the fixed part exactly once';
  assert not exists (
    select 1 from public.seller_order_fees
    where order_id = v_order
      and payment_fee_minor - round(items_gross_minor::numeric * v_bps / 10000) >= v_fixed),
    'no seller pays the whole fixed part on their own';

  select id into strict v_tx from public.ledger_transactions
  where order_id = v_order and kind = 'order_capture';
  assert (select -sum(e.amount_minor) from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id
          where e.transaction_id = v_tx and a.code = 'payment_fee_revenue')
       = (select sum(round(items_gross_minor::numeric * v_bps / 10000))
          from public.seller_order_fees where order_id = v_order) + v_fixed,
    'the ledger books the rate on each sale plus the fixed part once';
  assert not exists (
    select 1 from public.seller_order_fees x
    where x.order_id = v_order
      and x.payout_minor <> (
        select -sum(e.amount_minor) from public.ledger_entries e
        join public.ledger_accounts a on a.id = e.account_id
        where e.transaction_id = v_tx and a.seller_id = x.seller_id)),
    'each seller is owed exactly their statement';
end
$$;
select pg_temp.check_money('paid');

-- Not delivered yet, so each seller's share is pending and none of it is available.
do $$
declare
  v_order uuid := current_setting('t.order')::uuid;
  f record;
  b record;
begin
  for f in select * from public.seller_order_fees where order_id = v_order loop
    select * into strict b
    from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days(), f.seller_id);
    assert b.pending_minor >= f.payout_minor,
      format('the share of %s waits for delivery: %s pending, share %s', f.seller_id, b.pending_minor, f.payout_minor);
    perform set_config('t.before',
      (coalesce(nullif(current_setting('t.before', true), ''), '{}')::jsonb
       || jsonb_build_object(f.seller_id::text, b.available_minor))::text, true);
  end loop;
end
$$;

-- ═══ Picking, packing, route and delivery ══════════════════════════════════

do $$
declare
  v_order uuid := current_setting('t.order')::uuid;
  s record;
  t record;
  v_stops jsonb;
  v_route uuid;
  v_result jsonb;
begin
  perform pg_temp.act_as('bodega@yuntera.example');
  for s in select id from public.shipments where order_id = v_order loop
    perform public.wms_start_picking(s.id);
    for t in select id, quantity from public.pick_tasks where shipment_id = s.id loop
      perform public.wms_confirm_pick(t.id, t.quantity);
    end loop;
    perform public.wms_pack_shipment(
      s.id,
      (select sum(i.weight_grams * si.quantity)::integer + 150
       from public.shipment_items si join public.order_items i on i.id = si.order_item_id
       where si.shipment_id = s.id),
      1::smallint);
  end loop;

  perform pg_temp.act_as('central@yuntera.example');
  select jsonb_agg(jsonb_build_object('shipment_id', id, 'sequence', n, 'eta_minute', n * 18))
  into v_stops
  from (select id, row_number() over (order by id) as n
        from public.shipments where order_id = v_order and status = 'packed') x;
  assert jsonb_array_length(v_stops) >= 1, 'the parcels are packed';
  v_route := public.ops_create_route(
    current_date, (select id from public.warehouses where code = 'SJO1'), v_stops,
    (select d.id from public.drivers d join auth.users u on u.id = d.user_id
     where u.email = 'repartidor@yuntera.example'), 14.5, 95);

  perform pg_temp.act_as('repartidor@yuntera.example');
  perform public.driver_start_route(v_route);
  for s in
    select rs.id, rs.recipient_name, rs.cod_amount_minor, o.delivery_pin
    from public.route_stops rs
    join public.shipments sh on sh.id = rs.shipment_id
    join public.orders o on o.id = sh.order_id
    where rs.route_id = v_route order by rs.sequence
  loop
    v_result := public.driver_complete_stop(s.id, s.delivery_pin, s.recipient_name, s.cod_amount_minor);
    assert (v_result ->> 'ok')::boolean, format('delivered: %s', v_result);
  end loop;
  perform pg_temp.act_as(null);

  assert (select delivered_at is not null from public.orders where id = v_order), 'the order is delivered';
end
$$;
set constraints all immediate;
set constraints all deferred;
select pg_temp.check_money('delivered');

-- Delivered today: still inside the hold, so still pending.
do $$
declare
  f record;
begin
  for f in select * from public.seller_order_fees where order_id = current_setting('t.order')::uuid loop
    assert (select available_minor from private.seller_balances(
              private.cr_local(now())::date, private.payout_hold_days(), f.seller_id))
         = (current_setting('t.before')::jsonb ->> f.seller_id::text)::bigint,
      'a share delivered today is not available before the hold ends';
  end loop;
end
$$;

-- The hold passes: the delivery is moved back past it, as the clock would.
update public.orders
set delivered_at = now() - make_interval(days => private.payout_hold_days() + 1)
where id = current_setting('t.order')::uuid;
select pg_temp.check_money('hold passed');

do $$
declare
  f record;
begin
  for f in select * from public.seller_order_fees where order_id = current_setting('t.order')::uuid loop
    assert (select available_minor from private.seller_balances(
              private.cr_local(now())::date, private.payout_hold_days(), f.seller_id))
         = (current_setting('t.before')::jsonb ->> f.seller_id::text)::bigint + f.payout_minor,
      format('after the hold, %s can be paid their whole share', f.seller_id);
  end loop;
end
$$;

-- ═══ Payout run and "mark paid" ════════════════════════════════════════════

select pg_temp.remember('today', private.cr_local(now())::date::text);
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_order uuid := current_setting('t.order')::uuid;
  r jsonb;
  run jsonb;
  p jsonb;
  f record;
  n integer := 0;
begin
  r := public.ops_create_payout_run(current_setting('t.today')::date);
  run := public.ops_payout_run((r ->> 'run_id')::uuid);
  for f in select * from public.seller_order_fees where order_id = v_order loop
    select x into p from jsonb_array_elements(run -> 'payouts') x
    where (x ->> 'seller_id')::uuid = f.seller_id;
    assert p is not null, format('the run pays %s', f.seller_id);
    assert (p ->> 'amount_minor')::bigint
         = (current_setting('t.before')::jsonb ->> f.seller_id::text)::bigint + f.payout_minor,
      format('the run pays %s what was available, this order''s share included: %s', f.seller_id, p);
  end loop;
  for p in select x from jsonb_array_elements(run -> 'payouts') x loop
    n := n + 1;
    perform public.ops_mark_payout_paid((p ->> 'id')::uuid, 'BNCR-2026-T' || lpad(n::text, 3, '0'));
  end loop;
  perform set_config('t.paid_count', n::text, true);
end
$$;
reset role; select pg_temp.act_as(null);
set constraints all immediate;
set constraints all deferred;
select pg_temp.check_money('paid out');

do $$
declare
  f record;
  b record;
begin
  assert (select count(*) from public.ledger_transactions where kind = 'payout')
         = current_setting('t.paid_count')::integer, 'one ledger transaction for each payout';
  assert (select coalesce(sum(amount_minor), 0) from public.ledger_entries) = 0,
    'the whole ledger sums to zero';
  for f in select * from public.seller_order_fees where order_id = current_setting('t.order')::uuid loop
    select * into strict b
    from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days(), f.seller_id);
    assert b.available_minor = 0 and b.in_transit_minor = 0,
      format('nothing left to pay %s once paid: %s', f.seller_id, b);
  end loop;
  -- The fixed part is still charged once: paying out does not touch the fees.
  assert (select -sum(e.amount_minor) from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id
          join public.ledger_transactions t on t.id = e.transaction_id
          where t.order_id = current_setting('t.order')::uuid and a.code = 'payment_fee_revenue')
       = (select sum(payment_fee_minor) from public.seller_order_fees
          where order_id = current_setting('t.order')::uuid),
    'payment fee revenue for the order is the three statements'' payment fees';
end
$$;

rollback;
