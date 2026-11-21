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
  shop-native/       Yuntera         shopper app for iOS and Android (Expo)
  seller-native/     Yuntera Vende   seller app (skeleton: sign-in and role-gated home)
  driver-native/     Yuntera Ruta    drivers' app (skeleton)
  warehouse-native/  Yuntera Bodega  warehouse app (skeleton)
packages/
  brand/       name, app family, design tokens, logo — the only place the brand is defined
  core/        domain logic: money and IVA, fees, offer selection, search ranking,
               sourcing, delivery promise, routing, risk, seller score
  db/          typed client for the database's API, payload schemas, error messages
  ui/          shared React components
  next-kit/    what every web app shares: session, security headers, forms, shell
  expo-kit/    what every native app shares: config, encrypted session, API, theme, components
supabase/      migrations, row-level security, seed data, database tests
tools/
  dev-api/     local stand-in for the Supabase API, for development and tests
  e2e/         browser journeys for the four apps
  native-e2e/  browser journeys through the web export of the native apps
docs/          strategy, product, architecture, data, algorithms, security,
               operations, deployment, brand
```

The four web apps are Next.js. The native apps (`apps/*-native`) are Expo SDK 58
apps that call the same database functions through `packages/db`; the research
behind them is [`docs/research/expo-native-apps.md`](docs/research/expo-native-apps.md).

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

## Running a native app during development

The native apps depend on native configuration that Expo Go cannot provide
(fonts embedded in the binary, the permission texts, background location for
drivers), so a phone runs a **development build**:
an installable copy of the app with Expo's developer menu, built once by EAS
(`eas build --profile development` in the app's directory, which needs the
owner's Expo account) and then fed JavaScript by your computer:

```bash
cp apps/shop-native/.env.example apps/shop-native/.env.local
```

```bash
pnpm --filter @yuntera/shop-native start
```

Scan the QR code with the development build installed on the phone.

Each app's `eas.json` also has `preview` (an installable copy that talks to
the preview API over HTTPS; an APK on Android) and `preview-simulator` (the
same for the iOS Simulator, which needs no Apple account). Both run without a
computer feeding them JavaScript.

### Building a preview in the cloud

Only the shopper app has an EAS project so far (its id is in
`apps/shop-native/app.config.ts`; the configuration is dynamic, so a new app's
id from `eas init` is copied there by hand). Its `preview` settings live in the
EAS `preview` environment, not in `.env.local`:
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`EXPO_PUBLIC_SHOP_URL`, all plain text (`eas env:list preview` shows them).
From `apps/shop-native`, with the owner's Expo account signed in:

```bash
npx eas-cli build -p android --profile preview --non-interactive --no-wait
```

```bash
npx eas-cli build -p ios --profile preview-simulator --non-interactive --no-wait
```

EAS uploads the whole repository (the files Git tracks, so `.env.local` never
leaves your computer), installs the Node and pnpm versions pinned in `eas.json`
and runs `pnpm install --frozen-lockfile` at the root. On the first Android
build without a terminal, EAS generates the signing keystore and keeps it in
the Expo account. Each build counts against the account's monthly allowance
(`npx eas-cli account:usage`). Expo's cloud simulators need a paid plan
(`npx eas-cli simulator:availability`).

While the shop's address is behind the Vercel login, the app cannot load
product pictures from it and shows a placeholder instead.

**A phone cannot reach `127.0.0.1`.** On the phone, `127.0.0.1` is the phone
itself, not your computer, so the local API at `http://127.0.0.1:54321` is out
of reach. In `.env.local`, set `EXPO_PUBLIC_SUPABASE_URL` to your computer's
LAN address (for example `http://192.168.1.20:54321`, with the phone on the
same Wi-Fi) or to an HTTPS tunnel to the API. The local API listens on loopback
only, so a LAN address needs a tunnel or a port forward on your computer.
Only the development variant allows plain HTTP; preview and store builds
require HTTPS.

| Variable                               | What it is                                                       |
| -------------------------------------- | ---------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`             | The API address (see above)                                      |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key; public by design, checked by the database   |
| `EXPO_PUBLIC_SHOP_URL`                 | Shop app only: the website that serves product pictures and help |
| `APP_VARIANT`                          | `development` or `preview` for those builds; unset for the store |

Everything with the `EXPO_PUBLIC_` prefix is written into the app and readable
by anyone: never put a secret there.

Without a phone, the apps can be checked in a browser through their web export,
which is what the native journeys do:

```bash
tools/dev/stack.sh native 1
```

```bash
tools/dev/stack.sh native-e2e 1
```

The web export proves the screens, navigation, forms and API calls. It does
not exercise the native modules (secure store, location, camera), the fonts
embedded in the binary, or whether the binaries start; that needs an EAS build
and a phone.

## Where to read next

- [`docs/README.md`](docs/README.md) — index of the plan and architecture
- [`docs/brand/naming.md`](docs/brand/naming.md) — why the product is called Yuntera
- [`docs/07-deployment/runbook-first-deploy.md`](docs/07-deployment/runbook-first-deploy.md) — how to put it live
- [`docs/02-architecture/overview.md`](docs/02-architecture/overview.md) — how the system fits together
