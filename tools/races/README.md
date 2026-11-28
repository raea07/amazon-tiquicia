# Stock-lock races

Two real database sessions, let go at the same moment, against the functions
that write stock, offers, product summaries and parcels. Each family runs its
scenarios many rounds and prints, per scenario, how many rounds ended in a
deadlock, a serialisation error, a timeout, or a wrong result. They are slow
(minutes per family) and are **not** part of `pnpm test`; the few rounds that
must never regress are kept as contract tests in
`packages/db/src/contract.stock-lock-order-races.test.ts` and
`contract.stock-product-races.test.ts`.

The harness started as an independent review's scripts for wave 7 and was
brought into the repository in wave 8 (migration
`20261121084400_stock_lock_order.sql`), with families E made deterministic and
F, G, H and parts of C added (E11 and G2 come from an independent review
of wave 8), family I when the three wave 8 workstreams were merged, and family J
when the four wave 9 workstreams were (the support desk against Atención).

## Safety

- Only a local database is accepted: the URL must point at `127.0.0.1` or
  `localhost`, have no query string and no fragment (node-postgres would let
  `?host=`, `?port=` or `?options=` override the host the guard checked), and
  the database must be a lane's own: `yuntera_lane1` to `yuntera_lane19`, or
  such a name followed by `_<word>` (a lane's scratch copy, such as
  `yuntera_lane12_pre`). Lane 0's database (`yuntera_local`) and every other
  name are refused. The connection is built from the checked parts of the
  URL only. `node tools/races/guard-check.cjs` checks the guard against a list
  of URLs it must accept and refuse; `run-all.sh` runs it first.
- Each round cancels every open order of the harness's shoppers and rewrites
  the shelves of the products it uses (direct writes as the database owner).
  Run it only against a database nothing else uses, with the lane's stack
  **down** (`tools/dev/stack.sh down <lane>`), so no worker consumes the events.
- Never run two scripts against the same database at once. Two lanes may
  run at once: the barrier counts only its own database's waiters.
- **Reset the lane's database after a run** (`pnpm db:local:reset` with the
  lane's variables) before using it for journeys or tests. At the end the
  harness archives its own products (X, Y, Z, W) and pauses their offers, so
  the catalogue does not list them, and puts back the limits it raised; it
  leaves its shoppers (`carrera-w7-*`) with their addresses and orders, the
  shelves W7-01..03, the second shop's warehouse offer it may add to a seed
  product, the per-round brands of E11 and the second variant of W that H8 adds.
- The passwords in the examples are the local lane defaults.

## Running

1. Build the lane's database from the checkout under test (lane 15 here):

   ```bash
   eval "$(tools/dev/stack.sh env 15)"   # PG_DB_NAME=yuntera_lane15, DATABASE_URL
   echo "$PG_DB_NAME"                      # check it before the reset
   pnpm db:local:reset
   ```

2. Run one family, part of one, or all:

   ```bash
   node tools/races/race-c-sort-keys.cjs "$DATABASE_URL" 100
   node tools/races/race-c-sort-keys.cjs "$DATABASE_URL" 100 'C3'     # scenarios matching a regex
   node tools/races/race-h-seller-pack.cjs "$DATABASE_URL" 100 . out.jsonl   # and the table as JSON lines
   tools/races/run-all.sh "$DATABASE_URL" 100 head                     # every family, into tools/races/results/
   FAMILIES="E F G" tools/races/run-all.sh "$DATABASE_URL" 100 head /some/dir
   ```

   `run-all.sh` writes `<tag>-<family>.txt` (the table) and `.jsonl` (the same
   as JSON lines) per family. `tools/races/results/` is ignored by git.

3. To compare with an older commit, build a second database from that
   commit's SQL into a scratch folder (lane 12's scratch copy here):

   ```bash
   mkdir -p /tmp/pre && git archive <commit> supabase | tar -x -C /tmp/pre
   (cd /tmp/pre/supabase && PG_DB_NAME=yuntera_lane12_pre bash scripts/local-db.sh reset)
   tools/races/run-all.sh postgres://postgres:postgres@127.0.0.1:5432/yuntera_lane12_pre 100 base
   psql postgres://postgres:postgres@127.0.0.1:5432/postgres -c 'drop database yuntera_lane12_pre with (force)'
   ```

## The families

| File                             | Family | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `race-a-known-deadlocks.cjs`     | A      | The stock-row deadlocks of wave 7 stay gone: a payment confirmation against the unpaid-order sweep, against packing and against a staff cancellation of one product from two shops; checkout against packing and the sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `race-b-sweep.cjs`               | B      | The sweep (`private.expire_unpaid_orders`) against itself, against paying or cancelling an order of its set or outside it, against every stock writer; a large backlog (200 and 1000 expired orders over 20 products, timed, with a checkout and a payment started 20 ms after the sweep); odd expired orders. From 084400 a run cancels at most 200 orders, the oldest: B5 then checks that what it cancelled is the oldest part, the rest still wait for payment, and later runs take them.                                                                                                                                                                                                                                                                                                           |
| `race-c-sort-keys.cjs`           | C      | Cancellations (`private.cancel_order_internal`) of one product from two shops on one shelf, half picked; C3 a cancellation of a picked order against a count, a receipt and a pick on the same shelf (natural and forced); C4 a cancellation against the picker confirming the order's other line (natural and forced): never a unit picked and not put back.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `race-d-confirm-table.cjs`       | D      | Payment confirmations against each other and every stock writer, on three shelf layouts: never a pick task promised more than its shelf holds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `race-e-product-rows.cjs`        | E      | Product rows (one level above stock rows). E1 to E4 and E2: the sweep, checkouts, packing and a cancellation of two products that stay in stock, in opposite order: they must never touch a product row. E5 to E9: offers that cross zero (E5 two checkouts, E5b a cancellation and a checkout, in opposite order), and the other writers of product rows (a seller pausing an offer, a shop suspended, staff taking a product down, a seller sending an edit for review); E10, E10b and E10c packing, a checkout and a second switch against a seller switching off a shared variant; E11 staff merging the brand of two products against a checkout of their last units. After every round each product's stored summary must equal one computed from scratch.                                        |
| `race-f-stale-summary.cjs`       | F      | The listing summary is never left stale by two writers of different offers of one product at once (two checkouts of the last units, a cancellation and a checkout).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `race-g-recall-route.cjs`        | G      | Staff stopping a parcel (`ops_recall_shipment`) at the moment its driver starts the route (`driver_start_route`): either the stop wins (the parcel comes back, its stop is gone, the route starts without it) or the start wins (the stop is refused in plain words); never a deadlock, never a parcel coming back that its stop says to deliver. G2: staff taking a stop off the route (`ops_remove_route_stop`) at the moment the route starts.                                                                                                                                                                                                                                                                                                                                                       |
| `race-h-seller-pack.cjs`         | H      | A shop packing a parcel it ships itself (`seller_mark_packed`, Tienda Sendero's own warehouse, the harness's product W) against the shopper or staff cancelling the order (H1, H1b: one wins, the other is refused in plain words), a checkout of the same offer, the shop's count, the sweep, the warehouse packing the order's other parcel, the shop pausing the offer and switching off its variant (H8, the E10 mechanism); H7 races warehouse packing (`wms_pack_shipment`) against staff cancelling the same order, for comparison.                                                                                                                                                                                                                                                              |
| `race-i-count-into-location.cjs` | I      | A count of a product into a location that does not list it (`wms_count_into_location`, 084500) against a staff cancellation putting picked units back on that shelf, a shopper's cancellation, a correction, a move into that shelf, a pick at another shelf and one at that shelf, a returned parcel checked in to the returns area, a second count (one count, never the sum), and (I8) the shop switching off a variant two shops sell while the count takes its offer across zero; natural and forced both ways round. Every round of I1 to I7 starts with the target shelf's row at 0 units.                                                                                                                                                                                                       |
| `race-j-support-desk.cjs`        | J      | The support desk (084700, wave 9) against Atención and account deletion: an answer in Casos against one in Atención on the same complaint (J1, J1b), reopening against answering (J2), two answers at once (J3 both kept in order; J3b both closing, one refused), assigning against answering (J4), the shopper deleting their account against an answer to their recorded contact (J5: erased with the account, or refused after it), and a return decision with a note against an answer on its case (J6). The source row's status and the case's must agree afterwards, with every accepted answer on the timeline once. With `ops_answer_case` taking the case before the complaint (its order before the support desk's review), J1 deadlocked in 15 of 100 natural and 100 of 100 forced rounds. |
| `lib.cjs`                        |        | The harness: fixture, sessions acting as demo users, the barrier, the checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `run-all.sh`                     |        | Every family against one database, one after another.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Family J also races the account deletion against the other staff writers of
a case (J7 recording a contact, J9 reopening a closed complaint's case, J10
answering an open report, J11 assigning an open contact) and one writer's
texts against each other (J8); the file's header says what each must leave.
Before `ops_reopen_case` took the customer's account row first, J9 left an
open case on a deleted account in 28 of 30 rounds.

**Natural and forced.** A "natural" scenario lets both sessions go at the
same moment (each may start a few milliseconds late, varied by round) and
counts what happens. A "forced" scenario adds a third session that takes a
lock before the barrier opens and lets go 150 ms after it (200 ms in F): it
holds the row one writer needs between its two locks, the other starts 40 ms
late and takes what the first needs next. Where the lock order is wrong a
forced round deadlocks every time; where it is right it never does. Each
family file says what it holds.

## How it works

- **The pg module** is the one `packages/db` depends on (resolved from
  `packages/db/package.json`), so run `pnpm install` first.
- **Sessions act as demo users** the way the contract tests do: a pooled
  connection opens a transaction (READ COMMITTED, the default and the level
  every caller of the API runs in), sets `statement_timeout = '20s'`, sets
  `request.jwt.claims` to `{"sub": <user id>, "role": "authenticated",
"aal": "aal2"}` with `set_config(..., true)` and runs `set local role
authenticated`. The sweep runs as the database owner, as pg_cron does.
  Users: `central@yuntera.example` (staff), `bodega@yuntera.example`
  (warehouse), `repartidor@yuntera.example` (driver, family G),
  `sendero@yuntera.example` (owner of Tienda Sendero, families E and H) and eight
  shoppers the harness creates, `carrera-w7-1..8@yuntera.example`, each with
  a copy of the demo shopper's address.
- **The barrier.** A control session holds advisory lock 7707001. Every racer
  of a round, inside its transaction, first waits on
  `pg_advisory_xact_lock_shared(7707001)`; when all are queued (checked in
  `pg_locks`) the control session lets go and all start together. Each racer
  commits as soon as its own call ends, or rolls back on error.
- **Fixtures.** Family J uses its own complaints, accounts and cases, and one delivered line of the demo shopper for J6. Families A to D use two seed products of Tienda Sendero
  (`balon-futbol-sendero-5` and `rompecabezas-volcanes-500`; "low" is the one
  whose SKU id sorts first) and a second shop's (Cafetal Los Santos)
  warehouse offer of "low". Families E, F and G use the harness's own
  products, built as the database owner with ids chosen in `lib.cjs`
  (`FIXTURE`), so the lock order they test is the same on every database
  build: product X (variants x1 and x2), product Y (sold by both shops) and
  product Z (one variant sold by both shops), with SKU ids x1 < y < x2 and
  product ids Y < X. Family H uses product W, which Tienda Sendero ships
  itself from its own warehouse (`sellerStock()` sets its free units there;
  seller warehouses have no shelves).
- **Reset per round.** Every round makes fresh orders. Before them,
  `layout()` cancels every open harness order (packed parcels stay: they hold
  no reservation), rewrites the bins of the round's products in SJO1 to a
  known layout and sets `on_hand` to the bins plus units picked into open
  parcels and `reserved` to the active reservations (direct writes as the
  owner; the stock ledger is not written for these). The harness creates
  shelves W7-01..W7-03 and uses the returns area DEV-01. It raises four
  per-account limits for the run and puts the old values back at the end, and
  runs the sweep once at setup to clear expired orders the database already
  had.
- **What counts as wrong** (`check()` and each scenario's `verify`):
  `on_hand` against the bins plus units picked into open parcels; `reserved`
  against active reservations; `offers.available_quantity` against
  `on_hand - reserved`; a negative bin; a location promised more than it
  holds; an open task at a location without the product; a cancelled order
  with an active reservation, a parcel or a task left, a captured payment
  without exactly one cancellation refund, a ledger account of the order
  that does not net to zero, a payment still pending; more than one capture,
  refund, `payment.captured` or `order.cancelled` event; an unpaid order with
  a capture or tasks; a confirmed card order without a capture; sweep counts
  that do not add up; a product summary that differs from one computed from
  scratch (E, F); a route and its parcels in a state the driver could not act
  on (G).

## Reading the table

One line per scenario:

```
<database> | <scenario> | rounds 100 | lock-error rounds 3 | timeout rounds 0 | wrong rounds 0 | <actor>: <outcome> <count>; ... | max ms {...} | <seconds>s
```

- **lock-error rounds**: rounds where any actor ended with 40P01 (deadlock)
  or 40001 (serialisation failure). The outcomes list says which (`DEADLOCK`,
  `SERIALIZATION`) and who lost. A loser's transaction rolled back whole; the
  apps tell the person "nothing was saved, try again" (`try_again`).
- **timeout rounds**: rounds where an actor hit the 20 s statement timeout
  (57014).
- **wrong rounds**: rounds where `check()` or the scenario's `verify` found a
  violation; the first three are printed as `examples`, all are counted under
  `violations`. A round that deadlocked may also be wrong when the loser's
  work was what the check expected (for instance an expired order left
  pending because the sweep lost); read the examples.
- **outcomes**: per actor, `ok` or the error code it was refused with (an
  allowed refusal, such as `order_not_payable` or `shipment_not_recallable`,
  is not wrong unless the scenario says so).
- **max ms**: each actor's slowest call. A deadlock costs about 1 s (the
  server's `deadlock_timeout`); a forced round about the holder's 150 ms.
