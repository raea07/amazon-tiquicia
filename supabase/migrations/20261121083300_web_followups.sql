-- Web follow-ups to the security review of 21 November 2026 (WEB-2).
--
-- Sign-in, sign-up, password reset, e-mailed codes and token refreshes all
-- reach Supabase Auth from the apps' servers, so Auth's own limits by network
-- address count the server, not the visitor. The apps therefore keep their own
-- limit in front of each of those calls, here, so that it holds across every
-- server instance and all four apps:
--
--   * per visitor address, so one visitor cannot use up the server's share of
--     Auth's limits for everyone, nor guess passwords for many accounts;
--   * per account (the e-mail address typed), so many addresses together
--     cannot guess one account's password.
--
-- What is stored is only a keyed hash (HMAC-SHA-256 with a server-only key the
-- database never sees) of the address and of the e-mail, kept for two hours at
-- most. The database cannot turn a hash back into an address, and a caller
-- without the key cannot compute the hash of anyone else's address or e-mail,
-- so calling these functions directly cannot count against a real person.
--
-- Nothing here looks the account up: an e-mail address with no account is
-- counted and answered exactly like one with an account.
--
-- Three buckets per action, so that a stranger who knows someone's e-mail
-- cannot keep them out (review of the follow-ups, 22 November 2026):
--
--   * the visitor address alone (one visitor, many accounts);
--   * the account from one address (one visitor, one account): the strict
--     limit, which is what a single guesser meets;
--   * the account from every address together, much higher, against a guesser
--     with many addresses.
--
-- So one visitor guessing the owner's password, code or e-mail fills only its
-- own pair, and the owner, from any other address, is not held. Only a guesser
-- with many addresses can fill the account's total, for at most the window;
-- even then the owner's usual browser is not held (`p_known_device`, a signed
-- cookie the apps check, skips both account buckets), and the link in a reset
-- or confirmation e-mail counts per address only, so it always works.
--
-- Without a trustworthy visitor address (no header the host guarantees), the
-- pair bucket falls back to the account alone, at the strict limit.
--
-- The apps prove they are the caller with `p_caller`, a value derived from
-- their key. The database checks it against a digest kept in Vault
-- (`auth_limit_caller_digest`) when one is configured, so the public key alone
-- cannot add rows; a database without one (local runs, CI, a project not yet
-- configured) accepts any caller, as before.

-- ── The attempts ────────────────────────────────────────────────────────────

create table private.auth_attempts (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  -- Lowercase hex HMAC-SHA-256 digests computed by the apps; never an address or an e-mail.
  address_hash text check (address_hash ~ '^[0-9a-f]{64}$'),
  account_hash text check (account_hash ~ '^[0-9a-f]{64}$'),
  -- False for an attempt from a browser that signed in to the account before:
  -- it counts against the address only.
  counts_for_account boolean not null default true,
  attempted_at timestamptz not null default now()
);

create index auth_attempts_address_idx
  on private.auth_attempts (action, address_hash, attempted_at desc)
  where address_hash is not null;
create index auth_attempts_account_idx
  on private.auth_attempts (action, account_hash, attempted_at desc)
  where account_hash is not null and counts_for_account;
create index auth_attempts_age_idx on private.auth_attempts (attempted_at);

alter table private.auth_attempts enable row level security;
revoke all on private.auth_attempts from public, anon, authenticated;

comment on table private.auth_attempts is
  'Attempts to sign in, sign up, send an account e-mail, check a code or refresh a session, '
  'counted per keyed hash of the visitor address and of the account e-mail. Kept two hours.';

-- The limits. Each action has a window; within it, at most `per_address`
-- attempts from one visitor address, `per_pair` for one account from one
-- address, and `per_account` for one account from all addresses together. A
-- releasable attempt is given back when it succeeds, so only failures count
-- (a wrong password, a wrong code, a refresh Auth refused); the others count
-- every request, because each one makes Auth send an e-mail.
create or replace function private.auth_limit_rule(
  p_action text,
  out per_address integer,
  out per_pair integer,
  out per_account integer,
  out window_seconds integer,
  out releasable boolean
)
language sql immutable
set search_path = ''
as $$
  select r.per_address, r.per_pair, r.per_account, r.window_seconds, r.releasable
  from (values
    -- Wrong passwords in 15 minutes: 20 per address, 5 per account from one
    -- address, 50 per account in all.
    ('sign_in', 20, 5, 50, 900, true),
    -- New accounts in an hour: 10 per address, 3 for one e-mail from one
    -- address, 10 for one e-mail in all.
    ('sign_up', 10, 3, 10, 3600, false),
    -- Reset and confirmation e-mails in an hour: 10 per address, 5 per account
    -- from one address, 20 per account in all (Auth also waits a minute
    -- between two e-mails to one person).
    ('email', 10, 5, 20, 3600, false),
    -- Wrong e-mailed codes in 15 minutes: 20 per address, 5 per account from
    -- one address, 30 per account in all (a code has a million values and
    -- expires within the hour).
    ('code', 20, 5, 30, 900, true),
    -- The current password asked again (password change, account deletion):
    -- counted by the signed-in account, which only its own sessions can fill.
    ('reauth', 20, null, 5, 900, true),
    -- Session refreshes that Auth refused, per address only: a right refresh
    -- token gives its attempt back, so honest people behind one shared
    -- address (a mobile carrier's, an office's) are not counted at all.
    ('refresh', 120, null, null, 600, true)
  ) as r (action, per_address, per_pair, per_account, window_seconds, releasable)
  where r.action = p_action;
$$;

-- Seconds until one bucket is below its limit again, or 0 when it already is.
-- The bucket is the address (account null), the account in all (address
-- null), or the account from one address (both given).
create or replace function private.auth_bucket_wait(
  p_action text,
  p_address_hash text,
  p_account_hash text,
  p_limit integer,
  p_window_seconds integer
) returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select greatest(1, ceil(extract(epoch from (
      a.attempted_at + make_interval(secs => p_window_seconds) - now()))))::integer
    from private.auth_attempts a
    where a.action = p_action
      and a.attempted_at > now() - make_interval(secs => p_window_seconds)
      and (p_address_hash is null or a.address_hash = p_address_hash)
      and (p_account_hash is null or (a.account_hash = p_account_hash and a.counts_for_account))
    order by a.attempted_at desc
    offset greatest(p_limit, 1) - 1
    limit 1), 0);
$$;

-- Whether the caller is one of the apps: `p_caller` must hash to the digest
-- in Vault, when one is configured there.
create or replace function private.auth_limit_caller_ok(p_caller text) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_digest text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    return true;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets
             where name = 'auth_limit_caller_digest' limit 1$q$
    into v_digest;
  if nullif(trim(v_digest), '') is null then
    return true;
  end if;
  return p_caller is not null
    and encode(extensions.digest(p_caller, 'sha256'), 'hex') = lower(trim(v_digest));
end;
$$;

revoke all on function private.auth_limit_rule(text) from public, anon, authenticated;
revoke all on function private.auth_bucket_wait(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function private.auth_limit_caller_ok(text) from public, anon, authenticated;

-- ── The two functions the apps call ─────────────────────────────────────────

-- Called by the apps' servers before every call to Auth that the limit covers.
-- Counts the attempt straight away, under a lock per key, so a burst of
-- parallel requests cannot outrun the limit. Answers `attempt_id` null and how
-- many seconds to wait when any bucket is full; otherwise the id to give back
-- with `auth_limit_release` if the attempt succeeds.
--
-- Open to visitors on purpose: sign-in comes before any session. The check is
-- that the caller is one of the apps (`p_caller`, see the header) and that the
-- request is well formed; a caller can count only against the hashes it can
-- compute.
create or replace function public.auth_limit_reserve(
  p_action text,
  p_address_hash text default null,
  p_account_hash text default null,
  p_known_device boolean default false,
  p_caller text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_account text := p_account_hash;
  v_wait integer := 0;
  v_id uuid;
begin
  if not private.auth_limit_caller_ok(p_caller) then
    perform private.fail('auth_limit_caller');
  end if;
  select * into v_rule from private.auth_limit_rule(p_action);
  if v_rule.window_seconds is null
     or (p_address_hash is not null and p_address_hash !~ '^[0-9a-f]{64}$')
     or (p_account_hash is not null and p_account_hash !~ '^[0-9a-f]{64}$')
     or (p_address_hash is null and p_account_hash is null)
     or p_known_device is null then
    perform private.fail('invalid_limit_request');
  end if;
  if v_rule.per_account is null and v_rule.per_pair is null then
    v_account := null;
  end if;
  if p_address_hash is null and v_account is null then
    perform private.fail('invalid_limit_request');
  end if;

  -- Always the address first, then the account, so two calls never wait on
  -- each other's locks in opposite orders.
  if p_address_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('auth-limit:a:' || p_address_hash, 0));
  end if;
  if v_account is not null then
    perform pg_advisory_xact_lock(hashtextextended('auth-limit:u:' || v_account, 0));
  end if;

  -- A short retention: nothing older than the longest window (one hour) is
  -- needed; two hours leaves room. A bounded batch per call keeps each cheap.
  delete from private.auth_attempts a
  where a.id in (
    select o.id from private.auth_attempts o
    where o.attempted_at < now() - interval '2 hours'
    limit 500);

  if p_address_hash is not null then
    v_wait := private.auth_bucket_wait(
      p_action, p_address_hash, null, v_rule.per_address, v_rule.window_seconds);
  end if;
  if v_account is not null and not p_known_device then
    -- The account from this address; without an address, the account alone
    -- at the same strict limit.
    if v_rule.per_pair is not null then
      v_wait := greatest(v_wait, private.auth_bucket_wait(
        p_action, p_address_hash, v_account, v_rule.per_pair, v_rule.window_seconds));
    end if;
    if v_rule.per_account is not null then
      v_wait := greatest(v_wait, private.auth_bucket_wait(
        p_action, null, v_account, v_rule.per_account, v_rule.window_seconds));
    end if;
  end if;
  if v_wait > 0 then
    return jsonb_build_object('attempt_id', null, 'retry_after_seconds', v_wait);
  end if;

  insert into private.auth_attempts (action, address_hash, account_hash, counts_for_account)
  values (p_action, p_address_hash, v_account, not p_known_device)
  returning id into v_id;
  return jsonb_build_object('attempt_id', v_id, 'retry_after_seconds', 0);
end;
$$;

-- The attempt succeeded (a right password or code, a refresh Auth accepted):
-- it is not a failure. Only an attempt of an action that counts failures,
-- made in the last five minutes; e-mails sent and sign-ups stay counted. The id is a
-- random value only the server that reserved it has seen.
create or replace function public.auth_limit_release(p_attempt_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_attempt_id is null then
    perform private.fail('invalid_limit_request');
  end if;
  delete from private.auth_attempts a
  where a.id = p_attempt_id
    and (select r.releasable from private.auth_limit_rule(a.action) r)
    and a.attempted_at > now() - interval '5 minutes';
end;
$$;

revoke all on function public.auth_limit_reserve(text, text, text, boolean, text) from public;
revoke all on function public.auth_limit_release(uuid) from public;
grant execute on function public.auth_limit_reserve(text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.auth_limit_release(uuid) to anon, authenticated;

-- Old rows go even when nobody signs in for a while.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('auth-attempts-cleanup', '41 * * * *',
      $c$delete from private.auth_attempts where attempted_at < now() - interval '2 hours'$c$);
  else
    raise notice 'pg_cron is not available here; old sign-in attempts are removed as new ones arrive.';
  end if;
exception when others then
  raise notice 'Could not schedule auth-attempts-cleanup: %', sqlerrm;
end
$$;
