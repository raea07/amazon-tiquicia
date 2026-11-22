-- Staff catalogue tools in the console: categories, brands, search synonyms,
-- review moderation and staff corrections to a published product.
--
-- The lockdown (20261121082800) took every table privilege away from the app
-- roles, so these changes, which staff once made by writing to tables, had no
-- door at all. Each one is now a function for catalogue staff and
-- administrators (`has_staff_role('catalog')`; other staff roles are refused
-- with `forbidden`), checks its input, and leaves an entry in the audit log.
--
-- What this migration decides, and why:
--
--   * A category has an address in the shop (/c/<slug>). Renaming it keeps the
--     old address as an alias (`category_slug_aliases`) that the shop answers
--     with a permanent redirect, so links and search engines follow. Slugs and
--     aliases share one namespace: a new address may not be any category's
--     address or another category's old one, nor one of a few words the shop
--     keeps for itself.
--   * HIDING a category takes it, and everything under it, out of the shop's
--     menus and category pages and out of the choices sellers get for a new
--     listing. Its products are NOT taken off sale: they stay in search and at
--     their own address, and a product page shows only the visible part of its
--     breadcrumbs. Hiding is for a department that is being reorganised, not
--     for taking goods down (that is a product take-down, below).
--   * A category with products, or that past orders name, is never deleted;
--     an empty one without sub-categories can be.
--   * Commission comes from the fee schedule and from the category (its own
--     rate, else the nearest ancestor's). A move that would change the
--     commission of a listed product is refused: fee changes stay in
--     migrations, where packages/core/src/fees.ts and its parity test change
--     with them. A staff CORRECTION of one product's category may change that
--     product's commission (the product was filed in the wrong place); it is
--     refused if any of its offers would then sell at a loss, and the seller is
--     told the new rate.
--   * Merging a brand moves its products to the other brand and keeps the old
--     name (and a renamed brand's old name) as a search alias, so a shopper who
--     types the old name still finds them; the old brand's filter address
--     shows the brand it was merged into.
--   * A synonym is stored exactly as search reads it (folded, single spaces),
--     and refused when it is empty, too long, repeated, or so common that it
--     would match nearly everything.
--   * A hidden review keeps its row; the product's rating and count follow at
--     once (the rating trigger counts published reviews only), and the cached
--     pages are refreshed by the console. The author reads on their order page
--     that it was hidden and why. Hiding only the seller's reply leaves the
--     review and the rating alone.
--   * Staff take a published product down with a reason and put it back; a
--     content report acted on does the same take-down, and a report about a
--     review hides it with the same reasons. The seller is told through the
--     notification pipeline (topic `product.staff_changed`).

-- ═══ 1. Tables ═════════════════════════════════════════════════════════════

-- Old addresses of categories, answered by the shop with a redirect.
create table public.category_slug_aliases (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index category_slug_aliases_category_idx on public.category_slug_aliases (category_id);
alter table public.category_slug_aliases enable row level security;
revoke all on public.category_slug_aliases from public, anon, authenticated;
create policy "staff read" on public.category_slug_aliases for select
  using ((select private.is_staff()));

-- Brands can be hidden from the shop's filter, carry old names for search, and
-- point at the brand they were merged into.
alter table public.brands
  add column active boolean not null default true,
  add column aliases text[] not null default '{}' check (cardinality(aliases) <= 20),
  -- Earlier filter addresses (?marca=), which keep showing the brand after a rename.
  add column former_slugs text[] not null default '{}' check (cardinality(former_slugs) <= 20),
  add column merged_into_id uuid references public.brands (id),
  add column merged_at timestamptz,
  add constraint brands_not_merged_into_itself check (merged_into_id is distinct from id);

alter table public.search_synonyms
  add column created_at timestamptz not null default now(),
  add column created_by uuid references auth.users (id) on delete set null;

-- Why a review, or only the seller's reply to it, is not shown, and since when.
-- Legacy hidden reviews (status 'rejected' from a report before this migration)
-- have no reason code; they read as "no cumple las reglas".
alter table public.reviews
  add column hidden_reason text check (hidden_reason in
    ('offensive', 'personal_data', 'off_topic', 'spam', 'not_genuine', 'illegal', 'rules')),
  add column hidden_at timestamptz,
  add column hidden_by uuid references auth.users (id) on delete set null,
  add column reply_hidden_reason text check (reply_hidden_reason in
    ('offensive', 'personal_data', 'off_topic', 'spam', 'not_genuine', 'illegal', 'rules')),
  add column reply_hidden_at timestamptz,
  add column reply_hidden_by uuid references auth.users (id) on delete set null;

-- A take-down by staff (as opposed to a rejection at first review), so that
-- staff can put it back. The reason is the product's rejection_reason, which
-- the seller already reads.
--
-- `taken_down_fingerprint` is a digest of what the listing said when it was
-- taken down. Putting it back is refused once the seller has changed it since
-- (a seller may edit a listing that is not on sale in place, without review),
-- so a restore never publishes text, a category or a package no one reviewed.
-- A take-down ends by itself when the listing leaves 'rejected' any other way
-- (the seller sends it to review, review decides): see the trigger below.
alter table public.products
  add column taken_down_at timestamptz,
  add column taken_down_by uuid references auth.users (id) on delete set null,
  add column taken_down_fingerprint text,
  add constraint products_take_down_whole
    check ((taken_down_at is null) = (taken_down_fingerprint is null));

-- Brands and synonyms are reference data whose changes must not be silent;
-- categories already have the audit trigger (20261121083000_limits.sql).
create trigger brands_audit after insert or update or delete on public.brands
  for each row execute function private.audit();
create trigger search_synonyms_audit after insert or update or delete on public.search_synonyms
  for each row execute function private.audit();

-- ═══ 2. Helpers ════════════════════════════════════════════════════════════

-- An audit entry written by a function, for changes whose rows hold text that
-- does not belong in the log (a review's body) or that need a reason with them.
create or replace function private.catalog_audit(
  p_action text, p_table text, p_key text, p_old jsonb, p_new jsonb
) returns void
language sql security definer
set search_path = ''
as $$
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), p_action, p_table, p_key, p_old, p_new);
$$;

-- What search does to a query before it compares it with a synonym: folded
-- (lowercase, no accents, as private.fold) and with single spaces, trimmed
-- (as private.bounded_search_text). A synonym stored this way is found by
-- every query that search would match with it.
create or replace function private.search_term(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select nullif(trim(regexp_replace(private.fold(coalesce(p_text, '')), '\s+', ' ', 'g')), '');
$$;

-- An address from a name: "Café y té" -> "cafe-y-te".
create or replace function private.slugify(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select nullif(trim(both '-' from left(
    trim(both '-' from regexp_replace(private.fold(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g')),
    60)), '');
$$;

-- Words the shop keeps for itself under /c/: never a category's address.
create or replace function private.reserved_category_slug(p_slug text) returns boolean
language sql immutable
set search_path = ''
as $$
  select p_slug = any (array['buscar', 'todas', 'todos', 'nuevo', 'nuevos', 'nueva', 'nuevas',
                             'ofertas', 'marca', 'marcas', 'categoria', 'categorias', 'producto',
                             'productos', 'admin', 'api', 'ayuda', 'carrito', 'pagar', 'cuenta',
                             'pedidos', 'ingresar', 'yuntera']);
$$;

-- Refuses an address that cannot be given to a category. An address the
-- category itself used before is fine (it stops being an alias).
create or replace function private.check_category_slug(p_slug text, p_category_id uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_slug is null or char_length(p_slug) < 2 or char_length(p_slug) > 60
     or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    perform private.fail('category_slug_invalid');
  end if;
  if private.reserved_category_slug(p_slug) then
    perform private.fail('category_slug_reserved');
  end if;
  if exists (select 1 from public.categories c
             where c.slug = p_slug and c.id is distinct from p_category_id)
     or exists (select 1 from public.category_slug_aliases a
                where a.slug = p_slug and a.category_id is distinct from p_category_id) then
    perform private.fail('category_slug_taken');
  end if;
end;
$$;

-- A category shows in the shop when it and every category above it is active.
create or replace function private.category_visible(p_category_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  with recursive up as (
    select c.id, c.parent_id, c.active, 0 as depth from public.categories c where c.id = p_category_id
    union all
    select c.id, c.parent_id, c.active, up.depth + 1
    from public.categories c join up on c.id = up.parent_id
    where up.depth < 10
  )
  select exists (select 1 from up) and bool_and(up.active) from up;
$$;

-- How deep a category sits: 1 for a department, 2 under it, and so on.
create or replace function private.category_depth(p_category_id uuid) returns integer
language sql stable security definer
set search_path = ''
as $$
  with recursive up as (
    select c.id, c.parent_id, 1 as depth from public.categories c where c.id = p_category_id
    union all
    select c.id, c.parent_id, up.depth + 1
    from public.categories c join up on c.id = up.parent_id
    where up.depth < 10
  )
  select max(depth) from up;
$$;

-- A category and everything beneath it, by id, with each one's depth below it.
create or replace function private.category_subtree(p_category_id uuid)
returns table (id uuid, below integer)
language sql stable security definer
set search_path = ''
as $$
  with recursive tree as (
    select c.id, 0 as below from public.categories c where c.id = p_category_id
    union all
    select c.id, tree.below + 1 from public.categories c join tree on c.parent_id = tree.id
    where tree.below < 10
  )
  select tree.id, tree.below from tree;
$$;

-- The deepest the tree may go: department, category, sub-category.
create or replace function private.category_max_depth() returns integer
language sql immutable
set search_path = ''
as $$ select 3 $$;

-- A category's name, folded, is unique among its siblings.
create or replace function private.category_name_taken(
  p_name text, p_parent_id uuid, p_except uuid
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.categories c
    where c.parent_id is not distinct from p_parent_id
      and c.id is distinct from p_except
      and private.fold(c.name_es) = private.fold(p_name));
$$;

-- The commission each category of a subtree would charge, for the products
-- that are listed in it (not archived). Used to refuse a move that changes it.
create or replace function private.subtree_listed_rates(p_category_id uuid)
returns table (category_id uuid, referral_bps integer)
language sql stable security definer
set search_path = ''
as $$
  select t.id, coalesce(private.referral_bps_for_category(t.id),
                        (select s.default_referral_bps from public.fee_schedules s where s.active))
  from private.category_subtree(p_category_id) t
  where exists (select 1 from public.products p where p.category_id = t.id and p.status <> 'archived');
$$;

-- Siblings numbered 1..n in their current order, so moving one up or down is a swap.
create or replace function private.renumber_categories(p_parent_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.categories c
  set sort = x.n
  from (
    select s.id, row_number() over (order by s.sort, s.slug)::smallint as n
    from public.categories s where s.parent_id is not distinct from p_parent_id
  ) x
  where c.id = x.id and c.sort is distinct from x.n;
$$;

-- The search document of a product, now with its brand's old names (a merged
-- brand, a renamed one) so that searching an old name still finds it.
-- Replaces the version in 20261121080400_catalog.sql.
create or replace function private.refresh_product_search(p_product_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.products p
  set search_vector =
        setweight(to_tsvector('public.es', coalesce(p.title, '')), 'A')
     || setweight(to_tsvector('public.es',
          coalesce(b.name, '') || ' ' || coalesce(array_to_string(b.aliases, ' '), '')), 'A')
     || setweight(to_tsvector('public.es', coalesce(c.name_es, '')), 'B')
     || setweight(to_tsvector('public.es', coalesce(array_to_string(p.bullet_points, ' '), '')), 'C')
     || setweight(to_tsvector('public.es', coalesce(p.description, '')), 'D')
  from public.categories c
  left join public.brands b on b.id = (select q.brand_id from public.products q where q.id = p_product_id)
  where p.id = p_product_id and c.id = p.category_id;
$$;

-- The reasons a review or a reply can be hidden for. A low rating is never one.
create or replace function private.review_hide_reason_ok(p_reason text) returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_reason = any (array['offensive', 'personal_data', 'off_topic', 'spam',
                                        'not_genuine', 'illegal', 'rules']), false);
$$;

-- What a reason says, for the report the reporter is told about and for the log.
create or replace function private.review_hide_reason_text(p_reason text) returns text
language sql immutable
set search_path = ''
as $$
  select case p_reason
    when 'offensive' then 'Tiene insultos o lenguaje ofensivo.'
    when 'personal_data' then 'Incluye datos personales.'
    when 'off_topic' then 'No trata del producto ni de la compra.'
    when 'spam' then 'Es publicidad o lleva enlaces.'
    when 'not_genuine' then 'No describe una experiencia real con el producto.'
    when 'illegal' then 'Incluye contenido ilegal.'
    else 'No cumple las reglas de publicación de reseñas.'
  end;
$$;

-- Hides a review: it leaves the product page, the rating and the count (the
-- rating trigger counts published reviews only). Open reports about it are
-- closed as acted on, and each reporter is told, except the report this is
-- being done for (`p_except_report`), which its caller closes itself.
create or replace function private.hide_review(
  p_review_id uuid, p_reason text, p_note text, p_except_report uuid default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reviews%rowtype;
  v_report record;
begin
  if not private.review_hide_reason_ok(p_reason) then
    perform private.fail('review_reason_invalid');
  end if;
  select * into r from public.reviews where id = p_review_id for update;
  if not found then
    perform private.fail('review_not_found');
  end if;
  if r.status <> 'published' then
    perform private.fail('review_already_hidden');
  end if;
  update public.reviews
  set status = 'rejected', hidden_reason = p_reason, hidden_at = now(),
      hidden_by = (select auth.uid()), moderation_note = left(p_note, 1000)
  where id = p_review_id;

  for v_report in
    select cr.id from public.content_reports cr
    where cr.target_type = 'review' and cr.target_id = p_review_id
      and cr.status in ('open', 'in_review') and cr.id is distinct from p_except_report
    order by cr.id
    for update
  loop
    update public.content_reports
    set status = 'actioned', resolution = private.review_hide_reason_text(p_reason),
        resolved_by = (select auth.uid()), resolved_at = now()
    where id = v_report.id;
    perform private.emit('report.resolved',
      jsonb_build_object('report_id', v_report.id, 'actioned', true));
  end loop;

  perform private.catalog_audit('HIDE', 'reviews', p_review_id::text,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', 'rejected', 'reason', p_reason, 'note', left(p_note, 500),
                       'product_id', r.product_id, 'rating', r.rating));
end;
$$;

-- A digest of everything about a listing that a seller can change and that
-- review is meant to see: its text, where it is filed, its brand, and each
-- variant with its package. Compared when staff put a taken-down listing back.
create or replace function private.listing_fingerprint(p_product_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select md5(jsonb_build_object(
    'title', p.title,
    'description', p.description,
    'bullet_points', to_jsonb(p.bullet_points),
    'attributes', p.attributes,
    'brand_id', p.brand_id,
    'category_id', p.category_id,
    'tax_rate_bps', p.tax_rate_bps,
    'warranty_months', p.warranty_months,
    'made_in_cr', p.made_in_cr,
    'skus', coalesce((select jsonb_agg(to_jsonb(k) - 'created_at' order by k.id)
                      from public.skus k where k.product_id = p.id), '[]'::jsonb))::text)
  from public.products p
  where p.id = p_product_id;
$$;

-- A take-down ends when the listing leaves 'rejected' by any door other than a
-- staff restore (which clears it itself): the seller sends it to review, or
-- review decides. What comes back then has been through review, and staff
-- cannot later "put back" a listing that review turned down.
create or replace function private.products_end_take_down() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.taken_down_at is not distinct from old.taken_down_at then
    new.taken_down_at := null;
    new.taken_down_by := null;
    new.taken_down_fingerprint := null;
  end if;
  return new;
end;
$$;

create trigger products_end_take_down
  before update on public.products
  for each row
  when (old.taken_down_at is not null and new.status <> 'rejected')
  execute function private.products_end_take_down();

-- Replaces the version in 20261121080900_trust.sql. The product's rating and
-- count were recomputed from what this transaction could see when the trigger
-- started; two reviews of one product changing at once (two staff hiding, a
-- hide and a new review) then each wrote a count that missed the other, and
-- the product kept a wrong rating until its next review. Now the product row
-- is locked first, and the count is read in a statement that starts after the
-- lock is granted, so it sees every review committed before it (READ
-- COMMITTED takes a new snapshot per statement).
create or replace function private.reviews_rating_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
begin
  perform 1 from public.products p where p.id = v_product for update;
  update public.products p
  set rating_sum = coalesce((select sum(r.rating)::integer from public.reviews r
                             where r.product_id = v_product and r.status = 'published'), 0),
      rating_count = (select count(*)::integer from public.reviews r
                      where r.product_id = v_product and r.status = 'published')
  where p.id = v_product;
  return null;
end;
$$;

-- Takes a published product off the shop for a reason the seller reads, and
-- marks it as a staff take-down so it can be put back.
create or replace function private.take_down_product(p_product_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
begin
  select * into p from public.products where id = p_product_id for update;
  if not found or p.status <> 'active' then
    perform private.fail('product_not_active');
  end if;
  update public.products
  set status = 'rejected', rejection_reason = trim(p_reason),
      taken_down_at = now(), taken_down_by = (select auth.uid()),
      taken_down_fingerprint = private.listing_fingerprint(p_product_id)
  where id = p_product_id;
  perform private.catalog_audit('TAKE_DOWN', 'products', p_product_id::text,
    jsonb_build_object('status', p.status), jsonb_build_object('status', 'rejected', 'reason', trim(p_reason)));
  if p.created_by_seller_id is not null then
    perform private.emit('product.staff_changed', jsonb_build_object(
      'product_id', p.id, 'seller_id', p.created_by_seller_id, 'kind', 'taken_down',
      'note', left(trim(p_reason), 400)));
  end if;
end;
$$;

-- ═══ 3. What the shop reads ════════════════════════════════════════════════

-- Replaces the version in 20261121082800_lockdown.sql. Only categories that
-- show (active, and every category above them active): a hidden department
-- takes its sub-categories with it, instead of leaving them as orphans at the
-- top of the menu.
create or replace function public.list_categories()
returns table (slug text, parent_slug text, name_es text, name_en text, sort smallint,
               product_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.slug, parent.slug, c.name_es, c.name_en, c.sort,
         (select count(*) from public.products p
          where p.status = 'active' and p.min_price_minor is not null
            and p.category_id in (select private.category_descendants(c.slug)))
  from public.categories c
  left join public.categories parent on parent.id = c.parent_id
  where private.category_visible(c.id)
  order by (parent.slug is not null), coalesce(parent.sort, c.sort), c.sort, c.slug;
$$;

-- Replaces the version in 20261121083000_limits.sql: a category address
-- exists while the category shows. (An old address is answered by
-- category_redirect, below.)
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
      select 1 from public.categories c where c.slug = p_slug and private.category_visible(c.id))
    else false
  end;
$$;

-- Where an old category address points now: the category's current address
-- while it shows, else null (the shop then answers "not found").
create or replace function public.category_redirect(p_slug text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.slug
  from public.category_slug_aliases a
  join public.categories c on c.id = a.category_id
  where a.slug = left(p_slug, 60) and private.category_visible(c.id);
$$;

-- The brand a filter address (?marca=) means: the brand at that address, or
-- the one that had it before a rename, or, for a brand merged away, the brand
-- it went into. Addresses and earlier addresses share one namespace, so at
-- most one brand answers.
create or replace function private.brand_for_slug(p_slug text) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(b.merged_into_id, b.id)
  from public.brands b
  where b.slug = p_slug or p_slug = any (b.former_slugs)
  order by (b.slug = p_slug) desc, b.id
  limit 1;
$$;

-- The brands a shopper can filter by: shown, not merged away, with products on
-- sale (in a category and everything under it, when one is given). With each,
-- the addresses that used to mean it (its own before a rename, and those of
-- brands merged into it), so an old link still selects it in the filter.
create or replace function public.list_brands(p_category_slug text default null)
returns table (slug text, name text, product_count bigint, former_slugs text[])
language sql
stable
security definer
set search_path = ''
as $$
  select b.slug, b.name, count(p.id),
         b.former_slugs || coalesce((select array_agg(x order by x)
                                     from public.brands m, unnest(m.former_slugs || m.slug) x
                                     where m.merged_into_id = b.id), '{}')
  from public.brands b
  join public.products p on p.brand_id = b.id
  where b.active and b.merged_into_id is null
    and p.status = 'active' and p.min_price_minor is not null
    and (p_category_slug is null
         or p.category_id in (select private.category_descendants(left(p_category_slug, 100))))
  group by b.id, b.slug, b.name, b.former_slugs
  order by b.name, b.slug;
$$;

-- The search body, replacing the version in 20261121082800_lockdown.sql (and
-- kept private behind the bounded wrapper as 20261121083000_limits.sql set
-- up). Two changes, nothing else:
--   * a product in a hidden category is still found (it is on sale; only its
--     category is out of the menus);
--   * an optional brand filter, by the brand's address; the address of a brand
--     merged into another finds the other's products.
-- The ranking constants are those of 20261121081200_search.sql; the parity
-- test in packages/core checks this definition as well.
drop function public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer);
drop function private.search_products_unbounded(text, text, bigint, bigint, boolean, boolean, text, integer, integer);

-- The search functions pin pg_trgm's threshold; load its library first (see
-- 20261121081200_search.sql).
select extensions.word_similarity('a', 'a');

create function private.search_products_unbounded(
  p_query text default null,
  p_category_slug text default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_in_stock_only boolean default false,
  p_made_in_cr boolean default false,
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0,
  p_brand_slug text default null
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
  v_folded text := nullif(trim(private.fold(coalesce(p_query, ''))), '');
  v_tsquery tsquery;
  v_prefix text;
  v_expansion text;
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_brands uuid[];
begin
  if p_sort not in ('relevance', 'price_asc', 'price_desc', 'rating', 'newest') then
    perform private.fail('invalid_sort');
  end if;

  if p_brand_slug is not null then
    v_brands := array(select x from private.brand_for_slug(p_brand_slug) x where x is not null);
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
      and (p_brand_slug is null or p.brand_id = any (v_brands))
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

create function public.search_products(
  p_query text default null,
  p_category_slug text default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_in_stock_only boolean default false,
  p_made_in_cr boolean default false,
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0,
  p_brand_slug text default null
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
language sql stable security definer
set search_path = ''
as $$
  select * from private.search_products_unbounded(
    private.bounded_search_text(p_query), left(p_category_slug, 100), p_min_price_minor,
    p_max_price_minor, p_in_stock_only, p_made_in_cr, left(p_sort, 20), p_limit,
    least(greatest(coalesce(p_offset, 0), 0), 10000), left(p_brand_slug, 60));
$$;

-- The product page's body, replacing the version in 20261121082800_lockdown.sql
-- (behind the gate of 20261121083000_limits.sql). Changes:
--   * a product in a hidden category still has its page; the breadcrumbs show
--     only the categories that show (staff see them all);
--   * a seller's reply that staff hid is not shown.
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
    'breadcrumbs', coalesce((
      with recursive up as (
        select c.id, c.parent_id, c.slug, c.name_es, c.name_en, 0 as depth
        from public.categories c where c.id = p.category_id
        union all
        select c.id, c.parent_id, c.slug, c.name_es, c.name_en, up.depth + 1
        from public.categories c join up on c.id = up.parent_id
        where up.depth < 10
      )
      select jsonb_agg(jsonb_build_object('slug', up.slug, 'name_es', up.name_es, 'name_en', up.name_en)
                       order by up.depth desc)
      from up
      where v.staff or private.category_visible(up.id)), '[]'::jsonb),
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
        select r.id, r.rating, r.title, r.body, r.created_at,
               case when r.reply_hidden_at is null then r.seller_reply end as seller_reply,
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
                 where c1.id = p.category_id))
        order by (pr.product_id is not null) desc, pr.score desc nulls last,
                 q.units_sold_30d desc, q.id
        limit 8
      ) rel), '[]'::jsonb)
  )
  from viewer v
  join public.products p
    on p.slug = p_slug
   and (p.status = 'active' or v.staff or p.created_by_seller_id = any (v.sellers))
  join public.categories cat on cat.id = p.category_id
  left join public.brands b on b.id = p.brand_id;
$$;

-- What the author of a review reads on their own order page: which of their
-- reviews on this order are hidden, and why. Never who hid it.
create or replace function public.my_order_reviews(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  select o.id into v_order from public.orders o
  where o.order_number = left(p_order_number, 20) and o.user_id = v_user;
  if not found then
    perform private.fail('order_not_found');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_item_id', r.order_item_id,
      'hidden', r.status <> 'published',
      'hidden_reason', case when r.status <> 'published' then coalesce(r.hidden_reason, 'rules') end,
      'hidden_at', case when r.status <> 'published' then coalesce(r.hidden_at, r.updated_at) end,
      'reply_hidden', r.reply_hidden_at is not null and r.seller_reply is not null,
      'reply_hidden_reason', case when r.seller_reply is not null then r.reply_hidden_reason end
    ) order by r.order_item_id)
    from public.reviews r
    join public.order_items i on i.id = r.order_item_id
    where i.order_id = v_order and r.user_id = v_user), '[]'::jsonb);
end;
$$;

-- ═══ 4. Categories ═════════════════════════════════════════════════════════

-- Every category, shown or hidden, in tree order, with what staff need to
-- decide: products in it, whether it shows, its commission, its old addresses.
create or replace function public.ops_catalog_categories() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_default integer := (select s.default_referral_bps from public.fee_schedules s where s.active);
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    with recursive tree as (
      -- Each step of the path is the sort and the address, so siblings that
      -- share a sort still keep their own sub-categories right under them.
      select c.id, array[lpad(c.sort::text, 6, '0') || '/' || c.slug] as path, 1 as depth
      from public.categories c where c.parent_id is null
      union all
      select c.id, tree.path || (lpad(c.sort::text, 6, '0') || '/' || c.slug), tree.depth + 1
      from public.categories c join tree on c.parent_id = tree.id
      where tree.depth < 10
    )
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'parent_id', c.parent_id,
      'parent_slug', parent.slug,
      'name_es', c.name_es,
      'name_en', c.name_en,
      'sort', c.sort,
      'depth', t.depth,
      'active', c.active,
      'visible', private.category_visible(c.id),
      'child_count', (select count(*) from public.categories ch where ch.parent_id = c.id),
      'product_count', (select count(*) from public.products p
                        where p.category_id = c.id and p.status <> 'archived'),
      'active_product_count', (select count(*) from public.products p
                               where p.category_id = c.id and p.status = 'active'),
      'in_use', exists (select 1 from public.products p where p.category_id = c.id)
                or exists (select 1 from public.order_items i where i.category_id = c.id),
      'referral_bps', coalesce(private.referral_bps_for_category(c.id), v_default),
      'own_referral', c.referral_bps is not null,
      'aliases', coalesce((select jsonb_agg(a.slug order by a.created_at desc, a.slug)
                           from public.category_slug_aliases a where a.category_id = c.id), '[]'::jsonb)
    ) order by t.path)
    from tree t
    join public.categories c on c.id = t.id
    left join public.categories parent on parent.id = c.parent_id), '[]'::jsonb);
end;
$$;

-- A new category, at the end of its siblings, shown at once. Its commission is
-- its parent's (a new department: the schedule's default); its default IVA is
-- its parent's.
create or replace function public.ops_create_category(
  p_name_es text,
  p_name_en text default null,
  p_slug text default null,
  p_parent_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_text(p_name_es);
  v_name_en text := coalesce(private.clean_text(p_name_en), private.clean_text(p_name_es));
  v_slug text := coalesce(nullif(lower(trim(p_slug)), ''), private.slugify(p_name_es));
  v_parent public.categories%rowtype;
  v_id uuid;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if v_name is null or char_length(v_name) not between 2 and 60
     or char_length(v_name_en) > 60 then
    perform private.fail('category_name_invalid');
  end if;
  -- The depth and the sibling names are checked against the tree as it is:
  -- a move under way (ops_move_category) must finish first, or a child could
  -- land below the depth limit once its ancestor has moved.
  perform pg_advisory_xact_lock(hashtext('yuntera.category_tree'));
  if p_parent_id is not null then
    select * into v_parent from public.categories where id = p_parent_id for update;
    if not found then
      perform private.fail('category_not_found');
    end if;
    if private.category_depth(p_parent_id) >= private.category_max_depth() then
      perform private.fail('category_too_deep');
    end if;
  end if;
  -- One at a time: two staff creating the same address must not both pass the check.
  perform pg_advisory_xact_lock(hashtext('yuntera.category_paths'));
  perform private.check_category_slug(v_slug, null);
  if private.category_name_taken(v_name, p_parent_id, null) then
    perform private.fail('category_name_taken');
  end if;

  insert into public.categories (parent_id, slug, name_es, name_en, default_tax_rate_bps, sort, active)
  values (p_parent_id, v_slug, v_name, v_name_en, coalesce(v_parent.default_tax_rate_bps, 1300),
          coalesce((select max(c.sort) + 1 from public.categories c
                    where c.parent_id is not distinct from p_parent_id), 1),
          true)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end;
$$;

-- Renames a category: its name, its address, or both. The old address keeps
-- working as a redirect. Products filed directly in it get their search
-- document refreshed (the category's name is part of it).
create or replace function public.ops_update_category(
  p_category_id uuid,
  p_name_es text,
  p_name_en text default null,
  p_slug text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.categories%rowtype;
  v_name text := private.clean_text(p_name_es);
  v_name_en text;
  v_slug text;
  r record;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  -- Sibling names are checked against the tree as it is (see ops_create_category).
  perform pg_advisory_xact_lock(hashtext('yuntera.category_tree'));
  select * into c from public.categories where id = p_category_id for update;
  if not found then
    perform private.fail('category_not_found');
  end if;
  v_name := coalesce(v_name, c.name_es);
  v_name_en := coalesce(private.clean_text(p_name_en),
                        case when v_name is distinct from c.name_es and c.name_en = c.name_es
                             then v_name else c.name_en end);
  v_slug := coalesce(nullif(lower(trim(p_slug)), ''), c.slug);
  if char_length(v_name) not between 2 and 60 or char_length(v_name_en) > 60 then
    perform private.fail('category_name_invalid');
  end if;
  if v_name = c.name_es and v_name_en = c.name_en and v_slug = c.slug then
    perform private.fail('category_unchanged');
  end if;
  if private.fold(v_name) is distinct from private.fold(c.name_es)
     and private.category_name_taken(v_name, c.parent_id, c.id) then
    perform private.fail('category_name_taken');
  end if;

  if v_slug <> c.slug then
    perform pg_advisory_xact_lock(hashtext('yuntera.category_paths'));
    perform private.check_category_slug(v_slug, c.id);
    -- Going back to an address it had before: that one is live again.
    delete from public.category_slug_aliases where slug = v_slug and category_id = c.id;
    insert into public.category_slug_aliases (slug, category_id) values (c.slug, c.id);
  end if;

  update public.categories set name_es = v_name, name_en = v_name_en, slug = v_slug where id = c.id;

  if v_name <> c.name_es then
    for r in select p.id from public.products p where p.category_id = c.id order by p.id loop
      perform private.refresh_product_search(r.id);
    end loop;
  end if;
  return jsonb_build_object('id', c.id, 'slug', v_slug, 'previous_slug',
                            case when v_slug <> c.slug then c.slug end);
end;
$$;

-- Moves a category (with everything under it) under another parent, or to the
-- top (no parent), as the last of its new siblings. Refused when it would make
-- a loop, go deeper than three levels, or change what listed products pay in
-- commission.
create or replace function public.ops_move_category(
  p_category_id uuid,
  p_parent_id uuid default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.categories%rowtype;
  v_height integer;
  v_before jsonb;
  v_after jsonb;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  -- The whole tree's shape is checked, so moves happen one at a time.
  perform pg_advisory_xact_lock(hashtext('yuntera.category_tree'));
  select * into c from public.categories where id = p_category_id for update;
  if not found then
    perform private.fail('category_not_found');
  end if;
  if p_parent_id is not distinct from c.parent_id then
    perform private.fail('category_unchanged');
  end if;
  if p_parent_id is not null then
    if not exists (select 1 from public.categories where id = p_parent_id) then
      perform private.fail('category_not_found');
    end if;
    if p_parent_id in (select t.id from private.category_subtree(c.id) t) then
      perform private.fail('category_cycle');
    end if;
  end if;
  select max(t.below) into v_height from private.category_subtree(c.id) t;
  if coalesce(private.category_depth(p_parent_id), 0) + 1 + v_height > private.category_max_depth() then
    perform private.fail('category_too_deep');
  end if;
  if private.category_name_taken(c.name_es, p_parent_id, c.id) then
    perform private.fail('category_name_taken');
  end if;

  select coalesce(jsonb_object_agg(x.category_id, x.referral_bps), '{}') into v_before
  from private.subtree_listed_rates(c.id) x;

  update public.categories
  set parent_id = p_parent_id,
      sort = coalesce((select max(s.sort) + 1 from public.categories s
                       where s.parent_id is not distinct from p_parent_id and s.id <> c.id), 1)
  where id = c.id;
  perform private.renumber_categories(c.parent_id);

  select coalesce(jsonb_object_agg(x.category_id, x.referral_bps), '{}') into v_after
  from private.subtree_listed_rates(c.id) x;
  if v_before <> v_after then
    -- Raising rolls the move back: commissions change in a migration only.
    perform private.fail('category_move_changes_fees');
  end if;
end;
$$;

-- Moves a category one place up (-1) or down (+1) among its siblings.
create or replace function public.ops_shift_category(p_category_id uuid, p_direction integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.categories%rowtype;
  v_other public.categories%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    perform private.fail('category_unchanged');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.category_tree'));
  select * into c from public.categories where id = p_category_id;
  if not found then
    perform private.fail('category_not_found');
  end if;
  perform private.renumber_categories(c.parent_id);
  select * into c from public.categories where id = p_category_id for update;
  select * into v_other from public.categories s
  where s.parent_id is not distinct from c.parent_id and s.sort = c.sort + p_direction
  for update;
  if not found then
    perform private.fail('category_at_edge');
  end if;
  update public.categories set sort = v_other.sort where id = c.id;
  update public.categories set sort = c.sort where id = v_other.id;
end;
$$;

-- Shows or hides a category (and, in the shop, everything under it). Its
-- products stay on sale, in search and at their own address.
create or replace function public.ops_set_category_active(p_category_id uuid, p_active boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if p_active is null then
    perform private.fail('category_unchanged');
  end if;
  update public.categories set active = p_active where id = p_category_id and active <> p_active;
  if not found then
    if exists (select 1 from public.categories where id = p_category_id) then
      perform private.fail('category_unchanged');
    end if;
    perform private.fail('category_not_found');
  end if;
end;
$$;

-- Deletes a category nothing uses: no products (in any state), no orders that
-- name it, no sub-categories. Anything else is hidden instead.
create or replace function public.ops_delete_category(p_category_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.categories%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.category_tree'));
  select * into c from public.categories where id = p_category_id for update;
  if not found then
    perform private.fail('category_not_found');
  end if;
  if exists (select 1 from public.categories ch where ch.parent_id = c.id) then
    perform private.fail('category_has_children');
  end if;
  if exists (select 1 from public.products p where p.category_id = c.id)
     or exists (select 1 from public.order_items i where i.category_id = c.id) then
    perform private.fail('category_in_use');
  end if;
  delete from public.categories where id = c.id;
  perform private.renumber_categories(c.parent_id);
end;
$$;

-- ═══ 5. Brands ═════════════════════════════════════════════════════════════

create or replace function public.ops_catalog_brands() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'slug', b.slug,
      'name', b.name,
      'active', b.active,
      'aliases', to_jsonb(b.aliases),
      'former_slugs', to_jsonb(b.former_slugs),
      'merged_into', case when m.id is not null
                          then jsonb_build_object('id', m.id, 'name', m.name, 'slug', m.slug) end,
      'merged_at', b.merged_at,
      'product_count', (select count(*) from public.products p
                        where p.brand_id = b.id and p.status <> 'archived'),
      'active_product_count', (select count(*) from public.products p
                               where p.brand_id = b.id and p.status = 'active')
    ) order by (b.merged_into_id is not null), private.fold(b.name), b.slug)
    from public.brands b
    left join public.brands m on m.id = b.merged_into_id), '[]'::jsonb);
end;
$$;

-- Whether a brand name is already some brand's name or old name.
create or replace function private.brand_name_taken(p_name text, p_except uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.brands b
    where b.id is distinct from p_except
      and (private.fold(b.name) = private.fold(p_name)
           or private.fold(p_name) = any (select private.fold(a) from unnest(b.aliases) a)));
$$;

create or replace function public.ops_create_brand(p_name text, p_slug text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_text(p_name);
  v_slug text := coalesce(nullif(lower(trim(p_slug)), ''), private.slugify(p_name));
  v_id uuid;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if v_name is null or char_length(v_name) not between 2 and 60 then
    perform private.fail('brand_name_invalid');
  end if;
  if v_slug is null or char_length(v_slug) not between 2 and 60
     or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    perform private.fail('brand_slug_invalid');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.brands'));
  if private.brand_name_taken(v_name, null) then
    perform private.fail('brand_name_taken');
  end if;
  if exists (select 1 from public.brands b where b.slug = v_slug or v_slug = any (b.former_slugs)) then
    perform private.fail('brand_slug_taken');
  end if;
  insert into public.brands (slug, name) values (v_slug, v_name) returning id into v_id;
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'name', v_name);
end;
$$;

-- Renames a brand. The old name stays as a search alias, so a shopper who
-- types it still finds the products, and an old filter address (?marca=)
-- keeps showing the brand.
create or replace function public.ops_update_brand(
  p_brand_id uuid, p_name text, p_slug text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b public.brands%rowtype;
  v_name text;
  v_slug text;
  v_former text[];
  r record;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.brands'));
  select * into b from public.brands where id = p_brand_id for update;
  if not found then
    perform private.fail('brand_not_found');
  end if;
  if b.merged_into_id is not null then
    perform private.fail('brand_merged');
  end if;
  v_name := coalesce(private.clean_text(p_name), b.name);
  v_slug := coalesce(nullif(lower(trim(p_slug)), ''), b.slug);
  if char_length(v_name) not between 2 and 60 then
    perform private.fail('brand_name_invalid');
  end if;
  if char_length(v_slug) not between 2 and 60 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    perform private.fail('brand_slug_invalid');
  end if;
  if v_name = b.name and v_slug = b.slug then
    perform private.fail('brand_unchanged');
  end if;
  if private.fold(v_name) <> private.fold(b.name) and exists (
       select 1 from public.brands o
       where o.id <> b.id
         and (private.fold(o.name) = private.fold(v_name)
              or private.fold(v_name) = any (select private.fold(a) from unnest(o.aliases) a))) then
    perform private.fail('brand_name_taken');
  end if;
  if v_slug <> b.slug and exists (
       select 1 from public.brands o
       where o.id <> b.id and (o.slug = v_slug or v_slug = any (o.former_slugs))) then
    perform private.fail('brand_slug_taken');
  end if;
  if v_slug <> b.slug then
    -- The old address keeps showing this brand (going back to an earlier one
    -- makes it live again); the newest twenty are kept.
    v_former := array_remove(b.former_slugs, v_slug) || b.slug;
    v_former := v_former[greatest(1, cardinality(v_former) - 19):];
  else
    v_former := b.former_slugs;
  end if;

  update public.brands
  set name = v_name, slug = v_slug, former_slugs = v_former,
      aliases = case
        when private.fold(v_name) = private.fold(b.name) then
          array(select a from unnest(b.aliases) a where private.fold(a) <> private.fold(v_name))
        else (array(select distinct a from unnest(b.aliases || b.name) a
                    where private.fold(a) <> private.fold(v_name)))[1:20]
      end
  where id = b.id;
  if v_name <> b.name then
    for r in select p.id from public.products p where p.brand_id = b.id order by p.id loop
      perform private.refresh_product_search(r.id);
    end loop;
  end if;
  return jsonb_build_object('id', b.id, 'slug', v_slug, 'name', v_name);
end;
$$;

-- Shows or hides a brand in the shop's filter. Its products keep it.
create or replace function public.ops_set_brand_active(p_brand_id uuid, p_active boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  b public.brands%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  select * into b from public.brands where id = p_brand_id for update;
  if not found then
    perform private.fail('brand_not_found');
  end if;
  if b.merged_into_id is not null then
    perform private.fail('brand_merged');
  end if;
  if p_active is null or b.active = p_active then
    perform private.fail('brand_unchanged');
  end if;
  update public.brands set active = p_active where id = b.id;
end;
$$;

-- Merges a duplicate brand into another: its products move, its name (and its
-- old names) become search aliases of the other, and it stays behind, hidden,
-- pointing at the other (so its filter address still shows something).
create or replace function public.ops_merge_brands(p_from_id uuid, p_into_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from public.brands%rowtype;
  v_into public.brands%rowtype;
  v_moved integer;
  r record;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if p_from_id is null or p_into_id is null or p_from_id = p_into_id then
    perform private.fail('brand_merge_same');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.brands'));
  -- Both rows, in a fixed order.
  perform 1 from public.brands where id in (p_from_id, p_into_id) order by id for update;
  select * into v_from from public.brands where id = p_from_id;
  select * into v_into from public.brands where id = p_into_id;
  if v_from.id is null or v_into.id is null then
    perform private.fail('brand_not_found');
  end if;
  if v_from.merged_into_id is not null or v_into.merged_into_id is not null then
    perform private.fail('brand_merged');
  end if;
  -- Into a brand out of the filter, the moved products would leave the filter
  -- too. Show it again first, if it is the one that stays.
  if not v_into.active then
    perform private.fail('brand_merge_into_hidden');
  end if;

  -- The names first: the products' search documents are rebuilt from them.
  update public.brands
  set aliases = (array(select distinct a from unnest(v_into.aliases || v_from.name || v_from.aliases) a
                       where private.fold(a) <> private.fold(v_into.name)))[1:20]
  where id = v_into.id;
  update public.brands
  set active = false, merged_into_id = v_into.id, merged_at = now(), aliases = '{}'
  where id = v_from.id;
  -- Brands merged into the old one earlier now point at the survivor.
  update public.brands set merged_into_id = v_into.id where merged_into_id = v_from.id;

  update public.products set brand_id = v_into.id where brand_id = v_from.id;
  get diagnostics v_moved = row_count;
  for r in select p.id from public.products p where p.brand_id = v_into.id order by p.id loop
    perform private.refresh_product_search(r.id);
  end loop;

  perform private.catalog_audit('MERGE', 'brands', v_from.id::text,
    jsonb_build_object('name', v_from.name, 'slug', v_from.slug),
    jsonb_build_object('merged_into', v_into.name, 'products_moved', v_moved));
  return jsonb_build_object('into_id', v_into.id, 'moved', v_moved);
end;
$$;

-- ═══ 6. Search synonyms ════════════════════════════════════════════════════

create or replace function public.ops_search_synonyms() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('term', s.term, 'expansions', to_jsonb(s.expansions),
                                        'created_at', s.created_at) order by s.term)
    from public.search_synonyms s), '[]'::jsonb);
end;
$$;

-- Refuses a word or phrase that cannot be a synonym. `p_folded` is already
-- private.search_term of what was typed.
create or replace function private.check_synonym(p_folded text) returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_active bigint;
  v_matching bigint;
begin
  if p_folded is null or char_length(p_folded) < 2 or char_length(p_folded) > 60
     or p_folded !~ '^[a-z0-9]+([ -][a-z0-9]+)*$'
     or array_length(string_to_array(p_folded, ' '), 1) > 4 then
    perform private.fail('synonym_invalid');
  end if;
  -- Words search ignores ("de", "la", "con"): as a term it would widen every
  -- query that has them, as an expansion it would add nothing.
  if numnode(plainto_tsquery('public.es', p_folded)) = 0 then
    perform private.fail('synonym_too_common');
  end if;
  -- Something nearly every listing matches says nothing about what was searched.
  select count(*), count(*) filter (where p.search_vector @@ plainto_tsquery('public.es', p_folded))
  into v_active, v_matching
  from public.products p where p.status = 'active';
  if v_active >= 10 and v_matching * 10 >= v_active * 9 then
    perform private.fail('synonym_too_common');
  end if;
end;
$$;

-- Adds a synonym: a word or phrase shoppers type, and what it should also find.
create or replace function public.ops_add_search_synonym(p_term text, p_expansions text[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_term text := private.search_term(p_term);
  v_expansions text[];
  v_one text;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  perform private.check_synonym(v_term);
  v_expansions := array(select private.search_term(e) from unnest(coalesce(p_expansions, '{}')) e
                        where private.search_term(e) is not null);
  if cardinality(v_expansions) = 0 then
    perform private.fail('synonym_invalid');
  end if;
  if cardinality(v_expansions) > 8 then
    perform private.fail('synonym_too_many');
  end if;
  if (select count(distinct e) from unnest(v_expansions) e) <> cardinality(v_expansions)
     or v_term = any (v_expansions) then
    perform private.fail('synonym_duplicate');
  end if;
  foreach v_one in array v_expansions loop
    perform private.check_synonym(v_one);
  end loop;
  insert into public.search_synonyms (term, expansions, created_by)
  values (v_term, v_expansions, (select auth.uid()))
  on conflict (term) do nothing;
  if not found then
    perform private.fail('synonym_exists');
  end if;
  return jsonb_build_object('term', v_term, 'expansions', to_jsonb(v_expansions));
end;
$$;

create or replace function public.ops_remove_search_synonym(p_term text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  delete from public.search_synonyms where term = private.search_term(p_term);
  if not found then
    perform private.fail('synonym_not_found');
  end if;
end;
$$;

-- What a query finds in the shop right now, and which synonyms widen it: the
-- same search a shopper gets (bounded, folded), its first ten results.
create or replace function public.ops_search_preview(p_query text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_query text := private.bounded_search_text(p_query);
  v_folded text := nullif(trim(private.fold(coalesce(private.bounded_search_text(p_query), ''))), '');
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if v_folded is null then
    perform private.fail('synonym_invalid');
  end if;
  return jsonb_build_object(
    'query', v_folded,
    'synonyms', coalesce((
      select jsonb_agg(jsonb_build_object('term', s.term, 'expansions', to_jsonb(s.expansions))
                       order by s.term)
      from public.search_synonyms s
      where s.term = v_folded or s.term = any (string_to_array(v_folded, ' '))), '[]'::jsonb),
    'total', coalesce((select max(r.total_count) from private.search_products_unbounded(v_query) r), 0),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object('slug', r.slug, 'title', r.title, 'brand_name', r.brand_name,
                                          'category_slug', r.category_slug))
      from private.search_products_unbounded(v_query, p_limit => 10) r), '[]'::jsonb));
end;
$$;

-- ═══ 7. Reviews ════════════════════════════════════════════════════════════

-- Reviews for staff, newest first, 50 at a time, with a filter: all, reported
-- (an open report about it), low (one or two stars), replied (the seller
-- answered), hidden (the review or the reply). Of the reviewer, only what the
-- shop shows ("María F."); never the account, the e-mail or the order.
create or replace function public.ops_reviews(
  p_filter text default 'all',
  p_review_id uuid default null,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_page constant integer := 50;
  v_filter text := coalesce(p_filter, 'all');
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if v_filter not in ('all', 'reported', 'low', 'replied', 'hidden') then
    perform private.fail('review_filter_invalid');
  end if;
  return (
    with chosen as (
      select r.*,
             (select count(*) from public.content_reports cr
              where cr.target_type = 'review' and cr.target_id = r.id
                and cr.status in ('open', 'in_review')) as open_reports
      from public.reviews r
      where (p_review_id is null or r.id = p_review_id)
    ),
    filtered as (
      select * from chosen ch
      where case v_filter
        when 'reported' then ch.open_reports > 0
        when 'low' then ch.rating <= 2
        when 'replied' then ch.seller_reply is not null
        when 'hidden' then ch.status <> 'published' or ch.reply_hidden_at is not null
        else true
      end
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'page_size', c_page,
      'reviews', coalesce((
        select jsonb_agg(x.item order by x.created_at desc, x.id)
        from (
          select f.created_at, f.id, jsonb_build_object(
            'id', f.id,
            'product_slug', p.slug,
            'product_title', p.title,
            'seller_name', s.trade_name,
            'rating', f.rating,
            'title', f.title,
            'body', f.body,
            'created_at', f.created_at,
            'author', public.reviewer_display_name(f.user_id),
            'hidden', f.status <> 'published',
            'hidden_reason', case when f.status <> 'published' then coalesce(f.hidden_reason, 'rules') end,
            'hidden_at', case when f.status <> 'published' then coalesce(f.hidden_at, f.updated_at) end,
            'seller_reply', f.seller_reply,
            'seller_replied_at', f.seller_replied_at,
            'reply_hidden', f.reply_hidden_at is not null,
            'reply_hidden_reason', f.reply_hidden_reason,
            'open_reports', f.open_reports,
            'report_reasons', coalesce((
              select jsonb_agg(distinct cr.reason)
              from public.content_reports cr
              where cr.target_type = 'review' and cr.target_id = f.id
                and cr.status in ('open', 'in_review')), '[]'::jsonb)
          ) as item
          from filtered f
          join public.products p on p.id = f.product_id
          left join public.order_items i on i.id = f.order_item_id
          left join public.sellers s on s.id = i.seller_id
          order by f.created_at desc, f.id
          limit c_page offset v_offset
        ) x), '[]'::jsonb)));
end;
$$;

create or replace function public.ops_hide_review(p_review_id uuid, p_reason text, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  perform private.hide_review(p_review_id, p_reason, private.clean_text(p_note));
end;
$$;

-- Shows a hidden review again: it counts in the rating again at once.
create or replace function public.ops_show_review(p_review_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reviews%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  select * into r from public.reviews where id = p_review_id for update;
  if not found then
    perform private.fail('review_not_found');
  end if;
  if r.status = 'published' then
    perform private.fail('review_not_hidden');
  end if;
  update public.reviews
  set status = 'published', hidden_reason = null, hidden_at = null, hidden_by = null,
      moderation_note = null
  where id = r.id;
  perform private.catalog_audit('SHOW', 'reviews', r.id::text,
    jsonb_build_object('status', r.status, 'reason', r.hidden_reason),
    jsonb_build_object('status', 'published', 'product_id', r.product_id, 'rating', r.rating));
end;
$$;

-- Hides only the seller's reply: the review and the rating stay.
create or replace function public.ops_hide_review_reply(
  p_review_id uuid, p_reason text, p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reviews%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if not private.review_hide_reason_ok(p_reason) then
    perform private.fail('review_reason_invalid');
  end if;
  select * into r from public.reviews where id = p_review_id for update;
  if not found then
    perform private.fail('review_not_found');
  end if;
  if r.seller_reply is null then
    perform private.fail('review_has_no_reply');
  end if;
  if r.reply_hidden_at is not null then
    perform private.fail('review_reply_already_hidden');
  end if;
  update public.reviews
  set reply_hidden_reason = p_reason, reply_hidden_at = now(), reply_hidden_by = (select auth.uid())
  where id = r.id;
  perform private.catalog_audit('HIDE_REPLY', 'reviews', r.id::text, null,
    jsonb_build_object('reason', p_reason, 'note', left(private.clean_text(p_note), 500),
                       'product_id', r.product_id));
end;
$$;

create or replace function public.ops_show_review_reply(p_review_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.reviews%rowtype;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  select * into r from public.reviews where id = p_review_id for update;
  if not found then
    perform private.fail('review_not_found');
  end if;
  if r.reply_hidden_at is null then
    perform private.fail('review_reply_not_hidden');
  end if;
  update public.reviews
  set reply_hidden_reason = null, reply_hidden_at = null, reply_hidden_by = null
  where id = r.id;
  perform private.catalog_audit('SHOW_REPLY', 'reviews', r.id::text,
    jsonb_build_object('reason', r.reply_hidden_reason), jsonb_build_object('product_id', r.product_id));
end;
$$;

-- Replaces the version in 20261121081700_api_backoffice.sql. Acting on a
-- report now goes through the same doors as the console's own screens: a
-- product is taken down as a staff take-down (it can be put back, and the
-- seller is told), and a review is hidden with the reason closest to what was
-- reported (other open reports about it close with it). Everything else is
-- as before.
create or replace function public.ops_resolve_report(
  p_report_id uuid,
  p_action boolean,
  p_resolution text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_report public.content_reports%rowtype;
begin
  if not private.has_staff_role('catalog', 'support', 'ops') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_resolution)), 0) < 10 then
    perform private.fail('reason_required');
  end if;
  select * into v_report from public.content_reports where id = p_report_id for update;
  if not found or v_report.status not in ('open', 'in_review') then
    perform private.fail('report_not_found');
  end if;

  if p_action and v_report.target_type = 'product' then
    if exists (select 1 from public.products where id = v_report.target_id and status = 'active') then
      perform private.take_down_product(v_report.target_id, p_resolution);
    else
      update public.products
      set status = 'rejected', rejection_reason = trim(p_resolution)
      where id = v_report.target_id and status = 'pending_review';
    end if;
  elsif p_action and v_report.target_type = 'review' then
    if exists (select 1 from public.reviews where id = v_report.target_id and status = 'published') then
      perform private.hide_review(v_report.target_id,
        case v_report.reason
          when 'abuse' then 'offensive'
          when 'misleading' then 'not_genuine'
          when 'illegal_product' then 'illegal'
          when 'counterfeit' then 'illegal'
          when 'unsafe' then 'illegal'
          when 'intellectual_property' then 'illegal'
          else 'rules'
        end,
        trim(p_resolution), p_report_id);
    end if;
  end if;
  -- A reported seller is handled with ops_set_seller_status, which has its own rules.

  update public.content_reports
  set status = case when p_action then 'actioned' else 'dismissed' end::public.report_status,
      resolution = trim(p_resolution), resolved_by = (select auth.uid()), resolved_at = now()
  where id = p_report_id;

  perform private.emit('report.resolved',
    jsonb_build_object('report_id', p_report_id, 'actioned', p_action));
end;
$$;

-- ═══ 8. Staff corrections to a product ═════════════════════════════════════

-- A product as catalogue staff need it to correct it: where it is filed, its
-- brand, whether it is on sale or taken down, and whether a seller's edit is
-- waiting (which must be decided first). By its address in the shop or its id.
create or replace function public.ops_catalog_product(p_ref text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_ref text := lower(trim(coalesce(p_ref, '')));
  v_default integer := (select s.default_referral_bps from public.fee_schedules s where s.active);
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if v_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into p from public.products where id = v_ref::uuid;
  else
    select * into p from public.products where slug = left(v_ref, 120);
  end if;
  if not found then
    perform private.fail('catalog_product_not_found');
  end if;
  return jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'title', p.title,
    'status', p.status,
    'seller_name', (select s.trade_name from public.sellers s where s.id = p.created_by_seller_id),
    'category', (select jsonb_build_object('id', c.id, 'slug', c.slug, 'name_es', c.name_es,
                                           'visible', private.category_visible(c.id))
                 from public.categories c where c.id = p.category_id),
    'brand', (select jsonb_build_object('id', b.id, 'name', b.name)
              from public.brands b where b.id = p.brand_id),
    'referral_bps', coalesce(private.referral_bps_for_category(p.category_id), v_default),
    'tax_rate_bps', p.tax_rate_bps,
    'rejection_reason', p.rejection_reason,
    'taken_down', p.status = 'rejected' and p.taken_down_at is not null,
    'taken_down_at', case when p.status = 'rejected' then p.taken_down_at end,
    'changed_since_take_down', p.status = 'rejected' and p.taken_down_at is not null
                               and p.taken_down_fingerprint is distinct from private.listing_fingerprint(p.id),
    'edit_pending', exists (select 1 from public.product_change_requests r
                            where r.product_id = p.id and r.status = 'pending'),
    'offer_count', p.offer_count,
    'rating_sum', p.rating_sum,
    'rating_count', p.rating_count);
end;
$$;

-- Catalogue staff correct where a product is filed and its brand, without the
-- seller. The listing's shop is told what changed, why, and what it means for
-- its commission and IVA. Refused while the seller's own edit waits (decide
-- that first), and when one of its offers would then sell below what the fees
-- cost.
create or replace function public.ops_correct_product(
  p_product_id uuid,
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_clear_brand boolean default false,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_note text := private.clean_text(p_note);
  v_category public.categories%rowtype;
  v_old_category public.categories%rowtype;
  v_brand public.brands%rowtype;
  v_old_brand text;
  v_new_brand_id uuid;
  v_tax integer;
  v_default integer := (select s.default_referral_bps from public.fee_schedules s where s.active);
  v_old_bps integer;
  v_new_bps integer;
  v_take_down_intact boolean;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(v_note), 0) < 10 then
    -- The seller is owed an explanation.
    perform private.fail('reason_required');
  end if;
  select * into p from public.products where id = p_product_id for update;
  if not found then
    perform private.fail('catalog_product_not_found');
  end if;
  if p.status not in ('active', 'pending_review', 'rejected') then
    perform private.fail('product_not_correctable');
  end if;
  if exists (select 1 from public.product_change_requests r
             where r.product_id = p.id and r.status = 'pending') then
    perform private.fail('listing_edit_pending');
  end if;

  select * into v_old_category from public.categories where id = p.category_id;
  v_category := v_old_category;
  if p_category_id is not null and p_category_id <> p.category_id then
    select * into v_category from public.categories where id = p_category_id and active;
    if not found then
      perform private.fail('category_not_found');
    end if;
  end if;

  v_new_brand_id := p.brand_id;
  if p_clear_brand then
    v_new_brand_id := null;
  elsif p_brand_id is not null and p_brand_id is distinct from p.brand_id then
    select * into v_brand from public.brands
    where id = p_brand_id and active and merged_into_id is null;
    if not found then
      perform private.fail('brand_not_found');
    end if;
    v_new_brand_id := v_brand.id;
  end if;

  if v_category.id = p.category_id and v_new_brand_id is not distinct from p.brand_id then
    perform private.fail('correction_unchanged');
  end if;

  -- No offer of it may sell at a loss in its new category.
  if v_category.id <> p.category_id and exists (
    select 1 from public.offers o join public.skus k on k.id = o.sku_id
    where k.product_id = p.id and o.status = 'active'
      and private.worst_unit_payout(o.price_minor, o.fulfillment, v_category.id, k.weight_grams,
                                    greatest(k.length_cm, k.width_cm, k.height_cm)) < 0) then
    perform private.fail('correction_below_fee_floor');
  end if;

  v_old_bps := coalesce(private.referral_bps_for_category(p.category_id), v_default);
  v_new_bps := coalesce(private.referral_bps_for_category(v_category.id), v_default);
  -- As when an edit that changes the category is approved: the new
  -- category's IVA applies (20261121082400_fixes.sql, ops_review_listing_edit).
  v_tax := case when v_category.id <> p.category_id then v_category.default_tax_rate_bps
                else p.tax_rate_bps end;
  select b.name into v_old_brand from public.brands b where b.id = p.brand_id;

  v_take_down_intact := p.taken_down_at is not null
                        and p.taken_down_fingerprint = private.listing_fingerprint(p.id);
  update public.products
  set category_id = v_category.id, brand_id = v_new_brand_id, tax_rate_bps = v_tax
  where id = p.id;
  -- A taken-down listing that staff correct is what they would put back: the
  -- correction is not a seller's change. Only when the seller had changed
  -- nothing before it, so a correction never makes a seller's edit look reviewed.
  if v_take_down_intact then
    update public.products set taken_down_fingerprint = private.listing_fingerprint(p.id)
    where id = p.id;
  end if;

  perform private.catalog_audit('CORRECT', 'products', p.id::text,
    jsonb_build_object('category', v_old_category.slug, 'brand', v_old_brand, 'tax_rate_bps', p.tax_rate_bps),
    jsonb_build_object('category', v_category.slug,
                       'brand', (select b.name from public.brands b where b.id = v_new_brand_id),
                       'tax_rate_bps', v_tax, 'note', left(v_note, 500)));

  if p.created_by_seller_id is not null then
    perform private.emit('product.staff_changed', jsonb_strip_nulls(jsonb_build_object(
      'product_id', p.id, 'seller_id', p.created_by_seller_id, 'kind', 'corrected',
      'note', left(v_note, 400),
      -- The message says it is still on sale only when it is.
      'on_sale', p.status = 'active',
      'from_category', case when v_category.id <> p.category_id then v_old_category.name_es end,
      'to_category', case when v_category.id <> p.category_id then v_category.name_es end,
      'brand_changed', v_new_brand_id is distinct from p.brand_id,
      'from_brand', case when v_new_brand_id is distinct from p.brand_id then v_old_brand end,
      'to_brand', case when v_new_brand_id is distinct from p.brand_id
                       then (select b.name from public.brands b where b.id = v_new_brand_id) end,
      'from_referral_bps', case when v_old_bps <> v_new_bps then v_old_bps end,
      'to_referral_bps', case when v_old_bps <> v_new_bps then v_new_bps end,
      'from_tax_bps', case when v_tax <> p.tax_rate_bps then p.tax_rate_bps end,
      'to_tax_bps', case when v_tax <> p.tax_rate_bps then v_tax end)));
  end if;
  return public.ops_catalog_product(p.id::text);
end;
$$;

-- Takes a published product off the shop, with a reason the seller reads.
create or replace function public.ops_take_down_product(p_product_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(private.clean_text(p_reason)), 0) < 10 then
    perform private.fail('reason_required');
  end if;
  perform private.take_down_product(p_product_id, private.clean_text(p_reason));
end;
$$;

-- Puts back a product staff took down (by this screen or from a report),
-- exactly as it was when it was taken down. Not one the seller has changed
-- since (listing_changed_since_take_down), nor one the seller sent to review
-- (that ended the take-down: review decides). The shop must be allowed to trade (the trigger on products
-- says so with listing_shop_not_active).
create or replace function public.ops_restore_product(p_product_id uuid, p_note text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_note text := private.clean_text(p_note);
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(v_note), 0) < 10 then
    perform private.fail('reason_required');
  end if;
  select * into p from public.products where id = p_product_id for update;
  if not found or p.status <> 'rejected' or p.taken_down_at is null then
    perform private.fail('product_not_taken_down');
  end if;
  -- The seller changed it since: what would go on sale has not been reviewed.
  -- The seller sends it to review instead (which ends the take-down).
  if p.taken_down_fingerprint is distinct from private.listing_fingerprint(p.id) then
    perform private.fail('listing_changed_since_take_down');
  end if;
  update public.products
  set status = 'active', rejection_reason = null, taken_down_at = null, taken_down_by = null,
      taken_down_fingerprint = null
  where id = p.id;
  perform private.catalog_audit('RESTORE', 'products', p.id::text,
    jsonb_build_object('status', p.status, 'reason', p.rejection_reason),
    jsonb_build_object('status', 'active', 'note', left(v_note, 500)));
  if p.created_by_seller_id is not null then
    perform private.emit('product.staff_changed', jsonb_build_object(
      'product_id', p.id, 'seller_id', p.created_by_seller_id, 'kind', 'restored',
      'note', left(v_note, 400)));
  end if;
end;
$$;

-- ═══ 9. The seller is told ═════════════════════════════════════════════════

insert into private.outbox_routes (topic, consumer) values ('product.staff_changed', 'notify');

-- Replaces the version in 20261121083200_followups.sql, adding one topic:
-- `product.staff_changed` (a staff correction, take-down or restoration of a
-- listing) becomes `seller_listing_staff_change` for the listing's shop. The
-- table in docs/06-operations/notifications.md says the same, and a test in
-- packages/notifications compares the two.
create or replace function private.notify_plan_event(p_event private.outbox_events) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id bigint := p_event.id;
  p jsonb := p_event.payload;
  v_order public.orders;
  v_ship public.shipments;
  v_key text;
  v_ctx jsonb;
  r record;
begin
  if p ? 'order_id' then
    select * into v_order from public.orders where id = (p ->> 'order_id')::uuid;
  elsif p ? 'shipment_id' then
    select * into v_ship from public.shipments where id = (p ->> 'shipment_id')::uuid;
    select * into v_order from public.orders where id = v_ship.order_id;
  elsif p ? 'return_request_id' then
    select o.* into v_order from public.return_requests rr
    join public.order_items i on i.id = rr.order_item_id
    join public.orders o on o.id = i.order_id
    where rr.id = (p ->> 'return_request_id')::uuid;
  end if;
  v_key := case when v_order.id is not null then 'order:' || v_order.id end;
  v_ctx := jsonb_strip_nulls(jsonb_build_object(
    'order_id', v_order.id,
    'shipment_id', p ->> 'shipment_id',
    'route_id', p ->> 'route_id',
    'return_request_id', p ->> 'return_request_id',
    'amount_minor', p -> 'amount_minor'));

  case p_event.topic
    when 'order.placed' then
      perform private.notify_person(v_id, 'order_placed', v_order.user_id,
        array['email', 'push', 'whatsapp'], v_key, v_ctx);
      if v_order.payment_method in ('sinpe_movil', 'bank_transfer') then
        perform private.notify_team(v_id, 'staff_payment_to_confirm', 'finance', v_key, v_ctx);
      end if;

    when 'payment.captured' then
      perform private.notify_person(v_id, 'payment_received', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'order.released' then
      for r in select distinct i.seller_id from public.order_items i where i.order_id = v_order.id
               order by i.seller_id loop
        perform private.notify_shop(v_id, 'seller_new_order', r.seller_id,
          array['email', 'whatsapp', 'push'], v_key, v_ctx || jsonb_build_object('seller_id', r.seller_id));
      end loop;

    when 'order.cancelled' then
      perform private.notify_person(v_id, 'order_cancelled', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);
      for r in select distinct i.seller_id from public.order_items i where i.order_id = v_order.id
               order by i.seller_id loop
        perform private.notify_shop(v_id, 'seller_order_cancelled', r.seller_id,
          array['email', 'push'], v_key, v_ctx || jsonb_build_object('seller_id', r.seller_id));
      end loop;

    when 'refund.requested' then
      perform private.notify_person(v_id, 'refund_initiated', v_order.user_id,
        array['email'], v_key, v_ctx);

    when 'refund.completed' then
      perform private.notify_person(v_id, 'refund_completed', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'shipment.scheduled' then
      perform private.notify_person(v_id, 'shipment_scheduled', v_order.user_id,
        array['email', 'push'], v_key, v_ctx, 'shopper', 'shop', now() + interval '1 day');

    when 'shipment.out_for_delivery' then
      perform private.notify_person(v_id, 'shipment_out_for_delivery', v_order.user_id,
        array['push', 'whatsapp', 'email', 'sms'], v_key, v_ctx, 'shopper', 'shop',
        now() + interval '4 hours');

    when 'shipment.delivered' then
      perform private.notify_person(v_id, 'shipment_delivered', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'shipment.delivery_failed' then
      perform private.notify_person(v_id, 'shipment_delivery_failed', v_order.user_id,
        array['push', 'whatsapp', 'email', 'sms'], v_key, v_ctx || jsonb_build_object('reason', p ->> 'reason'));
      perform private.notify_team(v_id, 'staff_delivery_failed', 'ops', v_key,
        v_ctx || jsonb_build_object('reason', p ->> 'reason'));

    when 'return.requested' then
      -- A withdrawal of the purchase is approved as it is asked: the shopper
      -- is told how the goods are collected, not that it will be reviewed.
      select rr.kind into r from public.return_requests rr
      where rr.id = (p ->> 'return_request_id')::uuid;
      perform private.notify_person(v_id,
        case when r.kind = 'withdrawal' then 'return_approved' else 'return_received' end,
        v_order.user_id, array['email'], v_key, v_ctx);
      perform private.notify_team(v_id, 'staff_return_requested', 'support', v_key, v_ctx);

    when 'return.decided' then
      perform private.notify_person(v_id,
        case when (p ->> 'approved')::boolean then 'return_approved' else 'return_rejected' end,
        v_order.user_id, array['email', 'push'], v_key, v_ctx);

    when 'return.received' then
      perform private.notify_person(v_id, 'return_goods_received', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'delivery_code.locked' then
      perform private.notify_person(v_id, 'delivery_code_locked', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);
      perform private.notify_team(v_id, 'staff_delivery_code_locked', 'support', v_key, v_ctx);

    when 'delivery_code.released' then
      perform private.notify_person(v_id, 'delivery_code_released', v_order.user_id,
        array['email', 'push'], v_key, v_ctx);

    when 'complaint.filed' then
      select c.user_id, c.order_id into r from public.complaints c where c.id = (p ->> 'complaint_id')::uuid;
      perform private.notify_person(v_id, 'complaint_received', r.user_id, array['email'],
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id', 'order_id', r.order_id)));
      perform private.notify_team(v_id, 'staff_complaint_filed', 'support',
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id', 'order_id', r.order_id)));

    when 'complaint.answered' then
      select c.user_id, c.order_id into r from public.complaints c where c.id = (p ->> 'complaint_id')::uuid;
      perform private.notify_person(v_id, 'complaint_answered', r.user_id, array['email'],
        coalesce('order:' || r.order_id, 'user:' || r.user_id),
        jsonb_strip_nulls(jsonb_build_object('complaint_id', p ->> 'complaint_id',
          'order_id', r.order_id, 'closed', p -> 'closed')));

    when 'content.reported' then
      perform private.notify_team(v_id, 'staff_content_reported', 'trust', 'team:trust',
        jsonb_build_object('report_id', p ->> 'report_id'));

    when 'report.resolved' then
      select cr.reporter_id, cr.reporter_email into r from public.content_reports cr
      where cr.id = (p ->> 'report_id')::uuid;
      if r.reporter_id is not null then
        perform private.notify_person(v_id, 'report_resolved', r.reporter_id, array['email'],
          'user:' || r.reporter_id,
          jsonb_build_object('report_id', p ->> 'report_id', 'actioned', p -> 'actioned'), 'reporter');
      elsif r.reporter_email is not null then
        perform private.notify_add(v_id, 'report_resolved', 'email', 'report:' || (p ->> 'report_id'),
          'reporter', 'report:' || (p ->> 'report_id'),
          jsonb_build_object('report_id', p ->> 'report_id', 'actioned', p -> 'actioned'));
      end if;

    when 'product.reviewed' then
      select pr.created_by_seller_id as seller_id into r from public.products pr
      where pr.id = (p ->> 'product_id')::uuid;
      perform private.notify_shop(v_id,
        case when (p ->> 'approved')::boolean then 'seller_listing_approved' else 'seller_listing_rejected' end,
        r.seller_id, array['email', 'push'], 'seller:' || r.seller_id,
        jsonb_build_object('product_id', p ->> 'product_id', 'seller_id', r.seller_id));

    when 'product.staff_changed' then
      -- Everything the message says comes with the event, as it was decided;
      -- the product's title is read when the message is written.
      perform private.notify_shop(v_id, 'seller_listing_staff_change', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        (p - 'brand_changed') || jsonb_build_object('brand_changed', coalesce(p -> 'brand_changed', 'false')));

    when 'seller.status_changed' then
      perform private.notify_shop(v_id, 'seller_account_status', (p ->> 'seller_id')::uuid,
        array['email'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'status', p ->> 'status', 'note', p ->> 'note'));

    when 'seller.member_invited' then
      -- To the invited account's own, confirmed address; never to what was typed.
      -- At most one message per shop and account in an invitation's life (14
      -- days): renewing an invitation, or revoking and sending it again, emits
      -- the event every time, and without this any shop (one still waiting for
      -- approval too) could send our mail to any account as often as it liked.
      -- The invitation itself still shows in the invited account's seller centre.
      select u.id into r from auth.users u
      where u.id = (p ->> 'invitee_id')::uuid and u.email_confirmed_at is not null and u.deleted_at is null
        and not exists (
          select 1 from private.notification_deliveries d
          where d.template = 'seller_invitation' and d.recipient_user_id = u.id
            and d.context ->> 'seller_id' = p ->> 'seller_id'
            and d.created_at > now() - interval '14 days');
      if r.id is not null then
        perform private.notify_person(v_id, 'seller_invitation', r.id, array['email', 'push'],
          'user:' || r.id,
          jsonb_build_object('invitation_id', p ->> 'invitation_id', 'seller_id', p ->> 'seller_id'),
          'seller', 'seller');
      end if;

    when 'seller.change_decided' then
      perform private.notify_shop(v_id, 'seller_change_decided', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'change_request_id', p ->> 'request_id',
          'change_kind', p ->> 'kind', 'approved', p -> 'approved'));

    when 'payout_details.decided' then
      perform private.notify_shop(v_id, 'seller_payout_account_decided', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'payout_request_id', p ->> 'request_id',
          'approved', p -> 'approved'));

    when 'payout.paid' then
      perform private.notify_shop(v_id, 'seller_payout_paid', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'payout_id', p ->> 'payout_id',
          'amount_minor', p -> 'amount_minor'));

    when 'fees.offers_paused' then
      perform private.notify_shop(v_id, 'seller_offers_paused_fees', (p ->> 'seller_id')::uuid,
        array['email', 'push'], 'seller:' || (p ->> 'seller_id'),
        jsonb_build_object('seller_id', p ->> 'seller_id', 'schedule_version', p ->> 'schedule_version',
          'offer_count', p -> 'offer_count'));

    when 'route.assigned' then
      select d.user_id into r from public.drivers d where d.id = (p ->> 'driver_id')::uuid;
      perform private.notify_person(v_id, 'driver_route_assigned', r.user_id, array['push'],
        'route:' || (p ->> 'route_id'), jsonb_build_object('route_id', p ->> 'route_id'),
        'driver', 'driver');

    else
      null; -- a topic routed here without messages yet: nothing to plan
  end case;
end;
$$;

-- ═══ 10. Grants ════════════════════════════════════════════════════════════

revoke all on function
  private.catalog_audit(text, text, text, jsonb, jsonb),
  private.search_term(text),
  private.slugify(text),
  private.reserved_category_slug(text),
  private.check_category_slug(text, uuid),
  private.category_visible(uuid),
  private.category_depth(uuid),
  private.category_subtree(uuid),
  private.category_max_depth(),
  private.category_name_taken(text, uuid, uuid),
  private.subtree_listed_rates(uuid),
  private.renumber_categories(uuid),
  private.review_hide_reason_ok(text),
  private.review_hide_reason_text(text),
  private.hide_review(uuid, text, text, uuid),
  private.take_down_product(uuid, text),
  private.listing_fingerprint(uuid),
  private.products_end_take_down(),
  private.brand_for_slug(text),
  private.brand_name_taken(text, uuid),
  private.check_synonym(text),
  private.search_products_unbounded(text, text, bigint, bigint, boolean, boolean, text, integer, integer, text)
from public, anon, authenticated;

revoke all on function
  public.category_redirect(text),
  public.list_brands(text),
  public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer, text),
  public.my_order_reviews(text),
  public.ops_catalog_categories(),
  public.ops_create_category(text, text, text, uuid),
  public.ops_update_category(uuid, text, text, text),
  public.ops_move_category(uuid, uuid),
  public.ops_shift_category(uuid, integer),
  public.ops_set_category_active(uuid, boolean),
  public.ops_delete_category(uuid),
  public.ops_catalog_brands(),
  public.ops_create_brand(text, text),
  public.ops_update_brand(uuid, text, text),
  public.ops_set_brand_active(uuid, boolean),
  public.ops_merge_brands(uuid, uuid),
  public.ops_search_synonyms(),
  public.ops_add_search_synonym(text, text[]),
  public.ops_remove_search_synonym(text),
  public.ops_search_preview(text),
  public.ops_reviews(text, uuid, integer),
  public.ops_hide_review(uuid, text, text),
  public.ops_show_review(uuid),
  public.ops_hide_review_reply(uuid, text, text),
  public.ops_show_review_reply(uuid),
  public.ops_catalog_product(text),
  public.ops_correct_product(uuid, uuid, uuid, boolean, text),
  public.ops_take_down_product(uuid, text),
  public.ops_restore_product(uuid, text)
from public;

-- Visitors: the shop's brand filter, its search and its old category addresses.
grant execute on function
  public.category_redirect(text),
  public.list_brands(text),
  public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer, text)
to anon, authenticated;

grant execute on function
  public.my_order_reviews(text),
  public.ops_catalog_categories(),
  public.ops_create_category(text, text, text, uuid),
  public.ops_update_category(uuid, text, text, text),
  public.ops_move_category(uuid, uuid),
  public.ops_shift_category(uuid, integer),
  public.ops_set_category_active(uuid, boolean),
  public.ops_delete_category(uuid),
  public.ops_catalog_brands(),
  public.ops_create_brand(text, text),
  public.ops_update_brand(uuid, text, text),
  public.ops_set_brand_active(uuid, boolean),
  public.ops_merge_brands(uuid, uuid),
  public.ops_search_synonyms(),
  public.ops_add_search_synonym(text, text[]),
  public.ops_remove_search_synonym(text),
  public.ops_search_preview(text),
  public.ops_reviews(text, uuid, integer),
  public.ops_hide_review(uuid, text, text),
  public.ops_show_review(uuid),
  public.ops_hide_review_reply(uuid, text, text),
  public.ops_show_review_reply(uuid),
  public.ops_catalog_product(text),
  public.ops_correct_product(uuid, uuid, uuid, boolean, text),
  public.ops_take_down_product(uuid, text),
  public.ops_restore_product(uuid, text)
to authenticated;
