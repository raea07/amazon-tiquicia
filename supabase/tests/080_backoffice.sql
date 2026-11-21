-- Back-office functions: sellers manage where their stock is, and staff finish
-- the jobs in their queues. Each is checked for the right caller, the wrong
-- caller, and what it leaves behind.

begin;
\ir _helpers.sql

select pg_temp.remember('tecnocasa', (select id::text from public.sellers where slug = 'tecnocasa'));
select pg_temp.remember('depot', (select id::text from public.warehouses where code = 'SJO1'));
select pg_temp.remember('tecno_sku',
  (select o.sku_id::text from public.offers o join public.sellers s on s.id = o.seller_id
   where s.slug = 'tecnocasa' order by o.id limit 1));
-- A delivered line bought by the first shopper, with no return on it yet.
select pg_temp.remember('delivered_item', (
  select i.id::text
  from public.order_items i
  join public.orders o on o.id = i.order_id
  join auth.users u on u.id = o.user_id
  where u.email = 'comprador@yuntera.example' and o.status in ('delivered', 'completed')
    and not exists (select 1 from public.return_requests r where r.order_item_id = i.id)
  order by o.placed_at, i.id limit 1));
select pg_temp.remember('pending_sinpe',
  (select id::text from public.orders where idempotency_key = 'seed-today-e1'));
select pg_temp.remember('card_order',
  (select id::text from public.orders where idempotency_key = 'seed-today-d1'));
select pg_temp.remember('live_product',
  (select id::text from public.products where slug = 'cafe-molido-tarrazu-340g'));
select pg_temp.remember('driver', (select id::text from public.drivers order by full_name limit 1));

-- ── Seller: dispatch locations ─────────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  l jsonb;
  v_id uuid;
begin
  l := public.seller_locations(v_seller);
  assert jsonb_array_length(l -> 'own') = 0, 'TecnoCasa starts with no location of its own';
  assert l #>> '{platform,0,code}' = 'SJO1', 'the Yuntera warehouse is offered for inbound stock';

  v_id := public.seller_save_location(
    v_seller, 'Local San Pedro', 'San Pedro, del Outlet Mall 200 metros norte, local 3', '11501',
    9.9336, -84.0513);
  l := public.seller_locations(v_seller);
  assert jsonb_array_length(l -> 'own') = 1 and l #>> '{own,0,name}' = 'Local San Pedro', 'location saved';
  assert l #>> '{own,0,code}' ~ '^V[A-Z0-9]{9}$', format('generated code: %s', l #>> '{own,0,code}');

  -- The new location can hold the seller's stock straight away.
  perform public.seller_set_stock(v_id, current_setting('t.tecno_sku')::uuid, 7);
  assert (select available from public.seller_stock(v_seller)
          where warehouse_id = v_id and sku_id = current_setting('t.tecno_sku')::uuid) = 7,
    'stock counted at the new location';

  begin
    perform public.seller_save_location(
      v_seller, 'Local Limón', 'Limón centro, frente al parque Vargas, local 2', '70101', 9.99, -83.03);
    raise exception 'location outside the delivery area was accepted';
  exception when others then
    if sqlerrm <> 'zone_not_served' then raise; end if;
  end;
  begin
    perform public.seller_save_location(
      v_seller, 'En el mar', 'Un punto que no está en Costa Rica, de verdad', '11501', 0, 0);
    raise exception 'location outside Costa Rica was accepted';
  exception when others then
    if sqlerrm <> 'invalid_location' then raise; end if;
  end;
  begin
    perform public.seller_save_location(v_seller, 'X', 'corta', '11501', 9.93, -84.05);
    raise exception 'location without a usable address was accepted';
  exception when others then
    if sqlerrm <> 'invalid_location' then raise; end if;
  end;
end
$$;
reset role;

-- ── Seller: stock sent to a Yuntera warehouse ──────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
declare
  v_seller uuid := current_setting('t.tecnocasa')::uuid;
  v_before integer := jsonb_array_length(public.seller_inbounds(v_seller));
  i jsonb;
begin
  perform public.seller_create_inbound(
    current_setting('t.depot')::uuid, v_seller,
    jsonb_build_array(jsonb_build_object('sku_id', current_setting('t.tecno_sku'), 'quantity', 12)),
    current_date + 3);
  i := public.seller_inbounds(v_seller);
  assert jsonb_array_length(i) = v_before + 1, 'the new inbound shipment is listed';
  assert i #>> '{0,reference}' ~ '^IN-[0-9]+$' and i #>> '{0,status}' = 'in_transit', 'newest first';
  assert (i #>> '{0,lines,0,expected}')::integer = 12 and (i #>> '{0,lines,0,received}')::integer = 0,
    'lines show what is expected and what has arrived';
end
$$;
reset role;

-- Another seller sees none of it.
select pg_temp.login('cafetal@yuntera.example');
do $$
declare
  f text;
begin
  foreach f in array array[
    format('select public.seller_locations(%L)', current_setting('t.tecnocasa')),
    format('select public.seller_inbounds(%L)', current_setting('t.tecnocasa')),
    format('select public.seller_save_location(%L, ''Otro local'', ''San Pedro, 100 metros al sur del parque'', ''11501'', 9.93, -84.05)',
           current_setting('t.tecnocasa'))
  ] loop
    begin
      execute f;
      raise exception 'another seller could run: %', f;
    exception when others then
      if sqlerrm <> 'forbidden' then raise; end if;
    end;
  end loop;
end
$$;
reset role;

-- ── Returns: claim, decision, refund ───────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
select set_config('t.return_id', public.request_return(
  current_setting('t.delivered_item')::uuid, 'damaged', 1,
  'La caja llegó abierta y el producto golpeado.')::text, true);

-- The shopper cannot approve their own claim.
do $$
begin
  perform public.ops_decide_return(current_setting('t.return_id')::uuid, true);
  raise exception 'a shopper approved a return';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_return uuid := current_setting('t.return_id')::uuid;
  v_item public.order_items%rowtype;
  v_fees public.seller_order_fees%rowtype;
  v_payable_before bigint;
  v_payable_after bigint;
  v_result jsonb;
  v_expected_commission bigint;
  v_expected_tax bigint;
  q jsonb;
begin
  select * into v_item from public.order_items where id = current_setting('t.delivered_item')::uuid;
  select * into v_fees from public.seller_order_fees
  where order_id = v_item.order_id and seller_id = v_item.seller_id;

  q := public.ops_care_queues();
  assert exists (
    select 1 from jsonb_array_elements(q -> 'returns') r
    where (r ->> 'id')::uuid = v_return and (r ->> 'amount_minor')::bigint = v_item.unit_price_minor
      and r ->> 'customer' is not null
  ), 'the claim is in the queue with its amount and the shopper''s name';

  -- Refunding before a decision is refused.
  begin
    perform public.ops_complete_return(v_return);
    raise exception 'refunded a return nobody approved';
  exception when others then
    if sqlerrm <> 'invalid_return_state' then raise; end if;
  end;
  -- Refusing needs a reason the shopper can read.
  begin
    perform public.ops_decide_return(v_return, false, 'no');
    raise exception 'refused a return without a reason';
  exception when others then
    if sqlerrm <> 'reason_required' then raise; end if;
  end;

  perform public.ops_decide_return(v_return, true, 'Foto recibida; procede el reembolso.');
  assert (select status = 'approved' and refund_due_on is not null and decided_by is not null
          from public.return_requests where id = v_return), 'approved, with a refund deadline';

  select coalesce(-sum(e.amount_minor), 0) into v_payable_before
  from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
  where a.seller_id = v_item.seller_id;

  v_result := public.ops_complete_return(v_return, 'Reembolso enviado por SINPE.');

  v_expected_commission :=
    round(v_fees.referral_fee_minor::numeric * v_item.unit_price_minor / v_fees.items_gross_minor);
  v_expected_tax := round(v_expected_commission * 0.13);
  assert (v_result ->> 'refund_minor')::bigint = v_item.unit_price_minor,
    'the shopper gets back exactly what they paid for the unit';
  assert (v_result ->> 'seller_debit_minor')::bigint
         = v_item.unit_price_minor - v_expected_commission - v_expected_tax,
    format('the seller gives back the sale less the commission returned to them: %s', v_result);

  select coalesce(-sum(e.amount_minor), 0) into v_payable_after
  from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
  where a.seller_id = v_item.seller_id;
  assert v_payable_before - v_payable_after = (v_result ->> 'seller_debit_minor')::bigint,
    'what the platform owes the seller drops by that amount';

  assert (
    select sum(e.amount_minor) = 0 and count(*) >= 3
    from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
    where t.kind = 'return_refund' and t.order_id = v_item.order_id
  ), 'the refund entries balance';
  assert (select status = 'refunded' and refund_minor = v_item.unit_price_minor
          from public.return_requests where id = v_return), 'return closed with the amount recorded';

  -- A refund is paid once.
  begin
    perform public.ops_complete_return(v_return);
    raise exception 'the same return was refunded twice';
  exception when others then
    if sqlerrm <> 'invalid_return_state' then raise; end if;
  end;
  assert not exists (
    select 1 from jsonb_array_elements(public.ops_care_queues() -> 'returns') r
    where (r ->> 'id')::uuid = v_return), 'a refunded return leaves the queue';
end
$$;
reset role;

-- The whole ledger still balances after a partial refund.
do $$
begin
  assert (select coalesce(sum(amount_minor), 0) from public.ledger_entries) = 0, 'ledger sums to zero';
end
$$;

-- ── Complaints ─────────────────────────────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
select set_config('t.complaint',
  public.file_complaint('delivery', 'El repartidor llegó fuera del horario indicado.')::text, true);
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_id uuid := current_setting('t.complaint')::uuid;
begin
  begin
    perform public.ops_resolve_complaint(v_id, 'ok');
    raise exception 'complaint closed without an answer';
  exception when others then
    if sqlerrm <> 'reason_required' then raise; end if;
  end;

  perform public.ops_resolve_complaint(v_id, 'Estamos revisando la ruta con el repartidor.', false);
  assert (select status = 'in_progress' and resolved_at is null from public.complaints where id = v_id),
    'an interim answer keeps the complaint open';

  perform public.ops_resolve_complaint(v_id, 'Le pedimos disculpas; ajustamos el horario de esa ruta.');
  assert (select status = 'resolved' and resolved_at is not null from public.complaints where id = v_id),
    'closed with the final answer';

  begin
    perform public.ops_resolve_complaint(v_id, 'Otra respuesta para un caso ya cerrado.');
    raise exception 'a closed complaint was answered again';
  exception when others then
    if sqlerrm <> 'complaint_not_found' then raise; end if;
  end;
end
$$;
reset role;

-- ── Content reports ────────────────────────────────────────────────────────

select pg_temp.login('comprador2@yuntera.example');
select set_config('t.report_dismiss',
  public.report_content('product', current_setting('t.live_product')::uuid, 'misleading', 'No pesa 340 g.')::text, true);
select set_config('t.report_act',
  public.report_content('product', current_setting('t.live_product')::uuid, 'unsafe', 'Empaque roto.')::text, true);
do $$
begin
  perform public.ops_resolve_report(current_setting('t.report_act')::uuid, true, 'Lo bajo yo mismo, gracias.');
  raise exception 'a shopper took a listing down';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_product uuid := current_setting('t.live_product')::uuid;
  q jsonb := public.ops_care_queues();
begin
  assert exists (
    select 1 from jsonb_array_elements(q -> 'reports') r
    where (r ->> 'id')::uuid = current_setting('t.report_act')::uuid
      and r ->> 'target_label' like 'Café molido%'
  ), 'reports say what was reported';

  perform public.ops_resolve_report(
    current_setting('t.report_dismiss')::uuid, false, 'Verificamos el peso neto: es correcto.');
  assert (select status from public.products where id = v_product) = 'active',
    'dismissing a report leaves the listing alone';

  perform public.ops_resolve_report(
    current_setting('t.report_act')::uuid, true, 'Empaque no apto para alimentos; se retira.');
  assert (select status = 'rejected' and rejection_reason like 'Empaque%'
          from public.products where id = v_product), 'acting on a report takes the listing down, with the reason';
  assert (select status from public.content_reports where id = current_setting('t.report_act')::uuid) = 'actioned'
     and (select status from public.content_reports where id = current_setting('t.report_dismiss')::uuid) = 'dismissed',
    'both reports are closed with their outcome';

  begin
    perform public.ops_resolve_report(current_setting('t.report_act')::uuid, true, 'Otra vez el mismo reporte.');
    raise exception 'a closed report was resolved again';
  exception when others then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
end
$$;
reset role;

-- The listing is gone for shoppers.
select pg_temp.login_anon();
do $$
begin
  assert public.get_product('cafe-molido-tarrazu-340g') is null, 'a listing taken down is no longer shown';
end
$$;
reset role;

-- ── Confirming a bank transfer by hand ─────────────────────────────────────

select pg_temp.login('comprador@yuntera.example');
do $$
begin
  perform public.ops_confirm_payment(current_setting('t.pending_sinpe')::uuid, 'BNCR-000123');
  raise exception 'a shopper confirmed their own payment';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_order uuid := current_setting('t.pending_sinpe')::uuid;
begin
  begin
    perform public.ops_confirm_payment(v_order, 'x');
    raise exception 'confirmed without a bank reference';
  exception when others then
    if sqlerrm <> 'invalid_amount' then raise; end if;
  end;
  -- A card payment is never confirmed by hand.
  begin
    perform public.ops_confirm_payment(current_setting('t.card_order')::uuid, 'BNCR-000999');
    raise exception 'a card order was confirmed by hand';
  exception when others then
    if sqlerrm <> 'order_not_payable' then raise; end if;
  end;

  perform public.ops_confirm_payment(v_order, 'BNCR-000123');
  assert (select status from public.orders where id = v_order) = 'confirmed', 'order released to fulfilment';
  assert (select status = 'captured' and provider_reference = 'manual:BNCR-000123'
          from public.payments where order_id = v_order), 'the bank reference is kept with the payment';
  assert exists (select 1 from public.shipments where order_id = v_order), 'a parcel was created to prepare';

  begin
    perform public.ops_confirm_payment(v_order, 'BNCR-000124');
    raise exception 'the same order was confirmed twice';
  exception when others then
    if sqlerrm <> 'order_not_payable' then raise; end if;
  end;
end
$$;
reset role;

-- ── Drivers ────────────────────────────────────────────────────────────────

select pg_temp.login('vendedor@yuntera.example');
do $$
begin
  perform public.ops_drivers();
  raise exception 'a seller listed the drivers';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end
$$;
reset role;

select pg_temp.login('central@yuntera.example');
do $$
declare
  v_driver uuid := current_setting('t.driver')::uuid;
  d jsonb := public.ops_drivers();
begin
  assert jsonb_array_length(d) = 2, 'both drivers';
  assert d #>> '{0,documents_expired}' is not null, 'expired documents are flagged';
  perform public.ops_set_driver_status(v_driver, 'suspended');
  assert (select status from public.drivers where id = v_driver) = 'suspended', 'driver suspended';
  begin
    perform public.ops_set_driver_status(gen_random_uuid(), 'active');
    raise exception 'changed a driver that does not exist';
  exception when others then
    if sqlerrm <> 'driver_not_available' then raise; end if;
  end;
end
$$;
reset role;

-- A suspended driver is no longer offered on the dispatch board.
select pg_temp.login('central@yuntera.example');
do $$
begin
  assert not exists (
    select 1 from jsonb_array_elements(public.ops_dispatch_board() -> 'drivers') d
    where (d ->> 'id')::uuid = current_setting('t.driver')::uuid
  ), 'a suspended driver cannot be given a route';
end
$$;
reset role;

rollback;
