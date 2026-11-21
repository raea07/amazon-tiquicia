# Scope by app

Five apps, one platform. This document fixes what each app must do at three
points: **Pilot** (the first real orders, with invited sellers and shoppers),
**Launch** (public opening in the GAM) and **Later**. The rule for placing a
feature: if the first hundred orders cannot be fulfilled correctly and legally
without it, it is Pilot; if a stranger would not trust the site without it, it
is Launch; everything else is Later.

App names and audiences are defined once, in `packages/brand/src/brand.ts`.

## Standards that apply to every app

| Area              | Requirement                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accessibility     | WCAG 2.2 level AA. Colour pairings are already tested for contrast in `packages/brand`. Every flow completes with a keyboard and with a screen reader; touch targets are at least 44 px; nothing depends on colour alone |
| Performance (web) | Core Web Vitals at the 75th percentile on a mid-range Android phone over 4G: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Product and search pages are the ones measured                                                        |
| Language          | Costa Rican Spanish first, in the _usted_ register. English second, for the shopper app at Launch. Internal apps are Spanish only until there is a reason otherwise                                                      |
| Money and dates   | Colones written the local way (₡12 500), prices always IVA-inclusive, dates in Costa Rican time (`packages/core/src/money.ts`, `promise.ts`)                                                                             |
| Honest interface  | No pre-ticked options, no countdown timers that are not real, no hidden charges added at the last step. This is both brand policy and law (see [compliance](../05-security-compliance/compliance-costa-rica.md))         |

## Yuntera — shopper web and app

**Purpose:** find, buy, track, return. **Users:** shoppers in the GAM.
The web app is mobile-first and is the only shopper surface in the Pilot; a
native app follows once repeat usage justifies it.

| Pilot                                                               | Launch                                                                         | Later                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Browse categories; search with local vocabulary                     | Filters, sorting, search suggestions                                           | Personalised home page                                    |
| Product page: price with IVA, delivery date, seller identity, stock | Reviews and ratings (positive and negative published); questions to the seller | "Comprados juntos" recommendations (`recommendations.ts`) |
| Cart and checkout with order summary before confirmation            | Saved addresses and reorder                                                    | Native app with push notifications                        |
| Address as map pin + _señas_ + Plus Code                            | English interface                                                              | Wish lists, price alerts                                  |
| SINPE Móvil and cash on delivery                                    | Card payments through hosted fields                                            | Membership for free delivery                              |
| Order tracking and delivery PIN                                     | Self-service cancellation, withdrawal and return requests                      | Scheduled delivery windows                                |
| Receipt by email; contact support by WhatsApp                       | Complaint form; notice-and-report on listings                                  | Gift options, business accounts with invoicing data       |
| Account with email sign-in                                          | Phone verification; account deletion and data export                           |                                                           |

## Yuntera Vende — seller centre

**Purpose:** list, stock, get paid, stay healthy. **Users:** owners and staff of
PYMEs. Web, usable on a phone.

| Pilot                                                                                                          | Launch                                                         | Later                                                         |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Onboarding with identity (cédula física or jurídica, validated for shape in `cr/identity.ts`) and bank details | Self-service onboarding with document upload and review status | Bulk listing by spreadsheet; API                              |
| Create and edit listings; set price                                                                            | Listing quality hints; variant support                         | Sponsored placements                                          |
| Send stock to the warehouse with an inbound notice                                                             | Stock levels, low-stock alerts, storage report                 | Demand forecasts and restock suggestions                      |
| See orders and their status                                                                                    | Fulfil-it-yourself orders with handover to a Yuntera driver    | Own-courier fulfilment                                        |
| Statement per order with every fee itemised                                                                    | Payout schedule, downloadable statements, fee invoices         | Automatic electronic invoicing through an integrated provider |
| Record the electronic invoice key for each order                                                               | Performance score with the top issue to fix                    | Promotions and coupons                                        |
|                                                                                                                | Published explanation of how offers are ranked                 | Multi-user roles                                              |

## Yuntera Ruta — driver app

**Purpose:** deliver the route, prove it, close the cash. **Users:** drivers.
Native app (Android first), because it needs background location, the camera
and offline operation.

| Pilot                                                          | Launch                                                         | Later                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Today's route: ordered stops with pin, _señas_, recipient name | Navigation hand-off to the driver's preferred maps app         | Live re-sequencing when a stop is added or fails |
| One-tap call or WhatsApp to the recipient                      | Photo proof of delivery when the PIN is unavailable, by policy | Earnings and history                             |
| Deliver with the shopper's PIN                                 | Failed-delivery reasons with required evidence                 | Pickups from sellers on the same route           |
| Record cash collected; running total                           | End-of-route cash close-out with variance                      | In-app incident reporting                        |
| Mark a failed attempt with a reason                            | Location sharing while a route is active, with consent         | Multiple vehicle types                           |

**Offline behaviour.** The whole assigned route is stored on the phone when the
driver starts it. Deliveries, failures and cash amounts are recorded locally
with their time and position and sent when signal returns. The PIN must be
verifiable without signal; how that is done securely is an engineering decision
recorded in `docs/02-architecture/`. A driver must never be unable to complete
a delivery because of coverage.

## Yuntera Bodega — warehouse app

**Purpose:** receive, store, pick, pack, hand over. **Users:** warehouse
associates. Phone app using the camera as a barcode scanner in the Pilot;
dedicated scanners are a Later decision.

| Pilot                                                                       | Launch                                       | Later                             |
| --------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------- |
| Receive an inbound shipment against its notice; record shortages and damage | Label printing for units without barcodes    | Cycle counting                    |
| Put away to a location by scanning                                          | Batch picking across orders                  | Slotting suggestions              |
| Pick list per order, confirmed by scan                                      | Packing station flow with weight check       | Wave planning                     |
| Pack and mark ready for dispatch                                            | Returns receiving and grading                | Multiple warehouses and transfers |
| Hand over to a driver against a route                                       | Stock adjustments with a reason and approval | Handheld scanner support          |

**Offline behaviour.** Warehouses have Wi-Fi, so the requirement is lighter:
a scan that cannot be sent is queued and retried, and the associate sees that
it is pending. Stock is only considered moved once the server confirms it.

## Yuntera Central — operations console

**Purpose:** see the operation and fix exceptions. **Users:** the founder, then
operations and support staff. Web, desktop-first. Access requires staff
sign-in with multi-factor authentication from Launch.

| Pilot                                                             | Launch                                               | Later                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Orders: search, status, timeline, cancel, refund                  | Exceptions queue: late, unpaid, failed, stuck        | Service-level dashboards per zone          |
| Seller approval and suspension                                    | Listing moderation and the notice-and-action queue   | Automated risk review queue                |
| Build routes from ready parcels and assign drivers (`routing.ts`) | Drag stops between routes; capacity per zone and day | Carrier integrations for national delivery |
| Cash reconciliation per driver per day                            | Payout runs and seller statements                    | Finance exports and ledger views           |
| Record of every manual action                                     | Support inbox linked to orders                       | Role-based permissions beyond staff/admin  |
| Holiday and service-day calendar                                  | Complaint register                                   | Experimentation tools                      |

## Deliberately not in scope for any app yet

Chat between shoppers and sellers, a public API, loyalty points, live
auctions, a second country, and anything that requires holding card data. See
the "do not build yet" list in the [roadmap](roadmap.md).
