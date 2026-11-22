-- Electronic invoices for Hacienda (comprobantes electrónicos, version 4.4).
--
-- The data model (public.electronic_invoices) and the events existed; nothing
-- produced a document. This migration makes the platform issue its own
-- documents, following docs/research/hacienda-factura-electronica-v44.md
-- (section 8, and the corrections at its end):
--
--   * to the shopper, for the delivery fee: a tiquete (04), or a factura (01)
--     when the shopper asked at checkout for one in their name;
--   * to each seller, for the platform's commission, warehouse and payment
--     fees on an order: a factura (01) (the receiver's identification is
--     mandatory in a factura, and a seller needs it for its IVA credit);
--   * credit notes (03) when those are reversed: in full when a paid order is
--     cancelled, and for the commission given back when goods are returned.
--
-- Sellers issue their own documents for the goods, with their own systems,
-- as the note recommends for a marketplace (8.1): nothing here signs or sends
-- in a seller's name. Who issues the delivery fee's document is a setting
-- (`invoicing_policy.delivery_fee_issuer`), because the note leaves that to
-- the accountant; the default is the platform, its safest reading.
--
-- How it runs, in the same pattern as the notifications (082600):
--
--   1. Routing. 'payment.captured' and a new 'fiscal.refund_booked' (emitted
--      by a trigger on the refund register) get an 'invoice' job each.
--   2. Planning. private.invoice_plan turns each job into its documents,
--      exactly once (a unique key per thing documented), numbering each in
--      the same transaction from a counter row it locks, so numbers are
--      consecutive with no gaps and never repeat, also with two planners at
--      once. Amounts come from the order and the fee statement in céntimos,
--      converted with the annex's rounding (five decimals, half up).
--   3. The worker (packages/invoicing, run as the Edge Function
--      invoice-worker with its own secret key) claims documents with a
--      lease, builds and checks the XML, signs it, stores the signed XML here
--      once, sends it, polls for Hacienda's answer and records it. It calls
--      only the worker_invoice_* functions, granted to the service_role alone.
--   4. People read their own documents through functions: the shopper the
--      documents of their order made out to them, a seller's team the
--      documents made out to the shop, finance everything. Nobody else.
--
-- Same rules as every other function: owner's rights, an empty search_path,
-- the caller checked first, errors as short codes, nothing callable until
-- granted below. Tested by supabase/tests/140_invoicing.sql and
-- packages/db/src/contract.invoicing.test.ts.

-- ═══ 1. Settings ═══════════════════════════════════════════════════════════
-- The platform's fiscal identity starts as Hacienda's own fictitious example
-- (3101123456) and `ready: false`: nothing is numbered until the owner puts
-- the company's real registration here and sets `ready` to true
-- (docs/06-operations/invoicing.md). The local seed turns it on for the demo.

insert into public.app_settings (key, value, description) values
  ('invoicing_issuer', jsonb_build_object(
     'ready', false,
     'name', 'EJEMPLO PLATAFORMA SOCIEDAD ANONIMA',
     'commercial_name', 'Yuntera',
     'id_type', '02',
     'id_number', '3101123456',
     'provider_id', '3101123456',
     'activity_code', '532000',
     'province', 1, 'canton', 1, 'district', 1,
     'other_signs', 'Direccion exacta del domicilio fiscal',
     'emails', jsonb_build_array('facturacion@yuntera.example'),
     'establishment', 1,
     'terminal', 1),
   'The platform''s fiscal identity on its electronic invoices (Hacienda v4.4). Placeholder values until '
   'the company is registered: set the real ones and ready=true (docs/06-operations/invoicing.md).'),
  ('invoicing_policy', jsonb_build_object(
     'delivery_fee_issuer', 'platform',
     'fee_invoice_timing', 'per_order',
     'cabys', jsonb_build_object(
       'delivery', '6803000000000',
       'commission', '6254400000000',
       'fulfillment', '6729000000000',
       'payment', '7119002009900'),
     'fee_sale_condition', '01',
     'fee_payment_code', '99',
     'fee_payment_other', 'Compensación contra la liquidación de ventas',
     'credit_code_cancel', '01',
     'credit_code_return', '06',
     'answer_window_hours', 3,
     'retention_years', 10),
   'Choices the accountant must confirm (research note section 10): who issues the delivery fee''s document '
   '(platform | seller_third_party), fee invoices per order, CABYS codes for the platform''s own services, '
   'how fees netted from a payout are coded, the reference codes of credit notes, and the retention period.')
on conflict (key) do nothing;

-- ═══ 2. The documents ══════════════════════════════════════════════════════

-- The April 2026 schemas allow letters in the clave (new legal entities may
-- get alphanumeric identifications); the first cut allowed digits only
-- (research note 9.4).
alter table public.electronic_invoices drop constraint if exists electronic_invoices_clave_check;
alter table public.electronic_invoices
  add constraint electronic_invoices_clave_check check (clave ~ '^[A-Za-z0-9]{50}$');

alter table public.electronic_invoices
  -- What it documents: 'delivery' (to the shopper), 'fees' (to a seller),
  -- 'credit' (a credit note reversing one of those). A replacement of a
  -- rejected document keeps the kind of the one it replaces.
  add column kind text check (kind in ('delivery', 'fees', 'credit')),
  -- One thing documented, one row: what makes planning happen exactly once.
  add column dedupe_key text unique,
  add column source_event_id bigint,
  add column receiver_kind text check (receiver_kind in ('shopper', 'seller')),
  add column receiver_seller_id uuid references public.sellers (id),
  add column refund_id uuid references private.refunds (id),
  -- The document a credit note reverses, and the rejected one a replacement replaces.
  add column original_invoice_id uuid references public.electronic_invoices (id),
  add column replaces_id uuid unique references public.electronic_invoices (id),
  add column replaced_by_id uuid unique references public.electronic_invoices (id),
  -- Numbering (research note 3.2 and 3.3).
  add column establishment smallint check (establishment between 1 and 999),
  add column terminal integer check (terminal between 1 and 99999),
  add column sequence_number bigint check (sequence_number between 1 and 9999999999),
  add column situation char(1) check (situation in ('1', '2', '3')),
  add column security_code text check (security_code ~ '^[0-9]{8}$'),
  add column schema_version text not null default '4.4',
  -- The instant written to FechaEmision and the clave's date.
  add column issued_at timestamptz,
  -- Snapshots at issue time: what the XML says, forever.
  add column issuer jsonb,
  add column receiver jsonb,
  add column sale_condition text,
  add column payments jsonb,
  add column lines jsonb,
  add column summary jsonb,
  add column refs jsonb not null default '[]',
  -- The signed XML and Hacienda's answer live in private.electronic_invoice_files.
  add column signed_sha256 text,
  add column signed_at timestamptz,
  add column response_sha256 text,
  -- When the receiver could download it (research note 5.7: before Hacienda answers).
  add column made_available_at timestamptz,
  -- Transmission.
  add column attempts integer not null default 0,
  add column submit_attempts integer not null default 0,
  add column next_attempt_at timestamptz,
  add column locked_by text,
  add column locked_until timestamptz,
  add column submitted_at timestamptz,
  add column last_http_status integer,
  add column last_error_code text,
  add column last_error text,
  add column hacienda_state text
    check (hacienda_state in ('recibido', 'procesando', 'aceptado', 'rechazado', 'error')),
  add column poll_count integer not null default 0,
  add column last_polled_at timestamptz,
  add column answered_at timestamptz,
  add column rejected_at timestamptz,
  add column rejection_source text check (rejection_source in ('reception', 'validation')),
  -- Stopped for staff: the document did not pass the worker's checks.
  add column held_reason text,
  add column voided_at timestamptz;

create index electronic_invoices_receiver_seller_idx
  on public.electronic_invoices (receiver_seller_id, issued_at desc);
create index electronic_invoices_due_idx on public.electronic_invoices (next_attempt_at)
  where status in ('pending', 'sent');
create index electronic_invoices_issued_idx on public.electronic_invoices (issued_at desc);

-- Each counter: one per issuer, establishment, terminal and document type.
-- A document's number is taken from its row, locked, in the transaction that
-- inserts the document: a rollback gives the number back, a commit uses it,
-- and a second transaction waits its turn.
create table private.fiscal_counters (
  issuer_id text not null,
  establishment smallint not null,
  terminal integer not null,
  document_type text not null,
  last_number bigint not null default 0 check (last_number between 0 and 9999999999),
  updated_at timestamptz not null default now(),
  primary key (issuer_id, establishment, terminal, document_type)
);

-- The signed XML ({clave}.xml) and Hacienda's answer ({clave}_respuesta.xml),
-- kept for the retention period (5 years by law, 10 by the default setting).
-- Here and not in storage: a signed document is about 8 KB and an answer
-- about 3 KB, compressed by PostgreSQL; kept in the same transaction as the
-- document's state, with the database's backups, and unchangeable once written.
create table private.electronic_invoice_files (
  invoice_id uuid not null references public.electronic_invoices (id),
  kind text not null check (kind in ('signed', 'response')),
  file_name text not null,
  content text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (invoice_id, kind)
);

create trigger electronic_invoice_files_immutable before update or delete
  on private.electronic_invoice_files
  for each row execute function private.forbid_change();

-- What a shopper typed at checkout to have the delivery fee's document as a
-- factura in their name, keyed by the order's idempotency key until the
-- order exists and is paid. Used once, when the document is made, and then deleted.
create table private.invoice_checkout_receivers (
  user_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  id_type public.identification_type not null,
  id_number text not null,
  name text not null check (char_length(name) between 3 and 100),
  email text check (email is null or char_length(email) <= 160),
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

-- Deleting an account (delete_my_account stamps auth.users.deleted_at)
-- erases what the person typed for a factura that was never issued. The
-- documents already issued in their name stay: the law keeps them (RCE art.
-- 4.1.i, 22; CNPT art. 109), as it keeps the orders and the ledger.
create or replace function private.invoice_forget_receiver() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from private.invoice_checkout_receivers where user_id = new.id;
  end if;
  return null;
end;
$$;

create trigger invoice_forget_receiver after update of deleted_at on auth.users
  for each row execute function private.invoice_forget_receiver();

-- What the worker last said about itself: when it ran, and its certificate's expiry.
create table private.invoice_worker_health (
  id boolean primary key default true check (id),
  reported_at timestamptz not null default now(),
  environment text,
  certificate_subject text,
  certificate_issuer text,
  certificate_not_after timestamptz,
  error text
);

-- A configuration error (a gateway 403, refused credentials) pauses every send.
create table private.invoice_transmission_pause (
  id boolean primary key default true check (id),
  paused_until timestamptz not null,
  reason text not null
);

alter table private.fiscal_counters enable row level security;
alter table private.electronic_invoice_files enable row level security;
alter table private.invoice_checkout_receivers enable row level security;
alter table private.invoice_worker_health enable row level security;
alter table private.invoice_transmission_pause enable row level security;
revoke all on private.fiscal_counters, private.electronic_invoice_files,
  private.invoice_checkout_receivers, private.invoice_worker_health,
  private.invoice_transmission_pause from public, anon, authenticated;

-- The second lock on the document table (no API role holds any privilege on
-- it): the shopper only what is made out to them, a shop's team what is made
-- out to the shop or issued by it, finance everything. A shopper never sees
-- the platform's invoices to the sellers of their order.
alter policy "buyer, issuer or finance" on public.electronic_invoices
  using ((select private.has_staff_role('finance'))
         or (electronic_invoices.issuer_seller_id is not null
             and (select private.is_seller_member(electronic_invoices.issuer_seller_id)))
         or (electronic_invoices.receiver_seller_id is not null
             and (select private.is_seller_member(electronic_invoices.receiver_seller_id)))
         or (electronic_invoices.receiver_kind = 'shopper'
             and (select private.owns_order(electronic_invoices.order_id))));

-- ═══ 3. Arithmetic and keys ════════════════════════════════════════════════
-- The same rules as packages/invoicing (amounts.ts, key.ts), checked against
-- the same worked examples on both sides.

-- Five decimals, as the XML writes them.
create or replace function private.invoice_amount(p_value numeric) returns text
language sql immutable
set search_path = ''
as $$
  select round(p_value, 5)::text;
$$;

-- IVA rate in basis points for each rate code (nota 8.1).
create or replace function private.invoice_rate_bps(p_code text) returns integer
language sql immutable
set search_path = ''
as $$
  select case p_code
    when '01' then 0 when '02' then 100 when '03' then 200 when '04' then 400
    when '08' then 1300 when '09' then 50 when '10' then 0 when '11' then 0 end;
$$;

create or replace function private.invoice_rate_text(p_code text) returns text
language sql immutable
set search_path = ''
as $$
  select case p_code
    when '02' then '1.00' when '03' then '2.00' when '04' then '4.00'
    when '08' then '13.00' when '09' then '0.50' else '0.00' end;
$$;

-- The net inside an IVA-inclusive amount of céntimos: gross ÷ (1 + rate), to
-- five decimals, half up (₡2 500 → 2212.38938).
create or replace function private.invoice_net_of_gross(p_gross_minor bigint, p_bps integer) returns numeric
language sql immutable
set search_path = ''
as $$
  select round(p_gross_minor::numeric * 100 / (10000 + p_bps), 5);
$$;

-- One line of DetalleServicio, priced before IVA, quantity 1 (Yuntera's own services).
create or replace function private.invoice_line(
  p_number integer, p_cabys text, p_unit text, p_description text, p_net numeric, p_tarifa text
) returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_net numeric := round(p_net, 5);
  v_tax numeric := round(round(p_net, 5) * private.invoice_rate_bps(p_tarifa) / 10000, 5);
begin
  return jsonb_build_object(
    'number', p_number,
    'cabys', p_cabys,
    'quantity', '1.000',
    'unit', p_unit,
    'description', left(p_description, 200),
    'unit_price', private.invoice_amount(v_net),
    'total', private.invoice_amount(v_net),
    'subtotal', private.invoice_amount(v_net),
    'base', private.invoice_amount(v_net),
    'tax', jsonb_build_object('code', '01', 'tarifa_code', p_tarifa,
                              'rate', private.invoice_rate_text(p_tarifa),
                              'amount', private.invoice_amount(v_tax)),
    'net_tax', private.invoice_amount(v_tax),
    'line_total', private.invoice_amount(v_net + v_tax));
end;
$$;

-- ResumenFactura from the lines (ANX pp. 50–56): services are CABYS codes
-- starting 5–9, goods 0–4; totals that do not apply are null (left out).
-- packages/invoicing/src/document.ts summarize() is the same, and the worker
-- refuses a document whose stored totals differ from its own.
create or replace function private.invoice_summary(p_lines jsonb) returns jsonb
language sql immutable
set search_path = ''
as $$
  with l as (
    select (x ->> 'number')::integer as n,
           (x ->> 'total')::numeric as total,
           x -> 'tax' ->> 'code' as code,
           x -> 'tax' ->> 'tarifa_code' as tarifa,
           (x -> 'tax' ->> 'amount')::numeric as tax,
           (x ->> 'net_tax')::numeric as net_tax,
           case when x -> 'tax' ->> 'tarifa_code' = '10' then 'exempt'
                when x -> 'tax' ->> 'tarifa_code' in ('01', '11') then 'not_subject'
                else 'taxed' end as class,
           left(x ->> 'cabys', 1) between '5' and '9' as service
    from jsonb_array_elements(p_lines) x
  ),
  part as (
    select service, class, sum(total) as total from l group by service, class
  )
  select jsonb_build_object(
    'services_taxed', (select private.invoice_amount(total) from part where service and class = 'taxed'),
    'services_exempt', (select private.invoice_amount(total) from part where service and class = 'exempt'),
    'services_not_subject', (select private.invoice_amount(total) from part where service and class = 'not_subject'),
    'goods_taxed', (select private.invoice_amount(total) from part where not service and class = 'taxed'),
    'goods_exempt', (select private.invoice_amount(total) from part where not service and class = 'exempt'),
    'goods_not_subject', (select private.invoice_amount(total) from part where not service and class = 'not_subject'),
    'total_taxed', (select private.invoice_amount(sum(total)) from part where class = 'taxed' having count(*) > 0),
    'total_exempt', (select private.invoice_amount(sum(total)) from part where class = 'exempt' having count(*) > 0),
    'total_not_subject', (select private.invoice_amount(sum(total)) from part where class = 'not_subject' having count(*) > 0),
    'total_sale', (select private.invoice_amount(coalesce(sum(total), 0)) from l),
    'total_net', (select private.invoice_amount(coalesce(sum(total), 0)) from l),
    'breakdown', case when exists (select 1 from l where tax > 0) then coalesce((
        select jsonb_agg(jsonb_build_object('code', b.code, 'tarifa_code', b.tarifa,
                                            'amount', private.invoice_amount(b.tax)) order by b.first)
        from (select code, tarifa, sum(tax) as tax, min(n) as first from l group by code, tarifa
              having sum(tax) > 0) b), '[]') else '[]' end,
    'total_tax', case when exists (select 1 from l where tax > 0)
                      then (select private.invoice_amount(sum(net_tax)) from l) end,
    'total', (select private.invoice_amount(coalesce(sum(total), 0) + coalesce(sum(net_tax), 0)) from l));
$$;

-- The 20-digit consecutive number: establishment (3), terminal (5), type (2), sequence (10).
create or replace function private.invoice_consecutivo(
  p_establishment integer, p_terminal integer, p_type text, p_sequence bigint
) returns text
language sql immutable
set search_path = ''
as $$
  select lpad(p_establishment::text, 3, '0') || lpad(p_terminal::text, 5, '0') || p_type
         || lpad(p_sequence::text, 10, '0');
$$;

-- The 50-character clave: 506, the Costa Rica date (UTC−6, no daylight
-- saving) as DDMMYY, the issuer's identification padded to 12, the
-- consecutive number, the situation, the security code.
create or replace function private.invoice_clave(
  p_issued_at timestamptz, p_identification text, p_consecutivo text, p_situation text, p_security text
) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text := '506' || to_char((p_issued_at at time zone 'UTC') - interval '6 hours', 'DDMMYY')
                || lpad(p_identification, 12, '0') || p_consecutivo || p_situation || p_security;
begin
  if v_key !~ '^[A-Za-z0-9]{50}$' then
    perform private.fail('invoice_clave_invalid');
  end if;
  return v_key;
end;
$$;

-- Eight digits from the database's strong random source.
create or replace function private.invoice_security_code() returns text
language sql volatile security definer
set search_path = ''
as $$
  select lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 100000000)::text,
              8, '0');
$$;

-- The next number of a counter. The row stays locked until the caller's
-- transaction ends; after 9 999 999 999 the sequence starts again at 1 (nota 3).
create or replace function private.invoice_next_number(
  p_issuer text, p_establishment integer, p_terminal integer, p_type text
) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_number bigint;
begin
  insert into private.fiscal_counters (issuer_id, establishment, terminal, document_type)
  values (p_issuer, p_establishment, p_terminal, p_type)
  on conflict do nothing;
  update private.fiscal_counters
  set last_number = case when last_number >= 9999999999 then 1 else last_number + 1 end,
      updated_at = now()
  where issuer_id = p_issuer and establishment = p_establishment and terminal = p_terminal
    and document_type = p_type
  returning last_number into v_number;
  return v_number;
end;
$$;

-- ═══ 4. Who the documents are from and to ══════════════════════════════════

create or replace function private.invoice_policy() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.setting('invoicing_policy'), '{}'::jsonb);
$$;

-- The platform as issuer, from the settings, as the XML writes it. Refuses
-- until the owner has put the real registration in and set ready = true.
create or replace function private.invoice_issuer() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s jsonb := coalesce(private.setting('invoicing_issuer'), '{}'::jsonb);
begin
  if coalesce((s ->> 'ready')::boolean, false) is not true then
    perform private.fail('invoice_issuer_not_ready');
  end if;
  if coalesce(s ->> 'id_number', '') !~ '^[A-Za-z0-9]{9,12}$'
     or coalesce(s ->> 'id_type', '') !~ '^0[1-4]$'
     or coalesce(s ->> 'activity_code', '') !~ '^[0-9]{6}$'
     or char_length(coalesce(s ->> 'name', '')) < 5
     or jsonb_typeof(s -> 'emails') <> 'array' or jsonb_array_length(s -> 'emails') not between 1 and 4 then
    perform private.fail('invoice_issuer_not_ready');
  end if;
  return jsonb_build_object(
    'name', s ->> 'name',
    'commercial_name', s ->> 'commercial_name',
    'id_type', s ->> 'id_type',
    'id_number', s ->> 'id_number',
    'activity_code', s ->> 'activity_code',
    'location', jsonb_build_object('province', (s ->> 'province')::integer,
                                   'canton', (s ->> 'canton')::integer,
                                   'district', (s ->> 'district')::integer,
                                   'other_signs', s ->> 'other_signs'),
    'emails', s -> 'emails',
    'phone', null,
    'provider_id', coalesce(nullif(s ->> 'provider_id', ''), s ->> 'id_number'),
    'establishment', coalesce((s ->> 'establishment')::integer, 1),
    'terminal', coalesce((s ->> 'terminal')::integer, 1));
end;
$$;

create or replace function private.invoice_id_code(p_type public.identification_type) returns text
language sql immutable
set search_path = ''
as $$
  select case p_type when 'fisica' then '01' when 'juridica' then '02' when 'dimex' then '03'
                     when 'nite' then '04' end;
$$;

-- The shape each identification type must have (packages/core/src/cr/identity.ts).
create or replace function private.invoice_id_valid(p_type public.identification_type, p_number text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_type
    when 'fisica' then p_number ~ '^[1-9][0-9]{8}$'
    when 'juridica' then p_number ~ '^[2-5][0-9]{9}$'
    when 'dimex' then p_number ~ '^[1-9][0-9]{10,11}$'
    when 'nite' then p_number ~ '^[0-9]{10}$'
    else false end;
$$;

-- A seller as the receiver of the platform's factura: its registered legal
-- name and identification, and its contact e-mail. Refuses when the shop's
-- details cannot make a valid receiver.
create or replace function private.invoice_seller_receiver(p_seller_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  p public.seller_private;
begin
  select * into p from public.seller_private where seller_id = p_seller_id;
  if not found or char_length(trim(p.legal_name)) < 3 or p.id_number !~ '^[A-Za-z0-9]{9,12}$' then
    perform private.fail('invoice_receiver_incomplete');
  end if;
  return jsonb_build_object(
    'name', left(trim(p.legal_name), 100),
    'id_type', private.invoice_id_code(p.id_type),
    'id_number', p.id_number,
    'email', p.contact_email,
    'activity_code', case when p.economic_activity_code ~ '^[0-9]{6}$' then p.economic_activity_code end);
end;
$$;

-- Hacienda's payment-method code for how the shopper paid (nota 6).
create or replace function private.invoice_payment_code(p_method public.payment_method) returns text
language sql immutable
set search_path = ''
as $$
  select case p_method when 'cash_on_delivery' then '01' when 'card' then '02'
                       when 'bank_transfer' then '04' when 'sinpe_movil' then '06' end;
$$;

-- ═══ 5. Making a document ══════════════════════════════════════════════════

-- Numbers, keys and inserts one document. A second call with the same
-- dedupe key returns the first document and changes nothing.
create or replace function private.invoice_create(
  p_kind text,
  p_type text,
  p_order_id uuid,
  p_receiver_kind text,
  p_receiver_seller_id uuid,
  p_receiver jsonb,
  p_lines jsonb,
  p_sale_condition text,
  p_payment_code text,
  p_payment_other text,
  p_refs jsonb,
  p_dedupe_key text,
  p_event_id bigint,
  p_total_minor bigint,
  p_refund_id uuid default null,
  p_original_id uuid default null,
  p_replaces_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_issuer jsonb := private.invoice_issuer();
  v_issued timestamptz := now();
  v_sequence bigint;
  v_number text;
  v_security text := private.invoice_security_code();
  v_summary jsonb := private.invoice_summary(p_lines);
begin
  select id into v_id from public.electronic_invoices where dedupe_key = p_dedupe_key;
  if found then
    return v_id;
  end if;

  v_sequence := private.invoice_next_number(v_issuer ->> 'id_number', (v_issuer ->> 'establishment')::integer,
                                            (v_issuer ->> 'terminal')::integer, p_type);
  v_number := private.invoice_consecutivo((v_issuer ->> 'establishment')::integer,
                                          (v_issuer ->> 'terminal')::integer, p_type, v_sequence);

  insert into public.electronic_invoices (
    order_id, issuer_seller_id, document_type, clave, consecutivo, status, total_minor,
    kind, dedupe_key, source_event_id, receiver_kind, receiver_seller_id, refund_id,
    original_invoice_id, replaces_id, establishment, terminal, sequence_number, situation,
    security_code, issued_at, issuer, receiver, sale_condition, payments, lines, summary, refs,
    next_attempt_at)
  values (
    p_order_id, null, p_type,
    private.invoice_clave(v_issued, v_issuer ->> 'id_number', v_number, '1', v_security),
    v_number, 'pending', p_total_minor,
    p_kind, p_dedupe_key, p_event_id, p_receiver_kind, p_receiver_seller_id, p_refund_id,
    p_original_id, p_replaces_id, (v_issuer ->> 'establishment')::smallint,
    (v_issuer ->> 'terminal')::integer, v_sequence, '1', v_security, v_issued,
    v_issuer - 'establishment' - 'terminal', p_receiver, p_sale_condition,
    jsonb_build_array(jsonb_build_object('code', p_payment_code, 'other', p_payment_other,
                                         'amount', v_summary ->> 'total')),
    p_lines, v_summary, coalesce(p_refs, '[]'), now())
  returning id into v_id;
  return v_id;
end;
$$;

-- The document that currently stands for one that may have been rejected
-- and replaced: follows the chain of replacements to its end.
create or replace function private.invoice_current(p_id uuid) returns public.electronic_invoices
language plpgsql stable security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
begin
  select * into d from public.electronic_invoices where id = p_id;
  while d.replaced_by_id is not null loop
    select * into d from public.electronic_invoices where id = d.replaced_by_id;
  end loop;
  return d;
end;
$$;

-- What a credit note says about the document it reverses (InformacionReferencia).
create or replace function private.invoice_reference(
  d public.electronic_invoices, p_code text, p_reason text
) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('type', d.document_type, 'number', d.clave, 'issued_at', d.issued_at,
                            'code', p_code, 'reason', left(p_reason, 180));
$$;

-- A paid order: the delivery fee's document to the shopper, and one factura
-- per seller for the platform's fees.
create or replace function private.invoice_plan_capture(p_event_id bigint, p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_policy jsonb := private.invoice_policy();
  v_cabys jsonb := coalesce(v_policy -> 'cabys', '{}');
  v_receiver private.invoice_checkout_receivers;
  v_lines jsonb;
  v_n integer;
  f record;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or not exists (select 1 from public.ledger_transactions t
                              where t.order_id = p_order_id and t.kind = 'order_capture') then
    return;
  end if;

  if o.shipping_minor > 0 and coalesce(v_policy ->> 'delivery_fee_issuer', 'platform') = 'platform' then
    select * into v_receiver from private.invoice_checkout_receivers r
    where r.user_id = o.user_id and r.idempotency_key = o.idempotency_key;
    perform private.invoice_create(
      'delivery',
      case when v_receiver.user_id is null then '04' else '01' end,
      o.id, 'shopper', null,
      case when v_receiver.user_id is null then null else jsonb_build_object(
        'name', v_receiver.name, 'id_type', private.invoice_id_code(v_receiver.id_type),
        'id_number', v_receiver.id_number, 'email', v_receiver.email, 'activity_code', null) end,
      jsonb_build_array(private.invoice_line(
        1, coalesce(v_cabys ->> 'delivery', '6803000000000'), 'Os',
        'Entrega a domicilio, pedido ' || o.order_number,
        private.invoice_net_of_gross(o.shipping_minor, 1300), '08')),
      '01', private.invoice_payment_code(o.payment_method), null, '[]',
      'delivery:' || o.id, p_event_id, o.shipping_minor);
    -- Used: what the shopper typed now lives only in the document.
    delete from private.invoice_checkout_receivers r
    where r.user_id = o.user_id and r.idempotency_key = o.idempotency_key;
  end if;

  for f in
    select * from public.seller_order_fees where order_id = p_order_id and fees_net_minor > 0
    order by seller_id
  loop
    v_lines := '[]';
    v_n := 0;
    if f.referral_fee_minor > 0 then
      v_n := v_n + 1;
      v_lines := v_lines || private.invoice_line(v_n, coalesce(v_cabys ->> 'commission', '6254400000000'),
        'Cm', 'Comisión por venta, pedido ' || o.order_number, f.referral_fee_minor::numeric / 100, '08');
    end if;
    if f.fulfillment_fee_minor > 0 then
      v_n := v_n + 1;
      v_lines := v_lines || private.invoice_line(v_n, coalesce(v_cabys ->> 'fulfillment', '6729000000000'),
        'Os', 'Servicio de bodega y preparación, pedido ' || o.order_number,
        f.fulfillment_fee_minor::numeric / 100, '08');
    end if;
    if f.payment_fee_minor > 0 then
      v_n := v_n + 1;
      v_lines := v_lines || private.invoice_line(v_n, coalesce(v_cabys ->> 'payment', '7119002009900'),
        'Os', 'Gestión del cobro al comprador, pedido ' || o.order_number,
        f.payment_fee_minor::numeric / 100, '08');
    end if;
    perform private.invoice_create(
      'fees', '01', o.id, 'seller', f.seller_id, private.invoice_seller_receiver(f.seller_id), v_lines,
      coalesce(v_policy ->> 'fee_sale_condition', '01'), coalesce(v_policy ->> 'fee_payment_code', '99'),
      case when coalesce(v_policy ->> 'fee_payment_code', '99') = '99'
           then coalesce(v_policy ->> 'fee_payment_other', 'Compensación contra la liquidación de ventas') end,
      '[]', 'fees:' || o.id || ':' || f.seller_id, p_event_id, f.fees_net_minor + f.fees_tax_minor);
  end loop;
end;
$$;

-- A refund booked in the register: credit notes for what the platform gives back.
--   order_cancelled  the whole capture was reversed: every document of the
--                    order is credited in full (code `credit_code_cancel`, 01);
--   return, parcel_returned  each seller gets back the commission on the
--                    returned units (code `credit_code_return`, 06). Payment
--                    and warehouse fees stay, as the ledger does; the
--                    delivery fee is not refunded, so its document stands.
-- A credit note references the document that stands now: when the original
-- was rejected and replaced, the replacement; while it waits for one, the
-- credit note waits too (invoice_waiting).
create or replace function private.invoice_plan_refund(p_event_id bigint, p_refund_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r private.refunds;
  o public.orders;
  v_policy jsonb := private.invoice_policy();
  d public.electronic_invoices;
  v_root record;
  c record;
  v_tax_bps integer;
begin
  select * into r from private.refunds where id = p_refund_id;
  if not found then
    return;
  end if;
  select * into o from public.orders where id = r.order_id;

  if r.reason = 'order_cancelled' then
    for v_root in
      select e.id from public.electronic_invoices e
      where e.order_id = r.order_id and e.kind in ('delivery', 'fees') and e.replaces_id is null
      order by e.kind, e.receiver_seller_id nulls first
    loop
      d := private.invoice_current(v_root.id);
      if d.status = 'rejected' then
        perform private.fail('invoice_waiting');
      end if;
      perform private.invoice_create(
        'credit', '03', r.order_id, d.receiver_kind, d.receiver_seller_id, d.receiver, d.lines,
        d.sale_condition, d.payments -> 0 ->> 'code', d.payments -> 0 ->> 'other',
        jsonb_build_array(private.invoice_reference(d, coalesce(v_policy ->> 'credit_code_cancel', '01'),
          'Pedido ' || o.order_number || ' cancelado y reembolsado')),
        'credit:' || r.id || ':' || v_root.id, p_event_id, d.total_minor, r.id, d.id);
    end loop;
    return;
  end if;

  -- The commission given back per seller, by the formula private.refund_units booked it with.
  for c in
    select i.seller_id,
           sum(round(f.referral_fee_minor::numeric * i.unit_price_minor * u.quantity / f.items_gross_minor))::bigint
             as commission,
           max(s.fee_tax_bps) as tax_bps
    from private.refund_units u
    join public.order_items i on i.id = u.order_item_id
    join public.seller_order_fees f on f.order_id = i.order_id and f.seller_id = i.seller_id
    join public.fee_schedules s on s.version = f.schedule_version
    where u.refund_id = r.id
    group by i.seller_id
    order by i.seller_id
  loop
    if c.commission <= 0 then
      continue;
    end if;
    select e.id into v_root from public.electronic_invoices e
    where e.order_id = r.order_id and e.kind = 'fees' and e.receiver_seller_id = c.seller_id
      and e.replaces_id is null;
    if not found then
      continue;
    end if;
    d := private.invoice_current(v_root.id);
    if d.status = 'rejected' then
      perform private.fail('invoice_waiting');
    end if;
    v_tax_bps := coalesce(c.tax_bps, 1300);
    perform private.invoice_create(
      'credit', '03', r.order_id, 'seller', c.seller_id, d.receiver,
      jsonb_build_array(private.invoice_line(
        1, coalesce(v_policy -> 'cabys' ->> 'commission', '6254400000000'), 'Cm',
        'Devolución de la comisión por productos devueltos, pedido ' || o.order_number,
        c.commission::numeric / 100, '08')),
      d.sale_condition, d.payments -> 0 ->> 'code', d.payments -> 0 ->> 'other',
      jsonb_build_array(private.invoice_reference(d, coalesce(v_policy ->> 'credit_code_return', '06'),
        'Comisión devuelta por productos devueltos del pedido ' || o.order_number)),
      'credit:' || r.id || ':' || c.seller_id, p_event_id,
      c.commission + round(c.commission::numeric * v_tax_bps / 10000)::bigint, r.id, d.id);
  end loop;
end;
$$;

-- Plans pending 'invoice' jobs, oldest first, each in its own subtransaction:
-- its documents and numbers commit together or not at all. Two planners at
-- once skip each other's jobs, and wait for each other only on a counter row.
-- Until the issuer is set up, nothing is numbered and the jobs wait.
create or replace function private.invoice_plan(p_limit integer default 100) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  j record;
  e private.outbox_events;
  v_count integer := 0;
begin
  for j in
    select x.event_id from private.outbox_jobs x
    where x.consumer = 'invoice' and x.status = 'pending'
    order by x.event_id
    limit greatest(1, least(p_limit, 1000))
    for update of x skip locked
  loop
    select * into e from private.outbox_events where id = j.event_id;
    begin
      if e.topic = 'payment.captured' then
        perform private.invoice_plan_capture(e.id, (e.payload ->> 'order_id')::uuid);
      elsif e.topic = 'fiscal.refund_booked' then
        perform private.invoice_plan_refund(e.id, (e.payload ->> 'refund_id')::uuid);
      end if;
      update private.outbox_jobs set status = 'done', done_at = now(), attempts = attempts + 1
      where event_id = j.event_id and consumer = 'invoice';
      v_count := v_count + 1;
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
          set attempts = attempts + 1, last_error = left(sqlerrm, 500),
              status = case when attempts + 1 >= 5 then 'dead' else 'pending' end
          where event_id = j.event_id and consumer = 'invoice';
        end if;
    end;
  end loop;
  return v_count;
end;
$$;

-- ═══ 6. Events ═════════════════════════════════════════════════════════════

insert into private.outbox_routes (topic, consumer) values
  ('payment.captured', 'invoice'),
  ('fiscal.refund_booked', 'invoice')
on conflict do nothing;

-- Every refund in the register, whatever path booked it, may need a credit note.
create or replace function private.emit_fiscal_refund() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.emit('fiscal.refund_booked',
    jsonb_build_object('refund_id', new.id, 'order_id', new.order_id, 'reason', new.reason));
  return null;
end;
$$;

create trigger refunds_emit_fiscal after insert on private.refunds
  for each row execute function private.emit_fiscal_refund();

-- ═══ 7. The worker's functions ═════════════════════════════════════════════

create or replace function public.worker_invoice_plan(p_limit integer default 100) returns integer
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  return private.invoice_plan(p_limit);
end;
$$;

-- The document as the worker builds it (packages/invoicing FiscalDocument).
create or replace function private.invoice_document(d public.electronic_invoices) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'document_type', d.document_type,
    'clave', d.clave,
    'consecutivo', d.consecutivo,
    'issued_at', d.issued_at,
    'provider_id', d.issuer ->> 'provider_id',
    'issuer', d.issuer - 'provider_id',
    'receiver', d.receiver,
    'sale_condition', d.sale_condition,
    'sale_condition_other', null,
    'lines', d.lines,
    'payments', d.payments,
    'summary', d.summary,
    'references', d.refs);
$$;

-- Claims documents due for work, with a lease, in number order per counter:
-- to sign and send ("submit"), or to ask for Hacienda's answer ("poll").
-- A configuration error pauses everything until the pause ends.
create or replace function public.worker_invoice_claim(
  p_worker text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
  v_out jsonb := '[]';
  v_before boolean;
begin
  perform private.require_worker();
  if coalesce(char_length(p_worker), 0) not between 1 and 100 then
    perform private.fail('worker_only');
  end if;
  if exists (select 1 from private.invoice_transmission_pause where paused_until > now()) then
    return v_out;
  end if;

  for d in
    with picked as materialized (
      select x.id from public.electronic_invoices x
      where x.status in ('pending', 'sent') and x.held_reason is null
        and x.next_attempt_at <= now()
        and (x.locked_until is null or x.locked_until < now())
      order by x.next_attempt_at, x.establishment, x.terminal, x.document_type, x.sequence_number
      limit greatest(1, least(p_limit, 50))
      for update of x skip locked)
    update public.electronic_invoices t
    set locked_by = p_worker,
        locked_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
        submit_attempts = t.submit_attempts + case when t.status = 'pending' then 1 else 0 end
    from picked where t.id = picked.id
    returning t.*
  loop
    v_before := d.status = 'pending' and d.submit_attempts > 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', d.id,
      'phase', case when d.status = 'pending' then 'submit' else 'poll' end,
      'document', private.invoice_document(d),
      'signed_xml', (select f.content from private.electronic_invoice_files f
                     where f.invoice_id = d.id and f.kind = 'signed'),
      'submitted_before', v_before,
      'attempts', d.attempts));
  end loop;
  return v_out;
end;
$$;

-- Stores the signed XML once. Later attempts send these bytes; a second
-- signature of the same document is never kept. Returns what is stored, or
-- null when the caller no longer holds the document.
create or replace function public.worker_invoice_signed(
  p_id uuid, p_worker text, p_xml text, p_sha256 text
) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
  v_content text;
begin
  perform private.require_worker();
  select * into d from public.electronic_invoices
  where id = p_id and locked_by = p_worker and status = 'pending' for update;
  if not found then
    return null;
  end if;
  select content into v_content from private.electronic_invoice_files
  where invoice_id = p_id and kind = 'signed';
  if v_content is not null then
    return v_content;
  end if;
  if coalesce(char_length(p_xml), 0) not between 200 and 2000000 or p_sha256 !~ '^[0-9a-f]{64}$'
     or encode(extensions.digest(convert_to(p_xml, 'UTF8'), 'sha256'), 'hex') <> p_sha256
     or position(d.clave in p_xml) = 0 then
    perform private.fail('invoice_file_invalid');
  end if;
  insert into private.electronic_invoice_files (invoice_id, kind, file_name, content, sha256)
  values (p_id, 'signed', d.clave || '.xml', p_xml, p_sha256);
  update public.electronic_invoices
  set signed_sha256 = p_sha256, signed_at = now(), made_available_at = now(),
      xml_path = 'db:' || d.clave || '.xml'
  where id = p_id;
  return p_xml;
end;
$$;

-- When to ask Hacienda again (research note 8.2): 5 s, 15 s, 60 s, then
-- every 5 minutes up to 3 hours after it was received, then every hour.
create or replace function private.invoice_poll_delay(p_polls integer, p_submitted timestamptz)
returns interval
language sql stable
set search_path = ''
as $$
  select case
    when p_polls <= 0 then interval '5 seconds'
    when p_polls = 1 then interval '15 seconds'
    when p_polls = 2 then interval '60 seconds'
    when coalesce(p_submitted, now()) > now() - interval '3 hours' then interval '5 minutes'
    else interval '1 hour' end;
$$;

-- What happened, from the worker. p_outcome.event:
--   received, duplicate  Hacienda has it (201, or 400 "ya fue recibido"): poll for the answer
--   refused              400 with a cause: refused at reception; staff issue a replacement
--   answer               the status query: recibido, procesando, error (poll again), aceptado, rechazado
--   unknown_clave        404 on the status query: send it again
--   retry                network, timeout, 5xx, 429: back off, same bytes
--   config               a gateway 403, refused credentials: every send pauses 15 minutes
--   invalid              the worker's checks refused the document: held for staff
create or replace function public.worker_invoice_record(p_id uuid, p_worker text, p_outcome jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
  v_event text := p_outcome ->> 'event';
  v_state text := lower(p_outcome ->> 'state');
  v_wait double precision;
  v_xml text := p_outcome ->> 'response_xml';
  v_sha text := p_outcome ->> 'response_sha256';
begin
  perform private.require_worker();
  select * into d from public.electronic_invoices
  where id = p_id and locked_by = p_worker and status in ('pending', 'sent') for update;
  if not found then
    return null; -- the lease was lost; whoever holds it now decides
  end if;

  if v_event in ('received', 'duplicate') then
    update public.electronic_invoices
    set status = 'sent', submitted_at = coalesce(submitted_at, now()), hacienda_state = 'recibido',
        last_http_status = (p_outcome ->> 'http_status')::integer, poll_count = 0,
        next_attempt_at = now() + private.invoice_poll_delay(0, now()),
        attempts = attempts + 1, last_error_code = null, last_error = null
    where id = p_id;

  elsif v_event = 'refused' then
    update public.electronic_invoices
    set status = 'rejected', rejection_source = 'reception', rejected_at = now(),
        last_http_status = (p_outcome ->> 'http_status')::integer, attempts = attempts + 1,
        hacienda_message = left(p_outcome ->> 'cause', 2000), next_attempt_at = null
    where id = p_id;

  elsif v_event = 'answer' then
    if v_state not in ('recibido', 'procesando', 'aceptado', 'rechazado', 'error') then
      perform private.fail('invoice_outcome_invalid');
    end if;
    if v_state in ('aceptado', 'rechazado') then
      if v_xml is not null then
        if v_sha !~ '^[0-9a-f]{64}$'
           or encode(extensions.digest(convert_to(v_xml, 'UTF8'), 'sha256'), 'hex') <> v_sha then
          perform private.fail('invoice_file_invalid');
        end if;
        insert into private.electronic_invoice_files (invoice_id, kind, file_name, content, sha256)
        values (p_id, 'response', d.clave || '_respuesta.xml', v_xml, v_sha)
        on conflict (invoice_id, kind) do nothing;
      end if;
      update public.electronic_invoices
      set status = case v_state when 'aceptado' then 'accepted' else 'rejected' end::public.invoice_status,
          hacienda_state = v_state, answered_at = now(), last_polled_at = now(), poll_count = poll_count + 1,
          accepted_at = case when v_state = 'aceptado' then now() end,
          rejected_at = case when v_state = 'rechazado' then now() end,
          rejection_source = case when v_state = 'rechazado' then 'validation' end,
          response_sha256 = coalesce(response_sha256, v_sha),
          hacienda_message = left(coalesce(p_outcome ->> 'detail', hacienda_message), 2000),
          submitted_at = coalesce(submitted_at, now()), next_attempt_at = null,
          last_error_code = null, last_error = null
      where id = p_id;
      -- A credit note that annuls its document, once accepted, leaves that document void.
      if v_state = 'aceptado' and d.kind = 'credit' and d.original_invoice_id is not null
         and d.refs -> 0 ->> 'code' in ('01', '13') then
        update public.electronic_invoices
        set status = 'voided', voided_at = now()
        where id = d.original_invoice_id and status = 'accepted';
      end if;
    else
      update public.electronic_invoices
      set status = 'sent', hacienda_state = v_state, last_polled_at = now(), poll_count = poll_count + 1,
          submitted_at = coalesce(submitted_at, now()),
          next_attempt_at = now() + private.invoice_poll_delay(poll_count + 1, coalesce(submitted_at, now())),
          last_error_code = null, last_error = null
      where id = p_id;
    end if;

  elsif v_event = 'unknown_clave' then
    -- Hacienda does not know it: back to be sent, straight away and without asking first.
    update public.electronic_invoices
    set status = 'pending', hacienda_state = null, submit_attempts = 0, next_attempt_at = now(),
        last_http_status = (p_outcome ->> 'http_status')::integer
    where id = p_id;

  elsif v_event = 'retry' then
    -- 15 s, 30 s, 1, 2, 4 … minutes, at most an hour, ±20 %: Hacienda's link
    -- being down is no reason to give up (RCE art. 21: send when it is back).
    v_wait := greatest(coalesce((p_outcome ->> 'retry_after')::double precision, 0),
                       least(3600, 15 * power(2, least(greatest(d.attempts, 0), 12))))
              * (0.8 + random() * 0.4);
    update public.electronic_invoices
    set attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => v_wait),
        last_http_status = (p_outcome ->> 'http_status')::integer,
        last_error_code = left(p_outcome ->> 'code', 80), last_error = left(p_outcome ->> 'message', 300)
    where id = p_id;

  elsif v_event = 'config' then
    update public.electronic_invoices
    set attempts = attempts + 1, next_attempt_at = now() + interval '15 minutes',
        last_http_status = (p_outcome ->> 'http_status')::integer,
        last_error_code = left(p_outcome ->> 'code', 80), last_error = left(p_outcome ->> 'message', 300)
    where id = p_id;
    insert into private.invoice_transmission_pause (paused_until, reason)
    values (now() + interval '15 minutes', left(coalesce(p_outcome ->> 'code', 'config'), 80))
    on conflict (id) do update set paused_until = excluded.paused_until, reason = excluded.reason;

  elsif v_event = 'invalid' then
    update public.electronic_invoices
    set held_reason = left(coalesce(p_outcome ->> 'code', 'invalid'), 80), attempts = attempts + 1
    where id = p_id;

  else
    perform private.fail('invoice_outcome_invalid');
  end if;

  update public.electronic_invoices set locked_by = null, locked_until = null where id = p_id;
  return (select status::text from public.electronic_invoices where id = p_id);
end;
$$;

-- Hacienda's callback named this clave: ask for the answer now. The callback
-- is not authenticated, so this changes nothing but the time of the next query.
create or replace function public.worker_invoice_hint(p_clave text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  update public.electronic_invoices set next_attempt_at = now()
  where clave = p_clave and status = 'sent';
  return found;
end;
$$;

create or replace function public.worker_invoice_health(p_report jsonb) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_worker();
  insert into private.invoice_worker_health (id, reported_at, environment, certificate_subject,
                                             certificate_issuer, certificate_not_after, error)
  values (true, now(), left(p_report ->> 'environment', 20), left(p_report ->> 'certificate_subject', 300),
          left(p_report ->> 'certificate_issuer', 300),
          (p_report ->> 'certificate_not_after')::timestamptz, left(p_report ->> 'error', 300))
  on conflict (id) do update set reported_at = excluded.reported_at, environment = excluded.environment,
    certificate_subject = excluded.certificate_subject, certificate_issuer = excluded.certificate_issuer,
    certificate_not_after = excluded.certificate_not_after, error = excluded.error;
end;
$$;

-- ═══ 8. Reading documents ══════════════════════════════════════════════════

-- Whether the caller may read a document: finance; the shopper who placed the
-- order, for what is made out to them; the team of the shop it is made out to
-- (or that issued it). Never anyone else.
create or replace function private.can_read_invoice(d public.electronic_invoices) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    private.has_staff_role('finance')
    or (d.receiver_kind = 'shopper' and private.owns_order(d.order_id))
    or (d.receiver_seller_id is not null and private.is_seller_member(d.receiver_seller_id))
    or (d.issuer_seller_id is not null and private.is_seller_member(d.issuer_seller_id)));
$$;

-- One row of a list.
create or replace function private.invoice_row(d public.electronic_invoices) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'kind', d.kind,
    'document_type', d.document_type,
    'clave', d.clave,
    'consecutivo', d.consecutivo,
    'issued_at', d.issued_at,
    'status', d.status,
    'hacienda_state', d.hacienda_state,
    'total_minor', d.total_minor,
    'order_number', (select o.order_number from public.orders o where o.id = d.order_id),
    'receiver_name', d.receiver ->> 'name',
    'seller_name', (select s.trade_name from public.sellers s where s.id = d.receiver_seller_id),
    'references_clave', d.refs -> 0 ->> 'number',
    'reference_code', d.refs -> 0 ->> 'code',
    'replaces_id', d.replaces_id,
    'replaced_by_id', d.replaced_by_id,
    'has_xml', d.signed_sha256 is not null,
    'has_response', d.response_sha256 is not null,
    'accepted_at', d.accepted_at,
    'rejected_at', d.rejected_at);
$$;

-- The documents of an order made out to its shopper: the delivery fee's and
-- its credit notes. A rejected one that was replaced is left out: the
-- replacement stands for it.
create or replace function public.my_order_invoices(p_order_number text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  select id into v_order from public.orders
  where order_number = p_order_number and user_id = (select auth.uid());
  if not found then
    perform private.fail('order_not_found');
  end if;
  return coalesce((
    select jsonb_agg(private.invoice_row(e) order by e.issued_at, e.sequence_number)
    from public.electronic_invoices e
    where e.order_id = v_order and e.receiver_kind = 'shopper'
      and not (e.status = 'rejected' and e.replaced_by_id is not null)), '[]');
end;
$$;

-- The platform's documents to a shop: fee facturas and their credit notes.
create or replace function public.seller_fee_invoices(p_seller_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('finance')) then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(private.invoice_row(e) order by e.issued_at desc, e.sequence_number desc)
    from (select * from public.electronic_invoices x
          where x.receiver_seller_id = p_seller_id
            and not (x.status = 'rejected' and x.replaced_by_id is not null)
          order by x.issued_at desc, x.sequence_number desc
          limit least(greatest(coalesce(p_limit, 50), 1), 200)) e), '[]');
end;
$$;

-- A whole document for its readable page: everything the XML says, with
-- where it stands at Hacienda.
create or replace function public.invoice_detail(p_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  select * into d from public.electronic_invoices where id = p_id;
  if not found or d.kind is null or not private.can_read_invoice(d) then
    perform private.fail('invoice_not_found');
  end if;
  return private.invoice_row(d) || jsonb_build_object(
    'situation', d.situation,
    'issuer', d.issuer - 'provider_id',
    'provider_id', d.issuer ->> 'provider_id',
    'receiver', d.receiver,
    'sale_condition', d.sale_condition,
    'payments', d.payments,
    'lines', d.lines,
    'summary', d.summary,
    'references', d.refs,
    'hacienda_message', d.hacienda_message,
    'rejection_source', d.rejection_source,
    'submitted_at', d.submitted_at,
    'made_available_at', d.made_available_at,
    'replaces', (select jsonb_build_object('id', x.id, 'consecutivo', x.consecutivo, 'clave', x.clave)
                 from public.electronic_invoices x where x.id = d.replaces_id),
    'replaced_by', (select jsonb_build_object('id', x.id, 'consecutivo', x.consecutivo, 'clave', x.clave)
                    from public.electronic_invoices x where x.id = d.replaced_by_id));
end;
$$;

-- A document's file for download: the signed XML, or Hacienda's answer.
create or replace function public.invoice_file(p_id uuid, p_kind text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
  f private.electronic_invoice_files;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  select * into d from public.electronic_invoices where id = p_id;
  if not found or d.kind is null or not private.can_read_invoice(d) then
    perform private.fail('invoice_not_found');
  end if;
  select * into f from private.electronic_invoice_files
  where invoice_id = p_id and kind = case p_kind when 'xml' then 'signed' when 'response' then 'response' end;
  if not found then
    perform private.fail('invoice_file_not_ready');
  end if;
  return jsonb_build_object('file_name', f.file_name, 'content', f.content, 'sha256', f.sha256);
end;
$$;

-- ═══ 9. Asking for a factura at checkout ═══════════════════════════════════

-- Called by the checkout before the order is placed, with the order's
-- idempotency key, when the shopper ticked "factura a mi nombre" (and with a
-- null number to withdraw it). The identification is checked for its shape;
-- whether it exists in Hacienda's register is Hacienda's check.
create or replace function public.set_checkout_invoice_receiver(
  p_idempotency_key text,
  p_id_type public.identification_type,
  p_id_number text,
  p_name text,
  p_email text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_number text := upper(regexp_replace(coalesce(p_id_number, ''), '[\s.\-]', '', 'g'));
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  if coalesce(char_length(p_idempotency_key), 0) not between 8 and 80 then
    perform private.fail('invoice_receiver_invalid');
  end if;
  if exists (select 1 from public.orders o
             join public.payments p on p.order_id = o.id
             where o.user_id = v_user and o.idempotency_key = p_idempotency_key
               and p.status in ('captured', 'partially_refunded', 'refunded')) then
    perform private.fail('invoice_receiver_locked');
  end if;

  if v_number = '' then
    delete from private.invoice_checkout_receivers
    where user_id = v_user and idempotency_key = p_idempotency_key;
    return jsonb_build_object('requested', false);
  end if;

  if p_id_type is null or not private.invoice_id_valid(p_id_type, v_number) then
    perform private.fail('invoice_receiver_id_invalid');
  end if;
  if char_length(v_name) not between 3 and 100 then
    perform private.fail('invoice_receiver_name_invalid');
  end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    perform private.fail('invoice_receiver_email_invalid');
  end if;

  insert into private.invoice_checkout_receivers (user_id, idempotency_key, id_type, id_number, name, email)
  values (v_user, p_idempotency_key, p_id_type, v_number, v_name, v_email)
  on conflict (user_id, idempotency_key) do update
    set id_type = excluded.id_type, id_number = excluded.id_number, name = excluded.name,
        email = excluded.email, created_at = now();
  return jsonb_build_object('requested', true);
end;
$$;

-- ═══ 10. Finance ═══════════════════════════════════════════════════════════

-- The finance screen: documents by state, the ones waiting too long for
-- Hacienda's answer, the rejected ones with Hacienda's reason, the ones not
-- sent yet, events that produced no document, the worker's health, and the
-- daily count of documents against paid orders (Costa Rica days).
create or replace function public.ops_invoices(p_status text default null, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(hours => coalesce((private.invoice_policy() ->> 'answer_window_hours')::integer, 3));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'sent', count(*) filter (where status = 'sent'),
        'accepted', count(*) filter (where status = 'accepted'),
        'rejected', count(*) filter (where status = 'rejected' and replaced_by_id is null),
        'voided', count(*) filter (where status = 'voided'))
      from public.electronic_invoices where kind is not null),
    'answer_window_hours', extract(epoch from v_window)::integer / 3600,
    'waiting', coalesce((
      select jsonb_agg(private.invoice_row(e) || jsonb_build_object('submitted_at', e.submitted_at)
                       order by e.submitted_at)
      from (select * from public.electronic_invoices x
            where x.status = 'sent' and x.submitted_at < now() - v_window
            order by x.submitted_at limit 100) e), '[]'),
    'rejected', coalesce((
      select jsonb_agg(private.invoice_row(e) || jsonb_build_object(
               'hacienda_message', e.hacienda_message, 'rejection_source', e.rejection_source)
             order by e.rejected_at)
      from (select * from public.electronic_invoices x
            where x.status = 'rejected' and x.replaced_by_id is null
            order by x.rejected_at limit 100) e), '[]'),
    'unsent', coalesce((
      select jsonb_agg(private.invoice_row(e) || jsonb_build_object(
               'attempts', e.attempts, 'last_error_code', e.last_error_code,
               'held_reason', e.held_reason, 'next_attempt_at', e.next_attempt_at)
             order by e.issued_at)
      from (select * from public.electronic_invoices x
            where x.status = 'pending' and (x.held_reason is not null or x.issued_at < now() - interval '15 minutes')
            order by x.issued_at limit 100) e), '[]'),
    'failed_events', (select count(*) from private.outbox_jobs j
                      where j.consumer = 'invoice' and (j.status = 'dead' or (j.status = 'pending' and j.attempts > 0))),
    'waiting_events', (select count(*) from private.outbox_jobs j
                       where j.consumer = 'invoice' and j.status = 'pending'),
    'issuer_ready', coalesce((private.setting('invoicing_issuer') ->> 'ready')::boolean, false),
    'worker', (select jsonb_build_object('reported_at', h.reported_at, 'environment', h.environment,
                                         'certificate_not_after', h.certificate_not_after, 'error', h.error)
               from private.invoice_worker_health h),
    'paused_until', (select p.paused_until from private.invoice_transmission_pause p where p.paused_until > now()),
    'recent', coalesce((
      select jsonb_agg(private.invoice_row(e) order by e.issued_at desc, e.sequence_number desc)
      from (select * from public.electronic_invoices x
            where x.kind is not null
              and (p_status is null or x.status::text = p_status)
            order by x.issued_at desc, x.sequence_number desc limit v_limit) e), '[]'),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day, 'paid_orders', d.paid, 'documents', d.docs, 'tiquetes', d.tiquetes,
               'facturas', d.facturas, 'credit_notes', d.notes, 'accepted', d.accepted,
               'rejected', d.rejected) order by d.day desc)
      from (
        select g.day::date as day,
               (select count(distinct p.order_id) from public.payments p
                where p.captured_at is not null
                  and ((p.captured_at at time zone 'UTC') - interval '6 hours')::date = g.day::date) as paid,
               count(e.id) as docs,
               count(e.id) filter (where e.document_type = '04') as tiquetes,
               count(e.id) filter (where e.document_type = '01') as facturas,
               count(e.id) filter (where e.document_type = '03') as notes,
               count(e.id) filter (where e.status in ('accepted', 'voided')) as accepted,
               count(e.id) filter (where e.status = 'rejected') as rejected
        from generate_series(((now() at time zone 'UTC') - interval '6 hours')::date - 13,
                             ((now() at time zone 'UTC') - interval '6 hours')::date, interval '1 day') g (day)
        left join public.electronic_invoices e
          on e.kind is not null and ((e.issued_at at time zone 'UTC') - interval '6 hours')::date = g.day::date
        group by g.day) d), '[]'));
end;
$$;

-- A document Hacienda rejected is void (RCE art. 10, 19): it is never
-- edited, and no credit note is issued for it. Finance issues a new one,
-- with a new consecutive number, from the data as it stands now (the
-- platform's settings and the shop's registered details, corrected if that
-- was the cause), referencing the rejected one (TipoDocIR 10, Codigo 16)
-- when Hacienda had received it. A factura to a shopper whose identification
-- Hacienda did not accept can be reissued as a tiquete without receiver.
create or replace function public.ops_invoice_replace(p_id uuid, p_as_ticket boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
  v_type text;
  v_receiver jsonb;
  v_refs jsonb;
  v_new uuid;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  select * into d from public.electronic_invoices where id = p_id and kind is not null for update;
  if not found then
    perform private.fail('invoice_not_found');
  end if;
  if d.status <> 'rejected' then
    perform private.fail('invoice_not_rejected');
  end if;
  if d.replaced_by_id is not null then
    perform private.fail('invoice_already_replaced');
  end if;

  v_type := d.document_type;
  v_receiver := d.receiver;
  if d.receiver_seller_id is not null then
    v_receiver := private.invoice_seller_receiver(d.receiver_seller_id);
  end if;
  if coalesce(p_as_ticket, false) then
    if not (d.kind = 'delivery' and d.document_type = '01') then
      perform private.fail('invoice_not_replaceable_as_ticket');
    end if;
    v_type := '04';
    v_receiver := null;
  end if;

  -- What a credit note said about the document it reverses stays; the
  -- rejected document is referenced when Hacienda had it.
  v_refs := coalesce((select jsonb_agg(x) from jsonb_array_elements(d.refs) x
                      where x ->> 'type' <> '10'), '[]');
  if d.rejection_source = 'validation' then
    v_refs := v_refs || jsonb_build_array(jsonb_build_object(
      'type', '10', 'number', d.clave, 'issued_at', d.issued_at, 'code', '16',
      'reason', 'Sustituye comprobante rechazado por Hacienda'));
  end if;

  v_new := private.invoice_create(
    d.kind, v_type, d.order_id, d.receiver_kind, d.receiver_seller_id, v_receiver, d.lines,
    d.sale_condition, d.payments -> 0 ->> 'code', d.payments -> 0 ->> 'other', v_refs,
    'replace:' || d.id, d.source_event_id, d.total_minor, d.refund_id, d.original_invoice_id, d.id);
  update public.electronic_invoices set replaced_by_id = v_new where id = d.id;

  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'invoice_replaced', 'electronic_invoices', d.id::text,
          jsonb_build_object('consecutivo', d.consecutivo, 'status', d.status),
          jsonb_build_object('replacement_id', v_new, 'as_ticket', coalesce(p_as_ticket, false)));

  return private.invoice_row((select e from public.electronic_invoices e where e.id = v_new));
end;
$$;

-- Sends again, now, a document that is still in transit: one the worker's
-- checks held back (after the cause was fixed), or one backing off because
-- Hacienda could not be reached. The same signed bytes go, under the same
-- clave. A rejected document cannot be retried: it is replaced instead.
create or replace function public.ops_invoice_retry(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.electronic_invoices;
begin
  if not private.has_staff_role('finance') then
    perform private.fail('forbidden');
  end if;
  select * into d from public.electronic_invoices where id = p_id and kind is not null for update;
  if not found then
    perform private.fail('invoice_not_found');
  end if;
  if d.status not in ('pending', 'sent') or (d.held_reason is null and d.attempts = 0
                                              and d.next_attempt_at <= now()) then
    perform private.fail('invoice_not_retryable');
  end if;
  update public.electronic_invoices
  set held_reason = null, next_attempt_at = now(), locked_by = null, locked_until = null
  where id = p_id;
  delete from private.invoice_transmission_pause;

  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), 'invoice_retried', 'electronic_invoices', d.id::text,
          jsonb_build_object('status', d.status, 'held_reason', d.held_reason, 'attempts', d.attempts),
          null);
  return private.invoice_row((select e from public.electronic_invoices e where e.id = p_id));
end;
$$;

-- ═══ 11. Grants ════════════════════════════════════════════════════════════

revoke execute on function
  private.invoice_amount(numeric), private.invoice_rate_bps(text), private.invoice_rate_text(text),
  private.invoice_net_of_gross(bigint, integer), private.invoice_line(integer, text, text, text, numeric, text),
  private.invoice_summary(jsonb), private.invoice_consecutivo(integer, integer, text, bigint),
  private.invoice_clave(timestamptz, text, text, text, text), private.invoice_security_code(),
  private.invoice_next_number(text, integer, integer, text), private.invoice_policy(), private.invoice_issuer(),
  private.invoice_id_code(public.identification_type), private.invoice_id_valid(public.identification_type, text),
  private.invoice_seller_receiver(uuid), private.invoice_payment_code(public.payment_method),
  private.invoice_create(text, text, uuid, text, uuid, jsonb, jsonb, text, text, text, jsonb, text, bigint, bigint,
                         uuid, uuid, uuid),
  private.invoice_current(uuid), private.invoice_reference(public.electronic_invoices, text, text),
  private.invoice_plan_capture(bigint, uuid), private.invoice_plan_refund(bigint, uuid),
  private.invoice_plan(integer), private.emit_fiscal_refund(), private.invoice_document(public.electronic_invoices),
  private.invoice_poll_delay(integer, timestamptz), private.can_read_invoice(public.electronic_invoices),
  private.invoice_row(public.electronic_invoices), private.invoice_forget_receiver()
from public, anon, authenticated;

revoke execute on function
  public.worker_invoice_plan(integer), public.worker_invoice_claim(text, integer, integer),
  public.worker_invoice_signed(uuid, text, text, text), public.worker_invoice_record(uuid, text, jsonb),
  public.worker_invoice_hint(text), public.worker_invoice_health(jsonb),
  public.my_order_invoices(text), public.seller_fee_invoices(uuid, integer), public.invoice_detail(uuid),
  public.invoice_file(uuid, text),
  public.set_checkout_invoice_receiver(text, public.identification_type, text, text, text),
  public.ops_invoices(text, integer), public.ops_invoice_replace(uuid, boolean), public.ops_invoice_retry(uuid)
from public, anon, authenticated;

grant execute on function
  public.worker_invoice_plan(integer), public.worker_invoice_claim(text, integer, integer),
  public.worker_invoice_signed(uuid, text, text, text), public.worker_invoice_record(uuid, text, jsonb),
  public.worker_invoice_hint(text), public.worker_invoice_health(jsonb)
to service_role;

grant execute on function
  public.my_order_invoices(text), public.seller_fee_invoices(uuid, integer), public.invoice_detail(uuid),
  public.invoice_file(uuid, text),
  public.set_checkout_invoice_receiver(text, public.identification_type, text, text, text),
  public.ops_invoices(text, integer), public.ops_invoice_replace(uuid, boolean), public.ops_invoice_retry(uuid)
to authenticated;

-- ═══ 12. Waking the worker ═════════════════════════════════════════════════
-- As for notifications: on Supabase a sweep every 30 seconds by pg_cron and a
-- kick by pg_net when new jobs are written, calling the invoice-worker Edge
-- Function with a token that can do nothing but wake it. They need the Vault
-- secrets 'project_url' and 'invoice_worker_token'; until the owner sets them,
-- and on a plain PostgreSQL without these extensions, they do nothing.

create or replace function private.invoice_kick() returns void
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
                    (select decrypted_secret from vault.decrypted_secrets where name = 'invoice_worker_token')$q$
    into v_url, v_token;
  if v_url is null or v_token is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 5000)$q$
    using v_url || '/functions/v1/invoice-worker',
          jsonb_build_object('Content-Type', 'application/json', 'x-worker-token', v_token);
exception when others then
  raise warning 'invoice_kick: %', sqlerrm;
end;
$$;

create or replace function private.invoice_kick_on_jobs() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from inserted_jobs where consumer = 'invoice') then
    perform private.invoice_kick();
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create trigger outbox_jobs_invoice_kick after insert on private.outbox_jobs
  referencing new table as inserted_jobs
  for each statement execute function private.invoice_kick_on_jobs();

create or replace function private.invoice_sweep() returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.outbox_jobs where consumer = 'invoice' and status = 'pending')
     or exists (select 1 from public.electronic_invoices
                where status in ('pending', 'sent') and held_reason is null and next_attempt_at <= now()) then
    perform private.invoice_kick();
  end if;
  -- A factura asked for at checkout whose order was never paid is not kept.
  delete from private.invoice_checkout_receivers where created_at < now() - interval '2 days';
end;
$$;

revoke execute on function private.invoice_kick(), private.invoice_kick_on_jobs(), private.invoice_sweep()
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('invoice-sweep', '30 seconds', 'select private.invoice_sweep()');
  else
    raise notice 'pg_cron is not available here; run the invoice worker by hand or locally.';
  end if;
exception when others then
  raise notice 'Could not schedule the invoice sweep: %', sqlerrm;
end
$$;
