-- Inventory and warehouse management.
--
-- Two views of the same stock:
--   stock_levels  how many units a seller has at a site and how many are
--                 promised to orders. This is what availability is sold from.
--   bin_stock     where inside a platform warehouse those units physically sit.
--
-- Every change to either is recorded in stock_movements, an append-only ledger:
-- the current numbers can always be explained, and rebuilt, from the history.

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{2,12}$'),
  name text not null,
  kind public.warehouse_kind not null,
  -- Set for a seller's own stock location; null for platform warehouses.
  seller_id uuid references public.sellers (id) on delete cascade,
  address text not null,
  postal_code text references public.districts (postal_code),
  lat double precision not null check (lat between 8.0 and 11.25),
  lng double precision not null check (lng between -86.0 and -82.5),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'seller') = (seller_id is not null))
);

create index warehouses_seller_idx on public.warehouses (seller_id) where seller_id is not null;

create table public.warehouse_staff (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'associate' check (role in ('associate', 'lead')),
  created_at timestamptz not null default now(),
  primary key (warehouse_id, user_id)
);

create index warehouse_staff_user_idx on public.warehouse_staff (user_id);

create or replace function private.my_warehouse_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select w.warehouse_id from public.warehouse_staff w where w.user_id = (select auth.uid());
$$;

create or replace function private.works_at(p_warehouse_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.warehouse_staff w
    where w.warehouse_id = p_warehouse_id and w.user_id = (select auth.uid())
  );
$$;

-- Storage locations. Codes read aisle-bay-level-position, e.g. A-03-2-B.
create table public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9-]{1,20}$'),
  kind public.location_kind not null default 'storage',
  active boolean not null default true,
  unique (warehouse_id, code)
);

create table public.stock_levels (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  sku_id uuid not null references public.skus (id) on delete restrict,
  seller_id uuid not null references public.sellers (id) on delete restrict,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, sku_id, seller_id),
  -- The invariant that prevents overselling.
  constraint stock_reserved_within_on_hand check (reserved <= on_hand)
);

create index stock_levels_sku_seller_idx on public.stock_levels (sku_id, seller_id);

create table public.bin_stock (
  location_id uuid not null references public.warehouse_locations (id) on delete restrict,
  sku_id uuid not null references public.skus (id) on delete restrict,
  seller_id uuid not null references public.sellers (id) on delete restrict,
  quantity integer not null check (quantity >= 0),
  primary key (location_id, sku_id, seller_id)
);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  warehouse_id uuid not null references public.warehouses (id),
  sku_id uuid not null references public.skus (id),
  seller_id uuid not null references public.sellers (id),
  from_location_id uuid references public.warehouse_locations (id),
  to_location_id uuid references public.warehouse_locations (id),
  -- Signed change to on-hand stock at the warehouse. 0 for moves between bins.
  on_hand_delta integer not null,
  quantity integer not null check (quantity > 0),
  reason public.movement_reason not null,
  reference_type text,
  reference_id uuid,
  note text,
  actor_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index stock_movements_sku_idx on public.stock_movements (sku_id, created_at desc);
create index stock_movements_ref_idx on public.stock_movements (reference_type, reference_id);

-- The ledger is append-only for everyone, including table owners acting through the API.
create or replace function private.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Rows in % are immutable', tg_table_name using errcode = 'P0001';
end;
$$;

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function private.forbid_change();

-- ── Availability roll-up ───────────────────────────────────────────────────
-- An offer sells from the stock nodes that match its fulfilment type: platform
-- warehouses for platform-fulfilled offers, the seller's own locations otherwise.

create or replace function private.refresh_offer_availability(p_sku_id uuid, p_seller_id uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.offers o
  set available_quantity = coalesce((
    select sum(l.on_hand - l.reserved)
    from public.stock_levels l
    join public.warehouses w on w.id = l.warehouse_id
    where l.sku_id = o.sku_id
      and l.seller_id = o.seller_id
      and w.active
      and w.kind = (case when o.fulfillment = 'platform' then 'platform' else 'seller' end)::public.warehouse_kind
  ), 0)
  where o.sku_id = p_sku_id and o.seller_id = p_seller_id;
$$;

create or replace function private.stock_levels_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_offer_availability(old.sku_id, old.seller_id);
  else
    new.updated_at := now();
    perform private.refresh_offer_availability(new.sku_id, new.seller_id);
  end if;
  return null;
end;
$$;

create trigger stock_levels_availability
  after insert or update or delete on public.stock_levels
  for each row execute function private.stock_levels_trigger();

-- Changing how an offer is fulfilled changes which stock counts toward it.
create or replace function private.offers_availability_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.refresh_offer_availability(new.sku_id, new.seller_id);
  return null;
end;
$$;

create trigger offers_availability_refresh
  after insert or update of fulfillment on public.offers
  for each row execute function private.offers_availability_trigger();

-- ── Inbound shipments (seller stock arriving at a platform warehouse) ──────

create table public.inbound_shipments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  seller_id uuid not null references public.sellers (id),
  warehouse_id uuid not null references public.warehouses (id),
  status public.inbound_status not null default 'draft',
  expected_on date,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  received_at timestamptz
);

create index inbound_shipments_seller_idx on public.inbound_shipments (seller_id);
create index inbound_shipments_warehouse_idx on public.inbound_shipments (warehouse_id, status);

create table public.inbound_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  inbound_shipment_id uuid not null references public.inbound_shipments (id) on delete cascade,
  sku_id uuid not null references public.skus (id),
  expected_quantity integer not null check (expected_quantity > 0),
  received_quantity integer not null default 0 check (received_quantity >= 0),
  damaged_quantity integer not null default 0 check (damaged_quantity >= 0),
  unique (inbound_shipment_id, sku_id)
);

create sequence private.inbound_reference_seq start 1000;

-- ── Stock operations ───────────────────────────────────────────────────────

-- Internal: applies an on-hand change at a warehouse and writes the ledger row.
create or replace function private.apply_stock_change(
  p_warehouse_id uuid,
  p_sku_id uuid,
  p_seller_id uuid,
  p_delta integer,
  p_reason public.movement_reason,
  p_location_id uuid default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_delta = 0 then
    return;
  end if;

  if p_delta > 0 then
    insert into public.stock_levels (warehouse_id, sku_id, seller_id, on_hand)
    values (p_warehouse_id, p_sku_id, p_seller_id, p_delta)
    on conflict (warehouse_id, sku_id, seller_id)
    do update set on_hand = public.stock_levels.on_hand + p_delta;
  else
    -- Removing stock that was never recorded is an error, not a no-op.
    update public.stock_levels
    set on_hand = on_hand + p_delta
    where warehouse_id = p_warehouse_id and sku_id = p_sku_id and seller_id = p_seller_id;
    if not found then
      perform private.fail('insufficient_stock');
    end if;
  end if;

  if p_location_id is not null then
    if p_delta > 0 then
      insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
      values (p_location_id, p_sku_id, p_seller_id, p_delta)
      on conflict (location_id, sku_id, seller_id)
      do update set quantity = public.bin_stock.quantity + p_delta;
    else
      update public.bin_stock
      set quantity = quantity + p_delta
      where location_id = p_location_id and sku_id = p_sku_id and seller_id = p_seller_id;
      if not found then
        perform private.fail('insufficient_stock');
      end if;
    end if;
  end if;

  insert into public.stock_movements
    (warehouse_id, sku_id, seller_id, from_location_id, to_location_id, on_hand_delta, quantity,
     reason, reference_type, reference_id, note, actor_id)
  values
    (p_warehouse_id, p_sku_id, p_seller_id,
     case when p_delta < 0 then p_location_id end,
     case when p_delta > 0 then p_location_id end,
     p_delta, abs(p_delta), p_reason, p_reference_type, p_reference_id, p_note, (select auth.uid()));
exception
  when check_violation then
    perform private.fail('insufficient_stock');
end;
$$;

-- A seller sets the stock they hold at their own location (seller-fulfilled offers).
create or replace function public.seller_set_stock(
  p_warehouse_id uuid,
  p_sku_id uuid,
  p_quantity integer
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
  v_current integer;
  v_reserved integer;
begin
  select w.seller_id into v_seller
  from public.warehouses w
  where w.id = p_warehouse_id and w.kind = 'seller' and w.active;

  if v_seller is null or not private.is_seller_member(v_seller) then
    perform private.fail('forbidden');
  end if;
  if p_quantity < 0 or p_quantity > 100000 then
    perform private.fail('invalid_quantity');
  end if;
  if not exists (
    select 1 from public.offers o where o.sku_id = p_sku_id and o.seller_id = v_seller
  ) then
    perform private.fail('offer_not_found');
  end if;

  select l.on_hand, l.reserved into v_current, v_reserved
  from public.stock_levels l
  where l.warehouse_id = p_warehouse_id and l.sku_id = p_sku_id and l.seller_id = v_seller
  for update;

  if p_quantity < coalesce(v_reserved, 0) then
    -- Units already promised to shoppers cannot be counted away.
    perform private.fail('below_reserved', coalesce(v_reserved, 0)::text);
  end if;

  perform private.apply_stock_change(
    p_warehouse_id, p_sku_id, v_seller, p_quantity - coalesce(v_current, 0), 'adjust',
    null, 'seller_count', null, 'Conteo del vendedor');
end;
$$;

-- A seller announces stock they are sending to a platform warehouse.
create or replace function public.seller_create_inbound(
  p_warehouse_id uuid,
  p_seller_id uuid,
  p_lines jsonb,
  p_expected_on date default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_line record;
begin
  if not private.is_seller_member(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  if not exists (
    select 1 from public.warehouses w where w.id = p_warehouse_id and w.kind = 'platform' and w.active
  ) then
    perform private.fail('warehouse_not_found');
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.fail('invalid_lines');
  end if;

  insert into public.inbound_shipments (reference, seller_id, warehouse_id, status, expected_on, created_by)
  values ('IN-' || nextval('private.inbound_reference_seq'), p_seller_id, p_warehouse_id,
          'in_transit', p_expected_on, (select auth.uid()))
  returning id into v_id;

  for v_line in
    select (l ->> 'sku_id')::uuid as sku_id, (l ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_lines) l
  loop
    if v_line.quantity is null or v_line.quantity <= 0 then
      perform private.fail('invalid_quantity');
    end if;
    -- A seller can only send in SKUs they have an offer on.
    if not exists (
      select 1 from public.offers o where o.sku_id = v_line.sku_id and o.seller_id = p_seller_id
    ) then
      perform private.fail('offer_not_found', v_line.sku_id::text);
    end if;
    insert into public.inbound_shipment_lines (inbound_shipment_id, sku_id, expected_quantity)
    values (v_id, v_line.sku_id, v_line.quantity);
  end loop;

  return v_id;
end;
$$;

-- Warehouse staff count a line in at the dock and put it away in one step.
create or replace function public.wms_receive(
  p_inbound_line_id uuid,
  p_good_quantity integer,
  p_damaged_quantity integer,
  p_location_id uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_line record;
begin
  select l.id, l.sku_id, s.id as shipment_id, s.seller_id, s.warehouse_id, s.status
  into v_line
  from public.inbound_shipment_lines l
  join public.inbound_shipments s on s.id = l.inbound_shipment_id
  where l.id = p_inbound_line_id
  for update of l;

  if not found then
    perform private.fail('inbound_line_not_found');
  end if;
  if not (private.works_at(v_line.warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  if v_line.status not in ('in_transit', 'receiving') then
    perform private.fail('inbound_not_receivable', v_line.status::text);
  end if;
  if p_good_quantity < 0 or p_damaged_quantity < 0 or p_good_quantity + p_damaged_quantity = 0 then
    perform private.fail('invalid_quantity');
  end if;
  if not exists (
    select 1 from public.warehouse_locations wl
    where wl.id = p_location_id and wl.warehouse_id = v_line.warehouse_id and wl.active
  ) then
    perform private.fail('location_not_found');
  end if;

  update public.inbound_shipment_lines
  set received_quantity = received_quantity + p_good_quantity,
      damaged_quantity = damaged_quantity + p_damaged_quantity
  where id = p_inbound_line_id;

  -- Damaged units are recorded but never become sellable stock.
  perform private.apply_stock_change(
    v_line.warehouse_id, v_line.sku_id, v_line.seller_id, p_good_quantity, 'receive',
    p_location_id, 'inbound_shipment', v_line.shipment_id);

  update public.inbound_shipments s
  set status = case
        when not exists (
          select 1 from public.inbound_shipment_lines x
          where x.inbound_shipment_id = s.id
            and x.received_quantity + x.damaged_quantity < x.expected_quantity
        ) then 'received'::public.inbound_status
        else 'receiving'::public.inbound_status
      end,
      received_at = case
        when not exists (
          select 1 from public.inbound_shipment_lines x
          where x.inbound_shipment_id = s.id
            and x.received_quantity + x.damaged_quantity < x.expected_quantity
        ) then now()
      end
  where s.id = v_line.shipment_id;
end;
$$;

-- Cycle-count correction by warehouse staff.
create or replace function public.wms_adjust_stock(
  p_location_id uuid,
  p_sku_id uuid,
  p_seller_id uuid,
  p_delta integer,
  p_note text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_warehouse uuid;
begin
  select wl.warehouse_id into v_warehouse
  from public.warehouse_locations wl where wl.id = p_location_id;

  if v_warehouse is null then
    perform private.fail('location_not_found');
  end if;
  if not (private.works_at(v_warehouse) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  if p_delta = 0 or abs(p_delta) > 10000 or coalesce(char_length(trim(p_note)), 0) < 5 then
    -- Every correction needs a reason someone can read later.
    perform private.fail('invalid_adjustment');
  end if;

  perform private.apply_stock_change(
    v_warehouse, p_sku_id, p_seller_id, p_delta,
    case when p_delta < 0 then 'damage'::public.movement_reason else 'adjust'::public.movement_reason end,
    p_location_id, 'cycle_count', null, p_note);
end;
$$;
