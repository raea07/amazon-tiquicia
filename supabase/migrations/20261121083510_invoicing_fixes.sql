-- Fixes found on the hosted preview on 22 November 2026, after 083200 to
-- 083500 were applied there.
--
--   1. SIMULATED OR REAL, ONE RULE. 083500 counted an order's money as
--      simulated only when its payment's provider was `sandbox` or its
--      environment `test`. Cash on delivery taken in sandbox mode has
--      provider `cash` and no environment (083400), and payments settled it
--      as a simulation; invoicing counted it as real, so with the policy's
--      `simulated_payments` false (every real project, the preview too) its
--      payment.captured job would have produced a tiquete and a fee factura
--      for money that never existed, and sent them to Hacienda once the
--      issuer was ready. It also counted as simulated the real money that is
--      not the gateway's in test mode (cash collected by a driver, a transfer
--      finance confirmed by hand), which payments pays back as real.
--
--      Now one function decides it, private.payment_money_simulated, and it
--      is decided ONCE, when the payment is captured, with the mode of that
--      moment, into public.payments.simulated: the refund's channel
--      (private.open_gateway_refund), the refund of money held for review
--      (public.ops_resolve_payment_review) and invoicing
--      (private.invoice_money_documented) all read it. What changes for a
--      refund: money that was simulated when it was taken stays simulated
--      after the mode changes (it used to become a transfer finance had to
--      pay, for cash and hand-confirmed transfers taken in sandbox), and real
--      money stays real. Payments captured before this migration are decided
--      now, with the mode in force when each was captured, read from the
--      audit trail of app_settings (private.payments_mode_at), so the result
--      does not depend on the mode of the day the migration is applied.
--
--   2. JOBS THAT WAIT FOR SIMULATED MONEY END. An invoice job (payment
--      captured, refund booked) of an order whose money is not documented and
--      that has no document ends now: `done`, with `simulated_money` as its
--      note, and nothing numbered. That happens here once, at the start of
--      every planning run, and in the sweep (every 30 seconds where pg_cron
--      runs it, also with no worker deployed), so it never waits behind the
--      issuer's set-up and is never retried. ops_invoicing_state counts them
--      for the console.
--
--   3. WHAT THE SCREENS SAY. Two read functions give the console and the
--      shopper's order page the facts their texts need: whether payments are
--      simulated, whether simulated money is documented here, whether the
--      issuer is set up, and for one order whether a factura was asked for
--      and whether its delivery fee is Yuntera's to document.
--
-- Tested by supabase/tests/152_invoicing_fixes.sql and
-- packages/db/src/contract.invoicing-fixes.test.ts.

-- ═══ 1. Simulated or real ══════════════════════════════════════════════════

-- Whether money was never real, from what took it and the payments mode at
-- the moment it was captured:
--   live                          real (the gateway's live environment, or cash
--                                 and transfers taken in live mode);
--   test, through the gateway     simulated (the gateway's test environment);
--   test, cash or by hand         real (a driver collected it, or finance saw it
--                                 in the bank: test mode tests the gateway only);
--   sandbox card or SINPE Móvil   simulated (paid with the simulation button);
--   sandbox transfer, or cash     simulated when captured while the mode was
--   without an environment        sandbox (the demo's), real when captured in
--                                 test or live (finance confirmed a real
--                                 transfer; a driver collected real cash);
--   anything else                 real (never guess money away).
create or replace function private.payment_money_simulated(
  p_provider text,
  p_environment text,
  p_method public.payment_method,
  p_mode text
) returns boolean
language sql immutable security definer
set search_path = ''
as $$
  select case
    when p_environment = 'live' then false
    when p_environment = 'test' then coalesce(p_provider not in ('cash', 'manual'), true)
    when p_provider = 'sandbox' and p_method in ('card', 'sinpe_movil') then true
    when p_provider in ('sandbox', 'cash') then coalesce(p_mode = 'sandbox', false)
    else false end;
$$;

alter table public.payments
  -- Whether this money was never real: decided when the payment is captured
  -- (private.payment_money_simulated, with the mode of that moment), and
  -- again only if what took it is corrected. Null while not captured.
  add column simulated boolean;

create or replace function private.payments_decide_simulated() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status in ('captured', 'partially_refunded', 'refunded') and (
       tg_op = 'INSERT' or new.simulated is null
       or old.status not in ('captured', 'partially_refunded', 'refunded')
       or new.provider is distinct from old.provider
       or new.environment is distinct from old.environment) then
    new.simulated := private.payment_money_simulated(new.provider, new.environment, new.method,
                                                     private.payments_mode());
  end if;
  return new;
end;
$$;

-- After payments_provider_from_mode (triggers fire in name order), so the
-- provider and environment are the stored ones.
create trigger payments_simulated_at_capture before insert or update on public.payments
  for each row execute function private.payments_decide_simulated();

-- What a payment's money is: as decided at capture; for a payment not yet
-- captured, what it would be if captured now.
create or replace function private.payment_simulated(p public.payments) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(p.simulated,
                  private.payment_money_simulated(p.provider, p.environment, p.method, private.payments_mode()));
$$;

-- The payments mode at a moment of the past, from the audit trail of
-- app_settings (every change of the setting is written there, by
-- ops_set_payments_mode and by a direct update alike): the value of the last
-- change at or before that moment; before the first change, the value that
-- change replaced (`sandbox` before the setting existed); with no change
-- recorded at all, the current mode.
create or replace function private.payments_mode_at(p_at timestamptz) returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select a.new_row -> 'value' #>> '{}' from private.audit_log a
     where a.table_name = 'app_settings' and a.row_key = 'payments_mode' and a.new_row is not null
       and a.at <= p_at
     order by a.at desc, a.id desc limit 1),
    (select coalesce(a.old_row -> 'value' #>> '{}', 'sandbox') from private.audit_log a
     where a.table_name = 'app_settings' and a.row_key = 'payments_mode' and a.at > p_at
     order by a.at, a.id limit 1),
    private.payments_mode());
$$;

-- Payments captured before this migration, decided with the mode in force
-- when each was captured (not the mode of the day this runs: cash taken in
-- sandbox stays simulated even if the mode is test or live by then). Their
-- updated_at stays as it was: nothing about the payment changed.
alter table public.payments disable trigger payments_updated_at;
update public.payments
set simulated = private.payment_money_simulated(
      provider, environment, method, private.payments_mode_at(coalesce(captured_at, updated_at, created_at)))
where status in ('captured', 'partially_refunded', 'refunded') and simulated is null;
alter table public.payments enable trigger payments_updated_at;

-- Replaces the version in 20261121083500: simulated is the payment's own
-- decision (private.payment_simulated), the same one refunds follow.
create or replace function private.invoice_money_documented(p_order_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((private.invoice_policy() ->> 'simulated_payments')::boolean, false)
      or not exists (
        select 1 from public.payments p
        where p.order_id = p_order_id
          and p.status in ('captured', 'partially_refunded', 'refunded')
          and private.payment_simulated(p));
$$;

-- Replaces the version in 20261121083400; only the channel's rule changed.
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
  -- Money that was never real (private.payment_simulated) is refunded as a
  -- simulation; real money taken in live and refunded after the mode left
  -- live, a transfer confirmed by hand, or real cash is paid back by finance
  -- by bank transfer.
  v_channel := case
    when v_payment.gateway_reference is not null and v_payment.environment = private.payments_mode()
      then 'gateway'
    -- Whether the money was ever real is decided once, when it was captured
    -- (private.payment_simulated), by the rule invoicing uses too.
    when v_payment.id is not null and private.payment_simulated(v_payment)
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

-- Replaces the version in 20261121083400; only the rule for test money now
-- comes from private.payment_money_simulated (it decides the same: money of
-- the gateway's test environment is not real, anything else is).
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
      when private.payment_money_simulated(r.provider, r.environment, null, private.payments_mode()) then 'simulated'
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

-- ═══ 2. Invoice jobs for money that was never real ═════════════════════════

-- An invoice job that can never produce a document: its order's money is not
-- documented (private.invoice_money_documented) and the order has no
-- document to build on or to credit. An order that has documents (made while
-- the policy documented simulated money) keeps its jobs: its credit notes
-- must still follow.
create or replace function private.invoice_job_simulated(p_event_id bigint) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select e.topic in ('payment.captured', 'fiscal.refund_booked')
       and not private.invoice_money_documented((e.payload ->> 'order_id')::uuid)
       and not exists (select 1 from public.electronic_invoices d
                       where d.order_id = (e.payload ->> 'order_id')::uuid and d.kind is not null)
    from private.outbox_events e
    where e.id = p_event_id and e.payload ->> 'order_id' is not null), false);
$$;

-- Ends every waiting invoice job that can never produce a document: `done`,
-- noted `simulated_money`, nothing numbered. What the shopper typed for a
-- factura on such an order is not kept either (as invoice_plan_capture did).
-- Returns how many it ended. A job another planner holds is left to it.
create or replace function private.invoice_close_simulated() returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  j record;
  v_count integer := 0;
begin
  for j in
    select x.event_id, e.topic, (e.payload ->> 'order_id')::uuid as order_id
    from private.outbox_jobs x
    join private.outbox_events e on e.id = x.event_id
    where x.consumer = 'invoice' and x.status = 'pending'
      and private.invoice_job_simulated(x.event_id)
    order by x.event_id
    for update of x skip locked
  loop
    update private.outbox_jobs
    set status = 'done', done_at = now(), last_error = 'simulated_money', attempts = least(attempts + 1, 32000)
    where event_id = j.event_id and consumer = 'invoice';
    if j.topic = 'payment.captured' then
      delete from private.invoice_checkout_receivers r
      using public.orders o
      where o.id = j.order_id and r.user_id = o.user_id and r.idempotency_key = o.idempotency_key;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Replaces the version in 20261121083500: simulated jobs end first.
create or replace function private.invoice_plan(p_limit integer default 100) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  j record;
  e private.outbox_events;
  v_count integer := 0;
  v_failure text;
begin
  -- Jobs whose money was never real end first, visibly and without a
  -- document, so they never wait behind the issuer's set-up (083510).
  perform private.invoice_close_simulated();
  for j in
    select x.event_id from private.outbox_jobs x
    where x.consumer = 'invoice' and x.status = 'pending'
    order by x.attempts, x.event_id
    limit greatest(1, least(p_limit, 1000))
    for update of x skip locked
  loop
    select * into e from private.outbox_events where id = j.event_id;
    v_failure := null;
    begin
      if e.topic = 'payment.captured' then
        v_failure := private.invoice_plan_capture(e.id, (e.payload ->> 'order_id')::uuid);
      elsif e.topic = 'fiscal.refund_booked' then
        perform private.invoice_plan_refund(e.id, (e.payload ->> 'refund_id')::uuid);
      end if;
      if v_failure is null then
        update private.outbox_jobs set status = 'done', done_at = now(), attempts = least(attempts + 1, 32000)
        where event_id = j.event_id and consumer = 'invoice';
        v_count := v_count + 1;
      else
        -- Some of its documents were made (and stay); the rest wait for the cause to be fixed.
        update private.outbox_jobs set attempts = least(attempts + 1, 32000), last_error = left(v_failure, 500)
        where event_id = j.event_id and consumer = 'invoice';
      end if;
    exception
      when others then
        if sqlerrm = 'invoice_issuer_not_ready' then
          -- Nothing can be numbered yet: every job waits, in order.
          exit;
        elsif sqlerrm = 'invoice_waiting' then
          -- A document it depends on is being corrected: try again later, without counting.
          null;
        else
          update private.outbox_jobs
          set attempts = least(attempts + 1, 32000), last_error = left(sqlerrm, 500)
          where event_id = j.event_id and consumer = 'invoice';
        end if;
    end;
  end loop;
  return v_count;
end;
$$;

-- Replaces the version in 20261121083500: simulated jobs end here too.
create or replace function private.invoice_sweep() returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Jobs whose money was never real end here too, every 30 seconds where
  -- pg_cron runs the sweep, also while no worker is deployed (083510).
  perform private.invoice_close_simulated();
  if exists (select 1 from private.outbox_jobs where consumer = 'invoice' and status = 'pending')
     or exists (select 1 from public.electronic_invoices
                where status in ('pending', 'sent') and held_reason is null and next_attempt_at <= now()) then
    perform private.invoice_kick();
  end if;
  -- A factura asked for at checkout is kept while its order may still be
  -- paid (cash on delivery is paid at the door, days later). It is forgotten
  -- when no order was placed with it within two days, or when the order was
  -- cancelled without a payment. Once paid, planning uses it and deletes it.
  delete from private.invoice_checkout_receivers r
  where (r.created_at < now() - interval '2 days'
         and not exists (select 1 from public.orders o
                         where o.user_id = r.user_id and o.idempotency_key = r.idempotency_key))
     or exists (select 1 from public.orders o
                where o.user_id = r.user_id and o.idempotency_key = r.idempotency_key
                  and o.status in ('cancelled', 'refunded')
                  and not exists (select 1 from public.payments p where p.order_id = o.id
                                  and p.status in ('captured', 'partially_refunded', 'refunded')));
end;
$$;

-- The jobs already waiting (on the preview: the simulated SINPE Móvil orders
-- placed after 083500 and the refund of a cancelled one) end now.
select private.invoice_close_simulated();

-- ═══ 3. What the screens need to say one true thing ════════════════════════

-- For the console's invoices page: whether payments are simulated here,
-- whether simulated money is documented, whether the issuer is set up, and
-- what waits, counted the way the page says it: payments are orders (one
-- payment.captured job each; a simulated order that was paid and then
-- refunded is one payment, not two jobs), and refunds that wait for a credit
-- note are counted on their own.
--   waiting_real        orders with real money whose capture waits for its documents;
--   waiting_rehearsal   orders with simulated money whose capture waits and WILL be
--                       documented (the policy documents simulated money, or the order
--                       already has documents from when it did);
--   waiting_refunds     refunds whose credit note waits;
--   waiting_simulated   orders whose jobs wait only to end without a document;
--   closed_simulated    orders whose jobs ended without a document.
-- Finance only.
create or replace function public.ops_invoicing_state() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_real bigint;
  v_rehearsal bigint;
  v_refunds bigint;
  v_closing bigint;
  v_closed bigint;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  with jobs as (
    select e.topic, (e.payload ->> 'order_id')::uuid as order_id,
           private.invoice_job_simulated(j.event_id) as ends
    from private.outbox_jobs j
    join private.outbox_events e on e.id = j.event_id
    where j.consumer = 'invoice' and j.status = 'pending'
  )
  select
    count(distinct order_id) filter (where topic = 'payment.captured' and not ends and not exists (
      select 1 from public.payments p where p.order_id = jobs.order_id
        and p.status in ('captured', 'partially_refunded', 'refunded') and private.payment_simulated(p))),
    count(distinct order_id) filter (where topic = 'payment.captured' and not ends and exists (
      select 1 from public.payments p where p.order_id = jobs.order_id
        and p.status in ('captured', 'partially_refunded', 'refunded') and private.payment_simulated(p))),
    count(*) filter (where topic = 'fiscal.refund_booked' and not ends),
    count(distinct order_id) filter (where ends)
  into v_real, v_rehearsal, v_refunds, v_closing
  from jobs;
  select count(distinct e.payload ->> 'order_id') into v_closed
  from private.outbox_jobs j
  join private.outbox_events e on e.id = j.event_id
  where j.consumer = 'invoice' and j.status = 'done' and j.last_error = 'simulated_money';
  return jsonb_build_object(
    'payments_mode', private.payments_mode(),
    'simulated_documented', coalesce((private.invoice_policy() ->> 'simulated_payments')::boolean, false),
    'issuer_ready', coalesce((private.setting('invoicing_issuer') ->> 'ready')::boolean, false),
    'waiting_real', v_real,
    'waiting_rehearsal', v_rehearsal,
    'waiting_refunds', v_refunds,
    'waiting_simulated', v_closing,
    'closed_simulated', v_closed);
end;
$$;

-- For the shopper's order page, about one of their orders: whether it is
-- paid; whether its money is (or, unpaid, would be if paid now) simulated;
-- whether that money gets documents here; whether the issuer is set up;
-- whether its delivery fee is Yuntera's to document (a fee, and the policy
-- says the platform issues it); and whether a factura in the shopper's name
-- was asked for (still waiting to be used, or issued). `order_not_found`
-- for anyone but the order's shopper.
create or replace function public.my_order_invoicing(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  o public.orders;
  p public.payments;
  v_paid boolean;
  v_simulated boolean;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  select * into o from public.orders
  where order_number = p_order_number and user_id = (select auth.uid());
  if not found then
    perform private.fail('order_not_found');
  end if;
  select * into p from public.payments x where x.order_id = o.id
  order by (x.status in ('captured', 'partially_refunded', 'refunded')) desc, x.created_at desc limit 1;
  v_paid := coalesce(p.status in ('captured', 'partially_refunded', 'refunded'), false);
  v_simulated := case when p.id is null then false else private.payment_simulated(p) end;
  return jsonb_build_object(
    'paid', v_paid,
    'simulated', v_simulated,
    'documented', coalesce((private.invoice_policy() ->> 'simulated_payments')::boolean, false) or not v_simulated,
    'issuer_ready', coalesce((private.setting('invoicing_issuer') ->> 'ready')::boolean, false),
    'delivery_by_platform', o.shipping_minor > 0
      and coalesce(private.invoice_policy() ->> 'delivery_fee_issuer', 'platform') = 'platform',
    'factura_requested',
      exists (select 1 from private.invoice_checkout_receivers r
              where r.user_id = o.user_id and r.idempotency_key = o.idempotency_key)
      or exists (select 1 from public.electronic_invoices e
                 where e.order_id = o.id and e.kind = 'delivery' and e.document_type = '01'));
end;
$$;

-- ═══ 4. Grants ═════════════════════════════════════════════════════════════

revoke execute on function
  private.payment_money_simulated(text, text, public.payment_method, text),
  private.payments_mode_at(timestamptz),
  private.payments_decide_simulated(),
  private.payment_simulated(public.payments),
  private.invoice_job_simulated(bigint),
  private.invoice_close_simulated()
from public, anon, authenticated;

revoke all on function public.ops_invoicing_state(), public.my_order_invoicing(text)
from public, anon, service_role;
grant execute on function public.ops_invoicing_state(), public.my_order_invoicing(text) to authenticated;
