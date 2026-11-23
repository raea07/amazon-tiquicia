-- Shopper follow-ups (20261121084600_shopper_followups.sql):
--
--   1. Who may call what: cart_alternatives (visitors and signed-in people,
--      the old one-argument signature gone), private.refund_announcement
--      (nobody but the planner).
--   2. The delivery date of a cart alternative: the same as that offer's
--      date on its product page, for the same district, at the same moment:
--      in each zone, in a zone switched off, in a district not served,
--      without a district, with an unknown one, and after a day of the zone
--      is closed. A caller that sends only the offer ids is answered as
--      before (a null date).
--   3. One refund message for one cancellation: the goods of the last parcel
--      and the delivery fee, booked together, are announced once when the
--      refund starts and once when it arrives, with their total; the
--      confirmations in either order; goods alone, a fee alone and a refund
--      booked by another transaction (or before this migration) keep their
--      own messages; planning again changes nothing.
--
-- Who plays whom: a visitor and the demo shopper read the shop; central is
-- an administrator; comprador3 is made operations staff; the orders and
-- their two shoppers are this suite's own. The offer paused is Tienda
-- Sendero's earphones (TecnoCasa sells the same variant). Every check
-- compares with the suite's own fixtures, so it holds on a used database.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

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

-- Operations staff stop the order's parcel, and the warehouse checks it in.
create function pg_temp.stop_and_receive(p_order uuid) returns jsonb
language plpgsql as $$
declare
  v_ship uuid := pg_temp.shipment(p_order, 'platform');
  v jsonb;
begin
  perform pg_temp.act('comprador3@yuntera.example');
  perform public.ops_recall_shipment(v_ship, 'El cliente pidió cancelar');
  perform pg_temp.act('bodega@yuntera.example');
  v := public.wms_receive_returned_shipment(v_ship, true, null);
  perform pg_temp.logout();
  return v;
end;
$$;

-- What the shopper's messages planner makes of the order's refund events
-- (each planned again when asked: planning must be safe to repeat).
create function pg_temp.plan_refunds(p_order uuid) returns void
language plpgsql as $$
declare
  e private.outbox_events;
begin
  for e in select * from private.outbox_events x
           where x.id > current_setting('t.events_from')::bigint
             and x.topic in ('refund.requested', 'refund.completed')
             and x.payload ->> 'order_id' = p_order::text
           order by x.id loop
    perform private.notify_plan_event(e);
  end loop;
end;
$$;

-- The messages of one template planned for the order, per channel.
create function pg_temp.messages(p_order uuid, p_template text, p_channel text default 'email')
returns setof private.notification_deliveries
language sql as $$
  select * from private.notification_deliveries d
  where d.template = p_template and d.channel = p_channel and d.context ->> 'order_id' = p_order::text
  order by d.id
$$;

create function pg_temp.refund_of(p_order uuid, p_reason text) returns private.refunds
language sql as $$
  select * from private.refunds where order_id = p_order and reason = p_reason
$$;

-- The promise of one offer on its product page, as a visitor reads it.
create function pg_temp.page_promise(p_slug text, p_offer uuid, p_postal_code text) returns jsonb
language sql as $$
  -- JSON null (no date) read as SQL null, as the cart's column has it.
  select nullif(o -> 'promise', 'null'::jsonb)
  from jsonb_array_elements(public.get_product(p_slug, p_postal_code) -> 'skus') k,
       jsonb_array_elements(k -> 'offers') o
  where o ->> 'offer_id' = p_offer::text
$$;

grant execute on function pg_temp.remember(text, text), pg_temp.page_promise(text, uuid, text)
  to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────

update public.delivery_zones set active = true where id in ('gam-core', 'gam-extended') and not active;
update public.districts set served = true where not served;
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.seed_invoicing_settings();
select pg_temp.staff_as('ops');
select pg_temp.shopper('reembolso173a@yuntera.example', 'Prueba Reembolso Uno');
select pg_temp.shopper('reembolso173b@yuntera.example', 'Prueba Reembolso Dos');

-- The earphones: Tienda Sendero's offer paused (as its seller would), so the
-- cart offers TecnoCasa's, which has other handling days than Sendero's.
select pg_temp.remember('earphones', 'audifonos-inalambricos-nimbo-aire');
select pg_temp.remember('sendero_offer', (
  select o.id::text from public.offers o join public.sellers s on s.id = o.seller_id
  join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
  where p.slug = current_setting('t.earphones') and s.slug = 'tienda-sendero'));
select pg_temp.remember('tecno_offer', (
  select o.id::text from public.offers o join public.sellers s on s.id = o.seller_id
  join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
  where p.slug = current_setting('t.earphones') and s.slug = 'tecnocasa'));
update public.offers set status = 'active', available_quantity = greatest(available_quantity, 5)
where id = current_setting('t.tecno_offer')::uuid;
update public.offers set status = 'paused' where id = current_setting('t.sendero_offer')::uuid;

do $$ begin
  assert current_setting('t.sendero_offer') <> '' and current_setting('t.tecno_offer') <> '',
    'fixture: two shops sell the earphones';
  assert (select handling_days from public.offers where id = current_setting('t.sendero_offer')::uuid)
         <> (select handling_days from public.offers where id = current_setting('t.tecno_offer')::uuid),
    'fixture: the two offers take different handling days';
end $$;

-- ═══ 1. Who may call what ══════════════════════════════════════════════════

do $$
begin
  assert exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'cart_alternatives' and p.prosecdef
                   and 'search_path=""' = any (p.proconfig)
                   and pg_get_function_identity_arguments(p.oid) = 'p_offer_ids uuid[], p_postal_code text'),
    'access: cart_alternatives takes the offers and a district, as definer, with an empty search path';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'cart_alternatives') = 1,
    'access: the one-argument version is gone (no overload for the API to choose between)';
  assert has_function_privilege('anon', 'public.cart_alternatives(uuid[], text)', 'execute')
         and has_function_privilege('authenticated', 'public.cart_alternatives(uuid[], text)', 'execute'),
    'access: visitors and signed-in people read the alternatives';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                     where p.oid = 'public.cart_alternatives(uuid[], text)'::regprocedure and a.grantee = 0),
    'access: nothing granted to everyone by default';
  assert exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'private' and p.proname = 'refund_announcement' and p.prosecdef
                   and 'search_path=""' = any (p.proconfig)),
    'access: the announcement helper is definer with an empty search path';
  assert not has_function_privilege('anon', 'private.refund_announcement(uuid, boolean)', 'execute')
         and not has_function_privilege('authenticated', 'private.refund_announcement(uuid, boolean)', 'execute')
         and not has_function_privilege('service_role', 'private.refund_announcement(uuid, boolean)', 'execute'),
    'access: nobody calls the announcement helper but the planner';
  assert (select relrowsecurity from pg_class where oid = 'private.refunds'::regclass)
         and (select relrowsecurity from pg_class where oid = 'private.refund_confirmations'::regclass),
    'access: the refund tables keep row-level security';
  assert not has_table_privilege('authenticated', 'private.refunds', 'select')
         and not has_table_privilege('anon', 'private.refund_confirmations', 'select'),
    'access: and no API role reads them';
end $$;

-- A visitor and a signed-in shopper call it as the API does.
select pg_temp.login_anon();
do $$
declare
  v record;
begin
  select * into strict v from public.cart_alternatives(array[current_setting('t.sendero_offer')::uuid], '10101');
  assert v.alternative_offer_id = current_setting('t.tecno_offer')::uuid and v.promise is not null,
    'access: a visitor gets TecnoCasa''s offer with a date';
end $$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$
declare
  v record;
begin
  select * into strict v from public.cart_alternatives(array[current_setting('t.sendero_offer')::uuid], '10101');
  assert v.alternative_offer_id = current_setting('t.tecno_offer')::uuid and v.promise is not null,
    'access: a signed-in shopper too';
end $$;
reset role;
select pg_temp.logout();

-- ═══ 2. The delivery date of a cart alternative ════════════════════════════

-- A district not served (taken out of its zone's service for this suite).
select pg_temp.remember('unserved', (select min(postal_code) from public.districts d
  where coalesce(d.zone_id, (select c.zone_id from public.cantons c where c.code = d.canton_code)) = 'gam-core'
    and d.postal_code <> '10101'));
update public.districts set served = false where postal_code = current_setting('t.unserved');

-- Every case as a visitor: the cart's date is the product page's date for the
-- same offer and district, read in the same statement.
create temporary table promise_cases (label text, postal_code text, expect_date boolean) on commit drop;
insert into promise_cases values
  ('gam-core', '10101', true),
  ('gam-extended', (select min(d.postal_code) from public.districts d join public.cantons c on c.code = d.canton_code
                    where coalesce(d.zone_id, c.zone_id) = 'gam-extended' and d.served), true),
  ('a zone switched off', (select min(d.postal_code) from public.districts d join public.cantons c on c.code = d.canton_code
                           where coalesce(d.zone_id, c.zone_id) = 'national'), false),
  ('a district not served', current_setting('t.unserved'), false),
  ('no district', null, false),
  ('an unknown district', '99999', false);
grant select on promise_cases to anon;

create function pg_temp.check_promises(p_step text) returns void
language plpgsql as $$
declare
  c record;
  v_cart jsonb;
  v_page jsonb;
begin
  for c in select * from promise_cases loop
    select a.promise into v_cart
    from public.cart_alternatives(array[current_setting('t.sendero_offer')::uuid], c.postal_code) a;
    v_page := pg_temp.page_promise(current_setting('t.earphones'), current_setting('t.tecno_offer')::uuid,
                                   c.postal_code);
    assert v_cart is not distinct from v_page,
      format('promise (%s): %s, the cart says %s and the product page %s', p_step, c.label, v_cart, v_page);
    assert (v_cart is not null) = c.expect_date,
      format('promise (%s): %s has %s', p_step, c.label, coalesce(v_cart::text, 'no date'));
  end loop;
end;
$$;
grant execute on function pg_temp.check_promises(text) to anon;

select pg_temp.login_anon();
select pg_temp.check_promises('as seeded');
do $$
declare
  v record;
begin
  -- The other offer's date, not the paused one's.
  assert (select a.promise from public.cart_alternatives(array[current_setting('t.sendero_offer')::uuid], '10101') a)
         is distinct from pg_temp.page_promise(current_setting('t.earphones'),
                                               current_setting('t.sendero_offer')::uuid, '10101')
         or pg_temp.page_promise(current_setting('t.earphones'), current_setting('t.sendero_offer')::uuid, '10101') is null,
    'promise: the date is TecnoCasa''s (no handling days), not the paused offer''s';
  -- A caller that sends only the offer ids: the same answer, no date.
  select * into strict v from public.cart_alternatives(array[current_setting('t.sendero_offer')::uuid]);
  assert v.alternative_offer_id = current_setting('t.tecno_offer')::uuid and v.seller_name = 'TecnoCasa'
         and v.available > 0 and v.promise is null,
    format('promise: one argument still answers, without a date %s', row_to_json(v));
  -- An offer that can still be bought, or an unknown one: no line, as before.
  assert not exists (select 1 from public.cart_alternatives(
           array[current_setting('t.tecno_offer')::uuid, gen_random_uuid()], '10101')),
    'promise: nothing for an offer that can be bought or does not exist';
end $$;
reset role;

-- A closed day in gam-core on the day TecnoCasa's offer would arrive: both
-- move together, past the closed day.
select pg_temp.remember('closed_day', (
  select (pg_temp.page_promise(current_setting('t.earphones'), current_setting('t.tecno_offer')::uuid, '10101')
          ->> 'latest')));
insert into public.zone_closures (zone_id, day, reason)
values ('gam-core', current_setting('t.closed_day')::date, 'Cerrado por la prueba 173');
select pg_temp.login_anon();
select pg_temp.check_promises('with a closed day');
do $$
begin
  assert (select (a.promise ->> 'latest')::date
          from public.cart_alternatives(array[current_setting('t.sendero_offer')::uuid], '10101') a)
         > current_setting('t.closed_day')::date,
    'promise: the cart''s date skips the closed day';
end $$;
reset role;
delete from public.zone_closures where zone_id = 'gam-core' and day = current_setting('t.closed_day')::date
  and period_id is null;
select pg_temp.login_anon();
select pg_temp.check_promises('the day opened again');
do $$
begin
  assert (select a.promise ->> 'latest'
          from public.cart_alternatives(array[current_setting('t.sendero_offer')::uuid], '10101') a)
         = current_setting('t.closed_day'),
    'promise: and comes back when the day opens again';
end $$;
reset role;

-- ═══ 3. One refund message for one cancellation ════════════════════════════

-- G: paid, stopped before it left and received: goods and fee booked
-- together, both confirmed at commit (simulated money).
select pg_temp.remember('order_g', pg_temp.packed_order('reembolso173a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ref-173-g')::text);
do $$
declare
  o public.orders%rowtype;
  v jsonb;
  g private.refunds;
  f private.refunds;
begin
  select * into o from public.orders where id = current_setting('t.order_g')::uuid;
  assert o.shipping_minor > 0, 'fixture: G pays a delivery fee';
  v := pg_temp.stop_and_receive(o.id);
  assert (v ->> 'refund_minor')::bigint = o.items_total_minor
         and (v ->> 'delivery_fee_refund_minor')::bigint = o.shipping_minor,
    format('fixture: G refunds the goods and the fee %s', v);
  g := pg_temp.refund_of(o.id, 'parcel_returned');
  f := pg_temp.refund_of(o.id, 'delivery_fee');
  assert g.booked_xact is not null and g.booked_xact = f.booked_xact
         and g.booked_xact = pg_current_xact_id(),
    'refunds: both are marked as booked by the same transaction';
  -- How each is announced while nothing is confirmed.
  assert private.refund_announcement(g.id, false) = jsonb_build_object(
           'announce', false, 'amount_minor', o.total_minor, 'delivery_fee_minor', o.shipping_minor,
           'refund_count', 2),
    format('refunds: the goods'' start is not announced on its own %s', private.refund_announcement(g.id, false));
  assert (private.refund_announcement(f.id, false) ->> 'announce')::boolean
         and (private.refund_announcement(f.id, false) ->> 'amount_minor')::bigint = o.total_minor,
    'refunds: the fee''s start announces the total';
  assert private.refund_announcement(g.id, true) = '{"announce": false}'::jsonb
         and private.refund_announcement(f.id, true) = '{"announce": false}'::jsonb,
    'refunds: nothing says it arrived before both are confirmed';
  assert private.refund_announcement(gen_random_uuid(), false) is null
         and private.refund_announcement(null, true) is null,
    'refunds: an unknown refund is announced on its own';
end $$;
-- The commit: the simulated refunds are confirmed (and announced) now.
set constraints all immediate;
set constraints all deferred;
select pg_temp.plan_refunds(current_setting('t.order_g')::uuid);
do $$
declare
  o public.orders%rowtype;
  m private.notification_deliveries;
begin
  select * into o from public.orders where id = current_setting('t.order_g')::uuid;
  assert (select count(*) from private.outbox_events e where e.id > current_setting('t.events_from')::bigint
          and e.payload ->> 'order_id' = o.id::text and e.topic = 'refund.requested') = 2
     and (select count(*) from private.outbox_events e where e.id > current_setting('t.events_from')::bigint
          and e.payload ->> 'order_id' = o.id::text and e.topic = 'refund.completed') = 2,
    'G: two refunds, each with its own events, as before';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_initiated')) = 1,
    format('G: one "refund started" message, not %s', (select count(*) from pg_temp.messages(o.id, 'refund_initiated')));
  select * into m from pg_temp.messages(o.id, 'refund_initiated');
  assert (m.context ->> 'amount_minor')::bigint = o.total_minor
         and (m.context ->> 'delivery_fee_minor')::bigint = o.shipping_minor
         and not m.context ? 'announce',
    format('G: it names the total, the fee included %s', m.context);
  assert m.recipient_user_id = o.user_id, 'G: to the shopper';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_completed')) = 1,
    format('G: one "refund arrived" message, not %s', (select count(*) from pg_temp.messages(o.id, 'refund_completed')));
  select * into m from pg_temp.messages(o.id, 'refund_completed');
  assert (m.context ->> 'amount_minor')::bigint = o.total_minor
         and (m.context ->> 'delivery_fee_minor')::bigint = o.shipping_minor,
    format('G: it names the same total %s', m.context);
  -- On the last confirmation's event.
  assert m.event_id = (select max(e.id) from private.outbox_events e
                       where e.topic = 'refund.completed' and e.payload ->> 'order_id' = o.id::text),
    'G: announced on the last confirmation';
end $$;
-- Planning again (a replay of every event) changes nothing.
select pg_temp.plan_refunds(current_setting('t.order_g')::uuid);
do $$
begin
  assert (select count(*) from pg_temp.messages(current_setting('t.order_g')::uuid, 'refund_initiated')) = 1
         and (select count(*) from pg_temp.messages(current_setting('t.order_g')::uuid, 'refund_completed')) = 1,
    'G: a replay plans nothing more';
end $$;

-- H: the same, but the delivery fee's refund is confirmed first and the goods'
-- later (as when the gateway answers for each at another time).
select pg_temp.remember('order_h', pg_temp.packed_order('reembolso173a@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ref-173-h')::text);
select pg_temp.stop_and_receive(current_setting('t.order_h')::uuid);
select private.confirm_refund((pg_temp.refund_of(current_setting('t.order_h')::uuid, 'delivery_fee')).id, 'ref-fee');
select pg_temp.plan_refunds(current_setting('t.order_h')::uuid);
do $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_h')::uuid;
  assert (select count(*) from pg_temp.messages(o.id, 'refund_initiated')) = 1
         and (select (context ->> 'amount_minor')::bigint from pg_temp.messages(o.id, 'refund_initiated')) = o.total_minor,
    'H: the start is announced once, with the total';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_completed')) = 0,
    'H: the fee arrived alone: nothing says the refund arrived yet';
end $$;
-- The goods' refund is confirmed (at commit, the simulated way back).
set constraints all immediate;
set constraints all deferred;
select pg_temp.plan_refunds(current_setting('t.order_h')::uuid);
select pg_temp.plan_refunds(current_setting('t.order_h')::uuid);
do $$
declare
  o public.orders%rowtype;
  m private.notification_deliveries;
begin
  select * into o from public.orders where id = current_setting('t.order_h')::uuid;
  assert (select count(*) from pg_temp.messages(o.id, 'refund_completed')) = 1,
    format('H: one "refund arrived" once the goods arrived too, not %s',
           (select count(*) from pg_temp.messages(o.id, 'refund_completed')));
  select * into m from pg_temp.messages(o.id, 'refund_completed');
  assert (m.context ->> 'amount_minor')::bigint = o.total_minor, 'H: with the total';
  assert m.event_id = (select max(e.id) from private.outbox_events e
                       where e.topic = 'refund.completed' and e.payload ->> 'order_id' = o.id::text)
         and (select e.payload ->> 'reason' from private.outbox_events e where e.id = m.event_id) = 'parcel_returned',
    'H: announced on the goods'' confirmation, the last one';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_initiated')) = 1,
    'H: still one "refund started"';
end $$;

-- I: goods alone. The driver found nobody home (a real attempt), so the fee
-- stays charged: the goods' refund is announced on its own, as before.
select pg_temp.remember('order_i', pg_temp.packed_order('reembolso173b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ref-173-i')::text);
select pg_temp.remember('route_i', pg_temp.route(pg_temp.shipment(current_setting('t.order_i')::uuid, 'platform'))::text);
select pg_temp.act('repartidor@yuntera.example');
select public.driver_fail_stop(pg_temp.stop(current_setting('t.route_i')::uuid,
  pg_temp.shipment(current_setting('t.order_i')::uuid, 'platform')), 'nobody_home');
select pg_temp.act('comprador3@yuntera.example');
select public.ops_return_shipment(pg_temp.shipment(current_setting('t.order_i')::uuid, 'platform'));
select pg_temp.act('bodega@yuntera.example');
select public.wms_receive_returned_shipment(pg_temp.shipment(current_setting('t.order_i')::uuid, 'platform'), true, null);
select pg_temp.logout();
set constraints all immediate;
set constraints all deferred;
select pg_temp.plan_refunds(current_setting('t.order_i')::uuid);
do $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_i')::uuid;
  assert (select count(*) from private.refunds where order_id = o.id) = 1
         and (pg_temp.refund_of(o.id, 'delivery_fee')).id is null,
    'I: the goods alone are refunded';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_initiated')) = 1
         and (select (context ->> 'amount_minor')::bigint from pg_temp.messages(o.id, 'refund_initiated')) = o.items_total_minor
         and not (select context ? 'delivery_fee_minor' from pg_temp.messages(o.id, 'refund_initiated')),
    'I: one "refund started" with the goods'' amount, nothing about the fee';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_completed')) = 1
         and (select (context ->> 'amount_minor')::bigint from pg_temp.messages(o.id, 'refund_completed')) = o.items_total_minor,
    'I: one "refund arrived" with the goods'' amount';
end $$;

-- J: goods booked by another transaction than the fee (here: marked as
-- booked before this migration, which reads the same): each on its own.
select pg_temp.remember('order_j', pg_temp.packed_order('reembolso173b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ref-173-j')::text);
select pg_temp.stop_and_receive(current_setting('t.order_j')::uuid);
set constraints all immediate;
set constraints all deferred;
-- The register's rows are immutable; the suite lifts that for this one
-- statement to stand for a row booked elsewhere.
alter table private.refunds disable trigger refunds_immutable;
update private.refunds set booked_xact = null
where order_id = current_setting('t.order_j')::uuid and reason = 'parcel_returned';
alter table private.refunds enable trigger refunds_immutable;
select pg_temp.plan_refunds(current_setting('t.order_j')::uuid);
do $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_j')::uuid;
  assert (select count(*) from pg_temp.messages(o.id, 'refund_initiated')) = 2
         and (select array_agg((context ->> 'amount_minor')::bigint order by (context ->> 'amount_minor')::bigint)
              from pg_temp.messages(o.id, 'refund_initiated'))
             = array[least(o.items_total_minor, o.shipping_minor), greatest(o.items_total_minor, o.shipping_minor)],
    'J: two separate refunds, two "refund started", each with its amount';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_completed')) = 2,
    'J: and two "refund arrived"';
end $$;
-- The same with another transaction's id (a refund booked later, alone).
select pg_temp.remember('order_j2', pg_temp.packed_order('reembolso173b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ref-173-j2')::text);
select pg_temp.stop_and_receive(current_setting('t.order_j2')::uuid);
set constraints all immediate;
set constraints all deferred;
alter table private.refunds disable trigger refunds_immutable;
update private.refunds set booked_xact = '1'::xid8
where order_id = current_setting('t.order_j2')::uuid and reason = 'parcel_returned';
alter table private.refunds enable trigger refunds_immutable;
select pg_temp.plan_refunds(current_setting('t.order_j2')::uuid);
do $$
begin
  assert (select count(*) from pg_temp.messages(current_setting('t.order_j2')::uuid, 'refund_initiated')) = 2
         and (select count(*) from pg_temp.messages(current_setting('t.order_j2')::uuid, 'refund_completed')) = 2,
    'J2: a refund of another transaction keeps its own messages';
end $$;

-- K: a delivery fee refunded on its own still tells the shopper.
select pg_temp.remember('order_k', pg_temp.packed_order('reembolso173b@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'ref-173-k')::text);
select private.refund_delivery_fee(current_setting('t.order_k')::uuid);
set constraints all immediate;
set constraints all deferred;
select pg_temp.plan_refunds(current_setting('t.order_k')::uuid);
do $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = current_setting('t.order_k')::uuid;
  assert (select count(*) from private.refunds where order_id = o.id) = 1, 'K: the fee alone is refunded';
  assert private.refund_announcement((pg_temp.refund_of(o.id, 'delivery_fee')).id, false) is null,
    'K: a fee alone is no group';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_initiated')) = 1
         and (select (context ->> 'amount_minor')::bigint from pg_temp.messages(o.id, 'refund_initiated')) = o.shipping_minor,
    'K: one "refund started" with the fee';
  assert (select count(*) from pg_temp.messages(o.id, 'refund_completed')) = 1
         and (select (context ->> 'amount_minor')::bigint from pg_temp.messages(o.id, 'refund_completed')) = o.shipping_minor,
    'K: one "refund arrived" with the fee';
end $$;

-- Everything planned again, once more: still exactly what was said above.
select pg_temp.plan_refunds(o) from unnest(array[
  current_setting('t.order_g')::uuid, current_setting('t.order_h')::uuid, current_setting('t.order_i')::uuid,
  current_setting('t.order_j')::uuid, current_setting('t.order_j2')::uuid, current_setting('t.order_k')::uuid]) o;
do $$
begin
  assert (select count(*) from private.notification_deliveries d
          where d.template in ('refund_initiated', 'refund_completed') and d.channel = 'email'
            and d.context ->> 'order_id' in (current_setting('t.order_g'), current_setting('t.order_h'),
                                             current_setting('t.order_i'), current_setting('t.order_j'),
                                             current_setting('t.order_j2'), current_setting('t.order_k')))
         = 2 + 2 + 2 + 4 + 4 + 2,
    'replay: every order keeps exactly its messages';
end $$;

select pg_temp.check_money('shopper follow-ups: at the end');
select 'ok' as shopper_followups;
rollback;
