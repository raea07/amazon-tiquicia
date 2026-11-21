-- Geography, delivery zones and customer addresses.
--
-- Costa Rica's administrative hierarchy doubles as its postal code: the five
-- digits are province (1) + cantón (2) + distrito (2). The reference rows are
-- loaded by the next migration.

create table public.provinces (
  code smallint primary key check (code between 1 and 7),
  name text not null
);

-- ── Delivery zones ─────────────────────────────────────────────────────────
-- A zone carries the service promise: order cutoff, working days, transit time
-- and price. The promise logic is specified in packages/core/src/promise.ts and
-- implemented for the database in private.compute_promise below.

create table public.delivery_zones (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null,
  -- Orders placed before this local hour start processing the same day.
  cutoff_hour smallint not null check (cutoff_hour between 0 and 23),
  -- 0 = Sunday … 6 = Saturday.
  processing_weekdays smallint[] not null check (cardinality(processing_weekdays) > 0),
  delivery_weekdays smallint[] not null check (cardinality(delivery_weekdays) > 0),
  transit_min_days smallint not null check (transit_min_days >= 0),
  transit_max_days smallint not null check (transit_max_days >= transit_min_days),
  shipping_fee_minor bigint not null check (shipping_fee_minor >= 0),
  -- Orders at or above this merchandise total ship free. Null = never free.
  free_shipping_threshold_minor bigint check (free_shipping_threshold_minor > 0),
  cod_available boolean not null default true,
  -- Inactive zones are visible (so we can say "aún no llegamos") but cannot be ordered to.
  active boolean not null default true,
  sort smallint not null default 0
);

create table public.cantons (
  code text primary key check (code ~ '^[1-7][0-9]{2}$'),
  province_code smallint not null references public.provinces (code),
  name text not null,
  zone_id text not null references public.delivery_zones (id)
);

create table public.districts (
  postal_code text primary key check (postal_code ~ '^[1-7][0-9]{4}$'),
  canton_code text not null references public.cantons (code),
  name text not null,
  -- Overrides the cantón's zone for districts that are served differently
  -- (a remote district of an otherwise urban cantón, for example).
  zone_id text references public.delivery_zones (id)
);

create index districts_canton_idx on public.districts (canton_code);

create or replace function private.zone_for_postal_code(p_postal_code text) returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(d.zone_id, c.zone_id)
  from public.districts d
  join public.cantons c on c.code = d.canton_code
  where d.postal_code = p_postal_code;
$$;

-- ── Operations calendar ────────────────────────────────────────────────────
-- Days with no processing and no delivery. Authoritative over any holiday
-- formula, because the law has moved holidays to Mondays in some years.

create table public.holidays (
  day date primary key,
  name text not null
);

-- Delivery dates a zone can no longer take (capacity reached or closed).
create table public.zone_closures (
  zone_id text not null references public.delivery_zones (id) on delete cascade,
  day date not null,
  reason text not null default 'capacity',
  primary key (zone_id, day)
);

-- ── Delivery promise ───────────────────────────────────────────────────────
-- Mirrors computeDeliveryPromise in packages/core/src/promise.ts; the database
-- tests replay the same cases as the TypeScript unit tests.

create or replace function private.cr_local(p_at timestamptz) returns timestamp
language sql immutable
set search_path = ''
as $$
  -- Costa Rica is UTC−6 all year.
  select (p_at at time zone 'UTC') - interval '6 hours';
$$;

create or replace function private.compute_promise(
  p_zone_id text,
  p_handling_days integer,
  p_now timestamptz default now()
) returns table (dispatch_date date, earliest date, latest date)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  z public.delivery_zones%rowtype;
  v_local timestamp := private.cr_local(p_now);
  v_today date := v_local::date;
  v_dispatch date;
  v_earliest date;
  v_latest date;
  v_guard integer;
  i integer;
begin
  select * into z from public.delivery_zones where id = p_zone_id;
  if not found then
    perform private.fail('zone_not_found', p_zone_id);
  end if;
  if p_handling_days < 0 then
    perform private.fail('invalid_handling_days');
  end if;

  -- First processing day: today if before cutoff on a processing day, else the next one.
  v_dispatch := v_today;
  if not (
    extract(dow from v_today)::smallint = any (z.processing_weekdays)
    and not exists (select 1 from public.holidays h where h.day = v_today)
    and extract(hour from v_local) < z.cutoff_hour
  ) then
    v_dispatch := v_today + 1;
  end if;

  v_guard := 0;
  while not (
    extract(dow from v_dispatch)::smallint = any (z.processing_weekdays)
    and not exists (select 1 from public.holidays h where h.day = v_dispatch)
  ) loop
    v_dispatch := v_dispatch + 1;
    v_guard := v_guard + 1;
    if v_guard > 366 then perform private.fail('calendar_misconfigured', p_zone_id); end if;
  end loop;

  -- Handling time, counted in processing days.
  for i in 1 .. p_handling_days loop
    v_dispatch := v_dispatch + 1;
    v_guard := 0;
    while not (
      extract(dow from v_dispatch)::smallint = any (z.processing_weekdays)
      and not exists (select 1 from public.holidays h where h.day = v_dispatch)
    ) loop
      v_dispatch := v_dispatch + 1;
      v_guard := v_guard + 1;
      if v_guard > 366 then perform private.fail('calendar_misconfigured', p_zone_id); end if;
    end loop;
  end loop;

  v_earliest := private.advance_delivery_days(z.id, v_dispatch, z.transit_min_days);
  v_latest := private.advance_delivery_days(z.id, v_dispatch, z.transit_max_days);

  return query select v_dispatch, v_earliest, v_latest;
end;
$$;

-- Moves forward `p_days` delivery days from `p_from` (0 = the first delivery day on or after it).
create or replace function private.advance_delivery_days(p_zone_id text, p_from date, p_days integer)
returns date
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_weekdays smallint[];
  v_day date := p_from;
  v_left integer := p_days;
  v_guard integer := 0;
begin
  select delivery_weekdays into v_weekdays from public.delivery_zones where id = p_zone_id;

  if v_left > 0 then
    v_day := v_day + 1;
  end if;
  loop
    if extract(dow from v_day)::smallint = any (v_weekdays)
       and not exists (select 1 from public.holidays h where h.day = v_day)
       and not exists (select 1 from public.zone_closures c where c.zone_id = p_zone_id and c.day = v_day)
    then
      if v_left <= 1 then
        return v_day;
      end if;
      v_left := v_left - 1;
    end if;
    v_day := v_day + 1;
    v_guard := v_guard + 1;
    if v_guard > 366 then perform private.fail('calendar_misconfigured', p_zone_id); end if;
  end loop;
end;
$$;

-- What the storefront shows next to a product for a given district.
create or replace function public.delivery_estimate(
  p_postal_code text,
  p_handling_days integer default 0
) returns table (
  zone_id text,
  zone_active boolean,
  earliest date,
  latest date,
  shipping_fee_minor bigint,
  free_shipping_threshold_minor bigint,
  cod_available boolean
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_zone text := private.zone_for_postal_code(p_postal_code);
begin
  if v_zone is null then
    return;
  end if;
  return query
    select z.id, z.active, p.earliest, p.latest,
           z.shipping_fee_minor, z.free_shipping_threshold_minor, z.cod_available
    from public.delivery_zones z
    cross join lateral private.compute_promise(z.id, greatest(0, least(p_handling_days, 10))) p
    where z.id = v_zone;
end;
$$;

-- ── Customer addresses ─────────────────────────────────────────────────────
-- The map pin is the address of record; `senas` are the directions a driver
-- reads. A pin is mandatory because señas alone cannot be routed.

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text check (char_length(label) <= 40),
  recipient_name text not null check (char_length(recipient_name) between 3 and 120),
  phone text not null check (phone ~ '^\+506[2-8][0-9]{7}$'),
  postal_code text not null references public.districts (postal_code),
  senas text not null check (char_length(senas) between 15 and 500),
  lat double precision not null check (lat between 8.0 and 11.25),
  lng double precision not null check (lng between -86.0 and -82.5),
  plus_code text check (plus_code ~ '^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,3}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete: past orders keep their own snapshot, but we keep the row for audit.
  deleted_at timestamptz
);

create index addresses_user_idx on public.addresses (user_id) where deleted_at is null;
create unique index addresses_one_default_idx on public.addresses (user_id)
  where is_default and deleted_at is null;

create trigger addresses_updated_at before update on public.addresses
  for each row execute function private.set_updated_at();
