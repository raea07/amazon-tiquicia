-- Seller actions that lost their door (20261121083600_seller_listings.sql):
--
--   A  the offer order, the same cases as packages/core/src/offers.test.ts
--   B  an offer on another shop's product: search, add, who may change what
--   C  an order on that offer: paid, picked, delivered, settled, returned and
--      refunded, the money and the fees with the right shop
--   D  a variant switched off and on (alone, and shared with another shop)
--   E  a published listing back to draft and through review again
--   F  the shop's description, through the reviewed shop changes
--   G  the shop's logo, through the photo pipeline and the storage rules
--   H  offers paused below the price floor, with the reason, and resumed
--   I  a shop suspended and closed: shared listings stay and pass on
--   J  the per-request check: none of the new functions passes at aal1 for
--      an account with a second factor
--
-- Each function is called by the right caller, by wrong ones, and what it
-- leaves behind is checked. The money checks of _money_helpers.sql
-- (check_money) must hold after every block that moves money.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

-- ── Fixtures ────────────────────────────────────────────────────────────────

select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('ferreteria', (select id::text from public.sellers where slug = 'ferreteria-el-higueron'));
select pg_temp.remember('sendero', (select id::text from public.sellers where slug = 'tienda-sendero'));
select pg_temp.remember('cafetal', (select id::text from public.sellers where slug = 'cafetal-los-santos'));
select pg_temp.remember('bazar', (select id::text from public.sellers where slug = 'bazar-nuevo'));
select pg_temp.remember('higueron_wh', (select id::text from public.warehouses where code = 'HIG-HER'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.shopper('listados1@yuntera.example', 'Prueba Listados Uno');
select pg_temp.shopper('listados2@yuntera.example', 'Prueba Listados Dos');

-- The sku of a product's variant.
create function pg_temp.sku(p_slug text, p_variant text default '') returns uuid
language sql as $$
  select k.id from public.skus k join public.products p on p.id = k.product_id
  where p.slug = p_slug and k.variant_name = p_variant
$$;

-- One shop's offer on a product's variant.
create function pg_temp.offer_of(p_slug text, p_seller text, p_variant text default '') returns uuid
language sql as $$
  select o.id from public.offers o
  where o.sku_id = pg_temp.sku(p_slug, p_variant) and o.seller_id = current_setting('t.' || p_seller)::uuid
$$;

-- The offer ids of one variant on the product page, in the order shown.
create function pg_temp.page_offers(p_slug text, p_variant text default '') returns uuid[]
language sql as $$
  select array(
    select (o ->> 'offer_id')::uuid
    from jsonb_array_elements(public.get_product(p_slug) -> 'skus') k,
         jsonb_array_elements(k -> 'offers') with ordinality as x (o, n)
    where k ->> 'variant_name' = p_variant
    order by n)
$$;

-- Uploads one file the way the storage service records it, as the caller.
create function pg_temp.put(p_bucket text, p_path text, p_type text default 'image/jpeg',
                            p_size bigint default 120000) returns void
language sql as $$
  select set_config('storage.operation', 'storage.object.upload', true);
  insert into storage.objects (bucket_id, name, owner_id, metadata, version)
  values (p_bucket, p_path, auth.uid()::text,
          jsonb_build_object('mimetype', p_type, 'size', p_size, 'cacheControl', 'max-age=604800',
                             'eTag', '"' || md5(random()::text) || '"'),
          gen_random_uuid()::text);
$$;

do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ═══ A. The offer order ═════════════════════════════════════════════════════
-- One fixture product per case, each variant offered by up to three shops, as
-- in ORDER_CASES of packages/core/src/offers.test.ts.

create function pg_temp.case_product(p_code text) returns uuid
language plpgsql as $$
declare
  v_product uuid;
  v_sku uuid;
begin
  insert into public.products (slug, title, category_id, status, created_by_seller_id)
  values ('orden-' || p_code, 'Producto de orden ' || p_code,
          (select id from public.categories where slug = 'hogar'), 'active', current_setting('t.cafetal')::uuid)
  returning id into v_product;
  insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
  values (v_product, 'ORD-' || upper(p_code), 500, 20, 10, 10) returning id into v_sku;
  return v_sku;
end;
$$;

create function pg_temp.case_offer(
  p_id uuid, p_sku uuid, p_seller text, p_price_colones integer, p_stock integer, p_created timestamptz
) returns void
language plpgsql as $$
begin
  insert into public.offers (id, sku_id, seller_id, price_minor, fulfillment, handling_days, created_at)
  values (p_id, p_sku, current_setting('t.' || p_seller)::uuid, p_price_colones * 100::bigint, 'platform', 0, p_created);
  if p_stock > 0 then
    perform private.apply_stock_change(current_setting('t.depot')::uuid, p_sku,
      current_setting('t.' || p_seller)::uuid, p_stock, 'receive', null, 'test', null, 'orden');
  end if;
end;
$$;

do $$
declare
  t0 timestamptz := '2026-01-01 00:00:00+00';
  s uuid;
  v_product uuid;
begin
  -- a: in stock before out of stock, even when dearer
  s := pg_temp.case_product('a');
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000a1', s, 'tecnocasa', 15000, 0, t0);
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000a2', s, 'sendero', 25000, 3, t0);
  assert pg_temp.page_offers('orden-a') = array['00000000-0000-4000-8000-0000000000a2',
                                                '00000000-0000-4000-8000-0000000000a1']::uuid[],
    format('case a: %s', pg_temp.page_offers('orden-a'));
  -- b: then the lower price
  s := pg_temp.case_product('b');
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000b1', s, 'tecnocasa', 21000, 5, t0);
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000b2', s, 'sendero', 19900, 5, t0);
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000b3', s, 'ferreteria', 20000, 5, t0);
  assert pg_temp.page_offers('orden-b') = array['00000000-0000-4000-8000-0000000000b2',
    '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b1']::uuid[],
    format('case b: %s', pg_temp.page_offers('orden-b'));
  -- c: then the older offer
  s := pg_temp.case_product('c');
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000c1', s, 'tecnocasa', 20000, 5,
                             '2026-03-01 10:00:00+00');
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000c2', s, 'sendero', 20000, 5,
                             '2026-02-01 10:00:00+00');
  assert pg_temp.page_offers('orden-c') = array['00000000-0000-4000-8000-0000000000c2',
                                                '00000000-0000-4000-8000-0000000000c1']::uuid[],
    format('case c: %s', pg_temp.page_offers('orden-c'));
  -- d: then the id, for offers listed in the same instant
  s := pg_temp.case_product('d');
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000d2', s, 'tecnocasa', 20000, 5, t0);
  perform pg_temp.case_offer('00000000-0000-4000-8000-0000000000d1', s, 'sendero', 20000, 5, t0);
  assert pg_temp.page_offers('orden-d') = array['00000000-0000-4000-8000-0000000000d1',
                                                '00000000-0000-4000-8000-0000000000d2']::uuid[],
    format('case d: %s', pg_temp.page_offers('orden-d'));

  -- The listing summary (search, categories, the seller's badge) shows the
  -- first offer of the same order.
  foreach v_product in array array(select id from public.products where slug like 'orden-_' order by slug) loop
    assert (select p.featured_offer_id = (
              select (o ->> 'offer_id')::uuid
              from jsonb_array_elements(public.get_product(p.slug) -> 'skus') k,
                   jsonb_array_elements(k -> 'offers') with ordinality as x (o, n)
              order by n limit 1)
            from public.products p where p.id = v_product),
      format('summary and page agree for %s', (select slug from public.products where id = v_product));
  end loop;
  assert (select min_price_minor from public.products where slug = 'orden-a') = 2500000,
    'the price searched is the one in stock, not the cheaper one without stock';
end
$$;

-- ═══ B. An offer on another shop's product ══════════════════════════════════

-- A barcode on the thermal bottle, as its creator would have printed it.
update public.skus set gtin = '7441234567890' where id = pg_temp.sku('botella-termica-sendero-750ml');

do $$
declare
  v_found jsonb;
  v_variant jsonb;
  v_added jsonb;
  v_offer uuid;
  v_sku uuid := pg_temp.sku('botella-termica-sendero-750ml');
begin
  perform pg_temp.act('vendedor@yuntera.example');
  -- By name, by brand and by barcode (typed with a dash); one result per product.
  v_found := public.seller_catalog_search(current_setting('t.ferreteria')::uuid, 'botella termica');
  assert jsonb_array_length(v_found) >= 1 and v_found -> 0 ->> 'slug' = 'botella-termica-sendero-750ml',
    format('found by name: %s', v_found);
  v_variant := v_found -> 0 -> 'variants' -> 0;
  assert v_variant ->> 'my_offer_id' is null and (v_variant ->> 'offer_count')::integer = 1
     and (v_found -> 0 ->> 'own_listing')::boolean = false
     and v_found -> 0 ->> 'shop_name' = 'Tienda Sendero', format('the variant as offered: %s', v_variant);
  assert exists (select 1 from jsonb_array_elements(
                   public.seller_catalog_search(current_setting('t.ferreteria')::uuid, 'Sendero')) x
                 where x ->> 'slug' = 'botella-termica-sendero-750ml'), 'found by brand';
  v_found := public.seller_catalog_search(current_setting('t.ferreteria')::uuid, '744-1234567890');
  assert jsonb_array_length(v_found) = 1 and v_found -> 0 ->> 'slug' = 'botella-termica-sendero-750ml',
    format('found by barcode: %s', v_found);
  assert (select count(*) from jsonb_array_elements(
            public.seller_catalog_search(current_setting('t.ferreteria')::uuid, 'Sendero')) x
          group by x ->> 'slug' order by count(*) desc limit 1) = 1, 'never twice';
  -- Drafts and listings waiting for review are not in it.
  assert not exists (select 1 from jsonb_array_elements(
                       public.seller_catalog_search(current_setting('t.ferreteria')::uuid, 'lampara bambu')) x),
    'a listing in review is not offered';
  assert public.seller_catalog_search(current_setting('t.ferreteria')::uuid, 'x') = '[]'::jsonb,
    'one letter finds nothing';

  -- Adding the offer: no review, on sale at once.
  v_added := public.seller_add_offer(current_setting('t.ferreteria')::uuid, v_sku, 950000, 'seller', 1::smallint);
  v_offer := (v_added ->> 'offer_id')::uuid;
  assert v_added ->> 'outcome' = 'added' and v_added ->> 'slug' = 'botella-termica-sendero-750ml', v_added::text;
  perform pg_temp.remember('botella_offer', v_offer::text);
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 950000, ''seller'', 1::smallint)',
                                 current_setting('t.ferreteria'), v_sku), 'offer_exists');
  -- The new offer has no stock yet: it is listed after the creator's.
  assert pg_temp.page_offers('botella-termica-sendero-750ml') =
         array[pg_temp.offer_of('botella-termica-sendero-750ml', 'sendero'), v_offer],
    'no stock yet: after the offer that has some';
  -- Stock arrives by the usual path, at the shop's own place.
  perform public.seller_set_stock(current_setting('t.higueron_wh')::uuid, v_sku, 5);
  perform pg_temp.logout();
end
$$;

do $$
declare
  v_offer uuid := current_setting('t.botella_offer')::uuid;
  v_sku uuid := pg_temp.sku('botella-termica-sendero-750ml');
  v_page jsonb := public.get_product('botella-termica-sendero-750ml');
  v_cart record;
begin
  -- What it left behind.
  assert (select seller_id = current_setting('t.ferreteria')::uuid and status = 'active'
                 and available_quantity = 5 and fulfillment = 'seller'
          from public.offers where id = v_offer), 'the offer is the shop''s, on sale, with its stock';
  assert (select created_by_seller_id from public.products where slug = 'botella-termica-sendero-750ml')
         = current_setting('t.sendero')::uuid, 'the product stays with the shop that created it';
  assert (select count(*) from private.offer_additions where offer_id = v_offer) = 1, 'counted for the daily cap';
  assert exists (select 1 from private.outbox_events where topic = 'offer.added'
                 and payload ->> 'offer_id' = v_offer::text), 'and announced';
  assert (select count(*) from public.products p join public.skus k on k.product_id = p.id
          where p.title = (select title from public.products where slug = 'botella-termica-sendero-750ml')) = 1,
    'no duplicate product was made';

  -- The product page: both offers, in the order of the rule, each with its shop.
  assert pg_temp.page_offers('botella-termica-sendero-750ml') =
         array[v_offer, pg_temp.offer_of('botella-termica-sendero-750ml', 'sendero')],
    'cheaper and in stock: the new offer is shown first';
  assert v_page #>> '{skus,0,offers,0,seller,trade_name}' = 'Ferretería El Higuerón'
     and v_page #>> '{skus,0,offers,1,seller,trade_name}' = 'Tienda Sendero', 'each offer names its shop';
  assert (select featured_offer_id from public.products where slug = 'botella-termica-sendero-750ml') = v_offer
     and (select min_price_minor from public.products where slug = 'botella-termica-sendero-750ml') = 950000,
    'search and categories show the same offer and price';
  -- Search and suggestions list the product once.
  assert (select count(*) from public.search_products('botella termica')
          where slug = 'botella-termica-sendero-750ml') = 1, 'search lists it once';
  assert (select count(*) from public.suggest_products('botella ter')
          where slug = 'botella-termica-sendero-750ml') = 1, 'suggestions list it once';
  -- The cart buys exactly the offer chosen, and names who sells it.
  select * into v_cart from public.cart_lines(array[v_offer]);
  assert v_cart.buyable and v_cart.seller_name = 'Ferretería El Higuerón' and v_cart.price_minor = 950000,
    format('cart line: %s', row_to_json(v_cart));
end
$$;

-- Who may change what on a shared product.
do $$
declare
  v_offer uuid := current_setting('t.botella_offer')::uuid;
  v_product uuid := (select id from public.products where slug = 'botella-termica-sendero-750ml');
  v_listing jsonb;
begin
  -- The offering shop changes its own offer, and nothing of the product.
  perform pg_temp.act('vendedor@yuntera.example');
  perform public.seller_update_offer(v_offer, 960000, 'active', 1::smallint);
  assert (select price_minor from public.offers where id = v_offer) = 960000, 'its own price';
  perform pg_temp.refused(format('select public.seller_listing(%L)', v_product), 'listing_not_found');
  perform pg_temp.refused(format(
    'select public.seller_update_listing(%L, ''Botella de otra tienda'', ''aire-libre'', null, null, 380, 28, 8, 8)',
    v_product), 'listing_not_found');
  perform pg_temp.refused(format('select public.seller_reserve_photo(%L)', v_product), 'listing_not_found');
  perform pg_temp.refused(format('select public.seller_archive_listing(%L)', v_product), 'listing_not_found');
  perform pg_temp.refused(format('select public.seller_unpublish_listing(%L)', v_product), 'listing_not_found');
  perform pg_temp.refused(format('select public.seller_set_variant_active(%L, false)',
                                 pg_temp.sku('botella-termica-sendero-750ml')), 'listing_not_found');
  assert not (select editable from public.seller_listing_edits(current_setting('t.ferreteria')::uuid)
              where product_id = v_product), 'its list says it cannot edit the listing';
  assert exists (select 1 from public.seller_listings(current_setting('t.ferreteria')::uuid)
                 where offer_id = v_offer and competing_offers = 1), 'its list shows the offer and the competition';
  -- Its own listing is not offered twice.
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 5000000, ''platform'')',
                                 current_setting('t.ferreteria'), pg_temp.sku('taladro-inalambrico-roble-20v')),
                          'own_listing');

  -- The creating shop sees the listing is shared, and cannot take it away.
  perform pg_temp.act('sendero@yuntera.example');
  v_listing := public.seller_listing(v_product);
  assert (v_listing ->> 'shared')::boolean and (v_listing ->> 'other_shops')::integer = 1, v_listing::text;
  perform pg_temp.refused(format('select public.seller_archive_listing(%L)', v_product), 'listing_shared');
  perform pg_temp.refused(format('select public.seller_unpublish_listing(%L)', v_product), 'listing_shared');
  -- Nor can it touch the other shop's offer.
  perform pg_temp.refused(format('select public.seller_update_offer(%L, 100000, ''paused'')', v_offer),
                          'offer_not_found');
  perform pg_temp.logout();
end
$$;

-- Wrong callers and what cannot be offered.
do $$
declare
  v_sku uuid := pg_temp.sku('libreta-tapa-dura-a5');
begin
  -- Someone who is not in the shop.
  perform pg_temp.act('comprador@yuntera.example');
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 500000, ''seller'', 1::smallint)',
                                 current_setting('t.ferreteria'), v_sku), 'forbidden');
  perform pg_temp.refused(format('select public.seller_catalog_search(%L, ''libreta'')',
                                 current_setting('t.ferreteria')), 'forbidden');
  -- A shop that is not verified yet.
  perform pg_temp.act('bazar@yuntera.example');
  perform pg_temp.refused(format('select public.seller_catalog_search(%L, ''libreta'')',
                                 current_setting('t.bazar')), 'shop_not_approved');
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 500000, ''seller'', 1::smallint)',
                                 current_setting('t.bazar'), v_sku), 'shop_not_approved');
  perform pg_temp.act('vendedor@yuntera.example');
  -- A listing waiting for review, an unknown variant, a price under the floor,
  -- a malformed offer, a missing handling time.
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 500000, ''seller'', 1::smallint)',
                                 current_setting('t.ferreteria'),
                                 (select k.id from public.skus k where k.code = 'YT-LAMPBAMB')), 'variant_not_found');
  perform pg_temp.refused(format('select public.seller_add_offer(%L, gen_random_uuid(), 500000, ''seller'', 1::smallint)',
                                 current_setting('t.ferreteria')), 'variant_not_found');
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 1000, ''seller'', 1::smallint)',
                                 current_setting('t.ferreteria'), v_sku), 'price_below_fees');
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 500000, ''seller'', 1::smallint, 400000)',
                                 current_setting('t.ferreteria'), v_sku), 'invalid_offer');
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 500000, ''seller'')',
                                 current_setting('t.ferreteria'), v_sku), 'invalid_handling_days');
  -- The daily cap: with the cap at what the shop already added today, the next is refused.
  update public.app_settings set value = to_jsonb((select count(*) from private.offer_additions
                                                   where seller_id = current_setting('t.ferreteria')::uuid))
  where key = 'max_new_offers_per_day_per_seller';
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 500000, ''seller'', 1::smallint)',
                                 current_setting('t.ferreteria'), v_sku), 'too_many_new_offers');
  update public.app_settings set value = '30' where key = 'max_new_offers_per_day_per_seller';
  -- None of those refusals left an offer behind.
  assert not exists (select 1 from public.offers where sku_id = v_sku
                     and seller_id = current_setting('t.ferreteria')::uuid), 'nothing was added';
  perform pg_temp.logout();
end
$$;

-- An offer the shop archived is put back, not made twice.
do $$
declare
  v_sku uuid := pg_temp.sku('rompecabezas-volcanes-500');
  v_first jsonb;
  v_again jsonb;
begin
  perform pg_temp.act('vendedor@yuntera.example');
  v_first := public.seller_add_offer(current_setting('t.tecnocasa')::uuid, v_sku, 790000, 'platform');
  perform public.seller_update_offer((v_first ->> 'offer_id')::uuid, 790000, 'archived');
  v_again := public.seller_add_offer(current_setting('t.tecnocasa')::uuid, v_sku, 780000, 'platform');
  assert v_again ->> 'outcome' = 'resumed' and v_again ->> 'offer_id' = v_first ->> 'offer_id', v_again::text;
  assert (select price_minor = 780000 and status = 'active' from public.offers
          where id = (v_again ->> 'offer_id')::uuid), 'back on sale at the new price';
  -- Withdrawn again: the puzzle is used for the draft block below.
  perform public.seller_update_offer((v_first ->> 'offer_id')::uuid, 780000, 'archived');
  perform pg_temp.logout();
end
$$;

-- ═══ C. An order on the offering shop's offer, end to end ════════════════════

do $$
declare
  v_offer uuid := current_setting('t.botella_offer')::uuid;
  v_order uuid;
  v_item uuid;
  v_fees public.seller_order_fees;
  v_return uuid;
  v_review uuid;
begin
  v_order := pg_temp.place('listados1@yuntera.example',
                           jsonb_build_array(jsonb_build_object('offer_id', v_offer, 'quantity', 2)),
                           'card', 'listados-c-1');
  perform pg_temp.remember('c_order', v_order::text);
  v_item := (select id from public.order_items where order_id = v_order);
  assert (select seller_id from public.order_items where id = v_item) = current_setting('t.ferreteria')::uuid,
    'the line is the offering shop''s';
  assert (select count(*) from public.inventory_reservations
          where order_item_id = v_item and seller_id = current_setting('t.ferreteria')::uuid and status = 'active') = 1,
    'its stock is held, not the creator''s';

  perform pg_temp.pay(v_order);
  select * into v_fees from public.seller_order_fees where order_id = v_order;
  assert v_fees.seller_id = current_setting('t.ferreteria')::uuid and v_fees.items_gross_minor = 1920000,
    format('the fees are the offering shop''s: %s', row_to_json(v_fees));
  assert (select count(*) from public.seller_order_fees where order_id = v_order) = 1, 'and nobody else''s';
  assert exists (select 1 from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
                 join public.ledger_transactions t on t.id = e.transaction_id
                 where t.order_id = v_order and a.seller_id = current_setting('t.ferreteria')::uuid
                   and e.amount_minor = -v_fees.payout_minor), 'its payout is owed to the offering shop';
  assert not exists (select 1 from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
                     join public.ledger_transactions t on t.id = e.transaction_id
                     where t.order_id = v_order and a.seller_id = current_setting('t.sendero')::uuid),
    'the creating shop is owed nothing for it';
  perform pg_temp.check_money('C paid');

  -- Picked and packed by the offering shop, routed and delivered.
  perform pg_temp.deliver(v_order);
  assert (select status from public.orders where id = v_order) = 'delivered', 'delivered';
  assert (select seller_id from public.shipments where order_id = v_order limit 1)
         = current_setting('t.ferreteria')::uuid, 'the parcel left from the offering shop';
  perform pg_temp.check_money('C delivered');

  -- Reviews are about the product; the shop that sold the unit replies.
  perform pg_temp.act('listados1@yuntera.example');
  v_review := public.submit_review(v_item, 5::smallint, 'Muy buena', 'Mantiene el café caliente todo el día.');
  perform pg_temp.act('sendero@yuntera.example');
  perform pg_temp.refused(format('select public.seller_reply_review(%L, ''Gracias por su compra'')', v_review),
                          'review_not_found');
  perform pg_temp.act('vendedor@yuntera.example');
  perform public.seller_reply_review(v_review, 'Gracias por su compra.');
  assert (select product_id from public.reviews where id = v_review)
         = (select id from public.products where slug = 'botella-termica-sendero-750ml'), 'the review is the product''s';
  perform pg_temp.logout();

  -- A return of one unit, received and refunded.
  perform pg_temp.act('listados1@yuntera.example');
  v_return := public.request_return(v_item, 'withdrawal', 1);
  perform pg_temp.logout();
  perform pg_temp.receive(v_return);
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_complete_return(v_return);
  perform pg_temp.logout();
  assert (select count(*) from private.refunds where order_id = v_order) = 1, 'one refund booked';
  assert (select amount_minor from private.refunds where order_id = v_order) = 960000, 'for one unit';
  assert not exists (select 1 from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
                     join public.ledger_transactions t on t.id = e.transaction_id
                     where t.order_id = v_order and a.seller_id = current_setting('t.sendero')::uuid),
    'the refund touches only the offering shop''s account';
  perform pg_temp.check_money('C refunded');
end
$$;

-- ═══ D. A variant switched off and on ═══════════════════════════════════════

do $$
declare
  v_small uuid := pg_temp.sku('camiseta-algodon-sendero', 'Talla S');
  v_offer uuid := pg_temp.offer_of('camiseta-algodon-sendero', 'sendero', 'Talla S');
  v_order uuid;
  v_result jsonb;
begin
  -- An order waiting for its transfer holds a unit of the small size.
  v_order := pg_temp.place('listados2@yuntera.example',
                           jsonb_build_array(jsonb_build_object('offer_id', v_offer, 'quantity', 1)),
                           'sinpe_movil', 'listados-d-1');

  -- Wrong callers first.
  perform pg_temp.act('vendedor@yuntera.example');
  perform pg_temp.refused(format('select public.seller_set_variant_active(%L, false)', v_small), 'listing_not_found');
  perform pg_temp.act('comprador@yuntera.example');
  perform pg_temp.refused(format('select public.seller_set_variant_active(%L, false)', v_small), 'listing_not_found');

  perform pg_temp.act('sendero@yuntera.example');
  perform pg_temp.refused(format('select public.seller_set_variant_active(%L, null)', v_small), 'invalid_variant_state');
  v_result := public.seller_set_variant_active(v_small, false);
  assert v_result ->> 'outcome' = 'variant_off', v_result::text;
  assert public.seller_set_variant_active(v_small, false) ->> 'outcome' = 'unchanged', 'twice is harmless';
  perform pg_temp.logout();

  -- No new orders: not on the page, not buyable in a cart, refused at checkout.
  assert not exists (select 1 from jsonb_array_elements(public.get_product('camiseta-algodon-sendero') -> 'skus') k
                     where k ->> 'variant_name' = 'Talla S'), 'the page no longer offers it';
  assert not (select buyable from public.cart_lines(array[v_offer])), 'a cart cannot buy it';
  perform pg_temp.act('listados1@yuntera.example');
  perform pg_temp.refused(format(
    'select public.place_order(%L::jsonb, (select id from public.addresses where user_id = auth.uid() and is_default), ''card'', ''listados-d-2'')',
    jsonb_build_array(jsonb_build_object('offer_id', v_offer, 'quantity', 1))), 'offer_unavailable');
  perform pg_temp.logout();
  -- What was already there is untouched.
  assert (select status from public.orders where id = v_order) = 'pending_payment', 'the open order goes on';
  assert (select count(*) from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
          where i.order_id = v_order and r.status = 'active') = 1, 'its unit stays held';
  assert (select status from public.offers where id = v_offer) = 'active', 'the offer itself is unchanged';
  assert (select sum(on_hand) from public.stock_levels where sku_id = v_small) = 20, 'and the stock';

  -- Back on.
  perform pg_temp.act('sendero@yuntera.example');
  assert public.seller_set_variant_active(v_small, true) ->> 'outcome' = 'variant_on', 'on again';
  perform pg_temp.logout();
  assert (select buyable from public.cart_lines(array[v_offer])), 'buyable again';
  assert exists (select 1 from jsonb_array_elements(public.get_product('camiseta-algodon-sendero') -> 'skus') k
                 where k ->> 'variant_name' = 'Talla S'), 'and on the page';

  -- The last variant on sale is not switched off: draft or archive is the way.
  perform pg_temp.act('sendero@yuntera.example');
  perform pg_temp.refused(format('select public.seller_set_variant_active(%L, false)',
                                 pg_temp.sku('libreta-tapa-dura-a5')), 'last_variant');
  perform pg_temp.logout();
end
$$;

-- A variant another shop sells: only the creating shop's own offer goes.
do $$
declare
  v_large uuid := pg_temp.sku('camiseta-algodon-sendero', 'Talla L');
  v_theirs uuid;
  v_own uuid := pg_temp.offer_of('camiseta-algodon-sendero', 'sendero', 'Talla L');
  v_listing jsonb;
begin
  perform pg_temp.act('vendedor@yuntera.example');
  v_theirs := (public.seller_add_offer(current_setting('t.ferreteria')::uuid, v_large, 870000, 'seller',
                                       2::smallint) ->> 'offer_id')::uuid;
  perform pg_temp.act('sendero@yuntera.example');
  v_listing := public.seller_listing((select product_id from public.skus where id = v_large), v_large);
  assert exists (select 1 from jsonb_array_elements(v_listing -> 'variants') v
                 where (v ->> 'sku_id')::uuid = v_large and (v ->> 'shared')::boolean),
    'the listing says which variant is shared';
  assert public.seller_set_variant_active(v_large, false) ->> 'outcome' = 'offer_paused', 'only its own offer';
  assert (select active from public.skus where id = v_large), 'the variant stays for the other shop';
  assert (select status from public.offers where id = v_own) = 'paused'
     and (select status from public.offers where id = v_theirs) = 'active', 'own paused, theirs untouched';
  assert public.seller_set_variant_active(v_large, true) ->> 'outcome' = 'offer_resumed', 'and back';
  assert (select status from public.offers where id = v_own) = 'active', 'its own offer is on sale again';
  -- The other shop withdraws; the variant is the creator's alone again.
  perform pg_temp.act('vendedor@yuntera.example');
  perform public.seller_update_offer(v_theirs, 870000, 'archived', 2::smallint);
  perform pg_temp.act('sendero@yuntera.example');
  assert not private.variant_shared(v_large), 'an archived offer holds nothing back';
  perform pg_temp.logout();
end
$$;

-- ═══ E. A published listing back to draft, and through review again ════════

do $$
declare
  v_product uuid := (select id from public.products where slug = 'rompecabezas-volcanes-500');
  v_offer uuid := pg_temp.offer_of('rompecabezas-volcanes-500', 'sendero');
  v_published timestamptz := (select published_at from public.products where slug = 'rompecabezas-volcanes-500');
  v_order uuid;
  v_result jsonb;
  c jsonb;
begin
  -- An order already placed, and an edit waiting for review.
  v_order := pg_temp.place('listados2@yuntera.example',
                           jsonb_build_array(jsonb_build_object('offer_id', v_offer, 'quantity', 1)),
                           'card', 'listados-e-1');
  perform pg_temp.pay(v_order);
  perform pg_temp.act('sendero@yuntera.example');
  c := private.listing_content(v_product, pg_temp.sku('rompecabezas-volcanes-500'));
  perform public.seller_update_listing(v_product, 'Rompecabezas Volcanes de Costa Rica, 500 piezas',
    c ->> 'category_slug', c ->> 'description', array(select jsonb_array_elements_text(c -> 'bullet_points')),
    (c ->> 'weight_grams')::integer, (c ->> 'length_cm')::numeric, (c ->> 'width_cm')::numeric,
    (c ->> 'height_cm')::numeric);
  assert exists (select 1 from public.product_change_requests where product_id = v_product and status = 'pending'),
    'an edit waits';

  -- Wrong callers.
  perform pg_temp.act('vendedor@yuntera.example');
  perform pg_temp.refused(format('select public.seller_unpublish_listing(%L)', v_product), 'listing_not_found');

  perform pg_temp.act('sendero@yuntera.example');
  v_result := public.seller_unpublish_listing(v_product);
  assert v_result ->> 'status' = 'draft' and (v_result ->> 'edit_withdrawn')::boolean, v_result::text;
  perform pg_temp.refused(format('select public.seller_unpublish_listing(%L)', v_product), 'listing_not_published');
  perform pg_temp.logout();

  -- Hidden from the shop and from search; a cart treats it as archived.
  assert (select status from public.products where id = v_product) = 'draft', 'draft';
  assert not exists (select 1 from public.search_products('rompecabezas volcanes')
                     where slug = 'rompecabezas-volcanes-500'), 'not in search';
  assert not public.shop_path_exists('product', 'rompecabezas-volcanes-500'), 'its address is not found';
  perform pg_temp.login_anon();
  assert public.get_product('rompecabezas-volcanes-500') is null, 'a visitor does not see it';
  reset role;
  assert not (select buyable from public.cart_lines(array[v_offer])), 'not buyable from a cart';
  -- The open order goes on, and is delivered.
  assert (select status from public.orders where id = v_order) = 'confirmed', 'the paid order is untouched';
  perform pg_temp.deliver(v_order);
  assert (select status from public.orders where id = v_order) = 'delivered', 'and delivered';

  -- Reworked as a draft (in place), sent to review, published again.
  perform pg_temp.act('sendero@yuntera.example');
  assert public.seller_update_listing(v_product, 'Rompecabezas Volcanes de Costa Rica de 500 piezas',
    c ->> 'category_slug', c ->> 'description', array(select jsonb_array_elements_text(c -> 'bullet_points')),
    (c ->> 'weight_grams')::integer, (c ->> 'length_cm')::numeric, (c ->> 'width_cm')::numeric,
    (c ->> 'height_cm')::numeric, null, true) ->> 'outcome' = 'submitted', 'sent to review';
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_review_product(v_product, true);
  perform pg_temp.logout();
  assert (select status = 'active' and title = 'Rompecabezas Volcanes de Costa Rica de 500 piezas'
                 and published_at = v_published
          from public.products where id = v_product), 'published again, with its first publication date';
  assert (select buyable from public.cart_lines(array[v_offer])), 'and buyable';
  perform pg_temp.check_money('E');
end
$$;

-- ═══ F. The shop's description ═════════════════════════════════════════════

do $$
declare
  v_request uuid;
  v_front jsonb;
  v_text text := E'<b>Electrónica</b> con garantía local.\r\n\r\n\r\nEntregamos en todo el GAM.';
begin
  -- Wrong callers: someone outside the shop, and a member who is not in charge.
  perform pg_temp.act('comprador@yuntera.example');
  perform pg_temp.refused(format('select public.seller_request_shop_description(%L, ''Hola'')',
                                 current_setting('t.tecnocasa')), 'forbidden');
  perform pg_temp.refused(format('select public.seller_shop_front(%L)', current_setting('t.tecnocasa')), 'forbidden');

  perform pg_temp.act('vendedor@yuntera.example');
  perform pg_temp.refused(format('select public.seller_request_shop_description(%L, %L)',
                                 current_setting('t.tecnocasa'), repeat('a', 1001)), 'invalid_shop_description');
  perform pg_temp.refused(format('select public.seller_request_shop_description(%L, %L)',
                                 current_setting('t.tecnocasa'),
                                 (select description from public.sellers where slug = 'tecnocasa')),
                          'shop_change_unchanged');
  v_request := public.seller_request_shop_description(current_setting('t.tecnocasa')::uuid, v_text);
  v_front := public.seller_shop_front(current_setting('t.tecnocasa')::uuid);
  assert v_front #>> '{description_request,status}' = 'pending'
     and v_front #>> '{description_request,proposed,description}'
         = E'<b>Electrónica</b> con garantía local.\n\nEntregamos en todo el GAM.',
    format('waiting, stored as text: %s', v_front -> 'description_request');
  assert (select description from public.sellers where slug = 'tecnocasa') not like '%GAM%',
    'nothing changes until staff approve';
  perform pg_temp.logout();

  -- Operations decide it, as a name; finance does not.
  insert into public.staff_members (user_id, role)
  select id, 'finance' from auth.users where email = 'comprador3@yuntera.example';
  perform pg_temp.act('comprador3@yuntera.example');
  perform pg_temp.refused(format('select public.ops_decide_shop_change(%L, true)', v_request), 'shop_change_not_found');
  assert not exists (select 1 from jsonb_array_elements(public.ops_shop_change_requests('pending')) r
                     where (r ->> 'id')::uuid = v_request), 'finance does not see it';
  perform pg_temp.act('central@yuntera.example');
  assert exists (select 1 from jsonb_array_elements(public.ops_shop_change_requests('pending')) r
                 where (r ->> 'id')::uuid = v_request and r ->> 'kind' = 'description'
                   and (r ->> 'can_decide')::boolean), 'operations see it, with what is there now';
  perform public.ops_decide_shop_change(v_request, true);
  perform pg_temp.logout();

  assert (select description from public.sellers where slug = 'tecnocasa')
         = E'<b>Electrónica</b> con garantía local.\n\nEntregamos en todo el GAM.', 'written on the shop';
  assert exists (select 1 from private.audit_log l
                 where l.table_name = 'sellers' and l.row_key = current_setting('t.tecnocasa')
                   and l.new_row ->> 'description' like '%GAM%'
                   and l.actor_id = (select id from auth.users where email = 'central@yuntera.example')),
    'the decision is in the audit trail, with who made it';
  perform pg_temp.login_anon();
  assert public.get_shop('tecnocasa') ->> 'description' like '<b>Electrónica</b>%', 'the shop page shows it as text';
  reset role;

  -- A rejection carries a reason the seller reads. (Requests made in one
  -- transaction share its clock; the first one is dated an hour back, as it
  -- would be in real use.)
  update public.seller_change_requests set requested_at = requested_at - interval '1 hour'
  where id = v_request;
  perform pg_temp.act('vendedor@yuntera.example');
  v_request := public.seller_request_shop_description(current_setting('t.tecnocasa')::uuid, 'La mejor tienda del país.');
  perform pg_temp.act('central@yuntera.example');
  perform pg_temp.refused(format('select public.ops_decide_shop_change(%L, false, ''No'')', v_request), 'reason_required');
  perform public.ops_decide_shop_change(v_request, false, 'Describa lo que vende, sin comparaciones que no se puedan comprobar.');
  perform pg_temp.act('vendedor@yuntera.example');
  v_front := public.seller_shop_front(current_setting('t.tecnocasa')::uuid);
  assert v_front #>> '{description_request,status}' = 'rejected' and v_front #>> '{description_request,note}' like 'Describa%',
    'the seller reads why';
  perform pg_temp.logout();
end
$$;

-- ═══ G. The shop's logo ═════════════════════════════════════════════════════

select pg_temp.login('vendedor@yuntera.example');
select pg_temp.remember('logo1', (public.seller_reserve_logo(current_setting('t.tecnocasa')::uuid))::text);
do $$
declare
  v_reserved jsonb := current_setting('t.logo1')::jsonb;
  f jsonb;
begin
  assert v_reserved ->> 'bucket' = 'product-photos-pending' and jsonb_array_length(v_reserved -> 'files') = 3,
    v_reserved::text;
  assert v_reserved #>> '{files,0,path}' = current_setting('t.tecnocasa') || '/logo/' || (v_reserved ->> 'logo_id')
                                            || '/400.jpg', 'the path is the shop''s logo folder';
  for f in select jsonb_array_elements(v_reserved -> 'files') loop
    perform pg_temp.put('product-photos-pending', f ->> 'path');
  end loop;
  -- Not into the public bucket, and not into another shop's folder.
  begin
    perform pg_temp.put('product-photos', v_reserved #>> '{files,0,path}');
    raise exception 'a seller wrote a public logo file';
  exception when insufficient_privilege then null;
  end;
  begin
    perform pg_temp.put('product-photos-pending',
      current_setting('t.sendero') || '/logo/' || (v_reserved ->> 'logo_id') || '/400.jpg');
    raise exception 'a seller wrote into another shop''s folder';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.refused(format('select public.seller_finish_logo(%L, %L, 300, 300)',
                                 current_setting('t.tecnocasa'), v_reserved ->> 'logo_id'), 'invalid_photo');
  assert (public.seller_finish_logo(current_setting('t.tecnocasa')::uuid, (v_reserved ->> 'logo_id')::uuid,
                                    1200, 1200)) ->> 'state' = 'pending', 'sent for review';
  assert public.seller_shop_front(current_setting('t.tecnocasa')::uuid) #>> '{logo_waiting,state}' = 'pending',
    'the seller sees it waiting';
end
$$;
reset role;
select pg_temp.logout();

-- A visitor and another shop's member cannot read the waiting files; nobody
-- outside the shop can reserve or finish its logo.
select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v_reserved jsonb := current_setting('t.logo1')::jsonb;
begin
  perform set_config('storage.operation', 'storage.object.get_authenticated', true);
  assert (select count(*) from storage.objects where name like current_setting('t.tecnocasa') || '/logo/%') = 0,
    'another shop sees none of the files';
  perform pg_temp.refused(format('select public.seller_reserve_logo(%L)', current_setting('t.tecnocasa')), 'forbidden');
  perform pg_temp.refused(format('select public.seller_finish_logo(%L, %L, 1200, 1200)',
                                 current_setting('t.tecnocasa'), v_reserved ->> 'logo_id'), 'forbidden');
  perform pg_temp.refused('select public.ops_logos_for_review()', 'forbidden');
  perform pg_temp.refused(format('select public.ops_review_logo(%L, true)', v_reserved ->> 'logo_id'), 'forbidden');
end
$$;
reset role;
select pg_temp.logout();

-- Catalogue staff approve; the console writes the public sizes; the shop shows it.
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_logo uuid := (current_setting('t.logo1')::jsonb ->> 'logo_id')::uuid;
  v_queue jsonb := public.ops_logos_for_review();
  v_files jsonb;
  p text;
begin
  assert exists (select 1 from jsonb_array_elements(v_queue) x
                 where (x ->> 'logo_id')::uuid = v_logo and x ->> 'kind' = 'review'
                   and x ->> 'seller_name' = 'TecnoCasa' and not (x ->> 'files_changed')::boolean),
    format('in the queue: %s', v_queue);
  perform pg_temp.refused(format('select public.ops_review_logo(%L, false, ''no'')', v_logo), 'reason_required');
  perform public.ops_review_logo(v_logo, true);
  assert public.ops_confirm_logo_published(v_logo) ->> 'outcome' = 'waiting', 'not before the files exist';
  v_files := public.ops_logo_files_to_publish(v_logo);
  assert jsonb_array_length(v_files) = 1 and jsonb_array_length(v_files -> 0 -> 'paths') = 3, v_files::text;
  for p in select jsonb_array_elements_text(v_files -> 0 -> 'paths') loop
    perform pg_temp.put('product-photos', p);
  end loop;
  assert public.ops_confirm_logo_published(v_logo) ->> 'outcome' = 'published', 'published';
end
$$;
reset role;
select pg_temp.logout();

do $$
declare
  v_logo uuid := (current_setting('t.logo1')::jsonb ->> 'logo_id')::uuid;
  v_template text := current_setting('t.tecnocasa') || '/logo/' || v_logo || '/{w}.jpg';
begin
  assert (select logo_path from public.sellers where slug = 'tecnocasa') = v_template, 'the shop has its logo';
  assert public.get_shop('tecnocasa') ->> 'logo' = v_template, 'its page shows it';
  assert exists (select 1 from jsonb_array_elements(public.get_product('audifonos-inalambricos-nimbo-aire') -> 'skus') k,
                   jsonb_array_elements(k -> 'offers') o
                 where o #>> '{seller,slug}' = 'tecnocasa' and o #>> '{seller,logo}' = v_template),
    'and the product page, next to its offer';
  assert exists (select 1 from private.audit_log l where l.table_name = 'shop_logos' and l.row_key = v_logo::text
                 and l.new_row ->> 'state' = 'approved'
                 and l.actor_id = (select id from auth.users where email = 'central@yuntera.example')),
    'the approval is in the audit trail';
  assert exists (select 1 from private.outbox_events where topic = 'seller.change_decided'
                 and payload ->> 'kind' = 'logo' and payload ->> 'request_id' = v_logo::text), 'the shop is told';
  -- The waiting copies are no longer needed; the public ones are.
  assert private.photo_object_disposable('product-photos-pending',
           current_setting('t.tecnocasa') || '/logo/' || v_logo || '/400.jpg', now()), 'waiting copy disposable';
  assert not private.photo_object_disposable('product-photos',
           current_setting('t.tecnocasa') || '/logo/' || v_logo || '/400.jpg', now()), 'public copy kept';
end
$$;

-- A second logo, rejected with a reason; then a third replaces a waiting one;
-- the shop removes its logo.
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_second jsonb := public.seller_reserve_logo(current_setting('t.tecnocasa')::uuid);
  v_third jsonb;
  f jsonb;
begin
  for f in select jsonb_array_elements(v_second -> 'files') loop
    perform pg_temp.put('product-photos-pending', f ->> 'path');
  end loop;
  perform public.seller_finish_logo(current_setting('t.tecnocasa')::uuid, (v_second ->> 'logo_id')::uuid, 800, 800);
  perform pg_temp.remember('logo2', v_second ->> 'logo_id');
  v_third := public.seller_reserve_logo(current_setting('t.tecnocasa')::uuid);
  perform pg_temp.remember('logo3', v_third ->> 'logo_id');
end
$$;
reset role;
select pg_temp.logout();
do $$
begin
  assert (select state from public.shop_logos where id = current_setting('t.logo2')::uuid) = 'removed',
    'a new reservation replaces the logo waiting';
  assert (select state from public.shop_logos
          where id = (current_setting('t.logo1')::jsonb ->> 'logo_id')::uuid) = 'approved',
    'the published one stays';
end
$$;
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  f jsonb;
begin
  for f in select jsonb_build_object('path', current_setting('t.tecnocasa') || '/logo/' || current_setting('t.logo3')
                                             || '/' || s || '.jpg')
           from unnest(array[400, 800, 1600]) s loop
    perform pg_temp.put('product-photos-pending', f ->> 'path');
  end loop;
  perform public.seller_finish_logo(current_setting('t.tecnocasa')::uuid, current_setting('t.logo3')::uuid, 900, 600);
end
$$;
reset role;
select pg_temp.logout();
select pg_temp.login('central@yuntera.example');
select public.ops_review_logo(current_setting('t.logo3')::uuid, false, 'El logotipo tiene la marca de otra empresa.');
reset role;
select pg_temp.logout();
select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_front jsonb := public.seller_shop_front(current_setting('t.tecnocasa')::uuid);
begin
  assert v_front #>> '{logo_rejected,rejection_reason}' like 'El logotipo tiene%', format('refused: %s', v_front);
  assert v_front -> 'logo_waiting' = 'null'::jsonb, 'nothing waits';
  assert public.seller_remove_logo(current_setting('t.tecnocasa')::uuid), 'removed';
  assert public.seller_shop_front(current_setting('t.tecnocasa')::uuid) -> 'logo' = 'null'::jsonb, 'no logo now';
  perform pg_temp.refused(format('select public.seller_withdraw_logo(%L)', current_setting('t.tecnocasa')),
                          'logo_not_found');
end
$$;
reset role;
select pg_temp.logout();

-- ═══ H. Offers paused below the price floor ═════════════════════════════════

-- An approved edit of a shared listing's package leaves another shop's offer
-- below the floor: that offer is paused and listed, the edit goes through.
do $$
declare
  v_sku uuid := pg_temp.sku('balon-futbol-sendero-5');
  v_product uuid := (select product_id from public.skus where id = pg_temp.sku('balon-futbol-sendero-5'));
  v_category uuid := (select category_id from public.products where slug = 'balon-futbol-sendero-5');
  v_old bigint := private.min_price_covering_fees('platform', v_category, 430, 22);
  v_new bigint := private.min_price_covering_fees('platform', v_category, 20000, 100);
  v_theirs uuid;
  v_list jsonb;
  c jsonb := private.listing_content(v_product, pg_temp.sku('balon-futbol-sendero-5'));
begin
  assert v_new > v_old + 200, format('the heavier package costs more to sell (%s, %s)', v_old, v_new);
  perform pg_temp.act('vendedor@yuntera.example');
  v_theirs := (public.seller_add_offer(current_setting('t.ferreteria')::uuid, v_sku,
                                       ((v_old + 199) / 100) * 100 + 100, 'platform') ->> 'offer_id')::uuid;
  perform pg_temp.act('sendero@yuntera.example');
  perform public.seller_update_offer(pg_temp.offer_of('balon-futbol-sendero-5', 'sendero'),
                                     ((v_new + 99) / 100) * 100 + 10000, 'active');
  perform public.seller_update_listing(v_product, c ->> 'title', c ->> 'category_slug', c ->> 'description',
    array(select jsonb_array_elements_text(c -> 'bullet_points')), 20000, 100, 22, 22);
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_review_listing_edit(
    (select id from public.product_change_requests where product_id = v_product and status = 'pending'), true);
  assert (select weight_grams from public.skus where id = v_sku) = 20000, 'the edit went through';
  assert (select status from public.offers where id = v_theirs) = 'paused', 'the other shop''s offer is paused';
  assert (select status from public.offers where id = pg_temp.offer_of('balon-futbol-sendero-5', 'sendero')) = 'active',
    'the creator''s, which covers the fees, is not';

  perform pg_temp.act('vendedor@yuntera.example');
  v_list := public.seller_paused_offers(current_setting('t.ferreteria')::uuid);
  assert exists (select 1 from jsonb_array_elements(v_list) x
                 where (x ->> 'offer_id')::uuid = v_theirs and x ->> 'reason' = 'listing_edit'
                   and (x ->> 'min_price_minor')::bigint = ((v_new + 99) / 100) * 100),
    format('listed with the reason and the lowest price: %s', v_list);
  -- Below the floor it stays paused; at the price shown it goes back on sale.
  perform pg_temp.refused(format('select public.seller_update_offer(%L, %s, ''active'')', v_theirs, v_old + 100),
                          'price_below_fees');
  perform public.seller_update_offer(v_theirs, ((v_new + 99) / 100) * 100, 'active');
  assert not exists (select 1 from jsonb_array_elements(public.seller_paused_offers(current_setting('t.ferreteria')::uuid)) x
                     where (x ->> 'offer_id')::uuid = v_theirs), 'and leaves the list';
  -- Another shop's list is its own.
  perform pg_temp.act('comprador@yuntera.example');
  perform pg_temp.refused(format('select public.seller_paused_offers(%L)', current_setting('t.ferreteria')), 'forbidden');
  perform pg_temp.logout();
end
$$;

-- A fee change pauses offers; the seller's list says so.
do $$
declare
  v_offer uuid := current_setting('t.botella_offer')::uuid;
  v_list jsonb;
begin
  update public.fee_schedules set min_referral_fee_per_unit_minor = 1000000 where active;
  assert (select status from public.offers where id = v_offer) = 'paused', 'the fee change paused it';
  perform pg_temp.act('vendedor@yuntera.example');
  v_list := public.seller_paused_offers(current_setting('t.ferreteria')::uuid);
  assert exists (select 1 from jsonb_array_elements(v_list) x
                 where (x ->> 'offer_id')::uuid = v_offer and x ->> 'reason' = 'fee_change'
                   and x ->> 'title' = 'Botella térmica Sendero 750 ml acero inoxidable'
                   and (x ->> 'min_price_minor')::bigint > 960000),
    format('listed after a fee change: %s', v_list);
  perform pg_temp.logout();
  perform pg_temp.check_money('H');
end
$$;

-- ═══ I. A shop suspended, then closed ═══════════════════════════════════════

-- Put the fees back first: block H paused most of the catalogue.
update public.fee_schedules set min_referral_fee_per_unit_minor = 0 where active;
select pg_temp.act('vendedor@yuntera.example');
select public.seller_update_offer(current_setting('t.botella_offer')::uuid, 960000, 'active', 1::smallint);
select pg_temp.logout();
update public.sellers set description = 'Aire libre, por Diego.' where slug = 'tienda-sendero';

do $$
declare
  v_botella uuid := (select id from public.products where slug = 'botella-termica-sendero-750ml');
  v_libreta uuid := (select id from public.products where slug = 'libreta-tapa-dura-a5');
  c jsonb;
begin
  -- Suspended: the shared product stays on sale through the other shop, and
  -- stays the suspended shop's (it may come back); it cannot send edits.
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_set_seller_status(current_setting('t.sendero')::uuid, 'suspended', 'Revisión de documentos.');
  perform pg_temp.logout();
  assert public.shop_path_exists('product', 'botella-termica-sendero-750ml'), 'the shared page stays';
  assert pg_temp.page_offers('botella-termica-sendero-750ml') = array[current_setting('t.botella_offer')::uuid],
    'with the other shop''s offer only';
  assert not public.shop_path_exists('product', 'libreta-tapa-dura-a5'), 'its own listing leaves the shop';
  assert (select created_by_seller_id from public.products where id = v_botella) = current_setting('t.sendero')::uuid,
    'the content stays with it while suspended';
  assert not private.listing_shared(v_libreta), 'a suspended shop''s offers hold nothing back';
  perform pg_temp.act('sendero@yuntera.example');
  c := private.listing_content(v_botella, pg_temp.sku('botella-termica-sendero-750ml'));
  perform pg_temp.refused(format(
    'select public.seller_update_listing(%L, ''Botella térmica Sendero de 750 ml'', %L, null, null, 380, 28, 8, 8)',
    v_botella, c ->> 'category_slug'), 'shop_not_active');
  perform pg_temp.refused(format('select public.seller_set_variant_active(%L, true)',
                                 pg_temp.sku('camiseta-algodon-sendero', 'Talla S')), 'shop_not_active');
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 5000000, ''seller'', 1::smallint)',
                                 current_setting('t.sendero'), pg_temp.sku('taladro-inalambrico-roble-20v')),
                          'shop_not_active');

  -- Back, with an edit waiting on the shared listing; then closed.
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_set_seller_status(current_setting('t.sendero')::uuid, 'active');
  perform pg_temp.act('sendero@yuntera.example');
  perform public.seller_update_listing(v_botella, 'Botella térmica Sendero de 750 ml', c ->> 'category_slug',
    c ->> 'description', array(select jsonb_array_elements_text(c -> 'bullet_points')), 380, 28, 8, 8);
  perform pg_temp.act('central@yuntera.example');
  perform public.ops_set_seller_status(current_setting('t.sendero')::uuid, 'closed', 'Cierre pedido por la tienda.');
  perform pg_temp.logout();

  -- The shared listing passes to the shop with the oldest live offer.
  assert (select created_by_seller_id from public.products where id = v_botella)
         = current_setting('t.ferreteria')::uuid, 'handed over';
  assert (select status from public.products where id = v_botella) = 'active', 'still on sale';
  assert not exists (select 1 from public.product_change_requests where product_id = v_botella and status = 'pending'),
    'the closed shop''s waiting edit is withdrawn';
  assert exists (select 1 from private.outbox_events where topic = 'product.handed_over'
                 and payload ->> 'product_id' = v_botella::text), 'and it is recorded';
  -- Its own listing nobody else sells stays with it, shown nowhere.
  assert (select created_by_seller_id from public.products where id = v_libreta) = current_setting('t.sendero')::uuid
     and not public.shop_path_exists('product', 'libreta-tapa-dura-a5'), 'its own listing is gone from the shop';
  -- The closed shop's face goes; its page does not exist.
  assert (select description is null and logo_path is null from public.sellers where slug = 'tienda-sendero'),
    'its description and logo leave the shop';
  assert public.get_shop('tienda-sendero') is null and not public.shop_path_exists('shop', 'tienda-sendero'),
    'no page for a closed shop';

  -- The new owner edits it, through the same review.
  perform pg_temp.act('vendedor@yuntera.example');
  assert (public.seller_listing(v_botella) ->> 'seller_id')::uuid = current_setting('t.ferreteria')::uuid,
    'the new owner opens it';
  assert public.seller_update_listing(v_botella, 'Botella térmica de acero 750 ml', c ->> 'category_slug',
    c ->> 'description', array(select jsonb_array_elements_text(c -> 'bullet_points')), 380, 28, 8, 8)
    ->> 'outcome' = 'in_review', 'and its change waits for review like any other';
  perform pg_temp.act('sendero@yuntera.example');
  perform pg_temp.refused(format('select public.seller_listing(%L)', v_botella), 'listing_not_found');
  perform pg_temp.logout();
  perform pg_temp.check_money('I');
end
$$;

-- ═══ J. The per-request check ═══════════════════════════════════════════════

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), u.id, 'x', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'
from auth.users u where u.email = 'cafetal@yuntera.example';

select pg_temp.login('cafetal@yuntera.example', 'aal1');
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'seller_catalog_search', 'seller_add_offer', 'seller_set_variant_active', 'seller_unpublish_listing',
    'seller_paused_offers', 'seller_request_shop_description', 'seller_shop_front', 'seller_reserve_logo',
    'seller_finish_logo', 'seller_withdraw_logo', 'seller_remove_logo', 'ops_logos_for_review',
    'ops_review_logo', 'ops_logo_files_to_publish', 'ops_confirm_logo_published', 'get_shop'] loop
    perform set_config('request.path', '/rpc/' || v_fn, true);
    begin
      perform public.check_request();
      raise exception 'before_second_step: % passed the check at aal1', v_fn;
    exception when others then
      if sqlerrm <> 'second_factor_required' then raise; end if;
    end;
  end loop;
  -- And the seller helpers see no shop without the second step.
  perform pg_temp.refused(format('select public.seller_add_offer(%L, %L, 500000, ''seller'', 1::smallint)',
                                 current_setting('t.cafetal'), pg_temp.sku('libreta-tapa-dura-a5')), 'forbidden');
end
$$;
reset role;

select 'ok' as seller_listings;
rollback;
