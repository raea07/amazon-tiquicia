-- The operations API: seller centre, warehouse, driver app and internal console.
-- Same design as the shopper API: one function per screen, each checking who is
-- asking before it returns anything.

-- ═══ Seller centre ═════════════════════════════════════════════════════════

create or replace function public.seller_overview(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s public.sellers%rowtype;
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('ops', 'support', 'finance')) then
    perform private.fail('forbidden');
  end if;
  select * into s from public.sellers where id = p_seller_id;

  return jsonb_build_object(
    'seller', jsonb_build_object(
      'id', s.id, 'slug', s.slug, 'trade_name', s.trade_name, 'description', s.description,
      'status', s.status, 'score', s.score, 'health', s.health, 'approved_at', s.approved_at),
    'account', (
      select jsonb_build_object(
        'legal_name', sp.legal_name, 'id_type', sp.id_type, 'id_number', sp.id_number,
        'tax_regime', sp.tax_regime, 'contact_email', sp.contact_email,
        'contact_phone', sp.contact_phone, 'fiscal_address', sp.fiscal_address,
        'kyc_status', sp.kyc_status, 'kyc_notes', sp.kyc_notes,
        -- Enough of the account number to recognise it; never the whole thing.
        'payout_iban_masked', case when sp.payout_iban is null then null
                                   else 'CR•• •••• •••• •••• ' || right(sp.payout_iban, 4) end,
        'payout_holder_name', sp.payout_holder_name,
        'sinpe_movil_number', sp.sinpe_movil_number)
      from public.seller_private sp where sp.seller_id = p_seller_id),
    'counts', jsonb_build_object(
      'listings_active', (select count(*) from public.products where created_by_seller_id = p_seller_id and status = 'active'),
      'listings_in_review', (select count(*) from public.products where created_by_seller_id = p_seller_id and status = 'pending_review'),
      'listings_rejected', (select count(*) from public.products where created_by_seller_id = p_seller_id and status = 'rejected'),
      'offers_out_of_stock', (select count(*) from public.offers where seller_id = p_seller_id and status = 'active' and available_quantity = 0),
      'to_pack', (select count(*) from public.shipments sh
                  join public.orders o on o.id = sh.order_id
                  where sh.seller_id = p_seller_id and sh.status = 'pending'
                    and o.status in ('confirmed', 'processing', 'partially_shipped')),
      'open_returns', (select count(*) from public.return_requests rr
                       join public.order_items i on i.id = rr.order_item_id
                       where i.seller_id = p_seller_id and rr.status in ('requested', 'approved', 'received'))),
    'sales_30d', (
      select jsonb_build_object(
        'orders', count(distinct o.id), 'units', coalesce(sum(i.quantity), 0),
        'gross_minor', coalesce(sum(i.line_total_minor), 0))
      from public.order_items i join public.orders o on o.id = i.order_id
      where i.seller_id = p_seller_id and o.placed_at > now() - interval '30 days'
        and o.status not in ('pending_payment', 'payment_review', 'cancelled', 'refunded')),
    -- What the platform currently owes this seller, straight from the ledger.
    'payable_minor', coalesce((
      select -sum(e.amount_minor) from public.ledger_entries e
      join public.ledger_accounts a on a.id = e.account_id
      where a.seller_id = p_seller_id), 0)
  );
end;
$$;

-- One row per offer, with the listing it belongs to.
create or replace function public.seller_listings(p_seller_id uuid)
returns table (
  product_id uuid, product_slug text, title text, product_status public.product_status,
  rejection_reason text, category_slug text, image_path text,
  sku_id uuid, sku_code text, variant_name text,
  offer_id uuid, price_minor bigint, list_price_minor bigint, offer_status public.offer_status,
  fulfillment public.fulfillment_type, handling_days smallint, available_quantity integer,
  is_featured boolean, competing_offers bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.is_staff()) then
    perform private.fail('forbidden');
  end if;
  return query
    select p.id, p.slug, p.title, p.status, p.rejection_reason, c.slug,
           (select i.path from public.product_images i where i.product_id = p.id order by i.sort, i.id limit 1),
           k.id, k.code, k.variant_name,
           o.id, o.price_minor, o.list_price_minor, o.status, o.fulfillment, o.handling_days,
           o.available_quantity,
           p.featured_offer_id = o.id,
           (select count(*) from public.offers o2 join public.sellers s2 on s2.id = o2.seller_id
            where o2.sku_id = k.id and o2.id <> o.id and o2.status = 'active' and s2.status = 'active')
    from public.offers o
    join public.skus k on k.id = o.sku_id
    join public.products p on p.id = k.product_id
    join public.categories c on c.id = p.category_id
    where o.seller_id = p_seller_id and o.status <> 'archived'
    order by p.title, k.variant_name;
end;
$$;

-- Creates a listing with one variant and the seller's offer on it, in one step.
-- It is saved as a draft or sent for review; only catalogue staff publish.
create or replace function public.seller_create_listing(
  p_seller_id uuid,
  p_title text,
  p_category_slug text,
  p_description text,
  p_bullet_points text[],
  p_price_minor bigint,
  p_fulfillment public.fulfillment_type,
  p_handling_days smallint,
  p_weight_grams integer,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric,
  p_submit boolean default true
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_category public.categories%rowtype;
  v_slug text;
  v_product uuid;
  v_sku uuid;
  v_offer uuid;
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  select * into v_category from public.categories where slug = p_category_slug and active;
  if not found then
    perform private.fail('category_not_found');
  end if;

  -- A readable, unique address for the product page.
  v_slug := trim(both '-' from regexp_replace(private.fold(p_title), '[^a-z0-9]+', '-', 'g'));
  v_slug := left(v_slug, 100);
  if v_slug = '' then
    perform private.fail('invalid_listing');
  end if;
  if exists (select 1 from public.products where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.products
    (slug, title, description, bullet_points, category_id, status, created_by_seller_id, tax_rate_bps)
  values
    (v_slug, trim(p_title), nullif(trim(p_description), ''), coalesce(p_bullet_points, '{}'),
     v_category.id, case when p_submit then 'pending_review' else 'draft' end::public.product_status,
     p_seller_id, v_category.default_tax_rate_bps)
  returning id into v_product;

  insert into public.skus (product_id, code, weight_grams, length_cm, width_cm, height_cm)
  values (v_product, 'YT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
          p_weight_grams, p_length_cm, p_width_cm, p_height_cm)
  returning id into v_sku;

  insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days)
  values (v_sku, p_seller_id, p_price_minor, p_fulfillment,
          case when p_fulfillment = 'platform' then 0 else p_handling_days end)
  returning id into v_offer;

  return jsonb_build_object('product_id', v_product, 'slug', v_slug, 'sku_id', v_sku, 'offer_id', v_offer);
exception
  when check_violation or not_null_violation then
    perform private.fail('invalid_listing');
end;
$$;

create or replace function public.seller_update_offer(
  p_offer_id uuid,
  p_price_minor bigint,
  p_status public.offer_status,
  p_handling_days smallint default null,
  p_list_price_minor bigint default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
begin
  select seller_id into v_seller from public.offers where id = p_offer_id;
  if v_seller is null or not private.is_seller_member(v_seller) then
    perform private.fail('offer_not_found');
  end if;
  update public.offers
  set price_minor = p_price_minor,
      list_price_minor = p_list_price_minor,
      status = p_status,
      handling_days = case when fulfillment = 'platform' then 0
                           else coalesce(p_handling_days, handling_days) end
  where id = p_offer_id;
exception
  when check_violation then
    -- Price must be positive, and a "regular price" must be higher than the price.
    perform private.fail('invalid_offer');
end;
$$;

create or replace function public.seller_stock(p_seller_id uuid)
returns table (
  warehouse_id uuid, warehouse_code text, warehouse_name text, warehouse_kind public.warehouse_kind,
  sku_id uuid, sku_code text, title text, variant_name text,
  on_hand integer, reserved integer, available integer
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('ops', 'support')) then
    perform private.fail('forbidden');
  end if;
  return query
    select w.id, w.code, w.name, w.kind, k.id, k.code, p.title, k.variant_name,
           l.on_hand, l.reserved, l.on_hand - l.reserved
    from public.stock_levels l
    join public.warehouses w on w.id = l.warehouse_id
    join public.skus k on k.id = l.sku_id
    join public.products p on p.id = k.product_id
    where l.seller_id = p_seller_id
    order by w.kind, w.code, p.title, k.variant_name;
end;
$$;

-- The seller's statement: per order, what was sold, every fee, and what is owed.
create or replace function public.seller_statements(
  p_seller_id uuid, p_limit integer default 50, p_offset integer default 0
) returns table (
  order_number text, placed_at timestamptz, order_status public.order_status,
  payment_method public.payment_method, schedule_version text,
  items_gross_minor bigint, referral_fee_minor bigint, fulfillment_fee_minor bigint,
  payment_fee_minor bigint, fees_net_minor bigint, fees_tax_minor bigint, payout_minor bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('finance')) then
    perform private.fail('forbidden');
  end if;
  return query
    select o.order_number, o.placed_at, o.status, o.payment_method, f.schedule_version,
           f.items_gross_minor, f.referral_fee_minor, f.fulfillment_fee_minor, f.payment_fee_minor,
           f.fees_net_minor, f.fees_tax_minor, f.payout_minor
    from public.seller_order_fees f
    join public.orders o on o.id = f.order_id
    where f.seller_id = p_seller_id
    order by o.placed_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

-- Parcels this seller has to prepare from their own location.
create or replace function public.seller_to_pack(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shipment_id', sh.id, 'tracking_code', sh.tracking_code, 'status', sh.status,
      'order_number', o.order_number, 'placed_at', o.placed_at, 'promise_latest', sh.promise_latest,
      'origin', w.name,
      'items', (
        select jsonb_agg(jsonb_build_object(
          'title', i.title, 'variant_name', i.variant_name, 'quantity', si.quantity,
          'sku_code', k.code, 'image_path', i.image_path) order by i.title)
        from public.shipment_items si
        join public.order_items i on i.id = si.order_item_id
        join public.skus k on k.id = i.sku_id
        where si.shipment_id = sh.id)
    ) order by sh.promise_latest, o.placed_at)
    from public.shipments sh
    join public.orders o on o.id = sh.order_id
    join public.warehouses w on w.id = sh.origin_warehouse_id
    where sh.seller_id = p_seller_id
      and sh.status in ('pending', 'packed')
      and o.status in ('confirmed', 'processing', 'partially_shipped')
  ), '[]'::jsonb);
end;
$$;

-- ═══ Warehouse ═════════════════════════════════════════════════════════════

-- Everything on the floor right now, grouped by what has to happen next.
create or replace function public.wms_board(p_warehouse_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;

  return jsonb_build_object(
    'warehouse', (select jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name)
                  from public.warehouses w where w.id = p_warehouse_id),
    'shipments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shipment_id', sh.id, 'tracking_code', sh.tracking_code, 'status', sh.status,
        'order_number', o.order_number, 'promise_latest', sh.promise_latest,
        'placed_at', o.placed_at,
        'units', (select coalesce(sum(si.quantity), 0) from public.shipment_items si where si.shipment_id = sh.id),
        'lines', (select count(*) from public.shipment_items si where si.shipment_id = sh.id),
        'short', exists (select 1 from public.pick_tasks t where t.shipment_id = sh.id and t.status = 'short')
      ) order by sh.promise_latest, o.placed_at)
      from public.shipments sh
      join public.orders o on o.id = sh.order_id
      where sh.origin_warehouse_id = p_warehouse_id
        and sh.status in ('pending', 'picking', 'packed', 'ready_for_dispatch')
        and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')
    ), '[]'::jsonb),
    'inbound', coalesce((
      select jsonb_agg(jsonb_build_object(
        'inbound_id', ib.id, 'reference', ib.reference, 'status', ib.status,
        'expected_on', ib.expected_on, 'seller_name', s.trade_name,
        'lines', (
          select jsonb_agg(jsonb_build_object(
            'line_id', l.id, 'sku_code', k.code, 'title', p.title, 'variant_name', k.variant_name,
            'expected', l.expected_quantity, 'received', l.received_quantity,
            'damaged', l.damaged_quantity) order by p.title)
          from public.inbound_shipment_lines l
          join public.skus k on k.id = l.sku_id
          join public.products p on p.id = k.product_id
          where l.inbound_shipment_id = ib.id)
      ) order by ib.expected_on nulls last, ib.created_at)
      from public.inbound_shipments ib
      join public.sellers s on s.id = ib.seller_id
      where ib.warehouse_id = p_warehouse_id and ib.status in ('in_transit', 'receiving')
    ), '[]'::jsonb)
  );
end;
$$;

-- One parcel's pick list, in walking order (bin code), for the handheld.
create or replace function public.wms_shipment(p_shipment_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  sh public.shipments%rowtype;
begin
  select * into sh from public.shipments where id = p_shipment_id;
  if not found or not (private.works_at(sh.origin_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('shipment_not_found');
  end if;

  return jsonb_build_object(
    'shipment_id', sh.id, 'tracking_code', sh.tracking_code, 'status', sh.status,
    'order_number', (select o.order_number from public.orders o where o.id = sh.order_id),
    'promise_latest', sh.promise_latest, 'package_count', sh.package_count,
    'weight_grams', sh.weight_grams,
    'expected_weight_grams', (
      select coalesce(sum(i.weight_grams * si.quantity), 0)
      from public.shipment_items si join public.order_items i on i.id = si.order_item_id
      where si.shipment_id = sh.id),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'task_id', t.id, 'status', t.status, 'quantity', t.quantity,
        'picked_quantity', t.picked_quantity, 'location_id', t.location_id,
        'location_code', wl.code, 'sku_code', k.code, 'gtin', k.gtin,
        'title', i.title, 'variant_name', i.variant_name, 'image_path', i.image_path
      ) order by wl.code nulls last, i.title)
      from public.pick_tasks t
      join public.order_items i on i.id = t.order_item_id
      join public.skus k on k.id = t.sku_id
      left join public.warehouse_locations wl on wl.id = t.location_id
      where t.shipment_id = sh.id), '[]'::jsonb)
  );
end;
$$;

-- Barcode lookup: what is this, and where is it kept here?
create or replace function public.wms_find_sku(p_warehouse_id uuid, p_code text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  return (
    select jsonb_build_object(
      'sku_id', k.id, 'sku_code', k.code, 'gtin', k.gtin, 'title', p.title,
      'variant_name', k.variant_name,
      'bins', coalesce((
        select jsonb_agg(jsonb_build_object(
          'location_id', wl.id, 'location_code', wl.code, 'seller_id', b.seller_id,
          'seller_name', s.trade_name, 'quantity', b.quantity) order by wl.code)
        from public.bin_stock b
        join public.warehouse_locations wl on wl.id = b.location_id
        join public.sellers s on s.id = b.seller_id
        where b.sku_id = k.id and wl.warehouse_id = p_warehouse_id and b.quantity > 0), '[]'::jsonb))
    from public.skus k join public.products p on p.id = k.product_id
    where k.code = upper(trim(p_code)) or k.gtin = trim(p_code)
    limit 1);
end;
$$;

create or replace function public.wms_locations(p_warehouse_id uuid)
returns table (id uuid, code text, kind public.location_kind)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  return query
    select wl.id, wl.code, wl.kind from public.warehouse_locations wl
    where wl.warehouse_id = p_warehouse_id and wl.active order by wl.kind, wl.code;
end;
$$;

-- ═══ Driver ════════════════════════════════════════════════════════════════

-- The driver's day: their routes and, for each, the stops in order with what is
-- needed at the door. Never includes the delivery PIN — the shopper holds that.
create or replace function public.driver_today() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  d public.drivers%rowtype;
begin
  select * into d from public.drivers where user_id = (select auth.uid());
  if not found then
    perform private.fail('not_a_driver');
  end if;

  return jsonb_build_object(
    'driver', jsonb_build_object(
      'id', d.id, 'full_name', d.full_name, 'status', d.status, 'vehicle_type', d.vehicle_type,
      'plate', d.plate),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route_id', r.id, 'code', r.code, 'status', r.status, 'service_date', r.service_date,
        'planned_km', r.planned_km, 'planned_minutes', r.planned_minutes,
        'started_at', r.started_at, 'completed_at', r.completed_at,
        'depot', (select jsonb_build_object('name', w.name, 'address', w.address, 'lat', w.lat, 'lng', w.lng)
                  from public.warehouses w where w.id = r.depot_warehouse_id),
        'cash_to_hand_in_minor', (select coalesce(sum(rs.cod_collected_minor), 0)
                                  from public.route_stops rs where rs.route_id = r.id),
        'stops', coalesce((
          select jsonb_agg(jsonb_build_object(
            'stop_id', rs.id, 'sequence', rs.sequence, 'status', rs.status,
            'eta_minute', rs.eta_minute, 'recipient_name', rs.recipient_name, 'phone', rs.phone,
            'senas', rs.senas, 'lat', rs.lat, 'lng', rs.lng, 'plus_code', rs.plus_code,
            'package_count', rs.package_count, 'cod_amount_minor', rs.cod_amount_minor,
            'cod_collected_minor', rs.cod_collected_minor, 'failure_reason', rs.failure_reason,
            'pin_attempts_left', greatest(0, 5 - rs.pin_attempts),
            'tracking_code', sh.tracking_code, 'completed_at', rs.completed_at
          ) order by rs.sequence)
          from public.route_stops rs join public.shipments sh on sh.id = rs.shipment_id
          where rs.route_id = r.id), '[]'::jsonb)
      ) order by (r.status = 'in_progress') desc, (r.status = 'assigned') desc, r.service_date desc, r.code)
      from public.routes r
      where r.driver_id = d.id
        -- Same window as the row-level policy: live routes, and finished ones for a day.
        and (r.status in ('assigned', 'in_progress')
             or (r.status = 'completed' and r.completed_at > now() - interval '24 hours'))
    ), '[]'::jsonb)
  );
end;
$$;

-- ═══ Internal console ══════════════════════════════════════════════════════

create or replace function public.ops_overview() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'orders', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select o.status::text, count(*) as n from public.orders o group by 1) s),
    'orders_today', (select count(*) from public.orders
                     where private.cr_local(placed_at)::date = private.cr_local(now())::date),
    'revenue_today_minor', (select coalesce(sum(total_minor), 0) from public.orders
                            where private.cr_local(placed_at)::date = private.cr_local(now())::date
                              and status not in ('cancelled', 'refunded', 'pending_payment')),
    'late_shipments', (select count(*) from public.shipments
                       where status not in ('delivered', 'cancelled', 'returned')
                         and promise_latest < private.cr_local(now())::date),
    'awaiting_dispatch', (select count(*) from public.shipments where status = 'packed'),
    'failed_deliveries', (select count(*) from public.shipments where status = 'delivery_failed'),
    'sellers_pending', (select count(*) from public.sellers where status = 'pending'),
    'listings_in_review', (select count(*) from public.products where status = 'pending_review'),
    'open_complaints', (select count(*) from public.complaints where status <> 'resolved'),
    'open_returns', (select count(*) from public.return_requests where status in ('requested', 'approved', 'received')),
    'open_reports', (select count(*) from public.content_reports where status in ('open', 'in_review')),
    'open_settlements', (select count(*) from public.driver_settlements where status = 'open'),
    'payments_mode', private.setting('payments_mode') #>> '{}'
  );
end;
$$;

create or replace function public.ops_orders(
  p_status public.order_status default null,
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  order_number text, status public.order_status, placed_at timestamptz, total_minor bigint,
  payment_method public.payment_method, payment_status public.payment_status,
  recipient_name text, canton text, promise_latest date, shipment_statuses text[],
  is_late boolean
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops', 'support', 'finance') then
    perform private.fail('forbidden');
  end if;
  return query
    select o.order_number, o.status, o.placed_at, o.total_minor, o.payment_method,
           (select p.status from public.payments p where p.order_id = o.id order by p.created_at desc limit 1),
           o.ship_recipient_name,
           (select c.name from public.districts d join public.cantons c on c.code = d.canton_code
            where d.postal_code = o.ship_postal_code),
           o.promise_latest,
           array(select s.status::text from public.shipments s where s.order_id = o.id order by s.created_at),
           (o.status not in ('delivered', 'completed', 'cancelled', 'refunded')
            and o.promise_latest < private.cr_local(now())::date)
    from public.orders o
    where (p_status is null or o.status = p_status)
      and (coalesce(trim(p_query), '') = ''
           or o.order_number ilike '%' || private.like_escape(trim(p_query)) || '%'
           or private.fold(o.ship_recipient_name) like '%' || private.like_escape(private.fold(trim(p_query))) || '%')
    order by o.placed_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.ops_sellers(p_status public.seller_status default null)
returns table (
  id uuid, slug text, trade_name text, status public.seller_status, score smallint, health text,
  legal_name text, id_type public.identification_type, id_number text, tax_regime text,
  contact_email text, contact_phone text, kyc_status public.kyc_status, created_at timestamptz,
  listings bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops', 'support', 'finance') then
    perform private.fail('forbidden');
  end if;
  return query
    select s.id, s.slug, s.trade_name, s.status, s.score, s.health, sp.legal_name, sp.id_type,
           sp.id_number, sp.tax_regime, sp.contact_email, sp.contact_phone, sp.kyc_status, s.created_at,
           (select count(*) from public.products p where p.created_by_seller_id = s.id)
    from public.sellers s join public.seller_private sp on sp.seller_id = s.id
    where p_status is null or s.status = p_status
    order by (s.status = 'pending') desc, s.created_at desc;
end;
$$;

create or replace function public.ops_listings_for_review()
returns table (
  product_id uuid, slug text, title text, description text, bullet_points text[],
  category_slug text, seller_name text, seller_status public.seller_status,
  price_minor bigint, created_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return query
    select p.id, p.slug, p.title, p.description, p.bullet_points, c.slug, s.trade_name, s.status,
           (select min(o.price_minor) from public.offers o join public.skus k on k.id = o.sku_id
            where k.product_id = p.id),
           p.created_at
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.sellers s on s.id = p.created_by_seller_id
    where p.status = 'pending_review'
    order by p.created_at;
end;
$$;

-- The dispatcher's board for a day: parcels ready to go, who can take them,
-- and the routes already built.
create or replace function public.ops_dispatch_board(p_date date default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, private.cr_local(now())::date);
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;

  return jsonb_build_object(
    'date', v_date,
    'depots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'code', w.code, 'name', w.name, 'lat', w.lat, 'lng', w.lng) order by w.code)
      from public.warehouses w where w.kind = 'platform' and w.active), '[]'::jsonb),
    'ready', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shipment_id', sh.id, 'tracking_code', sh.tracking_code, 'status', sh.status,
        'order_number', o.order_number, 'origin_code', w.code, 'origin_kind', w.kind,
        'recipient_name', o.ship_recipient_name, 'lat', o.ship_lat, 'lng', o.ship_lng,
        'canton', (select c.name from public.districts d join public.cantons c on c.code = d.canton_code
                   where d.postal_code = o.ship_postal_code),
        'weight_grams', coalesce(sh.weight_grams, 1000), 'package_count', sh.package_count,
        'promise_latest', sh.promise_latest, 'attempt_count', sh.attempt_count,
        'cash_on_delivery', o.payment_method = 'cash_on_delivery'
      ) order by sh.promise_latest, o.placed_at)
      from public.shipments sh
      join public.orders o on o.id = sh.order_id
      join public.warehouses w on w.id = sh.origin_warehouse_id
      where sh.status in ('packed', 'delivery_failed')
        and not exists (select 1 from public.route_stops rs
                        where rs.shipment_id = sh.id and rs.status in ('pending', 'arrived'))
    ), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'full_name', d.full_name, 'vehicle_type', d.vehicle_type,
        'capacity_kg', d.capacity_kg, 'phone', d.phone,
        'active_routes', (select count(*) from public.routes r
                          where r.driver_id = d.id and r.status in ('assigned', 'in_progress')),
        'position', (select jsonb_build_object('lat', dp.lat, 'lng', dp.lng, 'recorded_at', dp.recorded_at)
                     from public.driver_positions dp where dp.driver_id = d.id)
      ) order by d.full_name)
      from public.drivers d where d.status = 'active'), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route_id', r.id, 'code', r.code, 'status', r.status, 'service_date', r.service_date,
        'driver_name', (select d.full_name from public.drivers d where d.id = r.driver_id),
        'planned_km', r.planned_km, 'planned_minutes', r.planned_minutes,
        'started_at', r.started_at, 'completed_at', r.completed_at,
        'stops', coalesce((
          select jsonb_agg(jsonb_build_object(
            'stop_id', rs.id, 'sequence', rs.sequence, 'status', rs.status,
            'recipient_name', rs.recipient_name, 'lat', rs.lat, 'lng', rs.lng,
            'tracking_code', sh.tracking_code, 'cod_amount_minor', rs.cod_amount_minor,
            'failure_reason', rs.failure_reason, 'completed_at', rs.completed_at
          ) order by rs.sequence)
          from public.route_stops rs join public.shipments sh on sh.id = rs.shipment_id
          where rs.route_id = r.id), '[]'::jsonb)
      ) order by (r.status = 'in_progress') desc, r.code desc)
      from public.routes r
      where r.service_date = v_date or r.status in ('draft', 'assigned', 'in_progress')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.ops_settlements(p_status text default 'open')
returns table (
  route_id uuid, route_code text, service_date date, driver_name text,
  cod_expected_minor bigint, cod_handed_minor bigint, status text, note text,
  settled_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops', 'finance') then
    perform private.fail('forbidden');
  end if;
  return query
    select r.id, r.code, r.service_date, d.full_name, s.cod_expected_minor, s.cod_handed_minor,
           s.status, s.note, s.settled_at
    from public.driver_settlements s
    join public.routes r on r.id = s.route_id
    join public.drivers d on d.id = s.driver_id
    where p_status is null or s.status = p_status
    order by r.service_date desc, r.code desc
    limit 200;
end;
$$;

-- The customer-care queues: complaints, returns, content reports.
create or replace function public.ops_care_queues() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('support', 'catalog') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category', c.category, 'description', c.description, 'status', c.status,
        'created_at', c.created_at,
        'order_number', (select o.order_number from public.orders o where o.id = c.order_id),
        'customer', (select p.full_name from public.profiles p where p.id = c.user_id)
      ) order by c.created_at)
      from public.complaints c where c.status <> 'resolved'), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rr.id, 'kind', rr.kind, 'quantity', rr.quantity, 'reason', rr.reason,
        'status', rr.status, 'refund_due_on', rr.refund_due_on, 'created_at', rr.created_at,
        'title', i.title, 'order_number', o.order_number,
        'seller_name', (select s.trade_name from public.sellers s where s.id = i.seller_id)
      ) order by rr.refund_due_on nulls last, rr.created_at)
      from public.return_requests rr
      join public.order_items i on i.id = rr.order_item_id
      join public.orders o on o.id = i.order_id
      where rr.status in ('requested', 'approved', 'received')), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cr.id, 'target_type', cr.target_type, 'target_id', cr.target_id, 'reason', cr.reason,
        'details', cr.details, 'status', cr.status, 'created_at', cr.created_at
      ) order by cr.created_at)
      from public.content_reports cr where cr.status in ('open', 'in_review')), '[]'::jsonb)
  );
end;
$$;

-- ═══ Grants ════════════════════════════════════════════════════════════════

grant execute on function
  public.seller_overview(uuid),
  public.seller_listings(uuid),
  public.seller_create_listing(uuid, text, text, text, text[], bigint, public.fulfillment_type,
                               smallint, integer, numeric, numeric, numeric, boolean),
  public.seller_update_offer(uuid, bigint, public.offer_status, smallint, bigint),
  public.seller_stock(uuid),
  public.seller_statements(uuid, integer, integer),
  public.seller_to_pack(uuid),
  public.wms_board(uuid),
  public.wms_shipment(uuid),
  public.wms_find_sku(uuid, text),
  public.wms_locations(uuid),
  public.driver_today(),
  public.ops_overview(),
  public.ops_orders(public.order_status, text, integer, integer),
  public.ops_sellers(public.seller_status),
  public.ops_listings_for_review(),
  public.ops_dispatch_board(date),
  public.ops_settlements(text),
  public.ops_care_queues()
to authenticated;
