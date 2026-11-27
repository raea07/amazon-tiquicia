-- Stock lock order (20261121084400_stock_lock_order.sql): the listing summary
-- is refreshed only when an input of it changes and is still always right;
-- a cancellation still puts picked units back; the unpaid-order sweep cancels
-- at most 200 orders a run, the oldest first, and loses none; a route starts
-- with the orders of its parcels locked first and still refuses the wrong
-- caller; packing (by the warehouse or by a shop) never writes the product
-- row; a shop's own packing still refuses the wrong callers; who may call what.
--
-- The races themselves (two sessions at once) are in tools/races and in
-- packages/db/src/contract.stock-product-races.test.ts; this suite checks, in
-- one session, that the functions still do what they did.
--
-- Who plays whom: central is an administrator (operations staff), bodega a
-- worker of SJO1, repartidor the driver of the routes, repartidor2 another
-- driver, comprador a shopper, a visitor. The products, their variants and
-- offers (Tienda Sendero and Cafetal Los Santos, warehouse-fulfilled from
-- SJO1), the shelf and the shopper are this suite's own, with chosen ids, so
-- every check holds on a used database.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

-- Limits on what one account may hold unpaid, raised for this transaction:
-- the sweep test places 250 unpaid orders.
update public.app_settings set value = '100000'::jsonb
where key in ('max_unpaid_orders_per_account', 'max_held_units_per_account', 'max_units_per_line',
              'max_open_cod_orders_new_account');

-- ═══ 0. Fixture ═══════════════════════════════════════════════════════════

-- Ids: products A (...0a, variants a1 and a2) and B (...0b, variant b1).
create function pg_temp.fx(p_n integer) returns uuid
language sql immutable as $$ select ('f1710000-0000-4000-8000-' || lpad(to_hex(p_n), 12, '0'))::uuid $$;

do $$
declare
  v_sendero uuid := (select id from public.sellers where slug = 'tienda-sendero');
  v_cafetal uuid := (select id from public.sellers where slug = 'cafetal-los-santos');
  v_like public.products%rowtype;
  v_wh uuid := (select id from public.warehouses where code = 'SJO1');
begin
  select * into strict v_like from public.products where slug = 'balon-futbol-sendero-5';
  insert into public.products (id, slug, title, description, category_id, brand_id, status, created_by_seller_id)
  values (pg_temp.fx(10), 'prueba-171-producto-a', 'Producto A de la prueba 171', 'Prueba.', v_like.category_id,
          v_like.brand_id, 'active', v_sendero),
         (pg_temp.fx(11), 'prueba-171-producto-b', 'Producto B de la prueba 171', 'Prueba.', v_like.category_id,
          v_like.brand_id, 'active', v_sendero);
  insert into public.skus (id, product_id, code, variant_name, weight_grams, length_cm, width_cm, height_cm)
  values (pg_temp.fx(101), pg_temp.fx(10), 'T171-A1', 'Uno', 500, 20, 15, 10),
         (pg_temp.fx(102), pg_temp.fx(10), 'T171-A2', 'Dos', 500, 20, 15, 10),
         (pg_temp.fx(103), pg_temp.fx(11), 'T171-B1', '', 500, 20, 15, 10);
  insert into public.offers (id, sku_id, seller_id, price_minor, fulfillment, handling_days, status, created_at)
  values (pg_temp.fx(201), pg_temp.fx(101), v_sendero, 1200000, 'platform', 0, 'active', '2026-01-01'),
         (pg_temp.fx(202), pg_temp.fx(102), v_sendero, 1300000, 'platform', 0, 'active', '2026-01-02'),
         (pg_temp.fx(203), pg_temp.fx(103), v_sendero, 1250000, 'platform', 0, 'active', '2026-01-01'),
         (pg_temp.fx(204), pg_temp.fx(103), v_cafetal, 1280000, 'platform', 0, 'active', '2026-01-03');
  insert into public.warehouse_locations (warehouse_id, code, kind, active)
  values (v_wh, 'T171-01', 'storage', true)
  on conflict (warehouse_id, code) do update set active = true, kind = 'storage';
  perform pg_temp.remember('wh', v_wh::text);
  perform pg_temp.remember('loc', (select id::text from public.warehouse_locations
                                   where warehouse_id = v_wh and code = 'T171-01'));
  perform pg_temp.remember('sendero', v_sendero::text);
  perform pg_temp.remember('cafetal', v_cafetal::text);
end
$$;

select pg_temp.remember('shopper', pg_temp.shopper('prueba-171@yuntera.example', 'Prueba Ciento Setenta')::text);

-- The listing summary computed from scratch, written here and not by calling
-- private.refresh_product_summary: the active offers of active variants of
-- shops in good standing; the featured one is the new-condition offer that
-- has units, then the cheapest, then the oldest, then by id.
create function pg_temp.expected(p_product uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'offer_count', (select count(*) from public.offers o join public.skus k on k.id = o.sku_id
                    join public.sellers s on s.id = o.seller_id
                    where k.product_id = p_product and k.active and o.status = 'active' and s.status = 'active'),
    'featured', b.id, 'min', b.price_minor, 'list', b.list_price_minor,
    'in_stock', coalesce(b.available_quantity > 0, false),
    'platform', coalesce(b.fulfillment = 'platform', false), 'handling', b.handling_days)
  from (select 1) one
  left join lateral (
    select o.* from public.offers o join public.skus k on k.id = o.sku_id
    join public.sellers s on s.id = o.seller_id
    where k.product_id = p_product and k.active and o.status = 'active' and s.status = 'active'
      and o.condition = 'new'
    order by o.available_quantity > 0 desc, o.price_minor, o.created_at, o.id
    limit 1) b on true
$$;

create function pg_temp.stored(p_product uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('offer_count', p.offer_count, 'featured', p.featured_offer_id,
    'min', p.min_price_minor, 'list', p.list_price_minor, 'in_stock', p.in_stock,
    'platform', p.fulfilled_by_platform, 'handling', p.best_handling_days)
  from public.products p where p.id = p_product
$$;

create function pg_temp.xmin(p_product uuid) returns text
language sql stable as $$ select xmin::text from public.products where id = p_product $$;

-- Units counted onto (or off) the suite's shelf by the warehouse's own function.
create function pg_temp.count(p_sku uuid, p_seller uuid, p_delta integer) returns void
language plpgsql as $$
begin
  perform pg_temp.act('bodega@yuntera.example');
  perform public.wms_adjust_stock(current_setting('t.loc')::uuid, p_sku, p_seller, p_delta,
                                  'Conteo de la prueba ciento setenta', null);
  perform pg_temp.logout();
end;
$$;

create function pg_temp.buy(p_offer uuid, p_quantity integer, p_method public.payment_method, p_key text)
returns uuid
language sql as $$
  select pg_temp.place('prueba-171@yuntera.example',
                       jsonb_build_array(jsonb_build_object('offer_id', p_offer, 'quantity', p_quantity)),
                       p_method, p_key)
$$;

-- Stock to start with: 6 of a1, 4 of a2, 5 of b1 (Sendero), 2 of b1 (Cafetal).
select pg_temp.count(pg_temp.fx(101), current_setting('t.sendero')::uuid, 6);
select pg_temp.count(pg_temp.fx(102), current_setting('t.sendero')::uuid, 4);
select pg_temp.count(pg_temp.fx(103), current_setting('t.sendero')::uuid, 5);
select pg_temp.count(pg_temp.fx(103), current_setting('t.cafetal')::uuid, 2);

do $$ begin
  assert pg_temp.stored(pg_temp.fx(10)) = pg_temp.expected(pg_temp.fx(10)), 'fixture: summary of A';
  assert pg_temp.stored(pg_temp.fx(11)) = pg_temp.expected(pg_temp.fx(11)), 'fixture: summary of B';
  assert (select in_stock and featured_offer_id = pg_temp.fx(201) from public.products where id = pg_temp.fx(10)),
    'fixture: A in stock, a1 featured';
end $$;

-- ═══ 1. Who may call what ═════════════════════════════════════════════════

do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (('private', 'refresh_product_summary'), ('private', 'offers_summary_trigger'),
                                   ('private', 'sellers_summary_trigger'), ('private', 'cancel_order_internal'),
                                   ('private', 'expire_unpaid_orders'))
    and (not p.prosecdef or not ('search_path=""' = any (p.proconfig))
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute'));
  assert v_bad is null, format('who_may_call: a private function a role can run, or not definer: %s', v_bad);
  assert (select p.prosecdef and 'search_path=""' = any (p.proconfig)
                 and has_function_privilege('authenticated', p.oid, 'execute')
                 and not has_function_privilege('anon', p.oid, 'execute')
          from pg_proc p where p.oid = 'public.driver_start_route(uuid)'::regprocedure),
    'who_may_call: driver_start_route is for signed-in callers only';
  assert (select p.prosecdef and 'search_path=""' = any (p.proconfig)
                 and has_function_privilege('authenticated', p.oid, 'execute')
                 and not has_function_privilege('anon', p.oid, 'execute')
          from pg_proc p where p.oid = 'public.seller_mark_packed(uuid, integer, smallint)'::regprocedure),
    'who_may_call: seller_mark_packed is for signed-in callers only';
end $$;

-- ═══ 2. The summary is refreshed only when an input changes ═══════════════

-- A sale that leaves the offer in stock (5 to 4) does not touch the product row.
select pg_temp.remember('xmin_b', pg_temp.xmin(pg_temp.fx(11)));
select pg_temp.remember('o_sale', pg_temp.buy(pg_temp.fx(203), 1, 'card', 't171-sale')::text);
do $$ begin
  assert (select available_quantity from public.offers where id = pg_temp.fx(203)) = 4, 'sale: 4 left';
  assert pg_temp.xmin(pg_temp.fx(11)) = current_setting('t.xmin_b'), 'sale: the product row was not written';
  assert pg_temp.stored(pg_temp.fx(11)) = pg_temp.expected(pg_temp.fx(11)), 'sale: summary right';
end $$;
-- Its cancellation (4 to 5) does not either.
select private.cancel_order_internal(current_setting('t.o_sale')::uuid, 'Prueba ciento setenta');
do $$ begin
  assert (select available_quantity from public.offers where id = pg_temp.fx(203)) = 5, 'release: 5 again';
  assert pg_temp.xmin(pg_temp.fx(11)) = current_setting('t.xmin_b'), 'release: the product row was not written';
end $$;

-- A change to an input that does not change the summary (the handling days of
-- the offer that is not featured) refreshes, finds nothing different and
-- writes nothing.
update public.offers set handling_days = 3 where id = pg_temp.fx(204);
do $$ begin
  assert pg_temp.xmin(pg_temp.fx(11)) = current_setting('t.xmin_b'), 'same summary: the product row was not written';
  assert pg_temp.stored(pg_temp.fx(11)) = pg_temp.expected(pg_temp.fx(11)), 'same summary: right';
end $$;
update public.offers set handling_days = 0 where id = pg_temp.fx(204);

-- Taking the last units of the featured offer moves the featured offer to the
-- other shop; taking the other's last units makes the product out of stock.
select pg_temp.count(pg_temp.fx(103), current_setting('t.sendero')::uuid, -4);
do $$ begin
  assert (select available_quantity from public.offers where id = pg_temp.fx(203)) = 1, 'last unit: fixture';
  assert (select featured_offer_id = pg_temp.fx(203) and in_stock and min_price_minor = 1250000
          from public.products where id = pg_temp.fx(11)), 'last unit: Sendero featured before';
end $$;
select pg_temp.remember('o_last1', pg_temp.buy(pg_temp.fx(203), 1, 'card', 't171-last-1')::text);
do $$ begin
  assert pg_temp.xmin(pg_temp.fx(11)) <> current_setting('t.xmin_b'), 'last unit: the product row was written';
  assert (select featured_offer_id = pg_temp.fx(204) and in_stock and min_price_minor = 1280000
          from public.products where id = pg_temp.fx(11)), 'last unit: Cafetal featured, still in stock';
  assert pg_temp.stored(pg_temp.fx(11)) = pg_temp.expected(pg_temp.fx(11)), 'last unit: summary right';
end $$;
select pg_temp.remember('o_last2', pg_temp.buy(pg_temp.fx(204), 2, 'card', 't171-last-2')::text);
do $$ begin
  assert (select not in_stock and featured_offer_id = pg_temp.fx(203) and min_price_minor = 1250000
          from public.products where id = pg_temp.fx(11)), 'all gone: out of stock, the cheaper featured';
  assert pg_temp.stored(pg_temp.fx(11)) = pg_temp.expected(pg_temp.fx(11)), 'all gone: summary right';
end $$;
-- Back in stock when one is cancelled.
select private.cancel_order_internal(current_setting('t.o_last2')::uuid, 'Prueba ciento setenta');
select private.cancel_order_internal(current_setting('t.o_last1')::uuid, 'Prueba ciento setenta');
do $$ begin
  assert (select in_stock and featured_offer_id = pg_temp.fx(203) from public.products where id = pg_temp.fx(11)),
    'given back: in stock again, Sendero featured';
  assert pg_temp.stored(pg_temp.fx(11)) = pg_temp.expected(pg_temp.fx(11)), 'given back: summary right';
end $$;

-- ═══ 3. A random walk over everything that feeds the summary ══════════════

-- 400 steps, the same every run (setseed). Each step is one of: a price up or
-- down, a list price set or cleared, an offer paused or put back on sale, its
-- fulfilment switched, its handling days, its condition, units counted in or
-- out by the warehouse's correction (wms_adjust_stock), a checkout of one unit
-- or of every unit left (place_order), a cancellation giving them back
-- (cancel_order_internal), a second shop's offer of a1 added or removed, a
-- variant switched off or on, Cafetal suspended or reinstated. After every
-- step both products' stored summary must equal the one computed from
-- scratch, and the stock functions must leave the offers' availability equal
-- to on hand minus reserved.
do $$
declare
  v_offers uuid[] := array[pg_temp.fx(201), pg_temp.fx(202), pg_temp.fx(203), pg_temp.fx(204)];
  v_sendero uuid := current_setting('t.sendero')::uuid;
  v_cafetal uuid := current_setting('t.cafetal')::uuid;
  v_extra uuid := pg_temp.fx(205);
  v_kind integer;
  v_offer public.offers%rowtype;
  v_step integer;
  v_done integer[] := array_fill(0, array[14]);
  v_refused integer := 0;
  v_before boolean[];
  v_flips_out integer := 0;
  v_flips_in integer := 0;
  v_order uuid;
  v_n integer;
  v_on_shelf integer;
  v_promised integer;
  v_free integer;
  v_p uuid;
begin
  perform setseed(0.171);
  for v_step in 1 .. 400 loop
    v_before := array[(select in_stock from public.products where id = pg_temp.fx(10)),
                      (select in_stock from public.products where id = pg_temp.fx(11))];
    v_kind := floor(random() * 14)::integer;
    v_p := v_offers[1 + floor(random() * 4)::integer];
    select * into strict v_offer from public.offers where id = v_p;
    begin
      case v_kind
      when 0 then  -- price up or down, staying above the list price's floor and the fee floor
        update public.offers
        set price_minor = greatest(1100000, price_minor + (floor(random() * 100001)::integer - 50000)),
            list_price_minor = null
        where id = v_offer.id;
      when 1 then  -- a list price, or none
        update public.offers
        set list_price_minor = case when random() < 0.5 then null else price_minor + 1000 * (1 + floor(random() * 50)) end
        where id = v_offer.id;
      when 2 then  -- paused, or back on sale
        update public.offers set status = case when status = 'active' then 'paused' else 'active' end::public.offer_status
        where id = v_offer.id;
      when 3 then  -- fulfilment switched (a seller-fulfilled offer sells from the shop's own site: none here)
        update public.offers set fulfillment = case when fulfillment = 'platform' then 'seller' else 'platform' end::public.fulfillment_type
        where id = v_offer.id;
      when 4 then  -- handling days
        update public.offers set handling_days = floor(random() * 4)::smallint where id = v_offer.id;
      when 5 then  -- condition
        update public.offers set condition = case when condition = 'new' then 'refurbished' else 'new' end::public.item_condition
        where id = v_offer.id;
      when 6 then  -- units counted in
        perform pg_temp.count(v_offer.sku_id, v_offer.seller_id, 1 + floor(random() * 3)::integer);
      when 7 then  -- every free unit on the shelf counted out (to zero, when nothing waits for them)
        select coalesce(b.quantity, 0) into v_on_shelf from public.bin_stock b
        where b.location_id = current_setting('t.loc')::uuid and b.sku_id = v_offer.sku_id and b.seller_id = v_offer.seller_id;
        v_promised := private.location_promised(current_setting('t.loc')::uuid, v_offer.sku_id, v_offer.seller_id);
        select least(coalesce(v_on_shelf, 0) - v_promised, l.on_hand - l.reserved) into v_free
        from public.stock_levels l
        where l.warehouse_id = current_setting('t.wh')::uuid and l.sku_id = v_offer.sku_id and l.seller_id = v_offer.seller_id;
        if coalesce(v_free, 0) > 0 then
          perform pg_temp.count(v_offer.sku_id, v_offer.seller_id, -v_free);
        else
          v_kind := 6;
          perform pg_temp.count(v_offer.sku_id, v_offer.seller_id, 2);
        end if;
      when 8, 13 then  -- a checkout of one unit, or of every unit left (to zero)
        -- One of the offers a shopper can buy right now, if any.
        select count(*) into v_n from public.offers o join public.skus k on k.id = o.sku_id
        join public.sellers s on s.id = o.seller_id
        where o.id = any (v_offers) and o.available_quantity > 0 and o.status = 'active' and k.active
          and s.status = 'active';
        if v_n > 0 then
          v_free := floor(random() * v_n)::integer;
          select o.* into v_offer from public.offers o join public.skus k on k.id = o.sku_id
          join public.sellers s on s.id = o.seller_id
          where o.id = any (v_offers) and o.available_quantity > 0 and o.status = 'active' and k.active
            and s.status = 'active'
          order by o.id offset v_free limit 1;
        end if;
        if v_n > 0 then
          v_n := case when v_kind = 13 then least(v_offer.available_quantity, 50) else 1 end;
          perform pg_temp.buy(v_offer.id, v_n, 'card', 't171-walk-' || v_step);
        else
          v_kind := 6;
          perform pg_temp.count(v_offer.sku_id, v_offer.seller_id, 1);
        end if;
      when 9 then  -- a cancellation of one of the walk's open orders
        select o.id into v_order from public.orders o
        where o.user_id = current_setting('t.shopper')::uuid and o.status = 'pending_payment'
          and o.idempotency_key like 't171-walk-%'
        order by o.placed_at, o.id offset floor(random() * 3)::integer limit 1;
        if v_order is not null then
          perform private.cancel_order_internal(v_order, 'Prueba ciento setenta');
        end if;
      when 10 then  -- a second shop's offer of a1, added or removed
        if exists (select 1 from public.offers where id = v_extra) then
          delete from public.offers where id = v_extra;
        else
          insert into public.offers (id, sku_id, seller_id, price_minor, fulfillment, handling_days, status, created_at)
          values (v_extra, pg_temp.fx(101), v_cafetal, 1150000 + floor(random() * 200000)::integer, 'platform', 0,
                  'active', '2026-01-04');
        end if;
      when 11 then  -- a variant switched off or on
        update public.skus set active = not active where id = pg_temp.fx(102);
      when 12 then  -- Cafetal suspended, or reinstated
        update public.sellers set status = case when status = 'active' then 'suspended' else 'active' end::public.seller_status
        where id = v_cafetal;
      end case;
      v_done[v_kind + 1] := v_done[v_kind + 1] + 1;
    exception when others then
      -- A step the shop refuses (an offer not on sale, a paused variant) changes
      -- nothing; it is counted, and the summary is still checked below.
      if sqlerrm not in ('offer_unavailable', 'insufficient_stock', 'shop_not_active') then
        raise exception 'walk step % (kind %): unexpected refusal %', v_step, v_kind, sqlerrm;
      end if;
      v_refused := v_refused + 1;
    end;
    foreach v_p in array array[pg_temp.fx(10), pg_temp.fx(11)] loop
      if pg_temp.stored(v_p) <> pg_temp.expected(v_p) then
        raise exception 'walk step % (kind %): stored % <> computed %', v_step, v_kind,
          pg_temp.stored(v_p), pg_temp.expected(v_p);
      end if;
    end loop;
    if exists (
      select 1 from public.offers o
      where o.sku_id in (pg_temp.fx(101), pg_temp.fx(102), pg_temp.fx(103))
        and o.available_quantity <> coalesce((
          select sum(l.on_hand - l.reserved) from public.stock_levels l join public.warehouses w on w.id = l.warehouse_id
          where l.sku_id = o.sku_id and l.seller_id = o.seller_id and w.active
            and w.kind = (case when o.fulfillment = 'platform' then 'platform' else 'seller' end)::public.warehouse_kind), 0)) then
      raise exception 'walk step % (kind %): an offer''s availability is not on hand minus reserved', v_step, v_kind;
    end if;
    if v_before[1] and not (select in_stock from public.products where id = pg_temp.fx(10)) then v_flips_out := v_flips_out + 1; end if;
    if v_before[2] and not (select in_stock from public.products where id = pg_temp.fx(11)) then v_flips_out := v_flips_out + 1; end if;
    if not v_before[1] and (select in_stock from public.products where id = pg_temp.fx(10)) then v_flips_in := v_flips_in + 1; end if;
    if not v_before[2] and (select in_stock from public.products where id = pg_temp.fx(11)) then v_flips_in := v_flips_in + 1; end if;
  end loop;
  -- The walk did what it says: every kind of step, products in and out of stock.
  for v_n in 1 .. 14 loop
    assert v_done[v_n] >= 5, format('walk: step kind %s ran %s times', v_n - 1, v_done[v_n]);
  end loop;
  assert v_flips_out >= 5 and v_flips_in >= 5, format('walk: in stock to out %s, out to in %s', v_flips_out, v_flips_in);
  raise notice 'walk: steps per kind %, refused %, flips out % in %', v_done, v_refused, v_flips_out, v_flips_in;
end
$$;

-- What the walk left on sale again, for the sections below.
update public.sellers set status = 'active' where id = current_setting('t.cafetal')::uuid;
update public.skus set active = true where id = pg_temp.fx(102);
update public.offers set status = 'active', fulfillment = 'platform', condition = 'new', handling_days = 0,
  list_price_minor = null
where id in (pg_temp.fx(201), pg_temp.fx(202), pg_temp.fx(203), pg_temp.fx(204));
do $$
declare
  o uuid;
begin
  for o in select id from public.orders where user_id = current_setting('t.shopper')::uuid
           and status = 'pending_payment' order by placed_at loop
    perform private.cancel_order_internal(o, 'Prueba ciento setenta');
  end loop;
  assert pg_temp.stored(pg_temp.fx(10)) = pg_temp.expected(pg_temp.fx(10)), 'after the walk: A';
  assert pg_temp.stored(pg_temp.fx(11)) = pg_temp.expected(pg_temp.fx(11)), 'after the walk: B';
end $$;

-- ═══ 4. A cancellation still puts picked units back ═══════════════════════

-- A cash order of a1 and a2, released at once; its first line picked; then
-- cancelled. Both shelves are as before, both tasks closed, nothing reserved.
select pg_temp.count(pg_temp.fx(101), current_setting('t.sendero')::uuid, 3);
select pg_temp.count(pg_temp.fx(102), current_setting('t.sendero')::uuid, 3);
create function pg_temp.shelf(p_sku uuid) returns integer
language sql stable as $$
  select coalesce((select quantity from public.bin_stock where location_id = current_setting('t.loc')::uuid
                   and sku_id = p_sku and seller_id = current_setting('t.sendero')::uuid), 0)
$$;
select pg_temp.remember('shelf_a1', pg_temp.shelf(pg_temp.fx(101))::text);
select pg_temp.remember('shelf_a2', pg_temp.shelf(pg_temp.fx(102))::text);
select pg_temp.remember('o_cash', pg_temp.place('prueba-171@yuntera.example',
  jsonb_build_array(jsonb_build_object('offer_id', pg_temp.fx(201), 'quantity', 1),
                    jsonb_build_object('offer_id', pg_temp.fx(202), 'quantity', 1)),
  'cash_on_delivery', 't171-cash')::text);
select pg_temp.remember('s_cash', (select id::text from public.shipments where order_id = current_setting('t.o_cash')::uuid));
select pg_temp.act('bodega@yuntera.example');
select public.wms_start_picking(current_setting('t.s_cash')::uuid);
select public.wms_confirm_pick(t.id, t.quantity, current_setting('t.loc')::uuid, k.code)
from public.pick_tasks t join public.skus k on k.id = t.sku_id
where t.shipment_id = current_setting('t.s_cash')::uuid and t.sku_id = pg_temp.fx(101);
select pg_temp.remember('t_a2', (select id::text from public.pick_tasks
  where shipment_id = current_setting('t.s_cash')::uuid and sku_id = pg_temp.fx(102)));
select pg_temp.logout();
do $$ begin
  assert pg_temp.shelf(pg_temp.fx(101)) = current_setting('t.shelf_a1')::integer - 1, 'cancel: fixture picked one';
end $$;
select pg_temp.act('central@yuntera.example');
select public.cancel_order(current_setting('t.o_cash')::uuid, 'Prueba ciento setenta');
select pg_temp.logout();
do $$ begin
  assert pg_temp.shelf(pg_temp.fx(101)) = current_setting('t.shelf_a1')::integer, 'cancel: a1 back on its shelf';
  assert pg_temp.shelf(pg_temp.fx(102)) = current_setting('t.shelf_a2')::integer, 'cancel: a2 untouched';
  assert not exists (select 1 from public.pick_tasks where shipment_id = current_setting('t.s_cash')::uuid
                     and status <> 'cancelled' and status <> 'done'), 'cancel: tasks closed';
  assert (select status from public.orders where id = current_setting('t.o_cash')::uuid) = 'cancelled', 'cancel: cancelled';
  assert not exists (select 1 from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
                     where i.order_id = current_setting('t.o_cash')::uuid and r.status = 'active'), 'cancel: released';
  assert (select on_hand = (select sum(b.quantity) from public.bin_stock b where b.sku_id = l.sku_id
                            and b.seller_id = l.seller_id and b.location_id = current_setting('t.loc')::uuid)
          from public.stock_levels l where l.warehouse_id = current_setting('t.wh')::uuid
            and l.sku_id = pg_temp.fx(101) and l.seller_id = current_setting('t.sendero')::uuid),
    'cancel: on hand is the shelf again';
end $$;
-- The picker's second line afterwards is refused: its task is closed.
select pg_temp.act('bodega@yuntera.example');
select pg_temp.refused(format($q$select public.wms_confirm_pick(%L, 1, null, 'T171-A2')$q$, current_setting('t.t_a2')),
                       'invalid_task_state');
select pg_temp.logout();

-- ═══ 5. The sweep: at most 200 a run, the oldest first, none lost ═════════

-- Expired orders already in the database are cleared first, so the counts
-- below are this suite's own.
do $$
declare
  n integer;
begin
  loop
    n := private.expire_unpaid_orders();
    exit when n = 0;
  end loop;
end $$;
select pg_temp.count(pg_temp.fx(101), current_setting('t.sendero')::uuid, 260);
do $$
declare
  i integer;
  v uuid;
begin
  for i in 1 .. 250 loop
    v := pg_temp.buy(pg_temp.fx(201), 1, 'card', 't171-sweep-' || i);
    update public.orders set placed_at = now() - interval '3 hours' + make_interval(secs => i) where id = v;
  end loop;
end $$;
create function pg_temp.sweep_orders(p_status public.order_status) returns integer
language sql stable as $$
  select count(*)::integer from public.orders
  where user_id = current_setting('t.shopper')::uuid and idempotency_key like 't171-sweep-%' and status = p_status
$$;
create function pg_temp.reserved_a1() returns integer
language sql stable as $$
  select reserved from public.stock_levels where warehouse_id = current_setting('t.wh')::uuid
  and sku_id = pg_temp.fx(201 - 100) and seller_id = current_setting('t.sendero')::uuid
$$;
do $$
declare
  n integer;
begin
  assert pg_temp.sweep_orders('pending_payment') = 250 and pg_temp.reserved_a1() = 250, 'sweep: fixture';
  n := private.expire_unpaid_orders();
  assert n = 200, format('sweep: the first run cancelled %s, not 200', n);
  assert pg_temp.sweep_orders('cancelled') = 200 and pg_temp.sweep_orders('pending_payment') = 50, 'sweep: 200 and 50';
  -- The oldest first: every cancelled one is older than every one left.
  assert (select max(placed_at) from public.orders where user_id = current_setting('t.shopper')::uuid
            and idempotency_key like 't171-sweep-%' and status = 'cancelled')
       < (select min(placed_at) from public.orders where user_id = current_setting('t.shopper')::uuid
            and idempotency_key like 't171-sweep-%' and status = 'pending_payment'), 'sweep: the oldest first';
  assert pg_temp.reserved_a1() = 50, format('sweep: %s still reserved after the first run, not 50', pg_temp.reserved_a1());
  n := private.expire_unpaid_orders();
  assert n = 50, format('sweep: the second run cancelled %s, not 50', n);
  n := private.expire_unpaid_orders();
  assert n = 0, format('sweep: the third run cancelled %s', n);
  assert pg_temp.sweep_orders('cancelled') = 250, 'sweep: none lost';
  assert pg_temp.reserved_a1() = 0, 'sweep: every unit given back';
  assert not exists (select 1 from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
                     join public.orders o on o.id = i.order_id
                     where o.idempotency_key like 't171-sweep-%' and o.user_id = current_setting('t.shopper')::uuid
                       and r.status <> 'released'), 'sweep: every reservation released';
  assert (select count(*) from public.payments p join public.orders o on o.id = p.order_id
          where o.idempotency_key like 't171-sweep-%' and o.user_id = current_setting('t.shopper')::uuid
            and p.status <> 'cancelled') = 0, 'sweep: every payment cancelled';
  assert (select available_quantity from public.offers where id = pg_temp.fx(201))
       = (select on_hand - reserved from public.stock_levels where warehouse_id = current_setting('t.wh')::uuid
          and sku_id = pg_temp.fx(101) and seller_id = current_setting('t.sendero')::uuid), 'sweep: what shoppers can buy';
  assert pg_temp.stored(pg_temp.fx(10)) = pg_temp.expected(pg_temp.fx(10)), 'sweep: summary right';
end $$;

-- ═══ 6. A route starts with its parcels' orders locked first ══════════════

-- Three cash orders, packed in SJO1; route one with parcels P and Q, route
-- two with parcel R, both assigned to repartidor and not started.
-- The walk of section 3 can end with any of a1, a2 and b1 sold out or counted
-- to zero (its clean-up puts offers back on sale but counts nothing in), so
-- each of the three is set to 5 free units right before it is bought.
create function pg_temp.stock_to(p_sku uuid, p_seller uuid, p_free integer) returns void
language plpgsql as $$
declare
  v_free integer := coalesce((select on_hand - reserved from public.stock_levels
                              where warehouse_id = current_setting('t.wh')::uuid and sku_id = p_sku
                                and seller_id = p_seller), 0);
begin
  if v_free <> p_free then
    perform pg_temp.count(p_sku, p_seller, p_free - v_free);
  end if;
  assert (select available_quantity from public.offers where sku_id = p_sku and seller_id = p_seller) = p_free,
    format('route: fixture, %s free units of %s', p_free, p_sku);
end;
$$;
select pg_temp.stock_to(pg_temp.fx(101), current_setting('t.sendero')::uuid, 5);
select pg_temp.stock_to(pg_temp.fx(102), current_setting('t.sendero')::uuid, 5);
select pg_temp.stock_to(pg_temp.fx(103), current_setting('t.sendero')::uuid, 5);
create function pg_temp.packed(p_key text, p_offer uuid) returns uuid
language plpgsql as $$
declare
  v_order uuid := pg_temp.buy(p_offer, 1, 'cash_on_delivery', p_key);
  v_ship uuid := (select id from public.shipments where order_id = v_order);
begin
  perform pg_temp.pack(v_ship);
  return v_ship;
end;
$$;
select pg_temp.remember('ship_p', pg_temp.packed('t171-route-p', pg_temp.fx(201))::text);
select pg_temp.remember('ship_q', pg_temp.packed('t171-route-q', pg_temp.fx(202))::text);
select pg_temp.remember('ship_r', pg_temp.packed('t171-route-r', pg_temp.fx(203))::text);
create function pg_temp.plan(variadic p_shipments uuid[]) returns uuid
language plpgsql as $$
declare
  v_route uuid;
begin
  perform pg_temp.act('central@yuntera.example');
  v_route := public.ops_create_route(
    private.cr_local(now())::date, current_setting('t.wh')::uuid,
    (select jsonb_agg(jsonb_build_object('shipment_id', s, 'sequence', n) order by n)
     from unnest(p_shipments) with ordinality as x (s, n)),
    (select d.id from public.drivers d join auth.users u on u.id = d.user_id
     where u.email = 'repartidor@yuntera.example'));
  perform pg_temp.logout();
  return v_route;
end;
$$;
select pg_temp.remember('route_one', pg_temp.plan(current_setting('t.ship_p')::uuid, current_setting('t.ship_q')::uuid)::text);
select pg_temp.remember('route_two', pg_temp.plan(current_setting('t.ship_r')::uuid)::text);

-- The wrong callers are refused and change nothing.
select pg_temp.login_anon();
select pg_temp.refused(format('select public.driver_start_route(%L)', current_setting('t.route_one')), 'forbidden');
reset role;
select pg_temp.act('repartidor2@yuntera.example');
select pg_temp.refused(format('select public.driver_start_route(%L)', current_setting('t.route_one')), 'route_not_found');
select pg_temp.act('comprador@yuntera.example');
select pg_temp.refused(format('select public.driver_start_route(%L)', current_setting('t.route_one')), 'route_not_found');
select pg_temp.act('bodega@yuntera.example');
select pg_temp.refused(format('select public.driver_start_route(%L)', current_setting('t.route_one')), 'route_not_found');
select pg_temp.logout();
do $$ begin
  assert (select status from public.routes where id = current_setting('t.route_one')::uuid) = 'assigned',
    'start: refused callers changed nothing';
  assert (select count(*) from public.shipments where id in (current_setting('t.ship_p')::uuid, current_setting('t.ship_q')::uuid)
          and status = 'ready_for_dispatch') = 2, 'start: both parcels still waiting';
end $$;

-- Staff stop P before the route starts: it comes back, its stop is skipped.
select pg_temp.act('central@yuntera.example');
select public.ops_recall_shipment(current_setting('t.ship_p')::uuid, 'Prueba ciento setenta');
select pg_temp.logout();
-- The driver starts route one: it leaves with Q only.
select pg_temp.act('repartidor@yuntera.example');
select public.driver_start_route(current_setting('t.route_one')::uuid);
-- Starting it again is refused.
select pg_temp.refused(format('select public.driver_start_route(%L)', current_setting('t.route_one')), 'route_not_startable');
-- Route two starts with R.
select public.driver_start_route(current_setting('t.route_two')::uuid);
select pg_temp.logout();
do $$ begin
  assert (select status from public.routes where id = current_setting('t.route_one')::uuid) = 'in_progress', 'start: route one under way';
  assert (select status from public.shipments where id = current_setting('t.ship_p')::uuid) = 'returning', 'start: P comes back';
  assert (select rs.status from public.route_stops rs where rs.route_id = current_setting('t.route_one')::uuid
          and rs.shipment_id = current_setting('t.ship_p')::uuid) = 'skipped', 'start: P''s stop skipped';
  assert (select status from public.shipments where id = current_setting('t.ship_q')::uuid) = 'out_for_delivery', 'start: Q out';
  assert (select status from public.shipments where id = current_setting('t.ship_r')::uuid) = 'out_for_delivery', 'start: R out';
  assert not exists (select 1 from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
                     where rs.route_id in (current_setting('t.route_one')::uuid, current_setting('t.route_two')::uuid)
                       and rs.status = 'pending' and s.status <> 'out_for_delivery'),
    'start: no pending stop whose parcel is not on the road';
  assert (select o.status from public.orders o join public.shipments s on s.order_id = o.id
          where s.id = current_setting('t.ship_q')::uuid) = 'shipped', 'start: Q''s order is shipped';
end $$;
-- Once the route is under way, staff cannot stop its parcels from here.
select pg_temp.act('central@yuntera.example');
select pg_temp.refused(format($q$select public.ops_recall_shipment(%L, 'Prueba ciento setenta')$q$, current_setting('t.ship_r')),
                       'shipment_not_recallable');
select pg_temp.logout();

-- ═══ 7. Packing never takes an offer across zero ══════════════════════════

-- Packing turns a reservation into units leaving the building: on hand and
-- reserved both go down by the same amount, so what shoppers can buy does not
-- move and the product row is not written (the documents say packing cannot
-- meet a product row). Warehouse packing first, of a1.
select pg_temp.count(pg_temp.fx(101), current_setting('t.sendero')::uuid, 3);
select pg_temp.remember('o_packw', pg_temp.buy(pg_temp.fx(201), 1, 'cash_on_delivery', 't171-pack-w')::text);
select pg_temp.remember('avail_a1', (select available_quantity::text from public.offers where id = pg_temp.fx(201)));
select pg_temp.remember('xmin_a', pg_temp.xmin(pg_temp.fx(10)));
select pg_temp.pack((select id from public.shipments where order_id = current_setting('t.o_packw')::uuid));
do $$ begin
  assert (select status from public.shipments where order_id = current_setting('t.o_packw')::uuid) = 'packed',
    'pack: packed';
  assert (select available_quantity::text from public.offers where id = pg_temp.fx(201)) = current_setting('t.avail_a1'),
    'pack: what shoppers can buy did not move';
  assert pg_temp.xmin(pg_temp.fx(10)) = current_setting('t.xmin_a'), 'pack: the product row was not written';
  assert pg_temp.stored(pg_temp.fx(10)) = pg_temp.expected(pg_temp.fx(10)), 'pack: summary right';
end $$;

-- ═══ 8. A shop packs its own parcel with the order locked first ═══════════

-- Product C (...0c, variant c1) which Tienda Sendero ships itself from its own
-- warehouse; 10 units counted there by the shop. seller_mark_packed is
-- redefined in 084400 (the order locked before the parcel): the wrong callers
-- are still refused and change nothing; the shop packs it; what it leaves
-- behind is as before.
do $$
declare
  v_like public.products%rowtype;
begin
  select * into strict v_like from public.products where slug = 'balon-futbol-sendero-5';
  insert into public.products (id, slug, title, description, category_id, brand_id, status, created_by_seller_id)
  values (pg_temp.fx(12), 'prueba-171-producto-c', 'Producto C de la prueba 171', 'Prueba.', v_like.category_id,
          v_like.brand_id, 'active', current_setting('t.sendero')::uuid);
  insert into public.skus (id, product_id, code, variant_name, weight_grams, length_cm, width_cm, height_cm)
  values (pg_temp.fx(104), pg_temp.fx(12), 'T171-C1', '', 500, 20, 15, 10);
  insert into public.offers (id, sku_id, seller_id, price_minor, fulfillment, handling_days, status, created_at)
  values (pg_temp.fx(205), pg_temp.fx(104), current_setting('t.sendero')::uuid, 1100000, 'seller', 1, 'active',
          '2026-01-01');
  perform pg_temp.remember('wh_sendero', (select id::text from public.warehouses
    where seller_id = current_setting('t.sendero')::uuid and kind = 'seller' and active order by code limit 1));
end $$;
select pg_temp.act('sendero@yuntera.example');
select public.seller_set_stock(current_setting('t.wh_sendero')::uuid, pg_temp.fx(104), 10);
select pg_temp.logout();
select pg_temp.remember('o_own', pg_temp.buy(pg_temp.fx(205), 1, 'cash_on_delivery', 't171-own-pack')::text);
select pg_temp.remember('s_own', (select id::text from public.shipments
  where order_id = current_setting('t.o_own')::uuid and origin_warehouse_id = current_setting('t.wh_sendero')::uuid));
create function pg_temp.own_stock() returns text
language sql stable as $$
  select format('%s/%s/%s', l.on_hand, l.reserved, (select available_quantity from public.offers where id = pg_temp.fx(205)))
  from public.stock_levels l
  where l.warehouse_id = current_setting('t.wh_sendero')::uuid and l.sku_id = pg_temp.fx(104)
    and l.seller_id = current_setting('t.sendero')::uuid
$$;
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.s_own')::uuid) = 'pending',
    'own pack: fixture, the parcel waits at the shop';
  assert pg_temp.own_stock() = '10/1/9', format('own pack: fixture stock %s', pg_temp.own_stock());
end $$;
select pg_temp.remember('xmin_c', pg_temp.xmin(pg_temp.fx(12)));

-- The wrong callers: a visitor, the shopper, another shop's member, warehouse staff.
select pg_temp.login_anon();
select pg_temp.refused(format('select public.seller_mark_packed(%L, 900, 1::smallint)', current_setting('t.s_own')), 'forbidden');
reset role;
select pg_temp.act('prueba-171@yuntera.example');
select pg_temp.refused(format('select public.seller_mark_packed(%L, 900, 1::smallint)', current_setting('t.s_own')), 'shipment_not_found');
select pg_temp.act('vendedor@yuntera.example');
select pg_temp.refused(format('select public.seller_mark_packed(%L, 900, 1::smallint)', current_setting('t.s_own')), 'shipment_not_found');
select pg_temp.act('bodega@yuntera.example');
select pg_temp.refused(format('select public.seller_mark_packed(%L, 900, 1::smallint)', current_setting('t.s_own')), 'shipment_not_found');
-- The right caller with a wrong package is refused too.
select pg_temp.act('sendero@yuntera.example');
select pg_temp.refused(format('select public.seller_mark_packed(%L, 0, 1::smallint)', current_setting('t.s_own')), 'invalid_package');
select pg_temp.logout();
do $$ begin
  assert (select status from public.shipments where id = current_setting('t.s_own')::uuid) = 'pending',
    'own pack: refused callers changed nothing';
  assert pg_temp.own_stock() = '10/1/9', 'own pack: refused callers left the stock';
end $$;

-- The shop packs it: one unit leaves its stock, the reservation is consumed,
-- the order moves on, what shoppers can buy and the product row do not move.
select pg_temp.act('sendero@yuntera.example');
select public.seller_mark_packed(current_setting('t.s_own')::uuid, 900, 1::smallint);
-- Packing it again is refused.
select pg_temp.refused(format('select public.seller_mark_packed(%L, 900, 1::smallint)', current_setting('t.s_own')),
                       'invalid_shipment_state');
select pg_temp.logout();
do $$ begin
  assert (select status = 'packed' and weight_grams = 900 and packed_at is not null
          from public.shipments where id = current_setting('t.s_own')::uuid), 'own pack: packed';
  assert pg_temp.own_stock() = '9/0/9', format('own pack: stock %s after packing', pg_temp.own_stock());
  assert (select r.status from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
          where i.order_id = current_setting('t.o_own')::uuid) = 'consumed', 'own pack: reservation consumed';
  assert exists (select 1 from public.stock_movements m where m.reference_id = current_setting('t.s_own')::uuid
                 and m.reason = 'ship' and m.on_hand_delta = -1), 'own pack: the ledger row';
  assert (select status from public.orders where id = current_setting('t.o_own')::uuid) = 'processing',
    'own pack: the order is being prepared';
  assert pg_temp.xmin(pg_temp.fx(12)) = current_setting('t.xmin_c'), 'own pack: the product row was not written';
  assert pg_temp.stored(pg_temp.fx(12)) = pg_temp.expected(pg_temp.fx(12)), 'own pack: summary right';
end $$;
-- Once packed, the order cannot be cancelled any more.
select pg_temp.act('central@yuntera.example');
select pg_temp.refused(format($q$select public.cancel_order(%L, 'Prueba ciento setenta')$q$, current_setting('t.o_own')),
                       'too_late_to_cancel');
select pg_temp.logout();

select 'ok' as stock_lock_order;
rollback;
