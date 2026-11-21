-- Orders, payments, shipments and the lifecycle rules that bind them.
--
-- An ORDER is what the shopper bought and owes. It is split into SHIPMENTS, one
-- per place the goods leave from. Stock is RESERVED the instant the order is
-- placed and CONSUMED when the parcel is packed, so two shoppers can never be
-- sold the same last unit.

create sequence private.order_number_seq start 100001;
create sequence private.tracking_seq start 500001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users (id),
  status public.order_status not null default 'pending_payment',
  currency char(3) not null default 'CRC' check (currency = 'CRC'),

  items_total_minor bigint not null check (items_total_minor >= 0),
  shipping_minor bigint not null check (shipping_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null,
  -- IVA contained in the total, shown in the price breakdown the law requires.
  tax_included_minor bigint not null check (tax_included_minor >= 0),
  payment_method public.payment_method not null,

  -- Delivery details are copied from the address at purchase time: editing or
  -- deleting the address later must not change where an order was sent.
  zone_id text not null references public.delivery_zones (id),
  ship_recipient_name text not null,
  ship_phone text not null,
  ship_postal_code text not null,
  ship_senas text not null,
  ship_lat double precision not null,
  ship_lng double precision not null,
  ship_plus_code text,

  promise_earliest date not null,
  promise_latest date not null,
  -- The shopper reads this code to the driver; it is the proof of delivery.
  delivery_pin text not null check (delivery_pin ~ '^[0-9]{4}$'),
  -- Last day the shopper may withdraw from the purchase. The law counts 8 business
  -- days from the sale; our policy restarts the count at delivery, which is never
  -- shorter. Set at purchase and extended when the order is delivered.
  withdrawal_deadline date not null,
  -- Legal warranty runs 30 business days from delivery; set when delivered.
  warranty_until date,

  risk_score smallint check (risk_score between 0 and 100),
  risk_decision text check (risk_decision in ('approve', 'step_up', 'review', 'decline')),

  -- Client-generated key: retrying a timed-out checkout returns the same order.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),

  placed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now(),

  unique (user_id, idempotency_key),
  constraint orders_total_adds_up check (total_minor = items_total_minor + shipping_minor - discount_minor),
  constraint orders_promise_ordered check (promise_latest >= promise_earliest)
);

create index orders_user_idx on public.orders (user_id, placed_at desc);
create index orders_status_idx on public.orders (status, placed_at desc);

create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  offer_id uuid not null references public.offers (id),
  sku_id uuid not null references public.skus (id),
  product_id uuid not null references public.products (id),
  seller_id uuid not null references public.sellers (id),
  category_id uuid not null references public.categories (id),
  -- Copies of what the shopper saw, so the order reads the same forever.
  title text not null,
  variant_name text not null default '',
  image_path text,
  unit_price_minor bigint not null check (unit_price_minor > 0),
  quantity integer not null check (quantity > 0),
  line_total_minor bigint not null,
  tax_rate_bps integer not null,
  tax_minor bigint not null check (tax_minor >= 0),
  fulfillment public.fulfillment_type not null,
  weight_grams integer not null,
  longest_side_cm numeric(6, 1) not null,
  constraint order_items_total check (line_total_minor = unit_price_minor * quantity)
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_seller_idx on public.order_items (seller_id);
create index order_items_product_idx on public.order_items (product_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  method public.payment_method not null,
  -- Which integration handled it. No card data is ever stored here or anywhere
  -- else in this database: cards are entered on the gateway's hosted fields.
  provider text not null default 'sandbox',
  status public.payment_status not null default 'pending',
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'CRC',
  provider_reference text,
  -- Code the shopper puts in the SINPE Móvil description so the transfer can be matched.
  sinpe_reference text,
  failure_reason text,
  created_at timestamptz not null default now(),
  captured_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id);
create unique index payments_provider_ref_idx on public.payments (provider, provider_reference)
  where provider_reference is not null;

create trigger payments_updated_at before update on public.payments
  for each row execute function private.set_updated_at();

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  tracking_code text not null unique,
  origin_warehouse_id uuid not null references public.warehouses (id),
  -- Set when the parcel leaves from a seller's own location.
  seller_id uuid references public.sellers (id),
  status public.shipment_status not null default 'pending',
  package_count smallint not null default 1 check (package_count between 1 and 20),
  weight_grams integer check (weight_grams > 0),
  promise_latest date not null,
  attempt_count smallint not null default 0,
  packed_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shipments_order_idx on public.shipments (order_id);
create index shipments_origin_status_idx on public.shipments (origin_warehouse_id, status);
create index shipments_seller_idx on public.shipments (seller_id) where seller_id is not null;

create trigger shipments_updated_at before update on public.shipments
  for each row execute function private.set_updated_at();

create table public.shipment_items (
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  primary key (shipment_id, order_item_id)
);

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id),
  sku_id uuid not null references public.skus (id),
  seller_id uuid not null references public.sellers (id),
  quantity integer not null check (quantity > 0),
  status public.reservation_status not null default 'active',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index reservations_item_idx on public.inventory_reservations (order_item_id);
create index reservations_active_idx on public.inventory_reservations (warehouse_id, sku_id, seller_id)
  where status = 'active';

create table public.pick_tasks (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id),
  sku_id uuid not null references public.skus (id),
  seller_id uuid not null references public.sellers (id),
  -- Suggested bin; null when stock was never put away to a bin.
  location_id uuid references public.warehouse_locations (id),
  quantity integer not null check (quantity > 0),
  picked_quantity integer not null default 0 check (picked_quantity >= 0),
  status public.pick_status not null default 'open',
  picked_by uuid references auth.users (id),
  picked_at timestamptz,
  created_at timestamptz not null default now(),
  check (picked_quantity <= quantity)
);

create index pick_tasks_shipment_idx on public.pick_tasks (shipment_id);
create index pick_tasks_open_idx on public.pick_tasks (warehouse_id, status)
  where status in ('open', 'in_progress');

-- Timeline of what happened to an order. `visible_to_customer` rows are the
-- tracking history the shopper sees.
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  shipment_id uuid references public.shipments (id) on delete cascade,
  kind text not null check (kind in ('order_status', 'shipment_status', 'payment', 'note')),
  from_status text,
  to_status text,
  note text,
  visible_to_customer boolean not null default true,
  actor_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

-- Messages for work that happens outside the transaction: e-mails, electronic
-- invoices, gateway refunds, search indexing. Written in the same transaction as
-- the change they describe, so an event exists if and only if the change committed.
create table private.outbox_events (
  id bigint generated always as identity primary key,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts smallint not null default 0,
  last_error text
);

create index outbox_unprocessed_idx on private.outbox_events (id) where processed_at is null;

create or replace function private.emit(p_topic text, p_payload jsonb) returns void
language sql security definer
set search_path = ''
as $$
  insert into private.outbox_events (topic, payload) values (p_topic, p_payload);
$$;

-- ── Lifecycle rules ────────────────────────────────────────────────────────
-- The allowed transitions. packages/core/src/lifecycle.ts holds the same tables
-- for the clients, and a unit test parses the two blocks below to make sure
-- they never drift apart.

create or replace function private.order_transition_allowed(
  p_from public.order_status, p_to public.order_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    -- BEGIN order_transitions
    ('pending_payment', 'payment_review'),
    ('pending_payment', 'confirmed'),
    ('pending_payment', 'cancelled'),
    ('payment_review', 'confirmed'),
    ('payment_review', 'cancelled'),
    ('confirmed', 'processing'),
    ('confirmed', 'cancelled'),
    ('processing', 'partially_shipped'),
    ('processing', 'shipped'),
    ('processing', 'cancelled'),
    ('partially_shipped', 'shipped'),
    ('partially_shipped', 'delivered'),
    ('shipped', 'delivered'),
    ('delivered', 'completed'),
    ('delivered', 'refunded'),
    ('completed', 'refunded'),
    ('cancelled', 'refunded')
    -- END order_transitions
  );
$$;

create or replace function private.shipment_transition_allowed(
  p_from public.shipment_status, p_to public.shipment_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    -- BEGIN shipment_transitions
    ('pending', 'picking'),
    ('pending', 'cancelled'),
    ('picking', 'packed'),
    ('picking', 'pending'),
    ('picking', 'cancelled'),
    ('packed', 'ready_for_dispatch'),
    ('packed', 'cancelled'),
    ('ready_for_dispatch', 'out_for_delivery'),
    ('ready_for_dispatch', 'cancelled'),
    ('out_for_delivery', 'delivered'),
    ('out_for_delivery', 'delivery_failed'),
    ('delivery_failed', 'ready_for_dispatch'),
    ('delivery_failed', 'returning'),
    ('returning', 'returned')
    -- END shipment_transitions
  );
$$;

create or replace function private.enforce_order_transition() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not private.order_transition_allowed(old.status, new.status) then
      raise exception using
        errcode = 'P0001',
        message = 'invalid_order_transition',
        detail = old.status::text || ' -> ' || new.status::text;
    end if;
    insert into public.order_events (order_id, kind, from_status, to_status, actor_id)
    values (new.id, 'order_status', old.status::text, new.status::text, (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger orders_enforce_transition before update of status on public.orders
  for each row execute function private.enforce_order_transition();

create or replace function private.enforce_shipment_transition() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not private.shipment_transition_allowed(old.status, new.status) then
      raise exception using
        errcode = 'P0001',
        message = 'invalid_shipment_transition',
        detail = old.status::text || ' -> ' || new.status::text;
    end if;
    insert into public.order_events (order_id, shipment_id, kind, from_status, to_status, actor_id)
    values (new.order_id, new.id, 'shipment_status', old.status::text, new.status::text,
            (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger shipments_enforce_transition before update of status on public.shipments
  for each row execute function private.enforce_shipment_transition();

-- Derives an order's status from its shipments (orderStatusFromShipments in
-- packages/core/src/lifecycle.ts). Payment-owned and final statuses are left alone.
create or replace function private.sync_order_status(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_current public.order_status;
  v_live integer;
  v_delivered integer;
  v_dispatched integer;
  v_started integer;
  v_target public.order_status;
begin
  select status into v_current from public.orders where id = p_order_id for update;
  if v_current in ('pending_payment', 'payment_review', 'cancelled', 'refunded', 'completed') then
    return;
  end if;

  select count(*) filter (where status <> 'cancelled'),
         count(*) filter (where status = 'delivered'),
         count(*) filter (where status in
           ('out_for_delivery', 'delivered', 'delivery_failed', 'returning', 'returned')),
         count(*) filter (where status not in ('pending', 'cancelled'))
  into v_live, v_delivered, v_dispatched, v_started
  from public.shipments where order_id = p_order_id;

  if v_live = 0 then
    return;
  end if;

  v_target := case
    when v_delivered = v_live then 'delivered'
    when v_dispatched = v_live then 'shipped'
    when v_dispatched > 0 then 'partially_shipped'
    when v_started > 0 then 'processing'
    else v_current
  end;

  -- Walk forward one legal step at a time so the history shows each stage.
  while v_current is distinct from v_target loop
    v_current := case
      when v_current = 'confirmed' then 'processing'
      when v_current = 'processing' and v_target = 'partially_shipped' then 'partially_shipped'
      when v_current = 'processing' then 'shipped'
      when v_current = 'partially_shipped' and v_target = 'delivered' then 'delivered'
      when v_current = 'partially_shipped' then 'shipped'
      when v_current = 'shipped' then 'delivered'
      else v_target
    end;
    update public.orders
    set status = v_current,
        delivered_at = case when v_current = 'delivered' then now() else delivered_at end,
        warranty_until = case
          when v_current = 'delivered' then private.add_business_days(private.cr_local(now())::date, 30)
          else warranty_until
        end,
        withdrawal_deadline = case
          when v_current = 'delivered'
            then greatest(withdrawal_deadline, private.add_business_days(private.cr_local(now())::date, 8))
          else withdrawal_deadline
        end
    where id = p_order_id;
  end loop;
end;
$$;

-- Business days are Monday to Friday, skipping the operations calendar's holidays.
create or replace function private.add_business_days(p_from date, p_days integer) returns date
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_day date := p_from;
  v_left integer := p_days;
begin
  while v_left > 0 loop
    v_day := v_day + 1;
    if extract(dow from v_day) between 1 and 5
       and not exists (select 1 from public.holidays h where h.day = v_day) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_day;
end;
$$;
