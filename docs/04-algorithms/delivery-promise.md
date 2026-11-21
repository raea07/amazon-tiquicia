# Delivery promise

The date shown next to "Llega…" on a product page, in the cart and at checkout,
and stored on the order when it is placed. It is a commitment the operation is
measured against, so the calculation is conservative and has no hidden steps.

- Specification: `packages/core/src/promise.ts` (`computeDeliveryPromise`)
- Implementation: `private.compute_promise` and
  `private.advance_delivery_days` in
  `supabase/migrations/20261121080200_geography.sql`; exposed through
  `delivery_estimate`, `get_product`, `checkout_quote` and `place_order`
- Tests: `packages/core/src/promise.test.ts`, replayed against the database in
  `supabase/tests/010_promise.sql`

## Goal

Tell the shopper the latest day the parcel will arrive, before they pay, and be
right. A date that is a day later than strictly possible costs a little
conversion; a date that is missed costs trust, a support contact and often a
refund.

## Inputs

| Input                                               | Source                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The current instant                                 | The request                                                                           |
| The shopper's zone                                  | Their district's postal code → cantón → `delivery_zones`                              |
| The zone's order cutoff hour                        | `delivery_zones.cutoff_hour`                                                          |
| Days the origin processes orders                    | `delivery_zones.processing_weekdays`                                                  |
| Days deliveries run in the zone                     | `delivery_zones.delivery_weekdays`                                                    |
| Transit time, fastest and slowest, in delivery days | `transit_min_days`, `transit_max_days`                                                |
| Handling days the origin needs before dispatch      | 0 for stock in a Yuntera warehouse; the offer's `handling_days` when the seller ships |
| Holidays                                            | The `holidays` table                                                                  |
| Days a zone is full                                 | `zone_closures`                                                                       |

Service levels as seeded. They are data, changeable without a deploy, and the
values are assumptions to validate in the pilot.

| Zone                  | Cutoff | Processing days | Delivery days   | Transit  |
| --------------------- | ------ | --------------- | --------------- | -------- |
| `gam-core`            | 14:00  | Monday–Saturday | Monday–Saturday | 1 day    |
| `gam-extended`        | 12:00  | Monday–Saturday | Monday–Saturday | 1–2 days |
| `national` (inactive) | 12:00  | Monday–Friday   | Monday–Friday   | 2–5 days |

## The calculation

All dates are Costa Rican calendar dates. Costa Rica is UTC−6 all year with no
daylight saving, so local time is the instant minus six hours — no timezone
database is needed.

1. **Did the order make today's cutoff?** Yes, if today is a processing day,
   is not a holiday, and the local hour is before the zone's cutoff hour.
2. **First processing day.** Today if the cutoff was made; otherwise the next
   processing day that is not a holiday.
3. **Handling.** Move forward one processing day for each handling day. The
   result is the **dispatch date**: the day the parcel must leave the origin.
4. **Transit.** From the dispatch date, move forward the zone's transit time
   counted in **delivery days** — days the zone delivers, that are not
   holidays, and on which the zone is not closed. Doing this with the fastest
   transit gives the **earliest** date; with the slowest, the **latest**.
5. **Promise days.** Calendar days from today to the latest date. Search
   ranking and the featured offer consume this number.

An order with several lines takes the longest handling time among its
seller-fulfilled lines (`private.price_items`), so the promise is the date the
whole order will have arrived.

A guard stops the search for a service day after 366 days and fails with
`calendar_misconfigured`: that is a zone with no service days, not a real case.

## Worked examples

Computed with `computeDeliveryPromise` and the 2026 holiday list.

| Ordered at (local time)     | Zone         | Handling | Made cutoff | Dispatch | Promise             | Why                                                               |
| --------------------------- | ------------ | -------: | ----------- | -------- | ------------------- | ----------------------------------------------------------------- |
| Saturday 21 Nov 2026, 03:42 | GAM core     |        0 | Yes         | Sat 21   | **Monday 23**       | One delivery day after Saturday; Sunday is not a delivery day     |
| Saturday 21 Nov 2026, 03:42 | GAM core     |        2 | Yes         | Tue 24   | **Wednesday 25**    | Two processing days of handling (Mon, Tue), then one delivery day |
| Saturday 21 Nov 2026, 15:00 | GAM core     |        0 | No          | Mon 23   | **Tuesday 24**      | After the 14:00 cutoff, processing starts Monday                  |
| Friday 20 Nov 2026, 11:00   | GAM extended |        0 | Yes         | Fri 20   | **Sat 21 – Mon 23** | Transit of one to two delivery days                               |
| Thursday 24 Dec 2026, 10:00 | GAM core     |        0 | Yes         | Thu 24   | **Saturday 26**     | Friday 25 December is a holiday and is skipped                    |

The first two rows are what the demo storefront showed on 21 November 2026 for
the listing in the [featured-offer example](featured-offer.md#worked-example):
"Llega el lunes, 23 de noviembre" for the warehouse offer and "el miércoles, 25
de noviembre" for the seller-shipped one.

## How it is shown

`describePromise` turns the dates into words: "Llega hoy", "Llega mañana",
"Llega el lunes, 23 de noviembre", or "Llega entre el … y el …" when the
earliest and latest dates differ. Until a shopper chooses their district, the
storefront estimates for San José centre and says so: "Elija su zona para
confirmar la fecha".

The promise stored on the order (`orders.promise_earliest`,
`promise_latest`) is the one computed at the moment of purchase, and each
shipment carries `promise_latest`. Late shipments are counted against that
date.

## What it deliberately does not use

- **Distance or live traffic.** The promise is a zone-level service standard,
  not a route estimate.
- **Per-order capacity.** The calculation does not count how many orders a zone
  already has for a day. Capacity is expressed by operations closing a day for
  a zone in `zone_closures`.
- **The shopper's history or value.** Everyone in a zone gets the same promise.
- **Optimism.** When earliest and latest differ, ranking uses the latest.

## Differences between the two implementations

|               | TypeScript                                                                                                                                            | SQL                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Holidays      | Passed in by the caller; `costaRicaHolidays(year)` generates the statutory dates, including Holy Thursday and Good Friday from the Easter calculation | Read from the `holidays` table |
| Zone closures | Passed in as `closedDates`                                                                                                                            | Read from `zone_closures`      |
| Zone settings | `SERVICE_PRESETS`                                                                                                                                     | `delivery_zones` rows          |

The algorithm is the same and the database test replays the TypeScript cases.
Where a result differs it is because the database knows the real calendar.

## Known limits

- **The holiday table must be maintained.** It is seeded with statutory
  holidays through the end of 2027 on their calendar dates. Costa Rican law has
  at times moved some holidays to the nearest Monday, and operations may add
  its own closures. Someone must review the table every December; a missing
  holiday produces a promise the operation cannot keep.
- **Sellers' handling days are self-declared.** A seller who declares one day
  and takes three makes Yuntera break a promise. The seller score is meant to
  catch this through late shipments, and is not computed yet.
- **No time of day.** The promise is a date, not a window.
- **Processing days are per zone, not per origin.** A seller who does not work
  Saturdays cannot say so; their handling days must absorb it.
- **Cutoffs assume the warehouse really ships same-day** for orders before the
  hour. If the pilot cannot, raise handling for warehouse stock or move the
  cutoff earlier — both are data changes.

## What to measure before changing a setting

| Measure                                                                                    | Why                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Share of shipments delivered on or before `promise_latest`, by zone and by fulfilment type | The number the promise exists for. Target it before tuning anything else      |
| Share delivered a full day or more early                                                   | A promise that is always beaten is costing conversion                         |
| Late shipments by cause: late dispatch, failed first attempt, route overrun                | Tells you whether to change the cutoff, the handling time or the transit time |
| Orders placed in the hour before and after cutoff                                          | Whether the cutoff hour is where shoppers are                                 |
| Conversion on product pages by promise length                                              | What a faster promise is worth                                                |
