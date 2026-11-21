-- Fixes for four limitations found while building the first version.
--
--   1. The fixed part of a payment fee was charged to every seller in an order.
--      It is now charged once per order and shared between the order's sellers.
--   2. Stock was added up across locations when shown, but a line of an order
--      had to ship from one location. A line can now be reserved from several
--      locations of the same offer, one parcel per location.
--   3. The shop could not answer "not found" for an unknown product or category
--      address before it started sending the page. A small existence check lets
--      it decide first.
--   4. Sellers could not change a listing after creating it. They can now edit
--      it; a published listing stays on sale unchanged while its edit waits for
--      catalogue staff.
--
-- Same rules as every other function: an empty search_path, the caller checked
-- first, errors as short codes, nothing callable until it is granted below.

-- ═══ 1. One fixed payment fee per order ════════════════════════════════════

comment on column public.fee_payment_methods.fixed_minor is
  'Flat amount per order (the gateway''s fixed fee, or cash handling). Charged once and shared between the order''s sellers in proportion to what each sold.';

-- Shares a fixed amount between sellers in proportion to their sales, to the
-- céntimo: each gets the whole céntimos of their proportion, and the céntimos
-- left over go one each to the largest remainders (ties: lowest seller id), so
-- the parts always add up to exactly the amount. Mirrored by
-- splitFixedPaymentFee in packages/core/src/fees.ts; the database tests and the
-- unit tests run the same cases through both.
create or replace function private.split_fixed_fee(
  p_fixed_minor bigint,
  p_sellers uuid[],
  p_weights bigint[]
) returns table (seller_id uuid, share_minor bigint)
language sql immutable
set search_path = ''
as $$
  with parties as (
    select s.seller_id, s.weight, (sum(s.weight) over ())::bigint as total
    from unnest(p_sellers, p_weights) as s (seller_id, weight)
  ),
  floored as (
    -- Whole-number arithmetic throughout: no rounding to disagree about.
    -- An order that sold nothing (every weight 0) has nothing to share the
    -- fee by: every seller's part is 0, as in splitFixedPaymentFee.
    select p.seller_id,
           case when p.total > 0 then (p_fixed_minor * p.weight) / p.total else 0 end as base,
           case when p.total > 0 then (p_fixed_minor * p.weight) % p.total else 0 end as remainder,
           p.total
    from parties p
  ),
  ranked as (
    select f.seller_id, f.base,
           row_number() over (order by f.remainder desc, f.seller_id) as position,
           case when f.total > 0 then p_fixed_minor - (sum(f.base) over ())::bigint else 0 end
             as left_over
    from floored f
  )
  select r.seller_id, r.base + case when r.position <= r.left_over then 1 else 0 end
  from ranked r;
$$;

create or replace function private.compute_seller_fees(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_schedule public.fee_schedules%rowtype;
  v_method public.payment_method;
  v_pay public.fee_payment_methods%rowtype;
  v_sellers uuid[];
  v_gross bigint[];
  r record;
  v_referral bigint;
  v_fulfillment bigint;
  v_payment bigint;
  v_net bigint;
  v_tax bigint;
begin
  select * into v_schedule from public.fee_schedules where active;
  if not found then
    perform private.fail('no_active_fee_schedule');
  end if;
  select payment_method into v_method from public.orders where id = p_order_id;
  select * into v_pay from public.fee_payment_methods
  where schedule_version = v_schedule.version and method = v_method;

  select array_agg(g.seller_id order by g.seller_id), array_agg(g.items_gross order by g.seller_id)
  into v_sellers, v_gross
  from (
    select i.seller_id, sum(i.line_total_minor)::bigint as items_gross
    from public.order_items i where i.order_id = p_order_id group by i.seller_id
  ) g;

  for r in
    select s.seller_id, v_gross[array_position(v_sellers, s.seller_id)] as items_gross,
           s.share_minor as fixed_share
    from private.split_fixed_fee(coalesce(v_pay.fixed_minor, 0), v_sellers, v_gross) s
    order by s.seller_id
  loop
    -- Referral: the category rate, floored per unit, and never more than the sale itself.
    select coalesce(sum(
      least(
        greatest(
          round(i.line_total_minor::numeric
                * coalesce(private.referral_bps_for_category(i.category_id), v_schedule.default_referral_bps)
                / 10000),
          v_schedule.min_referral_fee_per_unit_minor * i.quantity
        ),
        i.line_total_minor
      )
    ), 0)::bigint
    into v_referral
    from public.order_items i
    where i.order_id = p_order_id and i.seller_id = r.seller_id;

    -- Pick-pack-ship: smallest tier that fits, per unit, for platform-fulfilled lines.
    select coalesce(sum(i.quantity * (
      select t.fee_minor from public.fee_fulfillment_tiers t
      where t.schedule_version = v_schedule.version
        and i.weight_grams <= t.max_weight_grams
        and i.longest_side_cm <= t.max_longest_side_cm
      order by t.sort limit 1
    )), 0)::bigint
    into v_fulfillment
    from public.order_items i
    where i.order_id = p_order_id and i.seller_id = r.seller_id and i.fulfillment = 'platform';

    -- Collecting the money: the rate on what this seller sold, plus this
    -- seller's share of the one fixed amount the payment cost.
    v_payment := round(r.items_gross::numeric * coalesce(v_pay.bps, 0) / 10000)::bigint
                 + r.fixed_share;
    v_net := v_referral + v_fulfillment + v_payment;
    v_tax := round(v_net::numeric * v_schedule.fee_tax_bps / 10000)::bigint;

    insert into public.seller_order_fees
      (order_id, seller_id, schedule_version, items_gross_minor, referral_fee_minor,
       fulfillment_fee_minor, payment_fee_minor, fees_net_minor, fees_tax_minor, payout_minor)
    values
      (p_order_id, r.seller_id, v_schedule.version, r.items_gross, v_referral,
       v_fulfillment, v_payment, v_net, v_tax, r.items_gross - v_net - v_tax)
    on conflict (order_id, seller_id) do nothing;
  end loop;
end;
$$;

-- ═══ 2. A line can ship from several locations ═════════════════════════════
-- The shop shows an offer's stock added up across the locations it sells from.
-- An order can now take exactly that: when no single location has every unit
-- of a line, the line is reserved from several, fullest first, and each
-- location sends its own parcel — the same thing that already happens when an
-- order mixes warehouse items and a seller-shipped item. Everything downstream
-- (pick tasks, packing, cancelling, releasing) already worked per reservation
-- and per parcel, so only the reservation step changes.

create or replace function public.place_order(
  p_items jsonb,
  p_address_id uuid,
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_expected_total_minor bigint default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_existing public.orders%rowtype;
  v_addr public.addresses%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_zone_id text;
  v_max_units integer := (private.setting('max_units_per_line'))::integer;
  v_max_lines integer := (private.setting('max_lines_per_order'))::integer;
  v_cod_max bigint := (private.setting('cod_max_order_minor'))::bigint;
  v_prefix text := private.setting('order_number_prefix') #>> '{}';
  v_check record;
  v_shipping bigint;
  v_shipping_tax bigint;
  v_total bigint;
  v_promise record;
  v_order_id uuid;
  v_number text;
  v_pin text;
  v_today date := private.cr_local(now())::date;
  v_line record;
  v_node record;
  v_kind public.warehouse_kind;
  v_remaining integer;
  v_take integer;
  v_warehouse_seller uuid;
  v_item_id uuid;
  v_shipment uuid;
  v_sinpe_ref text;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;

  -- A retried request returns the order it already created.
  select * into v_existing from public.orders
  where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_id', v_existing.id, 'order_number', v_existing.order_number,
      'status', v_existing.status, 'total_minor', v_existing.total_minor, 'replayed', true);
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('cart_empty');
  end if;

  select * into v_addr from public.addresses
  where id = p_address_id and user_id = v_user and deleted_at is null;
  if not found then
    perform private.fail('address_not_found');
  end if;

  v_zone_id := private.zone_for_postal_code(v_addr.postal_code);
  select * into v_zone from public.delivery_zones where id = v_zone_id;
  if not found or not v_zone.active then
    perform private.fail('zone_not_served', v_addr.postal_code);
  end if;

  -- Pass 1: validate every line and price the order (shared with checkout_quote).
  select * into v_check from private.price_items(p_items, v_max_units);

  if v_check.line_count > v_max_lines then
    perform private.fail('too_many_lines');
  end if;
  if v_check.bad_quantity > 0 then
    perform private.fail('invalid_quantity');
  end if;
  if v_check.unavailable_offer is not null then
    perform private.fail('offer_unavailable', v_check.unavailable_offer::text);
  end if;

  select shipping_minor, shipping_tax_minor into v_shipping, v_shipping_tax
  from private.shipping_for(v_zone.id, v_check.items_total);
  v_total := v_check.items_total + v_shipping;

  if p_payment_method = 'cash_on_delivery'
     and (not v_zone.cod_available or v_total > v_cod_max) then
    perform private.fail('cod_not_available');
  end if;

  -- The shopper confirmed a specific total; if a price moved since, say so
  -- instead of charging a different amount.
  if p_expected_total_minor is not null and p_expected_total_minor <> v_total then
    perform private.fail('price_changed', v_total::text);
  end if;

  select * into v_promise from private.compute_promise(v_zone.id, v_check.handling_days);

  v_number := v_prefix || '-' || nextval('private.order_number_seq');
  v_pin := lpad(
    ((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::integer) % 10000)::text, 4, '0');

  insert into public.orders (
    order_number, user_id, status, items_total_minor, shipping_minor, total_minor,
    tax_included_minor, payment_method, zone_id,
    ship_recipient_name, ship_phone, ship_postal_code, ship_senas, ship_lat, ship_lng, ship_plus_code,
    promise_earliest, promise_latest, delivery_pin, withdrawal_deadline, idempotency_key,
    confirmed_at
  ) values (
    v_number, v_user,
    -- Cash on delivery is confirmed at once: there is nothing to wait for.
    case when p_payment_method = 'cash_on_delivery' then 'confirmed' else 'pending_payment' end::public.order_status,
    v_check.items_total, v_shipping, v_total,
    v_check.items_tax + v_shipping_tax, p_payment_method, v_zone.id,
    v_addr.recipient_name, v_addr.phone, v_addr.postal_code, v_addr.senas, v_addr.lat, v_addr.lng,
    v_addr.plus_code,
    v_promise.earliest, v_promise.latest, v_pin, private.add_business_days(v_today, 8),
    p_idempotency_key,
    case when p_payment_method = 'cash_on_delivery' then now() end
  )
  returning id into v_order_id;

  -- Pass 2: reserve stock and write the lines. Lines are taken in a fixed order
  -- (and, within a line, locations in a fixed order) so two concurrent
  -- checkouts lock stock rows in the same sequence and cannot deadlock.
  for v_line in
    with requested as (
      select (e ->> 'offer_id')::uuid as offer_id, sum((e ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e
      group by 1
    )
    select r.offer_id, r.quantity, o.price_minor, o.fulfillment, o.seller_id, o.sku_id,
           k.product_id, k.variant_name, k.weight_grams,
           greatest(k.length_cm, k.width_cm, k.height_cm) as longest_side_cm,
           p.title, p.tax_rate_bps, p.category_id,
           (select i.path from public.product_images i
            where i.product_id = p.id order by i.sort, i.id limit 1) as image_path
    from requested r
    join public.offers o on o.id = r.offer_id
    join public.skus k on k.id = o.sku_id
    join public.products p on p.id = k.product_id
    order by o.sku_id, o.seller_id
  loop
    v_kind := (case when v_line.fulfillment = 'platform' then 'platform' else 'seller' end)::public.warehouse_kind;

    -- Hold every location this offer sells from until the order commits. A
    -- concurrent order for the same stock waits here and then reads what is
    -- really left, so the last unit cannot be promised twice.
    perform 1
    from public.stock_levels l
    join public.warehouses w on w.id = l.warehouse_id
    where l.sku_id = v_line.sku_id and l.seller_id = v_line.seller_id
      and w.active and w.kind = v_kind
    order by l.warehouse_id
    for update of l;

    insert into public.order_items (
      order_id, offer_id, sku_id, product_id, seller_id, category_id, title, variant_name,
      image_path, unit_price_minor, quantity, line_total_minor, tax_rate_bps, tax_minor,
      fulfillment, weight_grams, longest_side_cm
    ) values (
      v_order_id, v_line.offer_id, v_line.sku_id, v_line.product_id, v_line.seller_id,
      v_line.category_id, v_line.title, v_line.variant_name, v_line.image_path,
      v_line.price_minor, v_line.quantity, v_line.price_minor * v_line.quantity,
      v_line.tax_rate_bps,
      (v_line.price_minor * v_line.quantity
        - round((v_line.price_minor * v_line.quantity)::numeric * 10000 / (10000 + v_line.tax_rate_bps)))::bigint,
      v_line.fulfillment, v_line.weight_grams, v_line.longest_side_cm
    )
    returning id into v_item_id;

    -- A location that can send the whole line is used on its own (one parcel);
    -- among those, the fullest. Otherwise the line is gathered from the fullest
    -- locations first, so it travels in as few parcels as the stock allows.
    v_remaining := v_line.quantity;
    for v_node in
      select l.warehouse_id, l.on_hand - l.reserved as available
      from public.stock_levels l
      join public.warehouses w on w.id = l.warehouse_id
      where l.sku_id = v_line.sku_id and l.seller_id = v_line.seller_id
        and w.active and w.kind = v_kind
        and l.on_hand - l.reserved > 0
      order by (l.on_hand - l.reserved >= v_line.quantity) desc,
               l.on_hand - l.reserved desc, l.warehouse_id
    loop
      exit when v_remaining = 0;
      v_take := least(v_node.available, v_remaining);

      update public.stock_levels
      set reserved = reserved + v_take
      where warehouse_id = v_node.warehouse_id
        and sku_id = v_line.sku_id and seller_id = v_line.seller_id;

      insert into public.inventory_reservations (order_item_id, warehouse_id, sku_id, seller_id, quantity)
      values (v_item_id, v_node.warehouse_id, v_line.sku_id, v_line.seller_id, v_take);

      -- One shipment per place the goods leave from.
      select s.id into v_shipment from public.shipments s
      where s.order_id = v_order_id and s.origin_warehouse_id = v_node.warehouse_id;
      if v_shipment is null then
        select w.seller_id into v_warehouse_seller
        from public.warehouses w where w.id = v_node.warehouse_id;
        insert into public.shipments (order_id, tracking_code, origin_warehouse_id, seller_id, promise_latest)
        values (v_order_id, v_prefix || nextval('private.tracking_seq'), v_node.warehouse_id,
                v_warehouse_seller, v_promise.latest)
        returning id into v_shipment;
      end if;

      insert into public.shipment_items (shipment_id, order_item_id, quantity)
      values (v_shipment, v_item_id, v_take);

      v_remaining := v_remaining - v_take;
      v_shipment := null;
    end loop;

    if v_remaining > 0 then
      -- All the locations together do not have the units: no order, nothing held.
      perform private.fail('insufficient_stock', v_line.offer_id::text);
    end if;
  end loop;

  v_sinpe_ref := case when p_payment_method = 'sinpe_movil' then split_part(v_number, '-', 2) end;
  insert into public.payments (order_id, method, provider, amount_minor, sinpe_reference)
  values (
    v_order_id, p_payment_method,
    case when p_payment_method = 'cash_on_delivery' then 'cash'
         else private.setting('payments_mode') #>> '{}' end,
    v_total, v_sinpe_ref);

  insert into public.order_events (order_id, kind, to_status, note, actor_id)
  values (v_order_id, 'note', null, 'Pedido recibido', v_user);

  perform private.emit('order.placed', jsonb_build_object('order_id', v_order_id));

  if p_payment_method = 'cash_on_delivery' then
    perform private.release_order_to_fulfillment(v_order_id);
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_number,
    'status', case when p_payment_method = 'cash_on_delivery' then 'confirmed' else 'pending_payment' end,
    'total_minor', v_total,
    'shipping_minor', v_shipping,
    'promise_earliest', v_promise.earliest,
    'promise_latest', v_promise.latest,
    'sinpe_reference', v_sinpe_ref,
    'replayed', false);
end;
$$;

-- A seller's sales, one row per line and parcel. A line that left from two
-- locations appears once for each, with the units and amount in that parcel,
-- so the rows of a line still add up to what was sold.
create or replace function public.seller_order_lines(
  p_seller_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  order_item_id uuid,
  order_number text,
  order_status public.order_status,
  placed_at timestamptz,
  promise_latest date,
  title text,
  variant_name text,
  quantity integer,
  unit_price_minor bigint,
  line_total_minor bigint,
  fulfillment public.fulfillment_type,
  shipment_id uuid,
  shipment_status public.shipment_status,
  tracking_code text,
  buyer_first_name text,
  district text,
  canton text
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.is_staff()) then
    perform private.fail('forbidden');
  end if;
  return query
    select i.id, o.order_number, o.status, o.placed_at, o.promise_latest, i.title, i.variant_name,
           coalesce(si.quantity, i.quantity), i.unit_price_minor,
           i.unit_price_minor * coalesce(si.quantity, i.quantity), i.fulfillment,
           s.id, s.status, s.tracking_code,
           -- First name and coarse location only: enough to write a thank-you note
           -- and plan stock by region, not enough to contact or find the shopper.
           split_part(trim(o.ship_recipient_name), ' ', 1),
           (select d.name from public.districts d where d.postal_code = o.ship_postal_code),
           (select c.name from public.districts d join public.cantons c on c.code = d.canton_code
            where d.postal_code = o.ship_postal_code)
    from public.order_items i
    join public.orders o on o.id = i.order_id
    left join public.shipment_items si on si.order_item_id = i.id
    left join public.shipments s on s.id = si.shipment_id
    where i.seller_id = p_seller_id
      and o.status not in ('pending_payment', 'payment_review')
    order by o.placed_at desc, i.id, s.created_at, s.id
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

-- ═══ 3. Does this shop address exist? ══════════════════════════════════════
-- Asked by the shop before it starts sending a product or category page, so an
-- unknown address can be answered with "not found" instead of a page. Runs
-- with the caller's rights and returns one boolean: it cannot reveal anything
-- a visitor could not already see by opening the page.
create or replace function public.shop_path_exists(p_kind text, p_slug text) returns boolean
language sql stable
set search_path = ''
as $$
  select case p_kind
    when 'product' then exists (
      select 1 from public.products p where p.slug = p_slug and p.status = 'active')
    when 'category' then exists (
      select 1 from public.categories c where c.slug = p_slug and c.active)
    else false
  end;
$$;

-- ═══ 4. Editing a listing ══════════════════════════════════════════════════
-- A listing that is not public yet (draft, in review, rejected) is changed in
-- place. A PUBLISHED listing is not: the seller's proposal is stored here and
-- the page stays exactly as it was until catalogue staff approve it. Proposals
-- live in their own table rather than on the product row because product rows
-- are readable by every visitor and an unreviewed text must not be.

create table public.product_change_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  seller_id uuid not null references public.sellers (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  -- What the seller wants the listing to say: title, description,
  -- bullet_points, category_slug, and the package of one variant.
  proposed jsonb not null,
  -- What the listing said before, kept when a proposal is approved.
  replaced jsonb,
  submitted_by uuid references auth.users (id),
  -- The clock, not the transaction's start: "the latest proposal" must be
  -- unambiguous even when two are made in one transaction.
  submitted_at timestamptz not null default clock_timestamp(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  -- Why it was rejected; the seller reads this as written.
  decision_reason text
);

-- One proposal waits per listing; a new one replaces the one before it.
create unique index product_change_requests_pending_idx
  on public.product_change_requests (product_id) where status = 'pending';
create index product_change_requests_product_idx
  on public.product_change_requests (product_id, submitted_at desc);

alter table public.product_change_requests enable row level security;
revoke all on public.product_change_requests from anon, authenticated;
-- Read-only through the API; proposals are made and decided by the functions below.
grant select on public.product_change_requests to authenticated;
create policy "listing owner, or catalogue staff" on public.product_change_requests
  for select to authenticated
  using ((select private.is_seller_member(seller_id))
         or (select private.has_staff_role('catalog')));

-- A seller may take their own rejected listing out of sight. (The first
-- version of this rule let a rejected listing move only to draft or review.)
create or replace function private.guard_product_status() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (new.status = 'active'
          or old.status = 'rejected' and new.status not in ('draft', 'pending_review', 'archived'))
     and (select auth.uid()) is not null
     and not private.has_staff_role('catalog') then
    raise exception using errcode = 'P0001', message = 'listing_needs_review';
  end if;
  if new.status = 'active' and old.status is distinct from 'active' then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

-- A published listing changes only through review. Sellers kept column
-- grants on products and skus (drafts are theirs to shape), so without this
-- a seller could rewrite a live page, or move it to a cheaper category or
-- package tier, straight through the table API and skip the review that
-- seller_update_listing queues. Catalogue staff, and the system itself (no
-- signed-in caller), are not limited; status changes keep their own guard.
create or replace function private.guard_live_listing() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
     and (select auth.uid()) is not null
     and not private.has_staff_role('catalog')
     and (new.slug, new.title, new.description, new.bullet_points, new.brand_id, new.category_id,
          new.attributes, new.tax_rate_bps, new.warranty_months, new.made_in_cr)
         is distinct from
         (old.slug, old.title, old.description, old.bullet_points, old.brand_id, old.category_id,
          old.attributes, old.tax_rate_bps, old.warranty_months, old.made_in_cr) then
    perform private.fail('published_listing_locked');
  end if;
  return new;
end;
$$;

create trigger products_guard_live_content before update on public.products
  for each row execute function private.guard_live_listing();

-- The same for a published listing's variants: their package decides the
-- warehouse fee, and a new variant would go on sale unreviewed. A seller may
-- still switch a variant on or off.
create or replace function private.guard_live_variant() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.has_staff_role('catalog') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.products p where p.id = new.product_id and p.status = 'active') then
      perform private.fail('published_listing_locked');
    end if;
  elsif (new.product_id, new.code, new.gtin, new.variant_name, new.variant_attributes,
         new.weight_grams, new.length_cm, new.width_cm, new.height_cm)
        is distinct from
        (old.product_id, old.code, old.gtin, old.variant_name, old.variant_attributes,
         old.weight_grams, old.length_cm, old.width_cm, old.height_cm)
        and exists (select 1 from public.products p
                    where p.id in (old.product_id, new.product_id) and p.status = 'active') then
    perform private.fail('published_listing_locked');
  end if;
  return new;
end;
$$;

create trigger skus_guard_live_variant before insert or update on public.skus
  for each row execute function private.guard_live_variant();

-- What a listing says, in the shape proposals are stored in.
create or replace function private.listing_content(p_product_id uuid, p_sku_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', p.title,
    'description', p.description,
    'bullet_points', to_jsonb(p.bullet_points),
    'category_slug', c.slug,
    'category_name', c.name_es,
    'sku_id', k.id,
    'weight_grams', k.weight_grams,
    'length_cm', k.length_cm,
    'width_cm', k.width_cm,
    'height_cm', k.height_cm)
  from public.products p
  join public.categories c on c.id = p.category_id
  join public.skus k on k.product_id = p.id and k.id = p_sku_id
  where p.id = p_product_id;
$$;

-- The listing a seller is about to edit: what it says now, what is waiting for
-- review, and what happened to their last proposal.
create or replace function public.seller_listing(p_product_id uuid, p_sku_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_sku uuid;
begin
  select * into p from public.products where id = p_product_id;
  -- The same answer for a listing that does not exist and one that belongs to someone else.
  if not found or p.created_by_seller_id is null
     or not (private.is_seller_member(p.created_by_seller_id) or private.has_staff_role('catalog')) then
    perform private.fail('listing_not_found');
  end if;

  select k.id into v_sku from public.skus k
  where k.product_id = p.id and (p_sku_id is null or k.id = p_sku_id)
  order by k.created_at, k.id limit 1;
  if v_sku is null then
    perform private.fail('listing_not_found');
  end if;

  return jsonb_build_object(
    'product_id', p.id,
    'slug', p.slug,
    'seller_id', p.created_by_seller_id,
    'status', p.status,
    'rejection_reason', p.rejection_reason,
    'content', private.listing_content(p.id, v_sku),
    'variants', (
      select jsonb_agg(jsonb_build_object('sku_id', k.id, 'sku_code', k.code, 'variant_name', k.variant_name)
                       order by k.created_at, k.id)
      from public.skus k where k.product_id = p.id),
    'pending', (
      select jsonb_build_object('request_id', r.id, 'submitted_at', r.submitted_at, 'proposed', r.proposed)
      from public.product_change_requests r
      where r.product_id = p.id and r.status = 'pending'),
    -- The latest proposal, when it was refused and nothing newer replaced it.
    'last_rejection', (
      select jsonb_build_object('decided_at', r.decided_at, 'reason', r.decision_reason, 'proposed', r.proposed)
      from (
        select r2.* from public.product_change_requests r2
        where r2.product_id = p.id order by r2.submitted_at desc, r2.id desc limit 1
      ) r
      where r.status = 'rejected'),
    -- Another seller also sells this product: its page is not this seller's alone to take down.
    'shared', exists (
      select 1 from public.offers o join public.skus k on k.id = o.sku_id
      where k.product_id = p.id and o.seller_id <> p.created_by_seller_id and o.status <> 'archived')
  );
end;
$$;

-- For the seller's list of products: which ones they may edit and whether a
-- change of theirs is waiting or was refused. One row per product they sell.
create or replace function public.seller_listing_edits(p_seller_id uuid)
returns table (
  product_id uuid, editable boolean, edit_status text, edit_reason text, edit_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.is_staff()) then
    perform private.fail('forbidden');
  end if;
  return query
    select p.id,
           p.created_by_seller_id = p_seller_id and p.status <> 'archived',
           case when latest.status in ('pending', 'rejected') then latest.status end,
           case when latest.status = 'rejected' then latest.decision_reason end,
           case latest.status when 'pending' then latest.submitted_at
                              when 'rejected' then latest.decided_at end
    from public.products p
    left join lateral (
      select r.status, r.decision_reason, r.submitted_at, r.decided_at
      from public.product_change_requests r
      where r.product_id = p.id and r.seller_id = p_seller_id
      order by r.submitted_at desc, r.id desc limit 1
    ) latest on true
    where exists (
      select 1 from public.offers o join public.skus k on k.id = o.sku_id
      where k.product_id = p.id and o.seller_id = p_seller_id and o.status <> 'archived');
end;
$$;

-- Changes a listing's title, description, characteristics, category and the
-- package of one variant. Price and stock are not here: they keep their own
-- functions and need no review.
create or replace function public.seller_update_listing(
  p_product_id uuid,
  p_title text,
  p_category_slug text,
  p_description text,
  p_bullet_points text[],
  p_weight_grams integer,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric,
  p_sku_id uuid default null,
  p_submit boolean default true
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_category public.categories%rowtype;
  v_sku uuid;
  v_title text := trim(p_title);
  v_description text := nullif(trim(p_description), '');
  v_bullets text[] := coalesce(p_bullet_points, '{}');
  -- The package is stored to a tenth of a centimetre; check what will be stored.
  v_length numeric := round(p_length_cm, 1);
  v_width numeric := round(p_width_cm, 1);
  v_height numeric := round(p_height_cm, 1);
  v_proposed jsonb;
  v_status public.product_status;
  v_request uuid;
begin
  select * into p from public.products where id = p_product_id for update;
  if not found or p.created_by_seller_id is null
     or not private.is_seller_member(p.created_by_seller_id) then
    perform private.fail('listing_not_found');
  end if;
  if p.status = 'archived' then
    perform private.fail('listing_not_editable');
  end if;

  select k.id into v_sku from public.skus k
  where k.product_id = p.id and (p_sku_id is null or k.id = p_sku_id)
  order by k.created_at, k.id limit 1;
  if v_sku is null then
    perform private.fail('listing_not_found');
  end if;

  select * into v_category from public.categories where slug = p_category_slug and active;
  if not found then
    perform private.fail('category_not_found');
  end if;

  -- The limits the tables enforce, on the values that will be stored, so that
  -- a proposal which waits for review can never fail when it is finally
  -- applied; plus the seller app's own limits (30 kg, 200 cm a side), so a
  -- direct call cannot store what the form would refuse. Every characteristic
  -- is a line of text: no empty ones, none longer than 300 characters.
  if coalesce(char_length(v_title), 0) not between 5 and 200
     or char_length(v_description) > 10000
     or cardinality(v_bullets) > 8
     or exists (select 1 from unnest(v_bullets) b
                where b is null or trim(b) = '' or char_length(b) > 300)
     or p_weight_grams is null or p_weight_grams <= 0 or p_weight_grams > 30000
     or v_length is null or v_length <= 0 or v_length > 200
     or v_width is null or v_width <= 0 or v_width > 200
     or v_height is null or v_height <= 0 or v_height > 200 then
    perform private.fail('invalid_listing');
  end if;
  v_bullets := array(select trim(b) from unnest(v_bullets) b);

  if p.status = 'active' then
    v_proposed := jsonb_build_object(
      'title', v_title,
      'description', v_description,
      'bullet_points', to_jsonb(v_bullets),
      'category_slug', v_category.slug,
      'category_name', v_category.name_es,
      'sku_id', v_sku,
      'weight_grams', p_weight_grams,
      'length_cm', v_length,
      'width_cm', v_width,
      'height_cm', v_height);
    if v_proposed = private.listing_content(p.id, v_sku) then
      perform private.fail('listing_unchanged');
    end if;

    -- A newer proposal replaces the one that was waiting. It gets a new id, so
    -- staff looking at the old one cannot approve text they have not read.
    update public.product_change_requests
    set status = 'withdrawn', decided_by = (select auth.uid()), decided_at = clock_timestamp()
    where product_id = p.id and status = 'pending';

    insert into public.product_change_requests (product_id, seller_id, proposed, submitted_by)
    values (p.id, p.created_by_seller_id, v_proposed, (select auth.uid()))
    returning id into v_request;

    perform private.emit('product.edit_submitted',
      jsonb_build_object('product_id', p.id, 'request_id', v_request));
    return jsonb_build_object('product_id', p.id, 'slug', p.slug, 'status', p.status,
                              'outcome', 'in_review');
  end if;

  -- Not public yet: change it in place. Sending it puts it in the review queue;
  -- saving without sending takes it out of the queue so the seller can keep working.
  v_status := case
    when p_submit then 'pending_review'
    when p.status = 'pending_review' then 'draft'
    else p.status
  end;

  update public.products
  set title = v_title,
      description = v_description,
      bullet_points = v_bullets,
      category_id = v_category.id,
      -- The tax rate came from the category when the listing was created; it follows a new one.
      tax_rate_bps = case when category_id is distinct from v_category.id
                          then v_category.default_tax_rate_bps else tax_rate_bps end,
      status = v_status,
      rejection_reason = case when p_submit then null else rejection_reason end
  where id = p.id;

  update public.skus
  set weight_grams = p_weight_grams, length_cm = v_length, width_cm = v_width,
      height_cm = v_height
  where id = v_sku;

  return jsonb_build_object('product_id', p.id, 'slug', p.slug, 'status', v_status,
                            'outcome', case when p_submit then 'submitted' else 'saved' end);
exception
  when check_violation or not_null_violation or numeric_value_out_of_range then
    perform private.fail('invalid_listing');
end;
$$;

-- The seller changes their mind about a proposal that is still waiting.
create or replace function public.seller_withdraw_listing_edit(p_product_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
begin
  select created_by_seller_id into v_seller from public.products where id = p_product_id;
  if v_seller is null or not private.is_seller_member(v_seller) then
    perform private.fail('listing_not_found');
  end if;

  update public.product_change_requests
  set status = 'withdrawn', decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where product_id = p_product_id and status = 'pending';
  if not found then
    perform private.fail('edit_not_found');
  end if;
end;
$$;

-- Takes a listing out of the shop. Its page stops existing for shoppers and
-- nothing on it can be bought; stock, past orders and statements are untouched.
-- Answers whether it changed anything: false when the listing was already
-- archived, so the caller need not tell the shop to refresh.
create or replace function public.seller_archive_listing(p_product_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
begin
  select * into p from public.products where id = p_product_id for update;
  if not found or p.created_by_seller_id is null
     or not private.is_seller_member(p.created_by_seller_id) then
    perform private.fail('listing_not_found');
  end if;
  if p.status = 'archived' then
    return false; -- already done; safe to call twice
  end if;
  -- The page is shared: another seller is selling from it. This seller can
  -- pause their own offer, but cannot take the page away from the other.
  if exists (
    select 1 from public.offers o join public.skus k on k.id = o.sku_id
    where k.product_id = p.id and o.seller_id <> p.created_by_seller_id and o.status <> 'archived'
  ) then
    perform private.fail('listing_shared');
  end if;

  update public.product_change_requests
  set status = 'withdrawn', decided_by = (select auth.uid()), decided_at = clock_timestamp()
  where product_id = p.id and status = 'pending';

  update public.products set status = 'archived' where id = p.id;

  perform private.emit('product.archived', jsonb_build_object('product_id', p.id));
  return true;
end;
$$;

-- A cart can still hold an offer whose listing has since been archived or
-- taken down. A visitor can no longer see that listing's rows, so the "can it
-- be bought" test came back unknown instead of "no", and the cart could not be
-- shown at all. Unknown now reads as no.
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
         coalesce(o.id is not null and o.status = 'active' and k.active and p.status = 'active'
                  and s.status = 'active' and o.available_quantity > 0, false),
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

-- Catalogue staff's queue of changes to published listings: for each, what the
-- page says now, what the seller proposes, and which fields differ.
create or replace function public.ops_listing_edits_for_review() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'request_id', x.id,
      'product_id', x.product_id,
      'slug', x.slug,
      'seller_name', x.trade_name,
      'submitted_at', x.submitted_at,
      'sku_code', x.sku_code,
      'variant_name', x.variant_name,
      'before', x.live,
      'after', x.proposed,
      'changed', (
        select coalesce(jsonb_agg(f.name order by f.position), '[]'::jsonb)
        from unnest(array['title', 'category_slug', 'bullet_points', 'description',
                          'weight_grams', 'length_cm', 'width_cm', 'height_cm'])
             with ordinality as f (name, position)
        where x.live -> f.name is distinct from x.proposed -> f.name)
    ) order by x.submitted_at, x.id)
    from (
      select r.id, r.product_id, r.submitted_at, r.proposed, p.slug, s.trade_name,
             k.code as sku_code, k.variant_name,
             private.listing_content(r.product_id, k.id) as live
      from public.product_change_requests r
      join public.products p on p.id = r.product_id
      join public.sellers s on s.id = r.seller_id
      join public.skus k on k.id = (r.proposed ->> 'sku_id')::uuid
      where r.status = 'pending'
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Catalogue staff approve a proposal (the listing changes at once) or reject
-- it with a reason the seller reads (the listing stays as it was).
create or replace function public.ops_review_listing_edit(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.product_change_requests%rowtype;
  p public.products%rowtype;
  v_category public.categories%rowtype;
  v_sku uuid;
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if not p_approve and coalesce(char_length(trim(p_reason)), 0) < 5 then
    -- The seller is owed an explanation they can act on.
    perform private.fail('reason_required');
  end if;

  select * into r from public.product_change_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    -- Already decided, withdrawn, or replaced by a newer proposal.
    perform private.fail('edit_not_found');
  end if;

  if not p_approve then
    update public.product_change_requests
    set status = 'rejected', decision_reason = trim(p_reason),
        decided_by = (select auth.uid()), decided_at = clock_timestamp()
    where id = r.id;
  else
    select * into p from public.products where id = r.product_id for update;
    if p.status <> 'active' then
      -- Taken down since the seller proposed this; there is no published page to change.
      perform private.fail('listing_not_editable');
    end if;
    select * into v_category from public.categories
    where slug = r.proposed ->> 'category_slug' and active;
    if not found then
      perform private.fail('category_not_found');
    end if;
    v_sku := (r.proposed ->> 'sku_id')::uuid;

    update public.product_change_requests
    set status = 'approved', replaced = private.listing_content(p.id, v_sku),
        decided_by = (select auth.uid()), decided_at = clock_timestamp()
    where id = r.id;

    update public.products
    set title = r.proposed ->> 'title',
        description = r.proposed ->> 'description',
        bullet_points = array(select jsonb_array_elements_text(r.proposed -> 'bullet_points')),
        category_id = v_category.id,
        tax_rate_bps = case when category_id is distinct from v_category.id
                            then v_category.default_tax_rate_bps else tax_rate_bps end
    where id = p.id;

    update public.skus
    set weight_grams = (r.proposed ->> 'weight_grams')::integer,
        length_cm = (r.proposed ->> 'length_cm')::numeric,
        width_cm = (r.proposed ->> 'width_cm')::numeric,
        height_cm = (r.proposed ->> 'height_cm')::numeric
    where id = v_sku and product_id = p.id;
  end if;

  perform private.emit('product.edit_reviewed',
    jsonb_build_object('product_id', r.product_id, 'request_id', r.id, 'approved', p_approve));
end;
$$;

-- ═══ Grants ════════════════════════════════════════════════════════════════

grant execute on function public.shop_path_exists(text, text) to anon, authenticated;

grant execute on function
  public.seller_listing(uuid, uuid),
  public.seller_listing_edits(uuid),
  public.seller_update_listing(uuid, text, text, text, text[], integer, numeric, numeric, numeric,
                               uuid, boolean),
  public.seller_withdraw_listing_edit(uuid),
  public.seller_archive_listing(uuid),
  public.ops_listing_edits_for_review(),
  public.ops_review_listing_edit(uuid, boolean, text)
to authenticated;
