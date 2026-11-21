# Sourcing and inventory

Two questions with one answer each. **Availability:** how many units of this
offer can be sold right now? **Sourcing:** when an order is placed, which
location ships each unit? Both must hold under concurrency: two shoppers must
never be sold the same last unit.

There are two pieces of logic here, and it is important to know which one is
running.

| Piece                                           | Where                                                                                            | State                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Availability, reservation, consumption, release | SQL: `…080500_inventory.sql`, `place_order` in `…081000_checkout.sql`, `…081100_fulfillment.sql` | Built, tested under the checkout and fulfilment suites, used by every order                             |
| Multi-location sourcing planner                 | `packages/core/src/allocation.ts` (`planSourcing`)                                               | Specified and unit-tested. **Not called by `place_order`**, which uses the simpler rule described below |

## Goal

1. Never sell what is not there.
2. Fulfil as much of the order as possible.
3. Use as few parcels as possible — each one is a delivery stop and a split
   experience for the shopper.
4. Among equally compact plans, ship from closest to the shopper.

## The stock model

Stock is counted per **warehouse + SKU + seller**. Units in a Yuntera warehouse
still belong to the seller who sent them, and two sellers' units of the same
SKU are never pooled.

| Quantity             | Meaning                                                |
| -------------------- | ------------------------------------------------------ |
| `on_hand`            | Units physically at the location                       |
| `reserved`           | Units promised to orders that have not been packed yet |
| `on_hand − reserved` | Available to promise                                   |

The database constraint `reserved <= on_hand` is the rule that prevents
overselling: any statement that would break it fails.

An offer sells from the locations that match how it is fulfilled: Yuntera
warehouses for warehouse-fulfilled offers, the seller's own locations
otherwise. `offers.available_quantity` is the sum of available-to-promise units
across those locations, kept current by a trigger on `stock_levels`. The
storefront shows at most "10" of it: exact stock is the seller's business.

## What happens to stock through an order's life

| Moment                                      | Function                                       | `on_hand`        | `reserved` | Reservation row | Ledger row                                                                     |
| ------------------------------------------- | ---------------------------------------------- | ---------------- | ---------- | --------------- | ------------------------------------------------------------------------------ |
| Stock arrives at a warehouse                | `wms_receive`                                  | + good units     | —          | —               | `receive`. Damaged units are counted on the inbound line and never enter stock |
| Seller counts stock at their own location   | `seller_set_stock`                             | set to the count | —          | —               | `adjust`                                                                       |
| Order placed                                | `place_order`                                  | —                | + quantity | `active`        | —                                                                              |
| Order cancelled, or unpaid after 30 minutes | `cancel_order`, `private.expire_unpaid_orders` | —                | − quantity | `released`      | —                                                                              |
| Parcel packed                               | `wms_pack_shipment`, `seller_mark_packed`      | − quantity       | − quantity | `consumed`      | `ship`                                                                         |
| Cycle-count correction                      | `wms_adjust_stock`                             | ± delta          | —          | —               | `adjust`, with a mandatory note                                                |

Stock leaves `on_hand` at **packing**, not at picking and not at delivery. From
that moment the units are in a sealed parcel and no longer on a shelf.

`seller_set_stock` refuses to set a count below what is already reserved
(`below_reserved`): a seller cannot un-promise units an order is waiting for.

## Sourcing as built

`place_order` handles each order line on its own, in a fixed order (by SKU,
then seller):

1. Find the locations of the right kind — Yuntera warehouse or the seller's own
   — that are active and have **all** the units this line needs available.
2. Among them, take the one with the most available units; break ties by
   warehouse id.
3. Raise `reserved` there by the quantity. The `UPDATE` repeats the
   availability test in its `WHERE` clause, so if a concurrent order took the
   units between steps 1 and 3 the statement matches nothing.
4. If nothing was reserved, the whole order fails with `insufficient_stock`
   naming the offer, and the transaction rolls back: no order, no partial
   reservation.
5. Write the order line and a reservation row. Attach the line to the order's
   shipment from that location, creating the shipment if this is the first line
   from there.

The result is one shipment per location the goods leave from. An order with
warehouse items and one seller-shipped item becomes two parcels, each with its
own tracking code and status.

Lines are always processed in the same order so that two concurrent checkouts
lock stock rows in the same sequence and cannot deadlock.

### Why this simple rule is enough for the pilot

With one Yuntera warehouse, and sellers who each ship from one location, every
line has exactly one candidate. There is nothing to optimise. The rule becomes
visibly suboptimal only when the same seller's stock of the same SKU sits in
more than one place.

## The planner that is specified but not wired

`planSourcing(lines, nodes, destination)` is a greedy set cover. Minimum-parcel
sourcing is a set-cover problem, which has no fast exact solution; orders are
small, so greedy is optimal or within one parcel in practice, and it is
deterministic.

Repeat until every unit is covered or nothing more can be:

1. For every location, count how many of the still-needed units it could
   supply — respecting that a seller's location holds only that seller's stock,
   and that two lines drawing on the same stock cannot both take the same unit.
2. Take the location that covers the most units. Ties go to the one that
   completes more lines, then the one closest to the destination (straight-line
   distance), then the lower id.
3. Assign those units to a parcel from that location and subtract them.

Anything left over is reported as `unfulfilled`.

### Worked example

Computed with `planSourcing`. An order to San Pedro:

| Line      | Seller    | Quantity |
| --------- | --------- | -------: |
| Audífonos | TecnoCasa |        1 |
| Cargador  | TecnoCasa |        2 |
| Café      | Cafetal   |        2 |

Stock:

| Location                    | Distance | Holds                                                |
| --------------------------- | -------: | ---------------------------------------------------- |
| Yuntera warehouse (BOD-SJO) |   3.5 km | TecnoCasa: 5 audífonos, 1 cargador. Cafetal: 10 café |
| TecnoCasa's own shop        |  10.1 km | TecnoCasa: 2 audífonos, 8 cargadores                 |

Round 1: the warehouse can cover 1 + 1 + 2 = 4 of the 5 units; the shop can
cover 1 + 2 = 3. The warehouse is chosen.

Round 2: one cargador remains. Only the shop has it.

Plan: two parcels — four units from the warehouse, one cargador from the shop.
Fully sourced.

**The same order under the rule that is actually built would be refused.** The
cargador line needs 2 units from a single location of the kind its offer
declares; if that offer is warehouse-fulfilled, the warehouse has only 1. That
is the gap the planner closes, at the cost of splitting a line across parcels.

## Known limits

- **A line cannot be split across locations.** As above.
- **Listed availability can exceed what one line can buy.** An offer's
  available quantity is summed across locations; a line needs it all in one
  place. With three units in one warehouse and two in another, the page says
  five are available and an order for four is refused. This cannot happen with
  a single warehouse.
- **Distance is not considered by the built rule**, only quantity. The planner
  uses straight-line distance, not road distance or delivery zones.
- **The delivery promise is computed before sourcing** and assumes warehouse
  stock ships with zero handling days from wherever it is. With several
  warehouses serving different zones that would need to become per-location.
- **Reservations are released by a scheduled job.** Without a scheduler, unpaid
  orders hold stock until the expiry function is called by hand.
- **Bins are a suggestion.** A pick task proposes the bin holding the most
  units; the associate may pick from another and say so. Bin quantities are
  only as good as the putaway and pick discipline behind them.
- **No safety stock, no reorder points, no forecasting.** Listed under
  "Later" in the [scope](../01-product/scope-by-app.md).

## When to wire the planner in

When the same seller's stock of a SKU is held in two places — a second Yuntera
warehouse, or a seller who both sends stock in and keeps some to ship
themselves under one offer. At that point `place_order` should call a SQL
implementation of the same greedy rule, reserving each planned portion
atomically and failing the order if the plan went stale, and the unit tests in
`allocation.test.ts` become the cases the SQL must replay.

## What to measure

| Measure                                                             | Why                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Orders refused with `insufficient_stock` when the page showed stock | Stale cache, or the multi-location gap                           |
| Parcels per order                                                   | The cost the planner minimises                                   |
| Pick tasks marked short                                             | Stock records that disagree with the shelf                       |
| Size and frequency of cycle-count adjustments, by location          | Where discipline is slipping                                     |
| Reservations released by expiry, as a share of orders               | How much stock unpaid orders tie up; tunes `reservation_minutes` |
| Units reserved but not packed for more than a day                   | Orders stuck between payment and the warehouse                   |
