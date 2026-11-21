-- Foundation: extensions, schemas, enumerated types and shared helpers.
--
-- Layout
--   public   Everything the Data API exposes: tables protected by row-level
--            security, and RPC functions that validate their caller.
--   private  Helpers and internal state. Never exposed through the API.
--
-- Conventions
--   * Money is an integer count of minor units (céntimos) plus a currency code.
--   * Every table has row-level security enabled; access is denied unless a
--     policy grants it. Table privileges are also granted explicitly (least
--     privilege), so RLS is the second lock, not the only one.
--   * Multi-step writes go through SECURITY DEFINER functions that check the
--     caller, so an order cannot be half-created by a client.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;

-- Secure by default. Supabase grants the API roles access to every new table
-- and function in `public`; switch that off so nothing these migrations create
-- is reachable through the API until a later statement grants it on purpose.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ── Enumerated types ───────────────────────────────────────────────────────

create type public.staff_role as enum ('admin', 'ops', 'support', 'finance', 'catalog');
create type public.seller_status as enum ('pending', 'active', 'suspended', 'closed');
create type public.seller_member_role as enum ('owner', 'admin', 'staff');
create type public.identification_type as enum ('fisica', 'juridica', 'dimex', 'nite');
create type public.kyc_status as enum ('pending', 'verified', 'rejected');
create type public.driver_status as enum ('pending', 'active', 'suspended', 'offboarded');
create type public.vehicle_type as enum ('motorcycle', 'car', 'van', 'bicycle');

create type public.product_status as enum ('draft', 'pending_review', 'active', 'rejected', 'archived');
create type public.offer_status as enum ('active', 'paused', 'archived');
create type public.item_condition as enum ('new', 'refurbished', 'used');
create type public.fulfillment_type as enum ('platform', 'seller');

create type public.warehouse_kind as enum ('platform', 'seller');
create type public.location_kind as enum
  ('receiving', 'storage', 'pick', 'packing', 'staging', 'returns', 'damaged');
create type public.movement_reason as enum
  ('receive', 'putaway', 'pick', 'ship', 'adjust', 'return', 'damage', 'transfer');
create type public.inbound_status as enum
  ('draft', 'in_transit', 'receiving', 'received', 'closed', 'cancelled');

-- Keep these two in step with packages/core/src/lifecycle.ts (a test checks it).
create type public.order_status as enum (
  'pending_payment', 'payment_review', 'confirmed', 'processing',
  'partially_shipped', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded'
);
create type public.shipment_status as enum (
  'pending', 'picking', 'packed', 'ready_for_dispatch', 'out_for_delivery',
  'delivered', 'delivery_failed', 'returning', 'returned', 'cancelled'
);

create type public.payment_method as enum
  ('card', 'sinpe_movil', 'cash_on_delivery', 'bank_transfer');
create type public.payment_status as enum
  ('pending', 'authorized', 'captured', 'failed', 'cancelled', 'refunded', 'partially_refunded');

create type public.reservation_status as enum ('active', 'consumed', 'released');
create type public.pick_status as enum ('open', 'in_progress', 'done', 'short', 'cancelled');
create type public.route_status as enum
  ('draft', 'assigned', 'in_progress', 'completed', 'cancelled');
create type public.stop_status as enum ('pending', 'arrived', 'delivered', 'failed', 'skipped');
create type public.review_status as enum ('pending', 'published', 'rejected');
create type public.report_status as enum ('open', 'in_review', 'actioned', 'dismissed');
create type public.invoice_status as enum ('pending', 'sent', 'accepted', 'rejected', 'voided');

-- ── Shared helpers ─────────────────────────────────────────────────────────

create or replace function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Accent- and case-insensitive folding for fuzzy matching. `unaccent` is only
-- STABLE because its dictionary can be swapped; pinning the dictionary makes it
-- safe to declare immutable so the result can be indexed.
create or replace function private.fold(input text) returns text
language sql immutable parallel safe strict
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, input));
$$;

-- Spanish full-text configuration that ignores accents, so "cafetera electrica"
-- finds "Cafetera eléctrica".
create text search configuration public.es (copy = pg_catalog.spanish);
alter text search configuration public.es
  alter mapping for hword, hword_part, word
  with extensions.unaccent, pg_catalog.spanish_stem;

-- Raises an application error the clients can switch on. `code` is a stable
-- machine-readable string (see packages/db/src/errors.ts); `detail` is optional.
create or replace function private.fail(code text, detail text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = code,
    detail = coalesce(detail, '');
end;
$$;

-- ── Platform settings ──────────────────────────────────────────────────────
-- Operational switches that must be changeable without a deploy. Readable by
-- everyone (nothing secret goes here); writable only by admins (policy below).

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now()
);

create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();

insert into public.app_settings (key, value, description) values
  ('payments_mode', '"sandbox"',
   'sandbox = simulated payments for pilots and demos; live = real gateway. Must be live in production.'),
  ('max_units_per_line', '10', 'Largest quantity of one offer allowed in a single order.'),
  ('max_lines_per_order', '40', 'Largest number of distinct offers in a single order.'),
  ('cod_max_order_minor', '15000000',
   'Orders above this total (minor units) cannot be paid in cash on delivery. ₡150 000.'),
  ('reservation_minutes', '30',
   'How long stock stays reserved for an order that is still waiting for payment.'),
  ('require_staff_mfa', 'false',
   'When true, staff permissions apply only to sessions authenticated with a second factor.');

create or replace function private.setting(p_key text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select value from public.app_settings where key = p_key;
$$;
