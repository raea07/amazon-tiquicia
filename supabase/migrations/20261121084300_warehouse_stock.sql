-- Warehouse stock: see what a location holds, move stock between locations,
-- correct a count.
--
-- Until now the warehouse could find a product's bins (wms_find_sku) but not
-- open a location, there was no way to move units from one location to
-- another (so a location holding stock could be switched off only once
-- orders emptied it), and the cycle-count function (wms_adjust_stock) had no
-- screen. This migration adds the reads and the move, and makes the count
-- correction safe to put behind a screen.
--
-- What this migration decides, and why:
--
--   * WHAT IS FREE IN A LOCATION. Stock is reserved for orders per warehouse
--     (stock_levels.reserved), not per shelf. A shelf's units are tied to an
--     order once a pick task names the shelf: release_order_to_fulfillment
--     creates one task per order line and names one location. A task's
--     units still to take (quantity - picked_quantity, while the task is
--     open, in progress or short) are PROMISED to it at that location
--     (private.location_promised). Units already picked have left the shelf
--     (bin_stock went down at the pick); they are shown apart, as units that
--     come back to this shelf if the order is cancelled
--     (private.location_picked_units). FREE = on the shelf - promised, never
--     below 0. A shelf can hold fewer units than are promised to it (the
--     picker then picks short); its free is 0.
--   * A MOVE (wms_move_stock) takes free units of one shop's product from a
--     location to a storage or picking location of the SAME warehouse that is
--     switched on, in one transaction. It never takes promised units, so it
--     never strands a pick. The source may be switched off: that is how a
--     location that is off, or is about to be, is emptied. The target must
--     be a storage or picking shelf: units in the damaged, packing or
--     dispatch areas would still count as sellable, and a damaged unit is a
--     correction, not a move. The shop's stock (stock_levels) and what
--     shoppers can buy do not change, so the shop is told nothing and its
--     stock history shows nothing; the ledger gets ONE row with both sides
--     (from_location_id, to_location_id, on_hand_delta 0, reason 'transfer',
--     which the enum has had since the first migration and nothing used),
--     with who and when. No new movement reason is needed, so there is no
--     TypeScript list to mirror.
--   * PICKING CHOOSES BY FREE UNITS. release_order_to_fulfillment named the
--     location with the most units, even when other open tasks had already
--     claimed them; after a move that left a shelf holding only its promised
--     units, a new task could be sent there and come up short. It now names
--     the switched-on location with the most free units first (then the most
--     units, then the code, as before), storage and picking shelves before
--     any other kind of location. It also takes the candidate shelves
--     FOR KEY SHARE before choosing, which waits for a move or a count that
--     holds one (FOR UPDATE) and is not blocked by picks, receipts or
--     cancellations (their updates take FOR NO KEY UPDATE): a move and a
--     release at the same moment are taken one after the other, and the
--     later one sees the other's result.
--   * A COUNT CORRECTION (wms_adjust_stock) keeps its five arguments, so the
--     typed method that exists keeps working, and gains a sixth, optional:
--     the quantity the screen showed (p_expected). When it is given and the
--     shelf changed since (a pick, a move, another count), the correction is
--     refused (`count_changed`) instead of applying a difference to a number
--     the worker never saw. What was unsafe before, and is refused now:
--       - taking units that open picks are waiting for on that shelf
--         (`adjust_below_promised`): the picker would come up short. The
--         message says to tell operations, who resolve the order first;
--       - leaving the warehouse with fewer units than shoppers already bought
--         (`adjust_below_reserved`), which before failed as a generic
--         "insufficient stock";
--       - a shelf below zero (`adjust_below_zero`, before a generic
--         "insufficient stock");
--       - units counted INTO a location that is switched off
--         (`location_inactive`, before the trigger's "location not found");
--       - units counted INTO the damaged, packing or dispatch areas
--         (`count_not_shelf`): they would count as sellable and picking
--         could be sent there. Only storage, picking, returns and receiving
--         locations take units in; units may be counted out anywhere;
--       - a product the shop does not sell (`offer_not_found`): before, any
--         product could be counted into existence for any shop;
--       - a location of a seller's own site (only Yuntera's warehouses have
--         shelves the warehouse counts).
--     Every correction is now recorded with the reason 'adjust' and the
--     reference 'cycle_count', in both directions: a count that takes units
--     away used to be booked as 'damage', which told the shop its goods were
--     damaged when they were simply not found. The worker's reason needs at
--     least 5 letters (not just 5 characters) and is kept to 500.
--   * WHAT THE SHOP SEES. A correction changes what the shop can sell (the
--     availability trigger follows on_hand at once). The shop's stock page
--     in the seller centre now has a history (seller_stock_history): every
--     change to its on-hand stock, received, sent in an order, back from a
--     failed delivery, its own counts and the warehouse's corrections with
--     the reason the worker wrote. Never who in the warehouse did it, never
--     an order's shopper. Moves and picks change nothing the shop owns and
--     are not listed.
--   * LOCK ORDER. Every function here takes the warehouse row FOR NO KEY
--     UPDATE first, as the console's location functions do (084000): moves
--     and corrections of one warehouse, and staff switching its locations
--     off or renaming them, are taken one after the other. A stock write by
--     anyone else (a pick, a pack, a receipt, a cancellation) takes only KEY
--     SHARE on the warehouse, through its ledger row's foreign key, which NO
--     KEY UPDATE does not block, so they never wait for us there. After the
--     warehouse:
--       move:        the target location FOR SHARE, then both shelves' rows
--                    (bin_stock) FOR UPDATE in location id order, the order
--                    a cancellation puts picked units back in;
--       correction:  the location FOR SHARE, then the shop's stock row
--                    (stock_levels) FOR UPDATE, then the shelf's row, the
--                    order private.apply_stock_change and every receipt
--                    take them in.
--     A pick takes its task, then one shelf row; a pack takes reservations,
--     then stock rows; neither waits for anything a move or a correction
--     holds while holding something they want. The races are proved with
--     two real sessions in packages/db/src/contract.warehouse-stock-races.test.ts.
--   * WHO. A worker of the warehouse (private.works_at) or operations staff.
--     Reads carry the shop's trade name, never a shopper's data. The staff
--     list of moves and corrections (ops_stock_changes) is for operations
--     staff, with the name of who did each.

-- ═══ 1. What a location holds ═════════════════════════════════════════════

create index if not exists pick_tasks_location_open_idx
  on public.pick_tasks (location_id, sku_id, seller_id)
  where status in ('open', 'in_progress', 'short');

create index if not exists stock_movements_review_idx
  on public.stock_movements (id desc)
  where reason = 'transfer' or reference_type = 'cycle_count';

create index if not exists stock_movements_seller_history_idx
  on public.stock_movements (seller_id, id desc)
  where on_hand_delta <> 0;

-- Units of one shop's product that open pick tasks are still to take from
-- this location.
create or replace function private.location_promised(
  p_location_id uuid, p_sku_id uuid, p_seller_id uuid
) returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(t.quantity - t.picked_quantity), 0)::integer
  from public.pick_tasks t
  where t.location_id = p_location_id and t.sku_id = p_sku_id and t.seller_id = p_seller_id
    and t.status in ('open', 'in_progress', 'short');
$$;

-- Units of one shop's product picked from this location into parcels still
-- being picked (they come back here if the order is cancelled).
create or replace function private.location_picked_item(
  p_location_id uuid, p_sku_id uuid, p_seller_id uuid
) returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(m.quantity), 0)::integer
  from public.stock_movements m
  join public.shipments s on s.id = m.reference_id
  where m.from_location_id = p_location_id and m.sku_id = p_sku_id and m.seller_id = p_seller_id
    and m.reason = 'pick' and m.reference_type = 'shipment' and s.status = 'picking';
$$;

-- A location and everything in it, for the warehouse screens.
create or replace function private.wms_location_json(p_location_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', wl.id,
    'code', wl.code,
    'kind', wl.kind,
    'active', wl.active,
    -- Stock can be moved into it (wms_move_stock).
    'shelf', wl.kind in ('storage', 'pick'),
    'warehouse', jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name),
    'units', coalesce(x.units, 0),
    'promised', coalesce(x.promised, 0),
    'free', coalesce(x.free, 0),
    'picked_units', private.location_picked_units(wl.id),
    'open_tasks', (select count(*) from public.pick_tasks t
                   where t.location_id = wl.id and t.status in ('open', 'in_progress', 'short')),
    'items', coalesce(x.items, '[]'::jsonb)
  )
  from public.warehouse_locations wl
  join public.warehouses w on w.id = wl.warehouse_id
  left join lateral (
    select sum(i.on_shelf)::integer as units, sum(i.promised)::integer as promised,
           sum(i.free)::integer as free,
           jsonb_agg(jsonb_build_object(
             'sku_id', i.sku_id, 'sku_code', i.sku_code, 'gtin', i.gtin, 'title', i.title,
             'variant_name', i.variant_name, 'seller_id', i.seller_id, 'seller_name', i.seller_name,
             'on_shelf', i.on_shelf, 'promised', i.promised, 'free', i.free,
             'picked_waiting', i.picked_waiting)
             order by i.title, i.variant_name, i.seller_name) as items
    from (
      select k.id as sku_id, k.code as sku_code, k.gtin, p.title, k.variant_name,
             s.id as seller_id, s.trade_name as seller_name, b.quantity as on_shelf,
             pr.promised, greatest(b.quantity - pr.promised, 0) as free,
             private.location_picked_item(b.location_id, b.sku_id, b.seller_id) as picked_waiting
      from public.bin_stock b
      join public.skus k on k.id = b.sku_id
      join public.products p on p.id = k.product_id
      join public.sellers s on s.id = b.seller_id
      cross join lateral (
        select private.location_promised(b.location_id, b.sku_id, b.seller_id) as promised) pr
      where b.location_id = wl.id and (b.quantity > 0 or pr.promised > 0)
    ) i
  ) x on true
  where wl.id = p_location_id;
$$;

-- Every location of a warehouse a worker can open: the switched-on ones, and
-- any switched off that still holds stock (to be emptied).
create or replace function public.wms_stock_locations(p_warehouse_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'code', l.code, 'kind', l.kind, 'active', l.active,
      'shelf', l.kind in ('storage', 'pick'),
      'units', l.units, 'products', l.products, 'promised', l.promised)
      order by (l.kind in ('storage', 'pick')) desc, l.code)
    from (
      select wl.id, wl.code, wl.kind, wl.active,
             coalesce(sum(b.quantity), 0)::integer as units,
             count(*) filter (where b.quantity > 0)::integer as products,
             (select coalesce(sum(t.quantity - t.picked_quantity), 0)::integer from public.pick_tasks t
              where t.location_id = wl.id and t.status in ('open', 'in_progress', 'short')) as promised
      from public.warehouse_locations wl
      left join public.bin_stock b on b.location_id = wl.id
      where wl.warehouse_id = p_warehouse_id
      group by wl.id
    ) l
    where l.active or l.units > 0), '[]'::jsonb);
end;
$$;

-- One location of the warehouse by the code on its label (typed or
-- scanned), with what it holds. Null when the warehouse has no such code.
create or replace function public.wms_location_stock(p_warehouse_id uuid, p_code text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  if p_code is null or char_length(p_code) > 40 then
    return null;
  end if;
  select wl.id into v_id from public.warehouse_locations wl
  where wl.warehouse_id = p_warehouse_id and wl.code = upper(trim(p_code));
  if v_id is null then
    return null;
  end if;
  return private.wms_location_json(v_id);
end;
$$;

-- Replaces the version in 20261121081600_api_operations.sql. What changed:
-- each bin also says how many of its units open picks are waiting for, how
-- many are free to move, and whether the location is switched on and a
-- shelf. The lookup itself is unchanged.
create or replace function public.wms_find_sku(p_warehouse_id uuid, p_code text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.works_at(p_warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  return (
    select jsonb_build_object(
      'sku_id', k.id, 'sku_code', k.code, 'gtin', k.gtin, 'title', p.title,
      'variant_name', k.variant_name,
      'bins', coalesce((
        select jsonb_agg(jsonb_build_object(
          'location_id', wl.id, 'location_code', wl.code, 'seller_id', b.seller_id,
          'seller_name', s.trade_name, 'quantity', b.quantity,
          'promised', pr.promised, 'free', greatest(b.quantity - pr.promised, 0),
          'location_active', wl.active, 'location_kind', wl.kind) order by wl.code)
        from public.bin_stock b
        join public.warehouse_locations wl on wl.id = b.location_id
        join public.sellers s on s.id = b.seller_id
        cross join lateral (
          select private.location_promised(b.location_id, b.sku_id, b.seller_id) as promised) pr
        where b.sku_id = k.id and wl.warehouse_id = p_warehouse_id and b.quantity > 0), '[]'::jsonb))
    from public.skus k join public.products p on p.id = k.product_id
    where k.code = upper(trim(p_code)) or k.gtin = trim(p_code)
    limit 1);
end;
$$;

-- ═══ 2. Picking names the shelf with free units ═══════════════════════════

-- Replaces the version in 20261121081000_checkout.sql. What changed: the
-- shelves it may choose from are taken FOR KEY SHARE first (so a move or a
-- count holding one is waited for, and seen), and the location named is the
-- switched-on one with the most free units (on the shelf minus what open
-- tasks already wait for), then the most units, then the code. Storage and
-- picking shelves come first, then the returns and receiving areas; the
-- damaged, packing and dispatch areas only when nothing else holds the
-- product (their units still count as sellable, see section 4).
create or replace function private.release_order_to_fulfillment(p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform 1
  from public.bin_stock b
  join public.warehouse_locations wl on wl.id = b.location_id
  where (wl.warehouse_id, b.sku_id, b.seller_id) in (
    select s.origin_warehouse_id, i.sku_id, i.seller_id
    from public.shipments s
    join public.shipment_items si on si.shipment_id = s.id
    join public.order_items i on i.id = si.order_item_id
    join public.warehouses w on w.id = s.origin_warehouse_id and w.kind = 'platform'
    where s.order_id = p_order_id)
  order by b.sku_id, b.seller_id, b.location_id
  for key share of b;

  insert into public.pick_tasks
    (shipment_id, order_item_id, warehouse_id, sku_id, seller_id, location_id, quantity)
  select s.id, si.order_item_id, s.origin_warehouse_id, i.sku_id, i.seller_id,
         (select b.location_id
          from public.bin_stock b
          join public.warehouse_locations wl on wl.id = b.location_id
          where wl.warehouse_id = s.origin_warehouse_id
            and b.sku_id = i.sku_id and b.seller_id = i.seller_id and b.quantity > 0
          order by case when wl.kind in ('storage', 'pick') then 0
                        when wl.kind in ('returns', 'receiving') then 1
                        else 2 end,
                   wl.active desc,
                   b.quantity - private.location_promised(b.location_id, b.sku_id, b.seller_id) desc,
                   b.quantity desc, wl.code
          limit 1),
         si.quantity
  from public.shipments s
  join public.shipment_items si on si.shipment_id = s.id
  join public.order_items i on i.id = si.order_item_id
  join public.warehouses w on w.id = s.origin_warehouse_id
  where s.order_id = p_order_id
    and w.kind = 'platform'
    and not exists (
      select 1 from public.pick_tasks t
      where t.shipment_id = s.id and t.order_item_id = si.order_item_id
    );

  perform private.emit('order.released', jsonb_build_object('order_id', p_order_id));
end;
$$;

-- ═══ 3. Moving stock between locations ════════════════════════════════════

create or replace function public.wms_move_stock(
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_sku_id uuid,
  p_seller_id uuid,
  p_quantity integer,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from public.warehouse_locations%rowtype;
  v_to public.warehouse_locations%rowtype;
  v_on_shelf integer;
  v_promised integer;
  v_free integer;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 200), '');
  v_movement bigint;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  select * into v_from from public.warehouse_locations where id = p_from_location_id;
  if not found then
    perform private.fail('location_not_found');
  end if;
  if not (private.works_at(v_from.warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  select * into v_to from public.warehouse_locations where id = p_to_location_id;
  if not found then
    perform private.fail('location_not_found');
  end if;
  if v_to.warehouse_id <> v_from.warehouse_id then
    perform private.fail('move_other_warehouse');
  end if;
  if v_to.id = v_from.id then
    perform private.fail('move_same_location');
  end if;
  if v_to.kind not in ('storage', 'pick') then
    perform private.fail('move_target_not_shelf');
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    perform private.fail('invalid_quantity');
  end if;
  if p_sku_id is null or p_seller_id is null then
    perform private.fail('move_nothing_here');
  end if;

  -- The lock order of the header: the warehouse, the target location, the
  -- two shelves in location id order.
  perform 1 from public.warehouses w where w.id = v_from.warehouse_id for no key update;
  select * into v_to from public.warehouse_locations where id = p_to_location_id for share;
  if not v_to.active then
    perform private.fail('location_inactive');
  end if;
  perform 1 from public.bin_stock b
  where b.location_id in (v_from.id, v_to.id) and b.sku_id = p_sku_id and b.seller_id = p_seller_id
  order by b.location_id
  for update;

  select b.quantity into v_on_shelf from public.bin_stock b
  where b.location_id = v_from.id and b.sku_id = p_sku_id and b.seller_id = p_seller_id;
  if coalesce(v_on_shelf, 0) = 0 then
    perform private.fail('move_nothing_here');
  end if;
  v_promised := private.location_promised(v_from.id, p_sku_id, p_seller_id);
  v_free := greatest(v_on_shelf - v_promised, 0);
  if p_quantity > v_free then
    perform private.fail('move_exceeds_free', v_free::text);
  end if;

  update public.bin_stock set quantity = quantity - p_quantity
  where location_id = v_from.id and sku_id = p_sku_id and seller_id = p_seller_id;
  insert into public.bin_stock (location_id, sku_id, seller_id, quantity)
  values (v_to.id, p_sku_id, p_seller_id, p_quantity)
  on conflict (location_id, sku_id, seller_id)
  do update set quantity = public.bin_stock.quantity + excluded.quantity;

  insert into public.stock_movements
    (warehouse_id, sku_id, seller_id, from_location_id, to_location_id, on_hand_delta, quantity,
     reason, reference_type, note, actor_id)
  values
    (v_from.warehouse_id, p_sku_id, p_seller_id, v_from.id, v_to.id, 0, p_quantity,
     'transfer', 'stock_move', v_note, (select auth.uid()))
  returning id into v_movement;

  return jsonb_build_object(
    'movement_id', v_movement,
    'quantity', p_quantity,
    'from', jsonb_build_object('id', v_from.id, 'code', v_from.code,
      'on_shelf', v_on_shelf - p_quantity, 'free', v_free - p_quantity),
    'to', jsonb_build_object('id', v_to.id, 'code', v_to.code,
      'on_shelf', (select b.quantity from public.bin_stock b
                   where b.location_id = v_to.id and b.sku_id = p_sku_id and b.seller_id = p_seller_id)));
end;
$$;

-- ═══ 4. Correcting a count ════════════════════════════════════════════════

-- Replaces the version in 20261121080500_inventory.sql (see the header for
-- what changed). The old five-argument form is dropped so there is one
-- function of this name; a call with five arguments reaches this one.
drop function if exists public.wms_adjust_stock(uuid, uuid, uuid, integer, text);

create or replace function public.wms_adjust_stock(
  p_location_id uuid,
  p_sku_id uuid,
  p_seller_id uuid,
  p_delta integer,
  p_note text,
  p_expected integer default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_location public.warehouse_locations%rowtype;
  v_note text := left(trim(coalesce(p_note, '')), 500);
  v_on_hand integer;
  v_reserved integer;
  v_on_shelf integer;
  v_promised integer;
begin
  if (select auth.uid()) is null then
    perform private.fail('not_authenticated');
  end if;
  select l.* into v_location from public.warehouse_locations l
  join public.warehouses w on w.id = l.warehouse_id and w.kind = 'platform'
  where l.id = p_location_id;
  if not found then
    perform private.fail('location_not_found');
  end if;
  if not (private.works_at(v_location.warehouse_id) or private.has_staff_role('ops')) then
    perform private.fail('forbidden');
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 10000
     or char_length(regexp_replace(v_note, '[^[:alpha:]]', '', 'g')) < 5 then
    -- Every correction needs a reason someone can read later.
    perform private.fail('invalid_adjustment');
  end if;
  if not exists (select 1 from public.offers o where o.sku_id = p_sku_id and o.seller_id = p_seller_id) then
    perform private.fail('offer_not_found');
  end if;

  -- The lock order of the header: the warehouse, the location, the shop's
  -- stock row, the shelf.
  perform 1 from public.warehouses w where w.id = v_location.warehouse_id for no key update;
  select * into v_location from public.warehouse_locations where id = p_location_id for share;
  if p_delta > 0 and not v_location.active then
    perform private.fail('location_inactive');
  end if;
  -- Units counted in are sellable at once and picking may be sent to them:
  -- never in the damaged, packing or dispatch areas.
  if p_delta > 0 and v_location.kind not in ('storage', 'pick', 'returns', 'receiving') then
    perform private.fail('count_not_shelf');
  end if;
  select l.on_hand, l.reserved into v_on_hand, v_reserved from public.stock_levels l
  where l.warehouse_id = v_location.warehouse_id and l.sku_id = p_sku_id and l.seller_id = p_seller_id
  for update;
  select b.quantity into v_on_shelf from public.bin_stock b
  where b.location_id = p_location_id and b.sku_id = p_sku_id and b.seller_id = p_seller_id
  for update;
  v_on_shelf := coalesce(v_on_shelf, 0);

  if p_expected is not null and p_expected <> v_on_shelf then
    -- The shelf changed since the worker read it: count again.
    perform private.fail('count_changed', v_on_shelf::text);
  end if;
  if p_delta < 0 then
    if v_on_shelf + p_delta < 0 then
      perform private.fail('adjust_below_zero', v_on_shelf::text);
    end if;
    v_promised := private.location_promised(p_location_id, p_sku_id, p_seller_id);
    if v_on_shelf + p_delta < v_promised then
      perform private.fail('adjust_below_promised', v_promised::text);
    end if;
    if coalesce(v_on_hand, 0) + p_delta < coalesce(v_reserved, 0) then
      perform private.fail('adjust_below_reserved', coalesce(v_reserved, 0)::text);
    end if;
  end if;

  perform private.apply_stock_change(
    v_location.warehouse_id, p_sku_id, p_seller_id, p_delta, 'adjust',
    p_location_id, 'cycle_count', null, v_note);
end;
$$;

-- ═══ 5. What the shop sees ════════════════════════════════════════════════

-- Every change to a shop's on-hand stock, newest first. Moves between shelves
-- and picks change nothing the shop owns and are not listed. Never who in the
-- warehouse made a change, never an order's shopper.
create or replace function public.seller_stock_history(p_seller_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_seller_member(p_seller_id) or private.has_staff_role('ops', 'support')) then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'at', m.created_at,
      'warehouse_id', w.id,
      'warehouse_name', w.name,
      'warehouse_kind', w.kind,
      'sku_id', k.id,
      'sku_code', k.code,
      'title', p.title,
      'variant_name', k.variant_name,
      'change', m.on_hand_delta,
      'kind', case
        when m.reason = 'receive' then 'received'
        when m.reason = 'ship' then 'shipped'
        when m.reason = 'return' then 'returned'
        when m.reference_type = 'cycle_count' then 'warehouse_count'
        when m.reference_type = 'seller_count' then 'own_count'
        else 'other' end,
      -- The reason the warehouse wrote for its correction; nothing else is
      -- free text the shop should read.
      'note', case when m.reference_type = 'cycle_count' then m.note end
    ) order by m.id desc)
    from (
      select * from public.stock_movements x
      where x.seller_id = p_seller_id and x.on_hand_delta <> 0
      order by x.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) m
    join public.warehouses w on w.id = m.warehouse_id
    join public.skus k on k.id = m.sku_id
    join public.products p on p.id = k.product_id), '[]'::jsonb);
end;
$$;

-- ═══ 6. The staff list of moves and corrections ═══════════════════════════

create or replace function public.ops_stock_changes(p_limit integer default 100) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_staff_role('ops') then
    perform private.fail('forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'at', m.created_at,
      'kind', case when m.reason = 'transfer' then 'move' else 'correction' end,
      'warehouse_code', w.code,
      'actor_name', coalesce(ap.full_name, au.email::text),
      'sku_code', k.code,
      'title', p.title,
      'variant_name', k.variant_name,
      'seller_name', s.trade_name,
      'quantity', m.quantity,
      'change', m.on_hand_delta,
      'from_code', fl.code,
      'to_code', tl.code,
      'note', m.note
    ) order by m.id desc)
    from (
      select * from public.stock_movements x
      where x.reason = 'transfer' or x.reference_type = 'cycle_count'
      order by x.id desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) m
    join public.warehouses w on w.id = m.warehouse_id
    join public.skus k on k.id = m.sku_id
    join public.products p on p.id = k.product_id
    join public.sellers s on s.id = m.seller_id
    left join public.warehouse_locations fl on fl.id = m.from_location_id
    left join public.warehouse_locations tl on tl.id = m.to_location_id
    left join auth.users au on au.id = m.actor_id
    left join public.profiles ap on ap.id = m.actor_id), '[]'::jsonb);
end;
$$;

-- ═══ 7. Grants ════════════════════════════════════════════════════════════

revoke all on function
  private.location_promised(uuid, uuid, uuid),
  private.location_picked_item(uuid, uuid, uuid),
  private.wms_location_json(uuid),
  private.release_order_to_fulfillment(uuid)
from public, anon, authenticated;

revoke all on function
  public.wms_stock_locations(uuid),
  public.wms_location_stock(uuid, text),
  public.wms_find_sku(uuid, text),
  public.wms_move_stock(uuid, uuid, uuid, uuid, integer, text),
  public.wms_adjust_stock(uuid, uuid, uuid, integer, text, integer),
  public.seller_stock_history(uuid, integer),
  public.ops_stock_changes(integer)
from public, anon;

grant execute on function
  public.wms_stock_locations(uuid),
  public.wms_location_stock(uuid, text),
  public.wms_find_sku(uuid, text),
  public.wms_move_stock(uuid, uuid, uuid, uuid, integer, text),
  public.wms_adjust_stock(uuid, uuid, uuid, integer, text, integer),
  public.seller_stock_history(uuid, integer),
  public.ops_stock_changes(integer)
to authenticated;
