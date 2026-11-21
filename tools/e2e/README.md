# Browser journeys

Four scripts that use the product the way its four kinds of users do, in a real
browser, against a freshly seeded database:

| Journey  | App           | What it walks through                                                                                                                                                                                                   |
| -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web`    | `apps/web`    | Search with a typo, product page, cart, sign-in with a wrong then right password, checkout, SINPE payment, delivery code, orders, another shopper's order hidden, phone width                                           |
| `seller` | `apps/seller` | Sign-in redirect, switching shops, price edit and its validation, stock count, new listing with the fee preview, inbound stock, statements, packing, a new seller registering on a phone                                |
| `ops`    | `apps/ops`    | Visitors and non-staff kept out, confirming a bank transfer, order search, product review, seller verification, route planning, a return approved and refunded, a complaint answered, drivers, audit trail, phone width |
| `field`  | `apps/field`  | Driver: route, wrong delivery code, short cash, delivery, failed delivery, cash settlement and position reaching the console. Warehouse: wrong scan refused, picking, packing, receiving, stock lookup                  |

Three more cover account security, reading e-mails from the stand-in's local
mailbox (`GET /dev/mail`) and switching Auth settings for their own database
(`POST /dev/settings`):

| Journey               | App        | What it walks through                                                                                                                                                        |
| --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `password-reset`      | `apps/web` | Same answer for an unknown address, the e-mail link, new password, old one refused, other session ended; then by 6-digit code; a reused and an expired link; a wrong code    |
| `staff-second-factor` | `apps/ops` | Enrolment with computed codes, the second step after a wrong code, `require_staff_mfa` on (database refuses aal1 staff, colleague sent to enrolment), admin resets colleague |
| `account-deletion`    | `apps/web` | Sign-up with confirmation on, resend limit, sign-in before confirming, code, deletion (wrong password first), same address signs up again, a shopper with an order refused   |

A journey fails if a step does not arrive where it should, if the browser logs
an error, or if any response is a 5xx. They are deliberately few and long: they
exist to prove the apps, the API and the database work together, not to cover
every branch (the database and unit tests do that).

## Running them

```bash
pnpm db:local:up
```

```bash
pnpm --filter @yuntera/dev-api start
```

```bash
pnpm build
```

Start the four apps, each in its own terminal:

```bash
pnpm --filter @yuntera/web start
```

```bash
pnpm --filter @yuntera/seller start
```

```bash
pnpm --filter @yuntera/ops start
```

```bash
pnpm --filter @yuntera/field start
```

Then:

```bash
pnpm --filter @yuntera/e2e journeys
```

Screenshots of the main screens are written to `tools/e2e/screenshots/`
(ignored by git). The runner resets the local database before each journey, so
do not point it at a database you care about.

## Settings

All optional; the defaults match local development.

| Variable                                        | Default                                    |
| ----------------------------------------------- | ------------------------------------------ |
| `WEB_URL`, `SELLER_URL`, `OPS_URL`, `FIELD_URL` | `http://127.0.0.1:3000` … `:3003`          |
| `API_URL`, `API_KEY`                            | the local stand-in and its publishable key |
| `SEED_PASSWORD`                                 | the local seed password                    |
| `E2E_SHOTS`                                     | `tools/e2e/screenshots`                    |
