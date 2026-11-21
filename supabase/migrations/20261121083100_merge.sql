-- Merge of the hardening work (082800 lockdown, 082900 integrity, 083000
-- limits) with the features applied before it (082500 account security,
-- 082600 notifications, 082700 product photos). Those three are applied on
-- the hosted project and are not edited any more; what of them had to change
-- because of the hardening is here.
--
-- Account deletion was written before the refund register, the private
-- delivery codes, shop invitations and shop-change requests existed. It now
-- also erases or anonymises what those hold about the person, and a shop
-- closed because nobody is left in charge also loses its open invitations and
-- requests.

-- ═══ 1. Closing a shop nobody is left in charge of ═════════════════════════
-- The same function as in 20261121082700_product_photos.sql, with one
-- addition: the shop's invitations and change requests (083000) go, as its
-- payout-account requests already did. They hold e-mail addresses, phone
-- numbers and an address someone typed, and a closed shop can act on none of
-- them. Keep the two in step if either changes again.
create or replace function private.close_abandoned_shop(p_seller_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product uuid;
begin
  update public.sellers s set status = 'closed' where s.id = p_seller_id and s.status <> 'closed';
  delete from public.payout_detail_requests r where r.seller_id = p_seller_id;
  -- What the limits migration (083000) added: invitations to join the shop and
  -- requests to change its name, fiscal details or contact.
  delete from public.seller_invitations i where i.seller_id = p_seller_id;
  delete from public.seller_change_requests r where r.seller_id = p_seller_id;
  -- The shop's photos (082700): nothing it left waiting for review goes on,
  -- and what it published goes too, unless another shop still sells that
  -- listing, which keeps its pictures. Removed photos' files become
  -- disposable; the console deletes them through the storage API (no
  -- database function can), keeping the public copy of any photo a past order
  -- still shows. Their descriptions go: they may describe the person.
  for v_product in
    update public.product_photos ph
    set state = 'removed', live_position = null, remove_requested_at = null,
        alt = null, live_alt = null
    where ph.seller_id = p_seller_id
      and ph.state in ('uploading', 'pending', 'approved')
      and not (ph.state = 'approved' and ph.published_at is not null
               and exists (select 1 from public.offers o
                           join public.skus k on k.id = o.sku_id
                           where k.product_id = ph.product_id and o.seller_id <> p_seller_id
                             and o.status = 'active'))
    returning ph.product_id
  loop
    perform private.sync_product_images(v_product);
  end loop;
  if not exists (select 1 from public.order_items i where i.seller_id = p_seller_id)
     and not exists (select 1 from public.payouts po where po.seller_id = p_seller_id)
     and not exists (select 1 from public.ledger_entries e
                     join public.ledger_accounts a on a.id = e.account_id
                     where a.seller_id = p_seller_id) then
    delete from public.seller_private sp where sp.seller_id = p_seller_id;
  else
    update public.seller_private sp
    set contact_email = p_seller_id::text || '@tienda-cerrada.invalid',
        contact_phone = '+50620000000',
        fiscal_address = 'Eliminada junto con la cuenta.',
        postal_code = null, payout_iban = null, payout_holder_name = null,
        sinpe_movil_number = null, kyc_notes = null
    where sp.seller_id = p_seller_id;
  end if;
end;
$$;

revoke all on function private.close_abandoned_shop(uuid) from public, anon, authenticated;

-- ═══ 2. Deleting an account ════════════════════════════════════════════════
-- The same function as in 20261121082600_notifications.sql, with these
-- additions, each marked below:
--   * the delivery codes of the person's orders (082900) go: every order is
--     closed by then (the blockers see to it), so no code is needed any more.
--     The log of wrong attempts stays: it names drivers, not the shopper, and
--     is how staff look into a driver.
--   * invitations to join a shop sent to the person (083000) go, whatever
--     their state: they hold the address. Invitations the person sent stop
--     being valid with their membership and are marked withdrawn.
--   * the person's requests to change a shop's name, fiscal details or
--     contact that never took effect lose what they proposed; one still
--     waiting is withdrawn. An approved request is the shop's history and
--     stays with the shop, as the shop's own details do.
--   * the refund register (082900) keeps every amount and what it refunded;
--     it names no person except as the bare id of who booked it, like the
--     ledger. Nothing to change there.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_blockers text[];
  v_orders integer;
  v_reviews integer;
  v_shop uuid;
begin
  if v_user is null then
    perform private.fail('not_authenticated');
  end if;
  -- An account with a second factor is deleted only from a session that passed it.
  if not private.factor_ok() then
    perform private.fail('second_factor_required');
  end if;
  -- One deletion at a time per account, and none for an account already gone.
  -- Requests of this account in flight hold this row FOR KEY SHARE (see
  -- check_request), so the deletion waits for them and they cannot follow it.
  select u.email into v_email from auth.users u where u.id = v_user and u.deleted_at is null for update;
  if not found then
    perform private.fail('not_authenticated');
  end if;

  v_blockers := private.account_deletion_blockers(v_user);
  -- The first reason wins; each is spelled out so the client's list of
  -- messages can be checked against this file.
  case v_blockers[1]
    when 'account_is_staff' then perform private.fail('account_is_staff');
    when 'account_is_driver' then perform private.fail('account_is_driver');
    when 'account_is_warehouse_staff' then perform private.fail('account_is_warehouse_staff');
    when 'account_has_open_orders' then perform private.fail('account_has_open_orders');
    when 'account_has_open_returns' then perform private.fail('account_has_open_returns');
    when 'account_has_pending_refund' then perform private.fail('account_has_pending_refund');
    when 'account_has_open_complaints' then perform private.fail('account_has_open_complaints');
    when 'account_runs_open_shop' then perform private.fail('account_runs_open_shop');
    when 'account_shop_has_stock' then perform private.fail('account_shop_has_stock');
    when 'account_shop_has_open_orders' then perform private.fail('account_shop_has_open_orders');
    when 'account_shop_has_balance' then perform private.fail('account_shop_has_balance');
    else null; -- nothing in the way
  end case;

  select count(*) into v_orders from public.orders o where o.user_id = v_user;
  select count(*) into v_reviews from public.reviews r where r.user_id = v_user;

  -- Personal data the platform holds for the person.
  update public.profiles
  set full_name = null, phone = null, phone_verified_at = null,
      marketing_opt_in = false, locale = 'es-CR'
  where id = v_user;
  delete from public.addresses a where a.user_id = v_user;
  delete from public.consents c where c.user_id = v_user;

  -- Kept records, without the person in them. The district stays (it decided
  -- the shipping fee); the pin is rounded to about a kilometre.
  update public.orders o
  set ship_recipient_name = 'Cuenta eliminada', ship_phone = '', ship_senas = '',
      ship_lat = round(o.ship_lat::numeric, 2)::double precision,
      ship_lng = round(o.ship_lng::numeric, 2)::double precision,
      ship_plus_code = null
  where o.user_id = v_user;
  update public.route_stops rs
  set recipient_name = 'Cuenta eliminada', phone = '', senas = '',
      lat = round(rs.lat::numeric, 2)::double precision,
      lng = round(rs.lng::numeric, 2)::double precision,
      plus_code = null, pod_recipient_name = null,
      pod_lat = null, pod_lng = null
  where rs.shipment_id in (
    select sh.id from public.shipments sh
    join public.orders o on o.id = sh.order_id
    where o.user_id = v_user);
  update public.return_requests r set reason = null where r.user_id = v_user;
  update public.complaints c
  set description = 'Texto eliminado junto con la cuenta.'
  where c.user_id = v_user;
  update public.content_reports cr set reporter_email = null
  where cr.reporter_id = v_user;
  -- [082900] The delivery codes of the person's orders, all closed by now.
  delete from private.delivery_codes c
  using public.orders o
  where o.id = c.order_id and o.user_id = v_user;
  -- [083000] Invitations sent to the person, to their account or to their address.
  delete from public.seller_invitations i
  where i.invitee_id = v_user or (i.invitee_id is null and lower(i.email) = lower(v_email));
  -- [083000] Their shop-change requests that never took effect keep nothing
  -- of what was proposed; a waiting one is withdrawn.
  update public.seller_change_requests r
  set status = case when r.status = 'pending' then 'withdrawn' else r.status end,
      decided_at = coalesce(r.decided_at, now()),
      decided_by = coalesce(r.decided_by, v_user),
      proposed = '{}'::jsonb,
      previous = '{}'::jsonb
  where r.requested_by = v_user and r.status <> 'approved';

  -- Roles that ended earlier: an inactive staff row, a former driver, shops
  -- left behind with nothing pending (the blockers above guarantee that). The
  -- audit trail never held a driver's or a shop's personal columns (see
  -- private.audit), so nothing of them is left there either.
  delete from public.staff_members s where s.user_id = v_user and not s.active;
  update public.drivers d
  set full_name = 'Repartidor retirado', phone = '+50650000000', id_number = '000000000',
      plate = null, license_class = null, license_expires_on = null,
      inspection_expires_on = null, insurance_expires_on = null
  where d.user_id = v_user;
  -- Shops (already suspended or closed: see account_runs_open_shop) this
  -- person leaves with nobody in charge.
  for v_shop in
    select m.seller_id from public.seller_members m
    where m.user_id = v_user
      and not exists (select 1 from public.seller_members o
                      where o.seller_id = m.seller_id and o.user_id <> v_user
                        and o.role in ('owner', 'admin'))
  loop
    perform private.close_abandoned_shop(v_shop);
  end loop;
  delete from public.seller_members m where m.user_id = v_user;
  -- [083000] What the person sent is no longer valid without their membership.
  update public.seller_invitations i
  set status = 'revoked', answered_at = now(), answered_by = v_user
  where i.invited_by = v_user and i.status = 'pending';
  delete from private.mfa_failures f where f.user_id = v_user;
  -- What the notifications add about the person (082600).
  perform private.notify_forget_person(v_user);

  -- The sign-in record: every session ends (and with check_request, every
  -- access token issued for them stops working at once), no way to sign in
  -- remains, and the e-mail address is free for a new account. The ban is
  -- finite, as Auth's own bans are: Auth reads banned_until into a Go time
  -- value, which has no 'infinity'.
  delete from auth.sessions s where s.user_id = v_user;
  delete from auth.mfa_factors f where f.user_id = v_user;
  delete from auth.one_time_tokens t where t.user_id = v_user;
  delete from auth.identities i where i.user_id = v_user;
  update auth.users u
  set email = v_user::text || '@cuenta-eliminada.invalid',
      encrypted_password = '',
      phone = null,
      email_change = '', phone_change = '',
      confirmation_token = '', recovery_token = '', email_change_token_new = '',
      email_change_token_current = '', phone_change_token = '', reauthentication_token = '',
      raw_user_meta_data = '{}'::jsonb,
      last_sign_in_at = null,
      banned_until = now() + interval '100 years',
      deleted_at = now(),
      updated_at = now()
  where u.id = v_user;
  -- Auth's own log of sign-ins, where the project still keeps one in the database.
  begin
    delete from auth.audit_log_entries l where l.payload ->> 'actor_id' = v_user::text;
  exception when undefined_table then
    null;
  end;

  insert into private.account_deletions (orders_kept, reviews_kept) values (v_orders, v_reviews);
  return jsonb_build_object('orders_kept', v_orders, 'reviews_kept', v_reviews);
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
