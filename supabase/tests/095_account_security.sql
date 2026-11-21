-- Account security: the staff second-factor gate, the limit on wrong codes, an
-- administrator resetting a colleague's factor, and deleting an account. Each
-- function is checked for the right caller, the wrong caller and what it
-- leaves behind. Runs on the local shim and on a hosted project alike: the
-- rows it adds to the `auth` tables use the columns both have.

begin;
\ir _helpers.sql

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
-- The administrator has a factor too.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), id, 'Teléfono', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
from auth.users where email = 'central@yuntera.example';

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

select pg_temp.login('comprador3@yuntera.example');
do $$
declare s jsonb := public.mfa_attempt_status();
begin
  assert not (s ->> 'locked')::boolean and (s ->> 'attempts_left')::int = 5, format('fresh: %s', s);
  for i in 1..4 loop
    s := public.mfa_record_failure();
  end loop;
  assert not (s ->> 'locked')::boolean and (s ->> 'attempts_left')::int = 1, format('after 4: %s', s);
  s := public.mfa_record_failure();
  assert (s ->> 'locked')::boolean and (s ->> 'retry_after_seconds')::int between 850 and 900,
    format('locked after 5: %s', s);
  s := public.mfa_record_failure();
  assert (s ->> 'locked')::boolean, 'stays locked';
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
  perform public.mfa_record_failure();
  raise exception 'a visitor recorded a failure';
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
  v_user text := (select id::text from auth.users where email = 'comprador2@yuntera.example');
  r jsonb;
begin
  r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', true));
  assert r ->> 'decision' = 'continue', 'a right code goes through';
  for i in 1..4 loop
    r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', false));
    assert r ->> 'decision' = 'continue', format('wrong code %s still continues', i);
  end loop;
  r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', false));
  assert r ->> 'decision' = 'reject', 'the fifth wrong code rejects';
  r := public.hook_mfa_verification_attempt(jsonb_build_object('user_id', v_user, 'valid', true));
  assert r ->> 'decision' = 'reject', 'even a right code is refused while locked';
end
$$;

-- ── Deleting an account: refused while something is pending ────────────────

-- The demo accounts each have a reason to stay.
select pg_temp.login('central@yuntera.example');
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
  assert b ? 'account_shop_has_stock', format('stock: %s', b);
  assert b ? 'account_shop_has_open_orders', format('open shop orders: %s', b);
  assert b ? 'account_shop_has_balance', format('money owed: %s', b);
  perform public.delete_my_account();
  raise exception 'a seller with stock deleted their account';
exception when others then
  if sqlerrm <> 'account_shop_has_stock' then raise; end if;
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
update public.orders set status = 'cancelled', cancelled_at = now()
where user_id = current_setting('t.gone')::uuid and status = 'confirmed';
update public.orders set status = 'delivered', delivered_at = now()
where user_id = current_setting('t.gone')::uuid and status = 'shipped';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), current_setting('t.gone')::uuid, 'x', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (gen_random_uuid(), current_setting('t.gone')::uuid, now(), now(), 'aal1');
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to)
values (gen_random_uuid(), current_setting('t.gone')::uuid, 'recovery_token', 'abc', 'comprador2@yuntera.example');
-- What identifies the person, to search for afterwards in every table.
select pg_temp.remember('needles', (
  select jsonb_build_array(u.email, p.full_name, a.phone, a.senas, a.recipient_name)::text
  from auth.users u join public.profiles p on p.id = u.id
  join public.addresses a on a.user_id = u.id
  where u.id = current_setting('t.gone')::uuid limit 1));
select pg_temp.remember('orders_before', (
  select count(*) || ':' || sum(total_minor) from public.orders where user_id = current_setting('t.gone')::uuid));
select pg_temp.remember('reviews_before', (
  select count(*)::text from public.reviews where user_id = current_setting('t.gone')::uuid));
select pg_temp.remember('deletions_before', (select count(*)::text from private.account_deletions));

select pg_temp.login('comprador2@yuntera.example');
do $$
declare r jsonb;
begin
  perform public.record_consent('marketing', '2026-11');
  perform public.mfa_record_failure();
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
  assert u.banned_until = 'infinity' and u.deleted_at is not null, 'sign-in impossible';
  assert not exists (select 1 from auth.identities where user_id = v_user), 'identities';
  assert not exists (select 1 from auth.sessions where user_id = v_user), 'sessions';
  assert not exists (select 1 from auth.mfa_factors where user_id = v_user), 'factors';
  assert not exists (select 1 from auth.one_time_tokens where user_id = v_user), 'pending tokens';
  assert (select full_name is null and phone is null and not marketing_opt_in
          from public.profiles where id = v_user), 'profile';
  assert not exists (select 1 from public.addresses where user_id = v_user), 'addresses';
  assert not exists (select 1 from public.consents where user_id = v_user), 'consents';
  assert not exists (select 1 from private.mfa_failures where user_id = v_user), 'mfa failures';
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
do $$
declare
  v_table record;
  v_needle text;
  v_found integer;
begin
  for v_needle in select jsonb_array_elements_text(current_setting('t.needles')::jsonb) loop
    for v_table in
      select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth')
    loop
      execute format('select count(*) from %I.%I t where t::text ilike %L',
                     v_table.nspname, v_table.relname, '%' || v_needle || '%')
        into v_found;
      assert v_found = 0,
        format('%s.%s still holds a piece of the deleted account', v_table.nspname, v_table.relname);
    end loop;
  end loop;
end
$$;

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
      'return_requests.decided_by', 'return_requests.refunded_by');
  assert v_unhandled is null, format('not handled by account deletion: %s', v_unhandled);
end
$$;

rollback;
