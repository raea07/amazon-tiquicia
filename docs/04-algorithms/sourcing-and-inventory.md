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
  switched on or off, even when that location cannot fill the task (a
  certain short pick, resolved by moving units onto a shelf, is preferred to
  sending a picker to units that may be damaged or set aside at a station).
  The shop's stock rows of the order are locked `FOR NO KEY UPDATE` first,
  by product, shop and warehouse, so two releases of the same product (two
  payments confirmed at the same moment) run one after the other and the
  second counts the first's task as promised; then the candidate shelves
  are locked `FOR KEY SHARE`, so a move or a count at that moment is waited
  for. Checkout, packing, a cancellation and a receipt of the same product
  wait for an open payment confirmation of it; reads and picks do not. This
  relies on READ COMMITTED, the level every caller runs in: under
  REPEATABLE READ the second release would wait and still count from its
  snapshot.
- **One order for stock rows.** Every function that writes the stock rows of
  several products, or of one product from several shops, in one
  transaction takes them by product, shop and warehouse: checkout, a release
  to picking, packing (`private.consume_shipment_stock`), a cancellation
  (`private.cancel_order_internal`) and the unpaid-order sweep
  (`private.expire_unpaid_orders`), which cancels many orders in one
  transaction and so takes the stock rows of all of them first, in one
  statement. Without it a payment confirmation racing the sweep, or packing
  an order that holds one product from two shops, ended in a deadlock for
  one of the two (`contract.stock-lock-order-races.test.ts` makes each race
  happen and fails without the fixed order). The full order, with orders,
  parcels, shelves, offers and product rows, is in
  [the lock order](#the-lock-order-084400) below.
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
   locks stock rows in the same order two of them cannot deadlock on stock
   rows. One level up, on product rows, two checkouts can still deadlock in
   one case: when each takes offers of two shared products across zero in
   opposite order (see [the lock order](#the-lock-order-084400)).
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
lock stock rows in the same sequence and cannot deadlock on them. Packing,
cancellations, the release to picking and the unpaid-order sweep take stock
rows in the same order (product, shop, warehouse).

### The lock order (084400)

Every session of the API runs in READ COMMITTED (the database default; no
role or function sets another level). Two functions rely on it: the release
to picking (it counts the other release's task after waiting for it) and the
listing summary (it computes from what the other refresh committed after
waiting for the product row). Under REPEATABLE READ both would wait and then
still read from their snapshot.

**The one order.** A transaction that takes several of these rows takes them
in this order:

1. the warehouse row (`FOR NO KEY UPDATE`; only moves and counts take it:
   every other stock writer takes only a key-share lock on it, through its
   ledger row, which does not wait for them);
2. the location row (`FOR SHARE`; moves and counts);
3. the order row (`FOR UPDATE`);
4. its parcel (shipment) row;
5. its open pick tasks;
6. stock rows (`stock_levels`), by product, shop and warehouse. Each stock
   row written takes, through triggers, its offer row
   (`refresh_offer_availability`) and, **only when that offer crosses zero**
   (out of stock, or back in stock), its product row
   (`refresh_product_summary`);
7. shelf rows (`bin_stock`), by product, shop and location.

A reservation is taken after the order row by whoever owns the order:
packing takes them before the stock rows, a cancellation after; both hold
the order row first, so the two never meet (race H1, a cancellation against
a shop packing its own parcel of the same order, and H7, against the
warehouse packing it, which takes the order first since 084200: 0 in 100
natural and in every forced variant since 084400).

| Writer                                                  | What it takes, in order                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout (`place_order`)                                | stock rows of every line (`FOR UPDATE`), the offers (`FOR SHARE`, id order); per line by product and shop: the order line (key-share on product, variant, shop), the stock row's update (offer; product if it crosses zero); a cash order is then released |
| Release to picking (payment confirmation, a cash order) | order (confirmation), stock rows (`FOR NO KEY UPDATE`), the candidate shelves (`FOR KEY SHARE`), new pick tasks                                                                                                                                            |
| Start picking                                           | order, parcel, its tasks                                                                                                                                                                                                                                   |
| Pick (`wms_confirm_pick`)                               | its task (`FOR UPDATE`), one shelf row                                                                                                                                                                                                                     |
| Packing (`wms_pack_shipment`)                           | order, parcel, reservations (`FOR UPDATE`), stock rows and their offers; never a product row (on hand and reserved go down together, so an offer never crosses zero)                                                                                       |
| A shop packing its own parcel (`seller_mark_packed`)    | since 084400: order, parcel, reservations (`FOR UPDATE`), stock rows and their offers (never a product row, as above). Before: parcel, stock rows, then the order. Raced (family H) against everything it can meet: 0                                      |
| Count (`wms_adjust_stock`)                              | warehouse, location, stock row (`FOR UPDATE`), shelf row (`FOR UPDATE`), then the writes (offer; product if it crosses zero)                                                                                                                               |
| Move (`wms_move_stock`)                                 | warehouse, target location, both shelf rows (location id order); no stock row                                                                                                                                                                              |
| Receipt (`wms_receive`)                                 | stock row (`FOR UPDATE`), its update (offer; product if it crosses zero), the shelf row                                                                                                                                                                    |
| Returned parcel checked in                              | order, parcel, per line by product and shop: stock row (offer; product if it crosses zero), the returns location's shelf row                                                                                                                               |
| Cancellation (`private.cancel_order_internal`)          | order, its open pick tasks, every stock row it writes (`FOR NO KEY UPDATE`), the shelves its picked units go back to, the tasks and parcels closed, reservations (`FOR UPDATE`), the stock rows' updates (offer; product if it crosses zero)               |
| Unpaid-order sweep (`private.expire_unpaid_orders`)     | at most 200 expired orders, oldest first (`FOR UPDATE SKIP LOCKED`), the stock rows of all of them, then each cancellation as above                                                                                                                        |
| Route start (`driver_start_route`)                      | the orders of its pending stops (id order), the route, each parcel, each order again (status)                                                                                                                                                              |
| Stopping a parcel (`ops_recall_shipment`)               | order, parcel, then (if planned) the route, the stop, the parcel                                                                                                                                                                                           |

Until 084400 the cancellation took a shelf row before the stock row (the
opposite of a count, a receipt and a pick) and closed its pick tasks only
after its shelves: a cancellation against a count or a receipt of the same
product on the same shelf deadlocked, and against the picker confirming the
order's other line it could leave the unit just picked off its shelf and
never put back (on hand then exceeded the shelves). A route start took the
route and its parcels before their orders, so staff stopping one of its
parcels at that moment deadlocked with it (and staff taking a stop off it,
`ops_remove_route_stop`, race G2). A shop packing a parcel it ships itself
(`seller_mark_packed`) took the parcel and the stock row before the order, so
the shopper or staff cancelling the order at that moment deadlocked with it
(race H1, measured at eaca8ad: staff 18 and the shopper 17 in 100 natural
rounds, every forced round; 0 since it takes the order first). Moving that
lock to the front changes a core stock writer, so every writer it can meet
on the same order, parcel, stock row, offer or variant was raced, 100
natural and 100 forced rounds each, before and after: a checkout of the same
offer, the shop's count, the sweep, the warehouse packing the order's other
parcel, the shop pausing the offer or switching off its variant (H2 to H6,
H8): 0 in every one.

**Product rows.** One product row is shared by every variant of the product
and every shop that sells it, and nothing takes product rows in one order
across products. Two rules keep stock writers off them:

- The summary (`offer_count`, `featured_offer_id`, `min_price_minor`,
  `list_price_minor`, `in_stock`, `fulfilled_by_platform`,
  `best_handling_days`) depends on whether an offer has units, never on how
  many. An offer's update refreshes it only when an input really changed:
  price, list price, status, fulfilment, handling days, condition, or the
  units crossing between zero and more than zero (`offers_summary_trigger`);
  an insert or a delete always refreshes. The refresh writes the row only
  when a value differs. An ordinary sale, receipt or release that leaves an
  offer on the same side of zero does not touch the product row, and
  neither does any pack (packing lowers on hand and reserved together, so
  what shoppers can buy does not move; the SQL suite 171 checks it for both
  kinds of packing).
- The refresh takes the product row `FOR NO KEY UPDATE` before it reads the
  offers, so two refreshes of one product run one after the other and the
  later one computes from what the earlier committed. Before, two checkouts
  taking the last unit of two different offers of one product left it "in
  stock" with a featured offer that had nothing to sell, until the next
  change to one of its offers (race F).
- A path that refreshes several products takes them in product id order
  (`sellers_summary_trigger`: a shop approved, suspended or closed). This is
  a convention, not a measured fix: no race found depends on it (E7 deadlocks
  the same with and without it, and taking it out fails no test).

With 084400 the races where the products stay in stock (the sweep against
a checkout, packing or a cancellation; two checkouts) went from 4 to 41
deadlocks in 100 natural rounds (every forced round) to 0, and the stale
summary (race F) from 58 to 100 wrong rounds in 100 to 0. What still can
deadlock on product rows, measured with 100 natural and 100 forced rounds
in `tools/races` on a local database of a shared machine (family E;
numbers natural / forced). The loser's transaction rolls back whole; the
shopper, packer or staff member reads "Alguien más cambiaba lo mismo en ese
momento, así que no se guardó nada. Inténtelo de nuevo." (`try_again`); the sweep runs again five minutes later:

- two transactions that each take offers of two shared products across zero
  in opposite order: two checkouts of last units (E5: 29 to 33 / 43 to 63
  in two runs); a staff cancellation giving back last units against such a
  checkout (E5b: 1 / 65); by the same mechanism, not raced separately, the
  sweep against such a checkout (packing never takes an offer across zero);
- a cancellation or the sweep that gives back the last unit of one offer of
  a product and then writes another offer of the same product, against the
  seller changing or pausing that second offer at that moment (the seller's
  update takes the offer row, then the product row) (E6). A checkout does
  not: it takes its offers `FOR SHARE` before it writes any stock row, so
  the seller waits for it (E6: 22 to 26 / 100; E6b: 0 / 0);
- a shop suspended or reinstated (its products in id order) against a
  writer that takes two of its products across zero in the other order
  (E7: 1 to 3 / 100);
- staff merging two brands (`ops_merge_brands`: one `UPDATE` of every
  product of the brand, in scan order) against a checkout that holds one of
  those products after taking its offer across zero and wants another (E11,
  found by an independent review: natural 0 for a checkout of [x1, low]
  and 4 to 8 for [second, x2] in 100 rounds; forced up to 38 and 56 in 100,
  depending on which session waits first; the same before 084400). Rare (a
  staff action). No summary was wrong in any round.

Not on product rows, found while listing their writers: packing against a
seller switching off a variant two shops sell (E10: 10 to 13 / 100 natural,
every forced round; 15 to 20 natural before 084400). `seller_set_variant_active`
takes the variant `FOR UPDATE`, which waits for the key-share lock packing's
ledger row takes on it, while packing waits for the offer the seller pauses.
A shop switching off the variant of a parcel it packs itself did not
deadlock in the same race (H8: 0 / 0, before and after 084400).

**Every statement that writes or locks `public.products`** (the definitions
in force), the order its path takes, and what it means for stock writers.
"Key share" is the lock an insert of a row that references the product, its
variant or its shop takes (an order line, a ledger row, a reservation); a
`FOR UPDATE` waits for it and blocks it.

| Path                                                                                                                                                                                                                                                                  | On the product row                                                        | Before                                        | After                                                                 | Against a stock writer                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.refresh_product_summary` (offers, shops and variants triggers)                                                                                                                                                                                               | `FOR NO KEY UPDATE`, then `UPDATE` when a value differs                   | the offer, shop or variant row that changed   | nothing                                                               | same direction as a stock writer (offer, then product); the cases above                                                                                                                                                                                                           |
| `private.sellers_summary_trigger` (shop status)                                                                                                                                                                                                                       | each of the shop's products, id order                                     | the shop row                                  | nothing                                                               | E7                                                                                                                                                                                                                                                                                |
| `private.skus_summary_trigger` (variant switched)                                                                                                                                                                                                                     | one product                                                               | the variant row (and offers paused before it) | nothing                                                               | see `seller_set_variant_active`                                                                                                                                                                                                                                                   |
| `private.refresh_product_signals` (nightly, 08:17 UTC)                                                                                                                                                                                                                | one `UPDATE` over every product whose 30-day units changed, in scan order | nothing                                       | nothing                                                               | could meet a writer holding one product row after crossing zero (by reading; not raced; the same mechanism as `ops_merge_brands`, which deadlocked in E11; runs at 02:17 Costa Rica time)                                                                                         |
| `private.reviews_rating_trigger`                                                                                                                                                                                                                                      | `FOR UPDATE`, `UPDATE`                                                    | the review row                                | nothing                                                               | by reading, not raced: it takes the review's product after the review row and nothing a stock writer holds                                                                                                                                                                        |
| `private.take_down_product`, `public.ops_restore_product`, `public.ops_correct_product`, `public.seller_archive_listing`, `public.ops_review_product`, `private.photos_touched`, `private.photo_listing`, `public.ops_review_photo_change`, `public.ops_remove_photo` | `FOR UPDATE` and/or `UPDATE`                                              | nothing a stock writer holds                  | audit, outbox, change-request and photo rows                          | no cycle found by reading; raced only for `private.take_down_product` (E8: staff taking a product down against a cancellation crossing zero, 0 / 0); the other eight not raced                                                                                                    |
| `public.seller_update_listing`, `public.seller_unpublish_listing` (`private.own_listing`)                                                                                                                                                                             | `FOR UPDATE`                                                              | nothing                                       | the shop row `FOR UPDATE`, then variants or a change request          | by reading: the shop's `FOR UPDATE` waits for a writer's key share on the shop, and a writer that then wants the product (crossing zero) would make a cycle; E9 raced it against a checkout of last units and measured 0 / 0 before and after 084400, so the cycle was never seen |
| `public.seller_set_variant_active` (`private.own_listing`)                                                                                                                                                                                                            | `FOR UPDATE`                                                              | nothing                                       | the variant `FOR UPDATE`, the shop's offers of it paused, the variant | the variant's `FOR UPDATE` blocks a writer's key share on it (its ledger row): a cycle with packing even when nothing crosses zero (E10)                                                                                                                                          |
| `public.seller_add_offer`                                                                                                                                                                                                                                             | `FOR UPDATE`                                                              | the shop row `FOR UPDATE`                     | the variant `FOR UPDATE`, the offer inserted or updated               | by reading: as `seller_set_variant_active` (not raced)                                                                                                                                                                                                                            |
| `public.seller_create_listing`                                                                                                                                                                                                                                        | `INSERT` (a new row)                                                      | the shop row `FOR UPDATE`                     | variant, offer inserted                                               | nothing else holds a new row                                                                                                                                                                                                                                                      |
| `public.ops_review_listing_edit`                                                                                                                                                                                                                                      | `FOR UPDATE`, `UPDATE`                                                    | the change request                            | offers below the fee floor paused, variants updated                   | product before offers, the opposite of a stock writer; a checkout holding those offers `FOR SHARE` and wanting a key share on the product could deadlock with it (by reading; not raced)                                                                                          |
| `private.sellers_hand_over_on_close` (a shop closes)                                                                                                                                                                                                                  | the shop's listings `FOR UPDATE`, id order, `UPDATE`                      | the shop row                                  | change requests, photos, logos                                        | id order, as the summary refresh                                                                                                                                                                                                                                                  |
| `public.ops_merge_brands`                                                                                                                                                                                                                                             | one `UPDATE` over every product of a brand, scan order                    | the brand rows                                | nothing                                                               | staff action, rare: against a checkout crossing zero on two of the brand's products it deadlocks (E11: natural 0 for a checkout of [x1, low] and 4 to 8 for [second, x2] in 100 rounds; forced up to 38 and 56 in 100, depending on which session waits first); no summary wrong  |
| `private.refresh_product_search` (products trigger)                                                                                                                                                                                                                   | `UPDATE` of the same row                                                  | the row, held by the caller                   | nothing                                                               | none                                                                                                                                                                                                                                                                              |

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
  orders hold stock until the expiry function is called by hand. Each run
  cancels at most 200 expired orders, the oldest first (084400): a run holds
  the stock rows of every order it cancels until it ends (about 2 ms an
  order), and a checkout of one of those products waits for it. A backlog
  larger than 200 is cleared over the next runs, five minutes apart.
- **Bins are a suggestion.** A pick task proposes one location by the rule
  above; the associate may pick from another and say so, and that can take
  units another task waits for there. A line larger than the chosen
  location's free units still comes up short there. Bin quantities are only
  as good as the putaway and pick discipline behind them.
- **A count cannot add a product that has no record on that location yet.**
- **Product rows are not taken in one order across products.** Writers that
  take offers of two shared products across zero in opposite order, a
  seller's offer change against a cancellation crossing zero on the same
  product, a shop's suspension against such a writer, and staff merging two
  brands against a checkout crossing zero on two of their products can still deadlock
  (see [the lock order](#the-lock-order-084400)); the loser is told nothing
  was saved and to try again.
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
