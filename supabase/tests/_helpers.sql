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
