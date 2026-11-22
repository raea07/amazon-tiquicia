-- Money: seller fees match the TypeScript specification, and the ledger balances.
--
-- The fee cases are the ones in packages/core/src/fees.test.ts. If a number is
-- changed here it must be changed there, and vice versa.

begin;
\ir _helpers.sql

-- A catalogue built for the cases: one seller, known prices, sizes and categories.
select pg_temp.remember('seller', (select id::text from public.sellers where slug = 'ferreteria-el-higueron'));
select pg_temp.remember('seller_wh', (select id::text from public.warehouses where code = 'HIG-HER'));
select pg_temp.remember('platform_wh', (select id::text from public.warehouses where code = 'SJO1'));

create function pg_temp.fixture(
  p_code text, p_category text, p_price_colones integer, p_fulfillment public.fulfillment_type,
  p_weight integer, p_longest numeric
) returns uuid
language plpgsql as $$
declare
  v_product uuid;
  v_sku uuid;
  v_offer uuid;
  v_seller uuid := current_setting('t.seller')::uuid;
begin
  insert into public.products (slug, title, category_id, status, created_by_seller_id)
  values ('fixture-' || lower(p_code), 'Producto de prueba ' || p_code,
          (select id from public.categories where slug = p_category), 'active', v_seller)
  returning id into v_product;
  insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
  values (v_product, 'FIX-' || p_code, p_weight, p_longest, 5, 5) returning id into v_sku;
  insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days)
  values (v_sku, v_seller, p_price_colones * 100::bigint, p_fulfillment, 0) returning id into v_offer;
  perform private.apply_stock_change(
    case when p_fulfillment = 'platform' then current_setting('t.platform_wh')::uuid
         else current_setting('t.seller_wh')::uuid end,
    v_sku, v_seller, 50, 'receive', null, 'test', null, 'fixture');
  return v_offer;
end;
$$;

select pg_temp.remember('home_seller', pg_temp.fixture('HOME1', 'hogar', 20000, 'seller', 800, 30)::text);
select pg_temp.remember('home_platform', pg_temp.fixture('HOME2', 'hogar', 20000, 'platform', 800, 30)::text);
-- Since 21 November 2026 the price floor (20261121082900_integrity.sql)
-- refuses a ₡500 offer: sold alone and paid in cash, its fees would exceed it.
-- The fee arithmetic for small amounts is still specified, so this one fixture
-- is written past the floor; 115_integrity.sql tests the floor itself.
alter table public.offers disable trigger offers_price_covers_fees;
select pg_temp.remember('cheap', pg_temp.fixture('CHEAP', 'hogar', 500, 'seller', 100, 10)::text);
alter table public.offers enable trigger offers_price_covers_fees;
select pg_temp.remember('electronics', pg_temp.fixture('ELEC', 'audio', 20000, 'seller', 300, 20)::text);

-- Places and pays an order for one fixture as the demo shopper. The checkout
-- functions identify the caller from the JWT claims, so setting the claims is
-- enough here; role enforcement is covered by 020_access.sql.
create function pg_temp.buy(
  p_offer text, p_quantity integer, p_method public.payment_method, p_key text
) returns void
language plpgsql as $$
declare
  v_user uuid := (select id from auth.users where email = 'comprador@yuntera.example');
  r jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.' || p_offer), 'quantity', p_quantity)),
    (select id from public.addresses where user_id = v_user and is_default), p_method, p_key);
  if p_method = 'card' then
    perform public.confirm_sandbox_payment((r ->> 'order_id')::uuid);
  else
    -- Stands in for the gateway webhook that confirms a transfer.
    perform private.capture_payment((r ->> 'order_id')::uuid, 'test:' || p_key, false);
  end if;
  perform set_config('t.last_order', r ->> 'order_id', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Case 1 — seller-fulfilled, card: ₡20 000 in "hogar" (12 %).
--   referral 2 400 · payment 3.9 % + ₡180 = 960 · net 3 360 · IVA 436.80 · payout 16 203.20
select pg_temp.buy('home_seller', 1, 'card', 'test-fees-001');
do $$
declare
  f public.seller_order_fees;
begin
  select * into f from public.seller_order_fees where order_id = current_setting('t.last_order')::uuid;
  assert f.items_gross_minor = 2000000, 'gross';
  assert f.referral_fee_minor = 240000, format('referral %s', f.referral_fee_minor);
  assert f.fulfillment_fee_minor = 0, 'no fulfilment fee when the seller ships';
  assert f.payment_fee_minor = 96000, format('payment %s', f.payment_fee_minor);
  assert f.fees_net_minor = 336000, format('net %s', f.fees_net_minor);
  assert f.fees_tax_minor = 43680, format('tax %s', f.fees_tax_minor);
  assert f.payout_minor = 1620320, format('payout %s', f.payout_minor);
  assert f.schedule_version = '2026-11-assumptions', 'statement records the schedule used';
end
$$;

-- Case 2 — platform-fulfilled, SINPE Móvil, two units: tier "pequeno" ₡1 400 each.
--   referral 4 800 · fulfilment 2 800 · payment 1.5 % of 40 000 = 600
select pg_temp.buy('home_platform', 2, 'sinpe_movil', 'test-fees-002');
do $$
declare
  f public.seller_order_fees;
begin
  select * into f from public.seller_order_fees where order_id = current_setting('t.last_order')::uuid;
  assert f.referral_fee_minor = 480000, format('referral %s', f.referral_fee_minor);
  assert f.fulfillment_fee_minor = 280000, format('fulfilment %s', f.fulfillment_fee_minor);
  assert f.payment_fee_minor = 60000, format('payment %s', f.payment_fee_minor);
end
$$;

-- Case 3 — the per-unit floor: four ₡500 items. 12 % would be ₡240; the floor is 4 × ₡150.
select pg_temp.buy('cheap', 4, 'card', 'test-fees-003');
do $$
begin
  assert (select referral_fee_minor from public.seller_order_fees
          where order_id = current_setting('t.last_order')::uuid) = 60000, 'referral floor applies';
end
$$;

-- Case 4 — a sub-category inherits its parent's rate: "audio" under "electronica" is 8 %.
select pg_temp.buy('electronics', 1, 'card', 'test-fees-004');
do $$
begin
  assert (select referral_fee_minor from public.seller_order_fees
          where order_id = current_setting('t.last_order')::uuid) = 160000, 'inherited category rate';
end
$$;

-- ── The ledger ─────────────────────────────────────────────────────────────

do $$
declare
  v_order uuid := current_setting('t.last_order')::uuid;
  v_tx uuid;
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = v_order;
  select id into v_tx from public.ledger_transactions where order_id = v_order and kind = 'order_capture';

  assert (select sum(amount_minor) from public.ledger_entries where transaction_id = v_tx) = 0,
    'the capture balances';
  -- What came in is exactly what the shopper paid.
  assert (select sum(amount_minor) from public.ledger_entries
          where transaction_id = v_tx and amount_minor > 0) = o.total_minor, 'debits equal the order total';
  -- What the seller is owed is exactly their statement.
  assert (select -sum(e.amount_minor) from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id
          where e.transaction_id = v_tx and a.seller_id is not null)
       = (select payout_minor from public.seller_order_fees where order_id = v_order),
    'seller payable equals the statement';

  -- The same confirmation again changes nothing. A different one for a paid
  -- order is a second payment, and is refused rather than silently dropped
  -- (since 21 November 2026; see 115_integrity.sql, INT-7).
  perform private.capture_payment(v_order,
    (select provider_reference from public.payments where order_id = v_order), false);
  assert (select count(*) from public.ledger_transactions
          where order_id = v_order and kind = 'order_capture') = 1, 'capture is idempotent';
  begin
    perform private.capture_payment(v_order, 'test:again', false);
    raise exception 'a second payment was accepted';
  exception when others then
    if sqlerrm <> 'order_not_payable' then raise; end if;
  end;
end
$$;

-- Across the whole database, the books balance and every transaction balances.
do $$
begin
  assert (select sum(amount_minor) from public.ledger_entries) = 0, 'the ledger sums to zero';
  assert not exists (
    select 1 from public.ledger_entries group by transaction_id having sum(amount_minor) <> 0
  ), 'every transaction balances';
end
$$;

-- An unbalanced transaction is rejected.
do $$
declare
  v_tx uuid;
begin
  insert into public.ledger_transactions (kind, memo) values ('adjustment', 'desbalanceado')
  returning id into v_tx;
  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  values (v_tx, private.ledger_account('gateway_clearing'), 1000);
  set constraints all immediate;
  raise exception 'an unbalanced entry was accepted';
exception when others then
  if sqlerrm not like 'Ledger transaction % is out of balance by 1000' then raise; end if;
end
$$;
set constraints all deferred;

-- Posted entries cannot be edited or removed.
do $$
begin
  update public.ledger_entries set amount_minor = amount_minor + 1;
  raise exception 'a ledger entry was edited';
exception when others then
  if sqlerrm <> 'Rows in ledger_entries are immutable' then raise; end if;
end
$$;

do $$
begin
  delete from public.stock_movements;
  raise exception 'stock history was deleted';
exception when others then
  if sqlerrm <> 'Rows in stock_movements are immutable' then raise; end if;
end
$$;

rollback;
