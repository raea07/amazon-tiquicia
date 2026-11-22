# Architecture decisions

Short records of the decisions that shape the system: what the situation was,
what was decided, and what follows from it — including what it costs. A
decision here can be reversed, but reversing it should be a conscious act with
its own entry, not something that happens by drift.

| #   | Decision                                                                                                                                            | State                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | [Database functions are the public API](#1-database-functions-are-the-public-api)                                                                   | Built                                    |
| 2   | [No privileged key in any app; staff are ordinary users](#2-no-privileged-key-in-any-app-staff-are-ordinary-users)                                  | Built                                    |
| 3   | [A local stand-in for the Supabase API](#3-a-local-stand-in-for-the-supabase-api)                                                                   | Built; real Supabase untested            |
| 4   | [One mobile web app for drivers and warehouse; native apps deferred](#4-one-mobile-web-app-for-drivers-and-warehouse-native-apps-deferred)          | Decided; app not built yet               |
| 5   | [The driver never sees the delivery PIN](#5-the-driver-never-sees-the-delivery-pin)                                                                 | Built                                    |
| 6   | [Cache Components: shared catalogue cached, personal content streamed](#6-cache-components-shared-catalogue-cached-personal-content-streamed)       | Built                                    |
| 7   | [A static Content-Security-Policy with unsafe-inline scripts](#7-a-static-content-security-policy-with-unsafe-inline-scripts)                       | Built; known trade-off                   |
| 8   | [Money is an integer count of céntimos](#8-money-is-an-integer-count-of-céntimos)                                                                   | Built                                    |
| 9   | [A double-entry ledger](#9-a-double-entry-ledger)                                                                                                   | Built                                    |
| 10  | [An append-only stock ledger, with reservation when the order is placed](#10-an-append-only-stock-ledger-with-reservation-when-the-order-is-placed) | Built                                    |
| 11  | [Idempotency keys on order placement](#11-idempotency-keys-on-order-placement)                                                                      | Built                                    |
| 12  | [Outbox events for work outside the transaction](#12-outbox-events-for-work-outside-the-transaction)                                                | Writer built; no consumer                |
| 13  | [Own-fleet delivery with a PIN as proof](#13-own-fleet-delivery-with-a-pin-as-proof)                                                                | Built in software; operation not started |
| 14  | [The name lives in one file](#14-the-name-lives-in-one-file)                                                                                        | Built                                    |
| 15  | [Fees regrounded on published gateway costs](#15-fees-regrounded-on-published-gateway-costs)                                                        | Built; amounts are assumptions           |
| 16  | [No cloud resources created without the owner](#16-no-cloud-resources-created-without-the-owner)                                                    | Standing                                 |
| 17  | [Native styling: plain StyleSheet with tokens from the brand package](#17-native-styling-plain-stylesheet-with-tokens-from-the-brand-package)       | Built                                    |
| 18  | [The session lives in the phone's secure store alone](#18-the-session-lives-in-the-phones-secure-store-alone)                                       | Built; unverified on a device            |
| 19  | [A darker field outline in the native apps than on the web](#19-a-darker-field-outline-in-the-native-apps-than-on-the-web)                          | Built                                    |
| 20  | [The native apps' store identifiers use com.yuntera](#20-the-native-apps-store-identifiers-use-comyuntera)                                          | Decided by the owner                     |
| 21  | [The brand package does not declare React](#21-the-brand-package-does-not-declare-react)                                                            | Built                                    |
| 22  | [Notifications run outside the apps, with their own key](#22-notifications-run-outside-the-apps-with-their-own-key)                                 | Built; not deployed                      |
| 23  | [A per-request check, and the second factor in the database](#23-a-per-request-check-and-the-second-factor-in-the-database)                         | Built; applied to the preview            |
| 24  | [Deleting an account anonymises; the sign-in record stays](#24-deleting-an-account-anonymises-the-sign-in-record-stays)                             | Built; applied to the preview            |
| 25  | [Photos in two buckets, published by re-encoding](#25-photos-in-two-buckets-published-by-re-encoding)                                               | Built; applied to the preview            |
| 26  | [One register for every refund](#26-one-register-for-every-refund)                                                                                  | Built; not on the preview yet            |
| 27  | [Limits are per account and per target, never per address](#27-limits-are-per-account-and-per-target-never-per-address)                             | Built; not on the preview yet            |
| 28  | [A driver's offline day in ordinary app storage, kept small and short](#28-a-drivers-offline-day-in-ordinary-app-storage-kept-small-and-short)      | Built; unverified on a device            |
| 29  | [The staff apps ask for the second factor themselves](#29-the-staff-apps-ask-for-the-second-factor-themselves)                                      | Built; hosted project untested           |

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
  (`private.outbox_jobs`), so other consumers (invoices, a search indexer) can
  attach without touching it. It sends nothing for real until the owner sets
  up the messaging provider.
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
  signs in, positions after 5 minutes and other entries after 36 hours (they
  are then shown as not sent).
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
