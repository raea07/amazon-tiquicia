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

create function pg_temp.login(p_email text, p_aal text default 'aal1') returns void
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
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_result := public.place_order(
    jsonb_build_array(jsonb_build_object(
      'offer_id', pg_temp.offer('parlante-bluetooth-nimbo-ola'), 'quantity', 1)),
    (select a.id from public.addresses a where a.user_id = v_user and a.is_default),
    'sinpe_movil', p_key);
  perform set_config('request.jwt.claims', '', true);
  return (v_result ->> 'order_id')::uuid;
end;
$$;
