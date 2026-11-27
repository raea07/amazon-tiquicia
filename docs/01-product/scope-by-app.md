# Scope by app

Five audiences, four deployed apps, one platform. Drivers and warehouse staff
share one mobile web app, `apps/field`, with an area each; the tables below
still describe them separately because their jobs differ. This document fixes
what each app must do at three points: **Pilot** (the first real orders, with
invited sellers and shoppers),
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

Built ahead of the Launch column (wave 9): the complaint form (`/reclamo` and
the app's "Presentar un reclamo"), which still needs an account, and "Sus
consultas", where the shopper reads staff's answers.

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
**Form:** the `/ruta` area of `apps/field`, an installable mobile web app. It
runs in the phone's browser and can be added to the home screen; there is no
app-store download.

A native app was the original plan, because it can track location in the
background, work offline and scan reliably. It is deferred: a web app works on
any phone today with no store review, and native builds could not be verified
where this was built. The costs of that choice are real and are listed below
the table. See
[decision 4](../02-architecture/decisions.md#4-one-mobile-web-app-for-drivers-and-warehouse-native-apps-deferred).

| Pilot                                                          | Launch                                                         | Later                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Today's route: ordered stops with pin, _señas_, recipient name | Navigation hand-off to the driver's preferred maps app         | Live re-sequencing when a stop is added or fails |
| One-tap call or WhatsApp to the recipient                      | Photo proof of delivery when the PIN is unavailable, by policy | Earnings and history                             |
| Deliver with the shopper's PIN                                 | Failed-delivery reasons with required evidence                 | Pickups from sellers on the same route           |
| Record cash collected; running total                           | End-of-route cash close-out with variance                      | In-app incident reporting                        |
| Mark a failed attempt with a reason                            | Position shared while the app is open on a route, with consent | Native app: background location, offline queue   |

**What the web app cannot do.**

- **It needs signal to confirm a delivery.** The route is loaded when the
  driver opens it, but completing a stop is a call to the server. Nothing is
  queued and replayed. A driver in a dead spot must move to coverage.
- **No background location.** Position is reported only while the app is open
  on screen. Dispatch sees where a driver last used the app, not a live trail.
- **The PIN is checked by the server, never on the phone.** The driver's app is
  never sent the PIN, so there is no offline check — that is deliberate, since
  a PIN the phone could verify is a PIN the driver could discover
  ([decision 5](../02-architecture/decisions.md#5-the-driver-never-sees-the-delivery-pin)).
  Five wrong attempts lock the stop.

Whether this is good enough is a question for the dress rehearsal on real
routes, and is on the [go-live checklist](../07-deployment/go-live-checklist.md).

## Yuntera Bodega — warehouse app

**Purpose:** receive, store, pick, pack, hand over. **Users:** warehouse
associates. **Form:** the `/bodega` area of the same mobile web app. Codes are
scanned with the phone's camera where the browser supports it and typed by
hand where it does not; dedicated scanners and a native app are Later
decisions.

| Pilot                                                                       | Launch                                       | Later                                                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Receive an inbound shipment against its notice; record shortages and damage | Label printing for units without barcodes    | Cycle counting (a count correction per location exists since 084300, and counting a product a location does not list since 084500) |
| Put away to a location by scanning or typing its code                       | Batch picking across orders                  | Slotting suggestions                                                                                                               |
| Pick list per order, in bin order, confirmed line by line                   | Packing station flow with weight check       | Wave planning                                                                                                                      |
| Pack and mark ready for dispatch                                            | Returns receiving and grading                | Multiple warehouses and transfers (moves between locations of one warehouse exist since 084300)                                    |
| Hand over to a driver against a route                                       | Stock adjustments with a reason and approval | Handheld scanners; native app with fast scan                                                                                       |

**Connectivity.** Warehouses have Wi-Fi, so the web app's need for a connection
is a small cost here. Every action is confirmed by the server before the
screen moves on; nothing is queued. Stock is only considered moved once the
server says so.

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

Built ahead of the Launch column (wave 9): Casos, a support desk where every
complaint, return request, content report and recorded WhatsApp, phone or
e-mail contact is a case with due times (the complaint register and its
monthly report included); and Salud del sistema, the checks that show what
needs attention, with the version of each app. The shared WhatsApp inbox is
not built: WhatsApp stays in the WhatsApp Business app.

## Deliberately not in scope for any app yet

Chat between shoppers and sellers, a public API, loyalty points, live
auctions, a second country, and anything that requires holding card data. See
the "do not build yet" list in the [roadmap](roadmap.md).
