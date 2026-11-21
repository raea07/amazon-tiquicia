-- Back-office additions: what the seller centre and the internal console need
-- to finish a job rather than only look at it.
--
--   Sellers: their own dispatch locations and the stock they send to a Yuntera
--            warehouse.
--   Staff:   decide and refund returns, answer complaints, act on content
--            reports, confirm a bank transfer by hand, manage drivers.
--
-- Same rules as every other function here: SECURITY DEFINER with an empty
-- search_path, an explicit permission check first, errors as short codes.

-- ═══ Seller: dispatch locations ════════════════════════════════════════════

-- Where a seller can keep stock: their own locations, and the Yuntera
-- warehouses that accept stock from sellers.
create or replace function public.seller_locations(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('ops', 'support')) then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'own', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'code', w.code, 'name', w.name, 'address', w.address,
        'postal_code', w.postal_code, 'active', w.active) order by w.created_at)
      from public.warehouses w where w.seller_id = p_seller_id), '[]'::jsonb),
    'platform', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'code', w.code, 'name', w.name, 'address', w.address) order by w.code)
      from public.warehouses w where w.kind = 'platform' and w.active), '[]'::jsonb)
  );
end;
$$;

-- A seller registers the place our drivers collect their parcels from.
create or replace function public.seller_save_location(
  p_seller_id uuid,
  p_name text,
  p_address text,
  p_postal_code text,
  p_lat double precision,
  p_lng double precision
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_seller_admin(p_seller_id) then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_name)), 0) not between 3 and 80
     or coalesce(char_length(trim(p_address)), 0) not between 15 and 500
     or p_lat is null or p_lng is null then
    perform private.fail('invalid_location');
  end if;
  -- Our drivers collect from this point, so it has to be where they work.
  if not exists (
    select 1
    from public.districts d
    join public.cantons c on c.code = d.canton_code
    join public.delivery_zones z on z.id = coalesce(d.zone_id, c.zone_id)
    where d.postal_code = p_postal_code and z.active
  ) then
    perform private.fail('zone_not_served');
  end if;
  if (select count(*) from public.warehouses w where w.seller_id = p_seller_id) >= 5 then
    perform private.fail('too_many_locations');
  end if;

  insert into public.warehouses (code, name, kind, seller_id, address, postal_code, lat, lng)
  values ('V' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)),
          trim(p_name), 'seller', p_seller_id, trim(p_address), p_postal_code, p_lat, p_lng)
  returning id into v_id;
  return v_id;
exception
  when check_violation then
    -- The point is outside Costa Rica.
    perform private.fail('invalid_location');
end;
$$;

-- Stock a seller has announced or sent to a Yuntera warehouse, newest first.
create or replace function public.seller_inbounds(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('ops', 'support')) then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select ib.id as inbound_id, ib.reference, ib.status, ib.expected_on, ib.created_at,
             ib.received_at, w.name as warehouse_name,
             (select jsonb_agg(jsonb_build_object(
                'sku_code', k.code, 'title', p.title, 'variant_name', k.variant_name,
                'expected', l.expected_quantity, 'received', l.received_quantity,
                'damaged', l.damaged_quantity) order by p.title)
              from public.inbound_shipment_lines l
              join public.skus k on k.id = l.sku_id
              join public.products p on p.id = k.product_id
              where l.inbound_shipment_id = ib.id) as lines
      from public.inbound_shipments ib
      join public.warehouses w on w.id = ib.warehouse_id
      where ib.seller_id = p_seller_id
      order by ib.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ═══ Staff: returns and refunds ════════════════════════════════════════════

alter table public.ledger_transactions drop constraint ledger_transactions_kind_check;
alter table public.ledger_transactions add constraint ledger_transactions_kind_check
  check (kind in ('order_capture', 'order_refund', 'return_refund', 'payout',
                  'cash_settlement', 'adjustment'));

alter table public.return_requests
  add column refund_minor bigint check (refund_minor > 0),
  add column decided_by uuid references auth.users (id),
  add column refunded_by uuid references auth.users (id);

-- Staff accept or refuse a claim (damaged, wrong item, warranty). A withdrawal
-- inside the legal window never comes here: it is approved the moment it is made.
create or replace function public.ops_decide_return(
  p_return_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not private.has_staff_role('support', 'ops') then
    perform private.fail('forbidden');
  end if;
  select status into v_status from public.return_requests where id = p_return_id for update;
  if not found then
    perform private.fail('return_not_found');
  end if;
  if v_status <> 'requested' then
    perform private.fail('invalid_return_state', v_status);
  end if;
  -- A refusal has to be explained: the shopper is told why.
  if not p_approve and coalesce(char_length(trim(p_note)), 0) < 10 then
    perform private.fail('reason_required');
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

-- Staff record that an approved return has been refunded.
--
-- The shopper gets back what they paid for the returned units. The seller gives
-- back what they were paid for them; the platform gives back its commission on
-- them (and the IVA on that commission). The costs of collecting the payment and
-- of the warehouse work already done are not returned to the seller — those
-- services were provided. The entries below always sum to zero.
create or replace function public.ops_complete_return(
  p_return_id uuid,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_return public.return_requests%rowtype;
  v_item public.order_items%rowtype;
  v_fees public.seller_order_fees%rowtype;
  v_number text;
  v_refund bigint;
  v_commission bigint;
  v_commission_tax bigint;
  v_tax_bps integer;
  v_tx uuid;
begin
  if not private.has_staff_role('finance', 'support') then
    perform private.fail('forbidden');
  end if;
  select * into v_return from public.return_requests where id = p_return_id for update;
  if not found then
    perform private.fail('return_not_found');
  end if;
  if v_return.status not in ('approved', 'received') then
    perform private.fail('invalid_return_state', v_return.status);
  end if;

  select * into v_item from public.order_items where id = v_return.order_item_id;
  select * into v_fees from public.seller_order_fees
  where order_id = v_item.order_id and seller_id = v_item.seller_id;
  if not found then
    -- Nothing was ever collected for this order, so there is nothing to refund.
    perform private.fail('order_not_payable');
  end if;
  select order_number into v_number from public.orders where id = v_item.order_id;

  v_refund := v_item.unit_price_minor * v_return.quantity;
  -- The commission on the returned units, in proportion to the seller's sale.
  v_commission := round(v_fees.referral_fee_minor::numeric * v_refund / v_fees.items_gross_minor)::bigint;
  select s.fee_tax_bps into v_tax_bps from public.fee_schedules s where s.version = v_fees.schedule_version;
  v_commission_tax := round(v_commission::numeric * v_tax_bps / 10000)::bigint;

  insert into public.ledger_transactions (kind, order_id, memo, created_by)
  values ('return_refund', v_item.order_id,
          'Devolución en el pedido ' || v_number || ': ' || v_item.title, (select auth.uid()))
  returning id into v_tx;

  insert into public.ledger_entries (transaction_id, account_id, amount_minor)
  select v_tx, x.account_id, x.amount
  from (values
    (private.seller_payable_account(v_item.seller_id), v_refund - v_commission - v_commission_tax),
    (private.ledger_account('commission_revenue'), v_commission),
    (private.ledger_account('iva_payable'), v_commission_tax),
    (private.ledger_account('refunds_payable'), -v_refund)
  ) as x (account_id, amount)
  where x.amount <> 0;

  update public.return_requests
  set status = 'refunded', refund_minor = v_refund, refunded_by = (select auth.uid()),
      resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note), resolved_at = now()
  where id = p_return_id;

  insert into public.order_events (order_id, kind, to_status, note, actor_id)
  values (v_item.order_id, 'note', null,
          'Reembolso de ' || v_return.quantity || ' × ' || v_item.title, (select auth.uid()));

  -- The money itself moves outside the database (gateway refund or transfer).
  perform private.emit('refund.requested', jsonb_build_object(
    'order_id', v_item.order_id, 'return_request_id', p_return_id, 'amount_minor', v_refund));

  return jsonb_build_object('refund_minor', v_refund, 'seller_debit_minor',
                            v_refund - v_commission - v_commission_tax);
end;
$$;

-- ═══ Staff: complaints and content reports ═════════════════════════════════

create or replace function public.ops_resolve_complaint(
  p_complaint_id uuid,
  p_resolution text,
  p_close boolean default true
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('support', 'ops') then
    perform private.fail('forbidden');
  end if;
  -- The answer is sent to the person who complained, so it cannot be empty.
  if coalesce(char_length(trim(p_resolution)), 0) < 10 then
    perform private.fail('reason_required');
  end if;

  update public.complaints
  set status = case when p_close then 'resolved' else 'in_progress' end,
      resolution = trim(p_resolution),
      resolved_at = case when p_close then now() end
  where id = p_complaint_id and status <> 'resolved';
  if not found then
    perform private.fail('complaint_not_found');
  end if;

  perform private.emit('complaint.answered',
    jsonb_build_object('complaint_id', p_complaint_id, 'closed', p_close));
end;
$$;

-- Notice and action: staff either act on a report (and, for a listing, take it
-- down in the same step) or dismiss it. Both need a written reason.
create or replace function public.ops_resolve_report(
  p_report_id uuid,
  p_action boolean,
  p_resolution text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_report public.content_reports%rowtype;
begin
  if not private.has_staff_role('catalog', 'support', 'ops') then
    perform private.fail('forbidden');
  end if;
  if coalesce(char_length(trim(p_resolution)), 0) < 10 then
    perform private.fail('reason_required');
  end if;
  select * into v_report from public.content_reports where id = p_report_id for update;
  if not found or v_report.status not in ('open', 'in_review') then
    perform private.fail('report_not_found');
  end if;

  if p_action and v_report.target_type = 'product' then
    update public.products
    set status = 'rejected', rejection_reason = trim(p_resolution)
    where id = v_report.target_id and status in ('active', 'pending_review');
  elsif p_action and v_report.target_type = 'review' then
    update public.reviews
    set status = 'rejected', moderation_note = trim(p_resolution)
    where id = v_report.target_id;
  end if;
  -- A reported seller is handled with ops_set_seller_status, which has its own rules.

  update public.content_reports
  set status = case when p_action then 'actioned' else 'dismissed' end::public.report_status,
      resolution = trim(p_resolution), resolved_by = (select auth.uid()), resolved_at = now()
  where id = p_report_id;

  perform private.emit('report.resolved',
    jsonb_build_object('report_id', p_report_id, 'actioned', p_action));
end;
$$;

-- ═══ Staff: payments ═══════════════════════════════════════════════════════

-- Finance confirms by hand that a transfer arrived (SINPE Móvil or bank
-- transfer), quoting the bank's own reference so the payment can be traced. This
-- is the manual path for the first months; a gateway integration replaces it by
-- calling the same internal function from a webhook.
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

  select o.status into v_status from public.orders o where o.id = p_order_id;
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

-- ═══ Staff: drivers ════════════════════════════════════════════════════════

create or replace function public.ops_drivers() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'full_name', d.full_name, 'phone', d.phone, 'status', d.status,
      'vehicle_type', d.vehicle_type, 'plate', d.plate, 'capacity_kg', d.capacity_kg,
      'license_expires_on', d.license_expires_on,
      'inspection_expires_on', d.inspection_expires_on,
      'insurance_expires_on', d.insurance_expires_on,
      -- True when a document the operation must keep current has lapsed.
      'documents_expired', coalesce(
        least(d.license_expires_on, d.inspection_expires_on, d.insurance_expires_on)
          < private.cr_local(now())::date, false)
    ) order by d.status, d.full_name)
    from public.drivers d
  ), '[]'::jsonb);
end;
$$;

create or replace function public.ops_set_driver_status(
  p_driver_id uuid,
  p_status public.driver_status
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  update public.drivers set status = p_status where id = p_driver_id;
  if not found then
    perform private.fail('driver_not_available');
  end if;
end;
$$;

-- ═══ Care queues, with what staff need to act ══════════════════════════════
-- Replaces the first version: returns now carry the amount and the shopper's
-- name, and approved returns waiting for their refund stay in the queue until
-- the money has gone back.

create or replace function public.ops_care_queues() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('support', 'ops', 'finance', 'catalog') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category', c.category, 'description', c.description, 'status', c.status,
        'created_at', c.created_at, 'order_number', o.order_number, 'customer', pr.full_name
      ) order by c.created_at)
      from public.complaints c
      left join public.orders o on o.id = c.order_id
      left join public.profiles pr on pr.id = c.user_id
      where c.status <> 'resolved'), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'quantity', r.quantity, 'reason', r.reason,
        'status', r.status, 'refund_due_on', r.refund_due_on, 'created_at', r.created_at,
        'title', i.title, 'order_number', o.order_number, 'seller_name', s.trade_name,
        'customer', pr.full_name, 'amount_minor', i.unit_price_minor * r.quantity
      ) order by r.refund_due_on nulls last, r.created_at)
      from public.return_requests r
      join public.order_items i on i.id = r.order_item_id
      join public.orders o on o.id = i.order_id
      left join public.sellers s on s.id = i.seller_id
      left join public.profiles pr on pr.id = r.user_id
      where r.status in ('requested', 'approved', 'received')), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cr.id, 'target_type', cr.target_type, 'target_id', cr.target_id,
        'reason', cr.reason, 'details', cr.details, 'status', cr.status,
        'created_at', cr.created_at,
        'target_label', case cr.target_type
          when 'product' then (select p.title from public.products p where p.id = cr.target_id)
          when 'seller' then (select s.trade_name from public.sellers s where s.id = cr.target_id)
          when 'review' then (select left(rv.body, 120) from public.reviews rv where rv.id = cr.target_id)
        end
      ) order by cr.created_at)
      from public.content_reports cr where cr.status in ('open', 'in_review')), '[]'::jsonb)
  );
end;
$$;

-- ═══ Grants ════════════════════════════════════════════════════════════════
-- New functions are closed to everyone by default (see the foundation
-- migration); each is opened to signed-in users here and checks the caller's
-- role itself.

grant execute on function
  public.seller_locations(uuid),
  public.seller_save_location(uuid, text, text, text, double precision, double precision),
  public.seller_inbounds(uuid),
  public.ops_decide_return(uuid, boolean, text),
  public.ops_complete_return(uuid, text),
  public.ops_resolve_complaint(uuid, text, boolean),
  public.ops_resolve_report(uuid, boolean, text),
  public.ops_confirm_payment(uuid, text),
  public.ops_drivers(),
  public.ops_set_driver_status(uuid, public.driver_status)
to authenticated;
