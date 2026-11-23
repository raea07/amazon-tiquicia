-- Catalogue follow-ups (20261121084100_catalogue_followups.sql).
--
-- 1. private.product_page_open refuses a product that is not on sale by
--    itself, while its own shop and staff still open it (the seller's
--    preview, the staff view). Every status that must not open for a visitor
--    is tried, plus a product in a hidden category (opens) and one of a
--    closed shop (does not), through the helper itself and through the shop's
--    calls.
-- 2. ops_delete_brand: who may call it; a brand in use (any status) is
--    refused with the number of products; a brand nobody names goes, with
--    the brands merged into it, its addresses free again and an audit entry;
--    a correction can no longer give it.
--
-- Who plays whom: central is an administrator; comprador3 is given one staff
-- role at a time; comprador is a shopper; sendero owns Tienda Sendero;
-- vendedor owns TecnoCasa and Ferretería El Higuerón.

begin;
\ir _helpers.sql

create function pg_temp.refused(p_sql text, p_code text, p_detail text default null) returns void
language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
  if p_detail is not null and v_detail is distinct from p_detail then
    raise exception 'expected detail % but got "%" for: %', p_detail, v_detail, p_sql;
  end if;
end;
$$;

create function pg_temp.staff_as(p_role public.staff_role) returns void
language sql as $$
  delete from public.staff_members
  where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
  insert into public.staff_members (user_id, role)
  select id, p_role from auth.users where email = 'comprador3@yuntera.example';
$$;

-- The helper itself, asked for a product as a given viewer (null: a visitor).
-- Runs as the owner, as the shop's functions do, with the viewer's claims.
create function pg_temp.helper_opens(p_email text, p_slug text) returns boolean
language plpgsql as $$
declare
  v_open boolean;
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then ''
         else json_build_object('sub', (select id from auth.users where email = p_email),
                                'role', 'authenticated', 'aal', 'aal2')::text end, true);
  v_open := private.product_page_open((select id from public.products where slug = p_slug));
  perform set_config('request.jwt.claims', '', true);
  return v_open;
end;
$$;

do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.refused(text, text, text), pg_temp.remember(text, text)
  to authenticated, anon;

-- ═══ 1. Product pages ══════════════════════════════════════════════════════

-- Fixtures, for this transaction only: Tienda Sendero's products in each
-- status, a hidden category, and Ferretería El Higuerón closed. On a used
-- database staff may have changed them; they are set here from what they are.
update public.categories set active = true where slug = 'libros';
update public.products set status = 'active', rejection_reason = null, taken_down_at = null,
       taken_down_by = null, taken_down_fingerprint = null
where slug in ('botella-termica-sendero-750ml', 'balon-futbol-sendero-5', 'rompecabezas-volcanes-500',
               'camiseta-algodon-sendero', 'libreta-tapa-dura-a5', 'hamaca-algodon-doble');
do $$ begin
  assert (select count(*) from public.products
          where slug in ('botella-termica-sendero-750ml', 'balon-futbol-sendero-5',
                         'rompecabezas-volcanes-500', 'camiseta-algodon-sendero',
                         'libreta-tapa-dura-a5', 'hamaca-algodon-doble')
            and status = 'active'
            and created_by_seller_id = (select id from public.sellers where slug = 'tienda-sendero')) = 6,
    'fixture: six products of Tienda Sendero on sale';
end $$;
update public.products set status = 'draft' where slug = 'botella-termica-sendero-750ml';
update public.products set status = 'pending_review' where slug = 'balon-futbol-sendero-5';
update public.products set status = 'archived' where slug = 'rompecabezas-volcanes-500';
update public.products
set status = 'rejected', rejection_reason = 'Infringe una marca registrada.', taken_down_at = now(),
    taken_down_fingerprint = private.listing_fingerprint(id)
where slug = 'camiseta-algodon-sendero';
update public.categories set active = false where slug = 'libros';
update public.sellers set status = 'closed' where slug = 'ferreteria-el-higueron';
do $$ begin
  -- The closed shop's product is sold by nobody else (else it would still open).
  assert not exists (
    select 1 from public.offers o join public.skus k on k.id = o.sku_id
    join public.products p on p.id = k.product_id join public.sellers s on s.id = o.seller_id
    where p.slug = 'taladro-inalambrico-roble-20v' and s.slug <> 'ferreteria-el-higueron'
      and o.status = 'active' and s.status = 'active'),
    'fixture: only its closed shop sells the drill';
end $$;

-- The helper by itself, for each viewer.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- slug, visitor, shopper, another shop, its own shop, staff
      ('botella-termica-sendero-750ml', false, false, false, true, true),   -- draft
      ('balon-futbol-sendero-5', false, false, false, true, true),          -- waiting for review
      ('rompecabezas-volcanes-500', false, false, false, true, true),       -- archived
      ('camiseta-algodon-sendero', false, false, false, true, true),        -- taken down
      ('libreta-tapa-dura-a5', true, true, true, true, true),               -- in a hidden category
      ('hamaca-algodon-doble', true, true, true, true, true),               -- on sale
      ('taladro-inalambrico-roble-20v', false, false, false, true, true)    -- of a closed shop
    ) v (slug, visitor, shopper, other_shop, own_shop, staff)
  loop
    assert pg_temp.helper_opens(null, r.slug) = r.visitor,
      format('helper: a visitor and %s should be %s', r.slug, r.visitor);
    assert pg_temp.helper_opens('comprador@yuntera.example', r.slug) = r.shopper,
      format('helper: a shopper and %s should be %s', r.slug, r.shopper);
    assert pg_temp.helper_opens(case when r.slug like 'taladro%' then 'sendero@yuntera.example'
                                     else 'vendedor@yuntera.example' end, r.slug) = r.other_shop,
      format('helper: another shop and %s should be %s', r.slug, r.other_shop);
    assert pg_temp.helper_opens(case when r.slug like 'taladro%' then 'vendedor@yuntera.example'
                                     else 'sendero@yuntera.example' end, r.slug) = r.own_shop,
      format('helper: its own shop and %s should be %s', r.slug, r.own_shop);
    assert pg_temp.helper_opens('central@yuntera.example', r.slug) = r.staff,
      format('helper: staff and %s should be %s', r.slug, r.staff);
  end loop;
end
$$;

-- Through the shop's own calls, as each viewer.
select pg_temp.login_anon();
do $$
declare
  v_slug text;
begin
  foreach v_slug in array array['botella-termica-sendero-750ml', 'balon-futbol-sendero-5',
                                'rompecabezas-volcanes-500', 'camiseta-algodon-sendero',
                                'taladro-inalambrico-roble-20v'] loop
    assert public.get_product(v_slug) is null, format('visitor: %s opens', v_slug);
    assert not public.shop_path_exists('product', v_slug), format('visitor: %s has an address', v_slug);
  end loop;
  assert public.get_product('libreta-tapa-dura-a5') ->> 'slug' = 'libreta-tapa-dura-a5',
    'visitor: a product in a hidden category no longer opens';
  assert public.shop_path_exists('product', 'libreta-tapa-dura-a5'),
    'visitor: a product in a hidden category lost its address';
  assert public.get_product('hamaca-algodon-doble') is not null, 'visitor: a product on sale does not open';
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$ begin
  assert public.get_product('botella-termica-sendero-750ml') is null, 'shopper: a draft opens';
  assert public.get_product('camiseta-algodon-sendero') is null, 'shopper: a taken-down product opens';
  assert public.get_product('libreta-tapa-dura-a5') is not null, 'shopper: the hidden category''s product';
end $$;
reset role;
select pg_temp.login('vendedor@yuntera.example');
do $$ begin
  assert public.get_product('botella-termica-sendero-750ml') is null, 'another shop: a draft opens';
  assert public.get_product('balon-futbol-sendero-5') is null, 'another shop: a listing in review opens';
  -- Its own closed shop's drill is still its own to look at.
  assert public.get_product('taladro-inalambrico-roble-20v') is not null, 'own closed shop: the drill';
end $$;
reset role;
select pg_temp.login('sendero@yuntera.example');
do $$
declare
  v_slug text;
begin
  -- The seller's preview of its own listings, whatever their status.
  foreach v_slug in array array['botella-termica-sendero-750ml', 'balon-futbol-sendero-5',
                                'rompecabezas-volcanes-500', 'camiseta-algodon-sendero'] loop
    assert public.get_product(v_slug) ->> 'slug' = v_slug, format('own shop: %s does not open', v_slug);
    -- Its address in the shop is still only for what is on sale.
    assert not public.shop_path_exists('product', v_slug), format('own shop: %s has a shop address', v_slug);
  end loop;
end
$$;
reset role;
select pg_temp.login('central@yuntera.example');
do $$ begin
  assert public.get_product('camiseta-algodon-sendero') ->> 'slug' = 'camiseta-algodon-sendero',
    'staff: a taken-down product does not open';
  assert public.get_product('rompecabezas-volcanes-500') is not null, 'staff: an archived product';
end $$;
reset role;

-- The fixtures go back as they were (the transaction rolls back anyway; the
-- brand section below needs the shop open again).
update public.sellers set status = 'active' where slug = 'ferreteria-el-higueron';
update public.categories set active = true where slug = 'libros';

-- ═══ 2. Deleting a brand ═══════════════════════════════════════════════════

-- The suite's own brands, so a used database's demo brands are never touched:
-- Sin Uso (nobody names it), Fusionada (merged into Sin Uso), En Uso (named
-- by an archived product only) and Con Varios (two products).
insert into public.brands (name, slug, former_slugs)
values ('Marca Sin Uso', 'marca-sin-uso', '{marca-sin-uso-vieja}'),
       ('Marca Fusionada', 'marca-fusionada', '{}'),
       ('Marca En Uso', 'marca-en-uso', '{}'),
       ('Marca Con Varios', 'marca-con-varios', '{}');
update public.brands
set active = false, merged_into_id = (select id from public.brands where slug = 'marca-sin-uso'),
    merged_at = now()
where slug = 'marca-fusionada';
update public.products set brand_id = (select id from public.brands where slug = 'marca-en-uso')
where slug = 'rompecabezas-volcanes-500';
update public.products set brand_id = (select id from public.brands where slug = 'marca-con-varios')
where slug in ('libreta-tapa-dura-a5', 'botella-termica-sendero-750ml');
select pg_temp.remember('sin_uso', (select id::text from public.brands where slug = 'marca-sin-uso'));
select pg_temp.remember('fusionada', (select id::text from public.brands where slug = 'marca-fusionada'));
select pg_temp.remember('en_uso', (select id::text from public.brands where slug = 'marca-en-uso'));
select pg_temp.remember('con_varios', (select id::text from public.brands where slug = 'marca-con-varios'));
select pg_temp.remember('audit_from', (select coalesce(max(id), 0)::text from private.audit_log));

-- Wrong callers.
select pg_temp.login_anon();
do $$ begin
  perform public.ops_delete_brand(current_setting('t.sin_uso')::uuid);
  raise exception 'a visitor deleted a brand';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.login('comprador@yuntera.example');
select pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')), 'forbidden');
reset role;
select pg_temp.login('vendedor@yuntera.example');
select pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')), 'forbidden');
reset role;
select pg_temp.login('repartidor@yuntera.example');
select pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')), 'forbidden');
reset role;
select pg_temp.login('bodega@yuntera.example');
select pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')), 'forbidden');
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')), 'forbidden');
reset role;
select pg_temp.staff_as('finance');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')), 'forbidden');
reset role;
select pg_temp.staff_as('ops');
select pg_temp.login('comprador3@yuntera.example');
select pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')), 'forbidden');
select pg_temp.refused('select public.ops_catalog_brands()', 'forbidden');
reset role;
do $$ begin
  assert (select count(*) from public.brands
          where id in (current_setting('t.sin_uso')::uuid, current_setting('t.fusionada')::uuid)) = 2,
    'wrong callers: a brand went';
end $$;

-- Catalogue staff.
select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
do $$
declare
  v jsonb;
  v_list jsonb := public.ops_catalog_brands();
begin
  -- What the console shows: every status counted, and where the action works.
  v := (select x from jsonb_array_elements(v_list) x where x ->> 'slug' = 'marca-en-uso');
  assert (v ->> 'product_count')::int = 0 and (v ->> 'all_product_count')::int = 1
         and not (v ->> 'deletable')::boolean, format('list: an archived product still counts: %s', v);
  v := (select x from jsonb_array_elements(v_list) x where x ->> 'slug' = 'marca-sin-uso');
  assert (v ->> 'all_product_count')::int = 0 and (v ->> 'deletable')::boolean,
    format('list: an unused brand is not deletable: %s', v);
  v := (select x from jsonb_array_elements(v_list) x where x ->> 'slug' = 'marca-fusionada');
  assert not (v ->> 'deletable')::boolean, format('list: a merged brand is deletable: %s', v);

  -- In use, in any status: refused with the number of products.
  perform pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.en_uso')),
                          'brand_in_use', '1');
  perform pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.con_varios')),
                          'brand_in_use', '2');
  -- A brand merged away goes only with the brand it went into.
  perform pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.fusionada')),
                          'brand_merged');
  perform pg_temp.refused(format('select public.ops_delete_brand(%L)', gen_random_uuid()), 'brand_not_found');
  perform pg_temp.refused('select public.ops_delete_brand(null)', 'brand_not_found');

  v := public.ops_delete_brand(current_setting('t.sin_uso')::uuid);
  assert v ->> 'slug' = 'marca-sin-uso' and (v ->> 'merged_removed')::int = 1, format('deleted: %s', v);
  perform pg_temp.refused(format('select public.ops_delete_brand(%L)', current_setting('t.sin_uso')),
                          'brand_not_found');
  -- Its addresses, its earlier one and the merged brand's are free again.
  v := public.ops_create_brand('Marca Sin Uso', 'marca-sin-uso');
  assert v ->> 'slug' = 'marca-sin-uso', format('the address is not free: %s', v);
  v := public.ops_create_brand('Otra Marca Vieja', 'marca-sin-uso-vieja');
  assert v ->> 'slug' = 'marca-sin-uso-vieja', format('the earlier address is not free: %s', v);
  v := public.ops_create_brand('Marca Fusionada', 'marca-fusionada');
  assert v ->> 'slug' = 'marca-fusionada', format('the merged brand''s address is not free: %s', v);
end
$$;
reset role;

-- What is left behind: the rows are gone, the products untouched, an audit
-- entry by the member of staff without free text from anyone else.
do $$
declare
  a record;
begin
  assert not exists (select 1 from public.brands
                     where id in (current_setting('t.sin_uso')::uuid, current_setting('t.fusionada')::uuid)),
    'left behind: the brands are still there';
  assert (select brand_id from public.products where slug = 'rompecabezas-volcanes-500')
         = current_setting('t.en_uso')::uuid, 'left behind: the brand in use lost its product';
  assert (select count(*) from public.products where brand_id = current_setting('t.con_varios')::uuid) = 2,
    'left behind: the brand with two products lost one';
  assert not exists (select 1 from public.products p
                     where p.brand_id is not null
                       and not exists (select 1 from public.brands b where b.id = p.brand_id)),
    'left behind: a product names a brand that does not exist';
  select * into a from private.audit_log
  where id > current_setting('t.audit_from')::bigint and action = 'DELETE' and table_name = 'brands'
    and row_key = current_setting('t.sin_uso') and new_row is null and old_row ? 'merged_brands'
  order by id desc limit 1;
  assert a.id is not null, 'left behind: no audit entry for the deletion';
  assert a.actor_id = (select id from auth.users where email = 'comprador3@yuntera.example'),
    'left behind: the audit entry does not name who deleted it';
  assert a.old_row ->> 'slug' = 'marca-sin-uso'
         and a.old_row -> 'former_slugs' = '["marca-sin-uso-vieja"]'::jsonb
         and a.old_row -> 'merged_brands' = '["Marca Fusionada"]'::jsonb,
    format('left behind: the audit entry %s', a.old_row);
end
$$;

-- An administrator may too; a correction cannot give a brand that is gone,
-- and a brand a correction gave is in use.
select pg_temp.remember('hamaca', (select id::text from public.products where slug = 'hamaca-algodon-doble'));
select pg_temp.login('central@yuntera.example');
do $$
declare
  v_brand uuid := (public.ops_create_brand('Marca Pasajera', 'marca-pasajera') ->> 'id')::uuid;
  v_product uuid := current_setting('t.hamaca')::uuid;
  v jsonb;
begin
  perform public.ops_correct_product(v_product, null, v_brand, false, 'La marca correcta es otra.');
  perform pg_temp.refused(format('select public.ops_delete_brand(%L)', v_brand), 'brand_in_use', '1');
  perform public.ops_correct_product(v_product, null, null, true, 'La hamaca no tiene marca.');
  v := public.ops_delete_brand(v_brand);
  assert (v ->> 'merged_removed')::int = 0, format('admin: deleted %s', v);
  perform pg_temp.refused(
    format($q$select public.ops_correct_product(%L, null, %L, false, 'La marca correcta es otra.')$q$,
           v_product, v_brand),
    'brand_not_found');
end
$$;
reset role;

select 'ok' as catalogue_followups;
rollback;
