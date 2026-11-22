-- Seller actions that lost their door when the lockdown (082800) took every
-- table privilege away from the app roles. Each was possible only as a direct
-- write; each is now a function, checked and tested like the rest.
--
--   1. The offer order: one rule, in stock first, then the lowest total for
--      the shopper, then the older offer, then the id. The listing summary
--      (search, categories, the seller's "featured" badge) and the order of
--      a variant's offers on the product page use it; packages/core/src/offers.ts
--      is the same rule for the product page's first offer, and a parity test
--      reads the ORDER BY between the `offer_order` markers below.
--   2. An offer on an existing product: a seller of an active, verified shop
--      finds a published product (name, brand, barcode) and adds its own offer
--      to one of its variants. No review (the content is already approved);
--      a daily cap per shop. The creating shop keeps the content.
--   3. Who edits a shared product's content: the creating shop, and catalogue
--      staff through the reviews. A shop that closes hands its shared listings
--      to the shop with the oldest live offer; one that is suspended keeps them
--      (it cannot send edits while suspended).
--   4. A variant switched off and on again, and a published listing taken back
--      to draft and sent to review again.
--   5. The shop's public description (a reviewed shop change, kind
--      'description') and its logo (the photo pipeline of 082700: waiting
--      bucket, staff review, published bucket), shown on a new public shop
--      page and on the product page.
--   6. Offers paused by a fee change (083200), listed for their seller with
--      the reason; also offers of other shops paused because an approved edit
--      of the listing's package or category left them below the price floor.
--
-- The rules of docs/03-data/access-control.md hold for everything here: every
-- function is security definer with an empty search path, checks its caller
-- first, raises short codes, and is granted to `authenticated` only (get_shop
-- also to visitors). New tables have row-level security and no privilege.
-- docs/04-algorithms/featured-offer.md explains the decisions.

-- ═══ 0. Helpers ═════════════════════════════════════════════════════════════

-- Does a shop other than the one that created the listing have a live offer
-- on it: an offer not archived (on sale or paused, which its shop can resume
-- at any moment) from a shop that may trade? A suspended or closed shop's
-- offers are on sale nowhere and hold nothing back.
create or replace function private.listing_shared(p_product_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.products p
    join public.skus k on k.product_id = p.id
    join public.offers o on o.sku_id = k.id
    join public.sellers s on s.id = o.seller_id
    where p.id = p_product_id
      and o.seller_id is distinct from p.created_by_seller_id
      and o.status <> 'archived' and s.status = 'active');
$$;

-- The same for one variant.
create or replace function private.variant_shared(p_sku_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.skus k
    join public.products p on p.id = k.product_id
    join public.offers o on o.sku_id = k.id
    join public.sellers s on s.id = o.seller_id
    where k.id = p_sku_id
      and o.seller_id is distinct from p.created_by_seller_id
      and o.status <> 'archived' and s.status = 'active');
$$;

-- ═══ 1. The offer order ═════════════════════════════════════════════════════

-- Replaces the version in the catalogue migration. The rule is unchanged (it
-- already put offers in stock first and the cheapest next); it is restated
-- here with the markers the parity test reads, so it cannot drift from
-- packages/core/src/offers.ts. Shipping is charged once per order by zone,
-- the same for every offer, so the price is the shopper's total per offer.
create or replace function private.refresh_product_summary(p_product_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_best record;
  v_count integer;
begin
  select count(*) into v_count
  from public.offers o
  join public.skus k on k.id = o.sku_id
  join public.sellers s on s.id = o.seller_id
  where k.product_id = p_product_id and k.active
    and o.status = 'active' and s.status = 'active';

  select o.id, o.price_minor, o.list_price_minor, o.fulfillment, o.handling_days,
         (o.available_quantity > 0) as buyable
  into v_best
  from public.offers o
  join public.skus k on k.id = o.sku_id
  join public.sellers s on s.id = o.seller_id
  where k.product_id = p_product_id and k.active
    and o.status = 'active' and s.status = 'active' and o.condition = 'new'
  -- BEGIN offer_order
  order by (o.available_quantity > 0) desc, o.price_minor asc, o.created_at asc, o.id asc
  -- END offer_order
  limit 1;

  update public.products
  set offer_count = v_count,
      featured_offer_id = v_best.id,
      min_price_minor = v_best.price_minor,
      list_price_minor = v_best.list_price_minor,
      in_stock = coalesce(v_best.buyable, false),
      fulfilled_by_platform = coalesce(v_best.fulfillment = 'platform', false),
      best_handling_days = v_best.handling_days
  where id = p_product_id;
end;
$$;

-- A variant switched off or on changes what the listing offers.
create or replace function private.skus_summary_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.refresh_product_summary(new.product_id);
  return null;
end;
$$;

create trigger skus_summary_refresh after update of active on public.skus
  for each row when (new.active is distinct from old.active)
  execute function private.skus_summary_trigger();

-- The body of get_product (082800_lockdown.sql, moved behind its gate by
-- 083000_limits.sql), with two changes: each offer names its shop's logo,
-- and a variant's offers come in the order of the rule above (they came by
-- price alone, so an offer without stock could be listed first).
create or replace function private.get_product_page(p_slug text, p_postal_code text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select private.is_staff() as staff,
           coalesce(array(select private.my_seller_ids()), '{}'::uuid[]) as sellers
  )
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'title', p.title,
    'description', p.description,
    'bullet_points', to_jsonb(p.bullet_points),
    'brand', b.name,
    'made_in_cr', p.made_in_cr,
    'warranty_months', p.warranty_months,
    'tax_rate_bps', p.tax_rate_bps,
    'rating_sum', p.rating_sum,
    'rating_count', p.rating_count,
    'rating_histogram', (
      select coalesce(jsonb_object_agg(stars::text, n), '{}'::jsonb)
      from (
        select s.stars, (select count(*) from public.reviews r
                         where r.product_id = p.id and r.status = 'published' and r.rating = s.stars) as n
        from generate_series(1, 5) as s (stars)
      ) h),
    'category', jsonb_build_object('slug', cat.slug, 'name_es', cat.name_es, 'name_en', cat.name_en),
    'breadcrumbs', (
      with recursive up as (
        select c.id, c.parent_id, c.slug, c.name_es, c.name_en, 0 as depth
        from public.categories c where c.id = p.category_id and (c.active or v.staff)
        union all
        select c.id, c.parent_id, c.slug, c.name_es, c.name_en, up.depth + 1
        from public.categories c join up on c.id = up.parent_id
        where c.active or v.staff
      )
      select jsonb_agg(jsonb_build_object('slug', slug, 'name_es', name_es, 'name_en', name_en)
                       order by depth desc)
      from up),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('path', i.path, 'alt', i.alt) order by i.sort, i.id)
      from public.product_images i where i.product_id = p.id), '[]'::jsonb),
    'zone', (
      select jsonb_build_object(
        'id', e.zone_id, 'active', e.zone_active, 'shipping_fee_minor', e.shipping_fee_minor,
        'free_shipping_threshold_minor', e.free_shipping_threshold_minor,
        'cod_available', e.cod_available)
      from public.delivery_estimate(p_postal_code, 0) e),
    'skus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id,
        'code', k.code,
        'variant_name', k.variant_name,
        'offers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'offer_id', o.id,
            'seller', jsonb_build_object(
              'slug', s.slug, 'trade_name', s.trade_name, 'score', s.score, 'health', s.health,
              'logo', s.logo_path),
            'price_minor', o.price_minor,
            'list_price_minor', o.list_price_minor,
            'condition', o.condition,
            'fulfillment', o.fulfillment,
            'handling_days', o.handling_days,
            -- Exact stock is the seller's business; the page needs "in stock" and "few left".
            'available', least(o.available_quantity, 10),
            'listed_at', o.created_at,
            'promise', (
              select jsonb_build_object('earliest', e.earliest, 'latest', e.latest)
              from public.delivery_estimate(p_postal_code, o.handling_days) e
              where e.zone_active)
          )
          -- BEGIN offer_order
          order by (o.available_quantity > 0) desc, o.price_minor asc, o.created_at asc, o.id asc
          -- END offer_order
          )
          from public.offers o
          join public.sellers s on s.id = o.seller_id
          where o.sku_id = k.id and o.status = 'active' and s.status = 'active'), '[]'::jsonb)
      ) order by k.variant_name, k.code)
      from public.skus k where k.product_id = p.id and k.active), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(row_to_json(rv) order by rv.created_at desc)
      from (
        select r.id, r.rating, r.title, r.body, r.created_at, r.seller_reply,
               public.reviewer_display_name(r.user_id) as author
        from public.reviews r
        where r.product_id = p.id and r.status = 'published'
        order by r.created_at desc limit 20
      ) rv), '[]'::jsonb),
    'related', coalesce((
      select jsonb_agg(row_to_json(rel))
      from (
        select q.slug, q.title, q.min_price_minor, q.list_price_minor, q.in_stock,
               q.rating_sum, q.rating_count, q.fulfilled_by_platform,
               (select i.path from public.product_images i
                where i.product_id = q.id order by i.sort, i.id limit 1) as image_path,
               coalesce(pr.kind, 'similar') as kind
        from public.products q
        left join public.product_relations pr on pr.product_id = p.id and pr.related_id = q.id
        where q.status = 'active' and q.id <> p.id and q.min_price_minor is not null
          and (pr.product_id is not null or q.category_id = p.category_id
               or q.category_id in (
                 select c2.id from public.categories c1
                 join public.categories c2 on c2.parent_id = c1.parent_id
                 where c1.id = p.category_id
                   and (c1.active or v.staff) and (c2.active or v.staff)))
        order by (pr.product_id is not null) desc, pr.score desc nulls last,
                 q.units_sold_30d desc, q.id
        limit 8
      ) rel), '[]'::jsonb)
  )
  from viewer v
  join public.products p
    on p.slug = p_slug
   and (p.status = 'active' or v.staff or p.created_by_seller_id = any (v.sellers))
  join public.categories cat on cat.id = p.category_id and (cat.active or v.staff)
  left join public.brands b on b.id = p.brand_id;
$$;

revoke all on function private.get_product_page(text, text) from public, anon, authenticated;

-- ═══ 2. An offer on an existing product ════════════════════════════════════

insert into public.app_settings (key, value, description) values
  ('max_new_offers_per_day_per_seller', '30',
   'Offers one shop may add (or put back) on other shops'' published products in 24 hours. They need no review, so this bounds what a shop can put in front of shoppers in one day.')
on conflict (key) do nothing;

-- Each offer a shop added on another shop's product, for the daily cap.
create table private.offer_additions (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.sellers (id) on delete cascade,
  offer_id uuid not null references public.offers (id) on delete cascade,
  added_by uuid references auth.users (id),
  added_at timestamptz not null default now()
);
create index offer_additions_seller_idx on private.offer_additions (seller_id, added_at desc);
alter table private.offer_additions enable row level security;
revoke all on private.offer_additions from public, anon, authenticated;

-- The shop may sell on other shops' listings: verified and active.
create or replace function private.require_verified_shop(p_seller_id uuid) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_trading_shop(p_seller_id);
  if not exists (select 1 from public.seller_private sp
                 where sp.seller_id = p_seller_id and sp.kyc_status = 'verified') then
    perform private.fail('shop_not_approved');
  end if;
end;
$$;

-- Barcodes as people type them: digits only.
create or replace function private.barcode_digits(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_text, ''), '[\s.-]', '', 'g'), '');
$$;

-- The search function below pins `pg_trgm.word_similarity_threshold`; on a
-- hosted database that is allowed only once pg_trgm's library is loaded in
-- the session (see 082800_lockdown.sql).
select extensions.word_similarity('a', 'a');

-- The published catalogue as a seller searches it to sell an existing
-- product: by name, by brand, or by a variant's barcode (8 to 14 digits).
-- Only products a shopper can open, at most 20, best matches first. For each
-- variant: whether this shop already offers it, how many shops do, and the
-- price shown first now.
create or replace function public.seller_catalog_search(
  p_seller_id uuid,
  p_query text,
  p_limit integer default 20
) returns jsonb
language plpgsql stable security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.55
as $$
declare
  v_text text := private.bounded_search_text(p_query);
  v_folded text;
  v_barcode text;
  v_tsquery tsquery;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform private.require_verified_shop(p_seller_id);

  v_folded := nullif(trim(private.fold(coalesce(v_text, ''))), '');
  if v_folded is null or char_length(v_folded) < 2 then
    return '[]'::jsonb;
  end if;
  v_barcode := private.barcode_digits(v_text);
  if v_barcode !~ '^[0-9]{8,14}$' then
    v_barcode := null;
  end if;
  v_tsquery := websearch_to_tsquery('public.es', v_folded);

  return coalesce((
    select jsonb_agg(x.item order by x.rank desc, x.title, x.id)
    from (
      select p.id, p.title,
        (case when v_barcode is not null and exists (
                select 1 from public.skus g where g.product_id = p.id and g.active and g.gtin = v_barcode)
              then 3 else 0 end
         + case when p.title_folded like private.like_escape(v_folded) || '%' then 1 else 0 end
         + coalesce(ts_rank_cd(p.search_vector, v_tsquery, 32), 0)
         + coalesce(extensions.word_similarity(v_folded, p.title_folded), 0))::double precision as rank,
        jsonb_build_object(
          'product_id', p.id,
          'slug', p.slug,
          'title', p.title,
          'brand', b.name,
          'category_name', c.name_es,
          'image_path', (select i.path from public.product_images i
                         where i.product_id = p.id order by i.sort, i.id limit 1),
          'shop_name', cs.trade_name,
          'own_listing', p.created_by_seller_id = p_seller_id,
          'variants', coalesce((
            select jsonb_agg(jsonb_build_object(
              'sku_id', k.id,
              'sku_code', k.code,
              'variant_name', k.variant_name,
              'gtin', k.gtin,
              'my_offer_id', mine.id,
              'my_offer_status', mine.status,
              'offer_count', (select count(*) from public.offers o2
                              join public.sellers s2 on s2.id = o2.seller_id
                              where o2.sku_id = k.id and o2.status = 'active' and s2.status = 'active'),
              'lowest_price_minor', (select min(o3.price_minor) from public.offers o3
                                     join public.sellers s3 on s3.id = o3.seller_id
                                     where o3.sku_id = k.id and o3.status = 'active'
                                       and s3.status = 'active' and o3.available_quantity > 0),
              'weight_grams', k.weight_grams,
              'fits_warehouse', private.fits_warehouse(k.weight_grams, k.length_cm, k.width_cm, k.height_cm)
            ) order by k.variant_name, k.code)
            from public.skus k
            left join lateral (
              select o.id, o.status from public.offers o
              where o.sku_id = k.id and o.seller_id = p_seller_id and o.condition = 'new'
            ) mine on true
            where k.product_id = p.id and k.active), '[]'::jsonb)
        ) as item
      from public.products p
      join public.categories c on c.id = p.category_id and c.active
      left join public.brands b on b.id = p.brand_id
      left join public.sellers cs on cs.id = p.created_by_seller_id
      where p.status = 'active'
        and private.product_page_open(p.id)
        and exists (select 1 from public.skus k0 where k0.product_id = p.id and k0.active)
        and (p.search_vector @@ v_tsquery
             or v_folded operator(extensions.<%) p.title_folded
             or (b.name is not null and private.fold(b.name) like private.like_escape(v_folded) || '%')
             or (v_barcode is not null and exists (
                   select 1 from public.skus g where g.product_id = p.id and g.active and g.gtin = v_barcode)))
      order by rank desc, p.title, p.id
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Adds this shop's offer to a variant of a product another shop created. The
-- product page, search and the cart then list it next to the others; stock
-- arrives as for any offer (seller_set_stock at the shop's own place, or an
-- inbound shipment to a Yuntera warehouse). An offer the shop archived on the
-- same variant is put back instead of a second one being made.
create or replace function public.seller_add_offer(
  p_seller_id uuid,
  p_sku_id uuid,
  p_price_minor bigint,
  p_fulfillment public.fulfillment_type,
  p_handling_days smallint default null,
  p_list_price_minor bigint default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max_price_minor constant bigint := 10000000000; -- ₡100 000 000, as for a new listing
  v_product public.products%rowtype;
  v_sku public.skus%rowtype;
  v_existing public.offers%rowtype;
  v_offer uuid;
  v_back boolean := false;
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  -- One addition at a time per shop, so the daily count holds.
  perform 1 from public.sellers where id = p_seller_id for update;
  perform private.require_verified_shop(p_seller_id);

  select * into v_sku from public.skus where id = p_sku_id;
  if not found then
    perform private.fail('variant_not_found');
  end if;
  -- The listing's row: a variant switched off, a listing taken back to draft
  -- or archived at this moment waits for this, or this waits for it.
  select * into v_product from public.products where id = v_sku.product_id for update;
  if v_product.status <> 'active' or not v_sku.active
     or not exists (select 1 from public.categories c where c.id = v_product.category_id and c.active)
     or not private.product_page_open(v_product.id) then
    perform private.fail('variant_not_found');
  end if;
  if v_product.created_by_seller_id = p_seller_id then
    -- Its own listing: its offers are already there, changed from the list of products.
    perform private.fail('own_listing');
  end if;

  if p_price_minor is null or p_price_minor <= 0 or p_price_minor > c_max_price_minor
     or p_fulfillment is null
     or (p_list_price_minor is not null and p_list_price_minor <= p_price_minor) then
    perform private.fail('invalid_offer');
  end if;
  if p_fulfillment = 'seller' and (p_handling_days is null or p_handling_days not between 0 and 10) then
    perform private.fail('invalid_handling_days');
  end if;
  if p_fulfillment = 'platform'
     and not private.fits_warehouse(v_sku.weight_grams, v_sku.length_cm, v_sku.width_cm, v_sku.height_cm) then
    perform private.fail('too_large_for_warehouse');
  end if;

  select * into v_existing from public.offers
  where sku_id = v_sku.id and seller_id = p_seller_id and condition = 'new'
  for update;
  if found and v_existing.status <> 'archived' then
    perform private.fail('offer_exists');
  end if;

  if (select count(*) from private.offer_additions a
      where a.seller_id = p_seller_id and a.added_at > now() - interval '1 day')
     >= private.limit_value('max_new_offers_per_day_per_seller', 30) then
    perform private.fail('too_many_new_offers');
  end if;

  begin
    if v_existing.id is not null then
      update public.offers
      set price_minor = p_price_minor, list_price_minor = p_list_price_minor,
          fulfillment = p_fulfillment,
          handling_days = case when p_fulfillment = 'platform' then 0 else p_handling_days end,
          status = 'active'
      where id = v_existing.id;
      v_offer := v_existing.id;
      v_back := true;
    else
      insert into public.offers (sku_id, seller_id, price_minor, list_price_minor, fulfillment, handling_days)
      values (v_sku.id, p_seller_id, p_price_minor, p_list_price_minor, p_fulfillment,
              case when p_fulfillment = 'platform' then 0 else p_handling_days end)
      returning id into v_offer;
    end if;
  exception
    when check_violation or not_null_violation or numeric_value_out_of_range then
      perform private.fail('invalid_offer');
  end;

  insert into private.offer_additions (seller_id, offer_id, added_by)
  values (p_seller_id, v_offer, (select auth.uid()));
  perform private.emit('offer.added', jsonb_build_object(
    'offer_id', v_offer, 'seller_id', p_seller_id, 'product_id', v_product.id, 'sku_id', v_sku.id));

  return jsonb_build_object('offer_id', v_offer, 'product_id', v_product.id, 'slug', v_product.slug,
                            'sku_id', v_sku.id, 'outcome', case when v_back then 'resumed' else 'added' end);
end;
$$;

-- ═══ 3. Who edits a shared product ══════════════════════════════════════════

-- Replaces the version in the fixes migration: "shared" now means a live
-- offer of another shop that may trade (see private.listing_shared), and each
-- variant says whether it is switched on, whether another shop offers it and
-- the state of this shop's own offer on it. The rest is unchanged.
create or replace function public.seller_listing(p_product_id uuid, p_sku_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_sku uuid;
begin
  select * into p from public.products where id = p_product_id;
  -- The same answer for a listing that does not exist and one that belongs to someone else.
  if not found or p.created_by_seller_id is null
     or not (private.is_seller_member(p.created_by_seller_id) or private.has_staff_role('catalog')) then
    perform private.fail('listing_not_found');
  end if;

  select k.id into v_sku from public.skus k
  where k.product_id = p.id and (p_sku_id is null or k.id = p_sku_id)
  order by k.created_at, k.id limit 1;
  if v_sku is null then
    perform private.fail('listing_not_found');
  end if;

  return jsonb_build_object(
    'product_id', p.id,
    'slug', p.slug,
    'seller_id', p.created_by_seller_id,
    'status', p.status,
    'rejection_reason', p.rejection_reason,
    'content', private.listing_content(p.id, v_sku),
    'variants', (
      select jsonb_agg(jsonb_build_object(
               'sku_id', k.id, 'sku_code', k.code, 'variant_name', k.variant_name,
               'active', k.active,
               'shared', private.variant_shared(k.id),
               'own_offer_status', (select o.status from public.offers o
                                    where o.sku_id = k.id and o.seller_id = p.created_by_seller_id
                                    order by (o.condition = 'new') desc, o.created_at limit 1))
             order by k.created_at, k.id)
      from public.skus k where k.product_id = p.id),
    'pending', (
      select jsonb_build_object('request_id', r.id, 'submitted_at', r.submitted_at, 'proposed', r.proposed)
      from public.product_change_requests r
      where r.product_id = p.id and r.status = 'pending'),
    -- The latest proposal, when it was refused and nothing newer replaced it.
    'last_rejection', (
      select jsonb_build_object('decided_at', r.decided_at, 'reason', r.decision_reason, 'proposed', r.proposed)
      from (
        select r2.* from public.product_change_requests r2
        where r2.product_id = p.id order by r2.submitted_at desc, r2.id desc limit 1
      ) r
      where r.status = 'rejected'),
    -- Another shop also sells from this page: it cannot be taken away from it.
    'shared', private.listing_shared(p.id),
    -- How many other shops sell from it now, for the page to say so.
    'other_shops', (
      select count(distinct o.seller_id) from public.offers o
      join public.skus k on k.id = o.sku_id
      join public.sellers s on s.id = o.seller_id
      where k.product_id = p.id and o.seller_id <> p.created_by_seller_id
        and o.status <> 'archived' and s.status = 'active')
  );
end;
$$;

-- Replaces the version in the fixes migration, with "shared" as above.
create or replace function public.seller_archive_listing(p_product_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
begin
  select * into p from public.products where id = p_product_id for update;
  if not found or p.created_by_seller_id is null
     or not private.is_seller_member(p.created_by_seller_id) then
    perform private.fail('listing_not_found');
  end if;
  if p.status = 'archived' then
    return false; -- already done; safe to call twice
  end if;
  -- The page is shared: another shop sells from it. This shop can pause its
  -- own offer, but cannot take the page away from the other.
  if private.listing_shared(p.id) then
    perform private.fail('listing_shared');
  end if;

  update public.product_change_requests
  set status = 'withdrawn', decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where product_id = p.id and status = 'pending';

  update public.products set status = 'archived' where id = p.id;

  perform private.emit('product.archived', jsonb_build_object('product_id', p.id));
  return true;
end;
$$;

-- A shop that closes cannot edit anything any more. Each of its published
-- listings that another shop still sells passes to the shop with the oldest
-- live offer on it, which from then on edits it through the same reviews;
-- what the closing shop had waiting for review on it is withdrawn. A listing
-- nobody else sells stays with the closed shop and is shown nowhere. Also,
-- whatever path closes the shop: its logo and description leave the shop
-- (they may describe the person behind it), and a logo waiting for review
-- goes out of the queue.
create or replace function private.sellers_hand_over_on_close() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select p.id as product_id,
           (select o.seller_id from public.offers o
            join public.skus k on k.id = o.sku_id
            join public.sellers s on s.id = o.seller_id
            where k.product_id = p.id and o.seller_id <> new.id
              and o.status <> 'archived' and s.status = 'active'
            order by o.created_at, o.id limit 1) as heir
    from public.products p
    where p.created_by_seller_id = new.id and p.status = 'active'
    order by p.id
    for update of p
  loop
    continue when r.heir is null;
    update public.product_change_requests
    set status = 'withdrawn', decided_at = clock_timestamp()
    where product_id = r.product_id and status = 'pending';
    -- Photos it added that nobody approved yet do not pass to the new shop.
    update public.product_photos
    set state = 'removed', remove_requested_at = null
    where product_id = r.product_id and seller_id = new.id and state in ('uploading', 'pending');
    update public.product_photos
    set remove_requested_at = null, position = live_position, alt = live_alt
    where product_id = r.product_id and state = 'approved' and live_position is not null;
    update public.products set created_by_seller_id = r.heir where id = r.product_id;
    perform private.emit('product.handed_over', jsonb_build_object(
      'product_id', r.product_id, 'from_seller_id', new.id, 'to_seller_id', r.heir));
  end loop;

  update public.shop_logos
  set state = 'removed', decided_at = coalesce(decided_at, clock_timestamp())
  where seller_id = new.id and state in ('uploading', 'pending', 'approved');
  update public.sellers set logo_path = null, description = null
  where id = new.id and (logo_path is not null or description is not null);
  return null;
end;
$$;

-- ═══ 4. Variants on and off; a listing back to draft ════════════════════════

-- The listing (locked) whose variants or status the caller, a member of the
-- shop that created it, changes.
create or replace function private.own_listing(p_product_id uuid) returns public.products
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  select * into p from public.products where id = p_product_id for update;
  if not found or p.created_by_seller_id is null
     or not private.is_seller_member(p.created_by_seller_id) then
    perform private.fail('listing_not_found');
  end if;
  return p;
end;
$$;

-- Switches a variant of the shop's own listing off (no new orders: shoppers
-- no longer see it, carts cannot buy it) or on again. Orders, reservations
-- and stock already there are untouched. If another shop sells that variant,
-- the variant stays for it and only this shop's own offer on it is paused;
-- switching it on again then puts that offer back on sale. The last variant
-- on sale is not switched off: take the listing back to draft or archive it.
create or replace function public.seller_set_variant_active(p_sku_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  p public.products;
  k public.skus%rowtype;
  v_outcome text;
  v_offer uuid;
begin
  select product_id into v_product_id from public.skus where id = p_sku_id;
  if v_product_id is null then
    perform private.fail('listing_not_found');
  end if;
  p := private.own_listing(v_product_id);
  select * into k from public.skus where id = p_sku_id for update;
  if p_active is null then
    perform private.fail('invalid_variant_state');
  end if;
  if p.status = 'archived' then
    perform private.fail('listing_not_editable');
  end if;
  if p_active then
    perform private.require_trading_shop(p.created_by_seller_id);
  else
    perform private.require_open_shop(p.created_by_seller_id);
  end if;

  if not p_active then
    if not k.active then
      v_outcome := 'unchanged';
    elsif private.variant_shared(k.id) then
      update public.offers set status = 'paused'
      where sku_id = k.id and seller_id = p.created_by_seller_id and status = 'active';
      v_outcome := 'offer_paused';
    elsif not exists (select 1 from public.skus x
                      where x.product_id = p.id and x.id <> k.id and x.active) then
      perform private.fail('last_variant');
    else
      update public.skus set active = false where id = k.id;
      v_outcome := 'variant_off';
    end if;
  else
    if not k.active then
      update public.skus set active = true where id = k.id;
      v_outcome := 'variant_on';
    else
      -- On already: put back on sale this shop's paused offers on it. The
      -- price floor checks each, so an offer a fee change left too cheap
      -- says so instead of going back on sale.
      v_outcome := 'unchanged';
      for v_offer in
        select o.id from public.offers o
        where o.sku_id = k.id and o.seller_id = p.created_by_seller_id and o.status = 'paused'
        order by o.id
      loop
        update public.offers set status = 'active' where id = v_offer;
        v_outcome := 'offer_resumed';
      end loop;
    end if;
  end if;

  if v_outcome <> 'unchanged' then
    perform private.emit('product.variant_changed', jsonb_build_object(
      'product_id', p.id, 'sku_id', k.id, 'outcome', v_outcome));
  end if;
  return jsonb_build_object('product_id', p.id, 'slug', p.slug, 'sku_id', k.id, 'outcome', v_outcome);
end;
$$;

-- Takes a published listing back to draft so its shop can rework it. The
-- shop and search stop showing it at once, carts treat it as they treat an
-- archived listing (it cannot be bought), and open orders go on as they were.
-- Not while another shop sells from it: its page is not this shop's alone. A
-- change waiting for review is withdrawn (the draft is now edited in place).
-- It goes back on sale only through the review of a new listing.
create or replace function public.seller_unpublish_listing(p_product_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products;
  v_shop public.seller_status;
  v_withdrawn integer;
begin
  p := private.own_listing(p_product_id);
  select status into v_shop from public.sellers where id = p.created_by_seller_id for update;
  if v_shop = 'closed' then
    perform private.fail('shop_not_active');
  end if;
  if p.status <> 'active' then
    perform private.fail('listing_not_published');
  end if;
  if private.listing_shared(p.id) then
    perform private.fail('listing_shared');
  end if;
  if (select count(*) from public.products x
      where x.created_by_seller_id = p.created_by_seller_id and x.status = 'draft')
     >= private.limit_value('max_draft_listings_per_seller', 200) then
    perform private.fail('too_many_draft_listings');
  end if;

  update public.product_change_requests
  set status = 'withdrawn', decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where product_id = p.id and status = 'pending';
  get diagnostics v_withdrawn = row_count;

  update public.products set status = 'draft', rejection_reason = null where id = p.id;
  perform private.emit('product.unpublished', jsonb_build_object('product_id', p.id));
  return jsonb_build_object('product_id', p.id, 'slug', p.slug, 'status', 'draft',
                            'edit_withdrawn', v_withdrawn > 0);
end;
$$;

-- ═══ 5. A listing edit that leaves another shop's offer below the floor ════

alter table private.fee_floor_breaches
  add column reason text not null default 'fee_change'
    check (reason in ('fee_change', 'listing_edit'));

-- Replaces the version in the fixes migration. What changed: an approved edit
-- of a shared listing's package or category can make a sale of another
-- shop's offer cost more in fees than it pays. That shop did not ask for the
-- edit, so its offer is paused (as a fee change pauses it) and listed for it
-- with the reason, instead of the creating shop's edit being refused for a
-- price it does not control. The creating shop's own offers are checked as
-- before: its edit is refused while its own price would fall below the floor.
create or replace function public.ops_review_listing_edit(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.product_change_requests%rowtype;
  p public.products%rowtype;
  v_category public.categories%rowtype;
  v_sku uuid;
  v_version text;
  o record;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if not p_approve and coalesce(char_length(trim(p_reason)), 0) < 5 then
    -- The seller is owed an explanation they can act on.
    perform private.fail('reason_required');
  end if;

  select * into r from public.product_change_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    -- Already decided, withdrawn, or replaced by a newer proposal.
    perform private.fail('edit_not_found');
  end if;

  if not p_approve then
    update public.product_change_requests
    set status = 'rejected', decision_reason = trim(p_reason),
        decided_by = (select auth.uid()), decided_at = clock_timestamp()
    where id = r.id;
  else
    select * into p from public.products where id = r.product_id for update;
    if p.status <> 'active' then
      -- Taken down since the seller proposed this; there is no published page to change.
      perform private.fail('listing_not_editable');
    end if;
    select * into v_category from public.categories
    where slug = r.proposed ->> 'category_slug' and active;
    if not found then
      perform private.fail('category_not_found');
    end if;
    v_sku := (r.proposed ->> 'sku_id')::uuid;

    -- Other shops' offers the new package or category would leave below the floor.
    select version into v_version from public.fee_schedules where active;
    for o in
      select x.id, x.seller_id, x.price_minor, x.fulfillment,
             case when k.id = v_sku then (r.proposed ->> 'weight_grams')::integer else k.weight_grams end as weight,
             case when k.id = v_sku
                  then greatest((r.proposed ->> 'length_cm')::numeric, (r.proposed ->> 'width_cm')::numeric,
                                (r.proposed ->> 'height_cm')::numeric)
                  else greatest(k.length_cm, k.width_cm, k.height_cm) end as longest
      from public.offers x
      join public.skus k on k.id = x.sku_id
      where k.product_id = p.id and x.status = 'active' and x.seller_id <> p.created_by_seller_id
      order by x.id
      for update of x
    loop
      if v_version is not null
         and private.worst_unit_payout(o.price_minor, o.fulfillment, v_category.id, o.weight, o.longest) < 0 then
        update public.offers set status = 'paused' where id = o.id;
        insert into private.fee_floor_breaches
          (schedule_version, offer_id, seller_id, price_minor, min_price_minor, reason)
        values (v_version, o.id, o.seller_id, o.price_minor,
                private.min_price_covering_fees(o.fulfillment, v_category.id, o.weight, o.longest),
                'listing_edit')
        on conflict (schedule_version, offer_id) do update
          set price_minor = excluded.price_minor, min_price_minor = excluded.min_price_minor,
              reason = excluded.reason, paused_at = now();
      end if;
    end loop;

    update public.product_change_requests
    set status = 'approved', replaced = private.listing_content(p.id, v_sku),
        decided_by = (select auth.uid()), decided_at = clock_timestamp()
    where id = r.id;

    update public.products
    set title = r.proposed ->> 'title',
        description = r.proposed ->> 'description',
        bullet_points = array(select jsonb_array_elements_text(r.proposed -> 'bullet_points')),
        category_id = v_category.id,
        tax_rate_bps = case when category_id is distinct from v_category.id
                            then v_category.default_tax_rate_bps else tax_rate_bps end
    where id = p.id;

    update public.skus
    set weight_grams = (r.proposed ->> 'weight_grams')::integer,
        length_cm = (r.proposed ->> 'length_cm')::numeric,
        width_cm = (r.proposed ->> 'width_cm')::numeric,
        height_cm = (r.proposed ->> 'height_cm')::numeric
    where id = v_sku and product_id = p.id;
  end if;

  perform private.emit('product.edit_reviewed',
    jsonb_build_object('product_id', r.product_id, 'request_id', r.id, 'approved', p_approve));
end;
$$;

-- ═══ 6. Offers paused below the price floor, for their seller ═════════════

-- This shop's offers that are paused because their price no longer covers
-- the fees: after a fee change, or after an approved edit of the listing's
-- package or category. Each with the lowest price that would cover them
-- (rounded up to whole colones; null when no price does), and the reason.
-- Putting the offer back on sale at such a price is seller_update_offer.
create or replace function public.seller_paused_offers(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.row order by x.paused_at, x.id)
    from (
      select b.id, b.paused_at, jsonb_build_object(
        'offer_id', o.id,
        'product_id', p.id,
        'slug', p.slug,
        'title', p.title,
        'product_status', p.status,
        'variant_name', k.variant_name,
        'sku_code', k.code,
        'image_path', (select i.path from public.product_images i
                       where i.product_id = p.id order by i.sort, i.id limit 1),
        'fulfillment', o.fulfillment,
        'handling_days', o.handling_days,
        'price_minor', o.price_minor,
        'list_price_minor', o.list_price_minor,
        'min_price_minor', case when b.min_price_minor is null then null
                                else ((b.min_price_minor + 99) / 100) * 100 end,
        'reason', b.reason,
        'schedule_version', b.schedule_version,
        'paused_at', b.paused_at) as row
      from private.fee_floor_breaches b
      join public.offers o on o.id = b.offer_id
      join public.skus k on k.id = o.sku_id
      join public.products p on p.id = k.product_id
      where b.seller_id = p_seller_id and o.seller_id = p_seller_id and o.status = 'paused'
        and b.id = (select max(b2.id) from private.fee_floor_breaches b2 where b2.offer_id = b.offer_id)
      order by b.paused_at, b.id
      limit 200) x), '[]'::jsonb);
end;
$$;

-- ═══ 7. The shop's description ══════════════════════════════════════════════

alter table public.seller_change_requests drop constraint seller_change_requests_kind_check;
alter table public.seller_change_requests add constraint seller_change_requests_kind_check
  check (kind in ('shop_name', 'fiscal', 'contact', 'description'));

-- Replaces the version in the limits migration: operations also decide a
-- description, as they decide a name (both are what shoppers read).
create or replace function private.may_decide_shop_change(p_kind text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'contact' then private.has_staff_role('finance')
    when 'shop_name' then private.has_staff_role('ops')
    when 'fiscal' then private.has_staff_role('ops')
    when 'description' then private.has_staff_role('ops')
    else false
  end;
$$;

-- Replaces the version in the limits migration, with the description.
create or replace function private.shop_details(p_seller_id uuid, p_kind text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'shop_name' then jsonb_build_object('trade_name', s.trade_name)
    when 'fiscal' then jsonb_build_object(
      'tax_regime', sp.tax_regime, 'fiscal_address', sp.fiscal_address,
      'postal_code', sp.postal_code, 'economic_activity_code', sp.economic_activity_code)
    when 'contact' then jsonb_build_object(
      'contact_email', sp.contact_email, 'contact_phone', sp.contact_phone)
    when 'description' then jsonb_build_object('description', s.description)
  end
  from public.sellers s join public.seller_private sp on sp.seller_id = s.id
  where s.id = p_seller_id;
$$;

-- A description as it is stored: line breaks kept (at most one empty line in
-- a row), other control characters dropped, runs of spaces collapsed, trimmed;
-- null when nothing is left. packages/core normaliseShopDescription is the same.
create or replace function private.clean_description(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select nullif(trim(regexp_replace(
           array_to_string(array(
             select trim(regexp_replace(line, '\s+', ' ', 'g'))
             from unnest(string_to_array(
               regexp_replace(replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\r', E'\n'),
                              '[\x01-\x09\x0b-\x1f\x7f]', '', 'g'), E'\n'))
               with ordinality as t (line, n)
             order by n), E'\n'),
           E'\n{3,}', E'\n\n', 'g'), E' \n'), '');
$$;

-- The shop's owner or an administrator asks to change the description
-- shoppers read on the shop's page. Operations approve it as they approve a
-- name. Shown as plain text everywhere: markup in it is never rendered. An
-- empty text asks to remove the description. A newer request replaces one
-- still waiting.
create or replace function public.seller_request_shop_description(p_seller_id uuid, p_description text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max constant integer := 1000;
  v_text text := private.clean_description(p_description);
  v_proposed jsonb;
  v_id uuid;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform 1 from public.seller_private where seller_id = p_seller_id for update;
  if not exists (select 1 from public.sellers s where s.id = p_seller_id and s.status <> 'closed') then
    perform private.fail('shop_not_active');
  end if;
  if char_length(coalesce(p_description, '')) > 4 * c_max or char_length(v_text) > c_max then
    perform private.fail('invalid_shop_description');
  end if;

  v_proposed := jsonb_build_object('description', v_text);
  if v_proposed = private.shop_details(p_seller_id, 'description') then
    perform private.fail('shop_change_unchanged');
  end if;

  update public.seller_change_requests
  set status = 'replaced', decided_at = now()
  where seller_id = p_seller_id and kind = 'description' and status = 'pending';

  insert into public.seller_change_requests (seller_id, kind, proposed, previous, requested_by)
  values (p_seller_id, 'description', v_proposed, private.shop_details(p_seller_id, 'description'),
          (select auth.uid()))
  returning id into v_id;

  perform private.emit('seller.change_requested',
    jsonb_build_object('seller_id', p_seller_id, 'request_id', v_id, 'kind', 'description'));
  return v_id;
end;
$$;

-- Replaces the version in the limits migration: what is on file now also
-- carries the description, for the form to start from. Unchanged otherwise.
create or replace function public.seller_shop_changes(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'can_request', private.is_seller_admin(p_seller_id)
                   and exists (select 1 from public.sellers s where s.id = p_seller_id and s.status <> 'closed'),
    'payout_request_open', exists (select 1 from public.payout_detail_requests r
                                   where r.seller_id = p_seller_id and r.status = 'pending'),
    'current', case when private.is_seller_admin(p_seller_id) then jsonb_build_object(
      'fiscal', private.shop_details(p_seller_id, 'fiscal'),
      'contact', private.shop_details(p_seller_id, 'contact'),
      'description', private.shop_details(p_seller_id, 'description')) end,
    'requests', coalesce((
      select jsonb_agg(private.shop_change_item(x.request) order by x.kind)
      from (
        select distinct on (r.kind) r.kind, r as request
        from public.seller_change_requests r
        where r.seller_id = p_seller_id and r.status not in ('replaced', 'withdrawn')
        order by r.kind, r.requested_at desc
      ) x), '[]'::jsonb)
  );
end;
$$;

-- Replaces the version in the limits migration: approving a description
-- writes it on the shop. Unchanged otherwise.
create or replace function public.ops_decide_shop_change(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.seller_change_requests%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.has_staff_role('ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  select * into r from public.seller_change_requests where id = p_request_id for update;
  if not found or not private.may_decide_shop_change(r.kind) then
    perform private.fail('shop_change_not_found');
  end if;
  if r.status <> 'pending' then
    perform private.fail('shop_change_not_pending');
  end if;
  if r.requested_by = (select auth.uid()) then
    perform private.fail('cannot_decide_own_request');
  end if;
  if private.is_seller_member(r.seller_id) then
    perform private.fail('cannot_decide_own_shop');
  end if;
  if p_approve is null then
    perform private.fail('shop_change_not_pending');
  end if;
  if char_length(v_note) > 1000 then
    perform private.fail('note_too_long');
  end if;
  if not p_approve and coalesce(char_length(v_note), 0) < 10 then
    perform private.fail('reason_required');
  end if;

  -- The shop's row first: a payout-account request sent at the same moment
  -- waits for this decision, and this one sees it if it came first.
  perform 1 from public.seller_private where seller_id = r.seller_id for update;
  -- Finance confirms a payout-account change by calling the phone on file. A
  -- contact change approved while such a request waits would let whoever sent
  -- both answer that call: the payout request is decided first.
  if p_approve and r.kind = 'contact' and exists (
    select 1 from public.payout_detail_requests q
    where q.seller_id = r.seller_id and q.status = 'pending'
  ) then
    perform private.fail('contact_change_waits_for_payout');
  end if;

  if p_approve then
    if r.kind = 'shop_name' then
      perform private.check_shop_name(r.proposed ->> 'trade_name', r.seller_id);
      update public.sellers set trade_name = r.proposed ->> 'trade_name' where id = r.seller_id;
    elsif r.kind = 'fiscal' then
      -- Whoever approves has checked the new details against Hacienda's records.
      update public.seller_private
      set tax_regime = r.proposed ->> 'tax_regime',
          fiscal_address = r.proposed ->> 'fiscal_address',
          postal_code = r.proposed ->> 'postal_code',
          economic_activity_code = r.proposed ->> 'economic_activity_code',
          hacienda_verified_at = case when hacienda_verified_at is not null then now() end
      where seller_id = r.seller_id;
    elsif r.kind = 'description' then
      update public.sellers set description = r.proposed ->> 'description' where id = r.seller_id;
    else
      update public.seller_private
      set contact_email = r.proposed ->> 'contact_email',
          contact_phone = r.proposed ->> 'contact_phone'
      where seller_id = r.seller_id;
    end if;
  end if;

  update public.seller_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
  where id = r.id;

  perform private.emit('seller.change_decided', jsonb_build_object(
    'seller_id', r.seller_id, 'request_id', r.id, 'kind', r.kind, 'approved', p_approve));
end;
$$;

-- What shoppers read about a shop changes only by a staff decision (or the
-- shop closing): every change is in the audit trail, with who made it.
create trigger audit_sellers_front after update of description, logo_path on public.sellers
  for each row when ((new.description, new.logo_path) is distinct from (old.description, old.logo_path))
  execute function private.audit();

-- ═══ 8. The shop's logo ═════════════════════════════════════════════════════
--
-- Through the product-photo pipeline (082700): the seller's browser makes the
-- three sizes and uploads them to the private bucket under a reservation; the
-- shop's members and catalogue staff can read them there; staff approve or
-- reject; the console then writes the public sizes from the largest waiting
-- copy, the one staff looked at, and confirms; only then does the shop show
-- it. Paths are `<seller id>/logo/<logo id>/<size>.<ext>`, so a logo is never
-- taken for a listing's photo (packages/core/src/shop-logos.ts builds the same).
-- A shop has at most one logo waiting; a new one replaces it. The published
-- one stays until a new one is published or the shop removes it.

create table public.shop_logos (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  format text not null default 'jpeg' check (format in ('jpeg', 'png', 'webp')),
  --   uploading  reserved; its files are being uploaded
  --   pending    uploaded; waiting for catalogue staff
  --   approved   approved (shown once its files are published)
  --   rejected   refused by staff, with a reason
  --   removed    replaced, withdrawn, removed by the shop, abandoned, or the shop closed
  state text not null default 'uploading'
    check (state in ('uploading', 'pending', 'approved', 'rejected', 'removed')),
  width integer check (width between 1 and 1600),
  height integer check (height between 1 and 1600),
  bytes bigint,
  file_versions jsonb,
  published_at timestamptz,
  rejection_reason text check (char_length(rejection_reason) <= 1000),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz
);

create index shop_logos_seller_idx on public.shop_logos (seller_id, state, created_at desc);
create index shop_logos_waiting_idx on public.shop_logos (state)
  where state in ('uploading', 'pending') or (state = 'approved' and published_at is null);

create trigger shop_logos_updated_at before update on public.shop_logos
  for each row execute function private.set_updated_at();
-- Staff decisions on a logo, with who made them.
create trigger audit_shop_logos after update of state, published_at on public.shop_logos
  for each row when ((new.state, new.published_at) is distinct from (old.state, old.published_at))
  execute function private.audit();

alter table public.shop_logos enable row level security;
revoke all on public.shop_logos from public, anon, authenticated;

create trigger sellers_hand_over_on_close after update of status on public.sellers
  for each row when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function private.sellers_hand_over_on_close();

-- BEGIN logo_path
create or replace function private.logo_path(
  p_seller_id uuid, p_logo_id uuid, p_size integer, p_format text
) returns text
language sql immutable
set search_path = ''
as $$
  select p_seller_id::text || '/logo/' || p_logo_id::text || '/'
         || p_size::text || '.' || private.photo_extension(p_format);
$$;
-- END logo_path

create or replace function private.logo_template(p_seller_id uuid, p_logo_id uuid, p_format text)
returns text
language sql immutable
set search_path = ''
as $$
  select p_seller_id::text || '/logo/' || p_logo_id::text || '/{w}.' || private.photo_extension(p_format);
$$;

-- The logo a storage path belongs to, when the path is a well-formed logo path.
create or replace function private.logo_for_object(p_name text) returns public.shop_logos
language sql stable security definer
set search_path = ''
as $$
  select l.* from public.shop_logos l
  where split_part(p_name, '/', 2) = 'logo'
    and l.id = private.uuid_or_null(split_part(p_name, '/', 3))
    and l.seller_id = private.uuid_or_null(split_part(p_name, '/', 1))
    and p_name in (select private.logo_path(l.seller_id, l.id, s, l.format)
                   from unnest(private.photo_sizes()) s);
$$;

-- Do a logo's waiting files still hold what was there when it was finished?
create or replace function private.logo_files_intact(l public.shop_logos) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select l.file_versions is not null
     and not exists (
       select 1 from unnest(private.photo_sizes()) s
       where not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'product-photos-pending'
           and o.name = private.logo_path(l.seller_id, l.id, s, l.format)
           and private.object_fingerprint(o.version, o.metadata) = l.file_versions ->> s::text));
$$;

-- Is this logo file no longer needed? Anything of a removed or rejected logo
-- (also the public copies of one replaced: the shop shows the new one), the
-- waiting copies of a published one, and an abandoned upload.
create or replace function private.logo_object_disposable(p_bucket text, p_name text, p_created_at timestamptz)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  l public.shop_logos;
begin
  l := private.logo_for_object(p_name);
  if l.id is null then
    return p_created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes'));
  end if;
  if l.state in ('removed', 'rejected') then
    return true;
  end if;
  if p_bucket = 'product-photos-pending' then
    return (l.state = 'approved' and l.published_at is not null)
        or (l.state = 'uploading'
            and l.created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes')));
  end if;
  return false;
end;
$$;

-- The storage rules of 082700, each with a branch for logo paths first. The
-- product-photo part of each is unchanged.
create or replace function private.photo_object_insertable(p_bucket text, p_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
  l public.shop_logos;
begin
  -- Storage does not run the Data API's check_request, so the same checks
  -- (20261121082500_account_security.sql) are made here: an ended session or a
  -- deleted account, and a password-only session of an account with a second
  -- factor, can do nothing with these files.
  if not (private.session_alive() and private.factor_ok()) then
    return false;
  end if;
  if private.storage_upsert_requested() then
    return false;
  end if;
  if split_part(p_name, '/', 2) = 'logo' then
    l := private.logo_for_object(p_name);
    if l.id is null then
      return false;
    end if;
    if p_bucket = 'product-photos-pending' then
      -- The shop's own reservation, still open, by someone who may change the shop's face.
      return l.state = 'uploading'
         and l.created_at > now() - make_interval(mins => private.photo_rule('upload_window_minutes'))
         and private.is_seller_admin(l.seller_id);
    elsif p_bucket = 'product-photos' then
      return l.state = 'approved' and private.has_staff_role('catalog');
    end if;
    return false;
  end if;
  ph := private.photo_for_object(p_name);
  if ph.id is null then
    return false;
  end if;
  if p_bucket = 'product-photos-pending' then
    -- The shop's own reservation, still open.
    return ph.state = 'uploading'
       and ph.created_at > now() - make_interval(mins => private.photo_rule('upload_window_minutes'))
       and private.is_seller_member(ph.seller_id);
  elsif p_bucket = 'product-photos' then
    -- Promotion: catalogue staff, for a photo already approved.
    return ph.state = 'approved' and private.has_staff_role('catalog');
  end if;
  return false;
end;
$$;

create or replace function private.photo_object_disposable(
  p_bucket text, p_name text, p_created_at timestamptz
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
begin
  if p_bucket not in ('product-photos-pending', 'product-photos') then
    return false;
  end if;
  if split_part(p_name, '/', 2) = 'logo' then
    return private.logo_object_disposable(p_bucket, p_name, p_created_at);
  end if;
  ph := private.photo_for_object(p_name);
  if ph.id is null then
    -- No photo (or not a photo path at all). Give an upload in progress its window.
    return p_created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes'));
  end if;
  if p_bucket = 'product-photos' and ph.state = 'removed'
     and exists (select 1 from public.order_items i
                 where i.image_path = private.photo_template(ph.seller_id, ph.product_id, ph.id, ph.format)) then
    return false;
  end if;
  if ph.state in ('removed', 'rejected') then
    return true;
  end if;
  if p_bucket = 'product-photos-pending' then
    return (ph.state = 'approved' and ph.published_at is not null)
        or (ph.state = 'uploading'
            and ph.created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes')));
  end if;
  return false;
end;
$$;

create or replace function private.photo_object_readable(
  p_bucket text, p_name text, p_created_at timestamptz
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  ph public.product_photos;
  l public.shop_logos;
  v_operation text := private.storage_operation();
begin
  if p_bucket not in ('product-photos-pending', 'product-photos') then
    return false;
  end if;
  -- As for adding files: Storage does not run check_request.
  if not (private.session_alive() and private.factor_ok()) then
    return false;
  end if;
  if private.has_staff_role('catalog') then
    return true;
  end if;
  if p_bucket <> 'product-photos-pending'
     or not private.is_seller_member(private.uuid_or_null(split_part(p_name, '/', 1))) then
    return false;
  end if;
  if v_operation in ('object.delete', 'object.delete_many') then
    return private.photo_object_disposable(p_bucket, p_name, p_created_at);
  end if;
  if v_operation not in ('object.get_authenticated', 'object.get_authenticated_info',
                         'object.head_authenticated_info', 'object.info_authenticated') then
    return false;
  end if;
  if split_part(p_name, '/', 2) = 'logo' then
    l := private.logo_for_object(p_name);
    return l.id is not null
       and ((l.state = 'uploading'
             and l.created_at > now() - make_interval(mins => private.photo_rule('upload_window_minutes')))
            or l.state = 'pending'
            or (l.state = 'approved' and l.published_at is null));
  end if;
  ph := private.photo_for_object(p_name);
  return ph.id is not null
     and ((ph.state = 'uploading'
           and ph.created_at > now() - make_interval(mins => private.photo_rule('upload_window_minutes')))
          or ph.state = 'pending'
          or (ph.state = 'approved' and ph.published_at is null));
end;
$$;

-- One logo as the seller centre and the console see it.
create or replace function private.logo_json(l public.shop_logos) returns jsonb
language sql stable
set search_path = ''
as $$
  select case when l.id is null then null else jsonb_build_object(
    'logo_id', l.id,
    'state', l.state,
    'format', l.format,
    'width', l.width,
    'height', l.height,
    'template', private.logo_template(l.seller_id, l.id, l.format),
    'published', l.published_at is not null,
    'rejection_reason', l.rejection_reason,
    'created_at', l.created_at,
    'decided_at', l.decided_at) end;
$$;

-- Marks a shop's abandoned logo reservations as removed.
create or replace function private.expire_logo_reservations(p_seller_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.shop_logos
  set state = 'removed'
  where seller_id = p_seller_id and state = 'uploading'
    and created_at < now() - make_interval(mins => private.photo_rule('upload_window_minutes'));
$$;

-- The shop's public face for its members: name, address, description and
-- logo as shoppers see them, what waits for review, and what was refused.
create or replace function public.seller_shop_front(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s public.sellers%rowtype;
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  select * into s from public.sellers where id = p_seller_id;
  return jsonb_build_object(
    'seller_id', s.id,
    'slug', s.slug,
    'trade_name', s.trade_name,
    'status', s.status,
    'description', s.description,
    'logo', s.logo_path,
    'can_edit', private.is_seller_admin(p_seller_id) and s.status <> 'closed',
    'rules', private.photo_rules(),
    'description_request', (
      select private.shop_change_item(r) from public.seller_change_requests r
      where r.seller_id = p_seller_id and r.kind = 'description'
        and r.status not in ('replaced', 'withdrawn')
      order by r.requested_at desc limit 1),
    -- The logo waiting for review (or approved and about to be published).
    'logo_waiting', (
      select private.logo_json(l) from public.shop_logos l
      where l.seller_id = p_seller_id
        and (l.state = 'pending' or (l.state = 'approved' and l.published_at is null))
      order by l.created_at desc limit 1),
    -- The latest logo refused, while nothing newer was sent.
    'logo_rejected', (
      select private.logo_json(l) from (
        select x.* from public.shop_logos x
        where x.seller_id = p_seller_id and x.state in ('pending', 'approved', 'rejected')
        order by x.created_at desc limit 1) l
      where l.state = 'rejected')
  );
end;
$$;

-- Reserves a new logo and says where its files go (the private bucket; the
-- rules accept them only for this reservation, for two hours). A logo still
-- waiting is replaced. At most ten a day per shop.
create or replace function public.seller_reserve_logo(p_seller_id uuid, p_format text default 'jpeg')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max_per_day constant integer := 10;
  l public.shop_logos;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform 1 from public.sellers where id = p_seller_id for update;
  perform private.require_open_shop(p_seller_id);
  if p_format is null or p_format not in ('jpeg', 'png', 'webp') then
    perform private.fail('invalid_photo');
  end if;
  perform private.expire_logo_reservations(p_seller_id);
  if (select count(*) from public.shop_logos x
      where x.seller_id = p_seller_id and x.created_at > now() - interval '1 day') >= c_max_per_day then
    perform private.fail('logo_daily_limit_reached');
  end if;

  update public.shop_logos set state = 'removed'
  where seller_id = p_seller_id and state in ('uploading', 'pending');

  insert into public.shop_logos (seller_id, format, created_by)
  values (p_seller_id, p_format, (select auth.uid()))
  returning * into l;

  return jsonb_build_object(
    'logo_id', l.id,
    'bucket', 'product-photos-pending',
    'content_type', private.photo_content_type(l.format),
    'files', (
      select jsonb_agg(jsonb_build_object('size', s, 'path', private.logo_path(l.seller_id, l.id, s, l.format))
                       order by s)
      from unnest(private.photo_sizes()) s));
end;
$$;

-- The files of a reserved logo are uploaded: check they are all there, of an
-- accepted type and size, and send it for review.
create or replace function public.seller_finish_logo(
  p_seller_id uuid, p_logo_id uuid, p_width integer, p_height integer
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.shop_logos;
  v_files jsonb;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform 1 from public.sellers where id = p_seller_id for update;
  select * into l from public.shop_logos where id = p_logo_id and seller_id = p_seller_id for update;
  if not found or l.state <> 'uploading' then
    perform private.fail('logo_not_found');
  end if;
  if p_width is null or p_height is null or p_width < 1 or p_height < 1
     or greatest(p_width, p_height) > 1600
     or greatest(p_width, p_height) < private.photo_rule('min_edge') then
    perform private.fail('invalid_photo');
  end if;

  select jsonb_agg(jsonb_build_object('size', s, 'object', to_jsonb(o)))
  into v_files
  from unnest(private.photo_sizes()) s
  left join storage.objects o
    on o.bucket_id = 'product-photos-pending'
   and o.name = private.logo_path(l.seller_id, l.id, s, l.format);
  if exists (select 1 from jsonb_array_elements(v_files) f where f -> 'object' = 'null'::jsonb) then
    perform private.fail('photo_upload_incomplete');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_files) f
    where f -> 'object' -> 'metadata' ->> 'mimetype' is distinct from private.photo_content_type(l.format)
       or coalesce((f -> 'object' -> 'metadata' ->> 'size')::bigint, 0) not between 1 and private.photo_rule('max_bytes')
  ) then
    perform private.fail('invalid_photo');
  end if;

  update public.shop_logos
  set state = 'pending', width = p_width, height = p_height,
      bytes = (select sum((f -> 'object' -> 'metadata' ->> 'size')::bigint) from jsonb_array_elements(v_files) f),
      file_versions = (select jsonb_object_agg(f ->> 'size',
                                               private.object_fingerprint(f -> 'object' ->> 'version',
                                                                          f -> 'object' -> 'metadata'))
                       from jsonb_array_elements(v_files) f)
  where id = l.id
  returning * into l;

  perform private.emit('seller.logo_submitted', jsonb_build_object('seller_id', p_seller_id, 'logo_id', l.id));
  return private.logo_json(l);
end;
$$;

-- The shop takes back the logo it sent (still uploading or waiting).
create or replace function public.seller_withdraw_logo(p_seller_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  update public.shop_logos set state = 'removed'
  where seller_id = p_seller_id and state in ('uploading', 'pending');
  if not found then
    perform private.fail('logo_not_found');
  end if;
end;
$$;

-- The shop stops showing its logo. Nothing to review: showing less needs no
-- approval. Answers whether there was one.
create or replace function public.seller_remove_logo(p_seller_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform 1 from public.sellers where id = p_seller_id for update;
  perform private.require_open_shop(p_seller_id);
  update public.shop_logos set state = 'removed'
  where seller_id = p_seller_id and state = 'approved';
  update public.sellers set logo_path = null where id = p_seller_id and logo_path is not null;
  return found;
end;
$$;

-- Catalogue staff's queue: logos waiting for a decision, and approved ones
-- whose public files are not written yet. Oldest first, at most 100.
create or replace function public.ops_logos_for_review() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.kind, x.created_at, x.id)
    from (
      select l.id, l.created_at,
             case when l.state = 'pending' then 'review' else 'publish' end as kind,
             private.logo_json(l) || jsonb_build_object(
               'kind', case when l.state = 'pending' then 'review' else 'publish' end,
               'seller_id', s.id, 'seller_name', s.trade_name, 'seller_slug', s.slug,
               'seller_status', s.status, 'current_logo', s.logo_path,
               -- The copy staff look at: the largest, as for photos.
               'review_path', private.logo_path(l.seller_id, l.id, 1600, l.format),
               'files_changed', l.state = 'pending' and not private.logo_files_intact(l),
               'own_shop', private.is_seller_member(l.seller_id)) as item
      from public.shop_logos l
      join public.sellers s on s.id = l.seller_id
      where l.state = 'pending' or (l.state = 'approved' and l.published_at is null)
      order by l.created_at, l.id
      limit 100) x), '[]'::jsonb);
end;
$$;

-- Approves (the console then publishes the files) or rejects a waiting logo
-- with a reason the seller reads. An approved logo not yet published can
-- still be rejected: the console does so when its file turns out not to be a
-- picture it can publish. Nobody decides for a shop they belong to.
create or replace function public.ops_review_logo(p_logo_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.shop_logos;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if p_approve is null then
    perform private.fail('logo_not_found');
  end if;
  if not p_approve and coalesce(char_length(v_reason), 0) < 5 then
    perform private.fail('reason_required');
  end if;
  if char_length(v_reason) > 1000 then
    perform private.fail('note_too_long');
  end if;
  select * into l from public.shop_logos where id = p_logo_id;
  if not found then
    perform private.fail('logo_not_found');
  end if;
  perform 1 from public.sellers where id = l.seller_id for update;
  select * into l from public.shop_logos where id = p_logo_id for update;
  if not (l.state = 'pending'
          or (l.state = 'approved' and l.published_at is null and not p_approve)) then
    perform private.fail('logo_not_found');
  end if;
  if private.is_seller_member(l.seller_id) then
    perform private.fail('cannot_decide_own_shop');
  end if;

  if p_approve and not private.logo_files_intact(l) then
    -- Its files were uploaded again after it was sent: not what staff saw.
    p_approve := false;
    v_reason := 'Los archivos del logotipo cambiaron después de subirlo, así que no lo publicamos. Súbalo de nuevo desde su teléfono o computadora.';
  end if;

  update public.shop_logos
  set state = case when p_approve then 'approved' else 'rejected' end,
      rejection_reason = case when p_approve then null else v_reason end,
      decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where id = l.id;

  perform private.emit('seller.change_decided', jsonb_build_object(
    'seller_id', l.seller_id, 'request_id', l.id, 'kind', 'logo', 'approved', p_approve));
end;
$$;

-- The files to write into the public bucket for an approved logo, in the
-- shape the console's publisher takes for photos.
create or replace function public.ops_logo_files_to_publish(p_logo_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'photo_id', l.id,
      'format', l.format,
      'width', l.width,
      'height', l.height,
      'source', private.logo_path(l.seller_id, l.id, 1600, l.format),
      'paths', (select jsonb_agg(private.logo_path(l.seller_id, l.id, s, l.format) order by s)
                from unnest(private.photo_sizes()) s)))
    from public.shop_logos l
    where l.id = p_logo_id and l.state = 'approved' and l.published_at is null
  ), '[]'::jsonb);
end;
$$;

-- After the copy: once all three public files exist, the logo is published,
-- the shop shows it, and the logo it replaces is removed. Refused instead
-- when its waiting files changed after it was sent. Answers what happened.
create or replace function public.ops_confirm_logo_published(p_logo_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.shop_logos;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  select * into l from public.shop_logos where id = p_logo_id;
  if not found then
    perform private.fail('logo_not_found');
  end if;
  perform 1 from public.sellers where id = l.seller_id for update;
  select * into l from public.shop_logos where id = p_logo_id for update;
  if l.state <> 'approved' then
    perform private.fail('logo_not_found');
  end if;
  if l.published_at is not null then
    return jsonb_build_object('outcome', 'published');
  end if;
  if not private.logo_files_intact(l) then
    update public.shop_logos
    set state = 'rejected', decided_by = (select auth.uid()), decided_at = clock_timestamp(),
        rejection_reason = 'Los archivos del logotipo cambiaron después de subirlo, así que no lo publicamos. Súbalo de nuevo desde su teléfono o computadora.'
    where id = l.id;
    return jsonb_build_object('outcome', 'refused');
  end if;
  if exists (
    select 1 from unnest(private.photo_sizes()) s
    where not exists (select 1 from storage.objects o
                      where o.bucket_id = 'product-photos'
                        and o.name = private.logo_path(l.seller_id, l.id, s, l.format))) then
    return jsonb_build_object('outcome', 'waiting');
  end if;

  update public.shop_logos set published_at = clock_timestamp() where id = l.id;
  update public.shop_logos set state = 'removed'
  where seller_id = l.seller_id and id <> l.id and state = 'approved';
  update public.sellers set logo_path = private.logo_template(l.seller_id, l.id, l.format)
  where id = l.seller_id;
  perform private.emit('seller.logo_published', jsonb_build_object('seller_id', l.seller_id, 'logo_id', l.id));
  return jsonb_build_object('outcome', 'published');
end;
$$;

-- ═══ 9. The shop's public page ══════════════════════════════════════════════

-- A shop as shoppers see it: name, description, logo, since when it sells,
-- and the products it sells now with its own price. Only an active shop has
-- a page; any other answers null, as a shop that does not exist does.
create or replace function public.get_shop(p_slug text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', s.slug,
    'trade_name', s.trade_name,
    'description', s.description,
    'logo', s.logo_path,
    'selling_since', s.approved_at,
    'products', coalesce((
      select jsonb_agg(row_to_json(x) order by x.in_stock desc, x.title, x.slug)
      from (
        select p.slug, p.title, b.name as brand_name,
               (select i.path from public.product_images i
                where i.product_id = p.id order by i.sort, i.id limit 1) as image_path,
               min(o.price_minor) filter (where o.available_quantity > 0) as in_stock_price_minor,
               min(o.price_minor) as price_minor,
               bool_or(o.available_quantity > 0) as in_stock,
               -- Whether the offer shown (in stock first) ships from a Yuntera warehouse.
               (array_agg(o.fulfillment = 'platform'
                          order by (o.available_quantity > 0) desc, o.price_minor))[1]
                 as fulfilled_by_platform,
               p.rating_sum, p.rating_count
        from public.offers o
        join public.skus k on k.id = o.sku_id and k.active
        join public.products p on p.id = k.product_id and p.status = 'active'
        join public.categories c on c.id = p.category_id and c.active
        left join public.brands b on b.id = p.brand_id
        where o.seller_id = s.id and o.status = 'active'
        group by p.id, p.slug, p.title, b.name, p.rating_sum, p.rating_count
        order by bool_or(o.available_quantity > 0) desc, p.title
        limit 60
      ) x), '[]'::jsonb)
  )
  from public.sellers s
  where s.slug = left(p_slug, 60) and s.status = 'active';
$$;

-- Replaces the version in the limits migration: the shop's router also asks
-- about a shop's page.
create or replace function public.shop_path_exists(p_kind text, p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'product' then exists (
      select 1 from public.products p
      where p.slug = p_slug and p.status = 'active' and private.product_page_open(p.id))
    when 'category' then exists (
      select 1 from public.categories c where c.slug = p_slug and c.active)
    when 'shop' then exists (
      select 1 from public.sellers s where s.slug = p_slug and s.status = 'active')
    else false
  end;
$$;

-- ═══ 10. Grants ═════════════════════════════════════════════════════════════

revoke all on function
  private.listing_shared(uuid),
  private.variant_shared(uuid),
  private.skus_summary_trigger(),
  private.require_verified_shop(uuid),
  private.barcode_digits(text),
  private.sellers_hand_over_on_close(),
  private.own_listing(uuid),
  private.clean_description(text),
  private.logo_path(uuid, uuid, integer, text),
  private.logo_template(uuid, uuid, text),
  private.logo_for_object(text),
  private.logo_files_intact(public.shop_logos),
  private.logo_object_disposable(text, text, timestamptz),
  private.logo_json(public.shop_logos),
  private.expire_logo_reservations(uuid)
from public, anon, authenticated;

revoke all on function
  public.seller_catalog_search(uuid, text, integer),
  public.seller_add_offer(uuid, uuid, bigint, public.fulfillment_type, smallint, bigint),
  public.seller_set_variant_active(uuid, boolean),
  public.seller_unpublish_listing(uuid),
  public.seller_paused_offers(uuid),
  public.seller_request_shop_description(uuid, text),
  public.seller_shop_front(uuid),
  public.seller_reserve_logo(uuid, text),
  public.seller_finish_logo(uuid, uuid, integer, integer),
  public.seller_withdraw_logo(uuid),
  public.seller_remove_logo(uuid),
  public.ops_logos_for_review(),
  public.ops_review_logo(uuid, boolean, text),
  public.ops_logo_files_to_publish(uuid),
  public.ops_confirm_logo_published(uuid),
  public.get_shop(text)
from public;

grant execute on function
  public.seller_catalog_search(uuid, text, integer),
  public.seller_add_offer(uuid, uuid, bigint, public.fulfillment_type, smallint, bigint),
  public.seller_set_variant_active(uuid, boolean),
  public.seller_unpublish_listing(uuid),
  public.seller_paused_offers(uuid),
  public.seller_request_shop_description(uuid, text),
  public.seller_shop_front(uuid),
  public.seller_reserve_logo(uuid, text),
  public.seller_finish_logo(uuid, uuid, integer, integer),
  public.seller_withdraw_logo(uuid),
  public.seller_remove_logo(uuid),
  public.ops_logos_for_review(),
  public.ops_review_logo(uuid, boolean, text),
  public.ops_logo_files_to_publish(uuid),
  public.ops_confirm_logo_published(uuid)
to authenticated;

grant execute on function public.get_shop(text) to anon, authenticated;
