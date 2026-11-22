-- Native accounts (20261121083900): the notification settings functions
-- record where the commercial consent was given. The shopper and seller apps
-- pass 'shop_app' and 'seller_app'; the websites pass nothing and keep
-- 'web_cuenta' and 'seller_cuenta'. Each audience may name only its own
-- places. Who may call the functions is unchanged.
--
-- Runs in one transaction that is rolled back. Assertions are on fixtures this
-- suite sets up and on the difference from counts taken at its start.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();

select pg_temp.remember('shopper', (select id::text from auth.users where email = 'comprador2@yuntera.example'));
select pg_temp.remember('shop', (
  select m.seller_id::text from public.seller_members m
  join auth.users u on u.id = m.user_id
  where u.email = 'vendedor@yuntera.example' and m.role = 'owner'
  order by m.seller_id limit 1));
-- A team member who is not an administrator of that shop.
insert into public.seller_members (seller_id, user_id, role)
select current_setting('t.shop')::uuid, id, 'staff' from auth.users where email = 'comprador3@yuntera.example'
on conflict do nothing;

-- ── One function of each name, granted to signed-in callers only ─────────

do $$
begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'set_my_notification_settings') = 1,
    'exactly one set_my_notification_settings';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'seller_set_notification_settings') = 1,
    'exactly one seller_set_notification_settings';
  assert to_regprocedure('public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint)') is null,
    'the old signature is gone';
  assert has_function_privilege('authenticated',
    'public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint, text)', 'execute');
  assert has_function_privilege('authenticated',
    'public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint, text)', 'execute');
  assert not has_function_privilege('anon',
    'public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint, text)', 'execute');
  assert not has_function_privilege('anon',
    'public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint, text)', 'execute');
  assert (select p.prosecdef and p.proconfig @> array['search_path=""']
          from pg_proc p where p.oid = 'public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint, text)'::regprocedure),
    'security definer with an empty search_path';
  assert (select p.prosecdef and p.proconfig @> array['search_path=""']
          from pg_proc p where p.oid = 'public.seller_set_notification_settings(uuid, boolean, boolean, text, boolean, text, bigint, text)'::regprocedure),
    'security definer with an empty search_path';
end
$$;

select pg_temp.login_anon();
do $$
begin
  begin
    perform public.set_my_notification_settings(true, false, false, true, null, true, 'comercial-2026-11', null, 'shop_app');
    assert false, 'a visitor saved settings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.seller_set_notification_settings(current_setting('t.shop')::uuid, false, true, null, true,
      'comercial-2026-11', null, 'seller_app');
    assert false, 'a visitor saved a shop''s settings';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- Start without consent, so each grant below is recorded.
select pg_temp.login('comprador2@yuntera.example');
select public.set_my_notification_settings(true, false, false, true, null, false, null, null);
reset role;
select pg_temp.login('vendedor@yuntera.example');
select public.seller_set_notification_settings(current_setting('t.shop')::uuid, false, true, null, false, null, null);
reset role;

-- The log's ids only grow: rows after this one are this suite's.
select pg_temp.remember('log_before', (select coalesce(max(id), 0)::text from private.commercial_consent_log));

-- ── The shopper app ────────────────────────────────────────────────────────

select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  s jsonb;
begin
  s := public.set_my_notification_settings(true, false, false, true, null, true, 'comercial-2026-11', null, 'shop_app');
  assert (s #>> '{commercial,opt_in}')::boolean, 'the consent is given';
  assert s #>> '{commercial,source}' = 'shop_app', 'and recorded as given in the shopper app: ' || (s #>> '{commercial,source}');
  -- A shopper cannot claim the seller's places, nor make one up.
  foreach s in array array['"seller_app"', '"seller_cuenta"', '"web"', 'null']::jsonb[] loop
    begin
      perform public.set_my_notification_settings(true, false, false, false, null, false, null, null, s #>> '{}');
      assert false, 'a shopper saved with the source ' || s::text;
    exception when raise_exception then assert sqlerrm = 'notify_consent_invalid', sqlerrm;
    end;
  end loop;
  assert (public.my_notification_settings() ->> 'push_enabled')::boolean, 'a refused save changed nothing';
  s := public.set_my_notification_settings(true, false, false, true, null, false, null, null, 'shop_app');
  assert not (s #>> '{commercial,opt_in}')::boolean, 'the consent is withdrawn';
end
$$;
reset role;

do $$
declare
  v_user uuid := current_setting('t.shopper')::uuid;
begin
  assert (select array_agg(action || ':' || source order by id)
          from private.commercial_consent_log
          where user_id = v_user and id > current_setting('t.log_before')::bigint)
         = array['granted:shop_app', 'withdrawn:shop_app'],
    'the log says both were done in the shopper app';
  assert exists (select 1 from public.consents c where c.user_id = v_user and c.purpose = 'marketing'
                 and c.policy_version = 'comercial-2026-11' and c.revoked_at is not null),
    'the consent record is kept, and marked withdrawn';
end
$$;

-- The website, passing no source, still records its own account page.
select pg_temp.login('comprador2@yuntera.example');
do $$
declare
  s jsonb;
begin
  s := public.set_my_notification_settings(true, false, false, true, null, true, 'comercial-2026-11');
  assert s #>> '{commercial,source}' = 'web_cuenta', 'the website keeps web_cuenta';
  s := public.set_my_notification_settings(true, false, false, true, null, true, 'comercial-2026-11', null, 'web_cuenta');
  assert s #>> '{commercial,source}' = 'web_cuenta', 'web_cuenta may be named too';
end
$$;
reset role;

-- ── The seller app ─────────────────────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_shop uuid := current_setting('t.shop')::uuid;
  s jsonb;
  v_source text;
begin
  s := public.seller_set_notification_settings(v_shop, false, true, null, true, 'comercial-2026-11', null, 'seller_app');
  assert s #>> '{commercial,source}' = 'seller_app', 'the shop''s consent is recorded as given in the seller app';
  foreach v_source in array array['shop_app', 'web_cuenta', 'otra'] loop
    begin
      perform public.seller_set_notification_settings(v_shop, false, false, null, false, null, null, v_source);
      assert false, 'a shop saved with the source ' || v_source;
    exception when raise_exception then assert sqlerrm = 'notify_consent_invalid', sqlerrm;
    end;
  end loop;
  assert (public.seller_notification_settings(v_shop) ->> 'push_enabled')::boolean, 'a refused save changed nothing';
  s := public.seller_set_notification_settings(v_shop, false, true, null, true, 'comercial-2026-11');
  assert s #>> '{commercial,source}' = 'seller_app', 'consent already given is not given again';
  perform public.seller_set_notification_settings(v_shop, false, true, null, false, null, null);
  s := public.seller_set_notification_settings(v_shop, false, true, null, true, 'comercial-2026-11');
  assert s #>> '{commercial,source}' = 'seller_cuenta', 'the seller centre keeps seller_cuenta';
end
$$;
reset role;

-- The wrong callers: a member who is not an administrator, another shopper.
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  begin
    perform public.seller_set_notification_settings(current_setting('t.shop')::uuid, false, false, null, true,
      'comercial-2026-11', null, 'seller_app');
    assert false, 'a staff member changed the shop''s settings';
  exception when raise_exception then assert sqlerrm = 'forbidden', sqlerrm;
  end;
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  begin
    perform public.seller_set_notification_settings(current_setting('t.shop')::uuid, false, false, null, true,
      'comercial-2026-11', null, 'seller_app');
    assert false, 'someone outside the shop changed its settings';
  exception when raise_exception then assert sqlerrm = 'seller_not_found', sqlerrm;
  end;
end
$$;
reset role;

-- What was left behind: exactly the rows the steps above wrote, in order.
do $$
declare
  v_after bigint := current_setting('t.log_before')::bigint;
begin
  assert (select array_agg(action || ':' || source order by id) from private.commercial_consent_log
          where user_id = current_setting('t.shopper')::uuid and id > v_after)
         = array['granted:shop_app', 'withdrawn:shop_app', 'granted:web_cuenta'],
    'the shopper: granted and withdrawn in the app, then granted on the website';
  assert (select array_agg(action || ':' || source order by id) from private.commercial_consent_log
          where seller_id = current_setting('t.shop')::uuid and id > v_after)
         = array['granted:seller_app', 'withdrawn:seller_cuenta', 'granted:seller_cuenta'],
    'the shop: granted in the app, withdrawn and granted again in the seller centre';
  assert (select count(*) from private.commercial_consent_log
          where id > v_after and (user_id = current_setting('t.shopper')::uuid
                                  or seller_id = current_setting('t.shop')::uuid)) = 6,
    'and nothing else';
end
$$;

rollback;
