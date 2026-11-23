# Logistics playbook

How the physical operation runs at pilot scale: one small storage space, one or
two drivers, tens of orders a day at most. It fixes the handful of rules that
keep stock, parcels and cash from getting lost, and the rhythm of a day and a
week. It is written to be followed by one or two people; anything that needs a
team is left for later on purpose.

Quantities and times below are **assumptions to validate** in the pilot unless
linked to the fact sheet or to code.

## The three rules

1. **Every unit has exactly one recorded location, and nothing moves without a
   scan.** If the system and the shelf disagree, stop and fix it before
   picking anything else.
2. **A parcel is not delivered until the shopper's PIN is entered.** No PIN, no
   delivery, whatever the driver remembers.
3. **Cash is counted against the system's figure the same day.** A variance is
   resolved before the driver's next route.

## Warehouse

### Layout

A pilot warehouse is a room: a secure space of a few dozen square metres with
shelving, a table and Wi-Fi. Its location and size are an
[open question](../08-open-questions.md); the default assumed is a small rented
space in the GAM core near the first sellers. It needs six zones, even if each
is one shelf:

| Zone             | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| _Recepción_      | Inbound stock waiting to be counted. Nothing here is sellable |
| _Almacenamiento_ | Counted stock in its locations                                |
| _Empaque_        | The packing table: boxes, bags, tape, labels, scale           |
| _Despacho_       | Packed parcels grouped by route, waiting for the driver       |
| _Devoluciones_   | Returned parcels waiting to be inspected                      |
| _Cuarentena_     | Damaged or doubtful units. Never sellable until released      |

### Location naming

One scheme from the first day, printed as barcode labels:

```
A-01-03-B
│  │  │ └─ position on the level, left to right (A, B, C…)
│  │  └─── level, counted from the floor (01, 02…)
│  └────── bay within the aisle (01, 02…)
└───────── aisle or shelving unit (A, B, C…)
```

Zone locations are named plainly: `REC-01`, `EMP-01`, `DES-R1` (dispatch, route
1), `DEV-01`, `CUA-01`. One product variant per location while the catalogue is
small: it wastes space and prevents picking errors.

### Inbound from sellers

1. The seller creates an inbound notice in _Yuntera Vende_: what, how many,
   when. Units must be individually sellable and carry a scannable barcode;
   units without one get a Yuntera label on arrival.
2. Drop-off is by appointment (proposal: two fixed windows a day).
3. On arrival the notice is opened in _Yuntera Bodega_. Each product is scanned
   and counted. Shortages, extras and damage are recorded then, with a photo,
   and the seller sees the result. Damaged units go to _Cuarentena_.
4. Target: stock is counted and available for sale within one working day of
   arrival.

### Putaway

Scan the unit, scan the destination location, confirm the quantity. Fast
sellers go at waist height nearest the packing table. Stock becomes available
to shoppers only after putaway is confirmed.

### Pick and pack

1. Orders confirmed before the cutoff appear as pick tasks. The cutoff for the
   GAM core is 14:00 (`SERVICE_PRESETS` in `packages/core/src/promise.ts`).
2. Pick one order at a time in the pilot: walk to the location shown, scan the
   location, scan the unit. A mismatch blocks the pick: the apps check the
   code, and the database checks it again against the product's stock code
   and barcode (any usual spelling of it), so a unit never leaves the shelf
   against another product's code. A line left short (0 or fewer units)
   needs no scan.
3. If a unit is missing or damaged, record the shortage in the app. Do not
   substitute. Operations contacts the shopper
   ([personas and journeys](../01-product/personas-and-journeys.md)).
4. Pack at the table: smallest packaging that protects the item; fragile items
   padded; nothing visible from outside that identifies the contents. Weigh,
   close, label. The label carries the parcel reference, route and zone, not
   the shopper's phone number.
5. Place the parcel in the dispatch location for its route.

Batch picking across orders starts only when one person can no longer keep up.

### Moving stock and correcting a count

Both are done from the location screens: **Bodega → Ubicaciones** in the field
app, **Ubicaciones** in the warehouse app (they need signal; each change is
saved at once). Open a location by scanning or typing its code.

- **Move** ("Mover"): choose the product, how many units and the shelf they
  go to (a switched-on storage or picking shelf of the same warehouse), and
  put them there right away. Only free units can move: units an open pick
  waits for stay. A move does not change what the shop can sell, and the shop
  is not told. To switch a location off, empty it first by moving everything
  to another shelf; the console then lets operations switch it off.
- **Correct a count** ("Corregir cantidad"): type what you counted and a
  reason of at least 5 letters ("faltan 2, caja rota"); the screen shows the
  difference. If the shelf changed while you counted, count again. A count
  never goes below what open picks wait for or what shoppers bought; if it
  would, tell operations, who resolve the order first. Units can be counted
  in only on storage, picking, returns and receiving locations. The shop sees
  each correction and its reason in its stock history.
- **Returned units** land on the returns location (DEV-01 in SJO1) when a
  parcel is checked in; put them on a shelf with "Mover" when convenient. The
  next pick of that product is sent there if no shelf has free units. Keep a
  returns location switched on: without one, returned parcels cannot be
  checked in.
- Operations sees every move and correction, with who made it, in the
  console, **Operación → Ubicaciones**.

## Dispatch and route building

1. After the cutoff, operations builds the next day's routes in _Yuntera
   Central_ from parcels that are packed. The planner
   (`packages/core/src/routing.ts`) groups stops by direction from the
   warehouse so each driver works one part of the city, then orders each
   driver's stops by nearest-neighbour and improves the order with 2-opt. It
   respects weight, a maximum number of stops and the length of the shift.
2. A person reviews every route. The planner ignores traffic, river crossings
   and local knowledge; the dispatcher does not. Stops can be moved between
   routes.
3. Planning figures for a motorcycle route: up to 30 stops, 40 kg and an
   8-hour shift at an average of 22 km/h door to door. These are starting
   assumptions; replace them with measured values after the first two weeks.
4. Shoppers are notified the evening before, and again when the route starts.
5. In the morning the driver scans each parcel out of its dispatch location.
   A parcel that is not scanned does not leave. The driver signs for the load
   by starting the route.

Parcels that do not fill a route, or that fall outside the core zone, go by
carrier. The [business model](../00-strategy/business-model.md) explains why:
below about 20 stops a day, a carrier is cheaper than an own driver.

## Delivery

1. The app shows the stops in order, each with the recipient's name, the map
   pin, the _señas_ and a button to call or message.
2. On approach, the driver messages the shopper. On arrival, the driver waits a
   reasonable time (proposal: 5 minutes) and calls once.
3. **Handover requires the PIN** the shopper received with the order. The
   driver enters it in the app; the system confirms it. A limited number of
   wrong attempts is allowed before the stop is blocked and operations is
   alerted.
4. If someone else receives the parcel, they must have the PIN. The driver
   records their name.
5. The app records the time and position of the delivery. A position the
   phone puts outside Costa Rica is kept but flagged for staff; an action
   sent later from a dead zone (arrival, failed delivery) keeps the time it
   happened, if within the last day. Each stop shows its district and cantón
   above the señas.

Photo proof without a PIN (leaving a parcel in a safe place) is not offered in
the pilot. If introduced later it is by the shopper's prior choice, never the
driver's decision.

### Cash on delivery

- The app shows the exact amount to collect. The driver collects it before
  handing over the parcel and confirms the amount in the app.
- SINPE Móvil at the door is accepted to Yuntera's registered number; the
  driver waits for the confirmation on screen. Transfers to a driver's personal
  number are prohibited.
- Drivers carry a small float for change (proposal: ₡20,000) that is theirs to
  return.
- Orders flagged by the risk rules are prepaid, not cash
  (`packages/core/src/risk.ts`).
- A driver carries no more cash than a set limit (proposal: ₡150,000) before
  returning to deposit it.

### Daily cash reconciliation

At the end of every route:

1. The app shows the cash the driver should hold: the sum of cash stops
   delivered.
2. The driver hands it in; a second person counts it; both confirm the figure.
3. A difference is recorded with an explanation the same day. A shortfall is
   investigated before the driver's next route; repeated variances end the
   engagement.
4. Cash is deposited to the bank the next banking day and the deposit matched
   to the day's figure.

## Failed deliveries and returns

| Situation                     | Action                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nobody home                   | Message and call; mark the stop failed with the reason. The parcel returns to the warehouse and is scanned into _Despacho_ for a new date the shopper chooses                                                                                                |
| Address cannot be found       | Call; if unresolved, as above, and operations corrects the pin with the shopper                                                                                                                                                                              |
| Shopper refuses the parcel    | Mark refused. The parcel returns; a cash order is cancelled, a prepaid one refunded according to policy                                                                                                                                                      |
| Second failed attempt         | The order is cancelled and refunded as described in [customer service](customer-service.md)                                                                                                                                                                  |
| Staff stop a packed parcel    | Operations stops it from the staff order page ("Detener el paquete", a reason and the tick box), while it is packed or on a route that has not started; its stop leaves the route. The warehouse list shows it as "Nunca salió de la bodega"; check it in as a returned parcel and put the units back. The shopper is refunded (the delivery fee too, if nobody went to the door) and the order is cancelled |
| Withdrawal or warranty return | The driver collects on a regular route. The parcel is scanned into _Devoluciones_, inspected within one working day, and graded: resellable (back to its location), damaged (quarantine, returned to the seller), or disposed of with the seller's agreement |

When a parcel comes back and the order ends cancelled, the delivery fee is
refunded too if no driver ever went to the shopper's door; after a real
attempt it stays charged (decision 43).

Every returning parcel is scanned back in the same day. A parcel that left and
did not come back delivered or scanned in is a missing parcel and is
investigated that evening.

## Service levels

Defined in `SERVICE_PRESETS` (`packages/core/src/promise.ts`) and shown to
shoppers as a delivery date.

| Zone                          | Order cutoff | Processing and delivery days | Delivery after dispatch |
| ----------------------------- | ------------ | ---------------------------- | ----------------------- |
| GAM core                      | 14:00        | Monday to Saturday           | Next delivery day       |
| GAM extended                  | 12:00        | Monday to Saturday           | 1–2 delivery days       |
| Rest of the country (Phase 4) | 12:00        | Monday to Friday             | 2–5 delivery days       |

Public holidays are skipped. A zone and day that is full is closed in the
calendar so that later orders are promised the following day rather than
over-promised. The GAM has 31 cantons
([fact sheet, section 6](../research/costa-rica-fact-sheet.md#6-geography-and-addressing));
which of them form the core zone at launch is decided from where the first
sellers and shoppers are.

A promise is a legal commitment: missing it entitles the shopper to a full
refund. When capacity is in doubt, promise later.

## Operating rhythm

### Every day

| When          | What                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| Start of day  | Drivers scan out and start routes. Check yesterday's cash deposit                       |
| Morning       | Receive inbound appointments. Pick and pack orders as they confirm                      |
| 14:00         | Cutoff. Finish picking and packing                                                      |
| Afternoon     | Build and review tomorrow's routes; send carrier parcels; inspect returns               |
| End of routes | Scan back failed parcels; reconcile cash; review failed deliveries and contact shoppers |
| Close         | Tomorrow's shoppers notified. No parcel unaccounted for. No cash variance open          |

### Every week

- Count a section of the shelves and compare with the system; every location
  is counted at least once a month.
- Review the metrics below and the three worst orders of the week: what went
  wrong and what would have prevented it.
- Review each seller's inbound accuracy and stock that has not moved.
- Check supplies: packaging, labels, the float.

### The metrics to watch

Seven numbers, on one page, reviewed weekly.

| Metric                                                    | Target (assumption to validate)       | Why                                     |
| --------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| On-time delivery against the promised date                | ≥ 95%                                 | The promise is the product              |
| First-attempt delivery success                            | ≥ 90%                                 | Failed attempts double the cost         |
| Delivered stops per driver-day                            | Rising toward 25                      | Decides delivery cost per order         |
| Picking accuracy (orders with the right items)            | ≥ 99%                                 | Errors cost a second delivery and trust |
| Inventory accuracy (locations where count matches system) | ≥ 98%                                 | Wrong stock breaks promises             |
| Cash variance                                             | Zero, daily                           | Small leaks become habits               |
| Order confirmed to parcel packed                          | Same day for orders before the cutoff | Otherwise the promise slips             |
