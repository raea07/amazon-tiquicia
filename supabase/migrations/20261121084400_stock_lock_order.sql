-- Stock writers that do not deadlock on product rows or shelves, a product
-- summary that is never stale, a capped unpaid-order sweep, and a route that
-- starts, and a shop that packs its own parcel, in the lock order of the
-- parcels' orders; a seller switching a variant off no longer blocks packing.
--
-- Measured before and after with two real sessions (tools/races, README
-- there; the tables are in the wave 8 report). Every session of the API runs
-- in READ COMMITTED, the database default; nothing here sets another level,
-- and two of the changes below rely on it (said where).
--
-- What this migration decides, and why:
--
--   * PRODUCT ROWS ARE WRITTEN ONLY WHEN THE SUMMARY CHANGES. Every stock
--     write fires private.stock_levels_trigger ->
--     private.refresh_offer_availability (offers.available_quantity) ->
--     trigger offers_summary_refresh -> private.refresh_product_summary, which
--     updated public.products every time. One product row is shared by all its
--     variants and every shop that sells it, and nothing orders product rows,
--     so two transactions writing two such products in opposite order
--     deadlocked on "products" (the race harness's family E at 717048f: 4 to
--     41 in 100 natural rounds, two checkouts 30 in 100, every forced round;
--     with this migration 0 in every one of them). The summary (offer_count,
--     featured_offer_id, min_price_minor, list_price_minor, in_stock,
--     fulfilled_by_platform, best_handling_days) depends on whether an offer
--     has units, never on how many. So:
--       - private.offers_summary_trigger, on UPDATE, refreshes only when an
--         input of the summary really changed: price_minor, list_price_minor,
--         status, fulfillment, handling_days, condition, or available_quantity
--         crossing between zero and more than zero. INSERT and DELETE refresh
--         as before. An ordinary sale (10 units to 9), a receipt or a
--         release that leaves an offer on the same side of zero, and every
--         pack (packing lowers on hand and reserved together, so what
--         shoppers can buy does not move), no longer touches the product row
--         at all;
--       - private.refresh_product_summary writes the row only when a value
--         differs.
--     No lock was added to place_order, packing, cancellation or any other
--     stock writer for this, and place_order is not redefined: every lock
--     added to a core writer in wave 7 created new inversions.
--   * A SUMMARY THAT IS NEVER STALE. refresh_product_summary read the offers
--     first and locked the product row only in its UPDATE. Two transactions
--     taking, at the same moment, the last unit of two DIFFERENT offers of one
--     product each computed the summary without the other's change; the second
--     waited for the first's row lock and then wrote what it had computed
--     before (READ COMMITTED re-checks the row's WHERE, not the values worked
--     out earlier). Both offers ended at 0 while the product said in stock
--     with a featured offer that had none, until the next change to one of its
--     offers (family F at 717048f: 83 in 100 natural rounds, 100 in 100
--     forced; a staff cancellation giving a last unit back against a checkout
--     of another offer ended the other way round, out of stock with stock, 58
--     and 65 in 100; with this migration 0). It now takes the product row FOR NO KEY
--     UPDATE before it reads the offers, so two refreshes of one product run
--     one after the other and the later one computes from what the earlier
--     one committed. This relies on READ COMMITTED and on the function being
--     VOLATILE (the default): each of its statements takes a new snapshot,
--     also inside a trigger in the middle of the caller's statement. The lock
--     is the one its UPDATE always took, taken earlier in the same function,
--     so it adds no lock and no new order; with the change above it is taken
--     far less often.
--   * PRODUCTS IN ONE ORDER WHERE ONE PATH REFRESHES SEVERAL:
--     private.sellers_summary_trigger (a shop approved, suspended or closed)
--     walked the shop's products in no order; it now goes by product id.
--     This is a convention, not a measured fix: no race found depends on it
--     (with or without it a shop's suspension against a writer crossing zero
--     on two of its products deadlocks the same, E7, and taking it out fails
--     no test). It gives every multi-product path one order to follow.
--     private.skus_summary_trigger refreshes one product and is unchanged.
--   * ONE LOCK ORDER FOR STOCK, ORDERS AND SHELVES. Worked out from every
--     stock writer (the table is in docs/04-algorithms/sourcing-and-inventory.md):
--
--       warehouse row (moves and counts only; FOR NO KEY UPDATE)
--       -> location row (FOR SHARE)
--       -> order row (FOR UPDATE)
--       -> its parcel (shipment) row
--       -> its open pick tasks
--       -> stock rows (stock_levels), by product, shop and warehouse
--          [each stock row written takes its offer row and, only when the
--          offer crosses zero, its product row: triggers]
--       -> shelf rows (bin_stock), by product, shop and location.
--
--     A reservation is taken after the order row by the function that owns
--     the order (packing takes them before the stock rows, a cancellation
--     after; both hold the order row first, so they never meet: race H1, a
--     cancellation against a shop packing its own parcel of the same order,
--     and H7, against the warehouse packing it, 0 in 100 natural and every
--     forced round with this migration).
--
--     Two functions did not follow it:
--       - private.cancel_order_internal put picked units back on their
--         shelves BEFORE it took the stock rows and closed the pick tasks
--         after the shelves: a cancellation against a count or a receipt of
--         the same product on the same shelf deadlocked (race C3 at 717048f:
--         6, 9 and 39 in 100 natural rounds, every forced round), and a pick
--         of the order's other line at that moment could leave a unit picked
--         and never put back (race C4: 43 in 100 natural rounds, every forced
--         round; on hand then exceeds the shelves). It now takes, after the
--         order, its open pick tasks and then every stock row it will write
--         (by product, shop and warehouse) before any shelf. Nothing else
--         changes in it. With this migration 0;
--       - public.seller_mark_packed (a shop packing a parcel it ships itself)
--         took the parcel and the stock rows before the order (the order came
--         last, in private.sync_order_status): the shopper or staff cancelling
--         the order at that moment deadlocked with it (race H1 at eaca8ad,
--         this branch before the fix: staff 18 and the shopper 17 in 100
--         natural rounds, every forced round). It now takes the order first,
--         as wms_pack_shipment does since 084200. Nothing else changes in it.
--         With this migration 0. This moves a lock a core stock writer
--         always took (the order, last) to the front, so every writer it can
--         meet on the same order, parcel, stock row, offer or variant was
--         raced, 100 natural and 100 forced rounds each, before and after
--         (family H: a checkout of the same offer, the shop's count, the
--         sweep, the warehouse packing the order's other parcel, the shop
--         pausing the offer or switching off its variant): 0 in every one,
--         before and after.
--   * THE SWEEP IS CAPPED. private.expire_unpaid_orders took every expired
--     order and held their stock rows for its whole run (about 2 ms an order:
--     0.4 s for 200, 2 s for 1000; the hosted API's statement timeout is 8 s
--     for signed-in callers, and a checkout of one of those products waits
--     the whole run). It now cancels at most 200 a run, the oldest first, and
--     returns how many it cancelled; the scheduled job ('expire-unpaid-orders',
--     every five minutes, 20261121081300_moderation.sql) takes the rest on its
--     next runs. Nothing else changes in it.
--   * A ROUTE STARTS IN THE ORDER OF ITS PARCELS' ORDERS. public.driver_start_route
--     took the route, then each parcel, then each order (in
--     private.sync_order_status); every other function that changes a parcel
--     takes the order first. Staff stopping one of the route's parcels at that
--     moment (ops_recall_shipment: the order, the parcel, then the route)
--     deadlocked with it (race G at 717048f: 24 in 100 natural rounds, every
--     forced round; with this migration 0). It
--     now takes the orders of its pending stops first, in id order. Either the
--     stop goes first (the parcel comes back, its stop is skipped, the route
--     starts without it) or the start does (the stop is refused:
--     shipment_not_recallable, "it is on its way"). ops_recall_shipment is
--     unchanged.
--
-- WHAT STILL CAN DEADLOCK ON PRODUCT ROWS (measured with tools/races on a
-- local database of a shared machine, with this migration, natural / forced
-- rounds of 100;
-- the loser rolls back whole and the person reads "nothing was saved, try
-- again", try_again; the sweep runs again five minutes later):
--   - two transactions that EACH take an offer of two shared products across
--     zero (out of stock, or back in stock), in opposite order. Two checkouts
--     of last units (E5: 29 to 33 / 43 to 63 in two runs; before this
--     migration 26 / 74, and then the summary was also wrong in 42 / 26
--     rounds); a staff cancellation giving back last units against such a
--     checkout (E5b: 1 / 65, the same before); by the same mechanism, not
--     raced separately: the sweep against such a checkout (packing never
--     takes an offer across zero);
--   - a staff cancellation or the sweep giving back the last unit of one
--     offer of a product and then writing another offer of
--     the same product, against the seller changing or pausing that second
--     offer at that moment (offer row, then product row) (E6). A checkout
--     does not deadlock with it: place_order takes its offers FOR SHARE before it writes a stock row,
--     so the seller waits (E6: 22 to 26 / 100, before 20 / 100; E6b: 0 / 0);
--   - a shop suspended or reinstated (its products in product-id order)
--     against a writer that takes two of its products across zero in the
--     other order (E7: 1 to 3 / 100; before this migration, when its walk
--     had no order, 1 / 100);
--   - staff merging two brands (public.ops_merge_brands: one UPDATE of every
--     product of the brand, in scan order) against a checkout that holds one
--     of those products after taking its offer across zero and wants another
--     (E11, found by an independent review: natural 0 to 20 in 100 rounds
--     over three runs and the two checkouts tried; forced up to 56 in 100,
--     depending on which session waits first; the same
--     before this migration). Not changed here; the function is outside
--     this migration.
--   * A VARIANT SWITCHED OFF. public.seller_set_variant_active took the
--     product row (private.own_listing, FOR UPDATE), then the variant FOR
--     UPDATE, then paused or resumed the shop's offer on it: the opposite of
--     every stock writer, which takes the offer before the product. Three
--     races came from it, all against a seller switching off a variant two
--     shops sell: packing that holds the offer and wants a key-share lock on
--     the variant through its ledger row (E10, on the merged database: 14 /
--     100 natural, 100 / 100 forced); a checkout of the variant that holds
--     the offer FOR SHARE and wants a key-share lock on the product (E10b:
--     17, then 6 and 14 / 100 natural, every forced round); a count into a
--     location that takes the offer across zero and then wants the product
--     (I8, found by an independent review of the merged tree: 10 / 100
--     natural, 100 / 100 forced with the seller first). It now takes the
--     shop's own offers on the variant first (FOR NO KEY UPDATE, id order,
--     only for a shop the caller belongs to), then the product, then the
--     variant. Taking the offers first is what removes all three: E10, E10b
--     and I8 are 0 / 0 after it, and stay 0 / 0 when the variant is taken
--     FOR UPDATE again (an independent check of the merged tree). The
--     variant is now taken FOR NO KEY UPDATE as well, a precaution no race
--     depends on: the function changes only `active` of the variant, no key
--     column, and deletes nothing, so the weaker lock is enough; a
--     transaction that only references the variant no longer holds the
--     switch up (contract test (ix)), and two changes of one variant still
--     run one after the other (E10c: 0 / 0, one switches it off, the other
--     finds it off). A shop switching off the variant of a parcel it packs
--     itself, H8, 0 / 0 before and after. The other seller
--     functions that call private.own_listing still take the product first;
--     none of them writes an offer after it.
-- Every statement that writes or locks public.products, and the order each
-- path takes, is listed in docs/04-algorithms/sourcing-and-inventory.md.

-- ═══ 1. Product rows only when the summary changes, and never stale ═══════

-- Replaces the version in 20261121083600_seller_listings.sql (which kept the
-- offer order between its markers; offers.parity.test.ts reads them here
-- too). Two changes: the product row is locked before the offers are read,
-- and written only when a value differs.
create or replace function private.refresh_product_summary(p_product_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_best record;
  v_count integer;
begin
  -- The product row first, before any offer is read: two refreshes of one
  -- product run one after the other, and the later one's reads (new
  -- statements, so a new snapshot in READ COMMITTED; this function is
  -- VOLATILE, so that holds inside a trigger in the middle of the caller's
  -- statement) see what the earlier one committed.
  perform 1 from public.products where id = p_product_id for no key update;

  select count(*) into v_count
  from public.offers o
  join public.skus k on k.id = o.sku_id
  join public.sellers s on s.id = o.seller_id
  where k.product_id = p_product_id and k.active
    and o.status = 'active' and s.status = 'active';

  select o.id, o.price_minor, o.list_price_minor, o.fulfillment, o.handling_days,
         (o.available_quantity > 0) as buyable
  into v_best
  from public.offers o
  join public.skus k on k.id = o.sku_id
  join public.sellers s on s.id = o.seller_id
  where k.product_id = p_product_id and k.active
    and o.status = 'active' and s.status = 'active' and o.condition = 'new'
  -- BEGIN offer_order
  order by (o.available_quantity > 0) desc, o.price_minor asc, o.created_at asc, o.id asc
  -- END offer_order
  limit 1;

  update public.products
  set offer_count = v_count,
      featured_offer_id = v_best.id,
      min_price_minor = v_best.price_minor,
      list_price_minor = v_best.list_price_minor,
      in_stock = coalesce(v_best.buyable, false),
      fulfilled_by_platform = coalesce(v_best.fulfillment = 'platform', false),
      best_handling_days = v_best.handling_days
  where id = p_product_id
    -- Written only when a value differs.
    and (offer_count, featured_offer_id, min_price_minor, list_price_minor, in_stock,
         fulfilled_by_platform, best_handling_days)
        is distinct from
        (v_count, v_best.id, v_best.price_minor, v_best.list_price_minor,
         coalesce(v_best.buyable, false), coalesce(v_best.fulfillment = 'platform', false),
         v_best.handling_days);
end;
$$;

-- Replaces the version in 20261121080400_catalog.sql. One change: an UPDATE
-- that changes no input of the summary returns at once. The trigger
-- (offers_summary_refresh) is unchanged.
create or replace function private.offers_summary_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product uuid;
begin
  -- An update that changes no input of the summary leaves the product row
  -- alone: the summary depends on whether an offer has units, never on how
  -- many, so an ordinary sale (10 units to 9) does not touch it.
  if tg_op = 'UPDATE'
     and new.price_minor is not distinct from old.price_minor
     and new.list_price_minor is not distinct from old.list_price_minor
     and new.status is not distinct from old.status
     and new.fulfillment is not distinct from old.fulfillment
     and new.handling_days is not distinct from old.handling_days
     and new.condition is not distinct from old.condition
     and (new.available_quantity > 0) = (old.available_quantity > 0) then
    return null;
  end if;
  select k.product_id into v_product
  from public.skus k where k.id = coalesce(new.sku_id, old.sku_id);
  if v_product is not null then
    perform private.refresh_product_summary(v_product);
  end if;
  return null;
end;
$$;

-- Replaces the version in 20261121080400_catalog.sql. One change: the shop's
-- products are refreshed in product id order.
create or replace function private.sellers_summary_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.status is distinct from old.status then
    for r in
      select distinct k.product_id
      from public.offers o join public.skus k on k.id = o.sku_id
      where o.seller_id = new.id
      -- In product id order, the one order every path that refreshes several
      -- products takes them in.
      order by k.product_id
    loop
      perform private.refresh_product_summary(r.product_id);
    end loop;
  end if;
  return null;
end;
$$;

-- ═══ 2. A cancellation in the lock order of every stock writer ════════════

-- Unchanged from 20261121084300_warehouse_stock.sql except the two lock
-- statements after the order's lock (its open pick tasks, then its stock
-- rows, before any shelf).
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

  -- The lock order of every stock writer (20261121084400): after the order,
  -- its open pick tasks (a pick takes its task before its shelf), then every
  -- stock row this cancellation writes, by product, shop and warehouse, and
  -- only then a shelf (a count and a receipt take the stock row before the
  -- shelf). Before, the shelf came first and a count, a receipt or a pick of
  -- the same product at the same moment could deadlock with it.
  perform 1
  from public.pick_tasks t
  join public.shipments s on s.id = t.shipment_id
  where s.order_id = p_order_id and t.status in ('open', 'in_progress', 'short')
  order by t.id
  for update of t;
  perform 1
  from public.stock_levels l
  where (l.warehouse_id, l.sku_id, l.seller_id) in (
    select res.warehouse_id, res.sku_id, res.seller_id
    from public.inventory_reservations res
    join public.order_items i on i.id = res.order_item_id
    where i.order_id = p_order_id and res.status = 'active'
    union
    select m.warehouse_id, m.sku_id, m.seller_id
    from public.stock_movements m
    join public.shipments s on s.id = m.reference_id
    where s.order_id = p_order_id and s.status = 'picking'
      and m.reason = 'pick' and m.reference_type = 'shipment' and m.from_location_id is not null)
  order by l.sku_id, l.seller_id, l.warehouse_id
  for no key update of l;

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
    order by m.sku_id, m.seller_id, m.from_location_id
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
    order by res.sku_id, res.seller_id, res.warehouse_id
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

-- ═══ 3. The unpaid-order sweep, at most 200 orders a run ══════════════════

-- Unchanged from 20261121084300_warehouse_stock.sql except the cap.
create or replace function private.expire_unpaid_orders() returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_minutes integer := (private.setting('reservation_minutes'))::integer;
  v_orders uuid[];
  v_order uuid;
begin
  select coalesce(array_agg(x.id order by x.placed_at, x.id), '{}') into v_orders
  from (
    select o.id, o.placed_at from public.orders o
    where o.status = 'pending_payment'
      and o.placed_at < now() - make_interval(mins => v_minutes)
    order by o.placed_at
    -- At most 200 a run, the oldest first: the run holds the stock rows of
    -- every order it cancels until it ends, and the next run (five minutes
    -- later) takes the rest.
    limit 200
    for update skip locked
  ) x;

  -- Every stock row these cancellations will write, in the order every
  -- checkout, release, packing and cancellation takes them.
  perform 1
  from public.stock_levels l
  where (l.warehouse_id, l.sku_id, l.seller_id) in (
    select res.warehouse_id, res.sku_id, res.seller_id
    from public.inventory_reservations res
    join public.order_items i on i.id = res.order_item_id
    where i.order_id = any(v_orders) and res.status = 'active')
  order by l.sku_id, l.seller_id, l.warehouse_id
  for no key update of l;

  foreach v_order in array v_orders loop
    perform private.cancel_order_internal(v_order, 'Pago no recibido a tiempo');
  end loop;
  return cardinality(v_orders);
end;
$$;

-- ═══ 4. A route starts with its parcels' orders locked first ══════════════

-- Unchanged from 20261121081100_fulfillment.sql except the lock of the
-- orders before the route.
create or replace function public.driver_start_route(p_route_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not private.drives_route(p_route_id) then
    perform private.fail('route_not_found');
  end if;
  -- The orders of its parcels first, in id order, then the route and the
  -- parcels, as every function that changes a parcel does (the order first:
  -- ops_recall_shipment, ops_remove_route_stop, driver_complete_stop). Before,
  -- it took the route and the parcels first and the orders last, so staff
  -- stopping one of its parcels at that moment deadlocked with it.
  perform 1
  from public.orders o
  where o.id in (
    select s.order_id
    from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
    where rs.route_id = p_route_id and rs.status = 'pending')
  order by o.id
  for update of o;
  update public.routes
  set status = 'in_progress', started_at = now()
  where id = p_route_id and status = 'assigned';
  if not found then
    perform private.fail('route_not_startable');
  end if;

  for r in
    select s.id, s.order_id
    from public.route_stops rs join public.shipments s on s.id = rs.shipment_id
    where rs.route_id = p_route_id and rs.status = 'pending' and s.status = 'ready_for_dispatch'
    order by rs.sequence
  loop
    update public.shipments set status = 'out_for_delivery', dispatched_at = now() where id = r.id;
    perform private.sync_order_status(r.order_id);
  end loop;
end;
$$;

-- ═══ 5. A shop packs its own parcel with the order locked first ═══════════

-- Unchanged from 20261121081100_fulfillment.sql except that the order is
-- locked before the parcel, as wms_pack_shipment does since
-- 20261121084200_order_followups.sql (the parcel is read first without a
-- lock, to find its order and check the caller; a parcel's order and shop
-- never change).
create or replace function public.seller_mark_packed(
  p_shipment_id uuid,
  p_weight_grams integer,
  p_package_count smallint default 1
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ship public.shipments%rowtype;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if not found or v_ship.seller_id is null or not private.is_seller_member(v_ship.seller_id) then
    perform private.fail('shipment_not_found');
  end if;
  -- The order first, then the parcel, its reservations and its stock rows,
  -- as every function that changes a parcel or an order does. Before, it took
  -- the parcel and the stock rows first and the order last (in
  -- private.sync_order_status), so the shopper or staff cancelling the order
  -- at that moment deadlocked with it.
  perform 1 from public.orders where id = v_ship.order_id for update;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.status <> 'pending' then
    perform private.fail('invalid_shipment_state', v_ship.status::text);
  end if;
  if not private.order_is_payable_for_fulfilment(v_ship.order_id) then
    perform private.fail('order_not_ready');
  end if;
  if p_weight_grams is null or p_weight_grams <= 0 or p_package_count < 1 then
    perform private.fail('invalid_package');
  end if;

  update public.shipments set status = 'picking' where id = p_shipment_id;
  perform private.consume_shipment_stock(p_shipment_id);
  update public.shipments
  set status = 'packed', packed_at = now(), weight_grams = p_weight_grams,
      package_count = p_package_count
  where id = p_shipment_id;
  perform private.sync_order_status(v_ship.order_id);
end;
$$;

-- ═══ 6. A seller switching a variant off takes it FOR NO KEY UPDATE ══════

-- Unchanged from 20261121083600_seller_listings.sql except the strength of
-- the variant's lock (section 'A VARIANT SWITCHED OFF' of the header).
create or replace function public.seller_set_variant_active(p_sku_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  p public.products;
  k public.skus%rowtype;
  v_outcome text;
  v_offer uuid;
begin
  select product_id into v_product_id from public.skus where id = p_sku_id;
  if v_product_id is null then
    perform private.fail('listing_not_found');
  end if;
  -- The shop's own offers on this variant first, in id order, before the
  -- product row: every stock writer takes an offer before its product (the
  -- lock order of this migration's header), and this function may pause or
  -- resume these offers after taking the product. Taking the product first
  -- deadlocked with a count, a checkout or any stock write that held the
  -- offer and took it across zero (races I8 and E10b), and with a pack
  -- holding the offer (E10). Only offers of a shop
  -- the caller belongs to are locked; own_listing still decides who may go on.
  perform 1 from public.offers o
  where o.sku_id = p_sku_id
    and o.seller_id = (select x.created_by_seller_id from public.products x
                       where x.id = v_product_id)
    and private.is_seller_member(o.seller_id)
  order by o.id
  for no key update of o;
  p := private.own_listing(v_product_id);
  -- NO KEY UPDATE, not UPDATE: it still makes two changes of one variant
  -- wait for each other, but not a transaction that only references the
  -- variant (a key-share lock: a pack's ledger row, an order line). Since
  -- the offers come first no race depends on it (E10 is 0 either way);
  -- contract test (ix) guards it. This function changes no key column of
  -- the variant (only `active`) and deletes nothing.
  select * into k from public.skus where id = p_sku_id for no key update;
  if p_active is null then
    perform private.fail('invalid_variant_state');
  end if;
  if p.status = 'archived' then
    perform private.fail('listing_not_editable');
  end if;
  if p_active then
    perform private.require_trading_shop(p.created_by_seller_id);
  else
    perform private.require_open_shop(p.created_by_seller_id);
  end if;

  if not p_active then
    if not k.active then
      v_outcome := 'unchanged';
    elsif private.variant_shared(k.id) then
      update public.offers set status = 'paused'
      where sku_id = k.id and seller_id = p.created_by_seller_id and status = 'active';
      v_outcome := 'offer_paused';
    elsif not exists (select 1 from public.skus x
                      where x.product_id = p.id and x.id <> k.id and x.active) then
      perform private.fail('last_variant');
    else
      update public.skus set active = false where id = k.id;
      v_outcome := 'variant_off';
    end if;
  else
    if not k.active then
      update public.skus set active = true where id = k.id;
      v_outcome := 'variant_on';
    else
      -- On already: put back on sale this shop's paused offers on it. The
      -- price floor checks each, so an offer a fee change left too cheap
      -- says so instead of going back on sale.
      v_outcome := 'unchanged';
      for v_offer in
        select o.id from public.offers o
        where o.sku_id = k.id and o.seller_id = p.created_by_seller_id and o.status = 'paused'
        order by o.id
      loop
        update public.offers set status = 'active' where id = v_offer;
        v_outcome := 'offer_resumed';
      end loop;
    end if;
  end if;

  if v_outcome <> 'unchanged' then
    perform private.emit('product.variant_changed', jsonb_build_object(
      'product_id', p.id, 'sku_id', k.id, 'outcome', v_outcome));
  end if;
  return jsonb_build_object('product_id', p.id, 'slug', p.slug, 'sku_id', k.id, 'outcome', v_outcome);
end;
$$;

-- ═══ 7. Grants (unchanged: replacing a function keeps them) ═══════════════

revoke all on function
  private.refresh_product_summary(uuid),
  private.offers_summary_trigger(),
  private.sellers_summary_trigger(),
  private.cancel_order_internal(uuid, text),
  private.expire_unpaid_orders()
from public, anon, authenticated;

revoke all on function public.driver_start_route(uuid) from public, anon;
grant execute on function public.driver_start_route(uuid) to authenticated;

revoke all on function public.seller_mark_packed(uuid, integer, smallint) from public, anon;
grant execute on function public.seller_mark_packed(uuid, integer, smallint) to authenticated;

revoke all on function public.seller_set_variant_active(uuid, boolean) from public, anon;
grant execute on function public.seller_set_variant_active(uuid, boolean) to authenticated;
