# Routing

Turning a list of parcels that are ready to leave into routes: which driver
takes which stops, and in what order.

- Specification and implementation: `packages/core/src/routing.ts`
  (`planRoutes`)
- Tests: `packages/core/src/routing.test.ts`
- Where the result is saved: `ops_create_route` in
  `supabase/migrations/20261121081100_fulfillment.sql`
- State: the planner is built and tested. It is meant to run in the ops
  console's dispatch board, which is in progress. The database does not plan
  routes; it validates and records the plan it is given, so a dispatcher can
  also order stops by hand.

## Goal

Give each driver a compact set of stops in one part of the city, in an order
that does not double back, within what the vehicle can carry and the shift
allows. Be fast, repeatable and easy to check by eye. Being a few percent from
optimal does not matter at pilot volume; being unexplainable does.

## Inputs

| Input           | Meaning                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Depot           | The warehouse the routes start from                                                                  |
| Stops           | For each: location, weight in kg, minutes needed at the door                                         |
| Vehicles        | For each: capacity in kg, maximum stops, shift length in minutes, average door-to-door speed in km/h |
| Circuity        | Road distance ÷ straight-line distance. Default **1.4** (`DEFAULT_CIRCUITY`)                         |
| Return to depot | Whether the route ends back at the depot. Default yes: cash and failed deliveries must come back     |

Distances are great-circle (haversine) distances multiplied by the circuity
factor. There is no road network and no traffic data.

## The method

This is a capacitated vehicle-routing problem, solved with a classic two-phase
heuristic.

### Phase 1 — sweep: who takes what

1. Stops heavier than the largest vehicle can carry are set aside as
   `exceeds_vehicle_capacity`.
2. The rest are sorted by compass bearing from the depot (ties by stop id), so
   that neighbours in the list are neighbours on the map.
3. Walk around the circle, filling one vehicle at a time. A stop is added to
   the current vehicle unless it would exceed the vehicle's maximum stops, its
   weight capacity, or its shift — the shift being checked with a quick
   estimate of the route's driving and service time. When a stop does not fit,
   that vehicle's wedge is closed and the next vehicle starts from there.
4. If a vehicle cannot take the next stop even on its own, the stop is left for
   a later, larger vehicle if one could take it; otherwise it is reported as
   `no_capacity_left`.
5. Stops left when the vehicles run out are reported as `no_capacity_left`.

Wedges keep each driver in one part of the city instead of criss-crossing it.

### Phase 2 — sequence: in what order

Inside each wedge:

1. **Nearest neighbour.** Start at the depot; repeatedly go to the closest
   unvisited stop.
2. **2-opt.** Try reversing every segment of the tour; keep any reversal that
   shortens it; repeat until none does. Each accepted change strictly shortens
   the tour, so this always finishes.

The output for each route is the ordered stops with the leg distance and the
minute after route start the driver is expected to arrive, plus total
distance, total time and load.

## Worked example

Computed with `planRoutes`. Depot in central San José; six stops; two
motorcycles, each 40 kg, at most 3 stops, a 4-hour shift, 22 km/h average;
5 minutes at each door.

| Stop | Area         | Weight |
| ---- | ------------ | -----: |
| s1   | San Pedro    |   2 kg |
| s2   | Curridabat   |   1 kg |
| s3   | Guadalupe    |   4 kg |
| s4   | Escazú       |   3 kg |
| s5   | Pavas        |   2 kg |
| s6   | Desamparados |   5 kg |

Result:

| Route  | Stops in order                                 | Arrives at minute | Distance |    Time | Load |
| ------ | ---------------------------------------------- | ----------------- | -------: | ------: | ---: |
| moto-1 | s4 Escazú → s5 Pavas → s3 Guadalupe            | 24, 41, 78        |  31.9 km | 102 min | 9 kg |
| moto-2 | s1 San Pedro → s2 Curridabat → s6 Desamparados | 14, 27, 47        |  18.8 km |  66 min | 8 kg |

Total 50.7 km, nothing unassigned.

The example also shows the method's weakness. Guadalupe is in the north-east
and sits on the western driver's route, costing an 11.7 km leg across the
city, because the sweep cut the circle at three stops per vehicle and the cut
fell there. A dispatcher looking at the map would swap Guadalupe for
Desamparados. That is why the plan is a proposal that people can edit, and why
the database accepts any ordering it is given.

## Saving a route

`ops_create_route` receives the service date, the depot, the ordered stops, and
optionally a driver and the planned distance and time. It checks that the
caller has the `ops` role, that every parcel exists, is packed (or is a failed
delivery going out again), is paid for unless it is cash on delivery, and is
not already on a live route, and that the driver is active. It then copies
onto each stop only what is needed at the door — recipient name, phone,
_señas_, pin location, parcel count, cash to collect.

When the last stop of a route is delivered or failed, the route completes
itself and a cash settlement is opened for it: what the driver collected and
must hand in ([fees and settlement](fees-and-settlement.md#cash-on-delivery)).

## What it deliberately does not use

- **Live traffic and time of day.** One average speed per vehicle.
- **Delivery time windows.** The promise is a date, not a slot.
- **Driver identity, seniority or preference.** Vehicles are interchangeable
  apart from capacity, stop limit, shift and speed.
- **Order value or customer value.** A parcel is a parcel; no shopper is
  prioritised.
- **Position history.** Only a driver's latest position is stored, for the
  dispatch map.

## Known limits

- **Not optimal, by design.** Sweep-and-2-opt is typically within a modest
  margin of the best plan for tens of stops, and can be visibly wrong when a
  wedge boundary falls badly, as in the example.
- **Straight-line distances.** A river, a hill or a one-way system is invisible
  to it. The circuity factor of 1.4 and the 22 km/h in the example are
  **assumptions**; neither has been measured on GAM streets.
- **One depot, one trip per vehicle.** No reloads, no pickups from sellers on
  the way, no multi-depot.
- **Vehicles are filled in the order given.** The planner does not balance
  load between drivers; early vehicles fill up and the last may get few stops.
- **Stop count dominates.** The 2-opt step is roughly cubic in the number of
  stops on a route. Fine for dozens; it would need a time limit for hundreds.
- **No re-planning during the day.** A failed or added stop does not
  re-sequence the route.

## The seam for something better

`planRoutes(depot, stops, vehicles, options)` returns routes and unassigned
stops. A solver or a routing API can replace the body behind that signature
without touching the dispatch board or `ops_create_route`. Do it when a
trigger in the [scaling path](../02-architecture/overview.md#scaling-path)
fires: more than a few dozen stops per driver, time windows, or several
depots.

## What to measure before changing anything

The business model lives or dies on stops per driver-day, so these are the most
important numbers in the operation.

| Measure                                                            | Why                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Delivered stops per driver-day                                     | The denominator of the largest variable cost                       |
| Planned versus actual route time and distance                      | Calibrates the speed and circuity assumptions                      |
| Minutes per stop at the door, by cash and non-cash                 | Calibrates service time; cash takes longer                         |
| First-attempt success rate, and failure reasons                    | A failed stop is paid for twice                                    |
| How often dispatchers edit the proposed plan, and what they change | Tells you what the planner is getting wrong before any metric does |
| Stops left unassigned                                              | Fleet too small for the day, or limits too tight                   |
