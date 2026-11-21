-- Lockdown: the functions are the only door.
--
-- On Supabase every table, view and sequence that `anon` or `authenticated`
-- holds a privilege on is reachable over HTTP, whether or not an app uses it.
-- The security review of 21 November 2026 found most of its holes there:
-- column grants that let a seller attach an offer to a competitor's listing,
-- staff read every delivery code, support re-open a refunded return, a seller
-- set the tax rate of a listing, and so on. Instead of patching each grant,
-- this migration closes the whole class:
--
--   1. Signed-in users and visitors hold NO privilege on any table, view or
--      sequence in `public` or `private` (table, column or sequence level),
--      and nothing created later is granted by default.
--   2. The read functions that ran with the caller's rights, and so needed
--      those privileges, now run with the owner's rights and apply, in their
--      own WHERE clauses, exactly the visibility the policies used to give
--      them. Their results do not change.
--   3. Row-level security stays enabled on every table, and the read
--      policies stay as a second lock. Those that read another table
--      directly now go through owner's-rights helpers (so they would still
--      work if a privilege came back), and the ones the review showed too
--      wide are narrowed. The write policies are dropped: no API role may
--      write a table, and a write policy left behind would be the shape of
--      the old hole waiting for a grant.
--   4. A visitor may execute only the functions a visitor must call.
--
-- What is deliberately NOT touched: `service_role` (the platform's own
-- server-side role), and the objects of the `auth` and `storage` schemas.
-- No business function's rules change here.

-- ═══ 1. Read functions: owner's rights, same results ═══════════════════════
--
-- Each was `security invoker`, so row-level security filtered what it read.
-- The filters below are those policies, written out. Where a policy let staff
-- or the listing's own seller see more than a visitor (a draft product, an
-- inactive category), the function still does, so no screen changes.

create or replace function public.get_product(p_slug text, p_postal_code text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Who is asking decides what is visible: anyone sees active listings in
  -- active categories; staff also see the rest, and a seller sees their own.
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
              'slug', s.slug, 'trade_name', s.trade_name, 'score', s.score, 'health', s.health),
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
          ) order by o.price_minor, o.created_at, o.id)
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

create or replace function public.search_products(
  p_query text default null,
  p_category_slug text default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_in_stock_only boolean default false,
  p_made_in_cr boolean default false,
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  product_id uuid, slug text, title text, brand_name text, category_slug text, image_path text,
  min_price_minor bigint, list_price_minor bigint, in_stock boolean, fulfilled_by_platform boolean,
  best_handling_days smallint, rating_sum integer, rating_count integer, made_in_cr boolean,
  score real, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.55
as $$
declare
  -- Staff also see products in categories that are switched off, as they did
  -- when this function ran with the caller's rights.
  v_staff boolean := private.is_staff();
  v_folded text := nullif(trim(private.fold(coalesce(p_query, ''))), '');
  v_tsquery tsquery;
  v_prefix text;
  v_expansion text;
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_sort not in ('relevance', 'price_asc', 'price_desc', 'rating', 'newest') then
    perform private.fail('invalid_sort');
  end if;

  if v_folded is not null then
    v_tsquery := websearch_to_tsquery('public.es', v_folded);
    v_prefix := private.like_escape(v_folded) || '%';
    -- Widen with synonyms: the whole query and each of its words.
    for v_expansion in
      select distinct e
      from public.search_synonyms s
      cross join lateral unnest(s.expansions) e
      where s.term = v_folded or s.term = any (string_to_array(v_folded, ' '))
    loop
      v_tsquery := v_tsquery || plainto_tsquery('public.es', v_expansion);
    end loop;
  end if;

  return query
  with matched as (
    select
      p.id, p.slug, p.title, p.category_id, p.brand_id, p.min_price_minor, p.list_price_minor,
      p.in_stock, p.fulfilled_by_platform, p.best_handling_days, p.rating_sum, p.rating_count,
      p.made_in_cr, p.units_sold_30d, p.views_30d, p.price_index, p.return_rate, p.published_at,
      (v_folded is null or p.search_vector @@ v_tsquery) as exact,
      case when v_folded is null then 0
           else ts_rank_cd(p.search_vector, v_tsquery, 32) end::double precision as rank,
      (v_folded is not null and p.title_folded like v_prefix) as head_match,
      (v_folded is not null and to_tsvector('public.es', cat.name_es) @@ v_tsquery) as category_match,
      case when v_folded is null then 0
           else extensions.word_similarity(v_folded, p.title_folded) end::double precision
        as word_similarity
    from public.products p
    join public.categories cat on cat.id = p.category_id and (cat.active or v_staff)
    where p.status = 'active'
      and p.min_price_minor is not null
      and (v_folded is null
           or p.search_vector @@ v_tsquery
           or v_folded operator(extensions.<%) p.title_folded)
      and (p_category_slug is null
           or p.category_id in (select private.category_descendants(p_category_slug)))
      and (p_min_price_minor is null or p.min_price_minor >= p_min_price_minor)
      and (p_max_price_minor is null or p.min_price_minor <= p_max_price_minor)
      and (not p_in_stock_only or p.in_stock)
      and (not p_made_in_cr or p.made_in_cr)
  ),
  candidates as (
    select m.*, count(*) filter (where m.exact) over () as exact_total
    from matched m
  ),
  scored as (
    select c.*,
      (case
        when v_folded is null then 1.0
        when c.exact then
          0.55 + 0.25 * c.rank + 0.12 * c.head_match::integer + 0.08 * c.category_match::integer
        else 0.5 * c.word_similarity
      end)::double precision as text_score,
      (
        0.30 * least(1, greatest(0, ((4.0 * 8 + c.rating_sum) / (8.0 + c.rating_count) - 1) / 4))
      + 0.25 * least(1, ln(1 + c.units_sold_30d) / ln(10) / 3)
      + 0.20 * least(1, (c.units_sold_30d + 1.0) / (c.views_30d + 50.0) / 0.15)
      + 0.15 * (1.0 / (1 + (case when c.fulfilled_by_platform then 1
                                 else 1 + coalesce(c.best_handling_days, 2) end)))
      + 0.10 * (case
                  when c.price_index <= 0 then 0.5
                  when c.price_index <= 1 then 0.5 + 0.5 * least(1, (1 - c.price_index) / 0.5)
                  else 0.5 * least(1, greatest(0, 2 - c.price_index))
                end)
      )
      * (1 - 0.3 * least(1, c.return_rate / 0.25))
      * (case when c.published_at > now() - interval '21 days' then 1.1 else 1 end)
      * (case when c.in_stock then 1 else 0.25 end) as quality
    from candidates c
    -- Typo-only matches are a fallback for when little matches exactly.
    where c.exact or c.exact_total < 4
  ),
  ranked as (
    select s.*,
      (power(s.text_score, 1.5) * (0.5 + 0.5 * least(1, greatest(0, s.quality))))::real as final_score,
      count(*) over () as total
    from scored s
  )
  select r.id, r.slug, r.title, b.name, cat.slug,
         (select i.path from public.product_images i
          where i.product_id = r.id order by i.sort, i.id limit 1),
         r.min_price_minor, r.list_price_minor, r.in_stock, r.fulfilled_by_platform,
         r.best_handling_days, r.rating_sum, r.rating_count, r.made_in_cr, r.final_score, r.total
  from ranked r
  join public.categories cat on cat.id = r.category_id
  left join public.brands b on b.id = r.brand_id
  order by
    case when p_sort = 'price_asc' then r.min_price_minor end asc nulls last,
    case when p_sort = 'price_desc' then r.min_price_minor end desc nulls last,
    case when p_sort = 'rating'
      then (4.0 * 8 + r.rating_sum) / (8.0 + r.rating_count) end desc nulls last,
    case when p_sort = 'newest' then r.published_at end desc nulls last,
    r.final_score desc,
    r.id
  limit v_limit offset v_offset;
end;
$$;

-- Reads only active products, which every caller could already see.
create or replace function public.suggest_products(p_prefix text, p_limit integer default 8)
returns table (title text, slug text)
language sql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.55
as $$
  with q as (
    select private.fold(trim(p_prefix)) as folded
  )
  select p.title, p.slug
  from public.products p, q
  where p.status = 'active' and p.in_stock
    and char_length(q.folded) >= 2
    and (p.title_folded like private.like_escape(q.folded) || '%'
         or q.folded operator(extensions.<%) p.title_folded)
  order by (p.title_folded like private.like_escape(q.folded) || '%') desc,
           extensions.word_similarity(q.folded, p.title_folded) desc,
           p.units_sold_30d desc,
           p.id
  limit least(greatest(p_limit, 1), 12);
$$;

create or replace function public.list_categories()
returns table (slug text, parent_slug text, name_es text, name_en text, sort smallint,
               product_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  -- A parent that is switched off is shown to staff only, as the policy did.
  with viewer as (select private.is_staff() as staff)
  select c.slug, parent.slug, c.name_es, c.name_en, c.sort,
         (select count(*) from public.products p
          where p.status = 'active' and p.min_price_minor is not null
            and p.category_id in (select private.category_descendants(c.slug)))
  from viewer v
  cross join public.categories c
  left join public.categories parent on parent.id = c.parent_id and (parent.active or v.staff)
  where c.active
  order by (parent.slug is not null), coalesce(parent.sort, c.sort), c.sort, c.slug;
$$;

-- Geography is public reference data; every caller saw all of it.
create or replace function public.list_districts()
returns table (postal_code text, district text, canton_code text, canton text,
               province_code smallint, province text, zone_id text, zone_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select d.postal_code, d.name, c.code, c.name, p.code, p.name,
         coalesce(d.zone_id, c.zone_id), z.active
  from public.districts d
  join public.cantons c on c.code = d.canton_code
  join public.provinces p on p.code = c.province_code
  join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
  order by p.code, c.code, d.postal_code;
$$;

create or replace function public.my_addresses()
returns table (id uuid, label text, recipient_name text, phone text, postal_code text, senas text,
               lat double precision, lng double precision, plus_code text, is_default boolean,
               district text, canton text, province text, zone_id text, zone_active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;

  return query
  select a.id, a.label, a.recipient_name, a.phone, a.postal_code, a.senas, a.lat, a.lng,
         a.plus_code, a.is_default, d.name, c.name, p.name,
         coalesce(d.zone_id, c.zone_id), z.active
  from public.addresses a
  join public.districts d on d.postal_code = a.postal_code
  join public.cantons c on c.code = d.canton_code
  join public.provinces p on p.code = c.province_code
  join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
  where a.user_id = (select auth.uid()) and a.deleted_at is null
  order by a.is_default desc, a.created_at desc;
end;
$$;

create or replace function public.my_orders(p_limit integer default 20, p_offset integer default 0)
returns table (order_number text, status public.order_status, placed_at timestamptz,
               total_minor bigint, payment_method public.payment_method, promise_earliest date,
               promise_latest date, delivered_at timestamptz, item_count bigint, first_title text,
               first_image_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;

  return query
  select o.order_number, o.status, o.placed_at, o.total_minor, o.payment_method,
         o.promise_earliest, o.promise_latest, o.delivered_at,
         (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id),
         first_item.title, first_item.image_path
  from public.orders o
  left join lateral (
    select i.title, i.image_path from public.order_items i
    where i.order_id = o.id order by i.line_total_minor desc, i.id limit 1
  ) first_item on true
  where o.user_id = (select auth.uid())
  order by o.placed_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
end;
$$;

-- The cart page. An offer the caller could not see before (paused, from a
-- seller who is not active, on a listing that is not public) still comes
-- back as a line with nothing but its id and "not buyable".
create or replace function public.cart_lines(p_offer_ids uuid[])
returns table (offer_id uuid, buyable boolean, product_slug text, title text, variant_name text,
               image_path text, seller_name text, price_minor bigint, list_price_minor bigint,
               available integer, fulfillment public.fulfillment_type, handling_days smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select private.is_staff() as staff,
           coalesce(array(select private.my_seller_ids()), '{}'::uuid[]) as sellers
  )
  select req.offer_id,
         coalesce(o.id is not null and o.status = 'active' and k.active and p.status = 'active'
                  and s.status = 'active' and o.available_quantity > 0, false),
         p.slug, p.title, k.variant_name,
         (select i.path from public.product_images i
          where i.product_id = p.id order by i.sort, i.id limit 1),
         s.trade_name, o.price_minor, o.list_price_minor,
         least(coalesce(o.available_quantity, 0), 10), o.fulfillment, o.handling_days
  from viewer v
  cross join unnest(p_offer_ids[1:60]) with ordinality as req (offer_id, position)
  left join public.offers o
    on o.id = req.offer_id
   and ((o.status = 'active' and exists (
           select 1 from public.sellers so where so.id = o.seller_id and so.status = 'active'))
        or o.seller_id = any (v.sellers) or v.staff)
  left join public.products p
    on p.id = (select k2.product_id from public.skus k2 where k2.id = o.sku_id)
   and (p.status = 'active' or v.staff or p.created_by_seller_id = any (v.sellers))
  left join public.skus k on k.id = o.sku_id and k.product_id = p.id
  left join public.sellers s
    on s.id = o.seller_id
   and (s.status = 'active' or v.staff or s.id = any (v.sellers))
  -- In the order the cart asked for them, as the earlier version returned them.
  order by req.position;
$$;

-- Reads only active products and categories, which every caller could see.
create or replace function public.shop_path_exists(p_kind text, p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'product' then exists (
      select 1 from public.products p where p.slug = p_slug and p.status = 'active')
    when 'category' then exists (
      select 1 from public.categories c where c.slug = p_slug and c.active)
    else false
  end;
$$;

-- The check that a ledger transaction balances is a deferred constraint
-- trigger: it runs at COMMIT, after the function that wrote the entries has
-- returned, so with the rights of whoever is then current, the API role. It
-- reads ledger_entries, which that role can no longer read, so it must run
-- with its owner's rights like everything else. (It takes nothing from the
-- caller: only the transaction id of the row that was written.)
alter function private.assert_ledger_balanced() security definer;

-- ═══ 2. Owner's-rights helpers for the policies ═════════════════════════════
--
-- A policy that reads another table directly needs a privilege on that table,
-- which no API role has any more. These helpers answer the same questions with
-- the owner's rights. Each looks only at the caller's own relationship to the
-- row, from the token, and returns a yes or no.

create or replace function private.can_see_product(p_product_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product_id
      and (p.status = 'active'
           or private.is_staff()
           or p.created_by_seller_id in (select private.my_seller_ids())));
$$;

create or replace function private.seller_is_active(p_seller_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.sellers s where s.id = p_seller_id and s.status = 'active');
$$;

create or replace function private.works_at_location(p_location_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.warehouse_locations wl
    where wl.id = p_location_id and private.works_at(wl.warehouse_id));
$$;

create or replace function private.can_see_inbound(p_inbound_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.inbound_shipments s
    where s.id = p_inbound_id
      and (private.is_seller_member(s.seller_id)
           or private.works_at(s.warehouse_id)
           or private.has_staff_role('ops')));
$$;

-- The buyer, or staff who handle orders.
create or replace function private.can_see_order(p_order_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (o.user_id = (select auth.uid()) or private.has_staff_role('ops', 'support', 'finance')));
$$;

-- The buyer only.
create or replace function private.owns_order(p_order_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o where o.id = p_order_id and o.user_id = (select auth.uid()));
$$;

create or replace function private.sells_order_item(p_order_item_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.order_items i
    where i.id = p_order_item_id and private.is_seller_member(i.seller_id));
$$;

-- A driver reads a stop only while the route is theirs to drive, and for a
-- day after it was completed.
create or replace function private.route_open_to_driver(p_route_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.drives_route(p_route_id) and exists (
    select 1 from public.routes r
    where r.id = p_route_id
      and (r.status in ('assigned', 'in_progress')
           or (r.status = 'completed' and r.completed_at > now() - interval '24 hours')));
$$;

create or replace function private.can_see_shipment(p_shipment_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shipments sh
    where sh.id = p_shipment_id
      and (private.can_see_order(sh.order_id)
           or (sh.seller_id is not null and private.is_seller_member(sh.seller_id))
           or private.works_at(sh.origin_warehouse_id)
           or exists (
             select 1 from public.route_stops rs
             where rs.shipment_id = sh.id
               and (private.has_staff_role('ops', 'support')
                    or private.route_open_to_driver(rs.route_id)))));
$$;

-- ═══ 3. Policies: the second lock ═══════════════════════════════════════════

-- Write policies go. No API role holds a write privilege on any table, and
-- several of these were what the review exploited (offers, seller_members,
-- return_requests, consents, reviews, complaints, content_reports, products).
-- Without them, row-level security refuses every write even if a privilege
-- were ever granted again by mistake.
drop policy if exists "admin writes" on public.app_settings;
drop policy if exists "ops writes" on public.cantons;
drop policy if exists "ops writes" on public.districts;
drop policy if exists "ops writes" on public.delivery_zones;
drop policy if exists "ops writes" on public.holidays;
drop policy if exists "ops writes" on public.zone_closures;
drop policy if exists "catalog writes" on public.categories;
drop policy if exists "catalog writes" on public.brands;
drop policy if exists "catalog writes" on public.search_synonyms;
drop policy if exists "finance writes" on public.fee_schedules;
drop policy if exists "finance writes" on public.fee_payment_methods;
drop policy if exists "finance writes" on public.fee_fulfillment_tiers;
drop policy if exists "edit own profile" on public.profiles;
drop policy if exists "admin manages staff" on public.staff_members;
drop policy if exists "seller admins edit the shop front" on public.sellers;
drop policy if exists "seller admins edit details" on public.seller_private;
drop policy if exists "seller admins add members" on public.seller_members;
drop policy if exists "seller admins change members" on public.seller_members;
drop policy if exists "seller admins remove members" on public.seller_members;
drop policy if exists "ops manages drivers" on public.drivers;
drop policy if exists "record own consent" on public.consents;
drop policy if exists "withdraw own consent" on public.consents;
drop policy if exists "add own address" on public.addresses;
drop policy if exists "edit own address" on public.addresses;
drop policy if exists "sellers create listings" on public.products;
drop policy if exists "sellers edit their listings" on public.products;
drop policy if exists "listing owner writes" on public.product_images;
drop policy if exists "listing owner adds variants" on public.skus;
drop policy if exists "listing owner edits variants" on public.skus;
drop policy if exists "sellers make offers" on public.offers;
drop policy if exists "sellers change their offers" on public.offers;
drop policy if exists "sellers and ops add locations" on public.warehouses;
drop policy if exists "sellers and ops edit locations" on public.warehouses;
drop policy if exists "ops assigns staff" on public.warehouse_staff;
drop policy if exists "ops defines locations" on public.warehouse_locations;
drop policy if exists "finance manages payouts" on public.payouts;
drop policy if exists "staff moderate" on public.reviews;
drop policy if exists "support resolves" on public.return_requests;
drop policy if exists "file a complaint" on public.complaints;
drop policy if exists "support resolves" on public.complaints;
drop policy if exists "anyone reports" on public.content_reports;
drop policy if exists "staff act on reports" on public.content_reports;

-- Read policies that read another table directly: same rows, through the helpers.
alter policy "follows product" on public.product_images
  using ((select private.can_see_product(product_images.product_id)));
alter policy "follows product" on public.skus
  using ((select private.can_see_product(skus.product_id)));
alter policy "live offers are public" on public.offers
  using ((offers.status = 'active' and (select private.seller_is_active(offers.seller_id)))
         or (select private.is_seller_member(offers.seller_id))
         or (select private.is_staff()));
alter policy "owner, site team or staff" on public.bin_stock
  using ((select private.is_seller_member(bin_stock.seller_id))
         or (select private.has_staff_role('ops'))
         or (select private.works_at_location(bin_stock.location_id)));
alter policy "follows inbound shipment" on public.inbound_shipment_lines
  using ((select private.can_see_inbound(inbound_shipment_lines.inbound_shipment_id)));
alter policy "buyer, seller of the line, or staff" on public.order_items
  using ((select private.can_see_order(order_items.order_id))
         or (select private.is_seller_member(order_items.seller_id)));
alter policy "follows order" on public.payments
  using ((select private.can_see_order(payments.order_id)));
alter policy "buyer, origin, driver or staff" on public.shipments
  using ((select private.can_see_shipment(shipments.id)));
alter policy "follows shipment" on public.shipment_items
  using ((select private.can_see_shipment(shipment_items.shipment_id)));
alter policy "customer timeline, or staff" on public.order_events
  using ((select private.has_staff_role('ops', 'support', 'finance'))
         or (order_events.visible_to_customer and (select private.owns_order(order_events.order_id))));
alter policy "driver during the route, or staff" on public.route_stops
  using ((select private.has_staff_role('ops', 'support'))
         or (select private.route_open_to_driver(route_stops.route_id)));
alter policy "buyer, issuer or finance" on public.electronic_invoices
  using ((select private.has_staff_role('finance'))
         or (electronic_invoices.issuer_seller_id is not null
             and (select private.is_seller_member(electronic_invoices.issuer_seller_id)))
         or (select private.owns_order(electronic_invoices.order_id)));
alter policy "buyer, seller of the item, or staff" on public.return_requests
  using (return_requests.user_id = (select auth.uid())
         or (select private.has_staff_role('support', 'ops'))
         or (select private.sells_order_item(return_requests.order_item_id)));

-- Narrowed where the review showed them wider than the documented need
-- (DTA-10): customer profiles are for support, not every staff role, and
-- drivers' identity documents are for ops, who manage drivers.
alter policy "own profile, or staff" on public.profiles
  using (profiles.id = (select auth.uid()) or (select private.has_staff_role('support')));
alter policy "own record, or staff" on public.drivers
  using (drivers.user_id = (select auth.uid()) or (select private.has_staff_role('ops')));

-- ═══ 4. Function privileges ═════════════════════════════════════════════════

-- Nothing is executable by PUBLIC, in either schema, whoever created it.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema private from public;

-- reviewer_display_name turns any account id into a name (DTA-9). Only
-- get_product calls it, and that now runs with the owner's rights.
revoke execute on function public.reviewer_display_name(uuid) from anon, authenticated;

-- These helpers were granted only so that invoker-rights functions could call
-- them as the caller. None is left.
revoke execute on function
  private.fold(text),
  private.like_escape(text),
  private.category_descendants(text),
  private.fail(text, text)
from anon, authenticated;

-- What remains executable in `private` by the API roles is the short list of
-- yes-or-no helpers that row-level-security policies call (here and, for
-- example, on storage objects). The Data API does not expose `private`, so
-- none of them can be called over HTTP.
grant execute on function
  private.can_see_product(uuid),
  private.seller_is_active(uuid),
  private.works_at_location(uuid),
  private.can_see_inbound(uuid),
  private.can_see_order(uuid),
  private.owns_order(uuid),
  private.sells_order_item(uuid),
  private.route_open_to_driver(uuid),
  private.can_see_shipment(uuid)
to anon, authenticated;

-- ═══ 5. No privilege on any table, view or sequence ═════════════════════════
--
-- A sweep over the catalogue rather than a list of names, so it also covers
-- the tables that other migrations added before this one. Column privileges
-- are revoked one by one as well: a column grant is a separate privilege.

do $$
declare
  r record;
begin
  -- Tables, partitioned tables, views, materialised views, foreign tables, sequences.
  for r in
    select n.nspname, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence %I.%I from anon, authenticated, public',
                     r.nspname, r.relname);
    else
      execute format('revoke all on table %I.%I from anon, authenticated, public',
                     r.nspname, r.relname);
    end if;
  end loop;

  -- Any column privilege still held by the API roles or PUBLIC.
  for r in
    select distinct n.nspname, c.relname, a.attname,
           case when acl.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(acl.grantee)) end
             as grantee
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) acl
    where n.nspname in ('public', 'private')
      and a.attacl is not null
      and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
  loop
    execute format('revoke all (%I) on table %I.%I from %s',
                   r.attname, r.nspname, r.relname, r.grantee);
  end loop;

  -- Row-level security on every table, including any added since 081400.
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
  end loop;
end
$$;

-- ═══ 6. Nothing granted by default to objects created later ═════════════════
--
-- A Supabase project grants `anon`, `authenticated` and `service_role`
-- everything on new tables, sequences and functions in `public` that the
-- `postgres` role creates (the Supabase guide "Securing your API"), and
-- PostgreSQL itself lets PUBLIC execute every new function. The local shim
-- copies the same defaults. Both are switched off here for the API roles and
-- PUBLIC, in `public`, in `private` and for functions everywhere. The
-- `service_role` defaults are the platform's and are left as they are.
-- (The 080000 migration did most of this without naming the role; naming it
-- makes the result the same whoever runs the migration.)
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, public;
alter default privileges for role postgres in schema private
  revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema private
  revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema private
  revoke all on functions from anon, authenticated, public;
