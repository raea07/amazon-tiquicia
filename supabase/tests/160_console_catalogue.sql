-- Staff catalogue tools (20261121083700_console_catalogue.sql): categories,
-- brands, search synonyms, review moderation and staff corrections to a
-- product. For each: the right caller gets what they asked for, every wrong
-- caller is refused, and what the function leaves behind is what the shop,
-- the seller, the author and the audit log should see.
--
-- Who plays whom: central is an administrator (catalogue staff included);
-- comprador3 is given one other staff role at a time; comprador is a shopper.

begin;
\ir _helpers.sql

create function pg_temp.refused(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'not refused: %', p_sql;
exception when others then
  if sqlerrm <> p_code then
    raise exception 'expected % but got "%" for: %', p_code, sqlerrm, p_sql;
  end if;
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

-- Every function named, called with nulls: each must refuse with `p_code`.
create function pg_temp.each_refused(p_functions text[], p_code text) returns integer
language plpgsql as $$
declare
  f record;
  v_args text;
  v_count integer := 0;
begin
  for f in
    select p.proname, p.proargtypes, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (p_functions)
    order by p.proname
  loop
    select string_agg(format('null::%s', format_type(f.proargtypes[i], null)), ', ' order by i)
    into v_args from generate_series(0, f.pronargs - 1) i;
    begin
      execute format('select public.%I(%s)', f.proname, coalesce(v_args, ''));
      raise exception 'answered: %', f.proname;
    exception when others then
      if sqlerrm <> p_code then
        raise exception '% gave "%" (expected %)', f.proname, sqlerrm, p_code;
      end if;
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The messages a staff change plans, as the notification worker would plan them.
create function pg_temp.planned_for(p_topic text, p_since bigint) returns jsonb
language plpgsql as $$
declare
  e private.outbox_events;
  v jsonb := '[]';
begin
  for e in select * from private.outbox_events where topic = p_topic and id > p_since order by id loop
    perform private.notify_plan_event(e);
    v := v || coalesce((select jsonb_agg(jsonb_build_object('template', d.template, 'channel', d.channel,
                                                            'recipient', d.recipient, 'context', d.context)
                                         order by d.channel)
                        from private.notification_deliveries d where d.event_id = e.id), '[]');
  end loop;
  return v;
end;
$$;

create function pg_temp.staff_as(p_role public.staff_role) returns void
language sql as $$
  delete from public.staff_members
  where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');
  insert into public.staff_members (user_id, role)
  select id, p_role from auth.users where email = 'comprador3@yuntera.example';
$$;

do $$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end
$$;
grant execute on function pg_temp.refused(text, text), pg_temp.denied(text),
  pg_temp.each_refused(text[], text), pg_temp.remember(text, text) to authenticated, anon;

select pg_temp.remember('central', (select id::text from auth.users where email = 'central@yuntera.example'));
select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('licuadora', (select id::text from public.products where slug = 'licuadora-volcan-600w'));
select pg_temp.remember('hamaca', (select id::text from public.products where slug = 'hamaca-algodon-doble'));
select pg_temp.remember('molido', (select id::text from public.products where slug = 'cafe-molido-tarrazu-340g'));
select pg_temp.remember('review', (
  select r.id::text from public.reviews r
  join public.order_items i on i.id = r.order_item_id
  join public.orders o on o.id = i.order_id
  where o.order_number = 'YT-100004' and r.product_id = current_setting('t.molido')::uuid));
select pg_temp.remember('events_from', (select coalesce(max(id), 0)::text from private.outbox_events));
select pg_temp.remember('audit_from', (select coalesce(max(id), 0)::text from private.audit_log));

-- ═══ 1. Who may call what ══════════════════════════════════════════════════

create temporary table staff_functions (fn text) on commit drop;
insert into staff_functions select unnest(array[
  'ops_catalog_categories', 'ops_create_category', 'ops_update_category', 'ops_move_category',
  'ops_shift_category', 'ops_set_category_active', 'ops_delete_category', 'ops_catalog_brands',
  'ops_create_brand', 'ops_update_brand', 'ops_set_brand_active', 'ops_merge_brands',
  'ops_search_synonyms', 'ops_add_search_synonym', 'ops_remove_search_synonym', 'ops_search_preview',
  'ops_reviews', 'ops_hide_review', 'ops_show_review', 'ops_hide_review_reply', 'ops_show_review_reply',
  'ops_catalog_product', 'ops_correct_product', 'ops_take_down_product', 'ops_restore_product']);
grant select on pg_temp.staff_functions to authenticated, anon;

-- Every one of them exists, is owner's-rights, and only signed-in users may call it.
do $$
declare
  v_missing text;
begin
  select string_agg(f.fn, ', ') into v_missing from pg_temp.staff_functions f
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f.fn and p.prosecdef
                      and has_function_privilege('authenticated', p.oid, 'execute')
                      and not has_function_privilege('anon', p.oid, 'execute'));
  assert v_missing is null, format('who_may_call: not a staff function as documented: %s', v_missing);
end
$$;

-- A visitor cannot even call them.
select pg_temp.login_anon();
select pg_temp.denied('select public.ops_catalog_categories()');
select pg_temp.denied('select public.ops_reviews()');
select pg_temp.denied($q$select public.my_order_reviews('YT-100004')$q$);
reset role;

-- A shopper, and staff of every role but catalogue, are refused all of them.
select pg_temp.login('comprador@yuntera.example');
do $$
begin
  assert pg_temp.each_refused(array(select fn from pg_temp.staff_functions), 'forbidden') = 25,
    'who_may_call: a shopper';
end
$$;
reset role;
select pg_temp.staff_as('support');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.staff_functions), 'forbidden') = 25,
    'who_may_call: support';
end $$;
reset role;
select pg_temp.staff_as('finance');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.staff_functions), 'forbidden') = 25,
    'who_may_call: finance';
end $$;
reset role;
select pg_temp.staff_as('ops');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.staff_functions), 'forbidden') = 25,
    'who_may_call: operations';
end $$;
reset role;

-- Catalogue staff may; and once the second factor is required, only after it.
select pg_temp.staff_as('catalog');
select pg_temp.login('comprador3@yuntera.example');
do $$ begin
  assert jsonb_array_length(public.ops_catalog_categories()) > 20, 'who_may_call: catalogue staff read the tree';
end $$;
reset role;
update public.app_settings set value = 'true' where key = 'require_staff_mfa';
select pg_temp.login('comprador3@yuntera.example', 'aal1');
do $$ begin
  assert pg_temp.each_refused(array(select fn from pg_temp.staff_functions), 'forbidden') = 25,
    'who_may_call: catalogue staff without the second factor, when it is required';
end $$;
reset role;
select pg_temp.login('comprador3@yuntera.example', 'aal2');
do $$ begin
  assert jsonb_array_length(public.ops_catalog_brands()) > 5, 'who_may_call: and with it';
end $$;
reset role;
update public.app_settings set value = 'false' where key = 'require_staff_mfa';
delete from public.staff_members
where user_id = (select id from auth.users where email = 'comprador3@yuntera.example');

-- The per-request check: none of the new functions is on its short list, so a
-- password-only session of an account with a factor is refused before any of
-- them runs (110_lockdown walks every function; this names ours).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), u.id, 'x', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'
from auth.users u where u.email = 'central@yuntera.example';
select pg_temp.login('central@yuntera.example', 'aal1');
do $$
declare
  v_fn text;
begin
  for v_fn in select fn from pg_temp.staff_functions union all select 'my_order_reviews' loop
    perform set_config('request.path', '/rpc/' || v_fn, true);
    begin
      perform public.check_request();
      raise exception 'before_second_step: % passed the check at aal1', v_fn;
    exception when others then
      if sqlerrm <> 'second_factor_required' then raise; end if;
    end;
  end loop;
end
$$;
reset role;
delete from auth.mfa_factors where friendly_name = 'x'
  and user_id = current_setting('t.central')::uuid;
-- The visitor functions answer a visitor: the check returns at once.
select pg_temp.login_anon();
do $$ begin
  perform set_config('request.path', '/rpc/list_brands', true);
  perform public.check_request();
  perform set_config('request.path', '/rpc/category_redirect', true);
  perform public.check_request();
end $$;
reset role;

-- ═══ 2. Categories ═════════════════════════════════════════════════════════

-- From here on, the suite reads what the functions left behind while signed
-- in (a SELECT grant inside this rolled-back transaction; see _helpers.sql).
select pg_temp.allow_inspection();

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v jsonb;
  v_dept uuid;
  v_child uuid;
  v_grand uuid;
begin
  -- Created from a name: the address is made from it, accents and all.
  v := public.ops_create_category('Café de especialidad');
  v_dept := (v ->> 'id')::uuid;
  assert v ->> 'slug' = 'cafe-de-especialidad', format('categories: slug from the name %s', v);
  perform pg_temp.remember('dept', v_dept::text);

  -- What is refused.
  perform pg_temp.refused($q$select public.ops_create_category('Otra', null, 'cafe-de-especialidad')$q$,
                          'category_slug_taken');
  perform pg_temp.refused($q$select public.ops_create_category('Buscar')$q$, 'category_slug_reserved');
  perform pg_temp.refused($q$select public.ops_create_category('Mal', null, 'Con Espacios')$q$,
                          'category_slug_invalid');
  perform pg_temp.refused($q$select public.ops_create_category('x')$q$, 'category_name_invalid');
  perform pg_temp.refused($q$select public.ops_create_category('   ')$q$, 'category_name_invalid');
  perform pg_temp.refused($q$select public.ops_create_category('CAFÉ DE ESPECIALIDAD', null, 'otra-direccion')$q$,
                          'category_name_taken');
  perform pg_temp.refused(format($q$select public.ops_create_category('Hija', null, null, %L)$q$,
                                 gen_random_uuid()), 'category_not_found');

  -- Three levels at most.
  v_child := (public.ops_create_category('Granos', null, null, v_dept) ->> 'id')::uuid;
  v_grand := (public.ops_create_category('Geisha', null, null, v_child) ->> 'id')::uuid;
  perform pg_temp.refused(format($q$select public.ops_create_category('Más hondo', null, null, %L)$q$, v_grand),
                          'category_too_deep');
  perform pg_temp.remember('child', v_child::text);
  perform pg_temp.remember('grand', v_grand::text);

  -- No loops, no going too deep by a move either.
  perform pg_temp.refused(format('select public.ops_move_category(%L, %L)', v_dept, v_grand), 'category_cycle');
  perform pg_temp.refused(format('select public.ops_move_category(%L, %L)', v_dept, v_dept), 'category_cycle');
  perform pg_temp.refused(format('select public.ops_move_category(%L, %L)', v_dept,
                                 (select id from public.categories where slug = 'cafe')), 'category_too_deep');
  perform pg_temp.refused(format('select public.ops_move_category(%L, null)', v_dept), 'category_unchanged');

  -- The tree staff see has it, with its products, commission and depth.
  v := (select x from jsonb_array_elements(public.ops_catalog_categories()) x where x ->> 'id' = v_dept::text);
  assert (v ->> 'depth')::int = 1 and (v ->> 'child_count')::int = 1 and (v ->> 'visible')::boolean
     and (v ->> 'referral_bps')::int = 1200 and not (v ->> 'own_referral')::boolean
     and (v ->> 'product_count')::int = 0, format('categories: staff tree row %s', v);
end
$$;
reset role;

-- The shop shows the new department and its address.
select pg_temp.login_anon();
do $$ begin
  assert exists (select 1 from public.list_categories() where slug = 'cafe-de-especialidad' and parent_slug is null),
    'categories: a visitor sees the new department';
  assert public.shop_path_exists('category', 'cafe-de-especialidad'), 'categories: its address exists';
end $$;
reset role;

-- Audit: the creations, by whom.
do $$ begin
  assert (select count(*) from private.audit_log
          where id > current_setting('t.audit_from')::bigint and table_name = 'categories'
            and action = 'INSERT' and actor_id = current_setting('t.central')::uuid) = 3,
    'categories: each creation is in the audit log, with who did it';
end $$;

-- Moves, order among siblings, renames.
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v_dept uuid := current_setting('t.dept')::uuid;
  v_abarrotes uuid := (select id from public.categories where slug = 'abarrotes');
  v_audio uuid := (select id from public.categories where slug = 'audio');
  v_electronica uuid := (select id from public.categories where slug = 'electronica');
  v_first text;
  v jsonb;
begin
  -- The empty department moves under Abarrotes (it has no listed product, so
  -- no commission changes), as the last of its new siblings.
  perform pg_temp.refused(format('select public.ops_move_category(%L, %L)', v_dept, v_abarrotes),
                          'category_too_deep'); -- it has two levels under it
  perform public.ops_delete_category(current_setting('t.grand')::uuid);
  perform public.ops_move_category(v_dept, v_abarrotes);
  assert (select parent_id from public.categories where id = v_dept) = v_abarrotes, 'categories: moved';
  assert (select sort from public.categories where id = v_dept)
       = (select max(sort) from public.categories where parent_id = v_abarrotes), 'categories: last among siblings';

  -- Audio has listed products at 8 %; under Hogar they would pay 12 %: refused,
  -- and nothing moved. Under Computación (8 %) it may go.
  perform pg_temp.refused(format('select public.ops_move_category(%L, %L)', v_audio,
                                 (select id from public.categories where slug = 'hogar')),
                          'category_move_changes_fees');
  assert (select parent_id from public.categories where id = v_audio) = v_electronica,
    'categories: a refused move leaves the category where it was';
  perform public.ops_move_category(v_audio, (select id from public.categories where slug = 'computacion'));
  perform public.ops_move_category(v_audio, v_electronica);

  -- Up and down among siblings: a swap.
  select slug into v_first from public.categories where parent_id = v_electronica order by sort, slug limit 1;
  perform public.ops_shift_category(
    (select id from public.categories where parent_id = v_electronica order by sort, slug offset 1 limit 1), -1);
  assert (select slug from public.categories where parent_id = v_electronica order by sort, slug offset 1 limit 1)
       = v_first, 'categories: moved up one place';
  perform pg_temp.refused(format('select public.ops_shift_category(%L, -1)',
    (select id from public.categories where parent_id = v_electronica order by sort, slug limit 1)), 'category_at_edge');
  perform pg_temp.refused(format('select public.ops_shift_category(%L, 5)', v_audio), 'category_unchanged');

  -- A rename of the address keeps the old one as an alias.
  v := public.ops_update_category(v_dept, 'Café de especialidad', null, 'cafes-especiales');
  assert v ->> 'previous_slug' = 'cafe-de-especialidad', format('categories: rename %s', v);
  perform pg_temp.refused(format($q$select public.ops_update_category(%L, null, null, 'hogar')$q$, v_dept),
                          'category_slug_taken');
  perform pg_temp.refused(format($q$select public.ops_update_category(%L, null, null, 'cafe-de-especialidad')$q$,
                                 v_audio), 'category_slug_taken'); -- another category's old address
  perform pg_temp.refused(format($q$select public.ops_update_category(%L, 'Café de especialidad')$q$, v_dept),
                          'category_unchanged');
  perform pg_temp.refused(format($q$select public.ops_update_category(%L, 'Café')$q$, v_dept),
                          'category_name_taken'); -- Abarrotes already has "Café"
end
$$;
reset role;

select pg_temp.login_anon();
do $$ begin
  assert public.category_redirect('cafe-de-especialidad') = 'cafes-especiales', 'categories: the old address redirects';
  assert not public.shop_path_exists('category', 'cafe-de-especialidad'), 'categories: and is no longer a page';
  assert public.shop_path_exists('category', 'cafes-especiales'), 'categories: the new one is';
  assert public.category_redirect('hogar') is null and public.category_redirect('no-existe') is null,
    'categories: a live or unknown address is not redirected';
  assert exists (select 1 from public.list_categories() where slug = 'cafes-especiales' and parent_slug = 'abarrotes'),
    'categories: the menu shows it under its new parent';
end $$;
reset role;

-- Back to an address it had before: allowed, and that address is live again.
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v_dept uuid := current_setting('t.dept')::uuid;
begin
  perform public.ops_update_category(v_dept, null, null, 'cafe-de-especialidad');
  assert (select slug from public.categories where id = v_dept) = 'cafe-de-especialidad', 'categories: back';
  assert (select array_agg(slug) from public.category_slug_aliases where category_id = v_dept) = '{cafes-especiales}',
    'categories: the address it left is the alias now';
  assert public.category_redirect('cafes-especiales') = 'cafe-de-especialidad', 'categories: and redirects';

  -- A new name for a category puts it in its products' search documents.
  perform public.ops_update_category((select id from public.categories where slug = 'descanso'), 'Hamacas y siestas');
end
$$;
reset role;
select pg_temp.login_anon();
do $$ begin
  assert exists (select 1 from public.search_products('siestas') where slug = 'hamaca-algodon-doble'),
    'categories: a renamed category is found by its new name';
end $$;
reset role;

-- Hiding: out of the menus and pages, with everything under it; its products
-- stay on sale, in search and at their own address.
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_set_category_active((select id from public.categories where slug = 'descanso'), false);
select pg_temp.refused(format('select public.ops_set_category_active(%L, false)',
  (select id from public.categories where slug = 'descanso')), 'category_unchanged');
reset role;
select pg_temp.login_anon();
do $$
declare
  v jsonb;
begin
  assert not exists (select 1 from public.list_categories() where slug = 'descanso'), 'hidden: not in the menu';
  assert not public.shop_path_exists('category', 'descanso'), 'hidden: no category page';
  assert exists (select 1 from public.search_products('hamaca') where slug = 'hamaca-algodon-doble'),
    'hidden: its product is still found';
  assert public.shop_path_exists('product', 'hamaca-algodon-doble'), 'hidden: and has its page';
  v := public.get_product('hamaca-algodon-doble');
  assert v is not null and v -> 'breadcrumbs' = '[{"slug": "hogar", "name_es": "Hogar y cocina", "name_en": "Home & kitchen"}]',
    format('hidden: breadcrumbs show only what shows: %s', v -> 'breadcrumbs');
end
$$;
reset role;
-- A hidden department takes its sub-categories with it.
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_set_category_active((select id from public.categories where slug = 'hogar'), false);
reset role;
select pg_temp.login_anon();
do $$ begin
  assert not exists (select 1 from public.list_categories() where slug in ('hogar', 'cocina')),
    'hidden: a hidden department hides what is under it';
  assert not public.shop_path_exists('category', 'cocina'), 'hidden: and their pages';
  assert exists (select 1 from public.search_products('tabla de picar') where slug = 'tabla-picar-teca'),
    'hidden: their products are still found';
  assert (select count(*) from public.list_brands('hogar')) >= 0, 'hidden: the brand list still answers';
end $$;
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_set_category_active((select id from public.categories where slug = 'hogar'), true);
select public.ops_set_category_active((select id from public.categories where slug = 'descanso'), true);
reset role;
select pg_temp.login_anon();
do $$ begin
  assert public.shop_path_exists('category', 'descanso'), 'shown again';
end $$;
reset role;

-- Deleting: only what nothing uses.
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v_dept uuid := current_setting('t.dept')::uuid;
begin
  perform pg_temp.refused(format('select public.ops_delete_category(%L)',
                                 (select id from public.categories where slug = 'descanso')), 'category_in_use');
  perform pg_temp.refused(format('select public.ops_delete_category(%L)', v_dept), 'category_has_children');
  perform public.ops_delete_category(current_setting('t.child')::uuid);
  perform public.ops_delete_category(v_dept);
  assert not exists (select 1 from public.categories where id = v_dept), 'deleted';
  assert not exists (select 1 from public.category_slug_aliases where category_id = v_dept), 'with its old addresses';
end
$$;
reset role;
do $$ begin
  assert exists (select 1 from private.audit_log where id > current_setting('t.audit_from')::bigint
                   and table_name = 'categories' and action = 'DELETE'
                   and row_key = current_setting('t.dept')), 'categories: the deletion is in the audit log';
  assert exists (select 1 from private.audit_log where id > current_setting('t.audit_from')::bigint
                   and table_name = 'categories' and action = 'UPDATE'
                   and old_row ->> 'active' = 'true' and new_row ->> 'active' = 'false'), 'categories: so is hiding';
end $$;

-- ═══ 3. Brands ═════════════════════════════════════════════════════════════

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v jsonb;
  v_luma uuid := (select id from public.brands where slug = 'luma');
  v_volcan uuid := (select id from public.brands where slug = 'volcan');
begin
  v := public.ops_create_brand('Ceiba Juguetes');
  assert v ->> 'slug' = 'ceiba-juguetes', format('brands: created %s', v);
  perform pg_temp.refused($q$select public.ops_create_brand('NIMBO')$q$, 'brand_name_taken');
  perform pg_temp.refused($q$select public.ops_create_brand('Volcan')$q$, 'brand_name_taken'); -- accents ignored
  perform pg_temp.refused($q$select public.ops_create_brand('Otra', 'nimbo')$q$, 'brand_slug_taken');
  perform pg_temp.refused($q$select public.ops_create_brand('Otra', 'Con Espacios')$q$, 'brand_slug_invalid');
  perform pg_temp.refused($q$select public.ops_create_brand('x')$q$, 'brand_name_invalid');

  -- A rename keeps the old name for search.
  v := public.ops_update_brand((select id from public.brands where slug = 'roble'), 'Roble Herramientas');
  assert (select aliases from public.brands where slug = 'roble') = '{Roble}', 'brands: the old name is an alias';
  perform pg_temp.refused(format($q$select public.ops_update_brand(%L, 'Roble Herramientas')$q$,
                                 (select id from public.brands where slug = 'roble')), 'brand_unchanged');

  -- A merge: products move, the old name and address still find them.
  perform pg_temp.refused(format('select public.ops_merge_brands(%L, %L)', v_luma, v_luma), 'brand_merge_same');
  v := public.ops_merge_brands(v_luma, v_volcan);
  assert (v ->> 'moved')::int = 1, format('brands: merged %s', v);
  assert (select brand_id from public.products where slug = 'bombillo-led-9w-4u') = v_volcan, 'brands: product moved';
  assert (select merged_into_id = v_volcan and not active from public.brands where id = v_luma), 'brands: old one points on';
  perform pg_temp.refused(format('select public.ops_merge_brands(%L, %L)', v_luma, v_volcan), 'brand_merged');
  perform pg_temp.refused(format('select public.ops_merge_brands(%L, %L)', v_volcan, v_luma), 'brand_merged');
  perform pg_temp.refused(format($q$select public.ops_update_brand(%L, 'Luma 2')$q$, v_luma), 'brand_merged');
  perform pg_temp.refused($q$select public.ops_create_brand('Luma')$q$, 'brand_name_taken');
  v := (select x from jsonb_array_elements(public.ops_catalog_brands()) x where x ->> 'slug' = 'luma');
  assert v -> 'merged_into' ->> 'slug' = 'volcan' and (v ->> 'product_count')::int = 0,
    format('brands: staff see the merge %s', v);

  -- Hidden from the filter; the product keeps its brand.
  perform public.ops_set_brand_active((select id from public.brands where slug = 'tinamu'), false);
  perform pg_temp.refused(format('select public.ops_set_brand_active(%L, false)',
                                 (select id from public.brands where slug = 'tinamu')), 'brand_unchanged');
end
$$;
reset role;

select pg_temp.remember('volcan_active', (
  select count(*)::text from public.products p join public.brands b on b.id = p.brand_id
  where b.slug = 'volcan' and p.status = 'active'));
select pg_temp.login_anon();
do $$ begin
  assert exists (select 1 from public.search_products('luma') where slug = 'bombillo-led-9w-4u'),
    'brands: the merged brand''s name still finds its product';
  assert exists (select 1 from public.search_products('roble') where slug = 'taladro-inalambrico-roble-20v'),
    'brands: so does a renamed brand''s old name';
  assert exists (select 1 from public.search_products(p_brand_slug => 'luma') where slug = 'bombillo-led-9w-4u')
     and exists (select 1 from public.search_products(p_brand_slug => 'luma') where slug = 'licuadora-volcan-600w'),
    'brands: the old brand''s filter address shows the brand it went into';
  assert (select count(*) from public.search_products(p_brand_slug => 'volcan'))
       = current_setting('t.volcan_active')::bigint, 'brands: the filter finds exactly the brand';
  assert not exists (select 1 from public.list_brands() where slug in ('luma', 'tinamu')),
    'brands: merged and hidden brands are not offered as a filter';
  assert exists (select 1 from public.list_brands() where slug = 'volcan' and product_count = 5),
    'brands: the filter counts the products';
  assert (select array_agg(slug order by slug) from public.list_brands('cafe')) = '{cafetal-los-santos}',
    'brands: in a category, only its brands';
  assert public.get_product('alimento-perro-adulto-tinamu-8kg') ->> 'brand' = 'Tinamú',
    'brands: a hidden brand still names its products';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from private.audit_log where id > current_setting('t.audit_from')::bigint
                   and table_name = 'brands' and action = 'MERGE'), 'brands: the merge is in the audit log';
  assert exists (select 1 from private.audit_log where id > current_setting('t.audit_from')::bigint
                   and table_name = 'brands' and action = 'INSERT'
                   and actor_id = current_setting('t.central')::uuid), 'brands: so is a new brand';
end $$;

-- ═══ 4. Search synonyms ════════════════════════════════════════════════════

select pg_temp.login_anon();
do $$ begin
  assert not exists (select 1 from public.search_products('pichinga')), 'synonyms: nothing before';
end $$;
reset role;

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v jsonb;
begin
  -- Stored the way search reads it.
  v := public.ops_add_search_synonym('  PICHINGÁ ', array[' Botella   Térmica ']);
  assert v = '{"term": "pichinga", "expansions": ["botella termica"]}', format('synonyms: normalised %s', v);
  perform pg_temp.refused($q$select public.ops_add_search_synonym('Pichinga', array['termo'])$q$, 'synonym_exists');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('', array['termo'])$q$, 'synonym_invalid');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('a', array['termo'])$q$, 'synonym_invalid');
  perform pg_temp.refused($q$select public.ops_add_search_synonym(repeat('palabra', 10), array['termo'])$q$,
                          'synonym_invalid');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('termito', array[]::text[])$q$, 'synonym_invalid');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('termito', array['   '])$q$, 'synonym_invalid');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('termito', array['termo', 'TERMO'])$q$,
                          'synonym_duplicate');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('termito', array['termito'])$q$,
                          'synonym_duplicate');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('termito',
                             array['a1','b2','c3','d4','e5','f6','g7','h8','i9'])$q$, 'synonym_too_many');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('de', array['termo'])$q$, 'synonym_too_common');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('termito', array['de la'])$q$,
                          'synonym_too_common');
  perform pg_temp.refused($q$select public.ops_add_search_synonym('termo; drop', array['x1'])$q$, 'synonym_invalid');

  v := public.ops_search_preview('Pichinga');
  assert v ->> 'query' = 'pichinga' and (v ->> 'total')::int >= 1
     and v -> 'results' @> '[{"slug": "botella-termica-sendero-750ml"}]'
     and v -> 'synonyms' = '[{"term": "pichinga", "expansions": ["botella termica"]}]',
    format('synonyms: the preview shows what it finds and why %s', v);
  perform pg_temp.refused($q$select public.ops_search_preview('   ')$q$, 'synonym_invalid');
  assert jsonb_array_length(public.ops_search_synonyms()) = (select count(*) from public.search_synonyms),
    'synonyms: staff see them all';
end
$$;
reset role;

select pg_temp.login_anon();
do $$ begin
  assert exists (select 1 from public.search_products('pichinga') where slug = 'botella-termica-sendero-750ml'),
    'synonyms: a visitor''s search finds the product once the synonym exists';
  assert exists (select 1 from public.search_products('una pichinga grande') where slug = 'botella-termica-sendero-750ml'),
    'synonyms: also as one word of a longer query';
end $$;
reset role;

-- Something nearly every listing has is refused as an expansion.
update public.products set description = coalesce(description, '') || ' universal' where status = 'active';
select pg_temp.login('central@yuntera.example', 'aal2');
select pg_temp.refused($q$select public.ops_add_search_synonym('termito', array['universal'])$q$, 'synonym_too_common');
select public.ops_remove_search_synonym('PICHINGA');
select pg_temp.refused($q$select public.ops_remove_search_synonym('pichinga')$q$, 'synonym_not_found');
reset role;
select pg_temp.login_anon();
do $$ begin
  assert not exists (select 1 from public.search_products('pichinga')), 'synonyms: removed, nothing again';
end $$;
reset role;
do $$ begin
  assert (select count(*) from private.audit_log where id > current_setting('t.audit_from')::bigint
            and table_name = 'search_synonyms' and action in ('INSERT', 'DELETE')) = 2,
    'synonyms: adding and removing are in the audit log';
end $$;

-- ═══ 5. Reviews ════════════════════════════════════════════════════════════

-- The seller answers, and someone reports the review.
select pg_temp.login('cafetal@yuntera.example');
select public.seller_reply_review(current_setting('t.review')::uuid, 'Gracias, revisaremos el empaque.');
reset role;
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.remember('report', public.report_content('review', current_setting('t.review')::uuid,
  'abuse', 'Tiene insultos.')::text);
reset role;

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v jsonb;
  v_row jsonb;
begin
  v := public.ops_reviews();
  assert (v ->> 'total')::int = (select count(*) from public.reviews) and (v ->> 'page_size')::int = 50,
    format('reviews: all %s', v ->> 'total');
  v := public.ops_reviews('reported');
  assert (v ->> 'total')::int = 1, format('reviews: reported %s', v);
  v_row := v -> 'reviews' -> 0;
  assert v_row ->> 'id' = current_setting('t.review') and (v_row ->> 'open_reports')::int = 1
     and v_row -> 'report_reasons' = '["abuse"]' and v_row ->> 'seller_name' = 'Cafetal Los Santos'
     and v_row ->> 'seller_reply' like 'Gracias%', format('reviews: the reported one %s', v_row);
  -- Of the reviewer, only what the shop shows.
  assert v_row ->> 'author' = 'María R.' or v_row ->> 'author' like '% _.', format('reviews: author %s', v_row ->> 'author');
  assert not (v_row ? 'user_id') and not (v_row ? 'email') and not (v_row ? 'order_number')
     and v_row::text not like '%comprador%', 'reviews: nothing else about the reviewer';
  assert ((public.ops_reviews('replied')) ->> 'total')::int = 1, 'reviews: replied';
  assert ((public.ops_reviews('low')) ->> 'total')::int
       = (select count(*) from public.reviews where rating <= 2), 'reviews: low ratings';
  assert ((public.ops_reviews('hidden')) ->> 'total')::int = 0, 'reviews: none hidden yet';
  assert ((public.ops_reviews('all', current_setting('t.review')::uuid)) ->> 'total')::int = 1, 'reviews: by id';
  perform pg_temp.refused($q$select public.ops_reviews('todas')$q$, 'review_filter_invalid');

  perform pg_temp.refused(format($q$select public.ops_hide_review(%L, 'low_rating')$q$, current_setting('t.review')),
                          'review_reason_invalid');
  perform pg_temp.refused(format($q$select public.ops_hide_review(%L, 'offensive')$q$, gen_random_uuid()),
                          'review_not_found');
  perform pg_temp.refused(format('select public.ops_show_review(%L)', current_setting('t.review')), 'review_not_hidden');
  perform public.ops_hide_review(current_setting('t.review')::uuid, 'offensive', 'Insulta al repartidor.');
  perform pg_temp.refused(format($q$select public.ops_hide_review(%L, 'spam')$q$, current_setting('t.review')),
                          'review_already_hidden');
  assert ((public.ops_reviews('hidden')) -> 'reviews' -> 0 ->> 'hidden_reason') = 'offensive', 'reviews: hidden, with why';
end
$$;
reset role;

-- The rating and count follow wherever the shop shows them.
select pg_temp.login_anon();
do $$
declare
  v jsonb := public.get_product('cafe-molido-tarrazu-340g');
begin
  assert (v ->> 'rating_count')::int = 1 and (v ->> 'rating_sum')::int = 5, format('reviews: page rating %s', v ->> 'rating_count');
  assert not exists (select 1 from jsonb_array_elements(v -> 'reviews') r where r ->> 'id' = current_setting('t.review')),
    'reviews: not on the page';
  assert v -> 'rating_histogram' ->> '4' = '0', 'reviews: not in the histogram';
  assert (select rating_count from public.search_products('cafe molido') where slug = 'cafe-molido-tarrazu-340g') = 1,
    'reviews: nor in search results';
end
$$;
reset role;

-- The report about it closed as acted on, and its reporter is told.
do $$ begin
  assert (select status = 'actioned' and resolution like 'Tiene insultos%' from public.content_reports
          where id = current_setting('t.report')::uuid), 'reviews: the report is closed with the hiding';
  assert exists (select 1 from private.outbox_events where topic = 'report.resolved'
                   and id > current_setting('t.events_from')::bigint
                   and payload ->> 'report_id' = current_setting('t.report')), 'reviews: and its reporter is told';
  assert exists (select 1 from private.audit_log where id > current_setting('t.audit_from')::bigint
                   and table_name = 'reviews' and action = 'HIDE' and row_key = current_setting('t.review')
                   and new_row ->> 'reason' = 'offensive' and not (new_row ? 'body')),
    'reviews: the hiding is in the audit log, without the text';
end $$;

-- The author reads it on their order page; nobody else does.
select pg_temp.login('comprador@yuntera.example');
do $$
declare
  v jsonb := public.my_order_reviews('YT-100004');
  v_item jsonb;
begin
  select x into v_item from jsonb_array_elements(v) x
  where x ->> 'order_item_id' = (select order_item_id::text from public.reviews where id = current_setting('t.review')::uuid);
  assert (v_item ->> 'hidden')::boolean and v_item ->> 'hidden_reason' = 'offensive'
     and v_item ->> 'hidden_at' is not null, format('reviews: the author sees why %s', v_item);
  assert not (v_item ? 'hidden_by') and v::text not like '%' || current_setting('t.central') || '%',
    'reviews: not who';
  assert jsonb_array_length(v) = 2, 'reviews: every review of the order';
end
$$;
reset role;
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.refused($q$select public.my_order_reviews('YT-100004')$q$, 'order_not_found');
reset role;

-- The reply alone.
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
begin
  perform public.ops_show_review(current_setting('t.review')::uuid);
  perform pg_temp.refused(format('select public.ops_show_review_reply(%L)', current_setting('t.review')),
                          'review_reply_not_hidden');
  perform public.ops_hide_review_reply(current_setting('t.review')::uuid, 'personal_data', 'Pone un teléfono.');
  perform pg_temp.refused(format($q$select public.ops_hide_review_reply(%L, 'spam')$q$, current_setting('t.review')),
                          'review_reply_already_hidden');
  perform pg_temp.refused(format($q$select public.ops_hide_review_reply(%L, 'spam')$q$,
    (select id from public.reviews where seller_reply is null limit 1)), 'review_has_no_reply');
end
$$;
reset role;
select pg_temp.login_anon();
do $$
declare
  v jsonb := public.get_product('cafe-molido-tarrazu-340g');
  v_review jsonb;
begin
  select r into v_review from jsonb_array_elements(v -> 'reviews') r where r ->> 'id' = current_setting('t.review');
  assert v_review is not null and v_review ->> 'seller_reply' is null, format('reply hidden: review shown, reply not %s', v_review);
  assert (v ->> 'rating_count')::int = 2 and (v ->> 'rating_sum')::int = 9, 'reply hidden: the rating is back and stays';
end
$$;
reset role;
select pg_temp.login('comprador@yuntera.example');
do $$ begin
  assert exists (select 1 from jsonb_array_elements(public.my_order_reviews('YT-100004')) x
                 where not (x ->> 'hidden')::boolean and (x ->> 'reply_hidden')::boolean
                   and x ->> 'reply_hidden_reason' = 'personal_data'), 'reply hidden: the author is told';
end $$;
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_show_review_reply(current_setting('t.review')::uuid);
reset role;
select pg_temp.login_anon();
do $$ begin
  assert exists (select 1 from jsonb_array_elements(public.get_product('cafe-molido-tarrazu-340g') -> 'reviews') r
                 where r ->> 'id' = current_setting('t.review') and r ->> 'seller_reply' like 'Gracias%'),
    'reply shown again';
end $$;
reset role;

-- A report acted on hides the review with the reason that matches it.
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.remember('report2', public.report_content('review', current_setting('t.review')::uuid,
  'misleading', 'No compró esto.')::text);
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_resolve_report(current_setting('t.report2')::uuid, true, 'La reseña no describe una compra real.');
reset role;
do $$ begin
  assert (select status = 'rejected' and hidden_reason = 'not_genuine' from public.reviews
          where id = current_setting('t.review')::uuid), 'reports: acting on a review report hides it';
  assert (select status = 'actioned' and resolution like 'La reseña%' from public.content_reports
          where id = current_setting('t.report2')::uuid), 'reports: closed with the staff''s own words';
  assert (select count(*) from private.outbox_events where topic = 'report.resolved'
            and payload ->> 'report_id' = current_setting('t.report2')) = 1, 'reports: its reporter is told once';
end $$;

-- ═══ 6. Staff corrections to a product ═════════════════════════════════════

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v jsonb;
  v_lic uuid := current_setting('t.licuadora')::uuid;
  v_cocina uuid := (select id from public.categories where slug = 'cocina');
begin
  v := public.ops_catalog_product('licuadora-volcan-600w');
  assert v ->> 'id' = v_lic::text and v -> 'category' ->> 'slug' = 'cocina-electrica'
     and v -> 'brand' ->> 'name' = 'Volcán' and (v ->> 'referral_bps')::int = 1000
     and not (v ->> 'taken_down')::boolean and not (v ->> 'edit_pending')::boolean,
    format('products: what staff see %s', v);
  assert public.ops_catalog_product(v_lic::text) ->> 'slug' = 'licuadora-volcan-600w', 'products: by id too';
  perform pg_temp.refused($q$select public.ops_catalog_product('no-existe')$q$, 'catalog_product_not_found');

  perform pg_temp.refused(format('select public.ops_correct_product(%L, %L, null, false, %L)', v_lic, v_cocina, 'corto'),
                          'reason_required');
  perform pg_temp.refused(format('select public.ops_correct_product(%L, %L, null, false, %L)', v_lic,
    (select category_id from public.products where id = v_lic), 'Nada cambia en esta corrección.'),
    'correction_unchanged');
  perform pg_temp.refused(format('select public.ops_correct_product(%L, null, %L, false, %L)', v_lic,
    (select id from public.brands where slug = 'luma'), 'Una marca que ya no existe.'), 'brand_not_found');
  perform public.ops_set_category_active(v_cocina, false);
  perform pg_temp.refused(format('select public.ops_correct_product(%L, %L, null, false, %L)', v_lic, v_cocina,
    'A una categoría oculta no.'), 'category_not_found');
  perform public.ops_set_category_active(v_cocina, true);
end
$$;
reset role;

-- While the seller's own edit waits, staff decide that first.
insert into public.product_change_requests (product_id, seller_id, proposed)
values (current_setting('t.licuadora')::uuid, current_setting('t.tecnocasa')::uuid, '{}');
select pg_temp.login('central@yuntera.example', 'aal2');
select pg_temp.refused(format('select public.ops_correct_product(%L, %L, null, false, %L)',
  current_setting('t.licuadora'), (select id from public.categories where slug = 'cocina'),
  'Mientras espera su cambio.'), 'listing_edit_pending');
reset role;
delete from public.product_change_requests
where product_id = current_setting('t.licuadora')::uuid and status = 'pending';

-- Not at a price below what the fees in the new category would cost.
select pg_temp.remember('licuadora_price', (
  select o.price_minor::text from public.offers o join public.skus k on k.id = o.sku_id
  where k.product_id = current_setting('t.licuadora')::uuid limit 1));
-- The lowest price that covers the fees where it is (10 %) is below what
-- they cost in Ropa (15 %).
update public.offers o
set price_minor = private.min_price_covering_fees(o.fulfillment, p.category_id, k.weight_grams,
                                                  greatest(k.length_cm, k.width_cm, k.height_cm))
from public.skus k join public.products p on p.id = k.product_id
where o.sku_id = k.id and p.id = current_setting('t.licuadora')::uuid;
select pg_temp.login('central@yuntera.example', 'aal2');
select pg_temp.refused(format('select public.ops_correct_product(%L, %L, null, false, %L)',
  current_setting('t.licuadora'), (select id from public.categories where slug = 'ropa'),
  'A pérdida no se puede.'), 'correction_below_fee_floor');
reset role;
update public.offers set price_minor = current_setting('t.licuadora_price')::bigint
where sku_id in (select id from public.skus where product_id = current_setting('t.licuadora')::uuid);

select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v jsonb;
  v_lic uuid := current_setting('t.licuadora')::uuid;
begin
  v := public.ops_correct_product(v_lic, (select id from public.categories where slug = 'cocina'), null, false,
                                  'Es un utensilio de cocina, no un electrodoméstico grande.');
  assert v -> 'category' ->> 'slug' = 'cocina' and (v ->> 'referral_bps')::int = 1200 and v -> 'brand' ->> 'name' = 'Volcán',
    format('products: corrected %s', v);
  v := public.ops_correct_product(v_lic, null, (select id from public.brands where slug = 'nimbo'), false,
                                  'La marca correcta es Nimbo, según la caja.');
  assert v -> 'brand' ->> 'name' = 'Nimbo', 'products: brand corrected';
  v := public.ops_correct_product(v_lic, null, null, true, 'No tiene marca visible en el empaque.');
  assert v -> 'brand' = 'null', 'products: brand cleared';
end
$$;
reset role;

-- The shop follows, the log says it, the seller is told what it means.
select pg_temp.login_anon();
do $$ begin
  assert exists (select 1 from public.search_products(p_category_slug => 'cocina') where slug = 'licuadora-volcan-600w'),
    'products: found in its new category';
  assert not exists (select 1 from public.search_products(p_category_slug => 'cocina-electrica')
                     where slug = 'licuadora-volcan-600w'), 'products: and no longer in the old one';
end $$;
reset role;
do $$
declare
  v jsonb;
  v_ctx jsonb;
begin
  assert (select count(*) from private.audit_log where id > current_setting('t.audit_from')::bigint
            and table_name = 'products' and action = 'CORRECT' and row_key = current_setting('t.licuadora')) = 3,
    'products: every correction is in the audit log';
  v := pg_temp.planned_for('product.staff_changed', current_setting('t.events_from')::bigint);
  assert v @> jsonb_build_array(jsonb_build_object('template', 'seller_listing_staff_change', 'channel', 'email',
                                                   'recipient', 'seller:' || current_setting('t.tecnocasa'))),
    format('products: the seller is told by e-mail %s', v);
  select x -> 'context' into v_ctx from jsonb_array_elements(v) x
  where x -> 'context' ->> 'to_category' is not null limit 1;
  assert v_ctx ->> 'kind' = 'corrected' and v_ctx ->> 'from_category' = 'Cocina eléctrica'
     and v_ctx ->> 'to_category' = 'Cocina y mesa' and (v_ctx ->> 'from_referral_bps')::int = 1000
     and (v_ctx ->> 'to_referral_bps')::int = 1200 and v_ctx ->> 'note' like 'Es un utensilio%',
    format('products: with the old and new category and commission %s', v_ctx);
  assert not exists (select 1 from jsonb_array_elements(v) x where x -> 'context' ? 'from_tax_bps'),
    'products: the IVA did not change, so it is not mentioned';
end
$$;

-- Take down and put back.
select pg_temp.login('central@yuntera.example', 'aal2');
do $$
declare
  v_hamaca uuid := current_setting('t.hamaca')::uuid;
begin
  perform pg_temp.refused(format('select public.ops_take_down_product(%L, %L)', v_hamaca, 'corto'), 'reason_required');
  perform pg_temp.refused(format('select public.ops_restore_product(%L, %L)', v_hamaca, 'No estaba retirado.'),
                          'product_not_taken_down');
  perform public.ops_take_down_product(v_hamaca, 'Las fotos muestran otra marca de hamaca.');
  perform pg_temp.refused(format('select public.ops_take_down_product(%L, %L)', v_hamaca, 'Otra vez retirado.'),
                          'product_not_active');
  assert (public.ops_catalog_product(v_hamaca::text) ->> 'taken_down')::boolean, 'products: taken down';
end
$$;
reset role;
select pg_temp.login_anon();
do $$ begin
  assert not exists (select 1 from public.search_products('hamaca') where slug = 'hamaca-algodon-doble'),
    'take-down: gone from search';
  assert not public.shop_path_exists('product', 'hamaca-algodon-doble'), 'take-down: and from its address';
end $$;
reset role;
do $$ begin
  assert (select status = 'rejected' and rejection_reason like 'Las fotos%' from public.products
          where id = current_setting('t.hamaca')::uuid), 'take-down: the seller reads the reason on the listing';
end $$;
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_restore_product(current_setting('t.hamaca')::uuid, 'El vendedor envió fotos propias por correo.');
reset role;
select pg_temp.login_anon();
do $$ begin
  assert public.shop_path_exists('product', 'hamaca-algodon-doble'), 'restore: back at its address';
end $$;
reset role;
do $$
declare
  v jsonb := pg_temp.planned_for('product.staff_changed', current_setting('t.events_from')::bigint);
begin
  assert (select array_agg(distinct x -> 'context' ->> 'kind' order by x -> 'context' ->> 'kind')
          from jsonb_array_elements(v) x) = '{corrected,restored,taken_down}', format('take-down: each is told %s', v);
  assert (select count(*) from private.audit_log where id > current_setting('t.audit_from')::bigint
            and table_name = 'products' and action in ('TAKE_DOWN', 'RESTORE')) = 2, 'take-down: in the audit log';
end
$$;

-- A report acted on takes the product down the same way, so it can be put back.
select pg_temp.login('comprador2@yuntera.example');
select pg_temp.remember('report3', public.report_content('product', current_setting('t.molido')::uuid,
  'misleading', 'El peso no coincide.')::text);
reset role;
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_resolve_report(current_setting('t.report3')::uuid, true, 'El peso del empaque no es el anunciado.');
do $$ begin
  assert (public.ops_catalog_product(current_setting('t.molido')) ->> 'taken_down')::boolean,
    'reports: a product taken down from a report can be put back';
end $$;
select public.ops_restore_product(current_setting('t.molido')::uuid, 'El vendedor corrigió el peso anunciado.');
reset role;

-- A shop that may not trade cannot have its product put back.
select pg_temp.login('central@yuntera.example', 'aal2');
select public.ops_take_down_product(current_setting('t.hamaca')::uuid, 'Retirado para la prueba de la tienda.');
reset role;
update public.sellers set status = 'suspended' where slug = 'tienda-sendero';
select pg_temp.login('central@yuntera.example', 'aal2');
select pg_temp.refused(format('select public.ops_restore_product(%L, %L)', current_setting('t.hamaca'),
  'Vuelve con la tienda suspendida.'), 'listing_shop_not_active');
reset role;

select 'ok' as console_catalogue;
rollback;
