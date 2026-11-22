-- Payments through a gateway: cards and SINPE Móvil confirmed by the
-- provider, refunds sent through it, and what finance needs to check it all.
--
-- Until now `payments_mode` was `sandbox` (a button simulates the payment) or
-- `live` (nothing could charge a card, and finance confirmed transfers by
-- hand). This migration adds the database side of a real integration; the
-- provider is called only by the server-side worker in packages/payments,
-- run as the Edge Functions `payments-worker` and `payments-webhook`, exactly
-- the way the notification worker runs (decision 22). The provider chosen and
-- its wire contract are in docs/research/payments-gateways-costa-rica.md; how
-- staff work with it is in docs/06-operations/payments.md.
--
--   1. MODES. `sandbox` keeps the simulation for local work and the preview.
--      `test` uses the provider's own test environment (its test keys), and
--      `live` the real one; in both the simulation refuses to run. Changing
--      the mode is an administrator's audited action, refused unless the
--      worker has reported, recently, that it holds keys and a webhook secret
--      for that environment.
--   2. ATTEMPTS. One order has one payment row (as before) and, in test and
--      live, one or more attempts at the provider: the shopper starts one,
--      the worker creates it at the provider with the amount and currency
--      read here (never from the client), the shopper pays on the provider's
--      own page (card) or by a transfer the provider matches (SINPE Móvil).
--      A declined attempt can be followed by a new one; an attempt whose
--      order expires or is cancelled is cancelled at the provider.
--   3. EVENTS. Every notification from the provider (and every answer to "how
--      is this payment?" that the worker asks for an attempt that never got
--      one) is recorded once by its id, then applied with the order's row
--      lock held: duplicates, reordering and parallel deliveries change
--      nothing twice. A payment that does not match its attempt's amount or
--      currency, arrives for an order that can no longer take it, pays an
--      order already paid, or names nothing we know is kept for finance in
--      private.payment_reviews and changes nothing, until finance accepts it,
--      attaches it to an order, refunds it or closes it with a note.
--   4. REFUNDS. The refund register (private.refunds, decision 26) still
--      decides what is owed. Each refund it books now gets one row in
--      private.gateway_refunds: REQUESTED when booked, SENT to the provider
--      once by the worker (the provider has no idempotency key, so the row
--      is the guard: a send whose answer was lost is never repeated blindly,
--      the worker first asks the provider what it holds), and COMPLETED only
--      when the provider confirms. Completion moves the money out in the
--      ledger (refunds_payable to gateway_clearing), updates the payment's
--      status and sends the shopper the "refund completed" message. Cash on
--      delivery and transfers confirmed by hand are refunded by finance by
--      bank transfer, recorded with the bank's reference. In sandbox the
--      refund completes at once, as before.
--   5. FEES. What the provider reports it charged for a payment is recorded
--      with what the fee schedule expected (a setting, gateway_expected_fees)
--      and booked as an expense; finance can record it from the provider's
--      statement when the provider does not report it.
--
-- Same rules as every other migration since the lockdown: tables in
-- `private` with row-level security and no grants; every function owner's
-- rights with an empty search path, caller checked first, errors as short
-- codes; shoppers and staff reach only the functions granted below, and the
-- worker only its four `worker_payments_*` functions with its own secret key.

-- ═══ 1. Settings and modes ═════════════════════════════════════════════════

update public.app_settings
set description = 'sandbox = simulated payments for local work and the preview; test = the gateway''s '
                  || 'test environment; live = real money through the gateway. Changed only by '
                  || 'public.ops_set_payments_mode.'
where key = 'payments_mode';

insert into public.app_settings (key, value, description) values
  ('payment_gateway', '"onvo"',
   'The gateway used in test and live mode (docs/research/payments-gateways-costa-rica.md).'),
  ('gateway_expected_fees',
   '{"card": {"bps": 390, "fixed_minor": 18000}, "sinpe_movil": {"bps": 150, "fixed_minor": 0}}',
   'What the gateway is expected to charge per payment, to compare with what it reports. An '
   || 'assumption from published prices: the central bank caps card acquiring at 1.95%, see '
   || 'docs/06-operations/payments.md. Not the fee charged to sellers (that is the fee schedule).'),
  ('max_payment_attempts_per_order', '5',
   'How many times a shopper may start a payment at the gateway for one order.'),
  ('gateway_refund_unknown_hold_minutes', '60',
   'How long a refund whose send got no answer is checked at the gateway before finance is asked to '
   || 'settle it (it is never sent again by itself: the gateway has no idempotency key).')
on conflict (key) do nothing;

create or replace function private.payments_mode() returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'payments_mode'), 'sandbox');
$$;

create or replace function private.payment_gateway() returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'payment_gateway'), 'onvo');
$$;

-- Only the three known modes; anything else in the setting is refused at write.
create or replace function private.guard_payments_mode() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.key = 'payments_mode' and (new.value #>> '{}') not in ('sandbox', 'test', 'live') then
    perform private.fail('payments_mode_invalid');
  end if;
  return new;
end;
$$;

create trigger app_settings_payments_mode before insert or update on public.app_settings
  for each row execute function private.guard_payments_mode();

-- ═══ 2. The payment row learns its gateway ═════════════════════════════════

alter table public.payments
  -- test or live: the mode the payment was taken in (for a payment through
  -- the gateway, the environment that took it). Null: sandbox, or before 083400.
  add column environment text check (environment in ('test', 'live')),
  -- The gateway's id the payment can be refunded against (ONVO: the payment
  -- intent). Null for payments that did not come through the gateway.
  add column gateway_reference text;

-- place_order writes the mode as the provider (sandbox, or the mode in test
-- and live). In test and live the provider is the gateway itself, and the
-- mode becomes the environment, so that place_order need not change.
create or replace function private.payments_provider_from_mode() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.provider in ('test', 'live') then
    new.environment := new.provider;
    -- Only cards and SINPE Móvil go through the gateway; a bank transfer is
    -- still confirmed by finance by hand.
    new.provider := case when new.method in ('card', 'sinpe_movil') then private.payment_gateway()
                         else 'manual' end;
  elsif new.provider = 'cash' and private.payments_mode() in ('test', 'live') then
    -- Cash on delivery keeps its provider and records the mode it was taken
    -- in. Null: taken in sandbox (the demo's cash), or before this migration.
    new.environment := private.payments_mode();
  end if;
  return new;
end;
$$;

create trigger payments_provider_from_mode before insert on public.payments
  for each row execute function private.payments_provider_from_mode();

-- ═══ 3. Tables ═════════════════════════════════════════════════════════════

-- What the worker last said about itself, per environment: whether it holds
-- the keys and a webhook secret for it. The mode can only be changed to an
-- environment the worker reported as ready a few minutes ago.
create table private.payment_gateway_status (
  provider text not null,
  environment text not null check (environment in ('test', 'live')),
  account_ref text check (char_length(account_ref) <= 120),
  keys_ready boolean not null,
  webhook_ready boolean not null,
  reported_at timestamptz not null default now(),
  primary key (provider, environment)
);

-- One try at paying an order at the gateway.
create table private.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  order_id uuid not null references public.orders (id),
  provider text not null,
  environment text not null check (environment in ('test', 'live')),
  method public.payment_method not null check (method in ('card', 'sinpe_movil')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'CRC',
  -- creating: the worker must create it at the gateway. open: the shopper can
  -- pay on the gateway's page. processing: the gateway is waiting for the
  -- transfer or confirming. failed: declined (the shopper may try again).
  -- succeeded: paid and applied. review: money arrived and waits for finance.
  -- cancel_requested: to be stopped at the gateway. cancelled, expired,
  -- error (could not be created): finished.
  status text not null default 'creating' check (status in (
    'creating', 'open', 'processing', 'failed', 'succeeded', 'review',
    'cancel_requested', 'cancelled', 'expired', 'error')),
  -- What the create call said: created, refused (nothing was created), or
  -- unknown (the answer was lost: it may exist at the gateway).
  create_outcome text check (create_outcome in ('created', 'refused', 'unknown')),
  return_to text not null default 'web' check (return_to in ('web', 'app')),
  session_reference text check (char_length(session_reference) <= 200),
  intent_reference text check (char_length(intent_reference) <= 200),
  checkout_url text check (char_length(checkout_url) <= 2048),
  sinpe_destination text check (sinpe_destination ~ '^\+506[0-9]{8}$'),
  -- Whose account pays a SINPE Móvil transfer: the gateway matches the
  -- transfer by this identification and the exact amount. Erased as soon as
  -- the gateway has it.
  payer_kind text check (payer_kind in ('national', 'resident', 'legal_entity')),
  payer_number text check (payer_number ~ '^[0-9]{9,12}$'),
  payer_phone text check (payer_phone ~ '^\+506[5-8][0-9]{7}$'),
  failure_code text check (char_length(failure_code) <= 80),
  -- When the gateway declined it (kept when the attempt is later stopped, so
  -- the day's declines can be counted).
  declined_at timestamptz,
  provider_updated_at timestamptz,
  expires_at timestamptz not null,
  -- When the worker should next look at it, and its lease while it does.
  work_after timestamptz not null default now(),
  tries smallint not null default 0,
  checks smallint not null default 0,
  locked_until timestamptz,
  locked_by text,
  returned_at timestamptz,
  last_checked_at timestamptz,
  -- Bare ids of people (here and below): they stay as the trail of who did
  -- what and lead to no one once an account is deleted.
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(), -- ordered even within one transaction
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index payment_attempts_session_idx on private.payment_attempts (provider, session_reference)
  where session_reference is not null;
create unique index payment_attempts_intent_idx on private.payment_attempts (provider, intent_reference)
  where intent_reference is not null;
-- At most one attempt of a payment that the shopper can still pay.
create unique index payment_attempts_one_live_idx on private.payment_attempts (payment_id)
  where status in ('creating', 'open', 'processing');
create index payment_attempts_order_idx on private.payment_attempts (order_id, created_at desc);
create index payment_attempts_work_idx on private.payment_attempts (work_after)
  where status in ('creating', 'open', 'processing', 'failed', 'cancel_requested');

create trigger payment_attempts_updated_at before update on private.payment_attempts
  for each row execute function private.set_updated_at();

-- Every notification from the gateway, and every answer to the worker's
-- questions, once. What is kept is the normalised event: references,
-- statuses, amounts. Never a name, an identification or anything typed into
-- a card field (the gateway sends none of those either).
create table private.payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null check (char_length(event_id) between 1 and 200),
  source text not null check (source in ('webhook', 'poll')),
  event_type text not null check (char_length(event_type) <= 60),
  provider_type text check (char_length(provider_type) <= 80),
  environment text,
  occurred_at timestamptz,
  attempt_id uuid references private.payment_attempts (id),
  order_id uuid references public.orders (id),
  gateway_refund_id uuid,
  outcome text not null default 'received',
  data jsonb not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index payment_events_received_idx on private.payment_events (received_at desc);
create index payment_events_order_idx on private.payment_events (order_id);

-- Money the gateway took that is not (yet) applied to an order, and other
-- things only a person can settle.
create table private.payment_reviews (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text,
  kind text not null check (kind in (
    'unknown_reference',   -- names no attempt of ours
    'amount_mismatch',     -- not the amount the attempt asked for
    'currency_mismatch',
    'late',                -- the order was cancelled or expired before it arrived
    'paid_twice',          -- the order was already paid
    'unmatched_transfer',  -- a transfer the gateway could not tie to a payment
    'unknown_refund',      -- a refund we did not ask for
    'wrong_environment',   -- paid in the gateway environment the mode has left
    'dispute')),           -- a chargeback
  event_id bigint references private.payment_events (id),
  order_id uuid references public.orders (id),
  attempt_id uuid references private.payment_attempts (id),
  -- The gateway's id of the money (ONVO: payment intent, or the transfer's reference).
  payment_reference text check (char_length(payment_reference) <= 200),
  amount_minor bigint,
  currency char(3),
  detail text check (char_length(detail) <= 500),
  status text not null default 'open' check (status in (
    'open', 'accepted', 'attached', 'refunding', 'refunded', 'dismissed')),
  resolved_order_id uuid references public.orders (id),
  resolution_note text check (char_length(resolution_note) <= 500),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- The same money is one item, however many events speak of it.
create unique index payment_reviews_money_idx on private.payment_reviews (provider, kind, payment_reference)
  where payment_reference is not null;
create index payment_reviews_open_idx on private.payment_reviews (created_at) where status = 'open';

-- Each refund on its way back to the shopper.
create table private.gateway_refunds (
  id uuid primary key default gen_random_uuid(),
  -- What it pays back: a refund in the register, or money in a review.
  refund_id uuid unique references private.refunds (id),
  review_id uuid unique references private.payment_reviews (id),
  constraint gateway_refunds_one_source check ((refund_id is null) <> (review_id is null)),
  order_id uuid references public.orders (id),
  payment_id uuid references public.payments (id),
  provider text,
  environment text,
  -- gateway: sent to the gateway. transfer: finance pays it by bank transfer
  -- (cash on delivery, transfers confirmed by hand, or a gateway refund that
  -- failed). simulated: sandbox, no money moves.
  channel text not null check (channel in ('gateway', 'transfer', 'simulated')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'CRC',
  payment_reference text check (char_length(payment_reference) <= 200),
  status text not null default 'requested' check (status in (
    'requested', 'sending', 'sent', 'unknown', 'succeeded', 'failed')),
  provider_refund_reference text check (char_length(provider_refund_reference) <= 200),
  failure_code text check (char_length(failure_code) <= 80),
  provider_updated_at timestamptz,
  send_count smallint not null default 0,
  -- Since when the answer to a send is lost (status unknown): decides how
  -- long the worker keeps checking before finance is asked.
  unknown_at timestamptz,
  work_after timestamptz not null default now(),
  locked_until timestamptz,
  locked_by text,
  requested_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  completion_tx uuid unique references public.ledger_transactions (id),
  bank_reference text check (char_length(bank_reference) between 4 and 60),
  completed_by uuid,
  note text check (char_length(note) <= 500)
);

create unique index gateway_refunds_provider_ref_idx on private.gateway_refunds (provider, provider_refund_reference)
  where provider_refund_reference is not null;
create index gateway_refunds_order_idx on private.gateway_refunds (order_id);
create index gateway_refunds_open_idx on private.gateway_refunds (work_after)
  where status in ('requested', 'sending', 'sent', 'unknown');

-- What the gateway charged for each payment, against what was expected.
create table private.payment_costs (
  payment_id uuid primary key references public.payments (id),
  expected_fee_minor bigint not null check (expected_fee_minor >= 0),
  expected_basis jsonb not null,
  reported_fee_minor bigint check (reported_fee_minor >= 0),
  reported_source text check (reported_source in ('gateway', 'statement')),
  reported_at timestamptz,
  reported_by uuid,
  ledger_transaction_id uuid unique references public.ledger_transactions (id),
  note text check (char_length(note) <= 500)
);

alter table private.payment_gateway_status enable row level security;
alter table private.payment_attempts enable row level security;
alter table private.payment_events enable row level security;
alter table private.payment_reviews enable row level security;
alter table private.gateway_refunds enable row level security;
alter table private.payment_costs enable row level security;
revoke all on private.payment_gateway_status, private.payment_attempts, private.payment_events,
  private.payment_reviews, private.gateway_refunds, private.payment_costs
from public, anon, authenticated;

-- The ledger learns three kinds: a refund moved to "owed to the shopper", a
-- refund paid out, and the gateway's own fee.
alter table public.ledger_transactions drop constraint ledger_transactions_kind_check;
alter table public.ledger_transactions add constraint ledger_transactions_kind_check
  check (kind in ('order_capture', 'order_refund', 'return_refund', 'payout',
                  'cash_settlement', 'adjustment', 'refund_pending', 'refund_paid', 'gateway_fee'));

insert into public.ledger_accounts (code, name, kind) values
  ('gateway_fee_expense', 'Comisiones de la pasarela de pago', 'expense')
on conflict (code) do nothing;

-- ═══ 4. Helpers ════════════════════════════════════════════════════════════

-- What the gateway is expected to charge for a payment, from the setting.
create or replace function private.expected_gateway_fee(p_method public.payment_method, p_amount bigint)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_rule jsonb := (select value from public.app_settings where key = 'gateway_expected_fees') -> p_method::text;
  v_bps integer := coalesce((v_rule ->> 'bps')::integer, 0);
  v_fixed bigint := coalesce((v_rule ->> 'fixed_minor')::bigint, 0);
begin
  return jsonb_build_object(
    'fee_minor', round(p_amount::numeric * v_bps / 10000)::bigint + v_fixed,
    'bps', v_bps, 'fixed_minor', v_fixed);
end;
$$;

-- Records what the gateway charged for a payment and books it as an expense,
-- once. The expected fee is kept from the moment the payment was taken.
create or replace function private.record_gateway_fee(
  p_payment_id uuid,
  p_fee_minor bigint,
  p_source text,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_cost private.payment_costs%rowtype;
  v_tx uuid;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  insert into private.payment_costs (payment_id, expected_fee_minor, expected_basis)
  select p_payment_id, (e ->> 'fee_minor')::bigint, e
  from private.expected_gateway_fee(v_payment.method, v_payment.amount_minor) e
  on conflict (payment_id) do nothing;
  if p_fee_minor is null then
    return;
  end if;
  select * into v_cost from private.payment_costs where payment_id = p_payment_id for update;
  if v_cost.reported_fee_minor is not null then
    return; -- already recorded; what is booked stays booked
  end if;
  if p_fee_minor > 0 then
    insert into public.ledger_transactions (kind, order_id, memo, created_by)
    values ('gateway_fee', v_payment.order_id,
            'Comisión de la pasarela, pedido ' ||
              (select order_number from public.orders where id = v_payment.order_id),
            (select auth.uid()))
    returning id into v_tx;
    insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
      (v_tx, private.ledger_account('gateway_fee_expense'), p_fee_minor),
      (v_tx, private.ledger_account('gateway_clearing'), -p_fee_minor);
  end if;
  update private.payment_costs
  set reported_fee_minor = p_fee_minor, reported_source = p_source, reported_at = now(),
      reported_by = (select auth.uid()), ledger_transaction_id = v_tx,
      note = left(nullif(trim(p_note), ''), 500)
  where payment_id = p_payment_id;
end;
$$;

-- The refunds of an order that have actually reached the shopper decide the
-- payment's status: a refund settled at the door (no money to send) counts at
-- once; any other only once its gateway refund (or transfer) completed. A
-- cancelled order whose money is all back becomes refunded.
create or replace function private.payments_refresh_refund_status(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_collected bigint := private.order_collected_minor(p_order_id);
  v_done bigint;
begin
  select coalesce(sum(r.amount_minor), 0) into v_done
  from private.refunds r
  where r.order_id = p_order_id
    and not exists (select 1 from private.gateway_refunds g
                    where g.refund_id = r.id and g.status <> 'succeeded');
  if v_done <= 0 or v_collected <= 0 then
    return;
  end if;
  update public.payments
  set status = case when v_done >= v_collected then 'refunded' else 'partially_refunded' end::public.payment_status,
      refunded_at = now()
  where order_id = p_order_id and status in ('captured', 'partially_refunded')
    and status <> case when v_done >= v_collected then 'refunded' else 'partially_refunded' end::public.payment_status;
  if v_done >= v_collected then
    update public.orders set status = 'refunded' where id = p_order_id and status = 'cancelled';
  end if;
end;
$$;

-- The money of one gateway refund has reached the shopper's side (the
-- gateway confirmed it, finance made the transfer, or nothing real had to
-- move): books it leaving refunds_payable, marks the gateway refund
-- succeeded and updates the payment's status. Nothing is announced here.
-- Answers false, and does nothing, when it was settled already.
create or replace function private.settle_gateway_refund(
  p_id uuid,
  p_bank_reference text default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  g private.gateway_refunds%rowtype;
  v_reason text;
  v_tx uuid;
  v_number text;
begin
  select * into g from private.gateway_refunds where id = p_id for update;
  if not found or g.status = 'succeeded' then
    return false;
  end if;
  if g.refund_id is not null then
    select reason into v_reason from private.refunds where id = g.refund_id;
    -- A cancelled order's reversal of simulated money already took it out of
    -- the gateway account; every other refund waits in refunds_payable.
    if not (g.channel = 'simulated' and v_reason = 'order_cancelled') then
      select order_number into v_number from public.orders where id = g.order_id;
      insert into public.ledger_transactions (kind, order_id, memo, created_by)
      values ('refund_paid', g.order_id,
              case g.channel when 'transfer' then 'Reembolso transferido, pedido '
                             else 'Reembolso enviado por la pasarela, pedido ' end || v_number,
              (select auth.uid()))
      returning id into v_tx;
      insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
        (v_tx, private.ledger_account('refunds_payable'), g.amount_minor),
        (v_tx, private.ledger_account(case g.channel when 'transfer' then 'bank_operating'
                                                     else 'gateway_clearing' end), -g.amount_minor);
    end if;
  end if;

  update private.gateway_refunds
  set status = 'succeeded', completed_at = now(), completion_tx = v_tx,
      completed_by = (select auth.uid()),
      bank_reference = coalesce(nullif(trim(p_bank_reference), ''), bank_reference),
      failure_code = null, locked_until = null, locked_by = null
  where id = p_id;

  if g.refund_id is not null then
    perform private.payments_refresh_refund_status(g.order_id);
    insert into public.order_events (order_id, kind, note, actor_id)
    values (g.order_id, 'payment', 'Reembolso completado', (select auth.uid()));
  else
    update private.payment_reviews set status = 'refunded' where id = g.review_id;
  end if;
  return true;
end;
$$;

-- A gateway refund is complete (the gateway confirmed it, or finance made the
-- transfer): its money is settled, and a refund of the register is confirmed
-- through private.confirm_refund (20261121083200), the one place that records
-- the confirmation and announces `refund.completed`, once. A simulated
-- refund completes in the transaction that booked it, before that booking's
-- own `refund.requested`; its confirmation therefore waits for the commit
-- (refunds_confirm_when_nothing_moves), so the two messages keep their order.
-- Safe to call twice.
create or replace function private.complete_gateway_refund(
  p_id uuid,
  p_bank_reference text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  g private.gateway_refunds%rowtype;
begin
  perform private.settle_gateway_refund(p_id, p_bank_reference);
  select * into g from private.gateway_refunds where id = p_id;
  if g.refund_id is not null and g.status = 'succeeded' and g.channel <> 'simulated' then
    perform private.confirm_refund(g.refund_id,
      coalesce(g.provider_refund_reference, g.bank_reference, g.channel));
  end if;
end;
$$;

-- Replaces the version in 20261121083200 so that a confirmation and the money
-- are one thing: confirming a refund whose gateway refund has not completed
-- settles it first (the money went out: the gateway or the bank says so),
-- and only then records the confirmation and announces it. Called by
-- complete_gateway_refund, and by any server-side handler that learns that
-- the money of a refund went out. A second call does nothing and answers
-- false.
create or replace function private.confirm_refund(p_refund_id uuid, p_reference text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  f private.refunds%rowtype;
  v_gateway uuid;
begin
  select * into f from private.refunds where id = p_refund_id;
  if not found then
    perform private.fail('refund_not_found');
  end if;
  perform 1 from public.orders where id = f.order_id for update;
  select g.id into v_gateway from private.gateway_refunds g
  where g.refund_id = p_refund_id and g.status <> 'succeeded';
  if v_gateway is not null then
    perform private.settle_gateway_refund(v_gateway, null);
  end if;
  insert into private.refund_confirmations (refund_id, reference)
  values (p_refund_id, left(coalesce(nullif(trim(p_reference), ''), 'confirmed'), 200))
  on conflict (refund_id) do nothing;
  if not found then
    return false;
  end if;
  perform private.emit('refund.completed', jsonb_build_object(
    'order_id', f.order_id, 'refund_id', f.id, 'amount_minor', f.amount_minor, 'reason', f.reason));
  return true;
end;
$$;

-- Replaces the version in 20261121083200. At commit, after the booking's own
-- `refund.requested`: a refund settled at the door moved no money and is
-- confirmed silently, as before; a refund whose money was never real (its
-- gateway refund is simulated and already settled) is confirmed and
-- announced. Every other refund waits for its gateway refund to complete.
-- What decides is the refund's own channel, no longer the mode at the time:
-- real money taken in live and refunded while the mode is sandbox is still
-- paid back, and confirmed, by transfer.
create or replace function private.refund_confirm_when_nothing_moves() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  g private.gateway_refunds%rowtype;
begin
  if exists (
    select 1 from public.ledger_entries e
    where e.transaction_id = new.ledger_transaction_id
      and e.account_id = private.ledger_account('driver_cash')
  ) then
    -- Settled at the door: no money to send, nothing to announce.
    insert into private.refund_confirmations (refund_id, reference)
    values (new.id, 'at_door') on conflict do nothing;
    return null;
  end if;
  select * into g from private.gateway_refunds where refund_id = new.id;
  if g.channel = 'simulated' and g.status = 'succeeded' then
    perform private.confirm_refund(new.id, case when g.provider = 'sandbox' then 'sandbox' else 'simulated' end);
  end if;
  return null;
end;
$$;

-- Every refund the register books gets its way back to the shopper. A refund
-- settled at the door of a cash order sends nothing: the driver simply took
-- less, so it counts as done at once.
create or replace function private.open_gateway_refund(p_refund private.refunds) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_channel text;
  v_pending bigint;
  v_tx uuid;
  v_id uuid;
begin
  if exists (select 1 from public.ledger_entries e
             where e.transaction_id = p_refund.ledger_transaction_id
               and e.account_id = private.ledger_account('driver_cash')) then
    perform private.payments_refresh_refund_status(p_refund.order_id);
    return;
  end if;

  select * into v_payment from public.payments
  where order_id = p_refund.order_id and status in ('captured', 'partially_refunded', 'refunded')
  order by created_at limit 1;

  -- Through the gateway only in the environment that took the payment, and
  -- only while the mode is that environment: the worker works for the current
  -- mode alone, so a refund for another environment would never be sent.
  -- Money that was never real (taken in sandbox, or in the gateway's test
  -- environment) is refunded as a simulation; real money taken in live and
  -- refunded after the mode left live, a transfer confirmed by hand, or cash
  -- is paid back by finance by bank transfer.
  v_channel := case
    when v_payment.gateway_reference is not null and v_payment.environment = private.payments_mode()
      then 'gateway'
    when v_payment.provider = 'sandbox' and v_payment.gateway_reference is null
         and (private.payments_mode() = 'sandbox' or v_payment.method in ('card', 'sinpe_movil'))
      then 'simulated'
    when v_payment.environment = 'test' and v_payment.gateway_reference is not null
      then 'simulated'
    -- Cash taken in sandbox (or before 083400, which did not say) is the
    -- demo's while the mode is sandbox. Cash taken in test or live mode is a
    -- real driver's: it is paid back, in any mode.
    when v_payment.provider = 'cash' and v_payment.environment is null and private.payments_mode() = 'sandbox'
      then 'simulated'
    else 'transfer' end;

  -- A cancelled order's reversal took the money straight off the gateway
  -- account. Until the money has really gone, it is owed to the shopper.
  if p_refund.reason = 'order_cancelled' and v_channel <> 'simulated' then
    select -coalesce(sum(e.amount_minor), 0) into v_pending
    from public.ledger_entries e
    where e.transaction_id = p_refund.ledger_transaction_id
      and e.account_id = private.ledger_account('gateway_clearing');
    if v_pending > 0 then
      insert into public.ledger_transactions (kind, order_id, memo, created_by)
      values ('refund_pending', p_refund.order_id, 'Reembolso por enviar, pedido '
                || (select order_number from public.orders where id = p_refund.order_id),
              (select auth.uid()))
      returning id into v_tx;
      insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
        (v_tx, private.ledger_account('gateway_clearing'), v_pending),
        (v_tx, private.ledger_account('refunds_payable'), -v_pending);
    end if;
  end if;

  insert into private.gateway_refunds
    (refund_id, order_id, payment_id, provider, environment, channel, amount_minor, currency,
     payment_reference, note)
  values
    (p_refund.id, p_refund.order_id, v_payment.id, v_payment.provider, v_payment.environment, v_channel,
     p_refund.amount_minor, coalesce(v_payment.currency, 'CRC'), v_payment.gateway_reference,
     case when v_channel = 'simulated' and private.payments_mode() <> 'sandbox'
          then 'Pago de prueba (sin dinero real): el reembolso se da por hecho sin mover dinero.' end)
  returning id into v_id;

  -- Nothing real to send: settled now. Its confirmation follows at commit
  -- (refund_confirm_when_nothing_moves), after `refund.requested`.
  if v_channel = 'simulated' then
    perform private.settle_gateway_refund(v_id);
  end if;
end;
$$;

create or replace function private.gateway_refund_for_register() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.open_gateway_refund(new);
  return null;
end;
$$;

create trigger refunds_gateway_refund after insert on private.refunds
  for each row execute function private.gateway_refund_for_register();

-- Refunds booked before this migration that are still unconfirmed (booked in
-- test or live mode after 20261121083200, waiting for a gateway that did not
-- exist): each gets its way back now, by the same rule as a new one. Money
-- that was never real is settled and confirmed at once (its booking was
-- announced long ago); any other waits for finance (a transfer) or the
-- gateway. Refunds already confirmed (before_confirmations, sandbox, at_door)
-- need nothing: their money is accounted for. On a fresh database, and on a
-- project that stayed in sandbox mode, this changes nothing.
do $$
declare
  f private.refunds;
begin
  for f in
    select r.* from private.refunds r
    where not exists (select 1 from private.refund_confirmations c where c.refund_id = r.id)
      and not exists (select 1 from private.gateway_refunds g where g.refund_id = r.id)
    order by r.created_at, r.id
  loop
    perform private.open_gateway_refund(f);
    if exists (select 1 from private.gateway_refunds g
               where g.refund_id = f.id and g.channel = 'simulated' and g.status = 'succeeded') then
      perform private.confirm_refund(f.id, 'simulated');
    end if;
  end loop;
end
$$;

-- When an order stops waiting for its money (paid another way, cancelled or
-- expired), whatever the shopper could still pay at the gateway is stopped
-- there. An attempt never created at the gateway is simply closed.
create or replace function private.payment_attempts_stop(p_order_id uuid, p_except uuid default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update private.payment_attempts
  -- Never created at the gateway (and no create call in flight): nothing to
  -- stop there. A create call whose answer never came may have created it:
  -- that is remembered, so that a payment it still receives is recognised.
  set status = case when session_reference is null and intent_reference is null
                         and (locked_until is null or locked_until < now())
                    then 'cancelled' else 'cancel_requested' end,
      create_outcome = case when session_reference is null and intent_reference is null
                                 and locked_until < now() and create_outcome is null
                            then 'unknown' else create_outcome end,
      finished_at = case when session_reference is null and intent_reference is null
                              and (locked_until is null or locked_until < now())
                         then now() end,
      payer_kind = null, payer_number = null, payer_phone = null,
      work_after = now()
  where order_id = p_order_id
    and status in ('creating', 'open', 'processing', 'failed')
    and id is distinct from p_except;
end;
$$;

create or replace function private.orders_stop_attempts() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'refunded') and old.status in ('pending_payment', 'payment_review') then
    perform private.payment_attempts_stop(new.id);
  end if;
  return null;
end;
$$;

create trigger orders_stop_payment_attempts after update of status on public.orders
  for each row execute function private.orders_stop_attempts();

create or replace function private.payments_stop_attempts() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'captured' and old.status is distinct from 'captured' then
    perform private.payment_attempts_stop(new.order_id);
  end if;
  return null;
end;
$$;

create trigger payments_stop_payment_attempts after update of status on public.payments
  for each row execute function private.payments_stop_attempts();

-- private.emit_logistics_events stays as 20261121083200 left it: a payment
-- turning `refunded` announces nothing; `refund.completed` is announced by
-- private.confirm_refund alone, once per refund.

-- ═══ 5. The refund register no longer marks the payment refunded itself ════
-- Unchanged from 20261121082900_integrity.sql except at the end: the
-- payment's status now follows the money reaching the shopper
-- (payments_refresh_refund_status, called when each refund completes),
-- instead of the moment the refund is booked.
create or replace function private.refund_units(
  p_order_id uuid,
  p_reason text,
  p_source_id uuid,
  p_units jsonb,
  p_at_door boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_tx uuid;
  v_refund uuid;
  v_total bigint := 0;
  v_seller_debit bigint := 0;
  v_amount bigint;
  v_commission bigint;
  v_commission_tax bigint;
  v_lines integer := 0;
  r record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('order_not_found');
  end if;
  if not exists (
    select 1 from public.payments p
    where p.order_id = p_order_id and p.status in ('captured', 'partially_refunded')
  ) then
    perform private.fail('order_not_refundable', v_order.status::text);
  end if;

  perform private.lock_seller_money(s.seller_id)
  from (select distinct i.seller_id from public.order_items i where i.order_id = p_order_id) s
  order by s.seller_id;

  insert into public.ledger_transactions (kind, order_id, memo, created_by)
  values ('return_refund', p_order_id,
          case p_reason when 'parcel_returned' then 'Paquete devuelto sin entregar, pedido '
                        else 'Devolución en el pedido ' end || v_order.order_number,
          (select auth.uid()))
  returning id into v_tx;

  for r in
    select i.id, i.seller_id, i.unit_price_minor, u.quantity,
           f.referral_fee_minor, f.items_gross_minor, s.fee_tax_bps
    from jsonb_to_recordset(p_units) as u (order_item_id uuid, quantity integer)
    join public.order_items i on i.id = u.order_item_id and i.order_id = p_order_id
    left join public.seller_order_fees f on f.order_id = i.order_id and f.seller_id = i.seller_id
    left join public.fee_schedules s on s.version = f.schedule_version
    order by i.id
  loop
    v_lines := v_lines + 1;
    if r.quantity is null or r.quantity <= 0 then
      perform private.fail('invalid_quantity');
    end if;
    if r.items_gross_minor is null or r.items_gross_minor <= 0 then
      perform private.fail('order_not_refundable', 'no_statement');
    end if;
    v_amount := r.unit_price_minor * r.quantity;
    v_commission := round(r.referral_fee_minor::numeric * v_amount / r.items_gross_minor)::bigint;
    v_commission_tax := round(v_commission::numeric * r.fee_tax_bps / 10000)::bigint;

    insert into public.ledger_entries (transaction_id, account_id, amount_minor)
    select v_tx, x.account_id, x.amount
    from (values
      (private.seller_payable_account(r.seller_id), v_amount - v_commission - v_commission_tax),
      (private.ledger_account('commission_revenue'), v_commission),
      (private.ledger_account('iva_payable'), v_commission_tax)
    ) as x (account_id, amount)
    where x.amount <> 0;

    v_total := v_total + v_amount;
    v_seller_debit := v_seller_debit + v_amount - v_commission - v_commission_tax;
  end loop;

  if v_lines = 0 or v_lines <> jsonb_array_length(p_units) then
    perform private.fail('order_item_not_found');
  end if;

  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  values (v_tx, private.ledger_account(case when p_at_door then 'driver_cash' else 'refunds_payable' end),
          -v_total);

  -- The register; its trigger starts the money's way back (gateway_refund_for_register).
  insert into private.refunds (order_id, reason, source_id, amount_minor, ledger_transaction_id, created_by)
  values (p_order_id, p_reason, p_source_id, v_total, v_tx, (select auth.uid()))
  returning id into v_refund;
  insert into private.refund_units (refund_id, order_item_id, quantity)
  select v_refund, u.order_item_id, u.quantity
  from jsonb_to_recordset(p_units) as u (order_item_id uuid, quantity integer);

  perform private.emit(case when p_at_door then 'refund.settled_at_door' else 'refund.requested' end,
                       jsonb_build_object(
    'order_id', p_order_id, 'refund_id', v_refund, 'reason', p_reason,
    'return_request_id', case when p_reason = 'return' then p_source_id end,
    'shipment_id', case when p_reason = 'parcel_returned' then p_source_id end,
    'amount_minor', v_total));

  return jsonb_build_object('refund_id', v_refund, 'refund_minor', v_total,
                            'seller_debit_minor', v_seller_debit);
end;
$$;

-- ═══ 5b. A cancelled order's refund follows its money ══════════════════════
-- Unchanged from 20261121082900_integrity.sql except at the end. The mode no
-- longer decides whether money moved: a cancellation in sandbox mode of a
-- payment taken with real money (in live, before the mode changed) used to
-- mark the payment refunded at once and announce nothing. Now the refund's
-- channel decides, as for every other refund: a simulated refund is settled
-- by the register's trigger, any other waits for its money, and
-- `refund.requested` (now with the refund's id) is announced for those.
create or replace function private.cancel_order_internal(p_order_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_paid boolean;
  v_refund_minor bigint := 0;
  v_refund_id uuid;
begin
  perform 1 from public.orders where id = p_order_id for update;
  if exists (
    select 1 from public.shipments s
    where s.order_id = p_order_id and s.status not in ('pending', 'picking', 'cancelled')
  ) then
    perform private.fail('too_late_to_cancel', 'packed');
  end if;

  -- Open returns of this order have nothing left to return.
  update public.return_requests rr
  set status = 'rejected', resolved_at = now(),
      resolution_note = 'Cerrada: el pedido se canceló.'
  from public.order_items i
  where i.id = rr.order_item_id and i.order_id = p_order_id and rr.status in ('requested', 'approved');

  -- Units already taken off a shelf go back to the shelf they came from.
  for r in
    select m.warehouse_id, m.sku_id, m.seller_id, m.from_location_id, m.reference_id,
           sum(m.quantity)::integer as quantity
    from public.stock_movements m
    join public.shipments s on s.id = m.reference_id
    where s.order_id = p_order_id and s.status = 'picking'
      and m.reason = 'pick' and m.reference_type = 'shipment' and m.from_location_id is not null
    group by m.warehouse_id, m.sku_id, m.seller_id, m.from_location_id, m.reference_id
    order by m.sku_id, m.from_location_id
  loop
    insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
    values (r.from_location_id, r.sku_id, r.seller_id, r.quantity)
    on conflict (location_id, sku_id, seller_id)
    do update set quantity = public.bin_stock.quantity + excluded.quantity;
    insert into public.stock_movements
      (warehouse_id, sku_id, seller_id, to_location_id, on_hand_delta, quantity, reason,
       reference_type, reference_id, note, actor_id)
    values
      (r.warehouse_id, r.sku_id, r.seller_id, r.from_location_id, 0, r.quantity, 'putaway',
       'shipment', r.reference_id, 'Pedido cancelado durante la preparación', (select auth.uid()));
  end loop;

  update public.pick_tasks t
  set status = 'cancelled'
  from public.shipments s
  where s.id = t.shipment_id and s.order_id = p_order_id and t.status in ('open', 'in_progress', 'short');

  update public.shipments
  set status = 'cancelled'
  where order_id = p_order_id and status in ('pending', 'picking');

  for r in
    select res.id, res.warehouse_id, res.sku_id, res.seller_id, res.quantity
    from public.inventory_reservations res
    join public.order_items i on i.id = res.order_item_id
    where i.order_id = p_order_id and res.status = 'active'
    order by res.sku_id, res.warehouse_id
    for update of res
  loop
    update public.stock_levels
    set reserved = reserved - r.quantity
    where warehouse_id = r.warehouse_id and sku_id = r.sku_id and seller_id = r.seller_id;
    update public.inventory_reservations
    set status = 'released', resolved_at = now() where id = r.id;
  end loop;

  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 500)
  where id = p_order_id;

  select exists (
    select 1 from public.payments where order_id = p_order_id and status = 'captured'
  ) into v_paid;

  if v_paid then
    -- The refund is booked and registered now, in every mode, so it can
    -- never be booked a second time by another path.
    perform private.post_order_refund(p_order_id);
    select id, amount_minor into v_refund_id, v_refund_minor
    from private.refunds where order_id = p_order_id and reason = 'order_cancelled';
    -- The register's trigger opened the refund's way back
    -- (private.open_gateway_refund). Money that was never real is settled
    -- already (the payment is refunded, the order too) and is confirmed at
    -- commit; real money goes back through the gateway or by transfer, and
    -- the payment and the order follow when it has gone.
    if not exists (select 1 from private.gateway_refunds g
                   where g.refund_id = v_refund_id and g.channel = 'simulated') then
      perform private.emit('refund.requested', jsonb_build_object(
        'order_id', p_order_id, 'refund_id', v_refund_id, 'reason', 'order_cancelled',
        'amount_minor', v_refund_minor));
    end if;
  else
    update public.payments
    set status = 'cancelled'
    where order_id = p_order_id and status in ('pending', 'authorized');
  end if;

  perform private.emit('order.cancelled',
    jsonb_build_object('order_id', p_order_id, 'reason', p_reason));
end;
$$;

-- ═══ 6. Manual confirmation stays for what the gateway does not confirm ═══
-- Unchanged from 20261121082900_integrity.sql, except that a payment going
-- through the gateway is confirmed by the gateway alone: finance settles a
-- transfer the gateway could not match from the review screen instead.
create or replace function public.ops_confirm_payment(
  p_order_id uuid,
  p_bank_reference text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_method public.payment_method;
  v_provider text;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_bank_reference)), 0) not between 4 and 60 then
    perform private.fail('invalid_amount');
  end if;

  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if not found then
    perform private.fail('order_not_found');
  end if;
  if v_status not in ('pending_payment', 'payment_review') then
    perform private.fail('order_not_payable', v_status::text);
  end if;
  select p.method, p.provider into v_method, v_provider from public.payments p
  where p.order_id = p_order_id and p.status in ('pending', 'authorized')
  order by p.created_at limit 1;
  if v_method is null or v_method not in ('sinpe_movil', 'bank_transfer') then
    perform private.fail('order_not_payable', coalesce(v_method::text, ''));
  end if;
  -- Outside sandbox a SINPE Móvil payment is the gateway's to confirm, also
  -- one placed in sandbox (the shopper pays it through the gateway now).
  if private.payments_mode() <> 'sandbox'
     and (v_provider = private.payment_gateway() or (v_provider = 'sandbox' and v_method = 'sinpe_movil')) then
    perform private.fail('confirmed_by_gateway');
  end if;

  perform private.capture_payment(p_order_id, 'manual:' || trim(p_bank_reference), false);
exception
  when unique_violation then
    perform private.fail('invalid_amount');
end;
$$;

-- ═══ 7. What the shopper (and staff) see of a payment ══════════════════════

create or replace function private.order_payment_json(p_order public.orders, p_staff boolean)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
  a private.payment_attempts%rowtype;
  r private.payment_reviews%rowtype;
  v_mode text := private.payments_mode();
  v_gateway text := private.payment_gateway();
  v_expires timestamptz := p_order.placed_at
    + make_interval(mins => coalesce((private.setting('reservation_minutes'))::integer, 30));
  v_tries integer;
  v_max integer := coalesce((private.setting('max_payment_attempts_per_order'))::integer, 5);
  v_stage text;
  v_can_start boolean;
  v_takeover boolean;
begin
  select * into p from public.payments where order_id = p_order.id order by created_at desc limit 1;
  select * into a from private.payment_attempts where order_id = p_order.id
  order by created_at desc limit 1;
  select count(*) into v_tries from private.payment_attempts where order_id = p_order.id;
  -- Money the gateway took for this order that waits for finance, or that
  -- finance sent back: the shopper paid, so the page must say so whatever
  -- the order's own status.
  select * into r from private.payment_reviews x
  where x.order_id = p_order.id
    and x.kind in ('unknown_reference', 'amount_mismatch', 'currency_mismatch', 'late', 'paid_twice',
                   'wrong_environment')
    and x.status in ('open', 'refunding', 'refunded')
  order by x.created_at desc, x.id limit 1;

  -- A card or SINPE Móvil order placed in another mode (sandbox, or the
  -- gateway's other environment) and not yet paid is paid through the
  -- gateway of the current mode: start_payment moves it there.
  v_takeover := p.status = 'pending' and p.method in ('card', 'sinpe_movil') and v_mode <> 'sandbox'
    and (p.provider is distinct from v_gateway or p.environment is distinct from v_mode);

  v_can_start := p_order.status in ('pending_payment', 'payment_review')
    and p.status = 'pending' and v_mode <> 'sandbox' and p.method in ('card', 'sinpe_movil')
    and ((p.provider = v_gateway and p.environment = v_mode) or v_takeover)
    and v_tries < v_max and v_expires > now() + interval '2 minutes'
    and (a.id is null or a.status not in ('creating', 'open', 'processing', 'review'));

  v_stage := case
    when p.method = 'cash_on_delivery' then 'cash'
    when p.status in ('captured', 'partially_refunded', 'refunded') then 'paid'
    when p_order.status in ('cancelled', 'refunded') then
      case when r.status in ('open', 'refunding') then 'review' else 'cancelled' end
    when a.status = 'review' then 'review'
    when v_mode = 'sandbox' and p.status = 'pending' then 'simulated'
    when p.method not in ('card', 'sinpe_movil') then 'manual'
    when v_takeover and (a.id is null or a.environment is distinct from v_mode) then 'start'
    when p.provider <> v_gateway then 'manual'
    when a.id is null then 'start'
    when a.status = 'creating' then 'preparing'
    when a.status in ('open', 'processing') and a.method = 'sinpe_movil' then 'transfer'
    when a.status = 'open' and a.returned_at is null then 'pay'
    when a.status in ('open', 'processing') then 'confirming'
    when a.status = 'failed' then 'failed'
    when a.status = 'error' then 'error'
    else 'start' end;

  return jsonb_build_object(
    'order_id', p_order.id,
    'order_number', p_order.order_number,
    'order_status', p_order.status,
    'mode', v_mode,
    'method', p.method,
    'status', p.status,
    'provider', p.provider,
    'amount_minor', p.amount_minor,
    'currency', p.currency,
    'stage', v_stage,
    'expires_at', v_expires,
    'can_start', v_can_start,
    'attempts_left', greatest(v_max - v_tries, 0),
    'manual_confirmation', p.status = 'pending'
                           and (p.method = 'bank_transfer' or (p.method = 'sinpe_movil' and v_mode = 'sandbox')),
    'attempt', case when a.id is null then null else jsonb_build_object(
      'id', a.id,
      'status', a.status,
      'method', a.method,
      'checkout_url', case when a.status = 'open' then a.checkout_url end,
      'sinpe_destination', case when a.status in ('open', 'processing') then a.sinpe_destination end,
      'suggested_description', 'Pedido ' || p_order.order_number,
      'failure_code', a.failure_code,
      'returned', a.returned_at is not null,
      'created_at', a.created_at,
      'session_reference', case when p_staff then a.session_reference end,
      'intent_reference', case when p_staff then a.intent_reference end) end,
    -- open: finance is deciding; refunding / refunded: it goes, or went, back.
    'money_in_review', case when r.id is null then null else jsonb_build_object(
      'kind', r.kind,
      'status', r.status,
      'amount_minor', r.amount_minor,
      'currency', r.currency,
      'created_at', r.created_at) end,
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'amount_minor', g.amount_minor,
        'channel', g.channel,
        'status', g.status,
        'requested_at', g.requested_at,
        'completed_at', g.completed_at,
        'provider_refund_reference', case when p_staff then g.provider_refund_reference end,
        'failure_code', case when p_staff then g.failure_code end)
        order by g.requested_at, g.id)
      from private.gateway_refunds g where g.order_id = p_order.id and g.refund_id is not null),
      '[]'::jsonb));
end;
$$;

-- The payment of one order, for its shopper and for staff helping them.
create or replace function public.order_payment(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_staff boolean := private.has_staff_role('ops', 'support', 'finance');
begin
  select * into o from public.orders where order_number = p_order_number;
  if not found or not (o.user_id = (select auth.uid()) or v_staff) then
    perform private.fail('order_not_found');
  end if;
  return private.order_payment_json(o, v_staff);
end;
$$;

-- The shopper starts paying an order at the gateway: the first time, and
-- again after a decline. The amount and currency are the order's own. For
-- SINPE Móvil the gateway needs whose account pays (identification and
-- phone): it accepts only a transfer from that account for exactly the
-- amount. Calling it while an attempt is still open returns that attempt.
create or replace function public.start_payment(
  p_order_id uuid,
  p_payer jsonb default null,
  p_return_to text default 'web'
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  p public.payments%rowtype;
  v_live private.payment_attempts%rowtype;
  v_mode text := private.payments_mode();
  v_minutes integer := coalesce((private.setting('reservation_minutes'))::integer, 30);
  v_max integer := coalesce((private.setting('max_payment_attempts_per_order'))::integer, 5);
  v_kind text;
  v_number text;
  v_phone text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.user_id is distinct from (select auth.uid()) then
    perform private.fail('order_not_found');
  end if;
  if v_mode = 'sandbox' then
    perform private.fail('gateway_not_in_use');
  end if;
  select * into p from public.payments where order_id = o.id order by created_at desc limit 1 for update;
  if o.status not in ('pending_payment', 'payment_review') or p.status is distinct from 'pending'
     or p.method not in ('card', 'sinpe_movil') then
    perform private.fail('payment_not_startable');
  end if;

  select * into v_live from private.payment_attempts
  where payment_id = p.id and status in ('creating', 'open', 'processing', 'review')
  order by created_at desc limit 1;
  if found then
    return private.order_payment_json(o, false); -- a double tap: the same attempt
  end if;

  if o.placed_at + make_interval(mins => v_minutes) < now() + interval '2 minutes' then
    perform private.fail('payment_expired');
  end if;
  if (select count(*) from private.payment_attempts where order_id = o.id) >= v_max then
    perform private.fail('payment_attempts_exhausted');
  end if;

  -- Placed in another mode (sandbox, or the gateway's other environment) and
  -- never paid: from now on it is paid through the gateway of this mode.
  -- Nothing of it is open at the old one (the mode changes only when no
  -- attempt there can still be paid).
  if p.provider is distinct from private.payment_gateway() or p.environment is distinct from v_mode then
    update public.payments set provider = private.payment_gateway(), environment = v_mode
    where id = p.id
    returning * into p;
  end if;

  if p.method = 'sinpe_movil' then
    v_kind := p_payer ->> 'kind';
    v_number := regexp_replace(coalesce(p_payer ->> 'number', ''), '[\s-]', '', 'g');
    v_phone := regexp_replace(coalesce(p_payer ->> 'phone', ''), '[\s()-]', '', 'g');
    if v_phone ~ '^[0-9]{8}$' then
      v_phone := '+506' || v_phone;
    end if;
    if v_kind is null or not (
         (v_kind = 'national' and v_number ~ '^[1-9][0-9]{8}$')
      or (v_kind = 'resident' and v_number ~ '^1[0-9]{11}$')
      or (v_kind = 'legal_entity' and v_number ~ '^3[0-9]{9}$')) then
      perform private.fail('payer_id_invalid');
    end if;
    if v_phone !~ '^\+506[5-8][0-9]{7}$' then
      perform private.fail('payer_phone_invalid');
    end if;
  end if;

  -- A declined attempt could still be paid on the gateway's page: stop it
  -- there before the shopper tries again.
  update private.payment_attempts
  set status = 'cancel_requested', work_after = now()
  where payment_id = p.id and status = 'failed';

  insert into private.payment_attempts
    (payment_id, order_id, provider, environment, method, amount_minor, currency, return_to,
     payer_kind, payer_number, payer_phone, expires_at, created_by)
  values
    (p.id, o.id, p.provider, v_mode, p.method, p.amount_minor, p.currency,
     case when p_return_to = 'app' then 'app' else 'web' end,
     case when p.method = 'sinpe_movil' then v_kind end,
     case when p.method = 'sinpe_movil' then v_number end,
     case when p.method = 'sinpe_movil' then v_phone end,
     o.placed_at + make_interval(mins => v_minutes), (select auth.uid()));

  return private.order_payment_json(o, false);
end;
$$;

-- The shopper came back from the gateway's page. Only a hint: it asks the
-- worker to check with the gateway now instead of waiting for its schedule.
create or replace function public.payment_returned(p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or o.user_id is distinct from (select auth.uid()) then
    perform private.fail('order_not_found');
  end if;
  update private.payment_attempts a
  set returned_at = coalesce(a.returned_at, now()), work_after = least(a.work_after, now())
  where a.id = (select x.id from private.payment_attempts x where x.order_id = o.id
                order by x.created_at desc limit 1)
    and a.status in ('open', 'processing', 'failed');
  return private.order_payment_json(o, false);
end;
$$;

-- ═══ 8. Applying what the gateway says ═════════════════════════════════════

create or replace function private.payment_review_add(
  p_kind text,
  p_event bigint,
  p_provider text,
  p_environment text,
  p_order uuid,
  p_attempt uuid,
  p_reference text,
  p_amount bigint,
  p_currency text,
  p_detail text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into private.payment_reviews
    (provider, environment, kind, event_id, order_id, attempt_id, payment_reference,
     amount_minor, currency, detail)
  values
    (p_provider, p_environment, p_kind, p_event, p_order, p_attempt, p_reference,
     p_amount, left(p_currency, 3), left(p_detail, 500))
  on conflict do nothing;
end;
$$;

-- The same money was applied to its order after all: an item kept as money
-- of no known attempt (its events came in an order that hid the match) is
-- closed, so that it can never be refunded on top of the order's own refunds.
create or replace function private.payment_reviews_close_applied(
  p_provider text,
  p_order uuid,
  p_intent text,
  p_session text,
  p_reference text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update private.payment_reviews
  set status = 'dismissed', resolved_at = now(), resolved_order_id = p_order,
      resolution_note = 'Cerrado solo: el mismo pago se aplicó al pedido '
                        || (select order_number from public.orders where id = p_order) || '.'
  where provider = p_provider and kind = 'unknown_reference' and status = 'open'
    and payment_reference in (p_intent, p_session, p_reference);
end;
$$;

-- A payment event (normalised by the worker's adapter). Returns its outcome.
create or replace function private.payments_apply_payment(p_row bigint, p_event jsonb) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_provider text := p_event ->> 'provider';
  v_env text := p_event ->> 'environment';
  v_type text := p_event ->> 'type';
  v_pay jsonb := coalesce(p_event -> 'payment', '{}'::jsonb);
  v_session text := nullif(v_pay ->> 'session_reference', '');
  v_intent text := nullif(v_pay ->> 'reference', '');
  v_amount bigint := (v_pay ->> 'amount_minor')::bigint;
  v_currency text := v_pay ->> 'currency';
  v_updated timestamptz := (v_pay ->> 'updated_at')::timestamptz;
  v_meta_attempt text := v_pay #>> '{metadata,attemptId}';
  v_meta_order text := v_pay #>> '{metadata,orderId}';
  v_fee bigint := (v_pay ->> 'fee_minor')::bigint;
  v_attempt_id uuid;
  v_order_id uuid;
  a private.payment_attempts%rowtype;
  o public.orders%rowtype;
  p public.payments%rowtype;
  v_reference text;
begin
  select x.id, x.order_id into v_attempt_id, v_order_id
  from private.payment_attempts x
  where x.provider = v_provider and x.environment = v_env
    and ((v_session is not null and x.session_reference = v_session)
      or (v_intent is not null and x.intent_reference = v_intent))
  order by x.created_at desc limit 1;

  -- An attempt that does not know this intent yet: a card's intent event
  -- can come before the session event that names the intent, and a create
  -- whose answer was lost knows no reference at all. The event is signed and
  -- only we create objects with our key, so our attempt id in its metadata
  -- identifies the attempt, as long as the attempt holds no other intent
  -- (and no other session); amounts are still checked below. Otherwise the
  -- same capture would also be kept as unknown money, and could be refunded
  -- while the order is fulfilled.
  if v_attempt_id is null and v_meta_attempt ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select x.id, x.order_id into v_attempt_id, v_order_id
    from private.payment_attempts x
    where x.id = v_meta_attempt::uuid and x.provider = v_provider and x.environment = v_env
      and (x.intent_reference is null or x.intent_reference = v_intent)
      and (v_session is null or x.session_reference is null or x.session_reference = v_session);
  end if;

  if v_attempt_id is null then
    -- An intent event without our metadata, before the session event that
    -- names it: the session event, or a check, settles it. Only a session
    -- nobody knows, or an intent carrying our own metadata (of an attempt
    -- that holds another intent, or of none of ours), is money to keep.
    if v_type = 'payment.succeeded' and (v_session is not null or v_meta_attempt is not null) then
      perform private.payment_review_add('unknown_reference', p_row, v_provider, v_env,
        (select id from public.orders where v_meta_order ~ '^[0-9a-f-]{36}$' and id = v_meta_order::uuid),
        null, coalesce(v_intent, v_session), v_amount, v_currency,
        'El pago no corresponde a ningún intento registrado.');
    end if;
    return 'unmatched';
  end if;

  -- The order's lock first, as every function that moves its money.
  select * into o from public.orders where id = v_order_id for update;
  select * into a from private.payment_attempts where id = v_attempt_id for update;
  update private.payment_events set attempt_id = a.id, order_id = o.id where id = p_row;

  update private.payment_attempts
  set session_reference = coalesce(session_reference, v_session),
      intent_reference = coalesce(intent_reference, v_intent)
  where id = a.id;
  v_reference := coalesce(v_intent, a.intent_reference, 'session:' || coalesce(v_session, a.session_reference));

  if v_type = 'payment.succeeded' then
    if a.status in ('succeeded', 'review') then
      if a.status = 'succeeded' then
        perform private.payment_reviews_close_applied(v_provider, o.id, v_intent, v_session, v_reference);
      end if;
      return 'duplicate'; -- the same money, already applied or already kept
    end if;
    if v_currency is distinct from a.currency then
      update private.payment_attempts set status = 'review', finished_at = now() where id = a.id;
      perform private.payment_review_add('currency_mismatch', p_row, v_provider, v_env, o.id, a.id,
        v_reference, v_amount, v_currency, 'La moneda no es la del pedido.');
      return 'mismatch';
    end if;
    if v_amount is distinct from a.amount_minor then
      update private.payment_attempts set status = 'review', finished_at = now() where id = a.id;
      perform private.payment_review_add('amount_mismatch', p_row, v_provider, v_env, o.id, a.id,
        v_reference, v_amount, v_currency, 'El monto no es el del pedido.');
      return 'mismatch';
    end if;
    select * into p from public.payments where id = a.payment_id for update;
    if p.status in ('captured', 'partially_refunded', 'refunded') then
      update private.payment_attempts set status = 'review', finished_at = now() where id = a.id;
      perform private.payment_review_add('paid_twice', p_row, v_provider, v_env, o.id, a.id,
        v_reference, v_amount, v_currency, 'El pedido ya estaba pagado.');
      return 'paid_twice';
    end if;
    if o.status not in ('pending_payment', 'payment_review') or p.status <> 'pending' then
      update private.payment_attempts set status = 'review', finished_at = now() where id = a.id;
      perform private.payment_review_add('late', p_row, v_provider, v_env, o.id, a.id,
        v_reference, v_amount, v_currency, 'Llegó cuando el pedido ya estaba cancelado.');
      return 'late';
    end if;

    update private.payment_attempts
    set status = 'succeeded', finished_at = now(), failure_code = null,
        provider_updated_at = greatest(provider_updated_at, v_updated),
        locked_until = null, locked_by = null
    where id = a.id;
    perform private.capture_payment(o.id, v_reference, false);
    update public.payments set gateway_reference = v_reference
    where id = p.id and v_reference not like 'session:%';
    perform private.record_gateway_fee(p.id, v_fee, 'gateway');
    perform private.payment_reviews_close_applied(v_provider, o.id, v_intent, v_session, v_reference);
    return 'applied';
  end if;

  -- Anything but a success: never undoes a final state, and an older state
  -- than the one already applied is stale (the gateway does not keep order).
  if a.status in ('succeeded', 'review', 'cancelled', 'expired', 'error') then
    return 'stale';
  end if;
  if v_updated is not null and a.provider_updated_at is not null and v_updated < a.provider_updated_at then
    return 'stale';
  end if;

  if v_type = 'payment.processing' then
    update private.payment_attempts
    set status = case when status in ('open', 'failed') then 'processing' else status end,
        provider_updated_at = coalesce(v_updated, provider_updated_at)
    where id = a.id;
    return 'applied';
  elsif v_type = 'payment.failed' then
    update private.payment_attempts
    set status = case when status in ('creating', 'open', 'processing') then 'failed' else status end,
        failure_code = left(coalesce(v_pay ->> 'failure_code', 'declined'), 80),
        declined_at = coalesce(declined_at, now()),
        provider_updated_at = coalesce(v_updated, provider_updated_at)
    where id = a.id;
    update public.payments set failure_reason = left(coalesce(v_pay ->> 'failure_code', 'declined'), 200)
    where id = a.payment_id and status = 'pending';
    return 'applied';
  elsif v_type in ('payment.cancelled', 'payment.expired') then
    update private.payment_attempts
    set status = case when v_type = 'payment.expired' then 'expired' else 'cancelled' end,
        finished_at = now(), provider_updated_at = coalesce(v_updated, provider_updated_at),
        locked_until = null, locked_by = null
    where id = a.id;
    return 'applied';
  end if;
  return 'ignored';
end;
$$;

-- A refund event: the gateway accepted, completed or refused a refund.
create or replace function private.payments_apply_refund(p_row bigint, p_event jsonb) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_provider text := p_event ->> 'provider';
  v_env text := p_event ->> 'environment';
  v_type text := p_event ->> 'type';
  v_ref jsonb := coalesce(p_event -> 'refund', '{}'::jsonb);
  v_rref text := nullif(v_ref ->> 'reference', '');
  v_pref text := nullif(v_ref ->> 'payment_reference', '');
  v_amount bigint := (v_ref ->> 'amount_minor')::bigint;
  v_updated timestamptz := (v_ref ->> 'updated_at')::timestamptz;
  v_id uuid;
  v_order uuid;
  g private.gateway_refunds%rowtype;
begin
  select x.id, x.order_id into v_id, v_order from private.gateway_refunds x
  where x.provider = v_provider and x.environment = v_env and x.provider_refund_reference = v_rref;
  if v_id is null then
    -- Sent, but its answer was lost: the gateway's first word about it names it.
    select x.id, x.order_id into v_id, v_order from private.gateway_refunds x
    where x.provider = v_provider and x.environment = v_env and x.channel = 'gateway'
      and x.payment_reference = v_pref and x.amount_minor = v_amount
      and x.provider_refund_reference is null and x.status in ('sending', 'sent', 'unknown')
    order by x.requested_at, x.id limit 1;
  end if;
  if v_id is null then
    if v_type = 'refund.succeeded' then
      perform private.payment_review_add('unknown_refund', p_row, v_provider, v_env,
        (select a.order_id from private.payment_attempts a
         where a.provider = v_provider and a.intent_reference = v_pref limit 1),
        null, v_rref, v_amount, v_ref ->> 'currency',
        'Reembolso que no pedimos (¿hecho a mano en la pasarela?).');
    end if;
    return 'unmatched';
  end if;

  if v_order is not null then
    perform 1 from public.orders where id = v_order for update;
  end if;
  select * into g from private.gateway_refunds where id = v_id for update;
  update private.payment_events set gateway_refund_id = g.id, order_id = g.order_id where id = p_row;
  update private.gateway_refunds
  set provider_refund_reference = coalesce(provider_refund_reference, v_rref)
  where id = g.id;

  if v_amount is distinct from g.amount_minor then
    return 'mismatch';
  end if;
  if g.status = 'succeeded' then
    return case when v_type = 'refund.succeeded' then 'duplicate' else 'stale' end;
  end if;
  if v_updated is not null and g.provider_updated_at is not null and v_updated < g.provider_updated_at then
    return 'stale';
  end if;

  if v_type = 'refund.created' then
    if g.status = 'failed' then
      return 'stale';
    end if;
    update private.gateway_refunds
    set status = 'sent', sent_at = coalesce(sent_at, now()), provider_updated_at = coalesce(v_updated, provider_updated_at),
        locked_until = null, locked_by = null, work_after = now() + interval '10 minutes'
    where id = g.id and status in ('requested', 'sending', 'unknown', 'sent');
    return 'applied';
  elsif v_type = 'refund.succeeded' then
    update private.gateway_refunds set provider_updated_at = coalesce(v_updated, provider_updated_at)
    where id = g.id;
    perform private.complete_gateway_refund(g.id);
    return 'applied';
  elsif v_type = 'refund.failed' then
    update private.gateway_refunds
    set status = 'failed', failed_at = now(),
        failure_code = left(coalesce(v_ref ->> 'failure_code', 'unknown'), 80),
        provider_updated_at = coalesce(v_updated, provider_updated_at),
        locked_until = null, locked_by = null
    where id = g.id;
    return 'applied';
  end if;
  return 'ignored';
end;
$$;

-- A payment taken in the gateway environment the mode has left: kept for
-- finance (kind wrong_environment), with its attempt marked as in review so
-- the shopper's page says the money arrived.
create or replace function private.payments_keep_other_environment(p_row bigint, p_event jsonb) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_provider text := p_event ->> 'provider';
  v_env text := p_event ->> 'environment';
  v_pay jsonb := coalesce(p_event -> 'payment', '{}'::jsonb);
  v_session text := nullif(v_pay ->> 'session_reference', '');
  v_intent text := nullif(v_pay ->> 'reference', '');
  v_meta_attempt text := v_pay #>> '{metadata,attemptId}';
  v_meta_order text := v_pay #>> '{metadata,orderId}';
  v_attempt_id uuid;
  v_order_id uuid;
  a private.payment_attempts%rowtype;
begin
  select x.id, x.order_id into v_attempt_id, v_order_id
  from private.payment_attempts x
  where x.provider = v_provider and x.environment = v_env
    and ((v_session is not null and x.session_reference = v_session)
      or (v_intent is not null and x.intent_reference = v_intent)
      or (v_meta_attempt ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and x.id = v_meta_attempt::uuid and (x.intent_reference is null or x.intent_reference = v_intent)))
  order by x.created_at desc limit 1;

  if v_attempt_id is not null then
    perform 1 from public.orders where id = v_order_id for update;
    select * into a from private.payment_attempts where id = v_attempt_id for update;
    update private.payment_events set attempt_id = a.id, order_id = a.order_id where id = p_row;
    if a.status in ('succeeded', 'review') then
      return 'duplicate';
    end if;
    update private.payment_attempts
    set status = 'review', finished_at = now(),
        intent_reference = coalesce(intent_reference, v_intent),
        locked_until = null, locked_by = null
    where id = a.id;
  else
    v_order_id := (select id from public.orders
                   where v_meta_order ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     and id = v_meta_order::uuid);
  end if;

  perform private.payment_review_add('wrong_environment', p_row, v_provider, v_env, v_order_id, v_attempt_id,
    coalesce(v_intent, 'session:' || v_session), (v_pay ->> 'amount_minor')::bigint, v_pay ->> 'currency',
    format('Pagado en el entorno %s de la pasarela cuando el modo de pagos ya era %s.',
           v_env, private.payments_mode()));
  return 'wrong_environment';
end;
$$;

-- Every event, once. The event's id is recorded first, in the same
-- transaction as its effect: a second delivery (or one running in parallel,
-- which waits on the unique index) finds it and changes nothing.
create or replace function private.payments_apply_event(p_event jsonb) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_provider text := p_event ->> 'provider';
  v_event_id text := p_event ->> 'event_id';
  v_type text := coalesce(p_event ->> 'type', '');
  v_source text := coalesce(p_event ->> 'source', 'webhook');
  v_env text := p_event ->> 'environment';
  v_row bigint;
  v_outcome text;
  v_transfer jsonb := p_event -> 'transfer';
  v_dispute jsonb := p_event -> 'dispute';
begin
  if v_provider is null or v_event_id is null or v_type = ''
     or v_source not in ('webhook', 'poll') or char_length(v_event_id) > 200 then
    perform private.fail('payment_event_invalid');
  end if;

  -- An answer to the worker's question pushes the next question back.
  if v_source = 'poll' and p_event ? 'attempt_id' then
    update private.payment_attempts
    set last_checked_at = now(), checks = checks + 1,
        work_after = now() + make_interval(mins => least(30, (2 ^ least(checks, 5))::integer)),
        locked_until = null, locked_by = null
    where id = (p_event ->> 'attempt_id')::uuid;
  end if;

  insert into private.payment_events
    (provider, event_id, source, event_type, provider_type, environment, occurred_at, data)
  values
    (v_provider, v_event_id, v_source, left(v_type, 60), left(p_event ->> 'provider_type', 80), v_env,
     (p_event ->> 'occurred_at')::timestamptz,
     p_event - 'raw')
  on conflict (provider, event_id) do nothing
  returning id into v_row;
  if v_row is null then
    return 'duplicate';
  end if;

  if v_provider <> private.payment_gateway() or v_env is null or v_env not in ('test', 'live') then
    v_outcome := 'wrong_mode';
  elsif v_env is distinct from private.payments_mode() then
    -- From the environment the mode has left (the mode changes only when
    -- nothing is open there, but a page can still be paid, and events
    -- arrive late). Money taken there is never applied to an order by
    -- itself, and never silently dropped: it is kept for finance. A refund
    -- there can still complete (it only settles what we owe). Anything else
    -- changes nothing.
    if v_type = 'payment.succeeded' then
      v_outcome := private.payments_keep_other_environment(v_row, p_event);
    elsif v_type like 'refund.%' then
      v_outcome := private.payments_apply_refund(v_row, p_event);
    else
      v_outcome := 'wrong_mode';
    end if;
  elsif v_type like 'payment.%' then
    v_outcome := private.payments_apply_payment(v_row, p_event);
  elsif v_type like 'refund.%' then
    v_outcome := private.payments_apply_refund(v_row, p_event);
  elsif v_type = 'transfer.received' and nullif(v_transfer ->> 'payment_reference', '') is null then
    perform private.payment_review_add('unmatched_transfer', v_row, v_provider, v_env, null, null,
      v_transfer ->> 'reference', (v_transfer ->> 'amount_minor')::bigint, v_transfer ->> 'currency',
      left('Transferencia sin pago asociado. ' || coalesce(v_transfer ->> 'description', ''), 500));
    v_outcome := 'unmatched';
  elsif v_type like 'dispute.%' then
    perform private.payment_review_add('dispute', v_row, v_provider, v_env,
      (select a.order_id from private.payment_attempts a
       where a.provider = v_provider and a.intent_reference = v_dispute ->> 'payment_reference' limit 1),
      null, v_dispute ->> 'reference', (v_dispute ->> 'amount_minor')::bigint, 'CRC',
      left('Contracargo: ' || coalesce(v_dispute ->> 'status', '') ||
           coalesce(' · responder antes del ' || (v_dispute ->> 'respond_by'), ''), 500));
    v_outcome := 'recorded';
  else
    v_outcome := 'ignored';
  end if;

  update private.payment_events set outcome = v_outcome where id = v_row;
  return v_outcome;
end;
$$;

-- ═══ 9. The worker's functions (server-side key only) ══════════════════════

-- The worker says what it holds for its environment; the answer says whether
-- it has anything to do (the mode is its environment and the gateway its own).
create or replace function public.worker_payments_hello(
  p_provider text,
  p_environment text,
  p_account text,
  p_keys_ready boolean,
  p_webhook_ready boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  if p_environment not in ('test', 'live') or coalesce(char_length(p_provider), 0) not between 1 and 40 then
    perform private.fail('payment_event_invalid');
  end if;
  insert into private.payment_gateway_status
    (provider, environment, account_ref, keys_ready, webhook_ready, reported_at)
  values (p_provider, p_environment, left(p_account, 120), coalesce(p_keys_ready, false),
          coalesce(p_webhook_ready, false), now())
  on conflict (provider, environment) do update
  set account_ref = excluded.account_ref, keys_ready = excluded.keys_ready,
      webhook_ready = excluded.webhook_ready, reported_at = excluded.reported_at;
  return jsonb_build_object(
    'mode', private.payments_mode(),
    'gateway', private.payment_gateway(),
    'active', private.payments_mode() = p_environment and private.payment_gateway() = p_provider);
end;
$$;

-- Hands the worker what is due, each under a lease. A task whose lease ran
-- out without a report is never simply repeated: an attempt being created is
-- marked "unknown" (it may exist at the gateway; the shopper can start a new
-- one), a refund being sent is marked "unknown" and checked first.
create or replace function public.worker_payments_claim(
  p_worker text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_env text := private.payments_mode();
  v_provider text := private.payment_gateway();
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 15), 300));
  v_tasks jsonb := '[]'::jsonb;
  v_more jsonb;
begin
  perform private.require_worker();
  if coalesce(char_length(p_worker), 0) not between 1 and 100 then
    perform private.fail('payment_event_invalid');
  end if;
  if v_env = 'sandbox' then
    return v_tasks;
  end if;

  -- Abandoned leases.
  update private.payment_attempts
  set status = 'error', create_outcome = 'unknown', failure_code = 'create_unconfirmed',
      payer_kind = null, payer_number = null, payer_phone = null,
      finished_at = now(), locked_until = null, locked_by = null
  where status = 'creating' and locked_until < now();
  update private.gateway_refunds
  set status = 'unknown', unknown_at = coalesce(unknown_at, now()), locked_until = null, locked_by = null,
      work_after = now() + interval '1 minute'
  where status = 'sending' and locked_until < now();
  -- Never created at the gateway: nothing to stop there.
  update private.payment_attempts
  set status = 'cancelled', finished_at = now(),
      create_outcome = case when locked_until is not null and create_outcome is null then 'unknown'
                            else create_outcome end
  where status = 'cancel_requested' and session_reference is null and intent_reference is null
    and (locked_until is null or locked_until < now());

  with due as (
    select a.id from private.payment_attempts a
    where a.provider = v_provider and a.environment = v_env
      and (a.locked_until is null or a.locked_until < now()) and a.work_after <= now()
      and (a.status in ('creating', 'cancel_requested')
           or (a.status in ('open', 'processing', 'failed') and now() < a.expires_at + interval '1 day'))
    order by a.work_after, a.id
    limit v_limit
    for update skip locked
  ), claimed as (
    update private.payment_attempts a
    set locked_until = now() + v_lease, locked_by = p_worker,
        tries = a.tries + (a.status = 'creating')::int
    from due where a.id = due.id
    returning a.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', case c.status when 'creating' then 'create' when 'cancel_requested' then 'cancel' else 'check' end,
    'attempt_id', c.id,
    'order_id', c.order_id,
    'payment_id', c.payment_id,
    'order_number', o.order_number,
    'method', c.method,
    'amount_minor', c.amount_minor,
    'currency', c.currency,
    'return_to', c.return_to,
    'expires_at', c.expires_at,
    'session_reference', c.session_reference,
    'intent_reference', c.intent_reference,
    'customer', case when c.status = 'creating' then jsonb_build_object(
      'name', coalesce(pr.full_name, o.ship_recipient_name),
      'email', (select u.email from auth.users u where u.id = o.user_id)) end,
    'payer', case when c.status = 'creating' and c.method = 'sinpe_movil' then jsonb_build_object(
      'kind', c.payer_kind, 'number', c.payer_number, 'phone', c.payer_phone) end
  ) order by c.work_after), '[]'::jsonb)
  into v_tasks
  from claimed c
  join public.orders o on o.id = c.order_id
  left join public.profiles pr on pr.id = o.user_id;

  with due as (
    select g.id from private.gateway_refunds g
    where g.channel = 'gateway' and g.provider = v_provider and g.environment = v_env
      and g.status in ('requested', 'unknown', 'sent')
      and (g.locked_until is null or g.locked_until < now()) and g.work_after <= now()
    order by g.work_after, g.id
    limit v_limit
    for update skip locked
  ), claimed as (
    update private.gateway_refunds g
    set status = case when g.status = 'requested' then 'sending' else g.status end,
        send_count = g.send_count + (g.status = 'requested')::int,
        locked_until = now() + v_lease, locked_by = p_worker
    from due where g.id = due.id
    returning g.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', case c.status when 'sending' then 'refund' when 'unknown' then 'refund_check'
            else 'refund_poll' end,
    'gateway_refund_id', c.id,
    'order_number', (select o.order_number from public.orders o where o.id = c.order_id),
    'payment_reference', c.payment_reference,
    'provider_refund_reference', c.provider_refund_reference,
    'amount_minor', c.amount_minor,
    'currency', c.currency,
    'reason', case when c.review_id is not null then 'duplicate' else 'requested_by_customer' end,
    'known_refunded_minor', (
      select coalesce(sum(x.amount_minor), 0) from private.gateway_refunds x
      where x.provider = c.provider and x.payment_reference = c.payment_reference and x.id <> c.id
        and x.status in ('sent', 'succeeded'))
  ) order by c.work_after), '[]'::jsonb)
  into v_more
  from claimed c;

  return v_tasks || v_more;
end;
$$;

-- What happened to a task the worker was given.
create or replace function public.worker_payments_report(p_worker text, p_report jsonb) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_kind text := p_report ->> 'kind';
  v_outcome text := p_report ->> 'outcome';
  a private.payment_attempts%rowtype;
  g private.gateway_refunds%rowtype;
  v_order uuid;
  v_refunded bigint;
  v_known bigint;
  v_hold_minutes integer := coalesce((private.setting('gateway_refund_unknown_hold_minutes'))::integer, 60);
begin
  perform private.require_worker();

  if v_kind in ('created', 'cancelled', 'release_attempt') then
    select order_id into v_order from private.payment_attempts where id = (p_report ->> 'attempt_id')::uuid;
    if v_order is null then
      perform private.fail('payment_event_invalid');
    end if;
    perform 1 from public.orders where id = v_order for update;
    select * into a from private.payment_attempts where id = (p_report ->> 'attempt_id')::uuid for update;
    if a.locked_by is distinct from p_worker then
      return 'stale_lease';
    end if;

    if v_kind = 'release_attempt' then
      update private.payment_attempts
      set locked_until = null, locked_by = null,
          work_after = now() + make_interval(secs => least(coalesce((p_report ->> 'retry_after_seconds')::integer, 30), 3600))
      where id = a.id;
      return 'released';
    end if;

    if v_kind = 'created' then
      if v_outcome = 'created' then
        update private.payment_attempts
        set session_reference = nullif(p_report ->> 'session_reference', ''),
            intent_reference = nullif(p_report ->> 'intent_reference', ''),
            checkout_url = nullif(p_report ->> 'checkout_url', ''),
            sinpe_destination = nullif(p_report ->> 'sinpe_destination', ''),
            create_outcome = 'created',
            -- Created after all for an attempt given up meanwhile: stop it there.
            status = case when status = 'creating'
                          then case when p_report ->> 'status' = 'processing' then 'processing' else 'open' end
                          when status in ('cancelled', 'error') then 'cancel_requested'
                          else status end,
            payer_kind = null, payer_number = null, payer_phone = null,
            locked_until = null, locked_by = null, failure_code = null,
            work_after = case when status = 'creating' then now() + interval '2 minutes' else now() end
        where id = a.id;
        return 'recorded';
      elsif v_outcome = 'refused' and coalesce((p_report ->> 'retryable')::boolean, false)
            and a.tries < 3 and a.status = 'creating' then
        update private.payment_attempts
        set locked_until = null, locked_by = null, work_after = now() + make_interval(secs => 15 * a.tries)
        where id = a.id;
        return 'retry';
      else
        update private.payment_attempts
        set status = case when status = 'creating' then 'error'
                          when status = 'cancel_requested' and v_outcome = 'refused' then 'cancelled'
                          else status end,
            create_outcome = case when v_outcome = 'unknown' then 'unknown' else 'refused' end,
            failure_code = left(coalesce(p_report ->> 'code', 'create_failed'), 80),
            payer_kind = null, payer_number = null, payer_phone = null,
            finished_at = case when status in ('creating', 'cancel_requested') then now() end,
            locked_until = null, locked_by = null
        where id = a.id;
        return 'recorded';
      end if;
    end if;

    -- cancelled
    if coalesce((p_report ->> 'ok')::boolean, false) then
      update private.payment_attempts
      set status = case when status = 'cancel_requested' then 'cancelled' else status end,
          finished_at = coalesce(finished_at, now()), locked_until = null, locked_by = null
      where id = a.id;
    else
      -- Could not stop it (perhaps it was just paid): the next notification
      -- or check says what happened; try again later meanwhile.
      update private.payment_attempts
      set locked_until = null, locked_by = null, failure_code = left(p_report ->> 'code', 80),
          work_after = now() + make_interval(mins => least(30, 1 + a.checks)), checks = checks + 1
      where id = a.id;
    end if;
    return 'recorded';
  end if;

  if v_kind in ('refund_sent', 'refund_checked', 'release_refund') then
    select order_id into v_order from private.gateway_refunds
    where id = (p_report ->> 'gateway_refund_id')::uuid;
    if not found then
      perform private.fail('payment_event_invalid');
    end if;
    if v_order is not null then
      perform 1 from public.orders where id = v_order for update;
    end if;
    select * into g from private.gateway_refunds where id = (p_report ->> 'gateway_refund_id')::uuid for update;
    if g.locked_by is distinct from p_worker then
      return 'stale_lease';
    end if;

    if v_kind = 'release_refund' then
      update private.gateway_refunds
      set status = case when status = 'sending' then 'unknown' else status end,
          unknown_at = case when status in ('sending', 'unknown') then coalesce(unknown_at, now()) end,
          locked_until = null, locked_by = null,
          work_after = now() + make_interval(secs => least(coalesce((p_report ->> 'retry_after_seconds')::integer, 60), 3600))
      where id = g.id;
      return 'released';
    end if;

    if v_kind = 'refund_sent' then
      if v_outcome = 'accepted' then
        update private.gateway_refunds
        set status = 'sent', sent_at = now(),
            provider_refund_reference = coalesce(provider_refund_reference,
                                                 nullif(p_report ->> 'provider_refund_reference', '')),
            locked_until = null, locked_by = null, work_after = now() + interval '10 minutes'
        where id = g.id and status in ('sending', 'unknown');
        -- The provider may answer with the final status at once; that answer
        -- is itself its confirmation.
        if p_report ->> 'status' = 'succeeded' then
          perform private.complete_gateway_refund(g.id);
        elsif p_report ->> 'status' = 'failed' then
          update private.gateway_refunds
          set status = 'failed', failed_at = now(), failure_code = left(coalesce(p_report ->> 'code', 'declined'), 80)
          where id = g.id;
        end if;
      elsif v_outcome = 'refused' then
        -- Refused outright: the gateway created nothing. Finance decides.
        update private.gateway_refunds
        set status = 'failed', failed_at = now(), failure_code = left(coalesce(p_report ->> 'code', 'refused'), 80),
            locked_until = null, locked_by = null
        where id = g.id;
      else
        update private.gateway_refunds
        set status = 'unknown', unknown_at = coalesce(unknown_at, now()),
            locked_until = null, locked_by = null, work_after = now() + interval '2 minutes'
        where id = g.id;
      end if;
      return 'recorded';
    end if;

    -- refund_checked: a send whose answer was lost. The gateway has no
    -- idempotency key, and the note does not say that a refund still pending
    -- there already shows in the intent's refunded total, so reading "nothing
    -- refunded" does not prove it was never created. It is never sent again
    -- by itself: while the hold lasts (longer than the gateway's first
    -- webhook deliveries) the worker keeps asking, and refund.created or
    -- refund.succeeded, matched by payment and amount, settles it; the
    -- intent's refunded total settles it when it covers every refund of that
    -- payment we know of, this one and any other whose answer was lost.
    -- After the hold, finance is asked (failed, send_unconfirmed): they check
    -- the gateway's dashboard and send it again or pay it by transfer.
    v_refunded := (p_report ->> 'provider_refunded_minor')::bigint;
    select coalesce(sum(x.amount_minor), 0) into v_known from private.gateway_refunds x
    where x.provider = g.provider and x.payment_reference = g.payment_reference and x.id <> g.id
      and x.channel = 'gateway' and x.status in ('sent', 'succeeded', 'sending', 'unknown');
    if v_refunded is not null and v_refunded >= v_known + g.amount_minor then
      update private.gateway_refunds
      set status = 'sent', sent_at = coalesce(sent_at, now()), locked_until = null, locked_by = null,
          work_after = now() + interval '10 minutes'
      where id = g.id;
    elsif coalesce(g.unknown_at, now()) > now() - make_interval(mins => v_hold_minutes) then
      update private.gateway_refunds set locked_until = null, locked_by = null,
        work_after = now() + interval '5 minutes' where id = g.id;
    else
      update private.gateway_refunds
      set status = 'failed', failed_at = now(), failure_code = 'send_unconfirmed',
          locked_until = null, locked_by = null
      where id = g.id;
    end if;
    return 'recorded';
  end if;

  perform private.fail('payment_event_invalid');
end;
$$;

-- A notification from the gateway (signature already checked by the
-- function), or the answer to the worker's own question about an attempt.
create or replace function public.worker_payments_event(p_event jsonb) returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  return private.payments_apply_event(p_event);
end;
$$;

-- ═══ 10. Finance ═══════════════════════════════════════════════════════════

-- Whether the gateway's id of some money is already the payment of an order
-- (applied by its own event, or by finance): then it must not be applied or
-- refunded again from a review.
create or replace function private.payment_reference_applied(p_provider text, p_reference text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_reference is not null and exists (
    select 1 from public.payments p
    where p.status in ('captured', 'partially_refunded', 'refunded')
      and (p.gateway_reference = p_reference or (p.provider = p_provider and p.provider_reference = p_reference)));
$$;

-- Money of the gateway's test environment pays only an order of that
-- environment, and real money never an order taken in test.
create or replace function private.payment_environments_fit(p_money text, p_payment text) returns boolean
language sql immutable security definer
set search_path = ''
as $$
  select not ('test' in (coalesce(p_money, ''), coalesce(p_payment, '')) and p_money is distinct from p_payment);
$$;

create or replace function private.payment_review_json(r private.payment_reviews) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'provider', r.provider,
    'environment', r.environment,
    'order_number', (select o.order_number from public.orders o where o.id = r.order_id),
    'order_status', (select o.status from public.orders o where o.id = r.order_id),
    'payment_reference', r.payment_reference, 'amount_minor', r.amount_minor,
    'currency', r.currency, 'detail', r.detail, 'created_at', r.created_at,
    'resolved_order_number', (select o.order_number from public.orders o where o.id = r.resolved_order_id),
    'resolution_note', r.resolution_note, 'resolved_at', r.resolved_at,
    'can_refund', r.status = 'open' and r.amount_minor > 0 and r.kind not in ('unknown_refund', 'dispute')
                  and not private.payment_reference_applied(r.provider, r.payment_reference),
    'can_accept', r.status = 'open' and r.kind not in ('unknown_refund', 'dispute')
                  and not private.payment_reference_applied(r.provider, r.payment_reference) and exists (
      select 1 from public.orders o join public.payments p on p.order_id = o.id
      where o.id = r.order_id and o.status in ('pending_payment', 'payment_review')
        and p.status = 'pending' and p.amount_minor = r.amount_minor and r.currency = p.currency
        and private.payment_environments_fit(r.environment, p.environment)),
    'can_attach', r.status = 'open' and r.amount_minor > 0 and r.kind not in ('unknown_refund', 'dispute')
                  and not private.payment_reference_applied(r.provider, r.payment_reference),
    'refund', (select jsonb_build_object('status', g.status, 'channel', g.channel)
               from private.gateway_refunds g where g.review_id = r.id));
$$;

create or replace function public.ops_payment_reviews(p_open_only boolean default true) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(private.payment_review_json(r) order by r.created_at desc, r.id)
    from (select * from private.payment_reviews x
          where not coalesce(p_open_only, true) or x.status in ('open', 'refunding')
          order by x.created_at desc limit 200) r), '[]'::jsonb);
end;
$$;

-- Finance settles one item: accept it as the payment of its order, attach it
-- to another order, refund it, or close it with a note.
create or replace function public.ops_resolve_payment_review(
  p_review_id uuid,
  p_action text,
  p_order_number text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r private.payment_reviews%rowtype;
  v_target uuid;
  o public.orders%rowtype;
  p public.payments%rowtype;
  v_note text := left(nullif(trim(p_note), ''), 500);
  v_reference text;
  v_channel text;
  v_refund uuid;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if p_action not in ('accept', 'attach', 'refund', 'dismiss') then
    perform private.fail('payment_review_action_invalid');
  end if;
  if coalesce(char_length(v_note), 0) < 4 then
    perform private.fail('payment_review_note_required');
  end if;
  select * into r from private.payment_reviews where id = p_review_id;
  if not found then
    perform private.fail('payment_review_not_found');
  end if;

  if p_action in ('accept', 'attach') then
    v_target := case when p_action = 'accept' then r.order_id
                     else (select id from public.orders where order_number = trim(p_order_number)) end;
    if v_target is null then
      perform private.fail('order_not_found');
    end if;
    -- The order first, then the item, as everywhere money moves.
    select * into o from public.orders where id = v_target for update;
  end if;
  select * into r from private.payment_reviews where id = p_review_id for update;
  if r.status <> 'open' then
    perform private.fail('payment_review_closed');
  end if;
  -- The same money is already an order's payment (its events arrived in an
  -- order that kept it here too): neither apply it again nor refund it.
  if p_action <> 'dismiss' and private.payment_reference_applied(r.provider, r.payment_reference) then
    perform private.fail('payment_review_applied');
  end if;

  if p_action in ('accept', 'attach') then
    if r.kind in ('unknown_refund', 'dispute') then
      perform private.fail('payment_review_action_invalid');
    end if;
    select * into p from public.payments where order_id = o.id order by created_at desc limit 1 for update;
    if o.status not in ('pending_payment', 'payment_review') or p.status is distinct from 'pending'
       or p.amount_minor is distinct from r.amount_minor or p.currency is distinct from r.currency
       or not private.payment_environments_fit(r.environment, p.environment) then
      perform private.fail('payment_review_mismatch');
    end if;
    v_reference := coalesce(r.payment_reference, 'review:' || r.id);
    perform private.capture_payment(o.id, v_reference, false);
    update public.payments
    set gateway_reference = case when r.kind <> 'unmatched_transfer' then r.payment_reference end,
        environment = coalesce(environment, r.environment)
    where id = p.id;
    perform private.record_gateway_fee(p.id, null, null);
    update private.payment_reviews
    set status = case when p_action = 'accept' then 'accepted' else 'attached' end,
        resolved_order_id = o.id, resolution_note = v_note, resolved_by = (select auth.uid()),
        resolved_at = now()
    where id = r.id;
  elsif p_action = 'refund' then
    if r.kind in ('unknown_refund', 'dispute') or coalesce(r.amount_minor, 0) <= 0 then
      perform private.fail('payment_review_action_invalid');
    end if;
    -- Through the gateway only for money with an intent id, of the
    -- environment the worker now serves; test money is not real (nothing to
    -- send back); any other real money finance pays back by transfer.
    v_channel := case
      when r.payment_reference is not null and r.payment_reference not like 'session:%'
           and r.kind <> 'unmatched_transfer' and r.environment = private.payments_mode() then 'gateway'
      when r.environment = 'test' then 'simulated'
      else 'transfer' end;
    insert into private.gateway_refunds
      (review_id, order_id, provider, environment, channel, amount_minor, currency, payment_reference, note)
    values
      (r.id, r.order_id, r.provider, r.environment, v_channel,
       r.amount_minor, coalesce(r.currency, 'CRC'), r.payment_reference, v_note)
    returning id into v_refund;
    update private.payment_reviews
    set status = 'refunding', resolution_note = v_note, resolved_by = (select auth.uid()), resolved_at = now()
    where id = r.id;
    if v_channel = 'simulated' then
      perform private.complete_gateway_refund(v_refund);
    end if;
  else
    update private.payment_reviews
    set status = 'dismissed', resolution_note = v_note, resolved_by = (select auth.uid()), resolved_at = now()
    where id = r.id;
  end if;

  -- The attempt that brought the money is finished either way: the shopper
  -- may start a new one while the order still waits for its payment.
  update private.payment_attempts
  set status = case when p_action in ('accept', 'attach') and o.id = order_id then 'succeeded' else 'cancelled' end,
      finished_at = coalesce(finished_at, now())
  where id = r.attempt_id and status = 'review';

  return private.payment_review_json((select x from private.payment_reviews x where x.id = r.id));
exception
  when unique_violation then
    perform private.fail('payment_review_applied');
end;
$$;

-- Which refunds finance may pay by bank transfer: those meant for it, those
-- the gateway refused, and those left for an environment the mode has left
-- (never sent: the worker serves the current mode only).
create or replace function private.gateway_refund_transferable(g private.gateway_refunds) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (g.channel = 'transfer' and g.status = 'requested')
      or (g.channel = 'gateway' and g.status = 'failed')
      or (g.channel = 'gateway' and g.status = 'requested'
          and g.environment is distinct from private.payments_mode());
$$;

create or replace function private.gateway_refund_json(g private.gateway_refunds) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', g.id,
    'order_number', (select o.order_number from public.orders o where o.id = g.order_id),
    'reason', coalesce((select r.reason from private.refunds r where r.id = g.refund_id), 'review'),
    'payment_method', (select p.method from public.payments p where p.id = g.payment_id),
    'channel', g.channel, 'status', g.status, 'amount_minor', g.amount_minor, 'currency', g.currency,
    'payment_reference', g.payment_reference, 'provider_refund_reference', g.provider_refund_reference,
    'failure_code', g.failure_code, 'send_count', g.send_count, 'requested_at', g.requested_at,
    'sent_at', g.sent_at, 'completed_at', g.completed_at, 'failed_at', g.failed_at,
    'bank_reference', g.bank_reference,
    'can_retry', g.channel = 'gateway' and g.status = 'failed',
    'can_record_transfer', private.gateway_refund_transferable(g));
$$;

create or replace function public.ops_gateway_refunds(p_open_only boolean default true) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(private.gateway_refund_json(g) order by g.requested_at desc, g.id)
    from (select * from private.gateway_refunds x
          where not coalesce(p_open_only, true) or x.status <> 'succeeded'
          order by x.requested_at desc limit 200) g), '[]'::jsonb);
end;
$$;

-- A refund the gateway refused can be sent once more (finance checked why).
create or replace function public.ops_retry_gateway_refund(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  g private.gateway_refunds%rowtype;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  select * into g from private.gateway_refunds where id = p_id;
  if not found then
    perform private.fail('gateway_refund_not_found');
  end if;
  if g.order_id is not null then
    perform 1 from public.orders where id = g.order_id for update;
  end if;
  select * into g from private.gateway_refunds where id = p_id for update;
  if g.channel <> 'gateway' or g.status <> 'failed' then
    perform private.fail('gateway_refund_state');
  end if;
  update private.gateway_refunds
  set status = 'requested', failure_code = null, failed_at = null, provider_refund_reference = null,
      unknown_at = null, work_after = now()
  where id = p_id;
  return private.gateway_refund_json((select x from private.gateway_refunds x where x.id = p_id));
end;
$$;

-- Finance paid a refund by bank transfer: cash on delivery, a transfer
-- confirmed by hand, or a gateway refund that failed.
create or replace function public.ops_record_refund_transfer(
  p_id uuid,
  p_bank_reference text,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  g private.gateway_refunds%rowtype;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_bank_reference)), 0) not between 4 and 60 then
    perform private.fail('bank_reference_invalid');
  end if;
  select * into g from private.gateway_refunds where id = p_id;
  if not found then
    perform private.fail('gateway_refund_not_found');
  end if;
  if g.order_id is not null then
    perform 1 from public.orders where id = g.order_id for update;
  end if;
  select * into g from private.gateway_refunds where id = p_id for update;
  if not private.gateway_refund_transferable(g) then
    perform private.fail('gateway_refund_state');
  end if;
  update private.gateway_refunds
  set channel = 'transfer', note = coalesce(left(nullif(trim(p_note), ''), 500), note)
  where id = p_id;
  perform private.complete_gateway_refund(p_id, trim(p_bank_reference));
  return private.gateway_refund_json((select x from private.gateway_refunds x where x.id = p_id));
end;
$$;

-- What the gateway charged, from its statement, for a payment it did not report.
create or replace function public.ops_record_payment_fee(
  p_payment_id uuid,
  p_fee_minor bigint,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  select * into p from public.payments where id = p_payment_id;
  if not found or p.gateway_reference is null
     or p.status not in ('captured', 'partially_refunded', 'refunded') then
    perform private.fail('payment_not_found');
  end if;
  if p_fee_minor is null or p_fee_minor < 0 or p_fee_minor > p.amount_minor then
    perform private.fail('payment_fee_invalid');
  end if;
  perform 1 from public.orders where id = p.order_id for update;
  if exists (select 1 from private.payment_costs c where c.payment_id = p.id and c.reported_fee_minor is not null) then
    perform private.fail('payment_fee_recorded');
  end if;
  perform private.record_gateway_fee(p.id, p_fee_minor, 'statement', p_note);
end;
$$;

-- Payments of one day (Costa Rica time), with the gateway's references and fees.
create or replace function public.ops_payments(p_date date default null, p_limit integer default 200)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_date, private.cr_local(now())::date);
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.at desc, x.id)
    from (
      select p.id, coalesce(p.captured_at, p.created_at) as at, jsonb_build_object(
        'id', p.id, 'order_number', o.order_number, 'method', p.method, 'provider', p.provider,
        'environment', p.environment, 'status', p.status, 'amount_minor', p.amount_minor,
        'currency', p.currency, 'provider_reference', p.provider_reference,
        'gateway_reference', p.gateway_reference,
        'session_reference', (select a.session_reference from private.payment_attempts a
                              where a.payment_id = p.id and a.status = 'succeeded' limit 1),
        'attempts', (select count(*) from private.payment_attempts a where a.payment_id = p.id),
        'created_at', p.created_at, 'captured_at', p.captured_at,
        'expected_fee_minor', c.expected_fee_minor, 'reported_fee_minor', c.reported_fee_minor,
        'fee_source', c.reported_source,
        'fee_difference_minor', c.reported_fee_minor - c.expected_fee_minor,
        'can_record_fee', p.gateway_reference is not null and c.reported_fee_minor is null
                          and p.status in ('captured', 'partially_refunded', 'refunded')) as item
      from public.payments p
      join public.orders o on o.id = p.order_id
      left join private.payment_costs c on c.payment_id = p.id
      where private.cr_local(coalesce(p.captured_at, p.created_at))::date = v_day
      order by coalesce(p.captured_at, p.created_at) desc
      limit least(greatest(coalesce(p_limit, 200), 1), 500)
    ) x), '[]'::jsonb);
end;
$$;

-- The day's reconciliation: what was taken by method, fees reported against
-- expected, refunds, what waits for finance, what the worker found, and the
-- events received by outcome.
create or replace function public.ops_payment_reconciliation(p_date date default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_date, private.cr_local(now())::date);
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'date', v_day,
    'mode', private.payments_mode(),
    'gateway', private.payment_gateway(),
    'captured', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method', m.method, 'provider', m.provider, 'count', m.n, 'amount_minor', m.amount,
        'expected_fee_minor', m.expected, 'reported_fee_minor', m.reported, 'fees_missing', m.missing)
        order by m.method, m.provider)
      from (
        select p.method, p.provider, count(*) as n, sum(p.amount_minor)::bigint as amount,
               coalesce(sum(c.expected_fee_minor), 0)::bigint as expected,
               coalesce(sum(c.reported_fee_minor), 0)::bigint as reported,
               count(*) filter (where p.gateway_reference is not null and c.reported_fee_minor is null) as missing
        from public.payments p
        left join private.payment_costs c on c.payment_id = p.id
        where p.captured_at is not null and private.cr_local(p.captured_at)::date = v_day
        group by p.method, p.provider) m), '[]'::jsonb),
    'refunds_completed', (
      select jsonb_build_object('count', count(*), 'amount_minor', coalesce(sum(amount_minor), 0))
      from private.gateway_refunds where completed_at is not null and private.cr_local(completed_at)::date = v_day),
    'refunds_open', (
      select jsonb_build_object('count', count(*), 'amount_minor', coalesce(sum(amount_minor), 0),
                                'failed', count(*) filter (where status = 'failed'))
      from private.gateway_refunds where status <> 'succeeded'),
    'reviews_open', (
      select jsonb_build_object('count', count(*), 'amount_minor', coalesce(sum(amount_minor), 0))
      from private.payment_reviews where status = 'open'),
    'attempts', (
      select jsonb_build_object(
        'created', count(*),
        -- succeeded + failed + review + stopped + waiting = created; declined
        -- counts every attempt the gateway declined, also those stopped since
        -- (a declined attempt is stopped when the shopper tries again).
        'succeeded', count(*) filter (where status = 'succeeded'),
        'failed', count(*) filter (where status = 'failed'),
        'review', count(*) filter (where status = 'review'),
        'stopped', count(*) filter (where status in ('cancelled', 'expired', 'cancel_requested', 'error')),
        'waiting', count(*) filter (where status in ('creating', 'open', 'processing')),
        'declined', count(*) filter (where declined_at is not null),
        'checked_by_worker', count(*) filter (where checks > 0))
      from private.payment_attempts where private.cr_local(created_at)::date = v_day),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('outcome', e.outcome, 'count', e.n) order by e.outcome)
      from (select outcome, count(*) as n from private.payment_events
            where private.cr_local(received_at)::date = v_day group by outcome) e), '[]'::jsonb),
    'ledger', jsonb_build_object(
      'gateway_clearing_minor', (select coalesce(sum(e.amount_minor), 0) from public.ledger_entries e
                                 where e.account_id = private.ledger_account('gateway_clearing')),
      'refunds_payable_minor', -(select coalesce(sum(e.amount_minor), 0) from public.ledger_entries e
                                 where e.account_id = private.ledger_account('refunds_payable')),
      'gateway_fees_minor', (select coalesce(sum(e.amount_minor), 0) from public.ledger_entries e
                             where e.account_id = private.ledger_account('gateway_fee_expense'))));
end;
$$;

-- The mode, the gateway, what the worker reported, and the expected fees.
create or replace function public.ops_payment_settings() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'mode', private.payments_mode(),
    'gateway', private.payment_gateway(),
    'expected_fees', (select value from public.app_settings where key = 'gateway_expected_fees'),
    'can_change', private.has_staff_role('admin'),
    'environments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'environment', s.environment, 'keys_ready', s.keys_ready, 'webhook_ready', s.webhook_ready,
        'account_ref', s.account_ref, 'reported_at', s.reported_at,
        'recent', s.reported_at > now() - interval '15 minutes') order by s.environment)
      from private.payment_gateway_status s where s.provider = private.payment_gateway()), '[]'::jsonb),
    'open_work', jsonb_build_object(
      'attempts', (select count(*) from private.payment_attempts a
                   where a.environment = private.payments_mode()
                     and a.status in ('creating', 'open', 'processing', 'failed', 'cancel_requested')),
      'refunds', (select count(*) from private.gateway_refunds g
                  where g.channel = 'gateway' and g.environment = private.payments_mode()
                    and g.status in ('requested', 'sending', 'sent', 'unknown'))));
end;
$$;

-- An administrator changes the payments mode, with a reason. Refused for an
-- environment the worker has not reported ready in the last 15 minutes, and
-- while anything is still on its way at the gateway (it would be stranded).
-- The change and its reason go to the audit trail.
create or replace function public.ops_set_payments_mode(p_mode text, p_note text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old text;
  v_note text := left(nullif(trim(p_note), ''), 500);
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  if p_mode not in ('sandbox', 'test', 'live') then
    perform private.fail('payments_mode_invalid');
  end if;
  if coalesce(char_length(v_note), 0) < 10 then
    perform private.fail('payments_mode_note_required');
  end if;
  select value #>> '{}' into v_old from public.app_settings where key = 'payments_mode' for update;
  if v_old = p_mode then
    return public.ops_payment_settings();
  end if;
  if p_mode in ('test', 'live') and not exists (
    select 1 from private.payment_gateway_status s
    where s.provider = private.payment_gateway() and s.environment = p_mode
      and s.keys_ready and s.webhook_ready and s.reported_at > now() - interval '15 minutes') then
    perform private.fail('payments_provider_not_ready');
  end if;
  -- What the worker of the environment being left still has to do there.
  -- A declined attempt counts: the gateway's page can still be paid until
  -- the worker stops it.
  if exists (select 1 from private.payment_attempts a
             where a.environment = v_old
               and a.status in ('creating', 'open', 'processing', 'failed', 'cancel_requested'))
     or exists (select 1 from private.gateway_refunds g
                where g.channel = 'gateway' and g.environment = v_old
                  and g.status in ('requested', 'sending', 'sent', 'unknown')) then
    perform private.fail('payments_work_open');
  end if;

  update public.app_settings set value = to_jsonb(p_mode) where key = 'payments_mode';
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'UPDATE', 'payments_mode', 'payments_mode',
          jsonb_build_object('mode', v_old), jsonb_build_object('mode', p_mode, 'note', v_note));
  return public.ops_payment_settings();
end;
$$;

-- An administrator changes what the gateway is expected to charge for a
-- method (the comparison finance sees; seller fees are the fee schedule).
create or replace function public.ops_set_expected_gateway_fee(
  p_method public.payment_method,
  p_bps integer,
  p_fixed_minor bigint,
  p_note text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note text := left(nullif(trim(p_note), ''), 500);
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  if p_method not in ('card', 'sinpe_movil') or p_bps is null or p_bps not between 0 and 2000
     or p_fixed_minor is null or p_fixed_minor not between 0 and 1000000 then
    perform private.fail('payment_fee_invalid');
  end if;
  if coalesce(char_length(v_note), 0) < 10 then
    perform private.fail('payments_mode_note_required');
  end if;
  update public.app_settings
  set value = coalesce(value, '{}'::jsonb)
              || jsonb_build_object(p_method::text, jsonb_build_object('bps', p_bps, 'fixed_minor', p_fixed_minor))
  where key = 'gateway_expected_fees';
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'UPDATE', 'gateway_expected_fees', p_method::text, null,
          jsonb_build_object('bps', p_bps, 'fixed_minor', p_fixed_minor, 'note', v_note));
  return public.ops_payment_settings();
end;
$$;

-- ═══ 11. Waking the worker ═════════════════════════════════════════════════
-- As for notifications (20261121082600, section 12): pg_net calls the
-- payments-worker function when there is new work, and pg_cron sweeps every
-- minute. Both need the Vault secrets 'project_url' and
-- 'payments_worker_token'; without them, or on a plain PostgreSQL, they do
-- nothing (locally the functions host wakes the worker itself).

create or replace function private.payments_kick() returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    return;
  end if;
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'payments_worker_token')$q$
    into v_url, v_token;
  if v_url is null or v_token is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 5000)$q$
    using v_url || '/functions/v1/payments-worker',
          jsonb_build_object('Content-Type', 'application/json', 'x-worker-token', v_token);
exception when others then
  raise warning 'payments_kick: %', sqlerrm;
end;
$$;

create or replace function private.payments_kick_on_work() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if private.payments_mode() <> 'sandbox' then
    perform private.payments_kick();
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create trigger payment_attempts_kick after insert on private.payment_attempts
  for each statement execute function private.payments_kick_on_work();
create trigger gateway_refunds_kick after insert on private.gateway_refunds
  for each statement execute function private.payments_kick_on_work();

create or replace function private.payments_sweep() returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if private.payments_mode() <> 'sandbox' and (
       exists (select 1 from private.payment_attempts
               where status in ('creating', 'open', 'processing', 'failed', 'cancel_requested')
                 and work_after <= now() and now() < expires_at + interval '1 day')
    or exists (select 1 from private.gateway_refunds
               where channel = 'gateway' and status in ('requested', 'sending', 'sent', 'unknown')
                 and work_after <= now())) then
    perform private.payments_kick();
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('payments-sweep', '* * * * *', 'select private.payments_sweep()');
  else
    raise notice 'pg_cron is not available here; the local functions host wakes the payments worker.';
  end if;
exception when others then
  raise notice 'Could not schedule the payments sweep: %', sqlerrm;
end
$$;

-- ═══ 12b. Account deletion waits for the person's money ════════════════════
-- Replaces the version in 20261121082500_account_security.sql; only the
-- pending-refund reason changed. Before the gateway, a refund booked was as
-- good as paid in the register's eyes; now the money goes back later, so the
-- account (whose details the transfer may need) stays until it has.
create or replace function private.account_deletion_blockers(p_user uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$
  with mine as (
    select m.seller_id from public.seller_members m where m.user_id = p_user
  )
  select array_remove(array[
    case when exists (select 1 from public.staff_members s
                      where s.user_id = p_user and s.active)
      then 'account_is_staff' end,
    case when exists (select 1 from public.drivers d
                      where d.user_id = p_user and d.status <> 'offboarded')
      then 'account_is_driver' end,
    case when exists (select 1 from public.warehouse_staff w where w.user_id = p_user)
      then 'account_is_warehouse_staff' end,
    case when exists (select 1 from public.orders o
                      where o.user_id = p_user
                        and o.status not in ('delivered', 'completed', 'cancelled', 'refunded'))
      then 'account_has_open_orders' end,
    case when exists (select 1 from public.return_requests r
                      where r.user_id = p_user and r.status in ('requested', 'approved', 'received'))
      then 'account_has_open_returns' end,
    -- A cancelled order that was paid is refunded later, through the gateway
    -- and to the account or phone that paid; that needs the person's details.
    -- [083400] So is every refund whose money has not gone yet (a return, a
    -- parcel back, a transfer finance still has to make), and money the
    -- gateway took for one of their orders that finance has not settled.
    case when exists (select 1 from public.payments p
                      join public.orders o on o.id = p.order_id
                      where o.user_id = p_user
                        and o.status in ('cancelled', 'refunded')
                        and p.status in ('authorized', 'captured', 'partially_refunded'))
           or exists (select 1 from private.gateway_refunds g
                      join public.orders o on o.id = g.order_id
                      where o.user_id = p_user and g.status <> 'succeeded')
           or exists (select 1 from private.payment_reviews r
                      join public.orders o on o.id = r.order_id
                      where o.user_id = p_user and r.status in ('open', 'refunding'))
      then 'account_has_pending_refund' end,
    case when exists (select 1 from public.complaints c
                      where c.user_id = p_user and c.status <> 'resolved')
      then 'account_has_open_complaints' end,
    -- The last person in charge of a shop that is open or opening: closing it
    -- is Yuntera's decision (ops_set_seller_status), not a side effect.
    case when exists (select 1 from public.seller_members m
                      join public.sellers s on s.id = m.seller_id
                      where m.user_id = p_user and m.role in ('owner', 'admin')
                        and s.status in ('pending', 'active')
                        and not exists (select 1 from public.seller_members o
                                        where o.seller_id = m.seller_id and o.user_id <> p_user
                                          and o.role in ('owner', 'admin')))
      then 'account_runs_open_shop' end,
    case when exists (select 1 from public.stock_levels sl
                      where sl.seller_id in (select seller_id from mine) and sl.on_hand > 0)
      then 'account_shop_has_stock' end,
    case when exists (select 1 from public.order_items i
                      join public.orders o on o.id = i.order_id
                      where i.seller_id in (select seller_id from mine)
                        and o.status not in ('delivered', 'completed', 'cancelled', 'refunded'))
      then 'account_shop_has_open_orders' end,
    case when exists (select 1 from mine
                      where (select coalesce(sum(e.amount_minor), 0)
                             from public.ledger_entries e
                             join public.ledger_accounts a on a.id = e.account_id
                             where a.seller_id = mine.seller_id) <> 0
                         or exists (select 1 from public.payouts po
                                    where po.seller_id = mine.seller_id
                                      and po.status = 'scheduled'))
      then 'account_shop_has_balance' end
  ], null);
$$;

-- ═══ 12. Grants ════════════════════════════════════════════════════════════

revoke all on function
  private.payments_mode(),
  private.payment_gateway(),
  private.guard_payments_mode(),
  private.payments_provider_from_mode(),
  private.expected_gateway_fee(public.payment_method, bigint),
  private.record_gateway_fee(uuid, bigint, text, text),
  private.payments_refresh_refund_status(uuid),
  private.settle_gateway_refund(uuid, text),
  private.complete_gateway_refund(uuid, text),
  private.open_gateway_refund(private.refunds),
  private.gateway_refund_for_register(),
  private.confirm_refund(uuid, text),
  private.refund_confirm_when_nothing_moves(),
  private.cancel_order_internal(uuid, text),
  private.account_deletion_blockers(uuid),
  private.payment_attempts_stop(uuid, uuid),
  private.orders_stop_attempts(),
  private.payments_stop_attempts(),
  private.order_payment_json(public.orders, boolean),
  private.payment_review_add(text, bigint, text, text, uuid, uuid, text, bigint, text, text),
  private.payment_reviews_close_applied(text, uuid, text, text, text),
  private.payments_keep_other_environment(bigint, jsonb),
  private.payment_reference_applied(text, text),
  private.payment_environments_fit(text, text),
  private.gateway_refund_transferable(private.gateway_refunds),
  private.payments_apply_payment(bigint, jsonb),
  private.payments_apply_refund(bigint, jsonb),
  private.payments_apply_event(jsonb),
  private.payment_review_json(private.payment_reviews),
  private.gateway_refund_json(private.gateway_refunds),
  private.payments_kick(),
  private.payments_kick_on_work(),
  private.payments_sweep()
from public, anon, authenticated;

revoke all on function
  public.worker_payments_hello(text, text, text, boolean, boolean),
  public.worker_payments_claim(text, integer, integer),
  public.worker_payments_report(text, jsonb),
  public.worker_payments_event(jsonb)
from public, anon, authenticated;
grant execute on function
  public.worker_payments_hello(text, text, text, boolean, boolean),
  public.worker_payments_claim(text, integer, integer),
  public.worker_payments_report(text, jsonb),
  public.worker_payments_event(jsonb)
to service_role;

revoke all on function
  public.order_payment(text),
  public.start_payment(uuid, jsonb, text),
  public.payment_returned(uuid),
  public.ops_payment_reviews(boolean),
  public.ops_resolve_payment_review(uuid, text, text, text),
  public.ops_gateway_refunds(boolean),
  public.ops_retry_gateway_refund(uuid),
  public.ops_record_refund_transfer(uuid, text, text),
  public.ops_record_payment_fee(uuid, bigint, text),
  public.ops_payments(date, integer),
  public.ops_payment_reconciliation(date),
  public.ops_payment_settings(),
  public.ops_set_payments_mode(text, text),
  public.ops_set_expected_gateway_fee(public.payment_method, integer, bigint, text)
from public, anon, service_role;
grant execute on function
  public.order_payment(text),
  public.start_payment(uuid, jsonb, text),
  public.payment_returned(uuid),
  public.ops_payment_reviews(boolean),
  public.ops_resolve_payment_review(uuid, text, text, text),
  public.ops_gateway_refunds(boolean),
  public.ops_retry_gateway_refund(uuid),
  public.ops_record_refund_transfer(uuid, text, text),
  public.ops_record_payment_fee(uuid, bigint, text),
  public.ops_payments(date, integer),
  public.ops_payment_reconciliation(date),
  public.ops_payment_settings(),
  public.ops_set_payments_mode(text, text),
  public.ops_set_expected_gateway_fee(public.payment_method, integer, bigint, text)
to authenticated;
