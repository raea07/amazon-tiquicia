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
- Work that genuinely needs to act without a user — a payment webhook, the
  outbox worker — will need a secret key held by server-side code. None exists
  yet; when it does it belongs in an Edge Function, never in an app bundle.

## 3. A local stand-in for the Supabase API

**Context.** The normal local setup is `supabase start`, which runs the real
PostgREST and Auth services in Docker. In the sandbox where this was built,
container images could not be pulled and release binaries could not be
downloaded. Without an HTTP API the apps could not be run or tested at all.

**Decision.** `tools/dev-api` is a small Node server that answers the two
things the apps ask of Supabase: function calls (`POST /rest/v1/rpc/<name>`)
and e-mail-and-password sessions (`/auth/v1/token`, `/signup`, `/user`,
`/logout`, plus a JWKS endpoint). It runs each call the way PostgREST does —
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
  for large sessions, e-mail confirmation flows (the stand-in confirms
  instantly), rate limits (it has none), refresh-token rotation (it keeps
  tokens in memory), and anything the platform pre-installs in the database.
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

## 5. The driver never sees the delivery PIN

**Context.** Each order has a four-digit PIN that the shopper reads to the
driver at the door. An earlier draft of the product scope asked for the PIN to
be verifiable on the phone without signal. That requires the PIN, or something
derived from it that can be brute-forced in ten thousand tries, to be on the
driver's device — which defeats its purpose as proof that the shopper was
present.

**Decision.** The PIN is checked only by the server. `driver_today` never
returns it; `driver_complete_stop` receives what the driver typed and compares
it in the database. After five wrong attempts the stop is locked. There is no
offline verification.

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
entries; none is stored. A refund is the original capture's entries, negated.

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

- The writer side is built and tested. **The worker is not built.** Until it
  is, no notification of any kind leaves the system.
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
