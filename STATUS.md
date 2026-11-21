# Status

Written 21 November 2026, at the end of the first build session. This is the
honest state of the project: what exists, how far it was checked, and what only
the owner can do.

## In one paragraph

Yuntera is a marketplace with its own warehouse and delivery, designed for
Costa Rica. The whole product works on a development machine: a shopper can
search, buy and pay; a seller can register, list, stock and pack; staff can
verify sellers, review products, plan routes, settle cash and refund returns;
a driver can deliver against the customer's code; a warehouse worker can pick,
pack and receive. **Nothing is deployed and no cloud resource was created.**
Everything was verified against a local PostgreSQL and a local stand-in for the
Supabase API — never against a real Supabase project.

## What needs you

In the order that unblocks the most.

1. **Decide where the database lives.** Your Supabase organisation is on a paid
   plan, so a new project there is billed (about US$10 a month on top of the
   plan, by Supabase's published pricing). The alternative is a separate free
   organisation. I created nothing while you were away because either choice
   spends your money or creates an account in your name. Once you choose,
   [`docs/07-deployment/runbook-first-deploy.md`](docs/07-deployment/runbook-first-deploy.md)
   is the step-by-step, and I can run it with you.
2. **Confirm the name before spending on it.** `yuntera.com` and `yuntera.app`
   were available and `yuntera.cr` did not resolve when checked; none has been
   bought. The checks cover domains, app stores and visible web presence. They
   are **not** a trademark search: that has to be done at the Registro Nacional
   before the name is used in public. Details and runner-up names are in
   [`docs/brand/naming.md`](docs/brand/naming.md). The name lives in one file
   (`packages/brand/src/brand.ts`), so changing it is cheap.
3. **Have a Costa Rican lawyer and an accountant read the compliance
   documents.** They were written from public sources by an AI, not by a
   professional: consumer law, electronic invoicing, IVA on a marketplace,
   data protection, and how drivers are engaged. See
   [`docs/05-security-compliance/`](docs/05-security-compliance/) and the open
   questions in [`docs/08-open-questions.md`](docs/08-open-questions.md).
4. **Open a pull request for this branch** (`claude/vigilant-edison-lh64v2`)
   when you want it on `main`. I did not open one because you had not asked.
   The CI workflow will run for the first time then; its steps were run by hand
   here but it has never run on GitHub.
5. **Business set-up that only you can do:** the legal entity and its
   registration with Hacienda, a payment gateway contract (cards and SINPE
   Móvil), the electronic-invoicing provider, a bank account, and the support
   mailboxes the screens mention (`ayuda@yuntera.cr` does not exist yet).

## What is built

| Part                 | Where                             | What it does                                                                                                                                                                                                                              |
| -------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop                 | `apps/web`                        | Home, search with typo tolerance, categories, product pages with competing offers and a delivery date, cart, checkout with SINPE Móvil, card or cash on delivery, orders with tracking and delivery code, returns, reviews, account, help |
| Seller centre        | `apps/seller`                     | Shop registration, listings with an itemised fee preview, prices, stock at the seller's own location, stock sent to the warehouse, packing, per-order statements                                                                          |
| Internal console     | `apps/ops`                        | Daily queues, orders, manual confirmation of transfers, route planning and dispatch, cash settlement, returns and refunds, complaints, content reports, product review, seller verification, drivers, audit trail                         |
| Routes and warehouse | `apps/field`                      | Driver: the day's route, navigation links, delivery against the customer's code, cash, failed deliveries, position sharing. Warehouse: pick lists with scan check, packing, receiving, stock lookup                                       |
| Database             | `supabase/`                       | 19 migrations, 58 tables, 77 API functions, row-level security on every table, double-entry ledger, stock ledger, the 494 districts of Costa Rica with delivery zones, demo data                                                          |
| Domain logic         | `packages/core`                   | Money and IVA, fees, featured-offer choice, search ranking, sourcing, delivery promise, routing, risk scoring, seller score, Costa Rican identifiers, phones and Plus Codes                                                               |
| Shared code          | `packages/{brand,ui,db,next-kit}` | Brand tokens and logo, components, the typed API client with a message for every error, and what all apps share (session, security headers, forms)                                                                                        |
| Documentation        | `docs/`                           | Strategy, product scope, architecture and decisions, data model, access control, API reference, one document per algorithm, security and compliance, operations, deployment runbook and go-live checklist                                 |
| Brand                | `docs/brand/`, `packages/brand/`  | Naming report, brand book ([published page](https://claude.ai/artifact/MJv6X1GarCNg1sZfuGjxfT), private to you until you share it; text in `docs/brand/brand-book.md`), logo files                                                        |

## How it was checked

| Check              | Result                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests         | 237 pass (core 192, brand 19, API client 14, shared web code 12)                                                                        |
| Database tests     | 8 files pass on PostgreSQL 16: access control per role, checkout, money, fulfilment, search, delivery promise, the API, the back office |
| API contract tests | 13 pass: every screen's payload, called as each role, matches the types the apps use                                                    |
| Browser journeys   | 4 pass in Chromium, each on a freshly seeded database: shopper, seller, staff, driver and warehouse (`pnpm e2e`)                        |
| Lint and types     | Clean across the workspace                                                                                                              |

What these checks do **not** cover, stated plainly:

- **No real Supabase.** Sign-in, sessions and function calls went through
  `tools/dev-api`, a local program that imitates the parts of Supabase the apps
  use. The real service will differ in details (e-mail confirmation, rate
  limits, token refresh timing). Expect a day of fixes on first contact.
- **No real money, messages or invoices.** Payments are in sandbox mode; no
  gateway, e-mail, SMS, WhatsApp or electronic-invoicing provider is connected.
- **No real phones.** The drivers' app was tested in a phone-sized desktop
  browser with a simulated location.
- **No load testing**, no security review by a third party.

## Not built

These are missing, not hidden. The first group blocks a public launch.

**Before launch**

- Payment gateway integration (cards, SINPE Móvil confirmation by webhook).
  Today finance confirms transfers by hand in the console and cards cannot be
  charged.
- Electronic invoices to Hacienda. The data model and the events exist; nothing
  sends them.
- Notifications. Events are recorded for e-mail and messaging; nothing delivers
  them, so a shopper is not told when an order ships.
- Password reset and e-mail confirmation screens.
- A second factor for staff sign-in. The database can require it
  (`require_staff_mfa`); the console has no screen to enrol or enter it.
- Product photos. Listings use placeholder drawings; there is no upload.
- Screens to add staff, drivers and warehouse workers. Today that is done with
  SQL; the runbook has the statements.
- Payouts to sellers. What is owed is computed and shown; paying it and
  recording the payment is not built.

**Later**

- English. The interface is Spanish only; error messages already exist in both.
- Native apps, background location and offline use for drivers; camera barcode
  scanning (a hand scanner works).
- Sponsored listings, promotions and coupons, a map on the dispatch screen,
  seller-side editing of listings after review, bulk listing upload.

## Decisions I made for you

Each is recorded with its reasoning in
[`docs/02-architecture/decisions.md`](docs/02-architecture/decisions.md). The
ones worth knowing about:

- **The name Yuntera**, pending the trademark search.
- **One PostgreSQL database with the business rules inside it.** The apps call
  database functions; they hold no privileged key. Suited to one or two people;
  the document says what would make this the wrong choice and when.
- **A web app for drivers and the warehouse instead of native apps.** It works
  on any phone today and I could verify it; native builds I could not. The cost
  is no background location and no offline mode.
- **Own drivers and a delivery code.** The customer's 4-digit code is checked
  on the server and is never shown to the driver or to staff.
- **Fees are assumptions.** Commission by category, warehouse fee by size and
  payment costs passed through at cost. The numbers come from public research
  on local gateways and are labelled as assumptions everywhere they appear.
- **No billable cloud resources and no pull request without your say-so.**

## Things to know before trusting the numbers

Found while building or reviewing; none is fixed by pretending otherwise.

- The fixed part of a payment fee is charged once per seller in an order, not
  once per payment. On an order with three sellers the platform recovers it
  three times.
- A refund returns the commission to the seller but not the payment and
  warehouse fees. That is a policy choice I made; confirm or change it.
- Stock is added up across locations when shown, but a line of an order must
  ship from one location. Two locations with one unit each can show "2
  available" and refuse an order for two.
- Unit economics, launch thresholds and data-retention periods in the strategy
  documents are estimates and say so.
- An unknown product address returns the "not found" page with HTTP 200, not
  404, because of how pages are streamed. Fine for people; worth fixing for
  search engines.

## Running it

[`README.md`](README.md) has the commands and the demo accounts. Five minutes
from a clean checkout to all four apps running locally.
