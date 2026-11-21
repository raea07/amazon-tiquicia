-- Catalogue: what is for sale and who sells it.
--
--   category ─< product ─< sku ─< offer >─ seller
--
-- A PRODUCT is one page in the store. A SKU is one buyable variant of it
-- (size, colour). An OFFER is one seller's price and terms for one SKU. Several
-- sellers can make offers on the same SKU; the page features one of them
-- (packages/core/src/offers.ts) and lists the rest.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_es text not null,
  name_en text not null,
  -- Commission rate in basis points. Null = inherit from the parent, then the schedule default.
  referral_bps integer check (referral_bps between 0 and 5000),
  -- Default IVA rate for products filed here; the product row has the final say.
  default_tax_rate_bps integer not null default 1300 check (default_tax_rate_bps in (0, 50, 100, 200, 400, 1300)),
  sort smallint not null default 0,
  active boolean not null default true
);

create index categories_parent_idx on public.categories (parent_id);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check (char_length(title) between 5 and 200),
  description text check (char_length(description) <= 10000),
  bullet_points text[] not null default '{}' check (cardinality(bullet_points) <= 8),
  brand_id uuid references public.brands (id),
  category_id uuid not null references public.categories (id),
  attributes jsonb not null default '{}',
  status public.product_status not null default 'draft',
  -- The seller that created the listing owns its content until staff take it over.
  created_by_seller_id uuid references public.sellers (id) on delete set null,
  rejection_reason text,
  tax_rate_bps integer not null default 1300 check (tax_rate_bps in (0, 50, 100, 200, 400, 1300)),
  -- Legal warranty is 30 business days minimum; sellers may offer more.
  warranty_months smallint not null default 1 check (warranty_months between 0 and 120),
  made_in_cr boolean not null default false,

  -- Search document, maintained by trigger.
  search_vector tsvector,
  title_folded text generated always as (private.fold(title)) stored,

  -- Listing summary, maintained by trigger from offers and stock, so category and
  -- search pages read one row per product instead of joining offers and inventory.
  min_price_minor bigint,
  list_price_minor bigint,
  featured_offer_id uuid,
  offer_count integer not null default 0,
  in_stock boolean not null default false,
  fulfilled_by_platform boolean not null default false,
  best_handling_days smallint,

  -- Ranking signals, refreshed by scheduled jobs.
  rating_sum integer not null default 0 check (rating_sum >= 0),
  rating_count integer not null default 0 check (rating_count >= 0),
  units_sold_30d integer not null default 0,
  views_30d integer not null default 0,
  price_index real not null default 1,
  return_rate real not null default 0 check (return_rate between 0 and 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index products_search_idx on public.products using gin (search_vector);
create index products_title_trgm_idx on public.products
  using gin (title_folded extensions.gin_trgm_ops);
create index products_category_idx on public.products (category_id) where status = 'active';
create index products_seller_idx on public.products (created_by_seller_id);

create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- Either a path in the `product-images` storage bucket or an absolute https URL.
  path text not null,
  alt text not null default '',
  sort smallint not null default 0
);

create index product_images_product_idx on public.product_images (product_id, sort);

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- Platform-wide stock code printed on bin and parcel labels.
  code text not null unique check (code ~ '^[A-Z0-9-]{4,32}$'),
  -- EAN/UPC barcode when the manufacturer prints one.
  gtin text check (gtin ~ '^[0-9]{8,14}$'),
  variant_name text not null default '',
  variant_attributes jsonb not null default '{}',
  weight_grams integer not null check (weight_grams > 0),
  length_cm numeric(6, 1) not null check (length_cm > 0),
  width_cm numeric(6, 1) not null check (width_cm > 0),
  height_cm numeric(6, 1) not null check (height_cm > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index skus_product_idx on public.skus (product_id);
create index skus_gtin_idx on public.skus (gtin) where gtin is not null;

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus (id) on delete cascade,
  seller_id uuid not null references public.sellers (id) on delete cascade,
  -- Tax-inclusive price the shopper pays, as consumer law requires.
  price_minor bigint not null check (price_minor > 0),
  -- A higher "precio regular" may be shown struck through only if it was genuinely charged.
  list_price_minor bigint check (list_price_minor > price_minor),
  currency char(3) not null default 'CRC' check (currency = 'CRC'),
  condition public.item_condition not null default 'new',
  fulfillment public.fulfillment_type not null default 'seller',
  -- Working days the seller needs before handing the parcel over. 0 for platform-fulfilled.
  handling_days smallint not null default 1 check (handling_days between 0 and 10),
  seller_sku text,
  status public.offer_status not null default 'active',
  -- Units a shopper can buy right now; maintained by trigger from stock levels.
  available_quantity integer not null default 0 check (available_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sku_id, seller_id, condition)
);

create index offers_seller_idx on public.offers (seller_id);
create index offers_sku_active_idx on public.offers (sku_id) where status = 'active';

create trigger offers_updated_at before update on public.offers
  for each row execute function private.set_updated_at();

alter table public.products
  add constraint products_featured_offer_fk
  foreign key (featured_offer_id) references public.offers (id) on delete set null;

-- ── Search vocabulary ──────────────────────────────────────────────────────

create table public.search_synonyms (
  term text primary key check (term = private.fold(term)),
  expansions text[] not null check (cardinality(expansions) > 0)
);

-- "Quienes compraron esto también llevaron": written by the nightly co-purchase job.
create table public.product_relations (
  product_id uuid not null references public.products (id) on delete cascade,
  related_id uuid not null references public.products (id) on delete cascade,
  kind text not null default 'bought_together' check (kind in ('bought_together', 'similar')),
  score real not null,
  primary key (product_id, related_id, kind),
  check (product_id <> related_id)
);

-- ── Search document ────────────────────────────────────────────────────────

create or replace function private.refresh_product_search(p_product_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.products p
  set search_vector =
        setweight(to_tsvector('public.es', coalesce(p.title, '')), 'A')
     || setweight(to_tsvector('public.es', coalesce(b.name, '')), 'A')
     || setweight(to_tsvector('public.es', coalesce(c.name_es, '')), 'B')
     || setweight(to_tsvector('public.es', coalesce(array_to_string(p.bullet_points, ' '), '')), 'C')
     || setweight(to_tsvector('public.es', coalesce(p.description, '')), 'D')
  from public.categories c
  left join public.brands b on b.id = (select brand_id from public.products where id = p_product_id)
  where p.id = p_product_id and c.id = p.category_id;
$$;

create or replace function private.products_search_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.refresh_product_search(new.id);
  return null;
end;
$$;

create trigger products_search_refresh
  after insert or update of title, description, bullet_points, brand_id, category_id
  on public.products
  for each row execute function private.products_search_trigger();

-- ── Listing summary ────────────────────────────────────────────────────────
-- The summary's "featured offer" is the cheapest buyable offer from a seller in
-- good standing. The product page runs the full featured-offer formula; the
-- listing only needs a price that is true and an offer that can be bought.

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
  order by (o.available_quantity > 0) desc, o.price_minor asc, o.created_at asc, o.id asc
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

create or replace function private.offers_summary_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product uuid;
begin
  select k.product_id into v_product
  from public.skus k where k.id = coalesce(new.sku_id, old.sku_id);
  if v_product is not null then
    perform private.refresh_product_summary(v_product);
  end if;
  return null;
end;
$$;

create trigger offers_summary_refresh
  after insert or delete or update of price_minor, list_price_minor, status, available_quantity,
    fulfillment, handling_days, condition
  on public.offers
  for each row execute function private.offers_summary_trigger();

-- A seller being approved or suspended changes what is buyable across its catalogue.
create or replace function private.sellers_summary_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.status is distinct from old.status then
    for r in
      select distinct k.product_id
      from public.offers o join public.skus k on k.id = o.sku_id
      where o.seller_id = new.id
    loop
      perform private.refresh_product_summary(r.product_id);
    end loop;
  end if;
  return null;
end;
$$;

create trigger sellers_summary_refresh after update of status on public.sellers
  for each row execute function private.sellers_summary_trigger();

-- ── Category helpers ───────────────────────────────────────────────────────

-- A category and everything beneath it.
create or replace function private.category_descendants(p_slug text) returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  with recursive tree as (
    select id from public.categories where slug = p_slug
    union all
    select c.id from public.categories c join tree t on c.parent_id = t.id
  )
  select id from tree;
$$;

-- Commission rate for a category: its own, else the nearest ancestor's, else null.
create or replace function private.referral_bps_for_category(p_category_id uuid) returns integer
language sql stable security definer
set search_path = ''
as $$
  with recursive up as (
    select id, parent_id, referral_bps, 0 as depth from public.categories where id = p_category_id
    union all
    select c.id, c.parent_id, c.referral_bps, up.depth + 1
    from public.categories c join up on c.id = up.parent_id
  )
  select referral_bps from up where referral_bps is not null order by depth limit 1;
$$;
