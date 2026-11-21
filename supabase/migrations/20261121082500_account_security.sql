-- Account security: what the database adds to Supabase Auth for the second
-- factor, for recovering a member of staff who lost their phone, and for
-- deleting an account.
--
-- Passwords, sessions, e-mail confirmation and the time-based codes themselves
-- belong to Supabase Auth; the apps call it directly. This file holds only what
-- Auth does not do on our plan:
--
--   * A limit on wrong second-factor codes per account. Auth limits challenge
--     and verify calls per IP address only (15 a minute), and every call from
--     the apps comes from the same server address, so that limit is shared by
--     everyone and protects no single account. Auth's own per-account hook
--     (MFA verification attempt) needs the Team plan; the hook function is
--     written below so it can be switched on there, and until then the apps
--     reserve an attempt (`mfa_reserve_attempt`) before every code they send.
--   * Making the second factor and the end of a session count in the database
--     itself, not only in the apps' screens: `private.factor_ok` in the staff
--     and seller helpers, and `check_request`, run by the Data API before
--     every request, which refuses a deleted account, an ended session, and a
--     password-only session of an account that has a second factor.
--   * `ops_reset_staff_factor`: an administrator removes the authenticator of a
--     colleague who lost their device. Recovery codes do not exist in Auth yet.
--   * `delete_my_account`: the right to erasure (Ley 8968) and the app stores'
--     account-deletion rule.
--
-- Writes to the `auth` schema. On a hosted project these functions are owned
-- by `postgres`, which may read and write the Auth tables (the runbook deletes
-- a throwaway account with `delete from auth.users` the same way). That is
-- verified on the hosted project before the screens are used there; see
-- docs/05-security-compliance/privacy.md, "Deleting an account".

-- ── Wrong second-factor codes ──────────────────────────────────────────────

-- One row per code tried and not (yet) known to be right. `reserved` rows are
-- attempts the apps announced before sending the code to Auth: counting them
-- up front means a burst of parallel requests cannot outrun the limit. A right
-- code removes its own reservation; a wrong one leaves it as a failure.
create table private.mfa_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  failed_at timestamptz not null default now(),
  reserved boolean not null default false
);

create index mfa_failures_user_idx on private.mfa_failures (user_id, failed_at desc);
alter table private.mfa_failures enable row level security;
revoke all on private.mfa_failures from public, anon, authenticated;

-- Five wrong codes within fifteen minutes lock the second step for the rest of
-- those fifteen minutes. With a million possible codes and three accepted at
-- any moment, that keeps a guesser below one chance in 25 000 a day.
create or replace function private.mfa_status(p_user uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with recent as (
    select f.failed_at from private.mfa_failures f
    where f.user_id = p_user and f.failed_at > now() - interval '15 minutes'
  ), fifth as (
    select r.failed_at from recent r order by r.failed_at desc offset 4 limit 1
  )
  select jsonb_build_object(
    'locked', (select count(*) from recent) >= 5,
    'attempts_left', greatest(0, 5 - (select count(*) from recent)),
    'retry_after_seconds', coalesce((
      select greatest(1, ceil(extract(epoch from (f.failed_at + interval '15 minutes' - now()))))::int
      from fifth f), 0));
$$;

-- Asked by the apps before they show the code form.
create or replace function public.mfa_attempt_status() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  return private.mfa_status((select auth.uid()));
end;
$$;

-- Called by the apps before every code they send to Auth. Counts the attempt
-- as a failure straight away, under a per-account lock so concurrent calls are
-- counted one after another, and says whether the code may be sent at all.
-- `attempt_id` is null when the account is locked; otherwise the apps pass it
-- to `mfa_attempt_succeeded` if Auth accepts the code. The status returned is
-- the one that applies if this code turns out wrong. A person can only ever
-- add attempts to their own account: nothing clears the count but time and a
-- right code, which removes only its own reservation.
create or replace function public.mfa_reserve_attempt() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id bigint;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mfa:' || v_user::text, 0));
  delete from private.mfa_failures f
  where f.user_id = v_user and f.failed_at < now() - interval '1 day';
  if (private.mfa_status(v_user) ->> 'locked')::boolean then
    return private.mfa_status(v_user) || jsonb_build_object('attempt_id', null);
  end if;
  insert into private.mfa_failures (user_id, reserved) values (v_user, true) returning id into v_id;
  return private.mfa_status(v_user) || jsonb_build_object('attempt_id', v_id);
end;
$$;

-- Auth accepted the code: the reservation made for it is not a failure.
create or replace function public.mfa_attempt_succeeded(p_attempt_id bigint) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  -- Only a reservation of one's own, made in the last few minutes; and only an
  -- account whose session has now passed the second step (or that is enrolling
  -- its first factor, which has no verified one yet) can say a code was right.
  if not private.factor_ok() then
    perform private.fail('second_factor_required');
  end if;
  delete from private.mfa_failures f
  where f.id = p_attempt_id and f.user_id = v_user and f.reserved
    and f.failed_at > now() - interval '5 minutes';
end;
$$;

-- The same limit as an Auth hook ("MFA verification attempt", Team plan and
-- above). Once enabled in the project's Auth settings, Auth itself calls it on
-- every code, including codes sent to Auth directly rather than through the
-- apps, and a rejection signs the account out everywhere. It counts each wrong
-- code once: when the apps already reserved the attempt, it turns that
-- reservation into the failure instead of adding a second row.
create or replace function public.hook_mfa_verification_attempt(event jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := nullif(event ->> 'user_id', '')::uuid;
  v_pending bigint;
  v_before integer;
begin
  if v_user is null then
    return jsonb_build_object('decision', 'continue');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mfa:' || v_user::text, 0));
  select f.id into v_pending from private.mfa_failures f
  where f.user_id = v_user and f.reserved and f.failed_at > now() - interval '5 minutes'
  order by f.failed_at desc limit 1;
  -- Failures before this attempt: the reservation for this very code does not count.
  select count(*) - (case when v_pending is null then 0 else 1 end) into v_before
  from private.mfa_failures f
  where f.user_id = v_user and f.failed_at > now() - interval '15 minutes';
  if v_before >= 5 then
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many wrong codes. Try again in 15 minutes.');
  end if;
  if coalesce((event ->> 'valid')::boolean, false) then
    return jsonb_build_object('decision', 'continue');
  end if;
  if v_pending is null then
    insert into private.mfa_failures (user_id) values (v_user);
  else
    update private.mfa_failures set reserved = false where id = v_pending;
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

-- ── Sessions that must not act ─────────────────────────────────────────────

-- True when the session has done what the account requires: passed the second
-- step (aal2), or the account has no verified second factor at all. This is
-- the check Supabase documents for "only users who enrolled" (auth-mfa guide),
-- and the one that makes a factor protect anything: without it a password
-- alone (aal1) would open every function the apps keep behind /verificar.
create or replace function private.factor_ok() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified');
$$;

-- The staff gate: any member of staff with a factor must have passed it, and
-- when `require_staff_mfa` is on, every staff session must be aal2.
create or replace function private.staff_session_ok() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.factor_ok() and case
    when coalesce((select value from public.app_settings where key = 'require_staff_mfa'), 'false'::jsonb) = 'true'::jsonb
      then coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    else true
  end;
$$;

-- The seller helpers, now also refusing a seller who turned the second factor
-- on and has not passed it in this session. Every seller function and every
-- seller policy (banking details included) goes through one of these.
create or replace function private.is_seller_member(p_seller_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seller_members m
    where m.seller_id = p_seller_id and m.user_id = (select auth.uid())
  ) and private.factor_ok();
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
  ) and private.factor_ok();
$$;

create or replace function private.my_seller_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.seller_id from public.seller_members m
  where m.user_id = (select auth.uid()) and private.factor_ok();
$$;

-- Runs before every Data API request (PostgREST's `db_pre_request`, set
-- below), in the same transaction, as the caller. Refuses:
--   * a token whose account was deleted, or whose session was ended (signed
--     out, password changed, factor reset by an administrator, account
--     deleted). Access tokens stay valid for up to an hour by themselves; this
--     makes ending a session take effect at once;
--   * an account with a second factor whose session has not passed it, for
--     everything except what the second-step screen itself needs.
-- For a request that can write, the account's sign-in row is locked FOR KEY
-- SHARE until the request ends. `delete_my_account` locks the same row FOR
-- UPDATE, so a request and a deletion of the same account never overlap: a
-- request that started first finishes first (and its order, say, then blocks
-- the deletion), and one that waited finds the account gone. Auth's own
-- updates of that row take a weaker lock and are not held up.
create or replace function public.check_request() returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_session text := (select auth.jwt()) ->> 'session_id';
  v_function text := regexp_replace(coalesce(current_setting('request.path', true), ''), '^/?rpc/', '');
begin
  if v_user is null then
    return; -- visitors and server keys: grants and policies decide
  end if;
  if current_setting('transaction_read_only') = 'off' then
    perform 1 from auth.users u where u.id = v_user and u.deleted_at is null for key share;
  else
    perform 1 from auth.users u where u.id = v_user and u.deleted_at is null;
  end if;
  if not found then
    perform private.fail('session_ended');
  end if;
  if v_session is not null
     and not exists (select 1 from auth.sessions s where s.id::text = v_session) then
    perform private.fail('session_ended');
  end if;
  if not private.factor_ok()
     and v_function not in ('my_security', 'my_roles', 'mfa_attempt_status',
                            'mfa_reserve_attempt', 'mfa_attempt_succeeded') then
    perform private.fail('second_factor_required');
  end if;
end;
$$;

-- Register it with the Data API, for this database only. On a hosted project
-- the migration runs as `postgres`, which Supabase's own guide has run exactly
-- this for ("Securing your API"); locally the shim creates the role and the
-- API stand-in reads the setting the way PostgREST does.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',
                   current_database(), 'public.check_request');
  end if;
end
$$;
notify pgrst, 'reload config';

-- ── What the screens need to know about the session ───────────────────────

-- The session's assurance level and whether this person must have a second
-- factor. Works at either level, so a member of staff who has not passed the
-- second step can still be told to.
create or replace function public.my_security() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_staff boolean;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  v_staff := exists (
    select 1 from public.staff_members s where s.user_id = v_user and s.active);
  return jsonb_build_object(
    'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
    'is_staff', v_staff,
    'mfa_required', v_staff
      and coalesce(private.setting('require_staff_mfa'), 'false'::jsonb) = 'true'::jsonb,
    'staff_session_ok', not v_staff or private.staff_session_ok());
end;
$$;

-- ── Recovering staff who lost their authenticator ─────────────────────────

-- Every member of staff and whether they have a second factor, for the
-- administrator's security screen.
create or replace function public.ops_staff_security() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id,
      'full_name', p.full_name,
      'email', u.email,
      'role', s.role,
      'active', s.active,
      'factors', (select count(*) from auth.mfa_factors f
                  where f.user_id = s.user_id and f.status = 'verified'),
      'is_self', s.user_id = (select auth.uid()))
      order by s.active desc, p.full_name nulls last, u.email)
    from public.staff_members s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id), '[]'::jsonb);
end;
$$;

-- Removes every second factor of another member of staff and ends all their
-- sessions, so their next sign-in starts again with the password and, when the
-- setting requires it, enrolment. Never for oneself: someone who has taken over
-- an administrator's session must not be able to strip that account's factor.
create or replace function public.ops_reset_staff_factor(p_user_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_factors integer;
  v_sessions integer;
begin
  if v_admin is null then
    perform private.fail('not_authenticated');
  end if;
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  if p_user_id = v_admin then
    perform private.fail('cannot_reset_own_factor');
  end if;
  perform 1 from public.staff_members s where s.user_id = p_user_id for update;
  if not found then
    perform private.fail('staff_not_found');
  end if;

  delete from auth.mfa_factors f where f.user_id = p_user_id;
  get diagnostics v_factors = row_count;
  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_sessions = row_count;
  delete from private.mfa_failures f where f.user_id = p_user_id;

  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values (v_admin, 'RESET_MFA', 'auth.mfa_factors', p_user_id::text,
          jsonb_build_object('factors', v_factors, 'sessions', v_sessions),
          jsonb_build_object('factors', 0, 'sessions', 0));

  return jsonb_build_object('factors_removed', v_factors, 'sessions_ended', v_sessions);
end;
$$;

-- ── Personal data in the audit trail ───────────────────────────────────────
--
-- The audit trail is immutable, so whatever personal data reaches it stays
-- there past any deletion. It records that a change happened and who made it;
-- it does not need a driver's name or ID number, or a shop's legal identity,
-- contact details and bank account, to do that (for a sole trader those are a
-- person's name, cédula and phone). Those columns are left out, and the names of
-- the ones that changed are kept under `changed_private`. The bank account
-- number was already left out; the rest of the list is new here.
create or replace function private.audit_private_columns(p_table text) returns text[]
language sql immutable
set search_path = ''
as $$
  select case p_table
    when 'drivers' then array['full_name', 'phone', 'id_number', 'plate', 'license_class',
                              'license_expires_on', 'inspection_expires_on', 'insurance_expires_on']
    when 'seller_private' then array['legal_name', 'id_number', 'payout_iban', 'payout_holder_name', 'contact_email',
                                     'contact_phone', 'sinpe_movil_number', 'fiscal_address',
                                     'postal_code', 'kyc_notes']
    else '{}'::text[]
  end;
$$;

create or replace function private.audit_redact(p_row jsonb, p_columns text[]) returns jsonb
language sql immutable
set search_path = ''
as $$
  select case when p_row is null then null else p_row - p_columns end;
$$;

create or replace function private.audit() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_hidden text[] := private.audit_private_columns(tg_table_name);
  v_changed jsonb;
  v_key text;
begin
  if cardinality(v_hidden) > 0 then
    select coalesce(jsonb_agg(c order by c), '[]'::jsonb) into v_changed
    from unnest(v_hidden) c
    where (v_old -> c) is distinct from (v_new -> c);
    v_old := private.audit_redact(v_old, v_hidden);
    v_new := private.audit_redact(v_new, v_hidden);
    if v_new is not null and jsonb_array_length(v_changed) > 0 then
      v_new := v_new || jsonb_build_object('changed_private', v_changed);
    end if;
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

-- Rows written before this migration still hold those columns. This is the one
-- rewrite the immutable trail ever gets, done by the owner while the guard is
-- off for this transaction only; it removes data and changes nothing else.
alter table private.audit_log disable trigger audit_log_immutable;
update private.audit_log l
set old_row = private.audit_redact(l.old_row, private.audit_private_columns(l.table_name)),
    new_row = private.audit_redact(l.new_row, private.audit_private_columns(l.table_name))
where l.table_name in ('drivers', 'seller_private')
  and (l.old_row ?| private.audit_private_columns(l.table_name)
       or l.new_row ?| private.audit_private_columns(l.table_name));
alter table private.audit_log enable trigger audit_log_immutable;

revoke execute on function
  private.audit_private_columns(text),
  private.audit_redact(jsonb, text[])
from public, anon, authenticated;

-- ── Deleting an account ────────────────────────────────────────────────────
--
-- What happens, in one transaction:
--   erased    profile name and phone, addresses, consents, the shipping name,
--             phone, directions and exact pin on past orders and route stops,
--             return reasons, complaint texts, the address given on content
--             reports, second factors, sessions, sign-in identities, and the
--             e-mail, password and metadata on the sign-in record;
--   kept      orders, their lines, payments, shipments, invoices and ledger
--             entries, for the legal retention period (five years for
--             electronic-invoicing records), detached from the person: they
--             keep pointing at an id that no longer leads to a name, an e-mail
--             or an address. Reviews stay published under "Cliente".
--
-- The sign-in record (auth.users) is anonymised, not deleted. Orders, returns,
-- complaints and ledger transactions refer to it without a cascade, as they
-- must: deleting it would fail for anyone who ever bought something, and
-- pointing all of them at one shared "deleted" account would merge strangers'
-- records (and collide on the per-person checkout key). Auth's own "soft
-- delete" works the same way: it obfuscates the e-mail and phone and keeps the
-- row. The e-mail becomes `<id>@cuenta-eliminada.invalid`, so the real address
-- can sign up again as a new, unrelated account.

-- A record that a deletion happened, for the data-protection register. It
-- holds no id and only the day, so it cannot be tied back to the person.
create table private.account_deletions (
  id bigint generated always as identity primary key,
  deleted_on date not null default current_date,
  orders_kept integer not null,
  reviews_kept integer not null
);

alter table private.account_deletions enable row level security;
revoke all on private.account_deletions from public, anon, authenticated;

-- Why an account cannot be deleted yet, as error codes, in the order a person
-- should deal with them. Empty when nothing stands in the way.
create or replace function private.account_deletion_blockers(p_user uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$
  with mine as (
    select m.seller_id from public.seller_members m where m.user_id = p_user
  )
  select array_remove(array[
    case when exists (select 1 from public.staff_members s
                      where s.user_id = p_user and s.active)
      then 'account_is_staff' end,
    case when exists (select 1 from public.drivers d
                      where d.user_id = p_user and d.status <> 'offboarded')
      then 'account_is_driver' end,
    case when exists (select 1 from public.warehouse_staff w where w.user_id = p_user)
      then 'account_is_warehouse_staff' end,
    case when exists (select 1 from public.orders o
                      where o.user_id = p_user
                        and o.status not in ('delivered', 'completed', 'cancelled', 'refunded'))
      then 'account_has_open_orders' end,
    case when exists (select 1 from public.return_requests r
                      where r.user_id = p_user and r.status in ('requested', 'approved', 'received'))
      then 'account_has_open_returns' end,
    -- A cancelled order that was paid is refunded later, through the gateway
    -- and to the account or phone that paid; that needs the person's details.
    case when exists (select 1 from public.payments p
                      join public.orders o on o.id = p.order_id
                      where o.user_id = p_user
                        and o.status in ('cancelled', 'refunded')
                        and p.status in ('authorized', 'captured', 'partially_refunded'))
      then 'account_has_pending_refund' end,
    case when exists (select 1 from public.complaints c
                      where c.user_id = p_user and c.status <> 'resolved')
      then 'account_has_open_complaints' end,
    -- The last person in charge of a shop that is open or opening: closing it
    -- is Yuntera's decision (ops_set_seller_status), not a side effect.
    case when exists (select 1 from public.seller_members m
                      join public.sellers s on s.id = m.seller_id
                      where m.user_id = p_user and m.role in ('owner', 'admin')
                        and s.status in ('pending', 'active')
                        and not exists (select 1 from public.seller_members o
                                        where o.seller_id = m.seller_id and o.user_id <> p_user
                                          and o.role in ('owner', 'admin')))
      then 'account_runs_open_shop' end,
    case when exists (select 1 from public.stock_levels sl
                      where sl.seller_id in (select seller_id from mine) and sl.on_hand > 0)
      then 'account_shop_has_stock' end,
    case when exists (select 1 from public.order_items i
                      join public.orders o on o.id = i.order_id
                      where i.seller_id in (select seller_id from mine)
                        and o.status not in ('delivered', 'completed', 'cancelled', 'refunded'))
      then 'account_shop_has_open_orders' end,
    case when exists (select 1 from mine
                      where (select coalesce(sum(e.amount_minor), 0)
                             from public.ledger_entries e
                             join public.ledger_accounts a on a.id = e.account_id
                             where a.seller_id = mine.seller_id) <> 0
                         or exists (select 1 from public.payouts po
                                    where po.seller_id = mine.seller_id
                                      and po.status = 'scheduled'))
      then 'account_shop_has_balance' end
  ], null);
$$;

-- What the deletion screen shows before asking for the password.
create or replace function public.account_deletion_check() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if not private.factor_ok() then
    perform private.fail('second_factor_required');
  end if;
  return jsonb_build_object(
    'blockers', to_jsonb(private.account_deletion_blockers(v_user)),
    'orders_kept', (select count(*) from public.orders o where o.user_id = v_user),
    'reviews_kept', (select count(*) from public.reviews r where r.user_id = v_user));
end;
$$;

-- A shop whose last person in charge deleted the account: closed for good,
-- and its private details go. A shop that never sold anything and was never
-- paid loses them all, its legal name and identification number included. A
-- shop that traded keeps those two (and the tax regime) with the invoices,
-- payouts and ledger entries made under them, for the tax retention period;
-- its contact details and bank account go.
create or replace function private.close_abandoned_shop(p_seller_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.sellers s set status = 'closed' where s.id = p_seller_id and s.status <> 'closed';
  if not exists (select 1 from public.order_items i where i.seller_id = p_seller_id)
     and not exists (select 1 from public.payouts po where po.seller_id = p_seller_id)
     and not exists (select 1 from public.ledger_entries e
                     join public.ledger_accounts a on a.id = e.account_id
                     where a.seller_id = p_seller_id) then
    delete from public.seller_private sp where sp.seller_id = p_seller_id;
  else
    update public.seller_private sp
    set contact_email = p_seller_id::text || '@tienda-cerrada.invalid',
        contact_phone = '+50620000000',
        fiscal_address = 'Eliminada junto con la cuenta.',
        postal_code = null, payout_iban = null, payout_holder_name = null,
        sinpe_movil_number = null, kyc_notes = null
    where sp.seller_id = p_seller_id;
  end if;
end;
$$;

create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_blockers text[];
  v_orders integer;
  v_reviews integer;
  v_shop uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  -- An account with a second factor is deleted only from a session that passed it.
  if not private.factor_ok() then
    perform private.fail('second_factor_required');
  end if;
  -- One deletion at a time per account, and none for an account already gone.
  -- Requests of this account in flight hold this row FOR KEY SHARE (see
  -- check_request), so the deletion waits for them and they cannot follow it.
  perform 1 from auth.users u where u.id = v_user and u.deleted_at is null for update;
  if not found then
    perform private.fail('not_authenticated');
  end if;

  v_blockers := private.account_deletion_blockers(v_user);
  -- The first reason wins; each is spelled out so the client's list of
  -- messages can be checked against this file.
  case v_blockers[1]
    when 'account_is_staff' then perform private.fail('account_is_staff');
    when 'account_is_driver' then perform private.fail('account_is_driver');
    when 'account_is_warehouse_staff' then perform private.fail('account_is_warehouse_staff');
    when 'account_has_open_orders' then perform private.fail('account_has_open_orders');
    when 'account_has_open_returns' then perform private.fail('account_has_open_returns');
    when 'account_has_pending_refund' then perform private.fail('account_has_pending_refund');
    when 'account_has_open_complaints' then perform private.fail('account_has_open_complaints');
    when 'account_runs_open_shop' then perform private.fail('account_runs_open_shop');
    when 'account_shop_has_stock' then perform private.fail('account_shop_has_stock');
    when 'account_shop_has_open_orders' then perform private.fail('account_shop_has_open_orders');
    when 'account_shop_has_balance' then perform private.fail('account_shop_has_balance');
    else null; -- nothing in the way
  end case;

  select count(*) into v_orders from public.orders o where o.user_id = v_user;
  select count(*) into v_reviews from public.reviews r where r.user_id = v_user;

  -- Personal data the platform holds for the person.
  update public.profiles
  set full_name = null, phone = null, phone_verified_at = null,
      marketing_opt_in = false, locale = 'es-CR'
  where id = v_user;
  delete from public.addresses a where a.user_id = v_user;
  delete from public.consents c where c.user_id = v_user;

  -- Kept records, without the person in them. The district stays (it decided
  -- the shipping fee); the pin is rounded to about a kilometre.
  update public.orders o
  set ship_recipient_name = 'Cuenta eliminada', ship_phone = '', ship_senas = '',
      ship_lat = round(o.ship_lat::numeric, 2)::double precision,
      ship_lng = round(o.ship_lng::numeric, 2)::double precision,
      ship_plus_code = null
  where o.user_id = v_user;
  update public.route_stops rs
  set recipient_name = 'Cuenta eliminada', phone = '', senas = '',
      lat = round(rs.lat::numeric, 2)::double precision,
      lng = round(rs.lng::numeric, 2)::double precision,
      plus_code = null, pod_recipient_name = null,
      pod_lat = null, pod_lng = null
  where rs.shipment_id in (
    select sh.id from public.shipments sh
    join public.orders o on o.id = sh.order_id
    where o.user_id = v_user);
  update public.return_requests r set reason = null where r.user_id = v_user;
  update public.complaints c
  set description = 'Texto eliminado junto con la cuenta.'
  where c.user_id = v_user;
  update public.content_reports cr set reporter_email = null
  where cr.reporter_id = v_user;

  -- Roles that ended earlier: an inactive staff row, a former driver, shops
  -- left behind with nothing pending (the blockers above guarantee that). The
  -- audit trail never held a driver's or a shop's personal columns (see
  -- private.audit), so nothing of them is left there either.
  delete from public.staff_members s where s.user_id = v_user and not s.active;
  update public.drivers d
  set full_name = 'Repartidor retirado', phone = '+50650000000', id_number = '000000000',
      plate = null, license_class = null, license_expires_on = null,
      inspection_expires_on = null, insurance_expires_on = null
  where d.user_id = v_user;
  -- Shops (already suspended or closed: see account_runs_open_shop) this
  -- person leaves with nobody in charge.
  for v_shop in
    select m.seller_id from public.seller_members m
    where m.user_id = v_user
      and not exists (select 1 from public.seller_members o
                      where o.seller_id = m.seller_id and o.user_id <> v_user
                        and o.role in ('owner', 'admin'))
  loop
    perform private.close_abandoned_shop(v_shop);
  end loop;
  delete from public.seller_members m where m.user_id = v_user;
  delete from private.mfa_failures f where f.user_id = v_user;

  -- The sign-in record: every session ends (and with check_request, every
  -- access token issued for them stops working at once), no way to sign in
  -- remains, and the e-mail address is free for a new account. The ban is
  -- finite, as Auth's own bans are: Auth reads banned_until into a Go time
  -- value, which has no 'infinity'.
  delete from auth.sessions s where s.user_id = v_user;
  delete from auth.mfa_factors f where f.user_id = v_user;
  delete from auth.one_time_tokens t where t.user_id = v_user;
  delete from auth.identities i where i.user_id = v_user;
  update auth.users u
  set email = v_user::text || '@cuenta-eliminada.invalid',
      encrypted_password = '',
      phone = null,
      email_change = '', phone_change = '',
      confirmation_token = '', recovery_token = '', email_change_token_new = '',
      email_change_token_current = '', phone_change_token = '', reauthentication_token = '',
      raw_user_meta_data = '{}'::jsonb,
      last_sign_in_at = null,
      banned_until = now() + interval '100 years',
      deleted_at = now(),
      updated_at = now()
  where u.id = v_user;
  -- Auth's own log of sign-ins, where the project still keeps one in the database.
  begin
    delete from auth.audit_log_entries l where l.payload ->> 'actor_id' = v_user::text;
  exception when undefined_table then
    null;
  end;

  insert into private.account_deletions (orders_kept, reviews_kept) values (v_orders, v_reviews);
  return jsonb_build_object('orders_kept', v_orders, 'reviews_kept', v_reviews);
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────

revoke execute on function
  private.mfa_status(uuid),
  private.factor_ok(),
  private.account_deletion_blockers(uuid),
  private.close_abandoned_shop(uuid),
  public.mfa_attempt_status(),
  public.mfa_reserve_attempt(),
  public.mfa_attempt_succeeded(bigint),
  public.hook_mfa_verification_attempt(jsonb),
  public.check_request(),
  public.my_security(),
  public.ops_staff_security(),
  public.ops_reset_staff_factor(uuid),
  public.account_deletion_check(),
  public.delete_my_account()
from public, anon, authenticated;

grant execute on function
  public.mfa_attempt_status(),
  public.mfa_reserve_attempt(),
  public.mfa_attempt_succeeded(bigint),
  public.my_security(),
  public.ops_staff_security(),
  public.ops_reset_staff_factor(uuid),
  public.account_deletion_check(),
  public.delete_my_account()
to authenticated;

-- The Data API runs check_request as the caller, visitors included.
grant execute on function public.check_request() to anon, authenticated;

-- Only Auth itself calls the hook.
grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;
