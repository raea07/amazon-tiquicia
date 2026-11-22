-- The screen-level API: each function returns its payload to the right caller
-- and refuses, or returns nothing, to everyone else.

begin;
\ir _helpers.sql

select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('cafetal', (select id::text from public.sellers where slug = 'cafetal-los-santos'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('seller_wh', (select id::text from public.warehouses where code = 'HIG-HER'));
select pg_temp.remember('cafe', pg_temp.offer('cafe-molido-tarrazu-340g')::text);
select pg_temp.remember('laptop', pg_temp.offer('laptop-14-nimbo-libro')::text);
-- The seed's shop and listing awaiting approval, also on a used database (_helpers.sql).
select pg_temp.seed_awaiting_approval();
select pg_temp.remember('pending_offer',
  (select o.id::text from public.offers o join public.sellers s on s.id = o.seller_id where s.slug = 'bazar-nuevo'));
select pg_temp.remember('buyer2_order',
  (select o.order_number from public.orders o join auth.users u on u.id = o.user_id
   where u.email = 'comprador2@yuntera.example' limit 1));
select pg_temp.remember('pick_shipment',
  (select s.id::text from public.shipments s join public.orders o on o.id = s.order_id
   where o.idempotency_key = 'seed-today-d1'));

-- ── Visitor ────────────────────────────────────────────────────────────────

-- Read as the owner: a visitor reads no table (082800).
select pg_temp.remember('speaker', (select id::text from public.products where slug = 'parlante-bluetooth-nimbo-ola'));
select pg_temp.login_anon();

do $$
declare
  p jsonb;
  q jsonb;
begin
  assert (select count(*) from public.list_categories()) > 14, 'category tree';
  assert (select product_count from public.list_categories() where slug = 'electronica') = 2,
    'a parent category counts its children''s products';
  assert (select count(*) from public.list_districts()) = 494, 'every district';
  assert (select zone_id from public.list_districts() where postal_code = '11501') = 'gam-core', 'district zone';

  -- Product page, personalised for a postal code.
  p := public.get_product('audifonos-inalambricos-nimbo-aire', '11501');
  assert p ->> 'title' like 'Audífonos%', 'title';
  assert jsonb_array_length(p -> 'images') = 1, 'images';
  assert jsonb_array_length(p -> 'breadcrumbs') = 2, 'breadcrumbs from root to leaf';
  assert p #>> '{breadcrumbs,0,slug}' = 'electronica' and p #>> '{breadcrumbs,1,slug}' = 'audio', 'breadcrumb order';
  assert jsonb_array_length(p #> '{skus,0,offers}') = 2, 'both sellers'' offers are listed';
  assert (p #>> '{skus,0,offers,0,available}')::integer <= 10, 'exact stock is never exposed';
  assert p #>> '{skus,0,offers,0,promise,latest}' is not null, 'each offer carries a delivery promise';
  assert p #>> '{zone,id}' = 'gam-core', 'zone for the postal code';
  assert jsonb_array_length(p -> 'reviews') > 0, 'reviews';
  assert p #>> '{reviews,0,author}' ~ '^\S+ \S\.$', format('reviewer shown as first name + initial: %s', p #>> '{reviews,0,author}');
  assert (select sum(value::integer) from jsonb_each_text(p -> 'rating_histogram')) = (p ->> 'rating_count')::integer,
    'histogram adds up to the rating count';
  assert jsonb_array_length(p -> 'related') > 0, 'related products';

  -- Outside the service area the page still renders, without a promise.
  p := public.get_product('audifonos-inalambricos-nimbo-aire', '70101');
  assert not (p #>> '{zone,active}')::boolean and p #> '{skus,0,offers,0,promise}' = 'null'::jsonb,
    'no promise where we do not deliver';
  assert public.get_product('audifonos-inalambricos-nimbo-aire') #> '{zone}' = 'null'::jsonb, 'no postal code, no zone';

  -- A listing that is not live does not exist for a visitor.
  assert public.get_product('lampara-mesa-bambu') is null, 'pending listing is invisible';
  assert public.get_product('no-existe') is null, 'unknown product';

  -- Cart: live offers come back buyable, dead ones flagged.
  assert (select buyable from public.cart_lines(array[current_setting('t.cafe')::uuid])), 'buyable offer';
  assert not (select buyable from public.cart_lines(array[gen_random_uuid()])), 'unknown offer is flagged';
  assert not (select buyable from public.cart_lines(array[current_setting('t.pending_offer')::uuid])),
    'offer of an unapproved seller is flagged';
  assert (select title is null from public.cart_lines(array[current_setting('t.pending_offer')::uuid])),
    'and reveals nothing about itself';

  -- Quote: the full breakdown the law requires before confirming.
  q := public.checkout_quote(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 2)), '11501');
  assert q ->> 'issue' is null, format('quote issue: %s', q ->> 'issue');
  assert (q ->> 'items_total_minor')::bigint = 990000 and (q ->> 'shipping_minor')::bigint = 150000
         and (q ->> 'total_minor')::bigint = 1140000 and (q ->> 'tax_included_minor')::bigint = 27059,
    format('quote totals: %s', q);
  assert q #>> '{promise,latest}' is not null and (q ->> 'cod_available')::boolean, 'promise and payment options';

  q := public.checkout_quote(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.laptop'), 'quantity', 1)), '11501');
  assert not (q ->> 'cod_available')::boolean, 'no cash on delivery above the cap';
  assert (q ->> 'shipping_minor')::bigint = 0, 'free shipping above the threshold';

  q := public.checkout_quote(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 1)), '70101');
  assert q ->> 'issue' = 'zone_not_served' and q -> 'promise' = 'null'::jsonb, 'honest answer outside the area';

  assert public.checkout_quote('[]'::jsonb, '11501') ->> 'issue' = 'cart_empty', 'empty cart';
  assert public.checkout_quote(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.cafe'), 'quantity', 99)), '11501')
    ->> 'issue' = 'invalid_quantity', 'too many units';
  assert public.checkout_quote(
    jsonb_build_array(jsonb_build_object('offer_id', current_setting('t.pending_offer'), 'quantity', 1)), '11501')
    ->> 'issue' = 'offer_unavailable', 'unavailable offer';
end
$$;

-- Account functions are closed to visitors.
do $$
declare
  f text;
begin
  foreach f in array array[
    'select public.my_roles()', 'select public.my_profile()', 'select * from public.my_addresses()',
    'select * from public.my_orders()',
    'select public.get_order(''YT-100001'')', 'select public.driver_today()', 'select public.ops_overview()'
  ] loop
    begin
      execute f;
      raise exception 'visitor could run: %', f;
    exception when insufficient_privilege then null;
    end;
  end loop;
end
$$;

-- A visitor can report a listing, with a contact address.
do $$
begin
  -- About a listing that exists and is public (120_limits.sql covers the rest).
  perform public.report_content('product', current_setting('t.speaker')::uuid,
                                'unsafe', 'Se calienta demasiado.', 'ana@correo.example');
  begin
    perform public.report_content('product', gen_random_uuid(), 'unsafe');
    raise exception 'anonymous report without contact';
  exception when others then
    if sqlerrm <> 'contact_required' then raise; end if;
  end;
  begin
    perform public.report_content('product', gen_random_uuid(), 'no me gusta', null, 'ana@correo.example');
    raise exception 'made-up report reason';
  exception when others then
    if sqlerrm <> 'invalid_report' then raise; end if;
  end;
end
$$;
reset role;

-- ── Shopper ────────────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');

do $$
declare
  r jsonb := public.my_roles();
  o jsonb;
  v_number text;
  v_address uuid;
begin
  assert r ->> 'staff_role' is null and r -> 'driver' = 'null'::jsonb
         and jsonb_array_length(r -> 'sellers') = 0 and jsonb_array_length(r -> 'warehouses') = 0,
    format('a shopper holds no other role: %s', r);
  assert public.my_profile() ->> 'email' = 'comprador@yuntera.example', 'own profile';

  -- Orders: a list, and each one in full.
  assert (select count(*) from public.my_orders()) between 1 and 20, 'own orders, paged';
  select order_number into v_number from public.my_orders() where status = 'delivered' limit 1;
  o := public.get_order(v_number);
  assert o ->> 'order_number' = v_number and jsonb_array_length(o -> 'items') > 0, 'order detail';
  assert o ->> 'delivery_pin' is null, 'the PIN disappears once the order is delivered';
  assert jsonb_array_length(o -> 'timeline') > 0 and jsonb_array_length(o -> 'shipments') = 1, 'timeline and parcels';
  assert o #>> '{address,senas}' like 'De la Fuente%', 'delivery details';
  assert not (o ->> 'can_cancel')::boolean, 'a delivered order cannot be cancelled';

  -- An order on the road shows its PIN and who is bringing it.
  select order_number into v_number from public.my_orders() where status = 'shipped' limit 1;
  o := public.get_order(v_number);
  assert o ->> 'delivery_pin' ~ '^[0-9]{4}$', 'PIN while there is something to hand over';
  assert o #>> '{shipments,0,driver_first_name}' = 'Carlos', 'driver first name while out for delivery';

  -- Someone else's order looks exactly like one that does not exist.
  begin
    perform public.get_order(current_setting('t.buyer2_order'));
    raise exception 'read a stranger''s order';
  exception when others then
    if sqlerrm <> 'order_not_found' then raise; end if;
  end;
  begin
    perform public.get_order('YT-000000');
    raise exception 'read a non-existent order';
  exception when others then
    if sqlerrm <> 'order_not_found' then raise; end if;
  end;

  -- Addresses.
  assert (select count(*) from public.my_addresses()) = 1 and (select is_default from public.my_addresses()),
    'seeded default address';
  v_address := public.save_address(
    'María Fernández Solís', '+50688881234', '10201',
    'Escazú centro, 75 metros al sur de la iglesia, portón blanco con campana', 9.9189, -84.1399,
    '66XQWV96+H2', 'Oficina', true);
  assert (select count(*) from public.my_addresses()) = 2, 'address added';
  assert (select count(*) from public.my_addresses() where is_default) = 1
         and (select id from public.my_addresses() where is_default) = v_address,
    'exactly one default, and it is the new one';
  assert (select canton from public.my_addresses() where id = v_address) = 'Escazú', 'district names resolved';

  begin
    perform public.save_address('M', '8888', '10201', 'casa', 40.4, -3.7);
    raise exception 'saved an invalid address';
  exception when others then
    if sqlerrm <> 'address_invalid' then raise; end if;
  end;
  begin
    perform public.save_address('María Fernández', '+50688881234', '99999',
      'Una dirección suficientemente larga para pasar', 9.93, -84.08);
    raise exception 'saved an address with an unknown postal code';
  exception when others then
    if sqlerrm <> 'postal_code_invalid' then raise; end if;
  end;

  perform public.delete_address(v_address);
  assert (select count(*) from public.my_addresses()) = 1, 'address removed';

  perform public.update_profile('María Fernández S.', '+50688881234', 'en', true);
  assert public.my_profile() ->> 'locale' = 'en', 'profile updated';
  begin
    perform public.update_profile('María', '12345');
    raise exception 'saved an invalid phone';
  exception when others then
    if sqlerrm <> 'invalid_profile' then raise; end if;
  end;

  perform public.file_complaint('delivery', 'El paquete llegó con la caja abierta.', v_number);
  begin
    perform public.file_complaint('delivery', 'Queja sobre un pedido ajeno.', current_setting('t.buyer2_order'));
    raise exception 'complained about a stranger''s order';
  exception when others then
    if sqlerrm <> 'order_not_found' then raise; end if;
  end;
end
$$;

-- A shopper is refused by every operations function.
do $$
declare
  f text;
begin
  foreach f in array array[
    format('select public.seller_overview(%L)', current_setting('t.tecnocasa')),
    format('select * from public.seller_listings(%L)', current_setting('t.tecnocasa')),
    format('select * from public.seller_stock(%L)', current_setting('t.tecnocasa')),
    format('select * from public.seller_statements(%L)', current_setting('t.tecnocasa')),
    format('select public.seller_to_pack(%L)', current_setting('t.tecnocasa')),
    format('select public.wms_board(%L)', current_setting('t.depot')),
    format('select public.wms_find_sku(%L, %L)', current_setting('t.depot'), 'YT-X'),
    format('select * from public.wms_locations(%L)', current_setting('t.depot')),
    'select public.ops_overview()', 'select * from public.ops_orders()', 'select * from public.ops_sellers()',
    'select * from public.ops_listings_for_review()', 'select public.ops_dispatch_board()',
    'select * from public.ops_settlements()', 'select public.ops_care_queues()'
  ] loop
    begin
      execute f;
      raise exception 'shopper could run: %', f;
    exception when others then
      if sqlerrm <> 'forbidden' then raise exception '% failed with % instead of forbidden', f, sqlerrm; end if;
    end;
  end loop;

  begin
    perform public.driver_today();
    raise exception 'shopper opened the driver app';
  exception when others then
    if sqlerrm <> 'not_a_driver' then raise; end if;
  end;
  begin
    perform public.wms_shipment(current_setting('t.pick_shipment')::uuid);
    raise exception 'shopper opened a pick list';
  exception when others then
    if sqlerrm <> 'shipment_not_found' then raise; end if;
  end;
end
$$;
reset role;

-- ── Seller ─────────────────────────────────────────────────────────────────

-- What TecnoCasa has, read from the tables as the owner: the seed's nine
-- offers and stock rows, plus whatever a shared preview has gained since
-- (the hosted one has a tenth listing, added in its photo test).
select pg_temp.remember('tecnocasa_offers',
  (select count(*)::text from public.offers
   where seller_id = current_setting('t.tecnocasa')::uuid and status <> 'archived'));
select pg_temp.remember('tecnocasa_stock',
  (select count(*)::text from public.stock_levels where seller_id = current_setting('t.tecnocasa')::uuid));
-- The shop's bank account as it stands (the seed's ends in 6789; a used
-- database may hold one the shop changed since).
select pg_temp.remember('tecnocasa_iban',
  (select payout_iban from public.seller_private where seller_id = current_setting('t.tecnocasa')::uuid));

select pg_temp.login('vendedor@yuntera.example');

do $$
declare
  r jsonb := public.my_roles();
  v jsonb;
  created jsonb;
  v_offer uuid;
begin
  assert jsonb_array_length(r -> 'sellers') = 2 and r #>> '{sellers,0,role}' = 'owner', format('roles: %s', r);

  v := public.seller_overview(current_setting('t.tecnocasa')::uuid);
  assert v #>> '{seller,trade_name}' = 'TecnoCasa', 'overview';
  assert v #>> '{account,payout_iban_masked}' like 'CR••%' || right(current_setting('t.tecnocasa_iban'), 4)
     and v #>> '{account,payout_iban_masked}' not like '%' || substr(current_setting('t.tecnocasa_iban'), 5, 10) || '%',
    'the bank account is masked';
  assert (v ->> 'payable_minor')::bigint > 0, 'amount owed comes from the ledger';
  assert (v #>> '{sales_30d,orders}')::integer > 0, 'recent sales';

  assert current_setting('t.tecnocasa_offers')::integer >= 9 and current_setting('t.tecnocasa_stock')::integer >= 9,
    'the seed''s nine offers and stock rows are there';
  assert (select count(*) from public.seller_listings(current_setting('t.tecnocasa')::uuid))
         = current_setting('t.tecnocasa_offers')::integer, 'all their offers that are not archived';
  assert (select bool_or(competing_offers > 0) from public.seller_listings(current_setting('t.tecnocasa')::uuid)),
    'they are told when another seller offers the same product';
  assert (select count(*) from public.seller_stock(current_setting('t.tecnocasa')::uuid))
         = current_setting('t.tecnocasa_stock')::integer, 'their stock';
  assert (select count(*) from public.seller_statements(current_setting('t.tecnocasa')::uuid)) > 0, 'their statements';

  -- The other seller they own ships from its own shop: one parcel to prepare.
  v := public.seller_to_pack((r #>> '{sellers,0,id}')::uuid);
  assert jsonb_array_length(v) = 1 and jsonb_array_length(v #> '{0,items}') = 2, format('to pack: %s', v);

  -- A competitor's data is refused everywhere.
  begin
    perform public.seller_overview(current_setting('t.cafetal')::uuid);
    raise exception 'read a competitor''s overview';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;

  -- New listing: goes to review, never straight to the store.
  created := public.seller_create_listing(
    current_setting('t.tecnocasa')::uuid, 'Lámpara LED de escritorio regulable', 'iluminacion',
    'Lámpara de escritorio con tres tonos de luz.', array['Brazo flexible', 'Puerto USB de carga'],
    1890000, 'seller', 2::smallint, 900, 40, 15, 15);
  assert created ->> 'slug' = 'lampara-led-de-escritorio-regulable', format('slug: %s', created ->> 'slug');
  assert (select product_status from public.seller_listings(current_setting('t.tecnocasa')::uuid)
          where product_id = (created ->> 'product_id')::uuid) = 'pending_review', 'sent for review';

  begin
    perform public.seller_create_listing(
      current_setting('t.cafetal')::uuid, 'Producto a nombre de otro', 'hogar', null, null,
      100000, 'seller', 1::smallint, 100, 10, 10, 10);
    raise exception 'created a listing for a competitor';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.seller_create_listing(
      current_setting('t.tecnocasa')::uuid, 'Precio negativo de prueba', 'hogar', null, null,
      -5, 'seller', 1::smallint, 100, 10, 10, 10);
    raise exception 'created a listing with a negative price';
  exception when others then
    if sqlerrm <> 'invalid_listing' then raise; end if;
  end;

  -- Repricing their own offer; a "regular price" must really be higher.
  v_offer := (created ->> 'offer_id')::uuid;
  perform public.seller_update_offer(v_offer, 1790000, 'active', 1::smallint, 2100000);
  assert (select price_minor = 1790000 and list_price_minor = 2100000
          from public.seller_listings(current_setting('t.tecnocasa')::uuid) where offer_id = v_offer), 'repriced';
  begin
    perform public.seller_update_offer(v_offer, 1790000, 'active', 1::smallint, 1000000);
    raise exception 'accepted a regular price below the price';
  exception when others then
    if sqlerrm <> 'invalid_offer' then raise; end if;
  end;
  begin
    perform public.seller_update_offer(current_setting('t.cafe')::uuid, 100, 'active');
    raise exception 'repriced a competitor''s offer';
  exception when others then
    if sqlerrm <> 'offer_not_found' then raise; end if;
  end;
end
$$;
reset role;

-- ── Warehouse ──────────────────────────────────────────────────────────────

select pg_temp.login('bodega@yuntera.example');
do $$
declare
  b jsonb := public.wms_board(current_setting('t.depot')::uuid);
  s jsonb;
  v_code text;
begin
  assert public.my_roles() #>> '{warehouses,0,code}' = 'SJO1', 'assigned warehouse';
  assert b #>> '{warehouse,code}' = 'SJO1' and jsonb_array_length(b -> 'shipments') > 0, 'floor board';
  assert not exists (
    select 1 from jsonb_array_elements(b -> 'shipments') x
    where x ->> 'status' not in ('pending', 'picking', 'packed', 'ready_for_dispatch')
  ), 'only parcels that still need hands';

  s := public.wms_shipment(current_setting('t.pick_shipment')::uuid);
  assert jsonb_array_length(s -> 'tasks') = 2, 'pick list';
  assert s #>> '{tasks,0,location_code}' ~ '^A-0[12]-0[123]-[AB]$', format('bin code: %s', s #>> '{tasks,0,location_code}');
  assert (s ->> 'expected_weight_grams')::integer > 0, 'expected weight for the scale check';
  -- The pick list names products and bins, and nothing about the customer.
  assert s::text !~* '(senas|phone|recipient|delivery_pin)', 'no customer data on a pick list';

  v_code := s #>> '{tasks,0,sku_code}';
  assert public.wms_find_sku(current_setting('t.depot')::uuid, lower(v_code)) #>> '{sku_code}' = v_code, 'barcode lookup';
  assert public.wms_find_sku(current_setting('t.depot')::uuid, 'NO-EXISTE') is null, 'unknown barcode';
  assert (select count(*) from public.wms_locations(current_setting('t.depot')::uuid)) = 19, 'locations';

  -- A warehouse they do not work at is closed to them.
  begin
    perform public.wms_board(current_setting('t.seller_wh')::uuid);
    raise exception 'opened another site''s board';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end
$$;
reset role;

-- ── Driver ─────────────────────────────────────────────────────────────────

-- The check below compares what the driver is given with the route itself.
select pg_temp.allow_inspection();
select pg_temp.login('repartidor@yuntera.example');
do $$
declare
  d jsonb := public.driver_today();
begin
  assert d #>> '{driver,full_name}' like 'Carlos%', 'driver';
  assert d #>> '{routes,0,status}' = 'in_progress', 'the route in progress comes first';
  -- Its stops, as the route has them (two in the seed: cash first, then a
  -- prepaid parcel; a used database may have moved on to other routes).
  assert jsonb_array_length(d #> '{routes,0,stops}') > 0
     and jsonb_array_length(d #> '{routes,0,stops}')
         = (select count(*) from public.route_stops where route_id = (d #>> '{routes,0,route_id}')::uuid),
    'its stops';
  assert d #>> '{routes,0,stops,0,senas}' <> '' and d #>> '{routes,0,stops,0,phone}' like '+506%',
    'what is needed at the door';
  assert (select coalesce(sum((x ->> 'cod_amount_minor')::bigint), 0) from jsonb_array_elements(d #> '{routes,0,stops}') x)
         = (select coalesce(sum(cod_amount_minor), 0) from public.route_stops
            where route_id = (d #>> '{routes,0,route_id}')::uuid), 'the cash to collect at each door';
  assert (d #>> '{routes,0,stops,0,cod_amount_minor}')::bigint > 0
      or (select code from public.routes where id = (d #>> '{routes,0,route_id}')::uuid) <> 'R-1003',
    'cash to collect (the seed''s route starts with its cash stop)';
  -- The driver never receives the PIN: the shopper reads it to them.
  assert d::text !~* 'delivery_pin', 'no PIN in the driver payload';
  assert not exists (
    select 1 from jsonb_array_elements(d -> 'routes') r where r ->> 'code' = 'R-1002'
  ), 'another driver''s route is absent';
end
$$;
reset role;
select pg_temp.stop_inspection();

-- ── Staff ──────────────────────────────────────────────────────────────────

-- Counted from the tables rather than fixed to the seed's numbers, so the suite
-- also passes on a shared preview where people have placed orders since.
select pg_temp.remember('orders_all', (select count(*)::text from public.orders));
select pg_temp.remember('orders_delivered',
  (select count(*)::text from public.orders where status = 'delivered'));
select pg_temp.remember('packed', (select count(*)::text from public.shipments where status = 'packed'));
select pg_temp.remember('ready',
  (select count(*)::text from public.shipments sh
   where sh.status in ('packed', 'delivery_failed')
     and not exists (select 1 from public.route_stops rs
                     where rs.shipment_id = sh.id and rs.status in ('pending', 'arrived'))));
-- Shops and listings waiting for staff (one shop and two listings here on a
-- fresh seed: the seeded ones and the one the seller block above submitted),
-- drivers and counted cash, as the tables have them.
select pg_temp.remember('sellers_pending', (select count(*)::text from public.sellers where status = 'pending'));
select pg_temp.remember('in_review', (select count(*)::text from public.products where status = 'pending_review'));
select pg_temp.remember('drivers', (select count(*)::text from public.drivers where status = 'active'));
select pg_temp.remember('settled', (select count(*)::text from public.driver_settlements where status <> 'open'));

select pg_temp.login('central@yuntera.example');
do $$
declare
  o jsonb := public.ops_overview();
  b jsonb := public.ops_dispatch_board();
  q jsonb;
begin
  assert public.my_roles() ->> 'staff_role' = 'admin', 'staff role';
  assert (o #>> '{orders,delivered}')::integer = current_setting('t.orders_delivered')::integer
         and (o ->> 'sellers_pending')::integer = current_setting('t.sellers_pending')::integer
         and (o ->> 'listings_in_review')::integer = current_setting('t.in_review')::integer
         and current_setting('t.sellers_pending')::integer >= 1 and current_setting('t.in_review')::integer >= 2
         and (o ->> 'awaiting_dispatch')::integer = current_setting('t.packed')::integer,
    format('overview: %s', o);
  assert o ->> 'payments_mode' = 'sandbox', 'the console shows which payment mode is live';

  assert (select count(*) from public.ops_orders()) = current_setting('t.orders_all')::bigint, 'all orders';
  assert (select count(*) from public.ops_orders('delivered')) = current_setting('t.orders_delivered')::bigint,
    'filtered by status';
  assert (select count(*) from public.ops_orders(null, 'sofia')) > 0, 'search by name, accent-insensitive';
  assert (select count(*) from public.ops_orders(null, '%')) = 0, 'wildcards are literal';
  assert (select count(*) from public.ops_sellers('pending')) = current_setting('t.sellers_pending')::integer,
    'sellers awaiting approval';
  assert (select count(*) = current_setting('t.in_review')::integer
                 and count(*) filter (where title like 'Lámpara%') >= 2 from public.ops_listings_for_review()),
    'listings awaiting review';

  assert jsonb_array_length(b -> 'ready') = current_setting('t.ready')::integer
         and jsonb_array_length(b -> 'drivers') = current_setting('t.drivers')::integer
         and jsonb_array_length(b -> 'depots') = 1, format('dispatch board: %s', b);
  assert b #>> '{routes,0,status}' = 'in_progress', 'live route first';
  assert (b #>> '{ready,0,lat}')::numeric between 8 and 11.25, 'coordinates for the route planner';

  assert (select count(*) from public.ops_settlements('settled')) = current_setting('t.settled')::integer,
    'settled cash counts';
  q := public.ops_care_queues();
  assert q ? 'complaints' and q ? 'returns' and q ? 'reports', 'care queues';

  -- Staff read any order in full, internal notes included.
  assert public.get_order(current_setting('t.buyer2_order')) ->> 'order_number' = current_setting('t.buyer2_order'),
    'staff can open any order';
end
$$;
reset role;

-- Which functions a visitor may execute is checked, against the list in
-- docs/03-data/access-control.md, by 110_lockdown.sql.

rollback;
