# Repository guide

How the repository is laid out, which package may depend on which, the
commands that matter, how to run everything on a laptop from nothing, and what
each layer of tests actually proves.

## Layout

```
apps/
  web/        Yuntera — the shopper storefront (Next.js 16). Built.
  seller/     Yuntera Vende — seller centre (Next.js). Built.
  ops/        Yuntera Central — internal console (Next.js). In progress.
  field/      Yuntera Ruta + Yuntera Bodega — one mobile web app. Planned.
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
  i18n/       Placeholder. Empty today; the apps render Spanish only.
supabase/
  migrations/ The database, in filename order. See docs/03-data.
  tests/      SQL test suites that run as real API roles.
  seed.sql    Demo data, created by calling the real functions as demo users.
  seed/       geo-cr.json: provinces, cantones, districts.
  scripts/    local-db.sh (build and test on plain PostgreSQL), local-shim.sql
              (what Supabase provides, for a plain PostgreSQL), gen-geo-migration.py.
tools/
  dev-api/    Local stand-in for the Supabase API. Loopback only. Never deployed.
docs/         This documentation.
```

The root `README.md` still lists `apps/driver` and `apps/warehouse` as separate
Expo apps. That was the earlier plan; the current one is `apps/field`
([decision 4](decisions.md#4-one-mobile-web-app-for-drivers-and-warehouse-native-apps-deferred)).

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
  apps["apps/*"] --> kit
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
| `packages/brand` imports nothing but React for the logo                                                                         | Renaming or restyling must never pull in business logic                                                           |
| `packages/db` knows function names, payload shapes and error codes, and nothing about HTTP or React                             | The same client works over supabase-js in an app and over a direct connection in a contract test (`RpcTransport`) |
| `packages/ui` has no data access                                                                                                | Components receive data; they do not fetch it                                                                     |
| Apps never import from another app                                                                                              | Shared code moves down into a package                                                                             |
| Nothing under `apps/` or `packages/` may import `tools/dev-api`, except `packages/db` as a dev dependency for its contract test | The stand-in must be impossible to ship                                                                           |
| No app or package reads a secret key                                                                                            | See [access control](../03-data/access-control.md)                                                                |

These rules are conventions today; no lint rule enforces import boundaries.

## Commands

Run from the repository root. Requires Node 22 or later and pnpm 10.

| Command                                | What it does                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm install`                         | Install every workspace's dependencies                                             |
| `pnpm lint`                            | Biome: lint and format check for the whole repository                              |
| `pnpm format`                          | Biome: apply fixes                                                                 |
| `pnpm typecheck`                       | TypeScript in every package and app                                                |
| `pnpm test`                            | Unit tests in every package (Vitest). No database needed                           |
| `pnpm build`                           | Build every app                                                                    |
| `pnpm ci`                              | `lint`, `typecheck`, `test`, `build`, in that order                                |
| `pnpm db:local:up`                     | Start the machine's PostgreSQL 16 if it is not running                             |
| `pnpm db:local:reset`                  | Drop and recreate the local database; apply the shim, every migration and the seed |
| `pnpm db:local:test`                   | Run every SQL test suite against the local database                                |
| `pnpm --filter @yuntera/dev-api start` | Start the local API stand-in on `127.0.0.1:54321`                                  |
| `pnpm --filter @yuntera/web dev`       | Start the storefront on `localhost:3000`                                           |
| `pnpm --filter @yuntera/brand tokens`  | Regenerate `tokens.css` from `tokens.ts`                                           |

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

4. Check it.

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

| Layer           | Where                                                                                | Runs with                                       | What it proves                                                                                                                                                                                                                                                                                                                                                                                       | What it does not                                               |
| --------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Unit tests      | `packages/core/src/**/*.test.ts`, `packages/brand`, `packages/db/src/errors.test.ts` | `pnpm test`                                     | The algorithms compute what they should, including edge cases; brand colours meet WCAG AA contrast; tokens and CSS are in sync                                                                                                                                                                                                                                                                       | Anything about the database                                    |
| Parity tests    | `packages/core/src/cr/compliance.test.ts`, `packages/db/src/errors.test.ts`          | `pnpm test`                                     | The constants and rules written in SQL are the same ones written in TypeScript; every error code has a message                                                                                                                                                                                                                                                                                       | That the SQL arithmetic is right (the next layer does)         |
| SQL suites      | `supabase/tests/010`–`070`                                                           | `pnpm db:local:test`                            | Run as real API roles with real claims: who can reach what (`020_access`), pricing, idempotency, reservation, cancellation and expiry (`030_checkout`), fees to the céntimo and a balanced ledger (`040_money`), pick, pack, route, PIN, cash and failures (`050_fulfillment`), accents, synonyms, typos and ranking (`060_search`), each screen function for the right and wrong caller (`070_api`) | Behaviour on the real Supabase platform                        |
| Contract tests  | `packages/db/src/contract.test.ts`                                                   | `DATABASE_URL=… pnpm --filter @yuntera/db test` | Real function responses match the client's schemas, per role                                                                                                                                                                                                                                                                                                                                         | UI behaviour                                                   |
| Browser journey | Run by hand with Playwright during development; not yet committed as a test          | —                                               | The storefront's purchase journey works in a real browser: search with a typo, product, cart, sign-in with return path, checkout, SINPE Móvil order, simulated payment, delivery PIN, order list, another shopper's order hidden, no horizontal overflow at phone width                                                                                                                              | Nothing automatically, until it is committed and wired into CI |

Each SQL suite runs inside a transaction that is rolled back, so the suites do
not affect each other or the seed data.

The local shim deliberately copies Supabase's permissive defaults — `anon` and
`authenticated` are granted everything on new tables in `public` — so that the
access tests prove the migrations' own revokes and policies are what protect
the data, rather than a stricter local setup hiding a mistake.

**Continuous integration is not set up yet.** The `.github/workflows` directory
is empty. The intended pipeline is `pnpm ci`, then a PostgreSQL service with
`db:local:reset` and `db:local:test`, then the contract tests, then the browser
journey.

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
