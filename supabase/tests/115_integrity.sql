-- Integrity: money, returns, stock, the delivery code and the state machines.
--
-- One block per finding of the security review of 21 November 2026, named by
-- its id (see docs/04-algorithms/returns-and-refunds.md for the rules). Each
-- block replays the attack and expects it to be refused, then checks the
-- invariants: every ledger transaction balances, every refund is registered,
-- nothing is refunded twice or beyond what was paid, a seller's balances add up
-- to their ledger balance, and stock is never negative or over-reserved.
--
-- The races (two calls at once) need two database sessions, which a SQL file
-- cannot open: they are in packages/db/src/contract.integrity.test.ts.

begin;
\ir _helpers.sql
-- Reads below check what functions left behind (see _helpers.sql); access
-- itself is tested in 020_access and 110_lockdown.
select pg_temp.allow_inspection();

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
  insert into auth.users (email, raw_user_meta_data)
  values (p_email, jsonb_build_object('full_name', p_name)) returning id into v_id;
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

-- What has gone back to the shopper for an order, from the ledger: every
-- refund transaction, measured on the account the money left through.
create function pg_temp.refunded_from_ledger(p_order uuid) returns bigint
language sql as $$
  select coalesce(sum(case
    when t.kind = 'order_refund' then -e.amount_minor * (a.code in ('gateway_clearing', 'driver_cash'))::int
    -- A refund settled at the door of a cash order leaves through the driver's cash.
    when t.kind = 'return_refund' then -e.amount_minor * (a.code in ('refunds_payable', 'driver_cash'))::int
  end), 0)::bigint
  from public.ledger_transactions t
  join public.ledger_entries e on e.transaction_id = t.id
  join public.ledger_accounts a on a.id = e.account_id
  where t.order_id = p_order and t.kind in ('order_refund', 'return_refund')
$$;

-- The invariants, after every sequence.
create function pg_temp.check_invariants(p_label text) returns void
language plpgsql as $$
declare
  v_bad text;
begin
  -- Deferred checks (balanced transactions, registered refunds) run now.
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
  where pg_temp.refunded_from_ledger(o.id) > private.order_collected_minor(o.id)
     or private.refunded_minor(o.id) <> pg_temp.refunded_from_ledger(o.id);
  assert v_bad is null, format('%s: refunded more than collected, or ledger and register disagree: %s',
                               p_label, v_bad);

  select string_agg(i.id::text, ', ') into v_bad from public.order_items i
  where (select coalesce(sum(u.quantity), 0) from private.refund_units u where u.order_item_id = i.id) > i.quantity
     or (select coalesce(sum(r.quantity), 0) from public.return_requests r
         where r.order_item_id = i.id and r.status <> 'rejected') > i.quantity;
  assert v_bad is null, format('%s: more units refunded or in returns than bought: %s', p_label, v_bad);

  select string_agg(b.seller_id::text, ', ') into v_bad
  from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days()) b
  where b.available_minor + b.pending_minor + b.in_transit_minor <> b.payable_minor
     or b.payable_minor <> (select coalesce(-sum(e.amount_minor), 0) from public.ledger_entries e
                            join public.ledger_accounts a on a.id = e.account_id where a.seller_id = b.seller_id);
  assert v_bad is null, format('%s: seller balances do not add up: %s', p_label, v_bad);

  assert not exists (select 1 from public.stock_levels l
                     where l.on_hand < 0 or l.reserved < 0 or l.reserved > l.on_hand
                        or l.reserved <> (select coalesce(sum(r.quantity), 0) from public.inventory_reservations r
                                          where r.warehouse_id = l.warehouse_id and r.sku_id = l.sku_id
                                            and r.seller_id = l.seller_id and r.status = 'active')),
    format('%s: stock is negative, over-reserved or out of step with its reservations', p_label);
  assert not exists (select 1 from public.bin_stock b where b.quantity < 0), p_label || ': negative bin';
end;
$$;

-- Lookups used while signed in (they read only what the signed-in role may read).
grant execute on function pg_temp.remember(text, text), pg_temp.offer(text, text),
  pg_temp.item(uuid, text) to authenticated;

select pg_temp.shopper('integridad1@yuntera.example', 'Prueba Integridad Uno');
select pg_temp.shopper('integridad2@yuntera.example', 'Prueba Integridad Dos');
select pg_temp.shopper('integridad3@yuntera.example', 'Prueba Integridad Tres');
select pg_temp.shopper('integridad-soporte@yuntera.example', 'Prueba Soporte');
insert into public.staff_members (user_id, role)
select id, 'support' from auth.users where email = 'integridad-soporte@yuntera.example';

select pg_temp.check_invariants('the seed');

-- ═══ FA-1: a withdrawal on a cancelled and refunded order ══════════════════

select pg_temp.remember('fa1', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'int-fa1-0001')::text);
select pg_temp.pay(current_setting('t.fa1')::uuid);
select pg_temp.remember('fa1_item', pg_temp.item(current_setting('t.fa1')::uuid, 'parlante-bluetooth-nimbo-ola')::text);

select pg_temp.login('integridad1@yuntera.example');
select public.cancel_order(current_setting('t.fa1')::uuid) ->> 'status' as fa1_cancelled;
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 1)', current_setting('t.fa1_item')),
                       'order_not_returnable');
reset role;

-- A withdrawal the old rules had already approved cannot be paid either:
-- not before the goods are back, and not on an order that was refunded.
insert into public.return_requests (order_item_id, user_id, kind, quantity, status, refund_due_on)
select current_setting('t.fa1_item')::uuid, user_id, 'withdrawal', 1, 'approved', current_date + 8
from public.orders where id = current_setting('t.fa1')::uuid
returning set_config('t.fa1_legacy', id::text, true) is not null as fa1_legacy_row;
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.ops_complete_return(%L)', current_setting('t.fa1_legacy')),
                       'return_not_received');
select pg_temp.refused(format('select public.ops_receive_return(%L)', current_setting('t.fa1_legacy')),
                       'order_not_returnable');
reset role;
do $$
begin
  assert (select status from public.return_requests where id = current_setting('t.fa1_legacy')::uuid) = 'approved';
  update public.return_requests set status = 'received' where id = current_setting('t.fa1_legacy')::uuid;
end
$$;
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.ops_complete_return(%L)', current_setting('t.fa1_legacy')),
                       'order_not_refundable');
reset role;
do $$
declare
  v_order uuid := current_setting('t.fa1')::uuid;
begin
  assert pg_temp.refunded_from_ledger(v_order) = (select total_minor from public.orders where id = v_order),
    'FA-1: the shopper got back exactly what they paid, once';
  assert (select count(*) from private.refunds where order_id = v_order) = 1, 'FA-1: one refund';
  assert not exists (select 1 from private.outbox_events
                     where topic = 'refund.requested' and payload ->> 'order_id' = v_order::text
                       and payload ->> 'return_request_id' is not null),
    'FA-1: no second refund was requested';
end
$$;
select pg_temp.check_invariants('FA-1');

-- ═══ FA-M1: a withdrawal filed on an unpaid order, then paid and cancelled ══

select pg_temp.remember('fam1', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'int-fam1-001')::text);
select pg_temp.remember('fam1_item', pg_temp.item(current_setting('t.fam1')::uuid, 'libreta-tapa-dura-a5')::text);
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 1)', current_setting('t.fam1_item')),
                       'order_not_returnable');
reset role;
-- The row the old rules wrote at this point.
insert into public.return_requests (order_item_id, user_id, kind, quantity, status, refund_due_on)
select current_setting('t.fam1_item')::uuid, user_id, 'withdrawal', 1, 'approved', current_date + 8
from public.orders where id = current_setting('t.fam1')::uuid
returning set_config('t.fam1_legacy', id::text, true) is not null as fam1_legacy_row;
select pg_temp.pay(current_setting('t.fam1')::uuid);
select pg_temp.login('integridad1@yuntera.example');
select public.cancel_order(current_setting('t.fam1')::uuid) ->> 'status' as fam1_cancelled;
reset role;
do $$
begin
  assert (select status from public.return_requests where id = current_setting('t.fam1_legacy')::uuid) = 'rejected',
    'FA-M1: cancelling closes the open withdrawal';
end
$$;
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.ops_complete_return(%L)', current_setting('t.fam1_legacy')),
                       'invalid_return_state');
reset role;
do $$
declare
  v_order uuid := current_setting('t.fam1')::uuid;
begin
  assert pg_temp.refunded_from_ledger(v_order) = (select total_minor from public.orders where id = v_order)
     and (select count(*) from private.refunds where order_id = v_order) = 1,
    'FA-M1: one refund of what was paid';
end
$$;
select pg_temp.check_invariants('FA-M1');

-- ═══ INT-1: a return refund on top of the refund that cancelling gives ════

-- (a) Return first, then cancel: before delivery there is no return, only the cancellation.
select pg_temp.remember('int1a', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'int-int1a-01')::text);
select pg_temp.pay(current_setting('t.int1a')::uuid);
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 2)',
                              pg_temp.item(current_setting('t.int1a')::uuid, 'libreta-tapa-dura-a5')),
                       'withdraw_before_delivery');
select public.cancel_order(current_setting('t.int1a')::uuid) ->> 'status' as int1a_cancelled;
reset role;

-- (b) A delivered order, returned in full and refunded: it cannot be
-- cancelled, and no other path can pay those units again.
select pg_temp.remember('int1b', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'int-int1b-01')::text);
select pg_temp.pay(current_setting('t.int1b')::uuid);
select pg_temp.deliver(current_setting('t.int1b')::uuid);
select pg_temp.remember('int1b_item', pg_temp.item(current_setting('t.int1b')::uuid, 'libreta-tapa-dura-a5')::text);
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.remember('int1b_ret', public.request_return(current_setting('t.int1b_item')::uuid, 'withdrawal', 2)::text);
-- Two returns of the same two units: the second is refused.
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 1)', current_setting('t.int1b_item')),
                       'invalid_quantity');
reset role;
select pg_temp.receive(current_setting('t.int1b_ret')::uuid);
select pg_temp.login('central@yuntera.example');
select (public.ops_complete_return(current_setting('t.int1b_ret')::uuid) ->> 'refund_minor')::bigint as int1b_refund;
select pg_temp.refused(format('select public.cancel_order(%L)', current_setting('t.int1b')), 'too_late_to_cancel');
reset role;
-- Even a path that skipped the functions is stopped by the register.
select pg_temp.refused(format('select private.post_order_refund(%L)', current_setting('t.int1b')),
                       'order_not_refundable');
select pg_temp.refused(format(
  'select private.refund_units(%L, ''return'', gen_random_uuid(), ''[{"order_item_id": "%s", "quantity": 1}]'')',
  current_setting('t.int1b'), current_setting('t.int1b_item')), 'refund_exceeds_payment');
do $$
declare
  v_order uuid := current_setting('t.int1b')::uuid;
begin
  assert pg_temp.refunded_from_ledger(v_order) = (select items_total_minor from public.orders where id = v_order),
    'INT-1: the two units, once (shipping was a service delivered)';
end
$$;
select pg_temp.check_invariants('INT-1');

-- ═══ DTA-3 and INT-M1: re-opening a refunded return to refund it again ════

select pg_temp.remember('dta3', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'int-dta3-001')::text);
select pg_temp.pay(current_setting('t.dta3')::uuid);
select pg_temp.deliver(current_setting('t.dta3')::uuid);
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.remember('dta3_ret', public.request_return(
  pg_temp.item(current_setting('t.dta3')::uuid, 'libreta-tapa-dura-a5'), 'damaged', 1,
  'La tapa llegó doblada y con una mancha.')::text);
reset role;

-- Support cannot move a claim by writing its status: not to approve it…
select pg_temp.login('integridad-soporte@yuntera.example');
select pg_temp.refused(format('update public.return_requests set status = ''approved'' where id = %L',
                              current_setting('t.dta3_ret')), 'forbidden');
select public.ops_decide_return(current_setting('t.dta3_ret')::uuid, true, 'Foto recibida.');
select public.ops_receive_return(current_setting('t.dta3_ret')::uuid, false, 'Llegó dañado.');
select (public.ops_complete_return(current_setting('t.dta3_ret')::uuid) ->> 'refund_minor')::bigint as dta3_refund;
-- …and not to re-open it once refunded.
select pg_temp.refused(format('update public.return_requests set status = ''approved'', resolved_at = null where id = %L',
                              current_setting('t.dta3_ret')), 'forbidden');
select pg_temp.refused(format('select public.ops_complete_return(%L)', current_setting('t.dta3_ret')),
                       'invalid_return_state');
reset role;
-- Refunded is final, whoever writes.
select pg_temp.refused(format('update public.return_requests set status = ''approved'' where id = %L',
                              current_setting('t.dta3_ret')), 'invalid_return_state');
-- The same return cannot be registered twice, and a refund outside the register is refused at commit.
select pg_temp.refused(format(
  'select private.refund_units(%L, ''return'', %L, ''[{"order_item_id": "%s", "quantity": 1}]'')',
  current_setting('t.dta3'), current_setting('t.dta3_ret'),
  pg_temp.item(current_setting('t.dta3')::uuid, 'libreta-tapa-dura-a5')), '23505');
savepoint unregistered;
do $$
declare
  v_tx uuid;
begin
  insert into public.ledger_transactions (kind, order_id, memo)
  values ('return_refund', current_setting('t.dta3')::uuid, 'Reembolso a mano') returning id into v_tx;
  insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
    (v_tx, private.ledger_account('refunds_payable'), -390000),
    (v_tx, private.ledger_account('commission_revenue'), 390000);
end
$$;
select pg_temp.refused('set constraints all immediate', 'refund_not_registered');
rollback to savepoint unregistered;
do $$
declare
  v_order uuid := current_setting('t.dta3')::uuid;
begin
  assert (select count(*) from public.ledger_transactions where order_id = v_order and kind = 'return_refund') = 1
     and (select count(*) from private.outbox_events
          where topic = 'refund.requested' and payload ->> 'return_request_id' = current_setting('t.dta3_ret')) = 1,
    'DTA-3: one refund for the one return';
  assert (select restocked = false from public.return_requests where id = current_setting('t.dta3_ret')::uuid),
    'DTA-3: a damaged return is not put back on sale';
end
$$;
select pg_temp.check_invariants('DTA-3 / INT-M1');

-- ═══ INT-2: a refund before the goods are delivered or returned ═══════════

select pg_temp.remember('int2', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'int-int2-001')::text);
select pg_temp.pay(current_setting('t.int2')::uuid);
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 1)',
                              pg_temp.item(current_setting('t.int2')::uuid, 'parlante-bluetooth-nimbo-ola')),
                       'withdraw_before_delivery');
select pg_temp.refused(format('select public.request_return(%L, ''damaged'', 1, ''Nunca llegó el producto.'')',
                              pg_temp.item(current_setting('t.int2')::uuid, 'parlante-bluetooth-nimbo-ola')),
                       'not_delivered_yet');
reset role;
select pg_temp.deliver(current_setting('t.int2')::uuid);
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.remember('int2_ret', public.request_return(
  pg_temp.item(current_setting('t.int2')::uuid, 'parlante-bluetooth-nimbo-ola'), 'withdrawal', 1)::text);
reset role;
-- Approved at once, as the law gives the right; refunded only once it is back.
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.ops_complete_return(%L)', current_setting('t.int2_ret')),
                       'return_not_received');
reset role;
do $$
declare
  v_sku uuid := (select sku_id from public.offers where id = pg_temp.offer('parlante-bluetooth-nimbo-ola'));
  v_before integer := (select on_hand from public.stock_levels l join public.warehouses w on w.id = l.warehouse_id
                       where w.code = 'SJO1' and l.sku_id = v_sku);
begin
  perform pg_temp.receive(current_setting('t.int2_ret')::uuid);
  assert (select on_hand from public.stock_levels l join public.warehouses w on w.id = l.warehouse_id
          where w.code = 'SJO1' and l.sku_id = v_sku) = v_before + 1,
    'INT-2: a returned unit in good condition is back on sale';
  assert exists (select 1 from public.stock_movements m where m.reason = 'return'
                 and m.reference_id = current_setting('t.int2_ret')::uuid), 'INT-2: with a stock movement';
end
$$;
select pg_temp.login('central@yuntera.example');
select (public.ops_complete_return(current_setting('t.int2_ret')::uuid) ->> 'refund_minor')::bigint as int2_refund;
reset role;
select pg_temp.check_invariants('INT-2');

-- ═══ FA-2 and INT-3: more returned units than the line has ═════════════════
-- The two-session race is in contract.integrity.test.ts; here the sequential
-- form, and the table's own backstop.

select pg_temp.remember('fa2', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'int-fa2-0001')::text);
select pg_temp.pay(current_setting('t.fa2')::uuid);
select pg_temp.deliver(current_setting('t.fa2')::uuid);
select pg_temp.remember('fa2_item', pg_temp.item(current_setting('t.fa2')::uuid, 'libreta-tapa-dura-a5')::text);
select pg_temp.login('integridad1@yuntera.example');
select public.request_return(current_setting('t.fa2_item')::uuid, 'withdrawal', 1) is not null as fa2_first;
select pg_temp.refused(format('select public.request_return(%L, ''withdrawal'', 1)', current_setting('t.fa2_item')),
                       'invalid_quantity');
reset role;
select pg_temp.refused(format(
  'insert into public.return_requests (order_item_id, user_id, kind, quantity, status) '
  'select %L, user_id, ''withdrawal'', 1, ''approved'' from public.orders where id = %L',
  current_setting('t.fa2_item'), current_setting('t.fa2')), 'invalid_quantity');
select pg_temp.check_invariants('FA-2 / INT-3');

-- ═══ FA-3: unpaid orders reserving all stock ═══════════════════════════════

do $$
declare
  v_offer uuid := pg_temp.offer('rompecabezas-volcanes-500');
  v_available integer := (select available_quantity from public.offers where id = v_offer);
begin
  perform pg_temp.remember('fa3_available', v_available::text);
  -- Ten of one product is the most one account may hold unpaid (as in one order).
  perform pg_temp.place('integridad2@yuntera.example', pg_temp.items('rompecabezas-volcanes-500:10'),
                        'sinpe_movil', 'int-fa3-0001');
  begin
    perform pg_temp.place('integridad2@yuntera.example', pg_temp.items('rompecabezas-volcanes-500:4'),
                          'sinpe_movil', 'int-fa3-0002');
    raise exception 'FA-3: a second unpaid order took more of the same product';
  exception when others then
    if sqlerrm <> 'offer_held_limit' then raise; end if;
  end;
  assert (select available_quantity from public.offers where id = v_offer) = v_available - 10,
    'FA-3: the rest stays on sale';
  -- Other products are fine, up to three unpaid orders.
  perform pg_temp.place('integridad2@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:5'),
                        'sinpe_movil', 'int-fa3-0003');
  perform pg_temp.place('integridad2@yuntera.example', pg_temp.items('cafe-molido-tarrazu-340g:5'),
                        'bank_transfer', 'int-fa3-0004');
  begin
    perform pg_temp.place('integridad2@yuntera.example', pg_temp.items('cafe-molido-tarrazu-340g:1'),
                          'sinpe_movil', 'int-fa3-0005');
    raise exception 'FA-3: a fourth unpaid order was accepted';
  exception when others then
    if sqlerrm <> 'too_many_unpaid_orders' then raise; end if;
  end;
  -- A retry of an order already placed still gets its answer.
  assert pg_temp.place('integridad2@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:5'),
                       'sinpe_movil', 'int-fa3-0003') is not null, 'FA-3: a retry is answered';
  -- Paying one frees a place.
  perform pg_temp.pay((select id from public.orders where idempotency_key = 'int-fa3-0003'));
  perform pg_temp.place('integridad2@yuntera.example', pg_temp.items('cafe-molido-tarrazu-340g:1'),
                        'sinpe_movil', 'int-fa3-0006');
  -- No further unpaid order on top of more than thirty units held in all.
  perform pg_temp.pay((select id from public.orders where idempotency_key = 'int-fa3-0006'));
  begin
    perform pg_temp.place('integridad2@yuntera.example',
      pg_temp.items('libreta-tapa-dura-a5:10', 'cafe-molido-tarrazu-340g:10', 'botella-termica-sendero-750ml:10'),
      'sinpe_movil', 'int-fa3-0007');
    raise exception 'FA-3: more than thirty units were held unpaid';
  exception when others then
    if sqlerrm <> 'too_many_held_units' then raise; end if;
  end;
end
$$;
-- REV-2: an honest first order of more than thirty units goes through, by
-- card too (it waits for the gateway as 'pending_payment'): one order is held
-- only to the per-order limits. A second unpaid order on top of it is refused,
-- and the refusal names the units already held.
select pg_temp.shopper('integridad-grande@yuntera.example', 'Prueba Pedido Grande');
do $$
declare
  v_detail text;
begin
  assert pg_temp.place('integridad-grande@yuntera.example',
    pg_temp.items('libreta-tapa-dura-a5:8', 'bombillo-led-9w-4u:8', 'parlante-bluetooth-nimbo-ola:8',
                  'cafe-molido-tarrazu-340g:8'),
    'card', 'int-rev2-0001') is not null, 'REV-2: a 32-unit first order by card is accepted';
  begin
    perform pg_temp.place('integridad-grande@yuntera.example', pg_temp.items('rompecabezas-volcanes-500:1'),
                          'sinpe_movil', 'int-rev2-0002');
    raise exception 'REV-2: a second unpaid order on top of 32 held units';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm <> 'too_many_held_units' then raise; end if;
    assert v_detail = '32', format('REV-2: the detail is the units already held, got %s', v_detail);
  end;
end
$$;
-- Cash on delivery from an account that has never received an order: two at a time.
do $$
begin
  perform pg_temp.place('integridad3@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:1'),
                        'cash_on_delivery', 'int-fa3-cod1');
  perform pg_temp.place('integridad3@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:1'),
                        'cash_on_delivery', 'int-fa3-cod2');
  begin
    perform pg_temp.place('integridad3@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:1'),
                          'cash_on_delivery', 'int-fa3-cod3');
    raise exception 'FA-3: a third cash order from a new account';
  exception when others then
    if sqlerrm <> 'cod_limit_reached' then raise; end if;
  end;
  -- A shopper who has received orders before is not held to it.
  perform pg_temp.place('integridad1@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:1'),
                        'cash_on_delivery', 'int-fa3-cod4');
  perform pg_temp.place('integridad1@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:1'),
                        'cash_on_delivery', 'int-fa3-cod5');
  perform pg_temp.place('integridad1@yuntera.example', pg_temp.items('libreta-tapa-dura-a5:1'),
                        'cash_on_delivery', 'int-fa3-cod6');
end
$$;
select pg_temp.check_invariants('FA-3');

-- ═══ DTA-2: staff reading every shopper's delivery code ════════════════════

select pg_temp.remember('dta2', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'int-dta2-001')::text);
select pg_temp.pay(current_setting('t.dta2')::uuid);
select pg_temp.login('integridad-soporte@yuntera.example');
select pg_temp.refused('select delivery_pin from public.orders', '42703');
select pg_temp.refused('select code from private.delivery_codes', 'forbidden');
do $$
begin
  assert public.get_order((select order_number from public.orders where id = current_setting('t.dta2')::uuid))
         ->> 'delivery_pin' is null, 'DTA-2: staff do not see the code';
end
$$;
reset role;
select pg_temp.remember('dta2_code', pg_temp.code(current_setting('t.dta2')::uuid));
select pg_temp.login('integridad1@yuntera.example');
do $$
begin
  assert public.get_order((select order_number from public.orders where id = current_setting('t.dta2')::uuid))
         ->> 'delivery_pin' = current_setting('t.dta2_code'), 'DTA-2: the shopper reads their own code';
end
$$;
select pg_temp.refused('select code from private.delivery_codes', 'forbidden');
reset role;
select pg_temp.login('repartidor@yuntera.example');
select pg_temp.refused('select code from private.delivery_codes', 'forbidden');
reset role;

-- ═══ INT-5: cash on delivery on two stops ══════════════════════════════════

select pg_temp.remember('int5', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1', 'bombillo-led-9w-4u:1'), 'cash_on_delivery', 'int-int5-001')::text);
select pg_temp.pack(pg_temp.shipment(current_setting('t.int5')::uuid, 'platform'));
select pg_temp.pack(pg_temp.shipment(current_setting('t.int5')::uuid, 'seller'));
do $$
declare
  v_order uuid := current_setting('t.int5')::uuid;
  v_s1 uuid := pg_temp.shipment(v_order, 'platform');
  v_s2 uuid := pg_temp.shipment(v_order, 'seller');
  v_r1 uuid := pg_temp.route(v_s1);
  v_r2 uuid := pg_temp.route(v_s2);
begin
  assert (select cod_amount_minor from public.route_stops where route_id = v_r1)
         = (select total_minor from public.orders where id = v_order)
     and (select cod_amount_minor from public.route_stops where route_id = v_r2) = 0,
    'INT-5: the cash is on one stop';
  -- And the table refuses a second cash stop, whatever writes it.
  begin
    update public.route_stops set cod_amount_minor = (select total_minor from public.orders where id = v_order)
    where route_id = v_r2;
    raise exception 'INT-5: two stops carry the cash';
  exception when unique_violation then
    null;
  end;
end
$$;
select pg_temp.check_invariants('INT-5');

-- ═══ INT-7: confirming a payment on a cancelled order ══════════════════════

select pg_temp.remember('int7', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'int-int7-001')::text);
select pg_temp.login('integridad1@yuntera.example');
select public.cancel_order(current_setting('t.int7')::uuid) ->> 'status' as int7_cancelled;
reset role;
-- What a confirmation that waited behind the cancellation now finds.
select pg_temp.refused(format('select private.capture_payment(%L, ''manual:SINPE-778899'')', current_setting('t.int7')),
                       'order_not_payable');
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.ops_confirm_payment(%L, ''SINPE-778899'')', current_setting('t.int7')),
                       'order_not_payable');
reset role;
-- A second confirmation of a paid order: the same one is harmless, another one is refused.
do $$
declare
  v_order uuid := current_setting('t.dta2')::uuid;
  v_tx bigint := (select count(*) from public.ledger_transactions where order_id = current_setting('t.dta2')::uuid);
begin
  perform private.capture_payment(v_order, 'sandbox:' || v_order);
  assert (select count(*) from public.ledger_transactions where order_id = v_order) = v_tx,
    'INT-7: the same confirmation again books nothing';
  begin
    perform private.capture_payment(v_order, 'manual:OTRA-REF');
    raise exception 'INT-7: a second, different payment was silently accepted';
  exception when others then
    if sqlerrm <> 'order_not_payable' then raise; end if;
  end;
end
$$;
select pg_temp.check_invariants('INT-7');

-- ═══ INT-8: cancelling an order that is being prepared ═════════════════════

-- Packed: too late, even for staff. The parcel comes back through the
-- returned-parcel check-in instead (INT-12).
select pg_temp.remember('int8', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'int-int8-001')::text);
select pg_temp.pay(current_setting('t.int8')::uuid);
select pg_temp.pack(pg_temp.shipment(current_setting('t.int8')::uuid, 'platform'));
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.cancel_order(%L, ''Prueba'')', current_setting('t.int8')),
                       'too_late_to_cancel');
reset role;
-- Being picked: staff may stop it, and what was taken off the shelf goes back to it.
select pg_temp.remember('int8b', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:2'), 'card', 'int-int8-002')::text);
select pg_temp.pay(current_setting('t.int8b')::uuid);
do $$
declare
  v_ship uuid := pg_temp.shipment(current_setting('t.int8b')::uuid, 'platform');
  v_task public.pick_tasks%rowtype;
  v_bin_before integer;
  v_on_hand_before integer;
begin
  select * into v_task from public.pick_tasks where shipment_id = v_ship;
  select quantity into v_bin_before from public.bin_stock
  where location_id = v_task.location_id and sku_id = v_task.sku_id and seller_id = v_task.seller_id;
  select on_hand into v_on_hand_before from public.stock_levels
  where warehouse_id = v_task.warehouse_id and sku_id = v_task.sku_id and seller_id = v_task.seller_id;
  perform pg_temp.act('central@yuntera.example');
  perform public.wms_start_picking(v_ship);
  perform public.wms_confirm_pick(v_task.id, 2);
  perform public.cancel_order(current_setting('t.int8b')::uuid, 'El cliente llamó para cancelar');
  perform pg_temp.logout();
  assert (select quantity from public.bin_stock
          where location_id = v_task.location_id and sku_id = v_task.sku_id and seller_id = v_task.seller_id)
         = v_bin_before, 'INT-8: the picked units are back on their shelf';
  assert (select on_hand from public.stock_levels
          where warehouse_id = v_task.warehouse_id and sku_id = v_task.sku_id and seller_id = v_task.seller_id)
         = v_on_hand_before, 'INT-8: nothing left the building';
  assert (select status from public.orders where id = current_setting('t.int8b')::uuid) = 'refunded',
    'INT-8: refunded';
end
$$;
select pg_temp.check_invariants('INT-8');

-- ═══ INT-9 and FA-10: the code's attempt limit, per order ══════════════════

select pg_temp.remember('int9', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1', 'bombillo-led-9w-4u:1'), 'card', 'int-int9-001')::text);
select pg_temp.pay(current_setting('t.int9')::uuid);
select pg_temp.pack(pg_temp.shipment(current_setting('t.int9')::uuid, 'platform'));
select pg_temp.pack(pg_temp.shipment(current_setting('t.int9')::uuid, 'seller'));
do $$
declare
  v_order uuid := current_setting('t.int9')::uuid;
  v_s1 uuid := pg_temp.shipment(v_order, 'platform');
  v_s2 uuid := pg_temp.shipment(v_order, 'seller');
  v_route uuid := pg_temp.route(v_s1, v_s2);
  v_wrong text := lpad(((pg_temp.code(v_order)::integer + 1) % 10000)::text, 4, '0');
  v_result jsonb;
  v_left integer;
begin
  -- Three wrong at the first parcel, two at the second: five in all, for the order.
  for n in 1..3 loop
    v_result := pg_temp.door(pg_temp.stop(v_route, v_s1), v_wrong);
  end loop;
  v_result := pg_temp.door(pg_temp.stop(v_route, v_s2), v_wrong);
  assert v_result ->> 'error' = 'wrong_pin' and (v_result ->> 'attempts_left')::integer = 1,
    format('INT-9: the second parcel shares the order''s count: %s', v_result);
  v_result := pg_temp.door(pg_temp.stop(v_route, v_s2), v_wrong);
  -- REV-7: the attempt that locks the order says so at once, so the driver
  -- is told to call Central instead of "0 attempts left".
  assert v_result ->> 'error' = 'pin_locked' and (v_result ->> 'attempts_left')::integer = 0,
    format('REV-7: the fifth wrong code reports the lock: %s', v_result);
  -- Locked: even the right code is refused now, at either parcel.
  assert pg_temp.door(pg_temp.stop(v_route, v_s1), pg_temp.code(v_order)) ->> 'error' = 'pin_locked',
    'INT-9: the order is locked';
  perform pg_temp.act('repartidor@yuntera.example');
  select (s ->> 'pin_attempts_left')::integer into v_left
  from jsonb_array_elements(public.driver_today() -> 'routes') r, jsonb_array_elements(r -> 'stops') s
  where (s ->> 'stop_id')::uuid = pg_temp.stop(v_route, v_s1);
  assert v_left = 0, 'INT-9: the driver''s screen reads the same counter';
  -- A fresh route does not bring fresh attempts.
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_s1), 'nobody_home');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_s2), 'nobody_home');
  perform pg_temp.logout();
  perform pg_temp.remember('int9_route2', pg_temp.route(v_s1)::text);
  assert pg_temp.door(pg_temp.stop(current_setting('t.int9_route2')::uuid, v_s1), v_wrong) ->> 'error' = 'pin_locked',
    'FA-10: re-routing does not reset the count';
  -- Staff can see it happened; the shopper's code stays theirs.
  assert exists (select 1 from public.order_events e where e.order_id = v_order and not e.visible_to_customer
                 and e.note like 'Código de entrega bloqueado%'), 'INT-9: an event for staff';
  assert exists (select 1 from private.outbox_events where topic = 'delivery_code.locked'
                 and payload ->> 'order_id' = v_order::text), 'INT-9: and an alert';
  assert (select count(*) from private.delivery_code_attempts a where a.order_id = v_order
          and a.driver_id is not null) = 5, 'INT-9: every wrong code is logged with the driver';
end
$$;
select pg_temp.login('repartidor@yuntera.example');
select pg_temp.refused(format('select public.ops_release_delivery_code(%L, ''Liberado'')', current_setting('t.int9')),
                       'forbidden');
reset role;
select pg_temp.remember('int9_old_code', pg_temp.code(current_setting('t.int9')::uuid));
select pg_temp.login('integridad-soporte@yuntera.example');
do $$
declare
  v jsonb := public.ops_delivery_code(current_setting('t.int9')::uuid);
begin
  assert (v ->> 'locked')::boolean and (v ->> 'attempts_left')::integer = 0 and not v ? 'code',
    format('INT-9: staff see the lock, not the code: %s', v);
  perform public.ops_release_delivery_code(current_setting('t.int9')::uuid,
    'La clienta confirmó por teléfono que espera el paquete.');
  assert not (public.ops_delivery_code(current_setting('t.int9')::uuid) ->> 'locked')::boolean, 'INT-9: released';
end
$$;
select pg_temp.refused(format('select public.ops_release_delivery_code(%L, ''Otra vez'')', current_setting('t.int9')),
                       'delivery_code_not_locked');
reset role;
select pg_temp.remember('int9_new_code', pg_temp.code(current_setting('t.int9')::uuid));
select pg_temp.login('integridad1@yuntera.example');
do $$
begin
  -- The shopper reads the new code where they read the old one.
  assert public.get_order((select order_number from public.orders where id = current_setting('t.int9')::uuid))
         ->> 'delivery_pin' = current_setting('t.int9_new_code'), 'INT-9: the shopper has the new code';
end
$$;
reset role;
do $$
declare
  v_order uuid := current_setting('t.int9')::uuid;
  v_s1 uuid := pg_temp.shipment(v_order, 'platform');
begin
  assert (pg_temp.door(pg_temp.stop(current_setting('t.int9_route2')::uuid, v_s1), pg_temp.code(v_order)) ->> 'ok')::boolean,
    'INT-9: the new code delivers';
end
$$;
select pg_temp.check_invariants('INT-9 / FA-10');

-- ═══ INT-12: a parcel that came back ═══════════════════════════════════════

-- The second parcel of the order above failed and goes back to the seller,
-- who checks it in: their unit is back in their stock and the shopper gets
-- back what they paid for it. The order, whose other parcel arrived, keeps the
-- status it had: an order is "delivered" only as a whole (seller payouts
-- already start their hold from the last parcel, see seller_order_settled_at).
do $$
declare
  v_order uuid := current_setting('t.int9')::uuid;
  v_s2 uuid := pg_temp.shipment(v_order, 'seller');
  v_item uuid := pg_temp.item(v_order, 'bombillo-led-9w-4u');
  v_ship public.shipments%rowtype;
  v_on_hand integer;
  v_result jsonb;
begin
  select * into v_ship from public.shipments where id = v_s2;
  select on_hand into v_on_hand from public.stock_levels l
  where l.warehouse_id = v_ship.origin_warehouse_id
    and l.sku_id = (select sku_id from public.order_items where id = v_item);
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_s2);
  perform pg_temp.act('integridad1@yuntera.example');
  begin
    perform public.wms_receive_returned_shipment(v_s2);
    raise exception 'INT-12: a shopper checked in a parcel';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  perform pg_temp.act('vendedor@yuntera.example');
  v_result := public.wms_receive_returned_shipment(v_s2, true, null);
  perform pg_temp.logout();
  assert (select status from public.shipments where id = v_s2) = 'returned', 'INT-12: returned';
  assert (select on_hand from public.stock_levels l where l.warehouse_id = v_ship.origin_warehouse_id
          and l.sku_id = (select sku_id from public.order_items where id = v_item)) = v_on_hand + 1,
    'INT-12: back in stock';
  assert (v_result ->> 'refund_minor')::bigint = (select unit_price_minor from public.order_items where id = v_item),
    format('INT-12: the unit is refunded: %s', v_result);
  assert v_result ->> 'order_status' = 'shipped', format('INT-12: the order is not cancelled: %s', v_result);
  assert (select status from public.payments where order_id = v_order) = 'partially_refunded',
    'INT-12: the payment is partly refunded';
  perform pg_temp.act('vendedor@yuntera.example');
  begin
    perform public.wms_receive_returned_shipment(v_s2);
    raise exception 'INT-12: checked in twice';
  exception when others then
    if sqlerrm <> 'shipment_not_returning' then raise; end if;
  end;
  perform pg_temp.logout();
end
$$;
-- That unit cannot be refunded a second time by any path, even where the
-- order's payment would still cover it.
select pg_temp.refused(format(
  'select private.refund_units(%L, ''return'', gen_random_uuid(), ''[{"order_item_id": "%s", "quantity": 1}]'')',
  current_setting('t.int9'), pg_temp.item(current_setting('t.int9')::uuid, 'bombillo-led-9w-4u')),
  'refund_exceeds_purchase');
-- An order none of whose parcels arrived is cancelled once they are all back.
select pg_temp.remember('int12', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'int-int12-01')::text);
select pg_temp.pay(current_setting('t.int12')::uuid);
do $$
declare
  v_order uuid := current_setting('t.int12')::uuid;
  v_ship uuid := pg_temp.shipment(v_order, 'platform');
  v_route uuid;
  v_result jsonb;
begin
  perform pg_temp.pack(v_ship);
  v_route := pg_temp.route(v_ship);
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_ship), 'nobody_home');
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_ship);
  perform pg_temp.act('bodega@yuntera.example');
  v_result := public.wms_receive_returned_shipment(v_ship, false, 'Caja mojada');
  perform pg_temp.logout();
  assert v_result ->> 'order_status' = 'cancelled', format('INT-12: cancelled: %s', v_result);
  assert (v_result ->> 'refund_minor')::bigint = (select items_total_minor from public.orders where id = v_order),
    'INT-12: the goods are refunded';
  assert exists (select 1 from public.stock_movements where reference_id = v_ship and reason = 'damage'),
    'INT-12: a damaged parcel is recorded, not restocked';
end
$$;
select pg_temp.check_invariants('INT-12');

-- ═══ REV-1: cash on delivery and a parcel that came back ══════════════════
-- Cash is collected once, at the first parcel handed over, for what is owed
-- then: the total less the goods of parcels already back or on their way
-- back. Whatever the order of events, what the shopper ends up paying is the
-- goods delivered plus shipping.

-- The goods of the order that reached the shopper, plus shipping.
create function pg_temp.owed_for_delivered(p_order uuid) returns bigint
language sql as $$
  select o.shipping_minor + coalesce((
    select sum(i.unit_price_minor * si.quantity)
    from public.shipments s join public.shipment_items si on si.shipment_id = s.id
    join public.order_items i on i.id = si.order_item_id
    where s.order_id = p_order and s.status = 'delivered'), 0)
  from public.orders o where o.id = p_order
$$;

-- What the shopper paid in the end: cash collected less what went back.
create function pg_temp.paid_in_the_end(p_order uuid) returns bigint
language sql as $$
  select coalesce((select sum(rs.cod_collected_minor) from public.route_stops rs
                   join public.shipments s on s.id = rs.shipment_id where s.order_id = p_order), 0)
       - private.refunded_minor(p_order)
       + coalesce((select sum(f.amount_minor) from private.refunds f join public.ledger_entries e
                   on e.transaction_id = f.ledger_transaction_id
                   join public.ledger_accounts a on a.id = e.account_id
                   where f.order_id = p_order and a.code = 'driver_cash'), 0)
$$;

-- (A) The first parcel fails and is checked back in; the second is then
-- routed and delivered: it collects its own goods plus shipping, not the total.
select pg_temp.shopper('integridad-cod-a@yuntera.example', 'Prueba Efectivo A');
select pg_temp.remember('rev1a', pg_temp.place('integridad-cod-a@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1', 'bombillo-led-9w-4u:1'), 'cash_on_delivery', 'int-rev1a-001')::text);
do $$
declare
  v_order uuid := current_setting('t.rev1a')::uuid;
  v_s1 uuid := pg_temp.shipment(v_order, 'platform');
  v_s2 uuid := pg_temp.shipment(v_order, 'seller');
  v_speaker bigint := (select unit_price_minor from public.order_items
                       where id = pg_temp.item(v_order, 'parlante-bluetooth-nimbo-ola'));
  v_total bigint := (select total_minor from public.orders where id = v_order);
  v_r1 uuid;
  v_r2 uuid;
  v_result jsonb;
begin
  perform pg_temp.pack(v_s1);
  perform pg_temp.pack(v_s2);
  v_r1 := pg_temp.route(v_s1);
  assert (select cod_amount_minor from public.route_stops where route_id = v_r1) = v_total,
    'REV-1A: the first stop plans the whole cash';
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_r1, v_s1), 'nobody_home');
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_s1);
  perform pg_temp.act('bodega@yuntera.example');
  v_result := public.wms_receive_returned_shipment(v_s1, true, null);
  assert (v_result ->> 'refund_minor')::bigint = 0, 'REV-1A: nothing was paid, nothing is refunded';
  v_r2 := pg_temp.route(v_s2);
  assert (select cod_amount_minor from public.route_stops where route_id = v_r2) = v_total - v_speaker,
    format('REV-1A: the second stop collects the total less the speaker that came back: %s',
           (select cod_amount_minor from public.route_stops where route_id = v_r2));
  v_result := pg_temp.door(pg_temp.stop(v_r2, v_s2), pg_temp.code(v_order));
  assert (v_result ->> 'ok')::boolean, format('REV-1A: delivered: %s', v_result);
  assert (select cod_collected_minor from public.route_stops where route_id = v_r2) = v_total - v_speaker,
    'REV-1A: the driver took the bulb and shipping';
  assert pg_temp.paid_in_the_end(v_order) = pg_temp.owed_for_delivered(v_order),
    format('REV-1A: paid %s for goods delivered worth %s', pg_temp.paid_in_the_end(v_order),
           pg_temp.owed_for_delivered(v_order));
  -- The speaker is in the register, settled at the door: it can never be
  -- refunded again, and nothing is sent to the shopper for it.
  assert (select count(*) from private.refunds where order_id = v_order and reason = 'parcel_returned'
          and source_id = v_s1 and amount_minor = v_speaker) = 1, 'REV-1A: the speaker is registered once';
  assert not exists (select 1 from private.outbox_events where topic = 'refund.requested'
                     and payload ->> 'order_id' = v_order::text), 'REV-1A: no money is sent back';
  assert exists (select 1 from private.outbox_events where topic = 'refund.settled_at_door'
                 and payload ->> 'order_id' = v_order::text), 'REV-1A: the settlement is recorded';
  -- The driver's cash account holds exactly what they took for this order.
  assert (select sum(e.amount_minor) from public.ledger_entries e
          join public.ledger_transactions t on t.id = e.transaction_id
          join public.ledger_accounts a on a.id = e.account_id
          where t.order_id = v_order and a.code = 'driver_cash') = v_total - v_speaker,
    'REV-1A: the books hold what the driver took';
end
$$;
select pg_temp.check_invariants('REV-1A');

-- (B) Both parcels on one route, the cash planned on the first. The driver
-- delivers the second first: the cash moves there, and a wrong amount is
-- answered with the right one. The first then fails and comes back: its
-- goods are refunded. A parcel is never handed over for nothing.
select pg_temp.shopper('integridad-cod-b@yuntera.example', 'Prueba Efectivo B');
select pg_temp.remember('rev1b', pg_temp.place('integridad-cod-b@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1', 'bombillo-led-9w-4u:1'), 'cash_on_delivery', 'int-rev1b-001')::text);
do $$
declare
  v_order uuid := current_setting('t.rev1b')::uuid;
  v_s1 uuid := pg_temp.shipment(v_order, 'platform');
  v_s2 uuid := pg_temp.shipment(v_order, 'seller');
  v_total bigint := (select total_minor from public.orders where id = v_order);
  v_speaker bigint := (select unit_price_minor from public.order_items
                       where id = pg_temp.item(v_order, 'parlante-bluetooth-nimbo-ola'));
  v_route uuid;
  v_result jsonb;
begin
  perform pg_temp.pack(v_s1);
  perform pg_temp.pack(v_s2);
  v_route := pg_temp.route(v_s1, v_s2);
  assert (select cod_amount_minor from public.route_stops where id = pg_temp.stop(v_route, v_s2)) = 0,
    'REV-1B: the plan puts the cash on the first stop';
  perform pg_temp.act('repartidor@yuntera.example');
  v_result := public.driver_complete_stop(pg_temp.stop(v_route, v_s2), pg_temp.code(v_order), 'Recibe Prueba', 0);
  perform pg_temp.logout();
  assert v_result ->> 'error' = 'cod_amount_mismatch' and (v_result ->> 'expected_minor')::bigint = v_total,
    format('REV-1B: the first parcel handed over carries the cash: %s', v_result);
  assert (select cod_amount_minor from public.route_stops where id = pg_temp.stop(v_route, v_s1)) = 0
     and (select cod_amount_minor from public.route_stops where id = pg_temp.stop(v_route, v_s2)) = v_total,
    'REV-1B: the plan moved to the stop at the door';
  v_result := pg_temp.door(pg_temp.stop(v_route, v_s2), pg_temp.code(v_order));
  assert (v_result ->> 'ok')::boolean, format('REV-1B: delivered with the cash: %s', v_result);
  assert (select status from public.payments where order_id = v_order) = 'captured', 'REV-1B: paid';
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_s1), 'refused');
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_s1);
  perform pg_temp.act('bodega@yuntera.example');
  v_result := public.wms_receive_returned_shipment(v_s1, true, null);
  perform pg_temp.logout();
  assert (v_result ->> 'refund_minor')::bigint = v_speaker, format('REV-1B: the speaker is refunded: %s', v_result);
  assert pg_temp.paid_in_the_end(v_order) = pg_temp.owed_for_delivered(v_order),
    format('REV-1B: paid %s for goods delivered worth %s', pg_temp.paid_in_the_end(v_order),
           pg_temp.owed_for_delivered(v_order));
end
$$;
select pg_temp.check_invariants('REV-1B');

-- (C) The first parcel is on its way back (not yet checked in) when the
-- second is delivered: the cash leaves it out, and checking it in afterwards
-- refunds nothing more. The warehouse sees it in its list of parcels to receive.
select pg_temp.shopper('integridad-cod-c@yuntera.example', 'Prueba Efectivo C');
select pg_temp.remember('rev1c', pg_temp.place('integridad-cod-c@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1', 'bombillo-led-9w-4u:1'), 'cash_on_delivery', 'int-rev1c-001')::text);
do $$
declare
  v_order uuid := current_setting('t.rev1c')::uuid;
  v_s1 uuid := pg_temp.shipment(v_order, 'platform');
  v_s2 uuid := pg_temp.shipment(v_order, 'seller');
  v_total bigint := (select total_minor from public.orders where id = v_order);
  v_speaker bigint := (select unit_price_minor from public.order_items
                       where id = pg_temp.item(v_order, 'parlante-bluetooth-nimbo-ola'));
  v_warehouse uuid := (select origin_warehouse_id from public.shipments where id = v_s1);
  v_route uuid;
  v_result jsonb;
begin
  perform pg_temp.pack(v_s1);
  perform pg_temp.pack(v_s2);
  v_route := pg_temp.route(v_s1, v_s2);
  perform pg_temp.act('repartidor@yuntera.example');
  perform public.driver_fail_stop(pg_temp.stop(v_route, v_s1), 'nobody_home');
  -- The cash follows to the live stop as soon as the first one fails.
  assert (select cod_amount_minor from public.route_stops where id = pg_temp.stop(v_route, v_s2)) = v_total,
    'REV-1C: the cash moved to the parcel still on the route';
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_return_shipment(v_s1);
  assert (select cod_amount_minor from public.route_stops where id = pg_temp.stop(v_route, v_s2))
         = v_total - v_speaker, 'REV-1C: and dropped by the goods on their way back';
  -- The warehouse's list of parcels coming back.
  perform pg_temp.act('bodega@yuntera.example');
  assert exists (select 1 from jsonb_array_elements(public.wms_returning_shipments(v_warehouse)) x
                 where x ->> 'shipment_id' = v_s1::text and (x ->> 'units')::integer = 1),
    'REV-8: the warehouse sees the parcel it is to receive';
  perform pg_temp.act('integridad-cod-c@yuntera.example');
  begin
    perform public.wms_returning_shipments(v_warehouse);
    raise exception 'REV-8: a shopper read the warehouse list';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  perform pg_temp.logout();
  v_result := pg_temp.door(pg_temp.stop(v_route, v_s2), pg_temp.code(v_order));
  assert (v_result ->> 'ok')::boolean, format('REV-1C: delivered: %s', v_result);
  perform pg_temp.act('bodega@yuntera.example');
  v_result := public.wms_receive_returned_shipment(v_s1, true, null);
  perform pg_temp.logout();
  assert (v_result ->> 'refund_minor')::bigint = 0, format('REV-1C: settled at the door, not again: %s', v_result);
  assert (select count(*) from private.refunds where order_id = v_order) = 1, 'REV-1C: one refund';
  assert pg_temp.paid_in_the_end(v_order) = pg_temp.owed_for_delivered(v_order),
    format('REV-1C: paid %s for goods delivered worth %s', pg_temp.paid_in_the_end(v_order),
           pg_temp.owed_for_delivered(v_order));
end
$$;
select pg_temp.check_invariants('REV-1C');

-- ═══ REV-4: an approved return whose goods never come back ════════════════

select pg_temp.remember('rev4', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'int-rev4-0001')::text);
select pg_temp.pay(current_setting('t.rev4')::uuid);
select pg_temp.deliver(current_setting('t.rev4')::uuid);
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.remember('rev4_ret', public.request_return(
  pg_temp.item(current_setting('t.rev4')::uuid, 'libreta-tapa-dura-a5'), 'withdrawal', 1)::text);
reset role;
select pg_temp.login('central@yuntera.example');
-- Closing needs a reason the shopper can read; approving twice is refused.
select pg_temp.refused(format('select public.ops_decide_return(%L, false, ''no'')', current_setting('t.rev4_ret')),
                       'reason_required');
select pg_temp.refused(format('select public.ops_decide_return(%L, true, null)', current_setting('t.rev4_ret')),
                       'invalid_return_state');
select public.ops_decide_return(current_setting('t.rev4_ret')::uuid, false,
                                'El cliente nunca entregó el producto para la recolección.');
reset role;
-- The unit is free for a later claim, and the shopper sees why the return closed.
select pg_temp.login('integridad1@yuntera.example');
select public.request_return(pg_temp.item(current_setting('t.rev4')::uuid, 'libreta-tapa-dura-a5'), 'damaged', 1,
                             'La tapa llegó despegada y no cierra.') is not null as rev4_claim;
do $$
declare
  v_returns jsonb := public.my_order_returns((select order_number from public.orders
                                              where id = current_setting('t.rev4')::uuid));
begin
  assert jsonb_array_length(v_returns) = 2, format('REV-5: the shopper sees both returns: %s', v_returns);
  assert exists (select 1 from jsonb_array_elements(v_returns) x where x ->> 'status' = 'rejected'
                 and x ->> 'resolution_note' like 'El cliente nunca%'), 'REV-5: with the reason it closed';
  assert exists (select 1 from jsonb_array_elements(v_returns) x where x ->> 'status' = 'requested'),
    'REV-5: and the new claim';
end
$$;
reset role;
-- Nobody else reads a shopper's returns, staff included (they have the queue).
select pg_temp.login('integridad2@yuntera.example');
select pg_temp.refused(format('select public.my_order_returns(%L)',
  (select order_number from public.orders where id = current_setting('t.rev4')::uuid)), 'order_not_found');
reset role;
select pg_temp.login('central@yuntera.example');
select pg_temp.refused(format('select public.my_order_returns(%L)',
  (select order_number from public.orders where id = current_setting('t.rev4')::uuid)), 'order_not_found');
reset role;
select pg_temp.check_invariants('REV-4');

-- ═══ REV-3: the price floor through the package or the category ═══════════

do $$
declare
  v_offer uuid;
  v_product uuid;
  v_sku uuid;
  v_detail text;
  v_min bigint;
begin
  select o.id, k.product_id, k.id into v_offer, v_product, v_sku
  from public.offers o join public.skus k on k.id = o.sku_id
  join public.sellers s on s.id = o.seller_id join public.products p on p.id = k.product_id
  where s.slug = 'tecnocasa' and o.fulfillment = 'platform' and p.status = 'active' and o.status = 'active'
  order by k.weight_grams, o.id limit 1;
  perform pg_temp.remember('rev3_offer', v_offer::text);

  -- The refusal says the lowest price that would be accepted, and that price is.
  perform pg_temp.act('vendedor@yuntera.example');
  begin
    perform public.seller_update_offer(v_offer, 100, 'active');
    raise exception 'REV-3: a price below the fees was accepted';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm <> 'price_below_fees' then raise; end if;
  end;
  v_min := v_detail::bigint;
  assert v_min > 100 and v_min % 100 = 0, format('REV-3: the detail is a price in whole colones: %s', v_detail);
  perform public.seller_update_offer(v_offer, v_min, 'active');
  begin
    perform public.seller_update_offer(v_offer, v_min - 100, 'active');
    raise exception 'REV-3: the minimum is not the minimum';
  exception when others then
    if sqlerrm <> 'price_below_fees' then raise; end if;
  end;

  -- A heavier, bigger package proposed for the listing cannot be approved
  -- while the price stays where it is.
  perform public.seller_update_listing(v_product, (select title from public.products where id = v_product),
    (select c.slug from public.categories c join public.products p on p.category_id = c.id where p.id = v_product),
    (select description from public.products where id = v_product),
    (select bullet_points from public.products where id = v_product),
    29000, 100, 50, 50, v_sku, true);
  perform pg_temp.act('central@yuntera.example');
  begin
    perform public.ops_review_listing_edit(
      (select id from public.product_change_requests where product_id = v_product and status = 'pending'), true, null);
    raise exception 'REV-3: a package change pushed the offer below its fees';
  exception when others then
    if sqlerrm <> 'price_below_fees' then raise; end if;
  end;
  perform pg_temp.logout();
  -- Nor by moving the listing to a category whose commission the price no
  -- longer covers (the category trigger, its own path). The target is a
  -- category in which this very offer would pay less than nothing.
  declare
    v_target uuid;
    v_before uuid := (select category_id from public.products where id = v_product);
  begin
    select c.id into v_target
    from public.categories c, public.offers o join public.skus k on k.id = o.sku_id
    where o.id = v_offer and c.id <> v_before
      and private.worst_unit_payout(o.price_minor, o.fulfillment, c.id, k.weight_grams,
                                    greatest(k.length_cm, k.width_cm, k.height_cm)) < 0
    order by c.slug limit 1;
    assert v_target is not null, 'REV-3: some category takes more than this price leaves';
    begin
      update public.products set category_id = v_target where id = v_product;
      raise exception 'REV-3: a category change pushed the offer below its fees';
    exception when others then
      if sqlerrm <> 'price_below_fees' then raise; end if;
    end;
    assert (select category_id from public.products where id = v_product) = v_before,
      'REV-3: the listing stays in its category';
  end;
  -- Nor by any other path: the variant's package.
  begin
    update public.skus set weight_grams = 29000, length_cm = 100, width_cm = 50, height_cm = 50 where id = v_sku;
    raise exception 'REV-3: a direct package change passed';
  exception when others then
    if sqlerrm <> 'price_below_fees' then raise; end if;
  end;
  -- A paused offer is checked when it is put back on sale.
  update public.offers set status = 'paused' where id = v_offer;
  update public.skus set weight_grams = 29000, length_cm = 100, width_cm = 50, height_cm = 50 where id = v_sku;
  begin
    update public.offers set status = 'active' where id = v_offer;
    raise exception 'REV-3: an offer below its fees went back on sale';
  exception when others then
    if sqlerrm <> 'price_below_fees' then raise; end if;
  end;
  assert not exists (
    select 1 from public.offers o join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
    where o.status = 'active'
      and private.worst_unit_payout(o.price_minor, o.fulfillment, p.category_id, k.weight_grams,
                                    greatest(k.length_cm, k.width_cm, k.height_cm)) < 0),
    'REV-3: no offer on sale pays less than its fees';
end
$$;
select pg_temp.check_invariants('REV-3');

-- ═══ INT-10: a payout paid after its order was refunded ════════════════════

update public.app_settings set value = '0' where key = 'payout_hold_days';
select pg_temp.remember('int10', pg_temp.place('integridad1@yuntera.example',
  pg_temp.items('parlante-bluetooth-nimbo-ola:1'), 'card', 'int-int10-01')::text);
select pg_temp.pay(current_setting('t.int10')::uuid);
select pg_temp.deliver(current_setting('t.int10')::uuid);
select pg_temp.login('central@yuntera.example', 'aal2');
select pg_temp.remember('int10_run',
  public.ops_create_payout_run(((now() at time zone 'UTC') - interval '6 hours')::date) ->> 'run_id');
reset role;
select pg_temp.remember('int10_payout', (
  select p.id::text from public.payouts p join public.sellers s on s.id = p.seller_id
  where p.run_id = current_setting('t.int10_run')::uuid and s.slug = 'tecnocasa'));
select pg_temp.check_invariants('INT-10, scheduled');
select pg_temp.login('integridad1@yuntera.example');
select pg_temp.remember('int10_ret', public.request_return(
  pg_temp.item(current_setting('t.int10')::uuid, 'parlante-bluetooth-nimbo-ola'), 'withdrawal', 1)::text);
reset role;
select pg_temp.receive(current_setting('t.int10_ret')::uuid);
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_complete_return(current_setting('t.int10_ret')::uuid) ->> 'seller_debit_minor' as int10_debit;
select pg_temp.refused(format('select public.ops_mark_payout_paid(%L, ''BNCR-INT10-01'')', current_setting('t.int10_payout')),
                       'payout_exceeds_balance');
-- Marked failed instead; a later run pays what is really owed.
select public.ops_mark_payout_failed(current_setting('t.int10_payout')::uuid,
  'Reembolso posterior a la corrida; se paga en la próxima.');
reset role;
do $$
begin
  assert (select count(*) from public.ledger_transactions t where t.kind = 'payout'
          and t.memo like '%' || (select reference from public.payouts where id = current_setting('t.int10_payout')::uuid)) = 0,
    'INT-10: nothing was paid out';
end
$$;
select pg_temp.check_invariants('INT-10');
update public.app_settings set value = '10' where key = 'payout_hold_days';

-- ═══ INT-11: receiving without an upper bound ══════════════════════════════

select pg_temp.login('vendedor@yuntera.example');
select pg_temp.remember('int11', public.seller_create_inbound(
  (select id from public.warehouses where code = 'SJO1'),
  (select id from public.sellers where slug = 'tecnocasa'),
  jsonb_build_array(
    jsonb_build_object('sku_id', (select sku_id from public.offers where id = pg_temp.offer('parlante-bluetooth-nimbo-ola')),
                       'quantity', 1),
    jsonb_build_object('sku_id', (select sku_id from public.offers where id = pg_temp.offer('teclado-mecanico-compacto-nimbo')),
                       'quantity', 2)),
  null)::text);
reset role;
select pg_temp.remember('int11_line1', (select l.id::text from public.inbound_shipment_lines l
  where l.inbound_shipment_id = current_setting('t.int11')::uuid and l.expected_quantity = 1));
select pg_temp.remember('int11_line2', (select l.id::text from public.inbound_shipment_lines l
  where l.inbound_shipment_id = current_setting('t.int11')::uuid and l.expected_quantity = 2));
select pg_temp.remember('int11_bin', (select wl.id::text from public.warehouse_locations wl
  join public.warehouses w on w.id = wl.warehouse_id where w.code = 'SJO1' and wl.active order by wl.code limit 1));
select pg_temp.login('bodega@yuntera.example');
select pg_temp.refused(format('select public.wms_receive(%L, 1000, 0, %L)',
                              current_setting('t.int11_line1'), current_setting('t.int11_bin')), 'over_receipt');
select public.wms_receive(current_setting('t.int11_line1')::uuid, 1, 0, current_setting('t.int11_bin')::uuid);
-- A double scan of the finished line, while the other line is still open.
select pg_temp.refused(format('select public.wms_receive(%L, 1, 0, %L)',
                              current_setting('t.int11_line1'), current_setting('t.int11_bin')), 'inbound_line_complete');
select pg_temp.refused(format('select public.wms_receive(%L, 2, 1, %L)',
                              current_setting('t.int11_line2'), current_setting('t.int11_bin')), 'over_receipt');
select public.wms_receive(current_setting('t.int11_line2')::uuid, 1, 1, current_setting('t.int11_bin')::uuid);
reset role;
do $$
begin
  assert (select status from public.inbound_shipments where id = current_setting('t.int11')::uuid) = 'received',
    'INT-11: complete when every line is';
  assert (select sum(received_quantity + damaged_quantity) from public.inbound_shipment_lines
          where inbound_shipment_id = current_setting('t.int11')::uuid) = 3, 'INT-11: exactly what was announced';
end
$$;
select pg_temp.check_invariants('INT-11');

-- ═══ INT-13: sales whose fees exceed the price ═════════════════════════════

select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format('select public.seller_update_offer(%L, 1, ''active'')',
                              pg_temp.offer('parlante-bluetooth-nimbo-ola')), 'price_below_fees');
reset role;
select pg_temp.remember('int13_offer', pg_temp.offer('parlante-bluetooth-nimbo-ola')::text);
select pg_temp.login('vendedor@yuntera.example');
-- A direct write is refused for lack of a privilege (082800); the same write
-- made as the table's owner, with the seller's token, meets the floor's
-- trigger, which holds on every path.
select pg_temp.refused(format('update public.offers set price_minor = 1 where id = %L',
                              current_setting('t.int13_offer')), 'forbidden');
reset role;
select pg_temp.refused(format('update public.offers set price_minor = 1 where id = %L',
                              current_setting('t.int13_offer')), 'price_below_fees');
select pg_temp.login('vendedor@yuntera.example');
-- A price that covers the fees is fine.
select public.seller_update_offer(pg_temp.offer('parlante-bluetooth-nimbo-ola'), 2700000, 'active');
reset role;
do $$
begin
  assert private.worst_unit_payout(1, 'seller', null, 100, 10) < 0, 'INT-13: one céntimo cannot pay its fees';
  assert private.worst_unit_payout(390000, 'platform',
           (select category_id from public.products where slug = 'libreta-tapa-dura-a5'), 400, 21) > 0,
    'INT-13: the cheapest product of the demo can';
end
$$;
select pg_temp.check_invariants('INT-13');

rollback;
