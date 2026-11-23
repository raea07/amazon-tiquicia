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
| Cycle-count correction                      | `wms_adjust_stock`                             | ± delta          | —          | —               | `adjust` with reference `cycle_count`, with a reason of at least 5 letters     |
| Units moved between locations               | `wms_move_stock`                               | —                | —          | —               | one `transfer` row with both locations                                         |
| A returned parcel checked in, resellable    | `wms_receive_returned_shipment`                | + quantity       | —          | —               | `return`, onto the warehouse's returns location                                |

Stock leaves `on_hand` at **packing**, not at picking and not at delivery. From
that moment the units are in a sealed parcel and no longer on a shelf.

`seller_set_stock` refuses to set a count below what is already reserved
(`below_reserved`): a seller cannot un-promise units an order is waiting for.

### Locations: what is free, moves and counts (084300)

Stock is reserved per warehouse, not per shelf. A shelf's units are tied to an
order only once a pick task names it, so **free** units of a location are the
units on it minus what its open pick tasks still wait for (never below 0).
Units already picked have left the shelf and are shown apart.

- **Moves** (`wms_move_stock`, from the location screens of the field app and
  the warehouse app) take free units of one shop's product to a switched-on
  storage or picking shelf of the same warehouse. The source may be any
  location, also one switched off (that is how it is emptied). The shop's
  stock and what shoppers can buy do not change, and the shop is not told.
- **Count corrections** (`wms_adjust_stock`, "Corregir cantidad") send the
  quantity the screen showed; a shelf that changed since is counted again
  (`count_changed`). Units are counted in only on storage, picking, returns
  and receiving locations; out anywhere. A correction never takes units open
  picks wait for, nor leaves fewer than shoppers bought; it tells the worker
  to ask operations instead. The shop sees each correction with the reason in
  its stock history.
- **Returned parcels** put their resellable units on the warehouse's first
  switched-on returns location (by code); while none is switched on, the
  check-in is refused (`returns_location_missing`), so no unit ends on no
  location.
- **Which shelf a new pick task names.** First a switched-on storage,
  picking, returns or receiving location whose free units fill the whole
  task; then one with some free units; then the rest. Within each group,
  storage, picking, returns and receiving locations before the damaged,
  packing and dispatch areas, switched-on locations before switched-off
  ones, storage and picking shelves before the returns and receiving areas,
  then the most free units, the most units, the code. A task is never sent
  to a shelf with too few free units while another switched-on storage,
  picking, returns or receiving location can fill it (an order of 3 with 1
  free on the shelf and 6 back in the returns area is picked from the
  returns area), and a shelf whose units are all promised never wins over
  units that came back into the returns area. One task names one location:
  when no location can fill it alone, the pick comes up short and staff
  move or recount first. The damaged, packing and dispatch areas only when
  no storage, picking, returns or receiving location holds the product,
  switched on or off. The shop's stock rows of the order are locked
  `FOR NO KEY UPDATE` first, so two releases of the same product (two
  payments confirmed at the same moment) run one after the other and the
  second counts the first's task as promised; then the candidate shelves
  are locked `FOR KEY SHARE`, so a move or a count at that moment is waited
  for.
- **Stock adds up**: a shop's on-hand units in a warehouse equal the units on
  all its locations plus those picked into parcels still being picked, after
  moves, counts, recalls and check-ins (`169_returned_stock.sql`, and the two
  race test files in `packages/db`).

## Sourcing as built

`place_order` handles each order line on its own, in a fixed order (by SKU,
then seller):

1. Lock every stock row of this offer at locations of the right kind — Yuntera
   warehouses or the seller's own — that are active, in warehouse-id order. A
   concurrent order for the same stock waits here and then reads what is really
   left, so the last unit cannot be promised twice, and because every checkout
   locks in the same order two of them cannot deadlock.
2. If one location has **all** the units the line needs, take them from there
   (the fullest such location; ties by warehouse id). The line travels whole.
3. Otherwise gather the line from the fullest locations first until it is
   covered: each location gives what it has available. The line then leaves
   in as few parcels as the stock allows.
4. For each location used: raise `reserved` there, write a reservation row for
   those units, and attach that many units of the line to the order's shipment
   from that location (`shipment_items.quantity`), creating the shipment if it
   is the first thing leaving from there.
5. If all the locations together do not have the units, the whole order fails
   with `insufficient_stock` naming the offer, and the transaction rolls back:
   no order, no partial reservation.

The result is one shipment per location the goods leave from. An order with
warehouse items and one seller-shipped item becomes two parcels, each with its
own tracking code and status; so does a line of two units whose stock is one
unit in each of two warehouses. Everything downstream already works per
reservation and per parcel: each parcel gets its own pick task for its own
units, packing consumes only that parcel's reservation and writes its own
`ship` movement, and cancelling releases every reservation of the order.
What the shop shows (`offers.available_quantity`, the sum over the same
locations) is therefore exactly what can be ordered.

Lines are always processed in the same order so that two concurrent checkouts
lock stock rows in the same sequence and cannot deadlock.

### Why this simple rule is enough for the pilot

With one Yuntera warehouse, and sellers who each ship from one location, every
line has exactly one candidate. There is nothing to optimise. The rule becomes
visibly suboptimal only when the same seller's stock of the same SKU sits in
more than one place: it then still sells every unit, but it decides line by
line, so it can use more parcels than a plan for the whole order would.

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

**The rule that is actually built** looks at one offer at a time, and an offer
sells from one kind of location (Yuntera warehouses, or the seller's own). If
the cargador offer is warehouse-fulfilled, the shop's 8 units are not its stock
at all, the warehouse has 1, and the line for 2 is refused, as the shop said it
would be ("1 available"). Stock of one offer spread over two warehouses is
gathered from both, one parcel each.

## Known limits

- **Lines are sourced one at a time, fullest location first.** A line is split
  only when no single location can send it whole, but the choice does not look
  at the order's other lines, so two lines can leave from different places
  when one place could have sent both. The planner above would do better.
- **Distance is not considered by the built rule**, only quantity. The planner
  uses straight-line distance, not road distance or delivery zones.
- **The delivery promise is computed before sourcing** and assumes warehouse
  stock ships with zero handling days from wherever it is. With several
  warehouses serving different zones that would need to become per-location.
- **Reservations are released by a scheduled job.** Without a scheduler, unpaid
  orders hold stock until the expiry function is called by hand.
- **Bins are a suggestion.** A pick task proposes one location by the rule
  above; the associate may pick from another and say so, and that can take
  units another task waits for there. A line larger than the chosen
  location's free units still comes up short there. Bin quantities are only
  as good as the putaway and pick discipline behind them.
- **A count cannot add a product that has no record on that location yet.**
- **A cancellation and a count of the same product on the same shelf at the
  same moment** can end with a deadlock for one of them
  (`private.cancel_order_internal` takes the shelf row before the stock row);
  the loser is told nothing was saved and to try again.
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
