-- Access control: table privileges and row-level-security policies.
--
-- Two locks on every table:
--   1. GRANTs decide which operations a role may attempt at all. Most tables
--      are read-only through the API; writes happen in the checked functions.
--   2. RLS policies decide which rows that role can see or touch.
--
-- There is no service-role key in any client application. Staff are ordinary
-- signed-in users whose extra reach comes from the staff_members table, so it
-- is revocable, auditable and (when enabled) gated on a second factor.
--
-- Policy style: role checks are wrapped in `(select …)` so they are evaluated
-- once per statement, and cross-table checks go through SECURITY DEFINER
-- helpers in `private` to avoid recursive policy evaluation.

-- Start from nothing, whatever defaults the platform applied.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Helpers that policies and invoker-rights functions call as the API roles.
grant execute on function
  private.is_staff(),
  private.has_staff_role(public.staff_role[]),
  private.is_seller_member(uuid),
  private.is_seller_admin(uuid),
  private.my_seller_ids(),
  private.my_driver_id(),
  private.my_warehouse_ids(),
  private.works_at(uuid),
  private.drives_route(uuid),
  private.fold(text),
  private.like_escape(text),
  private.category_descendants(text),
  private.fail(text, text)
to anon, authenticated;

-- Every table: RLS on, and forced, so even the table owner is subject to it
-- when acting through a non-bypass role.
do $$
declare
  t record;
begin
  for t in
    select schemaname, tablename from pg_tables where schemaname in ('public', 'private')
  loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end
$$;

-- ═══ Reference data: readable by everyone, changed only by staff ═══════════

grant select on
  public.app_settings, public.provinces, public.cantons, public.districts,
  public.delivery_zones, public.holidays, public.zone_closures,
  public.categories, public.brands, public.search_synonyms, public.product_relations,
  public.fee_schedules, public.fee_payment_methods, public.fee_fulfillment_tiers
to anon, authenticated;

grant insert, update, delete on
  public.app_settings, public.delivery_zones, public.holidays, public.zone_closures,
  public.districts, public.cantons,
  public.categories, public.brands, public.search_synonyms,
  public.fee_schedules, public.fee_payment_methods, public.fee_fulfillment_tiers
to authenticated;

create policy "read" on public.app_settings for select using (true);
create policy "admin writes" on public.app_settings for all to authenticated
  using ((select private.has_staff_role('admin'))) with check ((select private.has_staff_role('admin')));

create policy "read" on public.provinces for select using (true);
create policy "read" on public.cantons for select using (true);
create policy "read" on public.districts for select using (true);
create policy "read" on public.delivery_zones for select using (true);
create policy "read" on public.holidays for select using (true);
create policy "read" on public.zone_closures for select using (true);

create policy "ops writes" on public.cantons for update to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));
create policy "ops writes" on public.districts for update to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));
create policy "ops writes" on public.delivery_zones for all to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));
create policy "ops writes" on public.holidays for all to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));
create policy "ops writes" on public.zone_closures for all to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));

create policy "read active" on public.categories for select
  using (active or (select private.is_staff()));
create policy "catalog writes" on public.categories for all to authenticated
  using ((select private.has_staff_role('catalog'))) with check ((select private.has_staff_role('catalog')));
create policy "read" on public.brands for select using (true);
create policy "catalog writes" on public.brands for all to authenticated
  using ((select private.has_staff_role('catalog'))) with check ((select private.has_staff_role('catalog')));
create policy "read" on public.search_synonyms for select using (true);
create policy "catalog writes" on public.search_synonyms for all to authenticated
  using ((select private.has_staff_role('catalog'))) with check ((select private.has_staff_role('catalog')));
create policy "read" on public.product_relations for select using (true);

-- Fees are published: anyone can read exactly what a seller is charged.
create policy "read" on public.fee_schedules for select using (true);
create policy "read" on public.fee_payment_methods for select using (true);
create policy "read" on public.fee_fulfillment_tiers for select using (true);
create policy "finance writes" on public.fee_schedules for all to authenticated
  using ((select private.has_staff_role('finance'))) with check ((select private.has_staff_role('finance')));
create policy "finance writes" on public.fee_payment_methods for all to authenticated
  using ((select private.has_staff_role('finance'))) with check ((select private.has_staff_role('finance')));
create policy "finance writes" on public.fee_fulfillment_tiers for all to authenticated
  using ((select private.has_staff_role('finance'))) with check ((select private.has_staff_role('finance')));

-- ═══ Identity ═══════════════════════════════════════════════════════════════

grant select on public.profiles to authenticated;
-- A user edits only these fields; `phone_verified_at` is set by verification alone.
grant update (full_name, phone, locale, marketing_opt_in) on public.profiles to authenticated;

create policy "own profile, or staff" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select, insert, update, delete on public.staff_members to authenticated;
create policy "own row, or admin" on public.staff_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_staff_role('admin')));
create policy "admin manages staff" on public.staff_members for all to authenticated
  using ((select private.has_staff_role('admin'))) with check ((select private.has_staff_role('admin')));

grant select on public.sellers to anon, authenticated;
grant update (trade_name, description, logo_path) on public.sellers to authenticated;
create policy "active sellers are public" on public.sellers for select
  using (status = 'active'
         or (select private.is_staff())
         or id in (select private.my_seller_ids()));
create policy "seller admins edit the shop front" on public.sellers for update to authenticated
  using ((select private.is_seller_admin(id))) with check ((select private.is_seller_admin(id)));

grant select on public.seller_private to authenticated;
grant update (contact_email, contact_phone, fiscal_address, postal_code, economic_activity_code,
              payout_iban, payout_holder_name, sinpe_movil_number, tax_regime)
  on public.seller_private to authenticated;
create policy "members and staff" on public.seller_private for select to authenticated
  using ((select private.is_seller_member(seller_id))
         or (select private.has_staff_role('ops', 'finance', 'support')));
create policy "seller admins edit details" on public.seller_private for update to authenticated
  using ((select private.is_seller_admin(seller_id)))
  with check ((select private.is_seller_admin(seller_id)));

grant select, insert, update, delete on public.seller_members to authenticated;
create policy "members and staff" on public.seller_members for select to authenticated
  using ((select private.is_seller_member(seller_id)) or (select private.is_staff()));
-- Admins manage the team but can never create, alter or remove an owner.
create policy "seller admins add members" on public.seller_members for insert to authenticated
  with check ((select private.is_seller_admin(seller_id)) and role <> 'owner');
create policy "seller admins change members" on public.seller_members for update to authenticated
  using ((select private.is_seller_admin(seller_id)) and role <> 'owner')
  with check ((select private.is_seller_admin(seller_id)) and role <> 'owner');
create policy "seller admins remove members" on public.seller_members for delete to authenticated
  using ((select private.is_seller_admin(seller_id)) and role <> 'owner');

grant select, insert, update on public.drivers to authenticated;
create policy "own record, or staff" on public.drivers for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_staff_role('ops', 'support')));
create policy "ops manages drivers" on public.drivers for all to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));

grant select, insert on public.consents to authenticated;
grant update (revoked_at) on public.consents to authenticated;
create policy "own consents" on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_staff_role('support')));
create policy "record own consent" on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and revoked_at is null);
create policy "withdraw own consent" on public.consents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update on public.addresses to authenticated;
create policy "own addresses" on public.addresses for select to authenticated
  using ((user_id = (select auth.uid()) and deleted_at is null)
         or (select private.has_staff_role('support')));
create policy "add own address" on public.addresses for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "edit own address" on public.addresses for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ═══ Catalogue ══════════════════════════════════════════════════════════════

grant select on public.products, public.product_images, public.skus, public.offers
  to anon, authenticated;

-- Sellers write listing content only. Search, summary and ranking columns are
-- maintained by the system and are not writable through the API by anyone.
grant insert (slug, title, description, bullet_points, brand_id, category_id, attributes, status,
              created_by_seller_id, tax_rate_bps, warranty_months, made_in_cr)
  on public.products to authenticated;
grant update (slug, title, description, bullet_points, brand_id, category_id, attributes, status,
              tax_rate_bps, warranty_months, made_in_cr)
  on public.products to authenticated;

create policy "active products are public" on public.products for select
  using (status = 'active'
         or (select private.is_staff())
         or created_by_seller_id in (select private.my_seller_ids()));
create policy "sellers create listings" on public.products for insert to authenticated
  with check ((select private.is_seller_member(created_by_seller_id))
              or (select private.has_staff_role('catalog')));
create policy "sellers edit their listings" on public.products for update to authenticated
  using (created_by_seller_id in (select private.my_seller_ids())
         or (select private.has_staff_role('catalog')))
  with check (created_by_seller_id in (select private.my_seller_ids())
              or (select private.has_staff_role('catalog')));

grant insert, update, delete on public.product_images to authenticated;
-- Visibility follows the product: the subquery is itself filtered by the policy above.
create policy "follows product" on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_images.product_id));
create policy "listing owner writes" on public.product_images for all to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_images.product_id
      and (p.created_by_seller_id in (select private.my_seller_ids())
           or (select private.has_staff_role('catalog')))))
  with check (exists (
    select 1 from public.products p
    where p.id = product_images.product_id
      and (p.created_by_seller_id in (select private.my_seller_ids())
           or (select private.has_staff_role('catalog')))));

grant insert (product_id, code, gtin, variant_name, variant_attributes, weight_grams, length_cm,
              width_cm, height_cm, active)
  on public.skus to authenticated;
grant update (gtin, variant_name, variant_attributes, weight_grams, length_cm, width_cm,
              height_cm, active)
  on public.skus to authenticated;
create policy "follows product" on public.skus for select
  using (exists (select 1 from public.products p where p.id = skus.product_id));
create policy "listing owner adds variants" on public.skus for insert to authenticated
  with check (exists (
    select 1 from public.products p
    where p.id = skus.product_id
      and (p.created_by_seller_id in (select private.my_seller_ids())
           or (select private.has_staff_role('catalog')))));
create policy "listing owner edits variants" on public.skus for update to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = skus.product_id
      and (p.created_by_seller_id in (select private.my_seller_ids())
           or (select private.has_staff_role('catalog')))))
  with check (exists (
    select 1 from public.products p
    where p.id = skus.product_id
      and (p.created_by_seller_id in (select private.my_seller_ids())
           or (select private.has_staff_role('catalog')))));

grant insert (sku_id, seller_id, price_minor, list_price_minor, condition, fulfillment,
              handling_days, seller_sku, status)
  on public.offers to authenticated;
grant update (price_minor, list_price_minor, fulfillment, handling_days, seller_sku, status)
  on public.offers to authenticated;
-- An offer is public when it is active and its seller is. The seller subquery
-- is filtered by the sellers policy, which shows the public only active sellers.
create policy "live offers are public" on public.offers for select
  using ((status = 'active' and exists (
            select 1 from public.sellers s where s.id = offers.seller_id and s.status = 'active'))
         or (select private.is_seller_member(seller_id))
         or (select private.is_staff()));
create policy "sellers make offers" on public.offers for insert to authenticated
  with check ((select private.is_seller_member(seller_id)));
create policy "sellers change their offers" on public.offers for update to authenticated
  using ((select private.is_seller_member(seller_id)))
  with check ((select private.is_seller_member(seller_id)));

-- ═══ Inventory and warehouse ════════════════════════════════════════════════

grant select on
  public.warehouses, public.warehouse_staff, public.warehouse_locations, public.stock_levels,
  public.bin_stock, public.stock_movements, public.inbound_shipments,
  public.inbound_shipment_lines, public.inventory_reservations, public.pick_tasks
to authenticated;

grant insert (code, name, kind, seller_id, address, postal_code, lat, lng, active)
  on public.warehouses to authenticated;
grant update (name, address, postal_code, lat, lng, active) on public.warehouses to authenticated;
create policy "visible warehouses" on public.warehouses for select to authenticated
  using ((kind = 'platform' and active)
         or (seller_id is not null and (select private.is_seller_member(seller_id)))
         or (select private.works_at(id))
         or (select private.is_staff()));
create policy "sellers and ops add locations" on public.warehouses for insert to authenticated
  with check ((kind = 'seller' and (select private.is_seller_admin(seller_id)))
              or (select private.has_staff_role('ops')));
create policy "sellers and ops edit locations" on public.warehouses for update to authenticated
  using ((kind = 'seller' and (select private.is_seller_admin(seller_id)))
         or (select private.has_staff_role('ops')))
  with check ((kind = 'seller' and (select private.is_seller_admin(seller_id)))
              or (select private.has_staff_role('ops')));

grant insert, delete on public.warehouse_staff to authenticated;
create policy "own assignment, or staff" on public.warehouse_staff for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_staff_role('ops')));
create policy "ops assigns staff" on public.warehouse_staff for all to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));

grant insert, update on public.warehouse_locations to authenticated;
create policy "warehouse team" on public.warehouse_locations for select to authenticated
  using ((select private.works_at(warehouse_id)) or (select private.has_staff_role('ops')));
create policy "ops defines locations" on public.warehouse_locations for all to authenticated
  using ((select private.has_staff_role('ops'))) with check ((select private.has_staff_role('ops')));

-- Stock is read-only through the API; it changes only in the stock functions.
create policy "owner, site team or staff" on public.stock_levels for select to authenticated
  using ((select private.is_seller_member(seller_id))
         or (select private.works_at(warehouse_id))
         or (select private.has_staff_role('ops', 'support')));
create policy "owner, site team or staff" on public.bin_stock for select to authenticated
  using ((select private.is_seller_member(seller_id))
         or (select private.has_staff_role('ops'))
         or exists (select 1 from public.warehouse_locations wl
                    where wl.id = bin_stock.location_id and (select private.works_at(wl.warehouse_id))));
create policy "owner, site team or staff" on public.stock_movements for select to authenticated
  using ((select private.is_seller_member(seller_id))
         or (select private.works_at(warehouse_id))
         or (select private.has_staff_role('ops')));
create policy "owner, site team or staff" on public.inbound_shipments for select to authenticated
  using ((select private.is_seller_member(seller_id))
         or (select private.works_at(warehouse_id))
         or (select private.has_staff_role('ops')));
create policy "follows inbound shipment" on public.inbound_shipment_lines for select to authenticated
  using (exists (select 1 from public.inbound_shipments s
                 where s.id = inbound_shipment_lines.inbound_shipment_id));
create policy "owner, site team or staff" on public.inventory_reservations for select to authenticated
  using ((select private.is_seller_member(seller_id))
         or (select private.works_at(warehouse_id))
         or (select private.has_staff_role('ops', 'support')));
create policy "site team or staff" on public.pick_tasks for select to authenticated
  using ((select private.works_at(warehouse_id)) or (select private.has_staff_role('ops', 'support')));

-- ═══ Orders ═════════════════════════════════════════════════════════════════
-- Read-only through the API. Orders are created and changed by functions.

grant select on
  public.orders, public.order_items, public.payments, public.shipments, public.shipment_items,
  public.order_events
to authenticated;

create policy "own orders, or staff" on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_staff_role('ops', 'support', 'finance')));

-- A seller sees the lines they sold, but has no path from a line to the order's
-- delivery details: the orders policy above does not include them.
create policy "buyer, seller of the line, or staff" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id)
         or (select private.is_seller_member(seller_id)));

create policy "follows order" on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = payments.order_id));

create policy "buyer, origin, driver or staff" on public.shipments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = shipments.order_id)
         or (seller_id is not null and (select private.is_seller_member(seller_id)))
         or (select private.works_at(origin_warehouse_id))
         -- A driver sees the parcels on routes they can see. The outer column is
         -- qualified on purpose: route_stops has its own `id`, which would capture a bare one.
         or exists (select 1 from public.route_stops rs where rs.shipment_id = shipments.id));

create policy "follows shipment" on public.shipment_items for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_items.shipment_id));

create policy "customer timeline, or staff" on public.order_events for select to authenticated
  using ((select private.has_staff_role('ops', 'support', 'finance'))
         or (visible_to_customer and exists (
               select 1 from public.orders o
               where o.id = order_events.order_id and o.user_id = (select auth.uid()))));

-- ═══ Delivery ═══════════════════════════════════════════════════════════════

grant select on public.routes, public.route_stops, public.driver_positions, public.driver_settlements
  to authenticated;

create policy "assigned driver, or staff" on public.routes for select to authenticated
  using ((select private.drives_route(id)) or (select private.has_staff_role('ops', 'support', 'finance')));

-- A driver reads a stop's name, phone and directions only while the route is
-- theirs to drive, and for a day afterwards to resolve disputes. Then it closes.
create policy "driver during the route, or staff" on public.route_stops for select to authenticated
  using ((select private.has_staff_role('ops', 'support'))
         or ((select private.drives_route(route_id))
             and exists (
               select 1 from public.routes r
               where r.id = route_stops.route_id
                 and (r.status in ('assigned', 'in_progress')
                      or (r.status = 'completed' and r.completed_at > now() - interval '24 hours')))));

create policy "own position, or ops" on public.driver_positions for select to authenticated
  using (driver_id = (select private.my_driver_id()) or (select private.has_staff_role('ops')));

create policy "own settlement, or staff" on public.driver_settlements for select to authenticated
  using (driver_id = (select private.my_driver_id()) or (select private.has_staff_role('ops', 'finance')));

-- ═══ Finance ════════════════════════════════════════════════════════════════

grant select on
  public.seller_order_fees, public.ledger_accounts, public.ledger_transactions,
  public.ledger_entries, public.payouts, public.electronic_invoices
to authenticated;
grant insert, update on public.payouts to authenticated;

create policy "seller statement, or finance" on public.seller_order_fees for select to authenticated
  using ((select private.is_seller_member(seller_id)) or (select private.has_staff_role('finance')));
create policy "finance only" on public.ledger_accounts for select to authenticated
  using ((select private.has_staff_role('finance')));
create policy "finance only" on public.ledger_transactions for select to authenticated
  using ((select private.has_staff_role('finance')));
create policy "finance only" on public.ledger_entries for select to authenticated
  using ((select private.has_staff_role('finance')));
create policy "seller payouts, or finance" on public.payouts for select to authenticated
  using ((select private.is_seller_member(seller_id)) or (select private.has_staff_role('finance')));
create policy "finance manages payouts" on public.payouts for all to authenticated
  using ((select private.has_staff_role('finance'))) with check ((select private.has_staff_role('finance')));
create policy "buyer, issuer or finance" on public.electronic_invoices for select to authenticated
  using ((select private.has_staff_role('finance'))
         or (issuer_seller_id is not null and (select private.is_seller_member(issuer_seller_id)))
         or exists (select 1 from public.orders o
                    where o.id = electronic_invoices.order_id and o.user_id = (select auth.uid())));

-- ═══ Trust ══════════════════════════════════════════════════════════════════

grant select on public.reviews to anon, authenticated;
grant update (status, moderation_note) on public.reviews to authenticated;
create policy "published reviews are public" on public.reviews for select
  using (status = 'published'
         or user_id = (select auth.uid())
         or (select private.has_staff_role('support', 'catalog')));
create policy "staff moderate" on public.reviews for update to authenticated
  using ((select private.has_staff_role('support', 'catalog')))
  with check ((select private.has_staff_role('support', 'catalog')));

grant select on public.return_requests to authenticated;
grant update (status, resolution_note, resolved_at) on public.return_requests to authenticated;
create policy "buyer, seller of the item, or staff" on public.return_requests for select to authenticated
  using (user_id = (select auth.uid())
         or (select private.has_staff_role('support', 'ops'))
         or exists (select 1 from public.order_items i
                    where i.id = return_requests.order_item_id
                      and (select private.is_seller_member(i.seller_id))));
create policy "support resolves" on public.return_requests for update to authenticated
  using ((select private.has_staff_role('support'))) with check ((select private.has_staff_role('support')));

grant select on public.complaints to authenticated;
grant insert (user_id, order_id, category, description) on public.complaints to authenticated;
grant update (status, resolution, resolved_at) on public.complaints to authenticated;
create policy "own complaints, or staff" on public.complaints for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_staff_role('support')));
create policy "file a complaint" on public.complaints for insert to authenticated
  with check (user_id = (select auth.uid())
              and (order_id is null or exists (
                     select 1 from public.orders o
                     where o.id = complaints.order_id and o.user_id = (select auth.uid()))));
create policy "support resolves" on public.complaints for update to authenticated
  using ((select private.has_staff_role('support'))) with check ((select private.has_staff_role('support')));

-- Anyone can report content, signed in or not; only staff read the queue.
grant insert (reporter_id, reporter_email, target_type, target_id, reason, details)
  on public.content_reports to anon, authenticated;
grant select on public.content_reports to authenticated;
grant update (status, resolution, resolved_by, resolved_at) on public.content_reports to authenticated;
create policy "anyone reports" on public.content_reports for insert
  with check ((reporter_id is null and reporter_email is not null)
              or reporter_id = (select auth.uid()));
create policy "own reports, or staff" on public.content_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select private.has_staff_role('support', 'catalog')));
create policy "staff act on reports" on public.content_reports for update to authenticated
  using ((select private.has_staff_role('support', 'catalog')))
  with check ((select private.has_staff_role('support', 'catalog')));

-- ═══ Functions ══════════════════════════════════════════════════════════════

-- Open to visitors: browsing needs no account.
grant execute on function
  public.search_products(text, text, bigint, bigint, boolean, boolean, text, integer, integer),
  public.suggest_products(text, integer),
  public.delivery_estimate(text, integer)
to anon, authenticated;

-- Signed-in users. Each function checks for itself who may do what.
grant execute on function
  public.create_seller(text, text, text, public.identification_type, text, text, text, text),
  public.seller_set_stock(uuid, uuid, integer),
  public.seller_create_inbound(uuid, uuid, jsonb, date),
  public.seller_order_lines(uuid, integer, integer),
  public.seller_mark_packed(uuid, integer, smallint),
  public.seller_reply_review(uuid, text),
  public.wms_receive(uuid, integer, integer, uuid),
  public.wms_adjust_stock(uuid, uuid, uuid, integer, text),
  public.wms_start_picking(uuid),
  public.wms_confirm_pick(uuid, integer, uuid),
  public.wms_pack_shipment(uuid, integer, smallint),
  public.place_order(jsonb, uuid, public.payment_method, text, bigint),
  public.confirm_sandbox_payment(uuid),
  public.cancel_order(uuid, text),
  public.submit_review(uuid, smallint, text, text),
  public.request_return(uuid, text, integer, text),
  public.ops_create_route(date, uuid, jsonb, uuid, numeric, integer),
  public.ops_assign_route(uuid, uuid),
  public.ops_settle_route(uuid, bigint, text),
  public.ops_return_shipment(uuid),
  public.ops_review_product(uuid, boolean, text),
  public.ops_set_seller_status(uuid, public.seller_status, text),
  public.driver_start_route(uuid),
  public.driver_arrive(uuid),
  public.driver_complete_stop(uuid, text, text, bigint, text, double precision, double precision),
  public.driver_fail_stop(uuid, text, double precision, double precision),
  public.driver_report_position(double precision, double precision, real),
  public.audit_entries(text, integer)
to authenticated;
