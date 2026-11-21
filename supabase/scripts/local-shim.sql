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

-- ── Storage ─────────────────────────────────────────────────────────────────
-- The parts of Supabase Storage's schema that the migrations and the local
-- API stand-in (tools/dev-api/src/routes/storage.ts) use: the two tables with
-- the columns, keys and defaults a hosted project has, the path helpers that
-- rules call, and the grants the platform gives the API roles. As on Supabase,
-- the API roles may attempt anything on storage.objects and row-level security
-- with the migrations' rules decides; with no rule, nothing is allowed.
-- Not imitated: the storage service's own triggers (versioning, prefixes, the
-- guard against deleting rows by SQL) and the bucket analytics tables.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb,
  unique (bucket_id, name)
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text) returns text
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text) returns text
language plpgsql immutable
as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant all on storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;

-- Which storage operation is running (the service sets it for every request;
-- the local stand-in does the same). The photo rules read the setting itself.
create or replace function storage.operation() returns text
language plpgsql stable
as $$
begin
  return current_setting('storage.operation', true);
end;
$$;
grant execute on function storage.operation() to anon, authenticated, service_role;
