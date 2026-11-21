# Runbook: first deployment

Step by step, from nothing to a working preview on the real platforms, and what
changes for production. Written for the owner to follow with the Supabase and
Vercel dashboards open.

**Read this first.**

- **Nothing here has been done, and none of it has been tested.** The system
  was built and verified against a local PostgreSQL and a local stand-in for
  the Supabase API. This runbook is the first contact with the real services.
  Expect to find and fix small differences; the places most likely to differ
  are marked ⚠.
- **It costs money or it does not, depending on step 1.** Decide before
  starting.
- **Do not touch the existing production project** of the other product in the
  owner's Supabase organisation. Every step below names the project it applies
  to; check the project name in the dashboard header before running anything.

Time: allow half a day for the preview the first time.

## 0. Before you start

- [ ] Decide where the database lives:
      [the first decision](environments.md#the-first-decision-where-the-database-lives).
      For a preview, a separate free organisation is recommended.
- [ ] Have the repository checked out with `pnpm install` done, and
      `pnpm db:local:reset` and `pnpm db:local:test` passing locally. If the
      migrations do not apply cleanly on your own machine, they will not apply
      in the cloud.
- [ ] Install the Supabase command-line tool and `psql`.
- [ ] Domains are **not** needed for a preview; Vercel gives each app an
      address. They are needed for production (step 9).

## 1. Create the Supabase project

In the Supabase dashboard, in the organisation chosen in step 0:

1. New project. Name it so it cannot be mistaken: `yuntera-preview`.
2. Region: **US East (North Virginia)** unless a latency test says otherwise
   ([why](environments.md#region)).
3. Generate a strong database password and save it in a password manager.
4. Wait for the project to finish provisioning.

Record, from the project's settings:

| What                                      | Where it is                | Used in                                |
| ----------------------------------------- | -------------------------- | -------------------------------------- |
| Project reference                         | Project settings → General | Linking the command line               |
| API address                               | Connect dialog             | `NEXT_PUBLIC_SUPABASE_URL`             |
| Publishable key (`sb_publishable_…`)      | Settings → API Keys        | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Database connection string (session mode) | Connect dialog             | Applying migrations with `psql`        |

Do **not** copy the secret key anywhere. Nothing uses it.

## 2. Check two platform settings before applying anything

1. **Signing keys.** Settings → JWT keys. The project should be using an
   asymmetric signing key; this is the default for new projects. The apps
   verify session tokens against the project's published keys. If the project
   shows only a legacy shared secret, the apps still work — verification falls
   back to asking the Auth server on every request — but it is slower; rotate
   to an asymmetric key.
2. **Scheduled jobs.** Integrations → Cron → enable. The migrations schedule
   two jobs if the scheduler is available and skip them silently if it is not
   (step 4 checks).

## 3. Apply the migrations

The database is built only from `supabase/migrations/`, in filename order.

**Do not apply `supabase/scripts/local-shim.sql`.** It imitates, for a plain
PostgreSQL, the roles and schemas that a Supabase project already has.

Option A — with the Supabase command line. The repository has no
`supabase/config.toml` yet; create one first.

```bash
supabase init
```

```bash
supabase link --project-ref <project-reference>
```

```bash
supabase db push
```

Option B — with `psql`, one file at a time, stopping at the first error:

```bash
for f in supabase/migrations/*.sql; do echo "$f"; psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$f" || break; done
```

Option A records which migrations have been applied, which matters for every
later change; prefer it. If you use option B for the first build, adopt option
A before the second migration.

⚠ **Where the real platform may differ from local.**

| Possible problem                                      | What to do                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| An extension cannot be created in schema `extensions` | Enable `pgcrypto`, `pg_trgm` and `unaccent` from Database → Extensions, then re-run                                         |
| The trigger on `auth.users` is refused                | It must be created by a role allowed to; run that migration from the dashboard's SQL editor                                 |
| `pg_cron` could not be enabled from the migration     | The migration only prints a notice. Do step 2.2, then run the scheduling block at the end of `…081300_moderation.sql` again |
| A default privilege statement behaves differently     | The access tests in step 5 will show it. Do not continue past step 5 until they pass                                        |

## 4. Confirm the database is what the migrations say

In the SQL editor, on `yuntera-preview`:

```sql
select count(*) from public.districts;            -- 494
select id, active from public.delivery_zones;      -- gam-core and gam-extended active; national not
select key, value from public.app_settings;        -- payments_mode "sandbox"
select jobname, schedule from cron.job;            -- expire-unpaid-orders, refresh-product-signals
```

Then run the security and performance advisors (Advisors in the dashboard) and
read every finding. A table without row-level security, or a function with a
mutable search path, is a defect: fix it in a migration, not in the dashboard.

## 5. Seed the preview and run the access tests

**Preview only. Never on a production project.** The seed creates demo
accounts that share a password.

Choose a random password for the demo accounts and keep it. Then, in one
`psql` session:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "select set_config('app.seed_password', '<the password>', false)" -f supabase/seed.sql
```

⚠ The seed inserts users directly into the Auth schema and then places,
pays, picks, packs, routes and delivers orders by calling the real functions
as those users. It has only ever run against the local shim. If it fails on
user creation, create the demo accounts through the dashboard instead and run
the rest of the seed.

Now the most important check in this runbook. Run the SQL test suites against
the real project:

```bash
PG_ADMIN_URL="$DATABASE_URL" PG_DB_NAME=postgres pnpm db:local:test
```

⚠ The script was written for a local database and derives the target from
those two variables; check the address it prints before trusting the result.
Every suite runs inside a transaction that is rolled back, so it leaves no
data behind. `020_access.sql` and `070_api.sql` prove that each kind of user
sees only what they should **on this platform**. If either fails, stop: the
project is not safe to put on the internet.

## 6. Configure sign-in

Authentication → settings, on `yuntera-preview`:

| Setting                            | Preview                         | Production                    |
| ---------------------------------- | ------------------------------- | ----------------------------- |
| Site URL                           | The storefront's Vercel address | `https://www.yuntera.cr`      |
| Additional redirect URLs           | Each app's address              | Each app's production address |
| E-mail provider                    | Enabled                         | Enabled                       |
| Confirm e-mail                     | **Off** — see the warning below | On                            |
| Minimum password length            | 8, to match the apps' forms     | 8 or more                     |
| Leaked-password protection         | On if the plan offers it        | On                            |
| Multi-factor authentication (TOTP) | Enabled                         | Enabled                       |
| Custom SMTP                        | Not needed                      | **Required**                  |

⚠ **E-mail confirmation and password reset are not finished in the apps.**
With confirmation on, sign-up correctly tells the person to check their e-mail,
but there is no page in the storefront that receives the confirmation link, and
there is no "forgot my password" flow at all. For the preview, turn confirmation
off. Before production, those two flows must be built
([go-live checklist](go-live-checklist.md)).

**Custom SMTP.** Supabase's built-in e-mail sender is for testing: it is
heavily rate-limited and not meant for real users. Production needs an SMTP
provider with the sending domain authenticated (SPF, DKIM, DMARC). The
provider is not chosen.

**Staff and a second factor.** The database can require a second factor for
staff (`require_staff_mfa`). Turning it on is one statement by an admin:

```sql
update public.app_settings set value = 'true' where key = 'require_staff_mfa';
```

Do this only once the ops console has a screen to enrol an authenticator and
to complete the second step at sign-in — otherwise staff lock themselves out
of their own permissions. Whether that screen exists depends on how far
`apps/ops` has got; check before flipping it.

**The first admin.** Staff are ordinary accounts with a row in
`staff_members`, and only an admin can add one — so the first has to be
inserted directly. Sign up through the app with the owner's e-mail, then, in
the SQL editor:

```sql
insert into public.staff_members (user_id, role)
select id, 'admin' from auth.users where email = '<owner e-mail>';
```

In the preview the seed already provides `central@yuntera.example` as an admin.

## 7. Create the Vercel projects

One project per app, all pointing at the same repository.

| Project           | Root directory | State of the app                |
| ----------------- | -------------- | ------------------------------- |
| `yuntera-web`     | `apps/web`     | Built                           |
| `yuntera-vende`   | `apps/seller`  | Built                           |
| `yuntera-central` | `apps/ops`     | In progress                     |
| `yuntera-field`   | `apps/field`   | Planned — deploy when it exists |

For each:

1. Import the repository; set **Root Directory** as above. Framework: Next.js.
   Leave the install and build commands at their defaults; Vercel detects pnpm
   and the workspace from the lockfile and `packageManager`.
2. Node.js version: 22.
3. Environment variables, for Production and Preview:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `NEXT_PUBLIC_SITE_URL` ([what they are](environments.md#settings-per-app)).
4. Function region: the one matching the database's region.
5. Deploy.

⚠ The apps import workspace packages (`@yuntera/core`, `@yuntera/db`, …)
from outside their root directory. Vercel supports this for pnpm workspaces,
but it has not been tried with this repository. If a build cannot find a
workspace package, check that the project is allowed to include files outside
its root directory.

**Plan.** Vercel's free plan is for non-commercial use. A preview with fake
data fits; a store taking real orders needs a paid plan. Confirm the current
terms before launch.

**Protect the console.** Until it is on its own domain with staff sign-in and
a second factor, put `yuntera-central` behind Vercel's deployment protection so
it is not reachable by anyone who guesses the address.

## 8. Smoke test

On the deployed storefront, with the browser's developer tools open on the
Console and Network tabs. Every step should work with no error in the console
and no blocked request.

| #   | Do                                                        | Expect                                                                                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Open the home page                                        | Categories and products appear; fonts load; response headers include `content-security-policy` and `strict-transport-security` |
| 2   | Search `licuadra`                                         | The blender is found despite the typo                                                                                          |
| 3   | Search `laptop`                                           | The laptop is first, the backpack second                                                                                       |
| 4   | Open a product with two offers                            | One is featured with a price, a seller and a delivery date; the other is listed below                                          |
| 5   | Choose a delivery zone                                    | The date and shipping update                                                                                                   |
| 6   | Add two products to the cart; open the cart               | Lines, total, IVA included                                                                                                     |
| 7   | Continue to checkout while signed out                     | Redirected to sign in, then back to checkout                                                                                   |
| 8   | Sign in with a wrong password                             | One message that does not say whether the account exists; the e-mail field keeps its value                                     |
| 9   | Sign in as the demo shopper                               | Lands on checkout; the header greets them by name                                                                              |
| 10  | Check the session cookie in developer tools               | Present, `Secure` and `HttpOnly` ([why](go-live-checklist.md#4-security))                                                      |
| 11  | Try to confirm without choosing a payment method          | The form refuses                                                                                                               |
| 12  | Choose SINPE Móvil and confirm                            | An order page with instructions and a reference code                                                                           |
| 13  | Simulate the payment                                      | The page updates to show a four-digit delivery PIN                                                                             |
| 14  | Open "Mis pedidos"                                        | The new order is listed                                                                                                        |
| 15  | Open another shopper's order number by typing its address | "No encontramos esa página"                                                                                                    |
| 16  | Repeat steps 1–6 on a phone                               | Nothing overflows sideways; everything is reachable by thumb                                                                   |
| 17  | In the dashboard, look at the Auth and API logs           | No errors; sign-ins and function calls appear                                                                                  |

Then, as the other demo users, in each app that is deployed: a seller sees
only their own listings and statements; a warehouse associate can pick and
pack a waiting order; ops can build a route and assign it; the driver can
complete a stop with the PIN from step 13's order — and cannot with a wrong
one.

⚠ **Likely first-contact issues**, and where to look:

| Symptom                                   | Probable cause                                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every request to the database is blocked  | The Content-Security-Policy's `connect-src` was built without the real API address; rebuild after setting the variable                                            |
| Signed in, but pages behave as signed out | The session cookie is being split into several cookies and one is lost, or the proxy that refreshes it is not running; check `set-cookie` on the sign-in response |
| A function returns "permission denied"    | A grant is missing on this platform; compare with the access migration                                                                                            |
| A function returns an unexpected shape    | The contract test will say which; run it against the project                                                                                                      |
| Unpaid orders never expire                | The cron jobs were not scheduled; see step 4                                                                                                                      |

Write down everything that differed from local. Each difference is either a
fix to the migrations or the apps, or a line to add to this runbook.

## 9. Production, when the checklist says so

Production is a second Supabase project on a paid plan, never the preview
promoted. The steps are 1–7 again with these differences:

- [ ] Project name `yuntera-production`.
- [ ] **Skip step 5's seed entirely.** Reference data — districts, zones,
      categories, the fee schedule, holidays — comes from the migrations. Run
      the access tests against production only before it holds real data: the
      suites rely on seed accounts, so in practice run them on a throwaway
      project built the same way.
- [ ] `payments_mode` set to `live` — which disables the payment simulator —
      and only once a real gateway integration exists.
- [ ] `require_staff_mfa` set to `true`.
- [ ] E-mail confirmation on; custom SMTP configured and tested.
- [ ] Backups confirmed; decide on point-in-time recovery
      ([operations](operations.md#backups-and-the-restore-drill)).
- [ ] Domains:
  1. Register `yuntera.cr` (through NIC Costa Rica), and `yuntera.com` and
     `yuntera.app`. None is registered yet.
  2. In each Vercel project, add its hostname: `www.yuntera.cr` (and the bare
     domain redirecting to it), `vende.yuntera.cr`, `central.yuntera.cr`,
     `ruta.yuntera.cr` and `bodega.yuntera.cr` (both on the field app).
  3. At the DNS provider, create the records Vercel shows for each hostname.
     Certificates are issued automatically once DNS resolves.
  4. Add the mail provider's SPF, DKIM and DMARC records.
  5. Update `NEXT_PUBLIC_SITE_URL` in each project, the Site URL and redirect
     URLs in Supabase Auth, and redeploy.
- [ ] Everything else on the [go-live checklist](go-live-checklist.md).

## After the first deploy

- Commit `supabase/config.toml` if the command line created one.
- Update this runbook with what actually happened.
- Update the status notes in
  [architecture overview](../02-architecture/overview.md) and
  [decisions](../02-architecture/decisions.md#3-a-local-stand-in-for-the-supabase-api):
  "not run on real Supabase" stops being true the moment step 8 passes.
