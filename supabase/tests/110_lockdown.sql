-- Lockdown: the functions are the only door (20261121082800_lockdown.sql).
--
-- Part 1 is a guard over the whole catalogue. It fails when any migration,
-- including one merged after the lockdown, leaves a privilege on a table, view
-- or sequence for `anon`, `authenticated` or PUBLIC; adds a function in
-- `public` that is not owner's-rights with an empty search path; lets a role
-- execute a function that the list in docs/03-data/access-control.md does not
-- name for it; leaves a table without row-level security; writes a policy
-- that reads another of our tables directly or calls a caller's-rights
-- function; adds a policy other than `for select` on our tables; or leaves a
-- default that would grant new objects.
--
-- Part 2 replays each finding of the security review of 21 November 2026 as
-- its original reproduction, by the same kind of user. Each is now refused for
-- lack of a privilege, and where the legitimate action exists as a function,
-- the function is still there.
--
-- Part 3 tests the second lock: what each kind of user would see through the
-- read policies if a SELECT privilege came back by mistake.

begin;
\ir _helpers.sql

-- ═══ Part 1: the guard ══════════════════════════════════════════════════════

-- The documented lists. Keep these equal to the lists in
-- docs/03-data/access-control.md ("What each role may execute"); a unit test
-- in packages/db compares the two.
create temporary table allowed (role text, schema text, fn text) on commit drop;
insert into allowed (role, schema, fn)
-- BEGIN visitor functions
select 'anon', 'public', unnest(array[
  'auth_limit_release', 'auth_limit_reserve', 'cart_lines', 'check_request', 'checkout_quote', 'delivery_estimate', 'get_product',
  'list_categories', 'list_districts', 'report_content', 'search_products', 'shop_path_exists',
  'suggest_products'
])
-- END visitor functions
union all
-- BEGIN policy helpers
select r, 'private', unnest(array[
  'can_see_inbound', 'can_see_order', 'can_see_product', 'can_see_shipment', 'drives_route',
  'has_staff_role', 'is_seller_admin', 'is_seller_member', 'is_staff', 'my_driver_id',
  'my_seller_ids', 'my_warehouse_ids', 'owns_order', 'route_open_to_driver', 'sells_order_item',
  'seller_is_active', 'works_at', 'works_at_location'
])
-- END policy helpers
from unnest(array['anon', 'authenticated']) r
union all
-- BEGIN storage policy helpers
select 'authenticated', 'private', unnest(array[
  'photo_object_deletable', 'photo_object_insertable', 'photo_object_readable'
])
-- END storage policy helpers
;
-- Functions in `public` that no API role may execute.
create temporary table internal (fn text) on commit drop;
insert into internal (fn)
-- BEGIN internal functions
select unnest(array['reviewer_display_name'])
-- END internal functions
;
-- Functions in `public` that only a platform role may execute: the
-- notification worker (`service_role`) and the Auth server's hook
-- (`supabase_auth_admin`).
create temporary table worker_only (role text, fn text) on commit drop;
insert into worker_only (role, fn)
-- BEGIN server-side functions
select 'service_role', unnest(array[
  'worker_notify_apply_update', 'worker_notify_claim', 'worker_notify_defer', 'worker_notify_fail',
  'worker_notify_freeze', 'worker_notify_plan', 'worker_notify_sent', 'worker_notify_skip',
  'worker_payments_claim', 'worker_payments_event', 'worker_payments_hello',
  'worker_payments_report', 'worker_push_disable', 'worker_push_receipts_due'
])
union all
select 'supabase_auth_admin', unnest(array['hook_mfa_verification_attempt'])
-- END server-side functions
;

-- No privilege on any table, view, materialised view, foreign table or
-- sequence, at table or column level, for the API roles or PUBLIC.
do $$
declare
  found_ text;
begin
  select string_agg(format('%s.%s: %s %s', n.nspname, c.relname,
                           case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
                           acl.privilege_type), '; ' order by n.nspname, c.relname)
  into found_
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) acl
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'));
  assert found_ is null, format('API roles hold privileges on: %s', found_);

  select string_agg(format('%s.%s.%s: %s %s', n.nspname, c.relname, a.attname,
                           case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
                           acl.privilege_type), '; ')
  into found_
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(a.attacl) acl
  where n.nspname in ('public', 'private')
    and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'));
  assert found_ is null, format('API roles hold column privileges on: %s', found_);

  -- The same, asked the way PostgreSQL decides it (this also counts privileges
  -- inherited through another role).
  select string_agg(format('%s.%s (%s)', n.nspname, c.relname, r.rolname), '; ')
  into found_
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r (rolname)
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete, truncate, references, trigger')
         or has_any_column_privilege(r.rolname, c.oid, 'select, insert, update, references'));
  assert found_ is null, format('API roles can reach tables: %s', found_);

  select string_agg(format('%s.%s (%s)', n.nspname, c.relname, r.rolname), '; ')
  into found_
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r (rolname)
  where n.nspname in ('public', 'private') and c.relkind = 'S'
    and has_sequence_privilege(r.rolname, c.oid, 'usage, select, update');
  assert found_ is null, format('API roles can use sequences: %s', found_);

  -- Neither may create objects in our schemas.
  assert not has_schema_privilege('anon', 'public', 'create')
     and not has_schema_privilege('authenticated', 'public', 'create')
     and not has_schema_privilege('anon', 'private', 'create')
     and not has_schema_privilege('authenticated', 'private', 'create'),
    'an API role can create objects in public or private';
end
$$;

-- Every function in `public` runs with its owner's rights and an empty search path.
do $$
declare
  found_ text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into found_
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)));
  assert found_ is null, format('functions in public not owner''s-rights with search_path = '''': %s', found_);

  -- Owner's-rights functions in `private` pin the search path too.
  select string_agg(p.proname, ', ' order by p.proname) into found_
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prosecdef
    and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)));
  assert found_ is null, format('owner''s-rights functions in private without search_path = '''': %s', found_);
end
$$;

-- Who may execute what: only what the documented lists name.
do $$
declare
  found_ text;
begin
  select string_agg(format('%s.%s(%s) to %s', g.nspname, g.proname, g.args, g.grantee), '; '
                    order by g.nspname, g.proname, g.grantee)
  into found_
  from (
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
           p.prorettype = 'trigger'::regtype as is_trigger,
           case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    -- No ACL at all means PostgreSQL's default: executable by PUBLIC.
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname in ('public', 'private') and acl.privilege_type = 'EXECUTE'
  ) g
  where g.grantee = 'PUBLIC'
     or (g.grantee in ('anon', 'authenticated') and not (
          -- a helper the policies call
          exists (select 1 from pg_temp.allowed a
                  where a.role = g.grantee and a.schema = g.nspname and a.fn = g.proname)
          -- signed-in users: every API function, each of which checks its caller
          or (g.grantee = 'authenticated' and g.nspname = 'public' and not g.is_trigger
              and g.proname not in (select fn from pg_temp.internal)
              and g.proname not in (select fn from pg_temp.worker_only))));
  assert found_ is null, format('functions executable beyond the documented list: %s', found_);

  -- Every function in `public` that a signed-in user cannot execute is on one
  -- of the two lists, so neither list hides a function that is simply missing
  -- its grant.
  select string_agg(p.proname, ', ' order by p.proname) into found_
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
    and not has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname not in (select fn from pg_temp.internal)
    and p.proname not in (select fn from pg_temp.worker_only);
  assert found_ is null, format('public functions no signed-in user may execute, on no list: %s', found_);

  -- The worker and the Auth hook keep exactly what they need: their own
  -- functions, which no API role may call.
  select string_agg(w.fn, ', ') into found_
  from pg_temp.worker_only w
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = w.fn
                      and has_function_privilege(w.role, p.oid, 'execute')
                      and not has_function_privilege('authenticated', p.oid, 'execute')
                      and not has_function_privilege('anon', p.oid, 'execute'));
  assert found_ is null, format('server-side functions not reserved to their role: %s', found_);

  -- And the lists name nothing that does not exist (a stale list hides drift).
  select string_agg(a.schema || '.' || a.fn, ', ') into found_
  from pg_temp.allowed a
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = a.schema and p.proname = a.fn
                      and has_function_privilege(a.role, p.oid, 'execute'));
  assert found_ is null, format('documented as executable but not: %s', found_);
end
$$;

-- A deferred trigger runs at COMMIT, after the owner's-rights function that
-- caused it has returned, with the API role's rights. Those can read nothing,
-- so such a trigger must run with its owner's rights. (The suites roll back,
-- so without this check they would never see it fail; the apps commit.)
do $$
declare
  found_ text;
begin
  select string_agg(format('%s on %s', t.tgname, t.tgrelid::regclass), ', ') into found_
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and t.tgdeferrable and not p.prosecdef;
  assert found_ is null, format('deferred triggers without owner''s rights: %s', found_);
end
$$;

-- Row-level security is on for every table, in both schemas.
do $$
declare
  found_ text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into found_
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity;
  assert found_ is null, format('tables without row-level security: %s', found_);
end
$$;

-- No policy, in any schema, reads a table of `public` or `private` other than
-- its own directly, or calls a function that runs with the caller's rights
-- (other than the pure helpers named here). Either would fail for lack of a
-- privilege; a policy must ask an owner's-rights helper in `private` instead.
-- Only read policies remain on our tables: a write policy would reopen a hole
-- the moment a write privilege came back by mistake.
do $$
declare
  found_ text;
begin
  select string_agg(format('%s on %s reads %s', pol.polname, pol.polrelid::regclass, d.refobjid::regclass),
                    '; ')
  into found_
  from pg_policy pol
  join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
  join pg_class c on c.oid = d.refobjid and d.refclassid = 'pg_class'::regclass
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and d.refobjid <> pol.polrelid;
  assert found_ is null, format('policies that read a table directly: %s', found_);

  select string_agg(format('%s on %s calls %s.%s', pol.polname, pol.polrelid::regclass, n.nspname, p.proname),
                    '; ')
  into found_
  from pg_policy pol
  join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
                  and d.refclassid = 'pg_proc'::regclass
  join pg_proc p on p.oid = d.refobjid
  join pg_namespace n on n.oid = p.pronamespace
  where not p.prosecdef
    and n.nspname <> 'pg_catalog'
    -- Read only the request's claims or the object's name, no table.
    and (n.nspname, p.proname) not in (('auth', 'uid'), ('auth', 'jwt'), ('auth', 'role'),
                                       ('storage', 'foldername'), ('storage', 'filename'),
                                       ('storage', 'extension'));
  assert found_ is null, format('policies that call a caller''s-rights function: %s', found_);

  select string_agg(format('%s on %s (%s)', pol.polname, pol.polrelid::regclass, pol.polcmd), '; ')
  into found_
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and pol.polcmd <> 'r';
  assert found_ is null, format('policies other than for select: %s', found_);
end
$$;

-- Nothing created later is granted by default. The migrations run as
-- `postgres`; its default privileges must give the API roles and PUBLIC
-- nothing, globally and in every schema but `storage`.
--
-- `storage` is the platform's: on a hosted project Supabase itself gives
-- `anon` and `authenticated` everything on tables, sequences and functions
-- that `postgres` creates there, and the lockdown leaves the platform's
-- schemas alone (20261121082800_lockdown.sql, section 6). Those defaults
-- apply only to objects `postgres` creates in `storage`, and no migration
-- creates one; where the storage service's own role exists (a hosted
-- project), the second check proves `postgres` owns nothing there.
do $$
declare
  found_ text;
begin
  select string_agg(format('%s %s: %s', coalesce(nullif(d.defaclnamespace, 0)::regnamespace::text, '(all)'),
                           d.defaclobjtype,
                           case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end),
                    '; ')
  into found_
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) acl
  where d.defaclrole = 'postgres'::regrole
    and d.defaclobjtype in ('r', 'S', 'f')
    and d.defaclnamespace is distinct from 'storage'::regnamespace
    and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'));
  assert found_ is null, format('default privileges still grant: %s', found_);

  if exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    select string_agg(o, ', ') into found_ from (
      select c.relname::text as o from pg_class c
      where c.relnamespace = 'storage'::regnamespace and c.relowner = 'postgres'::regrole
      union all
      select p.proname::text from pg_proc p
      where p.pronamespace = 'storage'::regnamespace and p.proowner = 'postgres'::regrole
    ) x;
    assert found_ is null,
      format('postgres owns objects in storage, which its default privileges give to anon and authenticated: %s', found_);
  end if;

  -- Without an entry, PostgreSQL lets PUBLIC execute every new function.
  assert exists (select 1 from pg_default_acl d
                 where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0
                   and d.defaclobjtype = 'f'),
    'new functions would be executable by PUBLIC';
end
$$;

-- ═══ Part 2: the findings, one by one ═══════════════════════════════════════

-- Runs a statement that must be refused for lack of a privilege.
create function pg_temp.denied(p_id text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception '%: not refused: %', p_id, p_sql;
exception when insufficient_privilege then
  null; -- expected
end;
$$;
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.denied(text, text) to authenticated, anon;

-- Who a staff role is played by: comprador3, given the role for one block.
create function pg_temp.staff_as(p_role public.staff_role) returns void
language sql as $$
  delete from public.staff_members
  where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
  insert into public.staff_members (user_id, role)
  select id, p_role from auth.users where email = 'comprador3@yuntera.example';
$$;

select pg_temp.remember('sendero', (select id::text from public.sellers where slug = 'tienda-sendero'));
select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('licuadora_sku',
  (select k.id::text from public.skus k join public.products p on p.id = k.product_id
   where p.slug = 'licuadora-volcan-600w' limit 1));
select pg_temp.remember('shared_product',
  (select id::text from public.products where slug = 'audifonos-inalambricos-nimbo-aire'));
select pg_temp.remember('category_cocina', (select id::text from public.categories where slug = 'cocina-electrica'));
select pg_temp.remember('comprador2', (select id::text from auth.users where email = 'comprador2@yuntera.example'));
select pg_temp.remember('comprador3', (select id::text from auth.users where email = 'comprador3@yuntera.example'));
select pg_temp.remember('central', (select id::text from auth.users where email = 'central@yuntera.example'));
select pg_temp.remember('buyer_order',
  (select o.order_number from public.orders o join auth.users u on u.id = o.user_id
   where u.email = 'comprador@yuntera.example'
     and exists (select 1 from private.delivery_codes c where c.order_id = o.id)
     and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')
   order by o.placed_at desc limit 1));
select pg_temp.remember('delivered_item', (
  select i.id::text
  from public.order_items i
  join public.orders o on o.id = i.order_id
  join auth.users u on u.id = o.user_id
  where u.email = 'comprador@yuntera.example' and o.status in ('delivered', 'completed')
    and not exists (select 1 from public.return_requests r where r.order_item_id = i.id)
  order by o.placed_at, i.id limit 1));

-- ── DTA-3, INT-M1: a refunded return set back to approved ──────────────────
-- A return is claimed, approved and refunded through the functions, as the
-- console does it. Then support (DTA-3) and an administrator (INT-M1) try to
-- reopen it by writing its status.

select pg_temp.login('comprador@yuntera.example');
select set_config('t.return_id', public.request_return(
  current_setting('t.delivered_item')::uuid, 'damaged', 1,
  'La caja llegó abierta y el producto golpeado.')::text, true);
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
select public.ops_decide_return(current_setting('t.return_id')::uuid, true, 'Foto recibida.');
-- Since the integrity migration (082900) a return is refunded only after the
-- goods are recorded back.
select public.ops_receive_return(current_setting('t.return_id')::uuid, false, 'Recibido golpeado.');
select public.ops_complete_return(current_setting('t.return_id')::uuid, 'Reembolso enviado.');
select pg_temp.denied('DTA-3', format(
  $q$update public.return_requests set status = 'approved', resolved_at = null where id = %L$q$,
  current_setting('t.return_id')));
select pg_temp.denied('DTA-3', format(
  $q$update public.return_requests set status = 'received' where id = %L$q$, current_setting('t.return_id')));
reset role;
select pg_temp.login('central@yuntera.example');
select pg_temp.denied('INT-M1', format(
  $q$update public.return_requests set status = 'approved' where id = %L$q$, current_setting('t.return_id')));
reset role;
do $$
begin
  assert (select status from public.return_requests where id = current_setting('t.return_id')::uuid) = 'refunded',
    'DTA-3: the return stays refunded';
  assert (select count(*) from public.ledger_transactions t
          where t.kind = 'return_refund'
            and t.order_id = (select i.order_id from public.order_items i
                              where i.id = current_setting('t.delivered_item')::uuid)) = 1,
    'DTA-3: one refund in the ledger';
end
$$;

-- ── DTA-1: an offer on a competitor's listing ──────────────────────────────

select pg_temp.login('sendero@yuntera.example');
select pg_temp.denied('DTA-1', format(
  $q$insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days, status, condition)
     values (%L, %L, 100, 'seller', 0, 'active', 'new')$q$,
  current_setting('t.licuadora_sku'), current_setting('t.sendero')));
reset role;
select pg_temp.login_anon();
do $$
begin
  assert public.get_product('licuadora-volcan-600w')::text not like '%Sendero%',
    'DTA-1: the listing carries no offer from the other shop';
end
$$;
reset role;

-- ── DTA-2, INT-4, WEB-1: staff reading every delivery code ─────────────────

do $$
declare
  v_role public.staff_role;
  v_pin text;
begin
  foreach v_role in array array['ops', 'support', 'finance', 'admin']::public.staff_role[] loop
    perform pg_temp.staff_as(v_role);
    perform pg_temp.login('comprador3@yuntera.example');
    -- Since the integrity migration (082900) the code lives in its own private
    -- table; the column the review read no longer exists.
    perform pg_temp.denied('DTA-2', 'select order_id, code from private.delivery_codes');
    perform pg_temp.denied('INT-4', 'select count(code) from private.delivery_codes');
    perform pg_temp.denied('INT-4', 'select count(*) from private.delivery_code_attempts');
    -- The order functions staff use leave the code out.
    assert public.get_order(current_setting('t.buyer_order')) ->> 'delivery_pin' is null,
      format('WEB-1: %s staff see no delivery code through get_order', v_role);
    reset role;
  end loop;
  -- A driver neither.
  perform pg_temp.login('repartidor@yuntera.example');
  perform pg_temp.denied('WEB-1', 'select code from private.delivery_codes');
  assert public.driver_today()::text not like '%delivery_pin%', 'WEB-1: no code on the driver''s route';
  reset role;
  -- The shopper still has theirs, through the function.
  perform pg_temp.login('comprador@yuntera.example');
  v_pin := public.get_order(current_setting('t.buyer_order')) ->> 'delivery_pin';
  assert v_pin ~ '^[0-9]{4}$', 'WEB-1: the shopper reads their own code';
  reset role;
end
$$;

-- ── DTA-4: tax rate and badges set directly ────────────────────────────────

select pg_temp.login('sendero@yuntera.example');
select pg_temp.denied('DTA-4', format(
  $q$insert into public.products (slug, title, category_id, status, created_by_seller_id, tax_rate_bps,
                                  made_in_cr, warranty_months)
     values ('licuadora-sin-iva', 'Licuadora sin IVA', %L, 'pending_review', %L, 0, true, 120)$q$,
  current_setting('t.category_cocina'), current_setting('t.sendero')));
select pg_temp.denied('DTA-4', format(
  $q$update public.products set tax_rate_bps = 0, made_in_cr = true where created_by_seller_id = %L$q$,
  current_setting('t.sendero')));
reset role;
do $$
begin
  -- The legitimate way: the listing function, which takes the rate from the category.
  assert to_regprocedure('public.seller_create_listing(uuid, text, text, text, text[], bigint, '
                         'public.fulfillment_type, smallint, integer, numeric, numeric, numeric, boolean)')
         is not null, 'DTA-4: seller_create_listing exists';
end
$$;

-- ── DTA-5: taking down a shared listing ────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
select pg_temp.denied('DTA-5', $q$update public.products set status = 'archived'
                                  where slug = 'audifonos-inalambricos-nimbo-aire'$q$);
select pg_temp.denied('DTA-5', $q$update public.products set status = 'draft'
                                  where slug = 'audifonos-inalambricos-nimbo-aire'$q$);
select pg_temp.denied('DTA-5', format($q$update public.skus set active = false where product_id = %L$q$,
                                      current_setting('t.shared_product')));
-- The function still refuses, as it always did.
do $$
begin
  perform public.seller_archive_listing(current_setting('t.shared_product')::uuid);
  raise exception 'DTA-5: a shared listing was archived';
exception when others then
  if sqlerrm <> 'listing_shared' then raise; end if;
end
$$;
reset role;
select pg_temp.login_anon();
do $$
begin
  assert public.get_product('audifonos-inalambricos-nimbo-aire') is not null, 'DTA-5: the page is still up';
end
$$;
reset role;

-- ── DTA-6: accounts added to a shop without consent ────────────────────────

select pg_temp.login('sendero@yuntera.example');
select pg_temp.denied('DTA-6', format(
  $q$insert into public.seller_members (seller_id, user_id, role) values (%L, %L, 'admin'), (%L, %L, 'staff')$q$,
  current_setting('t.sendero'), current_setting('t.comprador2'),
  current_setting('t.sendero'), current_setting('t.central')));
select pg_temp.denied('DTA-6', format(
  $q$update public.seller_members set user_id = %L where seller_id = %L$q$,
  current_setting('t.comprador3'), current_setting('t.sendero')));
select pg_temp.denied('DTA-6', format(
  $q$delete from public.seller_members where seller_id = %L and role <> 'owner'$q$, current_setting('t.sendero')));
reset role;
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.denied('DTA-6', 'select legal_name, id_number, sinpe_movil_number from public.seller_private');
reset role;

-- ── DTA-7: fees changed with no audit ──────────────────────────────────────

select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('DTA-7', $q$update public.categories set referral_bps = 0 where slug = 'electronica'$q$);
select pg_temp.denied('DTA-7', $q$update public.categories set default_tax_rate_bps = 0 where slug = 'electronica'$q$);
reset role;
select pg_temp.staff_as('ops');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('DTA-7', 'update public.delivery_zones set shipping_fee_minor = 0');
select pg_temp.denied('DTA-7', 'insert into public.holidays (day, name) values (current_date, ''Feriado'')');
reset role;
select pg_temp.staff_as('finance');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('DTA-7', 'update public.fee_fulfillment_tiers set fee_minor = 0');
select pg_temp.denied('DTA-7', 'update public.fee_schedules set active = false');
reset role;

-- ── DTA-8: complaints, reports and reviews closed directly ─────────────────

select pg_temp.login('comprador@yuntera.example');
select set_config('t.complaint', public.file_complaint('delivery', 'El repartidor no tocó el timbre.')::text, true);
select set_config('t.report', public.report_content('product', current_setting('t.shared_product')::uuid,
                                                    'counterfeit')::text, true);
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('DTA-8', format(
  $q$update public.content_reports set status = 'actioned', resolved_by = %L, resolution = 'x' where id = %L$q$,
  current_setting('t.central'), current_setting('t.report')));
select pg_temp.denied('DTA-8', format(
  $q$update public.complaints set status = 'resolved' where id = %L$q$, current_setting('t.complaint')));
select pg_temp.denied('DTA-8', $q$update public.reviews set status = 'published'$q$);
-- The functions that do it properly still work.
select public.ops_resolve_complaint(current_setting('t.complaint')::uuid,
                                    'Hablamos con el repartidor y le ofrecimos disculpas.', true);
reset role;
select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('DTA-8', $q$update public.reviews set status = 'rejected', moderation_note = 'x'$q$);
select public.ops_resolve_report(current_setting('t.report')::uuid, false,
                                 'Revisamos la publicación y no infringe las reglas.');
reset role;
do $$
begin
  assert (select status from public.complaints where id = current_setting('t.complaint')::uuid) <> 'open',
    'DTA-8: the complaint was answered through the function';
  assert (select resolved_by from public.content_reports where id = current_setting('t.report')::uuid)
       = current_setting('t.comprador3')::uuid, 'DTA-8: and the report names who really resolved it';
end
$$;

-- ── DTA-9, FA-M4: reviewers' accounts and staff notes ──────────────────────

select pg_temp.login_anon();
select pg_temp.denied('DTA-9', 'select id, user_id, order_item_id from public.reviews');
select pg_temp.denied('FA-M4', 'select moderation_note from public.reviews');
select pg_temp.denied('DTA-9', format('select public.reviewer_display_name(%L)', current_setting('t.central')));
do $$
declare
  r jsonb := public.get_product('audifonos-inalambricos-nimbo-aire') -> 'reviews' -> 0;
begin
  assert r ->> 'author' is not null and not (r ? 'user_id') and not (r ? 'order_item_id')
         and not (r ? 'moderation_note'), 'DTA-9: the product page shows a display name only';
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example');
select pg_temp.denied('DTA-9', format('select public.reviewer_display_name(%L)', current_setting('t.central')));
reset role;

-- ── DTA-10: every customer profile; drivers' identity numbers ──────────────

select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('DTA-10', 'select count(*), count(phone) from public.profiles');
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.denied('DTA-10', 'select count(id_number) from public.drivers');
reset role;

-- ── DTA-11, DTA-12: shop name and fiscal details ───────────────────────────

select pg_temp.login('sendero@yuntera.example');
select pg_temp.denied('DTA-11', $q$update public.sellers set trade_name = 'Yuntera Oficial' where slug = 'tienda-sendero'$q$);
select pg_temp.denied('DTA-11', $q$update public.sellers set logo_path = 'data:image/svg+xml,<svg/>'$q$);
select pg_temp.denied('DTA-12', $q$update public.seller_private set tax_regime = 'simplificado',
                                   fiscal_address = 'Otra', economic_activity_code = '999999'$q$);
reset role;

-- ── DTA-13: back-dated consent ─────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
select pg_temp.denied('DTA-13', $q$insert into public.consents (user_id, purpose, policy_version, granted_at)
                                   values (auth.uid(), 'terms', 'v-fake', '2020-01-01')$q$);
select pg_temp.denied('DTA-13', 'update public.consents set revoked_at = null where user_id = auth.uid()');
select pg_temp.denied('DTA-13', $q$update public.consents set revoked_at = '2019-01-01' where user_id = auth.uid()$q$);
reset role;
do $$
begin
  assert to_regprocedure('public.record_consent(text, text)') is not null, 'DTA-13: record_consent exists';
end
$$;

-- ── DTA-14: photos written directly ────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
select pg_temp.denied('DTA-14', format(
  $q$insert into public.product_images (product_id, path) values (%L, 'data:image/svg+xml;base64,PHN2Zy8+')$q$,
  current_setting('t.shared_product')));
select pg_temp.denied('DTA-14', format(
  $q$update public.product_images set path = 'https://evil.example/x.png' where product_id = %L$q$,
  current_setting('t.shared_product')));
select pg_temp.denied('DTA-14', format('delete from public.product_images where product_id = %L',
                                       current_setting('t.shared_product')));
reset role;

-- ── DTA-15, DTA-M1: suspended sellers' products; sales volumes ─────────────
-- The direct read is closed here. The product page itself (get_product and
-- shop_path_exists) is closed by the limits migration (083000); its test is
-- in 120_limits.sql ("Merge: what the streams left to each other").

update public.sellers set status = 'suspended' where slug = 'tienda-sendero';
select pg_temp.login_anon();
select pg_temp.denied('DTA-15', format('select count(*) from public.products where created_by_seller_id = %L',
                                       current_setting('t.sendero')));
select pg_temp.denied('DTA-M1', 'select slug, units_sold_30d from public.products order by units_sold_30d desc');
select pg_temp.denied('DTA-M1', 'select slug, views_30d, return_rate, price_index from public.products');
select pg_temp.denied('DTA-M1', 'select score, health from public.sellers');
do $$
begin
  -- The catalogue functions do not return the ranking signals.
  assert not exists (
    select 1 from pg_proc p, unnest(p.proargnames) a
    where p.oid in ('public.search_products'::regproc, 'public.suggest_products'::regproc)
      and a in ('units_sold_30d', 'views_30d', 'return_rate', 'price_index')
  ), 'DTA-M1: search does not return sales volumes';
  assert public.get_product('licuadora-volcan-600w')::text not like '%units_sold%',
    'DTA-M1: nor does the product page';
end
$$;
reset role;
update public.sellers set status = 'active' where slug = 'tienda-sendero';

-- ── DTA-M2: fulfilment flipped directly ────────────────────────────────────

select pg_temp.login('sendero@yuntera.example');
select pg_temp.denied('DTA-M2', format(
  $q$update public.offers set fulfillment = 'seller' where seller_id = %L and fulfillment = 'platform'$q$,
  current_setting('t.sendero')));
select pg_temp.denied('DTA-M2', format(
  $q$update public.offers set status = 'active' where seller_id = %L$q$, current_setting('t.sendero')));
reset role;

-- ═══ Part 3: the second lock ════════════════════════════════════════════════
--
-- The policies are what would still stand if a privilege came back by
-- mistake. To see them work, this part gives `authenticated` that mistaken
-- privilege (SELECT on the tables that hold personal data, inside this
-- rolled-back transaction only) and checks what each kind of user would see.
-- Without the policies, or with one opened to everyone, these counts change.

select pg_temp.remember('n_profiles', (select count(*)::text from public.profiles));
select pg_temp.remember('n_drivers', (select count(*)::text from public.drivers));
select pg_temp.remember('n_orders', (select count(*)::text from public.orders));
select pg_temp.remember('buyer_orders', (
  select count(*)::text from public.orders o join auth.users u on u.id = o.user_id
  where u.email = 'comprador@yuntera.example'));
select pg_temp.remember('c3_orders', (
  select count(*)::text from public.orders o join auth.users u on u.id = o.user_id
  where u.email = 'comprador3@yuntera.example'));
select pg_temp.remember('buyer_items', (
  select count(*)::text from public.order_items i join public.orders o on o.id = i.order_id
  join auth.users u on u.id = o.user_id where u.email = 'comprador@yuntera.example'));
select pg_temp.remember('vendedor_items', (
  select count(*)::text from public.order_items i
  where i.seller_id in (select m.seller_id from public.seller_members m
                        join auth.users u on u.id = m.user_id where u.email = 'vendedor@yuntera.example')));
select pg_temp.remember('carlos_open_stops', (
  select count(*)::text from public.route_stops rs
  join public.routes r on r.id = rs.route_id
  join public.drivers d on d.id = r.driver_id
  join auth.users u on u.id = d.user_id
  where u.email = 'repartidor@yuntera.example'
    and (r.status in ('assigned', 'in_progress')
         or (r.status = 'completed' and r.completed_at > now() - interval '24 hours'))));
grant select on public.profiles, public.drivers, public.orders, public.order_items,
                public.payments, public.route_stops
to authenticated;

-- DTA-10: customer profiles are for support only, drivers' records for ops only.
select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  assert (select count(*) from public.profiles) = 1, 'DTA-10: catalog staff see only their own profile';
  assert (select count(*) from public.drivers) = 0, 'DTA-10: catalog staff see no driver';
  assert (select count(*) from public.orders) = current_setting('t.c3_orders')::bigint,
    'catalog staff see only the orders they placed themselves';
end
$$;
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  assert (select count(*) from public.profiles) = current_setting('t.n_profiles')::bigint,
    'support see the customer profiles';
  assert (select count(*) from public.drivers) = 0, 'DTA-10: support see no driver record';
  assert (select count(*) from public.orders) = current_setting('t.n_orders')::bigint,
    'support see the orders';
end
$$;
reset role;
select pg_temp.staff_as('ops');
select pg_temp.login('comprador3@yuntera.example');
do $$
begin
  assert (select count(*) from public.drivers) = current_setting('t.n_drivers')::bigint
     and current_setting('t.n_drivers')::integer > 0, 'ops see the drivers';
  assert (select count(*) from public.profiles) = 1, 'DTA-10: ops see only their own profile';
end
$$;
reset role;
delete from public.staff_members
where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');

-- A shopper: their own orders, lines and profile, and nobody else's.
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert (select count(*) from public.orders) = current_setting('t.buyer_orders')::bigint
     and current_setting('t.buyer_orders')::integer > 0, 'a shopper sees only their own orders';
  assert (select count(*) from public.order_items) = current_setting('t.buyer_items')::bigint,
    'and only their lines';
  assert (select count(*) from public.profiles) = 1, 'and only their own profile';
  assert (select count(*) from public.drivers) = 0, 'and no driver';
end
$$;
reset role;

-- A seller: the lines they sold, never the order, its payment or the buyer.
select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  assert (select count(*) from public.order_items) = current_setting('t.vendedor_items')::bigint
     and current_setting('t.vendedor_items')::integer > 0, 'a seller sees exactly the lines they sold';
  assert (select count(*) from public.orders) = 0, 'a seller sees no order';
  assert (select count(*) from public.payments) = 0, 'a seller sees no payment';
  assert (select count(*) from public.profiles) = 1, 'a seller sees only their own profile';
end
$$;
reset role;

-- A driver: the stops of their own open routes, their own record, no order.
select pg_temp.login('repartidor@yuntera.example');
do $$
begin
  assert (select count(*) from public.route_stops) = current_setting('t.carlos_open_stops')::bigint
     and current_setting('t.carlos_open_stops')::integer > 0, 'a driver sees the stops of their open routes';
  assert (select count(*) from public.drivers) = 1, 'a driver sees only their own record';
  assert (select count(*) from public.orders) = 0, 'a driver sees no order';
  assert (select count(*) from public.order_items) = 0, 'nor what is in it';
  assert (select count(*) from public.profiles) = 1, 'a driver sees only their own profile';
end
$$;
reset role;

revoke select on public.profiles, public.drivers, public.orders, public.order_items,
                  public.payments, public.route_stops
from authenticated;

rollback;
