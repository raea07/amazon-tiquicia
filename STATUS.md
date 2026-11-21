# Status

Updated 21 November 2026, after people management, seller payouts, the fixes
to known limitations and the native apps were added. This is the honest state
of the project: what exists, how far it was checked, and what only the owner
can do.

## In one paragraph

Yuntera is a marketplace with its own warehouse and delivery, designed for
Costa Rica. The whole product works on a development machine: a shopper can
search, buy and pay; a seller can register, list, edit listings, stock, pack
and see what they will be paid; staff can verify sellers, review products and
listing edits, add staff, drivers and warehouse workers, plan routes, settle
cash, refund returns and pay sellers; a driver can deliver against the
customer's code; a warehouse worker can pick, pack and receive. **A hosted
preview exists.** The database is a Supabase project in your separate free
organisation, with all 22 migrations applied and the demo data loaded. The
four web apps are deployed as a preview on Vercel at
`yuntera-web`, `yuntera-vende`, `yuntera-central` and `yuntera-campo` (each
`.vercel.app`); every address is behind a Vercel login, and the projects are
not connected to the Git repository. A shopper app for iOS and Android exists
with every shopping flow of the website, and the seller, driver and warehouse
apps exist as skeletons; none has been built into an installable app or run on
a phone yet. Payments, messages and invoices are still simulated or missing
(see "Not built").

## What needs you

In the order that unblocks the most.

1. **Register `yuntera.cr` and do the trademark search.** `yuntera.com` and
   `yuntera.app` were bought on 21 November 2026 through your Vercel team
   (registrant: Astra Vier Solutions; auto-renew on; US$12.03 and US$9.99 for
   the first year). `yuntera.cr` cannot be bought there: register it at NIC
   Costa Rica or a reseller. The availability checks are **not** a trademark
   search; that has to be done at the Registro Nacional before the name is used
   in public. Details are in [`docs/brand/naming.md`](docs/brand/naming.md).
2. **Have a Costa Rican lawyer and an accountant read the compliance
   documents.** They were written from public sources by an AI, not by a
   professional: consumer law, electronic invoicing, IVA on a marketplace,
   data protection, and how drivers are engaged. See
   [`docs/05-security-compliance/`](docs/05-security-compliance/) and the open
   questions in [`docs/08-open-questions.md`](docs/08-open-questions.md). The
   four research notes in [`docs/research/`](docs/research/) were fact-checked
   on 21 November 2026 and add these questions for them:
   1. The central bank caps what a card acquirer may take from a merchant on
      Costa Rican cards at 1.95%, but the gateways' published card prices
      (3.9% + US$0.35 and 4.25% + US$0.35) are above it. The card cost in the
      fee schedule is therefore an assumption.
   2. Collecting shoppers' money and paying sellers out may require
      registration with the financial supervisor (SUGEF) above a volume the
      press puts at about US$400,000 in 12 months.
   3. Strong customer authentication (3-D Secure) is required for online
      payments with Costa Rican cards.
   4. Whether a platform seller report was already due for 2025.
   5. Store accounts in the company's name need a legal
      entity, a D-U-N-S number, a public website and a work e-mail on the
      company's own domain.
3. **Open a pull request for this branch** (`claude/vigilant-edison-lh64v2`)
   when you want it on `main`. I did not open one because you had not asked.
   The CI workflow will run for the first time then; its steps were run by hand
   here but it has never run on GitHub.
4. **Business set-up that only you can do:** the legal entity and its
   registration with Hacienda, a payment gateway contract (cards and SINPE
   Móvil), the electronic-invoicing provider, a bank account, and the support
   mailboxes the screens mention (`ayuda@yuntera.cr` does not exist yet).
5. **Know what the preview costs.** The Vercel projects are on your Pro plan,
   which bills by use. The Supabase project is in the free organisation.
6. **Before the native apps go to a store:**
   1. Confirm the four store identifiers before the first upload, because they
      can never change afterwards: `cr.yuntera.shop`, `cr.yuntera.vende`
      (newly chosen for the seller app), `cr.yuntera.ruta` and
      `cr.yuntera.bodega`, with `.dev` and `.preview` for test builds.
   2. Answer Apple's export-compliance question. The apps encrypt the saved
      session with AES (`aes-js`), so whether that is exempt needs your or an
      adviser's answer; the setting (`usesNonExemptEncryption`) is left unset.
   3. Publish a privacy policy at a public address, and an account-deletion
      page plus a way to delete the account in each app. Both stores require
      them at the first submission; neither exists yet.
   4. Decide whether the four apps keep one shared icon, as the brand book
      says today, or get icons that tell them apart in the store.
   5. An Apple Developer Program membership (US$99 a year) for any iOS build on
      a phone, TestFlight or the App Store, and a Google Play Console account
      (US$25). Demo accounts on the hosted project for the stores' reviewers.

## What is built

| Part                 | Where                                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop                 | `apps/web`                           | Home, search with typo tolerance, categories, product pages with competing offers and a delivery date, cart, checkout with SINPE Móvil, card or cash on delivery, orders with tracking and delivery code, returns, reviews, account, help. An unknown product or category address answers "not found" (404)                                                                                                                                                                                                                                                          |
| Seller centre        | `apps/seller`                        | Shop registration, listings with an itemised fee preview, editing a listing (changes to a published one wait for review), prices, stock, stock sent to the warehouse, packing, per-order statements, what is available, pending and on its way to the bank, and a request to change the payout account                                                                                                                                                                                                                                                               |
| Internal console     | `apps/ops`                           | Daily queues, orders, manual confirmation of transfers, route planning and dispatch, cash settlement, returns and refunds, complaints, content reports, product and listing-edit review, seller verification, staff, drivers, warehouse workers, payout account approvals, payout runs, audit trail                                                                                                                                                                                                                                                                  |
| Routes and warehouse | `apps/field`                         | Driver: the day's route, navigation links, delivery against the customer's code, cash, failed deliveries, position sharing. Warehouse: pick lists with scan check, packing, receiving, stock lookup                                                                                                                                                                                                                                                                                                                                                                  |
| Database             | `supabase/`                          | 22 migrations, 61 tables, 101 API functions, row-level security on every table, double-entry ledger, stock ledger, the 494 districts of Costa Rica with delivery zones, demo data                                                                                                                                                                                                                                                                                                                                                                                    |
| Domain logic         | `packages/core`                      | Money and IVA, fees, featured-offer choice, search ranking, sourcing, delivery promise, routing, risk scoring, seller score, Costa Rican identifiers, IBANs, phones and Plus Codes                                                                                                                                                                                                                                                                                                                                                                                   |
| Native apps          | `apps/*-native`, `packages/expo-kit` | Expo SDK 58. The shopper app (`apps/shop-native`) has every shopper flow of the website laid out for a phone: browse, search, product, cart, sign-in, checkout, payment (simulated), delivery code, orders, cancellation, returns, reviews, addresses, account, help. The seller, driver and warehouse apps are skeletons: sign-in, a screen for an account without access, and a home screen gated by role that reads real data. `packages/expo-kit` is what all four share: configuration, the session encrypted on the phone, the typed API, theme and components |
| Shared code          | `packages/{brand,ui,db,next-kit}`    | Brand tokens and logo, components, the typed API client with a message for every error, and what all apps share (session, security headers, forms)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Documentation        | `docs/`                              | Strategy, product scope, architecture and decisions, data model, access control, API reference, one document per algorithm, security and compliance, operations, deployment runbook and go-live checklist, research notes for the next phase                                                                                                                                                                                                                                                                                                                         |
| Brand                | `docs/brand/`, `packages/brand/`     | Naming report, brand book ([published page](https://claude.ai/artifact/MJv6X1GarCNg1sZfuGjxfT), private to you until you share it; text in `docs/brand/brand-book.md`), logo files                                                                                                                                                                                                                                                                                                                                                                                   |

How the new parts work, in short:

- **Paying sellers.** What a shop is owed comes from the ledger and is split
  three ways: _pending_ (on orders not delivered, or delivered fewer than 10
  days ago), _in transit_ (in a payout run, not yet confirmed) and _available_.
  Finance previews a cut-off date, creates a payout run, makes the transfers
  by hand from the list the console gives (there is no bank connection), and
  marks each payout paid with the bank's reference, or failed. Shops below
  ₡5,000, suspended, or without a valid account are left out and told why.
- **Payout accounts.** A seller cannot change the payout account directly: they
  ask, and finance approves after checking. Nobody approves their own request
  or one for a shop they belong to.
- **Fees on an order from several sellers.** The fixed part of the payment fee
  (₡180 on a card) is charged once per order and shared between the sellers in
  proportion to what each sold.
- **Stock in several places.** One order line can be filled from several
  locations of the same offer; each location sends its own parcel.

## How it was checked

On a development machine, on one freshly seeded database, after the last
change:

| Check                | Result                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests           | 430 pass (core 239, brand 21, API client 14, shared web code 22, native kit 123, shopper app 11)                                                                                                                                                                                                                                                                                                      |
| Database tests       | 11 files pass on PostgreSQL 16: access control per role, checkout, money, fulfilment, search, delivery promise, the API, the back office, people and payouts, the fixes, and one order from three sellers paid out end to end                                                                                                                                                                         |
| API contract tests   | 32 pass: every screen's payload, called as each role, matches the types the apps use                                                                                                                                                                                                                                                                                                                  |
| Browser journeys     | 8 pass in Chromium on a freshly seeded database: shopper, seller, staff, driver and warehouse, people, payouts, listing edits, and the shop's 404 answers (`pnpm e2e`)                                                                                                                                                                                                                                |
| Native journeys      | 2 pass (48 checks) through the web export of the native apps, in Chromium at phone size on a freshly seeded database: the shopper app from a product opened by link, through search, cart, sign-in, SINPE Móvil and the delivery code, to signing out; the seller, driver and warehouse apps for a visitor, an account without access and the right account, including signing out with no connection |
| Native configuration | For each of the four apps: Expo's configuration resolves, package versions match Expo SDK 58, `expo-doctor` passes 20 of 20 checks, and the iOS and Android bundles build with only React 19.3.0 in them. The resolved iOS settings were checked in the development, preview and store variants: every permission text in Spanish, no microphone or motion permission, plain HTTP only in development |
| Lint and types       | No lint errors (warnings only) and no type errors across the workspace                                                                                                                                                                                                                                                                                                                                |

On the hosted preview (before today's two migrations): sign-in, sign-up and
the 8 database test files that existed then passed on the real Supabase
platform, with no difference in access control between local and hosted.
E-mail confirmation is switched off on the preview, because the apps have no
confirmation or password-reset screens yet.

What these checks do **not** cover, stated plainly:

- **The hosted preview was smoke-tested, not exhaustively tested.** On
  21 November 2026 all 11 database test suites passed on the hosted project,
  and a browser test of the deployed apps covered shopping, paying (simulated),
  picking, packing, routing and delivering one order, plus the screens added
  that day. Not tried there: a staff role other than administrator (the demo
  data has only an administrator), creating a payout run, and a real phone.
- **No real money, messages or invoices.** Payments are in sandbox mode; no
  gateway, e-mail, SMS, WhatsApp or electronic-invoicing provider is connected.
  Payouts are bank transfers made by hand; the list the console produces is not
  any bank's upload format.
- **No real phones.** The drivers' app was tested in a phone-sized desktop
  browser with a simulated location.
- **The native apps have never been built or run on a phone.** Their web
  export proves the screens, the navigation, the Spanish text and the API
  calls, including a full purchase in the shopper app. It does **not** prove
  that the iOS and Android apps start, nor the secure storage of the session,
  the embedded fonts, the permission prompts, location, the camera, or the
  gestures, keyboard and safe areas of a real phone. That stays unknown until
  a cloud build is installed on a phone or a simulator. The iOS settings
  (permission texts, no plain HTTP outside development builds) were read from
  Expo's resolved configuration, not from a built app.
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
- A bank connection for payouts. Transfers are made by hand and recorded in
  the console.

**Native apps** (the shopper app is complete; the rest is missing)

- The screens of the seller, driver and warehouse apps beyond sign-in and a
  home screen. Until then sellers, drivers and the warehouse use the web apps.
- Push notifications. The package is installed but switched off, and its
  permission and entitlement are removed on purpose until that work starts.
- Taking or uploading photos from the phone.
- Password reset and account deletion in the apps. Both stores require account
  deletion before the first submission; there is no database function for it
  yet.
- An offline queue for drivers, so a delivery confirmed without signal is sent
  later.
- Universal links (opening a yuntera.cr address in the app). No domain serves
  the files the phones check; the apps answer only addresses in their own
  schemes (`yuntera://`, `yuntera-ruta://` and so on), and those were not
  tested.

**Later**

- English. The interface is Spanish only; error messages already exist in both.
- Background location for drivers and camera barcode scanning (a hand scanner
  works in the web app).
- Sponsored listings, promotions and coupons, a map on the dispatch screen,
  bulk listing upload.

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
  is no background location and no offline mode. Native driver and warehouse
  apps now exist as skeletons; the web app stays what they use until those
  apps have screens and have run on a phone.
- **Native apps share one kit and the web's API.** The shopper app and the
  three skeletons use Expo, call the same database functions through the same
  typed client, and keep the session encrypted on the phone.
- **Own drivers and a delivery code.** The customer's 4-digit code is checked
  on the server and is never shown to the driver or to staff.
- **Fees are assumptions.** Commission by category, warehouse fee by size and
  payment costs passed through at cost. The numbers come from public research
  on local gateways and are labelled as assumptions everywhere they appear.
- **Sellers are paid 10 days after delivery, from ₡5,000.** Both are settings
  an administrator can change.
- **No billable cloud resources and no pull request without your say-so.**

## Things to know before trusting the numbers

Found while building or reviewing; none is fixed by pretending otherwise.

- A refund returns the commission to the seller but not the payment and
  warehouse fees. That is a policy choice I made; confirm or change it.
- Unit economics, launch thresholds and data-retention periods in the strategy
  documents are estimates and say so.
- Payout accounts that existed before today are not marked as approved by
  finance. They are refused only if the account number fails its check.
- A seller can no longer change the shop's contact phone or e-mail (finance
  calls that phone to confirm a change of payout account). They need a
  reviewed way to do it.
- The photos of a published listing can still be changed directly, without
  review. To be closed with the photo upload work.
- A package above the largest warehouse size (120 cm or 30 kg) gets no
  warehouse fee. It should be refused or priced.
- Another shopper's order page shows "not found" but answers with status 200
  rather than 404.
- A visitor can file any number of content reports, including about things that
  do not exist: there is no rate limit and no check that the target exists.
  This must be fixed before production.
- The shop refreshes its cached catalogue when a listing edit is approved or a
  listing is archived, through a key (`SHOP_REFRESH_KEY`) set to the same
  value on the shop, the seller centre and the console. It is set on the
  preview, but while the shop sits behind the Vercel login the request cannot
  reach it and is logged as an error; changes still appear within about a
  minute. It works once the shop is public.
- After a shopper chooses a delivery zone on a product page, the old date and
  shipping price stay on screen for a few seconds before the new ones replace
  them, with nothing showing that an update is on its way.

## Running it

[`README.md`](README.md) has the commands and the demo accounts. Five minutes
from a clean checkout to all four apps running locally.
