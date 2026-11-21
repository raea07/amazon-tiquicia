-- Local stand-in for what the Supabase platform provides.
--
-- Applied ONLY to a plain PostgreSQL used for local development and CI, before
-- the migrations. It is never applied to a Supabase project, which already has
-- these roles, the `auth` schema and the `extensions` schema.
--
-- It deliberately copies Supabase's permissive defaults (anon and authenticated
-- can touch every new table in `public`) so the database tests prove that our
-- explicit REVOKEs and row-level security are what protect the data, rather
-- than a stricter local setup hiding a mistake.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists extensions;
create schema if not exists auth;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- The parts of Supabase Auth's tables that a password sign-in depends on, with
-- the same names, nullability and defaults as on a hosted project (checked
-- against one in November 2026), so supabase/seed.sql runs unchanged on both.
-- Two deliberate differences: `id` and the metadata columns have defaults here,
-- because the local API stand-in inserts users without them.
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255),
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  phone text unique,
  phone_change text default '',
  phone_change_token varchar(255) default '',
  email_change_token_current varchar(255) default '',
  reauthentication_token varchar(255) default '',
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);

create table if not exists auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid primary key default gen_random_uuid(),
  unique (provider_id, provider)
);

-- PostgREST exposes the verified JWT as the `request.jwt.claims` setting.
create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_user::text);
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- ── Sessions, one-time tokens and second factors ───────────────────────────
-- Supabase Auth keeps these in the `auth` schema. They are imitated here with
-- the real names and the columns the local API stand-in (tools/dev-api) and
-- the database functions use, so SQL that reads `auth.sessions` or
-- `auth.mfa_factors` runs unchanged on both. Columns of the real tables that
-- nothing here touches (web_authn_*, oauth_client_id, …) are left out.

alter table auth.users add column if not exists invited_at timestamptz;
alter table auth.users add column if not exists confirmation_sent_at timestamptz;
alter table auth.users add column if not exists recovery_sent_at timestamptz;
alter table auth.users add column if not exists email_change_sent_at timestamptz;
alter table auth.users add column if not exists phone_confirmed_at timestamptz;
alter table auth.users add column if not exists phone_change_sent_at timestamptz;
alter table auth.users add column if not exists reauthentication_sent_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists is_super_admin boolean;

do $$
begin
  if not exists (select from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'auth' and t.typname = 'aal_level') then
    create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
  end if;
  if not exists (select from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'auth' and t.typname = 'factor_type') then
    create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
  end if;
  if not exists (select from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'auth' and t.typname = 'factor_status') then
    create type auth.factor_status as enum ('unverified', 'verified');
  end if;
  if not exists (select from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'auth' and t.typname = 'one_time_token_type') then
    create type auth.one_time_token_type as enum (
      'confirmation_token', 'reauthentication_token', 'recovery_token',
      'email_change_token_new', 'email_change_token_current', 'phone_change_token');
  end if;
  -- The role Supabase Auth connects as. Auth hooks are granted to it.
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  factor_id uuid,
  aal auth.aal_level,
  not_after timestamptz,
  refreshed_at timestamp,
  user_agent text,
  ip inet,
  tag text
);
create index if not exists sessions_user_id_idx on auth.sessions (user_id);

create table if not exists auth.refresh_tokens (
  instance_id uuid,
  id bigserial primary key,
  token varchar(255) unique,
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade
);

create table if not exists auth.mfa_amr_claims (
  id uuid primary key,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  authentication_method text not null,
  unique (session_id, authentication_method)
);

create table if not exists auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type auth.factor_type not null,
  status auth.factor_status not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  secret text,
  phone text,
  last_challenged_at timestamptz unique
);
create unique index if not exists mfa_factors_user_friendly_name_unique
  on auth.mfa_factors (friendly_name, user_id) where trim(friendly_name) <> '';

create table if not exists auth.mfa_challenges (
  id uuid primary key,
  factor_id uuid not null references auth.mfa_factors (id) on delete cascade,
  created_at timestamptz not null,
  verified_at timestamptz,
  ip_address inet not null,
  otp_code text
);

create table if not exists auth.one_time_tokens (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_type auth.one_time_token_type not null,
  token_hash text not null check (char_length(token_hash) > 0),
  relates_to text not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  unique (user_id, token_type)
);

create table if not exists auth.audit_log_entries (
  instance_id uuid,
  id uuid primary key,
  payload json,
  created_at timestamptz,
  ip_address varchar(64) not null default ''
);

-- ── State of the local API stand-in ────────────────────────────────────────
-- Not part of Supabase: settings the browser journeys switch (e-mail
-- confirmation on or off, the resend interval) and the local mailbox where
-- "sent" e-mails land. Lives in the database so every reset starts clean.
create schema if not exists dev_standin;
create table if not exists dev_standin.settings (
  key text primary key,
  value text not null
);
create table if not exists dev_standin.mailbox (
  id bigserial primary key,
  sent_at timestamptz not null default now(),
  to_address text not null,
  kind text not null,
  subject text not null,
  body text not null,
  token text,
  token_hash text,
  link text
);
