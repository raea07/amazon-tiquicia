-- Order and operations follow-ups (20261121084200_order_followups.sql):
--
--   1. Who may call the two new staff functions and the shopper's list.
--   2. Staff stop a packed parcel (ops_recall_shipment): on its own, on an
--      assigned route, and every parcel it must refuse.
--   3. The delivery fee when nobody went to the door: refunded with the goods
--      when the order ends cancelled and no parcel had an attempt; kept when
--      a parcel had a real attempt or another was delivered; nothing for a
--      cash order never paid; never twice, never more than was paid; the
--      credit note follows the delivery fee's document.
--   4. The shopper's order list and order page, the warehouse's list, the
--      console's routes.
--   5. A district moved back follows its canton.
--   6. Indexes, and a single closed day removed.
--
-- Who plays whom: central is an administrator; comprador3 is given one staff
-- role at a time; comprador is a shopper; the orders are this suite's own
-- (two shoppers it creates). Every check compares with the suite's own
-- fixtures or with what was there before, never with whole-database totals,
-- so it holds on a used database.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

create function pg_temp.refused_detail(p_sql text, p_code text) returns text
language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

create function pg_temp.staff_as(p_role public.staff_role) returns void
language sql as $$
  delete from public.staff_members
  where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
  insert into public.staff_members (user_id, role)
  select id, p_role from auth.users where email = 'comprador3@yuntera.example';
$$;

-- An order of this suite, placed, paid when asked, with its parcels packed.
create function pg_temp.packed_order(p_email text, p_items jsonb, p_method public.payment_method, p_key text)
returns uuid
language plpgsql as $$
declare
  v_order uuid;
  s uuid;
begin
  v_order := pg_temp.place(p_email, p_items, p_method, p_key);
  if p_method <> 'cash_on_delivery' then
    perform pg_temp.pay(v_order);
  end if;
  for s in select id from public.shipments where order_id = v_order and status = 'pending'
           order by created_at, id loop
    perform pg_temp.pack(s);
  end loop;
  return v_order;
end;
$$;

-- Stops a parcel as operations staff (comprador3, made ops below).
create function pg_temp.recall(p_shipment uuid, p_reason text default 'El cliente pidió cancelar') returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.act('comprador3@yuntera.example');
  v := public.ops_recall_shipment(p_shipment, p_reason);
  perform pg_temp.logout();
  return v;
end;
$$;

-- The warehouse checks a parcel in.
create function pg_temp.check_in(p_shipment uuid) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.act('bodega@yuntera.example');
  v := public.wms_receive_returned_shipment(p_shipment, true, null);
  perform pg_temp.logout();
  return v;
end;
$$;

create function pg_temp.fee_refunds(p_order uuid) returns bigint
language sql as $$
  select count(*) from private.refunds where order_id = p_order and reason = 'delivery_fee'
$$;

grant execute on function pg_temp.refused_detail(text, text), pg_temp.remember(text, text),
  pg_temp.items(variadic text[]), pg_temp.offer(text, text), pg_temp.stop(uuid, uuid),
  pg_temp.shipment(uuid, public.warehouse_kind) to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────

-- The zones as the seed has them (a used database may differ; this rolls back).
update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;
select pg_temp.remember('audit_from', (select coalesce(max(id), 0)::text from private.audit_log));
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.remember('platform', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.seed_invoicing_settings();
select pg_temp.staff_as('ops');
select pg_temp.shopper('seguimiento1@yuntera.example', 'Prueba Seguimiento Uno');
select pg_temp.shopper('seguimiento2@yuntera.example', 'Prueba Seguimiento Dos');

-- A: card, one parcel, packed: stopped on the shelf.
select pg_temp.remember('order_a', pg_temp.packed_order('seguimiento1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'seg-167-a')::text);
select pg_temp.remember('ship_a', pg_temp.shipment(current_setting('t.order_a')::uuid, 'platform')::text);
-- B: card, one parcel, on a route assigned but not started: stopped from the route.
select pg_temp.remember('order_b', pg_temp.packed_order('seguimiento1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'seg-167-b')::text);
select pg_temp.remember('ship_b', pg_temp.shipment(current_setting('t.order_b')::uuid, 'platform')::text);
-- C: card, taken off a route being driven (no attempt), then sent back.
select pg_temp.remember('order_c', pg_temp.packed_order('seguimiento1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'seg-167-c')::text);
select pg_temp.remember('ship_c', pg_temp.shipment(current_setting('t.order_c')::uuid, 'platform')::text);
-- D: card, the driver found nobody home (a real attempt), then sent back.
select pg_temp.remember('order_d', pg_temp.packed_order('seguimiento1@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'seg-167-d')::text);
select pg_temp.remember('ship_d', pg_temp.shipment(current_setting('t.order_d')::uuid, 'platform')::text);
-- E: cash on delivery, never paid: stopped on the shelf.
select pg_temp.remember('order_e', pg_temp.packed_order('seguimiento2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'cash_on_delivery', 'seg-167-e')::text);
select pg_temp.remember('ship_e', pg_temp.shipment(current_setting('t.order_e')::uuid, 'platform')::text);
-- F: card, two parcels (the warehouse's and a seller's): the seller's is
-- delivered, the warehouse's stopped.
select pg_temp.remember('order_f', pg_temp.packed_order('seguimiento2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1', 'bombillo-led-9w-4u:1'), 'card', 'seg-167-f')::text);
select pg_temp.remember('ship_f1', pg_temp.shipment(current_setting('t.order_f')::uuid, 'platform')::text);
select pg_temp.remember('ship_f2', pg_temp.shipment(current_setting('t.order_f')::uuid, 'seller')::text);

do $$ begin
  assert (select count(*) from public.shipments
          where order_id in (current_setting('t.order_a')::uuid, current_setting('t.order_b')::uuid,
                             current_setting('t.order_c')::uuid, current_setting('t.order_d')::uuid,
                             current_setting('t.order_e')::uuid, current_setting('t.order_f')::uuid)
            and status = 'packed') = 7,
    'fixture: seven packed parcels';
  assert (select shipping_minor from public.orders where id = current_setting('t.order_a')::uuid) > 0,
    'fixture: the order pays a delivery fee';
  assert current_setting('t.ship_f1') <> current_setting('t.ship_f2'), 'fixture: F has two parcels';
end $$;

-- Route one, assigned and not started, with B; route two, driven, with C and D.
select pg_temp.act('central@yuntera.example');
select pg_temp.remember('route_one', public.ops_create_route(
  private.cr_today(), current_setting('t.platform')::uuid,
  jsonb_build_array(jsonb_build_object('shipment_id', current_setting('t.ship_b'))),
  (select d.id from public.drivers d join auth.users u on u.id = d.user_id
   where u.email = 'repartidor@yuntera.example'))::text);
select pg_temp.logout();
select pg_temp.remember('route_two', pg_temp.route(current_setting('t.ship_c')::uuid,
                                                   current_setting('t.ship_d')::uuid, current_setting('t.ship_f2')::uuid)::text);
select pg_temp.remember('stop_b', pg_temp.stop(current_setting('t.route_one')::uuid, current_setting('t.ship_b')::uuid)::text);

-- ═══ 1. Who may call what ══════════════════════════════════════════════════

do $$
declare
  v_missing text;
begin
  select string_agg(f.fn, ', ') into v_missing
  from unnest(array['ops_recall_shipment', 'ops_remove_zone_closure_day', 'my_orders']) f (fn)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f.fn and p.prosecdef
                      and 'search_path=""' = any (p.proconfig)
                      and has_function_privilege('authenticated', p.oid, 'execute')
                      and not has_function_privilege('anon', p.oid, 'execute'));
  assert v_missing is null, format('who_may_call: not a signed-in function as documented: %s', v_missing);
  assert not has_function_privilege('authenticated', 'private.refund_delivery_fee(uuid)', 'execute')
         and not has_function_privilege('authenticated', 'private.order_had_door_attempt(uuid)', 'execute')
         and not has_function_privilege('anon', 'private.colones(bigint)', 'execute'),
    'who_may_call: the helpers are nobody''s';
end
$$;

select pg_temp.login_anon();
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba de visita')$q$, current_setting('t.ship_a')), 'forbidden');
select pg_temp.refused($q$select public.ops_remove_zone_closure_day('gam-core', current_date + 3)$q$, 'forbidden');
select pg_temp.refused('select * from public.my_orders(5, 0)', 'forbidden');
reset role;

-- A shopper, the warehouse, a driver, and staff of other areas are refused.
select pg_temp.login('comprador@yuntera.example');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba de cliente')$q$, current_setting('t.ship_a')), 'forbidden');
select pg_temp.refused($q$select public.ops_remove_zone_closure_day('gam-core', current_date + 3)$q$, 'forbidden');
reset role;
select pg_temp.login('bodega@yuntera.example');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba de bodega')$q$, current_setting('t.ship_a')), 'forbidden');
reset role;
select pg_temp.login('repartidor@yuntera.example');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba de ruta')$q$, current_setting('t.ship_a')), 'forbidden');
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba de soporte')$q$, current_setting('t.ship_a')), 'forbidden');
select pg_temp.refused($q$select public.ops_remove_zone_closure_day('gam-core', current_date + 3)$q$, 'forbidden');
reset role;
select pg_temp.staff_as('finance');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba de finanzas')$q$, current_setting('t.ship_a')), 'forbidden');
reset role;
select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba de catálogo')$q$, current_setting('t.ship_a')), 'forbidden');
reset role;
select pg_temp.staff_as('ops');
-- Without the second step, when staff need it, operations staff are refused too.
update public.app_settings set value = 'true' where key = 'require_staff_mfa';
select pg_temp.login('comprador3@yuntera.example', 'aal1');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba sin segundo paso')$q$, current_setting('t.ship_a')), 'forbidden');
reset role;
update public.app_settings set value = 'false' where key = 'require_staff_mfa';

do $$ begin
  assert (select count(*) from public.shipments where id = current_setting('t.ship_a')::uuid and status = 'packed') = 1
         and not exists (select 1 from private.audit_log a where a.id > current_setting('t.audit_from')::bigint
                         and a.action = 'shipment_recalled'),
    'who_may_call: nothing changed for any refused caller';
end $$;

-- ═══ 2. Staff stop a packed parcel ═════════════════════════════════════════

select pg_temp.login('comprador3@yuntera.example');
-- A reason needs five letters; an unknown parcel is not found.
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, '12345 !!')$q$, current_setting('t.ship_a')), 'reason_required');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, null)$q$, current_setting('t.ship_a')), 'reason_required');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Pedido equivocado')$q$, gen_random_uuid()), 'shipment_not_found');
-- Out for delivery (C, D on the route being driven) and a seller's parcel are refused, with why.
do $$ begin
  assert pg_temp.refused_detail(format($q$select public.ops_recall_shipment(%L, 'El cliente llamó')$q$,
           current_setting('t.ship_c')), 'shipment_not_recallable') = 'out_for_delivery',
    'recall: out for delivery is refused';
end $$;
reset role;
-- The seller's parcel of F is packed at the seller's.
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.ship_f2')::uuid) = 'out_for_delivery',
    'fixture: F''s seller parcel is on the road';
end $$;

-- A, on the shelf: stopped. The staff note keeps the reason; the shopper's
-- note says what happens to the money; the parcel waits at the dock.
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.ops_recall_shipment(current_setting('t.ship_a')::uuid, '  El cliente pidió cancelar  ');
  assert v ->> 'status' = 'returning' and v ->> 'route_code' is null
         and v ->> 'order_number' = (select order_number from public.orders where id = current_setting('t.order_a')::uuid),
    format('recall: A stopped %s', v);
end
$$;
-- Again: it is returning now, and says so.
do $$ begin
  assert pg_temp.refused_detail(format($q$select public.ops_recall_shipment(%L, 'Otra vez detenido')$q$,
           current_setting('t.ship_a')), 'shipment_not_recallable') = 'returning',
    'recall: a parcel already returning is refused';
end $$;
reset role;
do $$
declare
  s public.shipments%rowtype;
begin
  select * into s from public.shipments where id = current_setting('t.ship_a')::uuid;
  assert s.status = 'returning' and s.recalled_at is not null and s.recall_reason = 'El cliente pidió cancelar'
         and s.recalled_by = (select id from auth.users where email = 'comprador3@yuntera.example')
         and s.attempt_count = 0,
    format('recall: A is returning, with who and why %s', s);
  assert (select status from public.orders where id = current_setting('t.order_a')::uuid) = 'processing',
    'recall: the order is not moved to "on its way"';
  assert exists (select 1 from public.order_events e where e.shipment_id = s.id and e.visible_to_customer
                 and e.note like 'Detuvimos el envío del paquete%le devolvemos lo que pagó por él')
         and exists (select 1 from public.order_events e where e.shipment_id = s.id and not e.visible_to_customer
                     and e.note like 'Central detuvo el paquete%El cliente pidió cancelar')
         and not exists (select 1 from public.order_events e where e.shipment_id = s.id and e.visible_to_customer
                         and e.kind = 'shipment_status' and e.to_status = 'returning'),
    'recall: the shopper reads what it means, staff read why, and no bare status';
  assert exists (select 1 from private.audit_log a where a.id > current_setting('t.audit_from')::bigint
                 and a.action = 'shipment_recalled' and a.row_key = s.id::text
                 and a.new_row ->> 'status' = 'returning' and a.old_row ->> 'status' = 'packed'
                 and a.new_row::text !~ 'cancelar|Prueba'),
    'recall: in the audit log, without the reason typed';
  assert not exists (select 1 from private.refunds where order_id = current_setting('t.order_a')::uuid),
    'recall: nothing is refunded before the warehouse receives it';
end
$$;

-- B, on a route assigned and not started: its stop is removed by the same rules.
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.ops_recall_shipment(current_setting('t.ship_b')::uuid, 'Dirección equivocada');
  assert v ->> 'status' = 'returning'
         and v ->> 'route_code' = (select code from public.routes where id = current_setting('t.route_one')::uuid),
    format('recall: B stopped off its route %s', v);
  -- No longer on dispatch's list, but on the warehouse's, as never having left.
  assert not exists (select 1 from jsonb_array_elements(public.ops_dispatch_board() -> 'ready') e
                     where e ->> 'shipment_id' in (current_setting('t.ship_a'), current_setting('t.ship_b'))),
    'recall: not waiting for a route';
end
$$;
reset role;
do $$
declare
  rs public.route_stops%rowtype;
begin
  select * into rs from public.route_stops where id = current_setting('t.stop_b')::uuid;
  assert rs.status = 'skipped' and rs.removal_reason = 'Dirección equivocada' and rs.removed_at is not null,
    format('recall: B''s stop is removed, with the reason %s', rs);
  assert exists (select 1 from private.audit_log a where a.id > current_setting('t.audit_from')::bigint
                 and a.action = 'stop_removed' and a.row_key = rs.id::text),
    'recall: the stop removal is audited as ever';
end
$$;
select pg_temp.remember('code_a', pg_temp.code(current_setting('t.order_a')::uuid));
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb := public.wms_returning_shipments(current_setting('t.platform')::uuid);
  a jsonb;
begin
  select e into a from jsonb_array_elements(v) e where e ->> 'shipment_id' = current_setting('t.ship_a');
  assert (a ->> 'never_left')::boolean and a ->> 'recalled_at' is not null and (a ->> 'attempt_count')::integer = 0,
    format('warehouse: A never left the building %s', a);
  assert exists (select 1 from jsonb_array_elements(v) e
                 where e ->> 'shipment_id' = current_setting('t.ship_b') and (e ->> 'never_left')::boolean),
    'warehouse: nor did B';
  -- Never the delivery code.
  assert v::text !~ ('"' || current_setting('t.code_a') || '"') and v::text !~ '"(delivery_pin|pin|code)"',
    'warehouse: no delivery code';
end
$$;
reset role;

-- The driver's day: B's stop is skipped.
select pg_temp.login('repartidor@yuntera.example');
do $$ begin
  assert exists (select 1 from jsonb_array_elements(public.driver_today() -> 'routes') r,
                 jsonb_array_elements(r -> 'stops') s
                 where s ->> 'stop_id' = current_setting('t.stop_b') and s ->> 'status' = 'skipped'),
    'recall: the driver sees B skipped';
end $$;
reset role;

-- ═══ 3. The delivery fee ═══════════════════════════════════════════════════

-- A, received: the goods and the delivery fee go back; the payment ends refunded.
do $$
declare
  v jsonb;
  o public.orders%rowtype;
  v_fee private.refunds%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_a')::uuid;
  v := pg_temp.check_in(current_setting('t.ship_a')::uuid);
  assert (v ->> 'refund_minor')::bigint = o.items_total_minor
         and (v ->> 'delivery_fee_refund_minor')::bigint = o.shipping_minor,
    format('fee: A gives back goods and fee %s', v);
  select * into v_fee from private.refunds where order_id = o.id and reason = 'delivery_fee';
  assert v_fee.amount_minor = o.shipping_minor and v_fee.source_id = o.id,
    format('fee: one delivery-fee refund in the register %s', v_fee);
  assert private.refunded_minor(o.id) = private.order_collected_minor(o.id)
         and private.refunded_minor(o.id) = o.total_minor,
    'fee: everything paid is refunded, not a céntimo more';
  -- The way back of every refund: simulated money, settled and confirmed.
  assert (select count(*) from private.gateway_refunds g where g.order_id = o.id and g.status = 'succeeded'
          and g.channel = 'simulated') = 2,
    'fee: both refunds took the usual way back';
  assert (select status from public.payments where order_id = o.id order by created_at desc limit 1) = 'refunded',
    'fee: the payment ends refunded';
  assert (select status from public.orders where id = o.id) = 'refunded', 'fee: the order ends refunded';
  -- The ledger: the fee's transaction sums to zero and gives back the shipping revenue and its IVA.
  assert (select sum(e.amount_minor) from public.ledger_entries e where e.transaction_id = v_fee.ledger_transaction_id) = 0
         and (select sum(e.amount_minor) from public.ledger_entries e
              where e.transaction_id = v_fee.ledger_transaction_id
                and e.account_id in (private.ledger_account('shipping_revenue'), private.ledger_account('iva_payable')))
             = o.shipping_minor,
    'fee: the ledger gives back the shipping revenue and its IVA';
  -- The shopper is told the amounts.
  assert exists (select 1 from public.order_events e where e.order_id = o.id and e.visible_to_customer
                 and e.note = 'Le devolvemos también el envío, ' || private.colones(o.shipping_minor)
                              || ': no llegamos a intentar la entrega'),
    'fee: the order page says the fee comes back';
  assert exists (select 1 from public.order_events e where e.order_id = o.id and e.visible_to_customer
                 and e.note = 'Su paquete volvió a nuestros estantes sin salir de la bodega; le devolvemos '
                              || private.colones(o.items_total_minor) || ' que pagó por sus productos'),
    'fee: and the goods'' amount, for a parcel that never left';
  assert exists (select 1 from private.outbox_events e where e.id > current_setting('t.events_from')::bigint
                 and e.topic = 'order.cancelled' and e.payload ->> 'order_id' = o.id::text
                 and (e.payload ->> 'amount_minor')::bigint = o.total_minor),
    'fee: the cancellation message carries what is really refunded';
  assert exists (select 1 from private.outbox_events e where e.id > current_setting('t.events_from')::bigint
                 and e.topic = 'refund.requested' and e.payload ->> 'reason' = 'delivery_fee'
                 and (e.payload ->> 'amount_minor')::bigint = o.shipping_minor),
    'fee: its refund is announced with its amount';
end
$$;
select pg_temp.check_money('fee: after A');

-- The same again is refused, and the fee is never refunded twice by any path.
do $$
declare
  v_order uuid := current_setting('t.order_a')::uuid;
begin
  begin
    perform pg_temp.check_in(current_setting('t.ship_a')::uuid);
    raise exception 'fee: A checked in twice';
  exception when others then
    if sqlerrm <> 'shipment_not_returning' then raise; end if;
  end;
  perform pg_temp.logout();
  assert private.refund_delivery_fee(v_order) is null, 'fee: a replay refunds nothing';
  assert pg_temp.fee_refunds(v_order) = 1, 'fee: still one';
end
$$;
-- A second register row for the same thing is refused by the register itself.
do $$
declare
  v_tx uuid;
begin
  insert into public.ledger_transactions (kind, order_id, memo) values ('adjustment', current_setting('t.order_a')::uuid, 'prueba')
  returning id into v_tx;
  begin
    insert into private.refunds (order_id, reason, source_id, amount_minor, ledger_transaction_id)
    values (current_setting('t.order_a')::uuid, 'delivery_fee', current_setting('t.order_a')::uuid, 1, v_tx);
    raise exception 'fee: a second delivery-fee refund was registered';
  exception when unique_violation then
    null;
  end;
end
$$;

-- B, stopped off its route: the same.
do $$
declare
  v jsonb;
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_b')::uuid;
  v := pg_temp.check_in(current_setting('t.ship_b')::uuid);
  assert (v ->> 'delivery_fee_refund_minor')::bigint = o.shipping_minor and v ->> 'order_status' = 'refunded',
    format('fee: B gives back the fee too %s', v);
end
$$;

-- C, taken off a route being driven (no attempt), then sent back: the fee comes back.
select pg_temp.login('comprador3@yuntera.example');
select public.ops_remove_route_stop(pg_temp.stop(current_setting('t.route_two')::uuid, current_setting('t.ship_c')::uuid),
                                    'El camión se varó');
select public.ops_return_shipment(current_setting('t.ship_c')::uuid);
reset role;
do $$
declare
  v jsonb;
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_c')::uuid;
  v := pg_temp.check_in(current_setting('t.ship_c')::uuid);
  assert (v ->> 'delivery_fee_refund_minor')::bigint = o.shipping_minor
         and (select status from public.payments where order_id = o.id order by created_at desc limit 1) = 'refunded',
    format('fee: C, removed from a driven route without an attempt, gives back the fee %s', v);
  assert exists (select 1 from public.order_events e where e.order_id = o.id and e.visible_to_customer
                 and e.note like 'Su paquete regresó a nuestra bodega sin entregarse; le devolvemos ₡%'),
    'fee: a parcel that went out reads "regresó"';
end
$$;

-- D, the driver found nobody home: a real attempt. The fee stays charged.
select pg_temp.act('repartidor@yuntera.example');
select public.driver_fail_stop(pg_temp.stop(current_setting('t.route_two')::uuid, current_setting('t.ship_d')::uuid), 'nobody_home');
select pg_temp.act('comprador3@yuntera.example');
select public.ops_return_shipment(current_setting('t.ship_d')::uuid);
select pg_temp.logout();
do $$
declare
  v jsonb;
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_d')::uuid;
  v := pg_temp.check_in(current_setting('t.ship_d')::uuid);
  assert (v ->> 'delivery_fee_refund_minor')::bigint = 0 and (v ->> 'refund_minor')::bigint = o.items_total_minor
         and v ->> 'order_status' = 'cancelled',
    format('fee: D, after an attempt at the door, keeps the fee %s', v);
  assert pg_temp.fee_refunds(o.id) = 0
         and (select status from public.payments where order_id = o.id order by created_at desc limit 1) = 'partially_refunded',
    'fee: D''s payment stays partly refunded';
  assert exists (select 1 from private.outbox_events e where e.id > current_setting('t.events_from')::bigint
                 and e.topic = 'order.cancelled' and e.payload ->> 'order_id' = o.id::text
                 and (e.payload ->> 'amount_minor')::bigint = o.items_total_minor),
    'fee: D''s cancellation message says only the goods come back';
  assert not exists (select 1 from public.order_events e where e.order_id = o.id and e.note like 'Le devolvemos también el envío%'),
    'fee: and the page does not say the fee comes back';
end
$$;

-- F: the seller's parcel delivered, the warehouse's stopped and received: the
-- order is delivered, not cancelled, and the fee stays.
do $$ begin
  assert (pg_temp.door(pg_temp.stop(current_setting('t.route_two')::uuid, current_setting('t.ship_f2')::uuid),
                       pg_temp.code(current_setting('t.order_f')::uuid)) ->> 'ok')::boolean,
    'fixture: F''s seller parcel delivered';
end $$;
do $$
declare
  v jsonb;
  o public.orders%rowtype;
begin
  perform pg_temp.recall(current_setting('t.ship_f1')::uuid, 'La caja salió golpeada');
  select * into o from public.orders where id = current_setting('t.order_f')::uuid;
  v := pg_temp.check_in(current_setting('t.ship_f1')::uuid);
  assert (v ->> 'delivery_fee_refund_minor')::bigint = 0 and v ->> 'order_status' = 'delivered',
    format('fee: F, with a parcel delivered, keeps the fee %s', v);
  assert pg_temp.fee_refunds(o.id) = 0, 'fee: no fee refund for F';
end
$$;

-- E, cash on delivery never paid: nothing to refund; the order still ends cleanly.
do $$
declare
  v jsonb;
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_e')::uuid;
  perform pg_temp.recall(current_setting('t.ship_e')::uuid, 'El cliente ya no lo quiere');
  v := pg_temp.check_in(current_setting('t.ship_e')::uuid);
  assert (v ->> 'refund_minor')::bigint = 0 and (v ->> 'delivery_fee_refund_minor')::bigint = 0
         and v ->> 'order_status' = 'cancelled',
    format('fee: E, never paid, refunds nothing %s', v);
  assert not exists (select 1 from private.refunds where order_id = o.id)
         and not exists (select 1 from public.ledger_transactions where order_id = o.id)
         and (select status from public.payments where order_id = o.id order by created_at desc limit 1) = 'cancelled',
    'fee: E has no refund, no ledger entry and its payment is called off';
  assert exists (select 1 from private.outbox_events e where e.id > current_setting('t.events_from')::bigint
                 and e.topic = 'order.cancelled' and e.payload ->> 'order_id' = o.id::text
                 and not (e.payload ? 'amount_minor')),
    'fee: E''s message has no amount to give back';
end
$$;
select pg_temp.check_money('fee: after every case');

-- Two parcels of one order sent back (the warehouse's stopped on the shelf,
-- the seller's taken off a driven route): the fee comes back once, with the
-- last one received. Two sessions at the same moment are in
-- packages/db/src/contract.order-followups.test.ts.
select pg_temp.remember('order_g', pg_temp.packed_order('seguimiento2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1', 'bombillo-led-9w-4u:1'), 'card', 'seg-167-g')::text);
select pg_temp.remember('ship_g1', pg_temp.shipment(current_setting('t.order_g')::uuid, 'platform')::text);
select pg_temp.remember('ship_g2', pg_temp.shipment(current_setting('t.order_g')::uuid, 'seller')::text);
select pg_temp.remember('route_g', pg_temp.route(current_setting('t.ship_g2')::uuid)::text);
select pg_temp.act('comprador3@yuntera.example');
select public.ops_remove_route_stop(pg_temp.stop(current_setting('t.route_g')::uuid, current_setting('t.ship_g2')::uuid),
                                    'El cliente pidió cancelar');
select public.ops_return_shipment(current_setting('t.ship_g2')::uuid);
select pg_temp.logout();
do $$
declare
  v_order uuid := current_setting('t.order_g')::uuid;
  v jsonb;
begin
  assert (select shipping_minor from public.orders where id = v_order) > 0, 'fixture: G pays a delivery fee';
  perform pg_temp.recall(current_setting('t.ship_g1')::uuid, 'El cliente pidió cancelar');
  v := pg_temp.check_in(current_setting('t.ship_g1')::uuid);
  assert (v ->> 'delivery_fee_refund_minor')::bigint = 0 and v ->> 'order_status' <> 'cancelled',
    format('fee: G, the first parcel back, gives back its goods only %s', v);
  perform pg_temp.act('vendedor@yuntera.example');
  v := public.wms_receive_returned_shipment(current_setting('t.ship_g2')::uuid, true, null);
  perform pg_temp.logout();
  assert (v ->> 'delivery_fee_refund_minor')::bigint = (select shipping_minor from public.orders where id = v_order)
         and v ->> 'order_status' = 'refunded' and pg_temp.fee_refunds(v_order) = 1,
    format('fee: G, the last one, gives back the fee once %s', v);
  assert private.refunded_minor(v_order) = private.order_collected_minor(v_order), 'fee: G, all of it, no more';
end
$$;
select pg_temp.check_money('fee: after G');

-- The credit note follows the delivery fee's document: in full, with the
-- cancellation's code, as a whole cancellation makes it.
select private.invoice_plan(1000) from generate_series(1, 3);
do $$
declare
  v_fee private.refunds%rowtype;
  d public.electronic_invoices%rowtype;
  n public.electronic_invoices%rowtype;
begin
  select * into v_fee from private.refunds where order_id = current_setting('t.order_a')::uuid and reason = 'delivery_fee';
  select * into d from public.electronic_invoices
  where order_id = v_fee.order_id and kind = 'delivery' and replaces_id is null;
  if d.id is null then
    -- Simulated money is not documented on this database: nothing to credit.
    assert not exists (select 1 from public.electronic_invoices where refund_id = v_fee.id),
      'invoice: no credit note without a document';
    return;
  end if;
  select * into n from public.electronic_invoices where refund_id = v_fee.id;
  assert n.kind = 'credit' and n.original_invoice_id = d.id and n.total_minor = d.total_minor,
    format('invoice: the delivery fee''s document is credited in full %s', n);
  assert (select count(*) from public.electronic_invoices where refund_id = v_fee.id) = 1,
    'invoice: one credit note for the fee';
  assert not exists (select 1 from public.electronic_invoices x
                     where x.refund_id = v_fee.id and x.kind = 'credit' and x.receiver_kind = 'seller'),
    'invoice: no seller document is credited for the fee';
end
$$;

-- ═══ 4. What the shopper, the warehouse and the console read ═══════════════

-- The list carries each order's parcels; the columns before are unchanged.
do $$ begin
  assert pg_get_function_result('public.my_orders(integer, integer)'::regprocedure)
         = 'TABLE(order_number text, status order_status, placed_at timestamp with time zone, total_minor bigint, '
           'payment_method payment_method, promise_earliest date, promise_latest date, delivered_at timestamp with time zone, '
           'item_count bigint, first_title text, first_image_path text, shipments jsonb)',
    format('list: the columns %s', pg_get_function_result('public.my_orders(integer, integer)'::regprocedure));
end $$;
-- An order whose parcel is stopped and waits at the dock.
select pg_temp.remember('order_h', pg_temp.packed_order('seguimiento2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'seg-167-h')::text);
select pg_temp.recall(pg_temp.shipment(current_setting('t.order_h')::uuid, 'platform'));
select pg_temp.remember('code_h', pg_temp.code(current_setting('t.order_h')::uuid));
select pg_temp.login('seguimiento2@yuntera.example');
do $$
declare
  r record;
  v jsonb;
begin
  select * into r from public.my_orders(50, 0) m
  where m.order_number = (select order_number from public.orders where id = current_setting('t.order_h')::uuid);
  assert r.status = 'processing' and r.shipments = jsonb_build_array(jsonb_build_object(
           'status', 'returning', 'attempt_count', 0, 'recalled', true)),
    format('list: H says its parcel is stopped %s', r.shipments);
  select * into r from public.my_orders(50, 0) m
  where m.order_number = (select order_number from public.orders where id = current_setting('t.order_e')::uuid);
  assert jsonb_array_length(r.shipments) = 1 and r.shipments -> 0 ->> 'status' = 'returned',
    format('list: E %s', r.shipments);
  -- Only the shopper's own.
  assert not exists (select 1 from public.my_orders(50, 0) m
                     where m.order_number = (select order_number from public.orders where id = current_setting('t.order_a')::uuid)),
    'list: another shopper''s order is not listed';
  -- The order page: the parcel is marked stopped; the shopper cannot stop it; the code is theirs.
  v := public.get_order((select order_number from public.orders where id = current_setting('t.order_h')::uuid));
  assert (v -> 'shipments' -> 0 ->> 'recalled')::boolean and not (v -> 'shipments' -> 0 ->> 'can_recall')::boolean
         and v ->> 'delivery_pin' = current_setting('t.code_h'),
    format('page: H for its shopper %s', v -> 'shipments');
  assert exists (select 1 from jsonb_array_elements(v -> 'timeline') e where e ->> 'note' like 'Detuvimos el envío%')
         and not exists (select 1 from jsonb_array_elements(v -> 'timeline') e where e ->> 'note' like 'Central detuvo%'),
    'page: the shopper reads their note, not staff''s';
end
$$;
reset role;
-- Staff: what can still be stopped; never the code.
select pg_temp.remember('order_i', pg_temp.packed_order('seguimiento2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'seg-167-i')::text);
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.get_order((select order_number from public.orders where id = current_setting('t.order_i')::uuid));
  assert (v -> 'shipments' -> 0 ->> 'can_recall')::boolean and v ->> 'delivery_pin' is null,
    format('page: operations staff may stop I, and never see the code %s', v -> 'shipments');
  v := public.get_order((select order_number from public.orders where id = current_setting('t.order_c')::uuid));
  assert not (v -> 'shipments' -> 0 ->> 'can_recall')::boolean, 'page: a returned parcel cannot be stopped';
end
$$;
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert not (public.get_order((select order_number from public.orders where id = current_setting('t.order_i')::uuid))
              -> 'shipments' -> 0 ->> 'can_recall')::boolean,
    'page: support reads the order but may not stop a parcel';
end $$;
reset role;
select pg_temp.staff_as('ops');

-- The console's routes: a removed stop's parcel has no attempt; a failed one has.
select pg_temp.remember('order_j', pg_temp.packed_order('seguimiento2@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'seg-167-j')::text);
select pg_temp.remember('route_three', pg_temp.route(pg_temp.shipment(current_setting('t.order_j')::uuid, 'platform'))::text);
select pg_temp.login('comprador3@yuntera.example');
select public.ops_remove_route_stop(
  pg_temp.stop(current_setting('t.route_three')::uuid, pg_temp.shipment(current_setting('t.order_j')::uuid, 'platform')),
  'El cliente no estará');
do $$
declare
  s jsonb;
begin
  select st into s from jsonb_array_elements(public.ops_open_routes()) r, jsonb_array_elements(r -> 'stops') st
  where r ->> 'route_id' = current_setting('t.route_three');
  assert s ->> 'status' = 'skipped' and s ->> 'shipment_status' = 'delivery_failed'
         and (s ->> 'attempt_count')::integer = 0,
    format('routes: a removed stop''s parcel has no attempt %s', s);
end
$$;
reset role;

-- ═══ 5. A district moved back follows its canton ═══════════════════════════

do $$ begin
  assert not exists (select 1 from public.districts d join public.cantons c on c.code = d.canton_code
                     where d.zone_id is not null and d.zone_id = c.zone_id),
    'districts: none keeps its canton''s zone as its own';
  assert (select c.zone_id from public.districts d join public.cantons c on c.code = d.canton_code
          where d.postal_code = '10111') = 'gam-core'
         and (select zone_id from public.districts where postal_code = '10111') is null,
    'fixture: San Sebastián follows its canton (gam-core)';
end $$;
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
  d jsonb;
begin
  perform public.ops_move_districts(array['10111'], 'gam-extended');
  select e into d from jsonb_array_elements(public.ops_canton_districts('101') -> 'districts') e
  where e ->> 'postal_code' = '10111';
  assert d ->> 'zone_id' = 'gam-extended' and (d ->> 'own_zone')::boolean,
    format('districts: moved away, it has a zone of its own %s', d);
  assert (select (c ->> 'own_zone_count')::integer from jsonb_array_elements(public.ops_district_cantons()) c
          where c ->> 'code' = '101') >= 1,
    'districts: the canton says it has one with its own zone';
  -- Not served, then back to its canton's zone: it follows its canton again.
  perform public.ops_move_districts(array['10111'], null);
  perform public.ops_move_districts(array['10111'], 'gam-core');
  select e into d from jsonb_array_elements(public.ops_canton_districts('101') -> 'districts') e
  where e ->> 'postal_code' = '10111';
  assert d ->> 'zone_id' = 'gam-core' and not (d ->> 'own_zone')::boolean and (d ->> 'served')::boolean,
    format('districts: moved back, it follows its canton %s', d);
  -- Assigned to its canton's zone while it follows it: nothing to change.
  begin
    perform public.ops_move_districts(array['10111'], 'gam-core');
    raise exception 'districts: an unchanged move was accepted';
  exception when others then
    if sqlerrm <> 'district_unchanged' then raise; end if;
  end;
end
$$;
reset role;
do $$ begin
  assert (select zone_id from public.districts where postal_code = '10111') is null,
    'districts: no zone of its own stored';
  -- The audit says what it really holds after each step.
  assert (select array_agg(a.new_row ->> 'own_zone_id' order by a.id) from private.audit_log a
          where a.id > current_setting('t.audit_from')::bigint and a.action = 'district_zone' and a.row_key = '10111')
         = array['gam-extended', 'gam-extended', null],
    format('districts: the audit trail %s', (select array_agg(a.new_row order by a.id) from private.audit_log a
          where a.id > current_setting('t.audit_from')::bigint and a.action = 'district_zone' and a.row_key = '10111'));
end $$;

-- ═══ 6. Indexes, and a single closed day ═══════════════════════════════════

do $$ begin
  assert (select count(*) from pg_index i
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where (i.indrelid, a.attname) in (('public.route_stops'::regclass, 'removed_by'),
                                            ('public.routes'::regclass, 'closed_by'),
                                            ('public.zone_closure_periods'::regclass, 'created_by'),
                                            ('public.zone_closure_periods'::regclass, 'ended_early_by'),
                                            ('public.shipments'::regclass, 'recalled_by'))) = 5,
    'indexes: every "who" column leads an index';
end $$;

-- A delivery day of gam-core after today that an order placed the day before
-- is promised, with no closure: closed on its own, then removed.
do $$
declare
  d date;
begin
  select x::date into d
  from generate_series(private.cr_today() + 2, private.cr_today() + 60, interval '1 day') x
  where not exists (select 1 from public.zone_closures c where c.zone_id = 'gam-core' and c.day = x::date)
    and (select p.latest from private.compute_promise('gam-core', 0,
           ((x::date - 1)::timestamp + interval '15 hours') at time zone 'UTC') p) = x::date
  order by x limit 1;
  assert d is not null, 'fixture: a delivery day to close';
  perform pg_temp.remember('closed_day', d::text);
  insert into public.zone_closures (zone_id, day, reason) values ('gam-core', d, 'capacity');
  assert (select p.latest from private.compute_promise('gam-core', 0,
           ((d - 1)::timestamp + interval '15 hours') at time zone 'UTC') p) <> d,
    'fixture: the promise skips the closed day';
end
$$;
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
  d date := current_setting('t.closed_day')::date;
begin
  assert exists (select 1 from jsonb_array_elements(public.ops_zone_closures() -> 'single_days') e
                 where e ->> 'zone_id' = 'gam-core' and (e ->> 'day')::date = d),
    'closure day: listed';
  begin
    perform public.ops_remove_zone_closure_day('gam-core', d - 400);
    raise exception 'closure day: a past day was removed';
  exception when others then
    if sqlerrm <> 'zone_closure_in_past' then raise; end if;
  end;
  begin
    perform public.ops_remove_zone_closure_day('zona-que-no-existe', d);
    raise exception 'closure day: an unknown zone';
  exception when others then
    if sqlerrm <> 'zone_not_found' then raise; end if;
  end;
  begin
    perform public.ops_remove_zone_closure_day('gam-extended', d);
    raise exception 'closure day: a day that is not closed';
  exception when others then
    if sqlerrm <> 'zone_closure_not_found' then raise; end if;
  end;
  v := public.ops_remove_zone_closure_day('gam-core', d);
  assert v ->> 'zone_id' = 'gam-core' and (v ->> 'day')::date = d, format('closure day: removed %s', v);
  begin
    perform public.ops_remove_zone_closure_day('gam-core', d);
    raise exception 'closure day: removed twice';
  exception when others then
    if sqlerrm <> 'zone_closure_not_found' then raise; end if;
  end;
end
$$;
-- A day that belongs to a period is the period's to change.
do $$
declare
  p jsonb;
  d date := current_setting('t.closed_day')::date;
begin
  p := public.ops_open_zone_closure('gam-extended', d, d, 'weather', null);
  begin
    perform public.ops_remove_zone_closure_day('gam-extended', d);
    raise exception 'closure day: a period''s day was removed alone';
  exception when others then
    if sqlerrm <> 'zone_closure_not_found' then raise; end if;
  end;
end
$$;
reset role;
do $$
declare
  d date := current_setting('t.closed_day')::date;
begin
  assert not exists (select 1 from public.zone_closures where zone_id = 'gam-core' and day = d),
    'closure day: gone';
  assert (select p.latest from private.compute_promise('gam-core', 0,
           ((d - 1)::timestamp + interval '15 hours') at time zone 'UTC') p) = d,
    'closure day: the promise delivers on it again at once';
  assert exists (select 1 from private.audit_log a where a.id > current_setting('t.audit_from')::bigint
                 and a.action = 'closure_day_removed' and a.row_key = 'gam-core:' || d
                 and a.old_row ->> 'day' = d::text and a.new_row is null),
    'closure day: in the audit log';
end
$$;

select pg_temp.check_money('order follow-ups: at the end');
select 'ok' as order_followups;
rollback;
