-- Two catalogue follow-ups, after the staff catalogue tools (083700).
--
--   * PRODUCT PAGES: private.product_page_open now refuses, by itself, a
--     product that is not on sale. Until now the status filter lived only in
--     its callers. One caller, get_product, has no status filter of its own:
--     the page body (private.get_product_page) deliberately opens a product
--     that is not on sale to its own shop and to staff, so a seller can look
--     at a draft or a listing waiting for review and staff can look at a
--     taken-down one. The helper keeps exactly that: a product that is not
--     active opens only for staff and for members of the shop that created
--     it. Everyone else (visitors, shoppers, other shops) is refused at the
--     helper as well as at the caller. The rest of the helper (a product of a
--     shop that is not active opens only while another active shop sells it)
--     is unchanged. Every other caller (shop_path_exists,
--     seller_catalog_search, seller_add_offer, cart_alternatives) already asks
--     for an active product, so none of them changes.
--
--   * DELETING A BRAND: catalogue staff delete a brand that no product refers
--     to, in any status (archived and draft listings included: they still
--     name the brand, and the foreign key would refuse it anyway). A brand
--     in use is refused with
--     `brand_in_use`, whose detail is the number of products; staff merge it
--     into another brand or take it out of the filter instead. When a brand
--     goes:
--       - its address and its earlier addresses are free again (they live on
--         the brand's row): a new brand may take them;
--       - brands merged into it go with it. They are hidden rows that exist
--         only so their old filter address keeps showing the brand they went
--         into; with that brand gone they mean nothing, and their addresses
--         are freed too. Such a brand cannot be deleted on its own
--         (`brand_merged`): delete the brand it went into;
--       - an audit entry keeps its name, address, earlier addresses and the
--         names of the brands removed with it.
--     Serialised against the other brand changes: like ops_create_brand,
--     ops_update_brand and ops_merge_brands it takes the brands lock first,
--     then the brand's row (and the rows merged into it) for update, and only
--     then counts the products, so a merge into the brand that commits first
--     is counted. Sellers never name a brand (no seller function takes one):
--     the only other writer of products.brand_id is ops_correct_product,
--     which staff use to give a product a brand. It is redefined below to
--     lock the brand it gives before it locks the product (key share, the
--     lock the foreign key takes anyway), in the order the merge takes
--     its locks (brands, then products). A correction racing a deletion
--     therefore either is counted by the deletion (`brand_in_use`) or finds
--     the brand gone (`brand_not_found`); it never meets a broken reference.
--     ops_catalog_brands also returns `all_product_count` (every status) and
--     `deletable`, so the console offers the action only where it works.

-- ═══ 1. Product pages ══════════════════════════════════════════════════════

-- Replaces the version in 20261121083000_limits.sql.
create or replace function private.product_page_open(p_product_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product_id
      -- Not on sale: only its own shop's preview and staff (as get_product_page).
      and (p.status = 'active'
           or private.is_staff()
           or p.created_by_seller_id in (select private.my_seller_ids()))
      and (p.created_by_seller_id is null
           or private.seller_is_active(p.created_by_seller_id)
           or private.is_staff()
           or p.created_by_seller_id in (select private.my_seller_ids())
           or exists (select 1 from public.offers o
                      join public.skus k on k.id = o.sku_id
                      join public.sellers s on s.id = o.seller_id
                      where k.product_id = p.id and o.status = 'active' and s.status = 'active')));
$$;
revoke all on function private.product_page_open(uuid) from public, anon, authenticated;

-- ═══ 2. Brands ═════════════════════════════════════════════════════════════

-- Replaces the version in 20261121083700_console_catalogue.sql. Two fields
-- more: the products in every status, and whether the brand can be deleted.
create or replace function public.ops_catalog_brands() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'slug', b.slug,
      'name', b.name,
      'active', b.active,
      'aliases', to_jsonb(b.aliases),
      'former_slugs', to_jsonb(b.former_slugs),
      'merged_into', case when m.id is not null
                          then jsonb_build_object('id', m.id, 'name', m.name, 'slug', m.slug) end,
      'merged_at', b.merged_at,
      'product_count', (select count(*) from public.products p
                        where p.brand_id = b.id and p.status <> 'archived'),
      'active_product_count', (select count(*) from public.products p
                               where p.brand_id = b.id and p.status = 'active'),
      'all_product_count', u.n,
      'deletable', b.merged_into_id is null and u.n = 0
    ) order by (b.merged_into_id is not null), private.fold(b.name), b.slug)
    from public.brands b
    left join public.brands m on m.id = b.merged_into_id
    cross join lateral (select count(*) as n from public.products p where p.brand_id = b.id) u),
    '[]'::jsonb);
end;
$$;

-- Deletes a brand no product names, with the brands merged into it.
create or replace function public.ops_delete_brand(p_brand_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b public.brands%rowtype;
  v_merged text[];
  v_products bigint;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  -- The order every brand change takes: the brands lock, then the rows.
  perform pg_advisory_xact_lock(hashtext('yuntera.brands'));
  select * into b from public.brands where id = p_brand_id for update;
  if not found then
    perform private.fail('brand_not_found');
  end if;
  if b.merged_into_id is not null then
    perform private.fail('brand_merged');
  end if;
  perform 1 from public.brands where merged_into_id = b.id order by id for update;
  -- Counted only now, with the rows locked: what committed before is seen.
  select count(*) into v_products
  from public.products p
  where p.brand_id = b.id or p.brand_id in (select m.id from public.brands m where m.merged_into_id = b.id);
  if v_products > 0 then
    perform private.fail('brand_in_use', v_products::text);
  end if;
  select coalesce(array_agg(m.name order by m.name), '{}') into v_merged
  from public.brands m where m.merged_into_id = b.id;

  delete from public.brands where merged_into_id = b.id;
  delete from public.brands where id = b.id;

  perform private.catalog_audit('DELETE', 'brands', b.id::text,
    jsonb_build_object('name', b.name, 'slug', b.slug, 'former_slugs', to_jsonb(b.former_slugs),
                       'active', b.active, 'merged_brands', to_jsonb(v_merged)),
    null);
  return jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
                            'merged_removed', cardinality(v_merged));
end;
$$;

-- Replaces the version in 20261121083700_console_catalogue.sql. One change:
-- the brand a correction gives is locked first (key share, as the foreign key
-- does), before the product, so the correction queues behind a brand being
-- deleted or merged in the order those take their locks, and then reads it.
create or replace function public.ops_correct_product(
  p_product_id uuid,
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_clear_brand boolean default false,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_note text := private.clean_text(p_note);
  v_category public.categories%rowtype;
  v_old_category public.categories%rowtype;
  v_brand public.brands%rowtype;
  v_old_brand text;
  v_new_brand_id uuid;
  v_tax integer;
  v_default integer := (select s.default_referral_bps from public.fee_schedules s where s.active);
  v_old_bps integer;
  v_new_bps integer;
  v_take_down_intact boolean;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(v_note), 0) < 10 then
    -- The seller is owed an explanation.
    perform private.fail('reason_required');
  end if;
  if p_brand_id is not null and not coalesce(p_clear_brand, false) then
    perform 1 from public.brands where id = p_brand_id for key share;
  end if;
  select * into p from public.products where id = p_product_id for update;
  if not found then
    perform private.fail('catalog_product_not_found');
  end if;
  if p.status not in ('active', 'pending_review', 'rejected') then
    perform private.fail('product_not_correctable');
  end if;
  if exists (select 1 from public.product_change_requests r
             where r.product_id = p.id and r.status = 'pending') then
    perform private.fail('listing_edit_pending');
  end if;

  select * into v_old_category from public.categories where id = p.category_id;
  v_category := v_old_category;
  if p_category_id is not null and p_category_id <> p.category_id then
    select * into v_category from public.categories where id = p_category_id and active;
    if not found then
      perform private.fail('category_not_found');
    end if;
  end if;

  v_new_brand_id := p.brand_id;
  if p_clear_brand then
    v_new_brand_id := null;
  elsif p_brand_id is not null and p_brand_id is distinct from p.brand_id then
    select * into v_brand from public.brands
    where id = p_brand_id and active and merged_into_id is null;
    if not found then
      perform private.fail('brand_not_found');
    end if;
    v_new_brand_id := v_brand.id;
  end if;

  if v_category.id = p.category_id and v_new_brand_id is not distinct from p.brand_id then
    perform private.fail('correction_unchanged');
  end if;

  -- No offer of it may sell at a loss in its new category.
  if v_category.id <> p.category_id and exists (
    select 1 from public.offers o join public.skus k on k.id = o.sku_id
    where k.product_id = p.id and o.status = 'active'
      and private.worst_unit_payout(o.price_minor, o.fulfillment, v_category.id, k.weight_grams,
                                    greatest(k.length_cm, k.width_cm, k.height_cm)) < 0) then
    perform private.fail('correction_below_fee_floor');
  end if;

  v_old_bps := coalesce(private.referral_bps_for_category(p.category_id), v_default);
  v_new_bps := coalesce(private.referral_bps_for_category(v_category.id), v_default);
  -- As when an edit that changes the category is approved: the new
  -- category's IVA applies (20261121082400_fixes.sql, ops_review_listing_edit).
  v_tax := case when v_category.id <> p.category_id then v_category.default_tax_rate_bps
                else p.tax_rate_bps end;
  select b.name into v_old_brand from public.brands b where b.id = p.brand_id;

  v_take_down_intact := p.taken_down_at is not null
                        and p.taken_down_fingerprint = private.listing_fingerprint(p.id);
  update public.products
  set category_id = v_category.id, brand_id = v_new_brand_id, tax_rate_bps = v_tax
  where id = p.id;
  -- A taken-down listing that staff correct is what they would put back: the
  -- correction is not a seller's change. Only when the seller had changed
  -- nothing before it, so a correction never makes a seller's edit look reviewed.
  if v_take_down_intact then
    update public.products set taken_down_fingerprint = private.listing_fingerprint(p.id)
    where id = p.id;
  end if;

  perform private.catalog_audit('CORRECT', 'products', p.id::text,
    jsonb_build_object('category', v_old_category.slug, 'brand', v_old_brand, 'tax_rate_bps', p.tax_rate_bps),
    jsonb_build_object('category', v_category.slug,
                       'brand', (select b.name from public.brands b where b.id = v_new_brand_id),
                       'tax_rate_bps', v_tax, 'note', left(v_note, 500)));

  if p.created_by_seller_id is not null then
    perform private.emit('product.staff_changed', jsonb_strip_nulls(jsonb_build_object(
      'product_id', p.id, 'seller_id', p.created_by_seller_id, 'kind', 'corrected',
      'note', left(v_note, 400),
      -- The message says it is still on sale only when it is.
      'on_sale', p.status = 'active',
      'from_category', case when v_category.id <> p.category_id then v_old_category.name_es end,
      'to_category', case when v_category.id <> p.category_id then v_category.name_es end,
      'brand_changed', v_new_brand_id is distinct from p.brand_id,
      'from_brand', case when v_new_brand_id is distinct from p.brand_id then v_old_brand end,
      'to_brand', case when v_new_brand_id is distinct from p.brand_id
                       then (select b.name from public.brands b where b.id = v_new_brand_id) end,
      'from_referral_bps', case when v_old_bps <> v_new_bps then v_old_bps end,
      'to_referral_bps', case when v_old_bps <> v_new_bps then v_new_bps end,
      'from_tax_bps', case when v_tax <> p.tax_rate_bps then p.tax_rate_bps end,
      'to_tax_bps', case when v_tax <> p.tax_rate_bps then v_tax end)));
  end if;
  return public.ops_catalog_product(p.id::text);
end;
$$;

grant execute on function public.ops_delete_brand(uuid) to authenticated;
