-- The shopper-facing API.
--
-- The database's functions ARE its public API: one function per screen returns
-- that screen's whole payload as JSON. Clients never assemble a page from table
-- reads. This gives:
--   * a stable contract — tables can change shape without breaking any app;
--   * one round trip per screen, which matters on mobile data;
--   * a small, reviewable surface — every way in is a named function here.
-- Row-level security stays on every table underneath as a second lock.
--
-- Read functions run with the caller's rights (SECURITY INVOKER) wherever the
-- caller's own row access is exactly what the screen should show, so they
-- cannot reveal more than RLS allows. Functions that must combine data across
-- that boundary are SECURITY DEFINER and check the caller explicitly.
--
-- Payload shapes are mirrored by the schemas in packages/db/src/schemas.ts,
-- and a contract test validates real responses against them.

-- ── Who am I ───────────────────────────────────────────────────────────────

-- Everything the apps need to decide what to show a signed-in user.
create or replace function public.my_roles() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then null else jsonb_build_object(
    'user_id', (select auth.uid()),
    'full_name', (select p.full_name from public.profiles p where p.id = (select auth.uid())),
    'staff_role', (select s.role from public.staff_members s
                   where s.user_id = (select auth.uid()) and s.active),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'slug', s.slug, 'trade_name', s.trade_name, 'status', s.status, 'role', m.role)
        order by s.trade_name)
      from public.seller_members m join public.sellers s on s.id = m.seller_id
      where m.user_id = (select auth.uid())), '[]'::jsonb),
    'driver', (
      select jsonb_build_object('id', d.id, 'status', d.status, 'full_name', d.full_name)
      from public.drivers d where d.user_id = (select auth.uid())),
    'warehouses', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name, 'role', ws.role)
                       order by w.code)
      from public.warehouse_staff ws join public.warehouses w on w.id = ws.warehouse_id
      where ws.user_id = (select auth.uid())), '[]'::jsonb)
  ) end;
$$;

create or replace function public.my_profile() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'email', u.email, 'full_name', p.full_name, 'phone', p.phone,
    'phone_verified', p.phone_verified_at is not null, 'locale', p.locale,
    'marketing_opt_in', p.marketing_opt_in)
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = (select auth.uid());
$$;

create or replace function public.update_profile(
  p_full_name text,
  p_phone text default null,
  p_locale text default 'es-CR',
  p_marketing_opt_in boolean default false
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  update public.profiles
  set full_name = nullif(trim(p_full_name), ''),
      phone = nullif(trim(p_phone), ''),
      locale = p_locale,
      marketing_opt_in = p_marketing_opt_in
  where id = (select auth.uid());
exception
  when check_violation then
    perform private.fail('invalid_profile');
end;
$$;

create or replace function public.record_consent(p_purpose text, p_policy_version text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  insert into public.consents (user_id, purpose, policy_version)
  values ((select auth.uid()), p_purpose, p_policy_version);
exception
  when check_violation then
    perform private.fail('invalid_consent');
end;
$$;

-- ── Browse ─────────────────────────────────────────────────────────────────

create or replace function public.list_categories()
returns table (
  slug text, parent_slug text, name_es text, name_en text, sort smallint, product_count bigint
)
language sql stable
set search_path = ''
as $$
  select c.slug, parent.slug, c.name_es, c.name_en, c.sort,
         (select count(*) from public.products p
          where p.status = 'active' and p.min_price_minor is not null
            and p.category_id in (select private.category_descendants(c.slug)))
  from public.categories c
  left join public.categories parent on parent.id = c.parent_id
  where c.active
  order by (parent.slug is not null), coalesce(parent.sort, c.sort), c.sort, c.slug;
$$;

-- Every district with its cantón, province and delivery zone: the address form
-- and the "¿llegamos a su zona?" check both read from this.
create or replace function public.list_districts()
returns table (
  postal_code text, district text, canton_code text, canton text,
  province_code smallint, province text, zone_id text, zone_active boolean
)
language sql stable
set search_path = ''
as $$
  select d.postal_code, d.name, c.code, c.name, p.code, p.name,
         coalesce(d.zone_id, c.zone_id), z.active
  from public.districts d
  join public.cantons c on c.code = d.canton_code
  join public.provinces p on p.code = c.province_code
  join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
  order by p.code, c.code, d.postal_code;
$$;

-- "María F." — enough to feel like a person, not enough to identify one.
create or replace function public.reviewer_display_name(p_user_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    nullif(trim(
      split_part(trim(p.full_name), ' ', 1) ||
      case when split_part(trim(p.full_name), ' ', 2) <> ''
           then ' ' || left(split_part(trim(p.full_name), ' ', 2), 1) || '.' else '' end), ''),
    'Cliente')
  from public.profiles p where p.id = p_user_id;
$$;

-- The product page. `p_postal_code` personalises the delivery promise per offer.
create or replace function public.get_product(p_slug text, p_postal_code text default null)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'title', p.title,
    'description', p.description,
    'bullet_points', to_jsonb(p.bullet_points),
    'brand', b.name,
    'made_in_cr', p.made_in_cr,
    'warranty_months', p.warranty_months,
    'tax_rate_bps', p.tax_rate_bps,
    'rating_sum', p.rating_sum,
    'rating_count', p.rating_count,
    'rating_histogram', (
      select coalesce(jsonb_object_agg(stars::text, n), '{}'::jsonb)
      from (
        select s.stars, (select count(*) from public.reviews r
                         where r.product_id = p.id and r.status = 'published' and r.rating = s.stars) as n
        from generate_series(1, 5) as s (stars)
      ) h),
    'category', jsonb_build_object('slug', cat.slug, 'name_es', cat.name_es, 'name_en', cat.name_en),
    'breadcrumbs', (
      with recursive up as (
        select c.id, c.parent_id, c.slug, c.name_es, c.name_en, 0 as depth
        from public.categories c where c.id = p.category_id
        union all
        select c.id, c.parent_id, c.slug, c.name_es, c.name_en, up.depth + 1
        from public.categories c join up on c.id = up.parent_id
      )
      select jsonb_agg(jsonb_build_object('slug', slug, 'name_es', name_es, 'name_en', name_en)
                       order by depth desc)
      from up),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('path', i.path, 'alt', i.alt) order by i.sort, i.id)
      from public.product_images i where i.product_id = p.id), '[]'::jsonb),
    'zone', (
      select jsonb_build_object(
        'id', e.zone_id, 'active', e.zone_active, 'shipping_fee_minor', e.shipping_fee_minor,
        'free_shipping_threshold_minor', e.free_shipping_threshold_minor,
        'cod_available', e.cod_available)
      from public.delivery_estimate(p_postal_code, 0) e),
    'skus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id,
        'code', k.code,
        'variant_name', k.variant_name,
        'offers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'offer_id', o.id,
            'seller', jsonb_build_object(
              'slug', s.slug, 'trade_name', s.trade_name, 'score', s.score, 'health', s.health),
            'price_minor', o.price_minor,
            'list_price_minor', o.list_price_minor,
            'condition', o.condition,
            'fulfillment', o.fulfillment,
            'handling_days', o.handling_days,
            -- Exact stock is the seller's business; the page needs "in stock" and "few left".
            'available', least(o.available_quantity, 10),
            'listed_at', o.created_at,
            'promise', (
              select jsonb_build_object('earliest', e.earliest, 'latest', e.latest)
              from public.delivery_estimate(p_postal_code, o.handling_days) e
              where e.zone_active)
          ) order by o.price_minor, o.created_at, o.id)
          from public.offers o
          join public.sellers s on s.id = o.seller_id
          where o.sku_id = k.id and o.status = 'active' and s.status = 'active'), '[]'::jsonb)
      ) order by k.variant_name, k.code)
      from public.skus k where k.product_id = p.id and k.active), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(row_to_json(rv) order by rv.created_at desc)
      from (
        select r.id, r.rating, r.title, r.body, r.created_at, r.seller_reply,
               public.reviewer_display_name(r.user_id) as author
        from public.reviews r
        where r.product_id = p.id and r.status = 'published'
        order by r.created_at desc limit 20
      ) rv), '[]'::jsonb),
    'related', coalesce((
      select jsonb_agg(row_to_json(rel))
      from (
        select q.slug, q.title, q.min_price_minor, q.list_price_minor, q.in_stock,
               q.rating_sum, q.rating_count, q.fulfilled_by_platform,
               (select i.path from public.product_images i
                where i.product_id = q.id order by i.sort, i.id limit 1) as image_path,
               coalesce(pr.kind, 'similar') as kind
        from public.products q
        left join public.product_relations pr on pr.product_id = p.id and pr.related_id = q.id
        where q.status = 'active' and q.id <> p.id and q.min_price_minor is not null
          and (pr.product_id is not null or q.category_id = p.category_id
               or q.category_id in (
                 select c2.id from public.categories c1
                 join public.categories c2 on c2.parent_id = c1.parent_id
                 where c1.id = p.category_id))
        order by (pr.product_id is not null) desc, pr.score desc nulls last,
                 q.units_sold_30d desc, q.id
        limit 8
      ) rel), '[]'::jsonb)
  )
  from public.products p
  join public.categories cat on cat.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  where p.slug = p_slug;
$$;

-- ── Cart and checkout ──────────────────────────────────────────────────────

-- Current facts for the offers in a cart. Offers that can no longer be bought
-- come back flagged, so the cart can say so instead of silently dropping them.
create or replace function public.cart_lines(p_offer_ids uuid[])
returns table (
  offer_id uuid, buyable boolean, product_slug text, title text, variant_name text,
  image_path text, seller_name text, price_minor bigint, list_price_minor bigint,
  available integer, fulfillment public.fulfillment_type, handling_days smallint
)
language sql stable
set search_path = ''
as $$
  select req.offer_id,
         (o.id is not null and o.status = 'active' and k.active and p.status = 'active'
          and s.status = 'active' and o.available_quantity > 0),
         p.slug, p.title, k.variant_name,
         (select i.path from public.product_images i
          where i.product_id = p.id order by i.sort, i.id limit 1),
         s.trade_name, o.price_minor, o.list_price_minor,
         least(coalesce(o.available_quantity, 0), 10), o.fulfillment, o.handling_days
  from unnest(p_offer_ids[1:60]) as req (offer_id)
  left join public.offers o on o.id = req.offer_id
  left join public.skus k on k.id = o.sku_id
  left join public.products p on p.id = k.product_id
  left join public.sellers s on s.id = o.seller_id;
$$;

-- The order summary shown before the shopper confirms: every charge, the tax
-- inside it, and the delivery date. Priced by the same code that places the
-- order, so the two cannot disagree. Needs no account.
create or replace function public.checkout_quote(p_items jsonb, p_postal_code text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_max_units integer := (private.setting('max_units_per_line'))::integer;
  v_max_lines integer := (private.setting('max_lines_per_order'))::integer;
  v_cod_max bigint := (private.setting('cod_max_order_minor'))::bigint;
  v_zone public.delivery_zones%rowtype;
  v_check record;
  v_shipping bigint := 0;
  v_shipping_tax bigint := 0;
  v_earliest date;
  v_latest date;
  v_issue text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('issue', 'cart_empty');
  end if;

  select * into v_check from private.price_items(p_items, v_max_units);
  v_issue := case
    when v_check.line_count > v_max_lines then 'too_many_lines'
    when v_check.bad_quantity > 0 then 'invalid_quantity'
    when v_check.unavailable_offer is not null then 'offer_unavailable'
  end;

  select z.* into v_zone from public.delivery_zones z
  where z.id = private.zone_for_postal_code(p_postal_code);

  if v_zone.id is not null then
    select shipping_minor, shipping_tax_minor into v_shipping, v_shipping_tax
    from private.shipping_for(v_zone.id, v_check.items_total);
    if v_zone.active then
      select c.earliest, c.latest into v_earliest, v_latest
      from private.compute_promise(v_zone.id, v_check.handling_days) c;
    else
      v_issue := coalesce(v_issue, 'zone_not_served');
    end if;
  end if;

  return jsonb_build_object(
    'issue', v_issue,
    'unavailable_offer_id', v_check.unavailable_offer,
    'items_total_minor', v_check.items_total,
    'shipping_minor', case when v_zone.id is null then null else v_shipping end,
    'total_minor', case when v_zone.id is null then null else v_check.items_total + v_shipping end,
    'tax_included_minor',
      case when v_zone.id is null then v_check.items_tax else v_check.items_tax + v_shipping_tax end,
    'free_shipping_threshold_minor', v_zone.free_shipping_threshold_minor,
    'zone', case when v_zone.id is null then null else
      jsonb_build_object('id', v_zone.id, 'name', v_zone.name, 'active', v_zone.active) end,
    'promise', case when v_latest is null then null else
      jsonb_build_object('earliest', v_earliest, 'latest', v_latest) end,
    'cod_available', coalesce(v_zone.cod_available, false)
                     and v_check.items_total + v_shipping <= v_cod_max,
    'payments_mode', private.setting('payments_mode') #>> '{}'
  );
end;
$$;

-- ── Addresses ──────────────────────────────────────────────────────────────

create or replace function public.my_addresses()
returns table (
  id uuid, label text, recipient_name text, phone text, postal_code text, senas text,
  lat double precision, lng double precision, plus_code text, is_default boolean,
  district text, canton text, province text, zone_id text, zone_active boolean
)
language sql stable
set search_path = ''
as $$
  select a.id, a.label, a.recipient_name, a.phone, a.postal_code, a.senas, a.lat, a.lng,
         a.plus_code, a.is_default, d.name, c.name, p.name,
         coalesce(d.zone_id, c.zone_id), z.active
  from public.addresses a
  join public.districts d on d.postal_code = a.postal_code
  join public.cantons c on c.code = d.canton_code
  join public.provinces p on p.code = c.province_code
  join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
  where a.user_id = (select auth.uid()) and a.deleted_at is null
  order by a.is_default desc, a.created_at desc;
$$;

create or replace function public.save_address(
  p_recipient_name text,
  p_phone text,
  p_postal_code text,
  p_senas text,
  p_lat double precision,
  p_lng double precision,
  p_plus_code text default null,
  p_label text default null,
  p_make_default boolean default false,
  p_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_first boolean;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if not exists (select 1 from public.districts d where d.postal_code = p_postal_code) then
    perform private.fail('postal_code_invalid');
  end if;

  select not exists (
    select 1 from public.addresses a where a.user_id = v_user and a.deleted_at is null
  ) into v_first;

  if p_make_default or v_first then
    update public.addresses set is_default = false
    where user_id = v_user and is_default and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.addresses
      (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, plus_code, is_default)
    values
      (v_user, nullif(trim(p_label), ''), trim(p_recipient_name), p_phone, p_postal_code,
       trim(p_senas), p_lat, p_lng, p_plus_code, p_make_default or v_first)
    returning id into v_id;
  else
    update public.addresses
    set label = nullif(trim(p_label), ''), recipient_name = trim(p_recipient_name), phone = p_phone,
        postal_code = p_postal_code, senas = trim(p_senas), lat = p_lat, lng = p_lng,
        plus_code = p_plus_code, is_default = is_default or p_make_default
    where id = p_id and user_id = v_user and deleted_at is null
    returning id into v_id;
    if v_id is null then
      perform private.fail('address_not_found');
    end if;
  end if;
  return v_id;
exception
  when check_violation then
    -- One of: name too short, phone not Costa Rican, señas too short, pin outside the country.
    perform private.fail('address_invalid');
end;
$$;

create or replace function public.delete_address(p_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.addresses
  set deleted_at = now(), is_default = false
  where id = p_id and user_id = (select auth.uid()) and deleted_at is null;
  if not found then
    perform private.fail('address_not_found');
  end if;
end;
$$;

-- ── Orders ─────────────────────────────────────────────────────────────────

create or replace function public.my_orders(p_limit integer default 20, p_offset integer default 0)
returns table (
  order_number text, status public.order_status, placed_at timestamptz, total_minor bigint,
  payment_method public.payment_method, promise_earliest date, promise_latest date,
  delivered_at timestamptz, item_count bigint, first_title text, first_image_path text
)
language sql stable
set search_path = ''
as $$
  select o.order_number, o.status, o.placed_at, o.total_minor, o.payment_method,
         o.promise_earliest, o.promise_latest, o.delivered_at,
         (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id),
         first_item.title, first_item.image_path
  from public.orders o
  left join lateral (
    select i.title, i.image_path from public.order_items i
    where i.order_id = o.id order by i.line_total_minor desc, i.id limit 1
  ) first_item on true
  where o.user_id = (select auth.uid())
  order by o.placed_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;

-- One order in full: what was bought, what was paid, where each parcel is.
-- For the shopper who owns it, and for staff helping them.
create or replace function public.get_order(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_is_owner boolean;
  v_is_staff boolean := private.has_staff_role('ops', 'support', 'finance');
begin
  select * into o from public.orders where order_number = p_order_number;
  v_is_owner := found and o.user_id = (select auth.uid());
  if not found or not (v_is_owner or v_is_staff) then
    -- The same answer whether the order does not exist or belongs to someone else.
    perform private.fail('order_not_found');
  end if;

  return jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'placed_at', o.placed_at,
    'confirmed_at', o.confirmed_at,
    'delivered_at', o.delivered_at,
    'cancelled_at', o.cancelled_at,
    'cancel_reason', o.cancel_reason,
    'items_total_minor', o.items_total_minor,
    'shipping_minor', o.shipping_minor,
    'discount_minor', o.discount_minor,
    'total_minor', o.total_minor,
    'tax_included_minor', o.tax_included_minor,
    'payment_method', o.payment_method,
    'promise_earliest', o.promise_earliest,
    'promise_latest', o.promise_latest,
    'withdrawal_deadline', o.withdrawal_deadline,
    'warranty_until', o.warranty_until,
    -- The PIN is shown while there is still something to hand over, and only to
    -- the shopper. It is their proof against a parcel being marked delivered
    -- without them, so nobody on the platform's side may read it: not the
    -- driver, and not staff looking at the order.
    'delivery_pin', case when v_is_owner
                          and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')
                         then o.delivery_pin end,
    'can_cancel', v_is_staff and o.status in ('pending_payment', 'payment_review', 'confirmed', 'processing')
                  or (o.status in ('pending_payment', 'payment_review', 'confirmed')
                      and not exists (select 1 from public.shipments s
                                      where s.order_id = o.id and s.status <> 'pending')),
    'address', jsonb_build_object(
      'recipient_name', o.ship_recipient_name, 'phone', o.ship_phone,
      'postal_code', o.ship_postal_code, 'senas', o.ship_senas,
      'lat', o.ship_lat, 'lng', o.ship_lng, 'plus_code', o.ship_plus_code,
      'district', (select d.name from public.districts d where d.postal_code = o.ship_postal_code),
      'canton', (select c.name from public.districts d join public.cantons c on c.code = d.canton_code
                 where d.postal_code = o.ship_postal_code)),
    'payment', (
      select jsonb_build_object(
        'method', p.method, 'status', p.status, 'amount_minor', p.amount_minor,
        'provider', p.provider, 'sinpe_reference', p.sinpe_reference, 'captured_at', p.captured_at)
      from public.payments p where p.order_id = o.id order by p.created_at desc limit 1),
    'items', (
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'variant_name', i.variant_name, 'image_path', i.image_path,
        'product_slug', (select pr.slug from public.products pr where pr.id = i.product_id),
        'seller_name', (select s.trade_name from public.sellers s where s.id = i.seller_id),
        'unit_price_minor', i.unit_price_minor, 'quantity', i.quantity,
        'line_total_minor', i.line_total_minor, 'fulfillment', i.fulfillment,
        'review', (select jsonb_build_object('rating', r.rating, 'title', r.title, 'body', r.body)
                   from public.reviews r where r.order_item_id = i.id),
        'returned_quantity', (select coalesce(sum(rr.quantity), 0) from public.return_requests rr
                              where rr.order_item_id = i.id and rr.status <> 'rejected')
      ) order by i.line_total_minor desc, i.id)
      from public.order_items i where i.order_id = o.id),
    'shipments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'tracking_code', s.tracking_code, 'status', s.status,
        'package_count', s.package_count, 'attempt_count', s.attempt_count,
        'promise_latest', s.promise_latest, 'delivered_at', s.delivered_at,
        'item_ids', (select jsonb_agg(si.order_item_id) from public.shipment_items si
                     where si.shipment_id = s.id),
        -- While a parcel is on the road the shopper sees who is bringing it:
        -- a first name, nothing more.
        'driver_first_name', (
          select split_part(d.full_name, ' ', 1)
          from public.route_stops rs
          join public.routes r on r.id = rs.route_id
          join public.drivers d on d.id = r.driver_id
          where rs.shipment_id = s.id and r.status = 'in_progress' and s.status = 'out_for_delivery'
          limit 1)
      ) order by s.created_at, s.id)
      from public.shipments s where s.order_id = o.id), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', e.created_at, 'kind', e.kind, 'from_status', e.from_status,
        'to_status', e.to_status, 'note', e.note) order by e.created_at, e.id)
      from public.order_events e
      where e.order_id = o.id and (e.visible_to_customer or v_is_staff)), '[]'::jsonb)
  );
end;
$$;

-- ── Complaints and reports ─────────────────────────────────────────────────

create or replace function public.file_complaint(
  p_category text,
  p_description text,
  p_order_number text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_id uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if p_order_number is not null then
    select id into v_order from public.orders
    where order_number = p_order_number and user_id = v_user;
    if v_order is null then
      perform private.fail('order_not_found');
    end if;
  end if;
  insert into public.complaints (user_id, order_id, category, description)
  values (v_user, v_order, p_category, trim(p_description))
  returning id into v_id;
  perform private.emit('complaint.filed', jsonb_build_object('complaint_id', v_id));
  return v_id;
exception
  when check_violation then
    perform private.fail('invalid_complaint');
end;
$$;

-- Notice-and-action: anyone can report a listing, a review or a seller.
create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null,
  p_email text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null and coalesce(trim(p_email), '') = '' then
    perform private.fail('contact_required');
  end if;
  insert into public.content_reports (reporter_id, reporter_email, target_type, target_id, reason, details)
  values (v_user, nullif(trim(p_email), ''), p_target_type, p_target_id, p_reason,
          nullif(trim(p_details), ''))
  returning id into v_id;
  perform private.emit('content.reported', jsonb_build_object('report_id', v_id));
  return v_id;
exception
  when check_violation then
    perform private.fail('invalid_report');
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────

grant execute on function
  public.list_categories(),
  public.list_districts(),
  public.get_product(text, text),
  public.reviewer_display_name(uuid),
  public.cart_lines(uuid[]),
  public.checkout_quote(jsonb, text),
  public.report_content(text, uuid, text, text, text)
to anon, authenticated;

grant execute on function
  public.my_roles(),
  public.my_profile(),
  public.update_profile(text, text, text, boolean),
  public.record_consent(text, text),
  public.my_addresses(),
  public.save_address(text, text, text, text, double precision, double precision, text, text, boolean, uuid),
  public.delete_address(uuid),
  public.my_orders(integer, integer),
  public.get_order(text),
  public.file_complaint(text, text, text)
to authenticated;
