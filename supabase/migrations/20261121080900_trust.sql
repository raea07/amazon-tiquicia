-- Trust: reviews, returns, complaints, content reports and the audit trail.
--
-- Several of these exist because the law asks for them:
--   * Reviews, positive and negative alike, must be published (reglamento to
--     Ley 7472, art. 196).
--   * A free complaint mechanism is mandatory (art. 195).
--   * Shoppers may withdraw within 8 business days of the sale and are
--     refunded within 8 calendar days (arts. 72–75).
--   * Ley 10946 (in force mid-2027) requires a notice-and-action channel for
--     illegal content and an internal complaint-handling system.

-- ── Reviews ────────────────────────────────────────────────────────────────
-- Only someone who received the product can review it, once per purchase line.

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  order_item_id uuid not null unique references public.order_items (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title text check (char_length(title) <= 120),
  body text check (char_length(body) <= 4000),
  -- Published immediately. Moderation removes only what breaks the content
  -- rules (insults, personal data, off-topic); a low rating is never a reason.
  status public.review_status not null default 'published',
  moderation_note text,
  seller_reply text check (char_length(seller_reply) <= 2000),
  seller_replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_product_idx on public.reviews (product_id, created_at desc)
  where status = 'published';

create trigger reviews_updated_at before update on public.reviews
  for each row execute function private.set_updated_at();

create or replace function private.reviews_rating_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p
  set rating_sum = coalesce(agg.total, 0),
      rating_count = coalesce(agg.n, 0)
  from (
    select sum(r.rating)::integer as total, count(*)::integer as n
    from public.reviews r where r.product_id = v_product and r.status = 'published'
  ) agg
  where p.id = v_product;
  return null;
end;
$$;

create trigger reviews_rating_refresh
  after insert or delete or update of rating, status on public.reviews
  for each row execute function private.reviews_rating_trigger();

create or replace function public.submit_review(
  p_order_item_id uuid,
  p_rating smallint,
  p_title text default null,
  p_body text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item record;
  v_id uuid;
begin
  select i.id, i.product_id, o.user_id, o.status
  into v_item
  from public.order_items i join public.orders o on o.id = i.order_id
  where i.id = p_order_item_id;

  if not found or v_item.user_id is distinct from v_user then
    perform private.fail('order_item_not_found');
  end if;
  if v_item.status not in ('delivered', 'completed') then
    perform private.fail('not_delivered_yet');
  end if;

  insert into public.reviews (product_id, user_id, order_item_id, rating, title, body)
  values (v_item.product_id, v_user, p_order_item_id, p_rating,
          nullif(trim(p_title), ''), nullif(trim(p_body), ''))
  on conflict (order_item_id) do update
    set rating = excluded.rating, title = excluded.title, body = excluded.body
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Returns ────────────────────────────────────────────────────────────────

create table public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  -- withdrawal = legal right, no reason needed; the others are claims.
  kind text not null check (kind in ('withdrawal', 'warranty', 'damaged', 'wrong_item')),
  quantity integer not null check (quantity > 0),
  reason text check (char_length(reason) <= 2000),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'received', 'refunded')),
  -- The refund is due within 8 calendar days of a valid withdrawal.
  refund_due_on date,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index return_requests_user_idx on public.return_requests (user_id, created_at desc);
create index return_requests_open_idx on public.return_requests (status)
  where status in ('requested', 'approved', 'received');

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
  v_item record;
  v_today date := private.cr_local(now())::date;
  v_already integer;
  v_id uuid;
begin
  select i.id, i.quantity, o.user_id, o.status, o.withdrawal_deadline, o.warranty_until
  into v_item
  from public.order_items i join public.orders o on o.id = i.order_id
  where i.id = p_order_item_id;

  if not found or v_item.user_id is distinct from v_user then
    perform private.fail('order_item_not_found');
  end if;
  if p_kind not in ('withdrawal', 'warranty', 'damaged', 'wrong_item') then
    perform private.fail('invalid_return_kind');
  end if;

  select coalesce(sum(quantity), 0) into v_already
  from public.return_requests
  where order_item_id = p_order_item_id and status <> 'rejected';
  if p_quantity <= 0 or p_quantity + v_already > v_item.quantity then
    perform private.fail('invalid_quantity');
  end if;

  if p_kind = 'withdrawal' then
    -- The legal window runs from the sale, so it can be used before delivery too.
    if v_today > v_item.withdrawal_deadline then
      perform private.fail('withdrawal_window_closed', v_item.withdrawal_deadline::text);
    end if;
  else
    if v_item.status not in ('delivered', 'completed') then
      perform private.fail('not_delivered_yet');
    end if;
    if p_kind = 'warranty' and (v_item.warranty_until is null or v_today > v_item.warranty_until) then
      perform private.fail('warranty_expired', coalesce(v_item.warranty_until::text, ''));
    end if;
    if coalesce(char_length(trim(p_reason)), 0) < 10 then
      perform private.fail('reason_required');
    end if;
  end if;

  insert into public.return_requests (order_item_id, user_id, kind, quantity, reason, status, refund_due_on)
  values (p_order_item_id, v_user, p_kind, p_quantity, nullif(trim(p_reason), ''),
          -- A withdrawal inside the window is a right, not a request to be judged.
          case when p_kind = 'withdrawal' then 'approved' else 'requested' end,
          case when p_kind = 'withdrawal' then v_today + 8 end)
  returning id into v_id;

  perform private.emit('return.requested', jsonb_build_object('return_request_id', v_id));
  return v_id;
end;
$$;

-- ── Complaints (the shopper's free complaint channel) ──────────────────────

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  order_id uuid references public.orders (id),
  category text not null check (category in ('delivery', 'product', 'payment', 'seller', 'privacy', 'other')),
  description text not null check (char_length(description) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index complaints_user_idx on public.complaints (user_id, created_at desc);
create index complaints_open_idx on public.complaints (status) where status <> 'resolved';

-- ── Content reports (notice and action) ────────────────────────────────────
-- Anyone, signed in or not, can report a listing, review or seller.

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  reporter_email text check (reporter_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  target_type text not null check (target_type in ('product', 'review', 'seller')),
  target_id uuid not null,
  reason text not null check (reason in
    ('illegal_product', 'counterfeit', 'unsafe', 'misleading', 'intellectual_property', 'abuse', 'other')),
  details text check (char_length(details) <= 4000),
  status public.report_status not null default 'open',
  resolution text,
  resolved_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_id is not null or reporter_email is not null)
);

create index content_reports_open_idx on public.content_reports (status, created_at)
  where status in ('open', 'in_review');

-- ── Audit trail ────────────────────────────────────────────────────────────
-- Who changed what, and when, on the tables where a silent change would matter:
-- permissions, seller standing and banking details, fees, platform settings.
-- Lives in `private`: it can be read only through the staff function below.

create table private.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  table_name text not null,
  row_key text,
  old_row jsonb,
  new_row jsonb
);

create index audit_log_table_idx on private.audit_log (table_name, at desc);
create index audit_log_actor_idx on private.audit_log (actor_id, at desc);

create trigger audit_log_immutable before update or delete on private.audit_log
  for each row execute function private.forbid_change();

create or replace function private.audit() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_key text;
begin
  -- Bank account numbers are evidence that a change happened, not data to copy around.
  if tg_table_name = 'seller_private' then
    v_old := v_old - 'payout_iban';
    v_new := v_new - 'payout_iban';
  end if;
  v_key := coalesce(
    (coalesce(v_new, v_old) ->> 'id'),
    (coalesce(v_new, v_old) ->> 'user_id'),
    (coalesce(v_new, v_old) ->> 'seller_id'),
    (coalesce(v_new, v_old) ->> 'key'),
    (coalesce(v_new, v_old) ->> 'version')
  );
  insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
  values ((select auth.uid()), tg_op, tg_table_name, v_key, v_old, v_new);
  return null;
end;
$$;

create trigger audit_staff_members after insert or update or delete on public.staff_members
  for each row execute function private.audit();
create trigger audit_sellers after update of status on public.sellers
  for each row execute function private.audit();
create trigger audit_seller_private after insert or update or delete on public.seller_private
  for each row execute function private.audit();
create trigger audit_seller_members after insert or update or delete on public.seller_members
  for each row execute function private.audit();
create trigger audit_drivers after insert or update of status or delete on public.drivers
  for each row execute function private.audit();
create trigger audit_warehouse_staff after insert or update or delete on public.warehouse_staff
  for each row execute function private.audit();
create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function private.audit();
create trigger audit_fee_schedules after insert or update or delete on public.fee_schedules
  for each row execute function private.audit();
create trigger audit_fee_payment_methods after insert or update or delete on public.fee_payment_methods
  for each row execute function private.audit();
create trigger audit_payouts after insert or update or delete on public.payouts
  for each row execute function private.audit();

create or replace function public.audit_entries(
  p_table text default null,
  p_limit integer default 100
) returns table (
  id bigint, at timestamptz, actor_id uuid, action text, table_name text,
  row_key text, old_row jsonb, new_row jsonb
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('admin') then
    perform private.fail('forbidden');
  end if;
  return query
    select a.id, a.at, a.actor_id, a.action, a.table_name, a.row_key, a.old_row, a.new_row
    from private.audit_log a
    where p_table is null or a.table_name = p_table
    order by a.id desc
    limit least(greatest(p_limit, 1), 500);
end;
$$;
