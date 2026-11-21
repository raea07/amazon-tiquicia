-- Last-mile delivery: routes, stops, proof of delivery and cash reconciliation.
--
-- Privacy rule built into the shape of the data: a driver never reads the
-- orders table. Each stop carries a copy of only what is needed at the door
-- (name, phone, directions, pin location, cash to collect), and a driver can
-- read stops only on routes assigned to them.

create sequence private.route_code_seq start 1001;

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  service_date date not null,
  depot_warehouse_id uuid not null references public.warehouses (id),
  driver_id uuid references public.drivers (id),
  status public.route_status not null default 'draft',
  planned_km numeric(7, 2),
  planned_minutes integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A route that is being driven must have a driver.
  check (status in ('draft', 'cancelled') or driver_id is not null)
);

create index routes_driver_idx on public.routes (driver_id, service_date desc);
create index routes_date_idx on public.routes (service_date, status);

create trigger routes_updated_at before update on public.routes
  for each row execute function private.set_updated_at();

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  shipment_id uuid not null references public.shipments (id),
  sequence smallint not null check (sequence > 0),
  status public.stop_status not null default 'pending',
  -- Minutes after route start the driver is expected to arrive.
  eta_minute integer,

  -- What the driver needs at the door, copied from the order.
  recipient_name text not null,
  phone text not null,
  senas text not null,
  lat double precision not null,
  lng double precision not null,
  plus_code text,
  package_count smallint not null default 1,
  cod_amount_minor bigint not null default 0 check (cod_amount_minor >= 0),

  arrived_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  -- Proof of delivery.
  pod_recipient_name text,
  pod_photo_path text,
  pod_lat double precision,
  pod_lng double precision,
  cod_collected_minor bigint not null default 0 check (cod_collected_minor >= 0),
  pin_attempts smallint not null default 0,

  unique (route_id, sequence),
  unique (route_id, shipment_id)
);

-- A parcel can be on only one route at a time.
create unique index route_stops_active_shipment_idx on public.route_stops (shipment_id)
  where status in ('pending', 'arrived');

-- Latest known position per driver, for the dispatch map. History is not kept:
-- we track parcels, not people.
create table public.driver_positions (
  driver_id uuid primary key references public.drivers (id) on delete cascade,
  lat double precision not null check (lat between 8.0 and 11.25),
  lng double precision not null check (lng between -86.0 and -82.5),
  accuracy_m real,
  recorded_at timestamptz not null default now()
);

-- End-of-route cash count: what the driver collected against what they handed in.
create table public.driver_settlements (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null unique references public.routes (id) on delete cascade,
  driver_id uuid not null references public.drivers (id),
  cod_expected_minor bigint not null check (cod_expected_minor >= 0),
  cod_handed_minor bigint check (cod_handed_minor >= 0),
  status text not null default 'open' check (status in ('open', 'settled', 'short')),
  note text,
  settled_by uuid references auth.users (id),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function private.drives_route(p_route_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.routes r
    join public.drivers d on d.id = r.driver_id
    where r.id = p_route_id and d.user_id = (select auth.uid()) and d.status = 'active'
  );
$$;
