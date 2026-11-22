-- Account security: the staff second-factor gate, the limit on wrong codes, an
-- administrator resetting a colleague's factor, and deleting an account. Each
-- function is checked for the right caller, the wrong caller and what it
-- leaves behind. Runs on the local shim and on a hosted project alike: the
-- rows it adds to the `auth` tables use the columns both have.

begin;
\ir _helpers.sql
-- Reads below check what functions left behind (see _helpers.sql); access
-- itself is tested in 020_access and 110_lockdown.
select pg_temp.allow_inspection();

-- A second member of staff (support), with a verified factor and one open
-- session, for the administrator to recover.
select pg_temp.remember('colleague', gen_random_uuid()::text);
select pg_temp.remember('shopper', (select id::text from auth.users where email = 'comprador@yuntera.example'));
select pg_temp.remember('admin', (select id::text from auth.users where email = 'central@yuntera.example'));
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change,
   email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', current_setting('t.colleague')::uuid, 'authenticated',
   'authenticated', 'colega-095@yuntera.example', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Colega de Soporte"}', now(), now(),
   '', '', '', '', '', '', '', '');
insert into public.staff_members (user_id, role) values (current_setting('t.colleague')::uuid, 'support');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), current_setting('t.colleague')::uuid, 'Teléfono', 'totp', 'verified',
        now(), now(), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (gen_random_uuid(), current_setting('t.colleague')::uuid, now(), now(), 'aal2');

-- ── What a session knows about itself ──────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
do $$
declare s jsonb := public.my_security();
begin
  assert s ->> 'aal' = 'aal1', 'level read from the token';
  assert not (s ->> 'is_staff')::boolean and not (s ->> 'mfa_required')::boolean,
    'a shopper is not asked for a second factor';
end
$$;
reset role;

select pg_temp.login_anon();
do $$
begin
  perform public.my_security();
  raise exception 'a visitor reached my_security';
exception when insufficient_privilege then null;
end
$$;
reset role;

-- ── The staff gate, setting off ────────────────────────────────────────────

select pg_temp.login('central@yuntera.example');
do $$
declare s jsonb := public.my_security();
begin
  assert (s ->> 'is_staff')::boolean and not (s ->> 'mfa_required')::boolean, 'not required while off';
  assert (s ->> 'staff_session_ok')::boolean, 'a password-only session is enough while off';
  perform public.ops_overview();
end
$$;
reset role;

-- ── A second factor counts in the database, setting off ───────────────────
-- Once the administrator turns a factor on, a password alone (aal1) no longer
-- opens staff functions, whatever require_staff_mfa says: the factor protects
-- against someone who has only the password and calls the API directly.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), id, 'Teléfono', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
from auth.users where email = 'central@yuntera.example';

select pg_temp.login('central@yuntera.example');
do $$
begin
  assert not (public.my_security() ->> 'staff_session_ok')::boolean,
    'a staff member with a factor is not ok at aal1, even with the setting off';
  begin
    perform public.ops_overview();
    raise exception 'ops_overview answered a password-only session of an account with a factor';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_staff_security();
    raise exception 'the staff list (with e-mails) answered at aal1';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform * from public.audit_entries();
    raise exception 'the audit trail answered at aal1';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_reset_staff_factor(current_setting('t.colleague')::uuid);
    raise exception 'a factor was reset from a password-only session';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
begin
  assert (public.my_security() ->> 'staff_session_ok')::boolean, 'aal2 passes with the setting off';
  perform public.ops_overview();
end
$$;
reset role;

-- The same for a seller who turned the factor on: neither the seller
-- functions nor the bank details answer a password-only session.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), id, 'Teléfono', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
from auth.users where email = 'vendedor@yuntera.example';
select pg_temp.remember('shop', (
  select m.seller_id::text from public.seller_members m join auth.users u on u.id = m.user_id
  where u.email = 'vendedor@yuntera.example' order by m.seller_id limit 1));

select pg_temp.login('vendedor@yuntera.example');
do $$
declare v_rows integer;
begin
  assert not exists (select 1 from private.my_seller_ids()), 'no shops at aal1';
  -- The payout account itself is never written directly (082300: only an
  -- approved request changes it). Since the lockdown (082800) no column of the
  -- table is writable directly, and the fiscal details change only through a
  -- request (seller_request_shop_change, 083000), which is refused at aal1 too.
  begin
    update public.seller_private set fiscal_address = 'Dirección cambiada a aal1'
    where seller_id = current_setting('t.shop')::uuid;
    get diagnostics v_rows = row_count;
    assert v_rows = 0, 'the shop''s fiscal details cannot be changed at aal1';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.seller_request_shop_change(current_setting('t.shop')::uuid, 'fiscal',
      p_fiscal_address => 'Dirección cambiada a aal1');
    raise exception 'a fiscal change was requested at aal1';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    update public.seller_private set payout_iban = 'CR99999999999999999999'
    where seller_id = current_setting('t.shop')::uuid;
    raise exception 'the payout account was writable directly';
  exception when insufficient_privilege then
    null;
  end;
  assert not exists (select 1 from public.seller_private where seller_id = current_setting('t.shop')::uuid),
    'the bank details cannot be read at aal1';
  begin
    perform public.seller_overview(current_setting('t.shop')::uuid);
    raise exception 'a seller function answered at aal1';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;
select pg_temp.login('vendedor@yuntera.example', 'aal2');
do $$
begin
  assert exists (select 1 from private.my_seller_ids()), 'shops are back at aal2';
  assert exists (select 1 from public.seller_private where seller_id = current_setting('t.shop')::uuid),
    'bank details readable at aal2';
end
$$;
reset role;
delete from auth.mfa_factors f using auth.users u
where u.id = f.user_id and u.email = 'vendedor@yuntera.example';

-- ── The Data API's pre-request check ───────────────────────────────────────

do $$
begin
  assert exists (
    select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
    where r.rolname = 'authenticator'
      and s.setdatabase = (select oid from pg_database where datname = current_database())
      and 'pgrst.db_pre_request=public.check_request' = any (s.setconfig)),
    'check_request is registered with the Data API for this database';
end
$$;

-- A shopper with a factor, signed in with the password only: only what the
-- second-step screen needs gets through.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), id, 'Teléfono', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'
from auth.users where email = 'comprador3@yuntera.example';
select pg_temp.login('comprador3@yuntera.example');
do $$
declare v_path text;
begin
  perform set_config('request.path', '/rpc/my_security', true);
  perform public.check_request();
  perform set_config('request.path', '/rpc/mfa_reserve_attempt', true);
  perform public.check_request();
  foreach v_path in array array['/rpc/my_orders', '/rpc/save_address', '/rpc/delete_my_account', '/addresses'] loop
    perform set_config('request.path', v_path, true);
    begin
      perform public.check_request();
      raise exception '% got through at aal1 with a factor', v_path;
    exception when others then
      if sqlerrm <> 'second_factor_required' then raise; end if;
    end;
  end loop;
  -- And the deletion functions refuse by themselves too.
  begin
    perform public.delete_my_account();
    raise exception 'an account with a factor was deleted from a password-only session';
  exception when others then
    if sqlerrm <> 'second_factor_required' then raise; end if;
  end;
end
$$;
reset role;
select pg_temp.login('comprador3@yuntera.example', 'aal2');
do $$
begin
  perform set_config('request.path', '/rpc/my_orders', true);
  perform public.check_request();
end
$$;
reset role;
delete from auth.mfa_factors f using auth.users u
where u.id = f.user_id and u.email = 'comprador3@yuntera.example';

-- A session that has ended (signed out, password changed, factor reset):
-- its access token stops working at once, not when it expires.
select pg_temp.remember('live_session', gen_random_uuid()::text);
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
select current_setting('t.live_session')::uuid, id, now(), now(), 'aal1'
from auth.users where email = 'comprador@yuntera.example';
select pg_temp.login('comprador@yuntera.example');
select set_config('request.jwt.claims',
  (current_setting('request.jwt.claims')::jsonb
   || jsonb_build_object('session_id', current_setting('t.live_session')))::text, true);
select set_config('request.path', '/rpc/my_orders', true);
select public.check_request();
reset role;
delete from auth.sessions where id = current_setting('t.live_session')::uuid;
select pg_temp.login('comprador@yuntera.example');
select set_config('request.jwt.claims',
  (current_setting('request.jwt.claims')::jsonb
   || jsonb_build_object('session_id', current_setting('t.live_session')))::text, true);
do $$
begin
  perform public.check_request();
  raise exception 'a request with an ended session got through';
exception when others then
  if sqlerrm <> 'session_ended' then raise; end if;
end
$$;
reset role;

-- A visitor passes untouched (grants decide).
select pg_temp.login_anon();
select public.check_request();
reset role;

-- ── The staff gate, setting on ─────────────────────────────────────────────

update public.app_settings set value = 'true' where key = 'require_staff_mfa';

select pg_temp.login('central@yuntera.example');
do $$
declare s jsonb := public.my_security();
begin
  assert (s ->> 'mfa_required')::boolean, 'required once the setting is on';
  assert not (s ->> 'staff_session_ok')::boolean, 'a password-only session is not enough';
  -- The console still learns the person is staff, so it can send them to the second step.
  assert public.my_roles() ->> 'staff_role' = 'admin', 'staff role still visible at aal1';
  begin
    perform public.ops_overview();
    raise exception 'ops_overview answered a staff session without a second factor';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_drivers();
    raise exception 'ops_drivers answered a staff session without a second factor';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_reset_staff_factor(current_setting('t.colleague')::uuid);
    raise exception 'a factor was reset from a session without a second factor';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.ops_staff_security();
    raise exception 'the staff security list answered at aal1';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare s jsonb := public.my_security();
begin
  assert s ->> 'aal' = 'aal2' and (s ->> 'staff_session_ok')::boolean, 'aal2 passes';
  perform public.ops_overview();
  perform public.ops_drivers();
end
$$;
reset role;

-- A shopper's own functions do not depend on the setting.
select pg_temp.login('comprador@yuntera.example');
do $$ begin perform public.my_orders(); end $$;
reset role;

-- ── Recovering a colleague's factor ────────────────────────────────────────

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v_colleague uuid := current_setting('t.colleague')::uuid;
  v_list jsonb := public.ops_staff_security();
  v_row jsonb;
  r jsonb;
begin
  select e into v_row from jsonb_array_elements(v_list) e where e ->> 'user_id' = v_colleague::text;
  assert v_row ->> 'email' = 'colega-095@yuntera.example' and (v_row ->> 'factors')::int = 1,
    format('colleague listed with a factor: %s', v_row);
  assert (select count(*) from jsonb_array_elements(v_list) e where (e ->> 'is_self')::boolean) = 1,
    'the administrator is marked as themselves';

  begin
    perform public.ops_reset_staff_factor((select auth.uid()));
    raise exception 'an administrator reset their own factor';
  exception when others then
    if sqlerrm <> 'cannot_reset_own_factor' then raise; end if;
  end;
  begin
    perform public.ops_reset_staff_factor(current_setting('t.shopper')::uuid);
    raise exception 'a factor was reset for someone who is not staff';
  exception when others then
    if sqlerrm <> 'staff_not_found' then raise; end if;
  end;
  begin
    perform public.ops_reset_staff_factor(gen_random_uuid());
    raise exception 'a factor was reset for an unknown id';
  exception when others then
    if sqlerrm <> 'staff_not_found' then raise; end if;
  end;

  r := public.ops_reset_staff_factor(v_colleague);
  assert (r ->> 'factors_removed')::int = 1 and (r ->> 'sessions_ended')::int = 1,
    format('reset result: %s', r);
end
$$;
reset role;

do $$
declare v_colleague uuid := current_setting('t.colleague')::uuid;
begin
  assert not exists (select 1 from auth.mfa_factors where user_id = v_colleague), 'factor removed';
  assert not exists (select 1 from auth.sessions where user_id = v_colleague), 'sessions ended';
  assert exists (select 1 from auth.mfa_factors f join auth.users u on u.id = f.user_id
                 where u.email = 'central@yuntera.example'), 'the administrator keeps their own';
  assert exists (
    select 1 from private.audit_log
    where action = 'RESET_MFA' and row_key = v_colleague::text
      and actor_id = (select id from auth.users where email = 'central@yuntera.example')),
    'the reset is in the audit trail with who did it';
end
$$;

-- Not an administrator: support staff, even with a second factor, and a shopper.
select pg_temp.login('colega-095@yuntera.example', 'aal2');
do $$
begin
  perform public.ops_reset_staff_factor(current_setting('t.admin')::uuid);
  raise exception 'support staff reset a factor';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example', 'aal2');
do $$
begin
  perform public.ops_staff_security();
  raise exception 'a shopper read the staff security list';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;

update public.app_settings set value = 'false' where key = 'require_staff_mfa';

-- ── The limit on wrong codes ───────────────────────────────────────────────
-- Every code is counted before it goes to Auth (mfa_reserve_attempt), so a
-- burst of parallel requests is held to the same five as one at a time; the
-- per-account advisory lock serialises the count. A right code takes back
-- only its own reservation, and only from a session that passed the step.

select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  s jsonb := public.mfa_attempt_status();
  r jsonb;
begin
  assert not (s ->> 'locked')::boolean and (s ->> 'attempts_left')::int = 5, format('fresh: %s', s);
  -- A right code: reserved, then given back.
  r := public.mfa_reserve_attempt();
  assert (r ->> 'attempt_id') is not null and (r ->> 'attempts_left')::int = 4, format('reserved: %s', r);
  perform public.mfa_attempt_succeeded((r ->> 'attempt_id')::bigint);
  assert (public.mfa_attempt_status() ->> 'attempts_left')::int = 5, 'a right code is not a failure';
  -- Wrong codes: the reservations stay.
  for i in 1..4 loop
    r := public.mfa_reserve_attempt();
  end loop;
  assert not (r ->> 'locked')::boolean and (r ->> 'attempts_left')::int = 1, format('after 4: %s', r);
  r := public.mfa_reserve_attempt();
  assert (r ->> 'attempt_id') is not null, 'the fifth code may still be tried';
  assert (r ->> 'locked')::boolean and (r ->> 'retry_after_seconds')::int between 850 and 900,
    format('and locks if wrong: %s', r);
  r := public.mfa_reserve_attempt();
  assert (r ->> 'attempt_id') is null and (r ->> 'locked')::boolean, format('a sixth is refused: %s', r);
  -- An id that is not one's own reservation changes nothing (checked below).
  perform public.mfa_attempt_succeeded(-1);
end
$$;
reset role;

do $$
begin
  assert (select count(*) from private.mfa_failures f join auth.users u on u.id = f.user_id
          where u.email = 'comprador3@yuntera.example') = 5,
    'no rows are added once locked';
end
$$;

-- An account with a factor cannot give a reservation back from a
-- password-only session (that would reopen the limit for a guesser).
select pg_temp.remember('c2_attempt', '');
select pg_temp.login('comprador2@yuntera.example');
select set_config('t.c2_attempt', public.mfa_reserve_attempt() ->> 'attempt_id', true);
reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), id, 'Teléfono', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'
from auth.users where email = 'comprador2@yuntera.example';
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  perform public.mfa_attempt_succeeded(current_setting('t.c2_attempt')::bigint);
  raise exception 'a reservation was given back at aal1';
exception when others then
  if sqlerrm <> 'second_factor_required' then raise; end if;
end
$$;
reset role;
delete from auth.mfa_factors f using auth.users u
where u.id = f.user_id and u.email = 'comprador2@yuntera.example';
delete from private.mfa_failures f using auth.users u
where u.id = f.user_id and u.email = 'comprador2@yuntera.example';

-- Another account is not affected; a visitor cannot ask.
select pg_temp.login('comprador2@yuntera.example');
select set_config('t.other_status', public.mfa_attempt_status()::text, true);
reset role;
do $$
begin
  assert (current_setting('t.other_status')::jsonb ->> 'attempts_left')::int = 5, 'per account';
end
$$;
select pg_temp.login_anon();
do $$
begin
  perform public.mfa_reserve_attempt();
  raise exception 'a visitor reserved an attempt';
exception when insufficient_privilege then null;
end
$$;
reset role;

-- The Auth hook: only Auth may call it, and it applies the same limit.
select pg_temp.login('comprador2@yuntera.example');
do $$
begin
  perform public.hook_mfa_verification_attempt('{}'::jsonb);
  raise exception 'a signed-in user called the Auth hook';
exception when insufficient_privilege then null;
end
$$;
reset role;
do $$
declare
  v_user uuid := (select id from auth.users where email = 'comprador2@yuntera.example');
  r jsonb;
begin
  r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', true));
  assert r ->> 'decision' = 'continue', 'a right code goes through';
  -- A code the apps reserved and Auth found wrong is counted once, not twice.
  insert into private.mfa_failures (user_id, reserved) values (v_user, true);
  r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', false));
  assert r ->> 'decision' = 'continue', 'a wrong code continues (Auth refuses it)';
  assert (select count(*) from private.mfa_failures where user_id = v_user) = 1
     and not exists (select 1 from private.mfa_failures where user_id = v_user and reserved),
    'the reservation became the failure';
  -- Codes sent to Auth directly, with no reservation, are counted by the hook.
  for i in 2..5 loop
    r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', false));
    assert r ->> 'decision' = 'continue', format('wrong code %s still continues', i);
  end loop;
  r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', true));
  assert r ->> 'decision' = 'reject', 'after five wrong codes even a right one is refused';
  -- With the apps' reservation for the attempt that was allowed, the hook does
  -- not count that reservation against the code it belongs to.
  delete from private.mfa_failures where user_id = v_user;
  for i in 1..4 loop
    insert into private.mfa_failures (user_id) values (v_user);
  end loop;
  insert into private.mfa_failures (user_id, reserved) values (v_user, true);
  r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', true));
  assert r ->> 'decision' = 'continue', 'the fifth attempt, reserved by the apps, is still judged';
  delete from private.mfa_failures where user_id = v_user;
end
$$;

-- ── Deleting an account: refused while something is pending ────────────────

-- Every row of every table in the schemas the platform owns that still holds
-- any of the given pieces of a person, as "schema.table: piece".
create function pg_temp.leftovers(p_needles jsonb) returns text
language plpgsql as $$
declare
  v_table record;
  v_needle text;
  v_found integer;
  v_where text[] := '{}';
begin
  for v_needle in select jsonb_array_elements_text(p_needles) loop
    for v_table in
      select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth')
    loop
      execute format('select count(*) from %I.%I t where t::text ilike %L',
                     v_table.nspname, v_table.relname, '%' || v_needle || '%')
        into v_found;
      if v_found > 0 then
        v_where := v_where || format('%s.%s: %s', v_table.nspname, v_table.relname, v_needle);
      end if;
    end loop;
  end loop;
  return nullif(array_to_string(v_where, '; '), '');
end;
$$;

-- The demo accounts each have a reason to stay.
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
begin
  assert public.account_deletion_check() -> 'blockers' ? 'account_is_staff', 'staff';
  perform public.delete_my_account();
  raise exception 'staff deleted their own account';
exception when others then
  if sqlerrm <> 'account_is_staff' then raise; end if;
end
$$;
reset role;

select pg_temp.login('repartidor@yuntera.example');
do $$
begin
  perform public.delete_my_account();
  raise exception 'a driver deleted their account';
exception when others then
  if sqlerrm <> 'account_is_driver' then raise; end if;
end
$$;
reset role;

select pg_temp.login('bodega@yuntera.example');
do $$
begin
  perform public.delete_my_account();
  raise exception 'a warehouse associate deleted their account';
exception when others then
  if sqlerrm <> 'account_is_warehouse_staff' then raise; end if;
end
$$;
reset role;

select pg_temp.login('vendedor@yuntera.example');
do $$
declare b jsonb := public.account_deletion_check() -> 'blockers';
begin
  assert b ? 'account_runs_open_shop', format('the only owner of open shops: %s', b);
  assert b ? 'account_shop_has_stock', format('stock: %s', b);
  assert b ? 'account_shop_has_open_orders', format('open shop orders: %s', b);
  assert b ? 'account_shop_has_balance', format('money owed: %s', b);
  perform public.delete_my_account();
  raise exception 'a seller with stock deleted their account';
exception when others then
  if sqlerrm <> 'account_runs_open_shop' then raise; end if;
end
$$;
reset role;

-- A shopper with an order on its way, then also an open return and complaint.
select pg_temp.remember('returnable', (
  select i.id::text from public.order_items i join public.orders o on o.id = i.order_id
  join auth.users u on u.id = o.user_id
  where u.email = 'comprador@yuntera.example' and o.status = 'delivered'
  order by o.placed_at, i.id limit 1));
select pg_temp.login('comprador@yuntera.example');
do $$
declare b jsonb;
begin
  begin
    perform public.delete_my_account();
    raise exception 'a shopper with an order in progress deleted their account';
  exception when others then
    if sqlerrm <> 'account_has_open_orders' then raise; end if;
  end;
  perform public.request_return(current_setting('t.returnable')::uuid, 'withdrawal', 1, null);
  perform public.file_complaint('delivery', 'El paquete llegó tarde y nadie avisó.', null);
  b := public.account_deletion_check() -> 'blockers';
  assert b ? 'account_has_open_orders' and b ? 'account_has_open_returns'
     and b ? 'account_has_open_complaints', format('shopper blockers: %s', b);
  assert (public.account_deletion_check() ->> 'orders_kept')::int > 0, 'counts what would be kept';
end
$$;
reset role;

select pg_temp.login_anon();
do $$
begin
  perform public.delete_my_account();
  raise exception 'a visitor called delete_my_account';
exception when insufficient_privilege then null;
end
$$;
reset role;

-- ── Deleting an account: allowed ───────────────────────────────────────────

-- The second demo shopper's open orders reach the end of their life, so only
-- history remains. A consent, an MFA failure, a factor, a session and a
-- pending token are added so each can be seen to go.
select pg_temp.remember('gone', (select id::text from auth.users where email = 'comprador2@yuntera.example'));
update public.orders set status = 'delivered', delivered_at = now()
where user_id = current_setting('t.gone')::uuid and status = 'shipped';
-- The paid order still to ship is cancelled by the shopper with live
-- payments: the order is cancelled at once, the money goes back later through
-- the gateway. Until it has, the account must stay.
update public.app_settings set value = '"live"' where key = 'payments_mode';
select pg_temp.remember('cancelled', (
  select id::text from public.orders
  where user_id = current_setting('t.gone')::uuid and status = 'confirmed' limit 1));
-- Real money (the seed's was simulated, and a simulated payment's refund
-- completes at once): a payment confirmed by hand, refunded by transfer.
update public.payments set provider = 'manual' where order_id = current_setting('t.cancelled')::uuid;
select pg_temp.login('comprador2@yuntera.example');
select public.cancel_order(current_setting('t.cancelled')::uuid);
do $$
declare b jsonb := public.account_deletion_check() -> 'blockers';
begin
  assert b = '["account_has_pending_refund"]'::jsonb, format('refund pending: %s', b);
  perform public.delete_my_account();
  raise exception 'an account was deleted while a refund was still owed to it';
exception when others then
  if sqlerrm <> 'account_has_pending_refund' then raise; end if;
end
$$;
reset role;
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
-- The gateway confirms the refund.
update public.payments set status = 'refunded', refunded_at = now()
where order_id = current_setting('t.cancelled')::uuid;
update public.orders set status = 'refunded' where id = current_setting('t.cancelled')::uuid;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), current_setting('t.gone')::uuid, 'x', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (gen_random_uuid(), current_setting('t.gone')::uuid, now(), now(), 'aal1');
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to)
values (gen_random_uuid(), current_setting('t.gone')::uuid, 'recovery_token', 'abc', 'comprador2@yuntera.example');
-- The person has had messages (20261121082600_notifications.sql): channel
-- choices with a WhatsApp number, a commercial consent, a phone registered for
-- push, messages planned for an event about one of the orders, one of them on
-- its way with its frozen text, and suppressions for the e-mail and the number.
select pg_temp.login('comprador2@yuntera.example', 'aal2');
select public.set_my_notification_settings(true, true, false, true, '8777 4321', true, 'comercial-2026-11');
select public.register_push_token('shop', 'ExponentPushToken[cuentaBorrada0001]', 'android', 'telefono-de-prueba');
reset role;
insert into private.outbox_events (topic, payload)
select 'order.placed', jsonb_build_object('order_id', o.id)
from public.orders o where o.user_id = current_setting('t.gone')::uuid and o.status = 'delivered'
order by o.placed_at limit 1;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.worker_notify_plan(100);
select public.worker_notify_claim('prueba-borrado', 100);
reset role;
select pg_temp.remember('frozen', (
  select d.id::text || '|' || d.generation from private.notification_deliveries d
  where d.recipient_user_id = current_setting('t.gone')::uuid and d.channel = 'email' and d.status = 'sending'
  limit 1));
set local role service_role;
select public.worker_notify_freeze(split_part(current_setting('t.frozen'), '|', 1)::uuid, 'prueba-borrado',
  split_part(current_setting('t.frozen'), '|', 2)::int,
  '{"to":"comprador2@yuntera.example","whatsapp":"+50687774321"}');
reset role;
insert into private.notification_suppressions (channel, address, reason)
values ('whatsapp', '+50687774321', 'opt_out'), ('email', 'comprador2@yuntera.example', 'complaint');
do $$
begin
  assert (select count(*) from private.notification_deliveries
          where recipient_user_id = current_setting('t.gone')::uuid) >= 3,
    'messages were planned for the person';
  assert exists (select 1 from private.notification_deliveries
                 where recipient_user_id = current_setting('t.gone')::uuid and request_body is not null),
    'one of them holds its frozen text';
  assert exists (select 1 from private.commercial_consent_log where user_id = current_setting('t.gone')::uuid),
    'the commercial consent is on record';
end
$$;
-- The person has also used what the hardening added (082900, 083000): a
-- return of a damaged product, recorded back and refunded through the refund
-- register, its reason giving their name; two invitations to join a shop, to
-- their address, one declined and one still waiting; and a report. A driver
-- typed a wrong delivery code at their door once (written directly here: the
-- route steps that produce it are tested in 115_integrity).
select pg_temp.remember('gone_item', (
  select i.id::text from public.order_items i join public.orders o on o.id = i.order_id
  where o.user_id = current_setting('t.gone')::uuid and private.delivered_units(i.id) > 0
    and not exists (select 1 from public.return_requests r where r.order_item_id = i.id)
  order by i.id limit 1));
select pg_temp.remember('gone_name', (select full_name from public.profiles where id = current_setting('t.gone')::uuid));
select pg_temp.remember('gone_shop_a', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('gone_shop_b', (select id::text from public.sellers where slug = 'tienda-sendero'));
select pg_temp.remember('gone_report_target', (select id::text from public.products where slug = 'parlante-bluetooth-nimbo-ola'));
select pg_temp.login('comprador2@yuntera.example', 'aal2');
select set_config('t.gone_return', public.request_return(current_setting('t.gone_item')::uuid, 'damaged', 1,
  'Llegó roto; lo recibió ' || current_setting('t.gone_name') || ' en la puerta.')::text, true);
select public.report_content('product', current_setting('t.gone_report_target')::uuid,
  'misleading', 'La foto no coincide con el producto.');
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_decide_return(current_setting('t.gone_return')::uuid, true, 'Foto recibida.');
select public.ops_receive_return(current_setting('t.gone_return')::uuid, false, 'Llegó golpeado.');
select public.ops_complete_return(current_setting('t.gone_return')::uuid, 'Reembolso enviado.');
reset role;
select pg_temp.login('vendedor@yuntera.example');
select set_config('t.gone_invitation', public.seller_invite_member(
  current_setting('t.gone_shop_a')::uuid, 'comprador2@yuntera.example', 'staff')::text, true);
reset role;
select pg_temp.login('sendero@yuntera.example');
select public.seller_invite_member(
  current_setting('t.gone_shop_b')::uuid, 'comprador2@yuntera.example', 'staff');
reset role;
select pg_temp.login('comprador2@yuntera.example', 'aal2');
select public.seller_answer_invitation(current_setting('t.gone_invitation')::uuid, false);
reset role;
insert into private.delivery_code_attempts (order_id, driver_id)
select o.id, (select d.id from public.drivers d order by d.id limit 1)
from public.orders o where o.user_id = current_setting('t.gone')::uuid order by o.placed_at limit 1;
do $$
begin
  assert exists (select 1 from private.refunds f join public.return_requests r on r.id = f.source_id
                 where f.reason = 'return' and r.id = current_setting('t.gone_return')::uuid),
    'the refund is in the register';
  assert (select count(*) from public.seller_invitations i
          where i.invitee_id = current_setting('t.gone')::uuid) = 2, 'two invitations to the person';
  assert exists (select 1 from private.delivery_codes c join public.orders o on o.id = c.order_id
                 where o.user_id = current_setting('t.gone')::uuid), 'their orders have delivery codes';
end
$$;
select pg_temp.remember('gone_refunds', (
  select count(*) || ':' || sum(f.amount_minor) from private.refunds f
  join public.orders o on o.id = f.order_id where o.user_id = current_setting('t.gone')::uuid));
select pg_temp.remember('gone_attempts', (
  select count(*)::text from private.delivery_code_attempts a
  join public.orders o on o.id = a.order_id where o.user_id = current_setting('t.gone')::uuid));
-- And what the follow-ups added (083200, 083300): a second return claim, its
-- reason naming them, withdrawn before staff decided; a delivery code locked
-- and released on one of their orders, which messages them and support; the
-- invitations above, which now message them too; all planned, and the one the
-- worker can claim (messages to one person go out in order, after the earlier
-- ones still waiting) frozen with their name and address in it. The apps' sign-in limit
-- counted them signing in, as a keyed hash of their address and e-mail.
select pg_temp.remember('gone_item2', (
  select i.id::text from public.order_items i join public.orders o on o.id = i.order_id
  where o.user_id = current_setting('t.gone')::uuid and private.delivered_units(i.id) > 0
    and not exists (select 1 from public.return_requests r where r.order_item_id = i.id)
  order by i.id limit 1));
select pg_temp.login('comprador2@yuntera.example', 'aal2');
select set_config('t.gone_withdrawn', public.request_return(current_setting('t.gone_item2')::uuid,
  'damaged', 1, 'Me equivoqué; soy ' || current_setting('t.gone_name') || '.')::text, true);
select public.withdraw_return_request(current_setting('t.gone_withdrawn')::uuid);
reset role;
insert into private.outbox_events (topic, payload)
select t.topic, jsonb_build_object('order_id', o.id)
from (select o.id from public.orders o where o.user_id = current_setting('t.gone')::uuid
      order by o.placed_at limit 1) o
cross join (values ('delivery_code.locked'), ('delivery_code.released')) t (topic);
select pg_temp.login_anon();
select public.auth_limit_reserve('sign_in', repeat('a', 64), repeat('b', 64));
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.worker_notify_plan(100);
select public.worker_notify_claim('prueba-borrado-2', 100);
reset role;
select pg_temp.remember('frozen2', (
  select d.id::text || '|' || d.generation from private.notification_deliveries d
  where d.recipient_user_id = current_setting('t.gone')::uuid
    and d.template in ('delivery_code_locked', 'delivery_code_released', 'seller_invitation')
    and d.channel = 'email' and d.status = 'sending'
  limit 1));
set local role service_role;
select public.worker_notify_freeze(split_part(current_setting('t.frozen2'), '|', 1)::uuid, 'prueba-borrado-2',
  split_part(current_setting('t.frozen2'), '|', 2)::int,
  json_build_object('to', 'comprador2@yuntera.example', 'name', current_setting('t.gone_name'))::text);
reset role;
do $$
begin
  assert (select withdrawn_at is not null and reason like '%' || current_setting('t.gone_name') || '%'
          from public.return_requests where id = current_setting('t.gone_withdrawn')::uuid),
    'the withdrawn claim names the person';
  assert (select count(*) from private.notification_deliveries
          where recipient_user_id = current_setting('t.gone')::uuid
            and template in ('delivery_code_locked', 'delivery_code_released', 'seller_invitation')) >= 3,
    'the new messages were planned for the person';
  assert exists (select 1 from private.notification_deliveries
                 where template = 'staff_delivery_code_locked'
                   and context ->> 'order_id' in (select id::text from public.orders
                                                  where user_id = current_setting('t.gone')::uuid)),
    'support was told about the locked code';
  assert exists (select 1 from private.auth_attempts where account_hash = repeat('b', 64)),
    'the sign-in limit counted the attempt';
end
$$;
-- What identifies the person, to search for afterwards in every table.
select pg_temp.remember('needles', (
  select jsonb_build_array(u.email, p.full_name, a.phone, a.senas, a.recipient_name,
                           '+50687774321', 'cuentaBorrada0001')::text
  from auth.users u join public.profiles p on p.id = u.id
  join public.addresses a on a.user_id = u.id
  where u.id = current_setting('t.gone')::uuid limit 1));
select pg_temp.remember('orders_before', (
  select count(*) || ':' || sum(total_minor) from public.orders where user_id = current_setting('t.gone')::uuid));
select pg_temp.remember('reviews_before', (
  select count(*)::text from public.reviews where user_id = current_setting('t.gone')::uuid));
select pg_temp.remember('deletions_before', (select count(*)::text from private.account_deletions));

-- The account now has a factor, so the deletion needs a session that passed it.
select pg_temp.login('comprador2@yuntera.example', 'aal2');
do $$
declare r jsonb;
begin
  perform public.record_consent('marketing', '2026-11');
  perform public.mfa_reserve_attempt();
  assert jsonb_array_length(public.account_deletion_check() -> 'blockers') = 0, 'nothing pending';
  r := public.delete_my_account();
  assert (r ->> 'orders_kept')::int = 5 and (r ->> 'reviews_kept')::int = 6, format('result: %s', r);
  -- The token in hand still identifies the old id for up to an hour; a second
  -- deletion with it finds nothing to delete.
  begin
    perform public.delete_my_account();
    raise exception 'the account was deleted twice';
  exception when others then
    if sqlerrm <> 'not_authenticated' then raise; end if;
  end;
end
$$;
reset role;

-- What remains, table by table.
do $$
declare
  v_user uuid := current_setting('t.gone')::uuid;
  u record;
begin
  select * into u from auth.users where id = v_user;
  assert u.email = v_user::text || '@cuenta-eliminada.invalid', format('e-mail replaced: %s', u.email);
  assert u.encrypted_password = '' and u.raw_user_meta_data = '{}'::jsonb and u.phone is null,
    'password and metadata erased';
  assert u.banned_until > now() + interval '99 years' and u.banned_until < 'infinity'
     and u.deleted_at is not null, 'sign-in impossible, with a ban Auth can read';
  assert not exists (select 1 from auth.identities where user_id = v_user), 'identities';
  assert not exists (select 1 from auth.sessions where user_id = v_user), 'sessions';
  assert not exists (select 1 from auth.mfa_factors where user_id = v_user), 'factors';
  assert not exists (select 1 from auth.one_time_tokens where user_id = v_user), 'pending tokens';
  assert (select full_name is null and phone is null and not marketing_opt_in
          from public.profiles where id = v_user), 'profile';
  assert not exists (select 1 from public.addresses where user_id = v_user), 'addresses';
  assert not exists (select 1 from public.consents where user_id = v_user), 'consents';
  assert not exists (select 1 from private.mfa_failures where user_id = v_user), 'mfa failures';
  -- What the notifications held (20261121082600).
  assert not exists (select 1 from private.notification_preferences where user_id = v_user),
    'notification preferences';
  assert not exists (select 1 from private.commercial_consent_log where user_id = v_user),
    'the commercial-consent history';
  assert not exists (select 1 from private.push_tokens where user_id = v_user), 'push tokens';
  assert not exists (select 1 from private.notification_suppressions
                     where address in ('+50687774321', 'comprador2@yuntera.example')),
    'suppressions of addresses only the person used';
  assert not exists (select 1 from private.notification_deliveries
                     where recipient_user_id = v_user
                       and (status in ('pending', 'sending') or request_body is not null)),
    'nothing left to send to the person, and no frozen text';
  assert not exists (select 1 from public.orders where user_id = v_user
                     and (ship_recipient_name <> 'Cuenta eliminada' or ship_phone <> ''
                          or ship_senas <> '' or ship_plus_code is not null)),
    'shipping details on kept orders';
  assert not exists (
    select 1 from public.route_stops rs join public.shipments sh on sh.id = rs.shipment_id
    join public.orders o on o.id = sh.order_id
    where o.user_id = v_user and (rs.recipient_name <> 'Cuenta eliminada' or rs.phone <> '')),
    'details on route stops';
  assert public.reviewer_display_name(v_user) = 'Cliente', 'reviews no longer carry a name';
  assert (select count(*)::text from public.reviews where user_id = v_user)
         = current_setting('t.reviews_before'), 'reviews stay published';

  -- What the hardening added (082900, 083000).
  assert not exists (select 1 from public.seller_invitations i
                     where i.invitee_id = v_user or i.email = 'comprador2@yuntera.example'),
    'invitations to the person';
  assert not exists (select 1 from private.delivery_codes c join public.orders o on o.id = c.order_id
                     where o.user_id = v_user), 'the delivery codes of their orders';
  assert (select count(*)::text from private.delivery_code_attempts a
          join public.orders o on o.id = a.order_id where o.user_id = v_user)
         = current_setting('t.gone_attempts'), 'the log of wrong codes, which names drivers, stays';
  assert (select count(*) || ':' || sum(f.amount_minor) from private.refunds f
          join public.orders o on o.id = f.order_id where o.user_id = v_user)
         = current_setting('t.gone_refunds'), 'every refund stays in the register, amounts unchanged';
  assert (select reason is null and status = 'refunded' from public.return_requests
          where id = current_setting('t.gone_return')::uuid), 'the return stays refunded, without its reason';

  -- What the follow-ups added (083200, 083300).
  assert (select reason is null and withdrawn_at is not null from public.return_requests
          where id = current_setting('t.gone_withdrawn')::uuid),
    'the withdrawn claim stays withdrawn, without its reason';
  assert not exists (select 1 from private.notification_deliveries
                     where recipient_user_id = v_user
                       and template in ('delivery_code_locked', 'delivery_code_released', 'seller_invitation')
                       and (status in ('pending', 'sending') or request_body is not null)),
    'none of the new messages to the person is left to send or holds its text';
  -- The sign-in limit holds keyed hashes only, which the database cannot
  -- link to the person (the key is in the apps), for two hours at most.
  assert not exists (select 1 from private.auth_attempts a
                     where a.address_hash !~ '^[0-9a-f]{64}$' or a.account_hash !~ '^[0-9a-f]{64}$'),
    'the sign-in limit holds nothing but hashes';

  -- Kept records still add up.
  assert (select count(*) || ':' || sum(total_minor) from public.orders where user_id = v_user)
         = current_setting('t.orders_before'), 'order count and totals unchanged';
  assert not exists (
    select 1 from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
    join public.orders o on o.id = t.order_id
    where o.user_id = v_user group by t.id having sum(e.amount_minor) <> 0),
    'every kept ledger transaction still sums to zero';

  -- The register says a deletion happened, and cannot say whose.
  assert (select count(*) from private.account_deletions)
         = current_setting('t.deletions_before')::int + 1, 'deletion recorded';
  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'private' and table_name = 'account_deletions'
                       and data_type in ('uuid', 'text', 'timestamp with time zone')),
    'the register holds no id, text or exact time';
end
$$;

-- Nothing that identified the person is left anywhere: every row of every
-- table in the schemas the platform owns, searched for each piece.
select pg_temp.remember('leftovers', coalesce(pg_temp.leftovers(current_setting('t.needles')::jsonb), ''));
do $$
begin
  assert current_setting('t.leftovers') = '',
    format('still holds a piece of the deleted account: %s', current_setting('t.leftovers'));
end
$$;

-- The access token issued before the deletion stops working at once: the
-- Data API's pre-request check finds the account gone.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gone'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
do $$
begin
  perform set_config('request.path', '/rpc/save_address', true);
  perform public.check_request();
  raise exception 'a deleted account''s token was accepted';
exception when others then
  if sqlerrm <> 'session_ended' then raise; end if;
end
$$;
reset role;

-- The address can sign up again, as a new account.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change,
   email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
   'comprador2@yuntera.example', '', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', '');
do $$
begin
  assert (select count(*) from public.profiles p join auth.users u on u.id = p.id
          where u.email = 'comprador2@yuntera.example') = 1, 'the new account gets its own profile';
  assert not exists (select 1 from public.orders o join auth.users u on u.id = o.user_id
                     where u.email = 'comprador2@yuntera.example'), 'and none of the old history';
end
$$;

-- ── A former driver ────────────────────────────────────────────────────────
-- Operations offboards the driver (an audited change of status); then the
-- driver deletes the account. Nothing of the name, phone, ID number or plate
-- is left anywhere, the audit trail included.
select pg_temp.remember('driver_needles', (
  select jsonb_build_array(d.full_name, d.phone, d.id_number, d.plate)::text
  from public.drivers d join auth.users u on u.id = d.user_id
  where u.email = 'repartidor2@yuntera.example'));
select pg_temp.remember('driver_user', (select id::text from auth.users where email = 'repartidor2@yuntera.example'));
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_set_driver_status(
  (select d.id from public.drivers d where d.user_id = current_setting('t.driver_user')::uuid), 'offboarded');
reset role;
select pg_temp.login('repartidor2@yuntera.example');
do $$
begin
  assert jsonb_array_length(public.account_deletion_check() -> 'blockers') = 0, 'offboarded: nothing pending';
  perform public.delete_my_account();
end
$$;
reset role;
select pg_temp.remember('leftovers', coalesce(pg_temp.leftovers(current_setting('t.driver_needles')::jsonb), ''));
do $$
begin
  assert current_setting('t.leftovers') = '',
    format('a former driver''s details remain: %s', current_setting('t.leftovers'));
  assert exists (select 1 from private.audit_log where table_name = 'drivers'
                 and new_row ->> 'status' = 'offboarded'), 'the offboarding itself is still on record';
end
$$;

-- ── The only owner of a shop ───────────────────────────────────────────────
-- Laura is the only owner of a shop still waiting for approval, which has
-- never sold anything. While it is open she must ask for it to be closed;
-- once Yuntera has suspended it, her account can go, and the shop's private
-- details with it (nothing was ever invoiced under them).
select pg_temp.remember('bazar_shop', (
  select m.seller_id::text from public.seller_members m join auth.users u on u.id = m.user_id
  where u.email = 'bazar@yuntera.example'));
select pg_temp.remember('bazar_needles', (
  select jsonb_build_array(sp.legal_name, sp.id_number, sp.contact_phone, sp.fiscal_address,
                           'bazar@yuntera.example', 'Laura sonriendo en su puesto del bazar',
                           'laura.bazar@correo.example', '+50688112233', 'socia.bazar@correo.example')::text
  from public.seller_private sp where sp.seller_id = current_setting('t.bazar_shop')::uuid));
-- She also invited a partner to the team and asked to change the shop's
-- contact to her own address and phone (20261121083000_limits.sql).
select pg_temp.login('bazar@yuntera.example');
select public.seller_invite_member(current_setting('t.bazar_shop')::uuid, 'socia.bazar@correo.example', 'staff');
select public.seller_request_shop_change(current_setting('t.bazar_shop')::uuid, 'contact',
  p_contact_email => 'laura.bazar@correo.example', p_contact_phone => '+506 8811 2233');
reset role;
-- Before that she uploaded a photo for a draft listing, described with her own
-- name (20261121082700_product_photos.sql): it waits for review.
select pg_temp.login('bazar@yuntera.example');
do $$
declare
  created jsonb;
  r jsonb;
  f jsonb;
begin
  created := public.seller_create_listing(
    current_setting('t.bazar_shop')::uuid, 'Canasta tejida a mano', 'hogar',
    'Canasta de fibra natural.', array['Hecha a mano'], 1500000, 'seller', 2::smallint,
    600, 30, 30, 20, false);
  r := public.seller_reserve_photo((created ->> 'product_id')::uuid);
  perform set_config('storage.operation', 'storage.object.upload', true);
  for f in select * from jsonb_array_elements(r -> 'files') loop
    insert into storage.objects (bucket_id, name, owner_id, metadata, version)
    values ('product-photos-pending', f ->> 'path', auth.uid()::text,
            jsonb_build_object('mimetype', 'image/jpeg', 'size', 90000, 'eTag', '"e' || (f ->> 'size') || '"'),
            gen_random_uuid()::text);
  end loop;
  perform set_config('storage.operation', '', true);
  perform public.seller_finish_photo((r ->> 'photo_id')::uuid, 'Laura sonriendo en su puesto del bazar', 1600, 1200);
  perform set_config('t.bazar_photo', r ->> 'photo_id', true);
end
$$;
reset role;
do $$
begin
  assert (select state from public.product_photos where id = current_setting('t.bazar_photo')::uuid) = 'pending',
    'the photo waits for review';
end
$$;
select pg_temp.login('bazar@yuntera.example');
do $$
begin
  perform public.delete_my_account();
  raise exception 'the only owner of an open shop deleted the account';
exception when others then
  if sqlerrm <> 'account_runs_open_shop' then raise; end if;
end
$$;
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_set_seller_status(current_setting('t.bazar_shop')::uuid, 'suspended',
                                    'La persona dueña pidió cerrar la tienda.');
reset role;
select pg_temp.login('bazar@yuntera.example');
do $$ begin perform public.delete_my_account(); end $$;
reset role;
select pg_temp.remember('leftovers', coalesce(pg_temp.leftovers(current_setting('t.bazar_needles')::jsonb), ''));
do $$
begin
  assert current_setting('t.leftovers') = '',
    format('the shop owner''s details remain: %s', current_setting('t.leftovers'));
  assert (select status from public.sellers where id = current_setting('t.bazar_shop')::uuid) = 'closed',
    'the shop left with nobody in charge is closed';
  assert not exists (select 1 from public.seller_members where seller_id = current_setting('t.bazar_shop')::uuid),
    'and has no members';
  assert not exists (select 1 from public.seller_invitations where seller_id = current_setting('t.bazar_shop')::uuid),
    'nor invitations';
  assert not exists (select 1 from public.seller_change_requests where seller_id = current_setting('t.bazar_shop')::uuid),
    'nor change requests';
  -- Her photo leaves the review queue and the shop; its files are now
  -- disposable for the console's next clean-up.
  assert (select state from public.product_photos where id = current_setting('t.bazar_photo')::uuid) = 'removed',
    'the closed shop''s photo is removed';
  assert exists (select 1 from storage.objects o
                 where o.bucket_id = 'product-photos-pending'
                   and o.name like current_setting('t.bazar_shop') || '/%'
                   and private.photo_object_disposable(o.bucket_id, o.name, o.created_at)),
    'and its files can be deleted';
end
$$;

-- A shop that has traded keeps its legal name and identification number for
-- the tax retention period, but not its contact or bank details: Ferretería
-- El Higuerón, closed this way in this rolled-back transaction.
select pg_temp.remember('traded_shop', (select id::text from public.sellers where slug = 'ferreteria-el-higueron'));
select pg_temp.remember('traded_needles', (
  -- (The holder of the payout account is the owner, whose name as a sole
  -- trader is also the shop's legal name, which is kept.)
  select jsonb_build_array(sp.contact_email, sp.contact_phone, sp.payout_iban,
                           sp.fiscal_address, sp.sinpe_movil_number)::text
  from public.seller_private sp where sp.seller_id = current_setting('t.traded_shop')::uuid));
select pg_temp.remember('traded_identity', (
  select sp.legal_name || '|' || sp.id_number
  from public.seller_private sp where sp.seller_id = current_setting('t.traded_shop')::uuid));
-- A request to change the payout account (082300) holds an account number, its
-- holder and a SINPE number: it goes with the shop.
insert into public.payout_detail_requests (seller_id, payout_iban, payout_holder_name, sinpe_movil_number, requested_by)
select current_setting('t.traded_shop')::uuid, 'CR11015108410026019999', 'Titular De Prueba', '+50687779999', m.user_id
from public.seller_members m where m.seller_id = current_setting('t.traded_shop')::uuid limit 1;
select pg_temp.remember('traded_iban_last4', (
  select right(sp.payout_iban, 4) from public.seller_private sp
  where sp.seller_id = current_setting('t.traded_shop')::uuid));
select private.close_abandoned_shop(current_setting('t.traded_shop')::uuid);
do $$
declare r record;
begin
  assert not exists (select 1 from public.payout_detail_requests
                     where seller_id = current_setting('t.traded_shop')::uuid),
    'the closed shop''s payout-account requests are gone';
  -- Both audit rules hold in the same row: the payout account keeps only its
  -- last four digits (082300), and the shop's personal columns are left out,
  -- with the names of those that changed (082500).
  select * into r from private.audit_log l
  where l.table_name = 'seller_private' and l.action = 'UPDATE'
    and l.row_key = current_setting('t.traded_shop')
  order by l.id desc limit 1;
  assert r.old_row ->> 'payout_iban_masked' = 'CR•• •••• •••• •••• ' || current_setting('t.traded_iban_last4'),
    format('the old account keeps its last four digits: %s', r.old_row);
  assert not (r.old_row ? 'payout_iban') and not (r.new_row ? 'payout_iban'),
    'never the whole account number';
  assert not (r.old_row ?| array['contact_email', 'contact_phone', 'fiscal_address', 'payout_holder_name'])
     and not (r.new_row ?| array['contact_email', 'contact_phone', 'fiscal_address', 'payout_holder_name']),
    format('no personal column of the shop: %s', r.new_row);
  assert r.new_row -> 'changed_private' ?& array['contact_email', 'contact_phone', 'payout_iban'],
    format('the changed columns are named: %s', r.new_row -> 'changed_private');
end
$$;
-- (The same owner runs another shop with the same contact details, so the
-- search is limited to this shop's own row and its audit trail.)
do $$
declare v_needle text;
begin
  for v_needle in select jsonb_array_elements_text(current_setting('t.traded_needles')::jsonb) loop
    assert not exists (select 1 from public.seller_private sp
                       where sp.seller_id = current_setting('t.traded_shop')::uuid
                         and sp::text ilike '%' || v_needle || '%'),
      format('the closed shop still holds %s', v_needle);
    assert not exists (select 1 from private.audit_log l
                       where l.row_key = current_setting('t.traded_shop')
                         and l::text ilike '%' || v_needle || '%'),
      format('the audit trail still holds %s', v_needle);
  end loop;
  assert (select sp.payout_holder_name is null from public.seller_private sp
          where sp.seller_id = current_setting('t.traded_shop')::uuid), 'payout holder erased';
  assert (select sp.legal_name || '|' || sp.id_number from public.seller_private sp
          where sp.seller_id = current_setting('t.traded_shop')::uuid) = current_setting('t.traded_identity'),
    'the legal identity stays with the shop''s invoices';
  assert (select status from public.sellers where id = current_setting('t.traded_shop')::uuid) = 'closed',
    'and the shop is closed';
end
$$;

-- ── Every table that refers to an account is accounted for ─────────────────

-- A new table pointing at auth.users must be added to delete_my_account (or
-- to this list, with the reason it may keep the id), or this fails.
do $$
declare v_unhandled text;
begin
  select string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') into v_unhandled
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
    and c.conrelid::regclass::text not like 'auth.%'
    and format('%s.%s', c.conrelid::regclass, a.attname) not in (
      -- erased or anonymised by delete_my_account
      'profiles.id', 'addresses.user_id', 'consents.user_id', 'staff_members.user_id',
      'seller_members.user_id', 'drivers.user_id', 'orders.user_id', 'reviews.user_id',
      'return_requests.user_id', 'complaints.user_id', 'content_reports.reporter_id',
      -- blocks deletion while present
      'warehouse_staff.user_id',
      -- who did something at work (staff, warehouse, driver, the shopper's own
      -- cancellation): kept as a bare id, which no longer leads to a person
      'order_events.actor_id', 'stock_movements.actor_id', 'inbound_shipments.created_by',
      'pick_tasks.picked_by', 'routes.created_by', 'driver_settlements.settled_by',
      'ledger_transactions.created_by', 'content_reports.resolved_by',
      'return_requests.decided_by', 'return_requests.refunded_by',
      -- the same, for payouts and listing edits (082300, 082400): who asked for
      -- a payout account, who decided, who ran or marked a payout, who proposed
      -- or decided a listing change
      'payout_detail_requests.requested_by', 'payout_detail_requests.decided_by',
      'payout_runs.created_by', 'payouts.paid_by', 'payouts.failed_by',
      'product_change_requests.submitted_by', 'product_change_requests.decided_by',
      -- erased by notify_forget_person (082600)
      'private.notification_preferences.user_id', 'private.commercial_consent_log.user_id',
      'private.push_tokens.user_id',
      -- kept without a message body: what was sent to the person, and who
      -- changed a shop's settings, recorded consent or retried a message
      'private.notification_deliveries.recipient_user_id', 'private.notification_preferences.updated_by',
      'private.commercial_consent_log.actor_id', 'private.notification_deliveries.retried_by',
      -- who uploaded or decided a shop's photo (082700): the photo is the
      -- shop's, and closing a shop with nobody in charge removes its photos
      'product_photos.created_by', 'product_photos.decided_by',
      -- the hardening (082900, 083000): invitations to the person are erased
      -- by delete_my_account, and close_abandoned_shop removes a closed
      -- shop's invitations and change requests
      'seller_invitations.invitee_id',
      -- kept as a bare id: who recorded a return back, released a locked
      -- delivery code, booked a refund, sent or answered an invitation, asked
      -- for or decided a shop change, or approved a payout account. The
      -- person's own requests that never took effect are emptied.
      'return_requests.received_by', 'private.delivery_codes.released_by', 'private.refunds.created_by',
      'seller_invitations.invited_by', 'seller_invitations.answered_by',
      'seller_change_requests.requested_by', 'seller_change_requests.decided_by',
      'seller_private.payout_approved_by',
      -- what a shopper typed at checkout for a factura (083500): erased by a
      -- trigger when the account is deleted, and used up when the document is made
      'private.invoice_checkout_receivers.user_id');
  assert v_unhandled is null, format('not handled by account deletion: %s', v_unhandled);
end
$$;

rollback;
