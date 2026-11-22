-- The apps' own limit on sign-in, sign-up, account e-mails, codes and session
-- refreshes (supabase/migrations/20261121083300_web_followups.sql, finding
-- WEB-2 of the review of 21 November 2026).
--
-- Each section starts from the superuser with nobody signed in. The callers
-- are the ones the apps use: a visitor (the apps call these functions without
-- a session, before anyone has signed in) and, where it matters, a signed-in
-- user. Time passing is simulated by moving the recorded attempts back.

begin;
\ir _helpers.sql

-- Runs a statement that must be refused with the given code.
create function pg_temp.refused(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
end;
$$;

-- Runs a statement the current role has no privilege for.
create function pg_temp.denied(p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not denied: %', p_sql;
exception when insufficient_privilege then
  null;
end;
$$;

-- The refusal checks run as the API roles, so those roles may call them.
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.refused(text, text), pg_temp.denied(text) to authenticated, anon;

-- A hex digest standing for the keyed hash the apps compute.
create function pg_temp.h(p_text text) returns text
language sql immutable as $$ select encode(extensions.digest(p_text, 'sha256'), 'hex') $$;

-- One reservation as a visitor; returns the answer.
create function pg_temp.try(p_action text, p_address text, p_account text, p_known boolean default false)
returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.login_anon();
  v := public.auth_limit_reserve(p_action, p_address, p_account, p_known);
  reset role;
  return v;
end;
$$;

-- ── WEB-2: wrong passwords for one account ──────────────────────────────────
do $$
declare
  v jsonb;
  v_first uuid;
  v_victim text := pg_temp.h('account:victima@correo.example');
  i integer;
begin
  -- One visitor guessing one account: five wrong passwords, then a wait.
  for i in 1..5 loop
    v := pg_temp.try('sign_in', pg_temp.h('203.0.113.1'), v_victim);
    assert v ->> 'attempt_id' is not null, format('WEB-2: attempt %s for one account is allowed', i);
    assert (v ->> 'retry_after_seconds')::int = 0, 'WEB-2: an allowed attempt waits for nothing';
    if i = 1 then v_first := (v ->> 'attempt_id')::uuid; end if;
  end loop;
  v := pg_temp.try('sign_in', pg_temp.h('203.0.113.1'), v_victim);
  assert v ->> 'attempt_id' is null, 'WEB-2: a sixth wrong password from that visitor is refused';
  assert (v ->> 'retry_after_seconds')::int between 890 and 900,
    format('WEB-2: and says to wait about 15 minutes, not %s', v ->> 'retry_after_seconds');
  -- A refused attempt is not stored: waiting is not prolonged by more tries.
  assert (select count(*) from private.auth_attempts where account_hash = v_victim) = 5,
    'WEB-2: a refused attempt is not counted';

  -- The owner, on a browser that never signed in, from another address, is
  -- not held by the stranger's guesses (review of 22 November: lockout).
  v := pg_temp.try('sign_in', pg_temp.h('198.51.100.9'), v_victim);
  assert v ->> 'attempt_id' is not null,
    'WEB-2 lockout: a stranger''s wrong passwords do not hold the owner at another address';

  -- A guesser with many addresses: 50 wrong passwords for the account in all.
  for i in 7..50 loop
    v := pg_temp.try('sign_in', pg_temp.h('203.0.113.' || i), v_victim);
    assert v ->> 'attempt_id' is not null, format('WEB-2: attempt %s from address %s is allowed', i, i);
  end loop;
  v := pg_temp.try('sign_in', pg_temp.h('198.51.100.10'), v_victim);
  assert v ->> 'attempt_id' is null, 'WEB-2: the 51st wrong password for one account, from anywhere, is refused';

  -- The honest owner on a browser that signed in before is not held by the account limits.
  v := pg_temp.try('sign_in', pg_temp.h('192.0.2.50'), v_victim, true);
  assert v ->> 'attempt_id' is not null, 'WEB-2: a known device passes the account limit';
  assert not (select counts_for_account from private.auth_attempts where id = (v ->> 'attempt_id')::uuid),
    'WEB-2: and its attempt does not count against the account';

  -- An e-mail address with no account is counted exactly the same way: nothing is looked up.
  for i in 1..5 loop
    v := pg_temp.try('sign_in', pg_temp.h('203.0.113.200'), pg_temp.h('account:nadie@correo.example'));
  end loop;
  v := pg_temp.try('sign_in', pg_temp.h('203.0.113.200'), pg_temp.h('account:nadie@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: an address without an account is limited the same';

  -- Without a trustworthy visitor address the account alone gets the strict limit.
  for i in 1..5 loop
    v := pg_temp.try('sign_in', null, pg_temp.h('account:sin-direccion@correo.example'));
    assert v ->> 'attempt_id' is not null, format('WEB-2: attempt %s without an address is allowed', i);
  end loop;
  v := pg_temp.try('sign_in', null, pg_temp.h('account:sin-direccion@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: without an address, the sixth for one account is refused';

  -- Fifteen minutes later the account may try again.
  update private.auth_attempts set attempted_at = attempted_at - interval '15 minutes'
  where account_hash = v_victim;
  v := pg_temp.try('sign_in', pg_temp.h('203.0.113.1'), v_victim);
  assert v ->> 'attempt_id' is not null, 'WEB-2: after the window the account may try again';

  -- A first-time right password gives its reservation back.
  perform pg_temp.login_anon();
  perform public.auth_limit_release((v ->> 'attempt_id')::uuid);
  reset role;
  assert not exists (select 1 from private.auth_attempts where id = (v ->> 'attempt_id')::uuid),
    'WEB-2: a successful sign-in is not a failure';
  -- An old reservation cannot be given back (only the last five minutes count as this attempt).
  perform pg_temp.login_anon();
  perform public.auth_limit_release(v_first);
  reset role;
  assert exists (select 1 from private.auth_attempts where id = v_first),
    'WEB-2: a reservation older than five minutes stays a failure';
end
$$;

-- ── WEB-2: one address guessing many accounts ───────────────────────────────
do $$
declare
  v jsonb;
  i integer;
begin
  for i in 1..20 loop
    v := pg_temp.try('sign_in', pg_temp.h('203.0.113.66'), pg_temp.h('account:persona' || i || '@correo.example'));
    assert v ->> 'attempt_id' is not null, format('WEB-2: attempt %s from one address is allowed', i);
  end loop;
  v := pg_temp.try('sign_in', pg_temp.h('203.0.113.66'), pg_temp.h('account:persona21@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: the 21st wrong password from one address is refused';
  -- Even a known device is held by the address limit.
  v := pg_temp.try('sign_in', pg_temp.h('203.0.113.66'), pg_temp.h('account:persona1@correo.example'), true);
  assert v ->> 'attempt_id' is null, 'WEB-2: the address limit holds for a known device too';
  -- Everybody else is unaffected: the limit is not the server's, it is this visitor's.
  v := pg_temp.try('sign_in', pg_temp.h('203.0.113.67'), pg_temp.h('account:persona21@correo.example'));
  assert v ->> 'attempt_id' is not null, 'WEB-2: another visitor signs in as usual';
end
$$;

-- ── WEB-2: sign-ups, e-mails, codes and refreshes ───────────────────────────
do $$
declare
  v jsonb;
  v_id uuid;
  v_address text;
  v_account text;
  i integer;
begin
  -- Three sign-ups for one e-mail address from one visitor in an hour.
  for i in 1..3 loop
    v := pg_temp.try('sign_up', pg_temp.h('203.0.113.101'), pg_temp.h('account:nueva@correo.example'));
    assert v ->> 'attempt_id' is not null, format('WEB-2: sign-up %s is allowed', i);
  end loop;
  v_id := (v ->> 'attempt_id')::uuid;
  v := pg_temp.try('sign_up', pg_temp.h('203.0.113.101'), pg_temp.h('account:nueva@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: a fourth sign-up for one address from one visitor is refused';
  assert (v ->> 'retry_after_seconds')::int between 3500 and 3600, 'WEB-2: and waits up to an hour';
  -- The person who owns the address, elsewhere, can still create the account.
  v := pg_temp.try('sign_up', pg_temp.h('198.51.100.101'), pg_temp.h('account:nueva@correo.example'));
  assert v ->> 'attempt_id' is not null,
    'WEB-2 lockout: a stranger''s sign-ups do not stop the owner signing up elsewhere';
  -- Ten for one e-mail in all, from any number of addresses.
  for i in 1..8 loop
    v := pg_temp.try('sign_up', pg_temp.h('203.0.114.' || i), pg_temp.h('account:nueva@correo.example'));
  end loop;
  v := pg_temp.try('sign_up', pg_temp.h('203.0.114.99'), pg_temp.h('account:nueva@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: the 11th sign-up for one e-mail, from anywhere, is refused';
  -- A sign-up stays counted even when it worked: each one made Auth send an e-mail.
  perform pg_temp.login_anon();
  perform public.auth_limit_release(v_id);
  reset role;
  assert exists (select 1 from private.auth_attempts where id = v_id),
    'WEB-2: a sign-up cannot be given back';

  -- Ten account e-mails per address in an hour.
  for i in 1..10 loop
    v := pg_temp.try('email', pg_temp.h('203.0.113.120'), pg_temp.h('account:correo' || i || '@correo.example'));
    assert v ->> 'attempt_id' is not null, format('WEB-2: e-mail %s is allowed', i);
  end loop;
  v := pg_temp.try('email', pg_temp.h('203.0.113.120'), pg_temp.h('account:correo11@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: the 11th e-mail from one address in an hour is refused';

  -- Reset e-mails for one account: five from one visitor, then that visitor waits;
  -- the owner elsewhere still gets theirs.
  for i in 1..5 loop
    v := pg_temp.try('email', pg_temp.h('203.0.113.121'), pg_temp.h('account:reset@correo.example'));
  end loop;
  v := pg_temp.try('email', pg_temp.h('203.0.113.121'), pg_temp.h('account:reset@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: a sixth reset e-mail from one visitor is refused';
  v := pg_temp.try('email', pg_temp.h('198.51.100.121'), pg_temp.h('account:reset@correo.example'));
  assert v ->> 'attempt_id' is not null,
    'WEB-2 lockout: a stranger''s reset requests do not stop the owner''s own reset e-mail';
  -- Twenty for one account in all.
  for i in 1..14 loop
    v := pg_temp.try('email', pg_temp.h('203.0.115.' || i), pg_temp.h('account:reset@correo.example'));
  end loop;
  v := pg_temp.try('email', pg_temp.h('203.0.115.99'), pg_temp.h('account:reset@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: the 21st e-mail for one account, from anywhere, is refused';

  -- Wrong codes for one account: five from one visitor, then that visitor waits;
  -- the owner's right code from elsewhere is still checked.
  for i in 1..5 loop
    v := pg_temp.try('code', pg_temp.h('203.0.113.135'), pg_temp.h('account:codigo@correo.example'));
  end loop;
  v := pg_temp.try('code', pg_temp.h('203.0.113.135'), pg_temp.h('account:codigo@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: a sixth wrong code from one visitor is refused';
  v := pg_temp.try('code', pg_temp.h('198.51.100.135'), pg_temp.h('account:codigo@correo.example'));
  assert v ->> 'attempt_id' is not null,
    'WEB-2 lockout: a stranger''s wrong codes do not stop the owner''s right code';
  -- A known device skips the account buckets for codes and e-mails too.
  for i in 1..30 loop
    v := pg_temp.try('code', pg_temp.h('203.0.116.' || i), pg_temp.h('account:codigo2@correo.example'));
  end loop;
  v := pg_temp.try('code', pg_temp.h('198.51.100.136'), pg_temp.h('account:codigo2@correo.example'));
  assert v ->> 'attempt_id' is null, 'WEB-2: the 31st wrong code for one account, from anywhere, is refused';
  v := pg_temp.try('code', pg_temp.h('198.51.100.136'), pg_temp.h('account:codigo2@correo.example'), true);
  assert v ->> 'attempt_id' is not null, 'WEB-2: but not on the owner''s usual browser';

  -- Refreshes count per address only: an account given with them is ignored.
  v := pg_temp.try('refresh', pg_temp.h('203.0.113.150'), pg_temp.h('account:x@correo.example'));
  assert v ->> 'attempt_id' is not null, 'WEB-2: a refresh is allowed';
  assert (select account_hash from private.auth_attempts where id = (v ->> 'attempt_id')::uuid) is null,
    'WEB-2: a refresh stores no account';
  for i in 2..120 loop
    v := pg_temp.try('refresh', pg_temp.h('203.0.113.150'), null);
  end loop;
  assert v ->> 'attempt_id' is not null, 'WEB-2: 120 refused refreshes in ten minutes from one address are allowed';
  v := pg_temp.try('refresh', pg_temp.h('203.0.113.150'), null);
  assert v ->> 'attempt_id' is null, 'WEB-2: the 121st is refused';
  -- A refresh that Auth accepted is given back, so many honest people behind
  -- one address are not counted (review of 22 November: shared addresses).
  for i in 1..200 loop
    v := pg_temp.try('refresh', pg_temp.h('203.0.113.151'), null);
    assert v ->> 'attempt_id' is not null, format('WEB-2 shared address: right refresh %s is allowed', i);
    perform pg_temp.login_anon();
    perform public.auth_limit_release((v ->> 'attempt_id')::uuid);
    reset role;
  end loop;
  assert not exists (select 1 from private.auth_attempts where address_hash = pg_temp.h('203.0.113.151')),
    'WEB-2 shared address: right refreshes leave nothing behind';

  -- A signed-in caller gets the same answers (the apps call as a visitor, but nothing depends on it).
  v_address := pg_temp.h('203.0.113.160');
  v_account := pg_temp.h('account:comprador');
  perform pg_temp.login('comprador@yuntera.example');
  v := public.auth_limit_reserve('reauth', v_address, v_account);
  reset role;
  assert v ->> 'attempt_id' is not null, 'WEB-2: a signed-in caller may reserve too';
end
$$;

-- ── WEB-2: malformed requests and what no caller may do ─────────────────────
select pg_temp.login_anon();
-- Only hashes, never an address or an e-mail in clear.
select pg_temp.refused($$select public.auth_limit_reserve('sign_in', '203.0.113.7', null)$$,
  'invalid_limit_request');
select pg_temp.refused($$select public.auth_limit_reserve('sign_in', null, 'ana@correo.example')$$,
  'invalid_limit_request');
select pg_temp.refused(format('select public.auth_limit_reserve(%L, %L, null)',
  'sign_in', upper(encode(extensions.digest('x', 'sha256'), 'hex'))), 'invalid_limit_request');
select pg_temp.refused($$select public.auth_limit_reserve('sign_in', null, null)$$,
  'invalid_limit_request');
-- A refresh needs an address: without one it would be one bucket for everybody.
select pg_temp.refused(format('select public.auth_limit_reserve(%L, null, %L)',
  'refresh', encode(extensions.digest('x', 'sha256'), 'hex')), 'invalid_limit_request');
select pg_temp.refused(format('select public.auth_limit_reserve(%L, %L)',
  'drop_everything', encode(extensions.digest('x', 'sha256'), 'hex')), 'invalid_limit_request');
select pg_temp.refused($$select public.auth_limit_release(null)$$, 'invalid_limit_request');
-- The attempts themselves are out of reach of every API role.
select pg_temp.denied('select count(*) from private.auth_attempts');
select pg_temp.denied('delete from private.auth_attempts');
select pg_temp.denied($$select private.auth_bucket_wait('sign_in', null, null, 1, 1)$$);
reset role;
select pg_temp.login('comprador@yuntera.example');
select pg_temp.denied('select count(*) from private.auth_attempts');
select pg_temp.denied('update private.auth_attempts set attempted_at = now() - interval ''1 day''');
reset role;
select set_config('request.jwt.claims', '', true);

-- ── WEB-2: a short retention ────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  update private.auth_attempts set attempted_at = now() - interval '3 hours'
  where address_hash = pg_temp.h('203.0.113.66');
  v := pg_temp.try('sign_in', pg_temp.h('203.0.113.250'), pg_temp.h('account:otra@correo.example'));
  assert not exists (select 1 from private.auth_attempts where address_hash = pg_temp.h('203.0.113.66')),
    'WEB-2: attempts older than two hours are removed by the next call';
  assert not exists (select 1 from private.auth_attempts where attempted_at < now() - interval '2 hours'),
    'WEB-2: nothing older than two hours is kept';
  -- What is kept is only hashes: no column holds anything else.
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'private' and table_name = 'auth_attempts'
      and column_name not in ('id', 'action', 'address_hash', 'account_hash', 'counts_for_account', 'attempted_at')),
    'WEB-2: the table holds hashes, the action and the time, nothing more';
end
$$;

-- ── WEB-2: only the apps may add attempts, once the project says so ─────────
-- With a digest in Vault, a caller without the apps' value is refused and
-- adds nothing (review of 22 November: rows added with the public key alone).
-- A local database has no Vault: a stand-in with the same shape, for this
-- transaction only. A hosted project has the real one, which this file does
-- not touch; there the check is left to the deployment runbook.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'Vault exists here: the caller check is not exercised against it';
    perform set_config('t.vault', 'real', true);
  else
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    insert into vault.decrypted_secrets values
      ('auth_limit_caller_digest', encode(extensions.digest('the-apps-proof', 'sha256'), 'hex'));
    perform set_config('t.vault', 'stand-in', true);
  end if;
end
$$;
do $$
declare
  v jsonb;
  v_before bigint := (select count(*) from private.auth_attempts);
  v_a text := pg_temp.h('203.0.113.230');
  v_b text := pg_temp.h('203.0.113.231');
begin
  if current_setting('t.vault') <> 'stand-in' then
    return;
  end if;
  perform pg_temp.login_anon();
  perform pg_temp.refused(format('select public.auth_limit_reserve(%L, %L)',
    'sign_in', v_a), 'auth_limit_caller');
  perform pg_temp.refused(format('select public.auth_limit_reserve(%L, %L, null, false, %L)',
    'sign_in', v_a, 'a-guess'), 'auth_limit_caller');
  v := public.auth_limit_reserve('sign_in', v_a, null, false, 'the-apps-proof');
  reset role;
  assert v ->> 'attempt_id' is not null, 'WEB-2 caller: the apps'' proof is accepted';
  assert (select count(*) from private.auth_attempts) = v_before + 1,
    'WEB-2 caller: a refused caller adds no row';
  -- Without a digest configured, any caller is accepted (local runs, CI).
  delete from vault.decrypted_secrets;
  perform pg_temp.login_anon();
  v := public.auth_limit_reserve('sign_in', v_b);
  reset role;
  assert v ->> 'attempt_id' is not null, 'WEB-2 caller: without a digest the check is off';
end
$$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  if current_setting('t.vault') = 'stand-in' then
    drop table vault.decrypted_secrets;
    drop schema vault;
  end if;
end
$$;

select 'web follow-ups: all checks passed' as result;

rollback;
