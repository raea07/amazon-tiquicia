-- Fixes: one fixed payment fee per order, lines that ship from several
-- locations, the shop's "does this address exist" check, and listing edits.
-- Each is checked for the right caller, the wrong caller and what it leaves behind.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

select pg_temp.remember('buyer', (select id::text from auth.users where email = 'comprador@yuntera.example'));
select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
-- Listing edits made on a shared preview before this suite runs are counted,
-- so the suite stays re-runnable there.
select pg_temp.remember('prior_requests', (select count(*)::text from public.product_change_requests));
select pg_temp.remember('prior_vendedor_requests',
  (select count(*)::text from public.product_change_requests r
   join public.seller_members m on m.seller_id = r.seller_id
   join auth.users u on u.id = m.user_id where u.email = 'vendedor@yuntera.example'));

-- Back to the superuser with nobody signed in. (`reset role` alone leaves the
-- last user's claims in place, and the listing rules look at them.)
create function pg_temp.logout() returns void
language sql as $$ select set_config('request.jwt.claims', '', true) $$;

-- Runs a statement that must be refused with the given code.
create function pg_temp.refused(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
end;
$$;
-- The shared helpers are for the superuser between steps. This one is called
-- while impersonating, so the API roles need to reach the temporary schema.
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.refused(text, text) to authenticated, anon;

-- ═══ 1. One fixed payment fee per order ════════════════════════════════════

-- The split itself. packages/core/src/cr/compliance.test.ts reads the lines
-- between the markers and runs the same cases through the TypeScript, so a
-- number changed here must still be what splitFixedPaymentFee computes.
-- Sellers are named by their position in the list: …0001, …0002, and so on.
create function pg_temp.check_split(p_fixed bigint, p_sales bigint[], p_expected bigint[]) returns void
language plpgsql as $$
declare
  v_got bigint[];
begin
  select array_agg(s.share_minor order by s.seller_id) into v_got
  from private.split_fixed_fee(
    p_fixed,
    (select array_agg(('00000000-0000-4000-8000-00000000000' || n)::uuid order by n)
     from generate_subscripts(p_sales, 1) n),
    p_sales) s;
  assert v_got = p_expected, format('%s over %s: expected %s, got %s', p_fixed, p_sales, p_expected, v_got);
  -- The parts add up to the fee, except when nothing was sold: then there is
  -- nothing to share it by and every part is 0.
  assert (select sum(x) from unnest(v_got) x)
         = case when (select sum(x) from unnest(p_sales) x) > 0 then p_fixed else 0 end,
         format('%s over %s does not add up', p_fixed, p_sales);
end;
$$;

-- BEGIN fixed_fee_split_cases
select pg_temp.check_split(18000, '{2000000}', '{18000}');
select pg_temp.check_split(18000, '{2000000,990000,420000}', '{10557,5226,2217}');
select pg_temp.check_split(30000, '{1000000,1000000,1000000}', '{10000,10000,10000}');
select pg_temp.check_split(18000, '{100,100,100,100,100,100,100}', '{2572,2572,2572,2571,2571,2571,2571}');
select pg_temp.check_split(30001, '{500000,500000}', '{15001,15000}');
select pg_temp.check_split(1, '{1,999999999}', '{0,1}');
select pg_temp.check_split(17, '{300,200,100,100}', '{7,5,3,2}');
select pg_temp.check_split(0, '{2000000,990000}', '{0,0}');
select pg_temp.check_split(18000, '{1299000000,99,349900}', '{17995,0,5}');
select pg_temp.check_split(18000, '{0,0}', '{0,0}');
-- END fixed_fee_split_cases

-- A product of a given seller at a known price, with stock where its offer sells from.
create function pg_temp.fixture(
  p_code text, p_seller_slug text, p_price_colones integer, p_fulfillment public.fulfillment_type,
  p_weight integer, p_longest numeric, p_stock integer default 50
) returns uuid
language plpgsql as $$
declare
  v_seller uuid := (select id from public.sellers where slug = p_seller_slug);
  v_product uuid;
  v_sku uuid;
  v_offer uuid;
begin
  insert into public.products (slug, title, category_id, status, created_by_seller_id)
  values ('fixture-' || lower(p_code), 'Producto de prueba ' || p_code,
          (select id from public.categories where slug = 'hogar'), 'active', v_seller)
  returning id into v_product;
  insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
  values (v_product, 'FIX-' || p_code, p_weight, p_longest, 5, 5) returning id into v_sku;
  insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days)
  values (v_sku, v_seller, p_price_colones * 100::bigint, p_fulfillment, 0) returning id into v_offer;
  if p_stock > 0 then
    perform private.apply_stock_change(
      case when p_fulfillment = 'platform' then current_setting('t.depot')::uuid
           else (select id from public.warehouses where seller_id = v_seller and kind = 'seller' limit 1) end,
      v_sku, v_seller, p_stock, 'receive', null, 'test', null, 'fixture');
  end if;
  return v_offer;
end;
$$;

-- Three sellers in one card order, all in "hogar" (12 %). The same order is
-- worked out in packages/core/src/fees.test.ts; the numbers must match.
--   A  ₡20 000, ships it themselves
--   B  ₡9 900, from the Yuntera warehouse (tier "pequeno", ₡1 400)
--   C  ₡4 200, from the Yuntera warehouse (tier "sobre", ₡900)
select pg_temp.remember('fee_a', pg_temp.fixture('FEEA', 'ferreteria-el-higueron', 20000, 'seller', 800, 30)::text);
select pg_temp.remember('fee_b', pg_temp.fixture('FEEB', 'tecnocasa', 9900, 'platform', 800, 30)::text);
select pg_temp.remember('fee_c', pg_temp.fixture('FEEC', 'cafetal-los-santos', 4200, 'platform', 300, 20)::text);

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  r jsonb;
begin
  r := public.place_order(
    jsonb_build_array(
      jsonb_build_object('offer_id', current_setting('t.fee_a'), 'quantity', 1),
      jsonb_build_object('offer_id', current_setting('t.fee_b'), 'quantity', 1),
      jsonb_build_object('offer_id', current_setting('t.fee_c'), 'quantity', 1)),
    (select id from public.addresses where is_default), 'card', 'test-fixes-fee-001');
  perform public.confirm_sandbox_payment((r ->> 'order_id')::uuid);
  perform set_config('t.fee_order', r ->> 'order_id', true);
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  v_order uuid := current_setting('t.fee_order')::uuid;
  v_fixed bigint := (select fixed_minor from public.fee_payment_methods m
                     join public.fee_schedules s on s.version = m.schedule_version
                     where s.active and m.method = 'card');
  v_tx uuid;
  o public.orders%rowtype;
  f record;
begin
  select * into o from public.orders where id = v_order;
  assert (select count(*) from public.seller_order_fees where order_id = v_order) = 3, 'one statement per seller';

  -- The fixed parts add up to the fixed fee: charged once, not three times.
  assert v_fixed = 18000, 'the card fee has a fixed part of ₡180';
  assert (select sum(payment_fee_minor - round(items_gross_minor::numeric * 390 / 10000))
          from public.seller_order_fees where order_id = v_order) = v_fixed,
    'the sellers together pay the fixed amount exactly once';

  -- Each seller's statement, to the céntimo (payment = 3.9 % of their sales + their share).
  for f in
    select s.slug, x.*
    from public.seller_order_fees x join public.sellers s on s.id = x.seller_id
    where x.order_id = v_order
  loop
    if f.slug = 'ferreteria-el-higueron' then
      assert (f.items_gross_minor, f.referral_fee_minor, f.fulfillment_fee_minor, f.payment_fee_minor,
              f.fees_net_minor, f.fees_tax_minor, f.payout_minor)
           = (2000000, 240000, 0, 78000 + 10557, 328557, 42712, 1628731), format('seller A: %s', f);
    elsif f.slug = 'tecnocasa' then
      assert (f.items_gross_minor, f.referral_fee_minor, f.fulfillment_fee_minor, f.payment_fee_minor,
              f.fees_net_minor, f.fees_tax_minor, f.payout_minor)
           = (990000, 118800, 140000, 38610 + 5226, 302636, 39343, 648021), format('seller B: %s', f);
    else
      assert (f.items_gross_minor, f.referral_fee_minor, f.fulfillment_fee_minor, f.payment_fee_minor,
              f.fees_net_minor, f.fees_tax_minor, f.payout_minor)
           = (420000, 50400, 90000, 16380 + 2217, 158997, 20670, 240333), format('seller C: %s', f);
    end if;
    -- The table's own rules, spelled out: the fees add up and so does the payout.
    assert f.fees_net_minor = f.referral_fee_minor + f.fulfillment_fee_minor + f.payment_fee_minor
       and f.payout_minor = f.items_gross_minor - f.fees_net_minor - f.fees_tax_minor
       and f.payout_minor > 0, format('statement of %s adds up', f.slug);
  end loop;

  -- The ledger: the capture balances, and books exactly these statements.
  select id into v_tx from public.ledger_transactions where order_id = v_order and kind = 'order_capture';
  assert (select sum(amount_minor) from public.ledger_entries where transaction_id = v_tx) = 0,
    'the capture balances';
  assert (select sum(amount_minor) from public.ledger_entries
          where transaction_id = v_tx and amount_minor > 0) = o.total_minor, 'debits equal the order total';
  assert (select -sum(e.amount_minor) from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id
          where e.transaction_id = v_tx and a.code = 'payment_fee_revenue')
       = 78000 + 38610 + 16380 + 18000, 'payment fees booked: the rate on each sale plus ₡180 once';
  assert not exists (
    select 1 from public.seller_order_fees x
    where x.order_id = v_order
      and x.payout_minor <> (
        select -sum(e.amount_minor) from public.ledger_entries e
        join public.ledger_accounts a on a.id = e.account_id
        where e.transaction_id = v_tx and a.seller_id = x.seller_id)
  ), 'each seller is owed exactly their statement';
end
$$;

-- ═══ 2. A line can ship from several locations ═════════════════════════════

-- A second Yuntera warehouse, with a shelf and the same associate.
insert into public.warehouses (id, code, name, kind, address, postal_code, lat, lng)
values ('00000000-0000-4000-8000-0000000000b2', 'SJO2', 'Bodega de prueba Heredia', 'platform',
        'Heredia centro, 100 metros este del mercado', '40101', 9.9981, -84.1170);
insert into public.warehouse_locations (id, warehouse_id, code, kind)
values ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b2', 'A-01-01-A', 'pick');
insert into public.warehouse_staff (warehouse_id, user_id)
select '00000000-0000-4000-8000-0000000000b2', id from auth.users where email = 'bodega@yuntera.example';
select pg_temp.remember('depot2', '00000000-0000-4000-8000-0000000000b2');
select pg_temp.remember('bin1',
  (select id::text from public.warehouse_locations
   where warehouse_id = current_setting('t.depot')::uuid and kind = 'pick' order by code limit 1));
select pg_temp.remember('bin2', '00000000-0000-4000-8000-0000000000b3');

-- Puts units of a fixture on a shelf in one of the two warehouses.
create function pg_temp.stock(p_offer text, p_depot text, p_units integer) returns void
language sql as $$
  select private.apply_stock_change(
    current_setting('t.' || p_depot)::uuid, o.sku_id, o.seller_id, p_units, 'receive',
    current_setting('t.' || case p_depot when 'depot' then 'bin1' else 'bin2' end)::uuid,
    'test', null, 'fixture')
  from public.offers o where o.id = current_setting('t.' || p_offer)::uuid;
$$;

-- "split": one unit in each warehouse. The shop shows two.
select pg_temp.remember('split', pg_temp.fixture('SPLIT', 'tecnocasa', 5000, 'platform', 400, 20, 0)::text);
select pg_temp.stock('split', 'depot', 1);
select pg_temp.stock('split', 'depot2', 1);
-- "whole": one location alone can send two; "fullest": 2 here and 3 there.
select pg_temp.remember('whole', pg_temp.fixture('WHOLE', 'tecnocasa', 5000, 'platform', 400, 20, 0)::text);
select pg_temp.stock('whole', 'depot', 1);
select pg_temp.stock('whole', 'depot2', 3);
select pg_temp.remember('fullest', pg_temp.fixture('FULLEST', 'tecnocasa', 5000, 'platform', 400, 20, 0)::text);
select pg_temp.stock('fullest', 'depot', 2);
select pg_temp.stock('fullest', 'depot2', 3);

do $$
begin
  assert (select available_quantity from public.offers where id = current_setting('t.split')::uuid) = 2,
    'availability is the stock of both warehouses';
end
$$;

select pg_temp.login('comprador@yuntera.example');
do $$
declare
  r jsonb;
  v_address uuid := (select id from public.addresses where is_default);
begin
  -- What the shop shows a visitor…
  assert (select available from public.cart_lines(array[current_setting('t.split')::uuid])) = 2,
    'the cart offers two';

  -- …is what can be ordered. Three is more than exists anywhere: refused, nothing held.
  perform pg_temp.refused(format(
    $q$select public.place_order('[{"offer_id": "%s", "quantity": 3}]', '%s', 'sinpe_movil', 'test-fixes-split-000')$q$,
    current_setting('t.split'), v_address), 'insufficient_stock');

  -- Two succeeds, although no single warehouse has two.
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.split'), 'quantity', 2)),
    v_address, 'sinpe_movil', 'test-fixes-split-001');
  perform set_config('t.split_order', r ->> 'order_id', true);
  perform set_config('t.split_number', r ->> 'order_number', true);
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  v_order uuid := current_setting('t.split_order')::uuid;
  v_sku uuid := (select sku_id from public.offers where id = current_setting('t.split')::uuid);
begin
  assert not exists (select 1 from public.orders where idempotency_key = 'test-fixes-split-000'),
    'the refused order left nothing behind';
  assert (select count(*) = 1 and sum(quantity) = 2 from public.order_items where order_id = v_order),
    'one line for two units';
  assert (select count(*) from public.shipments where order_id = v_order) = 2, 'two parcels, one per warehouse';
  assert (select count(distinct origin_warehouse_id) from public.shipments where order_id = v_order) = 2,
    'the parcels leave from different warehouses';
  assert (select count(*) = 2 and bool_and(si.quantity = 1)
          from public.shipment_items si join public.shipments s on s.id = si.shipment_id
          where s.order_id = v_order), 'each parcel carries one unit of the line';
  assert (select count(*) = 2 and bool_and(res.quantity = 1 and res.status = 'active')
            and count(distinct res.warehouse_id) = 2
          from public.inventory_reservations res join public.order_items i on i.id = res.order_item_id
          where i.order_id = v_order), 'one unit reserved in each warehouse';
  assert (select count(*) = 2 and bool_and(on_hand = 1 and reserved = 1)
          from public.stock_levels where sku_id = v_sku), 'both stock rows hold their unit';
  assert (select available_quantity from public.offers where id = current_setting('t.split')::uuid) = 0,
    'nothing is left to sell';
  assert not exists (select 1 from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
                     where s.order_id = v_order), 'no picking before payment';
end
$$;

-- Cancelling releases both reservations.
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert jsonb_array_length(public.get_order(current_setting('t.split_number')) -> 'shipments') = 2,
    'the shopper sees both parcels';
  perform public.cancel_order(current_setting('t.split_order')::uuid, 'Prueba');
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  v_order uuid := current_setting('t.split_order')::uuid;
  v_sku uuid := (select sku_id from public.offers where id = current_setting('t.split')::uuid);
begin
  assert (select count(*) = 2 and bool_and(res.status = 'released')
          from public.inventory_reservations res join public.order_items i on i.id = res.order_item_id
          where i.order_id = v_order), 'both reservations released';
  assert (select bool_and(on_hand = 1 and reserved = 0) from public.stock_levels where sku_id = v_sku),
    'both units are free again';
  assert (select bool_and(status = 'cancelled') from public.shipments where order_id = v_order),
    'both parcels cancelled';
  assert (select available_quantity from public.offers where id = current_setting('t.split')::uuid) = 2,
    'two can be bought again';
end
$$;

-- Bought again and paid: each warehouse gets its own pick task and packs its own parcel.
select pg_temp.login('comprador@yuntera.example');
do $$
declare
  r jsonb;
  v_address uuid := (select id from public.addresses where is_default);
begin
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.split'), 'quantity', 2)),
    v_address, 'card', 'test-fixes-split-002');
  perform public.confirm_sandbox_payment((r ->> 'order_id')::uuid);
  perform set_config('t.paid_order', r ->> 'order_id', true);

  -- A location that can send the whole line does so alone…
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.whole'), 'quantity', 2)),
    v_address, 'sinpe_movil', 'test-fixes-split-003');
  perform set_config('t.whole_order', r ->> 'order_id', true);
  -- …and a line that must be split takes from the fullest location first.
  r := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.fullest'), 'quantity', 4)),
    v_address, 'sinpe_movil', 'test-fixes-split-004');
  perform set_config('t.fullest_order', r ->> 'order_id', true);
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  v_order uuid := current_setting('t.paid_order')::uuid;
begin
  assert (select count(*) = 2 and bool_and(t.quantity = 1 and t.status = 'open')
            and count(distinct t.warehouse_id) = 2
            and bool_and(t.warehouse_id = s.origin_warehouse_id)
            and bool_and(t.location_id in (current_setting('t.bin1')::uuid, current_setting('t.bin2')::uuid))
          from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = v_order), 'one pick task per warehouse, each pointing at its own shelf';

  assert (select count(*) = 1 and bool_and(origin_warehouse_id = current_setting('t.depot2')::uuid)
          from public.shipments where order_id = current_setting('t.whole_order')::uuid),
    'a line one warehouse can send whole is not split';
  assert (select jsonb_object_agg(w.code, si.quantity)
          from public.shipment_items si
          join public.shipments s on s.id = si.shipment_id
          join public.warehouses w on w.id = s.origin_warehouse_id
          where s.order_id = current_setting('t.fullest_order')::uuid)
       = '{"SJO2": 3, "SJO1": 1}'::jsonb, 'the fullest warehouse gives all it has, the other the rest';
end
$$;
select pg_temp.remember('parcel1', (select id::text from public.shipments
  where order_id = current_setting('t.paid_order')::uuid
    and origin_warehouse_id = current_setting('t.depot')::uuid));
select pg_temp.remember('parcel2', (select id::text from public.shipments
  where order_id = current_setting('t.paid_order')::uuid
    and origin_warehouse_id = current_setting('t.depot2')::uuid));

-- The seller sees the line once per parcel, and the rows add up to what was sold.
select pg_temp.remember('paid_number',
  (select order_number from public.orders where id = current_setting('t.paid_order')::uuid));
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_number text := current_setting('t.paid_number');
begin
  assert (select count(*) = 2 and count(distinct order_item_id) = 1 and count(distinct shipment_id) = 2
            and bool_and(quantity = 1 and line_total_minor = 500000)
          from public.seller_order_lines(current_setting('t.tecnocasa')::uuid, 200)
          where order_number = v_number), 'one row per parcel, each with its own units and amount';
end
$$;
reset role; select pg_temp.logout();

-- The first warehouse picks and packs its parcel; the other's unit stays reserved.
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v_parcel uuid := current_setting('t.parcel1')::uuid;
  s jsonb;
begin
  perform public.wms_start_picking(v_parcel);
  s := public.wms_shipment(v_parcel);
  assert jsonb_array_length(s -> 'tasks') = 1 and (s #>> '{tasks,0,quantity}')::integer = 1,
    format('the pick list asks for one unit: %s', s -> 'tasks');
  perform public.wms_confirm_pick((s #>> '{tasks,0,task_id}')::uuid, 1, null, s #>> '{tasks,0,sku_code}');
  perform public.wms_pack_shipment(v_parcel, 450, 1::smallint);
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  v_order uuid := current_setting('t.paid_order')::uuid;
  v_sku uuid := (select sku_id from public.offers where id = current_setting('t.split')::uuid);
begin
  assert (select (on_hand, reserved) = (0, 0) from public.stock_levels
          where sku_id = v_sku and warehouse_id = current_setting('t.depot')::uuid), 'the packed unit left its warehouse';
  assert (select (on_hand, reserved) = (1, 1) from public.stock_levels
          where sku_id = v_sku and warehouse_id = current_setting('t.depot2')::uuid),
    'the other warehouse still holds and owes its unit';
  assert (select jsonb_object_agg(w.code, res.status)
          from public.inventory_reservations res
          join public.order_items i on i.id = res.order_item_id
          join public.warehouses w on w.id = res.warehouse_id
          where i.order_id = v_order) = '{"SJO1": "consumed", "SJO2": "active"}'::jsonb,
    'only the packed parcel''s reservation is consumed';
end
$$;

select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v_parcel uuid := current_setting('t.parcel2')::uuid;
  s jsonb;
begin
  perform public.wms_start_picking(v_parcel);
  s := public.wms_shipment(v_parcel);
  perform public.wms_confirm_pick((s #>> '{tasks,0,task_id}')::uuid, 1, null, s #>> '{tasks,0,sku_code}');
  perform public.wms_pack_shipment(v_parcel, 450, 1::smallint);
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  v_order uuid := current_setting('t.paid_order')::uuid;
  v_sku uuid := (select sku_id from public.offers where id = current_setting('t.split')::uuid);
begin
  assert (select bool_and(status = 'packed') from public.shipments where order_id = v_order), 'both parcels packed';
  assert (select bool_and(on_hand = 0 and reserved = 0) from public.stock_levels where sku_id = v_sku),
    'both units have left';
  assert (select bool_and(res.status = 'consumed') from public.inventory_reservations res
          join public.order_items i on i.id = res.order_item_id where i.order_id = v_order),
    'both reservations consumed';
  -- The stock ledger explains it: one unit shipped from each warehouse, against its own parcel.
  assert (select count(*) = 2 and bool_and(m.on_hand_delta = -1 and m.quantity = 1)
            and count(distinct m.warehouse_id) = 2 and count(distinct m.reference_id) = 2
          from public.stock_movements m
          where m.sku_id = v_sku and m.reason = 'ship'
            and m.reference_id in (current_setting('t.parcel1')::uuid, current_setting('t.parcel2')::uuid)),
    'one ship movement per warehouse';
  assert (select sum(on_hand_delta) from public.stock_movements where sku_id = v_sku) = 0,
    'the ledger adds up to what is on the shelves: nothing';
  assert (select status from public.orders where id = v_order) = 'processing', 'the order is being prepared';
  assert not exists (select 1 from public.stock_levels where reserved > on_hand), 'invariant holds';
end
$$;

-- ═══ 3. Does this shop address exist? ══════════════════════════════════════

select pg_temp.remember('draft_slug', 'fixture-borrador');
insert into public.products (slug, title, category_id, status, created_by_seller_id)
select 'fixture-borrador', 'Producto de prueba en borrador', id, 'draft', current_setting('t.tecnocasa')::uuid
from public.categories where slug = 'hogar';
insert into public.categories (slug, name_es, name_en, active) values ('fixture-oculta', 'Oculta', 'Hidden', false);

select pg_temp.login_anon();
do $$
begin
  assert public.shop_path_exists('product', 'cafe-molido-tarrazu-340g'), 'a published product exists';
  assert not public.shop_path_exists('product', 'no-existe-este-producto'), 'an unknown product does not';
  assert not public.shop_path_exists('product', 'fixture-borrador'), 'a draft is not an address of the shop';
  assert public.shop_path_exists('category', 'hogar'), 'a category exists';
  assert not public.shop_path_exists('category', 'no-existe'), 'an unknown category does not';
  assert not public.shop_path_exists('category', 'fixture-oculta'), 'a category that is switched off does not';
  assert not public.shop_path_exists('seller', 'tecnocasa'), 'other kinds of address are not answered';
  assert not public.shop_path_exists('product', null), 'no slug, no page';
end
$$;
reset role; select pg_temp.logout();

-- The draft's own seller gets the same answer: the shop shows published products only.
select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  assert not public.shop_path_exists('product', 'fixture-borrador'), 'not even for its owner';
end
$$;
reset role; select pg_temp.logout();

-- ═══ 4. Editing a listing ══════════════════════════════════════════════════

select pg_temp.remember('laptop', (select id::text from public.products where slug = 'laptop-14-nimbo-libro'));
select pg_temp.remember('teclado', (select id::text from public.products where slug = 'teclado-mecanico-compacto-nimbo'));
select pg_temp.remember('cargador', (select id::text from public.products where slug = 'cargador-usb-c-30w-nimbo'));
select pg_temp.remember('parlante', (select id::text from public.products where slug = 'parlante-bluetooth-nimbo-ola'));
select pg_temp.remember('audifonos', (select id::text from public.products where slug = 'audifonos-inalambricos-nimbo-aire'));
select pg_temp.remember('laptop_title', (select title from public.products where slug = 'laptop-14-nimbo-libro'));
select pg_temp.remember('laptop_tax', (select tax_rate_bps::text from public.products where slug = 'laptop-14-nimbo-libro'));
select pg_temp.remember('laptop_description', (select md5(coalesce(description, '')) from public.products where slug = 'laptop-14-nimbo-libro'));

-- Sends an edit that changes only the title (and optionally the weight) of a listing.
create function pg_temp.retitle(p_product text, p_title text, p_weight integer default null, p_submit boolean default true)
returns jsonb
language sql as $$
  select public.seller_update_listing(
    p.id, p_title, c.slug, p.description, p.bullet_points,
    coalesce(p_weight, k.weight_grams), k.length_cm, k.width_cm, k.height_cm, null, p_submit)
  from public.products p
  join public.categories c on c.id = p.category_id
  join public.skus k on k.product_id = p.id
  where p.id = current_setting('t.' || p_product)::uuid;
$$;
grant execute on function pg_temp.retitle(text, text, integer, boolean) to authenticated;

-- ── The owner edits a published listing ────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  l jsonb;
  r jsonb;
begin
  l := public.seller_listing(current_setting('t.laptop')::uuid);
  assert l ->> 'status' = 'active' and l #>> '{content,title}' = current_setting('t.laptop_title')
     and l -> 'pending' = 'null'::jsonb and l -> 'last_rejection' = 'null'::jsonb
     and not (l ->> 'shared')::boolean and jsonb_array_length(l -> 'variants') = 1,
    format('the listing as it stands: %s', l);
  assert (public.seller_listing(current_setting('t.audifonos')::uuid) ->> 'shared')::boolean,
    'a page another seller also sells from is marked as shared';

  -- Sending back exactly what is published is not an edit.
  perform pg_temp.refused($q$select pg_temp.retitle('laptop', current_setting('t.laptop_title'))$q$,
                          'listing_unchanged');

  r := pg_temp.retitle('laptop', '  Laptop Nimbo Libro 14 pulgadas, primera propuesta  ', 2000);
  assert r ->> 'outcome' = 'in_review' and r ->> 'status' = 'active', format('edit goes to review: %s', r);
  l := public.seller_listing(current_setting('t.laptop')::uuid);
  assert l #>> '{pending,proposed,title}' = 'Laptop Nimbo Libro 14 pulgadas, primera propuesta'
     and (l #>> '{pending,proposed,weight_grams}')::integer = 2000
     and l #>> '{content,title}' = current_setting('t.laptop_title'),
    format('the proposal waits next to the published text: %s', l);
  perform set_config('t.first_request', l #>> '{pending,request_id}', true);

  -- A second edit replaces the one that was waiting.
  perform pg_temp.retitle('laptop', 'Laptop Nimbo Libro 14 pulgadas con 16 GB', 2000);
  l := public.seller_listing(current_setting('t.laptop')::uuid);
  assert l #>> '{pending,proposed,title}' = 'Laptop Nimbo Libro 14 pulgadas con 16 GB'
     and l #>> '{pending,request_id}' <> current_setting('t.first_request'), 'the newer proposal is the one waiting';
  perform set_config('t.second_request', l #>> '{pending,request_id}', true);

  assert (select (editable, edit_status) = (true, 'pending') from public.seller_listing_edits(current_setting('t.tecnocasa')::uuid)
          where product_id = current_setting('t.laptop')::uuid), 'the list of products shows the edit is waiting';
  assert (select count(*) from public.product_change_requests)
         = current_setting('t.prior_vendedor_requests')::bigint + 2, 'the owner reads their own proposals';

  -- What cannot be saved is refused before it ever reaches a reviewer.
  perform pg_temp.refused($q$select pg_temp.retitle('laptop', 'abc')$q$, 'invalid_listing');
  perform pg_temp.refused($q$select pg_temp.retitle('laptop', 'Laptop con peso imposible', 0)$q$, 'invalid_listing');
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop Nimbo en otra parte',
    'no-existe', null, '{}', 1900, 36, 26, 6)$q$, current_setting('t.laptop')), 'category_not_found');
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop Nimbo con mil cosas',
    'laptops', null, '{a,b,c,d,e,f,g,h,i}', 1900, 36, 26, 6)$q$, current_setting('t.laptop')), 'invalid_listing');
  -- A side that rounds to 0.0 cm would be stored as 0 and break the table's own rule on approval.
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop con medida rara',
    'laptops', null, '{}', 1900, 0.04, 26, 6)$q$, current_setting('t.laptop')), 'invalid_listing');
  -- Characteristics are lines of text: none missing, none blank, none endless.
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop con viñetas vacías',
    'laptops', null, array['a', null], 1900, 36, 26, 6)$q$, current_setting('t.laptop')), 'invalid_listing');
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop con viñetas vacías',
    'laptops', null, array['a', '   '], 1900, 36, 26, 6)$q$, current_setting('t.laptop')), 'invalid_listing');
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop con viñeta larguísima',
    'laptops', null, array[repeat('x', 301)], 1900, 36, 26, 6)$q$, current_setting('t.laptop')), 'invalid_listing');
  -- The same package limits as the seller app: 30 kg, 200 cm a side.
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop de mucho peso',
    'laptops', null, '{}', 30001, 36, 26, 6)$q$, current_setting('t.laptop')), 'package_over_limit');
  perform pg_temp.refused(format($q$select public.seller_update_listing('%s', 'Laptop de mucho largo',
    'laptops', null, '{}', 1900, 200.1, 26, 6)$q$, current_setting('t.laptop')), 'package_over_limit');
  assert (select count(*) from public.product_change_requests where status = 'pending') = 1,
    'nothing invalid was queued';
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  p public.products%rowtype;
begin
  select * into p from public.products where id = current_setting('t.laptop')::uuid;
  assert p.title = current_setting('t.laptop_title') and p.status = 'active',
    'the published listing has not changed';
  assert (select weight_grams from public.skus where product_id = p.id) = 1900, 'nor has its package';
  assert (select jsonb_object_agg(id::text, status) from public.product_change_requests
          where product_id = p.id and submitted_at >= now()) -- made in this suite's transaction
       = jsonb_build_object(current_setting('t.first_request'), 'withdrawn',
                            current_setting('t.second_request'), 'pending'),
    'the replaced proposal is closed; one is waiting';
end
$$;

-- ── The review cannot be skipped through the tables ────────────────────────

-- First lock: a seller holds no privilege on products or skus, so every
-- direct write is refused before any rule is looked at (lockdown migration).
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_sku uuid := (select id from public.skus where product_id = current_setting('t.laptop')::uuid);
begin
  perform pg_temp.refused(format($q$update public.products set title = 'Título sin revisión' where id = %L$q$,
    current_setting('t.laptop')), 'permission denied for table products');
  perform pg_temp.refused(format($q$update public.products set tax_rate_bps = 0 where id = %L$q$,
    current_setting('t.laptop')), 'permission denied for table products');
  perform pg_temp.refused(format($q$update public.skus set weight_grams = 1 where id = %L$q$, v_sku),
    'permission denied for table skus');
  perform pg_temp.refused(format($q$update public.skus set active = false where id = %L$q$, v_sku),
    'permission denied for table skus');
  perform pg_temp.refused(format(
    $q$insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
       values (%L, 'YT-SINREVISAR', 1, 1, 1, 1)$q$, current_setting('t.laptop')), 'permission denied for table skus');
  perform pg_temp.refused(format($q$update public.products set title = 'Cambiado' where slug = %L$q$,
    current_setting('t.draft_slug')), 'permission denied for table products');
end
$$;

-- Second lock: the rule on the table itself. Whoever writes (here the owner,
-- as any function would, with the seller's identity in the token), content
-- changes to a published listing are refused unless the caller is catalogue
-- staff: text, category and tax rate (which set the referral fee), or the
-- package (which sets the warehouse fee). Adding a variant would put it on
-- sale unreviewed.
reset role;
do $$
declare
  v_sku uuid := (select id from public.skus where product_id = current_setting('t.laptop')::uuid);
begin
  perform pg_temp.refused(format($q$update public.products set title = 'Título sin revisión' where id = %L$q$,
    current_setting('t.laptop')), 'published_listing_locked');
  perform pg_temp.refused(format($q$update public.products set description = 'spam' where id = %L$q$,
    current_setting('t.laptop')), 'published_listing_locked');
  perform pg_temp.refused(format($q$update public.products set bullet_points = '{spam}' where id = %L$q$,
    current_setting('t.laptop')), 'published_listing_locked');
  perform pg_temp.refused(format(
    $q$update public.products set category_id = (select id from public.categories where slug = 'belleza') where id = %L$q$,
    current_setting('t.laptop')), 'published_listing_locked');
  perform pg_temp.refused(format($q$update public.products set tax_rate_bps = 0 where id = %L$q$,
    current_setting('t.laptop')), 'published_listing_locked');
  -- Changing the status and the text in one statement is no way round it.
  perform pg_temp.refused(format(
    $q$update public.products set status = 'draft', title = 'Título sin revisión' where id = %L$q$,
    current_setting('t.laptop')), 'published_listing_locked');
  perform pg_temp.refused(format($q$update public.skus set weight_grams = 1 where id = %L$q$, v_sku),
    'published_listing_locked');
  perform pg_temp.refused(format($q$update public.skus set length_cm = 1, width_cm = 1, height_cm = 1 where id = %L$q$,
    v_sku), 'published_listing_locked');
  perform pg_temp.refused(format($q$update public.skus set variant_name = 'Otra' where id = %L$q$, v_sku),
    'published_listing_locked');
  perform pg_temp.refused(format(
    $q$insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
       values (%L, 'YT-SINREVISAR', 1, 1, 1, 1)$q$, current_setting('t.laptop')), 'published_listing_locked');

  -- A listing that is not published yet is not locked by the rule.
  update public.products set title = 'Producto de prueba en borrador, cambiado'
  where slug = current_setting('t.draft_slug');
  assert found, 'a draft is not locked';
end
$$;
select pg_temp.logout();

do $$
begin
  assert (select (title, md5(coalesce(description, '')), tax_rate_bps::text, status::text)
                 = (current_setting('t.laptop_title'), current_setting('t.laptop_description'),
                    current_setting('t.laptop_tax'), 'active')
          from public.products p where p.id = current_setting('t.laptop')::uuid), 'the live listing is unchanged';
  assert (select (count(*), min(weight_grams), bool_and(active)) = (1::bigint, 1900, true)
          from public.skus where product_id = current_setting('t.laptop')::uuid), 'and so is its variant';
  assert (select title from public.products where slug = current_setting('t.draft_slug'))
       = 'Producto de prueba en borrador, cambiado', 'the draft was changed';
end
$$;

-- Catalogue staff are not limited by the rule (they correct live listings).
-- Like everyone, they write through functions; this is the rule as a
-- function owned by the table's owner meets it with their identity.
select pg_temp.login('central@yuntera.example');
reset role;
do $$
begin
  update public.products set warranty_months = warranty_months where id = current_setting('t.laptop')::uuid;
  update public.products set made_in_cr = not made_in_cr where id = current_setting('t.laptop')::uuid;
  update public.products set made_in_cr = not made_in_cr where id = current_setting('t.laptop')::uuid;
end
$$;
select pg_temp.logout();

-- The shop keeps showing the published text.
select pg_temp.login_anon();
do $$
begin
  assert public.get_product('laptop-14-nimbo-libro') ->> 'title' = current_setting('t.laptop_title'),
    'visitors see the published title';
  -- Proposals are not part of what visitors can read.
  perform pg_temp.refused('select count(*) from public.product_change_requests',
                          'permission denied for table product_change_requests');
end
$$;
reset role; select pg_temp.logout();

-- ── Nobody else can read, edit, withdraw or archive it ─────────────────────

select pg_temp.login('cafetal@yuntera.example');
do $$
begin
  assert (select count(*) from public.product_change_requests) = 0, 'another seller reads no proposals';
  perform pg_temp.refused(format('select public.seller_listing(%L)', current_setting('t.laptop')), 'listing_not_found');
  perform pg_temp.refused($q$select pg_temp.retitle('laptop', 'Laptop de otro vendedor')$q$, 'listing_not_found');
  perform pg_temp.refused(format('select public.seller_withdraw_listing_edit(%L)', current_setting('t.laptop')),
                          'listing_not_found');
  perform pg_temp.refused(format('select public.seller_archive_listing(%L)', current_setting('t.laptop')),
                          'listing_not_found');
  perform pg_temp.refused(format('select * from public.seller_listing_edits(%L)', current_setting('t.tecnocasa')),
                          'forbidden');
  -- A listing that does not exist answers the same as someone else's.
  perform pg_temp.refused(format('select public.seller_listing(%L)', gen_random_uuid()), 'listing_not_found');
  -- Sellers do not review.
  perform pg_temp.refused('select public.ops_listing_edits_for_review()', 'forbidden');
  perform pg_temp.refused(format('select public.ops_review_listing_edit(%L, true)', current_setting('t.second_request')),
                          'forbidden');
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert (select count(*) from public.product_change_requests) = 0, 'a shopper reads no proposals';
  perform pg_temp.refused($q$select pg_temp.retitle('laptop', 'Laptop de un comprador')$q$, 'listing_not_found');
  perform pg_temp.refused('select public.ops_listing_edits_for_review()', 'forbidden');
end
$$;
reset role; select pg_temp.logout();

-- The owner may not approve their own edit either.
select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  perform pg_temp.refused(format('select public.ops_review_listing_edit(%L, true)', current_setting('t.second_request')),
                          'forbidden');
end
$$;
reset role; select pg_temp.logout();

-- ── Catalogue staff see before and after, and decide ───────────────────────

select pg_temp.login('central@yuntera.example');
do $$
declare
  q jsonb;
begin
  q := public.ops_listing_edits_for_review();
  assert jsonb_array_length(q) = 1, format('one edit waits: %s', q);
  assert q #>> '{0,request_id}' = current_setting('t.second_request')
     and q #>> '{0,slug}' = 'laptop-14-nimbo-libro' and q #>> '{0,seller_name}' = 'TecnoCasa'
     and q #>> '{0,before,title}' = current_setting('t.laptop_title')
     and q #>> '{0,after,title}' = 'Laptop Nimbo Libro 14 pulgadas con 16 GB'
     and (q #>> '{0,before,weight_grams}')::integer = 1900 and (q #>> '{0,after,weight_grams}')::integer = 2000,
    format('old and new side by side: %s', q);
  assert q #> '{0,changed}' = '["title", "weight_grams"]'::jsonb,
    format('only what differs is flagged: %s', q #> '{0,changed}');
  -- Staff also read the proposals table itself.
  assert (select count(*) from public.product_change_requests)
         = current_setting('t.prior_requests')::bigint + 2, 'catalogue staff read every proposal';

  -- A rejection must say why; the proposal that was replaced cannot be decided at all.
  perform pg_temp.refused(format('select public.ops_review_listing_edit(%L, false, %L)',
    current_setting('t.second_request'), 'no'), 'reason_required');
  perform pg_temp.refused(format('select public.ops_review_listing_edit(%L, true)',
    current_setting('t.first_request')), 'edit_not_found');
  perform pg_temp.refused(format('select public.ops_review_listing_edit(%L, true)', gen_random_uuid()),
                          'edit_not_found');

  perform public.ops_review_listing_edit(current_setting('t.second_request')::uuid, false,
    'El título no puede prometer memoria que la descripción no menciona.');
  assert jsonb_array_length(public.ops_listing_edits_for_review()) = 0, 'the queue is empty again';
  -- Decided once.
  perform pg_temp.refused(format('select public.ops_review_listing_edit(%L, true)',
    current_setting('t.second_request')), 'edit_not_found');
end
$$;
reset role; select pg_temp.logout();

do $$
begin
  assert (select title from public.products where id = current_setting('t.laptop')::uuid)
       = current_setting('t.laptop_title'), 'a rejected edit changes nothing';
  assert (select status = 'rejected' and decision_reason is not null and decided_by is not null
                 and decided_at is not null
          from public.product_change_requests where id = current_setting('t.second_request')::uuid),
    'the decision is recorded with who and when';
end
$$;

-- The seller reads the reason, fixes the edit, and this time it is approved.
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  l jsonb;
begin
  l := public.seller_listing(current_setting('t.laptop')::uuid);
  assert l -> 'pending' = 'null'::jsonb
     and l #>> '{last_rejection,reason}' = 'El título no puede prometer memoria que la descripción no menciona.'
     and l #>> '{last_rejection,proposed,title}' = 'Laptop Nimbo Libro 14 pulgadas con 16 GB',
    format('the seller sees why, and what they had proposed: %s', l);
  assert (select (edit_status, edit_reason) = ('rejected', 'El título no puede prometer memoria que la descripción no menciona.')
          from public.seller_listing_edits(current_setting('t.tecnocasa')::uuid)
          where product_id = current_setting('t.laptop')::uuid), 'and in the list of products';

  -- Title, description, characteristics, category and package, all at once.
  perform public.seller_update_listing(
    current_setting('t.laptop')::uuid, 'Laptop Nimbo Libro 14 pulgadas ultraliviana', 'perifericos',
    'Pantalla de 14 pulgadas y batería para todo el día.', array['Pantalla de 14 pulgadas', 'Pesa 1,4 kg'],
    1400, 33.5, 23, 2);
  perform set_config('t.third_request',
    public.seller_listing(current_setting('t.laptop')::uuid) #>> '{pending,request_id}', true);
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('central@yuntera.example');
do $$
declare
  q jsonb := public.ops_listing_edits_for_review();
begin
  assert q #> '{0,changed}' = '["title", "category_slug", "bullet_points", "description", "weight_grams", "length_cm", "width_cm", "height_cm"]'::jsonb,
    format('every changed field is flagged: %s', q #> '{0,changed}');
  assert q #>> '{0,before,category_name}' = 'Laptops' and q #>> '{0,after,category_name}' is not null,
    'categories are named for the reviewer';
  perform public.ops_review_listing_edit(current_setting('t.third_request')::uuid, true);
end
$$;
reset role; select pg_temp.logout();

do $$
declare
  p public.products%rowtype;
  k public.skus%rowtype;
  r public.product_change_requests%rowtype;
begin
  select * into p from public.products where id = current_setting('t.laptop')::uuid;
  select * into k from public.skus where product_id = p.id;
  select * into r from public.product_change_requests where id = current_setting('t.third_request')::uuid;
  assert p.title = 'Laptop Nimbo Libro 14 pulgadas ultraliviana' and p.status = 'active'
     and p.slug = 'laptop-14-nimbo-libro'
     and p.description = 'Pantalla de 14 pulgadas y batería para todo el día.'
     and p.bullet_points = array['Pantalla de 14 pulgadas', 'Pesa 1,4 kg']
     and p.category_id = (select id from public.categories where slug = 'perifericos'),
    format('the approved edit is published, at the same address: %s', p.title);
  assert (k.weight_grams, k.length_cm, k.width_cm, k.height_cm) = (1400, 33.5, 23.0, 2.0), 'and so is the package';
  assert r.status = 'approved' and r.replaced ->> 'title' = current_setting('t.laptop_title')
     and r.replaced ->> 'category_slug' = 'laptops', 'what was replaced is kept';
  assert p.search_vector @@ to_tsquery('public.es', 'ultraliviana'), 'search knows the new title';
end
$$;

select pg_temp.login_anon();
do $$
begin
  assert public.get_product('laptop-14-nimbo-libro') ->> 'title' = 'Laptop Nimbo Libro 14 pulgadas ultraliviana',
    'visitors now see the new title';
end
$$;
reset role; select pg_temp.logout();

-- ── Withdrawing ────────────────────────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  l jsonb;
begin
  l := public.seller_listing(current_setting('t.laptop')::uuid);
  assert l -> 'pending' = 'null'::jsonb and l -> 'last_rejection' = 'null'::jsonb,
    'after an approval there is nothing waiting and nothing to explain';

  perform pg_temp.refused(format('select public.seller_withdraw_listing_edit(%L)', current_setting('t.laptop')),
                          'edit_not_found');
  perform pg_temp.retitle('laptop', 'Laptop Nimbo Libro 14 pulgadas, cambio de idea');
  perform public.seller_withdraw_listing_edit(current_setting('t.laptop')::uuid);
  assert public.seller_listing(current_setting('t.laptop')::uuid) -> 'pending' = 'null'::jsonb, 'withdrawn';
  perform pg_temp.refused(format('select public.seller_withdraw_listing_edit(%L)', current_setting('t.laptop')),
                          'edit_not_found');
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('central@yuntera.example');
do $$
begin
  assert jsonb_array_length(public.ops_listing_edits_for_review()) = 0, 'a withdrawn edit leaves the queue';
end
$$;
reset role; select pg_temp.logout();

-- ── A listing that is not public yet is changed in place ───────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  c jsonb;
  r jsonb;
begin
  c := public.seller_create_listing(
    current_setting('t.tecnocasa')::uuid, 'Lámpara de prueba para editar', 'hogar', null, '{}',
    1500000, 'platform', 0::smallint, 900, 30, 15, 12, false);
  perform set_config('t.draft', c ->> 'product_id', true);

  -- Saved as a draft: changed directly, nothing to review.
  r := pg_temp.retitle('draft', 'Lámpara de prueba, borrador corregido', 950, false);
  assert r ->> 'outcome' = 'saved' and r ->> 'status' = 'draft', format('draft saved: %s', r);
  assert public.seller_listing(current_setting('t.draft')::uuid) #>> '{content,title}'
       = 'Lámpara de prueba, borrador corregido', 'the draft itself changed';

  -- Sent for review; then taken back out to keep working on it; then sent again.
  r := pg_temp.retitle('draft', 'Lámpara de prueba, lista para revisar');
  assert r ->> 'outcome' = 'submitted' and r ->> 'status' = 'pending_review', format('submitted: %s', r);
  r := pg_temp.retitle('draft', 'Lámpara de prueba, todavía no', null, false);
  assert r ->> 'status' = 'draft', 'saving without sending takes it out of the queue';
  r := pg_temp.retitle('draft', 'Lámpara de prueba, ahora sí');
  assert r ->> 'status' = 'pending_review', 'sent again';
end
$$;
reset role; select pg_temp.logout();

do $$
begin
  assert (select count(*) from public.product_change_requests
          where product_id = current_setting('t.draft')::uuid) = 0, 'an unpublished listing needs no proposals';
  assert (select weight_grams from public.skus where product_id = current_setting('t.draft')::uuid) = 950,
    'its package was changed in place';
end
$$;

select pg_temp.login('central@yuntera.example');
select public.ops_review_product(current_setting('t.draft')::uuid, false, 'Falta decir de qué material es.');
reset role; select pg_temp.logout();

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  r jsonb;
begin
  -- A rejected listing keeps its reason while the seller works on it…
  r := pg_temp.retitle('draft', 'Lámpara de prueba de bambú, sin enviar', null, false);
  assert r ->> 'status' = 'rejected', format('still rejected while it is being fixed: %s', r);
  assert public.seller_listing(current_setting('t.draft')::uuid) ->> 'rejection_reason'
       = 'Falta decir de qué material es.', 'the reason stays visible';
  -- …and loses it when it goes back to review.
  r := pg_temp.retitle('draft', 'Lámpara de prueba de bambú');
  assert r ->> 'status' = 'pending_review', 'resubmitted';
  assert public.seller_listing(current_setting('t.draft')::uuid) -> 'rejection_reason' = 'null'::jsonb,
    'the old reason is gone';
end
$$;
reset role; select pg_temp.logout();

-- ── Archiving ──────────────────────────────────────────────────────────────

select pg_temp.remember('teclado_offer', pg_temp.offer('teclado-mecanico-compacto-nimbo')::text);
select pg_temp.remember('teclado_stock',
  (select sum(on_hand)::text from public.stock_levels l join public.skus k on k.id = l.sku_id
   where k.product_id = current_setting('t.teclado')::uuid));

select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  -- A page another seller sells from is not this seller's to take down.
  perform pg_temp.refused(format('select public.seller_archive_listing(%L)', current_setting('t.audifonos')),
                          'listing_shared');

  -- An edit that is waiting is withdrawn when its listing is archived.
  perform pg_temp.retitle('cargador', 'Cargador USB-C 30 W Nimbo, edición que no llegará');
  perform public.seller_archive_listing(current_setting('t.cargador')::uuid);

  assert public.seller_archive_listing(current_setting('t.teclado')::uuid), 'archiving reports a change';
  -- Twice is the same as once, and says so: the seller app then leaves the shop's cache alone.
  assert not public.seller_archive_listing(current_setting('t.teclado')::uuid), 'the second time changes nothing';
  assert public.seller_listing(current_setting('t.teclado')::uuid) ->> 'status' = 'archived', 'archived';
  assert (select not editable from public.seller_listing_edits(current_setting('t.tecnocasa')::uuid)
          where product_id = current_setting('t.teclado')::uuid), 'an archived listing cannot be edited';
  perform pg_temp.refused($q$select pg_temp.retitle('teclado', 'Teclado que ya no se vende')$q$,
                          'listing_not_editable');

  -- A rejected listing can be put away too.
  perform pg_temp.retitle('parlante', 'Parlante Nimbo Ola, edición pendiente');
end
$$;
reset role; select pg_temp.logout();

do $$
begin
  assert (select status from public.products where id = current_setting('t.teclado')::uuid) = 'archived',
    'the listing is archived';
  assert (select sum(on_hand)::text from public.stock_levels l join public.skus k on k.id = l.sku_id
          where k.product_id = current_setting('t.teclado')::uuid) = current_setting('t.teclado_stock'),
    'its stock is untouched';
  assert (select status from public.product_change_requests
          where product_id = current_setting('t.cargador')::uuid) = 'withdrawn',
    'the waiting edit of an archived listing is closed';
end
$$;

-- Gone from the shop, and nothing on it can be bought.
select pg_temp.login_anon();
do $$
begin
  assert public.get_product('teclado-mecanico-compacto-nimbo') is null, 'the page no longer exists';
  assert not public.shop_path_exists('product', 'teclado-mecanico-compacto-nimbo'), 'nor its address';
  assert not exists (select 1 from public.search_products('teclado') where slug = 'teclado-mecanico-compacto-nimbo'),
    'search does not find it';
  assert (select not buyable from public.cart_lines(array[current_setting('t.teclado_offer')::uuid])),
    'a cart that still has it says it cannot be bought';
end
$$;
reset role; select pg_temp.logout();

select pg_temp.login('comprador@yuntera.example');
do $$
begin
  perform pg_temp.refused(format(
    $q$select public.place_order('[{"offer_id": "%s", "quantity": 1}]', '%s', 'card', 'test-fixes-archived-001')$q$,
    current_setting('t.teclado_offer'), (select id from public.addresses where is_default)), 'offer_unavailable');
end
$$;
reset role; select pg_temp.logout();

-- An edit cannot be approved onto a listing that staff took down in the meantime.
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_request uuid := (public.ops_listing_edits_for_review() #>> '{0,request_id}')::uuid;
begin
  perform public.ops_review_product(current_setting('t.parlante')::uuid, false, 'Retirado por un reporte.');
  perform pg_temp.refused(format('select public.ops_review_listing_edit(%L, true)', v_request), 'listing_not_editable');
  -- It can still be turned down, so it does not sit in the queue for ever.
  perform public.ops_review_listing_edit(v_request, false, 'El producto fue retirado.');
end
$$;
reset role; select pg_temp.logout();

-- The seller of a rejected listing may archive it (the first status rule did not allow that).
select pg_temp.login('vendedor@yuntera.example');
select public.seller_archive_listing(current_setting('t.parlante')::uuid);
reset role; select pg_temp.logout();
do $$
begin
  assert (select status from public.products where id = current_setting('t.parlante')::uuid) = 'archived',
    'a rejected listing was archived by its seller';
end
$$;

-- A seller still cannot publish anything themselves: the table is closed to
-- them, and the status rule refuses it even to a write made on their behalf.
select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  update public.products set status = 'active' where id = current_setting('t.draft')::uuid;
  raise exception 'a seller published their own listing';
exception when insufficient_privilege then
  null;
end
$$;
reset role;
do $$
begin
  update public.products set status = 'active' where id = current_setting('t.draft')::uuid;
  raise exception 'a write with a seller''s identity published a listing';
exception when others then
  if sqlerrm <> 'listing_needs_review' then raise; end if;
end
$$;
select pg_temp.logout();

rollback;
