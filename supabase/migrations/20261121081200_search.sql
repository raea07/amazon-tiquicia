-- Product search and listing.
--
-- One function serves search results, category pages and the home-page shelves.
-- It runs with the caller's own rights (SECURITY INVOKER): row-level security
-- decides which products exist for them, so it cannot leak a draft listing.
--
-- RETRIEVAL
--   Exact matches come from Postgres full-text search with the accent-insensitive
--   Spanish configuration, widened with curated synonyms ("refri" →
--   "refrigeradora"). Typos are caught with WORD similarity on the title, not
--   whole-string similarity: against a long title, whole-string similarity
--   scores "licuadra" at about 0.16 and would never match, while word similarity
--   scores it 0.67 and nonsense 0.00. The 0.55 threshold was set from measured
--   typos (0.58–0.86). Typo-only matches are a fallback: they are shown only
--   when fewer than four products match exactly.
--
-- TEXT RELEVANCE  (composeTextScore in packages/core/src/search.ts)
--   Term frequency alone cannot tell a product that IS the thing searched for
--   from one that merely mentions it — for "laptop", a backpack "con
--   compartimento para laptop" out-scores the laptop. Two structural signals
--   fix that: the title begins with the query, and the query matches the
--   product's category.
--
-- RANKING  (scoreCandidate in the same file)
--   final = text_relevance ^ 1.5 × (0.5 + 0.5 × quality). Quality can at most
--   double a score, so relevance stays in charge.
--
-- A unit test reads this file and fails if its constants drift from the
-- TypeScript specification.

-- Escapes LIKE wildcards so a shopper typing "%" or "_" searches for those characters.
create or replace function private.like_escape(p_text text) returns text
language sql immutable parallel safe strict
set search_path = ''
as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
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
) returns table (
  product_id uuid,
  slug text,
  title text,
  brand_name text,
  category_slug text,
  image_path text,
  min_price_minor bigint,
  list_price_minor bigint,
  in_stock boolean,
  fulfilled_by_platform boolean,
  best_handling_days smallint,
  rating_sum integer,
  rating_count integer,
  made_in_cr boolean,
  score real,
  total_count bigint
)
language plpgsql stable
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.55
as $$
declare
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
    join public.categories cat on cat.id = p.category_id
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

-- Autocomplete: product titles that start with, or closely resemble, what was typed.
create or replace function public.suggest_products(p_prefix text, p_limit integer default 8)
returns table (title text, slug text)
language sql stable
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
