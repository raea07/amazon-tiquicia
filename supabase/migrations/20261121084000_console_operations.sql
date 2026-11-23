-- Staff operations tools in the console: delivery zones, districts, holidays,
-- zone closures, platform settings, warehouse locations and stuck routes.
--
-- The lockdown (20261121082800) took every table privilege away from the app
-- roles. These changes had only ever been direct table writes, so they had no
-- door at all: each one is now a function, for the staff role that owns the
-- area today (the same role the old write policies named), administrators
-- always, and every other staff role is refused with `forbidden`:
--
--   delivery zones, districts, holidays, zone closures   ops
--   warehouse locations, stuck routes                    ops (dispatch and the warehouse)
--   platform settings                                    administrators only
--
-- Every change leaves an entry in the audit log with the old and the new
-- value and no personal data: the tables that already had the audit trigger
-- (delivery_zones, holidays, zone_closures, app_settings) keep it, and the
-- functions below write their own entry for districts, closure periods,
-- warehouse locations and routes (a route stop holds the recipient's name and
-- phone, so its row is never copied into the log).
--
-- What this migration decides, and why:
--
--   * SWITCHING A ZONE OFF stops new orders to it at once: an address there
--     cannot be chosen at checkout, the cart says the shop does not deliver
--     there for now, and the product page gives no date. Orders already
--     placed are untouched: they keep their zone, their promise and their
--     route. Staff see how many are open in the zone before confirming. The
--     shop always keeps somewhere to deliver: the last active zone that
--     serves a district cannot be switched off (`zone_last_active`), a zone
--     with no district served cannot be switched on (`zone_has_no_districts`:
--     it would promise addresses it has none of), and no district move may
--     leave every active zone without a served district
--     (`districts_none_served`). A new zone starts switched off and with no
--     districts; it is switched on once districts are assigned to it. A zone
--     can be deleted only while nothing refers to it (no canton, district,
--     order or closure). Zone and holiday names lose control and invisible
--     characters and must hold at least two letters (private.clean_label).
--   * Zone parameters are validated here, not only in the console: money in
--     whole céntimos and never negative, a cut-off between 06:00 and 22:00,
--     at least one processing and one delivery weekday, transit days with the
--     fastest not after the slowest. Two staff editing the same zone: each
--     edit carries the revision it was made from, and the second is refused
--     (`zone_changed_meanwhile`) instead of silently undoing the first.
--   * DISTRICTS are reference data: no function creates or renames one. Staff
--     assign one or several (a canton's together) to a zone, or mark them as
--     not served. A district not served keeps its zone for the record but
--     reads as a switched-off zone everywhere a shopper looks (list_districts,
--     my_addresses, delivery_estimate, checkout_quote), and place_order
--     refuses it (`zone_not_served`). A SAVED ADDRESS in such a district stays
--     saved and is shown with "por ahora no entregamos en esta dirección"; it
--     cannot be chosen at checkout until the district is served again, and
--     nothing is deleted. Moving a district to another zone changes the fee
--     and the promise of future orders only. Staff see, before confirming,
--     how many saved addresses and open orders the move touches and which
--     zones it would leave without districts. A seller's pickup point cannot
--     be saved in a district that is not served (seller_save_location).
--   * HOLIDAYS are Costa Rica dates (America/Costa_Rica, UTC−6 all year, as
--     private.cr_local). Only days after today can be added or removed (today
--     already has deliveries under way), at most two years ahead (a mistyped
--     year is refused rather than stored). A day with routes planned is
--     REFUSED (`holiday_has_routes`): dispatch must move or close them first.
--     A day on which open orders are promised is WARNED with their count
--     (`holiday_has_promised_orders`) and added only when staff confirm;
--     those orders keep their promise (nothing is re-promised by itself).
--     The promise shown to shoppers reads the calendar on every call.
--   * ZONE CLOSURES are periods (`zone_closure_periods`) with a reason from a
--     short list (weather, road closed, capacity, other with a text). Each
--     period writes its days into zone_closures, the table the delivery
--     promise already reads, so the promise and its parity test with
--     packages/core/src/promise.ts are unchanged. A closure starts today or
--     later, lasts at most 31 days and starts at most a year ahead. An
--     OVERLAPPING closure of the same zone is REFUSED, not merged: the
--     existing one's end can be changed instead. Ending a closure early
--     reopens the zone from today; one that had not started is cancelled,
--     and stays on the console's list for 7 days so it can be closed again
--     from there. Days already past stay as they were. Orders already promised inside a
--     closure are listed for staff; nothing is cancelled or re-promised.
--   * SETTINGS: every row of app_settings is listed. Operational settings
--     (limits staff reasonably tune, in private.operational_setting below)
--     are changed by administrators, one whole number at a time, within its
--     range, against the value they saw (`setting_changed_meanwhile`).
--     Everything else is PROTECTED and changed only by the deployment
--     runbook: the payments mode and gateway, every invoicing setting,
--     whether staff need a second factor, consent versions, the order number
--     prefix, payouts, and the limits whose numbers are also written in the
--     apps' code or texts (units and lines per order, the 30 minutes an
--     unpaid order is held). A key that is not on the operational list is
--     protected, so a setting added later is protected until someone decides
--     otherwise here.
--   * WAREHOUSE LOCATIONS: operations staff create, rename and switch off
--     storage and picking locations of a Yuntera warehouse, with the code
--     format the existing ones use (zone letter, aisle, level, position:
--     A-01-02-B), unique within the warehouse. Receiving, packing, dispatch,
--     returns and damaged areas are shown but not changed here. A location
--     holding stock or named in an open pick task cannot be switched off (the
--     refusal says how many units), nor the last active storage or picking
--     location of a warehouse. The warehouse screens list active locations
--     only (wms_locations), so a new one is offered at once and one switched
--     off is no longer offered; stock can no longer be put into a location
--     that is off, even by a receipt that started before (trigger below).
--     Nor can a location be switched off while units picked from it sit in a
--     parcel still being picked (`location_has_picked_units`): cancelling
--     that order puts them back on the shelf they came from, and the trigger
--     would refuse it, so the order could not be cancelled at all.
--   * STUCK ROUTES: dispatch removes a pending stop from an open route and
--     closes a route once no stop is still out. The removed stop is kept,
--     marked "skipped" (the driver reads "Omitida"), with who removed it and
--     why. Its parcel goes back to waiting for a route:
--       - not yet handed to the driver (ready_for_dispatch): back to packed;
--       - already with the driver (out_for_delivery): to delivery_failed, as
--         after an attempt, but without counting an attempt, without a
--         notification and with the status entry hidden from the shopper's
--         history. Its attempt_count stays 0, and that is how the shop's order
--         page and dispatch tell it from a failed attempt: the shopper reads
--         that the delivery was rescheduled, not that nobody was home. It is
--         on dispatch's list again and the driver brings it back;
--       - cancelled (the case that got routes stuck before the review): it
--         stays cancelled.
--     The shopper's promise is not changed, and the parcel's next route sends
--     the usual messages. Cash planned on the stop moves to another live stop
--     of the order or to its next route (private.replan_cod); no money moves
--     and the ledger is not touched. A stop already delivered, failed or
--     skipped, or one where the driver is at the door (an attempt in
--     progress), is refused. A route with a stop still out cannot be closed:
--     each stop must be delivered, failed or removed first. Closing a route
--     being driven completes it and opens its cash count for what the driver
--     collected, as the driver's own last stop does; closing one that never
--     started cancels it. The delivery code is never read or returned here.

-- ═══ 1. Tables and columns ═════════════════════════════════════════════════

-- The revision staff edit from, so a concurrent edit is refused, not lost.
alter table public.delivery_zones
  add column revision integer not null default 1,
  add column updated_at timestamptz not null default now();

-- A district may be marked as not served, whatever zone it belongs to.
alter table public.districts
  add column served boolean not null default true;

-- A zone closed for a period, with why. Its days are written into
-- zone_closures, which the delivery promise reads.
create table public.zone_closure_periods (
  id uuid primary key default gen_random_uuid(),
  zone_id text not null references public.delivery_zones (id),
  starts_on date not null,
  ends_on date not null,
  reason text not null check (reason in ('weather', 'road_closed', 'capacity', 'other')),
  note text check (note is null or char_length(note) between 3 and 200),
  revision integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_early_at timestamptz,
  ended_early_by uuid references auth.users (id) on delete set null,
  -- Ended before its first day: it never closed anything.
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (reason <> 'other' or note is not null)
);
create index zone_closure_periods_zone_idx on public.zone_closure_periods (zone_id, starts_on);
alter table public.zone_closure_periods enable row level security;
revoke all on public.zone_closure_periods from public, anon, authenticated;
create policy "staff read" on public.zone_closure_periods for select
  using ((select private.is_staff()));

-- The period a closed day belongs to. Days closed one by one before this
-- migration (or by an administrator in the database) have none.
alter table public.zone_closures
  add column period_id uuid references public.zone_closure_periods (id) on delete cascade;
create index zone_closures_period_idx on public.zone_closures (period_id);

-- Who took a stop off its route and why; who closed a route and why.
alter table public.route_stops
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id) on delete set null,
  add column removal_reason text
    check (removal_reason is null or char_length(removal_reason) between 5 and 300);
alter table public.routes
  add column closed_at timestamptz,
  add column closed_by uuid references auth.users (id) on delete set null,
  add column close_reason text
    check (close_reason is null or char_length(close_reason) between 5 and 300);

-- ═══ 2. The parcel lifecycle: off a route before it left ══════════════════

-- Replaces the version in orders. One transition is added: a parcel planned
-- on a route but not yet handed to the driver (ready_for_dispatch) goes back
-- to packed when dispatch takes it off the route. packages/core/src/lifecycle.ts
-- changes with it (the parity test reads the newest list between the markers).
create or replace function private.shipment_transition_allowed(
  p_from public.shipment_status, p_to public.shipment_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    -- BEGIN shipment_transitions
    ('pending', 'picking'),
    ('pending', 'cancelled'),
    ('picking', 'packed'),
    ('picking', 'pending'),
    ('picking', 'cancelled'),
    ('packed', 'ready_for_dispatch'),
    ('packed', 'cancelled'),
    ('ready_for_dispatch', 'out_for_delivery'),
    ('ready_for_dispatch', 'packed'),
    ('ready_for_dispatch', 'cancelled'),
    ('out_for_delivery', 'delivered'),
    ('out_for_delivery', 'delivery_failed'),
    ('delivery_failed', 'ready_for_dispatch'),
    ('delivery_failed', 'returning'),
    ('returning', 'returned')
    -- END shipment_transitions
  );
$$;

-- ═══ 3. Helpers ════════════════════════════════════════════════════════════

-- An audit entry written by a function: the action, the row's key and the
-- old and new values it chose to record (never a name, phone or address).
create or replace function private.operations_audit(
  p_action text, p_table text, p_key text, p_old jsonb, p_new jsonb
) returns void
language sql security definer
set search_path = ''
as $$
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), p_action, p_table, p_key, p_old, p_new);
$$;

-- Today in Costa Rica.
create or replace function private.cr_today() returns date
language sql stable
set search_path = ''
as $$
  select private.cr_local(now())::date;
$$;

-- A short name or reason as staff typed it, for showing: control characters
-- become spaces, invisible ones (zero-width, direction marks, soft hyphens)
-- go, and spaces are collapsed as in private.clean_text.
create or replace function private.clean_label(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select private.clean_text(regexp_replace(
    regexp_replace(coalesce(p_text, ''), '[\x01-\x1F\x7F-\x9F]', ' ', 'g'),
    '[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]', '', 'g'));
$$;

-- At least two letters: a name someone can read.
create or replace function private.has_letters(p_text text) returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_text ~ '[[:alpha:]].*[[:alpha:]]', false);
$$;

-- An order that can still change: not delivered, completed, cancelled or refunded.
create or replace function private.order_is_open(p_status public.order_status) returns boolean
language sql immutable
set search_path = ''
as $$
  select p_status in ('pending_payment', 'payment_review', 'confirmed', 'processing',
                      'partially_shipped', 'shipped');
$$;

-- Each district with the zone it belongs to (its own, else its canton's) and
-- whether it is served.
create or replace function private.district_zones()
returns table (postal_code text, canton_code text, zone_id text, served boolean)
language sql stable security definer
set search_path = ''
as $$
  select d.postal_code, d.canton_code, coalesce(d.zone_id, c.zone_id), d.served
  from public.districts d
  join public.cantons c on c.code = d.canton_code;
$$;

-- True when the zone serves at least one district.
create or replace function private.zone_serves(p_zone_id text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from private.district_zones() dz where dz.zone_id = p_zone_id and dz.served);
$$;

-- Replaces the version in geography: a district that is not served has no
-- zone to deliver from. place_order refuses it (`zone_not_served`).
create or replace function private.zone_for_postal_code(p_postal_code text) returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(d.zone_id, c.zone_id)
  from public.districts d
  join public.cantons c on c.code = d.canton_code
  where d.postal_code = p_postal_code and d.served;
$$;

-- Checks what a zone holds. Money is whole céntimos; times are local hours.
create or replace function private.check_zone_service(
  p_name text,
  p_cutoff_hour integer,
  p_processing_weekdays smallint[],
  p_delivery_weekdays smallint[],
  p_transit_min_days integer,
  p_transit_max_days integer,
  p_shipping_fee_minor bigint,
  p_free_shipping_threshold_minor bigint
) returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_name is null or char_length(p_name) not between 2 and 60 or not private.has_letters(p_name) then
    perform private.fail('zone_name_invalid');
  end if;
  if p_cutoff_hour is null or p_cutoff_hour not between 6 and 22 then
    perform private.fail('zone_cutoff_invalid');
  end if;
  if p_processing_weekdays is null or cardinality(p_processing_weekdays) = 0
     or p_delivery_weekdays is null or cardinality(p_delivery_weekdays) = 0
     or exists (select 1 from unnest(p_processing_weekdays || p_delivery_weekdays) d
                where d is null or d not between 0 and 6) then
    perform private.fail('zone_weekdays_invalid');
  end if;
  if p_transit_min_days is null or p_transit_max_days is null
     or p_transit_min_days not between 0 and 10 or p_transit_max_days not between 0 and 15
     or p_transit_max_days < p_transit_min_days then
    perform private.fail('zone_transit_invalid');
  end if;
  -- ₡100 000 at most for one delivery.
  if p_shipping_fee_minor is null or p_shipping_fee_minor not between 0 and 10000000 then
    perform private.fail('zone_fee_invalid');
  end if;
  -- Null: never free. Otherwise ₡1 to ₡10 000 000.
  if p_free_shipping_threshold_minor is not null
     and p_free_shipping_threshold_minor not between 100 and 1000000000 then
    perform private.fail('zone_threshold_invalid');
  end if;
end;
$$;

-- Weekdays as one sorted list without repeats.
create or replace function private.weekday_set(p_days smallint[]) returns smallint[]
language sql immutable
set search_path = ''
as $$
  select array_agg(distinct d order by d) from unnest(p_days) d;
$$;

-- What a zone looks like to staff.
create or replace function private.ops_zone_json(p_zone_id text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', z.id,
    'name', z.name,
    'active', z.active,
    'sort', z.sort,
    'revision', z.revision,
    'cutoff_hour', z.cutoff_hour,
    'processing_weekdays', to_jsonb(z.processing_weekdays),
    'delivery_weekdays', to_jsonb(z.delivery_weekdays),
    'transit_min_days', z.transit_min_days,
    'transit_max_days', z.transit_max_days,
    'shipping_fee_minor', z.shipping_fee_minor,
    'free_shipping_threshold_minor', z.free_shipping_threshold_minor,
    'cod_available', z.cod_available,
    'district_count', (select count(*) from private.district_zones() dz
                       where dz.zone_id = z.id and dz.served),
    'not_served_count', (select count(*) from private.district_zones() dz
                         where dz.zone_id = z.id and not dz.served),
    'saved_address_count', (
      select count(*) from public.addresses a
      join private.district_zones() dz on dz.postal_code = a.postal_code
      where a.deleted_at is null and dz.zone_id = z.id and dz.served),
    'open_order_count', (select count(*) from public.orders o
                         where o.zone_id = z.id and private.order_is_open(o.status)),
    'upcoming_closures', (select count(*) from public.zone_closure_periods p
                          where p.zone_id = z.id and p.cancelled_at is null
                            and p.ends_on >= private.cr_today()),
    'in_use', exists (select 1 from public.cantons c where c.zone_id = z.id)
              or exists (select 1 from public.districts d where d.zone_id = z.id)
              or exists (select 1 from public.orders o where o.zone_id = z.id)
              or exists (select 1 from public.zone_closure_periods p where p.zone_id = z.id)
              or exists (select 1 from public.zone_closures c where c.zone_id = z.id),
    -- What a shopper ordering now is told for stock in a Yuntera warehouse.
    'promise', (select jsonb_build_object('earliest', p.earliest, 'latest', p.latest)
                from private.compute_promise(z.id, 0) p)
  )
  from public.delivery_zones z
  where z.id = p_zone_id;
$$;

-- ═══ 4. What the shop reads ════════════════════════════════════════════════

-- Replaces the version in geography: a district that is not served answers
-- like a zone that is switched off (zone_active false), so the product page
-- says it gives no date there.
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
  v_zone text;
  v_served boolean;
begin
  select dz.zone_id, dz.served into v_zone, v_served
  from private.district_zones() dz where dz.postal_code = p_postal_code;
  if v_zone is null then
    return;
  end if;
  return query
    select z.id, z.active and v_served, p.earliest, p.latest,
           z.shipping_fee_minor, z.free_shipping_threshold_minor, z.cod_available
    from public.delivery_zones z
    cross join lateral private.compute_promise(z.id, greatest(0, least(p_handling_days, 10))) p
    where z.id = v_zone;
end;
$$;

-- Replaces the version in lockdown: zone_active is false in a district that
-- is not served, as in a zone that is switched off.
create or replace function public.list_districts()
returns table (postal_code text, district text, canton_code text, canton text,
               province_code smallint, province text, zone_id text, zone_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select d.postal_code, d.name, c.code, c.name, p.code, p.name,
         coalesce(d.zone_id, c.zone_id), z.active and d.served
  from public.districts d
  join public.cantons c on c.code = d.canton_code
  join public.provinces p on p.code = c.province_code
  join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
  order by p.code, c.code, d.postal_code;
$$;

-- Replaces the version in lockdown, for the same reason: a saved address in a
-- district that is not served stays saved and cannot be chosen at checkout.
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
         coalesce(d.zone_id, c.zone_id), z.active and d.served
  from public.addresses a
  join public.districts d on d.postal_code = a.postal_code
  join public.cantons c on c.code = d.canton_code
  join public.provinces p on p.code = c.province_code
  join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
  where a.user_id = (select auth.uid()) and a.deleted_at is null
  order by a.is_default desc, a.created_at desc;
end;
$$;

-- Replaces the version in limits. The one change: a district that is not
-- served is quoted like a zone that is switched off (its zone, its fee, no
-- date, and the issue `zone_not_served`), not as an unknown district.
create or replace function public.checkout_quote(p_items jsonb, p_postal_code text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_max_units integer := (private.setting('max_units_per_line'))::integer;
  v_max_lines integer := (private.setting('max_lines_per_order'))::integer;
  v_cod_max bigint := (private.setting('cod_max_order_minor'))::bigint;
  v_postal text := left(p_postal_code, 10);
  v_zone public.delivery_zones%rowtype;
  v_served boolean;
  v_check record;
  v_shipping bigint := 0;
  v_shipping_tax bigint := 0;
  v_earliest date;
  v_latest date;
  v_issue text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('issue', 'cart_empty');
  end if;
  if jsonb_array_length(p_items) > v_max_lines then
    return jsonb_build_object('issue', 'too_many_lines');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'offer_id', '') !~ c_uuid) then
    return jsonb_build_object('issue', 'offer_unavailable');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where jsonb_typeof(e -> 'quantity') is distinct from 'number'
                or (e ->> 'quantity')::numeric <> floor((e ->> 'quantity')::numeric)
                or abs((e ->> 'quantity')::numeric) > 1000000) then
    -- Not a whole number at all. Whole numbers out of range are priced and
    -- flagged below, as before.
    return jsonb_build_object('issue', 'invalid_quantity');
  end if;

  select * into v_check from private.price_items(p_items, v_max_units);
  v_issue := case
    when v_check.line_count > v_max_lines then 'too_many_lines'
    when v_check.bad_quantity > 0 then 'invalid_quantity'
    when v_check.unavailable_offer is not null then 'offer_unavailable'
  end;

  select dz.served into v_served from private.district_zones() dz where dz.postal_code = v_postal;
  select z.* into v_zone from public.delivery_zones z
  where z.id = (select dz.zone_id from private.district_zones() dz where dz.postal_code = v_postal);

  if v_zone.id is not null then
    select shipping_minor, shipping_tax_minor into v_shipping, v_shipping_tax
    from private.shipping_for(v_zone.id, v_check.items_total);
    if v_zone.active and v_served then
      select c.earliest, c.latest into v_earliest, v_latest
      from private.compute_promise(v_zone.id, v_check.handling_days) c;
    else
      v_issue := coalesce(v_issue, 'zone_not_served');
    end if;
  end if;

  return jsonb_build_object(
    'issue', v_issue,
    'unavailable_offer_id', v_check.unavailable_offer,
    'items_total_minor', v_check.items_total,
    'shipping_minor', case when v_zone.id is null then null else v_shipping end,
    'total_minor', case when v_zone.id is null then null else v_check.items_total + v_shipping end,
    'tax_included_minor',
      case when v_zone.id is null then v_check.items_tax else v_check.items_tax + v_shipping_tax end,
    'free_shipping_threshold_minor', v_zone.free_shipping_threshold_minor,
    'zone', case when v_zone.id is null then null else
      jsonb_build_object('id', v_zone.id, 'name', v_zone.name, 'active', v_zone.active and v_served) end,
    'promise', case when v_latest is null then null else
      jsonb_build_object('earliest', v_earliest, 'latest', v_latest) end,
    'cod_available', coalesce(v_zone.cod_available, false)
                     and v_check.items_total + v_shipping <= v_cod_max,
    'payments_mode', private.setting('payments_mode') #>> '{}'
  );
end;
$$;

-- ═══ 5. Delivery zones ═════════════════════════════════════════════════════

create or replace function public.ops_delivery_zones() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(private.ops_zone_json(z.id) order by z.sort, z.id)
    from public.delivery_zones z), '[]'::jsonb);
end;
$$;

-- A new zone, switched off and with no districts until staff assign them.
create or replace function public.ops_create_zone(
  p_zone_id text,
  p_name text,
  p_cutoff_hour integer,
  p_processing_weekdays smallint[],
  p_delivery_weekdays smallint[],
  p_transit_min_days integer,
  p_transit_max_days integer,
  p_shipping_fee_minor bigint,
  p_free_shipping_threshold_minor bigint default null,
  p_cod_available boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text := lower(trim(coalesce(p_zone_id, '')));
  v_name text := private.clean_label(p_name);
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_id) not between 2 and 30 or v_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    perform private.fail('zone_id_invalid');
  end if;
  perform private.check_zone_service(v_name, p_cutoff_hour, p_processing_weekdays,
    p_delivery_weekdays, p_transit_min_days, p_transit_max_days, p_shipping_fee_minor,
    p_free_shipping_threshold_minor);
  perform pg_advisory_xact_lock(hashtext('yuntera.zones'));
  if exists (select 1 from public.delivery_zones z where z.id = v_id) then
    perform private.fail('zone_id_taken');
  end if;
  insert into public.delivery_zones
    (id, name, cutoff_hour, processing_weekdays, delivery_weekdays, transit_min_days,
     transit_max_days, shipping_fee_minor, free_shipping_threshold_minor, cod_available, active, sort)
  values
    (v_id, v_name, p_cutoff_hour, private.weekday_set(p_processing_weekdays),
     private.weekday_set(p_delivery_weekdays), p_transit_min_days, p_transit_max_days,
     p_shipping_fee_minor, p_free_shipping_threshold_minor, coalesce(p_cod_available, false), false,
     coalesce((select max(z.sort) + 1 from public.delivery_zones z), 1));
  return private.ops_zone_json(v_id);
end;
$$;

-- Changes what a zone holds today. Orders already placed keep what they were
-- promised and charged. Refused when someone changed the zone since
-- `p_revision` was read.
create or replace function public.ops_update_zone(
  p_zone_id text,
  p_revision integer,
  p_name text,
  p_cutoff_hour integer,
  p_processing_weekdays smallint[],
  p_delivery_weekdays smallint[],
  p_transit_min_days integer,
  p_transit_max_days integer,
  p_shipping_fee_minor bigint,
  p_free_shipping_threshold_minor bigint default null,
  p_cod_available boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  z public.delivery_zones%rowtype;
  v_name text := private.clean_label(p_name);
  v_processing smallint[] := private.weekday_set(p_processing_weekdays);
  v_delivery smallint[] := private.weekday_set(p_delivery_weekdays);
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  perform private.check_zone_service(v_name, p_cutoff_hour, p_processing_weekdays,
    p_delivery_weekdays, p_transit_min_days, p_transit_max_days, p_shipping_fee_minor,
    p_free_shipping_threshold_minor);
  select * into z from public.delivery_zones where id = p_zone_id for update;
  if not found then
    perform private.fail('zone_not_found');
  end if;
  if p_revision is distinct from z.revision then
    perform private.fail('zone_changed_meanwhile');
  end if;
  if z.name = v_name and z.cutoff_hour = p_cutoff_hour and z.processing_weekdays = v_processing
     and z.delivery_weekdays = v_delivery and z.transit_min_days = p_transit_min_days
     and z.transit_max_days = p_transit_max_days and z.shipping_fee_minor = p_shipping_fee_minor
     and z.free_shipping_threshold_minor is not distinct from p_free_shipping_threshold_minor
     and z.cod_available = coalesce(p_cod_available, false) then
    perform private.fail('zone_unchanged');
  end if;
  update public.delivery_zones
  set name = v_name, cutoff_hour = p_cutoff_hour, processing_weekdays = v_processing,
      delivery_weekdays = v_delivery, transit_min_days = p_transit_min_days,
      transit_max_days = p_transit_max_days, shipping_fee_minor = p_shipping_fee_minor,
      free_shipping_threshold_minor = p_free_shipping_threshold_minor,
      cod_available = coalesce(p_cod_available, false),
      revision = revision + 1, updated_at = now()
  where id = z.id;
  return private.ops_zone_json(z.id);
end;
$$;

-- Switches a zone off (no new orders to it; orders placed are untouched) or
-- on again. The last active zone stays on.
create or replace function public.ops_set_zone_active(
  p_zone_id text,
  p_active boolean,
  p_revision integer
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  z public.delivery_zones%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if p_active is null then
    perform private.fail('zone_unchanged');
  end if;
  -- One at a time, so two staff cannot each switch off one of the last two;
  -- and not while districts move (the same two locks, in the same order, as
  -- ops_move_districts and ops_delete_zone), so "serves a district" holds.
  perform pg_advisory_xact_lock(hashtext('yuntera.zones'));
  perform pg_advisory_xact_lock(hashtext('yuntera.districts'));
  select * into z from public.delivery_zones where id = p_zone_id for update;
  if not found then
    perform private.fail('zone_not_found');
  end if;
  if p_revision is distinct from z.revision then
    perform private.fail('zone_changed_meanwhile');
  end if;
  if z.active = p_active then
    perform private.fail('zone_unchanged');
  end if;
  -- Switched on, a zone with no district served would take no order and
  -- would let the zone it stands for look covered.
  if p_active and not private.zone_serves(z.id) then
    perform private.fail('zone_has_no_districts');
  end if;
  -- Another active zone must still serve a district: an active zone with
  -- none does not count.
  if not p_active and not exists (
    select 1 from public.delivery_zones o
    where o.active and o.id <> z.id and private.zone_serves(o.id)
  ) then
    perform private.fail('zone_last_active');
  end if;
  update public.delivery_zones
  set active = p_active, revision = revision + 1, updated_at = now()
  where id = z.id;
  return private.ops_zone_json(z.id);
end;
$$;

-- Deletes a zone nothing refers to (a new one created by mistake).
create or replace function public.ops_delete_zone(p_zone_id text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  z public.delivery_zones%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.zones'));
  -- Districts move under the same lock (ops_move_districts), so none can be
  -- assigned to this zone while it is deleted.
  perform pg_advisory_xact_lock(hashtext('yuntera.districts'));
  select * into z from public.delivery_zones where id = p_zone_id for update;
  if not found then
    perform private.fail('zone_not_found');
  end if;
  if (private.ops_zone_json(z.id) ->> 'in_use')::boolean then
    perform private.fail('zone_in_use');
  end if;
  delete from public.delivery_zones where id = z.id;
end;
$$;

-- ═══ 6. Districts ══════════════════════════════════════════════════════════

-- Every canton, with how its districts are served: for choosing one.
create or replace function public.ops_district_cantons() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.code, 'name', c.name, 'province_code', p.code, 'province', p.name,
      'district_count', x.district_count, 'served_count', x.served_count,
      'zones', x.zones
    ) order by p.code, c.code)
    from public.cantons c
    join public.provinces p on p.code = c.province_code
    cross join lateral (
      select count(*) as district_count,
             count(*) filter (where dz.served) as served_count,
             coalesce(jsonb_agg(distinct dz.zone_id) filter (where dz.served), '[]'::jsonb) as zones
      from private.district_zones() dz where dz.canton_code = c.code
    ) x), '[]'::jsonb);
end;
$$;

-- The districts of one canton, with their zone and what a move would touch.
create or replace function public.ops_canton_districts(p_canton_code text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.cantons%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  select * into c from public.cantons where code = p_canton_code;
  if not found then
    perform private.fail('canton_not_found');
  end if;
  return jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'province', (select p.name from public.provinces p where p.code = c.province_code),
    'canton_zone_id', c.zone_id,
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'postal_code', d.postal_code,
        'name', d.name,
        'zone_id', dz.zone_id,
        'zone_name', z.name,
        'zone_active', z.active,
        'served', d.served,
        'saved_address_count', (select count(*) from public.addresses a
                                where a.postal_code = d.postal_code and a.deleted_at is null),
        'open_order_count', (select count(*) from public.orders o
                             where o.ship_postal_code = d.postal_code and private.order_is_open(o.status))
      ) order by d.postal_code)
      from public.districts d
      join private.district_zones() dz on dz.postal_code = d.postal_code
      join public.delivery_zones z on z.id = dz.zone_id
      where d.canton_code = c.code), '[]'::jsonb));
end;
$$;

-- What assigning these districts to `p_zone_id` (null: not served) would
-- touch: the districts that change, their saved addresses and open orders,
-- and the zones left with no district served.
create or replace function private.district_move_impact(p_postal_codes text[], p_zone_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_codes text[];
  v_target public.delivery_zones%rowtype;
begin
  select array_agg(distinct c) into v_codes from unnest(p_postal_codes) c where c is not null;
  if v_codes is null or cardinality(v_codes) = 0 or cardinality(v_codes) > 60 then
    perform private.fail('district_selection_invalid');
  end if;
  if (select count(*) from public.districts d where d.postal_code = any (v_codes)) <> cardinality(v_codes) then
    perform private.fail('district_not_found');
  end if;
  if p_zone_id is not null then
    select * into v_target from public.delivery_zones where id = p_zone_id;
    if not found then
      perform private.fail('zone_not_found');
    end if;
  end if;
  return (
    with changing as (
      select dz.* from private.district_zones() dz
      where dz.postal_code = any (v_codes)
        and (case when p_zone_id is null then dz.served
                  else not dz.served or dz.zone_id <> p_zone_id end)
    ),
    after as (
      select dz.postal_code,
             case when ch.postal_code is not null and p_zone_id is not null then p_zone_id
                  else dz.zone_id end as zone_id,
             case when ch.postal_code is not null then p_zone_id is not null
                  else dz.served end as served
      from private.district_zones() dz
      left join changing ch on ch.postal_code = dz.postal_code
    )
    select jsonb_build_object(
      'district_count', cardinality(v_codes),
      'changing_count', (select count(*) from changing),
      'changing', coalesce((select jsonb_agg(ch.postal_code order by ch.postal_code) from changing ch), '[]'::jsonb),
      'saved_address_count', (select count(*) from public.addresses a
                              where a.deleted_at is null
                                and a.postal_code in (select ch.postal_code from changing ch)),
      'open_order_count', (select count(*) from public.orders o
                           where private.order_is_open(o.status)
                             and o.ship_postal_code in (select ch.postal_code from changing ch)),
      'target', case when p_zone_id is null then null else
        jsonb_build_object('id', v_target.id, 'name', v_target.name, 'active', v_target.active) end,
      -- Zones that serve a district now and would serve none afterwards.
      'zones_left_empty', coalesce((
        select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) order by z.sort, z.id)
        from public.delivery_zones z
        where exists (select 1 from private.district_zones() dz where dz.zone_id = z.id and dz.served)
          and not exists (select 1 from after a where a.zone_id = z.id and a.served)), '[]'::jsonb),
      -- No active zone would serve any district: nobody could order.
      'nothing_served_after', not exists (
        select 1 from after a join public.delivery_zones z on z.id = a.zone_id
        where a.served and z.active)
    ));
end;
$$;

create or replace function public.ops_district_move_preview(p_postal_codes text[], p_zone_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return private.district_move_impact(p_postal_codes, p_zone_id);
end;
$$;

-- Assigns districts to a zone (served from then on), or marks them as not
-- served (`p_zone_id` null; they keep their zone for the record). Future
-- orders follow; orders already placed keep their zone, fee and promise.
create or replace function public.ops_move_districts(p_postal_codes text[], p_zone_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_impact jsonb;
  r record;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  -- One move at a time, so "left with no districts" is worked out on what is
  -- there, a zone being deleted cannot receive a district, and no zone is
  -- switched on or off meanwhile (zones first, then districts, as
  -- ops_set_zone_active and ops_delete_zone take them).
  perform pg_advisory_xact_lock(hashtext('yuntera.zones'));
  perform pg_advisory_xact_lock(hashtext('yuntera.districts'));
  v_impact := private.district_move_impact(p_postal_codes, p_zone_id);
  if (v_impact ->> 'changing_count')::integer = 0 then
    perform private.fail('district_unchanged');
  end if;
  if (v_impact ->> 'nothing_served_after')::boolean then
    perform private.fail('districts_none_served');
  end if;
  for r in
    select d.postal_code, d.zone_id as own_zone, dz.zone_id, d.served
    from public.districts d
    join private.district_zones() dz on dz.postal_code = d.postal_code
    where d.postal_code in (select jsonb_array_elements_text(v_impact -> 'changing'))
    order by d.postal_code
    for update of d
  loop
    if p_zone_id is null then
      update public.districts set served = false where postal_code = r.postal_code;
    else
      update public.districts set zone_id = p_zone_id, served = true where postal_code = r.postal_code;
    end if;
    perform private.operations_audit('district_zone', 'districts', r.postal_code,
      jsonb_build_object('zone_id', r.zone_id, 'own_zone_id', r.own_zone, 'served', r.served),
      jsonb_build_object('zone_id', coalesce(p_zone_id, r.zone_id),
                         'own_zone_id', coalesce(p_zone_id, r.own_zone),
                         'served', p_zone_id is not null));
  end loop;
  return v_impact;
end;
$$;

-- ═══ 7. Holidays ═══════════════════════════════════════════════════════════

-- Open orders whose promise window includes this day, in any zone.
create or replace function private.orders_promised_on(p_day date) returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(*)::integer from public.orders o
  where private.order_is_open(o.status) and p_day between o.promise_earliest and o.promise_latest;
$$;

-- Routes planned for this day that are not cancelled.
create or replace function private.routes_planned_on(p_day date) returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(*)::integer from public.routes r
  where r.service_date = p_day and r.status <> 'cancelled';
$$;

create or replace function public.ops_holidays() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := private.cr_today();
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'today', v_today,
    'latest_allowed', v_today + 730,
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', h.day, 'name', h.name,
        'changeable', h.day > v_today,
        'routes_planned', private.routes_planned_on(h.day),
        'promised_orders', private.orders_promised_on(h.day)
      ) order by h.day)
      from public.holidays h where h.day >= v_today - 60), '[]'::jsonb));
end;
$$;

-- Adds a day without processing or delivery. Refused on a day with routes
-- planned; on a day with open orders promised, refused unless `p_confirm`
-- (the console shows their count first). Those orders keep their promise.
create or replace function public.ops_add_holiday(
  p_day date,
  p_name text,
  p_confirm boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_label(p_name);
  v_today date := private.cr_today();
  v_routes integer;
  v_orders integer;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if v_name is null or char_length(v_name) not between 3 and 60 or not private.has_letters(v_name) then
    perform private.fail('holiday_name_invalid');
  end if;
  if p_day is null or p_day <= v_today then
    perform private.fail('holiday_in_past');
  end if;
  if p_day > v_today + 730 then
    perform private.fail('holiday_too_far');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.holidays'));
  if exists (select 1 from public.holidays h where h.day = p_day) then
    perform private.fail('holiday_exists');
  end if;
  v_routes := private.routes_planned_on(p_day);
  if v_routes > 0 then
    perform private.fail('holiday_has_routes', v_routes::text);
  end if;
  v_orders := private.orders_promised_on(p_day);
  if v_orders > 0 and not coalesce(p_confirm, false) then
    perform private.fail('holiday_has_promised_orders', v_orders::text);
  end if;
  insert into public.holidays (day, name) values (p_day, v_name);
  return jsonb_build_object('day', p_day, 'name', v_name, 'promised_orders', v_orders);
end;
$$;

-- Removes a day without delivery (a holiday the law moved, or one entered by
-- mistake). Only days after today.
create or replace function public.ops_remove_holiday(p_day date) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  h public.holidays%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if p_day is null or p_day <= private.cr_today() then
    perform private.fail('holiday_in_past');
  end if;
  perform pg_advisory_xact_lock(hashtext('yuntera.holidays'));
  delete from public.holidays where day = p_day returning * into h;
  if not found then
    perform private.fail('holiday_not_found');
  end if;
  return jsonb_build_object('day', h.day, 'name', h.name);
end;
$$;

-- ═══ 8. Zone closures ══════════════════════════════════════════════════════

-- True when another closure of the zone (or a day closed on its own) falls
-- between these dates.
create or replace function private.closure_overlaps(
  p_zone_id text, p_from date, p_to date, p_except uuid
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.zone_closure_periods p
    where p.zone_id = p_zone_id and p.cancelled_at is null and p.id is distinct from p_except
      and p.starts_on <= p_to and p.ends_on >= p_from
  ) or exists (
    select 1 from public.zone_closures c
    where c.zone_id = p_zone_id and c.period_id is null and c.day between p_from and p_to
  );
$$;

-- Writes a period's days from today on into zone_closures (the days the
-- promise skips). Days already past are left as they were.
create or replace function private.sync_closure_days(p_period_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.zone_closure_periods%rowtype;
  v_today date := private.cr_today();
begin
  select * into p from public.zone_closure_periods where id = p_period_id;
  delete from public.zone_closures c where c.period_id = p.id and c.day >= v_today;
  if p.cancelled_at is null then
    insert into public.zone_closures (zone_id, day, reason, period_id)
    select p.zone_id, d::date, p.reason, p.id
    from generate_series(greatest(p.starts_on, v_today), p.ends_on, interval '1 day') d
    on conflict (zone_id, day) do nothing;
  end if;
end;
$$;

-- A closure as staff see it, with the open orders promised inside it.
create or replace function private.ops_closure_json(p_period_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'zone_id', p.zone_id,
    'zone_name', z.name,
    'starts_on', p.starts_on,
    'ends_on', p.ends_on,
    'reason', p.reason,
    'note', p.note,
    'revision', p.revision,
    'state', case
      when p.cancelled_at is not null then 'cancelled'
      when p.ends_on < private.cr_today() then 'over'
      when p.starts_on > private.cr_today() then 'upcoming'
      else 'current' end,
    'ended_early', p.ended_early_at is not null,
    'created_at', p.created_at,
    'affected_order_count', (
      select count(*) from public.orders o
      where o.zone_id = p.zone_id and private.order_is_open(o.status)
        and o.promise_latest >= p.starts_on and o.promise_earliest <= p.ends_on),
    'affected_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_number', x.order_number, 'status', x.status,
        'promise_earliest', x.promise_earliest, 'promise_latest', x.promise_latest)
        order by x.promise_latest, x.order_number)
      from (
        select o.order_number, o.status, o.promise_earliest, o.promise_latest
        from public.orders o
        where o.zone_id = p.zone_id and private.order_is_open(o.status)
          and o.promise_latest >= p.starts_on and o.promise_earliest <= p.ends_on
        order by o.promise_latest, o.order_number
        limit 50
      ) x), '[]'::jsonb)
  )
  from public.zone_closure_periods p
  join public.delivery_zones z on z.id = p.zone_id
  where p.id = p_period_id;
$$;

create or replace function private.closure_audit_row(p public.zone_closure_periods) returns jsonb
language sql immutable
set search_path = ''
as $$
  -- The note is left out: it is free text.
  select jsonb_build_object('zone_id', p.zone_id, 'starts_on', p.starts_on, 'ends_on', p.ends_on,
                            'reason', p.reason, 'cancelled', p.cancelled_at is not null,
                            'ended_early', p.ended_early_at is not null);
$$;

create or replace function public.ops_zone_closures() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := private.cr_today();
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'today', v_today,
    'closures', coalesce((
      select jsonb_agg(private.ops_closure_json(p.id) order by p.starts_on, p.zone_id, p.id)
      from public.zone_closure_periods p
      where (p.cancelled_at is null and p.ends_on >= v_today - 30)
         -- Cancelled before it started, lately: shown so it can be closed
         -- again, until the zone is closed on those days by another one.
         or (p.cancelled_at > now() - interval '7 days' and p.ends_on >= v_today
             and not private.closure_overlaps(p.zone_id, greatest(p.starts_on, v_today), p.ends_on, p.id))),
      '[]'::jsonb),
    -- Days closed one by one, outside any period (before this migration).
    'single_days', coalesce((
      select jsonb_agg(jsonb_build_object('zone_id', c.zone_id, 'zone_name', z.name, 'day', c.day,
                                          'reason', c.reason) order by c.day, c.zone_id)
      from public.zone_closures c join public.delivery_zones z on z.id = c.zone_id
      where c.period_id is null and c.day >= v_today), '[]'::jsonb));
end;
$$;

create or replace function private.check_closure_dates(p_starts_on date, p_ends_on date) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    perform private.fail('zone_closure_dates_invalid');
  end if;
  if p_ends_on < private.cr_today() then
    perform private.fail('zone_closure_in_past');
  end if;
  if p_starts_on > private.cr_today() + 365 then
    perform private.fail('zone_closure_too_far');
  end if;
  if p_ends_on - p_starts_on > 30 then
    perform private.fail('zone_closure_too_long');
  end if;
end;
$$;

-- Closes a zone from `p_starts_on` to `p_ends_on`, both included.
create or replace function public.ops_open_zone_closure(
  p_zone_id text,
  p_starts_on date,
  p_ends_on date,
  p_reason text,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note text := private.clean_label(p_note);
  p public.zone_closure_periods%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if p_reason is null or p_reason not in ('weather', 'road_closed', 'capacity', 'other') then
    perform private.fail('zone_closure_reason_invalid');
  end if;
  if (p_reason = 'other' and (v_note is null or char_length(v_note) < 3))
     or (v_note is not null and not private.has_letters(v_note))
     or char_length(coalesce(v_note, '')) > 200 then
    perform private.fail('zone_closure_note_invalid');
  end if;
  if p_starts_on is not null and p_starts_on < private.cr_today() then
    perform private.fail('zone_closure_in_past');
  end if;
  perform private.check_closure_dates(p_starts_on, p_ends_on);
  -- The zone's row is the lock for its closures: two staff closing the same
  -- zone at once are taken one after the other.
  perform 1 from public.delivery_zones where id = p_zone_id for update;
  if not found then
    perform private.fail('zone_not_found');
  end if;
  if private.closure_overlaps(p_zone_id, p_starts_on, p_ends_on, null) then
    perform private.fail('zone_closure_overlaps');
  end if;
  insert into public.zone_closure_periods (zone_id, starts_on, ends_on, reason, note, created_by)
  values (p_zone_id, p_starts_on, p_ends_on, p_reason, v_note, (select auth.uid()))
  returning * into p;
  perform private.sync_closure_days(p.id);
  perform private.operations_audit('closure_opened', 'zone_closure_periods', p.id::text, null,
                                   private.closure_audit_row(p));
  return private.ops_closure_json(p.id);
end;
$$;

-- Moves a closure's last day (sooner or later). Days already past stay.
create or replace function public.ops_change_zone_closure_end(
  p_closure_id uuid,
  p_ends_on date,
  p_revision integer
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_zone text;
  p public.zone_closure_periods%rowtype;
  v_old public.zone_closure_periods%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  select zone_id into v_zone from public.zone_closure_periods where id = p_closure_id;
  perform 1 from public.delivery_zones where id = v_zone for update;
  select * into p from public.zone_closure_periods where id = p_closure_id for update;
  if not found then
    perform private.fail('zone_closure_not_found');
  end if;
  if p_revision is distinct from p.revision then
    perform private.fail('zone_closure_changed_meanwhile');
  end if;
  if p.cancelled_at is not null then
    perform private.fail('zone_closure_over');
  end if;
  if p_ends_on is not null and p_ends_on < private.cr_today() then
    perform private.fail('zone_closure_in_past');
  end if;
  perform private.check_closure_dates(p.starts_on, p_ends_on);
  if p_ends_on = p.ends_on then
    perform private.fail('zone_closure_unchanged');
  end if;
  if private.closure_overlaps(p.zone_id, p.starts_on, p_ends_on, p.id) then
    perform private.fail('zone_closure_overlaps');
  end if;
  v_old := p;
  update public.zone_closure_periods
  set ends_on = p_ends_on, ended_early_at = null, ended_early_by = null,
      revision = revision + 1, updated_at = now()
  where id = p.id
  returning * into p;
  perform private.sync_closure_days(p.id);
  perform private.operations_audit('closure_end_changed', 'zone_closure_periods', p.id::text,
                                   private.closure_audit_row(v_old), private.closure_audit_row(p));
  return private.ops_closure_json(p.id);
end;
$$;

-- Ends a closure now: the zone delivers again from today. One that has not
-- started is cancelled.
create or replace function public.ops_end_zone_closure(p_closure_id uuid, p_revision integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_today date := private.cr_today();
  p public.zone_closure_periods%rowtype;
  v_old public.zone_closure_periods%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  select zone_id into v_zone from public.zone_closure_periods where id = p_closure_id;
  perform 1 from public.delivery_zones where id = v_zone for update;
  select * into p from public.zone_closure_periods where id = p_closure_id for update;
  if not found then
    perform private.fail('zone_closure_not_found');
  end if;
  if p_revision is distinct from p.revision then
    perform private.fail('zone_closure_changed_meanwhile');
  end if;
  if p.cancelled_at is not null or p.ends_on < v_today then
    perform private.fail('zone_closure_over');
  end if;
  v_old := p;
  if p.starts_on >= v_today then
    update public.zone_closure_periods
    set cancelled_at = now(), ended_early_at = now(), ended_early_by = (select auth.uid()),
        revision = revision + 1, updated_at = now()
    where id = p.id returning * into p;
  else
    update public.zone_closure_periods
    set ends_on = v_today - 1, ended_early_at = now(), ended_early_by = (select auth.uid()),
        revision = revision + 1, updated_at = now()
    where id = p.id returning * into p;
  end if;
  perform private.sync_closure_days(p.id);
  perform private.operations_audit('closure_ended', 'zone_closure_periods', p.id::text,
                                   private.closure_audit_row(v_old), private.closure_audit_row(p));
  return private.ops_closure_json(p.id);
end;
$$;

-- ═══ 9. Platform settings ══════════════════════════════════════════════════

-- The settings staff may tune, with their range. Every other key is
-- protected: changed only by the deployment runbook. Units: 'count',
-- 'minor' (céntimos, shown in colones), 'per_hour'.
create or replace function private.operational_setting(p_key text)
returns table (key text, min_value bigint, max_value bigint, unit text)
language sql immutable
set search_path = ''
as $$
  select * from (values
    ('cod_max_order_minor', 100000::bigint, 100000000::bigint, 'minor'),
    ('max_held_units_per_account', 1, 500, 'count'),
    ('max_unpaid_orders_per_account', 1, 20, 'count'),
    ('max_open_cod_orders_new_account', 0, 10, 'count'),
    ('max_pending_shops_per_account', 1, 5, 'count'),
    ('max_listings_in_review_per_seller', 1, 1000, 'count'),
    ('max_new_offers_per_day_per_seller', 1, 1000, 'count'),
    ('max_draft_listings_per_seller', 10, 5000, 'count'),
    ('max_open_inbounds_per_seller', 1, 100, 'count'),
    ('max_lines_per_inbound', 1, 500, 'count'),
    ('max_units_per_inbound_line', 1, 1000000, 'count'),
    ('max_members_per_shop', 1, 200, 'count'),
    ('max_pending_invitations_per_shop', 1, 100, 'count'),
    ('max_open_complaints_per_account', 1, 50, 'count'),
    ('max_open_reports_per_account', 1, 200, 'count'),
    ('visitor_reports_per_hour', 10, 10000, 'per_hour')
  ) s (key, min_value, max_value, unit)
  where s.key = p_key;
$$;

-- Every setting, operational or protected, for administrators.
create or replace function public.ops_settings() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', s.key,
      'value', s.value,
      'description', s.description,
      'editable', r.key is not null,
      'min_value', r.min_value,
      'max_value', r.max_value,
      'unit', r.unit,
      'updated_at', s.updated_at
    ) order by (r.key is null), s.key)
    from public.app_settings s
    left join lateral private.operational_setting(s.key) r on true), '[]'::jsonb);
end;
$$;

-- Changes one operational setting to a whole number within its range, if it
-- still holds `p_expected` (what the administrator saw).
create or replace function public.ops_update_setting(p_key text, p_value jsonb, p_expected jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.app_settings%rowtype;
  r record;
  v_number numeric;
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  select * into r from private.operational_setting(p_key);
  if r.key is null then
    -- Not on the list: protected, whether or not it exists.
    if exists (select 1 from public.app_settings a where a.key = p_key) then
      perform private.fail('setting_protected');
    end if;
    perform private.fail('setting_not_found');
  end if;
  if jsonb_typeof(p_value) is distinct from 'number' then
    perform private.fail('setting_out_of_range');
  end if;
  v_number := (p_value #>> '{}')::numeric;
  if v_number <> floor(v_number) or v_number < r.min_value or v_number > r.max_value then
    perform private.fail('setting_out_of_range', r.min_value || '-' || r.max_value);
  end if;
  select * into s from public.app_settings where key = p_key for update;
  if not found then
    perform private.fail('setting_not_found');
  end if;
  if s.value is distinct from p_expected then
    perform private.fail('setting_changed_meanwhile');
  end if;
  if s.value = to_jsonb(v_number::bigint) then
    perform private.fail('setting_unchanged');
  end if;
  -- The audit trigger on app_settings records the old and the new value.
  update public.app_settings set value = to_jsonb(v_number::bigint) where key = s.key
  returning * into s;
  return jsonb_build_object('key', s.key, 'value', s.value, 'updated_at', s.updated_at);
end;
$$;

-- ═══ 10. Warehouse locations ═══════════════════════════════════════════════

-- No stock goes into a location that is switched off: a receipt or a move
-- that started before the switch waits for it, then is refused.
create or replace function private.bin_stock_location_open() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before integer := 0;
begin
  if tg_op = 'UPDATE' then
    v_before := old.quantity;
  end if;
  if new.quantity > v_before then
    perform 1 from public.warehouse_locations wl
    where wl.id = new.location_id and wl.active
    for share;
    if not found then
      perform private.fail('location_not_found');
    end if;
  end if;
  return new;
end;
$$;

create trigger bin_stock_location_open before insert or update of quantity on public.bin_stock
  for each row execute function private.bin_stock_location_open();

-- The code of a storage or picking location: zone letter, aisle, level and
-- position, as the warehouse's labels (A-01-02-B).
create or replace function private.location_code(p_code text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_code !~ '^[A-Z]-[0-9]{2}-[0-9]{2}-[A-Z]$' then
    perform private.fail('location_code_invalid');
  end if;
  return v_code;
end;
$$;

-- Units picked from a location into parcels that are still being picked:
-- they go back to this location if the order is cancelled.
create or replace function private.location_picked_units(p_location_id uuid) returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(m.quantity), 0)::bigint
  from public.stock_movements m
  join public.shipments s on s.id = m.reference_id
  where m.from_location_id = p_location_id and m.reason = 'pick'
    and m.reference_type = 'shipment' and s.status = 'picking';
$$;

create or replace function private.ops_location_json(p_location_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', wl.id,
    'code', wl.code,
    'kind', wl.kind,
    'active', wl.active,
    'editable', wl.kind in ('storage', 'pick'),
    'units', (select coalesce(sum(b.quantity), 0) from public.bin_stock b where b.location_id = wl.id),
    'picked_units', private.location_picked_units(wl.id),
    'open_tasks', (select count(*) from public.pick_tasks t
                   where t.location_id = wl.id and t.status in ('open', 'in_progress'))
  )
  from public.warehouse_locations wl where wl.id = p_location_id;
$$;

-- Yuntera's warehouses with all their locations, switched on or off.
create or replace function public.ops_warehouse_locations() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'code', w.code, 'name', w.name, 'active', w.active,
      'locations', coalesce((
        select jsonb_agg(private.ops_location_json(wl.id)
                         order by (wl.kind in ('storage', 'pick')) desc, wl.code)
        from public.warehouse_locations wl where wl.warehouse_id = w.id), '[]'::jsonb)
    ) order by w.code)
    from public.warehouses w where w.kind = 'platform'), '[]'::jsonb);
end;
$$;

create or replace function public.ops_create_location(
  p_warehouse_id uuid,
  p_code text,
  p_kind public.location_kind
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code text;
  v_id uuid;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if p_kind is null or p_kind not in ('storage', 'pick') then
    perform private.fail('location_kind_invalid');
  end if;
  v_code := private.location_code(p_code);
  perform 1 from public.warehouses w
  where w.id = p_warehouse_id and w.kind = 'platform' and w.active
  for update;
  if not found then
    perform private.fail('warehouse_not_found');
  end if;
  if exists (select 1 from public.warehouse_locations wl
             where wl.warehouse_id = p_warehouse_id and wl.code = v_code) then
    perform private.fail('location_code_taken');
  end if;
  insert into public.warehouse_locations (warehouse_id, code, kind, active)
  values (p_warehouse_id, v_code, p_kind, true)
  returning id into v_id;
  perform private.operations_audit('location_created', 'warehouse_locations', v_id::text, null,
    jsonb_build_object('warehouse_id', p_warehouse_id, 'code', v_code, 'kind', p_kind, 'active', true));
  return private.ops_location_json(v_id);
end;
$$;

-- Gives a location a new code (its label was changed). Not while an open pick
-- task names it: the picker is looking for the old label.
create or replace function public.ops_rename_location(p_location_id uuid, p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  wl public.warehouse_locations%rowtype;
  v_code text;
  v_tasks integer;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  v_code := private.location_code(p_code);
  select l.* into wl from public.warehouse_locations l
  join public.warehouses w on w.id = l.warehouse_id and w.kind = 'platform'
  where l.id = p_location_id;
  if not found then
    perform private.fail('location_not_found');
  end if;
  perform 1 from public.warehouses w where w.id = wl.warehouse_id for update;
  select * into wl from public.warehouse_locations where id = p_location_id for update;
  if wl.kind not in ('storage', 'pick') then
    perform private.fail('location_not_editable');
  end if;
  if wl.code = v_code then
    perform private.fail('location_unchanged');
  end if;
  if exists (select 1 from public.warehouse_locations l
             where l.warehouse_id = wl.warehouse_id and l.code = v_code) then
    perform private.fail('location_code_taken');
  end if;
  select count(*) into v_tasks from public.pick_tasks t
  where t.location_id = wl.id and t.status in ('open', 'in_progress');
  if v_tasks > 0 then
    perform private.fail('location_has_open_tasks', v_tasks::text);
  end if;
  update public.warehouse_locations set code = v_code where id = wl.id;
  perform private.operations_audit('location_renamed', 'warehouse_locations', wl.id::text,
    jsonb_build_object('code', wl.code), jsonb_build_object('code', v_code));
  return private.ops_location_json(wl.id) || jsonb_build_object('previous_code', wl.code);
end;
$$;

-- Switches a location off (no longer offered to the warehouse) or on again.
create or replace function public.ops_set_location_active(p_location_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  wl public.warehouse_locations%rowtype;
  v_units bigint;
  v_picked bigint;
  v_tasks integer;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  select l.* into wl from public.warehouse_locations l
  join public.warehouses w on w.id = l.warehouse_id and w.kind = 'platform'
  where l.id = p_location_id;
  if not found then
    perform private.fail('location_not_found');
  end if;
  -- The warehouse's row first: two staff switching off its last two
  -- locations are taken one after the other.
  perform 1 from public.warehouses w where w.id = wl.warehouse_id for update;
  select * into wl from public.warehouse_locations where id = p_location_id for update;
  if wl.kind not in ('storage', 'pick') then
    perform private.fail('location_not_editable');
  end if;
  if p_active is null or wl.active = p_active then
    perform private.fail('location_unchanged');
  end if;
  if not p_active then
    select coalesce(sum(b.quantity), 0) into v_units from public.bin_stock b where b.location_id = wl.id;
    if v_units > 0 then
      perform private.fail('location_has_stock', v_units::text);
    end if;
    select count(*) into v_tasks from public.pick_tasks t
    where t.location_id = wl.id and t.status in ('open', 'in_progress');
    if v_tasks > 0 then
      perform private.fail('location_has_open_tasks', v_tasks::text);
    end if;
    -- Units already taken off this shelf into a parcel still being picked:
    -- cancelling that order puts them back here (cancel_order_internal).
    v_picked := private.location_picked_units(wl.id);
    if v_picked > 0 then
      perform private.fail('location_has_picked_units', v_picked::text);
    end if;
    if not exists (select 1 from public.warehouse_locations l
                   where l.warehouse_id = wl.warehouse_id and l.id <> wl.id and l.active
                     and l.kind in ('storage', 'pick')) then
      perform private.fail('location_last_active');
    end if;
  end if;
  update public.warehouse_locations set active = p_active where id = wl.id;
  perform private.operations_audit('location_active', 'warehouse_locations', wl.id::text,
    jsonb_build_object('code', wl.code, 'active', wl.active),
    jsonb_build_object('code', wl.code, 'active', p_active));
  return private.ops_location_json(wl.id);
end;
$$;

-- ═══ 11. Stuck routes ══════════════════════════════════════════════════════

-- Why a stop cannot be taken off its route, or null.
create or replace function private.stop_not_removable(p_status public.stop_status) returns text
language sql immutable
set search_path = ''
as $$
  select case p_status
    when 'pending' then null
    when 'arrived' then 'attempt_in_progress'
    else 'closed' end;
$$;

-- Every route not yet completed or cancelled, the stuck ones first, with
-- each stop's parcel. Never a delivery code; no recipient's name or phone.
create or replace function public.ops_open_routes() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := private.cr_today();
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.route order by x.stuck desc, (x.route ->> 'service_date'), (x.route ->> 'code'))
    from (
      select r.id, s.stuck, jsonb_build_object(
        'route_id', r.id,
        'code', r.code,
        'status', r.status,
        'service_date', r.service_date,
        'started_at', r.started_at,
        'driver_name', (select d.full_name from public.drivers d where d.id = r.driver_id),
        'open_stops', s.open_stops,
        'stuck', s.stuck,
        'stuck_reasons', to_jsonb(s.reasons),
        'stops', coalesce((
          select jsonb_agg(jsonb_build_object(
            'stop_id', rs.id,
            'sequence', rs.sequence,
            'status', rs.status,
            'tracking_code', sh.tracking_code,
            'shipment_status', sh.status,
            'order_number', o.order_number,
            'district', (select dd.name from public.districts dd where dd.postal_code = o.ship_postal_code),
            'cash_planned', rs.cod_amount_minor > 0,
            'removed_at', rs.removed_at,
            'removal_reason', rs.removal_reason,
            'not_removable', private.stop_not_removable(rs.status)
          ) order by rs.sequence)
          from public.route_stops rs
          join public.shipments sh on sh.id = rs.shipment_id
          join public.orders o on o.id = sh.order_id
          where rs.route_id = r.id), '[]'::jsonb)
      ) as route
      from public.routes r
      cross join lateral (
        select o.open_stops, cardinality(o.reasons) > 0 as stuck, o.reasons
        from (
          select (select count(*) from public.route_stops rs
                  where rs.route_id = r.id and rs.status in ('pending', 'arrived')) as open_stops,
                 array_remove(array[
                   case when r.service_date < v_today then 'past_date' end,
                   case when exists (select 1 from public.route_stops rs
                                     join public.shipments sh on sh.id = rs.shipment_id
                                     where rs.route_id = r.id and rs.status in ('pending', 'arrived')
                                       and sh.status in ('cancelled', 'returning', 'returned'))
                        then 'cancelled_parcel' end,
                   case when not exists (select 1 from public.route_stops rs
                                         where rs.route_id = r.id and rs.status in ('pending', 'arrived'))
                        then 'no_open_stops' end
                 ], null) as reasons
        ) o
      ) s
      where r.status in ('draft', 'assigned', 'in_progress')
    ) x), '[]'::jsonb);
end;
$$;

-- Takes a pending stop off its route. The parcel goes back to waiting for a
-- route (see the header); the stop stays, marked skipped.
create or replace function public.ops_remove_route_stop(p_stop_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := private.clean_label(p_reason);
  v_order uuid;
  v_route public.routes%rowtype;
  v_stop public.route_stops%rowtype;
  v_ship public.shipments%rowtype;
  v_to public.shipment_status;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if v_reason is null or char_length(v_reason) not between 5 and 300 or not private.has_letters(v_reason) then
    perform private.fail('reason_required');
  end if;
  -- The order first, as every function that changes a parcel or its cash
  -- does (driver_complete_stop, driver_fail_stop, ops_create_route), then the
  -- route, the stop and the parcel.
  select s.order_id into v_order
  from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
  where rs.id = p_stop_id;
  if not found then
    perform private.fail('stop_not_found');
  end if;
  perform 1 from public.orders where id = v_order for update;
  select r.* into v_route from public.routes r
  where r.id = (select rs.route_id from public.route_stops rs where rs.id = p_stop_id)
  for update;
  select * into v_stop from public.route_stops where id = p_stop_id for update;
  if v_route.status not in ('draft', 'assigned', 'in_progress') then
    perform private.fail('route_closed');
  end if;
  if v_stop.status = 'arrived' then
    perform private.fail('stop_attempt_in_progress');
  end if;
  if v_stop.status <> 'pending' then
    perform private.fail('stop_already_closed', v_stop.status::text);
  end if;
  select * into v_ship from public.shipments where id = v_stop.shipment_id for update;

  update public.route_stops
  set status = 'skipped', cod_amount_minor = 0, removed_at = now(),
      removed_by = (select auth.uid()), removal_reason = v_reason,
      completed_at = now(), completed_received_at = now()
  where id = v_stop.id;

  v_to := case v_ship.status
    when 'ready_for_dispatch' then 'packed'
    when 'out_for_delivery' then 'delivery_failed'
  end::public.shipment_status;
  if v_to is not null then
    update public.shipments set status = v_to where id = v_ship.id;
    -- Nothing happened at the shopper's door: the step is staff's, not theirs.
    update public.order_events e set visible_to_customer = false
    where e.id = (select max(e2.id) from public.order_events e2
                  where e2.shipment_id = v_ship.id and e2.kind = 'shipment_status'
                    and e2.to_status = v_to::text);
  end if;
  insert into public.order_events (order_id, shipment_id, kind, note, visible_to_customer, actor_id)
  values (v_order, v_ship.id, 'note',
          'Central quitó el paquete ' || v_ship.tracking_code || ' de la ruta ' || v_route.code
            || '. Vuelve a esperar ruta.',
          false, (select auth.uid()));

  -- The cash planned on it moves to another live stop of the order, or to the
  -- parcel's next route. Nothing is collected or refunded here.
  perform private.replan_cod(v_order);
  perform private.sync_order_status(v_order);

  perform private.operations_audit('stop_removed', 'route_stops', v_stop.id::text,
    jsonb_build_object('route', v_route.code, 'tracking_code', v_ship.tracking_code,
                       'stop_status', v_stop.status, 'shipment_status', v_ship.status),
    jsonb_build_object('route', v_route.code, 'tracking_code', v_ship.tracking_code,
                       'stop_status', 'skipped', 'shipment_status', coalesce(v_to, v_ship.status)));
  return jsonb_build_object(
    'route_id', v_route.id,
    'route_code', v_route.code,
    'tracking_code', v_ship.tracking_code,
    'shipment_status', coalesce(v_to, v_ship.status),
    'open_stops', (select count(*) from public.route_stops rs
                   where rs.route_id = v_route.id and rs.status in ('pending', 'arrived')));
end;
$$;

-- Closes a route with no stop still out: completed (its cash count opens)
-- when it was being driven, cancelled when it never started.
create or replace function public.ops_close_route(p_route_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := private.clean_label(p_reason);
  r public.routes%rowtype;
  v_open integer;
  v_status public.route_status;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if v_reason is null or char_length(v_reason) not between 5 and 300 or not private.has_letters(v_reason) then
    perform private.fail('reason_required');
  end if;
  select * into r from public.routes where id = p_route_id for update;
  if not found then
    perform private.fail('route_not_found');
  end if;
  if r.status not in ('draft', 'assigned', 'in_progress') then
    perform private.fail('route_closed');
  end if;
  select count(*) into v_open from public.route_stops rs
  where rs.route_id = r.id and rs.status in ('pending', 'arrived');
  if v_open > 0 then
    perform private.fail('route_has_open_stops', v_open::text);
  end if;
  if r.status = 'in_progress' then
    perform private.maybe_complete_route(r.id);
  else
    update public.routes set status = 'cancelled' where id = r.id;
  end if;
  update public.routes
  set closed_at = now(), closed_by = (select auth.uid()), close_reason = v_reason
  where id = r.id
  returning status into v_status;
  perform private.operations_audit('route_closed', 'routes', r.id::text,
    jsonb_build_object('code', r.code, 'status', r.status),
    jsonb_build_object('code', r.code, 'status', v_status));
  return jsonb_build_object('route_id', r.id, 'code', r.code, 'status', v_status);
end;
$$;

-- ═══ 11b. A seller's pickup point ══════════════════════════════════════════

-- Replaces the version in limits. The one change: a district that is not
-- served is refused like a switched-off zone (`zone_not_served`), since our
-- drivers do not go there either.
create or replace function public.seller_save_location(
  p_seller_id uuid,
  p_name text,
  p_address text,
  p_postal_code text,
  p_lat double precision,
  p_lng double precision
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  perform private.require_open_shop(p_seller_id);
  if coalesce(char_length(trim(p_name)), 0) not between 3 and 80
     or coalesce(char_length(trim(p_address)), 0) not between 15 and 500
     or p_lat is null or p_lng is null then
    perform private.fail('invalid_location');
  end if;
  -- Our drivers collect from this point, so it has to be where they work.
  if not exists (
    select 1
    from public.districts d
    join public.cantons c on c.code = d.canton_code
    join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
    where d.postal_code = p_postal_code and z.active and d.served
  ) then
    perform private.fail('zone_not_served');
  end if;
  if (select count(*) from public.warehouses w where w.seller_id = p_seller_id) >= 5 then
    perform private.fail('too_many_locations');
  end if;

  insert into public.warehouses (code, name, kind, seller_id, address, postal_code, lat, lng)
  values ('V' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)),
          trim(p_name), 'seller', p_seller_id, trim(p_address), p_postal_code, p_lat, p_lng)
  returning id into v_id;
  return v_id;
exception
  when check_violation then
    -- The point is outside Costa Rica.
    perform private.fail('invalid_location');
end;
$$;

-- ═══ 12. Grants ════════════════════════════════════════════════════════════

revoke all on function
  private.operations_audit(text, text, text, jsonb, jsonb),
  private.cr_today(),
  private.clean_label(text),
  private.has_letters(text),
  private.zone_serves(text),
  private.location_picked_units(uuid),
  private.order_is_open(public.order_status),
  private.district_zones(),
  private.check_zone_service(text, integer, smallint[], smallint[], integer, integer, bigint, bigint),
  private.weekday_set(smallint[]),
  private.ops_zone_json(text),
  private.district_move_impact(text[], text),
  private.orders_promised_on(date),
  private.routes_planned_on(date),
  private.closure_overlaps(text, date, date, uuid),
  private.sync_closure_days(uuid),
  private.ops_closure_json(uuid),
  private.closure_audit_row(public.zone_closure_periods),
  private.check_closure_dates(date, date),
  private.operational_setting(text),
  private.bin_stock_location_open(),
  private.location_code(text),
  private.ops_location_json(uuid),
  private.stop_not_removable(public.stop_status)
from public, anon, authenticated;

revoke all on function
  public.ops_delivery_zones(),
  public.ops_create_zone(text, text, integer, smallint[], smallint[], integer, integer, bigint, bigint, boolean),
  public.ops_update_zone(text, integer, text, integer, smallint[], smallint[], integer, integer, bigint, bigint, boolean),
  public.ops_set_zone_active(text, boolean, integer),
  public.ops_delete_zone(text),
  public.ops_district_cantons(),
  public.ops_canton_districts(text),
  public.ops_district_move_preview(text[], text),
  public.ops_move_districts(text[], text),
  public.ops_holidays(),
  public.ops_add_holiday(date, text, boolean),
  public.ops_remove_holiday(date),
  public.ops_zone_closures(),
  public.ops_open_zone_closure(text, date, date, text, text),
  public.ops_change_zone_closure_end(uuid, date, integer),
  public.ops_end_zone_closure(uuid, integer),
  public.ops_settings(),
  public.ops_update_setting(text, jsonb, jsonb),
  public.ops_warehouse_locations(),
  public.ops_create_location(uuid, text, public.location_kind),
  public.ops_rename_location(uuid, text),
  public.ops_set_location_active(uuid, boolean),
  public.ops_open_routes(),
  public.ops_remove_route_stop(uuid, text),
  public.ops_close_route(uuid, text)
from public;

grant execute on function
  public.ops_delivery_zones(),
  public.ops_create_zone(text, text, integer, smallint[], smallint[], integer, integer, bigint, bigint, boolean),
  public.ops_update_zone(text, integer, text, integer, smallint[], smallint[], integer, integer, bigint, bigint, boolean),
  public.ops_set_zone_active(text, boolean, integer),
  public.ops_delete_zone(text),
  public.ops_district_cantons(),
  public.ops_canton_districts(text),
  public.ops_district_move_preview(text[], text),
  public.ops_move_districts(text[], text),
  public.ops_holidays(),
  public.ops_add_holiday(date, text, boolean),
  public.ops_remove_holiday(date),
  public.ops_zone_closures(),
  public.ops_open_zone_closure(text, date, date, text, text),
  public.ops_change_zone_closure_end(uuid, date, integer),
  public.ops_end_zone_closure(uuid, integer),
  public.ops_settings(),
  public.ops_update_setting(text, jsonb, jsonb),
  public.ops_warehouse_locations(),
  public.ops_create_location(uuid, text, public.location_kind),
  public.ops_rename_location(uuid, text),
  public.ops_set_location_active(uuid, boolean),
  public.ops_open_routes(),
  public.ops_remove_route_stop(uuid, text),
  public.ops_close_route(uuid, text)
to authenticated;
