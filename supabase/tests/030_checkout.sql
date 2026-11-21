-- Checkout: pricing, idempotency, stock reservation, cancellation, expiry.

begin;
\ir _helpers.sql

select pg_temp.remember('cafe', pg_temp.offer('cafe-molido-tarrazu-340g')::text);
select pg_temp.remember('laptop', pg_temp.offer('laptop-14-nimbo-libro')::text);
select pg_temp.remember('hamaca', pg_temp.offer('hamaca-algodon-doble')::text);
select pg_temp.remember('carreta', pg_temp.offer('carreta-decorativa-pintada-20cm')::text);
select pg_temp.remember('unpaid', pg_temp.unpaid_order('test-unpaid-030')::text);
select pg_temp.remember('pending_offer',
  (select o.id::text from public.offers o join public.sellers s on s.id = o.seller_id
   where s.slug = 'bazar-nuevo'));

-- An address outside the launch area, for the "zone not served" case.
insert into public.addresses (id, user_id, recipient_name, phone, postal_code, senas, lat, lng)
select '00000000-0000-4000-8000-0000000000a1', id, 'María Fernández Solís', '+50688881234', '70101',
       'Limón centro, 100 metros norte del Parque Vargas, casa amarilla', 9.9907, -83.0360
from auth.users where email = 'comprador@yuntera.example';

-- ── Pricing ────────────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');

do $$
declare
  r jsonb;
  o public.orders%rowtype;
  v_address uuid := (select id from public.addresses where is_default);
begin
  -- Two coffees at ₡4 950: below the free-shipping threshold, so ₡1 500 shipping.
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 2)),
    v_address, 'card', 'test-pricing-001');
  select * into o from public.orders where id = (r ->> 'order_id')::uuid;

  assert o.items_total_minor = 990000, format('items total %s', o.items_total_minor);
  assert o.shipping_minor = 150000, format('shipping %s', o.shipping_minor);
  assert o.total_minor = 1140000, format('total %s', o.total_minor);
  -- Coffee carries 1 % IVA, shipping 13 %: 990000 − 980198 = 9802, 150000 − 132743 = 17257.
  assert o.tax_included_minor = 9802 + 17257, format('tax %s', o.tax_included_minor);
  assert o.status = 'pending_payment', 'a card order waits for payment';
  assert o.zone_id = 'gam-core', 'zone comes from the address';
  assert o.ship_senas like 'De la Fuente%', 'delivery details are copied onto the order';
  assert o.promise_latest >= o.promise_earliest and o.promise_earliest > current_date - 1, 'promise set';
  assert o.withdrawal_deadline > current_date, 'withdrawal deadline set';
  assert (select count(*) from public.payments where order_id = o.id and status = 'pending') = 1,
    'one pending payment';
  assert (select count(*) from public.shipments where order_id = o.id) = 1, 'one shipment';
  perform set_config('t.order1', o.id::text, true);

  -- Retrying with the same key returns the same order and reserves nothing more.
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 2)),
    v_address, 'card', 'test-pricing-001');
  assert (r ->> 'order_id')::uuid = o.id and (r ->> 'replayed')::boolean, 'idempotent replay';
end
$$;

reset role;
do $$
begin
  assert (
    select sum(res.quantity) from public.inventory_reservations res
    join public.order_items i on i.id = res.order_item_id
    where i.order_id = current_setting('t.order1')::uuid and res.status = 'active'
  ) = 2, 'the replay did not reserve a second time';
end
$$;
select pg_temp.login('comprador@yuntera.example');

-- Free shipping at or above the zone threshold (₡25 000), and duplicate lines are merged.
do $$
declare
  r jsonb;
  o public.orders%rowtype;
begin
  r := public.place_order(
    jsonb_build_array(
      jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 3),
      jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 3)),
    (select id from public.addresses where is_default), 'sinpe_movil', 'test-pricing-002');
  select * into o from public.orders where id = (r ->> 'order_id')::uuid;
  assert o.items_total_minor = 2970000 and o.shipping_minor = 0, 'free shipping over the threshold';
  assert (select count(*) from public.order_items where order_id = o.id) = 1, 'duplicate lines merged';
  assert (select quantity from public.order_items where order_id = o.id) = 6, 'quantities added';
  assert r ->> 'sinpe_reference' is not null, 'SINPE orders get a reference to quote';
end
$$;

-- ── Refusals ───────────────────────────────────────────────────────────────

-- A price that moved since the shopper confirmed is reported, not silently charged.
do $$
begin
  perform public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 1)),
    (select id from public.addresses where is_default), 'card', 'test-refuse-001', 1);
  raise exception 'accepted a stale total';
exception when others then
  if sqlerrm <> 'price_changed' then raise; end if;
end
$$;

do $$
declare
  v_case record;
begin
  for v_case in
    select * from (values
      ('[]'::jsonb, 'cart_empty'),
      (jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 0)), 'invalid_quantity'),
      (jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 11)), 'invalid_quantity'),
      (jsonb_build_array(jsonb_build_object('offer_id', gen_random_uuid(), 'quantity', 1)), 'offer_unavailable'),
      (jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.pending_offer'), 'quantity', 1)), 'offer_unavailable')
    ) c (items, expected)
  loop
    begin
      perform public.place_order(v_case.items, (select id from public.addresses where is_default),
                                 'card', 'test-refuse-' || v_case.expected || md5(v_case.items::text));
      raise exception 'accepted % (expected %)', v_case.items, v_case.expected;
    exception when others then
      if sqlerrm <> v_case.expected then raise; end if;
    end;
  end loop;
end
$$;

do $$
begin
  perform public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 1)),
    '00000000-0000-4000-8000-0000000000a1', 'card', 'test-refuse-zone');
  raise exception 'accepted an address outside the service area';
exception when others then
  if sqlerrm <> 'zone_not_served' then raise; end if;
end
$$;

do $$
begin
  perform public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 1)),
    gen_random_uuid(), 'card', 'test-refuse-address');
  raise exception 'accepted an address that is not the shopper''s';
exception when others then
  if sqlerrm <> 'address_not_found' then raise; end if;
end
$$;

-- Cash on delivery is capped: a ₡289 000 laptop must be prepaid.
do $$
begin
  perform public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.laptop'), 'quantity', 1)),
    (select id from public.addresses where is_default), 'cash_on_delivery', 'test-refuse-cod');
  raise exception 'accepted a high-value cash order';
exception when others then
  if sqlerrm <> 'cod_not_available' then raise; end if;
end
$$;

reset role;

-- ── Stock: the last units cannot be sold twice ─────────────────────────────

update public.stock_levels l
set on_hand = l.reserved + 3
from public.offers o
where o.id = current_setting('t.hamaca')::uuid and l.sku_id = o.sku_id and l.seller_id = o.seller_id;

do $$
begin
  assert (select available_quantity from public.offers where id = current_setting('t.hamaca')::uuid) = 3,
    'availability follows stock';
end
$$;

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  r jsonb;
begin
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.hamaca'), 'quantity', 2)),
    (select id from public.addresses where is_default), 'card', 'test-stock-001');
  perform set_config('t.stock_order', r ->> 'order_id', true);
end
$$;
reset role;

select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  assert (select available_quantity from public.offers where id = current_setting('t.hamaca')::uuid) = 1,
    'one unit left after the first order';
  perform public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.hamaca'), 'quantity', 2)),
    (select id from public.addresses where is_default), 'card', 'test-stock-002');
  raise exception 'sold two units when one was left';
exception when others then
  if sqlerrm <> 'insufficient_stock' then raise; end if;
end
$$;
do $$
begin
  -- The failed attempt left nothing behind …
  assert (select count(*) from public.orders where idempotency_key = 'test-stock-002') = 0,
    'no order from a failed checkout';
  -- … and the one remaining unit can still be bought.
  perform public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.hamaca'), 'quantity', 1)),
    (select id from public.addresses where is_default), 'card', 'test-stock-003');
  assert (select available_quantity from public.offers where id = current_setting('t.hamaca')::uuid) = 0,
    'sold out';
  assert not (select in_stock from public.products where slug = 'hamaca-algodon-doble'),
    'the listing shows out of stock';
end
$$;
reset role;

do $$
begin
  assert not exists (select 1 from public.stock_levels where reserved > on_hand or reserved < 0),
    'reserved never exceeds on hand';
end
$$;

-- ── Cancellation ───────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  r jsonb;
begin
  -- An unpaid order: stock comes back, payment is cancelled.
  r := public.cancel_order(current_setting('t.stock_order')::uuid, 'Cambié de opinión');
  assert r ->> 'status' = 'cancelled', 'unpaid order is cancelled';
  assert (select available_quantity from public.offers where id = current_setting('t.hamaca')::uuid) = 2,
    'its two units are back on sale';
  assert (select status from public.payments where order_id = current_setting('t.stock_order')::uuid)
    = 'cancelled', 'payment cancelled';
  assert (select bool_and(status = 'cancelled') from public.shipments
          where order_id = current_setting('t.stock_order')::uuid), 'shipments cancelled';

  -- A paid order: refunded in full, by the same route the money came in.
  perform public.confirm_sandbox_payment(current_setting('t.order1')::uuid);
  assert (select status from public.orders where id = current_setting('t.order1')::uuid) = 'confirmed',
    'payment confirms the order';
  r := public.cancel_order(current_setting('t.order1')::uuid);
  assert r ->> 'status' = 'refunded', format('paid order is refunded, got %s', r ->> 'status');
  assert (select status from public.payments where order_id = current_setting('t.order1')::uuid)
    = 'refunded', 'payment refunded';

  -- Cancelling twice is refused.
  begin
    perform public.cancel_order(current_setting('t.order1')::uuid);
    raise exception 'cancelled twice';
  exception when others then
    if sqlerrm <> 'too_late_to_cancel' then raise; end if;
  end;
end
$$;
reset role;

do $$
declare
  v_order uuid := current_setting('t.order1')::uuid;
begin
  -- Capture and refund cancel out exactly, account by account.
  assert not exists (
    select 1 from public.ledger_entries e
    join public.ledger_transactions t on t.id = e.transaction_id
    where t.order_id = v_order
    group by e.account_id having sum(e.amount_minor) <> 0
  ), 'the refund reverses every ledger entry of the capture';
  assert (select count(*) from public.ledger_transactions where order_id = v_order) = 2,
    'one capture and one refund';
  assert not exists (
    select 1 from public.inventory_reservations res
    join public.order_items i on i.id = res.order_item_id
    where i.order_id = v_order and res.status = 'active'
  ), 'no reservation survives a cancellation';
end
$$;

-- Once the warehouse has started, the shopper can no longer cancel on their own.
select pg_temp.remember('in_prep',
  (select o.id::text from public.orders o where o.idempotency_key = 'seed-today-d1'));
select pg_temp.login('bodega@yuntera.example');
do $$
begin
  perform public.wms_start_picking(
    (select id from public.shipments where order_id = current_setting('t.in_prep')::uuid));
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  perform public.cancel_order(current_setting('t.in_prep')::uuid);
  raise exception 'shopper cancelled an order already being prepared';
exception when others then
  if sqlerrm <> 'too_late_to_cancel' then raise; end if;
end
$$;
reset role;

-- ── Guards that hold even for the database owner ───────────────────────────

do $$
begin
  update public.orders set status = 'delivered' where id = current_setting('t.unpaid')::uuid;
  raise exception 'jumped from pending payment to delivered';
exception when others then
  if sqlerrm <> 'invalid_order_transition' then raise; end if;
end
$$;

do $$
begin
  update public.shipments set status = 'delivered'
  where order_id = (select id from public.orders where idempotency_key = 'seed-today-d2');
  raise exception 'shipment skipped picking, packing and dispatch';
exception when others then
  if sqlerrm <> 'invalid_shipment_transition' then raise; end if;
end
$$;

-- ── Unpaid orders expire and release their stock ───────────────────────────

do $$
declare
  v_order uuid := (select id from public.orders where idempotency_key = 'test-pricing-002');
  v_before integer := (select available_quantity from public.offers where id = current_setting('t.cafe')::uuid);
  v_expired integer;
begin
  -- Anything else already stale (the seed's unpaid order, on an older database) may go here.
  perform private.expire_unpaid_orders();
  assert (select status from public.orders where id = v_order) = 'pending_payment', 'fresh orders are left alone';
  update public.orders set placed_at = now() - interval '31 minutes' where id = v_order;
  v_expired := private.expire_unpaid_orders();
  assert v_expired >= 1, 'stale unpaid order expires';
  assert (select status from public.orders where id = v_order) = 'cancelled', 'and is cancelled';
  assert (select available_quantity from public.offers where id = current_setting('t.cafe')::uuid)
    = v_before + 6, 'its six units are back on sale';
end
$$;

-- ── The sandbox payment switch ─────────────────────────────────────────────

update public.app_settings set value = '"live"' where key = 'payments_mode';
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  perform public.confirm_sandbox_payment(current_setting('t.unpaid')::uuid);
  raise exception 'simulated a payment while in live mode';
exception when others then
  if sqlerrm <> 'sandbox_disabled' then raise; end if;
end
$$;
reset role;

rollback;
