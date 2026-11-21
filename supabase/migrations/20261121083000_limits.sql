-- Limits against abuse, and the authorisation gaps the review of
-- 21 November 2026 found (supabase/tests/120_limits.sql names each finding).
--
--   1. Access that ends at once. A driver who is suspended or deactivated gets
--      no stops from driver_today, and their unfinished routes go back to
--      dispatch (FA-4, FA-M2). Shops that are not active can no longer put
--      anything in a staff queue or in front of shoppers.
--   2. Shop registration. One shop in review per account, identification
--      numbers checked for shape, and a clash with another shop's number is
--      no longer revealed: it is accepted and flagged for staff, and only one
--      shop can ever be verified with a number (FA-5).
--   3. Queues a stranger could fill: listings in review, inbound shipments,
--      content reports, complaints. Each has a cap per account, a report must
--      be about something that exists and is public, a duplicate is not
--      counted twice, and visitors' reports have a safety valve (FA-6, FA-7).
--   4. Bounded input on everything a visitor can call (FA-8).
--   5. Rules that only a function can keep: joining a shop needs the invited
--      person's yes (DTA-6); the shop's name, fiscal details and contact are
--      changed by a request staff approve (DTA-11, DTA-12); consents are
--      stamped by the database and never rewritten (DTA-13); fees are not
--      changed through the API at all, and every change to them is audited
--      (DTA-7).
--   6. Smaller things: reviewer names only for reviewers (FA-9), codes instead
--      of raw constraint errors (FA-M3), packages too big for the warehouse,
--      payout accounts finance never approved.
--   7. From the review of this work: a contact change and a payout-account
--      request never wait at the same time, in either order; a seller sees
--      that an unapproved payout account blocks the payout; a fiscal request
--      keeps the fields it does not send; an invitation can be taken by the
--      account that later confirms the address; an administrator's invitations
--      end with their role; a listing goes on sale only for a shop that may
--      trade; a closed shop only reads; nothing is planned for an address a
--      visitor typed. driver_today and the search functions are gates in front
--      of whatever body they had, so this file never undoes another
--      migration's changes to them.
--
-- Every limit is a setting in app_settings (an administrator can change it
-- without a migration) or a named constant in the function that uses it, and
-- docs/03-data/access-control.md says why each number was chosen. None depends
-- on the caller's network address: the apps call the database from their
-- servers, and anyone with the publishable key can call it directly, so an
-- address would either be the app's own or be made up.
--
-- This migration assumes the API roles reach tables only through functions
-- (the lockdown migration, 082800, takes the rest away). For the tables of the
-- findings above it also revokes the direct writes itself, so it is correct
-- whether or not that migration ran first. Same rules as every other function:
-- SECURITY DEFINER with an empty search_path, the caller checked first, errors
-- as short codes, nothing callable until it is granted at the end.

-- ═══ 0. Settings and shared helpers ════════════════════════════════════════

insert into public.app_settings (key, value, description) values
  ('max_pending_shops_per_account', '1',
   'Shops one account may have waiting for verification at a time. A second waits until the first is decided.'),
  ('max_listings_in_review_per_seller', '50',
   'Listings (new ones, and edits of published ones) one shop may have waiting for catalogue review at a time.'),
  ('max_draft_listings_per_seller', '200',
   'Draft listings one shop may keep. Drafts are never reviewed or shown; the cap only stops a table from filling up.'),
  ('max_open_inbounds_per_seller', '10',
   'Shipments to a Yuntera warehouse one shop may have announced and not yet received.'),
  ('max_lines_per_inbound', '100',
   'Different products in one shipment to the warehouse.'),
  ('max_units_per_inbound_line', '100000',
   'Units of one product in one shipment to the warehouse.'),
  ('max_open_reports_per_account', '20',
   'Content reports one signed-in account may have waiting for a decision at a time.'),
  ('visitor_reports_per_hour', '300',
   'Reports from visitors who are not signed in, across the whole platform, in the last hour. Above it a visitor is asked to write to support, except about something nobody has reported yet.'),
  ('max_open_complaints_per_account', '5',
   'Complaints one account may have open at a time.'),
  ('max_pending_invitations_per_shop', '20',
   'Invitations to join a shop that may be waiting for an answer at a time.'),
  ('max_members_per_shop', '50',
   'People (members plus pending invitations) one shop may have.'),
  ('policy_versions',
   '{"terms": "2026-11", "privacy": "2026-11", "marketing": "2026-11", "location": "2026-11", "driver_terms": "2026-11", "seller_terms": "2026-11"}',
   'The version of each policy a person agrees to now. record_consent accepts only these.')
on conflict (key) do nothing;

-- A whole-number limit from app_settings. A setting that is missing or is not
-- a number falls back to the documented default rather than switching the
-- limit off or stopping the function.
create or replace function private.limit_value(p_key text, p_default integer) returns integer
language sql stable security definer
set search_path = ''
as $$
  select case
    when jsonb_typeof(private.setting(p_key)) = 'number'
      then least(greatest(floor((private.setting(p_key) #>> '{}')::numeric), 0), 1000000000)::integer
    else p_default
  end;
$$;

-- Text as people type it: trimmed, inner runs of spaces collapsed.
create or replace function private.clean_text(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select nullif(trim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), '');
$$;

-- The shape of an e-mail address, and the length the standard allows.
create or replace function private.is_email(p_email text) returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(char_length(p_email) <= 254 and p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', false);
$$;

-- A shop that may trade: put listings in review, edit what is published,
-- announce stock, write publicly. A pending (not yet verified) or suspended
-- shop keeps reading its data, keeps drafts, and finishes what it already
-- owes shoppers (packing, stock counts); a closed shop only reads.
create or replace function private.require_trading_shop(p_seller_id uuid) returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_status public.seller_status;
begin
  select s.status into v_status from public.sellers s where s.id = p_seller_id;
  -- A shop waiting for verification is told so, apart from a suspended one.
  if v_status = 'pending' then
    perform private.fail('shop_not_approved');
  elsif v_status is distinct from 'active' then
    perform private.fail('shop_not_active');
  end if;
end;
$$;

-- A shop that is not closed. A closed shop only reads: it adds no pickup
-- point and counts no stock. (It may still ask for its payout account to be
-- changed, so that it can be paid what it is owed; finance decides.)
create or replace function private.require_open_shop(p_seller_id uuid) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sellers s where s.id = p_seller_id and s.status <> 'closed') then
    perform private.fail('shop_closed');
  end if;
end;
$$;

-- ═══ 1. Drivers lose access at once (FA-4, FA-M2) ══════════════════════════

-- Routes that went back to dispatch because their driver stopped being active.
alter table public.routes
  add column released_at timestamptz,
  add column released_from_driver_id uuid references public.drivers (id),
  -- For a route that was already being driven: the route whose unfinished
  -- stops this one took over.
  add column released_from_route_id uuid references public.routes (id),
  add column release_reason text check (release_reason in ('driver_suspended', 'driver_offboarded', 'driver_pending'));

create index routes_released_idx on public.routes (released_at desc) where released_at is not null;

-- Takes a driver's unfinished work back. A route not started yet returns to
-- dispatch as a draft, without a driver. A route being driven is split: the
-- stops still to do move to a new draft route for another driver; the stops
-- already done stay on the old route, which is closed, and its cash count
-- opens for the driver who collected the money. Parcels already handed out
-- stay "out for delivery": staff must recover them from the driver, which is
-- why the dispatch screen shows every released route.
create or replace function private.release_driver_routes(p_driver_id uuid, p_reason text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_new uuid;
  v_count integer := 0;
begin
  for r in
    select * from public.routes
    where driver_id = p_driver_id and status in ('assigned', 'in_progress')
    order by service_date, code
    for update
  loop
    v_count := v_count + 1;
    if r.status = 'assigned' then
      update public.routes
      set driver_id = null, status = 'draft', released_at = now(),
          released_from_driver_id = p_driver_id, release_reason = p_reason
      where id = r.id;
      continue;
    end if;

    if exists (select 1 from public.route_stops s
               where s.route_id = r.id and s.status in ('pending', 'arrived')) then
      insert into public.routes
        (code, service_date, depot_warehouse_id, status, created_by, released_at,
         released_from_driver_id, released_from_route_id, release_reason)
      values
        ('R-' || nextval('private.route_code_seq'), r.service_date, r.depot_warehouse_id, 'draft',
         (select auth.uid()), now(), p_driver_id, r.id, p_reason)
      returning id into v_new;

      update public.route_stops rs
      set route_id = v_new, sequence = x.position, status = 'pending', arrived_at = null
      from (
        select s.id, (row_number() over (order by s.sequence, s.id))::smallint as position
        from public.route_stops s
        where s.route_id = r.id and s.status in ('pending', 'arrived')
      ) x
      where rs.id = x.id;
    end if;

    if exists (select 1 from public.route_stops s where s.route_id = r.id) then
      -- Nothing left to do on it: closes it and opens the cash count.
      perform private.maybe_complete_route(r.id);
    else
      update public.routes set status = 'cancelled' where id = r.id;
    end if;
  end loop;

  if v_count > 0 then
    perform private.emit('driver.routes_released',
      jsonb_build_object('driver_id', p_driver_id, 'routes', v_count, 'reason', p_reason));
  end if;
  return v_count;
end;
$$;

-- On the table itself, so that every way a driver stops being active (the
-- console's function, or an administrator's SQL) releases the routes.
create or replace function private.drivers_release_on_leave() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    perform private.release_driver_routes(new.id, 'driver_' || new.status::text);
  end if;
  return null;
end;
$$;

create trigger drivers_release_on_leave after update of status on public.drivers
  for each row execute function private.drivers_release_on_leave();

-- A driver who is not active sees their own record and no routes, so no
-- recipient's name, phone or address. The body of driver_today is not
-- rewritten here: whatever version is in place when this migration runs (the
-- one in api_operations, or a later one such as the integrity workstream's,
-- which counts delivery-code attempts) moves to the private schema unchanged,
-- and the public name becomes a gate in front of it. So this migration never
-- undoes another one's changes to what an active driver sees.
alter function public.driver_today() rename to driver_today_active;
alter function public.driver_today_active() set schema private;
revoke all on function private.driver_today_active() from public, anon, authenticated;

create function public.driver_today() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  d public.drivers%rowtype;
begin
  select * into d from public.drivers where user_id = (select auth.uid());
  if not found then
    perform private.fail('not_a_driver');
  end if;
  if d.status <> 'active' then
    return jsonb_build_object(
      'driver', jsonb_build_object(
        'id', d.id, 'full_name', d.full_name, 'status', d.status, 'vehicle_type', d.vehicle_type,
        'plate', d.plate),
      'routes', '[]'::jsonb);
  end if;
  return private.driver_today_active();
end;
$$;

-- Replaces the version in api_backoffice: the driver's row is locked so a
-- route cannot be assigned to them while they are being suspended, and the
-- trigger above takes their routes back.
create or replace function public.ops_set_driver_status(
  p_driver_id uuid,
  p_status public.driver_status
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if p_status is null then
    perform private.fail('invalid_driver_status');
  end if;
  perform 1 from public.drivers where id = p_driver_id for update;
  if not found then
    perform private.fail('driver_not_available');
  end if;
  update public.drivers set status = p_status where id = p_driver_id;
end;
$$;

-- What went back to dispatch in the last days because a driver left, so
-- staff can reassign it and collect the parcels still with that driver.
create or replace function public.ops_released_routes(p_days integer default 7) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_max_days constant integer := 60;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'route_id', r.id, 'code', r.code, 'status', r.status, 'service_date', r.service_date,
      'released_at', r.released_at, 'reason', r.release_reason,
      'from_driver_name', d.full_name,
      'from_route_code', (select o.code from public.routes o where o.id = r.released_from_route_id),
      'driver_name', (select n.full_name from public.drivers n where n.id = r.driver_id),
      'stops', (select count(*) from public.route_stops s where s.route_id = r.id),
      'parcels_out', (select count(*) from public.route_stops s
                      join public.shipments sh on sh.id = s.shipment_id
                      where s.route_id = r.id and sh.status = 'out_for_delivery')
    ) order by r.released_at desc, r.code)
    from public.routes r
    join public.drivers d on d.id = r.released_from_driver_id
    where r.released_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), c_max_days))
  ), '[]'::jsonb);
end;
$$;

-- ═══ 2. Shop names and registration (FA-5) ═════════════════════════════════

-- An identification number with a shape Hacienda or the Registro Civil would
-- issue. Mirrors parseIdentification in packages/core/src/cr/identity.ts; the
-- cases between the markers in supabase/tests/120_limits.sql run through both.
create or replace function private.is_valid_identification(
  p_type public.identification_type,
  p_number text
) returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(case p_type
    when 'fisica' then p_number ~ '^[1-9][0-9]{8}$'
    when 'juridica' then p_number ~ '^[2-5][0-9]{9}$'
    when 'dimex' then p_number ~ '^[1-9][0-9]{10,11}$'
    when 'nite' then p_number ~ '^[0-9]{10}$'
  end, false);
$$;

-- Why a shop may not be called this, or null. The same rules at registration
-- and when a name change is requested:
--   shop_name_invalid   2 to 80 characters, Latin letters (accents and ñ are
--                       fine), digits and & . , ' ( ) + / -. No other
--                       alphabets: a Cyrillic "а" looks like an "a".
--   shop_name_reserved  it contains "yuntera" once spaces and punctuation are
--                       ignored, or it is a word that sounds like the platform
--                       speaking (soporte, ayuda, oficial…).
--   shop_name_taken     it reads the same as another active shop's name. Only
--                       active shops count: their names are public anyway, so
--                       the answer reveals nothing a visitor cannot see.
create or replace function private.shop_name_problem(p_name text, p_seller_id uuid) returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_reserved_fragments constant text[] := array['yuntera'];
  c_reserved_names constant text[] := array[
    'soporte', 'ayuda', 'oficial', 'tiendaoficial', 'admin', 'administracion', 'administrador',
    'servicioalcliente', 'atencionalcliente', 'central', 'pagos', 'seguridad', 'verificacion'];
  v_key text;
begin
  if p_name is null or char_length(p_name) not between 2 and 80
     or private.fold(p_name) !~ '^[a-z0-9 &.,''()+/-]+$' then
    return 'shop_name_invalid';
  end if;
  v_key := regexp_replace(private.fold(p_name), '[^a-z0-9]', '', 'g');
  if char_length(v_key) < 2 then
    return 'shop_name_invalid';
  end if;
  if exists (select 1 from unnest(c_reserved_fragments) f where position(f in v_key) > 0)
     or v_key = any (c_reserved_names) then
    return 'shop_name_reserved';
  end if;
  if exists (
    select 1 from public.sellers s
    where s.status = 'active' and s.id is distinct from p_seller_id
      and regexp_replace(private.fold(s.trade_name), '[^a-z0-9]', '', 'g') = v_key
  ) then
    return 'shop_name_taken';
  end if;
  return null;
end;
$$;

-- Refuses a name that may not be used, with the reason as its code.
create or replace function private.check_shop_name(p_name text, p_seller_id uuid) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  case private.shop_name_problem(p_name, p_seller_id)
    when 'shop_name_invalid' then perform private.fail('shop_name_invalid');
    when 'shop_name_reserved' then perform private.fail('shop_name_reserved');
    when 'shop_name_taken' then perform private.fail('shop_name_taken');
    else null;
  end case;
end;
$$;

-- Uniqueness of identification numbers moves from "registered" to "verified".
-- Before, the first account to type a number owned it, and the refusal told
-- anyone whether that person or business sells here. Now any number with a
-- valid shape is accepted; two shops with one number are shown to staff, and
-- the database lets only one of them ever be verified.
alter table public.seller_private drop constraint if exists seller_private_id_type_id_number_key;
create unique index seller_private_verified_id_idx
  on public.seller_private (id_type, id_number) where kyc_status = 'verified';
create index seller_private_id_idx on public.seller_private (id_type, id_number);

-- Replaces the version in identity. What changed:
--   * one shop waiting for verification per account (a setting);
--   * the identification number must have a valid shape for its type;
--   * a number another shop uses is accepted like any other: the caller is
--     told nothing, staff see the clash (ops_seller_id_clashes);
--   * the name rules above; every field checked, so no raw constraint error;
--   * two registrations with one address at once: the loser is told slug_taken.
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
  v_trade text := private.clean_text(p_trade_name);
  v_legal text := private.clean_text(p_legal_name);
  v_number text := upper(regexp_replace(coalesce(p_id_number, ''), '[\s.\-–—]', '', 'g'));
  v_email text := lower(trim(coalesce(p_contact_email, '')));
  v_phone text := regexp_replace(coalesce(p_contact_phone, ''), '[\s-]', '', 'g');
  v_address text := private.clean_text(p_fiscal_address);
  v_seller uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  perform private.check_shop_name(v_trade, null);
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 60 then
    perform private.fail('invalid_shop_details');
  end if;
  if p_id_type is null or not private.is_valid_identification(p_id_type, v_number) then
    perform private.fail('invalid_identification');
  end if;
  if coalesce(char_length(v_legal), 0) not between 2 and 160
     or not private.is_email(v_email)
     or v_phone !~ '^\+506[2-8][0-9]{7}$'
     or coalesce(char_length(v_address), 0) not between 10 and 500 then
    perform private.fail('invalid_shop_details');
  end if;

  -- Two registrations by one account take turns, so the count below holds.
  perform pg_advisory_xact_lock(hashtextextended('create_seller:' || v_user::text, 0));
  if (select count(*) from public.seller_members m
      join public.sellers s on s.id = m.seller_id
      where m.user_id = v_user and m.role = 'owner' and s.status = 'pending')
     >= private.limit_value('max_pending_shops_per_account', 1) then
    perform private.fail('shop_registration_pending');
  end if;

  begin
    insert into public.sellers (slug, trade_name) values (p_slug, v_trade)
    returning id into v_seller;
  exception when unique_violation then
    perform private.fail('slug_taken');
  end;

  insert into public.seller_private
    (seller_id, legal_name, id_type, id_number, contact_email, contact_phone, fiscal_address)
  values (v_seller, v_legal, p_id_type, v_number, v_email, v_phone, v_address);

  insert into public.seller_members (seller_id, user_id, role) values (v_seller, v_user, 'owner');

  insert into public.consents (user_id, purpose, policy_version)
  values (v_user, 'seller_terms', private.policy_version('seller_terms'));

  perform private.emit('seller.registered', jsonb_build_object('seller_id', v_seller));
  return v_seller;
end;
$$;

-- Shops that share an identification number with another shop, for the
-- staff who verify sellers. Not in ops_sellers so its payload stays as it is.
create or replace function public.ops_seller_id_clashes() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops', 'support', 'finance') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'seller_id', a.seller_id,
      'shared_with', (
        select jsonb_agg(jsonb_build_object(
          'seller_id', s.id, 'trade_name', s.trade_name, 'status', s.status,
          'kyc_status', b.kyc_status) order by s.created_at)
        from public.seller_private b join public.sellers s on s.id = b.seller_id
        where b.id_type = a.id_type and b.id_number = a.id_number and b.seller_id <> a.seller_id)
    ) order by a.created_at)
    from public.seller_private a
    where exists (select 1 from public.seller_private b
                  where b.id_type = a.id_type and b.id_number = a.id_number
                    and b.seller_id <> a.seller_id)
  ), '[]'::jsonb);
end;
$$;

-- Replaces the version in moderation: verifying a shop whose number another
-- shop already holds verified is refused with a code, and only a pending or
-- suspended shop's number can clash, so staff resolve it before approving.
create or replace function public.ops_set_seller_status(
  p_seller_id uuid,
  p_status public.seller_status,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_private public.seller_private%rowtype;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if p_status is null then
    perform private.fail('invalid_seller_status');
  end if;
  if char_length(p_note) > 1000 then
    perform private.fail('note_too_long');
  end if;

  select * into v_private from public.seller_private where seller_id = p_seller_id for update;
  if not found then
    perform private.fail('seller_not_found');
  end if;

  if p_status = 'active' then
    if exists (
      select 1 from public.seller_private o
      where o.id_type = v_private.id_type and o.id_number = v_private.id_number
        and o.seller_id <> p_seller_id and o.kyc_status = 'verified'
    ) then
      perform private.fail('identification_verified_elsewhere');
    end if;
    -- Activating a seller is the identity decision: the platform must know who
    -- is selling, both for shoppers and for its reporting duty to Hacienda.
    begin
      update public.seller_private
      set kyc_status = 'verified', kyc_notes = nullif(trim(p_note), ''),
          hacienda_verified_at = coalesce(hacienda_verified_at, now())
      where seller_id = p_seller_id;
    exception when unique_violation then
      perform private.fail('identification_verified_elsewhere');
    end;
  elsif p_status in ('suspended', 'closed') and coalesce(char_length(trim(p_note)), 0) < 5 then
    perform private.fail('reason_required');
  end if;

  update public.sellers
  set status = p_status,
      approved_at = case when p_status = 'active' then coalesce(approved_at, now()) else approved_at end
  where id = p_seller_id;

  perform private.emit('seller.status_changed',
    jsonb_build_object('seller_id', p_seller_id, 'status', p_status, 'note', p_note));
end;
$$;

-- ═══ 3. Packages the warehouse can take (fee tiers) ════════════════════════

-- Whether a package fits the largest size tier of the fee schedule in force
-- (today 30 kg and 120 cm on its longest side). One that does not would be
-- charged no warehouse fee, so it cannot be fulfilled by Yuntera; the seller
-- may still ship it themselves.
create or replace function private.fits_warehouse(
  p_weight_grams integer,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fee_fulfillment_tiers t
    join public.fee_schedules s on s.version = t.schedule_version and s.active
    where p_weight_grams <= t.max_weight_grams
      and greatest(p_length_cm, p_width_cm, p_height_cm) <= t.max_longest_side_cm
  );
$$;

-- An offer becomes warehouse-fulfilled only if its package fits.
create or replace function private.offers_warehouse_size() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.fulfillment = 'platform'
     and (tg_op = 'INSERT' or old.fulfillment <> 'platform' or old.sku_id <> new.sku_id)
     and not exists (
       select 1 from public.skus k
       where k.id = new.sku_id
         and private.fits_warehouse(k.weight_grams, k.length_cm, k.width_cm, k.height_cm)) then
    perform private.fail('too_large_for_warehouse');
  end if;
  return new;
end;
$$;

create trigger offers_warehouse_size before insert or update of fulfillment, sku_id on public.offers
  for each row execute function private.offers_warehouse_size();

-- A package that grows cannot outgrow the warehouse while an offer still
-- sends it from there (an approved listing edit goes through here too).
create or replace function private.skus_warehouse_size() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (new.weight_grams, new.length_cm, new.width_cm, new.height_cm)
       is distinct from (old.weight_grams, old.length_cm, old.width_cm, old.height_cm)
     and not private.fits_warehouse(new.weight_grams, new.length_cm, new.width_cm, new.height_cm)
     and exists (select 1 from public.offers o
                 where o.sku_id = new.id and o.fulfillment = 'platform' and o.status <> 'archived') then
    perform private.fail('too_large_for_warehouse');
  end if;
  return new;
end;
$$;

create trigger skus_warehouse_size before update of weight_grams, length_cm, width_cm, height_cm
  on public.skus
  for each row execute function private.skus_warehouse_size();

-- ═══ 4. Listings and inbound shipments (FA-6, FA-M3) ═══════════════════════

-- What one shop has waiting for catalogue staff: new listings in review and
-- edits of published ones. `p_except` leaves out the listing being changed,
-- whose own proposal is about to be replaced.
create or replace function private.listings_in_review(p_seller_id uuid, p_except uuid default null)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select ((select count(*) from public.products p
           where p.created_by_seller_id = p_seller_id and p.status = 'pending_review'
             and p.id is distinct from p_except)
        + (select count(*) from public.product_change_requests r
           where r.seller_id = p_seller_id and r.status = 'pending'
             and r.product_id is distinct from p_except))::integer;
$$;

-- The limits of a listing's content and package, on the values that will be
-- stored. The same as the seller app's form and seller_update_listing. A
-- package over 30 kg or 200 cm a side is carried by no kind of delivery
-- (package_over_limit), which is said plainly rather than as a form error.
create or replace function private.listing_problem(
  p_title text, p_description text, p_bullets text[], p_weight_grams integer,
  p_length_cm numeric, p_width_cm numeric, p_height_cm numeric
) returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_weight_grams > 30000 or p_length_cm > 200 or p_width_cm > 200 or p_height_cm > 200
      then 'package_over_limit'
    when coalesce(char_length(trim(p_title)), 0) not between 5 and 200
      or coalesce(char_length(trim(p_description)), 0) > 10000
      or coalesce(cardinality(p_bullets), 0) > 8
      or exists (select 1 from unnest(coalesce(p_bullets, '{}')) b
                 where b is null or trim(b) = '' or char_length(b) > 300)
      or p_weight_grams is null or p_weight_grams <= 0 or p_weight_grams > 30000
      or p_length_cm is null or round(p_length_cm, 1) <= 0 or p_length_cm > 200
      or p_width_cm is null or round(p_width_cm, 1) <= 0 or p_width_cm > 200
      or p_height_cm is null or round(p_height_cm, 1) <= 0 or p_height_cm > 200
      then 'invalid_listing'
  end;
$$;

-- Replaces the version in api_operations. What changed: sending a listing for
-- review needs an active shop (a pending one may keep drafts ready for the
-- day it is approved); each shop has a cap on listings in review and on
-- drafts; the content and package are checked like an edit is; and a package
-- too big for the warehouse cannot be sent there.
create or replace function public.seller_create_listing(
  p_seller_id uuid,
  p_title text,
  p_category_slug text,
  p_description text,
  p_bullet_points text[],
  p_price_minor bigint,
  p_fulfillment public.fulfillment_type,
  p_handling_days smallint,
  p_weight_grams integer,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric,
  p_submit boolean default true
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max_price_minor constant bigint := 10000000000; -- ₡100 000 000
  v_category public.categories%rowtype;
  v_status public.seller_status;
  v_slug text;
  v_product uuid;
  v_sku uuid;
  v_offer uuid;
  v_problem text;
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  -- One listing at a time per shop, so the counts below hold.
  select status into v_status from public.sellers where id = p_seller_id for update;
  if coalesce(p_submit, false) and v_status = 'pending' then
    perform private.fail('shop_not_approved');
  elsif v_status = 'closed' or (coalesce(p_submit, false) and v_status <> 'active') then
    perform private.fail('shop_not_active');
  end if;

  v_problem := private.listing_problem(p_title, p_description, p_bullet_points, p_weight_grams,
                                       p_length_cm, p_width_cm, p_height_cm);
  if v_problem = 'package_over_limit' then
    perform private.fail('package_over_limit');
  end if;
  if v_problem is not null or p_price_minor is null or p_price_minor <= 0
     or p_price_minor > c_max_price_minor or p_fulfillment is null then
    perform private.fail('invalid_listing');
  end if;
  if p_fulfillment = 'seller' and (p_handling_days is null or p_handling_days not between 0 and 10) then
    perform private.fail('invalid_handling_days');
  end if;
  if p_fulfillment = 'platform'
     and not private.fits_warehouse(p_weight_grams, round(p_length_cm, 1), round(p_width_cm, 1),
                                    round(p_height_cm, 1)) then
    perform private.fail('too_large_for_warehouse');
  end if;

  if coalesce(p_submit, false) then
    if private.listings_in_review(p_seller_id) >= private.limit_value('max_listings_in_review_per_seller', 50) then
      perform private.fail('too_many_listings_in_review');
    end if;
  elsif (select count(*) from public.products p
         where p.created_by_seller_id = p_seller_id and p.status = 'draft')
        >= private.limit_value('max_draft_listings_per_seller', 200) then
    perform private.fail('too_many_draft_listings');
  end if;

  select * into v_category from public.categories where slug = p_category_slug and active;
  if not found then
    perform private.fail('category_not_found');
  end if;

  -- A readable, unique address for the product page.
  v_slug := trim(both '-' from regexp_replace(private.fold(p_title), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from left(v_slug, 100));
  if v_slug = '' then
    perform private.fail('invalid_listing');
  end if;
  if exists (select 1 from public.products where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.products
    (slug, title, description, bullet_points, category_id, status, created_by_seller_id, tax_rate_bps)
  values
    (v_slug, trim(p_title), nullif(trim(p_description), ''),
     array(select trim(b) from unnest(coalesce(p_bullet_points, '{}')) b),
     v_category.id, case when p_submit then 'pending_review' else 'draft' end::public.product_status,
     p_seller_id, v_category.default_tax_rate_bps)
  returning id into v_product;

  insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
  values (v_product, 'YT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
          p_weight_grams, round(p_length_cm, 1), round(p_width_cm, 1), round(p_height_cm, 1))
  returning id into v_sku;

  insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days)
  values (v_sku, p_seller_id, p_price_minor, p_fulfillment,
          case when p_fulfillment = 'platform' then 0 else p_handling_days end)
  returning id into v_offer;

  return jsonb_build_object('product_id', v_product, 'slug', v_slug, 'sku_id', v_sku, 'offer_id', v_offer);
exception
  when check_violation or not_null_violation or numeric_value_out_of_range then
    perform private.fail('invalid_listing');
end;
$$;

-- Replaces the version in the fixes migration, keeping everything it does.
-- What changed: an edit of a published listing, or sending a draft for
-- review, needs an active shop and room under the shop's review cap; saving a
-- draft needs a shop that is not closed; and a package that would no longer
-- fit the warehouse is refused while the listing is sold from there.
create or replace function public.seller_update_listing(
  p_product_id uuid,
  p_title text,
  p_category_slug text,
  p_description text,
  p_bullet_points text[],
  p_weight_grams integer,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric,
  p_sku_id uuid default null,
  p_submit boolean default true
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_category public.categories%rowtype;
  v_shop public.seller_status;
  v_sku uuid;
  v_title text := trim(p_title);
  v_description text := nullif(trim(p_description), '');
  v_bullets text[] := coalesce(p_bullet_points, '{}');
  -- The package is stored to a tenth of a centimetre; check what will be stored.
  v_length numeric := round(p_length_cm, 1);
  v_width numeric := round(p_width_cm, 1);
  v_height numeric := round(p_height_cm, 1);
  v_proposed jsonb;
  v_status public.product_status;
  v_request uuid;
  v_problem text;
begin
  select * into p from public.products where id = p_product_id for update;
  if not found or p.created_by_seller_id is null
     or not private.is_seller_member(p.created_by_seller_id) then
    perform private.fail('listing_not_found');
  end if;
  if p.status = 'archived' then
    perform private.fail('listing_not_editable');
  end if;
  select status into v_shop from public.sellers where id = p.created_by_seller_id for update;
  if (p.status = 'active' or coalesce(p_submit, false)) and v_shop = 'pending' then
    perform private.fail('shop_not_approved');
  elsif v_shop = 'closed' or ((p.status = 'active' or coalesce(p_submit, false)) and v_shop <> 'active') then
    perform private.fail('shop_not_active');
  end if;

  select k.id into v_sku from public.skus k
  where k.product_id = p.id and (p_sku_id is null or k.id = p_sku_id)
  order by k.created_at, k.id limit 1;
  if v_sku is null then
    perform private.fail('listing_not_found');
  end if;

  select * into v_category from public.categories where slug = p_category_slug and active;
  if not found then
    perform private.fail('category_not_found');
  end if;

  v_problem := private.listing_problem(v_title, v_description, v_bullets, p_weight_grams,
                                       p_length_cm, p_width_cm, p_height_cm);
  if v_problem = 'package_over_limit' then
    perform private.fail('package_over_limit');
  elsif v_problem is not null then
    perform private.fail('invalid_listing');
  end if;
  v_bullets := array(select trim(b) from unnest(v_bullets) b);

  if not private.fits_warehouse(p_weight_grams, v_length, v_width, v_height)
     and exists (select 1 from public.offers o
                 where o.sku_id = v_sku and o.fulfillment = 'platform' and o.status <> 'archived') then
    perform private.fail('too_large_for_warehouse');
  end if;

  if (p.status = 'active' or coalesce(p_submit, false))
     and private.listings_in_review(p.created_by_seller_id, p.id)
         >= private.limit_value('max_listings_in_review_per_seller', 50) then
    perform private.fail('too_many_listings_in_review');
  end if;

  if p.status = 'active' then
    v_proposed := jsonb_build_object(
      'title', v_title,
      'description', v_description,
      'bullet_points', to_jsonb(v_bullets),
      'category_slug', v_category.slug,
      'category_name', v_category.name_es,
      'sku_id', v_sku,
      'weight_grams', p_weight_grams,
      'length_cm', v_length,
      'width_cm', v_width,
      'height_cm', v_height);
    if v_proposed = private.listing_content(p.id, v_sku) then
      perform private.fail('listing_unchanged');
    end if;

    -- A newer proposal replaces the one that was waiting. It gets a new id, so
    -- staff looking at the old one cannot approve text they have not read.
    update public.product_change_requests
    set status = 'withdrawn', decided_by = (select auth.uid()), decided_at = clock_timestamp()
    where product_id = p.id and status = 'pending';

    insert into public.product_change_requests (product_id, seller_id, proposed, submitted_by)
    values (p.id, p.created_by_seller_id, v_proposed, (select auth.uid()))
    returning id into v_request;

    perform private.emit('product.edit_submitted',
      jsonb_build_object('product_id', p.id, 'request_id', v_request));
    return jsonb_build_object('product_id', p.id, 'slug', p.slug, 'status', p.status,
                              'outcome', 'in_review');
  end if;

  -- Not public yet: change it in place. Sending it puts it in the review queue;
  -- saving without sending takes it out of the queue so the seller can keep working.
  v_status := case
    when p_submit then 'pending_review'
    when p.status = 'pending_review' then 'draft'
    else p.status
  end;

  update public.products
  set title = v_title,
      description = v_description,
      bullet_points = v_bullets,
      category_id = v_category.id,
      -- The tax rate came from the category when the listing was created; it follows a new one.
      tax_rate_bps = case when category_id is distinct from v_category.id
                          then v_category.default_tax_rate_bps else tax_rate_bps end,
      status = v_status,
      rejection_reason = case when p_submit then null else rejection_reason end
  where id = p.id;

  update public.skus
  set weight_grams = p_weight_grams, length_cm = v_length, width_cm = v_width,
      height_cm = v_height
  where id = v_sku;

  return jsonb_build_object('product_id', p.id, 'slug', p.slug, 'status', v_status,
                            'outcome', case when p_submit then 'submitted' else 'saved' end);
exception
  when check_violation or not_null_violation or numeric_value_out_of_range then
    perform private.fail('invalid_listing');
end;
$$;

-- Replaces the version in api_operations. What changed: a suspended or
-- closed shop cannot put an offer back on sale (pausing and archiving stay
-- possible), and a missing price or status is a code, not a raw error.
create or replace function public.seller_update_offer(
  p_offer_id uuid,
  p_price_minor bigint,
  p_status public.offer_status,
  p_handling_days smallint default null,
  p_list_price_minor bigint default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
begin
  select seller_id into v_seller from public.offers where id = p_offer_id;
  if v_seller is null or not private.is_seller_member(v_seller) then
    perform private.fail('offer_not_found');
  end if;
  if p_status = 'active'
     and exists (select 1 from public.sellers s where s.id = v_seller and s.status in ('suspended', 'closed')) then
    perform private.fail('shop_not_active');
  end if;
  update public.offers
  set price_minor = p_price_minor,
      list_price_minor = p_list_price_minor,
      status = p_status,
      handling_days = case when fulfillment = 'platform' then 0
                           else coalesce(p_handling_days, handling_days) end
  where id = p_offer_id;
exception
  when check_violation or not_null_violation or numeric_value_out_of_range then
    -- Price must be positive, and a "regular price" must be higher than the price.
    perform private.fail('invalid_offer');
end;
$$;

-- Replaces the version in inventory. What changed: only an active shop can
-- announce stock to a warehouse; a shop has a cap on shipments not yet
-- received, on lines per shipment and on units per line; every line is checked
-- before anything is written, so a repeated product or a malformed line is a
-- code (it used to surface as a raw unique-constraint error, FA-M3).
create or replace function public.seller_create_inbound(
  p_warehouse_id uuid,
  p_seller_id uuid,
  p_lines jsonb,
  p_expected_on date default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_max_lines integer := private.limit_value('max_lines_per_inbound', 100);
  v_max_units integer := private.limit_value('max_units_per_inbound_line', 100000);
  v_id uuid;
  v_line record;
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  -- One announcement at a time per shop, so the count below holds.
  perform 1 from public.sellers where id = p_seller_id for update;
  perform private.require_trading_shop(p_seller_id);
  if not exists (
    select 1 from public.warehouses w where w.id = p_warehouse_id and w.kind = 'platform' and w.active
  ) then
    perform private.fail('warehouse_not_found');
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > v_max_lines then
    perform private.fail('invalid_lines');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where jsonb_typeof(l) <> 'object' or coalesce(l ->> 'sku_id', '') !~ c_uuid
  ) or (select count(distinct lower(l ->> 'sku_id')) from jsonb_array_elements(p_lines) l)
       <> jsonb_array_length(p_lines) then
    perform private.fail('invalid_lines');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where jsonb_typeof(l -> 'quantity') is distinct from 'number'
       or (l ->> 'quantity')::numeric <> floor((l ->> 'quantity')::numeric)
       or (l ->> 'quantity')::numeric not between 1 and v_max_units
  ) then
    perform private.fail('invalid_quantity');
  end if;
  if p_expected_on is not null
     and (p_expected_on < private.cr_local(now())::date - 1 or p_expected_on > private.cr_local(now())::date + 180) then
    perform private.fail('invalid_expected_date');
  end if;
  if (select count(*) from public.inbound_shipments ib
      where ib.seller_id = p_seller_id and ib.status in ('draft', 'in_transit', 'receiving'))
     >= private.limit_value('max_open_inbounds_per_seller', 10) then
    perform private.fail('too_many_open_inbounds');
  end if;

  insert into public.inbound_shipments (reference, seller_id, warehouse_id, status, expected_on, created_by)
  values ('IN-' || nextval('private.inbound_reference_seq'), p_seller_id, p_warehouse_id,
          'in_transit', p_expected_on, (select auth.uid()))
  returning id into v_id;

  for v_line in
    select (l ->> 'sku_id')::uuid as sku_id, (l ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_lines) l
  loop
    -- A seller can only send in SKUs they have an offer on.
    if not exists (
      select 1 from public.offers o where o.sku_id = v_line.sku_id and o.seller_id = p_seller_id
    ) then
      perform private.fail('offer_not_found', v_line.sku_id::text);
    end if;
    insert into public.inbound_shipment_lines (inbound_shipment_id, sku_id, expected_quantity)
    values (v_id, v_line.sku_id, v_line.quantity);
  end loop;

  return v_id;
exception
  when unique_violation or check_violation then
    perform private.fail('invalid_lines');
end;
$$;

-- Replaces the version in moderation: a reply is public text with the shop's
-- name on it, so a suspended or closed shop no longer writes one.
create or replace function public.seller_reply_review(p_review_id uuid, p_reply text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
begin
  select i.seller_id into v_seller
  from public.reviews r join public.order_items i on i.id = r.order_item_id
  where r.id = p_review_id;
  if v_seller is null or not private.is_seller_member(v_seller) then
    perform private.fail('review_not_found');
  end if;
  perform private.require_trading_shop(v_seller);
  if coalesce(char_length(trim(p_reply)), 0) not between 2 and 2000 then
    perform private.fail('invalid_reply');
  end if;
  update public.reviews
  set seller_reply = trim(p_reply), seller_replied_at = now()
  where id = p_review_id;
end;
$$;

-- A listing goes on sale only if the shop that created it may trade. This is
-- on the table, not in ops_review_product, so it holds whichever version of
-- that function is in place (product photos redefines it) and on any other
-- path. A listing a shop sent before it was suspended waits until the shop is
-- active again, or staff reject it.
create or replace function private.products_need_trading_shop() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active'
     and new.created_by_seller_id is not null
     and not exists (select 1 from public.sellers s
                     where s.id = new.created_by_seller_id and s.status = 'active') then
    perform private.fail('listing_shop_not_active');
  end if;
  return new;
end;
$$;

create trigger products_need_trading_shop before update of status on public.products
  for each row execute function private.products_need_trading_shop();

-- Replaces the version in api_operations: the oldest listings waiting, a page
-- at a time, so a flood cannot make the screen unusable. The rest follow as
-- these are decided. Each row says the shop's status: a listing of a shop
-- that may not trade cannot be approved (see above), and the console says so.
create or replace function public.ops_listings_for_review()
returns table (
  product_id uuid, slug text, title text, description text, bullet_points text[],
  category_slug text, seller_name text, seller_status public.seller_status,
  price_minor bigint, created_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_page constant integer := 100;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return query
    select p.id, p.slug, p.title, p.description, p.bullet_points, c.slug, s.trade_name, s.status,
           (select min(o.price_minor) from public.offers o join public.skus k on k.id = o.sku_id
            where k.product_id = p.id),
           p.created_at
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.sellers s on s.id = p.created_by_seller_id
    where p.status = 'pending_review'
    order by p.created_at, p.id
    limit c_page;
end;
$$;

-- Replaces the version in api_operations: the inbound list shows the shipments
-- expected first, a page of them, with how many there are in all.
create or replace function public.wms_board(p_warehouse_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_inbound_page constant integer := 100;
begin
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;

  return jsonb_build_object(
    'warehouse', (select jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name)
                  from public.warehouses w where w.id = p_warehouse_id),
    'shipments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shipment_id', sh.id, 'tracking_code', sh.tracking_code, 'status', sh.status,
        'order_number', o.order_number, 'promise_latest', sh.promise_latest,
        'placed_at', o.placed_at,
        'units', (select coalesce(sum(si.quantity), 0) from public.shipment_items si where si.shipment_id = sh.id),
        'lines', (select count(*) from public.shipment_items si where si.shipment_id = sh.id),
        'short', exists (select 1 from public.pick_tasks t where t.shipment_id = sh.id and t.status = 'short')
      ) order by sh.promise_latest, o.placed_at)
      from public.shipments sh
      join public.orders o on o.id = sh.order_id
      where sh.origin_warehouse_id = p_warehouse_id
        and sh.status in ('pending', 'picking', 'packed', 'ready_for_dispatch')
        and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')
    ), '[]'::jsonb),
    'inbound', coalesce((
      select jsonb_agg(x.item order by x.expected_on nulls last, x.created_at)
      from (
        select ib.expected_on, ib.created_at, jsonb_build_object(
          'inbound_id', ib.id, 'reference', ib.reference, 'status', ib.status,
          'expected_on', ib.expected_on, 'seller_name', s.trade_name,
          'lines', (
            select jsonb_agg(jsonb_build_object(
              'line_id', l.id, 'sku_code', k.code, 'title', p.title, 'variant_name', k.variant_name,
              'expected', l.expected_quantity, 'received', l.received_quantity,
              'damaged', l.damaged_quantity) order by p.title)
            from public.inbound_shipment_lines l
            join public.skus k on k.id = l.sku_id
            join public.products p on p.id = k.product_id
            where l.inbound_shipment_id = ib.id)
        ) as item
        from public.inbound_shipments ib
        join public.sellers s on s.id = ib.seller_id
        where ib.warehouse_id = p_warehouse_id and ib.status in ('in_transit', 'receiving')
        order by ib.expected_on nulls last, ib.created_at
        limit c_inbound_page
      ) x
    ), '[]'::jsonb),
    'inbound_total', (select count(*) from public.inbound_shipments ib
                      where ib.warehouse_id = p_warehouse_id and ib.status in ('in_transit', 'receiving'))
  );
end;
$$;

-- ═══ 5. Reports and complaints (FA-7) ══════════════════════════════════════

-- Whether a shopper can see the thing being reported. Reports about anything
-- else (made-up ids, drafts, suspended shops) are refused: there is nothing
-- public to act on, and they would only fill the queue.
create or replace function private.is_public_target(p_type text, p_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_type
    when 'seller' then exists (select 1 from public.sellers s where s.id = p_id and s.status = 'active')
    when 'product' then exists (
      select 1 from public.products p
      left join public.sellers s on s.id = p.created_by_seller_id
      where p.id = p_id and p.status = 'active' and (s.id is null or s.status = 'active'))
    when 'review' then exists (
      select 1 from public.reviews r
      join public.products p on p.id = r.product_id
      left join public.sellers s on s.id = p.created_by_seller_id
      where r.id = p_id and r.status = 'published' and p.status = 'active'
        and (s.id is null or s.status = 'active'))
    else false
  end;
$$;

comment on column public.content_reports.reporter_email is
  'A contact detail the reporter typed, never verified. Staff may write to it by hand; nothing may send automatic messages to it, because anyone can type anyone''s address.';

-- Nothing is planned for that address either. The notifications migration
-- (082600) plans a "report resolved" e-mail to a visitor's typed address,
-- under the recipient 'report:<id>'. Where that table exists, a trigger drops
-- any such delivery before it is stored, and any already planned is skipped:
-- a visitor must not be able to make Yuntera write to somebody else. Without
-- notifications this does nothing; a reporter with an account is still told
-- about the outcome through their account.
create or replace function private.drop_typed_address_deliveries() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recipient like 'report:%' then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.drop_typed_address_deliveries() from public;

do $$
begin
  if to_regclass('private.notification_deliveries') is not null then
    execute 'create trigger notification_deliveries_no_typed_address
               before insert on private.notification_deliveries
               for each row execute function private.drop_typed_address_deliveries()';
    execute $sql$update private.notification_deliveries set status = 'skipped'
                 where recipient like 'report:%' and status = 'pending'$sql$;
  end if;
end
$$;

create index content_reports_visitor_recent_idx on public.content_reports (created_at)
  where reporter_id is null;
create index content_reports_target_idx on public.content_reports (target_type, target_id)
  where status in ('open', 'in_review');
create index content_reports_reporter_idx on public.content_reports (reporter_id)
  where status in ('open', 'in_review');

-- Replaces the version in api_shopper. What changed:
--   * the target must exist and be public (report_target_not_found);
--   * the same reporter (the account, or a visitor's e-mail) reporting the same
--     thing for the same reason while it is open gets the same report back:
--     counted once;
--   * a signed-in account has a cap on open reports;
--   * visitors share a safety valve per hour across the platform. When it is
--     reached a visitor is asked to write to support (reports_paused), except
--     about something nobody has reported yet: that first report always gets
--     through, so a flood cannot silence the reports about one listing;
--   * text and e-mail are bounded and checked, so no raw constraint error.
-- The e-mail is stored as a contact detail only; the event says nothing about it.
create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null,
  p_email text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  c_details_max constant integer := 2000;
  v_user uuid := (select auth.uid());
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_details text := nullif(trim(coalesce(p_details, '')), '');
  v_id uuid;
begin
  if p_target_type is null or p_target_type not in ('product', 'review', 'seller')
     or p_target_id is null
     or p_reason is null or p_reason not in ('illegal_product', 'counterfeit', 'unsafe', 'misleading',
                                             'intellectual_property', 'abuse', 'other')
     or char_length(v_details) > c_details_max then
    perform private.fail('invalid_report');
  end if;
  if v_user is null and v_email is null then
    perform private.fail('contact_required');
  end if;
  if v_email is not null and not private.is_email(v_email) then
    perform private.fail('invalid_contact_email');
  end if;
  if not private.is_public_target(p_target_type, p_target_id) then
    perform private.fail('report_target_not_found');
  end if;

  -- The same reporter about the same thing takes turns, so a repeat is found.
  perform pg_advisory_xact_lock(hashtextextended(
    'report:' || p_target_type || ':' || p_target_id::text || ':' || p_reason || ':'
      || coalesce(v_user::text, 'e:' || v_email), 0));
  select r.id into v_id from public.content_reports r
  where r.target_type = p_target_type and r.target_id = p_target_id
    and r.status in ('open', 'in_review') and r.reason = p_reason
    and (case when v_user is not null then r.reporter_id = v_user
              else r.reporter_id is null and lower(r.reporter_email) = v_email end)
  order by r.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if v_user is not null then
    if (select count(*) from public.content_reports r
        where r.reporter_id = v_user and r.status in ('open', 'in_review'))
       >= private.limit_value('max_open_reports_per_account', 20) then
      perform private.fail('too_many_open_reports');
    end if;
  elsif exists (select 1 from public.content_reports r
                where r.target_type = p_target_type and r.target_id = p_target_id
                  and r.status in ('open', 'in_review'))
        and (select count(*) from public.content_reports r
             where r.reporter_id is null and r.created_at > now() - interval '1 hour')
            >= private.limit_value('visitor_reports_per_hour', 300) then
    perform private.fail('reports_paused');
  end if;

  insert into public.content_reports (reporter_id, reporter_email, target_type, target_id, reason, details)
  values (v_user, v_email, p_target_type, p_target_id, p_reason, v_details)
  returning id into v_id;
  perform private.emit('content.reported', jsonb_build_object('report_id', v_id));
  return v_id;
exception
  when check_violation then
    perform private.fail('invalid_report');
end;
$$;

-- Replaces the version in api_shopper. What changed: a cap on open
-- complaints per account; the same complaint about the same order while it is
-- open is counted once; every field checked, so no raw constraint error.
create or replace function public.file_complaint(
  p_category text,
  p_description text,
  p_order_number text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_description text := trim(coalesce(p_description, ''));
  v_order uuid;
  v_id uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if p_category is null
     or p_category not in ('delivery', 'product', 'payment', 'seller', 'privacy', 'other')
     or char_length(v_description) not between 10 and 4000
     or char_length(p_order_number) > 40 then
    perform private.fail('invalid_complaint');
  end if;
  if p_order_number is not null then
    select id into v_order from public.orders
    where order_number = p_order_number and user_id = v_user;
    if v_order is null then
      perform private.fail('order_not_found');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('complaint:' || v_user::text, 0));
  select c.id into v_id from public.complaints c
  where c.user_id = v_user and c.status <> 'resolved' and c.category = p_category
    and c.order_id is not distinct from v_order and c.description = v_description
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  if (select count(*) from public.complaints c where c.user_id = v_user and c.status <> 'resolved')
     >= private.limit_value('max_open_complaints_per_account', 5) then
    perform private.fail('too_many_open_complaints');
  end if;

  insert into public.complaints (user_id, order_id, category, description)
  values (v_user, v_order, p_category, v_description)
  returning id into v_id;
  perform private.emit('complaint.filed', jsonb_build_object('complaint_id', v_id));
  return v_id;
exception
  when check_violation then
    perform private.fail('invalid_complaint');
end;
$$;

-- Replaces the version in api_backoffice, keeping every item as it was. Each
-- queue now carries its oldest items, a page of them, and `totals` says how
-- many there are, so the payload no longer grows with whatever was filed.
create or replace function public.ops_care_queues() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_page constant integer := 100;
begin
  if not private.has_staff_role('support', 'ops', 'finance', 'catalog') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'complaints', coalesce((
      select jsonb_agg(x.item order by x.created_at, x.id)
      from (
        select c.created_at, c.id, jsonb_build_object(
          'id', c.id, 'category', c.category, 'description', c.description, 'status', c.status,
          'created_at', c.created_at, 'order_number', o.order_number, 'customer', pr.full_name
        ) as item
        from public.complaints c
        left join public.orders o on o.id = c.order_id
        left join public.profiles pr on pr.id = c.user_id
        where c.status <> 'resolved'
        order by c.created_at, c.id
        limit c_page
      ) x), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(x.item order by x.refund_due_on nulls last, x.created_at, x.id)
      from (
        select r.refund_due_on, r.created_at, r.id, jsonb_build_object(
          'id', r.id, 'kind', r.kind, 'quantity', r.quantity, 'reason', r.reason,
          'status', r.status, 'refund_due_on', r.refund_due_on, 'created_at', r.created_at,
          'title', i.title, 'order_number', o.order_number, 'seller_name', s.trade_name,
          'customer', pr.full_name, 'amount_minor', i.unit_price_minor * r.quantity
        ) as item
        from public.return_requests r
        join public.order_items i on i.id = r.order_item_id
        join public.orders o on o.id = i.order_id
        left join public.sellers s on s.id = i.seller_id
        left join public.profiles pr on pr.id = r.user_id
        where r.status in ('requested', 'approved', 'received')
        order by r.refund_due_on nulls last, r.created_at, r.id
        limit c_page
      ) x), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(x.item order by x.created_at, x.id)
      from (
        select cr.created_at, cr.id, jsonb_build_object(
          'id', cr.id, 'target_type', cr.target_type, 'target_id', cr.target_id,
          'reason', cr.reason, 'details', cr.details, 'status', cr.status,
          'created_at', cr.created_at,
          'target_label', case cr.target_type
            when 'product' then (select p.title from public.products p where p.id = cr.target_id)
            when 'seller' then (select s.trade_name from public.sellers s where s.id = cr.target_id)
            when 'review' then (select left(rv.body, 120) from public.reviews rv where rv.id = cr.target_id)
          end
        ) as item
        from public.content_reports cr where cr.status in ('open', 'in_review')
        order by cr.created_at, cr.id
        limit c_page
      ) x), '[]'::jsonb),
    'totals', jsonb_build_object(
      'complaints', (select count(*) from public.complaints c where c.status <> 'resolved'),
      'returns', (select count(*) from public.return_requests r
                  where r.status in ('requested', 'approved', 'received')),
      'reports', (select count(*) from public.content_reports cr
                  where cr.status in ('open', 'in_review')))
  );
end;
$$;

-- ═══ 6. Bounded input for visitors (FA-8) ══════════════════════════════════

-- What a search box may send: at most 200 characters and 12 words. Longer
-- input is cut, not refused, so a pasted paragraph still searches its start.
-- The numbers are SEARCH_INPUT_LIMITS in packages/core/src/search.ts; a unit
-- test reads this line: search input limits 200 characters, 12 words.
create or replace function private.bounded_search_text(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select case when p_text is null then null else
    array_to_string((regexp_split_to_array(trim(left(p_text, 200)), '\s+'))[1:12], ' ') end;
$$;

-- The search functions keep their bodies (search.sql, whose constants a unit
-- test checks) under a private name; the public names become thin wrappers
-- that bound the text first. The wrappers are security definer, like every
-- API function, and the bodies are reachable only through them: nobody can
-- call a body with unbounded text. The bodies read only what a visitor may
-- see (active products), as their own filters say.
alter function public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer)
  rename to search_products_unbounded;
alter function public.search_products_unbounded(text, text, bigint, bigint, boolean, boolean, text, integer, integer)
  set schema private;
alter function public.suggest_products(text, integer) rename to suggest_products_unbounded;
alter function public.suggest_products_unbounded(text, integer) set schema private;

create function public.search_products(
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
language sql stable
set search_path = ''
as $$
  select * from private.search_products_unbounded(
    private.bounded_search_text(p_query), left(p_category_slug, 100), p_min_price_minor,
    p_max_price_minor, p_in_stock_only, p_made_in_cr, left(p_sort, 20), p_limit,
    least(greatest(coalesce(p_offset, 0), 0), 10000));
$$;
alter function public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer)
  security definer;

create function public.suggest_products(p_prefix text, p_limit integer default 8)
returns table (title text, slug text)
language sql stable
set search_path = ''
as $$
  select * from private.suggest_products_unbounded(private.bounded_search_text(p_prefix), p_limit);
$$;
alter function public.suggest_products(text, integer) security definer;

-- Replaces the version in api_shopper. The number of lines is checked before
-- any pricing work, and a line that is not an object with an offer id and a
-- whole quantity is answered as an issue, not a raw cast error.
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

  select z.* into v_zone from public.delivery_zones z
  where z.id = private.zone_for_postal_code(v_postal);

  if v_zone.id is not null then
    select shipping_minor, shipping_tax_minor into v_shipping, v_shipping_tax
    from private.shipping_for(v_zone.id, v_check.items_total);
    if v_zone.active then
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
      jsonb_build_object('id', v_zone.id, 'name', v_zone.name, 'active', v_zone.active) end,
    'promise', case when v_latest is null then null else
      jsonb_build_object('earliest', v_earliest, 'latest', v_latest) end,
    'cod_available', coalesce(v_zone.cod_available, false)
                     and v_check.items_total + v_shipping <= v_cod_max,
    'payments_mode', private.setting('payments_mode') #>> '{}'
  );
end;
$$;

-- ═══ 7. Reviewer names (FA-9) ══════════════════════════════════════════════

-- Replaces the version in api_shopper: "María F." only for an account that
-- has a published review; "Cliente" for any other id, existing or not, so the
-- answer neither names staff or drivers nor tells whether an account exists.
create or replace function public.reviewer_display_name(p_user_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select nullif(trim(
      split_part(trim(p.full_name), ' ', 1) ||
      case when split_part(trim(p.full_name), ' ', 2) <> ''
           then ' ' || left(split_part(trim(p.full_name), ' ', 2), 1) || '.' else '' end), '')
    from public.profiles p
    where p.id = p_user_id
      and exists (select 1 from public.reviews r where r.user_id = p_user_id and r.status = 'published')
  ), 'Cliente');
$$;

-- ═══ 8. Joining a shop needs the invited person's yes (DTA-6) ══════════════

-- Nobody writes the member list directly any more: an owner or administrator
-- invites by e-mail, the invited account accepts or declines, and members
-- leave or are removed through the functions below.
revoke insert, update, delete on public.seller_members from authenticated;

create table public.seller_invitations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  -- As the inviter typed it (lower case). Shown only to the shop's administrators.
  email text not null check (char_length(email) <= 254),
  -- The account with that address when the invitation was sent, or null when
  -- there was none. Only that account can answer. When there was none, the
  -- account that later signs up with the address and confirms it (proving it
  -- owns the mailbox) can: inviting someone before they register is the
  -- common case. An account whose address is not confirmed never can.
  invitee_id uuid references auth.users (id) on delete cascade,
  role public.seller_member_role not null check (role in ('admin', 'staff')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  answered_at timestamptz,
  answered_by uuid references auth.users (id),
  constraint seller_invitations_answered check ((status = 'pending') = (answered_at is null))
);

create unique index seller_invitations_open_idx
  on public.seller_invitations (seller_id, email) where status = 'pending';
create index seller_invitations_invitee_idx
  on public.seller_invitations (invitee_id) where status = 'pending';
create index seller_invitations_unbound_idx
  on public.seller_invitations (email) where status = 'pending' and invitee_id is null;

alter table public.seller_invitations enable row level security;
revoke all on public.seller_invitations from anon, authenticated;

-- An invitation still waiting: pending and not past its date.
create or replace function private.invitation_open(p public.seller_invitations) returns boolean
language sql stable
set search_path = ''
as $$
  select p.status = 'pending' and p.expires_at > now();
$$;

-- An invitation that can still be accepted: open, and whoever sent it is still
-- allowed to (the owner, or an administrator for a staff seat). An
-- administrator who leaves or is removed takes their invitations with them.
create or replace function private.invitation_valid(p public.seller_invitations) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.invitation_open(p) and exists (
    select 1 from public.seller_members m
    where m.seller_id = p.seller_id and m.user_id = p.invited_by
      and (m.role = 'owner' or (m.role = 'admin' and p.role = 'staff')));
$$;

-- Whether the signed-in person may answer an invitation: it names their
-- account, or it named nobody and was sent to the address they confirmed.
create or replace function private.invitation_for_me(p public.seller_invitations) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when p.invitee_id is not null then p.invitee_id = (select auth.uid())
    else exists (select 1 from auth.users u
                 where u.id = (select auth.uid()) and u.email_confirmed_at is not null
                   and lower(u.email) = p.email)
  end;
$$;

-- Withdraws what someone sent for a shop when they stop being allowed to send
-- it (they left, were removed or became staff), so the owner's list is true.
create or replace function private.revoke_invitations_sent_by(p_seller_id uuid, p_user_id uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.seller_invitations i
  set status = 'revoked', answered_at = now(), answered_by = (select auth.uid())
  where i.seller_id = p_seller_id and i.invited_by = p_user_id and i.status = 'pending'
    and not private.invitation_valid(i);
$$;

-- The shop's team, for any member. Administrators also see the e-mail of each
-- member and the invitations waiting for an answer.
create or replace function public.seller_team(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_admin boolean;
  v_owner boolean;
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  v_admin := private.is_seller_admin(p_seller_id);
  v_owner := exists (select 1 from public.seller_members m
                     where m.seller_id = p_seller_id and m.user_id = v_me and m.role = 'owner');
  return jsonb_build_object(
    'can_manage', v_admin,
    'is_owner', v_owner,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'full_name', p.full_name,
        'email', case when v_admin then u.email end,
        'role', m.role, 'since', m.created_at, 'is_you', m.user_id = v_me
      ) order by (m.role = 'owner') desc, (m.role = 'admin') desc, p.full_name, m.user_id)
      from public.seller_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      where m.seller_id = p_seller_id), '[]'::jsonb),
    'invitations', case when not v_admin then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'created_at', i.created_at,
        'expires_at', i.expires_at,
        'invited_by_name', (select p.full_name from public.profiles p where p.id = i.invited_by)
      ) order by i.created_at)
      from public.seller_invitations i
      where i.seller_id = p_seller_id and private.invitation_valid(i)), '[]'::jsonb) end
  );
end;
$$;

-- An owner or administrator invites someone by the e-mail they sign in with.
-- The answer is the same whether or not that address has an account, so
-- inviting cannot be used to find out who has one. Only the owner invites
-- administrators. Inviting the same address again renews the invitation.
create or replace function public.seller_invite_member(
  p_seller_id uuid,
  p_email text,
  p_role public.seller_member_role
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  c_valid_days constant integer := 14;
  v_me uuid := (select auth.uid());
  v_email text := lower(trim(coalesce(p_email, '')));
  v_status public.seller_status;
  v_invitee uuid;
  v_id uuid;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  if p_role is null or p_role not in ('admin', 'staff') then
    perform private.fail('invalid_member_role');
  end if;
  if p_role = 'admin' and not exists (
    select 1 from public.seller_members m
    where m.seller_id = p_seller_id and m.user_id = v_me and m.role = 'owner'
  ) then
    perform private.fail('owner_only');
  end if;
  if not private.is_email(v_email) then
    perform private.fail('invalid_invitation_email');
  end if;

  -- One change to the team at a time, so the counts below hold.
  select status into v_status from public.sellers where id = p_seller_id for update;
  if v_status not in ('pending', 'active') then
    perform private.fail('shop_not_active');
  end if;

  v_invitee := private.account_by_email(v_email);
  if v_invitee is not null and exists (
    select 1 from public.seller_members m where m.seller_id = p_seller_id and m.user_id = v_invitee
  ) then
    perform private.fail('already_a_member');
  end if;

  update public.seller_invitations
  set role = p_role, invitee_id = v_invitee, invited_by = v_me,
      created_at = now(), expires_at = now() + make_interval(days => c_valid_days)
  where seller_id = p_seller_id and email = v_email and status = 'pending'
  returning id into v_id;

  if v_id is null then
    -- Invitations past their date no longer hold a place.
    update public.seller_invitations
    set status = 'revoked', answered_at = now()
    where seller_id = p_seller_id and email = v_email and status = 'pending';
    if (select count(*) from public.seller_invitations i
        where i.seller_id = p_seller_id and private.invitation_open(i))
       >= private.limit_value('max_pending_invitations_per_shop', 20) then
      perform private.fail('too_many_invitations');
    end if;
    if (select count(*) from public.seller_members m where m.seller_id = p_seller_id)
       + (select count(*) from public.seller_invitations i
          where i.seller_id = p_seller_id and private.invitation_open(i))
       >= private.limit_value('max_members_per_shop', 50) then
      perform private.fail('team_full');
    end if;
    insert into public.seller_invitations (seller_id, email, invitee_id, role, invited_by, expires_at)
    values (p_seller_id, v_email, v_invitee, p_role, v_me, now() + make_interval(days => c_valid_days))
    returning id into v_id;
  end if;

  -- For a future notice to the invited account. It names the account, never
  -- the address typed: a message goes to an address its owner proved, not to
  -- one somebody else wrote down.
  if v_invitee is not null then
    perform private.emit('seller.member_invited',
      jsonb_build_object('invitation_id', v_id, 'seller_id', p_seller_id, 'invitee_id', v_invitee));
  end if;
  return v_id;
end;
$$;

-- The invitations waiting for the signed-in person. Works for someone with no
-- shop yet: that is who is usually invited.
create or replace function public.my_invitations() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    perform private.fail('not_authenticated');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'role', i.role, 'created_at', i.created_at, 'expires_at', i.expires_at,
      'shop', jsonb_build_object('id', s.id, 'trade_name', s.trade_name, 'status', s.status),
      -- A first name is enough to recognise who invited you.
      'invited_by_name', (select split_part(trim(p.full_name), ' ', 1)
                          from public.profiles p where p.id = i.invited_by)
    ) order by i.created_at)
    from public.seller_invitations i
    join public.sellers s on s.id = i.seller_id
    where private.invitation_for_me(i) and private.invitation_valid(i) and s.status <> 'closed'
  ), '[]'::jsonb);
end;
$$;

-- The invited person accepts (they become a member with the role offered) or
-- declines. Anyone else, and an invitation past its date, gets "not found".
-- Answers the shop's id.
create or replace function public.seller_answer_invitation(p_invitation_id uuid, p_accept boolean)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v public.seller_invitations%rowtype;
begin
  if v_me is null then
    perform private.fail('not_authenticated');
  end if;
  select * into v from public.seller_invitations where id = p_invitation_id for update;
  if not found or not private.invitation_for_me(v) or not private.invitation_valid(v) then
    perform private.fail('invitation_not_found');
  end if;
  if p_accept is null then
    perform private.fail('invitation_not_found');
  end if;
  if p_accept then
    if not exists (select 1 from public.sellers s where s.id = v.seller_id and s.status in ('pending', 'active')) then
      perform private.fail('shop_not_active');
    end if;
    insert into public.seller_members (seller_id, user_id, role)
    values (v.seller_id, v_me, v.role)
    on conflict (seller_id, user_id) do nothing;
  end if;
  update public.seller_invitations
  set status = case when p_accept then 'accepted' else 'declined' end,
      answered_at = now(), answered_by = v_me, invitee_id = v_me
  where id = v.id;
  perform private.emit('seller.invitation_answered',
    jsonb_build_object('invitation_id', v.id, 'seller_id', v.seller_id, 'accepted', p_accept));
  return v.seller_id;
end;
$$;

-- The owner withdraws any invitation; an administrator, those for staff.
create or replace function public.seller_revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.seller_invitations%rowtype;
begin
  select * into v from public.seller_invitations where id = p_invitation_id for update;
  if not found or not private.is_seller_admin(v.seller_id) or v.status <> 'pending' then
    perform private.fail('invitation_not_found');
  end if;
  if v.role = 'admin' and not exists (
    select 1 from public.seller_members m
    where m.seller_id = v.seller_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    perform private.fail('owner_only');
  end if;
  update public.seller_invitations
  set status = 'revoked', answered_at = now(), answered_by = (select auth.uid())
  where id = v.id;
end;
$$;

-- Removes someone from the team, or (naming yourself) leaves it. The owner
-- removes anyone but themselves; an administrator removes staff; nobody
-- removes or replaces the owner. Access ends with the row.
create or replace function public.seller_remove_member(p_seller_id uuid, p_user_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_my_role public.seller_member_role;
  v_their_role public.seller_member_role;
begin
  select m.role into v_my_role from public.seller_members m
  where m.seller_id = p_seller_id and m.user_id = v_me;
  -- A member who turned the second factor on acts only from a session that
  -- passed it, as everywhere else in the seller centre (is_seller_member).
  if v_my_role is null or not private.factor_ok() then
    perform private.fail('forbidden');
  end if;
  select m.role into v_their_role from public.seller_members m
  where m.seller_id = p_seller_id and m.user_id = p_user_id for update;
  if v_their_role is null then
    perform private.fail('member_not_found');
  end if;
  if v_their_role = 'owner' then
    perform private.fail('owner_only');
  end if;
  if p_user_id <> v_me and not (v_my_role = 'owner' or (v_my_role = 'admin' and v_their_role = 'staff')) then
    perform private.fail('owner_only');
  end if;
  delete from public.seller_members where seller_id = p_seller_id and user_id = p_user_id;
  perform private.revoke_invitations_sent_by(p_seller_id, p_user_id);
end;
$$;

-- The owner makes a member an administrator, or staff again.
create or replace function public.seller_set_member_role(
  p_seller_id uuid,
  p_user_id uuid,
  p_role public.seller_member_role
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  if not exists (select 1 from public.seller_members m
                 where m.seller_id = p_seller_id and m.user_id = (select auth.uid()) and m.role = 'owner') then
    perform private.fail('owner_only');
  end if;
  if p_role is null or p_role not in ('admin', 'staff') then
    perform private.fail('invalid_member_role');
  end if;
  update public.seller_members set role = p_role
  where seller_id = p_seller_id and user_id = p_user_id and role <> 'owner';
  if not found then
    perform private.fail('member_not_found');
  end if;
  perform private.revoke_invitations_sent_by(p_seller_id, p_user_id);
end;
$$;

-- ═══ 9. The shop's name, fiscal details and contact (DTA-11, DTA-12) ═══════

-- A shop admin no longer writes these directly. The public name could imitate
-- the platform or another shop; fiscal details could drift from what was
-- verified; the contact phone is the number finance calls to confirm a change
-- of payout account. Each is now a request a member of staff approves, in the
-- shape of the payout-account request (migration 082300).
revoke update (trade_name, description, logo_path) on public.sellers from authenticated;
revoke update (fiscal_address, postal_code, economic_activity_code, tax_regime, contact_email,
               contact_phone, payout_iban, payout_holder_name, sinpe_movil_number)
  on public.seller_private from authenticated;

create table public.seller_change_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  --   shop_name  the shop's public name (ops decide)
  --   fiscal     tax regime, fiscal address, postal code, activity code (ops decide)
  --   contact    contact e-mail and phone (finance decide: it is their phone check)
  kind text not null check (kind in ('shop_name', 'fiscal', 'contact')),
  -- The whole desired state of that kind, and what it was when asked.
  proposed jsonb not null,
  previous jsonb not null,
  -- `replaced` = the seller sent a newer request of the same kind first.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'replaced')),
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  -- Written for the seller, who reads it when a request is rejected.
  decision_note text check (char_length(decision_note) <= 1000),
  constraint seller_change_requests_closed check ((status = 'pending') = (decided_at is null))
);

create unique index seller_change_requests_open_idx
  on public.seller_change_requests (seller_id, kind) where status = 'pending';
create index seller_change_requests_seller_idx
  on public.seller_change_requests (seller_id, requested_at desc);

alter table public.seller_change_requests enable row level security;
revoke all on public.seller_change_requests from anon, authenticated;

-- Which staff decide each kind.
create or replace function private.may_decide_shop_change(p_kind text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'contact' then private.has_staff_role('finance')
    when 'shop_name' then private.has_staff_role('ops')
    when 'fiscal' then private.has_staff_role('ops')
    else false
  end;
$$;

-- What a shop's details of one kind are now, in the shape a request proposes.
create or replace function private.shop_details(p_seller_id uuid, p_kind text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'shop_name' then jsonb_build_object('trade_name', s.trade_name)
    when 'fiscal' then jsonb_build_object(
      'tax_regime', sp.tax_regime, 'fiscal_address', sp.fiscal_address,
      'postal_code', sp.postal_code, 'economic_activity_code', sp.economic_activity_code)
    when 'contact' then jsonb_build_object(
      'contact_email', sp.contact_email, 'contact_phone', sp.contact_phone)
  end
  from public.sellers s join public.seller_private sp on sp.seller_id = s.id
  where s.id = p_seller_id;
$$;

-- A shop's owner or administrator asks for a change of one kind. Pass the
-- fields of that kind; the others are ignored. A newer request of the same
-- kind replaces one still waiting. A change of contact is refused while a
-- change of payout account waits: finance would be confirming the account by
-- calling a number that is itself being changed.
create or replace function public.seller_request_shop_change(
  p_seller_id uuid,
  p_kind text,
  p_trade_name text default null,
  p_tax_regime text default null,
  p_fiscal_address text default null,
  p_postal_code text default null,
  p_economic_activity_code text default null,
  p_contact_email text default null,
  p_contact_phone text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_proposed jsonb;
  v_current jsonb;
  v_phone text := regexp_replace(coalesce(p_contact_phone, ''), '[\s-]', '', 'g');
  v_id uuid;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  if p_kind is null or p_kind not in ('shop_name', 'fiscal', 'contact') then
    perform private.fail('invalid_change_kind');
  end if;
  -- One request at a time per shop.
  perform 1 from public.seller_private where seller_id = p_seller_id for update;
  if not exists (select 1 from public.sellers s where s.id = p_seller_id and s.status <> 'closed') then
    perform private.fail('shop_not_active');
  end if;

  if p_kind = 'shop_name' then
    v_proposed := jsonb_build_object('trade_name', private.clean_text(p_trade_name));
    perform private.check_shop_name(v_proposed ->> 'trade_name', p_seller_id);
  elsif p_kind = 'fiscal' then
    -- A field left out (null or blank) keeps what is on file: a seller fixing
    -- the address must not wipe the postal or activity code Hacienda verified.
    -- So a request never clears a field; staff do that if it is ever needed.
    v_current := private.shop_details(p_seller_id, 'fiscal');
    v_proposed := jsonb_build_object(
      'tax_regime', coalesce(nullif(trim(coalesce(p_tax_regime, '')), ''), v_current ->> 'tax_regime'),
      'fiscal_address', coalesce(private.clean_text(p_fiscal_address), v_current ->> 'fiscal_address'),
      'postal_code', coalesce(nullif(trim(coalesce(p_postal_code, '')), ''), v_current ->> 'postal_code'),
      'economic_activity_code', coalesce(
        nullif(regexp_replace(coalesce(p_economic_activity_code, ''), '[\s.]', '', 'g'), ''),
        v_current ->> 'economic_activity_code'));
    if (v_proposed ->> 'tax_regime') is null or (v_proposed ->> 'tax_regime') not in ('general', 'simplificado')
       or coalesce(char_length(v_proposed ->> 'fiscal_address'), 0) not between 10 and 500
       or (v_proposed ->> 'postal_code' is not null
           and not exists (select 1 from public.districts d where d.postal_code = v_proposed ->> 'postal_code'))
       or coalesce(v_proposed ->> 'economic_activity_code', '000000') !~ '^[0-9]{4,6}$' then
      perform private.fail('invalid_fiscal_details');
    end if;
  else
    v_proposed := jsonb_build_object(
      'contact_email', lower(trim(coalesce(p_contact_email, ''))),
      'contact_phone', v_phone);
    if not private.is_email(v_proposed ->> 'contact_email') or v_phone !~ '^\+506[2-8][0-9]{7}$' then
      perform private.fail('invalid_contact_details');
    end if;
    if exists (select 1 from public.payout_detail_requests r
               where r.seller_id = p_seller_id and r.status = 'pending') then
      perform private.fail('payout_request_open');
    end if;
  end if;

  if v_proposed = private.shop_details(p_seller_id, p_kind) then
    perform private.fail('shop_change_unchanged');
  end if;

  update public.seller_change_requests
  set status = 'replaced', decided_at = now()
  where seller_id = p_seller_id and kind = p_kind and status = 'pending';

  insert into public.seller_change_requests (seller_id, kind, proposed, previous, requested_by)
  values (p_seller_id, p_kind, v_proposed, private.shop_details(p_seller_id, p_kind), (select auth.uid()))
  returning id into v_id;

  perform private.emit('seller.change_requested',
    jsonb_build_object('seller_id', p_seller_id, 'request_id', v_id, 'kind', p_kind));
  return v_id;
end;
$$;

-- A request's public face: never who decided, only what and why.
create or replace function private.shop_change_item(r public.seller_change_requests) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'proposed', r.proposed,
    'requested_at', r.requested_at,
    'requested_by_name', (select p.full_name from public.profiles p where p.id = r.requested_by),
    'decided_at', r.decided_at, 'note', r.decision_note);
$$;

-- What a member sees: whether they may ask, whether a payout-account request
-- is waiting (which holds back a contact change), and the latest request of
-- each kind with its state.
create or replace function public.seller_shop_changes(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'can_request', private.is_seller_admin(p_seller_id)
                   and exists (select 1 from public.sellers s where s.id = p_seller_id and s.status <> 'closed'),
    'payout_request_open', exists (select 1 from public.payout_detail_requests r
                                   where r.seller_id = p_seller_id and r.status = 'pending'),
    -- What is on file, for the forms to start from, so a field the seller does
    -- not touch is sent as it is. Only for those who may ask for a change.
    'current', case when private.is_seller_admin(p_seller_id) then jsonb_build_object(
      'fiscal', private.shop_details(p_seller_id, 'fiscal'),
      'contact', private.shop_details(p_seller_id, 'contact')) end,
    'requests', coalesce((
      select jsonb_agg(private.shop_change_item(x.request) order by x.kind)
      from (
        select distinct on (r.kind) r.kind, r as request
        from public.seller_change_requests r
        where r.seller_id = p_seller_id and r.status not in ('replaced', 'withdrawn')
        order by r.kind, r.requested_at desc
      ) x), '[]'::jsonb)
  );
end;
$$;

-- The seller changes their mind about a request still waiting.
create or replace function public.seller_withdraw_shop_change(p_request_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
begin
  select seller_id into v_seller from public.seller_change_requests where id = p_request_id for update;
  if v_seller is null or not private.is_seller_admin(v_seller) then
    perform private.fail('shop_change_not_found');
  end if;
  update public.seller_change_requests
  set status = 'withdrawn', decided_at = now(), decided_by = (select auth.uid())
  where id = p_request_id and status = 'pending';
  if not found then
    perform private.fail('shop_change_not_found');
  end if;
end;
$$;

-- The staff queue: requests this person may decide (ops: names and fiscal
-- details; finance: contacts), waiting ones first, oldest first, then the
-- latest decided. Each carries what is there now and what is asked.
create or replace function public.ops_shop_change_requests(p_status text default 'pending')
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c_page constant integer := 100;
begin
  if not private.has_staff_role('ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.pending desc, x.sort_key, x.id)
    from (
      select r.id, (r.status = 'pending') as pending,
        case when r.status = 'pending' then extract(epoch from r.requested_at)
             else -extract(epoch from r.decided_at) end as sort_key,
        private.shop_change_item(r) || jsonb_build_object(
          'current', private.shop_details(r.seller_id, r.kind),
          'previous', r.previous,
          'requested_by_email', ru.email,
          'decided_by_name', (select p.full_name from public.profiles p where p.id = r.decided_by),
          'seller', jsonb_build_object(
            'id', s.id, 'trade_name', s.trade_name, 'slug', s.slug, 'status', s.status,
            'legal_name', sp.legal_name, 'id_type', sp.id_type, 'id_number', sp.id_number,
            'contact_phone', sp.contact_phone, 'kyc_status', sp.kyc_status),
          'signals', jsonb_build_object(
            'payout_request_open', exists (select 1 from public.payout_detail_requests q
                                           where q.seller_id = r.seller_id and q.status = 'pending'),
            'name_problem', case when r.kind = 'shop_name' and r.status = 'pending'
                                 then private.shop_name_problem(r.proposed ->> 'trade_name', r.seller_id) end),
          'can_decide', r.status = 'pending' and private.may_decide_shop_change(r.kind)
                        and r.requested_by <> (select auth.uid())
                        and not private.is_seller_member(r.seller_id)
        ) as item
      from public.seller_change_requests r
      join public.sellers s on s.id = r.seller_id
      join public.seller_private sp on sp.seller_id = r.seller_id
      join auth.users ru on ru.id = r.requested_by
      where r.status not in ('replaced', 'withdrawn')
        and (p_status is null or r.status = p_status)
        and private.may_decide_shop_change(r.kind)
      order by (r.status = 'pending') desc, r.requested_at
      limit c_page
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Staff approve (the change is made at once) or reject with a reason the
-- seller reads. Nobody decides their own request or one for a shop they
-- belong to. A name is checked again on approval: another shop may have
-- taken it meanwhile.
create or replace function public.ops_decide_shop_change(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.seller_change_requests%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.has_staff_role('ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  select * into r from public.seller_change_requests where id = p_request_id for update;
  if not found or not private.may_decide_shop_change(r.kind) then
    perform private.fail('shop_change_not_found');
  end if;
  if r.status <> 'pending' then
    perform private.fail('shop_change_not_pending');
  end if;
  if r.requested_by = (select auth.uid()) then
    perform private.fail('cannot_decide_own_request');
  end if;
  if private.is_seller_member(r.seller_id) then
    perform private.fail('cannot_decide_own_shop');
  end if;
  if p_approve is null then
    perform private.fail('shop_change_not_pending');
  end if;
  if char_length(v_note) > 1000 then
    perform private.fail('note_too_long');
  end if;
  if not p_approve and coalesce(char_length(v_note), 0) < 10 then
    perform private.fail('reason_required');
  end if;

  -- The shop's row first: a payout-account request sent at the same moment
  -- waits for this decision, and this one sees it if it came first.
  perform 1 from public.seller_private where seller_id = r.seller_id for update;
  -- Finance confirms a payout-account change by calling the phone on file. A
  -- contact change approved while such a request waits would let whoever sent
  -- both answer that call: the payout request is decided first.
  if p_approve and r.kind = 'contact' and exists (
    select 1 from public.payout_detail_requests q
    where q.seller_id = r.seller_id and q.status = 'pending'
  ) then
    perform private.fail('contact_change_waits_for_payout');
  end if;

  if p_approve then
    if r.kind = 'shop_name' then
      perform private.check_shop_name(r.proposed ->> 'trade_name', r.seller_id);
      update public.sellers set trade_name = r.proposed ->> 'trade_name' where id = r.seller_id;
    elsif r.kind = 'fiscal' then
      -- Whoever approves has checked the new details against Hacienda's records.
      update public.seller_private
      set tax_regime = r.proposed ->> 'tax_regime',
          fiscal_address = r.proposed ->> 'fiscal_address',
          postal_code = r.proposed ->> 'postal_code',
          economic_activity_code = r.proposed ->> 'economic_activity_code',
          hacienda_verified_at = case when hacienda_verified_at is not null then now() end
      where seller_id = r.seller_id;
    else
      update public.seller_private
      set contact_email = r.proposed ->> 'contact_email',
          contact_phone = r.proposed ->> 'contact_phone'
      where seller_id = r.seller_id;
    end if;
  end if;

  update public.seller_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
  where id = r.id;

  perform private.emit('seller.change_decided', jsonb_build_object(
    'seller_id', r.seller_id, 'request_id', r.id, 'kind', r.kind, 'approved', p_approve));
end;
$$;

-- ═══ 10. Consents are stamped by the database and never rewritten (DTA-13) ═

revoke insert, update, delete on public.consents from authenticated;

-- The current version of a policy.
create or replace function private.policy_version(p_purpose text) returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.setting('policy_versions') ->> p_purpose, '2026-11');
$$;

-- On the table itself, so no path can rewrite history: a new consent is
-- dated now, whatever the insert said; a withdrawal is dated now and is
-- final; nothing else about a record ever changes.
create or replace function private.consents_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.granted_at := now();
    new.revoked_at := null;
    return new;
  end if;
  if (new.id, new.user_id, new.purpose, new.policy_version, new.granted_at)
       is distinct from (old.id, old.user_id, old.purpose, old.policy_version, old.granted_at)
     or old.revoked_at is not null then
    perform private.fail('consent_history_locked');
  end if;
  if new.revoked_at is null then
    return old;
  end if;
  new.revoked_at := now();
  return new;
end;
$$;

create trigger consents_append_only before insert or update on public.consents
  for each row execute function private.consents_append_only();

-- Replaces the version in api_shopper: only the version in force, dated by
-- the database, and agreeing again to what is already agreed adds nothing.
create or replace function public.record_consent(p_purpose text, p_policy_version text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if p_purpose is null
     or p_purpose not in ('terms', 'privacy', 'marketing', 'location', 'driver_terms', 'seller_terms') then
    perform private.fail('invalid_consent');
  end if;
  if p_policy_version is distinct from private.policy_version(p_purpose) then
    perform private.fail('policy_version_outdated');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('consent:' || v_user::text || ':' || p_purpose, 0));
  if exists (select 1 from public.consents c
             where c.user_id = v_user and c.purpose = p_purpose
               and c.policy_version = p_policy_version and c.revoked_at is null) then
    return;
  end if;
  insert into public.consents (user_id, purpose, policy_version)
  values (v_user, p_purpose, p_policy_version);
end;
$$;

-- Withdraws the signed-in person's consent for a purpose, as of now. Answers
-- how many records it closed (0 when there was nothing to withdraw).
create or replace function public.withdraw_consent(p_purpose text) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if p_purpose is null
     or p_purpose not in ('terms', 'privacy', 'marketing', 'location', 'driver_terms', 'seller_terms') then
    perform private.fail('invalid_consent');
  end if;
  update public.consents set revoked_at = now()
  where user_id = v_user and purpose = p_purpose and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ═══ 11. Fees change only by migration, and every change is audited (DTA-7) ═

-- Commission, warehouse and payment fees, shipping prices: no API role writes
-- them. They change in a migration, where the parity test with
-- packages/core/src/fees.ts keeps both sides equal and the change is reviewed.
revoke insert, update, delete on
  public.fee_schedules, public.fee_payment_methods, public.fee_fulfillment_tiers,
  public.categories, public.delivery_zones
from authenticated;

-- And whatever changes them, a migration or an administrator in the
-- database, leaves a row in the audit log. (Tables that already have the
-- audit trigger are left as they are.)
do $$
declare
  v_table text;
begin
  foreach v_table in array array['categories', 'delivery_zones', 'fee_fulfillment_tiers',
                                  'fee_schedules', 'fee_payment_methods', 'holidays', 'zone_closures']
  loop
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = format('public.%I', v_table)::regclass and not t.tgisinternal
        and t.tgfoid = 'private.audit()'::regprocedure
    ) then
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()',
        v_table || '_audit', v_table);
    end if;
  end loop;
end
$$;

-- ═══ 12. Payout accounts finance approved ══════════════════════════════════

-- When finance approved the account on file, and who. Accounts entered
-- before requests existed have neither, and are not paid until approved.
alter table public.seller_private
  add column payout_approved_at timestamptz,
  add column payout_approved_by uuid references auth.users (id);

-- Replaces the version in people_payouts: approving also marks the account
-- as approved.
create or replace function public.ops_decide_payout_details(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_request public.payout_detail_requests%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  select * into v_request from public.payout_detail_requests where id = p_request_id for update;
  if not found then
    perform private.fail('payout_request_not_found');
  end if;
  if v_request.status <> 'pending' then
    perform private.fail('payout_request_not_pending', v_request.status);
  end if;
  -- Nobody approves a change they asked for themselves, nor one for a shop
  -- they belong to: a colleague in the shop could ask on their behalf.
  if v_request.requested_by = (select auth.uid()) then
    perform private.fail('cannot_decide_own_request');
  end if;
  if private.is_seller_member(v_request.seller_id) then
    perform private.fail('cannot_decide_own_shop');
  end if;
  if char_length(v_note) > 1000 then
    perform private.fail('note_too_long');
  end if;
  if not coalesce(p_approve, false) and coalesce(char_length(v_note), 0) < 10 then
    perform private.fail('reason_required');
  end if;

  if p_approve then
    update public.seller_private
    set payout_iban = v_request.payout_iban,
        payout_holder_name = v_request.payout_holder_name,
        sinpe_movil_number = v_request.sinpe_movil_number,
        payout_approved_at = now(),
        payout_approved_by = (select auth.uid())
    where seller_id = v_request.seller_id;
  end if;

  update public.payout_detail_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note
  where id = p_request_id;

  perform private.emit('payout_details.decided', jsonb_build_object(
    'seller_id', v_request.seller_id, 'request_id', p_request_id,
    'approved', coalesce(p_approve, false)));
end;
$$;

-- Replaces the version in people_payouts. What changed: asking again for the
-- account already on file is allowed while finance has never approved it, so
-- a seller whose account predates approvals can have it approved; and it is
-- refused while a change of the shop's contact waits (contact_request_open).
create or replace function public.seller_request_payout_details(
  p_seller_id uuid,
  p_iban text,
  p_holder_name text,
  p_sinpe_number text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  -- Accept the number the way people write it: in groups, with spaces.
  v_iban text := upper(regexp_replace(coalesce(p_iban, ''), '[\s-]', '', 'g'));
  v_holder text := trim(regexp_replace(coalesce(p_holder_name, ''), '\s+', ' ', 'g'));
  v_sinpe text := nullif(regexp_replace(coalesce(p_sinpe_number, ''), '[\s-]', '', 'g'), '');
  v_current public.seller_private%rowtype;
  v_id uuid;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  if not private.is_valid_cr_iban(v_iban) then
    perform private.fail('invalid_iban');
  end if;
  if char_length(v_holder) not between 3 and 160 then
    perform private.fail('invalid_account_holder');
  end if;
  if v_sinpe is not null and v_sinpe !~ '^\+506[5-8][0-9]{7}$' then
    perform private.fail('invalid_sinpe_number');
  end if;

  -- Locking the shop's row makes two requests sent at once take turns.
  select * into v_current from public.seller_private where seller_id = p_seller_id for update;
  if not found then
    perform private.fail('seller_not_found');
  end if;
  -- A change of contact waiting for finance holds this back, for the same
  -- reason a payout request holds back a contact change: the confirmation call
  -- must go to a number that is not itself being changed.
  if exists (select 1 from public.seller_change_requests c
             where c.seller_id = p_seller_id and c.kind = 'contact' and c.status = 'pending') then
    perform private.fail('contact_request_open');
  end if;
  if v_current.payout_approved_at is not null
     and v_current.payout_iban = v_iban and v_current.payout_holder_name = v_holder
     and v_current.sinpe_movil_number is not distinct from v_sinpe then
    perform private.fail('payout_details_unchanged');
  end if;

  update public.payout_detail_requests
  set status = 'replaced', decided_at = now()
  where seller_id = p_seller_id and status = 'pending';

  insert into public.payout_detail_requests
    (seller_id, payout_iban, payout_holder_name, sinpe_movil_number, requested_by)
  values (p_seller_id, v_iban, v_holder, v_sinpe, (select auth.uid()))
  returning id into v_id;

  perform private.emit('payout_details.requested',
    jsonb_build_object('seller_id', p_seller_id, 'request_id', v_id));
  return v_id;
end;
$$;

-- Replaces the version in people_payouts. An account on file that finance
-- never approved counts as no approved account (no_bank_details), which is
-- what the screens already say: "Sin cuenta bancaria aprobada".
create or replace function private.payout_candidates(
  p_cutoff date,
  p_hold_days integer,
  p_minimum_minor bigint
) returns table (
  seller_id uuid, trade_name text, seller_status public.seller_status,
  payable_minor bigint, pending_minor bigint, in_transit_minor bigint, available_minor bigint,
  payout_iban text, payout_holder_name text, reasons text[]
)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.trade_name, s.status,
         b.payable_minor, b.pending_minor, b.in_transit_minor, b.available_minor,
         sp.payout_iban, sp.payout_holder_name,
         array_remove(array[
           case when s.status in ('suspended', 'pending') then 'shop_suspended' end,
           case when sp.payout_iban is null or sp.payout_holder_name is null
                  or sp.payout_approved_at is null then 'no_bank_details' end,
           -- An account on file from before requests existed, never checked.
           case when sp.payout_iban is not null and not private.is_valid_cr_iban(sp.payout_iban)
                then 'invalid_bank_details' end,
           case when b.available_minor < greatest(p_minimum_minor, 1) then 'below_minimum' end
         ], null)
  from private.seller_balances(p_cutoff, p_hold_days) b
  join public.sellers s on s.id = b.seller_id
  join public.seller_private sp on sp.seller_id = s.id
  where b.payable_minor <> 0 or b.in_transit_minor <> 0 or b.available_minor <> 0;
$$;

-- Replaces the version in people_payouts. The one change: `current.approved`
-- says whether finance approved the account on file, so the seller's screen
-- can ask for an account that was never approved to be sent for approval.
create or replace function public.seller_payout_details(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('finance', 'support')) then
    perform private.fail('forbidden');
  end if;
  if not exists (select 1 from public.seller_private sp where sp.seller_id = p_seller_id) then
    perform private.fail('seller_not_found');
  end if;
  return jsonb_build_object(
    'can_request', private.is_seller_admin(p_seller_id),
    'current', (
      select jsonb_build_object(
        'iban_masked', private.mask_iban(sp.payout_iban),
        'holder_name', sp.payout_holder_name,
        'sinpe_number', sp.sinpe_movil_number,
        -- Whether finance approved the account on file. One entered before
        -- approvals existed is not, and is not paid until it is.
        'approved', sp.payout_iban is not null and sp.payout_approved_at is not null)
      from public.seller_private sp where sp.seller_id = p_seller_id),
    'request', (
      select jsonb_build_object(
        'id', r.id, 'status', r.status,
        'iban_masked', private.mask_iban(r.payout_iban),
        'holder_name', r.payout_holder_name,
        'sinpe_number', r.sinpe_movil_number,
        'requested_at', r.requested_at,
        'requested_by_name', (select p.full_name from public.profiles p where p.id = r.requested_by),
        'decided_at', r.decided_at,
        'note', r.decision_note)
      from public.payout_detail_requests r
      where r.seller_id = p_seller_id and r.status <> 'replaced'
      order by r.requested_at desc limit 1)
  );
end;
$$;

-- Replaces the version in people_payouts. The one change: what stands in the
-- way of a payout follows the same rule as finance's run (payout_candidates):
-- an account finance never approved counts as no approved account.
create or replace function public.seller_payouts(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := private.cr_local(now())::date;
  v_hold integer := private.payout_hold_days();
  v_minimum bigint := private.payout_minimum_minor();
  b record;
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('finance')) then
    perform private.fail('forbidden');
  end if;
  select * into b from private.seller_balances(v_today, v_hold, p_seller_id);
  if not found then
    perform private.fail('seller_not_found');
  end if;

  return jsonb_build_object(
    'as_of', v_today, 'hold_days', v_hold, 'minimum_minor', v_minimum,
    'payable_minor', b.payable_minor, 'available_minor', b.available_minor,
    'pending_minor', b.pending_minor, 'in_transit_minor', b.in_transit_minor,
    -- Sales delivered up to this day are out of their hold today.
    'delivered_through', v_today - v_hold,
    -- The pending part, by the day it becomes available …
    'releases', coalesce((
      select jsonb_agg(jsonb_build_object('on', x.release_on, 'amount_minor', x.amount)
                       order by x.release_on)
      from (
        select private.cr_local(y.settled_at)::date + v_hold as release_on,
               -sum(y.amount_minor)::bigint as amount
        from (
          select e.amount_minor, private.seller_order_settled_at(t.order_id, a.seller_id) as settled_at
          from public.ledger_accounts a
          join public.ledger_entries e on e.account_id = a.id
          join public.ledger_transactions t on t.id = e.transaction_id
          where a.seller_id = p_seller_id and t.order_id is not null
        ) y
        where y.settled_at is not null
          and private.cr_local(y.settled_at)::date + v_hold > v_today
        group by 1
        having sum(y.amount_minor) <> 0
      ) x), '[]'::jsonb),
    -- … and the part that has no day yet because the goods are still on their way.
    'awaiting_delivery_minor', coalesce((
      select -sum(e.amount_minor)::bigint
      from public.ledger_accounts a
      join public.ledger_entries e on e.account_id = a.id
      join public.ledger_transactions t on t.id = e.transaction_id
      where a.seller_id = p_seller_id and t.order_id is not null
        and private.seller_order_settled_at(t.order_id, a.seller_id) is null), 0),
    'blocked_by', (
      select to_jsonb(array_remove(array[
        case when s.status in ('suspended', 'pending') then 'shop_suspended' end,
        case when sp.payout_iban is null or sp.payout_holder_name is null
               or sp.payout_approved_at is null then 'no_bank_details' end,
        case when sp.payout_iban is not null and not private.is_valid_cr_iban(sp.payout_iban)
             then 'invalid_bank_details' end,
        case when b.available_minor < greatest(v_minimum, 1) then 'below_minimum' end
      ], null))
      from public.sellers s join public.seller_private sp on sp.seller_id = s.id
      where s.id = p_seller_id),
    'account', (
      select jsonb_build_object(
        'iban_masked', private.mask_iban(sp.payout_iban), 'holder_name', sp.payout_holder_name)
      from public.seller_private sp where sp.seller_id = p_seller_id),
    'payouts', coalesce((
      select jsonb_agg(x.item order by x.created_at desc)
      from (
        select p.created_at, jsonb_build_object(
          'id', p.id, 'reference', p.reference, 'status', p.status,
          'amount_minor', p.amount_minor, 'cutoff_on', r.cutoff_on,
          'scheduled_at', p.created_at, 'paid_at', p.paid_at,
          'bank_reference', p.bank_reference, 'failed_at', p.failed_at,
          'failure_reason', p.failure_reason,
          'iban_masked', private.mask_iban(p.payout_iban)) as item
        from public.payouts p
        left join public.payout_runs r on r.id = p.run_id
        where p.seller_id = p_seller_id
        order by p.created_at desc
        limit 100
      ) x), '[]'::jsonb)
  );
end;
$$;

-- ═══ 12b. A closed shop only reads ══════════════════════════════════════════

-- Replaces the version in api_backoffice. The one change: a closed shop adds
-- no pickup point (shop_closed).
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
    where d.postal_code = p_postal_code and z.active
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

-- Replaces the version in inventory. The one change: a closed shop counts no
-- stock (shop_closed). A suspended shop still counts what it holds.
create or replace function public.seller_set_stock(
  p_warehouse_id uuid,
  p_sku_id uuid,
  p_quantity integer
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
  v_current integer;
  v_reserved integer;
begin
  select w.seller_id into v_seller
  from public.warehouses w
  where w.id = p_warehouse_id and w.kind = 'seller' and w.active;

  if v_seller is null or not private.is_seller_member(v_seller) then
    perform private.fail('forbidden');
  end if;
  perform private.require_open_shop(v_seller);
  if p_quantity < 0 or p_quantity > 100000 then
    perform private.fail('invalid_quantity');
  end if;
  if not exists (
    select 1 from public.offers o where o.sku_id = p_sku_id and o.seller_id = v_seller
  ) then
    perform private.fail('offer_not_found');
  end if;

  select l.on_hand, l.reserved into v_current, v_reserved
  from public.stock_levels l
  where l.warehouse_id = p_warehouse_id and l.sku_id = p_sku_id and l.seller_id = v_seller
  for update;

  if p_quantity < coalesce(v_reserved, 0) then
    -- Units already promised to shoppers cannot be counted away.
    perform private.fail('below_reserved', coalesce(v_reserved, 0)::text);
  end if;

  perform private.apply_stock_change(
    p_warehouse_id, p_sku_id, v_seller, p_quantity - coalesce(v_current, 0), 'adjust',
    null, 'seller_count', null, 'Conteo del vendedor');
end;
$$;

-- ═══ 12c. A suspended shop's listings leave the shop (DTA-15) ══════════════
--
-- Search stopped listing a suspended shop's products, but its product pages
-- were still served to a visitor who had the address, by get_product and by
-- the check the shop's router makes (shop_path_exists). A product page is now
-- open to a visitor while the shop that created the listing is active, or
-- while another active shop sells it (a shared page stays for its other
-- sellers). Staff, and the shop itself, see it as before. get_product keeps
-- its body (20261121082800_lockdown.sql) behind a gate, as the search
-- functions above do, so its visibility rules for staff and the shop's own
-- drafts stay in one place.

create or replace function private.product_page_open(p_product_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product_id
      and (p.created_by_seller_id is null
           or private.seller_is_active(p.created_by_seller_id)
           or private.is_staff()
           or p.created_by_seller_id in (select private.my_seller_ids())
           or exists (select 1 from public.offers o
                      join public.skus k on k.id = o.sku_id
                      join public.sellers s on s.id = o.seller_id
                      where k.product_id = p.id and o.status = 'active' and s.status = 'active')));
$$;

alter function public.get_product(text, text) rename to get_product_page;
alter function public.get_product_page(text, text) set schema private;
revoke all on function private.get_product_page(text, text) from public, anon, authenticated;

create function public.get_product(p_slug text, p_postal_code text default null) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select private.get_product_page(p.slug, p_postal_code)
  from public.products p
  where p.slug = p_slug and private.product_page_open(p.id);
$$;

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
      select 1 from public.categories c where c.slug = p_slug and c.active)
    else false
  end;
$$;

revoke all on function private.product_page_open(uuid) from public, anon, authenticated;
revoke all on function public.get_product(text, text) from public;
grant execute on function public.get_product(text, text) to anon, authenticated;

-- ═══ 13. Grants ════════════════════════════════════════════════════════════

revoke all on function
  private.limit_value(text, integer),
  private.clean_text(text),
  private.is_email(text),
  private.require_trading_shop(uuid),
  private.require_open_shop(uuid),
  private.release_driver_routes(uuid, text),
  private.drivers_release_on_leave(),
  private.is_valid_identification(public.identification_type, text),
  private.shop_name_problem(text, uuid),
  private.check_shop_name(text, uuid),
  private.fits_warehouse(integer, numeric, numeric, numeric),
  private.offers_warehouse_size(),
  private.skus_warehouse_size(),
  private.listings_in_review(uuid, uuid),
  private.products_need_trading_shop(),
  private.listing_problem(text, text, text[], integer, numeric, numeric, numeric),
  private.is_public_target(text, uuid),
  private.invitation_open(public.seller_invitations),
  private.invitation_valid(public.seller_invitations),
  private.invitation_for_me(public.seller_invitations),
  private.revoke_invitations_sent_by(uuid, uuid),
  private.may_decide_shop_change(text),
  private.shop_details(uuid, text),
  private.shop_change_item(public.seller_change_requests),
  private.policy_version(text),
  private.consents_append_only()
from public;

revoke all on function
  public.ops_released_routes(integer),
  public.ops_seller_id_clashes(),
  public.seller_team(uuid),
  public.seller_invite_member(uuid, text, public.seller_member_role),
  public.my_invitations(),
  public.seller_answer_invitation(uuid, boolean),
  public.seller_revoke_invitation(uuid),
  public.seller_remove_member(uuid, uuid),
  public.seller_set_member_role(uuid, uuid, public.seller_member_role),
  public.seller_request_shop_change(uuid, text, text, text, text, text, text, text, text),
  public.seller_shop_changes(uuid),
  public.seller_withdraw_shop_change(uuid),
  public.ops_shop_change_requests(text),
  public.ops_decide_shop_change(uuid, boolean, text),
  public.withdraw_consent(text),
  public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer),
  public.suggest_products(text, integer),
  public.driver_today()
from public;

-- The search bodies run only through their wrappers.
revoke all on function
  private.bounded_search_text(text),
  private.search_products_unbounded(text, text, bigint, bigint, boolean, boolean, text, integer, integer),
  private.suggest_products_unbounded(text, integer)
from public, anon, authenticated;

grant execute on function
  public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer),
  public.suggest_products(text, integer)
to anon, authenticated;

grant execute on function
  public.ops_released_routes(integer),
  public.ops_seller_id_clashes(),
  public.seller_team(uuid),
  public.seller_invite_member(uuid, text, public.seller_member_role),
  public.my_invitations(),
  public.seller_answer_invitation(uuid, boolean),
  public.seller_revoke_invitation(uuid),
  public.seller_remove_member(uuid, uuid),
  public.seller_set_member_role(uuid, uuid, public.seller_member_role),
  public.seller_request_shop_change(uuid, text, text, text, text, text, text, text, text),
  public.seller_shop_changes(uuid),
  public.seller_withdraw_shop_change(uuid),
  public.ops_shop_change_requests(text),
  public.ops_decide_shop_change(uuid, boolean, text),
  public.withdraw_consent(text),
  public.driver_today()
to authenticated;
