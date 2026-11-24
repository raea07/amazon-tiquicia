-- Counting a product into a location that has no record of it
-- (20261121084500_count_into_location.sql): the lookup the screen uses to
-- find the product and its shop, and the count. For each: the right caller
-- gets what they asked for, every wrong caller is refused, and what is left
-- behind is exactly what an upward count correction (wms_adjust_stock)
-- leaves. First, the reason the function exists: wms_adjust_stock with the
-- screen's 0 creates a shop's first units of a product in a warehouse.
--
-- Who plays whom: bodega is a worker of SJO1; central is an administrator;
-- a worker of another Yuntera warehouse (created here); vendedor is a seller
-- (TecnoCasa); repartidor a driver; comprador a shopper; a visitor.
-- Products: the notebook of Tienda Sendero (stored in SJO1); the earphones,
-- sold by TecnoCasa from SJO1 and by Tienda Sendero from its own site (no
-- stock record in SJO1); the drill, sold only by Ferretería El Higuerón from
-- its own site. The locations, the other warehouse and the order are the
-- suite's own. Every check compares with the suite's own fixtures or with
-- what was there before, so it holds on a used database.

begin;
\ir _helpers.sql
select pg_temp.allow_inspection();
\ir _money_helpers.sql

create function pg_temp.refused_detail(p_sql text, p_code text) returns text
language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

create function pg_temp.denied(p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not denied: %', p_sql;
exception when insufficient_privilege then
  null;
end;
$$;

grant execute on function pg_temp.refused_detail(text, text), pg_temp.denied(text) to authenticated, anon;

-- Units of a product of a shop on one of the suite's locations (superuser only).
create function pg_temp.bin(p_location text, p_sku text default 'sku', p_seller text default 'seller')
returns integer
language sql as $$
  select coalesce((select b.quantity from public.bin_stock b
                   where b.location_id = current_setting('t.' || p_location)::uuid
                     and b.sku_id = current_setting('t.' || p_sku)::uuid
                     and b.seller_id = current_setting('t.' || p_seller)::uuid), 0)
$$;
-- Readable while signed in as a worker too (row-level security still applies).
grant execute on function pg_temp.bin(text, text, text) to authenticated;

-- The notebook's totals in SJO1 and what shoppers can buy, as numbers.
create function pg_temp.on_hand() returns integer
language sql as $$
  select l.on_hand from public.stock_levels l
  where l.warehouse_id = current_setting('t.platform')::uuid
    and l.sku_id = current_setting('t.sku')::uuid and l.seller_id = current_setting('t.seller')::uuid
$$;
create function pg_temp.available() returns integer
language sql as $$
  select o.available_quantity from public.offers o
  where o.sku_id = current_setting('t.sku')::uuid and o.seller_id = current_setting('t.seller')::uuid
$$;

-- The calls, as text for the refusal helpers.
create function pg_temp.count_sql(p_location text, p_quantity integer, p_note text,
                                  p_sku text default 'sku', p_seller text default 'seller')
returns text
language sql as $$
  select format('select public.wms_count_into_location(%L, %L, %L, %s, %L)',
    current_setting('t.' || p_location), current_setting('t.' || p_sku),
    current_setting('t.' || p_seller), coalesce(p_quantity::text, 'null'), p_note)
$$;
grant execute on function pg_temp.count_sql(text, integer, text, text, text) to authenticated, anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────

select pg_temp.remember('platform', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('sku', (select o.sku_id::text from public.offers o where o.id = pg_temp.offer('libreta-tapa-dura-a5')));
select pg_temp.remember('seller', (select o.seller_id::text from public.offers o where o.id = pg_temp.offer('libreta-tapa-dura-a5')));
select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('earphones', (select o.sku_id::text from public.offers o
  join public.sellers s on s.id = o.seller_id
  where s.slug = 'tecnocasa' and o.fulfillment = 'platform'
    and exists (select 1 from public.offers x where x.sku_id = o.sku_id and x.seller_id = current_setting('t.seller')::uuid
                and x.fulfillment = 'seller')
  limit 1));
select pg_temp.remember('drill', (select k.id::text from public.skus k join public.products p on p.id = k.product_id
  where p.title like 'Taladro inalámbrico%' limit 1));
select pg_temp.remember('higueron', (select o.seller_id::text from public.offers o
  where o.sku_id = current_setting('t.drill')::uuid limit 1));
select pg_temp.remember('moves_from', (select coalesce(max(id), 0)::text from public.stock_movements));
do $$ begin
  assert current_setting('t.sku') <> '' and current_setting('t.seller') <> '', 'fixture: the notebook';
  assert pg_temp.on_hand() is not null, 'fixture: the notebook has a stock record in SJO1';
  assert current_setting('t.earphones') <> '', 'fixture: the earphones, sold by two shops';
  assert exists (select 1 from public.stock_levels where warehouse_id = current_setting('t.platform')::uuid
                 and sku_id = current_setting('t.earphones')::uuid and seller_id = current_setting('t.tecnocasa')::uuid),
    'fixture: TecnoCasa keeps the earphones in SJO1';
  assert not exists (select 1 from public.stock_levels where warehouse_id = current_setting('t.platform')::uuid
                     and sku_id = current_setting('t.earphones')::uuid and seller_id = current_setting('t.seller')::uuid),
    'fixture: Tienda Sendero has no stock record of the earphones in SJO1';
  assert current_setting('t.drill') <> '' and not exists (select 1 from public.stock_levels l
    join public.warehouses w on w.id = l.warehouse_id and w.kind = 'platform'
    where l.sku_id = current_setting('t.drill')::uuid), 'fixture: the drill is in no Yuntera warehouse';
end $$;

-- Locations of the suite's own in SJO1: three shelves, one switched off.
select pg_temp.act('central@yuntera.example');
select pg_temp.remember('l1', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-72-01-A', 'storage') ->> 'id');
select pg_temp.remember('l2', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-72-02-A', 'pick') ->> 'id');
select pg_temp.remember('l3', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-72-03-A', 'storage') ->> 'id');
select pg_temp.remember('l4', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-72-04-A', 'storage') ->> 'id');
select pg_temp.remember('off', public.ops_create_location(current_setting('t.platform')::uuid, 'Y-72-05-A', 'storage') ->> 'id');
select public.ops_set_location_active(current_setting('t.off')::uuid, false);
select pg_temp.logout();
select pg_temp.remember('reception', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.platform')::uuid and code = 'REC-01'));
select pg_temp.remember('returns', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.platform')::uuid and code = 'DEV-01'));

-- Another Yuntera warehouse, with a worker, a location, and the drill on
-- record there (so a search from SJO1 must not find it by name).
insert into public.warehouses (code, name, kind, address, postal_code, lat, lng)
values ('ZZ172', 'Bodega de la prueba 172', 'platform', 'Cartago centro', '30101', 9.86, -83.92);
select pg_temp.remember('other_wh', (select id::text from public.warehouses where code = 'ZZ172'));
insert into public.warehouse_locations (warehouse_id, code, kind)
values (current_setting('t.other_wh')::uuid, 'Y-72-09-A', 'storage');
select pg_temp.remember('other_loc', (select id::text from public.warehouse_locations
  where warehouse_id = current_setting('t.other_wh')::uuid and code = 'Y-72-09-A'));
insert into public.stock_levels (warehouse_id, sku_id, seller_id, on_hand)
values (current_setting('t.other_wh')::uuid, current_setting('t.drill')::uuid, current_setting('t.higueron')::uuid, 7);
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'otrabodega172@yuntera.example', '{"full_name": "Otra Bodega Prueba"}');
insert into public.warehouse_staff (warehouse_id, user_id, role)
select current_setting('t.other_wh')::uuid, id, 'associate' from auth.users
where email = 'otrabodega172@yuntera.example';

-- ═══ 0. Why a new function: wms_adjust_stock creates first units ═════════

-- From the screen's 0, wms_adjust_stock counts the earphones into SJO1 for
-- Tienda Sendero, which never had them there: a stock record appears from
-- nothing. (Rolled back at once: the rest of the suite needs it absent.)
savepoint before_proof;
select pg_temp.act('bodega@yuntera.example');
select public.wms_adjust_stock(current_setting('t.l1')::uuid, current_setting('t.earphones')::uuid,
  current_setting('t.seller')::uuid, 3, 'Prueba de la razón de esta función', 0);
select pg_temp.logout();
do $$ begin
  assert (select on_hand from public.stock_levels where warehouse_id = current_setting('t.platform')::uuid
          and sku_id = current_setting('t.earphones')::uuid and seller_id = current_setting('t.seller')::uuid) = 3,
    'proof: wms_adjust_stock made a first stock record out of a count';
end $$;
rollback to savepoint before_proof;

-- ═══ 1. Who may call what ══════════════════════════════════════════════════

do $$
declare
  v_missing text;
begin
  select string_agg(f.fn, ', ') into v_missing
  from unnest(array['wms_count_candidates', 'wms_count_into_location']) f (fn)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f.fn and p.prosecdef
                      and p.proconfig @> array['search_path=""']
                      and has_function_privilege('authenticated', p.oid, 'execute')
                      and not has_function_privilege('anon', p.oid, 'execute')
                      and not has_function_privilege('public', p.oid, 'execute'));
  assert v_missing is null, format('who: not as documented: %s', v_missing);
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'wms_adjust_stock') = 1,
    'who: wms_adjust_stock is still one function';
end $$;

-- A visitor: no privilege at all.
select pg_temp.login_anon();
do $$ begin
  perform pg_temp.denied(format('select public.wms_count_candidates(%L, %L)', current_setting('t.l1'), 'Libreta'));
  perform pg_temp.denied(pg_temp.count_sql('l1', 2, 'Conteo de un visitante'));
end $$;
reset role;

-- A shopper, a seller, a driver, a worker of another warehouse: refused, and
-- nothing written.
do $$
declare
  v_who text;
begin
  foreach v_who in array array['comprador@yuntera.example', 'vendedor@yuntera.example',
                               'repartidor@yuntera.example', 'otrabodega172@yuntera.example'] loop
    perform pg_temp.login(v_who);
    perform pg_temp.refused(format('select public.wms_count_candidates(%L, %L)', current_setting('t.l1'), 'Libreta'), 'forbidden');
    perform pg_temp.refused(pg_temp.count_sql('l1', 2, 'Conteo de quien no debe'), 'forbidden');
    reset role;
  end loop;
end $$;
-- Signed out with the authenticated role (no user): not authenticated.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select pg_temp.refused(pg_temp.count_sql('l1', 2, 'Conteo sin usuario'), 'not_authenticated');
select pg_temp.refused(format('select public.wms_count_candidates(%L, %L)', current_setting('t.l1'), 'Libreta'), 'not_authenticated');
reset role;
-- The other warehouse's worker finds the drill from their own location.
select pg_temp.login('otrabodega172@yuntera.example');
do $$ begin
  assert exists (select 1 from jsonb_array_elements(public.wms_count_candidates(current_setting('t.other_loc')::uuid, 'taladro')) c
                 where c ->> 'sku_id' = current_setting('t.drill')),
    'who: a worker searches from a location of their own warehouse';
end $$;
reset role;
do $$ begin
  assert pg_temp.bin('l1') = 0 and pg_temp.bin('l1', 'earphones', 'tecnocasa') = 0, 'who: nothing written';
end $$;

-- ═══ 2. The lookup ═════════════════════════════════════════════════════════

select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb;
  c jsonb;
  s jsonb;
begin
  -- By its code, as typed (lower case, spaces) or scanned.
  v := public.wms_count_candidates(current_setting('t.l1')::uuid,
    ' ' || lower((select code from public.skus where id = current_setting('t.sku')::uuid)) || ' ');
  assert jsonb_array_length(v) = 1, format('lookup: by code, one product: %s', v);
  c := v -> 0;
  assert c ->> 'sku_id' = current_setting('t.sku') and c ->> 'title' like 'Libreta%'
         and jsonb_array_length(c -> 'shops') = 1, format('lookup: the notebook %s', c);
  s := c -> 'shops' -> 0;
  assert s ->> 'seller_id' = current_setting('t.seller') and s ->> 'seller_name' = 'Tienda Sendero'
         and (s ->> 'stock_record')::boolean and not (s ->> 'listed')::boolean
         and (s ->> 'on_shelf')::integer = 0, format('lookup: its shop %s', s);
  -- By its barcode, when it has one.
  if (select gtin from public.skus where id = current_setting('t.sku')::uuid) is not null then
    assert public.wms_count_candidates(current_setting('t.l1')::uuid,
             (select gtin from public.skus where id = current_setting('t.sku')::uuid)) -> 0 ->> 'sku_id'
           = current_setting('t.sku'), 'lookup: by barcode';
  end if;
  -- By name, any case, part of a word.
  assert exists (select 1 from jsonb_array_elements(public.wms_count_candidates(current_setting('t.l1')::uuid, 'LIBRETA de not')) x
                 where x ->> 'sku_id' = current_setting('t.sku')), 'lookup: by name';
  -- The earphones: TecnoCasa keeps them here; Tienda Sendero sells them from
  -- its own site and has no record here (listed second, not countable).
  v := public.wms_count_candidates(current_setting('t.l1')::uuid,
    (select code from public.skus where id = current_setting('t.earphones')::uuid));
  assert jsonb_array_length(v -> 0 -> 'shops') = 2
         and v -> 0 -> 'shops' -> 0 ->> 'seller_id' = current_setting('t.tecnocasa')
         and (v -> 0 -> 'shops' -> 0 ->> 'stock_record')::boolean
         and v -> 0 -> 'shops' -> 1 ->> 'seller_id' = current_setting('t.seller')
         and not (v -> 0 -> 'shops' -> 1 ->> 'stock_record')::boolean,
    format('lookup: two shops, the one with a record first: %s', v);
  -- The drill is in no warehouse of ours: found by its code (so the screen can
  -- say the first units come with a receipt), never by name from SJO1, where
  -- only the other warehouse has it on record.
  v := public.wms_count_candidates(current_setting('t.l1')::uuid,
    (select code from public.skus where id = current_setting('t.drill')::uuid));
  assert jsonb_array_length(v) = 1 and not (v -> 0 -> 'shops' -> 0 ->> 'stock_record')::boolean,
    format('lookup: by code, the drill with no record here: %s', v);
  assert not exists (select 1 from jsonb_array_elements(public.wms_count_candidates(current_setting('t.l1')::uuid, 'taladro')) x
                     where x ->> 'sku_id' = current_setting('t.drill')),
    'lookup: a name never finds what only another warehouse keeps';
  assert public.wms_count_candidates(current_setting('t.l1')::uuid, 'taladro')::text !~ '"on_hand"',
    'lookup: no stock totals at all';
  -- Short, long, wildcards, nothing found.
  assert public.wms_count_candidates(current_setting('t.l1')::uuid, 'l') = '[]'::jsonb, 'lookup: too short';
  assert public.wms_count_candidates(current_setting('t.l1')::uuid, repeat('a', 81)) = '[]'::jsonb, 'lookup: too long';
  assert public.wms_count_candidates(current_setting('t.l1')::uuid, null) = '[]'::jsonb, 'lookup: nothing typed';
  assert public.wms_count_candidates(current_setting('t.l1')::uuid, '%%') = '[]'::jsonb, 'lookup: % is a letter, not a wildcard';
  assert public.wms_count_candidates(current_setting('t.l1')::uuid, '__') = '[]'::jsonb, 'lookup: _ is a letter, not a wildcard';
  assert public.wms_count_candidates(current_setting('t.l1')::uuid, 'no existe tal cosa') = '[]'::jsonb, 'lookup: no match';
  -- At most ten, and never anything about shoppers.
  v := public.wms_count_candidates(current_setting('t.l1')::uuid, 'YT-');
  assert jsonb_array_length(v) = 10, format('lookup: ten at most (%s)', jsonb_array_length(v));
  assert v::text !~* '(senas|phone|recipient|delivery_pin|email|full_name|address)', 'lookup: no personal data';
  perform pg_temp.refused(format('select public.wms_count_candidates(%L, %L)', gen_random_uuid(), 'Libreta'), 'location_not_found');
end $$;
reset role;

-- ═══ 3. Refusals, each with nothing written ═══════════════════════════════

select pg_temp.remember('before_refusals', (select coalesce(max(id), 0)::text from public.stock_movements));
select pg_temp.remember('on_hand_start', pg_temp.on_hand()::text);
select pg_temp.remember('available_start', pg_temp.available()::text);
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  -- How many: a whole number from 1 to 10 000, as an upward correction.
  perform pg_temp.refused(pg_temp.count_sql('l1', 0, 'Conteo de la prueba'), 'invalid_adjustment');
  perform pg_temp.refused(pg_temp.count_sql('l1', -2, 'Conteo de la prueba'), 'invalid_adjustment');
  perform pg_temp.refused(pg_temp.count_sql('l1', 10001, 'Conteo de la prueba'), 'invalid_adjustment');
  perform pg_temp.refused(pg_temp.count_sql('l1', null, 'Conteo de la prueba'), 'invalid_adjustment');
  -- A reason of at least 5 letters.
  perform pg_temp.refused(pg_temp.count_sql('l1', 2, 'abc'), 'invalid_adjustment');
  perform pg_temp.refused(pg_temp.count_sql('l1', 2, '12345 67'), 'invalid_adjustment');
  perform pg_temp.refused(pg_temp.count_sql('l1', 2, null), 'invalid_adjustment');
  -- A product the shop does not sell.
  perform pg_temp.refused(pg_temp.count_sql('l1', 2, 'Conteo de otra tienda', 'sku', 'tecnocasa'), 'offer_not_found');
  -- A shop that sells it but has no stock record here: that is a receipt.
  perform pg_temp.refused(pg_temp.count_sql('l1', 2, 'Audífonos encontrados en el estante', 'earphones', 'seller'),
    'count_no_stock_record');
  perform pg_temp.refused(pg_temp.count_sql('l1', 2, 'Taladros encontrados en el estante', 'drill', 'higueron'),
    'count_no_stock_record');
  -- A location switched off, of another warehouse, of nobody.
  perform pg_temp.refused(pg_temp.count_sql('off', 2, 'Libretas en un estante apagado'), 'location_inactive');
  perform pg_temp.refused(pg_temp.count_sql('other_loc', 2, 'Libretas en otra bodega'), 'forbidden');
  perform pg_temp.refused(format('select public.wms_count_into_location(%L, %L, %L, 2, %L)', gen_random_uuid(),
    current_setting('t.sku'), current_setting('t.seller'), 'Libretas en ninguna parte'), 'location_not_found');
end $$;
-- Units counted in are sellable at once: never into the damaged, packing or dispatch areas.
do $$
declare
  v_code text;
begin
  foreach v_code in array array['CUA-01', 'EMP-01', 'DES-R1'] loop
    perform pg_temp.refused(format('select public.wms_count_into_location(%L, %L, %L, 2, %L)',
      (select id from public.warehouse_locations
       where warehouse_id = current_setting('t.platform')::uuid and code = v_code),
      current_setting('t.sku'), current_setting('t.seller'), 'Unidades contadas en la zona'),
      'count_not_shelf');
  end loop;
end $$;
reset role;
do $$ begin
  assert (select coalesce(max(id), 0) from public.stock_movements) = current_setting('t.before_refusals')::bigint,
    'refusals: no ledger row';
  assert pg_temp.on_hand() = current_setting('t.on_hand_start')::integer
         and pg_temp.available() = current_setting('t.available_start')::integer, 'refusals: the totals unchanged';
  assert not exists (select 1 from public.stock_levels where warehouse_id = current_setting('t.platform')::uuid
                     and sku_id in (current_setting('t.earphones')::uuid, current_setting('t.drill')::uuid)
                     and seller_id in (current_setting('t.seller')::uuid, current_setting('t.higueron')::uuid)),
    'refusals: no first stock record made';
  assert not exists (select 1 from public.bin_stock where location_id in (current_setting('t.l1')::uuid,
                     current_setting('t.off')::uuid)), 'refusals: no shelf row';
end $$;

-- ═══ 4. The count, and what it leaves ═════════════════════════════════════

select pg_temp.remember('events_before', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v jsonb;
begin
  v := public.wms_count_into_location(current_setting('t.l1')::uuid, current_setting('t.sku')::uuid,
    current_setting('t.seller')::uuid, 2, '  Dos libretas sin registrar en el estante  ');
  assert v ->> 'location_id' = current_setting('t.l1') and v ->> 'location_code' = 'Y-72-01-A'
         and v ->> 'sku_id' = current_setting('t.sku')
         and v ->> 'sku_code' = (select code from public.skus where id = current_setting('t.sku')::uuid)
         and v ->> 'seller_id' = current_setting('t.seller')
         and (v ->> 'quantity')::integer = 2 and (v ->> 'on_shelf')::integer = 2,
    format('count: the answer %s', v);
  -- The location lists it straight away, with the shop.
  v := public.wms_location_stock(current_setting('t.platform')::uuid, 'Y-72-01-A');
  assert jsonb_array_length(v -> 'items') = 1 and v -> 'items' -> 0 ->> 'sku_id' = current_setting('t.sku')
         and (v -> 'items' -> 0 ->> 'on_shelf')::integer = 2 and (v -> 'items' -> 0 ->> 'free')::integer = 2,
    format('count: the location lists it %s', v);
  -- And the lookup says so.
  assert (public.wms_count_candidates(current_setting('t.l1')::uuid,
            (select code from public.skus where id = current_setting('t.sku')::uuid)) -> 0 -> 'shops' -> 0 ->> 'listed')::boolean,
    'count: the lookup says it is listed now';
end $$;
reset role;
select pg_temp.remember('count_events', ((select coalesce(max(id), 0) from private.outbox_events)
  - current_setting('t.events_before')::bigint)::text);

do $$
declare
  m public.stock_movements%rowtype;
  h jsonb;
  o jsonb;
begin
  assert pg_temp.bin('l1') = 2, 'count: the shelf holds two';
  assert pg_temp.on_hand() = current_setting('t.on_hand_start')::integer + 2
         and pg_temp.available() = current_setting('t.available_start')::integer + 2,
    'count: the shop owns two more and shoppers can buy them';
  select * into m from public.stock_movements
  where id > current_setting('t.before_refusals')::bigint and to_location_id = current_setting('t.l1')::uuid;
  assert m.reason = 'adjust' and m.reference_type = 'cycle_count' and m.reference_id is null
         and m.on_hand_delta = 2 and m.quantity = 2 and m.from_location_id is null
         and m.warehouse_id = current_setting('t.platform')::uuid
         and m.note = 'Dos libretas sin registrar en el estante'
         and m.actor_id = (select id from auth.users where email = 'bodega@yuntera.example'),
    format('count: the ledger row %s', row_to_json(m));
  assert (select count(*) from public.stock_movements where id > current_setting('t.before_refusals')::bigint) = 1,
    'count: exactly one ledger row';
  perform pg_temp.remember('count_move', m.id::text);
  -- The shop's history: a warehouse count with the reason, never who.
  perform pg_temp.act('sendero@yuntera.example');
  h := public.seller_stock_history(current_setting('t.seller')::uuid, 5) -> 0;
  assert (h ->> 'id')::bigint = m.id and h ->> 'kind' = 'warehouse_count' and (h ->> 'change')::integer = 2
         and h ->> 'note' = 'Dos libretas sin registrar en el estante'
         and h ->> 'warehouse_name' = (select name from public.warehouses where id = current_setting('t.platform')::uuid),
    format('count: the shop''s history %s', h);
  assert h::text !~* '(bodega@|actor|Kattia|Y-72-01-A|location)', format('count: the shop never sees who or where %s', h);
  -- The staff list: a correction, with who.
  perform pg_temp.act('central@yuntera.example');
  select x into o from jsonb_array_elements(public.ops_stock_changes(20)) x where (x ->> 'id')::bigint = m.id;
  assert o ->> 'kind' = 'correction' and (o ->> 'change')::integer = 2 and o ->> 'to_code' = 'Y-72-01-A'
         and o ->> 'from_code' is null and o ->> 'seller_name' = 'Tienda Sendero'
         and o ->> 'actor_name' = (select coalesce(p.full_name, u.email::text) from auth.users u
                                   left join public.profiles p on p.id = u.id where u.email = 'bodega@yuntera.example')
         and o ->> 'note' = 'Dos libretas sin registrar en el estante',
    format('count: the staff list %s', o);
  perform pg_temp.logout();
end $$;

-- What an upward correction leaves, for the same product on another empty
-- shelf: the same ledger row but for its shelf, the same totals change, the
-- same events.
select pg_temp.remember('events_before_adjust', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.act('bodega@yuntera.example');
select public.wms_adjust_stock(current_setting('t.l2')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 2, 'Dos libretas sin registrar en el estante', 0);
select pg_temp.logout();
do $$
declare
  a public.stock_movements%rowtype;
  c public.stock_movements%rowtype;
begin
  select * into c from public.stock_movements where id = current_setting('t.count_move')::bigint;
  select * into a from public.stock_movements where id > c.id and to_location_id = current_setting('t.l2')::uuid;
  assert (a.warehouse_id, a.sku_id, a.seller_id, a.from_location_id, a.on_hand_delta, a.quantity, a.reason,
          a.reference_type, a.reference_id, a.note, a.actor_id)
         is not distinct from
         (c.warehouse_id, c.sku_id, c.seller_id, c.from_location_id, c.on_hand_delta, c.quantity, c.reason,
          c.reference_type, c.reference_id, c.note, c.actor_id),
    format('parity: the same ledger row as a correction: %s against %s', row_to_json(c), row_to_json(a));
  assert ((select coalesce(max(id), 0) from private.outbox_events) - current_setting('t.events_before_adjust')::bigint)
         = current_setting('t.count_events')::bigint,
    'parity: the same number of events as a correction';
  assert pg_temp.on_hand() = current_setting('t.on_hand_start')::integer + 4
         and pg_temp.available() = current_setting('t.available_start')::integer + 4,
    'parity: the same change to the totals';
end $$;

-- ═══ 5. Stale pages and double taps ═══════════════════════════════════════

select pg_temp.remember('before_again', (select coalesce(max(id), 0)::text from public.stock_movements));
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  -- The same save again (a double tap, or another worker who counted it meanwhile).
  assert pg_temp.refused_detail(pg_temp.count_sql('l1', 2, 'Dos libretas sin registrar en el estante'),
           'count_already_listed') = '2', 'again: refused, with what is on the shelf now';
  assert pg_temp.refused_detail(pg_temp.count_sql('l1', 5, 'Cinco libretas en el estante'),
           'count_already_listed') = '2', 'again: another number too';
end $$;
reset role;
do $$ begin
  assert pg_temp.bin('l1') = 2 and (select coalesce(max(id), 0) from public.stock_movements)
         = current_setting('t.before_again')::bigint, 'again: nothing changed';
end $$;

-- A product moved onto a shelf meanwhile: also listed.
select pg_temp.act('bodega@yuntera.example');
select public.wms_move_stock(current_setting('t.l2')::uuid, current_setting('t.l3')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 1, 'Reordenar');
select pg_temp.logout();
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  assert pg_temp.refused_detail(pg_temp.count_sql('l3', 3, 'Tres libretas en el estante'),
           'count_already_listed') = '1', 'moved: refused, with what is on the shelf now';
end $$;
reset role;

-- A shelf emptied to 0 keeps its row but lists nothing: a count may go there.
select pg_temp.act('bodega@yuntera.example');
select public.wms_move_stock(current_setting('t.l3')::uuid, current_setting('t.l2')::uuid,
  current_setting('t.sku')::uuid, current_setting('t.seller')::uuid, 1, 'Reordenar');
select pg_temp.logout();
do $$ begin
  assert exists (select 1 from public.bin_stock where location_id = current_setting('t.l3')::uuid
                 and sku_id = current_setting('t.sku')::uuid and quantity = 0), 'fixture: an emptied shelf row';
end $$;

-- ═══ 6. Pick tasks ═════════════════════════════════════════════════════════

-- A paid order of the notebook; its task is pointed at L4, which holds
-- none: the location lists the product (an order waits for it there), so a
-- count of it as new is refused and goes on the product's own line.
select pg_temp.shopper('cuenta172@yuntera.example', 'Prueba Conteo Nuevo');
select pg_temp.remember('order', pg_temp.place('cuenta172@yuntera.example',
  pg_temp.items('libreta-tapa-dura-a5:1'), 'card', 'count-172')::text);
select pg_temp.pay(current_setting('t.order')::uuid);
select pg_temp.remember('task', (select t.id::text from public.pick_tasks t
  join public.shipments s on s.id = t.shipment_id where s.order_id = current_setting('t.order')::uuid));
update public.pick_tasks set location_id = current_setting('t.l4')::uuid where id = current_setting('t.task')::uuid;
select pg_temp.login('bodega@yuntera.example');
do $$ begin
  assert (public.wms_count_candidates(current_setting('t.l4')::uuid,
            (select code from public.skus where id = current_setting('t.sku')::uuid)) -> 0 -> 'shops' -> 0 ->> 'listed')::boolean,
    'tasks: the lookup says an order waits for it here';
  assert pg_temp.refused_detail(pg_temp.count_sql('l4', 1, 'Una libreta en el estante'),
           'count_already_listed') = '0', 'tasks: refused while an order waits for it there';
end $$;
reset role;

-- A task that came up short elsewhere (L4) is left as an upward correction
-- leaves it: still short, still naming L4. The count goes onto L3.
update public.pick_tasks set status = 'short' where id = current_setting('t.task')::uuid;
select pg_temp.remember('task_before', (select row_to_json(t)::text from public.pick_tasks t
  where t.id = current_setting('t.task')::uuid));
select pg_temp.login('bodega@yuntera.example');
select public.wms_count_into_location(current_setting('t.l3')::uuid, current_setting('t.sku')::uuid,
  current_setting('t.seller')::uuid, 3, 'Tres libretas en el estante vacío');
reset role;
do $$ begin
  assert pg_temp.bin('l3') = 3, 'tasks: the emptied shelf holds the three counted';
  assert (select row_to_json(t)::text from public.pick_tasks t where t.id = current_setting('t.task')::uuid)
         = current_setting('t.task_before'), 'tasks: the short task is untouched';
end $$;

-- ═══ 7. Other places and callers ══════════════════════════════════════════

-- The returns and receiving areas take counted units, as a correction.
select pg_temp.login('bodega@yuntera.example');
do $$
declare
  v_location text;
begin
  foreach v_location in array array['returns', 'reception'] loop
    -- (On a used database the area may already list them: then it is left alone.)
    if not exists (select 1 from jsonb_array_elements(public.wms_count_candidates(
                     current_setting('t.' || v_location)::uuid,
                     (select code from public.skus where id = current_setting('t.earphones')::uuid)) -> 0 -> 'shops') s
                   where s ->> 'seller_id' = current_setting('t.tecnocasa') and (s ->> 'listed')::boolean) then
      perform public.wms_count_into_location(current_setting('t.' || v_location)::uuid,
        current_setting('t.earphones')::uuid, current_setting('t.tecnocasa')::uuid, 1, 'Un audífono encontrado aquí');
    end if;
  end loop;
end $$;
reset role;
do $$ begin
  assert pg_temp.bin('returns', 'earphones', 'tecnocasa') >= 1 and pg_temp.bin('reception', 'earphones', 'tecnocasa') >= 1,
    'places: the returns and receiving areas';
end $$;
-- Operations staff may count too; up to the limit of a correction.
select pg_temp.login('central@yuntera.example');
select public.wms_count_into_location(current_setting('t.l4')::uuid, current_setting('t.earphones')::uuid,
  current_setting('t.tecnocasa')::uuid, 10000, 'Conteo de operaciones en el estante');
reset role;
do $$ begin
  assert pg_temp.bin('l4', 'earphones', 'tecnocasa') = 10000, 'staff: operations counted, at the limit';
  assert (select actor_id from public.stock_movements where to_location_id = current_setting('t.l4')::uuid
          and sku_id = current_setting('t.earphones')::uuid order by id desc limit 1)
         = (select id from auth.users where email = 'central@yuntera.example'), 'staff: with who';
end $$;

-- ═══ 8. What is left behind ═══════════════════════════════════════════════

do $$ begin
  assert not exists (select 1 from public.stock_movements where id > current_setting('t.moves_from')::bigint
                     and reference_type = 'cycle_count'
                     and (reason <> 'adjust' or on_hand_delta <= 0 or from_location_id is not null
                          or to_location_id is null or note is null)),
    'ledger: every count in is an upward correction with a shelf and a reason';
  -- The suite's shelves add up with what the ledger says went in and out.
  assert (select sum(b.quantity) from public.bin_stock b
          where b.location_id in (current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
                                  current_setting('t.l3')::uuid, current_setting('t.l4')::uuid))
         = (select sum(case when m.to_location_id in (current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
                                                      current_setting('t.l3')::uuid, current_setting('t.l4')::uuid)
                            then m.quantity else 0 end)
                 - sum(case when m.from_location_id in (current_setting('t.l1')::uuid, current_setting('t.l2')::uuid,
                                                        current_setting('t.l3')::uuid, current_setting('t.l4')::uuid)
                            then m.quantity else 0 end)
            from public.stock_movements m where m.id > current_setting('t.moves_from')::bigint),
    'ledger: explains the shelves';
end $$;

select 'ok' as count_into_location;
rollback;
