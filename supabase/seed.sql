-- Demo data for local development, CI and preview environments.
--
-- NEVER run this against production: it creates accounts with a shared
-- password and fictional sellers, products, orders and reviews. It refuses to
-- run unless the platform is in sandbox payment mode.
--
-- Everything after the catalogue is created by calling the same functions the
-- apps call, as the demo users, so seeding doubles as an end-to-end smoke test
-- of checkout, warehouse, dispatch and delivery.
--
-- Accounts (password from the `app.seed_password` setting, else the local
-- default below; a hosted preview is seeded with `remote-db.sh seed`, which
-- takes a random password from the environment and sends only its hash):
--   comprador@yuntera.example   shopper
--   vendedor@yuntera.example    seller (TecnoCasa and Ferretería El Higuerón)
--   bodega@yuntera.example      warehouse associate
--   repartidor@yuntera.example  delivery driver
--   central@yuntera.example     operations staff (admin)

begin;

do $$
begin
  if private.setting('payments_mode') is distinct from '"sandbox"'::jsonb then
    raise exception 'Seed data is for sandbox environments only';
  end if;
  if exists (select 1 from public.sellers) then
    raise exception 'Seed data already present; reset the database first';
  end if;
end
$$;

-- ── Helpers (session-local) ────────────────────────────────────────────────

-- Creates a confirmed e-mail/password user, with the same rows Supabase Auth
-- writes when someone signs up (checked against a real sign-up on a hosted
-- project). The local shim has the same columns, so this runs unchanged on both.
create function pg_temp.seed_user(p_email text, p_name text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  -- A hosted seed passes only the bcrypt hash (remote-db.sh seed), so the
  -- password itself never appears in the seed's statement text.
  v_hash text := coalesce(
    nullif(current_setting('app.seed_password_hash', true), ''),
    extensions.crypt(
      coalesce(nullif(current_setting('app.seed_password', true), ''), 'yuntera-local-dev'),
      extensions.gen_salt('bf', 10)));
begin
  if v_hash !~ '^\$2[aby]\$[0-9]{2}\$.{53}$' then
    raise exception 'app.seed_password_hash is not a bcrypt hash';
  end if;
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
     -- The auth service reads these as strings and fails on NULL; it writes ''.
     confirmation_token, recovery_token, email_change_token_new, email_change,
     email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values
    ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', lower(p_email),
     v_hash, now(),
     '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name),
     now(), now(),
     '', '', '', '', '', '', '', '');

  -- Supabase Auth gives every account one identity per sign-in method.
  insert into auth.identities
    (user_id, provider_id, provider, identity_data, created_at, updated_at)
  values
    (v_id, v_id::text, 'email',
     jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true,
                        'phone_verified', false),
     now(), now());
  return v_id;
end;
$$;

-- Makes the following calls run as the given user, the way the API would.
create function pg_temp.act_as(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else
      json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
$$;

create temp table seed_ids (name text primary key, id uuid not null) on commit drop;

create function pg_temp.id(p_name text) returns uuid
language sql as $$ select id from seed_ids where name = p_name $$;

-- ── People ─────────────────────────────────────────────────────────────────

insert into seed_ids (name, id) values
  ('u_buyer', pg_temp.seed_user('comprador@yuntera.example', 'María Fernández Solís')),
  ('u_buyer2', pg_temp.seed_user('comprador2@yuntera.example', 'Andrés Mora Chaves')),
  ('u_buyer3', pg_temp.seed_user('comprador3@yuntera.example', 'Sofía Vargas Rojas')),
  ('u_seller', pg_temp.seed_user('vendedor@yuntera.example', 'Roberto Jiménez Arce')),
  ('u_cafetal', pg_temp.seed_user('cafetal@yuntera.example', 'Ana Lucía Ureña Mora')),
  ('u_sendero', pg_temp.seed_user('sendero@yuntera.example', 'Diego Castro León')),
  ('u_bazar', pg_temp.seed_user('bazar@yuntera.example', 'Laura Quesada Brenes')),
  ('u_warehouse', pg_temp.seed_user('bodega@yuntera.example', 'Kattia Rodríguez Salas')),
  ('u_driver', pg_temp.seed_user('repartidor@yuntera.example', 'Carlos Méndez Porras')),
  ('u_driver2', pg_temp.seed_user('repartidor2@yuntera.example', 'Luis Alvarado Cruz')),
  ('u_staff', pg_temp.seed_user('central@yuntera.example', 'Gabriela Soto Marín'));

update public.profiles set phone = '+50688881234', phone_verified_at = now() where id = pg_temp.id('u_buyer');
update public.profiles set phone = '+50670002345', phone_verified_at = now() where id = pg_temp.id('u_buyer2');
update public.profiles set phone = '+50661113456', phone_verified_at = now() where id = pg_temp.id('u_buyer3');

insert into public.staff_members (user_id, role) values (pg_temp.id('u_staff'), 'admin');

insert into public.consents (user_id, purpose, policy_version)
select id, purpose, '2026-11'
from seed_ids cross join (values ('terms'), ('privacy')) p (purpose)
where name like 'u_buyer%';

-- ── Sellers ────────────────────────────────────────────────────────────────

with new_sellers as (
  insert into public.sellers (slug, trade_name, description, status, score, health, approved_at)
  values
    ('cafetal-los-santos', 'Cafetal Los Santos',
     'Café de altura de la Zona de los Santos y artesanía de talleres costarricenses.',
     'active', 96, 'excelente', now() - interval '90 days'),
    ('tecnocasa', 'TecnoCasa',
     'Electrónica y electrodomésticos con garantía local de 12 meses.',
     'active', 92, 'excelente', now() - interval '120 days'),
    ('ferreteria-el-higueron', 'Ferretería El Higuerón',
     'Herramientas y materiales. Despachamos desde Heredia.',
     'active', 84, 'bien', now() - interval '60 days'),
    ('tienda-sendero', 'Tienda Sendero',
     'Aire libre, deporte y todo para la casa.',
     'active', 90, 'excelente', now() - interval '75 days'),
    ('bazar-nuevo', 'Bazar Nuevo', 'Decoración para el hogar.', 'pending', 90, 'bien', null)
  returning id, slug
)
insert into seed_ids (name, id) select 's_' || slug, id from new_sellers;

insert into public.seller_private
  (seller_id, legal_name, id_type, id_number, contact_email, contact_phone, fiscal_address,
   postal_code, payout_iban, payout_holder_name, sinpe_movil_number, kyc_status, hacienda_verified_at,
   payout_approved_at)
values
  (pg_temp.id('s_cafetal-los-santos'), 'Cafetal Los Santos S.R.L.', 'juridica', '3102700101',
   'cafetal@yuntera.example', '+50625460101', 'San Marcos de Tarrazú, 200 m norte del parque',
   '10501', 'CR05015202001026284066', 'Cafetal Los Santos S.R.L.', '+50683330101', 'verified', now(), now()),
  (pg_temp.id('s_tecnocasa'), 'TecnoCasa de Costa Rica S.A.', 'juridica', '3101700202',
   'vendedor@yuntera.example', '+50622340202', 'Curridabat, frente al antiguo Registro',
   '11801', 'CR26010200009123456789', 'TecnoCasa de Costa Rica S.A.', '+50684440202', 'verified', now(), now()),
  (pg_temp.id('s_ferreteria-el-higueron'), 'Roberto Jiménez Arce', 'fisica', '401230456',
   'vendedor@yuntera.example', '+50622610303', 'Heredia centro, 100 m este del Mercado',
   '40101', 'CR86015100020019688637', 'Roberto Jiménez Arce', '+50685550303', 'verified', now(), now()),
  (pg_temp.id('s_tienda-sendero'), 'Sendero Outdoor S.R.L.', 'juridica', '3102700404',
   'sendero@yuntera.example', '+50622890404', 'Escazú, San Rafael, Plaza Colonial local 4',
   '10203', 'CR31010200009555666777', 'Sendero Outdoor S.R.L.', '+50686660404', 'verified', now(), now()),
  (pg_temp.id('s_bazar-nuevo'), 'Laura Quesada Brenes', 'fisica', '109870654',
   'bazar@yuntera.example', '+50687770505', 'Tibás, San Juan, 50 m sur de la iglesia',
   '11301', null, null, null, 'pending', null, null);

insert into public.seller_members (seller_id, user_id, role) values
  (pg_temp.id('s_cafetal-los-santos'), pg_temp.id('u_cafetal'), 'owner'),
  (pg_temp.id('s_tecnocasa'), pg_temp.id('u_seller'), 'owner'),
  (pg_temp.id('s_ferreteria-el-higueron'), pg_temp.id('u_seller'), 'owner'),
  (pg_temp.id('s_tienda-sendero'), pg_temp.id('u_sendero'), 'owner'),
  (pg_temp.id('s_bazar-nuevo'), pg_temp.id('u_bazar'), 'owner');

-- ── Warehouses, bins, staff, drivers ───────────────────────────────────────

with w as (
  insert into public.warehouses (code, name, kind, seller_id, address, postal_code, lat, lng)
  values
    ('SJO1', 'Centro de distribución Curridabat', 'platform', null,
     'Curridabat, 300 m sur de la Municipalidad, bodega 4', '11801', 9.9116, -84.0344),
    ('HIG-HER', 'Ferretería El Higuerón — Heredia', 'seller', pg_temp.id('s_ferreteria-el-higueron'),
     'Heredia centro, 100 m este del Mercado', '40101', 9.9981, -84.1171),
    ('SEN-ESC', 'Tienda Sendero — Escazú', 'seller', pg_temp.id('s_tienda-sendero'),
     'Escazú, San Rafael, Plaza Colonial local 4', '10203', 9.9340, -84.1420)
  returning id, code
)
insert into seed_ids (name, id) select 'w_' || code, id from w;

insert into public.warehouse_locations (warehouse_id, code, kind)
select pg_temp.id('w_SJO1'), code, kind::public.location_kind
from (values
  ('REC-01', 'receiving'), ('EMP-01', 'packing'), ('DES-R1', 'staging'),
  ('DEV-01', 'returns'), ('CUA-01', 'damaged'),
  ('A-01-01-A', 'pick'), ('A-01-01-B', 'pick'), ('A-01-02-A', 'pick'), ('A-01-02-B', 'pick'),
  ('A-01-03-A', 'pick'), ('A-01-03-B', 'pick'), ('A-02-01-A', 'pick'), ('A-02-01-B', 'pick'),
  ('A-02-02-A', 'pick'), ('A-02-02-B', 'pick'), ('A-02-03-A', 'pick'), ('A-02-03-B', 'pick'),
  ('B-01-01-A', 'storage'), ('B-01-02-A', 'storage')
) l (code, kind);

insert into public.warehouse_staff (warehouse_id, user_id, role)
values (pg_temp.id('w_SJO1'), pg_temp.id('u_warehouse'), 'lead');

with d as (
  insert into public.drivers
    (user_id, status, full_name, phone, id_number, vehicle_type, plate, capacity_kg, license_class,
     license_expires_on, inspection_expires_on, insurance_expires_on)
  values
    (pg_temp.id('u_driver'), 'active', 'Carlos Méndez Porras', '+50688110011', '112340567',
     'motorcycle', 'MOT-482913', 40, 'A2', current_date + 400, current_date + 200, current_date + 300),
    (pg_temp.id('u_driver2'), 'active', 'Luis Alvarado Cruz', '+50688220022', '205670891',
     'car', 'BRT-204', 250, 'B1', current_date + 600, current_date + 150, current_date + 250)
  returning id, user_id
)
insert into seed_ids (name, id)
select case when user_id = pg_temp.id('u_driver') then 'd_carlos' else 'd_luis' end, id from d;

-- ── Catalogue ──────────────────────────────────────────────────────────────

create function pg_temp.add_product(
  p_slug text, p_title text, p_category text, p_brand text, p_seller text,
  p_price integer, p_list_price integer, p_weight integer, p_dims numeric[],
  p_fulfillment public.fulfillment_type, p_stock integer, p_bullets text[], p_description text,
  p_made_in_cr boolean default false, p_tax integer default 1300, p_warranty smallint default 1,
  p_variants text[] default array['']
) returns void
language plpgsql as $$
declare
  v_brand uuid;
  v_product uuid;
  v_sku uuid;
  v_seller uuid := pg_temp.id('s_' || p_seller);
  v_variant text;
  v_bin uuid;
  v_warehouse uuid;
  v_n integer;
begin
  insert into public.brands (slug, name)
  values (trim(both '-' from regexp_replace(lower(extensions.unaccent(p_brand)), '[^a-z0-9]+', '-', 'g')), p_brand)
  on conflict (name) do update set name = excluded.name
  returning id into v_brand;

  insert into public.products
    (slug, title, description, bullet_points, brand_id, category_id, status, created_by_seller_id,
     tax_rate_bps, warranty_months, made_in_cr, published_at)
  values
    (p_slug, p_title, p_description, p_bullets, v_brand,
     (select id from public.categories where slug = p_category), 'active', v_seller,
     p_tax, p_warranty, p_made_in_cr, now() - (random() * interval '80 days') - interval '30 days')
  returning id into v_product;

  insert into public.product_images (product_id, path, alt, sort)
  values (v_product, '/demo/products/' || p_slug || '.svg', p_title, 0);

  select count(*) into v_n from public.skus;
  foreach v_variant in array p_variants loop
    insert into public.skus (product_id, code, variant_name, weight_grams, length_cm, width_cm, height_cm)
    values (v_product,
            'YT-' || upper(substr(md5(p_slug || v_variant), 1, 8)),
            v_variant, p_weight, p_dims[1], p_dims[2], p_dims[3])
    returning id into v_sku;

    insert into public.offers
      (sku_id, seller_id, price_minor, list_price_minor, fulfillment, handling_days, seller_sku)
    values
      (v_sku, v_seller, p_price * 100::bigint, p_list_price * 100::bigint, p_fulfillment,
       case when p_fulfillment = 'platform' then 0 else 1 end, upper(left(p_slug, 12)));

    if p_fulfillment = 'platform' then
      v_warehouse := pg_temp.id('w_SJO1');
      select id into v_bin from public.warehouse_locations
      where warehouse_id = v_warehouse and kind = 'pick'
      order by code offset (v_n % 12) limit 1;
    else
      select id into v_warehouse from public.warehouses where seller_id = v_seller and kind = 'seller';
      v_bin := null;
    end if;
    perform private.apply_stock_change(
      v_warehouse, v_sku, v_seller, p_stock, 'receive', v_bin, 'seed', null, 'Inventario inicial');
    v_n := v_n + 1;
  end loop;
end;
$$;

select pg_temp.add_product(
  'cafe-molido-tarrazu-340g', 'Café molido de altura Tarrazú 340 g', 'cafe', 'Cafetal Los Santos',
  'cafetal-los-santos', 4950, null, 360, '{20,9,6}', 'platform', 120,
  '{"Tueste medio, molido para chorreador","Cultivado a 1 600 m en la Zona de los Santos","Notas de chocolate y cítricos","Empacado la misma semana del tueste"}',
  'Café 100 % arábica de pequeños productores de Tarrazú. Molienda media, ideal para chorreador y cafetera de filtro.',
  true, 100);
select pg_temp.add_product(
  'cafe-grano-tarrazu-1kg', 'Café en grano tostado medio Tarrazú 1 kg', 'cafe', 'Cafetal Los Santos',
  'cafetal-los-santos', 12900, null, 1040, '{28,14,8}', 'platform', 60,
  '{"Grano entero para moler en casa","Bolsa con válvula que conserva el aroma","Rinde unas 100 tazas"}',
  'El mismo café de altura, en grano entero, para quienes muelen al momento.', true, 100);
select pg_temp.add_product(
  'chorreador-madera-artesanal', 'Chorreador de madera artesanal con bolsa de tela', 'artesania',
  'Taller Sarchí', 'cafetal-los-santos', 9500, null, 600, '{30,15,15}', 'platform', 40,
  '{"Madera de cenízaro con acabado natural","Incluye bolsa de algodón lavable","Hecho a mano en Sarchí"}',
  'El método tradicional costarricense para preparar café, hecho por artesanos de Sarchí.', true);
select pg_temp.add_product(
  'carreta-decorativa-pintada-20cm', 'Carreta típica decorativa pintada a mano 20 cm', 'artesania',
  'Taller Sarchí', 'cafetal-los-santos', 18500, null, 800, '{24,14,14}', 'platform', 20,
  '{"Pintada a mano, cada pieza es única","Ruedas que giran","Incluye yunta de bueyes tallada"}',
  'Réplica de la carreta costarricense, símbolo nacional del trabajo, pintada en el estilo tradicional de Sarchí.', true);
select pg_temp.add_product(
  'tabla-picar-teca', 'Tabla de picar de madera de teca 35 cm', 'cocina', 'Taller Sarchí',
  'cafetal-los-santos', 13500, null, 1200, '{36,24,3}', 'platform', 30,
  '{"Teca de plantación certificada","No daña el filo de los cuchillos","Canal para jugos"}',
  'Tabla maciza de teca, resistente a la humedad y fácil de mantener con aceite mineral.', true);
select pg_temp.add_product(
  'jabon-artesanal-avena-miel-3u', 'Jabón artesanal de avena y miel, 3 unidades', 'belleza',
  'Guaria Botánica', 'cafetal-los-santos', 5400, null, 330, '{12,9,8}', 'platform', 70,
  '{"Sin colorantes ni fragancias artificiales","Para piel sensible","Tres barras de 100 g"}',
  'Jabón saponificado en frío con avena molida y miel de abeja costarricense.', true);

select pg_temp.add_product(
  'audifonos-inalambricos-nimbo-aire', 'Audífonos inalámbricos Nimbo Aire con estuche de carga',
  'audio', 'Nimbo', 'tecnocasa', 19900, 24900, 180, '{10,8,4}', 'platform', 90,
  '{"Hasta 24 horas de batería con el estuche","Cancelación de ruido en llamadas","Resistentes al sudor","Garantía local de 12 meses"}',
  'Audífonos Bluetooth 5.3 con estuche de carga USB-C y controles táctiles.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'parlante-bluetooth-nimbo-ola', 'Parlante Bluetooth Nimbo Ola resistente al agua', 'audio', 'Nimbo',
  'tecnocasa', 27500, null, 620, '{18,8,8}', 'platform', 40,
  '{"Resistente al agua y al polvo","12 horas de reproducción","Se enlaza con un segundo parlante en estéreo"}',
  'Parlante portátil para la playa, la piscina o el corredor.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'cargador-usb-c-30w-nimbo', 'Cargador USB-C 30 W Nimbo de carga rápida', 'cargadores', 'Nimbo',
  'tecnocasa', 8900, 10900, 120, '{9,6,4}', 'platform', 150,
  '{"Carga rápida para celulares y tabletas","Compacto, clavijas plegables","Protección contra sobrecarga"}',
  'Cargador de pared USB-C de 30 W compatible con carga rápida.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'laptop-14-nimbo-libro', 'Laptop Nimbo Libro 14" 8 GB RAM 256 GB SSD', 'laptops', 'Nimbo',
  'tecnocasa', 289000, 319000, 1900, '{36,26,6}', 'platform', 12,
  '{"Pantalla de 14 pulgadas Full HD","Teclado en español con ñ","8 GB de RAM y 256 GB SSD","Garantía local de 12 meses"}',
  'Laptop liviana para estudio y oficina, con teclado en español.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'teclado-mecanico-compacto-nimbo', 'Teclado mecánico compacto Nimbo en español', 'perifericos',
  'Nimbo', 'tecnocasa', 32000, null, 780, '{32,12,5}', 'platform', 30,
  '{"Distribución en español con ñ","Interruptores táctiles","Cable USB-C desmontable"}',
  'Teclado mecánico de 75 % con retroiluminación blanca.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'olla-arrocera-volcan-1-8l', 'Olla arrocera Volcán 1,8 L con vaporera', 'cocina-electrica', 'Volcán',
  'tecnocasa', 21900, null, 2400, '{28,28,26}', 'platform', 40,
  '{"Para 10 tazas de arroz cocido","Recipiente antiadherente removible","Función mantener caliente","Incluye vaporera"}',
  'La olla arrocera de todos los días, con vaporera para verduras.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'licuadora-volcan-600w', 'Licuadora Volcán 600 W vaso de vidrio 1,5 L', 'cocina-electrica', 'Volcán',
  'tecnocasa', 26500, 29900, 3200, '{22,20,40}', 'platform', 30,
  '{"Vaso de vidrio de 1,5 litros","Cuchillas de acero inoxidable","5 velocidades y pulso"}',
  'Licuadora de 600 W para frescos, batidos y salsas.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'abanico-pie-volcan-18', 'Abanico de pie Volcán 18" 3 velocidades', 'ventilacion', 'Volcán',
  'tecnocasa', 29900, null, 5600, '{55,50,18}', 'platform', 25,
  '{"Aspas de 18 pulgadas","Altura ajustable y oscilación","Silencioso en velocidad baja"}',
  'Abanico de pedestal para cuartos y salas.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'cafetera-electrica-volcan-12-tazas', 'Cafetera eléctrica Volcán 12 tazas programable',
  'cocina-electrica', 'Volcán', 'tecnocasa', 23900, null, 2100, '{30,22,34}', 'platform', 30,
  '{"Programable hasta 24 horas","Filtro permanente lavable","Pausa para servir"}',
  'Cafetera de goteo programable de 12 tazas.', false, 1300, 12::smallint);

select pg_temp.add_product(
  'taladro-inalambrico-roble-20v', 'Taladro inalámbrico Roble 20 V con 2 baterías',
  'herramientas-electricas', 'Roble', 'ferreteria-el-higueron', 54900, 62000, 2900, '{34,28,10}',
  'seller', 14,
  '{"Dos baterías de litio y cargador","Mandril de 13 mm sin llave","Maletín incluido"}',
  'Taladro atornillador de 20 V para madera, metal y concreto liviano.', false, 1300, 12::smallint);
select pg_temp.add_product(
  'juego-desatornilladores-roble-32', 'Juego de desatornilladores Roble 32 piezas', 'ferreteria',
  'Roble', 'ferreteria-el-higueron', 11500, null, 900, '{25,15,5}', 'seller', 40,
  '{"Puntas imantadas","Mango ergonómico","Estuche organizador"}',
  'Juego de desatornilladores y puntas para el hogar y el taller.');
select pg_temp.add_product(
  'bombillo-led-9w-4u', 'Bombillo LED 9 W luz cálida, paquete de 4', 'iluminacion', 'Luma',
  'ferreteria-el-higueron', 4200, null, 240, '{13,13,11}', 'seller', 80,
  '{"Equivale a 60 W incandescente","Rosca estándar E27","Vida útil de 15 000 horas"}',
  'Paquete de cuatro bombillos LED de bajo consumo.');

select pg_temp.add_product(
  'salveque-urbano-sendero-25l', 'Salveque urbano Sendero 25 L con compartimento para laptop',
  'bolsos', 'Sendero', 'tienda-sendero', 18900, null, 700, '{46,30,16}', 'platform', 40,
  '{"Compartimento acolchado para laptop de 15 pulgadas","Tela repelente al agua","Bolsillo oculto antirrobo"}',
  'Salveque para el trabajo, la universidad y el fin de semana.');
select pg_temp.add_product(
  'botella-termica-sendero-750ml', 'Botella térmica Sendero 750 ml acero inoxidable', 'aire-libre',
  'Sendero', 'tienda-sendero', 9900, null, 380, '{28,8,8}', 'platform', 60,
  '{"Mantiene frío 24 horas y caliente 12","Acero inoxidable sin BPA","Tapa a prueba de derrames"}',
  'Botella de doble pared para llevar agua fría todo el día.');
select pg_temp.add_product(
  'balon-futbol-sendero-5', 'Balón de fútbol Sendero N.º 5 cosido a mano', 'futbol', 'Sendero',
  'tienda-sendero', 12500, null, 430, '{22,22,22}', 'platform', 35,
  '{"Tamaño y peso oficiales","Cosido a mano","Para zacate natural y sintético"}',
  'Balón de entrenamiento número 5.');
select pg_temp.add_product(
  'hamaca-algodon-doble', 'Hamaca de algodón tejida doble con bolsa', 'descanso',
  'Tejidos del Pacífico', 'tienda-sendero', 24900, null, 1500, '{40,25,12}', 'platform', 20,
  '{"Para dos personas, soporta 200 kg","Algodón tejido a mano","Incluye bolsa para guardarla"}',
  'Hamaca doble tejida por artesanas de Guanacaste.', true);
select pg_temp.add_product(
  'alimento-perro-adulto-tinamu-8kg', 'Alimento para perro adulto Tinamú 8 kg', 'mascotas', 'Tinamú',
  'tienda-sendero', 16900, null, 8200, '{60,38,12}', 'platform', 30,
  '{"Pollo y arroz","Para razas medianas y grandes","Sin colorantes artificiales"}',
  'Alimento seco completo para perros adultos.');
select pg_temp.add_product(
  'camiseta-algodon-sendero', 'Camiseta de algodón Sendero cuello redondo', 'ropa', 'Sendero',
  'tienda-sendero', 8900, null, 200, '{30,25,2}', 'platform', 20,
  '{"100 % algodón peinado","Corte regular","No encoge al lavar"}',
  'Camiseta básica de algodón.', false, 1300, 1::smallint, array['Talla S', 'Talla M', 'Talla L']);
select pg_temp.add_product(
  'rompecabezas-volcanes-500', 'Rompecabezas Volcanes de Costa Rica 500 piezas', 'juguetes',
  'Juegos Ceiba', 'tienda-sendero', 7900, null, 550, '{33,23,5}', 'platform', 25,
  '{"500 piezas de cartón grueso","Ilustración original","Armado mide 48 × 34 cm"}',
  'Rompecabezas ilustrado con los volcanes del país.', true);
select pg_temp.add_product(
  'libreta-tapa-dura-a5', 'Libreta de notas tapa dura A5 rayada', 'libros', 'Papelera Central',
  'tienda-sendero', 3900, null, 300, '{22,15,2}', 'platform', 60,
  '{"96 hojas rayadas","Tapa dura con elástico","Papel de 80 g"}',
  'Libreta A5 para el trabajo y el estudio.');

-- A second seller offering the same headphones: cheaper, but slower. This is
-- what the featured-offer rule has to weigh.
with o as (
  insert into public.offers
    (sku_id, seller_id, price_minor, fulfillment, handling_days, seller_sku)
  select k.id, pg_temp.id('s_tienda-sendero'), 1950000, 'seller', 2, 'NIMBO-AIRE'
  from public.skus k join public.products p on p.id = k.product_id
  where p.slug = 'audifonos-inalambricos-nimbo-aire'
  returning sku_id
)
select private.apply_stock_change(
  pg_temp.id('w_SEN-ESC'), sku_id, pg_temp.id('s_tienda-sendero'), 6, 'receive', null, 'seed', null,
  'Inventario inicial')
from o;

-- A listing waiting for approval, from a seller waiting for approval.
with p as (
  insert into public.products
    (slug, title, description, bullet_points, category_id, status, created_by_seller_id)
  values
    ('lampara-mesa-bambu', 'Lámpara de mesa de bambú tejido',
     'Lámpara de mesa con pantalla de bambú tejido a mano.',
     '{"Bambú tejido a mano","Rosca E27, bombillo no incluido"}',
     (select id from public.categories where slug = 'hogar'), 'pending_review',
     pg_temp.id('s_bazar-nuevo'))
  returning id
), k as (
  insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
  select id, 'YT-LAMPBAMB', 900, 25, 25, 35 from p returning id
)
insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days)
select id, pg_temp.id('s_bazar-nuevo'), 1650000, 'seller', 2 from k;

-- ── Addresses ──────────────────────────────────────────────────────────────

with a as (
  insert into public.addresses
    (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, plus_code, is_default)
  values
    (pg_temp.id('u_buyer'), 'Casa', 'María Fernández Solís', '+50688881234', '11501',
     'De la Fuente de la Hispanidad 300 metros sur y 50 este, casa esquinera con portón negro',
     9.9338, -84.0512, '66XQWWMX+GG', true),
    (pg_temp.id('u_buyer2'), 'Casa', 'Andrés Mora Chaves', '+50670002345', '10201',
     'Escazú centro, del parque 200 metros oeste, edificio blanco de dos pisos, apartamento 3',
     9.9189, -84.1399, '66XQWV96+H2', true),
    (pg_temp.id('u_buyer3'), 'Trabajo', 'Sofía Vargas Rojas', '+50661113456', '40101',
     'Heredia centro, costado norte del Parque Central, oficina con rótulo verde',
     9.9981, -84.1171, '66XQXVXM+65', true)
  returning id, user_id
)
insert into seed_ids (name, id)
select 'a_' || (select name from seed_ids s where s.id = a.user_id), a.id from a;

-- ── Orders, through the real functions ─────────────────────────────────────

create function pg_temp.offer_of(p_slug text, p_variant text default '') returns uuid
language sql as $$
  select o.id from public.offers o
  join public.skus k on k.id = o.sku_id
  join public.products p on p.id = k.product_id
  where p.slug = p_slug and k.variant_name = p_variant
  -- Deterministic: the platform-fulfilled offer, so demo orders ship from one place.
  order by (o.fulfillment = 'platform') desc, o.price_minor desc, o.id limit 1
$$;

-- Places an order as a shopper and returns its id.
create function pg_temp.order_as(
  p_user text, p_key text, p_method public.payment_method, variadic p_lines text[]
) returns uuid
language plpgsql as $$
declare
  v_items jsonb := '[]';
  v_line text;
  v_result jsonb;
begin
  -- Each line is 'slug:quantity' or 'slug:quantity:variant'.
  foreach v_line in array p_lines loop
    v_items := v_items || jsonb_build_object(
      'offer_id', pg_temp.offer_of(split_part(v_line, ':', 1), split_part(v_line, ':', 3)),
      'quantity', split_part(v_line, ':', 2)::integer);
  end loop;
  perform pg_temp.act_as(pg_temp.id(p_user));
  v_result := public.place_order(v_items, pg_temp.id('a_' || p_user), p_method, p_key);
  if p_method not in ('cash_on_delivery', 'sinpe_movil') then
    perform public.confirm_sandbox_payment((v_result ->> 'order_id')::uuid);
  end if;
  return (v_result ->> 'order_id')::uuid;
end;
$$;

-- Picks and packs every platform shipment of an order, as the warehouse associate.
create function pg_temp.pick_and_pack(p_order uuid) returns void
language plpgsql as $$
declare
  s record;
  t record;
begin
  perform pg_temp.act_as(pg_temp.id('u_warehouse'));
  for s in
    select sh.id from public.shipments sh
    join public.warehouses w on w.id = sh.origin_warehouse_id
    where sh.order_id = p_order and w.kind = 'platform' and sh.status = 'pending'
  loop
    perform public.wms_start_picking(s.id);
    for t in select id, quantity from public.pick_tasks where shipment_id = s.id loop
      perform public.wms_confirm_pick(t.id, t.quantity);
    end loop;
    perform public.wms_pack_shipment(
      s.id,
      (select sum(i.weight_grams * si.quantity)::integer + 150
       from public.shipment_items si join public.order_items i on i.id = si.order_item_id
       where si.shipment_id = s.id),
      1::smallint);
  end loop;
end;
$$;

-- Builds a route from the packed shipments of the given orders, as operations staff.
create function pg_temp.route_for(p_driver text, variadic p_orders uuid[]) returns uuid
language plpgsql as $$
declare
  v_stops jsonb;
begin
  perform pg_temp.act_as(pg_temp.id('u_staff'));
  select jsonb_agg(jsonb_build_object('shipment_id', sh.id, 'sequence', n, 'eta_minute', n * 18)
                   order by n)
  into v_stops
  from (
    select sh.id, row_number() over (order by array_position(p_orders, sh.order_id), sh.id) as n
    from public.shipments sh
    where sh.order_id = any (p_orders) and sh.status = 'packed'
  ) sh;
  return public.ops_create_route(
    current_date, pg_temp.id('w_SJO1'), v_stops, pg_temp.id(p_driver), 14.5, 95);
end;
$$;

-- Drives a route to completion, delivering every stop with its PIN.
create function pg_temp.deliver_route(p_route uuid, p_driver_user text) returns void
language plpgsql as $$
declare
  st record;
  v_result jsonb;
begin
  perform pg_temp.act_as(pg_temp.id(p_driver_user));
  perform public.driver_start_route(p_route);
  for st in
    select rs.id, rs.recipient_name, rs.cod_amount_minor, o.delivery_pin
    from public.route_stops rs
    join public.shipments sh on sh.id = rs.shipment_id
    join public.orders o on o.id = sh.order_id
    where rs.route_id = p_route order by rs.sequence
  loop
    v_result := public.driver_complete_stop(
      st.id, st.delivery_pin, st.recipient_name, st.cod_amount_minor);
    if not (v_result ->> 'ok')::boolean then
      raise exception 'Seed delivery failed: %', v_result;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_history uuid[] := '{}';
  v_order uuid;
  v_route uuid;
  v_b uuid; v_b2 uuid; v_c uuid; v_d uuid;
  v_review record;
  v_n integer := 0;
  v_comments text[] := array[
    'Llegó al día siguiente, tal como decía. Muy buen producto.',
    'Buena calidad por el precio. El repartidor fue muy amable.',
    'Cumple con lo que promete. Lo volvería a comprar.',
    'Excelente, bien empacado y con factura electrónica al correo.',
    'Está bien, aunque esperaba un poco más por el precio.',
    'Me encantó. Se lo recomendé a mi familia.',
    'Funciona perfecto. La entrega fue puntual.',
    'Buen producto, la caja llegó un poco golpeada pero el contenido bien.'
  ];
  v_ratings smallint[] := array[5, 4, 5, 5, 3, 5, 4, 4];
begin
  -- Past orders: placed, paid, picked, packed, routed, delivered and reviewed.
  v_history := array[
    pg_temp.order_as('u_buyer', 'seed-h01', 'card',
      'audifonos-inalambricos-nimbo-aire:1', 'cafe-molido-tarrazu-340g:2'),
    pg_temp.order_as('u_buyer2', 'seed-h02', 'card',
      'olla-arrocera-volcan-1-8l:1', 'cafe-grano-tarrazu-1kg:1'),
    pg_temp.order_as('u_buyer3', 'seed-h03', 'card',
      'salveque-urbano-sendero-25l:1', 'botella-termica-sendero-750ml:2'),
    pg_temp.order_as('u_buyer', 'seed-h04', 'cash_on_delivery',
      'chorreador-madera-artesanal:1', 'cafe-molido-tarrazu-340g:3'),
    pg_temp.order_as('u_buyer2', 'seed-h05', 'card',
      'cargador-usb-c-30w-nimbo:2', 'parlante-bluetooth-nimbo-ola:1'),
    pg_temp.order_as('u_buyer3', 'seed-h06', 'card',
      'licuadora-volcan-600w:1', 'tabla-picar-teca:1', 'jabon-artesanal-avena-miel-3u:2'),
    pg_temp.order_as('u_buyer', 'seed-h07', 'card',
      'hamaca-algodon-doble:1', 'camiseta-algodon-sendero:2:Talla M'),
    pg_temp.order_as('u_buyer2', 'seed-h08', 'cash_on_delivery',
      'balon-futbol-sendero-5:1', 'audifonos-inalambricos-nimbo-aire:1'),
    pg_temp.order_as('u_buyer3', 'seed-h09', 'card',
      'cafetera-electrica-volcan-12-tazas:1', 'cafe-grano-tarrazu-1kg:2'),
    pg_temp.order_as('u_buyer', 'seed-h10', 'card',
      'teclado-mecanico-compacto-nimbo:1', 'libreta-tapa-dura-a5:3')
  ];
  foreach v_order in array v_history loop
    perform pg_temp.pick_and_pack(v_order);
  end loop;
  perform pg_temp.deliver_route(pg_temp.route_for('d_carlos', variadic v_history[1:5]), 'u_driver');
  perform pg_temp.deliver_route(pg_temp.route_for('d_luis', variadic v_history[6:10]), 'u_driver2');

  -- The office counts the cash from both routes.
  perform pg_temp.act_as(pg_temp.id('u_staff'));
  perform public.ops_settle_route(s.route_id, s.cod_expected_minor)
  from public.driver_settlements s;

  -- Reviews from the people who received those orders.
  for v_review in
    select i.id as item_id, o.user_id
    from public.order_items i join public.orders o on o.id = i.order_id
    where o.id = any (v_history)
    order by o.order_number, i.title
  loop
    v_n := v_n + 1;
    perform pg_temp.act_as(v_review.user_id);
    perform public.submit_review(
      v_review.item_id, v_ratings[1 + v_n % 8], null, v_comments[1 + v_n % 8]);
  end loop;

  -- Today's work, left at each stage so every app has something to show:
  -- two parcels out for delivery (one to be paid in cash) …
  v_b := pg_temp.order_as('u_buyer', 'seed-today-b1', 'cash_on_delivery', 'olla-arrocera-volcan-1-8l:1');
  v_b2 := pg_temp.order_as('u_buyer2', 'seed-today-b2', 'card',
    'abanico-pie-volcan-18:1', 'rompecabezas-volcanes-500:1');
  perform pg_temp.pick_and_pack(v_b);
  perform pg_temp.pick_and_pack(v_b2);
  v_route := pg_temp.route_for('d_carlos', v_b, v_b2);
  perform pg_temp.act_as(pg_temp.id('u_driver'));
  perform public.driver_start_route(v_route);

  -- … one packed and waiting for a route …
  v_c := pg_temp.order_as('u_buyer3', 'seed-today-c1', 'card',
    'alimento-perro-adulto-tinamu-8kg:1', 'botella-termica-sendero-750ml:1');
  perform pg_temp.pick_and_pack(v_c);

  -- … two paid and waiting to be picked …
  v_d := pg_temp.order_as('u_buyer', 'seed-today-d1', 'card',
    'laptop-14-nimbo-libro:1', 'cargador-usb-c-30w-nimbo:1');
  perform pg_temp.order_as('u_buyer2', 'seed-today-d2', 'card',
    'carreta-decorativa-pintada-20cm:1', 'cafe-molido-tarrazu-340g:4');

  -- … one waiting for its SINPE Móvil transfer …
  perform pg_temp.order_as('u_buyer', 'seed-today-e1', 'sinpe_movil', 'parlante-bluetooth-nimbo-ola:1');

  -- … and one the seller ships from their own shop.
  perform pg_temp.order_as('u_buyer3', 'seed-today-f1', 'card',
    'taladro-inalambrico-roble-20v:1', 'bombillo-led-9w-4u:2');

  perform pg_temp.act_as(null);
end
$$;

-- Spread the past orders over the last month so the history reads naturally.
with past as (
  select id, row_number() over (order by order_number) as n
  from public.orders where idempotency_key like 'seed-h%'
)
update public.orders o
set placed_at = now() - make_interval(days => (31 - past.n * 3)::integer),
    confirmed_at = now() - make_interval(days => (31 - past.n * 3)::integer),
    delivered_at = now() - make_interval(days => (30 - past.n * 3)::integer)
from past where o.id = past.id;

update public.reviews r
set created_at = o.delivered_at + interval '2 days'
from public.order_items i join public.orders o on o.id = i.order_id
where i.id = r.order_item_id;

-- Ranking signals the nightly jobs would have produced.
select private.refresh_product_signals();
update public.products set views_30d = 40 + units_sold_30d * 22 + (random() * 60)::integer
where status = 'active';

commit;
