-- The database follow-ups (083200) and the web follow-ups (083300) together,
-- where the per-request check meets the functions each added.
--
-- The sign-in limit is asked before anyone is signed in: the apps call
-- auth_limit_reserve and auth_limit_release as a visitor, with the
-- publishable key and no session, from the sign-in forms and from the proxy.
-- So the Data API's pre-request check (check_request) lets them through for a
-- visitor, before any second step. The follow-ups' own functions are for
-- signed-in people and staff, and stay behind the second step like every other
-- function.

begin;
\ir _helpers.sql
-- The limit's caller check is 130_web_followups' subject; here no digest is
-- configured for this transaction, whatever the project's Vault holds.
select pg_temp.set_caller_digest(null);

select pg_temp.remember('shopper', (select id::text from auth.users where email = 'comprador@yuntera.example'));

-- A visitor: the check lets both limit functions through, and they answer.
select pg_temp.login_anon();
do $$
declare
  r jsonb;
begin
  perform set_config('request.path', '/rpc/auth_limit_reserve', true);
  perform public.check_request();
  r := public.auth_limit_reserve('sign_in', repeat('c', 64), repeat('d', 64));
  assert (r ->> 'retry_after_seconds')::int = 0 and r ->> 'attempt_id' is not null,
    format('visitor_limit: a visitor reserves an attempt: %s', r);
  perform set_config('request.path', '/rpc/auth_limit_release', true);
  perform public.check_request();
  perform public.auth_limit_release((r ->> 'attempt_id')::uuid);
end
$$;
reset role;
do $$
begin
  assert not exists (select 1 from private.auth_attempts where account_hash = repeat('d', 64)),
    'visitor_limit: the released attempt is gone';
end
$$;

-- A shopper with a second factor, signed in with the password only: the
-- follow-ups' functions wait for the second step, as everything else does. The
-- limit functions too, when called with that session; the apps never do (they
-- ask the limit as a visitor, see the header).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), current_setting('t.shopper')::uuid, 'x', 'totp', 'verified', now(), now(),
        'JBSWY3DPEHPK3PXP');
select pg_temp.login('comprador@yuntera.example', 'aal1');
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['withdraw_return_request', 'my_order_returns', 'driver_report_position',
                              'wms_confirm_pick', 'ops_fee_floor_breaches', 'auth_limit_reserve'] loop
    perform set_config('request.path', '/rpc/' || v_fn, true);
    begin
      perform public.check_request();
      raise exception 'before_second_step: % passed the check at aal1', v_fn;
    exception when others then
      if sqlerrm <> 'second_factor_required' then raise; end if;
    end;
  end loop;
  -- Still allowed before the second step: what the screens need to send the
  -- person to it.
  perform set_config('request.path', '/rpc/my_security', true);
  perform public.check_request();
end
$$;
reset role;

-- Staff, with the staff gate on and no second step: the new console list is
-- refused by the function itself too.
update public.app_settings set value = 'true' where key = 'require_staff_mfa';
select pg_temp.login('central@yuntera.example', 'aal1');
do $$
begin
  perform public.ops_fee_floor_breaches();
  raise exception 'staff_gate: the fee-floor list answered a session without a second factor';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
begin
  perform set_config('request.path', '/rpc/ops_fee_floor_breaches', true);
  perform public.check_request();
  perform public.ops_fee_floor_breaches();
end
$$;
reset role;

select 'ok' as merge_followups;
rollback;
