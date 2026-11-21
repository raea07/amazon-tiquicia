-- Identity: who a signed-in user is to the platform.
--
-- A person authenticates once (Supabase Auth) and may hold several roles at
-- the same time: shopper (everyone), member of one or more seller accounts,
-- driver, warehouse staff, internal staff. Roles are rows, not JWT claims, so
-- revoking one takes effect on the next request rather than at token expiry.

-- ── Profiles ───────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) between 2 and 120),
  phone text check (phone ~ '^\+506[2-8][0-9]{7}$'),
  phone_verified_at timestamptz,
  locale text not null default 'es-CR' check (locale in ('es-CR', 'en')),
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Every new account gets a profile row.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(left(new.raw_user_meta_data ->> 'full_name', 120), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Internal staff ─────────────────────────────────────────────────────────

create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.staff_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Sellers ────────────────────────────────────────────────────────────────
-- Split in two so the public can read a seller's shop-front details without any
-- path to its legal and banking data.

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  trade_name text not null check (char_length(trade_name) between 2 and 80),
  description text check (char_length(description) <= 2000),
  logo_path text,
  status public.seller_status not null default 'pending',
  -- Cached output of the seller score (packages/core/src/sellers.ts); refreshed nightly.
  score smallint not null default 90 check (score between 0 and 100),
  health text not null default 'bien' check (health in ('excelente', 'bien', 'en_riesgo', 'critico')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sellers_updated_at before update on public.sellers
  for each row execute function private.set_updated_at();

create table public.seller_private (
  seller_id uuid primary key references public.sellers (id) on delete cascade,
  legal_name text not null check (char_length(legal_name) between 2 and 160),
  id_type public.identification_type not null,
  id_number text not null check (id_number ~ '^[0-9A-Z]{9,12}$'),
  tax_regime text not null default 'general' check (tax_regime in ('general', 'simplificado')),
  economic_activity_code text,
  contact_email text not null check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text not null check (contact_phone ~ '^\+506[2-8][0-9]{7}$'),
  fiscal_address text not null,
  postal_code text,
  -- Payout destination. IBAN format for Costa Rica: CR + 20 digits.
  payout_iban text check (payout_iban ~ '^CR[0-9]{20}$'),
  payout_holder_name text,
  -- SINPE Móvil number the seller collects with, which taxpayers must register
  -- with Hacienda (Decreto 45953-H).
  sinpe_movil_number text check (sinpe_movil_number ~ '^\+506[5-8][0-9]{7}$'),
  kyc_status public.kyc_status not null default 'pending',
  kyc_notes text,
  hacienda_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_type, id_number)
);

create trigger seller_private_updated_at before update on public.seller_private
  for each row execute function private.set_updated_at();

create table public.seller_members (
  seller_id uuid not null references public.sellers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.seller_member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (seller_id, user_id)
);

create index seller_members_user_idx on public.seller_members (user_id);

-- ── Drivers ────────────────────────────────────────────────────────────────

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  status public.driver_status not null default 'pending',
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text not null check (phone ~ '^\+506[5-8][0-9]{7}$'),
  id_type public.identification_type not null default 'fisica',
  id_number text not null check (id_number ~ '^[0-9]{9,12}$'),
  vehicle_type public.vehicle_type not null default 'motorcycle',
  plate text,
  capacity_kg numeric(6, 1) not null default 40 check (capacity_kg > 0),
  -- Documents the operation must keep current before a driver may be assigned work.
  license_class text,
  license_expires_on date,
  inspection_expires_on date,
  insurance_expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger drivers_updated_at before update on public.drivers
  for each row execute function private.set_updated_at();

-- ── Consent records (Ley 8968) ─────────────────────────────────────────────
-- Consent must be prior, informed and express, and we must be able to show it.
-- Rows are append-only: withdrawing consent stamps `revoked_at`.

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('terms', 'privacy', 'marketing', 'location', 'driver_terms', 'seller_terms')),
  policy_version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index consents_user_idx on public.consents (user_id, purpose);

-- ── Role helpers ───────────────────────────────────────────────────────────
-- Used by row-level-security policies. SECURITY DEFINER so a policy on table A
-- can consult table B without recursing into B's own policies; STABLE and
-- wrapped in `(select …)` at the call site so Postgres evaluates them once per
-- statement instead of once per row.

create or replace function private.staff_session_ok() returns boolean
language sql stable security definer
set search_path = ''
as $$
  -- When MFA is required, a staff session must carry authenticator assurance level 2.
  select case
    when coalesce((select value from public.app_settings where key = 'require_staff_mfa'), 'false'::jsonb) = 'true'::jsonb
      then coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    else true
  end;
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = (select auth.uid()) and s.active
  ) and private.staff_session_ok();
$$;

-- True when the caller is active staff holding any of the given roles. Admin implies all.
create or replace function private.has_staff_role(variadic p_roles public.staff_role[]) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = (select auth.uid())
      and s.active
      and (s.role = 'admin' or s.role = any (p_roles))
  ) and private.staff_session_ok();
$$;

create or replace function private.is_seller_member(p_seller_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seller_members m
    where m.seller_id = p_seller_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_seller_admin(p_seller_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seller_members m
    where m.seller_id = p_seller_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function private.my_seller_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.seller_id from public.seller_members m where m.user_id = (select auth.uid());
$$;

create or replace function private.my_driver_id() returns uuid
language sql stable security definer
set search_path = ''
as $$
  select d.id from public.drivers d
  where d.user_id = (select auth.uid()) and d.status = 'active';
$$;

-- ── Seller onboarding ──────────────────────────────────────────────────────

create or replace function public.create_seller(
  p_trade_name text,
  p_slug text,
  p_legal_name text,
  p_id_type public.identification_type,
  p_id_number text,
  p_contact_email text,
  p_contact_phone text,
  p_fiscal_address text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_seller uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if exists (select 1 from public.sellers s where s.slug = p_slug) then
    perform private.fail('slug_taken');
  end if;
  if exists (
    select 1 from public.seller_private sp
    where sp.id_type = p_id_type and sp.id_number = p_id_number
  ) then
    perform private.fail('seller_already_registered');
  end if;

  -- New sellers start `pending`: nothing they list is visible until staff approve them.
  insert into public.sellers (slug, trade_name)
  values (p_slug, p_trade_name)
  returning id into v_seller;

  insert into public.seller_private
    (seller_id, legal_name, id_type, id_number, contact_email, contact_phone, fiscal_address)
  values
    (v_seller, p_legal_name, p_id_type, p_id_number, p_contact_email, p_contact_phone, p_fiscal_address);

  insert into public.seller_members (seller_id, user_id, role) values (v_seller, v_user, 'owner');

  insert into public.consents (user_id, purpose, policy_version)
  values (v_user, 'seller_terms', '2026-11');

  return v_seller;
end;
$$;
