-- People management and seller payouts.
--
--   People:   administrators manage who is staff; operations manage drivers and
--             who works in each warehouse. Until now that was done with SQL.
--   Bank:     a seller asks to change where they are paid; finance approves it
--             after checking with the seller by phone. A seller never writes the
--             payout account directly: changing it is the classic fraud.
--   Payouts:  what a seller is owed is split into available, pending and in
--             transit; finance previews a cut-off, creates a run, sends the
--             transfers from the bank and records each one here.
--
-- Same rules as every other function: SECURITY DEFINER with an empty
-- search_path, an explicit permission check first, errors as short codes.

-- ═══ Settings ══════════════════════════════════════════════════════════════

insert into public.app_settings (key, value, description) values
  ('payout_hold_days', '10',
   'Days after an order is delivered before what it earned can be paid to the seller. Covers the period in which the shopper may still return it.'),
  ('payout_minimum_minor', '500000',
   'Smallest amount (minor units) worth a bank transfer to a seller. ₡5 000. Smaller balances wait for a later run.');

-- The two rules above as numbers. A setting that is missing or is not a number
-- falls back to its documented default rather than stopping every payout screen.
create or replace function private.payout_hold_days() returns integer
language sql stable security definer
set search_path = ''
as $$
  select case
    when jsonb_typeof(private.setting('payout_hold_days')) = 'number'
      then least(greatest(floor((private.setting('payout_hold_days') #>> '{}')::numeric), 0), 90)::integer
    else 10
  end;
$$;

create or replace function private.payout_minimum_minor() returns bigint
language sql stable security definer
set search_path = ''
as $$
  select case
    when jsonb_typeof(private.setting('payout_minimum_minor')) = 'number'
      then greatest(floor((private.setting('payout_minimum_minor') #>> '{}')::numeric), 0)::bigint
    else 500000
  end;
$$;

-- ═══ Shared helpers ════════════════════════════════════════════════════════

-- The account behind an e-mail address, or null. People are added to roles by
-- the e-mail they sign in with; nothing here ever creates an account.
create or replace function private.account_by_email(p_email text) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at limit 1;
$$;

-- A Costa Rican IBAN is "CR" followed by twenty digits, of which the first two
-- are check digits (ISO 13616). The check: move the first four characters to
-- the end, write the letters as numbers (C = 12, R = 27), and the whole number
-- must leave remainder 1 when divided by 97. Check digits run from 02 to 98;
-- 00, 01 and 99 would pass the division for some numbers but are never issued.
-- Mirrored in packages/core/src/cr/iban.ts; both sides are tested on the same list.
create or replace function private.is_valid_cr_iban(p_iban text) returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_iban ~ '^CR[0-9]{20}$' and substr(p_iban, 3, 2) between '02' and '98'
      then (substr(p_iban, 5) || '1227' || substr(p_iban, 3, 2))::numeric % 97 = 1
    else false
  end;
$$;

-- Enough of an account number to recognise it; never the whole thing.
create or replace function private.mask_iban(p_iban text) returns text
language sql immutable
set search_path = ''
as $$
  select case when p_iban is null then null else 'CR•• •••• •••• •••• ' || right(p_iban, 4) end;
$$;

-- ═══ Audit trail: who, by name, and never a whole account number ═══════════

-- Replaces the first version. Any audited row that carries a payout account
-- keeps only its last four digits in the trail: enough to see that the account
-- changed, not enough to copy it. (Before, the number was dropped from
-- seller_private rows only, so a change of account left no visible trace.)
create or replace function private.audit() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_key text;
begin
  if v_old ? 'payout_iban' then
    v_old := (v_old - 'payout_iban')
      || jsonb_build_object('payout_iban_masked', private.mask_iban(v_old ->> 'payout_iban'));
  end if;
  if v_new ? 'payout_iban' then
    v_new := (v_new - 'payout_iban')
      || jsonb_build_object('payout_iban_masked', private.mask_iban(v_new ->> 'payout_iban'));
  end if;
  v_key := coalesce(
    (coalesce(v_new, v_old) ->> 'id'),
    (coalesce(v_new, v_old) ->> 'user_id'),
    (coalesce(v_new, v_old) ->> 'seller_id'),
    (coalesce(v_new, v_old) ->> 'key'),
    (coalesce(v_new, v_old) ->> 'version')
  );
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), tg_op, tg_table_name, v_key, v_old, v_new);
  return null;
end;
$$;

-- A driver's record can now be edited, so every edit is recorded, not only a
-- change of status: a licence date moved forward must not be a silent change.
drop trigger audit_drivers on public.drivers;
create trigger audit_drivers after insert or update or delete on public.drivers
  for each row execute function private.audit();

-- The audit screen showed the first characters of an id. It now gets the name
-- of who did it and of who or what it was done to.
drop function public.audit_entries(text, integer);
create function public.audit_entries(
  p_table text default null,
  p_limit integer default 100
) returns table (
  id bigint, at timestamptz, actor_id uuid, actor_name text, action text, table_name text,
  row_key text, subject text, old_row jsonb, new_row jsonb
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  return query
    select a.id, a.at, a.actor_id,
           coalesce(ap.full_name, au.email::text),
           a.action, a.table_name, a.row_key,
           -- The person a row is about, or else the shop.
           coalesce(sp.full_name, su.email::text, ss.trade_name),
           a.old_row, a.new_row
    from (
      select l.*, coalesce(l.new_row, l.old_row) as r
      from private.audit_log l
      where p_table is null or l.table_name = p_table
      order by l.id desc
      limit least(greatest(p_limit, 1), 500)
    ) a
    left join public.profiles ap on ap.id = a.actor_id
    left join auth.users au on au.id = a.actor_id
    left join public.profiles sp
      on a.table_name in ('staff_members', 'warehouse_staff', 'seller_members', 'drivers')
     and sp.id = (a.r ->> 'user_id')::uuid
    left join auth.users su
      on a.table_name in ('staff_members', 'warehouse_staff', 'seller_members', 'drivers')
     and su.id = (a.r ->> 'user_id')::uuid
    left join public.sellers ss
      on ss.id = case
        when a.table_name = 'sellers' then (a.r ->> 'id')::uuid
        when a.table_name in ('seller_private', 'payouts') then (a.r ->> 'seller_id')::uuid
      end
    order by a.id desc;
end;
$$;

-- ═══ Staff ═════════════════════════════════════════════════════════════════

-- The platform must always have someone who can manage it. Checked on the
-- table itself, so the rule holds for every way a staff row can change: the
-- function below, a direct write by an administrator, or an account deletion.
create or replace function private.keep_one_admin() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- One at a time, so two administrators cannot remove each other at the same moment.
  perform pg_advisory_xact_lock(hashtext('yuntera.staff_members'));
  if not exists (select 1 from public.staff_members s where s.role = 'admin' and s.active) then
    perform private.fail('last_admin');
  end if;
  return null;
end;
$$;

create trigger staff_members_keep_one_admin after update or delete on public.staff_members
  for each row when (old.role = 'admin' and old.active)
  execute function private.keep_one_admin();

-- Everyone who has, or has had, a staff role.
create or replace function public.ops_staff() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id, 'full_name', p.full_name, 'email', u.email, 'role', s.role,
      'active', s.active, 'since', s.created_at,
      'is_you', s.user_id = (select auth.uid())
    ) order by s.active desc, p.full_name nulls last, u.email)
    from public.staff_members s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
  ), '[]'::jsonb);
end;
$$;

-- Gives an existing account a staff role, changes it, or switches it off.
-- Roles are read from this table on every request, so the change applies to
-- the person's very next click; there is no token to wait out.
create or replace function public.ops_set_staff(
  p_email text,
  p_role public.staff_role,
  p_active boolean default true
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_row public.staff_members%rowtype;
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  v_user := private.account_by_email(p_email);
  if v_user is null then
    -- The person must create their own account first: we never make one for them.
    perform private.fail('account_not_found');
  end if;

  select * into v_row from public.staff_members where user_id = v_user for update;
  if not found then
    if p_role is null or not coalesce(p_active, true) then
      perform private.fail('staff_not_found');
    end if;
    insert into public.staff_members (user_id, role, active) values (v_user, p_role, true);
  elsif v_row.role is distinct from coalesce(p_role, v_row.role)
     or v_row.active is distinct from coalesce(p_active, v_row.active) then
    -- The table's trigger refuses a change that would leave no active administrator.
    update public.staff_members
    set role = coalesce(p_role, role), active = coalesce(p_active, active)
    where user_id = v_user;
  end if;
end;
$$;

-- ═══ Drivers ═══════════════════════════════════════════════════════════════

-- Creates the driver record of an existing account (by e-mail) or corrects an
-- existing record (by id). A new driver starts `pending`; ops_set_driver_status
-- activates them once the documents have been seen. The same format rules are
-- checked in the console's form, where they can be explained field by field.
create or replace function public.ops_save_driver(
  p_full_name text,
  p_phone text,
  p_id_type public.identification_type,
  p_id_number text,
  p_vehicle_type public.vehicle_type,
  p_plate text,
  p_capacity_kg numeric,
  p_license_class text,
  p_license_expires_on date,
  p_inspection_expires_on date,
  p_insurance_expires_on date,
  p_email text default null,
  p_driver_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_plate text := nullif(upper(regexp_replace(coalesce(p_plate, ''), '\s', '', 'g')), '');
  v_class text := nullif(upper(trim(coalesce(p_license_class, ''))), '');
  v_today date := private.cr_local(now())::date;
  v_motor boolean := p_vehicle_type is distinct from 'bicycle';
  v_user uuid;
  v_id uuid;
  v_day date;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;

  if char_length(v_name) not between 5 and 120 then
    perform private.fail('invalid_driver_name');
  end if;
  -- Drivers are reached on a mobile line: +506 and eight digits starting 5 to 8.
  if p_phone is null or p_phone !~ '^\+506[5-8][0-9]{7}$' then
    perform private.fail('invalid_driver_phone');
  end if;
  -- A driver is a person: a cédula (9 digits) or a DIMEX (11 or 12).
  if p_id_number is null or not (
       (p_id_type = 'fisica' and p_id_number ~ '^[1-9][0-9]{8}$')
       or (p_id_type = 'dimex' and p_id_number ~ '^[1-9][0-9]{10,11}$')) then
    perform private.fail('invalid_driver_identification');
  end if;
  if p_vehicle_type is null or p_capacity_kg is null or p_capacity_kg <= 0 or p_capacity_kg > 5000
     or (v_motor and (v_plate is null or v_plate !~ '^([A-Z]{1,3}-?)?[0-9]{3,6}$')) then
    perform private.fail('invalid_driver_vehicle');
  end if;
  -- A motor vehicle needs a licence, the technical inspection and insurance, each
  -- with the day it runs out. A bicycle needs none; what is given is still checked.
  if v_motor and (v_class is null or p_license_expires_on is null
                  or p_inspection_expires_on is null or p_insurance_expires_on is null) then
    perform private.fail('invalid_driver_documents');
  end if;
  if v_class is not null and v_class !~ '^[A-E][1-4]$' then
    perform private.fail('invalid_driver_documents');
  end if;
  foreach v_day in array array[p_license_expires_on, p_inspection_expires_on, p_insurance_expires_on] loop
    if v_day is not null and (v_day < date '2000-01-01' or v_day > v_today + 3653) then
      perform private.fail('invalid_driver_documents');
    end if;
  end loop;

  if p_driver_id is null then
    v_user := private.account_by_email(p_email);
    if v_user is null then
      perform private.fail('account_not_found');
    end if;
    if exists (select 1 from public.drivers d where d.user_id = v_user) then
      perform private.fail('driver_already_exists');
    end if;
    insert into public.drivers
      (user_id, status, full_name, phone, id_type, id_number, vehicle_type, plate, capacity_kg,
       license_class, license_expires_on, inspection_expires_on, insurance_expires_on)
    values
      (v_user, 'pending', v_name, p_phone, p_id_type, p_id_number, p_vehicle_type,
       case when v_motor then v_plate end, p_capacity_kg, v_class, p_license_expires_on,
       p_inspection_expires_on, p_insurance_expires_on)
    returning id into v_id;
  else
    -- The account and the status are not changed here.
    update public.drivers
    set full_name = v_name, phone = p_phone, id_type = p_id_type, id_number = p_id_number,
        vehicle_type = p_vehicle_type, plate = case when v_motor then v_plate end,
        capacity_kg = p_capacity_kg, license_class = v_class,
        license_expires_on = p_license_expires_on,
        inspection_expires_on = p_inspection_expires_on,
        insurance_expires_on = p_insurance_expires_on
    where id = p_driver_id
    returning id into v_id;
    if v_id is null then
      perform private.fail('driver_not_found');
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    -- Two people saved the same new driver at once.
    perform private.fail('driver_already_exists');
end;
$$;

-- Replaces the first version: the list now carries everything the edit form
-- shows (e-mail, identification, licence class).
create or replace function public.ops_drivers() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'full_name', d.full_name, 'phone', d.phone, 'status', d.status,
      'email', u.email, 'id_type', d.id_type, 'id_number', d.id_number,
      'vehicle_type', d.vehicle_type, 'plate', d.plate, 'capacity_kg', d.capacity_kg,
      'license_class', d.license_class,
      'license_expires_on', d.license_expires_on,
      'inspection_expires_on', d.inspection_expires_on,
      'insurance_expires_on', d.insurance_expires_on,
      -- True when a document the operation must keep current has lapsed.
      'documents_expired', coalesce(
        least(d.license_expires_on, d.inspection_expires_on, d.insurance_expires_on)
          < private.cr_local(now())::date, false)
    ) order by d.status, d.full_name)
    from public.drivers d
    join auth.users u on u.id = d.user_id
  ), '[]'::jsonb);
end;
$$;

-- ═══ Warehouse workers ═════════════════════════════════════════════════════

-- Yuntera's own warehouses, each with the people who work there. (A seller's
-- own location is run by the seller's team, not by warehouse workers.)
create or replace function public.ops_warehouse_staff() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'code', w.code, 'name', w.name, 'address', w.address, 'active', w.active,
      'staff', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', ws.user_id, 'full_name', p.full_name, 'email', u.email, 'role', ws.role,
          'since', ws.created_at
        ) order by (ws.role = 'lead') desc, p.full_name nulls last, u.email)
        from public.warehouse_staff ws
        join auth.users u on u.id = ws.user_id
        left join public.profiles p on p.id = ws.user_id
        where ws.warehouse_id = w.id), '[]'::jsonb)
    ) order by w.code)
    from public.warehouses w
    where w.kind = 'platform'
  ), '[]'::jsonb);
end;
$$;

-- Adds a worker to a warehouse, changes their role, or (role null) removes them.
create or replace function public.ops_set_warehouse_staff(
  p_warehouse_id uuid,
  p_email text,
  p_role text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if not exists (
    select 1 from public.warehouses w where w.id = p_warehouse_id and w.kind = 'platform'
  ) then
    perform private.fail('warehouse_not_found');
  end if;
  if p_role is not null and p_role not in ('associate', 'lead') then
    perform private.fail('invalid_warehouse_role');
  end if;
  v_user := private.account_by_email(p_email);
  if v_user is null then
    perform private.fail('account_not_found');
  end if;

  if p_role is null then
    delete from public.warehouse_staff where warehouse_id = p_warehouse_id and user_id = v_user;
    if not found then
      perform private.fail('warehouse_staff_not_found');
    end if;
  else
    insert into public.warehouse_staff (warehouse_id, user_id, role)
    values (p_warehouse_id, v_user, p_role)
    on conflict (warehouse_id, user_id) do update set role = excluded.role
      where public.warehouse_staff.role <> excluded.role;
  end if;
end;
$$;

-- ═══ Sellers' bank details: a request that finance approves ════════════════

-- From here on the payout account changes in one place only: when finance
-- approves a request. The seller's direct write to these columns is withdrawn,
-- and the full account number is no longer readable straight from the table —
-- sellers see it masked, finance sees it in full through the functions below.
revoke update (payout_iban, payout_holder_name, sinpe_movil_number)
  on public.seller_private from authenticated;
revoke select on public.seller_private from authenticated;
grant select (seller_id, legal_name, id_type, id_number, tax_regime, economic_activity_code,
              contact_email, contact_phone, fiscal_address, postal_code, payout_holder_name,
              sinpe_movil_number, kyc_status, kyc_notes, hacienda_verified_at, created_at,
              updated_at)
  on public.seller_private to authenticated;

create table public.payout_detail_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  -- What the seller asks for. The whole desired state: an empty SINPE Móvil
  -- number means "remove it".
  payout_iban text not null check (payout_iban ~ '^CR[0-9]{20}$'),
  payout_holder_name text not null check (char_length(payout_holder_name) between 3 and 160),
  sinpe_movil_number text check (sinpe_movil_number ~ '^\+506[5-8][0-9]{7}$'),
  -- `replaced` = the seller sent a newer request before this one was decided.
  -- Those rows are kept: every account number ever asked for stays on record.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'replaced')),
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  -- Written for the seller, who reads it when a request is rejected.
  decision_note text check (char_length(decision_note) <= 1000),
  constraint payout_detail_requests_closed check ((status = 'pending') = (decided_at is null))
);

-- One open request per shop.
create unique index payout_detail_requests_open_idx
  on public.payout_detail_requests (seller_id) where status = 'pending';
create index payout_detail_requests_seller_idx
  on public.payout_detail_requests (seller_id, requested_at desc);

-- Reached only through the functions below: no direct access for any API role.
alter table public.payout_detail_requests enable row level security;
revoke all on public.payout_detail_requests from anon, authenticated;

-- A shop's owner or administrator asks for a new payout account. Nothing
-- changes until finance approves; a newer request replaces one still waiting.
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
  if v_current.payout_iban = v_iban and v_current.payout_holder_name = v_holder
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

-- What a seller sees about their payout account: the current one, masked, and
-- their latest request with its state. Never a whole account number.
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
        'sinpe_number', sp.sinpe_movil_number)
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

-- Finance's queue. A request waiting for a decision shows the requested
-- account in full, because finance reads it back to the seller on the phone —
-- calling the number already on file, never one that came with the request.
create or replace function public.ops_payout_detail_requests(p_status text default 'pending')
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.pending desc, x.sort_key)
    from (
      select
        (r.status = 'pending') as pending,
        -- Oldest first while waiting; newest first once decided.
        case when r.status = 'pending' then extract(epoch from r.requested_at)
             else -extract(epoch from r.decided_at) end as sort_key,
        jsonb_build_object(
          'id', r.id, 'status', r.status, 'requested_at', r.requested_at,
          'requested_by_name', rp.full_name, 'requested_by_email', ru.email,
          'seller', jsonb_build_object(
            'id', s.id, 'trade_name', s.trade_name, 'status', s.status,
            'legal_name', sp.legal_name, 'id_type', sp.id_type, 'id_number', sp.id_number,
            'contact_phone', sp.contact_phone, 'contact_email', sp.contact_email,
            'since', s.created_at),
          'current', jsonb_build_object(
            'iban_masked', private.mask_iban(sp.payout_iban),
            'holder_name', sp.payout_holder_name, 'sinpe_number', sp.sinpe_movil_number),
          'requested', jsonb_build_object(
            'iban', case when r.status = 'pending' then r.payout_iban end,
            'iban_masked', private.mask_iban(r.payout_iban),
            'holder_name', r.payout_holder_name, 'sinpe_number', r.sinpe_movil_number),
          -- Things worth a second look before approving.
          'signals', jsonb_build_object(
            'first_account', sp.payout_iban is null,
            'holder_differs', private.fold(r.payout_holder_name) <> private.fold(sp.legal_name),
            'used_by_other_shop', exists (
              select 1 from public.seller_private o
              where o.payout_iban = r.payout_iban and o.seller_id <> r.seller_id)),
          'decided_at', r.decided_at,
          'decided_by_name', (select p.full_name from public.profiles p where p.id = r.decided_by),
          'note', r.decision_note
        ) as item
      from public.payout_detail_requests r
      join public.sellers s on s.id = r.seller_id
      join public.seller_private sp on sp.seller_id = r.seller_id
      join auth.users ru on ru.id = r.requested_by
      left join public.profiles rp on rp.id = r.requested_by
      where r.status <> 'replaced' and (p_status is null or r.status = p_status)
      order by (r.status = 'pending') desc, r.requested_at desc
      limit 100
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Finance approves or rejects a request. Approval is the only thing that ever
-- writes a seller's payout account; the audit trigger on seller_private records
-- it with the name of who approved. A rejection must say why: the seller reads it.
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
  -- Nobody approves a change they asked for themselves.
  if v_request.requested_by = (select auth.uid()) then
    perform private.fail('cannot_decide_own_request');
  end if;
  if not coalesce(p_approve, false) and coalesce(char_length(v_note), 0) < 10 then
    perform private.fail('reason_required');
  end if;

  if p_approve then
    update public.seller_private
    set payout_iban = v_request.payout_iban,
        payout_holder_name = v_request.payout_holder_name,
        sinpe_movil_number = v_request.sinpe_movil_number
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

-- ═══ Payouts ═══════════════════════════════════════════════════════════════

-- Where the money leaves from when a seller is paid.
insert into public.ledger_accounts (code, name, kind) values
  ('bank_operating', 'Cuenta bancaria operativa', 'asset');

-- A run: everything that was available to pay at a cut-off date, sent to the
-- bank together. The rules in force when it was created are kept with it.
create table public.payout_runs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  cutoff_on date not null unique,
  hold_days integer not null check (hold_days >= 0),
  minimum_minor bigint not null check (minimum_minor >= 0),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.payout_runs enable row level security;
revoke all on public.payout_runs from anon, authenticated;

-- A payout now belongs to a run and settles what was available at its cut-off,
-- so it has no period of its own. The amount and the destination are frozen
-- when it is scheduled: the list sent to the bank is the list that is recorded.
alter table public.payouts
  alter column period_start drop not null,
  alter column period_end drop not null,
  add column run_id uuid references public.payout_runs (id),
  -- The text finance puts in the transfer's description; the seller sees it too.
  add column reference text unique,
  add column payout_iban text check (payout_iban ~ '^CR[0-9]{20}$'),
  add column payout_holder_name text,
  add column ledger_transaction_id uuid references public.ledger_transactions (id),
  add column paid_by uuid references auth.users (id),
  add column failed_at timestamptz,
  add column failed_by uuid references auth.users (id),
  add column failure_reason text check (char_length(failure_reason) <= 500);

create index payouts_seller_idx on public.payouts (seller_id, created_at desc);
create index payouts_scheduled_idx on public.payouts (seller_id) where status = 'scheduled';
-- A seller has one live payout per run; a failed one may be tried again.
create unique index payouts_one_live_per_run_idx
  on public.payouts (run_id, seller_id) where status <> 'failed';
-- One bank transfer settles one payout.
create unique index payouts_bank_reference_idx
  on public.payouts (bank_reference) where bank_reference is not null;

-- Payouts change only inside the functions below, which keep them in step with
-- the ledger, and they now hold a full account number: no API role reads or
-- writes the table directly any more. Sellers read theirs through seller_payouts.
revoke all on public.payouts from anon, authenticated;
drop policy "seller payouts, or finance" on public.payouts;
drop policy "finance manages payouts" on public.payouts;

-- What the platform owes each seller, split three ways. Nothing here is stored:
--
--   payable     the balance of the seller's account in the ledger
--   pending     the part earned on orders that are not delivered yet, or were
--               delivered fewer than `p_hold_days` days before `p_as_of`
--   in transit  payouts scheduled and not yet marked paid
--   available   the rest: payable − pending − in transit
--
-- So the three parts add up to the ledger balance by construction. Refunds and
-- returns carry their order's id, so they reduce the same part as the sale did;
-- paid payouts are already out of the ledger balance. The hold counts from the
-- day the whole order was delivered, in Costa Rican time.
create or replace function private.seller_balances(
  p_as_of date,
  p_hold_days integer,
  p_seller_id uuid default null
) returns table (
  seller_id uuid, payable_minor bigint, pending_minor bigint, in_transit_minor bigint,
  available_minor bigint
)
language sql stable security definer
set search_path = ''
as $$
  with ledger as (
    select a.seller_id,
           coalesce(-sum(e.amount_minor), 0)::bigint as payable,
           coalesce(-sum(e.amount_minor) filter (
             where o.id is not null
               and (o.delivered_at is null
                    or private.cr_local(o.delivered_at)::date + p_hold_days > p_as_of)
           ), 0)::bigint as pending
    from public.ledger_accounts a
    join public.ledger_entries e on e.account_id = a.id
    join public.ledger_transactions t on t.id = e.transaction_id
    left join public.orders o on o.id = t.order_id
    where a.seller_id is not null and (p_seller_id is null or a.seller_id = p_seller_id)
    group by a.seller_id
  ), scheduled as (
    select p.seller_id, sum(p.amount_minor)::bigint as in_transit
    from public.payouts p
    where p.status = 'scheduled' and (p_seller_id is null or p.seller_id = p_seller_id)
    group by p.seller_id
  )
  select s.id,
         coalesce(l.payable, 0),
         coalesce(l.pending, 0),
         coalesce(sc.in_transit, 0),
         coalesce(l.payable, 0) - coalesce(l.pending, 0) - coalesce(sc.in_transit, 0)
  from public.sellers s
  left join ledger l on l.seller_id = s.id
  left join scheduled sc on sc.seller_id = s.id
  where p_seller_id is null or s.id = p_seller_id;
$$;

-- Every seller with money in play at a cut-off, and what stands between them
-- and being paid. The preview and the run both read this, so they cannot disagree.
--   shop_suspended   the shop is suspended or not verified; a closed shop is
--                    still paid what it is owed
--   no_bank_details  no payout account has been approved
--   below_minimum    less is available than is worth a transfer (or nothing)
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
           case when sp.payout_iban is null or sp.payout_holder_name is null then 'no_bank_details' end,
           case when b.available_minor < greatest(p_minimum_minor, 1) then 'below_minimum' end
         ], null)
  from private.seller_balances(p_cutoff, p_hold_days) b
  join public.sellers s on s.id = b.seller_id
  join public.seller_private sp on sp.seller_id = s.id
  where b.payable_minor <> 0 or b.in_transit_minor <> 0 or b.available_minor <> 0;
$$;

-- What a run for this cut-off would pay, seller by seller, and why not when not.
create or replace function public.ops_payout_preview(p_cutoff date default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := private.cr_local(now())::date;
  v_cutoff date := coalesce(p_cutoff, v_today);
  v_run public.payout_runs%rowtype;
  v_hold integer;
  v_minimum bigint;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  -- A later cut-off would release money that is still inside its hold.
  if v_cutoff > v_today then
    perform private.fail('invalid_cutoff');
  end if;
  -- A run that already exists keeps the rules it was created with.
  select * into v_run from public.payout_runs where cutoff_on = v_cutoff;
  v_hold := coalesce(v_run.hold_days, private.payout_hold_days());
  v_minimum := coalesce(v_run.minimum_minor, private.payout_minimum_minor());

  return (
    select jsonb_build_object(
      'cutoff_on', v_cutoff, 'today', v_today, 'hold_days', v_hold, 'minimum_minor', v_minimum,
      -- Orders delivered up to this day are out of their hold at the cut-off.
      'delivered_through', v_cutoff - v_hold,
      'run', case when v_run.id is not null
                  then jsonb_build_object('id', v_run.id, 'code', v_run.code) end,
      'to_pay_count', count(*) filter (where cardinality(c.reasons) = 0),
      'to_pay_minor', coalesce(sum(c.available_minor) filter (where cardinality(c.reasons) = 0), 0),
      'sellers', coalesce(jsonb_agg(jsonb_build_object(
        'seller_id', c.seller_id, 'trade_name', c.trade_name, 'seller_status', c.seller_status,
        'payable_minor', c.payable_minor, 'available_minor', c.available_minor,
        'pending_minor', c.pending_minor, 'in_transit_minor', c.in_transit_minor,
        'iban_masked', private.mask_iban(c.payout_iban), 'holder_name', c.payout_holder_name,
        'will_pay', cardinality(c.reasons) = 0, 'reasons', to_jsonb(c.reasons),
        'details_request_pending', exists (
          select 1 from public.payout_detail_requests r
          where r.seller_id = c.seller_id and r.status = 'pending')
      ) order by (cardinality(c.reasons) = 0) desc, c.available_minor desc, c.trade_name), '[]'::jsonb)
    )
    from private.payout_candidates(v_cutoff, v_hold, v_minimum) c
  );
end;
$$;

-- Creates the run for a cut-off and schedules one payout per seller who can be
-- paid, with the amount and the destination frozen. Nothing reaches the ledger
-- until a payout is marked paid. Safe to call again for the same cut-off: a
-- seller already scheduled has nothing left available, so nothing is added —
-- except for a seller whose payout failed or who became payable since.
create or replace function public.ops_create_payout_run(p_cutoff date) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := private.cr_local(now())::date;
  v_run public.payout_runs%rowtype;
  v_is_new boolean;
  v_n integer;
  v_created integer := 0;
  v_total bigint := 0;
  v_payout uuid;
  c record;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if p_cutoff is null or p_cutoff > v_today then
    perform private.fail('invalid_cutoff');
  end if;
  -- One run is built at a time, so two people cannot schedule the same money twice.
  perform pg_advisory_xact_lock(hashtext('yuntera.payout_runs'));

  select * into v_run from public.payout_runs where cutoff_on = p_cutoff;
  v_is_new := not found;
  if v_is_new then
    insert into public.payout_runs (code, cutoff_on, hold_days, minimum_minor, created_by)
    values ('PV-' || to_char(p_cutoff, 'YYYYMMDD'), p_cutoff, private.payout_hold_days(),
            private.payout_minimum_minor(), (select auth.uid()))
    returning * into v_run;
  end if;
  select count(*) into v_n from public.payouts where run_id = v_run.id;

  for c in
    select * from private.payout_candidates(p_cutoff, v_run.hold_days, v_run.minimum_minor) pc
    where cardinality(pc.reasons) = 0
    order by pc.trade_name, pc.seller_id
  loop
    v_n := v_n + 1;
    insert into public.payouts
      (seller_id, run_id, amount_minor, status, reference, payout_iban, payout_holder_name)
    values
      (c.seller_id, v_run.id, c.available_minor, 'scheduled',
       'YUNTERA ' || v_run.code || '-' || lpad(v_n::text, 3, '0'),
       c.payout_iban, c.payout_holder_name)
    returning id into v_payout;
    v_created := v_created + 1;
    v_total := v_total + c.available_minor;
    perform private.emit('payout.scheduled', jsonb_build_object(
      'payout_id', v_payout, 'seller_id', c.seller_id, 'amount_minor', c.available_minor));
  end loop;

  -- A first call that would pay nobody leaves nothing behind.
  if v_is_new and v_created = 0 then
    perform private.fail('nothing_to_pay');
  end if;
  return jsonb_build_object(
    'run_id', v_run.id, 'code', v_run.code, 'created', v_created, 'total_minor', v_total);
end;
$$;

-- The runs, newest cut-off first, with how far each has got.
create or replace function public.ops_payout_runs() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.cutoff_on desc)
    from (
      select r.cutoff_on, jsonb_build_object(
        'id', r.id, 'code', r.code, 'cutoff_on', r.cutoff_on, 'created_at', r.created_at,
        'created_by_name', (select p.full_name from public.profiles p where p.id = r.created_by),
        'scheduled', count(p.id) filter (where p.status = 'scheduled'),
        'paid', count(p.id) filter (where p.status = 'paid'),
        'failed', count(p.id) filter (where p.status = 'failed'),
        'scheduled_minor', coalesce(sum(p.amount_minor) filter (where p.status = 'scheduled'), 0),
        'paid_minor', coalesce(sum(p.amount_minor) filter (where p.status = 'paid'), 0)
      ) as item
      from public.payout_runs r
      left join public.payouts p on p.run_id = r.id
      group by r.id
      order by r.cutoff_on desc
      limit 60
    ) x
  ), '[]'::jsonb);
end;
$$;

-- One run with its payouts. The ones still scheduled are the list for the
-- bank: account number in full, holder, amount and the text for the description.
create or replace function public.ops_payout_run(p_run_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_run public.payout_runs%rowtype;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  select * into v_run from public.payout_runs where id = p_run_id;
  if not found then
    perform private.fail('payout_run_not_found');
  end if;
  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id, 'code', v_run.code, 'cutoff_on', v_run.cutoff_on,
      'hold_days', v_run.hold_days, 'minimum_minor', v_run.minimum_minor,
      'created_at', v_run.created_at,
      'created_by_name', (select p.full_name from public.profiles p where p.id = v_run.created_by)),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'seller_id', p.seller_id, 'trade_name', s.trade_name,
        'legal_name', sp.legal_name, 'id_number', sp.id_number,
        'status', p.status, 'amount_minor', p.amount_minor, 'reference', p.reference,
        'iban', p.payout_iban, 'holder_name', p.payout_holder_name,
        'bank_reference', p.bank_reference, 'paid_at', p.paid_at,
        'failed_at', p.failed_at, 'failure_reason', p.failure_reason
      ) order by p.reference)
      from public.payouts p
      join public.sellers s on s.id = p.seller_id
      join public.seller_private sp on sp.seller_id = p.seller_id
      where p.run_id = v_run.id), '[]'::jsonb)
  );
end;
$$;

-- Finance records that the bank sent a payout, quoting the bank's reference.
-- This is the moment the ledger changes: the seller is owed that much less, and
-- that much has left the operating bank account. Once only per payout.
create or replace function public.ops_mark_payout_paid(
  p_payout_id uuid,
  p_bank_reference text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payout public.payouts%rowtype;
  v_reference text := trim(coalesce(p_bank_reference, ''));
  v_tx uuid;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_reference) not between 4 and 60 then
    perform private.fail('invalid_bank_reference');
  end if;
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then
    perform private.fail('payout_not_found');
  end if;
  if v_payout.status <> 'scheduled' then
    perform private.fail('payout_not_scheduled', v_payout.status);
  end if;

  insert into public.ledger_transactions (kind, memo, created_by)
  values ('payout', 'Pago a vendedor ' || coalesce(v_payout.reference, v_payout.id::text),
          (select auth.uid()))
  returning id into v_tx;
  insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
    (v_tx, private.seller_payable_account(v_payout.seller_id), v_payout.amount_minor),
    (v_tx, private.ledger_account('bank_operating'), -v_payout.amount_minor);

  update public.payouts
  set status = 'paid', bank_reference = v_reference, paid_at = now(),
      paid_by = (select auth.uid()), ledger_transaction_id = v_tx
  where id = p_payout_id;

  perform private.emit('payout.paid', jsonb_build_object(
    'payout_id', p_payout_id, 'seller_id', v_payout.seller_id,
    'amount_minor', v_payout.amount_minor));
exception
  when unique_violation then
    -- The same bank reference is already recorded on another payout.
    perform private.fail('bank_reference_used');
end;
$$;

-- Finance records that a payout did not go through, with the reason the seller
-- will read. The amount goes back to "available" and a later run picks it up.
-- For a payout already marked paid (the bank returned the transfer afterwards)
-- the ledger entry is reversed, so the books again say the seller is owed it.
create or replace function public.ops_mark_payout_failed(
  p_payout_id uuid,
  p_reason text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payout public.payouts%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_tx uuid;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_reason) not between 5 and 500 then
    perform private.fail('reason_required');
  end if;
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then
    perform private.fail('payout_not_found');
  end if;
  if v_payout.status = 'failed' then
    perform private.fail('payout_not_scheduled', v_payout.status);
  end if;

  if v_payout.status = 'paid' then
    insert into public.ledger_transactions (kind, memo, created_by)
    values ('payout', 'Pago devuelto por el banco ' || coalesce(v_payout.reference, v_payout.id::text),
            (select auth.uid()))
    returning id into v_tx;
    insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
      (v_tx, private.seller_payable_account(v_payout.seller_id), -v_payout.amount_minor),
      (v_tx, private.ledger_account('bank_operating'), v_payout.amount_minor);
  end if;

  update public.payouts
  set status = 'failed', failed_at = now(), failed_by = (select auth.uid()),
      failure_reason = v_reason
  where id = p_payout_id;

  perform private.emit('payout.failed', jsonb_build_object(
    'payout_id', p_payout_id, 'seller_id', v_payout.seller_id,
    'amount_minor', v_payout.amount_minor));
end;
$$;

-- The seller's money screen: the three balances, when the pending part is
-- released, what stands in the way of being paid, and every payout so far.
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
        select private.cr_local(o.delivered_at)::date + v_hold as release_on,
               -sum(e.amount_minor)::bigint as amount
        from public.ledger_accounts a
        join public.ledger_entries e on e.account_id = a.id
        join public.ledger_transactions t on t.id = e.transaction_id
        join public.orders o on o.id = t.order_id
        where a.seller_id = p_seller_id and o.delivered_at is not null
          and private.cr_local(o.delivered_at)::date + v_hold > v_today
        group by 1
        having sum(e.amount_minor) <> 0
      ) x), '[]'::jsonb),
    -- … and the part that has no day yet because the order is still on its way.
    'awaiting_delivery_minor', coalesce((
      select -sum(e.amount_minor)::bigint
      from public.ledger_accounts a
      join public.ledger_entries e on e.account_id = a.id
      join public.ledger_transactions t on t.id = e.transaction_id
      join public.orders o on o.id = t.order_id
      where a.seller_id = p_seller_id and o.delivered_at is null), 0),
    'blocked_by', (
      select to_jsonb(array_remove(array[
        case when s.status in ('suspended', 'pending') then 'shop_suspended' end,
        case when sp.payout_iban is null or sp.payout_holder_name is null then 'no_bank_details' end,
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

-- ═══ Grants ════════════════════════════════════════════════════════════════
-- New functions are closed to everyone by default; each is opened to signed-in
-- users here and checks the caller's role itself.

grant execute on function
  public.audit_entries(text, integer),
  public.ops_staff(),
  public.ops_set_staff(text, public.staff_role, boolean),
  public.ops_save_driver(text, text, public.identification_type, text, public.vehicle_type, text,
                         numeric, text, date, date, date, text, uuid),
  public.ops_warehouse_staff(),
  public.ops_set_warehouse_staff(uuid, text, text),
  public.seller_request_payout_details(uuid, text, text, text),
  public.seller_payout_details(uuid),
  public.ops_payout_detail_requests(text),
  public.ops_decide_payout_details(uuid, boolean, text),
  public.ops_payout_preview(date),
  public.ops_create_payout_run(date),
  public.ops_payout_runs(),
  public.ops_payout_run(uuid),
  public.ops_mark_payout_paid(uuid, text),
  public.ops_mark_payout_failed(uuid, text),
  public.seller_payouts(uuid)
to authenticated;
