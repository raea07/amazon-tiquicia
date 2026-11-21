-- Access control: what each kind of user can and cannot reach.
--
-- Every block runs as a real API role with real claims, against the seed data.
-- A failure here means personal data or a privileged action is exposed.

begin;
\ir _helpers.sql

-- Facts the impersonated blocks need but could not look up themselves.
select pg_temp.remember('buyer2_order',
  (select o.id::text from public.orders o join auth.users u on u.id = o.user_id
   where u.email = 'comprador2@yuntera.example' limit 1));
select pg_temp.remember('buyer2_id',
  (select id::text from auth.users where email = 'comprador2@yuntera.example'));
select pg_temp.remember('cafetal_id', (select id::text from public.sellers where slug = 'cafetal-los-santos'));
select pg_temp.remember('tecnocasa_id', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('cafetal_offer', pg_temp.offer('cafe-molido-tarrazu-340g')::text);
select pg_temp.remember('tecnocasa_offer', pg_temp.offer('cargador-usb-c-30w-nimbo')::text);
select pg_temp.remember('luis_route',
  (select r.id::text from public.routes r join public.drivers d on d.id = r.driver_id
   where d.full_name like 'Luis%' limit 1));
select pg_temp.remember('luis_stop',
  (select rs.id::text from public.route_stops rs where rs.route_id = current_setting('t.luis_route')::uuid limit 1));
select pg_temp.remember('total_orders', (select count(*)::text from public.orders));

-- ── Visitor (not signed in) ────────────────────────────────────────────────

select pg_temp.login_anon();

do $$
declare
  n integer;
begin
  select count(*) into n from public.products;
  assert n = 26, format('visitor sees only the 26 active products, saw %s', n);
  assert not exists (select 1 from public.products where slug = 'lampara-mesa-bambu'),
    'a listing awaiting review is invisible';
  assert (select count(*) from public.sellers) = 4, 'only active sellers are public';
  assert not exists (
    select 1 from public.offers o join public.sellers s on s.id = o.seller_id where s.status <> 'active'
  ), 'offers of an unapproved seller are invisible';
  assert (select count(*) from public.search_products('cafe')) > 0, 'visitors can search';
  assert (select count(*) from public.reviews) > 0, 'published reviews are public';
end
$$;

-- Tables with personal or commercial data are not granted to visitors at all.
do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'order_items', 'payments', 'profiles', 'addresses', 'seller_private', 'stock_levels',
    'route_stops', 'ledger_entries', 'staff_members', 'drivers', 'shipments', 'pick_tasks'
  ] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'visitor could read %', t;
    exception when insufficient_privilege then
      null; -- expected
    end;
  end loop;
end
$$;

do $$
begin
  perform public.place_order('[]'::jsonb, gen_random_uuid(), 'card', 'visitor-attempt');
  raise exception 'visitor could call place_order';
exception when insufficient_privilege then
  null;
end
$$;

-- Anyone may report content, but must leave a way to be contacted.
insert into public.content_reports (reporter_email, target_type, target_id, reason)
values ('alguien@correo.example', 'product', gen_random_uuid(), 'counterfeit');

do $$
begin
  insert into public.content_reports (target_type, target_id, reason)
  values ('product', gen_random_uuid(), 'counterfeit');
  raise exception 'anonymous report without contact was accepted';
exception when insufficient_privilege or check_violation then
  null;
end
$$;

reset role;

-- ── Shopper ────────────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');

do $$
declare
  n integer;
  mine integer;
begin
  select count(*) into n from public.orders;
  select count(*) into mine from public.orders where user_id = auth.uid();
  assert n = mine and n > 0, 'a shopper sees exactly their own orders';
  assert not exists (select 1 from public.orders where id = current_setting('t.buyer2_order')::uuid),
    'another shopper''s order is invisible';
  assert not exists (
    select 1 from public.order_items where order_id = current_setting('t.buyer2_order')::uuid
  ), 'and so are its lines';
  assert (select count(*) from public.addresses) = 1, 'only their own address';
  assert (select count(*) from public.profiles) = 1, 'only their own profile';
  assert (select bool_and(delivery_pin ~ '^[0-9]{4}$') from public.orders), 'they can read their delivery PIN';

  -- Nothing operational or commercial leaks to a shopper.
  assert (select count(*) from public.seller_private) = 0, 'seller legal data';
  assert (select count(*) from public.stock_levels) = 0, 'stock levels';
  assert (select count(*) from public.route_stops) = 0, 'route stops';
  assert (select count(*) from public.routes) = 0, 'routes';
  assert (select count(*) from public.pick_tasks) = 0, 'pick tasks';
  assert (select count(*) from public.ledger_entries) = 0, 'ledger';
  assert (select count(*) from public.seller_order_fees) = 0, 'seller statements';
  assert (select count(*) from public.staff_members) = 0, 'staff list';
  assert (select count(*) from public.drivers) = 0, 'driver records';
  assert not exists (select 1 from public.order_events where not visible_to_customer),
    'internal notes on their orders';
end
$$;

-- Column privileges: system-maintained fields cannot be written through the API.
do $$
begin
  update public.products set rating_sum = 5000, rating_count = 1000;
  raise exception 'shopper rewrote product ratings';
exception when insufficient_privilege then null;
end
$$;

do $$
begin
  update public.profiles set phone_verified_at = now() where id = auth.uid();
  raise exception 'shopper verified their own phone';
exception when insufficient_privilege then null;
end
$$;

do $$
begin
  update public.orders set status = 'delivered' where user_id = auth.uid();
  raise exception 'shopper changed an order directly';
exception when insufficient_privilege then null;
end
$$;

do $$
declare
  n integer;
begin
  update public.profiles set full_name = 'María F. Solís' where id = auth.uid();
  get diagnostics n = row_count;
  assert n = 1, 'a shopper can edit their own name';

  update public.profiles set full_name = 'Intruso' where id = current_setting('t.buyer2_id')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'but not anyone else''s';

  -- Changing the phone number drops its verified status.
  update public.profiles set phone = '+50688889999' where id = auth.uid();
  assert (select phone_verified_at is null from public.profiles where id = auth.uid()),
    'a changed phone is unverified';
end
$$;

-- Privileged functions refuse a shopper, each with its own check.
do $$
begin
  perform public.ops_set_seller_status(current_setting('t.cafetal_id')::uuid, 'suspended', 'porque sí');
  raise exception 'shopper suspended a seller';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;

do $$
begin
  perform public.confirm_sandbox_payment(current_setting('t.buyer2_order')::uuid);
  raise exception 'shopper paid for a stranger''s order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

do $$
begin
  perform public.cancel_order(current_setting('t.buyer2_order')::uuid, 'no es mío');
  raise exception 'shopper cancelled a stranger''s order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

do $$
begin
  perform * from public.audit_entries();
  raise exception 'shopper read the audit trail';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;

do $$
begin
  perform * from public.seller_order_lines(current_setting('t.tecnocasa_id')::uuid);
  raise exception 'shopper read a seller''s sales';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;

-- A complaint can be filed only in one's own name.
insert into public.complaints (user_id, category, description)
values (auth.uid(), 'delivery', 'El paquete llegó un día tarde y nadie avisó.');

do $$
begin
  insert into public.complaints (user_id, category, description)
  values (current_setting('t.buyer2_id')::uuid, 'delivery', 'Queja a nombre de otra persona.');
  raise exception 'shopper filed a complaint as someone else';
exception when insufficient_privilege then null;
end
$$;

reset role;

-- ── Seller ─────────────────────────────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');

do $$
declare
  n integer;
begin
  assert (select count(*) from public.seller_private) = 2, 'legal data of their two sellers only';
  assert not exists (
    select 1 from public.seller_private where seller_id = current_setting('t.cafetal_id')::uuid
  ), 'a competitor''s legal and banking data is invisible';
  assert not exists (
    select 1 from public.stock_levels where seller_id = current_setting('t.cafetal_id')::uuid
  ), 'a competitor''s stock is invisible';
  assert (select count(*) from public.stock_levels) > 0, 'their own stock is visible';
  assert not exists (
    select 1 from public.seller_order_fees where seller_id = current_setting('t.cafetal_id')::uuid
  ), 'a competitor''s statements are invisible';

  -- They see the lines they sold …
  select count(*) into n from public.order_items;
  assert n > 0, 'sold lines are visible';
  assert not exists (
    select 1 from public.order_items i
    where i.seller_id not in (select seller_id from public.seller_members where user_id = auth.uid())
  ), 'only lines of their own sellers';
  -- … but have no path to the shopper's order, address, phone or delivery PIN.
  assert (select count(*) from public.orders) = 0, 'orders (delivery details, PIN) are invisible';
  assert (select count(*) from public.addresses) = 0, 'shopper addresses are invisible';
  assert (select count(*) from public.profiles) = 1, 'shopper profiles are invisible';
  assert (select count(*) from public.payments) = 0, 'payments are invisible';
  assert (select count(*) from public.route_stops) = 0, 'route stops are invisible';
end
$$;

do $$
declare
  line record;
begin
  select * into line from public.seller_order_lines(current_setting('t.tecnocasa_id')::uuid) limit 1;
  assert line.order_number is not null, 'the sales view works for their seller';
  -- The view offers a first name and a district, never a way to reach the shopper.
  assert position(' ' in line.buyer_first_name) = 0, 'first name only';

  perform * from public.seller_order_lines(current_setting('t.cafetal_id')::uuid);
  raise exception 'seller read a competitor''s sales';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;

-- Listings: a seller writes drafts, never publishes.
do $$
declare
  v_product uuid;
begin
  insert into public.products (slug, title, category_id, status, created_by_seller_id)
  values ('prueba-publicacion-directa', 'Producto publicado sin revisión',
          (select id from public.categories where slug = 'hogar'), 'active',
          current_setting('t.tecnocasa_id')::uuid);
  raise exception 'seller published a listing directly';
exception when others then
  if sqlerrm <> 'listing_needs_review' then raise; end if;
end
$$;

do $$
declare
  v_product uuid;
begin
  insert into public.products (slug, title, category_id, status, created_by_seller_id)
  values ('prueba-borrador', 'Producto en borrador de prueba',
          (select id from public.categories where slug = 'hogar'), 'draft',
          current_setting('t.tecnocasa_id')::uuid)
  returning id into v_product;

  update public.products set status = 'pending_review' where id = v_product;
  begin
    update public.products set status = 'active' where id = v_product;
    raise exception 'seller approved their own listing';
  exception when others then
    if sqlerrm <> 'listing_needs_review' then raise; end if;
  end;
end
$$;

do $$
begin
  insert into public.products (slug, title, category_id, status, created_by_seller_id)
  values ('prueba-ajena', 'Producto a nombre de otro vendedor',
          (select id from public.categories where slug = 'hogar'), 'draft',
          current_setting('t.cafetal_id')::uuid);
  raise exception 'seller created a listing for a competitor';
exception when insufficient_privilege then null;
end
$$;

-- Offers: their own price is theirs to change; nothing else is.
do $$
declare
  n integer;
begin
  update public.offers set price_minor = price_minor + 100
  where id = current_setting('t.tecnocasa_offer')::uuid;
  get diagnostics n = row_count;
  assert n = 1, 'a seller can reprice their own offer';

  update public.offers set price_minor = 100 where id = current_setting('t.cafetal_offer')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'but not a competitor''s';
end
$$;

do $$
begin
  update public.offers set available_quantity = 99999
  where id = current_setting('t.tecnocasa_offer')::uuid;
  raise exception 'seller invented stock';
exception when insufficient_privilege then null;
end
$$;

do $$
begin
  insert into public.offers (sku_id, seller_id, price_minor)
  select sku_id, current_setting('t.cafetal_id')::uuid, 100
  from public.offers where id = current_setting('t.tecnocasa_offer')::uuid;
  raise exception 'seller made an offer in a competitor''s name';
exception when insufficient_privilege then null;
end
$$;

do $$
begin
  insert into public.seller_members (seller_id, user_id, role)
  values (current_setting('t.cafetal_id')::uuid, auth.uid(), 'owner');
  raise exception 'seller joined a competitor''s account';
exception when insufficient_privilege then null;
end
$$;

do $$
begin
  update public.sellers set status = 'active' where id = current_setting('t.tecnocasa_id')::uuid;
  raise exception 'seller changed their own standing';
exception when insufficient_privilege then null;
end
$$;

do $$
begin
  update public.seller_private set kyc_status = 'verified'
  where seller_id = current_setting('t.tecnocasa_id')::uuid;
  raise exception 'seller verified their own identity';
exception when insufficient_privilege then null;
end
$$;

reset role;

-- ── Driver ─────────────────────────────────────────────────────────────────

select pg_temp.login('repartidor@yuntera.example');

do $$
begin
  assert (select count(*) from public.routes) = 2, 'a driver sees only routes assigned to them';
  assert not exists (select 1 from public.routes where id = current_setting('t.luis_route')::uuid),
    'another driver''s route is invisible';
  assert (select count(*) from public.route_stops) > 0, 'their stops are visible';
  assert not exists (
    select 1 from public.route_stops where route_id = current_setting('t.luis_route')::uuid
  ), 'another driver''s stops are invisible';
  -- They can read the parcels on those routes (tracking code, package count) …
  assert (select count(*) from public.shipments) = (select count(*) from public.route_stops)
         and (select count(*) from public.shipments) > 0,
    'a driver sees exactly the parcels on their own routes';
  -- … and get the door details from the stop, but nothing more of the order.
  assert (select count(*) from public.orders) = 0, 'orders (and delivery PINs) are invisible';
  assert (select count(*) from public.order_items) = 0, 'what is in the parcel is invisible';
  assert (select count(*) from public.payments) = 0, 'payments are invisible';
  assert (select count(*) from public.addresses) = 0, 'address book is invisible';
  assert (select count(*) from public.drivers) = 1, 'only their own driver record';
end
$$;

do $$
begin
  perform public.driver_complete_stop(current_setting('t.luis_stop')::uuid, '0000', 'Nadie');
  raise exception 'driver completed a stop on someone else''s route';
exception when others then
  if sqlerrm <> 'stop_not_found' then raise; end if;
end
$$;

reset role;

-- A day after a route is finished, its stops (names, phones, directions) close to the driver.
update public.routes set completed_at = now() - interval '25 hours' where status = 'completed';
select pg_temp.login('repartidor@yuntera.example');
do $$
begin
  assert not exists (
    select 1 from public.route_stops rs join public.routes r on r.id = rs.route_id
    where r.status = 'completed'
  ), 'stops of a route finished over 24 hours ago are closed to the driver';
  assert exists (
    select 1 from public.route_stops rs join public.routes r on r.id = rs.route_id
    where r.status = 'in_progress'
  ), 'stops of the route in progress stay open';
end
$$;
reset role;

-- ── Warehouse associate ────────────────────────────────────────────────────

select pg_temp.login('bodega@yuntera.example');

do $$
begin
  assert (select count(*) from public.pick_tasks) > 0, 'pick tasks of their warehouse';
  assert (select count(*) from public.stock_levels) > 0, 'stock of their warehouse';
  assert not exists (
    select 1 from public.stock_levels l join public.warehouses w on w.id = l.warehouse_id
    where w.kind = 'seller'
  ), 'stock at sellers'' own locations is invisible';
  assert (select count(*) from public.orders) = 0, 'orders are invisible';
  assert (select count(*) from public.addresses) = 0, 'addresses are invisible';
  assert (select count(*) from public.seller_private) = 0, 'seller legal data is invisible';
  assert (select count(*) from public.ledger_entries) = 0, 'ledger is invisible';
end
$$;

do $$
begin
  perform public.ops_create_route(current_date, gen_random_uuid(), '[{"shipment_id": null}]'::jsonb);
  raise exception 'warehouse associate created a route';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;

reset role;

-- ── Staff ──────────────────────────────────────────────────────────────────

select pg_temp.login('central@yuntera.example');

do $$
begin
  assert (select count(*) from public.orders) = current_setting('t.total_orders')::integer,
    'operations staff see every order';
  assert (select count(*) from public.seller_private) = 5, 'and every seller, including pending';
  assert exists (select 1 from public.products where slug = 'lampara-mesa-bambu'),
    'and listings awaiting review';
  assert (select count(*) from public.audit_entries()) > 0, 'an admin can read the audit trail';
end
$$;

reset role;

-- With MFA required, a staff session without a second factor is an ordinary user.
update public.app_settings set value = 'true' where key = 'require_staff_mfa';

select pg_temp.login('central@yuntera.example', 'aal1');
do $$
begin
  assert (select count(*) from public.orders) = 0, 'no second factor, no staff access';
  assert (select count(*) from public.seller_private) = 0, 'no second factor, no seller data';
end
$$;
reset role;

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
begin
  assert (select count(*) from public.orders) = current_setting('t.total_orders')::integer,
    'with a second factor, staff access returns';
end
$$;
reset role;

-- ── Structural guarantees ──────────────────────────────────────────────────

do $$
declare
  missing text;
begin
  -- Every table has row-level security switched on.
  select string_agg(schemaname || '.' || tablename, ', ') into missing
  from pg_tables
  where schemaname in ('public', 'private') and not rowsecurity;
  assert missing is null, format('tables without RLS: %s', missing);

  -- Every SECURITY DEFINER function pins its search_path.
  select string_agg(p.proname, ', ') into missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  assert missing is null, format('SECURITY DEFINER without search_path: %s', missing);

  -- Nothing in `public` is executable by visitors except the three browsing functions.
  select string_agg(p.proname, ', ') into missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('search_products', 'suggest_products', 'delivery_estimate');
  assert missing is null, format('functions open to visitors: %s', missing);

  -- Internal tables are unreachable through the API roles.
  assert not has_table_privilege('authenticated', 'private.audit_log', 'select'), 'audit log is private';
  assert not has_table_privilege('authenticated', 'private.outbox_events', 'select'), 'outbox is private';
end
$$;

-- The audit trail cannot be rewritten, even by the database owner.
do $$
begin
  update private.audit_log set action = 'TAMPERED';
  raise exception 'audit log was modified';
exception when others then
  if sqlerrm not like 'Rows in audit_log are immutable' then raise; end if;
end
$$;

rollback;
