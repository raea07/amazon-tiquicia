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
--     ask `mfa_attempt_status` before every code and report every wrong one.
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

create table private.mfa_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  failed_at timestamptz not null default now()
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

-- Asked by the apps before they send a code to Auth.
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

-- Told by the apps when Auth refused a code. A person can only ever add
-- failures to their own account, never remove them: there is no function that
-- clears the count, which simply ages out.
create or replace function public.mfa_record_failure() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if not (private.mfa_status(v_user) ->> 'locked')::boolean then
    insert into private.mfa_failures (user_id) values (v_user);
  end if;
  delete from private.mfa_failures f
  where f.user_id = v_user and f.failed_at < now() - interval '1 day';
  return private.mfa_status(v_user);
end;
$$;

-- The same limit as an Auth hook ("MFA verification attempt", Team plan and
-- above). Once enabled in the project's Auth settings, Auth itself calls it on
-- every code, including codes sent to Auth directly rather than through the
-- apps, and a rejection signs the account out everywhere.
create or replace function public.hook_mfa_verification_attempt(event jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := nullif(event ->> 'user_id', '')::uuid;
begin
  if v_user is null then
    return jsonb_build_object('decision', 'continue');
  end if;
  if (private.mfa_status(v_user) ->> 'locked')::boolean then
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many wrong codes. Try again in 15 minutes.');
  end if;
  if coalesce((event ->> 'valid')::boolean, false) then
    return jsonb_build_object('decision', 'continue');
  end if;
  insert into private.mfa_failures (user_id) values (v_user);
  if (private.mfa_status(v_user) ->> 'locked')::boolean then
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many wrong codes. Try again in 15 minutes.');
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

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
          jsonb_build_object('factors', v_factors),
          jsonb_build_object('factors', 0, 'sessions_ended', v_sessions));

  return jsonb_build_object('factors_removed', v_factors, 'sessions_ended', v_sessions);
end;
$$;

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
    case when exists (select 1 from public.complaints c
                      where c.user_id = p_user and c.status <> 'resolved')
      then 'account_has_open_complaints' end,
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
  return jsonb_build_object(
    'blockers', to_jsonb(private.account_deletion_blockers(v_user)),
    'orders_kept', (select count(*) from public.orders o where o.user_id = v_user),
    'reviews_kept', (select count(*) from public.reviews r where r.user_id = v_user));
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
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  -- One deletion at a time per account, and none for an account already gone.
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
    when 'account_has_open_complaints' then perform private.fail('account_has_open_complaints');
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
  -- left behind with nothing pending (the blockers above guarantee that).
  delete from public.staff_members s where s.user_id = v_user and not s.active;
  update public.drivers d
  set full_name = 'Repartidor retirado', phone = '+50650000000', id_number = '000000000',
      plate = null, license_class = null, license_expires_on = null,
      inspection_expires_on = null, insurance_expires_on = null
  where d.user_id = v_user;
  delete from public.seller_members m where m.user_id = v_user;
  delete from private.mfa_failures f where f.user_id = v_user;

  -- The sign-in record: every session ends, no way to sign in remains, and the
  -- e-mail address is free for a new account.
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
      banned_until = 'infinity',
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
  private.account_deletion_blockers(uuid),
  public.mfa_attempt_status(),
  public.mfa_record_failure(),
  public.hook_mfa_verification_attempt(jsonb),
  public.my_security(),
  public.ops_staff_security(),
  public.ops_reset_staff_factor(uuid),
  public.account_deletion_check(),
  public.delete_my_account()
from public, anon, authenticated;

grant execute on function
  public.mfa_attempt_status(),
  public.mfa_record_failure(),
  public.my_security(),
  public.ops_staff_security(),
  public.ops_reset_staff_factor(uuid),
  public.account_deletion_check(),
  public.delete_my_account()
to authenticated;

-- Only Auth itself calls the hook.
grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;
