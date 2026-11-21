-- Access control: what each kind of user can and cannot reach.
--
-- Every block runs as a real API role with real claims, against the seed data.
-- A failure here means personal data or a privileged action is exposed.
--
-- Since the lockdown migration (20261121082800) the API roles hold no
-- privilege on any table, view or sequence: the functions are the only door.
-- So each kind of user is checked twice: every table refuses them outright,
-- and the functions they call show them exactly what they should see. The
-- catalogue-wide guard (who holds which privilege, which function is open to
-- whom) is 110_lockdown.sql.

begin;
\ir _helpers.sql

-- Facts the impersonated blocks need but could not look up themselves.
select pg_temp.remember('buyer2_order',
  (select o.order_number from public.orders o join auth.users u on u.id = o.user_id
   where u.email = 'comprador2@yuntera.example' limit 1));
select pg_temp.remember('buyer2_order_id',
  (select o.id::text from public.orders o join auth.users u on u.id = o.user_id
   where u.email = 'comprador2@yuntera.example' order by o.placed_at desc limit 1));
select pg_temp.remember('buyer_orders',
  (select count(*)::text from public.orders o join auth.users u on u.id = o.user_id
   where u.email = 'comprador@yuntera.example'));
select pg_temp.remember('buyer_order',
  (select o.order_number from public.orders o join auth.users u on u.id = o.user_id
   where u.email = 'comprador@yuntera.example' order by o.placed_at desc limit 1));
-- An order with a line sold by TecnoCasa, for the seller's view of it.
select pg_temp.remember('tecnocasa_sold_order',
  (select o.order_number from public.orders o join public.order_items i on i.order_id = o.id
   join public.sellers s on s.id = i.seller_id where s.slug = 'tecnocasa' limit 1));
select pg_temp.remember('cafetal_id', (select id::text from public.sellers where slug = 'cafetal-los-santos'));
select pg_temp.remember('tecnocasa_id', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('cafetal_offer', pg_temp.offer('cafe-molido-tarrazu-340g')::text);
select pg_temp.remember('tecnocasa_offer', pg_temp.offer('cargador-usb-c-30w-nimbo')::text);
select pg_temp.remember('pending_offer',
  (select o.id::text from public.offers o join public.sellers s on s.id = o.seller_id where s.slug = 'bazar-nuevo'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('seller_wh', (select id::text from public.warehouses where code = 'HIG-HER'));
select pg_temp.remember('luis_route',
  (select r.id::text from public.routes r join public.drivers d on d.id = r.driver_id
   where d.full_name like 'Luis%' limit 1));
select pg_temp.remember('luis_stop',
  (select rs.id::text from public.route_stops rs where rs.route_id = current_setting('t.luis_route')::uuid limit 1));
select pg_temp.remember('total_orders', (select count(*)::text from public.orders));
select pg_temp.remember('public_products',
  (select count(*)::text from public.products p join public.categories c on c.id = p.category_id
   where p.status = 'active' and p.min_price_minor is not null and c.active));

-- Every table, view and sequence in the two schemas, and the statement that
-- tries each operation on it. An API role must be refused every one of them
-- for lack of a privilege, whoever it is. `where false` keeps a statement
-- harmless if a privilege were ever there: the check comes first anyway.
create temporary table direct_access (stmt text) on commit drop;
insert into direct_access
select format(s.tpl, n.nspname, c.relname, a.attname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral (
  select a.attname from pg_attribute a
  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    and a.attidentity = '' and a.attgenerated = ''
  order by a.attnum limit 1) a
cross join lateral (values
  ('select 1 from %I.%I limit 1', true),
  ('insert into %I.%I default values', false),
  ('update %1$I.%2$I set %3$I = %3$I where false', false),
  ('delete from %I.%I where false', false)
) s (tpl, reads)
where n.nspname in ('public', 'private')
  -- Writes are tried on tables; a view may not be writable at all.
  and (c.relkind in ('r', 'p', 'f') or (s.reads and c.relkind in ('v', 'm')))
union all
select format('select nextval(%L)', format('%I.%I', n.nspname, c.relname))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private') and c.relkind = 'S';
grant select on direct_access to anon, authenticated;
do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;

create function pg_temp.no_direct_access(p_who text) returns void
language plpgsql as $$
declare
  t record;
begin
  for t in select stmt from pg_temp.direct_access loop
    begin
      execute t.stmt;
      raise exception '% could run: %', p_who, t.stmt;
    exception when insufficient_privilege then
      null; -- expected
    end;
  end loop;
end;
$$;
grant execute on function pg_temp.no_direct_access(text) to anon, authenticated;

-- ── Visitor (not signed in) ────────────────────────────────────────────────

-- A listing that exists and is public, to report (read as the owner: a visitor
-- reads no table).
select pg_temp.remember('public_product', (select id::text from public.products where slug = 'parlante-bluetooth-nimbo-ola'));
select pg_temp.login_anon();
select pg_temp.no_direct_access('a visitor');

do $$
declare
  p jsonb;
  c record;
begin
  assert (select max(total_count) from public.search_products(p_limit => 60))
       = current_setting('t.public_products')::bigint,
    'visitors find every active product, and nothing else';
  assert public.get_product('lampara-mesa-bambu') is null, 'a listing awaiting review is invisible';
  assert not public.shop_path_exists('product', 'lampara-mesa-bambu'), 'and has no address in the shop';
  -- A seller awaiting approval sells nothing: not on a page, not in a cart.
  select * into c from public.cart_lines(array[current_setting('t.pending_offer')::uuid]);
  assert not c.buyable and c.product_slug is null and c.price_minor is null,
    'an unapproved seller''s offer shows nothing in a cart';
  -- Published reviews are public, with a display name and no account id.
  p := public.get_product('audifonos-inalambricos-nimbo-aire');
  assert jsonb_array_length(p -> 'reviews') > 0, 'published reviews are public';
  assert not (p -> 'reviews' -> 0 ? 'user_id') and not (p -> 'reviews' -> 0 ? 'order_item_id'),
    'reviews do not name the account or the order';
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

do $$
begin
  perform public.my_orders();
  raise exception 'visitor could call my_orders';
exception when insufficient_privilege then
  null;
end
$$;

-- Anyone may report content, but must leave a way to be contacted.
-- Since the limits migration (083000) the report must be about something that
-- exists and is public; 120_limits.sql covers the refusals.
select public.report_content('product', current_setting('t.public_product')::uuid, 'counterfeit', null,
                             'alguien@correo.example');

do $$
begin
  perform public.report_content('product', gen_random_uuid(), 'counterfeit');
  raise exception 'anonymous report without contact was accepted';
exception when others then
  if sqlerrm <> 'contact_required' then raise; end if;
end
$$;

reset role;

-- ── Shopper ────────────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
select pg_temp.no_direct_access('a shopper');

do $$
declare
  o jsonb;
begin
  assert (select count(*) from public.my_orders(50)) = current_setting('t.buyer_orders')::bigint
         and current_setting('t.buyer_orders')::integer > 0, 'a shopper sees exactly their own orders';
  o := public.get_order(current_setting('t.buyer_order'));
  assert o ->> 'delivery_pin' ~ '^[0-9]{4}$', 'they can read their delivery PIN';
  assert (select count(*) from public.my_addresses()) = 1, 'only their own address';
  assert public.my_profile() ->> 'email' = 'comprador@yuntera.example', 'their own profile';
  assert public.my_roles() ->> 'staff_role' is null, 'no staff role';
  -- Since the review of 21 November 2026 the delivery code is in no table an
  -- API role can read: get_order is the only way to it.
  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'orders' and column_name = 'delivery_pin'),
    'the delivery code is not in the orders table';
end
$$;

-- Another shopper's order answers "not found", the same as one that does not exist.
do $$
begin
  perform public.get_order(current_setting('t.buyer2_order'));
  raise exception 'shopper read a stranger''s order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

-- Their profile is theirs to edit, through the function; a changed phone is
-- unverified again, and the verification itself is not theirs to set.
do $$
begin
  perform public.update_profile('María F. Solís', '+50688889999', 'es-CR', false);
  assert public.my_profile() ->> 'full_name' = 'María F. Solís', 'a shopper can edit their own name';
  assert not (public.my_profile() -> 'phone_verified')::boolean, 'a changed phone is unverified';
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

-- Paying for or cancelling someone else's order answers "not found" before
-- the order's state is even looked at.
do $$
begin
  perform public.confirm_sandbox_payment(current_setting('t.buyer2_order_id')::uuid);
  raise exception 'shopper paid for a stranger''s order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

do $$
begin
  perform public.cancel_order(current_setting('t.buyer2_order_id')::uuid, 'no es mío');
  raise exception 'shopper cancelled a stranger''s order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

do $$
begin
  perform public.ops_orders(null, null, 10, 0);
  raise exception 'shopper listed every order';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
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

do $$
begin
  perform public.driver_today();
  raise exception 'shopper read a driver''s route';
exception when others then
  if sqlerrm <> 'not_a_driver' then raise; end if;
end
$$;

do $$
begin
  perform public.wms_board(current_setting('t.depot')::uuid);
  raise exception 'shopper read the warehouse floor';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;

-- A complaint is filed in one's own name, and only about one's own order.
select public.file_complaint('delivery', 'El paquete llegó un día tarde y nadie avisó.');

do $$
begin
  perform public.file_complaint('delivery', 'Queja sobre el pedido de otra persona.',
                                current_setting('t.buyer2_order'));
  raise exception 'shopper complained about someone else''s order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

reset role;

-- ── Seller ─────────────────────────────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
select pg_temp.no_direct_access('a seller');

do $$
declare
  line record;
begin
  assert (select count(*) from public.seller_stock(current_setting('t.tecnocasa_id')::uuid)) > 0,
    'their own stock is visible';
  select * into line from public.seller_order_lines(current_setting('t.tecnocasa_id')::uuid) limit 1;
  assert line.order_number is not null, 'the sales view works for their seller';
  -- The view offers a first name and a district, never a way to reach the shopper.
  assert position(' ' in line.buyer_first_name) = 0, 'first name only';
end
$$;

-- A competitor's sales, stock, statements and overview are refused.
do $$
declare
  f text;
begin
  foreach f in array array[
    'select * from public.seller_order_lines(%L)',
    'select * from public.seller_stock(%L)',
    'select * from public.seller_statements(%L)',
    'select public.seller_overview(%L)'
  ] loop
    begin
      execute format(f, current_setting('t.cafetal_id'));
      raise exception 'a seller ran %', format(f, current_setting('t.cafetal_id'));
    exception when others then
      if sqlerrm <> 'forbidden' then raise; end if;
    end;
  end loop;
end
$$;

-- A line they sold gives no path to the shopper's order, address, phone or PIN.
do $$
begin
  perform public.get_order(current_setting('t.tecnocasa_sold_order'));
  raise exception 'seller opened the order behind a line they sold';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

-- Offers: their own price is theirs to change; a competitor's is not.
do $$
declare
  c record;
begin
  select * into c from public.cart_lines(array[current_setting('t.tecnocasa_offer')::uuid]);
  perform public.seller_update_offer(current_setting('t.tecnocasa_offer')::uuid, c.price_minor + 100,
                                     'active', c.handling_days, c.list_price_minor);
  assert (select (public.cart_lines(array[current_setting('t.tecnocasa_offer')::uuid])).price_minor)
       = c.price_minor + 100, 'a seller can reprice their own offer';
  begin
    perform public.seller_update_offer(current_setting('t.cafetal_offer')::uuid, 100::bigint, 'active',
                                       1::smallint, null::bigint);
    raise exception 'a seller repriced a competitor''s offer';
  exception when others then
    if sqlerrm not in ('offer_not_found', 'forbidden') then raise; end if;
  end;
end
$$;

reset role;

-- Listings: a seller never publishes. The status rule sits on the table, so
-- it holds for any write made with a seller's identity, here by the owner as
-- a function would (the seller cannot write the table at all, above).
select pg_temp.login('vendedor@yuntera.example');
reset role;
do $$
declare
  v_product uuid;
begin
  begin
    insert into public.products (slug, title, category_id, status, created_by_seller_id)
    values ('prueba-publicacion-directa', 'Producto publicado sin revisión',
            (select id from public.categories where slug = 'hogar'), 'active',
            current_setting('t.tecnocasa_id')::uuid);
    raise exception 'seller published a listing directly';
  exception when others then
    if sqlerrm <> 'listing_needs_review' then raise; end if;
  end;

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
select set_config('request.jwt.claims', '', true);

-- ── Driver ─────────────────────────────────────────────────────────────────

select pg_temp.login('repartidor@yuntera.example');
select pg_temp.no_direct_access('a driver');

do $$
declare
  t jsonb := public.driver_today();
begin
  assert jsonb_array_length(t -> 'routes') > 0, 'a driver sees their routes';
  assert not exists (
    select 1 from jsonb_array_elements(t -> 'routes') r
    where r ->> 'route_id' = current_setting('t.luis_route')
  ), 'another driver''s route is invisible';
  assert (select count(*) from jsonb_array_elements(t -> 'routes') r,
                 jsonb_array_elements(r -> 'stops') s) > 0, 'their stops are visible';
  -- They get the door details from the stop, but nothing more of the order.
  assert t::text not like '%delivery_pin%', 'the delivery PIN is not in the payload';
  assert t::text not like '%total_minor%' and t::text not like '%price_minor%',
    'nor what the parcel is worth';
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

do $$
begin
  perform public.get_order(current_setting('t.buyer_order'));
  raise exception 'driver opened an order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

reset role;

-- A day after a route is finished, its stops (names, phones, directions) close to the driver.
update public.routes set completed_at = now() - interval '25 hours' where status = 'completed';
select pg_temp.login('repartidor@yuntera.example');
do $$
declare
  t jsonb := public.driver_today();
begin
  assert not exists (
    select 1 from jsonb_array_elements(t -> 'routes') r where r ->> 'status' = 'completed'
  ), 'stops of a route finished over 24 hours ago are closed to the driver';
  assert exists (
    select 1 from jsonb_array_elements(t -> 'routes') r
    where r ->> 'status' = 'in_progress' and jsonb_array_length(r -> 'stops') > 0
  ), 'stops of the route in progress stay open';
end
$$;
reset role;

-- ── Warehouse associate ────────────────────────────────────────────────────

select pg_temp.login('bodega@yuntera.example');
select pg_temp.no_direct_access('a warehouse associate');

do $$
declare
  b jsonb := public.wms_board(current_setting('t.depot')::uuid);
begin
  assert b is not null, 'the floor board of their warehouse';
  assert b::text not like '%delivery_pin%' and b::text not like '%ship_phone%',
    'no shopper phone or delivery PIN on the floor board';
end
$$;

do $$
begin
  perform public.wms_board(current_setting('t.seller_wh')::uuid);
  raise exception 'warehouse associate read a seller''s own location';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
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

do $$
begin
  perform public.get_order(current_setting('t.buyer_order'));
  raise exception 'warehouse associate opened an order';
exception when others then
  if sqlerrm <> 'order_not_found' then raise; end if;
end
$$;

reset role;

-- ── Staff ──────────────────────────────────────────────────────────────────

select pg_temp.login('central@yuntera.example');
select pg_temp.no_direct_access('an administrator');

do $$
begin
  assert (select count(*) from public.ops_orders(null, null, 1000, 0))
       = current_setting('t.total_orders')::integer, 'operations staff see every order';
  assert (select count(*) from public.ops_sellers(null)) = 5, 'and every seller, including pending';
  assert public.get_product('lampara-mesa-bambu') ->> 'slug' = 'lampara-mesa-bambu',
    'and listings awaiting review';
  assert (select count(*) from public.audit_entries()) > 0, 'an admin can read the audit trail';
  -- Staff open any order, but the delivery code is the shopper's alone.
  assert public.get_order(current_setting('t.buyer2_order')) ->> 'order_number'
       = current_setting('t.buyer2_order'), 'staff can open any order';
  assert public.get_order(current_setting('t.buyer2_order')) ->> 'delivery_pin' is null,
    'but never see its delivery code';
end
$$;

reset role;

-- With MFA required, a staff session without a second factor is an ordinary user.
update public.app_settings set value = 'true' where key = 'require_staff_mfa';

select pg_temp.login('central@yuntera.example', 'aal1');
do $$
begin
  perform public.ops_orders(null, null, 10, 0);
  raise exception 'no second factor, yet staff access';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
do $$
begin
  perform * from public.ops_sellers(null);
  raise exception 'no second factor, yet seller data';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
begin
  assert (select count(*) from public.ops_orders(null, null, 1000, 0))
       = current_setting('t.total_orders')::integer, 'with a second factor, staff access returns';
end
$$;
reset role;

-- ── Structural guarantees ──────────────────────────────────────────────────
-- (Row-level security on every table, function rights and every privilege of
-- the API roles are checked over the whole catalogue in 110_lockdown.sql.)

do $$
begin
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
