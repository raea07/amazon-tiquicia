-- Integrity: money, returns, stock, the delivery code and the state machines.
--
-- A security review on 21 November 2026 found ways for a shopper or a staff
-- member to have the same money go back twice, or more than was paid, and a
-- set of races and dead ends around stock, cash and the delivery code. This
-- migration fixes their causes. The rules are written down in plain language
-- in docs/04-algorithms/returns-and-refunds.md; in short:
--
--   1. ONE REFUND REGISTER. Every refund, whatever path leads to it
--      (cancelling an order, a return, a parcel that came back undelivered),
--      is booked by one function, private.refund_units, or by the full
--      reversal private.post_order_refund, and is written to private.refunds
--      with the thing it refunds. The register refuses a second refund of the
--      same thing, more units of a line than were bought, and more money than
--      was collected for the order. A refund transaction in the ledger that is
--      not in the register is refused when the transaction commits.
--   2. RETURNS FOLLOW A STATE MACHINE that a trigger enforces: requested ->
--      approved or rejected; approved -> received or rejected; received ->
--      refunded. Rejected and refunded are final. Statuses change only inside
--      the functions; a direct write by an API role is refused. A return is
--      possible only for units that were delivered, on an order that was paid
--      and not reversed, and it is refunded only once the goods are back.
--   3. LOCKS IN ONE ORDER: the order row first, then what hangs from it, so
--      that two calls at once cannot both pass a check.
--   4. THE DELIVERY CODE lives in the private schema, which no API role can
--      read, and wrong attempts are counted per order across all its parcels,
--      stops and routes.
--
-- Same rules as every other function: an empty search_path, the caller
-- checked first, errors as short codes, nothing callable until granted below.

-- ═══ 1. The refund register ════════════════════════════════════════════════

create table private.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  -- What is being refunded: a whole order that was cancelled, one return
  -- request, or one parcel that came back without being delivered.
  reason text not null check (reason in ('order_cancelled', 'return', 'parcel_returned')),
  source_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  ledger_transaction_id uuid not null unique references public.ledger_transactions (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  -- The same thing is never refunded twice.
  unique (reason, source_id)
);

create index refunds_order_idx on private.refunds (order_id);

-- The units each refund gives back, per line.
create table private.refund_units (
  refund_id uuid not null references private.refunds (id),
  order_item_id uuid not null references public.order_items (id),
  quantity integer not null check (quantity > 0),
  primary key (refund_id, order_item_id)
);

create index refund_units_item_idx on private.refund_units (order_item_id);

alter table private.refunds enable row level security;
alter table private.refund_units enable row level security;
revoke all on private.refunds, private.refund_units from public, anon, authenticated;

-- What has been booked stays booked.
create trigger refunds_immutable before update or delete on private.refunds
  for each row execute function private.forbid_change();
create trigger refund_units_immutable before update or delete on private.refund_units
  for each row execute function private.forbid_change();

-- What was collected for an order: the payments that were captured, whether
-- or not part of them has gone back since.
create or replace function private.order_collected_minor(p_order_id uuid) returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(p.amount_minor), 0)::bigint from public.payments p
  where p.order_id = p_order_id and p.status in ('captured', 'partially_refunded', 'refunded');
$$;

create or replace function private.refunded_minor(p_order_id uuid) returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(r.amount_minor), 0)::bigint from private.refunds r where r.order_id = p_order_id;
$$;

-- Never more units of a line than were bought.
create or replace function private.refund_units_within_purchase() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_bought integer;
begin
  select quantity into v_bought from public.order_items where id = new.order_item_id for update;
  if (select sum(u.quantity) from private.refund_units u where u.order_item_id = new.order_item_id)
     > v_bought then
    perform private.fail('refund_exceeds_purchase');
  end if;
  return null;
end;
$$;

create trigger refund_units_within_purchase after insert on private.refund_units
  for each row execute function private.refund_units_within_purchase();

-- Never more money than was collected for the order.
create or replace function private.refunds_within_payment() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if private.refunded_minor(new.order_id) > private.order_collected_minor(new.order_id) then
    perform private.fail('refund_exceeds_payment');
  end if;
  return null;
end;
$$;

create trigger refunds_within_payment after insert on private.refunds
  for each row execute function private.refunds_within_payment();

-- A refund in the ledger that is not in the register is refused at commit, so
-- no future path can move money back without going through the rules above.
create or replace function private.assert_refund_registered() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.kind in ('order_refund', 'return_refund')
     and not exists (select 1 from private.refunds r where r.ledger_transaction_id = new.id) then
    perform private.fail('refund_not_registered');
  end if;
  return null;
end;
$$;

create constraint trigger ledger_refunds_registered
  after insert on public.ledger_transactions
  deferrable initially deferred
  for each row execute function private.assert_refund_registered();

-- One capture and at most one full reversal per order, in the ledger itself.
create unique index ledger_one_capture_per_order_idx on public.ledger_transactions (order_id)
  where kind = 'order_capture';
create unique index ledger_one_reversal_per_order_idx on public.ledger_transactions (order_id)
  where kind = 'order_refund';

-- Money owed to one seller changes one transaction at a time: refunds (which
-- take from it) and paying a payout (which sends it) wait for each other.
create or replace function private.lock_seller_money(p_seller_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtext('yuntera.seller_money'), hashtext(p_seller_id::text));
$$;

-- Gives back units of an order's lines: the shopper gets what they paid for
-- them; each seller gives back what they were paid for them, and the platform
-- gives back its commission on them and the IVA on that commission. The costs
-- of collecting the payment and of the warehouse work already done are not
-- returned to the seller: those services were provided. This is the rule that
-- ops_complete_return applied before, now shared by every path that returns
-- units, and registered so that it cannot happen twice.
--
-- p_units: [{"order_item_id": uuid, "quantity": n}, …]. The caller must hold
-- the order's row lock.
create or replace function private.refund_units(
  p_order_id uuid,
  p_reason text,
  p_source_id uuid,
  p_units jsonb
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
  v_collected bigint;
  r record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('order_not_found');
  end if;
  -- Only money that was collected and has not all gone back can be refunded.
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
      -- No statement was ever made for this seller: nothing was collected for them.
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
  values (v_tx, private.ledger_account('refunds_payable'), -v_total);

  insert into private.refunds (order_id, reason, source_id, amount_minor, ledger_transaction_id, created_by)
  values (p_order_id, p_reason, p_source_id, v_total, v_tx, (select auth.uid()))
  returning id into v_refund;
  insert into private.refund_units (refund_id, order_item_id, quantity)
  select v_refund, u.order_item_id, u.quantity
  from jsonb_to_recordset(p_units) as u (order_item_id uuid, quantity integer);

  v_collected := private.order_collected_minor(p_order_id);
  update public.payments
  set status = case when private.refunded_minor(p_order_id) >= v_collected
                    then 'refunded' else 'partially_refunded' end::public.payment_status,
      refunded_at = now()
  where order_id = p_order_id and status in ('captured', 'partially_refunded');

  -- The money itself moves outside the database (gateway refund or transfer).
  perform private.emit('refund.requested', jsonb_build_object(
    'order_id', p_order_id, 'refund_id', v_refund, 'reason', p_reason,
    'return_request_id', case when p_reason = 'return' then p_source_id end,
    'shipment_id', case when p_reason = 'parcel_returned' then p_source_id end,
    'amount_minor', v_total));

  return jsonb_build_object('refund_id', v_refund, 'refund_minor', v_total,
                            'seller_debit_minor', v_seller_debit);
end;
$$;

-- Reverses a capture in full: every entry of the original, negated. Used only
-- when an order is cancelled before anything left the building, so nothing of
-- it may have been refunded before; the register then holds every unit.
create or replace function private.post_order_refund(p_order_id uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_capture uuid;
  v_tx uuid;
  v_order public.orders%rowtype;
  v_refund uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  select id into v_capture from public.ledger_transactions
  where order_id = p_order_id and kind = 'order_capture';
  if v_capture is null then
    return null;
  end if;
  if exists (select 1 from private.refunds r where r.order_id = p_order_id) then
    -- Part of it went back already: a full reversal would pay those units twice.
    perform private.fail('order_not_refundable', 'partly_refunded');
  end if;

  perform private.lock_seller_money(s.seller_id)
  from (select distinct i.seller_id from public.order_items i where i.order_id = p_order_id) s
  order by s.seller_id;

  insert into public.ledger_transactions (kind, order_id, memo, created_by)
  values ('order_refund', p_order_id, 'Reembolso del pedido ' || v_order.order_number, (select auth.uid()))
  returning id into v_tx;

  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  select v_tx, e.account_id, -e.amount_minor
  from public.ledger_entries e where e.transaction_id = v_capture;

  insert into private.refunds (order_id, reason, source_id, amount_minor, ledger_transaction_id, created_by)
  values (p_order_id, 'order_cancelled', p_order_id, v_order.total_minor, v_tx, (select auth.uid()))
  returning id into v_refund;
  insert into private.refund_units (refund_id, order_item_id, quantity)
  select v_refund, i.id, i.quantity from public.order_items i where i.order_id = p_order_id;

  return v_tx;
end;
$$;

-- ═══ 2. Returns ════════════════════════════════════════════════════════════

alter table public.return_requests
  add column received_at timestamptz,
  add column received_by uuid references auth.users (id),
  add column restocked boolean;

-- Repairs what the old rules let through, so that the triggers below start
-- from a consistent table. On a fresh database this changes nothing.
--   a. Open returns on orders that were never paid, or were cancelled or refunded.
update public.return_requests r
set status = 'rejected', resolved_at = now(),
    resolution_note = 'Cerrada: el pedido no tiene un pago vigente que devolver.'
from public.order_items i join public.orders o on o.id = i.order_id
where i.id = r.order_item_id and r.status in ('requested', 'approved', 'received')
  and (o.status in ('pending_payment', 'payment_review', 'cancelled', 'refunded')
       or not exists (select 1 from public.payments p where p.order_id = o.id
                      and p.status in ('captured', 'partially_refunded')));
--   b. Open returns of units that were never delivered (an approved withdrawal
--      on an order still being prepared or on its way).
update public.return_requests r
set status = 'rejected', resolved_at = now(),
    resolution_note = 'Cerrada: el producto todavía no se había entregado.'
where r.status in ('requested', 'approved')
  and not exists (
    select 1 from public.shipment_items si join public.shipments s on s.id = si.shipment_id
    where si.order_item_id = r.order_item_id and s.status = 'delivered');
--   c. More units in open or refunded returns than the line has: the newest
--      open ones beyond the line's quantity are closed.
with ranked as (
  select r.id, r.status, i.quantity as bought,
         sum(r.quantity) over (partition by r.order_item_id
                               order by (r.status = 'refunded') desc, r.created_at, r.id) as running
  from public.return_requests r join public.order_items i on i.id = r.order_item_id
  where r.status <> 'rejected'
)
update public.return_requests r
set status = 'rejected', resolved_at = now(),
    resolution_note = 'Cerrada: repetía unidades que ya estaban en otra devolución.'
from ranked x
where x.id = r.id and x.running > x.bought and r.status in ('requested', 'approved', 'received');

-- The allowed steps of a return. packages/core does not need them: only staff
-- screens move a return, and they read its status from the queue.
create or replace function private.return_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('requested', 'approved'),
    ('requested', 'rejected'),
    ('approved', 'received'),
    ('approved', 'rejected'),
    ('received', 'refunded')
  );
$$;

-- Not security definer on purpose: current_user must be the role that wrote
-- the row. Inside the API functions that is their owner; a direct write by a
-- signed-in user or a visitor arrives as `authenticated` or `anon` and is refused.
create or replace function private.guard_return_request() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    perform private.fail('forbidden');
  end if;
  if tg_op = 'UPDATE' then
    if new.order_item_id is distinct from old.order_item_id
       or new.user_id is distinct from old.user_id
       or new.kind is distinct from old.kind
       or new.quantity is distinct from old.quantity
       or (old.refund_minor is not null and new.refund_minor is distinct from old.refund_minor) then
      perform private.fail('invalid_return_state', old.status);
    end if;
    if new.status is distinct from old.status
       and not private.return_transition_allowed(old.status, new.status) then
      perform private.fail('invalid_return_state', old.status || ' -> ' || new.status);
    end if;
  elsif new.status not in ('requested', 'approved') then
    perform private.fail('invalid_return_state', new.status);
  end if;
  return new;
end;
$$;

create trigger return_requests_guard before insert or update on public.return_requests
  for each row execute function private.guard_return_request();

-- However a return row is written, the units in returns that are open or
-- refunded never exceed what the line has.
create or replace function private.return_quantity_within_line() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_bought integer;
begin
  select quantity into v_bought from public.order_items where id = new.order_item_id for update;
  if (select coalesce(sum(r.quantity), 0) from public.return_requests r
      where r.order_item_id = new.order_item_id and r.status <> 'rejected') > v_bought then
    perform private.fail('invalid_quantity');
  end if;
  return null;
end;
$$;

create trigger return_requests_within_line
  after insert or update of status, quantity on public.return_requests
  for each row execute function private.return_quantity_within_line();

-- Units of a line that reached the shopper.
create or replace function private.delivered_units(p_order_item_id uuid) returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(si.quantity), 0)::integer
  from public.shipment_items si join public.shipments s on s.id = si.shipment_id
  where si.order_item_id = p_order_item_id and s.status = 'delivered';
$$;

-- An order that can have something returned: paid, and not reversed.
create or replace function private.order_returnable(p_order public.orders) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_order.status not in ('pending_payment', 'payment_review', 'cancelled', 'refunded')
     and exists (select 1 from public.payments p where p.order_id = p_order.id
                 and p.status in ('captured', 'partially_refunded'));
$$;

-- A shopper asks to return units they received. A withdrawal inside the legal
-- window is a right: it is approved at once. Before delivery there is nothing
-- to return: the order is cancelled instead (cancel_order), or, once it can no
-- longer be cancelled, the shopper withdraws after it arrives — the window
-- restarts at delivery.
create or replace function public.request_return(
  p_order_item_id uuid,
  p_kind text,
  p_quantity integer,
  p_reason text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_today date := private.cr_local(now())::date;
  v_delivered integer;
  v_already integer;
  v_id uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  select i.order_id into v_order_id from public.order_items i where i.id = p_order_item_id;
  -- The order first, then the line: the same order every function that
  -- changes an order's money takes them in, so these calls queue up.
  select * into v_order from public.orders where id = v_order_id for update;
  if not found or v_order.user_id is distinct from v_user then
    perform private.fail('order_item_not_found');
  end if;
  select * into v_item from public.order_items where id = p_order_item_id for update;

  if p_kind is null or p_kind not in ('withdrawal', 'warranty', 'damaged', 'wrong_item') then
    perform private.fail('invalid_return_kind');
  end if;
  if not private.order_returnable(v_order) then
    perform private.fail('order_not_returnable', v_order.status::text);
  end if;

  v_delivered := private.delivered_units(p_order_item_id);
  if v_delivered = 0 then
    if p_kind = 'withdrawal' then
      perform private.fail('withdraw_before_delivery');
    end if;
    perform private.fail('not_delivered_yet');
  end if;

  select coalesce(sum(quantity), 0) into v_already
  from public.return_requests
  where order_item_id = p_order_item_id and status <> 'rejected';
  if p_quantity is null or p_quantity <= 0 or p_quantity + v_already > v_delivered then
    perform private.fail('invalid_quantity');
  end if;

  if p_kind = 'withdrawal' then
    if v_today > v_order.withdrawal_deadline then
      perform private.fail('withdrawal_window_closed', v_order.withdrawal_deadline::text);
    end if;
  else
    if p_kind = 'warranty' and (v_order.warranty_until is null or v_today > v_order.warranty_until) then
      perform private.fail('warranty_expired', coalesce(v_order.warranty_until::text, ''));
    end if;
    if coalesce(char_length(trim(p_reason)), 0) < 10 then
      perform private.fail('reason_required');
    end if;
  end if;

  insert into public.return_requests (order_item_id, user_id, kind, quantity, reason, status, refund_due_on)
  values (p_order_item_id, v_user, p_kind, p_quantity, nullif(trim(p_reason), ''),
          case when p_kind = 'withdrawal' then 'approved' else 'requested' end,
          case when p_kind = 'withdrawal' then v_today + 8 end)
  returning id into v_id;

  perform private.emit('return.requested', jsonb_build_object('return_request_id', v_id));
  return v_id;
end;
$$;

-- Staff accept or refuse a claim (damaged, wrong item, warranty).
create or replace function public.ops_decide_return(
  p_return_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_status text;
begin
  if not private.has_staff_role('support', 'ops') then
    perform private.fail('forbidden');
  end if;
  select o.* into v_order
  from public.return_requests r
  join public.order_items i on i.id = r.order_item_id
  join public.orders o on o.id = i.order_id
  where r.id = p_return_id;
  if not found then
    perform private.fail('return_not_found');
  end if;
  perform 1 from public.orders where id = v_order.id for update;
  select status into v_status from public.return_requests where id = p_return_id for update;
  if v_status <> 'requested' then
    perform private.fail('invalid_return_state', v_status);
  end if;
  -- A refusal has to be explained: the shopper is told why.
  if not p_approve and coalesce(char_length(trim(p_note)), 0) < 10 then
    perform private.fail('reason_required');
  end if;
  if p_approve and not private.order_returnable(v_order) then
    perform private.fail('order_not_returnable', v_order.status::text);
  end if;

  update public.return_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      refund_due_on = case when p_approve then private.cr_local(now())::date + 8 end,
      resolution_note = nullif(trim(p_note), ''),
      decided_by = (select auth.uid()),
      resolved_at = case when p_approve then null else now() end
  where id = p_return_id;

  perform private.emit('return.decided',
    jsonb_build_object('return_request_id', p_return_id, 'approved', p_approve));
end;
$$;

-- Staff record that the goods of an approved return are back with Yuntera.
-- Units in a condition to be sold again go back into the warehouse stock they
-- left from; damaged ones are recorded and stay out of stock. A line the
-- seller ships from their own shop goes back to the seller, who counts it in
-- their own stock.
create or replace function public.ops_receive_return(
  p_return_id uuid,
  p_resellable boolean default true,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_return public.return_requests%rowtype;
  v_item public.order_items%rowtype;
  v_warehouse uuid;
  v_location uuid;
  v_restock boolean := false;
begin
  if not private.has_staff_role('support', 'ops') then
    perform private.fail('forbidden');
  end if;
  select i.order_id into v_order_id
  from public.return_requests r join public.order_items i on i.id = r.order_item_id
  where r.id = p_return_id;
  if not found then
    perform private.fail('return_not_found');
  end if;
  perform 1 from public.orders where id = v_order_id for update;
  select * into v_return from public.return_requests where id = p_return_id for update;
  if v_return.status <> 'approved' then
    perform private.fail('invalid_return_state', v_return.status);
  end if;
  if not private.order_returnable((select o from public.orders o where o.id = v_order_id)) then
    perform private.fail('order_not_returnable');
  end if;
  select * into v_item from public.order_items where id = v_return.order_item_id;

  if coalesce(p_resellable, true) and v_item.fulfillment = 'platform' then
    select s.origin_warehouse_id into v_warehouse
    from public.shipments s
    join public.shipment_items si on si.shipment_id = s.id
    join public.warehouses w on w.id = s.origin_warehouse_id
    where si.order_item_id = v_item.id and s.status = 'delivered' and w.kind = 'platform'
    order by si.quantity desc, s.id
    limit 1;
    if v_warehouse is not null then
      select wl.id into v_location from public.warehouse_locations wl
      where wl.warehouse_id = v_warehouse and wl.kind = 'returns' and wl.active
      order by wl.code limit 1;
      perform private.apply_stock_change(
        v_warehouse, v_item.sku_id, v_item.seller_id, v_return.quantity, 'return',
        v_location, 'return_request', p_return_id, 'Devolución recibida');
      v_restock := true;
    end if;
  end if;

  update public.return_requests
  set status = 'received', received_at = now(), received_by = (select auth.uid()),
      restocked = v_restock,
      resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note)
  where id = p_return_id;

  insert into public.order_events (order_id, kind, note, actor_id)
  values (v_order_id, 'note',
          'Recibimos ' || v_return.quantity || ' × ' || v_item.title || ' de vuelta',
          (select auth.uid()));
  perform private.emit('return.received', jsonb_build_object(
    'return_request_id', p_return_id, 'restocked', v_restock));
end;
$$;

-- Staff record that a received return has been refunded. The amounts follow
-- private.refund_units; the register makes a second refund of the same
-- return, or of more units than were bought, impossible.
create or replace function public.ops_complete_return(
  p_return_id uuid,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_return public.return_requests%rowtype;
  v_item public.order_items%rowtype;
  v_result jsonb;
begin
  if not private.has_staff_role('finance', 'support') then
    perform private.fail('forbidden');
  end if;
  select i.order_id into v_order_id
  from public.return_requests r join public.order_items i on i.id = r.order_item_id
  where r.id = p_return_id;
  if not found then
    perform private.fail('return_not_found');
  end if;
  perform 1 from public.orders where id = v_order_id for update;
  select * into v_return from public.return_requests where id = p_return_id for update;
  if v_return.status = 'approved' then
    -- The money goes back once the goods are back.
    perform private.fail('return_not_received');
  end if;
  if v_return.status <> 'received' then
    perform private.fail('invalid_return_state', v_return.status);
  end if;
  select * into v_item from public.order_items where id = v_return.order_item_id;

  v_result := private.refund_units(v_order_id, 'return', p_return_id,
    jsonb_build_array(jsonb_build_object('order_item_id', v_item.id, 'quantity', v_return.quantity)));

  update public.return_requests
  set status = 'refunded', refund_minor = (v_result ->> 'refund_minor')::bigint,
      refunded_by = (select auth.uid()),
      resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note), resolved_at = now()
  where id = p_return_id;

  insert into public.order_events (order_id, kind, to_status, note, actor_id)
  values (v_order_id, 'note', null,
          'Reembolso de ' || v_return.quantity || ' × ' || v_item.title, (select auth.uid()));

  return jsonb_build_object('refund_minor', (v_result ->> 'refund_minor')::bigint,
                            'seller_debit_minor', (v_result ->> 'seller_debit_minor')::bigint);
end;
$$;

-- ═══ 3. Cancelling ═════════════════════════════════════════════════════════

-- Releases stock, stops fulfilment and settles the payment for a cancelled
-- order. Only before anything is packed: a packed parcel holds the goods, and
-- stopping it means it comes back through the returned-parcel check-in.
create or replace function private.cancel_order_internal(p_order_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_paid boolean;
  v_refund_minor bigint := 0;
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
    select coalesce(sum(amount_minor), 0) into v_refund_minor
    from private.refunds where order_id = p_order_id and reason = 'order_cancelled';
    if private.setting('payments_mode') = '"sandbox"'::jsonb then
      -- No real money moved: settle the payment immediately.
      update public.payments
      set status = 'refunded', refunded_at = now()
      where order_id = p_order_id and status = 'captured';
      update public.orders set status = 'refunded' where id = p_order_id;
    else
      -- The refund goes back through the gateway, by the same method the shopper paid with.
      perform private.emit('refund.requested', jsonb_build_object(
        'order_id', p_order_id, 'reason', 'order_cancelled', 'amount_minor', v_refund_minor));
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

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_is_staff boolean := private.has_staff_role('ops', 'support');
  v_status public.order_status;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not (v_order.user_id = (select auth.uid()) or v_is_staff) then
    perform private.fail('order_not_found');
  end if;

  if v_order.status not in ('pending_payment', 'payment_review', 'confirmed', 'processing') then
    perform private.fail('too_late_to_cancel', v_order.status::text);
  end if;
  -- Once the warehouse has started on it, only staff can stop it; the shopper
  -- still has the withdrawal right after delivery.
  if not v_is_staff and (
    v_order.status = 'processing'
    or exists (select 1 from public.shipments s where s.order_id = p_order_id and s.status <> 'pending')
  ) then
    perform private.fail('too_late_to_cancel', 'in_preparation');
  end if;
  -- Staff can stop it while it is being picked, not once a parcel is packed.
  if exists (
    select 1 from public.shipments s
    where s.order_id = p_order_id and s.status not in ('pending', 'picking', 'cancelled')
  ) then
    perform private.fail('too_late_to_cancel', 'packed');
  end if;

  perform private.cancel_order_internal(
    p_order_id, coalesce(nullif(trim(p_reason), ''), 'Cancelado por el cliente'));

  select status into v_status from public.orders where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', v_status);
end;
$$;

-- ═══ 4. Payment confirmation ═══════════════════════════════════════════════

-- Marks an order's payment as received and books it. Takes the order's lock
-- first, so a confirmation that waited behind a cancellation sees the
-- cancellation and says so, instead of reporting success and recording nothing.
-- Calling it again with the same reference after it succeeded does nothing.
create or replace function private.capture_payment(
  p_order_id uuid,
  p_provider_reference text,
  p_cash boolean default false
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_payment uuid;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('order_not_found');
  end if;
  if v_status in ('cancelled', 'refunded') then
    perform private.fail('order_not_payable', v_status::text);
  end if;

  select id into v_payment from public.payments
  where order_id = p_order_id and status in ('pending', 'authorized')
  order by created_at limit 1
  for update;
  if v_payment is null then
    if exists (
      select 1 from public.payments p
      where p.order_id = p_order_id and p.provider_reference = p_provider_reference
        and p.status in ('captured', 'partially_refunded', 'refunded')
    ) then
      return; -- the same confirmation, again
    end if;
    perform private.fail('order_not_payable', 'already_paid');
  end if;

  update public.payments
  set status = 'captured', captured_at = now(), provider_reference = p_provider_reference
  where id = v_payment;

  insert into public.order_events (order_id, kind, to_status, note, actor_id)
  values (p_order_id, 'payment', 'captured', 'Pago recibido', (select auth.uid()));

  perform private.post_order_capture(p_order_id, p_cash);

  if v_status in ('pending_payment', 'payment_review') then
    update public.orders set status = 'confirmed', confirmed_at = now() where id = p_order_id;
    perform private.release_order_to_fulfillment(p_order_id);
  end if;

  perform private.emit('payment.captured', jsonb_build_object('order_id', p_order_id));
  -- The seller's electronic invoice to the shopper is issued from this event.
  perform private.emit('invoice.requested', jsonb_build_object('order_id', p_order_id));
end;
$$;

create or replace function public.confirm_sandbox_payment(p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if private.setting('payments_mode') is distinct from '"sandbox"'::jsonb then
    perform private.fail('sandbox_disabled');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found
     or not (v_order.user_id = (select auth.uid()) or private.has_staff_role('ops', 'support', 'finance')) then
    perform private.fail('order_not_found');
  end if;
  if v_order.status <> 'pending_payment' then
    perform private.fail('order_not_payable', v_order.status::text);
  end if;

  perform private.capture_payment(p_order_id, 'sandbox:' || p_order_id, false);
  return jsonb_build_object('order_id', p_order_id, 'status', 'confirmed');
end;
$$;

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
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_bank_reference)), 0) not between 4 and 60 then
    perform private.fail('invalid_amount');
  end if;

  -- Waits for a cancellation in progress, then reads what it left.
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if not found then
    perform private.fail('order_not_found');
  end if;
  if v_status not in ('pending_payment', 'payment_review') then
    perform private.fail('order_not_payable', v_status::text);
  end if;
  select p.method into v_method from public.payments p
  where p.order_id = p_order_id and p.status in ('pending', 'authorized')
  order by p.created_at limit 1;
  -- Cards are confirmed by the gateway and cash by the driver, never by hand.
  if v_method is null or v_method not in ('sinpe_movil', 'bank_transfer') then
    perform private.fail('order_not_payable', coalesce(v_method::text, ''));
  end if;

  perform private.capture_payment(p_order_id, 'manual:' || trim(p_bank_reference), false);
exception
  when unique_violation then
    -- The same bank reference was already used for another order.
    perform private.fail('invalid_amount');
end;
$$;

-- ═══ 5. The delivery code ══════════════════════════════════════════════════
-- The code moves out of public.orders, which staff could read, into a table
-- in the private schema that no API role can read. Only get_order (for the
-- shopper who owns the order) and driver_complete_stop (to compare) reach it.

create table private.delivery_codes (
  order_id uuid primary key references public.orders (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$'),
  -- Wrong codes typed for this order, across all its parcels, stops and routes.
  wrong_attempts smallint not null default 0 check (wrong_attempts >= 0),
  locked_at timestamptz,
  released_at timestamptz,
  released_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

-- Every wrong code, with the driver who typed it, for staff to look into.
create table private.delivery_code_attempts (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  stop_id uuid references public.route_stops (id) on delete set null,
  driver_id uuid references public.drivers (id),
  attempted_at timestamptz not null default now()
);

create index delivery_code_attempts_order_idx on private.delivery_code_attempts (order_id, attempted_at);

alter table private.delivery_codes enable row level security;
alter table private.delivery_code_attempts enable row level security;
revoke all on private.delivery_codes, private.delivery_code_attempts from public, anon, authenticated;

create or replace function private.delivery_code_max_attempts() returns smallint
language sql immutable
set search_path = ''
as $$ select 5::smallint $$;

create or replace function private.new_delivery_code() returns text
language sql volatile security definer
set search_path = ''
as $$
  select lpad(
    ((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::integer) % 10000)::text, 4, '0');
$$;

insert into private.delivery_codes (order_id, code)
select o.id, o.delivery_pin from public.orders o;

-- Wrong attempts already counted on stops carry over to their order.
update private.delivery_codes c
set wrong_attempts = least(x.attempts, private.delivery_code_max_attempts()),
    locked_at = case when x.attempts >= private.delivery_code_max_attempts() then now() end
from (
  select s.order_id, sum(rs.pin_attempts)::integer as attempts
  from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
  group by s.order_id
) x
where x.order_id = c.order_id and x.attempts > 0
  and exists (select 1 from public.orders o where o.id = c.order_id
              and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped'));

alter table public.orders drop column delivery_pin;

-- ═══ 6. Placing an order ═══════════════════════════════════════════════════

insert into public.app_settings (key, value, description) values
  ('max_unpaid_orders_per_account', '3',
   'Orders one account may have waiting for payment at the same time.'),
  ('max_held_units_per_account', '30',
   'Units one account may hold reserved in orders not yet paid (and, for an account with no delivered order, in cash-on-delivery orders not yet delivered).'),
  ('max_open_cod_orders_new_account', '2',
   'Cash-on-delivery orders not yet delivered that an account with no delivered order may have.')
on conflict (key) do nothing;

-- Units an account holds reserved in orders that have not been paid, or, for
-- an account that has never received an order, in cash-on-delivery orders not
-- yet delivered. Per offer, so one product cannot be emptied by one account.
create or replace function private.held_units(p_user_id uuid)
returns table (offer_id uuid, quantity bigint)
language sql stable security definer
set search_path = ''
as $$
  with established as (
    select exists (select 1 from public.orders o
                   where o.user_id = p_user_id and o.status in ('delivered', 'completed')) as yes
  )
  select i.offer_id, sum(res.quantity)::bigint
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.inventory_reservations res on res.order_item_id = i.id and res.status = 'active'
  cross join established e
  where o.user_id = p_user_id
    and (o.status in ('pending_payment', 'payment_review')
         or (not e.yes and o.payment_method = 'cash_on_delivery'
             and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')))
  group by i.offer_id;
$$;

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
  v_max_unpaid integer := coalesce((private.setting('max_unpaid_orders_per_account'))::integer, 3);
  v_max_held integer := coalesce((private.setting('max_held_units_per_account'))::integer, 30);
  v_max_new_cod integer := coalesce((private.setting('max_open_cod_orders_new_account'))::integer, 2);
  v_prefix text := private.setting('order_number_prefix') #>> '{}';
  v_check record;
  v_recheck record;
  v_shipping bigint;
  v_shipping_tax bigint;
  v_total bigint;
  v_promise record;
  v_order_id uuid;
  v_number text;
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
  v_prices jsonb;
  v_price bigint;
  v_lines_total bigint;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;

  -- One checkout per account at a time. A retry of a request still in flight
  -- waits here and then gets the order the first one created, instead of a
  -- raw duplicate-key error; and the limits below cannot be passed by sending
  -- several orders at once.
  perform pg_advisory_xact_lock(hashtext('yuntera.place_order'), hashtext(v_user::text));

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

  -- Hold the stock and the offers before reading a price. Stock rows first,
  -- in the fixed order every checkout and every packing uses (SKU, seller,
  -- location), then the offers in id order: a concurrent order for the same
  -- stock waits on the first lock, so the last unit cannot be promised twice,
  -- and a price change waits until this order is written, so the lines are
  -- written at the price the total was worked out with.
  perform 1
  from public.stock_levels l
  join public.warehouses w on w.id = l.warehouse_id
  join public.offers o on o.sku_id = l.sku_id and o.seller_id = l.seller_id
  where o.id in (select (e ->> 'offer_id')::uuid from jsonb_array_elements(p_items) e
                 where (e ->> 'offer_id') ~ '^[0-9a-fA-F-]{36}$')
    and w.active
    and w.kind = (case when o.fulfillment = 'platform' then 'platform' else 'seller' end)::public.warehouse_kind
  order by l.sku_id, l.seller_id, l.warehouse_id
  for update of l;
  perform 1 from public.offers o
  where o.id in (select (e ->> 'offer_id')::uuid from jsonb_array_elements(p_items) e
                 where (e ->> 'offer_id') ~ '^[0-9a-fA-F-]{36}$')
  order by o.id
  for share of o;

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

  -- The prices the total is made of, kept to write the lines with.
  select jsonb_object_agg(o.id::text, o.price_minor) into v_prices
  from public.offers o
  where o.id in (select (e ->> 'offer_id')::uuid from jsonb_array_elements(p_items) e);

  -- Limits on what one account can hold without paying. An honest shopper
  -- has one or two orders waiting for a transfer; holding many, or most of a
  -- product, is how stock is taken off sale for everyone else.
  if p_payment_method <> 'cash_on_delivery' and (
    select count(*) from public.orders o
    where o.user_id = v_user and o.status in ('pending_payment', 'payment_review')
  ) >= v_max_unpaid then
    perform private.fail('too_many_unpaid_orders', v_max_unpaid::text);
  end if;
  if p_payment_method = 'cash_on_delivery'
     and not exists (select 1 from public.orders o
                     where o.user_id = v_user and o.status in ('delivered', 'completed'))
     and (select count(*) from public.orders o
          where o.user_id = v_user and o.payment_method = 'cash_on_delivery'
            and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')) >= v_max_new_cod then
    perform private.fail('cod_limit_reached', v_max_new_cod::text);
  end if;
  if p_payment_method <> 'cash_on_delivery'
     or not exists (select 1 from public.orders o
                    where o.user_id = v_user and o.status in ('delivered', 'completed')) then
    if (select coalesce(sum(h.quantity), 0) from private.held_units(v_user) h)
       + (select coalesce(sum((e ->> 'quantity')::integer), 0) from jsonb_array_elements(p_items) e)
       > v_max_held
       or exists (
         select 1
         from (select (e ->> 'offer_id')::uuid as offer_id, sum((e ->> 'quantity')::integer) as quantity
               from jsonb_array_elements(p_items) e group by 1) r
         left join private.held_units(v_user) h on h.offer_id = r.offer_id
         where r.quantity + coalesce(h.quantity, 0) > v_max_units
       ) then
      perform private.fail('too_many_held_units', v_max_units::text);
    end if;
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

  insert into public.orders (
    order_number, user_id, status, items_total_minor, shipping_minor, total_minor,
    tax_included_minor, payment_method, zone_id,
    ship_recipient_name, ship_phone, ship_postal_code, ship_senas, ship_lat, ship_lng, ship_plus_code,
    promise_earliest, promise_latest, withdrawal_deadline, idempotency_key,
    confirmed_at
  ) values (
    v_number, v_user,
    -- Cash on delivery is confirmed at once: there is nothing to wait for.
    case when p_payment_method = 'cash_on_delivery' then 'confirmed' else 'pending_payment' end::public.order_status,
    v_check.items_total, v_shipping, v_total,
    v_check.items_tax + v_shipping_tax, p_payment_method, v_zone.id,
    v_addr.recipient_name, v_addr.phone, v_addr.postal_code, v_addr.senas, v_addr.lat, v_addr.lng,
    v_addr.plus_code,
    v_promise.earliest, v_promise.latest, private.add_business_days(v_today, 8),
    p_idempotency_key,
    case when p_payment_method = 'cash_on_delivery' then now() end
  )
  returning id into v_order_id;

  insert into private.delivery_codes (order_id, code) values (v_order_id, private.new_delivery_code());

  -- Pass 2: reserve stock and write the lines, at the prices of pass 1.
  for v_line in
    with requested as (
      select (e ->> 'offer_id')::uuid as offer_id, sum((e ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e
      group by 1
    )
    select r.offer_id, r.quantity, o.fulfillment, o.seller_id, o.sku_id,
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
    v_price := (v_prices ->> v_line.offer_id::text)::bigint;

    insert into public.order_items (
      order_id, offer_id, sku_id, product_id, seller_id, category_id, title, variant_name,
      image_path, unit_price_minor, quantity, line_total_minor, tax_rate_bps, tax_minor,
      fulfillment, weight_grams, longest_side_cm
    ) values (
      v_order_id, v_line.offer_id, v_line.sku_id, v_line.product_id, v_line.seller_id,
      v_line.category_id, v_line.title, v_line.variant_name, v_line.image_path,
      v_price, v_line.quantity, v_price * v_line.quantity,
      v_line.tax_rate_bps,
      (v_price * v_line.quantity
        - round((v_price * v_line.quantity)::numeric * 10000 / (10000 + v_line.tax_rate_bps)))::bigint,
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

  -- The lines add up to the total the shopper is charged, and every offer is
  -- still on sale at the price it was priced at.
  select coalesce(sum(line_total_minor), 0) into v_lines_total
  from public.order_items where order_id = v_order_id;
  select * into v_recheck from private.price_items(p_items, v_max_units);
  if v_lines_total <> v_check.items_total
     or v_recheck.unavailable_offer is not null
     or v_recheck.items_total <> v_check.items_total then
    perform private.fail('price_changed', coalesce(v_recheck.items_total + v_shipping, v_total)::text);
  end if;

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

-- One order in full: what was bought, what was paid, where each parcel is.
-- For the shopper who owns it, and for staff helping them. Unchanged except
-- that the delivery code now comes from the private table.
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
    -- The code is shown while there is still something to hand over, and only
    -- to the shopper. It is their proof against a parcel being marked
    -- delivered without them, so nobody on the platform's side may read it:
    -- not the driver, and not staff looking at the order.
    'delivery_pin', case when v_is_owner
                          and o.status in ('confirmed', 'processing', 'partially_shipped', 'shipped')
                         then (select c.code from private.delivery_codes c where c.order_id = o.id) end,
    'can_cancel', v_is_staff and o.status in ('pending_payment', 'payment_review', 'confirmed', 'processing')
                  and not exists (select 1 from public.shipments s where s.order_id = o.id
                                  and s.status not in ('pending', 'picking', 'cancelled'))
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

-- ═══ 7. Routes, cash on delivery and the door ══════════════════════════════

-- The order whose cash a stop collects, so that a unique index can say "one
-- live stop carries the cash of an order" whatever writes the stops.
alter table public.route_stops add column cod_order_id uuid references public.orders (id);

create or replace function private.route_stop_cod_order() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.cod_order_id := case when new.cod_amount_minor > 0
    then (select s.order_id from public.shipments s where s.id = new.shipment_id) end;
  return new;
end;
$$;

create trigger route_stops_cod_order before insert or update of cod_amount_minor, shipment_id
  on public.route_stops
  for each row execute function private.route_stop_cod_order();

update public.route_stops rs set cod_order_id = s.order_id
from public.shipments s where s.id = rs.shipment_id and rs.cod_amount_minor > 0;

create unique index route_stops_one_cash_stop_idx on public.route_stops (cod_order_id)
  where cod_amount_minor > 0 and status in ('pending', 'arrived', 'delivered');

-- Saves a planned route. Unchanged, except that each parcel's order is locked
-- before the shipment (the order every other function uses), so two routes
-- planned at once for parcels of the same cash order cannot both put the cash
-- on their stop.
create or replace function public.ops_create_route(
  p_service_date date,
  p_depot_warehouse_id uuid,
  p_stops jsonb,
  p_driver_id uuid default null,
  p_planned_km numeric default null,
  p_planned_minutes integer default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_route uuid;
  v_stop record;
  v_ship public.shipments%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_cod bigint;
  v_sequence smallint := 0;
  v_constraint text;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  if jsonb_typeof(p_stops) is distinct from 'array' or jsonb_array_length(p_stops) = 0 then
    perform private.fail('route_empty');
  end if;
  if p_driver_id is not null and not exists (
    select 1 from public.drivers d where d.id = p_driver_id and d.status = 'active'
  ) then
    perform private.fail('driver_not_available');
  end if;

  insert into public.routes
    (code, service_date, depot_warehouse_id, driver_id, status, planned_km, planned_minutes, created_by)
  values
    ('R-' || nextval('private.route_code_seq'), p_service_date, p_depot_warehouse_id, p_driver_id,
     case when p_driver_id is null then 'draft' else 'assigned' end::public.route_status,
     p_planned_km, p_planned_minutes, (select auth.uid()))
  returning id into v_route;

  for v_stop in
    select (s ->> 'shipment_id')::uuid as shipment_id,
           (s ->> 'eta_minute')::integer as eta_minute,
           row_number() over (order by (s ->> 'sequence')::integer, ord) as position
    from jsonb_array_elements(p_stops) with ordinality as t (s, ord)
    order by position
  loop
    select order_id into v_order_id from public.shipments where id = v_stop.shipment_id;
    if not found then
      perform private.fail('shipment_not_found', v_stop.shipment_id::text);
    end if;
    select * into v_order from public.orders where id = v_order_id for update;
    select * into v_ship from public.shipments where id = v_stop.shipment_id for update;
    if v_ship.status not in ('packed', 'ready_for_dispatch', 'delivery_failed') then
      perform private.fail('shipment_not_dispatchable', v_ship.tracking_code);
    end if;

    -- Cash for the whole order is collected once, at the first parcel delivered.
    v_cod := 0;
    if v_order.payment_method = 'cash_on_delivery'
       and exists (select 1 from public.payments p where p.order_id = v_order.id and p.status = 'pending')
       and not exists (
         select 1 from public.route_stops rs
         join public.shipments s2 on s2.id = rs.shipment_id
         where s2.order_id = v_order.id and rs.cod_amount_minor > 0
           and rs.status in ('pending', 'arrived', 'delivered')
       ) then
      v_cod := v_order.total_minor;
    end if;

    v_sequence := v_sequence + 1;
    begin
      insert into public.route_stops
        (route_id, shipment_id, sequence, eta_minute, recipient_name, phone, senas, lat, lng,
         plus_code, package_count, cod_amount_minor)
      values
        (v_route, v_ship.id, v_sequence, v_stop.eta_minute, v_order.ship_recipient_name,
         v_order.ship_phone, v_order.ship_senas, v_order.ship_lat, v_order.ship_lng,
         v_order.ship_plus_code, v_ship.package_count, v_cod);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'route_stops_one_cash_stop_idx' then
        perform private.fail('cash_already_on_route', v_ship.tracking_code);
      end if;
      perform private.fail('shipment_already_routed', v_ship.tracking_code);
    end;

    if v_ship.status <> 'ready_for_dispatch' then
      update public.shipments set status = 'ready_for_dispatch' where id = v_ship.id;
    end if;
  end loop;

  return v_route;
end;
$$;

-- Completes a delivery. Returns a result object instead of raising for the
-- outcomes a driver can cause at the door (wrong code, wrong cash amount), so
-- that wrong attempts are counted rather than rolled back. Wrong codes are
-- counted per ORDER, across all its parcels, stops and routes: after the
-- limit the order is locked until staff release it, and staff see an event.
create or replace function public.driver_complete_stop(
  p_stop_id uuid,
  p_pin text,
  p_recipient_name text,
  p_cod_collected_minor bigint default 0,
  p_photo_path text default null,
  p_lat double precision default null,
  p_lng double precision default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_stop public.route_stops%rowtype;
  v_ship public.shipments%rowtype;
  v_code private.delivery_codes%rowtype;
  v_route_done boolean;
  v_attempts smallint;
  c_max_attempts constant smallint := private.delivery_code_max_attempts();
begin
  select * into v_stop from public.route_stops where id = p_stop_id for update;
  if not found or not private.drives_route(v_stop.route_id) then
    perform private.fail('stop_not_found');
  end if;
  if not exists (select 1 from public.routes r where r.id = v_stop.route_id and r.status = 'in_progress') then
    perform private.fail('route_not_in_progress');
  end if;
  if v_stop.status not in ('pending', 'arrived') then
    perform private.fail('invalid_stop_state', v_stop.status::text);
  end if;

  select * into v_ship from public.shipments where id = v_stop.shipment_id for update;
  select * into v_code from private.delivery_codes where order_id = v_ship.order_id for update;

  if v_code.order_id is null then
    perform private.fail('stop_not_found');
  end if;
  if v_code.locked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'pin_locked');
  end if;

  if p_pin is null or p_pin <> v_code.code then
    v_attempts := v_code.wrong_attempts + 1;
    update public.route_stops set pin_attempts = pin_attempts + 1 where id = p_stop_id;
    update private.delivery_codes
    set wrong_attempts = v_attempts,
        locked_at = case when v_attempts >= c_max_attempts then now() end,
        updated_at = now()
    where order_id = v_ship.order_id;
    insert into private.delivery_code_attempts (order_id, stop_id, driver_id)
    values (v_ship.order_id, p_stop_id, private.my_driver_id());
    if v_attempts >= c_max_attempts then
      -- Staff see it on the order; the shopper's code stays private.
      insert into public.order_events (order_id, shipment_id, kind, note, visible_to_customer, actor_id)
      values (v_ship.order_id, v_ship.id, 'note',
              'Código de entrega bloqueado tras ' || c_max_attempts
                || ' intentos fallidos. Atención al cliente debe liberarlo.',
              false, (select auth.uid()));
      perform private.emit('delivery_code.locked', jsonb_build_object(
        'order_id', v_ship.order_id, 'stop_id', p_stop_id, 'driver_id', private.my_driver_id(),
        'attempts', v_attempts));
    end if;
    return jsonb_build_object(
      'ok', false, 'error', 'wrong_pin',
      'attempts_left', greatest(0, c_max_attempts - v_attempts));
  end if;

  if v_stop.cod_amount_minor > 0 and coalesce(p_cod_collected_minor, 0) <> v_stop.cod_amount_minor then
    return jsonb_build_object(
      'ok', false, 'error', 'cod_amount_mismatch', 'expected_minor', v_stop.cod_amount_minor);
  end if;
  if coalesce(char_length(trim(p_recipient_name)), 0) < 2 then
    return jsonb_build_object('ok', false, 'error', 'recipient_required');
  end if;

  update public.route_stops
  set status = 'delivered', completed_at = now(), arrived_at = coalesce(arrived_at, now()),
      pod_recipient_name = trim(p_recipient_name), pod_photo_path = p_photo_path,
      pod_lat = p_lat, pod_lng = p_lng,
      cod_collected_minor = case when cod_amount_minor > 0 then p_cod_collected_minor else 0 end
  where id = p_stop_id;

  update public.shipments set status = 'delivered', delivered_at = now() where id = v_ship.id;

  if v_stop.cod_amount_minor > 0 then
    perform private.capture_payment(v_ship.order_id, 'cod:' || p_stop_id, true);
  end if;

  perform private.sync_order_status(v_ship.order_id);
  perform private.emit('shipment.delivered', jsonb_build_object('shipment_id', v_ship.id));
  v_route_done := private.maybe_complete_route(v_stop.route_id);

  return jsonb_build_object('ok', true, 'route_completed', v_route_done);
end;
$$;

-- The driver's day. Unchanged, except that the attempts left come from the
-- order's counter, the one the door check uses.
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
            'pin_attempts_left', (
              select case when c.locked_at is not null then 0
                          else greatest(0, private.delivery_code_max_attempts() - c.wrong_attempts) end
              from private.delivery_codes c where c.order_id = sh.order_id),
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

-- Staff: how a delivery code stands. Never the code itself.
create or replace function public.ops_delivery_code(p_order_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c private.delivery_codes%rowtype;
begin
  if not private.has_staff_role('ops', 'support') then
    perform private.fail('forbidden');
  end if;
  select * into c from private.delivery_codes where order_id = p_order_id;
  if not found then
    perform private.fail('order_not_found');
  end if;
  return jsonb_build_object(
    'order_id', c.order_id,
    'wrong_attempts', c.wrong_attempts,
    'attempts_left', case when c.locked_at is not null then 0
                          else greatest(0, private.delivery_code_max_attempts() - c.wrong_attempts) end,
    'max_attempts', private.delivery_code_max_attempts(),
    'locked', c.locked_at is not null,
    'locked_at', c.locked_at,
    'released_at', c.released_at);
end;
$$;

-- Staff release a locked code after speaking with the shopper. The order gets
-- a NEW code, so the guesses made against the old one are worth nothing; the
-- shopper reads it on their order page as before.
create or replace function public.ops_release_delivery_code(p_order_id uuid, p_note text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c private.delivery_codes%rowtype;
begin
  if not private.has_staff_role('ops', 'support') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_note)), 0) < 5 then
    perform private.fail('reason_required');
  end if;
  select * into c from private.delivery_codes where order_id = p_order_id for update;
  if not found then
    perform private.fail('order_not_found');
  end if;
  if c.locked_at is null then
    perform private.fail('delivery_code_not_locked');
  end if;

  update private.delivery_codes
  set code = private.new_delivery_code(), wrong_attempts = 0, locked_at = null,
      released_at = now(), released_by = (select auth.uid()), updated_at = now()
  where order_id = p_order_id;

  insert into public.order_events (order_id, kind, note, visible_to_customer, actor_id)
  values (p_order_id, 'note', 'Código de entrega liberado: ' || left(trim(p_note), 300), false,
          (select auth.uid()));
  insert into public.order_events (order_id, kind, note, visible_to_customer, actor_id)
  values (p_order_id, 'note', 'Le dimos un código de entrega nuevo; lo encuentra en este pedido.', true,
          (select auth.uid()));
  perform private.emit('delivery_code.released', jsonb_build_object('order_id', p_order_id));
end;
$$;

-- ═══ 8. Parcels that come back ═════════════════════════════════════════════

-- An order whose every parcel came back undelivered is cancelled, from the
-- states it can be in while parcels travel. packages/core/src/lifecycle.ts
-- holds the same table (its test reads the block from the newest migration).
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
    ('partially_shipped', 'cancelled'),
    ('shipped', 'delivered'),
    ('shipped', 'cancelled'),
    ('delivered', 'completed'),
    ('delivered', 'refunded'),
    ('completed', 'refunded'),
    ('cancelled', 'refunded')
    -- END order_transitions
  );
$$;

-- The warehouse checks in a parcel that came back without being delivered
-- (ops_return_shipment sent it back). Its units go back into stock where it
-- left from, or, if damaged, are recorded and stay out. The shopper gets back
-- what they paid for those units, through the refund register. An order none
-- of whose parcels reached the shopper is then cancelled.
create or replace function public.wms_receive_returned_shipment(
  p_shipment_id uuid,
  p_resellable boolean default true,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ship public.shipments%rowtype;
  v_order public.orders%rowtype;
  v_kind public.warehouse_kind;
  v_location uuid;
  v_units jsonb;
  v_refund jsonb;
  r record;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if not found then
    perform private.fail('shipment_not_found');
  end if;
  if not (private.works_at(v_ship.origin_warehouse_id) or private.has_staff_role('ops')
          or (v_ship.seller_id is not null and private.is_seller_member(v_ship.seller_id))) then
    perform private.fail('forbidden');
  end if;
  select * into v_order from public.orders where id = v_ship.order_id for update;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.status <> 'returning' then
    perform private.fail('shipment_not_returning', v_ship.status::text);
  end if;

  select w.kind into v_kind from public.warehouses w where w.id = v_ship.origin_warehouse_id;
  if v_kind = 'platform' then
    select wl.id into v_location from public.warehouse_locations wl
    where wl.warehouse_id = v_ship.origin_warehouse_id and wl.kind = 'returns' and wl.active
    order by wl.code limit 1;
  end if;

  for r in
    select si.order_item_id, si.quantity, i.sku_id, i.seller_id
    from public.shipment_items si join public.order_items i on i.id = si.order_item_id
    where si.shipment_id = p_shipment_id
    order by i.sku_id, i.seller_id
  loop
    if coalesce(p_resellable, true) then
      perform private.apply_stock_change(
        v_ship.origin_warehouse_id, r.sku_id, r.seller_id, r.quantity, 'return', v_location,
        'shipment', p_shipment_id, coalesce(nullif(trim(p_note), ''), 'Paquete devuelto sin entregar'));
    else
      -- Recorded, never sellable again.
      insert into public.stock_movements
        (warehouse_id, sku_id, seller_id, on_hand_delta, quantity, reason, reference_type,
         reference_id, note, actor_id)
      values
        (v_ship.origin_warehouse_id, r.sku_id, r.seller_id, 0, r.quantity, 'damage', 'shipment',
         p_shipment_id, coalesce(nullif(trim(p_note), ''), 'Paquete devuelto dañado'),
         (select auth.uid()));
    end if;
  end loop;

  update public.shipments set status = 'returned' where id = p_shipment_id;

  -- What was paid for these units goes back to the shopper.
  if exists (select 1 from public.payments p where p.order_id = v_order.id
             and p.status in ('captured', 'partially_refunded')) then
    select jsonb_agg(jsonb_build_object('order_item_id', si.order_item_id, 'quantity', si.quantity))
    into v_units
    from public.shipment_items si where si.shipment_id = p_shipment_id;
    v_refund := private.refund_units(v_order.id, 'parcel_returned', p_shipment_id, v_units);
  end if;

  insert into public.order_events (order_id, shipment_id, kind, note, actor_id)
  values (v_order.id, p_shipment_id, 'note',
          case when v_refund is null then 'Su paquete regresó a nuestra bodega sin entregarse'
               else 'Su paquete regresó a nuestra bodega sin entregarse; le devolvemos lo que pagó por él' end,
          (select auth.uid()));

  if not exists (select 1 from public.shipments s where s.order_id = v_order.id
                 and s.status not in ('returned', 'cancelled'))
     and not exists (select 1 from public.shipments s where s.order_id = v_order.id
                     and s.status = 'delivered') then
    -- Nothing reached the shopper and nothing is still on its way.
    update public.orders
    set status = 'cancelled', cancelled_at = now(),
        cancel_reason = 'Los paquetes regresaron sin entregarse'
    where id = v_order.id and status not in ('cancelled', 'refunded');
    update public.payments set status = 'cancelled'
    where order_id = v_order.id and status in ('pending', 'authorized');
    perform private.emit('order.cancelled', jsonb_build_object(
      'order_id', v_order.id, 'reason', 'Los paquetes regresaron sin entregarse'));
  else
    perform private.sync_order_status(v_order.id);
  end if;

  perform private.emit('shipment.returned', jsonb_build_object(
    'shipment_id', p_shipment_id, 'resellable', coalesce(p_resellable, true)));

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'refund_minor', coalesce((v_refund ->> 'refund_minor')::bigint, 0),
    'order_status', (select o.status from public.orders o where o.id = v_order.id));
end;
$$;

-- ═══ 9. Paying sellers ═════════════════════════════════════════════════════

-- Finance records that the bank sent a payout. Unchanged, except that it waits
-- for any refund of the same seller in progress and then refuses to pay more
-- than the seller is owed: when refunds since the run was made leave less
-- available than was scheduled, the payout is marked failed instead and the
-- next run pays what is really owed.
create or replace function public.ops_mark_payout_paid(
  p_payout_id uuid,
  p_bank_reference text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payout public.payouts%rowtype;
  v_hold integer;
  v_available bigint;
  v_reference text := trim(coalesce(p_bank_reference, ''));
  v_tx uuid;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  if char_length(v_reference) not between 4 and 60 then
    perform private.fail('invalid_bank_reference');
  end if;
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then
    perform private.fail('payout_not_found');
  end if;
  if v_payout.status <> 'scheduled' then
    perform private.fail('payout_not_scheduled', v_payout.status);
  end if;

  perform private.lock_seller_money(v_payout.seller_id);
  select r.hold_days into v_hold from public.payout_runs r where r.id = v_payout.run_id;
  select b.available_minor into v_available
  from private.seller_balances(private.cr_local(now())::date,
                               coalesce(v_hold, private.payout_hold_days()), v_payout.seller_id) b;
  if coalesce(v_available, 0) < 0 then
    perform private.fail('payout_exceeds_balance', (-v_available)::text);
  end if;

  insert into public.ledger_transactions (kind, memo, created_by)
  values ('payout', 'Pago a vendedor ' || coalesce(v_payout.reference, v_payout.id::text),
          (select auth.uid()))
  returning id into v_tx;
  insert into public.ledger_entries (transaction_id, account_id, amount_minor) values
    (v_tx, private.seller_payable_account(v_payout.seller_id), v_payout.amount_minor),
    (v_tx, private.ledger_account('bank_operating'), -v_payout.amount_minor);

  update public.payouts
  set status = 'paid', bank_reference = v_reference, paid_at = now(),
      paid_by = (select auth.uid()), ledger_transaction_id = v_tx
  where id = p_payout_id;

  perform private.emit('payout.paid', jsonb_build_object(
    'payout_id', p_payout_id, 'seller_id', v_payout.seller_id,
    'amount_minor', v_payout.amount_minor));
exception
  when unique_violation then
    -- The same bank reference is already recorded on another payout.
    perform private.fail('bank_reference_used');
end;
$$;

-- ═══ 10. Receiving stock ═══════════════════════════════════════════════════

-- Warehouse staff count a line in at the dock and put it away in one step.
-- Unchanged, except that a line takes no more than the seller announced: a
-- double scan or a typo is refused instead of becoming phantom stock. More
-- units than announced go in on a new inbound from the seller.
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
  select l.id, l.sku_id, l.expected_quantity, l.received_quantity, l.damaged_quantity,
         s.id as shipment_id, s.seller_id, s.warehouse_id, s.status
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
  if p_good_quantity is null or p_damaged_quantity is null
     or p_good_quantity < 0 or p_damaged_quantity < 0 or p_good_quantity + p_damaged_quantity = 0 then
    perform private.fail('invalid_quantity');
  end if;
  if v_line.received_quantity + v_line.damaged_quantity >= v_line.expected_quantity then
    perform private.fail('inbound_line_complete');
  end if;
  if v_line.received_quantity + v_line.damaged_quantity + p_good_quantity + p_damaged_quantity
     > v_line.expected_quantity then
    perform private.fail('over_receipt',
      (v_line.expected_quantity - v_line.received_quantity - v_line.damaged_quantity)::text);
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

-- ═══ 11. A price that covers the fees ══════════════════════════════════════

-- What the seller is paid for one unit sold on its own, paid for by the most
-- expensive method, under the active fee schedule. If even that is negative,
-- every sale of the offer books fees the seller can never pay.
create or replace function private.worst_unit_payout(
  p_price_minor bigint,
  p_fulfillment public.fulfillment_type,
  p_category_id uuid,
  p_weight_grams integer,
  p_longest_side_cm numeric
) returns bigint
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_schedule public.fee_schedules%rowtype;
  v_referral bigint;
  v_fulfillment bigint := 0;
  v_payment bigint;
  v_net bigint;
begin
  select * into v_schedule from public.fee_schedules where active;
  if not found then
    return p_price_minor;
  end if;
  v_referral := least(
    greatest(
      round(p_price_minor::numeric
            * coalesce(private.referral_bps_for_category(p_category_id), v_schedule.default_referral_bps)
            / 10000)::bigint,
      v_schedule.min_referral_fee_per_unit_minor),
    p_price_minor);
  if p_fulfillment = 'platform' then
    select coalesce((
      select t.fee_minor from public.fee_fulfillment_tiers t
      where t.schedule_version = v_schedule.version
        and p_weight_grams <= t.max_weight_grams and p_longest_side_cm <= t.max_longest_side_cm
      order by t.sort limit 1), 0)
    into v_fulfillment;
  end if;
  select coalesce(max(round(p_price_minor::numeric * m.bps / 10000)::bigint + m.fixed_minor), 0)
  into v_payment
  from public.fee_payment_methods m where m.schedule_version = v_schedule.version;
  v_net := v_referral + v_fulfillment + v_payment;
  return p_price_minor - v_net - round(v_net::numeric * v_schedule.fee_tax_bps / 10000)::bigint;
end;
$$;

-- On every write of a price or of how the offer is fulfilled, whichever path
-- writes it (seller_update_offer, a listing, or a direct update).
create or replace function private.guard_offer_price() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payout bigint;
begin
  if new.price_minor is null or new.price_minor <= 0 then
    return null; -- the table's own check answers that
  end if;
  select private.worst_unit_payout(new.price_minor, new.fulfillment, p.category_id, k.weight_grams,
                                   greatest(k.length_cm, k.width_cm, k.height_cm))
  into v_payout
  from public.skus k join public.products p on p.id = k.product_id
  where k.id = new.sku_id;
  if v_payout < 0 then
    perform private.fail('price_below_fees', (-v_payout)::text);
  end if;
  return null;
end;
$$;

-- After the row is written, so that the grants, the row-level policies and
-- the table's own checks answer first for a write that was never allowed.
create trigger offers_price_covers_fees after insert or update of price_minor, fulfillment
  on public.offers
  for each row execute function private.guard_offer_price();

-- ═══ Grants ════════════════════════════════════════════════════════════════

revoke all on function
  private.order_collected_minor(uuid),
  private.refunded_minor(uuid),
  private.lock_seller_money(uuid),
  private.refund_units(uuid, text, uuid, jsonb),
  private.return_transition_allowed(text, text),
  private.delivered_units(uuid),
  private.order_returnable(public.orders),
  private.delivery_code_max_attempts(),
  private.new_delivery_code(),
  private.held_units(uuid),
  private.worst_unit_payout(bigint, public.fulfillment_type, uuid, integer, numeric)
from public, anon, authenticated;

revoke all on function
  public.ops_receive_return(uuid, boolean, text),
  public.ops_delivery_code(uuid),
  public.ops_release_delivery_code(uuid, text),
  public.wms_receive_returned_shipment(uuid, boolean, text)
from public, anon;

grant execute on function
  public.ops_receive_return(uuid, boolean, text),
  public.ops_delivery_code(uuid),
  public.ops_release_delivery_code(uuid, text),
  public.wms_receive_returned_shipment(uuid, boolean, text)
to authenticated;
