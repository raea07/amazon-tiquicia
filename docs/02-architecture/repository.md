# Repository guide

How the repository is laid out, which package may depend on which, the
commands that matter, how to run everything on a laptop from nothing, and what
each layer of tests actually proves.

## Layout

```
apps/
  web/        Yuntera — the shopper storefront (Next.js 16). Built.
  seller/     Yuntera Vende — seller centre (Next.js). Built.
  ops/        Yuntera Central — internal console (Next.js). Built.
  field/      Yuntera Ruta + Yuntera Bodega — one mobile web app. Built.
  shop-native/       Yuntera — the shopper app for iOS and Android (Expo SDK 58). Built.
  seller-native/     Yuntera Vende — seller app (Expo SDK 58). Built; not yet built for a phone.
  driver-native/     Yuntera Ruta — drivers' app, with position sharing and work
                     without signal (Expo SDK 58). Built; not yet built for a phone.
  warehouse-native/  Yuntera Bodega — warehouse app, with camera and hand-scanner
                     scanning and the check-in of returned parcels (Expo SDK 58).
                     Built; not yet built for a phone.
packages/
  brand/      Name, app family, design tokens, logo. The only place the brand is defined.
  core/       Domain logic as pure TypeScript: money, fees, offers, search ranking,
              sourcing, delivery promise, routing, risk, seller score, lifecycles,
              recommendations, Costa Rican formats and legal constants.
  db/         Typed client for the database functions: one method per function,
              a schema per payload, a message per error code.
  ui/         React components shared by the web apps: buttons, fields, alerts,
              prices, ratings, status badges.
  next-kit/   Plumbing shared by the Next.js apps: session client, sign-in helpers,
              security headers, fonts, form components. In progress.
  notifications/ The notification worker as web-standard TypeScript: templates for
              e-mail, WhatsApp, SMS and push (and the account e-mails' shared
              words), provider adapters, webhook checks, the worker loop.
  payments/   The payments worker and webhook receiver: a provider-neutral
              interface, the ONVO adapter, signature checks, the worker loop.
              Server-side only; no app imports it.
  invoicing/  Hacienda version 4.4 documents: XML, the clave, amounts, exclusive
              canonicalisation and XAdES-EPES signing with WebCrypto, the
              reception client and the worker loop. Server-side only; the
              shared web code imports only its readable-document helpers, never
              the signer, and no native app imports it.
  expo-kit/   What the native apps share: the app configuration with development,
              preview and store variants, the Supabase client with the session in
              the phone's secure store, sign-in with the second step, roles, the
              typed API, tokens derived from packages/brand, fonts, components,
              the data layer, product picture addresses (images), an offline
              queue and saved-answer cache (offline) and a barcode scanner for
              camera, typing and hand scanners (scanner).
  i18n/       Placeholder. Empty today; the apps render Spanish only.
supabase/
  migrations/ The database, in filename order. See docs/03-data.
  tests/      SQL test suites that run as real API roles.
  seed.sql    Demo data, created by calling the real functions as demo users.
  seed/       geo-cr.json: provinces, cantones, districts.
  scripts/    local-db.sh (build and test on plain PostgreSQL), local-shim.sql
              (what Supabase provides, for a plain PostgreSQL: roles, the Auth
              tables, a storage schema), gen-geo-migration.py, auth-config.sh
              (sign-in settings and e-mail templates for a hosted project),
              deploy-notifications.sh, deploy-payments.sh and deploy-invoicing.sh
              (the Edge Functions); none of the deploy scripts has been run.
  functions/  Edge Function entry points (notify-worker, bird-webhook, auth-email;
              payments-worker, payments-webhook; invoice-worker,
              hacienda-callback), thin Deno wrappers around packages/notifications,
              packages/payments and packages/invoicing.
  templates/  Auth's Spanish e-mail templates. auth/ holds the sign-in settings.
tools/
  dev-api/    Local stand-in for the Supabase API: function calls, Auth with a local
              mailbox, storage. Loopback only. Never deployed.
  dev-notify/ Fake e-mail, WhatsApp, SMS and push providers, a fake of the
              payment gateway (ONVO), and a host that runs the notification and
              payments functions against them. Local only.
  dev-hacienda/ A fake of Hacienda's identity provider and reception API, and a
              host that runs the invoice functions against it with a throwaway
              signing key. Local only.
  e2e/        Browser journeys for the four web apps (Playwright).
  native-e2e/ Browser journeys through the web export of the native apps, and the
              small static server that serves those exports.
  dev/        stack.sh (an isolated copy of the whole stack per numbered lane),
              native-icons.cjs (draws the native apps' icons from the brand geometry).
  races/      Two-session races against a lane's database (stock, offers,
              product summaries, parcels, counts; families A to I, natural and
              forced rounds). Not part of pnpm test; see its README.
docs/         This documentation.
```

Drivers and the warehouse work in `apps/field`
([decision 4](decisions.md#4-one-mobile-web-app-for-drivers-and-warehouse-native-apps-deferred)).
Their native apps have every flow of it, and the drivers' app adds work
without signal; `apps/field` stays what they use until a build of each has run
on a phone.

## Package boundaries

```mermaid
flowchart BT
  core["packages/core<br/>no dependencies"]
  brand["packages/brand<br/>no dependencies"]
  db["packages/db"] --> core
  ui["packages/ui"] --> core
  ui --> brand
  kit["packages/next-kit"] --> db
  kit --> ui
  kit --> brand
  expokit["packages/expo-kit"] --> db
  expokit --> core
  expokit --> brand
  native["apps/*-native"] --> expokit
  native --> db
  apps["apps/* (web)"] --> kit
  apps --> db
  apps --> ui
  apps --> core
  apps --> brand
  devapi["tools/dev-api<br/>test and local only"]
  db -. dev dependency .-> devapi
```

Rules, and the reason for each:

| Rule                                                                                                                            | Why                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/core` imports nothing: no framework, no database client, no clock it was not handed                                   | It is the specification. It must run in a unit test, a browser, a server and a phone identically                  |
| `packages/brand` imports nothing but React's types for the logo, and declares no React of its own                               | Renaming or restyling must never pull in business logic; the web and native apps each bring their own React       |
| `packages/ui` and `packages/next-kit` are for the web apps only; native apps use `packages/expo-kit`                            | They render HTML; the native apps render React Native views and use React 19.3.0, the web apps 19.3.1             |
| `packages/db` knows function names, payload shapes and error codes, and nothing about HTTP or React                             | The same client works over supabase-js in an app and over a direct connection in a contract test (`RpcTransport`) |
| `packages/ui` has no data access                                                                                                | Components receive data; they do not fetch it                                                                     |
| Apps never import from another app                                                                                              | Shared code moves down into a package                                                                             |
| Nothing under `apps/` or `packages/` may import `tools/dev-api`, except `packages/db` as a dev dependency for its contract test | The stand-in must be impossible to ship                                                                           |
| No app or package reads a secret key                                                                                            | See [access control](../03-data/access-control.md)                                                                |

These rules are conventions today; no lint rule enforces import boundaries.

## Commands

Run from the repository root. Requires Node 22 or later and pnpm 10.

| Command                                | What it does                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm install`                         | Install every workspace's dependencies                                                                    |
| `pnpm lint`                            | Biome: lint and format check for the whole repository                                                     |
| `pnpm format`                          | Biome: apply fixes                                                                                        |
| `pnpm typecheck`                       | TypeScript in every package and app                                                                       |
| `pnpm test`                            | Unit tests in every package (Vitest). No database needed                                                  |
| `pnpm build`                           | Build every app                                                                                           |
| `pnpm ci`                              | `lint`, `typecheck`, `test`, `build`, in that order                                                       |
| `pnpm db:local:up`                     | Start the machine's PostgreSQL 16 if it is not running                                                    |
| `pnpm db:local:reset`                  | Drop and recreate the local database; apply the shim, every migration and the seed                        |
| `pnpm db:local:test`                   | Run every SQL test suite against the local database                                                       |
| `pnpm --filter @yuntera/dev-api start` | Start the local API stand-in on `127.0.0.1:54321`                                                         |
| `pnpm --filter @yuntera/web dev`       | Start the storefront on `localhost:3000`                                                                  |
| `pnpm --filter @yuntera/brand tokens`  | Regenerate `tokens.css` from `tokens.ts`                                                                  |
| `tools/dev/stack.sh up [lane]`         | Database, API, every web app, the three workers (notifications, payments, invoices) and their three fakes |
| `tools/dev/stack.sh notify [lane]`     | Restart only the notification and payments workers, the fake providers and the fake gateway               |
| `tools/dev/stack.sh invoicing [lane]`  | Restart only the invoice worker and the fake of Hacienda                                                  |
| `tools/dev/stack.sh native [lane]`     | Export the native apps for the web and serve them on the lane's app ports + 10–13                         |
| `tools/dev/stack.sh native-e2e [lane]` | Run the native journeys against those exports                                                             |

Loose end: the root script `db:types` points at
`supabase/scripts/gen-types.sh`, which does not exist. The typed client in
`packages/db` is hand-written against the function payloads and checked by the
contract test, so nothing depends on generated types today.

## Run it locally from zero

You need PostgreSQL 16 with a superuser the script can use. By default it
expects `postgres://postgres:postgres@127.0.0.1:5432/postgres`; set
`PG_ADMIN_URL` to point elsewhere. The database it creates is `yuntera_local`
(`PG_DB_NAME` to change).

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Make sure PostgreSQL is running.

   ```bash
   pnpm db:local:up
   ```

3. Build the database: shim, migrations, seed.

   ```bash
   pnpm db:local:reset
   ```

4. Check it, with nothing else using that database (`140_invoicing` fails if
   an invoice worker, such as the one `tools/dev/stack.sh up` starts, takes
   the seed's jobs first).

   ```bash
   pnpm db:local:test
   ```

5. In a second terminal, start the API stand-in and leave it running.

   ```bash
   pnpm --filter @yuntera/dev-api start
   ```

6. Give the storefront its settings. Nothing in this file is secret.

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

7. Start the storefront.

   ```bash
   pnpm --filter @yuntera/web dev
   ```

Open `http://localhost:3000`. The seed creates demo accounts, all with the
local password `yuntera-local-dev`:

| Account                      | Role                                              |
| ---------------------------- | ------------------------------------------------- |
| `comprador@yuntera.example`  | Shopper with an address and order history         |
| `vendedor@yuntera.example`   | Seller: owns TecnoCasa and Ferretería El Higuerón |
| `bodega@yuntera.example`     | Warehouse associate                               |
| `repartidor@yuntera.example` | Delivery driver with a route today                |
| `central@yuntera.example`    | Internal staff, admin                             |

The seed leaves orders at every stage — delivered with reviews, out for
delivery, packed, waiting to be picked, waiting for a SINPE Móvil payment — so
each app has something to show.

**What the local setup does not do.** Unpaid orders do not expire on their own
(there is no scheduler; call `select private.expire_unpaid_orders()` by hand).
No e-mail is sent. Sign-up confirms the account instantly. If you have Docker,
`supabase start` gives you the real services instead of the stand-in; that path
has not been exercised with this repository yet.

### The seed is a smoke test

`supabase/seed.sql` does not insert orders into tables. It signs in as the demo
users and calls `place_order`, `confirm_sandbox_payment`, `wms_start_picking`,
`wms_confirm_pick`, `wms_pack_shipment`, `ops_create_route`,
`driver_complete_stop` and the rest, the way the apps do. If a migration breaks
the purchase or fulfilment flow, `pnpm db:local:reset` fails. The seed refuses
to run unless `payments_mode` is `sandbox`, and must never be applied to
production.

## Test layers

| Layer            | Where                                                                                                                                                                                                                                                                                                                                        | Runs with                                       | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | What it does not                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests       | `packages/core/src/**/*.test.ts`, `packages/brand`, `packages/db/src/errors.test.ts`, `packages/expo-kit/src/**/*.test.ts`, `apps/*-native/src/**/*.test.ts`                                                                                                                                                                                 | `pnpm test`                                     | The algorithms compute what they should, including edge cases; brand colours meet WCAG AA contrast; tokens and CSS are in sync; the kit's session storage, second step, offline queue (order, at most once, per account, restarts, removal) and scanner rules; each native app's own rules (the seller, driver and warehouse apps run theirs with Node's test runner through `tsx`)                                                                                                                             | Anything about the database                                                                                                                           |
| Parity tests     | `packages/core/src/cr/compliance.test.ts`, `packages/db/src/errors.test.ts`                                                                                                                                                                                                                                                                  | `pnpm test`                                     | The constants and rules written in SQL are the same ones written in TypeScript; every error code has a message                                                                                                                                                                                                                                                                                                                                                                                                  | That the SQL arithmetic is right (the next layer does)                                                                                                |
| SQL suites       | `supabase/tests/010`–`175`, 38 files                                                                                                                                                                                                                                                                                                         | `pnpm db:local:test`                            | Run as real API roles with real claims: who can reach what (`020_access`), pricing, idempotency, reservation, cancellation and expiry (`030_checkout`), fees to the céntimo and a balanced ledger (`040_money`), pick, pack, route, PIN, cash and failures (`050_fulfillment`), accents, synonyms, typos and ranking (`060_search`), each screen function for the right and wrong caller (`070_api`)                                                                                                            | Behaviour on the real Supabase platform                                                                                                               |
| Contract tests   | `packages/db/src/contract*.test.ts`, 32 files (races in two real sessions among them; the 100-round races are in `tools/races`)                                                                                                                                                                                                              | `DATABASE_URL=… pnpm --filter @yuntera/db test` | Real function responses match the client's schemas, per role                                                                                                                                                                                                                                                                                                                                                                                                                                                    | UI behaviour                                                                                                                                          |
| Browser journeys | `tools/e2e` (Playwright), 30 scripts, from shopper, seller, staff, driver and warehouse to limits, payments, invoicing, operations, order follow-ups and warehouse stock                                                                                                                                                                     | `pnpm e2e`                                      | The apps, the API and the database work together in a real browser, each from a freshly seeded database: purchase with SINPE Móvil and delivery code; seller registration, listing, stock and packing; payment confirmation, review, dispatch, refund; delivery with a wrong then right code, picking with a wrong then right scan                                                                                                                                                                              | Anything on a real Supabase project; real payments; real phones                                                                                       |
| Native journeys  | `tools/native-e2e` (Playwright), 17 scripts: `shop`, `seller`, `driver` and `warehouse` (each app's flows at phone size), `staff` (the right and wrong kinds of account for the three staff apps, and signing out offline), the account screens of each app, and the later parity, order follow-up, stock and logo journeys (see the README) | `tools/dev/stack.sh native-e2e [lane]`          | The native apps' screens, navigation, Spanish text, role gates and API calls work against the local API through their web export, including a full purchase and a return, a driver's day with a stretch without signal, a suspension that hands the route back and a delivery code locked and released, picking by scan, refused receipts and a returned parcel, a price below the fees and a seller's second step; `packages/expo-kit` unit tests also check each app's resolved iOS and Android configuration | That the binaries start, and anything that needs a phone: the secure store, embedded fonts, permissions, location in the background, camera, gestures |

Each SQL suite runs inside a transaction that is rolled back, so the suites do
not affect each other or the seed data.

The local shim deliberately copies Supabase's permissive defaults — `anon` and
`authenticated` are granted everything on new tables in `public` — so that the
access tests prove the migrations' own revokes and policies are what protect
the data, rather than a stricter local setup hiding a mistake.

**Continuous integration** is defined in `.github/workflows/ci.yml` and runs on
every pull request and every push to `main`, in three jobs. The first lints,
typechecks, runs the unit tests, builds the database from scratch on a
PostgreSQL service, and runs the database tests and the API contract tests.
The second builds every app, starts them against the local API stand-in and
runs the browser journeys in `tools/e2e`, keeping screenshots and logs
when one fails. The third checks the native apps: their configuration and
package versions against Expo SDK 58, the iOS and Android JavaScript bundles,
and the journeys in `tools/native-e2e` through the web export. It builds
no native binary. The workflow was written and its steps were run by hand
locally; it has not yet run on GitHub itself, so expect to adjust it on the
first pull request.

## Conventions

- **TypeScript** is strict, with `noUncheckedIndexedAccess`. `any`, non-null
  assertions and `dangerouslySetInnerHTML` are lint errors.
- **Formatting** is Biome's: two spaces, 100 columns, double quotes.
- **Migrations** are append-only once deployed. Before the first deployment
  they may still be edited in place; after it, every change is a new file. See
  the migrations policy in
  [operations](../07-deployment/operations.md#migrations-policy).
- **SQL functions** that are `security definer` set `search_path = ''` and
  schema-qualify every name. Errors go through `private.fail('code')`.
- **Comments** explain why, in plain language, for a reader who is not an
  engineer.
- **Interface copy** is Costa Rican Spanish in the _usted_ register.
