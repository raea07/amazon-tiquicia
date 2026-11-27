-- Refunds of a cancellation, across 20261121084400 (the cancellation's lock
-- order, the capped sweep) and 20261121084600 (refunds booked together are
-- announced once). The whole suite is ONE transaction, so every refund it
-- books carries the same booked_xact: exactly the case of one transaction
-- booking refunds of several orders.
--
--   (a) An order cancelled because its parcel came back with nobody at the
--       door: wms_receive_returned_shipment (084200) books the goods and the
--       delivery fee and cancels the order itself. It does not go through
--       private.cancel_order_internal (084400), which refuses an order with a
--       packed parcel. The shopper is told once that the refund started and
--       once that it arrived, each with the total.
--   (b) Refunds of different orders booked by one transaction are never
--       grouped: two such orders received in this transaction, a staff
--       cancellation of a paid order through private.cancel_order_internal,
--       and the unpaid-order sweep (private.expire_unpaid_orders, one
--       transaction, up to 200 orders), which books no refund at all (it
--       takes only orders waiting for payment).
--   (c) The planner in force is the 084600 definition (it asks
--       private.refund_announcement). That no later migration redefines it
--       is checked in packages/core/src/definitions-in-force.test.ts.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

create function pg_temp.staff_as_ops() returns void
language sql as $$
  delete from public.staff_members
  where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
  insert into public.staff_members (user_id, role)
  select id, 'ops' from auth.users where email = 'comprador3@yuntera.example';
$$;

create function pg_temp.packed(p_email text, p_key text) returns uuid
language plpgsql as $$
declare
  v_order uuid := pg_temp.place(p_email, pg_temp.items('libreta-tapa-dura-a5:1'), 'card', p_key);
  s uuid;
begin
  perform pg_temp.pay(v_order);
  for s in select id from public.shipments where order_id = v_order and status = 'pending' order by id loop
    perform pg_temp.pack(s);
  end loop;
  return v_order;
end;
$$;

-- Staff stop the parcel and the warehouse checks it in.
create function pg_temp.stop_and_receive(p_order uuid) returns void
language plpgsql as $$
declare
  v_ship uuid := pg_temp.shipment(p_order, 'platform');
begin
  perform pg_temp.act('comprador3@yuntera.example');
  perform public.ops_recall_shipment(v_ship, 'El cliente pidió cancelar');
  perform pg_temp.act('bodega@yuntera.example');
  perform public.wms_receive_returned_shipment(v_ship, true, null);
  perform pg_temp.logout();
end;
$$;

-- The refund events of the suite's orders, planned (each may be planned again).
create function pg_temp.plan_refunds() returns void
language plpgsql as $$
declare
  e private.outbox_events;
begin
  for e in select * from private.outbox_events x
           where x.id > current_setting('t.events_from')::bigint
             and x.topic in ('refund.requested', 'refund.completed')
           order by x.id loop
    perform private.notify_plan_event(e);
  end loop;
end;
$$;

create function pg_temp.messages(p_order uuid, p_template text)
returns setof private.notification_deliveries
language sql as $$
  select * from private.notification_deliveries d
  where d.template = p_template and d.channel = 'email' and d.context ->> 'order_id' = p_order::text
  order by d.id
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────

update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.seed_invoicing_settings();
select pg_temp.staff_as_ops();
select pg_temp.shopper('reembolso175a@yuntera.example', 'Prueba Reembolso Uno');
select pg_temp.shopper('reembolso175b@yuntera.example', 'Prueba Reembolso Dos');
select pg_temp.shopper('reembolso175c@yuntera.example', 'Prueba Reembolso Tres');

-- ═══ (c) The planner in force ═════════════════════════════════════════════

do $$ begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname = 'notify_plan_event') = 1,
    'planner: one definition';
  assert (select position('private.refund_announcement(' in p.prosrc) > 0
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname = 'notify_plan_event'),
    'planner: the 084600 definition (it asks private.refund_announcement)';
  assert (select position('for no key update of l' in p.prosrc) > 0
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname = 'cancel_order_internal'),
    'cancellation: the 084400 definition';
end $$;

-- ═══ (a) Parcels back with nobody at the door ═════════════════════════════

select pg_temp.remember('a', pg_temp.packed('reembolso175a@yuntera.example', 'ref-175-a')::text);
select pg_temp.remember('b', pg_temp.packed('reembolso175b@yuntera.example', 'ref-175-b')::text);

-- The cancellation of 084400 is not this path: staff cannot cancel an order
-- whose parcel is packed.
select pg_temp.act('comprador3@yuntera.example');
select pg_temp.refused(format('select public.cancel_order(%L, %L)', current_setting('t.a'), 'Prueba'),
  'too_late_to_cancel');
select pg_temp.logout();

select pg_temp.stop_and_receive(current_setting('t.a')::uuid);
select pg_temp.stop_and_receive(current_setting('t.b')::uuid);

do $$
declare
  o public.orders%rowtype;
begin
  for o in select * from public.orders where id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid) loop
    -- Refunded at once where the money was simulated (as here), cancelled otherwise.
    -- Stopped by staff before it left: since 085000 the reason says it never left.
    assert o.status in ('cancelled', 'refunded') and o.cancel_reason = 'Los paquetes no salieron de la bodega',
      format('a: order %s cancelled by the return (%s)', o.order_number, o.status);
    assert (select array_agg(f.reason order by f.reason) from private.refunds f where f.order_id = o.id)
         = array['delivery_fee', 'parcel_returned'],
      format('a: order %s refunds the goods and the fee', o.order_number);
    assert (select sum(f.amount_minor) from private.refunds f where f.order_id = o.id) = o.total_minor,
      format('a: order %s refunds its total', o.order_number);
  end loop;
end $$;

-- ═══ (b) Other orders' refunds in the same transaction ═══════════════════

-- A staff cancellation of a paid order that is still waiting at the
-- warehouse, through private.cancel_order_internal (084400): one refund of
-- the whole order.
select pg_temp.remember('c', pg_temp.place('reembolso175c@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ref-175-c')::text);
select pg_temp.pay(current_setting('t.c')::uuid);
select pg_temp.act('comprador3@yuntera.example');
select public.cancel_order(current_setting('t.c')::uuid, 'Prueba de la suite 175');
select pg_temp.logout();

-- The sweep, in the same transaction, over two expired unpaid orders.
select pg_temp.remember('u1', pg_temp.place('reembolso175a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'ref-175-u1')::text);
select pg_temp.remember('u2', pg_temp.place('reembolso175b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'sinpe_movil', 'ref-175-u2')::text);
update public.orders set placed_at = now() - interval '1 day'
where id in (current_setting('t.u1')::uuid, current_setting('t.u2')::uuid);
do $$ begin
  assert private.expire_unpaid_orders() >= 2, 'sweep: cancels the expired orders';
  assert (select count(*) from public.orders where id in (current_setting('t.u1')::uuid, current_setting('t.u2')::uuid)
          and status = 'cancelled' and cancel_reason = 'Pago no recibido a tiempo') = 2,
    'sweep: both cancelled for no payment';
  assert not exists (select 1 from private.refunds f
                     where f.order_id in (current_setting('t.u1')::uuid, current_setting('t.u2')::uuid)),
    'sweep: books no refund';
end $$;

do $$
declare
  v_xact xid8 := pg_current_xact_id();
  f private.refunds;
  o public.orders%rowtype;
begin
  -- Every refund of the suite was booked by this one transaction.
  assert (select count(distinct x.order_id) from private.refunds x where x.booked_xact = v_xact) = 3,
    'fixture: three orders refunded in one transaction';
  for f in select * from private.refunds x where x.booked_xact = v_xact order by x.id loop
    select * into o from public.orders where id = f.order_id;
    if f.order_id = current_setting('t.c')::uuid then
      -- No delivery fee refund of its own order: announced alone.
      assert private.refund_announcement(f.id, false) is null and private.refund_announcement(f.id, true) is null,
        'b: a staff cancellation''s refund is announced on its own';
    else
      -- Grouped with its own order's refunds only: two of them, its own total.
      assert (private.refund_announcement(f.id, false) ->> 'refund_count')::int = 2
         and (private.refund_announcement(f.id, false) ->> 'amount_minor')::bigint = o.total_minor
         and (private.refund_announcement(f.id, false) ->> 'delivery_fee_minor')::bigint = o.shipping_minor,
        format('b: order %s is grouped with its own refunds only: %s', o.order_number,
               private.refund_announcement(f.id, false));
    end if;
  end loop;
end $$;

-- The commit: the simulated refunds are confirmed (and announced) now.
set constraints all immediate;
set constraints all deferred;
select pg_temp.plan_refunds();
select pg_temp.plan_refunds();

do $$
declare
  o public.orders%rowtype;
begin
  for o in select * from public.orders where id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid) loop
    assert (select count(*) from pg_temp.messages(o.id, 'refund_initiated')) = 1
       and (select count(*) from pg_temp.messages(o.id, 'refund_completed')) = 1,
      format('a: order %s: one "refund started" and one "refund arrived", not %s and %s', o.order_number,
             (select count(*) from pg_temp.messages(o.id, 'refund_initiated')),
             (select count(*) from pg_temp.messages(o.id, 'refund_completed')));
    assert (select bool_and((d.context ->> 'amount_minor')::bigint = o.total_minor
                            and (d.context ->> 'delivery_fee_minor')::bigint = o.shipping_minor)
            from private.notification_deliveries d
            where d.context ->> 'order_id' = o.id::text and d.template in ('refund_initiated', 'refund_completed')),
      format('a: order %s: both name its own total, the fee included', o.order_number);
  end loop;
  -- The staff cancellation's refund: its own amount, no fee named.
  select * into o from public.orders where id = current_setting('t.c')::uuid;
  assert not exists (select 1 from private.notification_deliveries d
                     where d.context ->> 'order_id' = o.id::text
                       and d.template in ('refund_initiated', 'refund_completed')
                       and ((d.context ->> 'amount_minor')::bigint <> o.total_minor or d.context ? 'delivery_fee_minor')),
    'b: the staff cancellation''s messages name its own amount alone';
end $$;

select 'ok' as refunds_across_streams;
rollback;
