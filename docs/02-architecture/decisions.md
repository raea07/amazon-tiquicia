# Architecture decisions

Short records of the decisions that shape the system: what the situation was,
what was decided, and what follows from it — including what it costs. A
decision here can be reversed, but reversing it should be a conscious act with
its own entry, not something that happens by drift.

| #   | Decision                                                                                                                                                                                                                   | State                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | [Database functions are the public API](#1-database-functions-are-the-public-api)                                                                                                                                          | Built                                    |
| 2   | [No privileged key in any app; staff are ordinary users](#2-no-privileged-key-in-any-app-staff-are-ordinary-users)                                                                                                         | Built                                    |
| 3   | [A local stand-in for the Supabase API](#3-a-local-stand-in-for-the-supabase-api)                                                                                                                                          | Built; real Supabase untested            |
| 4   | [One mobile web app for drivers and warehouse; native apps deferred](#4-one-mobile-web-app-for-drivers-and-warehouse-native-apps-deferred)                                                                                 | Decided; app not built yet               |
| 5   | [The driver never sees the delivery PIN](#5-the-driver-never-sees-the-delivery-pin)                                                                                                                                        | Built                                    |
| 6   | [Cache Components: shared catalogue cached, personal content streamed](#6-cache-components-shared-catalogue-cached-personal-content-streamed)                                                                              | Built                                    |
| 7   | [A static Content-Security-Policy with unsafe-inline scripts](#7-a-static-content-security-policy-with-unsafe-inline-scripts)                                                                                              | Built; known trade-off                   |
| 8   | [Money is an integer count of céntimos](#8-money-is-an-integer-count-of-céntimos)                                                                                                                                          | Built                                    |
| 9   | [A double-entry ledger](#9-a-double-entry-ledger)                                                                                                                                                                          | Built                                    |
| 10  | [An append-only stock ledger, with reservation when the order is placed](#10-an-append-only-stock-ledger-with-reservation-when-the-order-is-placed)                                                                        | Built                                    |
| 11  | [Idempotency keys on order placement](#11-idempotency-keys-on-order-placement)                                                                                                                                             | Built                                    |
| 12  | [Outbox events for work outside the transaction](#12-outbox-events-for-work-outside-the-transaction)                                                                                                                       | Built; two consumers, nothing sent       |
| 13  | [Own-fleet delivery with a PIN as proof](#13-own-fleet-delivery-with-a-pin-as-proof)                                                                                                                                       | Built in software; operation not started |
| 14  | [The name lives in one file](#14-the-name-lives-in-one-file)                                                                                                                                                               | Built                                    |
| 15  | [Fees regrounded on published gateway costs](#15-fees-regrounded-on-published-gateway-costs)                                                                                                                               | Built; amounts are assumptions           |
| 16  | [No cloud resources created without the owner](#16-no-cloud-resources-created-without-the-owner)                                                                                                                           | Standing                                 |
| 17  | [Native styling: plain StyleSheet with tokens from the brand package](#17-native-styling-plain-stylesheet-with-tokens-from-the-brand-package)                                                                              | Built                                    |
| 18  | [The session lives in the phone's secure store alone](#18-the-session-lives-in-the-phones-secure-store-alone)                                                                                                              | Built; unverified on a device            |
| 19  | [A darker field outline in the native apps than on the web](#19-a-darker-field-outline-in-the-native-apps-than-on-the-web)                                                                                                 | Built                                    |
| 20  | [The native apps' store identifiers use com.yuntera](#20-the-native-apps-store-identifiers-use-comyuntera)                                                                                                                 | Decided by the owner                     |
| 21  | [The brand package does not declare React](#21-the-brand-package-does-not-declare-react)                                                                                                                                   | Built                                    |
| 22  | [Notifications run outside the apps, with their own key](#22-notifications-run-outside-the-apps-with-their-own-key)                                                                                                        | Built; not deployed                      |
| 23  | [A per-request check, and the second factor in the database](#23-a-per-request-check-and-the-second-factor-in-the-database)                                                                                                | Built; applied to the preview            |
| 24  | [Deleting an account anonymises; the sign-in record stays](#24-deleting-an-account-anonymises-the-sign-in-record-stays)                                                                                                    | Built; applied to the preview            |
| 25  | [Photos in two buckets, published by re-encoding](#25-photos-in-two-buckets-published-by-re-encoding)                                                                                                                      | Built; applied to the preview            |
| 26  | [One register for every refund](#26-one-register-for-every-refund)                                                                                                                                                         | Built; not on the preview yet            |
| 27  | [Limits are per account and per target, never per address](#27-limits-are-per-account-and-per-target-never-per-address)                                                                                                    | Built; not on the preview yet            |
| 28  | [A driver's offline day in ordinary app storage, kept small and short](#28-a-drivers-offline-day-in-ordinary-app-storage-kept-small-and-short)                                                                             | Built; unverified on a device            |
| 29  | [The staff apps ask for the second factor themselves](#29-the-staff-apps-ask-for-the-second-factor-themselves)                                                                                                             | Built; hosted project untested           |
| 30  | [A driver's far-away position: refused live, flagged at a door](#30-a-drivers-far-away-position-refused-live-flagged-at-a-door)                                                                                            | Built; not on the preview yet            |
| 31  | [Offline driver actions keep when they happened, within a day](#31-offline-driver-actions-keep-when-they-happened-within-a-day)                                                                                            | Built; not on the preview yet            |
| 32  | [Delivered and returned parcels end an order as delivered](#32-delivered-and-returned-parcels-end-an-order-as-delivered)                                                                                                   | Built; not on the preview yet            |
| 33  | [A fee change pauses offers below the price floor](#33-a-fee-change-pauses-offers-below-the-price-floor)                                                                                                                   | Built; not on the preview yet            |
| 34  | ["Refund completed" waits for a recorded confirmation](#34-refund-completed-waits-for-a-recorded-confirmation)                                                                                                             | Built; with the gateway against a fake   |
| 35  | [The web apps' own sign-in limit, per visitor and per account](#35-the-web-apps-own-sign-in-limit-per-visitor-and-per-account)                                                                                             | Built; not on the preview yet            |
| 36  | [Session lifetimes per app](#36-session-lifetimes-per-app)                                                                                                                                                                 | Built; not on the preview yet            |
| 37  | [Payments through a gateway worker, confirmed only by the gateway](#37-payments-through-a-gateway-worker-confirmed-only-by-the-gateway)                                                                                    | Built against a local fake; not deployed |
| 38  | [The platform issues its own fiscal documents from the outbox](#38-the-platform-issues-its-own-fiscal-documents-from-the-outbox)                                                                                           | Built against a local fake; not deployed |
| 39  | [One offer order everywhere, and shared listings without review](#39-one-offer-order-everywhere-and-shared-listings-without-review)                                                                                        | Built; applied to the preview            |
| 40  | [Catalogue staff change the catalogue through functions; hiding is not taking down](#40-catalogue-staff-change-the-catalogue-through-functions-hiding-is-not-taking-down)                                                  | Built; applied to the preview            |
| 41  | [Operations staff change zones, districts, the calendar, settings, locations and stuck routes](#41-operations-staff-change-zones-districts-the-calendar-settings-locations-and-stuck-routes-through-functions)             | Built; applied to the preview            |
| 42  | [Brands are deleted only when nothing names them; product pages refuse what is not on sale](#42-brands-are-deleted-only-when-nothing-names-them-product-pages-refuse-what-is-not-on-sale-at-the-helper)                    | Built; applied to the preview            |
| 43  | [Order follow-ups: the delivery fee, stopping a packed parcel, an order that never moves back](#43-order-follow-ups-the-delivery-fee-when-nobody-went-to-the-door-stopping-a-packed-parcel-an-order-that-never-moves-back) | Built; not on the preview yet            |
| 44  | [Warehouse stock: free units, moves the shop never sees, counts only onto shelves](#44-warehouse-stock-what-is-free-moves-that-the-shop-never-sees-counts-only-onto-shelves)                                               | Built; not on the preview yet            |
| 45  | [Android builds of the shopper app go to the internal testers without a click](#45-android-builds-of-the-shopper-app-go-to-the-internal-testers-without-a-click)                                                           | Decided; settings not changed yet        |
| 46  | [Product rows written only when the summary changes; one lock order for stock, orders and shelves](#46-product-rows-written-only-when-the-summary-changes-one-lock-order-for-stock-orders-and-shelves)                     | Built; not on the preview yet            |
| 47  | [Counting a product a location does not list is its own function](#47-counting-a-product-a-location-does-not-list-is-its-own-function)                                                                                     |
| 48  | [Refunds booked together are announced once; "refund arrived" waits for the last](#48-refunds-booked-together-are-announced-once-refund-arrived-waits-for-the-last)                                                        |
| 49  | [The cart's date for another shop's offer comes from the product page's function](#49-the-carts-date-for-another-shops-offer-comes-from-the-product-pages-function)                                                        |
| 50  | [The shopper app keeps what it shows and gives up on a read after 15 s; the other apps do not yet](#50-the-shopper-app-keeps-what-it-shows-and-gives-up-on-a-read-after-15-s-the-other-apps-do-not-yet)                    |
| 51  | [The unpaid-order sweep cancels at most 200 orders a run](#51-the-unpaid-order-sweep-cancels-at-most-200-orders-a-run)                                                                                                     |
| 52  | [Shelf rows left at 0 units stay](#52-shelf-rows-left-at-0-units-stay)                                                                                                                                                     |
| 53  | [A cancelled order says why from the reasons the database writes; staff's note stays internal](#53-a-cancelled-order-says-why-from-the-reasons-the-database-writes-staffs-note-stays-internal)                             |
| 54  | [Back links and short links are 44 px tall without moving the layout](#54-back-links-and-short-links-are-44-px-tall-without-moving-the-layout)                                                                             |

---

## 1. Database functions are the public API

**Context.** A Supabase project exposes every table in `public` over HTTP. The
usual way to build on it is for each app to read and write tables directly,
with row-level security as the only guard. That spreads business rules across
five apps, makes every schema change a breaking change, and means a single
missing policy exposes data.

**Decision.** Apps call functions, never tables, to build a screen or perform
an action. One function returns one screen's payload as JSON
(`get_product`, `my_orders`, `seller_overview`, `wms_board`, `driver_today`,
`ops_dispatch_board`); one function performs one business action
(`place_order`, `wms_pack_shipment`, `driver_complete_stop`). Since
21 November 2026 this is enforced, not only followed: signed-in users and
visitors hold no privilege on any table, view or sequence, so the functions
are the only door. Tables keep row-level security underneath as a second lock.

**Consequences.**

- The whole surface is a list of named functions that can be reviewed in one
  sitting ([API reference](../03-data/api-reference.md)).
- Tables can change shape without touching any app, as long as the function's
  payload holds. A contract test checks that it does.
- One round trip per screen, which matters on mobile data.
- More SQL to write and maintain, and a new screen usually needs a migration.
- Every function runs with its owner's rights (`security definer`) and checks
  the caller itself; read functions write their visibility rules into their own
  queries. Getting that check wrong is the main risk of this design, which is
  why [access control](../03-data/access-control.md) has a checklist for it and
  `supabase/tests/110_lockdown.sql` fails on any table privilege or unlisted
  function a later migration adds.
- An action that no function performs cannot be done through the API at all,
  even by staff. The security review of November 2026 showed that the
  alternative (narrow column grants plus policies) left holes that no single
  reviewer saw; the price is writing a function for each new action.

## 2. No privileged key in any app; staff are ordinary users

**Context.** The quick way to build an admin console is to give it the
service-role key, which bypasses row-level security entirely. A leaked key, or
one bug in the console, then exposes everything, and nothing records who did
what.

**Decision.** No app holds a service-role or secret key. Each has only the
project's publishable key. Staff sign in like anyone else; their extra reach
comes from a row in `staff_members` with a role (`admin`, `ops`, `support`,
`finance`, `catalog`). The setting `require_staff_mfa` makes staff permissions
apply only to sessions that completed a second factor (the token's `aal` claim
is `aal2`).

**Consequences.**

- Revoking a staff member is deleting or deactivating one row; it takes effect
  on their next request, not when a token expires.
- Staff actions on sensitive tables are written to `private.audit_log` with the
  acting user.
- Every privileged operation must exist as a function or policy that names the
  role allowed to do it. There is no escape hatch, which is the point — and
  occasionally an inconvenience.
- `require_staff_mfa` ships as `false`. It must be turned on before launch
  ([go-live checklist](../07-deployment/go-live-checklist.md)).
- Work that genuinely needs to act without a user needs a secret key held by
  server-side code, never by an app. The first is the notification worker
  (decision 22): an Edge Function with its own key, which reaches only the
  `worker_*` functions, each granted to `service_role` alone.
- A second factor counts in the database whatever the setting: an account
  with a verified factor gets nothing from a staff or seller function at
  `aal1` (decision 23).

## 3. A local stand-in for the Supabase API

**Context.** The normal local setup is `supabase start`, which runs the real
PostgREST and Auth services in Docker. In the sandbox where this was built,
container images could not be pulled and release binaries could not be
downloaded. Without an HTTP API the apps could not be run or tested at all.

**Decision.** `tools/dev-api` is a small Node server that answers what the
apps ask of Supabase: function calls (`POST /rest/v1/rpc/<name>`, after the
pre-request check, as PostgREST does), Auth (sessions, sign-up with e-mail
confirmation, password recovery, time-based second factors, a local mailbox
at `GET /dev/mail`, plus a JWKS endpoint) and the storage calls storage-js
makes (`/storage/v1/*`, decided by the same rules on `storage.objects`, files
on local disk). A request is a visitor, a session token or, with the local
secret key, the server-side caller; one function maps that to the database
role for every route. It runs each call the way PostgREST does —
inside a transaction, as role `anon` or `authenticated`, with the token's
claims in `request.jwt.claims` — and signs tokens with an ES256 key so that the
apps verify signatures the same way they will in production. It binds to
`127.0.0.1` only and is never deployed.

**Consequences.**

- The apps and the contract tests run end to end on a plain PostgreSQL, in the
  sandbox and in CI, with no Docker.
- **The system has not been run against real Supabase.** The stand-in mirrors a
  narrow surface faithfully, but it is not PostgREST and not GoTrue. Things
  that could differ on first contact: error payload details, cookie chunking
  for large sessions, how the real Auth renders the e-mail templates, rate
  limits (it has none), whether PostgREST honours the per-database
  pre-request setting, the storage service's own triggers and CDN, and
  anything the platform pre-installs in the database.
- The RPC-first design in decision 1 is what makes the stand-in small: it never
  has to emulate PostgREST's table query language.
- When a developer has Docker, `supabase start` should replace it. The stand-in
  stays for CI speed and for machines without containers.

## 4. One mobile web app for drivers and warehouse; native apps deferred

**Context.** The original plan was two native apps built with Expo: Yuntera
Ruta for drivers and Yuntera Bodega for the warehouse. Native builds could not
be produced or verified in the build sandbox, and shipping unverified native
code would have meant handing over something that might not start. Separately,
a pilot with one or two drivers and one warehouse does not need app-store
distribution.

**Decision.** Build one installable mobile web app, `apps/field`, with two
areas: `/ruta` for drivers and `/bodega` for warehouse staff. Each person sees
the area their role allows. Native apps move to the roadmap.

**Consequences — what is gained.**

- Works today on any phone with a browser: no developer accounts, no store
  review, no build pipeline, and an update reaches everyone on the next load.
- One codebase, sharing the same session handling and components as the other
  web apps.

**Consequences — what is given up, honestly.**

- **No background location.** A web app can read the phone's position only
  while it is open on screen. Dispatch sees where a driver was the last time
  they touched the app, not a live trail.
- **Weaker offline behaviour.** The app needs signal to load the route and to
  confirm a delivery. A driver in a dead spot must walk to coverage; nothing is
  queued and replayed.
- **Barcode scanning depends on the browser.** Camera scanning uses a browser
  API that is not available everywhere; where it is missing, the code is typed
  by hand.
- **No push notifications worth relying on**, and no home-screen presence
  unless the person installs it.

**Revisit when** drivers regularly lose signal on real routes, when dispatch
needs live positions, or when warehouse scanning speed becomes the constraint.
The functions the native apps would call are the same ones the web app calls,
so nothing below the screen has to change.

**Since then.** The native drivers' app (`apps/driver-native`, Yuntera Ruta)
and warehouse app (`apps/warehouse-native`, Yuntera Bodega) have every flow
of their `apps/field` areas. The drivers' app adds what this decision gave up:
position sharing during a route with the screen off (a foreground service on
Android, the location background mode on iOS, never the "always" permission)
and work without signal (arrivals, failed deliveries and positions queued and
sent later in order, the route readable from a copy kept on the phone,
decision 28). The warehouse app scans with the camera or a hand scanner. Until
a build of each has run on a phone, `apps/field` remains the tool drivers and
the warehouse use.

## 5. The driver never sees the delivery PIN

**Context.** Each order has a four-digit PIN that the shopper reads to the
driver at the door. An earlier draft of the product scope asked for the PIN to
be verifiable on the phone without signal. That requires the PIN, or something
derived from it that can be brute-forced in ten thousand tries, to be on the
driver's device — which defeats its purpose as proof that the shopper was
present.

**Decision.** The PIN is checked only by the server. `driver_today` never
returns it; `driver_complete_stop` receives what the driver typed and compares
it in the database. There is no offline verification. Since the security
review of 21 November 2026 the code is kept in its own private table
(`private.delivery_codes`), which no app role can read; the shopper reads it
through `get_order` only, and nobody on the platform's side can. Wrong
attempts are counted per order, across all its parcels, stops and routes, and
each is logged with the driver who typed it. After five the order locks;
staff release it with `ops_release_delivery_code`, which issues a new code the
shopper reads on their order page.

**Consequences.**

- The PIN is real proof of delivery: a driver cannot mark a parcel delivered
  without the shopper's cooperation.
- A delivery cannot be completed without signal. This is the same limitation as
  decision 4 and is accepted for the pilot's coverage area.
- Wrong attempts are counted, not rolled back: the function returns a result
  object for `wrong_pin` rather than raising an error, so the counter survives.
- When the PIN is genuinely unavailable (the shopper lost it, a neighbour
  receives), the fallback is operational — support confirms identity and staff
  resolve the stop — not a weaker check in the app. A photo-based fallback is
  in the Launch scope and is not built.

## 6. Cache Components: shared catalogue cached, personal content streamed

**Context.** A storefront is mostly the same for everyone and occasionally
specific to one person. Rendering every page per request is slow and expensive;
caching whole pages leaks one person's cart to another.

**Decision.** Use Next.js 16 Cache Components. Every page prerenders a static
shell. Catalogue reads are cached functions with explicit lifetimes and tags.
Anything that depends on the signed-in person is read at request time inside a
`<Suspense>` boundary and streamed into the shell.

**Consequences.**

- First paint does not wait for the database.
- The line between shared and personal data is enforced by which client a read
  uses: `publicApi()` has no cookies and may be cached; `sessionApi()` reads
  the request and cannot be.
- Prices and stock can be up to a few minutes stale on screen. That is safe
  only because checkout re-prices and re-checks in the database
  ([overview](overview.md#caching-model)).
- The framework is strict about where request-time data may be read. Code that
  needs the clock or the session must say so explicitly; this is occasionally
  awkward and is a feature.
- Pages that discover "not found" after the shell has been sent answer with
  status 200 and the not-found content, not a 404. Acceptable for private
  pages; for unknown product addresses it is a soft-404 that should be watched
  in search-engine reports.

## 7. A static Content-Security-Policy with unsafe-inline scripts

**Context.** The strongest script policy uses a fresh nonce on every response.
A nonce is per-request by definition, so it forces every page to render at
request time and gives up the prerendered shell from decision 6. The
framework's own bootstrap is an inline script, so without a nonce the policy
must allow inline scripts.

**Decision.** Ship a static policy (`apps/web/next.config.ts`):
`script-src 'self' 'unsafe-inline'`, with everything else locked down —
`default-src 'self'`, `connect-src` limited to the site and the Supabase
origin, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`,
`object-src 'none'`, plus HSTS, `nosniff`, a strict referrer policy and a
restrictive permissions policy.

**Consequences.**

- The policy does **not** stop an injected inline script from running. It still
  blocks loading scripts from other origins, framing, and posting forms
  elsewhere.
- The mitigations that carry the weight instead:
  - No third-party scripts at all: no analytics tag, no chat widget, no ad
    pixel. Fonts are self-hosted.
  - The lint configuration makes `dangerouslySetInnerHTML` an error, so text
    from sellers and shoppers is always escaped by React.
  - The cart and delivery-zone cookies are `HttpOnly`, and no token is ever
    placed in page markup.
  - All other directives are strict.
- **The session cookie is hidden from scripts.** The Supabase server library
  writes the session cookie without `HttpOnly` by default (so that a
  browser-side client could read it). These apps have no browser-side Supabase
  client — all sign-in and data access happens on the server — so they
  override that: the cookie is `HttpOnly`, `SameSite=Lax` and, in production,
  `Secure` (`SESSION_COOKIE` in `packages/next-kit`). An injected script
  therefore cannot read the session, which is what makes the `'unsafe-inline'`
  trade-off acceptable.
- **Revisit when** any third-party script is added, when user-supplied rich
  text or HTML is ever rendered, or when the framework supports a hash-based
  policy for its bootstrap that works with prerendering. At that point either
  move the affected routes to a nonce-based policy and accept dynamic rendering
  for them, or adopt hashes.

## 8. Money is an integer count of céntimos

**Context.** Floating-point arithmetic loses céntimos, and a marketplace's
books must add up exactly: what the shopper paid equals what the seller
receives plus every fee plus tax.

**Decision.** Every amount is an integer number of minor units (céntimos) with
a currency code, in TypeScript (`packages/core/src/money.ts`) and in SQL
(`bigint` columns suffixed `_minor`). Rates are integer basis points. Prices
are tax-inclusive; the tax inside a price is derived, not stored separately as
a second source of truth. Rounding happens once, at a defined step, half away
from zero.

**Consequences.**

- Fee statements balance to the céntimo; a test asserts
  `payout + fees = money collected` for every combination it tries.
- Display formatting is a separate concern (`formatPrice`): ₡12 500.
- Only colones are supported; the `orders.currency` column is constrained to
  `CRC`. A second currency is a schema change, deliberately.

## 9. A double-entry ledger

**Context.** A marketplace holds other people's money. "How much do we owe this
seller, and why?" must have an answer that can be reconstructed, not a balance
column that was incremented by code nobody remembers.

**Decision.** Every movement of money is a `ledger_transaction` with
`ledger_entries` that sum to zero (debits positive, credits negative). A
deferred constraint trigger refuses to commit an unbalanced transaction, and
entries can never be updated or deleted. Balances are derived by summing
entries; none is stored. A refund is the original capture's entries, negated,
or for part of an order the goods' entries reversed; since 21 November 2026
every refund also has a row in one register (decision 26).

**Consequences.**

- A seller's payable balance, the platform's commission revenue, the IVA owed
  on fees and shipping, and the cash a driver is carrying are all queries over
  one table.
- Cash on delivery is first-class: cash sits in `driver_cash` until the route
  is settled, and a shortfall is posted to `cash_over_short` with a mandatory
  written note.
- Corrections are new transactions, never edits. The history is the audit
  trail.
- It is more ceremony than a balance column. It is also what an accountant will
  ask for.

## 10. An append-only stock ledger, with reservation when the order is placed

**Context.** Two shoppers must never be sold the same last unit, and "why does
the system say we have three?" must be answerable.

**Decision.** `stock_levels` holds `on_hand` and `reserved` per warehouse, SKU
and seller, with the constraint `reserved <= on_hand`. Placing an order raises
`reserved` in the same transaction that creates the order; packing the parcel
lowers both. Every change to on-hand stock writes a row to `stock_movements`,
which cannot be updated or deleted. Unpaid orders release their reservation
after `reservation_minutes` (30 by default) through a scheduled job.

**Consequences.**

- Overselling is prevented by the database, under concurrency: the reserving
  `UPDATE` repeats the availability test in its `WHERE`, so a competing order
  that got there first leaves it matching nothing, and the order fails with
  `insufficient_stock`.
- Current stock can always be explained, and rebuilt, from the movements.
- The expiry job needs a scheduler (`pg_cron`). Where there is none — local
  development — unpaid orders hold stock until someone calls the function.

## 11. Idempotency keys on order placement

**Context.** Mobile connections drop. A shopper who taps "Confirmar" and sees a
spinner will tap again; a timed-out request may or may not have created the
order.

**Decision.** The checkout page generates a key when it renders and sends it
with the order. `orders` has a unique constraint on `(user_id,
idempotency_key)`; `place_order` looks the key up first and, if an order
exists, returns it with `replayed: true` instead of creating another.

**Consequences.**

- A double tap or a retry cannot create two orders or reserve stock twice.
- Payment capture is idempotent in the same spirit: capturing an already-booked
  order does nothing.
- The key belongs to a rendering of the checkout page, so a shopper who
  deliberately goes back and orders the same basket again gets a new order.

## 12. Outbox events for work outside the transaction

**Context.** Placing an order should eventually send an e-mail, issue an
invoice, and notify a gateway. Doing those inside the transaction makes the
order depend on third parties being up; doing them after it risks the order
committing and the follow-up being lost.

**Decision.** Business functions write a row to `private.outbox_events` in the
same transaction as the change it describes (`order.placed`,
`order.released`, `shipment.delivered`, `shipment.delivery_failed`,
`return.requested`, and others). An event exists if and only if the change
committed. A worker is meant to read unprocessed rows, do the external work,
and mark them processed, retrying on failure.

**Consequences.**

- The writer side is built and tested. The first consumer is the
  notification worker (decision 22): each event gets one job per consumer
  (`private.outbox_jobs`), so other consumers can attach without touching it.
  The second is the invoice worker (decision 38), for `payment.captured` and
  `fiscal.refund_booked`. Neither sends anything for real until the owner
  sets up its provider.
- Consumers must be idempotent: an event can be delivered more than once.
- This is the seam where a queue or a search indexer attaches later without
  touching the business functions.

## 13. Own-fleet delivery with a PIN as proof

**Context.** The wedge is reliable next-day delivery in the GAM with a person
who can be held to it. Carriers are cheaper at low density but do not offer
cash on delivery, proof at the door, or control over the promise.

**Decision.** Yuntera's own drivers deliver in the active zones. A route is a
list of stops; each stop carries a copy of only what is needed at the door.
Delivery is proven by the shopper's PIN (decision 5), the recipient's name, the
position where it was confirmed, and optionally a photo.

**Consequences.**

- Privacy is built into the shape of the data: a driver never reads the
  `orders` table, sees stops only on routes assigned to them, and loses access
  to a route's stops 24 hours after it is completed.
- Only the driver's latest position is stored (`driver_positions` has one row
  per driver). There is no location history: the system tracks parcels, not
  people.
- The economics depend on stops per driver-day; see the
  [business model](../00-strategy/business-model.md). The software does not
  change that arithmetic.
- National delivery by carrier (the `national` zone) is modelled and switched
  off.

## 14. The name lives in one file

**Context.** The name was chosen after checking domains and app stores, but no
trademark search has been done and no domain has been bought. It may have to
change.

**Decision.** The product name, the app family names, taglines, domains and
bundle identifiers are defined in `packages/brand/src/brand.ts` and read from
there everywhere. Colours and type are tokens in the same package. Order
numbers take their prefix from a setting (`order_number_prefix`).

**Consequences.**

- Renaming is an edit to that file plus the logo artwork, then a rebuild.
- Things that would still need a manual pass: the package scope
  `@yuntera/*`, the demo accounts' `@yuntera.example` addresses, the local
  database name, prose in `docs/`, and any domain or hostname already
  configured in a hosting platform.

## 15. Fees regrounded on published gateway costs

**Context.** The first fee schedule charged sellers 3.5% for card payments and
1% for SINPE Móvil. Research found published gateway prices above both
([fact sheet, section 5](../research/costa-rica-fact-sheet.md#5-payments)):
the platform would have lost money on every payment.

**Decision.** Set the payment fee at the cheaper published gateway's price:
card 3.9% + ₡180 (about US$0.35), SINPE Móvil 1.5%, cash on delivery 2% + ₡300,
bank transfer 0.5%, with 13% IVA on all fees. Referral commission stays at a
12% default with per-category rates from 8% to 15% and a ₡150 floor per unit.
The same numbers are in `packages/core/src/fees.ts` and in the
`fee_schedules` tables; a test fails if they differ.

**Consequences.**

- The payment line is designed to pass cost through, not to earn margin.
- The amounts are **assumptions**, version `2026-11-assumptions`. They follow
  published list prices at low-to-medium confidence, not a signed contract, and
  the colón amount of the fixed fee assumes an exchange rate. They must be
  replaced when a gateway is contracted.
- The tested example: a ₡20,000 household item, shipped by the seller, paid by
  card, pays the seller ₡16,203.20
  ([worked through here](../04-algorithms/fees-and-settlement.md#worked-example)).
- The fixed part of the payment fee is charged once per order, as the gateway
  charges it, and shared between the order's sellers in proportion to what
  each sold; see the fees document.

## 16. No cloud resources created without the owner

**Context.** The session that built this had access to the owner's Supabase
and Vercel accounts. The Supabase organisation is on a paid plan and already
hosts the production database of another product. A new project there is
billed (about US$10 a month on top of the plan, by the platform's published
compute pricing), and a mistake in the wrong project would touch a live
business.

**Decision.** Create nothing. No Supabase project, no Vercel project, no
domain. Leave a runbook the owner can follow, with the cost choice at the top.

**Consequences.**

- Nothing is deployed, so nothing has been tested on the real platforms
  (decision 3).
- The owner chooses between a new project in the paid organisation and a
  separate free organisation, with the trade-offs laid out in
  [environments](../07-deployment/environments.md#the-first-decision-where-the-database-lives).
- The existing production project in that organisation was not touched and must
  not be used for this product.

## 17. Native styling: plain StyleSheet with tokens from the brand package

**Context.** The native apps need the same colours, type and spacing as the
web apps, which take them from `packages/brand` as CSS variables. React Native
has no CSS; the usual options are a utility-class library on top of React
Native or plain `StyleSheet` objects.

**Decision.** Plain `StyleSheet`, with a numeric token module in
`packages/expo-kit/src/theme/tokens.ts` that is derived from `packages/brand`
rather than copied: colours by name, sizes converted from the web's units to
points. Every pair of text and background, and every control edge, that the
native components draw is listed there and tested for 4.5:1 or 3:1 contrast.

**Consequences.**

- One less build-time dependency, and nothing that differs between iOS,
  Android and the web export.
- A change to the brand tokens reaches the apps with no copy to update; the
  contrast test fails if a native pair stops passing.
- Styles are written as objects, not class names, so screens are a little more
  verbose than with a utility-class library.

## 18. The session lives in the phone's secure store alone

**Context.** A signed-in session holds a refresh token, which is as good as
the password until it expires, so on a phone it belongs in the platform's
secure store: the Keychain on iOS, storage encrypted with a Keystore key on
Android, both reached through `expo-secure-store`. That store is meant for
small values, and a session (two tokens and the user) is larger than it
reliably accepts. The first version therefore encrypted the session in
JavaScript with AES (`aes-js`), kept the ciphertext in ordinary app storage
and only the random key in the secure store. Shipping a cipher of our own
makes Apple's export-compliance question, asked for every build and holding
it as "Missing Compliance" until answered, a matter for an adviser. The apps
are about to go to TestFlight and Google Play internal testing.

**Decision.** Ship no cipher. The session is kept only in the secure store,
split into pieces of at most 1,024 bytes of UTF-8 (half the roughly 2,048
bytes some iOS releases refused), never cutting a character, with a small
manifest written last (`packages/expo-kit/src/supabase/secure-session-storage.ts`).
Pieces go into whichever of two slots the manifest does not point to, so at
every moment the manifest points to a complete value or to none; byte length
and a checksum confirm the pieces read back, and anything inconsistent reads
as signed out and is deleted. Calls run one at a time. On iOS the pieces stay
readable after the phone's first unlock (so a background task can still call
the API) and only on this device (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), so
a backup restored on another phone starts signed out. Because the iOS
Keychain survives uninstalling the app, a marker in ordinary storage (not
secret) records that this installation has cleaned up; when it is missing,
the first call removes what the old adapter left (the ciphertext in ordinary
storage and its key in the secure store) and any session kept from before a
reinstall. All four apps declare `ios.config.usesNonExemptEncryption: false`
(`packages/expo-kit/src/config.ts`): the apps' only encryption is the
operating system's (HTTPS, Keychain, Keystore), which is exempt. A test fails
if a cipher, hash or key-derivation library is added to the kit, a native
app or a package they bundle, and a scan of every exported bundle
(`packages/expo-kit/scripts/scan-bundles.mjs`, run by `stack.sh native` and in
CI) fails if one arrives through a dependency of a dependency. The shop keeps
`expo-crypto` for a random identifier at checkout; since SDK 58 that package
also offers AES-GCM through CryptoKit and javax.crypto, so a source check
allows the apps only its random-number functions. The web export, used only for the journeys,
keeps the session in the browser's local storage and must not serve as a
model for a public website.

**Consequences.**

- Everyone signed in to a native app signs in once more after this update.
  Only development and test builds existed before it, so only their
  testers are affected.
- TestFlight builds no longer wait on the export-compliance question. The
  declaration must be revisited if an app ever adds encryption of its own.
- The size limit was taken from Expo's SecureStore documentation ("some iOS
  releases refused values above roughly 2048 bytes. Expo does not enforce a
  limit") and checked in the installed `expo-secure-store` 58.0.3: the iOS
  module stores the value's UTF-8 bytes in one Keychain item with no limit
  of its own, and the Android module encrypts it with a Keystore key into
  one SharedPreferences entry, also with no limit. Key names may contain
  only letters, digits, `.`, `-` and `_`, checked in its source. The real
  limits on today's phones, the behaviour after a restore to a new device
  and the Keychain setting are unverified until a build is installed.
- A session now takes several secure-store calls to read; the last value is
  kept in memory, so this happens once per start rather than before every
  API call. A second JavaScript runtime writing the session at the same time
  is not supported.
- The logic is unit-tested with fake stores, including stores that fail or
  stop at every write of an update and of a sign-out. A sign-out that could
  not make the stored session unreadable (the secure store failing every
  call) is reported as failed rather than as done, so the person stays
  visibly signed in and can try again. Every way the apps sign out goes
  through `signOutDevice` (`packages/expo-kit/src/auth/sign-out.ts`): the
  button, a session the database says has ended (decision 23), and, in the
  shopper app, a password-only sign-in to an account with a second factor,
  which that app does not keep (the other three ask for the code, decision
  29).

## 19. A darker field outline in the native apps than on the web

**Context.** The web draws text fields and choice boxes with the brand's
`borderStrong` (añil 200), which measures 1.5:1 against white. WCAG asks 3:1
for the edge of a control that has nothing else to show where it is.

**Decision.** The native apps outline fields and choice boxes in añil 400 from
the same palette, and the contrast test checks it.

**Consequences.**

- Fields look slightly heavier in the apps than on the website. This is a
  deliberate difference, not drift.
- The web's outline has the same shortfall and should get the same change; it
  has not been made there yet.

## 20. The native apps' store identifiers use com.yuntera

**Context.** Each native app needs an identifier for the App Store and Google
Play, and it can never change once the app is uploaded. The apps were first
built with identifiers under `cr.yuntera`, which assumed the `yuntera.cr`
domain; that domain is not registered yet, while `yuntera.com` is owned.

**Decision.** The owner chose, on 21 November 2026 and before any store upload:
`com.yuntera.shop` (shopper), `com.yuntera.vende` (seller), `com.yuntera.ruta`
(drivers) and `com.yuntera.bodega` (warehouse). They are recorded in
`packages/brand/src/brand.ts`; development and preview builds add `.dev` and
`.preview`. A test pins the shopper app's store build to `com.yuntera.shop`.

**Consequences.**

- The shopper app is registered under `com.yuntera.shop` in Google Play
  Console; from the first upload on, the identifiers are fixed.
- The stores do not check that an identifier matches a domain, so registering
  `yuntera.cr` later changes nothing here.

## 21. The brand package does not declare React

**Context.** `packages/brand` declared React 19.3.1 as a dependency for its
logo component. The web apps use React 19.3.1; the native apps use 19.3.0, the
version Expo SDK 58 is built against. Because of the declaration, the package
manager installed a second React inside the native apps' dependencies, and
Expo's checks reported a duplicate React. The bundles were still correct, but two copies of React in one bundle break an app at run time, and the check must stay clean to catch that.

**Decision.** `packages/brand` declares React neither as a dependency nor as a
peer. Its logo uses React only for types, which `@types/react` provides; each
app brings its own React.

**Consequences.**

- The web apps resolve React 19.3.1 and the native apps 19.3.0, with one copy
  each.
- If the brand package ever needs React at run time, it should declare it as a
  peer with a range both versions satisfy, and the duplicate check must pass
  again.

## 22. Notifications run outside the apps, with their own key

**Context.** Order messages, staff alerts and account e-mails must go out
after the change that caused them commits, be retried without being sent
twice, and respect each person's channels and consent. No app may hold a
privileged key (decision 2).

**Decision.** A SQL planner turns each outbox event into one planned message
per recipient and channel, exactly once. A worker in `packages/notifications`
(web-standard TypeScript, deployed as the Edge Functions `notify-worker`,
`bird-webhook` and `auth-email`) claims due messages with a lease, renders
them, sends them through Bird (e-mail, WhatsApp, SMS) and Expo (push), and
records the outcome. It calls only `worker_*` functions with a dedicated
secret key; each is granted to `service_role` alone and checks the token's
role. Provider reports arrive as signed webhooks and are applied once.
Account e-mails use Auth's own templates until the provider is set up, then
the Send Email Hook, in the same words (a test keeps them equal).

**Consequences.**

- The apps still hold no privileged key; staff see which messages an order
  produced, never their text or address.
- Nothing is sent for real until the owner sets up Bird, Meta and Expo
  ([notifications](../06-operations/notifications.md)). Locally the worker
  talks to fakes (`tools/dev-notify`).
- Commercial messages need a separate, recorded consent and cannot be sent
  yet: there is no commercial template and no one-step unsubscribe page.

## 23. A per-request check, and the second factor in the database

**Context.** Access tokens are valid for an hour by themselves, so signing
out, changing a password or deleting an account did not stop a token already
issued. And a second factor checked only by the apps' screens protects
nothing: anyone with the password can call the Data API directly.

**Decision.** `public.check_request()` runs before every Data API request
(`pgrst.db_pre_request`). It refuses a deleted account, a session that no
longer exists, and a password-only session of an account with a verified
factor (except for the second step's own functions). The staff and seller
helpers include `private.factor_ok()`. Storage, which does not run the check,
calls the same helpers in its rules.

**Consequences.**

- Ending a session takes effect at once; deletion and writing requests of the
  same account are serialised.
- Every request pays a few indexed lookups (`auth.users`, `auth.sessions`,
  `auth.mfa_factors`); how much that costs on the hosted project is not
  measured.
- Whether the hosted project accepts the setting is checked when the
  migration is first applied
  ([runbook step 3](../07-deployment/runbook-first-deploy.md#3-apply-the-migrations)).

## 24. Deleting an account anonymises; the sign-in record stays

**Context.** The right to erasure and both app stores require a way to delete
an account, but orders, returns, complaints and ledger entries must be kept
for the legal retention period and refer to the account.

**Decision.** `delete_my_account` erases or anonymises everything that
identifies the person in one transaction, keeps the records the law requires
detached from them, and anonymises the `auth.users` row rather than deleting
it. It refuses while something is pending (an order, a refund owed, an open
shop the person alone runs). What later features add about a person (the
notifications' preferences, consent, tokens and suppressions; a closed shop's
photos) is erased in the same transaction; a test searches every row of every
table for the person afterwards.

**Consequences.**

- A new feature that stores something about a person must extend the
  deletion; a guard in `095_account_security.sql` fails for any new column
  that refers to an account and is not accounted for.
- The same e-mail can sign up again as a new account.

## 25. Photos in two buckets, published by re-encoding

**Context.** Sellers' photos must not reach the shop before catalogue review,
and the three sizes a browser picks from must be the picture staff saw.

**Decision.** Sellers upload into a private bucket, into paths reserved by a
function, and cannot overwrite, move or sign a shareable link. On approval the
console downloads the largest copy under the staff member's session, checks
and decodes it with `sharp`, and writes the three public sizes from it into
the public bucket.

**Consequences.**

- Whatever a client uploads (another picture per size, location data, hidden
  content), only what staff saw, re-encoded, is public.
- The console needs `sharp` at run time, a native module; it is a declared
  dependency of `apps/ops`, and whether it runs on Vercel is checked at the
  first deploy.
- Files that are no longer needed are deleted only when a seller or catalogue
  staff act; there is no scheduled clean-up.

## 26. One register for every refund

**Context.** The security review of 21 November 2026 found that the same money
could move twice: two returns of the last unit of a line approved at once, a
refunded return set back to approved, a cancellation refunded while a return
of the same order was refunded too. Each refund path checked its own rules,
and nothing checked them together.

**Decision.** Every refund goes through `private.refunds` and
`private.refund_units`, which name what is refunded (a cancelled order, one
return, one parcel that came back) and refuse the same thing twice, more units
than were bought and more money than was collected. A deferred trigger refuses
at commit any refund transaction in the ledger that is not in the register.
Returns follow a state machine (requested, approved, received, refunded, or
rejected) enforced by a trigger, and are refunded only after the goods are
recorded back. Every function that moves an order's money takes the order's
row lock first, so two such calls on one order queue up. The rules are in
[returns and refunds](../04-algorithms/returns-and-refunds.md).

**Consequences.**

- A refund amount can be traced to what it refunded, and no path can exceed
  what was paid.
- A return waits for the goods; staff close an approved return whose goods
  never came back.
- Cash on delivery is collected once, at the first parcel handed over, for the
  total less the goods already on their way back. A parcel that comes back
  after the cash was taken is refunded by transfer, because the gateway has no
  partial capture.
- Shipping is not refunded when a parcel comes back undelivered. That is a
  policy choice for the owner to confirm.

## 27. Limits are per account and per target, never per address

**Context.** The same review found that one account or one visitor could fill
queues (listings for review, inbound shipments, reports, invitations), take a
product off sale with unpaid orders, or send inputs large enough to slow the
database. A rate limit by network address does not work behind the apps'
servers, which make every call.

**Decision.** Limits are of four kinds: the target must exist and be public;
a repeat is counted once; each account has a cap on what it has open; inputs
are bounded before any work is done. Each limit is a setting in
`app_settings` with a documented fallback, or a named constant. Visitor
reports share one safety valve per hour across the platform, but the first
report about something not yet reported always gets through. Changes that
could mislead shoppers or redirect money (a shop's name, fiscal details,
contact phone) are requests staff approve, never direct writes.

**Consequences.**

- Nothing here stops one person using many free accounts; that needs the
  gateway's fraud tools and identity checks.
- There is still no limit per minute or on request size at the edge; that is
  configured on the hosting platform before launch.
- The numbers are first guesses above what an honest shopper or seller does;
  they are settings so that they can change without a migration.

## 28. A driver's offline day in ordinary app storage, kept small and short

**Context.** The drivers' app works in dead zones: it keeps the day's routes
on the phone (customers' names, phones, _señas_ and map pins) and a queue of
what the driver did without signal (arrivals, failed deliveries with the
position at the door, position reports). Its first version kept both in the
kit's encrypted storage, a cipher of our own that the apps no longer ship
(decision 18). The secure store that replaced it suits the session, not
this: a long route's day is tens of kilobytes (dozens of 1,024-byte pieces,
against the store's 64-piece ceiling), rewritten whenever a stop changes, and
the queue is written several times a minute by the location task while the
screen is locked, each write several Keychain or Keystore calls.

**Decision.** Both live in the app's ordinary storage (AsyncStorage through
the kit's `appStorage`). The operating system encrypts it with the device's
own keys (iOS data protection, Android file-based encryption) and keeps it to
the app; there is no cipher of ours. In exchange the app keeps as little and
as briefly as the feature needs (`apps/driver-native/src/lib/driver.tsx`,
`route.ts` `keptOnPhone`, and `packages/expo-kit/src/offline/`):

- Only the routes still to drive are saved; finished and cancelled ones are
  shown while there is signal but never written, and a stop already closed
  keeps no phone number. The queue holds stop ids, failure reasons and the
  driver's positions, never a customer's name, phone or address.
- The saved day is removed at sign-out (also when the server ends the
  session), when access is lost or the driver is suspended, when another
  account opens the app, and once it is a day old, whether or not anyone is
  signed in and even with the app left open. The queue drops positions at
  sign-out, everything of an account when it loses access or another account
  signs in, positions after 5 minutes and other entries after 24 hours, as
  long as the database accepts the time they happened (they are then shown
  as not sent; decision 31).
- The drivers' app is kept out of Android's cloud backup
  (`android:allowBackup="false"`) and AsyncStorage is excluded from iOS
  backups in every app (`RCTAsyncStorageExcludeFromBackup`, its default,
  written out). Nothing of it is logged.

**Consequences.**

- Someone who unlocks the phone, or a forensic copy of an unlocked phone, can
  read the day saved for the last 24 hours; the secure store would not have
  stopped that either, since the app reads the day without asking for a
  fingerprint.
- Android's device-to-device transfer (moving to a new phone) is not
  switched off by `allowBackup`; a transferred day is at most 24 hours old
  and is removed on the next start. Not checked on a device.
- Every removal path has a unit test with a fake store; the driver journey
  checks what is left in storage after the routes end and after sign-out.

## 29. The staff apps ask for the second factor themselves

**Context.** Sellers can turn on an authenticator app on the website, and the
database refuses a password-only session of such an account everything but
the second step (decision 23). The native apps used to undo that sign-in and
send the person to the website, which locked those sellers out of their app.

**Decision.** The kit has a second-step screen. After the right password, an
account with a verified authenticator is held at the session status
`secondStep`: its roles are not read, and the sign-in form asks for the
6-digit code. The code goes through the same steps as the website: an attempt
is reserved with `mfa_reserve_attempt` before the code leaves, Auth's
`challengeAndVerify` checks it, and `mfa_attempt_succeeded` gives the
reservation back. The seller, driver and warehouse apps use it
(`AppProviders secondStep="in-app"`); the shopper app still sends such
accounts to the website until it gets the same screen.

**Consequences.**

- A wrong code says how many tries are left; after five in fifteen minutes the
  pause holds even the right code and the message says how long to wait. The
  code is never stored or logged.
- Enrolling or removing an authenticator stays on the website.
- Checked against the local stand-in for Auth (the seller journey); the hosted
  project's Auth was not tried from the apps.

## 30. A driver's far-away position: refused live, flagged at a door

**Context.** The drivers' phones send a position every so often, and one with
each delivery and failed delivery. The database accepted any number: a
position report outside Costa Rica failed on the table's own check with a raw
error, and a stop took anything, `NaN` included.

**Decision.** Every position is checked first: half of one, a value that is
not finite (`NaN`, infinity) or off the globe is refused (`invalid_position`).
A real place outside the service area (the Costa Rica box of
`CR_BOUNDS`) is treated by what it is for:

- **A live position report is refused** (`position_outside_area`) and not
  stored. It only feeds the dispatch map of drivers in Costa Rica; a reading
  from Madrid or from 0,0 is a fault or a fake, and the next report replaces
  it anyway. Storing it would put the driver in the wrong place on Central's
  map.
- **A delivery or a failure is recorded, with the position kept and flagged**
  (`route_stops.pod_outside_area`). The delivery is proven by the shopper's
  code, not by the position; refusing it would leave a parcel delivered in
  fact but not in the system. Keeping the odd position is the evidence staff
  need if it ever matters (a failure claimed far from the door).

**Consequences.**

- The apps get a code they can explain, never a database error.
- The flag shows on the console's dispatch board, next to the stop.

## 31. Offline driver actions keep when they happened, within a day

**Context.** The drivers' app queues arrivals, failed deliveries and positions
without signal and sends them later; the database stamped them with the time
they arrived, which moved failures and arrivals hours later than they
happened.

**Decision.** `driver_arrive`, `driver_fail_stop` and `driver_report_position`
take `p_occurred_at` and `p_sent_at` (the phone's clock when it sends). With
both, the database records its own now minus the difference, so only how
long the phone held the action counts and a phone clock that is off by
minutes or hours does not matter; an action after its own sending is refused
(`action_time_in_future`). Without `p_sent_at` the time is taken as given: it
is accepted up to two minutes ahead of the database's clock (a phone a little
fast counts as now), refused further ahead
(`action_time_in_future`) or more than a day back (`action_time_too_old`), and
never earlier than what it follows (the route's start, the arrival). The
stop's `arrived_at` and `completed_at` and the shopper's timeline hold when it
happened, which every reader (driver app, dispatch board, promise and seller
metrics) uses; the time received is kept beside it (`arrived_received_at`,
`completed_received_at`, `driver_positions.received_at`). An older position
never overwrites a newer one. The app sends the time the action was queued,
or for a position the time the phone read it, and the client adds the
phone's clock at sending to every such call; it keeps stop actions a day.
The dispatch board shows when a closing reached the server ten minutes or
more after it happened, and flags a delivery whose door position lay outside
the service area (decision 30).

**Consequences.**

- A phone's wrong clock does not block its queue. The one thing the phone's
  clock can still distort is a jump while an action waits (the clock
  corrected by the network in between); the bounds still apply then.
- A delivery against the code still needs signal and is stamped by the
  database.

## 32. Delivered and returned parcels end an order as delivered

**Context.** An order with one parcel delivered and another back at the
warehouse stayed "shipped" for ever: it counted as open, so the shopper (and
the last person running its shop) could not delete their account.

**Decision.** An order whose parcels have all ended, at least one delivered
and the rest returned, is **delivered**. Seller payouts already treated such
an order as settled when each seller's parcels ended; to change no payout,
`seller_order_settled_at` keeps deciding per seller for an order that has a
returned parcel. Existing orders in that state were moved by the migration,
dated when their last parcel ended. `orderStatusFromShipments` says the same.

**Consequences.**

- Its withdrawal and warranty windows count from when the last parcel ended,
  never shorter than before.
- An order none of whose parcels was delivered is still cancelled.

## 33. A fee change pauses offers below the price floor

**Context.** The price floor (a sale must not book more fees than the seller
is paid) was enforced when a price, package, category or status changed, but
not when a new fee schedule was switched on.

**Decision.** Switching a schedule on, or changing the active one's own
amounts (default commission, minimum commission per unit, tax on the fees),
its payment or warehouse fees or a category's commission, rechecks every
offer on sale.
Those below the floor are **paused**, recorded
(`private.fee_floor_breaches`), listed for finance and catalogue staff (the
console's "Ofertas en pausa") and their shops are told with the minimum price,
once per shop and change however many fee tables it touches (the message
lists the shop's paused offers when it is written).
They are paused rather than left on sale because each sale at a loss leaves
the seller owing Yuntera money that nothing collects, while a paused offer is
back on sale the moment its seller sets a price that covers the new fees (the
floor is checked then, as always).

**Consequences.**

- Shoppers stop seeing those offers until the seller acts.
- Orders placed before the change are unaffected; a capture after it books
  the new fees, as before.

## 34. "Refund completed" waits for a recorded confirmation

**Context.** "Refund completed" was announced when a payment was marked
refunded, which in live mode happens when the refund is booked, before any
money moves.

**Decision.** A refund is confirmed by a row of its own
(`private.refund_confirmations`, written once), and only that announces
`refund.completed`. In sandbox mode, where nothing moves, a refund confirms
itself when its transaction commits (after its `refund.requested`); one
settled at the door is confirmed silently; in live mode the payment gateway
work calls `private.confirm_refund(refund_id, reference)` from its server-side
handler when the gateway or the bank says the money went out.

**Consequences.**

- Staff-approved return refunds now get a "refund completed" message too.
- Since the gateway (decision 37, migration 083400) the confirmation and the
  money are one step: completing a gateway refund (the gateway's
  confirmation, or finance recording a transfer) settles it and then calls
  `private.confirm_refund`, and calling `private.confirm_refund` first
  settles the open gateway refund. A refund whose money was never real is
  confirmed at commit whatever the mode; real money taken in live is not,
  even in sandbox mode. The four pieces are described in
  [returns and refunds](../04-algorithms/returns-and-refunds.md#one-refund-four-pieces).

## 35. The web apps' own sign-in limit, per visitor and per account

**Context.** Sign-in, sign-up, password reset, e-mailed codes and token
refreshes all reach Supabase Auth from the apps' servers, so Auth's limits by
network address (a bucket of 30 on `/auth/v1/token`, for example) count the
server, not the visitor: one visitor could spend them for everybody, and they
stop nobody in particular (WEB-2 of the review of 21 November 2026). Auth can
count a forwarded address (`Sb-Forwarded-For`), but only on requests made with
a **secret** key, with the setting switched on per project; publishable keys
are not accepted. The apps hold no secret key, by design (decision 2).

**Decision.**

- **Not `Sb-Forwarded-For`, for now.** Using it would mean giving the apps a
  secret key, or moving sign-in into a server-side function that holds one.
  The second is the better long-term shape and is left for when sign-in moves
  behind such a function; nothing below has to change for it.
- **The apps' own limit, kept in the database**
  (`auth_limit_reserve` / `auth_limit_release`, migration `083300`), in front
  of every call to Auth a visitor can repeat: sign-in, sign-up, reset and
  confirmation e-mails, e-mailed codes, the current password asked again, and
  the proxy's token refreshes. Counted before the call, under a lock, so a
  burst cannot outrun it; a right password or code, and a refresh Auth
  accepted, give their attempt back.

  Three buckets per action: the visitor address; the account from that one
  address (the strict limit a single guesser meets); and the account from all
  addresses together (a higher ceiling against a guesser with many addresses).

  | What                           | Per address | Per account, one address | Per account, all | Window     |
  | ------------------------------ | ----------- | ------------------------ | ---------------- | ---------- |
  | Wrong passwords                | 20          | 5                        | 50               | 15 minutes |
  | Sign-ups                       | 10          | 3                        | 10               | 1 hour     |
  | Reset and confirmation e-mails | 10          | 5                        | 20               | 1 hour     |
  | Wrong e-mailed codes           | 20          | 5                        | 30               | 15 minutes |
  | Current password asked again   | 20          | —                        | 5 (signed in)    | 15 minutes |
  | Refused token refreshes        | 120         | —                        | —                | 10 minutes |

  Without a trusted visitor address, "per account, one address" becomes the
  account alone at the strict limit.

- **Only keyed hashes are stored**, for two hours: HMAC-SHA-256 of the
  address and of the e-mail typed, with `AUTH_GUARD_KEY`, a server-only key
  the database never sees. A caller without the key cannot compute anyone
  else's hash, so calling the functions directly (they are open to visitors,
  since sign-in comes before a session) cannot count against a real person.
- **Only the apps may add attempts, once the project says so.** Every
  reservation carries `p_caller`, an HMAC of a fixed text with
  `AUTH_GUARD_KEY`. When the project keeps that value's SHA-256 in Vault as
  `auth_limit_caller_digest`, a caller without it is refused
  (`auth_limit_caller`) and adds nothing; without the secret (local runs, CI, a
  project not yet set up) any caller is accepted. The runbook step is
  `select vault.create_secret('<digest>', 'auth_limit_caller_digest')`, with
  `<digest>` from
  `printf %s "$(printf %s auth-limit-caller | openssl dgst -sha256 -hmac "$AUTH_GUARD_KEY" -r | cut -d' ' -f1)" | sha256sum | cut -d' ' -f1`;
  set it after the apps run with the new key, and again whenever the key changes.
- **Nothing looks the account up**: an address with no account is counted and
  answered word for word like one with an account.
- **A stranger cannot keep an honest person out.** One guesser fills only
  its own "one address" share: the owner, from any other address, signs in,
  asks for a reset e-mail and types the right code as usual. A browser that
  signed in to the account before (a signed `yt-dispositivo` cookie, at most
  three accounts) skips both account buckets, for passwords, codes, e-mails and
  sign-ups; the per-address limit still applies there. Only a guesser with
  many addresses (10 for passwords, 6 for codes, 4 for e-mails) can fill the
  account's total, for one window at a time; the owner's usual browser is not
  held even then, and the link in any reset e-mail already sent (including the
  ones the guesser triggered) counts per address only, so it still gets them
  in. The e-mail limit's message does not tell the reader they asked for the
  e-mails, and points to the latest one.
- **Which header says who the visitor is.** On Vercel, `x-vercel-forwarded-for`
  (which Vercel writes and a proxy in front cannot replace), then `x-real-ip`;
  Vercel overwrites both. Elsewhere only what the operator names in
  `AUTH_CLIENT_IP_HEADER` and `AUTH_CLIENT_IP_HOPS` (the entry written by the
  proxy nearest the app; entries further left are the visitor's own words).
  Without either, there is no per-address limit: one shared bucket for every
  visitor would recreate the outage this fixes. IPv6 is counted per /64.
- **Fails closed**: outside a local run, a missing, short or example
  `AUTH_GUARD_KEY`, or a database that does not answer, stops sign-in with a
  generic message rather than letting attempts through uncounted. The one
  exception is a refresh, which goes ahead if the limit cannot be asked: a
  fault in the limit must not sign everybody out.
- **A refused refresh never signs anyone out.** Only refreshes Auth refused
  count (made-up or revoked tokens), so people behind one shared address (a
  mobile carrier's CGNAT, an office) are not counted for their own refreshes.
  If someone sharing their address fills the bucket, the refresh does not go
  to Auth and the cookie writers in the proxy and the session client keep the
  browser's cookies untouched: that person is treated as signed out for that
  request only, and the next request after the wait renews the token.
- **What counts as a local run.** Not on Vercel, the API and site on
  loopback, and either not a production build (`next dev`, tests) or
  `YUNTERA_LOCAL_RUN=1`, which `tools/dev/stack.sh` and CI set. A self-hosted
  production server whose API happens to be on loopback is therefore treated as
  deployed: the published local guard key and example refresh keys are
  refused there. Never set `YUNTERA_LOCAL_RUN` on a deployment.
- **The human check is wired in and off.** Cloudflare Turnstile, which Auth
  verifies once its CAPTCHA protection is on: the widget appears on the
  sign-in, sign-up, reset, resend, password-change and deletion forms when
  `NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY` is set at build time, and the token goes
  to Auth as `captchaToken`. The content-security policy adds Turnstile's
  origin only then.

This refines decision 27 for sign-in only: the other limits stay per account
and per target, because the database cannot see a trustworthy address; these
can, because the apps' server reads it from a header the host guarantees.

**Consequences.**

- Someone with many addresses gets 50 wrong passwords per account per 15
  minutes, about 4 800 a day per account, against passwords that must pass the
  rules in `auth-rules.ts`; and 30 wrong codes per account per 15 minutes
  against a 6-digit code that expires within the hour (about 1 in 8 000 per
  code's life). That is the price of not letting one stranger lock the owner
  out. The edge (Vercel's firewall) and the human check are the next layers.
- Until `auth_limit_caller_digest` is set in Vault, calling
  `auth_limit_reserve` directly with the public key can add rows with made-up
  hashes; they touch nobody and are gone within two hours.
- Auth's own limits still apply behind ours, per server address. Ours are set
  below them per visitor, so a single visitor can no longer exhaust them;
  enough honest traffic from one server address still could (no different from
  before).

## 36. Session lifetimes per app

**Context.** Every app kept @supabase/ssr's default cookie of 400 days, and
Supabase refresh tokens do not expire by default, so a warehouse handheld or a
staff laptop stayed signed in for over a year (WEB-5). Auth's own time-box and
inactivity timeout exist but are a Pro-plan setting; the preview project is on
the free plan.

**Decision.** Each app has a lifetime, enforced by the apps whatever the plan
(`SESSION_POLICIES` in `packages/next-kit/src/guard.ts`, chosen by
`baseConfig({ app })`):

| App           | From sign-in | Idle       | Why                                                                     |
| ------------- | ------------ | ---------- | ----------------------------------------------------------------------- |
| Shop          | 90 days      | —          | A personal device; checkout re-checks everything that matters           |
| Seller centre | 30 days      | —          | Money and payout requests behind it, usually an own device              |
| Staff console | 12 hours     | 30 minutes | One working day; away from the desk ends it; the audit names the person |
| Field app     | 12 hours     | —          | One shift on a shared handheld                                          |

The time from sign-in comes from Auth's signed `amr` claim, so it survives
token refreshes; the console's last activity is a cookie signed for that
session (`yt-actividad`), renewed by every request except background
prefetches. The proxy checks both on every request. A session past either is
ended closed: its refresh token is revoked at Auth (`signOut` for this
session), the cookies are removed, the page sends the person to sign in with
the address they were on, and sign-in says why and brings them back. The
session cookies also carry the app's lifetime as their `Max-Age`.

**Consequences.**

- How it fits Auth's tokens: the access token still lasts one hour and is
  renewed by the proxy; these limits end the whole session on top. A refresh
  token copied out of the browser before the end keeps working against Auth
  directly until Auth's own time-box ends it, which on the free plan is never:
  turn on Auth's time-box (12 hours) and inactivity timeout on the production
  project as well.
- Someone at the console when the 12 hours run out signs in again, even if
  active. A page that polls would count as activity; none does today.
- Sessions of the native apps are not covered (they keep the session in the
  phone's secure store, decision 18).
- What one person's work leaves in the browser (today the console's order
  search, `PER_PERSON_COOKIES` in guard.ts) is removed when a session begins,
  when the person signs out and when the proxy ends a session, so the next
  person at a shared desk does not see it.

## 37. Payments through a gateway worker, confirmed only by the gateway

**Context.** Cards could not be charged and finance confirmed SINPE Móvil
transfers by hand. The research note chose ONVO Pay, which has no idempotency
key for payments or refunds, delivers webhooks at least once in no order,
and matches SINPE Móvil transfers by the payer's identification and amount.

**Decision.** The database keeps one attempt per try at the gateway, every
event once by its id, money that does not match for finance
(`private.payment_reviews`) and one gateway refund per refund in the register.
Only a server-side worker talks to the gateway, in the notification worker's
pattern (decision 22): its own secret key reaching four `worker_payments_*`
functions, woken by `pg_net` and `pg_cron`. The amount always comes from the
order. An order is paid when the gateway's signed notification, or the
worker's own question, says so, applied with the order's lock; the return from
the gateway's page is only a hint. A refund is completed, booked out and
announced only when the gateway confirms it; a send whose answer was lost is
never sent again by itself: the worker checks the gateway for a while, then
finance decides. Each event applies only in the gateway environment that is
the current mode; money taken in the environment the mode has left is kept
for finance, never applied by itself or dropped. Modes:
`sandbox` (simulation), `test` (the gateway's test environment), `live`;
changed only by an administrator, with a reason, once the worker reported
itself ready for that environment.

**Consequences.**

- No card data reaches Yuntera: cards are typed on ONVO's hosted page, in the
  native app too (the phone's browser).
- Paying takes one more step on the order page (start the payment), so a
  decline can be retried with a new attempt without placing a new order.
- Money that arrives unmatched is never applied automatically; finance
  accepts, attaches, refunds or closes it.
- The expected gateway fee is a setting, not a constant, because the central
  bank's card fee cap may not allow the published price.

## 38. The platform issues its own fiscal documents from the outbox

**Context.** Yuntera charges shoppers the delivery fee and charges sellers
commission and fees, so it must issue its own electronic documents to
Hacienda (version 4.4); the sellers invoice the goods themselves. Documents
must be numbered with no gaps, never issued twice, never edited once issued,
and kept for the retention period.

**Decision.** A second consumer of the outbox, `invoice`, turns
`payment.captured` into a tiquete or factura for the delivery fee and a fee
factura per seller, and `fiscal.refund_booked` (a trigger on the refund
register, so every refund path is covered) into credit notes. Each document
has a unique key per thing it documents and takes its number from a locked
counter in the same transaction. A server-side worker with its own key signs
it once (XAdES-EPES with WebCrypto), sends it once, asks before sending again
after a lost answer, and records Hacienda's answer; the signed XML and the
answer are stored immutably in the database. A credit note follows the
booking of the refund, as the ledger does, and waits for its order's capture
documents. Money that was never real (sandbox mode, or the gateway's test
environment) is documented only where `invoicing_policy.simulated_payments`
says so: locally, never on a real project.

**Consequences.**

- Nothing is numbered until the owner enters the company's registration and
  sets `invoicing_issuer.ready`; jobs wait in order until then.
- A job never gives up: a shop's incomplete fiscal data holds back only that
  shop's factura, and finance sees it.
- Issued documents keep the receiver's name and identification after an
  account is deleted, with access closed (privacy.md).
- Only proven against a local fake of Hacienda; signature acceptance needs
  the sandbox credentials.

## 39. One offer order everywhere, and shared listings without review

**Context.** The lockdown closed the table writes through which a shop could
offer on another shop's listing, switch a variant off, take a listing back to
draft, or change its description and logo. Bringing an offer on an existing
product back raised three questions: which offer a shopper sees first, whether
such an offer needs review, and who owns a listing several shops sell.

**Decision.**

- One deterministic order for a variant's offers, in SQL and TypeScript: in
  stock first, then the lowest total for the shopper, then the older offer,
  then the id. The weighted featured-offer score is retired: it disagreed with
  what search showed, could not run in the database, and its seller part was
  a constant. A parity test reads the SQL order (`offers.parity.test.ts`).
- An offer on another shop's product needs no review (its content was
  reviewed); only verified, active shops may add one, at most 30 a day.
- The creating shop keeps the content and edits it through review; nobody
  else does. It cannot archive or draft a listing on which another active
  shop has an offer on sale; a paused offer holds nothing back (a forgotten
  pause would otherwise block the creating shop for good), and the offering
  shop can withdraw its offer for good. When the creating shop closes, each
  listing another active shop offers passes to the shop with the oldest offer
  on sale (the oldest paused one when none is), with its published photos.
- A package or category edit that would leave other shops' offers below the
  price floor is not refused for prices the creating shop does not set, but
  staff see those offers in the review and must confirm; the offers are then
  paused and their shops are told.
- When the offer in a cart can no longer be bought, the cart names another
  shop's offer of the same variant (the first in the same order) and offers
  to swap the line; it never swaps silently.
- The shop's description is a reviewed shop change; its logo goes through the
  photo pipeline; both are shown as text or images only, never markup.

**Consequences.**

- A faster offer no longer beats a slightly cheaper one; every offer's
  delivery date is shown next to its price. Bringing speed back is a change to
  both sides and the help page.
- A shop that takes over a listing cannot remove the photos the closed shop
  uploaded; staff can.
- Details: [offers and the product page](../04-algorithms/featured-offer.md).

## 40. Catalogue staff change the catalogue through functions; hiding is not taking down

**Context.** The lockdown left categories, brands, search synonyms and review
moderation without a door. Staff need them, and the shop must follow at once
without breaking links, the rating or the fees.

**Decision.** One function per change, for catalogue staff and
administrators only, each audited (migration 083700, console section
Catálogo). Chosen where the work offered a choice:

- **Hiding a category** takes it and everything under it out of the menus and
  category pages and out of sellers' choices; its products stay on sale, in
  search and at their own address (breadcrumbs show only what shows). Taking
  goods off sale is a separate, explicit act: a product take-down.
- **A renamed category keeps its old address** as an alias the shop answers
  with a permanent redirect (308) in its proxy, so links and search engines
  follow. Addresses and old addresses share one namespace, and a few words the
  shop keeps for itself are refused.
- **Commission never changes as a side effect.** A category move that would
  change what a listed product pays is refused; commissions change in a
  migration with the TypeScript mirror. A staff correction of one product's
  category may change its commission, because the product was misfiled; it is
  refused if an offer would then sell at a loss, and the seller is told the old
  and new rate (and the IVA, which follows the category as when a seller's edit
  is approved).
- **A merged brand stays as a row** that points at the survivor: its name
  becomes a search alias and its filter address shows the survivor, so nothing
  that pointed at it breaks. A renamed brand keeps its old name as an alias
  and its old filter address too (`brands.former_slugs`). Merging into a brand
  that is out of the filter is refused, so the moved products never drop out
  of it.
- **A hidden review keeps its row and is excluded from the rating** by the
  existing trigger (it counts published reviews only); the reasons are a short
  fixed list, never a low rating; the author reads why on their order page,
  never who did it. Hiding only the seller's reply leaves the rating alone.
  The trigger locks the product row before it counts, so two reviews of one
  product changing at once cannot leave a stale rating.
- **Content reports use the same doors**: acting on a product report is a
  take-down that can be put back, and on a review report a hiding with the
  closest reason, closing the review's other open reports.
- **Putting back never publishes what no one reviewed.** A take-down records
  a digest of the listing (`taken_down_fingerprint`: text, category, brand,
  variants and packages). A seller may change a listing that is not on sale in
  place, so a restore is refused once it differs
  (`listing_changed_since_take_down`); a staff correction while it is down
  keeps it restorable. A take-down ends when the listing leaves `rejected` any
  other way (the seller sends it to review, review decides), so a listing
  review turned down cannot be "put back" either. A taken-down listing whose
  shop closes passes, still taken down, to the shop that inherits it under
  [decision 39](#39-one-offer-order-everywhere-and-shared-listings-without-review),
  so it can still be put back as it was reviewed.
- **Hidden means hidden all the way up.** A category shows only when it and
  every category above it is active; the same rule decides what sellers may
  file under, find to offer on, or have an edit approved into.

**Consequences.**

- The seller is told of a correction, take-down or restoration by a new
  message (`seller_listing_staff_change`); the reviewer of a hidden review is
  not messaged, only shown on the order page.
- Only the listing's own shop is told; other shops offering on a shared
  listing are not.
- A seller who edits a reply staff hid keeps it hidden until staff show it.
- The commission spec in `packages/core/src/fees.ts` is keyed by the launch
  slugs of the departments; the live rate stays on the category row, so a
  renamed department keeps its rate while the spec keeps the old slug.

## 41. Operations staff change zones, districts, the calendar, settings, locations and stuck routes through functions

**Context.** The lockdown left delivery zones, holidays, zone closures,
districts, settings, warehouse locations and stuck routes with no door: only
an administrator in the database could change them. Each change touches
promises already made to shoppers, so the rules must be decided once, in the
database (migration 084000, console section Operación).

**Decision.** One function per change, for operations staff and
administrators (settings for administrators only), each audited without the
free text staff type. Chosen where the work offered a choice:

- **Districts can be "not served".** A district keeps its zone for the record
  but has a `served` flag. A district not served reads like a switched-off
  zone everywhere the shop asks (`list_districts`, `my_addresses`,
  `delivery_estimate`, `checkout_quote`, `place_order` and seller pickup
  points refuse it with `zone_not_served`). A saved address there stays saved
  and is offered again when the district is served again; nothing is deleted.
- **The shop always keeps at least one served district.** The last active
  zone that serves a district cannot be switched off, a zone with no served
  district cannot be switched on, and no district move may leave every active
  zone without one. Zone switches and district moves take the same two locks
  in the same order, so two staff at once cannot get around it (proved by
  the parallel-session test `contract.operations-races.test.ts`).
- **A holiday is refused on a day with routes and needs a confirmation on a
  day with promised orders.** Routes would have to be moved by hand; promised
  orders keep their promise and staff decide whether to tell the shoppers.
  Holidays are added only for days after today and at most 730 days ahead.
- **Overlapping closures of a zone are refused, not merged.** Staff change the
  existing closure's end instead, so one period always says why the zone is
  closed. A closure's days are written into the per-day table the delivery
  promise already reads, so the promise and its parity test are unchanged.
- **Every setting not on the operational list is protected.** Sixteen named
  limits are editable within a range, against the value the administrator
  saw. Everything else (payments, invoicing, the second factor, consent
  versions, payouts, and limits whose numbers are written in app code or
  texts) changes only through the deployment runbook, and a setting added
  later is protected until someone adds it to the list.
- **Lifecycle: `ready_for_dispatch → packed`.** A parcel planned on a route
  but not yet with the driver goes back to packed when dispatch takes it off
  the route; the same transition is in `packages/core/src/lifecycle.ts`, kept
  equal by the parity test.
- **A stop removed by staff shows the shopper "Entrega reprogramada".** A
  parcel already with the driver goes to `delivery_failed` without counting an
  attempt, without a message and with the status entry hidden; `attempt_count`
  0 is how the shop, the native shop, dispatch and the staff order page tell it
  from a failed attempt (`isRescheduledShipment`); an order whose parcels still
  to deliver are all rescheduled says "Entrega reprogramada" in its heading
  too (`isRescheduledOrder`). The driver sees the stop as "Omitida" with what
  to do with the parcel (before the route starts: not to collect it; after:
  to bring it back), and the route's count, the parcels to collect and the
  dispatch card leave it out.
- **One lock order for warehouse locations.** Staff changes to a location
  lock the warehouse row `FOR NO KEY UPDATE` (not `FOR UPDATE`), then the
  location. A stock write holds the location before its ledger row takes
  `KEY SHARE` on the warehouse; `FOR UPDATE` there made the two wait for each
  other and one of them (a staff order cancellation among them) end in a
  deadlock error. `NO KEY UPDATE` still keeps two staff changes in one
  warehouse one after the other.

**Consequences.**

- A parcel that had a real failed attempt, went out again and was then
  removed by staff has `attempt_count` 1, so the shopper still reads "No
  pudimos entregarlo". Telling them apart would need the order to expose the
  last stop's state. (Since decision 43 the order list carries each parcel's
  state, and such an order reads "Entrega reprogramada".)
- There is still no screen to move stock between warehouse locations, nor to
  edit or remove single-day closures made before periods existed; sign-in
  limits are constants in functions, not settings. (Since 084200 and 084300,
  decisions 43 and 44, stock is moved from the location screens and a single
  closed day can be opened; sign-in limits are still constants.)
- A new zone gets its districts while it is off, and is switched on after.

## 42. Brands are deleted only when nothing names them; product pages refuse what is not on sale at the helper

**Context.** Brands could be created, renamed, hidden and merged (decision
40), not deleted, so test brands stayed forever. And the rule that only a
product on sale opens for the public lived only in the callers of
`private.product_page_open`.

**Decision.** (migration 084100)

- **`ops_delete_brand`** deletes a brand that no product names in any status
  (an archived listing counts: the foreign key would refuse it anyway); it is
  refused with `brand_in_use` and the number of products, and the console
  says to merge it or take it out of the filter instead. The brands merged
  into it go with it (they exist only to point at it), its address and
  earlier addresses become free, and an audit entry keeps what it was. A
  brand merged away cannot be deleted on its own.
- **Lock order.** The deletion takes the brands lock and the brand rows before
  it counts, as merges do. Sellers never name a brand; the only other writer
  of a product's brand is a staff correction, which now locks the brand it
  gives before the product. A correction racing a deletion is therefore
  either counted or told the brand is gone, never a foreign-key error (proved
  in `contract.operations-races.test.ts`; without the lock the test fails with
  the foreign-key error).
- **`private.product_page_open`** refuses a product that is not active unless
  the viewer is staff or a member of the shop that created it. Those two keep
  their preview through `get_product`, which has no status filter of its own
  and whose page body applies the same rule; every other caller already asked
  for an active product.

**Consequences.** The two test brands on the hosted preview can be removed
from the console once 084100 is applied there.

## 43. Order follow-ups: the delivery fee when nobody went to the door, stopping a packed parcel, an order that never moves back

**Context.** On the hosted preview two orders (YT-101282, YT-101283) were
taken off routes and came back to the warehouse without any driver going to
the door; receiving them refunded the goods and kept the delivery fee. Once a
parcel was packed, neither the shopper nor staff could cancel the order. And
an order's heading followed its parcels backwards: a parcel planned again
after a failed attempt and then taken off that route made the order's target
"processing" again, and the removal failed.

**Decision.** (migration 084200)

- **The owner's decision of 23 November 2026, on the delivery fee.** Two
  options were put to the owner: keep the delivery fee whenever a parcel
  comes back, or refund it when nobody tried to deliver. The owner chose:
  when an order is cancelled because its parcels came back and nobody ever
  went to the shopper's door, the delivery fee is refunded too; when an
  attempt was made at the door, or another parcel of the order was
  delivered, the fee stays charged. An attempt is a stop the driver marked
  failed, or an attempt counted on a parcel; a stop staff removed is not
  one, nor is a parcel stopped before it left (`private.order_had_door_attempt`,
  mirrored by `deliveryFeeComesBack` in `packages/core`). It applies from
  084200 on; it is not applied to orders closed before.
- **The delivery-fee refund is its own row in the refund register** (reason
  `delivery_fee`, one per order, never more than what is left of the
  payment), not folded into the last parcel's refund. It goes back the same
  way as every other refund and credits the delivery fee's fiscal document in
  full, with the same loop a whole cancellation uses. The goods' refunds and
  the sellers' commission credits stay as they were.
- **Staff stop a packed parcel through a new function**,
  `ops_recall_shipment(p_shipment_id, p_reason)`, rather than a wider
  `ops_return_shipment`: the old one has no reason argument and the console
  and the field app call it, so a new signature would have been an overload.
  Only parcels of a Yuntera warehouse can be stopped; a seller's own packed
  parcel is at the seller's, and sellers have no screen to receive returned
  parcels. A parcel on a route that has started is refused.
- **An order's status never moves backwards** (`private.sync_order_status`
  and `orderStatusFromShipments` keep one ordered list, checked by a parity
  test). A parcel may step back (planned again, then taken off a route); the
  order stays "shipped" until it ends. The shopper's screens read the parcels
  to say what is really happening: "Se está cancelando" when everything left
  is coming back, "Entrega reprogramada" when everything left waits in the
  warehouse to go out again (`orderComingBack`, `orderAwaitingNewAttempt`).
- **Found when it was merged with 084300:** starting a pick and packing take
  the order's lock before the parcel's, as stopping a parcel does; before,
  a stop at the moment of packing ended with a deadlock for one caller. A
  returned parcel is not checked in while its Yuntera warehouse has no
  returns location switched on (`returns_location_missing`), so its units
  always land on a location.

**Consequences.** The shopper gets two refund messages of each kind when the
fee comes back (goods, then fee), each with its own true amount. The store
build of the shopper app from `3f251c3` cannot read the new fields: it shows
such orders by the order's status. YT-101282 and YT-101283 on the preview kept
their ₡1,500 fee under the old rule; refunding it is a finance decision.

## 44. Warehouse stock: what is free, moves that the shop never sees, counts only onto shelves

**Context.** The warehouse could look a product up but not open a location,
could not move stock between locations (so a location holding stock could be
switched off only once orders emptied it), and the count-correction function
had no screen and few checks.

**Decision.** (migration 084300)

- **Free units** of a location are the units on it minus what open pick
  tasks naming it still wait for. Stock is reserved per warehouse, not per
  shelf, so a pick task is the only promise a shelf carries.
- **A move never changes the shop's stock, and the shop does not see it.**
  `wms_move_stock` takes free units of one shop's product to a switched-on
  storage or picking shelf of the same warehouse: one ledger row with both
  sides, no change to on-hand, reserved or what shoppers can buy, no message,
  and nothing in the shop's stock history. Staff see every move in the
  console.
- **Counted units can be added only on shelves**: storage, picking, returns
  and receiving locations (`count_not_shelf` otherwise); units may be counted
  out anywhere. A correction is refused when the shelf changed since the
  screen showed it, when it would take units open picks wait for or that
  shoppers already bought, and below zero. Every correction is booked as a
  count, never as damage, and the shop sees it with the warehouse's reason.
- **Picks prefer shelves.** A new pick task names a switched-on storage,
  picking, returns or receiving location whose free units fill the whole
  task first, then one with some free units; within that, storage and
  picking shelves before the returns and receiving areas, then the most
  free units; a shelf with too few free units never wins over another
  switched-on storage, picking, returns or receiving location that can fill
  the task, such as units that came back into the returns area. Among
  locations that cannot fill it, switched-on ones come before switched-off
  ones; the damaged, packing and dispatch areas only when no other location
  holds the product, switched on or off, even when that location cannot fill
  the task: a certain short pick, which staff resolve by moving units onto a
  shelf, is preferred to sending a picker to units that may be damaged or
  already set aside at a packing or dispatch station. Two releases of the
  same product wait for each other on the shop's stock row, so two payments
  confirmed at the same moment never send both tasks to a shelf that fills
  only one. That wait works in READ COMMITTED, the level every caller runs
  in; a caller in REPEATABLE READ would wait and still count from its
  snapshot, so no function may set another level for a release.
- **Lock order.** Moves and corrections take the warehouse row
  `FOR NO KEY UPDATE` first, then the locations, then (a correction) the
  shop's stock row before the shelf's row, the order receipts and returned
  parcels take them in. Every function that writes the stock rows of
  several products, or of one product from several shops, in one
  transaction takes them by product, shop and warehouse, as checkout does:
  a release to picking, packing, a cancellation, and the unpaid-order sweep,
  which takes the rows of every order it cancels first. Proved in
  `contract.stock-lock-order-races.test.ts`. Proved with two real sessions in
  `contract.warehouse-stock-races.test.ts` and
  `contract.returned-stock-races.test.ts` (100 rounds each against a
  returned parcel's check-in).

**Consequences.** A cancellation still took a shelf's row before the shop's
stock row (`private.cancel_order_internal`, whose only change here was the order it sorts by), so a
cancellation racing a count of the same product on the same shelf could end
with a deadlock for one of the two, until decision 46 made the cancellation
take the stock row first. A product the location does not list is
counted onto it with its own function (decision 47).

## 45. Android builds of the shopper app go to the internal testers without a click

**Context.** The first Android build of the shopper app reached Google Play's
internal testing as a draft release, because the app had never been
published; each draft needs a click in Play Console before testers get it.

**Decision.** The owner's decision of 23 November 2026: from the owner's
first Android release of the shopper app on, each new Android build goes
straight to the internal testers without a click. Until that first release,
builds stay drafts.

**Consequences.** Recorded as a decision only: the build and submission
settings (`apps/shop-native/eas.json`, the app configuration, identifiers,
permissions and native modules) are not changed by this record. They change
when the first release has been made.

## 46. Product rows written only when the summary changes; one lock order for stock, orders and shelves

**Context.** Every stock write refreshed the product's listing summary, so
two transactions writing two products shared by several variants or shops
in opposite order deadlocked on the product rows (an independent race
harness: 1 to 42 in 100 natural rounds, every forced round). The refresh
read the offers before it locked the product row, so two checkouts of the
last units of two offers of one product could leave it "in stock" with
nothing to sell. A cancellation took a shelf before the stock row, the
opposite of a count, a receipt and a pick. The unpaid-order sweep held the
stock rows of every expired order for its whole run. A driver starting a
route took the route and its parcels before their orders, and a shop
packing a parcel it ships itself took the parcel and its stock before the
order, so a cancellation at that moment deadlocked with it.

**Decision.** (migration 084400)

- **The summary is written only when it changes.** It depends on whether an
  offer has units, never on how many, so an offer's update refreshes it only
  when price, list price, status, fulfilment, handling days or condition
  changed, or the units crossed zero; the refresh writes only a value that
  differs. Chosen over the other fix the review offered (taking every
  order's product rows in id order in each stock writer): wave 7 showed that
  every lock added to a core writer creates new inversions, while this one
  removes the product row from ordinary sales altogether and changes no
  stock writer.
- **The refresh locks the product row before it reads.** Two refreshes of
  one product run one after the other, and the later one computes from what
  the earlier committed. This relies on READ COMMITTED and on the refresh
  being a VOLATILE function (a new snapshot per statement, also inside a
  trigger).
- **One lock order** for every stock writer: warehouse (moves and counts),
  location, order, parcel, pick tasks, stock rows by product, shop and
  warehouse (each with its offer and, when the offer crosses zero, its
  product), shelf rows. The cancellation follows it now; a route start takes
  its parcels' orders first; a shop packing a parcel it ships itself
  (`seller_mark_packed`) takes the order first, as warehouse packing does; a
  shop's products are refreshed in id order (a convention: no measured race
  depends on it). A count into a location (decision 47) takes the
  warehouse, the location, the stock row and the shelf, as a correction
  does. A seller switching a variant off or on takes the shop's own offers
  on the variant first, then the product, then the variant FOR NO KEY
  UPDATE, not FOR UPDATE (it changes no key column). It took the product and
  the variant first and then waited on the offer, while packing (which wants
  a key-share lock on the variant, race E10), a checkout (a key-share lock on
  the product, E10b) or a count into a location taking the offer across zero
  (the product, I8) held that offer: 14, 17 and 10 in 100 natural rounds and
  every forced round before, 0 after.
  Written down in `docs/04-algorithms/sourcing-and-inventory.md`, with every
  statement that writes or locks a product row.
- **The sweep cancels at most 200 orders a run, the oldest first**, so a run
  holds stock rows for about 0.4 s (measured for 200 orders on a local
  database of a shared machine, not on the hosted project); the five-minute
  schedule takes the rest.
- **The races stay in the repository** (`tools/races`, two real sessions and
  forced interleavings, 100 rounds a scenario), outside `pnpm test`; a few
  forced rounds of each fix are contract tests.

**Consequences.** Ordinary sales no longer write the product row (its
`updated_at` no longer moves with stock). Still possible, measured with
forced rounds and documented: two writers that each take offers of two
shared products across zero in opposite order; a cancellation or the sweep
crossing zero on one offer of a product while the seller changes another
offer of it; a shop suspended against such a writer; and staff merging two
brands against a checkout crossing zero on two of their products.
Each loser rolls back whole and reads "nothing was saved, try again".
A backlog of more than 200 expired orders takes more than one run to clear.

## 47. Counting a product a location does not list is its own function

**Context.** A worker who found units of a product on a shelf the system does
not list there had no way to say so. `wms_adjust_stock` with the screen's 0
looked like it, but it creates a shop's first units of a product in a
warehouse out of a count, two such saves at the same moment add up (no row to
wait on), and a location that lists a product only through an open pick
passes as empty.

**Decision.** (migration 084500) `wms_count_into_location` counts 1 to 10 000
units of one shop's variant onto a switched-on shelf, pick, returns or
receiving location that lists nothing of it, only for a shop that already has
a stock record in that warehouse (`count_no_stock_record` otherwise: the
first units come in with a receipt), and leaves exactly what an upward
correction leaves. `wms_count_candidates` finds the product by code, barcode
or name for the screen. `wms_adjust_stock` is unchanged.

**Consequences.** A count never creates a shop's first units in a warehouse.
A location that lists the product when the save arrives refuses it
(`count_already_listed`): two saves at once end with one count, never the
sum. Short pick tasks are left as an upward correction leaves them.

## 48. Refunds booked together are announced once; "refund arrived" waits for the last

**Context.** An order cancelled because its parcels came back with nobody at
the door refunds the goods and the delivery fee as two refunds, and the
shopper got two "refund started" and two "refund arrived" messages, each
with part of the amount.

**Decision.** (migration 084600) Refunds of one order booked by one
transaction together with a delivery-fee refund are one group
(`private.refunds.booked_xact`). "Refund started" goes out once, on the fee's
event; "refund arrived" once, on the confirmation with the highest sequence
number (`private.refund_confirmations.seq`), when every refund of the group
is confirmed. Both name the total, the fee included. Refunds of different
orders are never grouped, also when one transaction books them (proved in
`175_refunds_across_streams`). Every other refund is announced alone.

**Consequences.** "Refund arrived" waits for the last refund of the group,
without a time limit: while the fee's refund is open (the gateway has not
confirmed, or it failed and finance has not recorded a transfer) nothing is
said about the goods either.

## 49. The cart's date for another shop's offer comes from the product page's function

**Context.** For a cart line that can no longer be bought the cart offers
another shop's offer of the same variant, without a date; the shopper app
asked for each product page to show one.

**Decision.** (migration 084600) `cart_alternatives` takes an optional
district and returns `promise`, computed by the same `delivery_estimate` call
with the offer's handling days that the product page uses. The function is
dropped and created again (arguments and columns change); a call with only
the offer ids answers as before plus a null `promise`. The web product page's
cache is keyed by the Costa Rica date and hour, so its date changes at
cutoffs and midnight together with the cart's.

**Consequences.** The cart and the product page give the same date at the same
moment. The apps of `717048f` keep working: they send only the offer ids.

## 50. The shopper app keeps what it shows and gives up on a read after 15 s; the other apps do not yet

**Context.** A refresh that failed replaced what the shopper app showed with
an error, and a read that never answered left a screen loading for ever.

**Decision.** In the shopper app a failed refresh keeps what is on screen
with a notice and «Intentar de nuevo»; a first read that fails still shows
the error. A read that has not answered in 15 s counts as failed and is not
retried by itself (`readTimeoutMs`, opt-in in `packages/expo-kit`, set only by
the shopper app).

**Consequences.** The seller, driver and warehouse apps still replace data
with an error and wait without limit. The limit must not be switched on there
before those apps keep their data: a refresh that gives up would then wipe
the screen.

## 51. The unpaid-order sweep cancels at most 200 orders a run

**Context.** The sweep held the stock rows of every expired order for its
whole run (about 2 ms an order); a checkout of one of those products waited
the whole run.

**Decision.** (migration 084400) At most 200 a run, the oldest first; the
five-minute schedule takes the rest.

**Consequences.** A checkout during a 1000-order backlog waited 1666 ms before
and about 230 ms after (local machine). A larger backlog clears over several
runs, five minutes apart.

## 52. Shelf rows left at 0 units stay

**Context.** A move, a pick or a correction that empties a shelf leaves its
`bin_stock` row at 0 units; nothing deletes such rows, and the hosted check
of wave 7 found two.

**Decision.** They stay. `174_zero_unit_shelf_rows` compares a location with a
0-unit row against one with no row through every reader and writer of
`bin_stock` (the location page and list, the console list, the product
lookup, the count and its lookup, corrections, moves, the shelf ranking of
picks, renaming, switching off and on, the conservation check) and finds
them the same. Removing them would need redefinitions of the move, the pick
and the correction and a clean-up statement, for a row that changes no
answer: the smaller safe change is none.

**Consequences.** Rows at 0 accumulate slowly (one per product and shelf ever
emptied). A reader added later must keep filtering on units above zero; the
suite fails if one of today's readers stops doing so.

## 53. A cancelled order says why from the reasons the database writes; staff's note stays internal

**Context.** An order the sweep cancelled read only "Cancelado"; the reason
was stored on the order but shown nowhere to the shopper.

**Decision.** The shop and the shopper app turn the reasons the database
writes itself (no payment in time, parcels came back, cancelled by the
shopper) into a notice on the order page and a line of its history, with
what the money does and what to do next (`packages/core` `cancellation.ts`;
a test keeps the sentences equal to the SQL). A reason staff typed is an
internal note: the shopper reads "Cancelamos este pedido" and is pointed to
Ayuda, and since 084600 `get_order` gives the shopper `cancel_reason` only
when it is one of the three sentences the database writes (null otherwise;
staff still read the note), so the note never reaches the shopper's phone.
When the parcels came back after a real attempt at the door, the notice says
only the products' money comes back and why the delivery fee stays, once.

**Consequences.** A new kind of cancellation the database writes needs its
words added there, or it reads as the generic one.

## 54. Back links and short links are 44 px tall without moving the layout

**Context.** The back links at the top of pages and "Presente un reclamo"
were 17 px tall on a phone, under the 44 px rule.

**Decision.** One `BackLink` in `packages/next-kit` and `touchLinkClass` in
`packages/ui`: the link is 44 px tall and a negative margin keeps its line,
so nothing on the page moves. `tools/e2e/touch-targets.cjs` lists every other
control under 44 px outside running text on the main pages of the four web
apps; what it found is 44 px too (footer, category bar, home figures, the
product page's breadcrumb, the account's "Agregar una dirección", the seller
centre's price and notification links, the console's order-status links,
the driver's "No se pudo entregar"). A link stretched over its card (the
shop's product cards) is measured as the card, which is its target.

**Consequences.** A link inside a sentence is still as tall as its line, as
the accessibility rules allow.
