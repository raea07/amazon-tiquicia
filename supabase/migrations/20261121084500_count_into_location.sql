-- Count a product into a location that has no record of it.
--
-- The location screens corrected only products the location already listed:
-- a worker who found units of a product on a shelf the system does not list
-- there had no way to say so. This migration adds the lookup the screen uses
-- to find the product and the shop the units belong to, and the count itself.
--
-- What this migration decides, and why:
--
--   * WHY NOT wms_adjust_stock WITH p_expected 0. It looks like the same
--     thing (a shelf the screen shows at 0, units counted in), but it is not
--     safe for a product the location does not list:
--       - it creates the shop's FIRST units of a product in a warehouse when
--         the shop has no stock record there (private.apply_stock_change
--         inserts the stock_levels row). Those units were never received:
--         that is a receipt, with its own checks and its own paper trail;
--       - with no stock record, two workers saving the same product into the
--         same shelf at the same moment share no row to wait on (both read
--         no stock row and no shelf row, both insert, the second insert
--         turns into an update) and the shelf ends with the SUM of the two
--         counts;
--       - a location that lists the product only because open picks wait
--         for it there (0 on the shelf, units promised) passes p_expected 0
--         and would be counted as new instead of on its own line.
--     wms_adjust_stock is left exactly as it is for its callers; the count of
--     a product the location does not list is a separate function.
--   * WHAT A COUNT INTO A LOCATION IS. One variant of one shop that already
--     has a stock record in this warehouse (a stock_levels row, even at 0),
--     counted onto a location of the same warehouse that is switched on and
--     takes counted units (storage, picking, returns, receiving: the
--     count_not_shelf rule of 084300), where the location lists nothing of
--     that product for that shop (no units on it and no open pick waiting
--     for it there). From 1 to 10 000 units, the limit of an upward
--     correction, and a reason of at least 5 letters (kept to 500).
--   * WHAT IT LEAVES. Exactly what an upward count correction leaves, through
--     the same private.apply_stock_change call with the same reason
--     ('adjust') and reference ('cycle_count'): the shelf's row, the shop's
--     on-hand stock and what shoppers can buy go up; one ledger row with the
--     worker and the reason; a line in the shop's stock history
--     (seller_stock_history, "warehouse_count", with the reason, never who);
--     a line in the staff list (ops_stock_changes, a correction, with who).
--     Open pick tasks that came up short for that product are not touched,
--     as an upward correction does not touch them today: a short task stays
--     short and names the location it was sent to (staff resolve it). A
--     short task waiting at THIS location makes the location list the
--     product, so it is refused here and counted on its own line instead.
--   * STALE PAGES AND DOUBLE TAPS. When the save arrives and the location
--     already lists the product for that shop (another worker counted or
--     moved it there meanwhile, a pick task was sent there, or the same
--     worker tapped twice), nothing changes: `count_already_listed`, with
--     the units now on the shelf, and the screen says to count again on the
--     product's own line. Two saves at the same moment wait for each other
--     first on the warehouse row (the first lock every stock writer of the
--     warehouse takes), and would wait again on the shop's stock row (which
--     must exist); the later one reads the shelf after the earlier one
--     committed (READ COMMITTED, the level every caller runs in): ONE count,
--     never the sum. Proved with two real sessions in
--     packages/db/src/contract.count-into-location.test.ts, and by review
--     over 200 rounds each of two workers and of a double tap: one count
--     every time, no deadlock.
--   * LOCK ORDER. The order of a correction in 084300: the warehouse row FOR
--     NO KEY UPDATE, the location FOR SHARE, the shop's stock row FOR UPDATE,
--     then the shelf's row. A cancellation that returns picked units to the
--     same shelf at the same moment as this count of the same product can
--     still deadlock, as it can with a correction (STATUS.md, decision 44):
--     measured by review over 100 exact collisions, 52 ended in a deadlock
--     (49 lost by the count, 3 by the cancellation), against 57 of 100 for
--     wms_adjust_stock in the same race. The loser rolls back whole (nothing
--     half-saved; on-hand stayed equal to the shelves plus the units in
--     picking in every round) and is told nothing was saved and to try
--     again. The fix is the cancellation's lock order, not this function.
--   * THE LOOKUP (wms_count_candidates). The screen finds the product by its
--     code, barcode or name, and for each match lists the shops that sell
--     it, whether each has a stock record in THIS warehouse, and whether the
--     location already lists it. A code or barcode finds the product even
--     when no shop has a record here (so the screen can say the first units
--     come in with a receipt); a name finds only products some shop keeps
--     in this warehouse. It reads nothing of another warehouse (no units,
--     no records), and nothing about shoppers: shop trade names only.
--   * WHO. A worker of the location's warehouse (private.works_at) or
--     operations staff, as for a count today.

-- ═══ 1. The lookup ════════════════════════════════════════════════════════

create or replace function public.wms_count_candidates(p_location_id uuid, p_query text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_location public.warehouse_locations%rowtype;
  v_query text := trim(coalesce(p_query, ''));
  v_like text;
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
  if char_length(v_query) < 2 or char_length(v_query) > 80 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(lower(v_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sku_id', m.id,
      'sku_code', m.code,
      'gtin', m.gtin,
      'title', m.title,
      'variant_name', m.variant_name,
      'shops', coalesce((
        select jsonb_agg(jsonb_build_object(
          'seller_id', s.id,
          'seller_name', s.trade_name,
          -- The shop has a stock record of this variant in this warehouse.
          'stock_record', sl.sku_id is not null,
          -- The location lists it for this shop (units on it, or open picks
          -- waiting for it there): count it on its own line instead.
          'listed', coalesce(b.quantity, 0) > 0 or pr.promised > 0,
          'on_shelf', coalesce(b.quantity, 0)
        ) order by (sl.sku_id is not null) desc, s.trade_name)
        from public.offers o
        join public.sellers s on s.id = o.seller_id
        left join public.stock_levels sl
          on sl.warehouse_id = v_location.warehouse_id and sl.sku_id = o.sku_id and sl.seller_id = o.seller_id
        left join public.bin_stock b
          on b.location_id = v_location.id and b.sku_id = o.sku_id and b.seller_id = o.seller_id
        cross join lateral (
          select private.location_promised(v_location.id, o.sku_id, o.seller_id) as promised) pr
        where o.sku_id = m.id), '[]'::jsonb)
    ) order by m.exact desc, m.title, m.variant_name, m.code)
    from (
      select k.id, k.code, k.gtin, p.title, k.variant_name,
             (k.code = upper(v_query) or k.gtin = v_query) as exact
      from public.skus k
      join public.products p on p.id = k.product_id
      where k.code = upper(v_query) or k.gtin = v_query
         or (exists (select 1 from public.stock_levels sl
                     where sl.warehouse_id = v_location.warehouse_id and sl.sku_id = k.id)
             and (lower(p.title) like v_like
                  or lower(k.variant_name) like v_like
                  or lower(k.code) like v_like))
      order by (k.code = upper(v_query) or k.gtin = v_query) desc, p.title, k.variant_name, k.code
      limit 10
    ) m), '[]'::jsonb);
end;
$$;

-- ═══ 2. The count ═════════════════════════════════════════════════════════

create or replace function public.wms_count_into_location(
  p_location_id uuid,
  p_sku_id uuid,
  p_seller_id uuid,
  p_quantity integer,
  p_note text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_location public.warehouse_locations%rowtype;
  v_note text := left(trim(coalesce(p_note, '')), 500);
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
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000
     or char_length(regexp_replace(v_note, '[^[:alpha:]]', '', 'g')) < 5 then
    -- As a correction: a whole number of units and a reason someone can read later.
    perform private.fail('invalid_adjustment');
  end if;
  if not exists (select 1 from public.offers o where o.sku_id = p_sku_id and o.seller_id = p_seller_id) then
    perform private.fail('offer_not_found');
  end if;

  -- The lock order of a correction (084300): the warehouse, the location,
  -- the shop's stock row, the shelf.
  perform 1 from public.warehouses w where w.id = v_location.warehouse_id for no key update;
  select * into v_location from public.warehouse_locations where id = p_location_id for share;
  if not v_location.active then
    perform private.fail('location_inactive');
  end if;
  if v_location.kind not in ('storage', 'pick', 'returns', 'receiving') then
    perform private.fail('count_not_shelf');
  end if;
  perform 1 from public.stock_levels l
  where l.warehouse_id = v_location.warehouse_id and l.sku_id = p_sku_id and l.seller_id = p_seller_id
  for update;
  if not found then
    -- The shop's first units of this product here come in with a receipt.
    perform private.fail('count_no_stock_record');
  end if;
  -- Read after the stock row's lock: a save that held it has committed, and
  -- what it put on the shelf is seen here.
  select b.quantity into v_on_shelf from public.bin_stock b
  where b.location_id = p_location_id and b.sku_id = p_sku_id and b.seller_id = p_seller_id
  for update;
  v_on_shelf := coalesce(v_on_shelf, 0);
  v_promised := private.location_promised(p_location_id, p_sku_id, p_seller_id);
  if v_on_shelf > 0 or v_promised > 0 then
    perform private.fail('count_already_listed', v_on_shelf::text);
  end if;

  perform private.apply_stock_change(
    v_location.warehouse_id, p_sku_id, p_seller_id, p_quantity, 'adjust',
    p_location_id, 'cycle_count', null, v_note);

  return jsonb_build_object(
    'location_id', v_location.id,
    'location_code', v_location.code,
    'sku_id', p_sku_id,
    'sku_code', (select k.code from public.skus k where k.id = p_sku_id),
    'seller_id', p_seller_id,
    'quantity', p_quantity,
    'on_shelf', p_quantity);
end;
$$;

-- ═══ 3. Grants ════════════════════════════════════════════════════════════

revoke all on function
  public.wms_count_candidates(uuid, text),
  public.wms_count_into_location(uuid, uuid, uuid, integer, text)
from public, anon;

grant execute on function
  public.wms_count_candidates(uuid, text),
  public.wms_count_into_location(uuid, uuid, uuid, integer, text)
to authenticated;
