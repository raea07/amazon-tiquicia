-- Shared helpers for the database tests. Included with \ir by each test file.
--
-- Tests impersonate users the way the Data API does: the JWT claims go in the
-- `request.jwt.claims` setting and the session switches to the `authenticated`
-- (or `anon`) role, so grants and row-level security apply exactly as they
-- would to a real request. `reset role` returns to the superuser between steps.
--
-- Note: these helpers must be called while still superuser; once impersonating,
-- the session can no longer reach the temporary schema. Values needed across
-- steps are passed in custom settings (set_config('t.something', …)).
--
-- The suites also run on used databases (the hosted preview: supabase/scripts/
-- remote-db.sh test; locally: supabase/scripts/used-db-check.sh). Two things
-- people do there would otherwise stop suites for reasons that are not about
-- what they test, so they are handled here, for each suite's own transaction:
--
--   * A demo account may have a second factor (a staff member enrolled one):
--     a person is signed in with the second step done (aal2) unless a suite
--     asks for 'aal1', which the suites about the second step do.
--   * The demo shoppers may have unpaid orders placed by hand, which count
--     against the limits on what one account may hold unpaid (082900). Those
--     orders (never the seed's own) are cancelled at the start of the
--     transaction, which rolls back. On a fresh seed there are none.
--   * The demo shoppers (comprador, comprador2, comprador3) are the suites'
--     "a shopper, nobody else": where staff made one of them a member of
--     staff (as the people journey does), that membership is removed for the
--     transaction. On a fresh seed none is staff.

delete from public.staff_members s using auth.users u
where u.id = s.user_id and u.email ~ '^comprador[0-9]?@yuntera\.example$';

do $$
declare
  o record;
begin
  for o in
    select x.id from public.orders x join auth.users u on u.id = x.user_id
    where u.email like '%@yuntera.example' and x.status in ('pending_payment', 'payment_review')
      and x.idempotency_key not like 'seed-%'
    order by x.placed_at
  loop
    perform private.cancel_order_internal(o.id, 'Apartado por las pruebas de la base de datos');
  end loop;
end
$$;

create function pg_temp.login(p_email text, p_aal text default 'aal2') returns void
language plpgsql as $$
declare
  v_user uuid;
begin
  select id into strict v_user from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.login_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Lets a suite look at what a function left behind while it is still signed in
-- as the user who called it. The API roles hold no privilege on any table
-- (20261121082800_lockdown.sql), so without this every check that reads a row
-- would fail. The grant is SELECT only, exists only inside the suite's own
-- rolled-back transaction, and row-level security still filters what the
-- checks see. It is for the suites that test what functions do; the suites
-- that test who can reach what (020_access, 110_lockdown) never call it.
-- Visitors get nothing, so what a visitor is refused stays tested everywhere.
create function pg_temp.allow_inspection() returns void
language plpgsql as $$
begin
  grant select on all tables in schema public to authenticated;
end;
$$;

-- Takes the inspection grant away again, for a step that checks privileges.
create function pg_temp.stop_inspection() returns void
language plpgsql as $$
begin
  revoke select on all tables in schema public from authenticated;
end;
$$;

-- Remembers a value for later steps, readable under any role.
create function pg_temp.remember(p_name text, p_value text) returns void
language sql as $$
  select set_config('t.' || p_name, p_value, true);
$$;

-- Looks up an offer id by product slug (the platform-fulfilled one when there are several).
create function pg_temp.offer(p_slug text, p_variant text default '') returns uuid
language sql as $$
  select o.id from public.offers o
  join public.skus k on k.id = o.sku_id
  join public.products p on p.id = k.product_id
  where p.slug = p_slug and k.variant_name = p_variant
  order by (o.fulfillment = 'platform') desc, o.price_minor desc, o.id limit 1
$$;

-- Places, as the demo shopper, a SINPE Móvil order that is waiting for its
-- transfer, and returns its id. Suites use this rather than the seed's unpaid
-- order: the expiry job cancels that one 30 minutes after seeding wherever the
-- scheduler runs (a hosted project), and it is stale on any older database.
create function pg_temp.unpaid_order(p_key text) returns uuid
language plpgsql as $$
declare
  v_user uuid;
  v_result jsonb;
begin
  select id into strict v_user from auth.users where email = 'comprador@yuntera.example';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_result := public.place_order(
    jsonb_build_array(jsonb_build_object(
      'offer_id', pg_temp.offer('parlante-bluetooth-nimbo-ola'), 'quantity', 1)),
    (select a.id from public.addresses a where a.user_id = v_user and a.is_default),
    'sinpe_movil', p_key);
  perform set_config('request.jwt.claims', '', true);
  return (v_result ->> 'order_id')::uuid;
end;
$$;

-- The sign-in limit accepts only the apps once a digest of their proof is in
-- Vault (20261121083300_web_followups.sql). A hosted project that has stored
-- one (runbook, "Migrations 083200 and 083300") would refuse the suites, which
-- do not hold the apps' key. This sets the digest the limit sees for this
-- transaction only, which every suite rolls back: null means none configured
-- (an empty value, as the check reads it). Where the database has no real
-- Vault (local runs, CI), it does nothing: 130_web_followups brings a
-- stand-in of its own there.
create function pg_temp.set_caller_digest(p_digest text) returns void
language plpgsql as $$
declare
  v_id uuid;
begin
  if to_regprocedure('vault.update_secret(uuid, text, text, text, uuid)') is null then
    return;
  end if;
  execute $q$select id from vault.secrets where name = 'auth_limit_caller_digest'$q$ into v_id;
  if v_id is not null then
    execute 'select vault.update_secret($1, $2)' using v_id, coalesce(p_digest, '');
  elsif p_digest is not null then
    execute 'select vault.create_secret($1, $2)' using p_digest, 'auth_limit_caller_digest';
  end if;
end;
$$;

-- The seed's settings for Hacienda's fictitious demo issuer (seed.sql): the
-- issuer ready and simulated money documented, so the local fake of Hacienda
-- has something to receive. A database seeded before 083500 (the hosted
-- preview) never got them and keeps `ready` and `simulated_payments` false;
-- this gives the suites the seed's settings for their own transaction only,
-- which rolls back. Where the seed ran after the migration it changes nothing.
create function pg_temp.seed_invoicing_settings() returns void
language sql as $$
  update public.app_settings set value = jsonb_set(value, '{ready}', 'true')
  where key = 'invoicing_issuer' and value ->> 'id_number' = '3101123456';
  update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'true')
  where key = 'invoicing_policy'
    and (select value ->> 'id_number' from public.app_settings where key = 'invoicing_issuer') = '3101123456';
$$;

-- The seed's shop awaiting approval (bazar-nuevo) and its listing awaiting
-- review (lampara-mesa-bambu), which the access suites use as "not yet
-- approved". On a used database staff may have approved them: for this
-- transaction only, which rolls back, they are put back as the seed made
-- them. On a fresh seed this changes nothing.
create function pg_temp.seed_awaiting_approval() returns void
language sql as $$
  update public.sellers set status = 'pending' where slug = 'bazar-nuevo' and status <> 'pending';
  update public.seller_private set kyc_status = 'pending'
  where seller_id = (select id from public.sellers where slug = 'bazar-nuevo') and kyc_status <> 'pending';
  update public.products set status = 'pending_review'
  where slug = 'lampara-mesa-bambu' and status <> 'pending_review';
$$;


-- The seed's paid card order waiting to be picked (seed-today-d1) while it
-- still is; otherwise (a used database, where people moved it on) a card
-- order the same shopper places and pays now with the simulation, as the seed
-- did, for this transaction only. Returns its id.
create function pg_temp.paid_order(p_key text) returns uuid
language plpgsql as $$
declare
  v_order uuid;
  v_user uuid;
  v_result jsonb;
begin
  select o.id into v_order from public.orders o join public.shipments s on s.order_id = o.id
  where o.idempotency_key = 'seed-today-d1' and o.status in ('confirmed', 'processing') and s.status = 'pending';
  if v_order is not null then
    return v_order;
  end if;
  select id into strict v_user from auth.users where email = 'comprador@yuntera.example';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_result := public.place_order(
    jsonb_build_array(jsonb_build_object('offer_id', pg_temp.offer('laptop-14-nimbo-libro'), 'quantity', 1),
                      jsonb_build_object('offer_id', pg_temp.offer('cargador-usb-c-30w-nimbo'), 'quantity', 1)),
    (select a.id from public.addresses a where a.user_id = v_user and a.is_default and a.deleted_at is null),
    'card', p_key);
  perform public.confirm_sandbox_payment((v_result ->> 'order_id')::uuid);
  perform set_config('request.jwt.claims', '', true);
  return (v_result ->> 'order_id')::uuid;
end;
$$;

-- On a used database a payout run may already be open (the payouts journey
-- schedules one) and would hold the suite's sellers out of its own run: its
-- payouts are recorded as failed, the way finance records a transfer the bank
-- returned (the money is the shop's to be paid again, as in the seed), and a
-- run made today is moved ten years back with its references, for this
-- transaction only. On a fresh seed there is none.
create function pg_temp.set_aside_payout_runs() returns void
language plpgsql as $$
declare
  p record;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = 'central@yuntera.example'),
    'role', 'authenticated', 'aal', 'aal2')::text, true);
  for p in select id from public.payouts where status = 'scheduled' order by created_at, id loop
    perform public.ops_mark_payout_failed(p.id, 'Apartado por las pruebas de la base de datos');
  end loop;
  perform set_config('request.jwt.claims', '', true);
  update public.payouts x set reference = x.reference || '-PREVIA'
  from public.payout_runs r where r.id = x.run_id and r.cutoff_on = private.cr_local(now())::date;
  update public.payout_runs set cutoff_on = cutoff_on - 3650, code = code || '-PREVIA'
  where cutoff_on = private.cr_local(now())::date;
end;
$$;
