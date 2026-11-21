-- Finance: the published fee schedule, a double-entry ledger, seller statements,
-- payouts and electronic-invoice records.
--
-- The fee rules are specified and unit-tested in packages/core/src/fees.ts.
-- They are implemented again here because money must be posted inside the same
-- transaction that confirms a payment; the database tests replay the TypeScript
-- test cases so the two cannot disagree silently.

create table public.fee_schedules (
  version text primary key,
  active boolean not null default false,
  default_referral_bps integer not null check (default_referral_bps between 0 and 5000),
  min_referral_fee_per_unit_minor bigint not null check (min_referral_fee_per_unit_minor >= 0),
  -- IVA charged on the platform's fees (they are a service invoiced to the seller).
  fee_tax_bps integer not null default 1300,
  effective_from date not null,
  notes text
);

create unique index fee_schedules_one_active_idx on public.fee_schedules (active) where active;

create table public.fee_payment_methods (
  schedule_version text not null references public.fee_schedules (version) on delete cascade,
  method public.payment_method not null,
  bps integer not null check (bps between 0 and 2000),
  -- Flat amount per seller-order, covering the gateway's fixed fee or cash handling.
  fixed_minor bigint not null default 0 check (fixed_minor >= 0),
  primary key (schedule_version, method)
);

create table public.fee_fulfillment_tiers (
  schedule_version text not null references public.fee_schedules (version) on delete cascade,
  id text not null,
  max_weight_grams integer not null check (max_weight_grams > 0),
  max_longest_side_cm numeric(6, 1) not null check (max_longest_side_cm > 0),
  fee_minor bigint not null check (fee_minor >= 0),
  sort smallint not null,
  primary key (schedule_version, id)
);

-- Working assumptions, regrounded on published gateway costs
-- (docs/research/costa-rica-fact-sheet.md §5). Not a decided price list.
insert into public.fee_schedules
  (version, active, default_referral_bps, min_referral_fee_per_unit_minor, fee_tax_bps, effective_from, notes)
values
  ('2026-11-assumptions', true, 1200, 15000, 1300, '2026-11-01',
   'Planning assumptions pending validation with pilot sellers.');

insert into public.fee_payment_methods (schedule_version, method, bps, fixed_minor) values
  ('2026-11-assumptions', 'card', 390, 18000),
  ('2026-11-assumptions', 'sinpe_movil', 150, 0),
  ('2026-11-assumptions', 'cash_on_delivery', 200, 30000),
  ('2026-11-assumptions', 'bank_transfer', 50, 0);

insert into public.fee_fulfillment_tiers
  (schedule_version, id, max_weight_grams, max_longest_side_cm, fee_minor, sort)
values
  ('2026-11-assumptions', 'sobre', 500, 30, 90000, 1),
  ('2026-11-assumptions', 'pequeno', 2000, 45, 140000, 2),
  ('2026-11-assumptions', 'mediano', 10000, 60, 240000, 3),
  ('2026-11-assumptions', 'grande', 30000, 120, 490000, 4);

-- ── Seller statements ──────────────────────────────────────────────────────
-- One row per seller per order: exactly what was charged and what is owed.

create table public.seller_order_fees (
  order_id uuid not null references public.orders (id) on delete cascade,
  seller_id uuid not null references public.sellers (id),
  schedule_version text not null references public.fee_schedules (version),
  items_gross_minor bigint not null,
  referral_fee_minor bigint not null,
  fulfillment_fee_minor bigint not null,
  payment_fee_minor bigint not null,
  fees_net_minor bigint not null,
  fees_tax_minor bigint not null,
  payout_minor bigint not null,
  created_at timestamptz not null default now(),
  primary key (order_id, seller_id),
  constraint seller_fees_add_up check (
    fees_net_minor = referral_fee_minor + fulfillment_fee_minor + payment_fee_minor
    and payout_minor = items_gross_minor - fees_net_minor - fees_tax_minor
  )
);

create index seller_order_fees_seller_idx on public.seller_order_fees (seller_id, created_at desc);

create or replace function private.compute_seller_fees(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_schedule public.fee_schedules%rowtype;
  v_method public.payment_method;
  v_pay public.fee_payment_methods%rowtype;
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

  for r in
    select i.seller_id, sum(i.line_total_minor) as items_gross
    from public.order_items i where i.order_id = p_order_id group by i.seller_id
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

    v_payment := round(r.items_gross::numeric * coalesce(v_pay.bps, 0) / 10000)::bigint
                 + coalesce(v_pay.fixed_minor, 0);
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

-- ── Ledger ─────────────────────────────────────────────────────────────────
-- Double entry: every transaction's entries sum to zero (debits positive,
-- credits negative), enforced at commit. Balances are never stored, only derived.

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('asset', 'liability', 'revenue', 'expense')),
  seller_id uuid references public.sellers (id)
);

insert into public.ledger_accounts (code, name, kind) values
  ('gateway_clearing', 'Fondos por liquidar de la pasarela de pago', 'asset'),
  ('driver_cash', 'Efectivo en poder de repartidores', 'asset'),
  ('commission_revenue', 'Ingresos por comisión de venta', 'revenue'),
  ('fulfillment_revenue', 'Ingresos por servicio de bodega', 'revenue'),
  ('payment_fee_revenue', 'Recuperación de costos de cobro', 'revenue'),
  ('shipping_revenue', 'Ingresos por envío', 'revenue'),
  ('iva_payable', 'IVA por pagar', 'liability'),
  ('refunds_payable', 'Reembolsos por pagar a clientes', 'liability');

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('order_capture', 'order_refund', 'payout', 'cash_settlement', 'adjustment')),
  order_id uuid references public.orders (id),
  memo text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index ledger_transactions_order_idx on public.ledger_transactions (order_id);

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions (id) on delete restrict,
  account_id uuid not null references public.ledger_accounts (id),
  -- Positive = debit, negative = credit.
  amount_minor bigint not null check (amount_minor <> 0)
);

create index ledger_entries_tx_idx on public.ledger_entries (transaction_id);
create index ledger_entries_account_idx on public.ledger_entries (account_id);

create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function private.forbid_change();

create or replace function private.assert_ledger_balanced() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sum bigint;
begin
  select coalesce(sum(amount_minor), 0) into v_sum
  from public.ledger_entries where transaction_id = new.transaction_id;
  if v_sum <> 0 then
    raise exception 'Ledger transaction % is out of balance by %', new.transaction_id, v_sum
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

-- Deferred to commit, so a transaction's entries can be inserted one by one.
create constraint trigger ledger_entries_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function private.assert_ledger_balanced();

create or replace function private.seller_payable_account(p_seller_id uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.ledger_accounts where seller_id = p_seller_id;
  if v_id is null then
    insert into public.ledger_accounts (code, name, kind, seller_id)
    values ('seller_payable:' || p_seller_id, 'Por pagar al vendedor', 'liability', p_seller_id)
    on conflict (code) do update set name = excluded.name
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function private.ledger_account(p_code text) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from public.ledger_accounts where code = p_code;
$$;

-- Books a captured payment: what came in, what is owed to each seller, what the
-- platform earned, and the IVA collected on its own services.
create or replace function private.post_order_capture(p_order_id uuid, p_cash boolean) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_tx uuid;
  v_shipping_net bigint;
  r record;
begin
  select * into v_order from public.orders where id = p_order_id;
  if exists (
    select 1 from public.ledger_transactions t where t.order_id = p_order_id and t.kind = 'order_capture'
  ) then
    return null; -- already booked; capture is idempotent
  end if;

  perform private.compute_seller_fees(p_order_id);

  insert into public.ledger_transactions (kind, order_id, memo, created_by)
  values ('order_capture', p_order_id, 'Pago del pedido ' || v_order.order_number, (select auth.uid()))
  returning id into v_tx;

  -- Money in: cash sits with the driver until settled; everything else with the gateway.
  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  values (v_tx, private.ledger_account(case when p_cash then 'driver_cash' else 'gateway_clearing' end),
          v_order.total_minor);

  for r in select * from public.seller_order_fees where order_id = p_order_id loop
    if r.payout_minor <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.seller_payable_account(r.seller_id), -r.payout_minor);
    end if;
    if r.referral_fee_minor <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('commission_revenue'), -r.referral_fee_minor);
    end if;
    if r.fulfillment_fee_minor <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('fulfillment_revenue'), -r.fulfillment_fee_minor);
    end if;
    if r.payment_fee_minor <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('payment_fee_revenue'), -r.payment_fee_minor);
    end if;
    if r.fees_tax_minor <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('iva_payable'), -r.fees_tax_minor);
    end if;
  end loop;

  -- Shipping is the platform's own taxable service, charged tax-inclusive.
  if v_order.shipping_minor > 0 then
    v_shipping_net := round(v_order.shipping_minor::numeric * 10000 / 11300)::bigint;
    insert into public.ledger_entries (transaction_id, account_id, amount_minor)
    values (v_tx, private.ledger_account('shipping_revenue'), -v_shipping_net);
    if v_order.shipping_minor - v_shipping_net <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, private.ledger_account('iva_payable'), -(v_order.shipping_minor - v_shipping_net));
    end if;
  end if;

  return v_tx;
end;
$$;

-- Reverses a capture in full: every entry of the original, negated.
create or replace function private.post_order_refund(p_order_id uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_capture uuid;
  v_tx uuid;
  v_number text;
begin
  select id into v_capture from public.ledger_transactions
  where order_id = p_order_id and kind = 'order_capture';
  if v_capture is null or exists (
    select 1 from public.ledger_transactions where order_id = p_order_id and kind = 'order_refund'
  ) then
    return null;
  end if;
  select order_number into v_number from public.orders where id = p_order_id;

  insert into public.ledger_transactions (kind, order_id, memo, created_by)
  values ('order_refund', p_order_id, 'Reembolso del pedido ' || v_number, (select auth.uid()))
  returning id into v_tx;

  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  select v_tx, e.account_id, -e.amount_minor
  from public.ledger_entries e where e.transaction_id = v_capture;

  return v_tx;
end;
$$;

-- ── Payouts ────────────────────────────────────────────────────────────────

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id),
  period_start date not null,
  period_end date not null,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'paid', 'failed')),
  bank_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (seller_id, period_start, period_end)
);

-- ── Electronic invoices (Hacienda v4.4) ────────────────────────────────────
-- A record per fiscal document: the seller's invoice to the shopper, and the
-- platform's invoice to the seller for its fees. Issuing and signing happen in
-- an integration service; this table is the system of record for their state.

create table public.electronic_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id),
  -- The taxpayer issuing the document: a seller, or null for the platform itself.
  issuer_seller_id uuid references public.sellers (id),
  -- 01 factura, 03 nota de crédito, 04 tiquete, 10 recibo electrónico de pago.
  document_type text not null check (document_type in ('01', '02', '03', '04', '08', '09', '10')),
  -- Hacienda's 50-digit key and 20-digit consecutive number, once assigned.
  clave text unique check (clave ~ '^[0-9]{50}$'),
  consecutivo text check (consecutivo ~ '^[0-9]{20}$'),
  status public.invoice_status not null default 'pending',
  total_minor bigint not null,
  xml_path text,
  hacienda_message text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index electronic_invoices_order_idx on public.electronic_invoices (order_id);
create index electronic_invoices_issuer_idx on public.electronic_invoices (issuer_seller_id);
