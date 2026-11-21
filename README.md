# Yuntera

Marketplace, fulfilment and last-mile delivery platform for Costa Rica.

Local sellers list products. They ship orders themselves or store stock in
Yuntera warehouses. Yuntera drivers deliver, starting in the Gran Área
Metropolitana. Shoppers pay with SINPE Móvil, card or cash on delivery and get
an electronic invoice.

> Status: pre-launch foundation. See [`STATUS.md`](STATUS.md) for what is built,
> what is verified, and what still needs the owner.

## What is in this repository

```
apps/
  web/         Yuntera           shopper storefront
  seller/      Yuntera Vende     seller centre
  ops/         Yuntera Central   internal console, on its own origin
  field/       Yuntera Ruta      drivers' routes and deliveries   (/ruta)
               Yuntera Bodega    warehouse picking and receiving  (/bodega)
packages/
  brand/       name, app family, design tokens, logo — the only place the brand is defined
  core/        domain logic: money and IVA, fees, offer selection, search ranking,
               sourcing, delivery promise, routing, risk, seller score
  db/          typed client for the database's API, payload schemas, error messages
  ui/          shared React components
  next-kit/    what every web app shares: session, security headers, forms, shell
supabase/      migrations, row-level security, seed data, database tests
tools/
  dev-api/     local stand-in for the Supabase API, for development and tests
  e2e/         browser journeys for the four apps
docs/          strategy, product, architecture, data, algorithms, security,
               operations, deployment, brand
```

All four apps are Next.js. The drivers' and warehouse app is an installable web
app rather than a native one; [`docs/02-architecture/decisions.md`](docs/02-architecture/decisions.md)
says why and what that costs.

## Getting started

Requires Node 22+, pnpm 10 and PostgreSQL 16.

```bash
pnpm install
```

```bash
pnpm db:local:up
```

```bash
pnpm db:local:reset
```

Start the local API (leave it running):

```bash
pnpm --filter @yuntera/dev-api start
```

Copy each app's settings once:

```bash
for app in web seller ops field; do cp apps/$app/.env.example apps/$app/.env.local; done
```

Then run the apps:

```bash
pnpm dev
```

| App           | Address               | Demo account (password `yuntera-local-dev`) |
| ------------- | --------------------- | ------------------------------------------- |
| Shop          | http://localhost:3000 | `comprador@yuntera.example`                 |
| Seller centre | http://localhost:3001 | `vendedor@yuntera.example`                  |
| Console       | http://localhost:3002 | `central@yuntera.example`                   |
| Routes        | http://localhost:3003 | `repartidor@yuntera.example`                |
| Warehouse     | http://localhost:3003 | `bodega@yuntera.example`                    |

The demo accounts and their password exist only in the local seed data.

| Command                     | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `pnpm ci`                   | Lint, typecheck, unit tests and production builds               |
| `pnpm test`                 | Unit tests for every package                                    |
| `pnpm lint` / `pnpm format` | Check / fix formatting and lint rules (Biome)                   |
| `pnpm db:local:reset`       | Rebuild the local database from migrations and seed data        |
| `pnpm db:local:test`        | Run the database tests, including the access-control checks     |
| `pnpm e2e`                  | Browser journeys for all four apps ([how](tools/e2e/README.md)) |

## Where to read next

- [`docs/README.md`](docs/README.md) — index of the plan and architecture
- [`docs/brand/naming.md`](docs/brand/naming.md) — why the product is called Yuntera
- [`docs/07-deployment/runbook-first-deploy.md`](docs/07-deployment/runbook-first-deploy.md) — how to put it live
- [`docs/02-architecture/overview.md`](docs/02-architecture/overview.md) — how the system fits together
