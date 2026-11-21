-- Staff decisions that change what the public can see or who can sell.
-- Each goes through a function so it is checked, complete and audited.

-- Sellers cannot publish their own listings: a new product goes live only when
-- catalogue staff approve it.
create or replace function private.guard_product_status() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (new.status = 'active' or old.status = 'rejected' and new.status not in ('draft', 'pending_review'))
     and (select auth.uid()) is not null
     and not private.has_staff_role('catalog') then
    raise exception using errcode = 'P0001', message = 'listing_needs_review';
  end if;
  if new.status = 'active' and old.status is distinct from 'active' then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

create trigger products_guard_status before update of status on public.products
  for each row execute function private.guard_product_status();

create or replace function private.guard_product_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status not in ('draft', 'pending_review')
     and (select auth.uid()) is not null
     and not private.has_staff_role('catalog') then
    raise exception using errcode = 'P0001', message = 'listing_needs_review';
  end if;
  if new.status = 'active' then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

create trigger products_guard_insert before insert on public.products
  for each row execute function private.guard_product_insert();

create or replace function public.ops_review_product(
  p_product_id uuid,
  p_approve boolean,
  p_reason text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('catalog') then
    perform private.fail('forbidden');
  end if;
  if not p_approve and coalesce(char_length(trim(p_reason)), 0) < 5 then
    -- The seller is owed an explanation they can act on.
    perform private.fail('reason_required');
  end if;

  update public.products
  set status = case when p_approve then 'active' else 'rejected' end::public.product_status,
      rejection_reason = case when p_approve then null else trim(p_reason) end
  where id = p_product_id and status in ('pending_review', 'active', 'rejected');
  if not found then
    perform private.fail('product_not_reviewable');
  end if;

  perform private.emit('product.reviewed',
    jsonb_build_object('product_id', p_product_id, 'approved', p_approve));
end;
$$;

-- Approves, suspends or reinstates a seller, recording the identity check.
create or replace function public.ops_set_seller_status(
  p_seller_id uuid,
  p_status public.seller_status,
  p_note text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_kyc public.kyc_status;
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;

  select kyc_status into v_kyc from public.seller_private where seller_id = p_seller_id;
  if not found then
    perform private.fail('seller_not_found');
  end if;

  if p_status = 'active' then
    -- Activating a seller is the identity decision: the platform must know who
    -- is selling, both for shoppers and for its reporting duty to Hacienda.
    update public.seller_private
    set kyc_status = 'verified', kyc_notes = nullif(trim(p_note), ''),
        hacienda_verified_at = coalesce(hacienda_verified_at, now())
    where seller_id = p_seller_id;
  elsif p_status in ('suspended', 'closed') and coalesce(char_length(trim(p_note)), 0) < 5 then
    perform private.fail('reason_required');
  end if;

  update public.sellers
  set status = p_status,
      approved_at = case when p_status = 'active' then coalesce(approved_at, now()) else approved_at end
  where id = p_seller_id;

  perform private.emit('seller.status_changed',
    jsonb_build_object('seller_id', p_seller_id, 'status', p_status, 'note', p_note));
end;
$$;

create or replace function public.seller_reply_review(p_review_id uuid, p_reply text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller uuid;
begin
  select i.seller_id into v_seller
  from public.reviews r join public.order_items i on i.id = r.order_item_id
  where r.id = p_review_id;
  if v_seller is null or not private.is_seller_member(v_seller) then
    perform private.fail('review_not_found');
  end if;
  if coalesce(char_length(trim(p_reply)), 0) not between 2 and 2000 then
    perform private.fail('invalid_reply');
  end if;
  update public.reviews
  set seller_reply = trim(p_reply), seller_replied_at = now()
  where id = p_review_id;
end;
$$;

-- A changed phone number is an unverified phone number.
create or replace function private.profiles_phone_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is distinct from old.phone then
    new.phone_verified_at := null;
  end if;
  return new;
end;
$$;

create trigger profiles_phone_guard before update of phone on public.profiles
  for each row execute function private.profiles_phone_guard();

-- Refreshes the popularity signal search ranking uses. Runs nightly.
create or replace function private.refresh_product_signals() returns void
language sql security definer
set search_path = ''
as $$
  update public.products p
  set units_sold_30d = coalesce(s.units, 0)
  from public.products p2
  left join (
    select i.product_id, sum(i.quantity)::integer as units
    from public.order_items i
    join public.orders o on o.id = i.order_id
    where o.placed_at > now() - interval '30 days'
      and o.status not in ('pending_payment', 'payment_review', 'cancelled', 'refunded')
    group by i.product_id
  ) s on s.product_id = p2.id
  where p.id = p2.id and p.units_sold_30d is distinct from coalesce(s.units, 0);
$$;

-- Releases stock held by unpaid orders, every five minutes, where the platform
-- provides a scheduler. Elsewhere (local development) call the function by hand.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'expire-unpaid-orders', '*/5 * * * *', 'select private.expire_unpaid_orders()');
    perform cron.schedule(
      'refresh-product-signals', '17 8 * * *', 'select private.refresh_product_signals()');
  else
    raise notice 'pg_cron is not available here; unpaid orders will not expire automatically.';
  end if;
exception when others then
  raise notice 'Could not schedule expire-unpaid-orders: %', sqlerrm;
end
$$;
