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
  web/         Yuntera          shopper storefront              (Next.js)
  seller/      Yuntera Vende    seller centre                   (Next.js)
  ops/         Yuntera Central  internal operations console     (Next.js)
  driver/      Yuntera Ruta     delivery driver app             (Expo)
  warehouse/   Yuntera Bodega   warehouse scanner app           (Expo)
packages/
  brand/       name, app family, design tokens, logo — the only place the brand is defined
  core/        domain logic: money and IVA, fees, offer selection, search ranking,
               sourcing, delivery promise, routing, risk, seller score
  db/          typed database client and generated types
  ui/          shared React components for the web apps
  i18n/        es-CR and en messages
supabase/      migrations, row-level security, seed data, database tests
docs/          strategy, product, architecture, security, operations, brand
```

## Getting started

Requires Node 22+, pnpm 10 and (for database work) PostgreSQL 16.

```bash
pnpm install
```

```bash
pnpm db:local:reset
```

```bash
pnpm dev
```

| Command                     | What it does                                                |
| --------------------------- | ----------------------------------------------------------- |
| `pnpm ci`                   | Everything CI runs: lint, typecheck, unit tests, build      |
| `pnpm test`                 | Unit tests for every package                                |
| `pnpm lint` / `pnpm format` | Check / fix formatting and lint rules (Biome)               |
| `pnpm db:local:reset`       | Rebuild a local database from migrations and seed data      |
| `pnpm db:local:test`        | Run the database tests, including row-level-security checks |

## Where to read next

- [`docs/README.md`](docs/README.md) — index of the plan and architecture
- [`docs/brand/naming.md`](docs/brand/naming.md) — why the product is called Yuntera
- [`docs/02-architecture/overview.md`](docs/02-architecture/overview.md) — how the system fits together
