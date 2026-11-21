# Runbook: first deployment

Step by step, from nothing to a working preview on the real platforms, and what
changes for production. Written for the owner, or anyone repeating it for
production, with the Supabase and Vercel dashboards open.

**Read this first.**

- **Steps 1–6 were done for the preview on 21 November 2026** (project
  `yuntera`, reference `lfulotisyeyooxecwnox`, US East, Postgres 17, free
  plan). Each step says what was actually run and what differed from the local
  build. Steps 7 and 8 are being done next. Places that differed, or still may,
  are marked ⚠.
- **It costs money or it does not, depending on step 1.** Decide before
  starting.
- **Do not touch the existing production project** of the other product in the
  owner's Supabase organisation. Every command below takes the project
  reference explicitly; check it against the dashboard before running anything.

Time: about two hours for the preview, most of it reading results.

## 0. Before you start

- [ ] Decide where the database lives:
      [the first decision](environments.md#the-first-decision-where-the-database-lives).
      For a preview, a separate free organisation is recommended.
- [ ] Have the repository checked out with `pnpm install` done, and
      `pnpm db:local:reset` and `pnpm db:local:test` passing locally. If the
      migrations do not apply cleanly on your own machine, they will not apply
      in the cloud.
- [ ] Node.js and `curl`. Neither the Supabase command-line tool nor `psql` is
      needed: everything below goes through Supabase's Management API with
      `supabase/scripts/remote-db.sh`, so no database password is used or
      stored anywhere.
- [ ] A personal access token for the Supabase account
      (Account → Access Tokens), exported as `SUPABASE_ACCESS_TOKEN` in the
      shell that runs the script. Where a network proxy already adds the
      credential for `api.supabase.com`, leave the variable unset. Revoke the
      token when the deployment is done.
- [ ] Domains are **not** needed for a preview; Vercel gives each app an
      address. They are needed for production (step 9).

## 1. Create the Supabase project

In the Supabase dashboard, in the organisation chosen in step 0:

1. New project. Name it so it cannot be mistaken (the preview is `yuntera`;
   production will be `yuntera-production`).
2. Region: **US East (North Virginia)** unless a latency test says otherwise
   ([why](environments.md#region)).
3. Let the dashboard generate the database password and do not keep it.
   Nothing in this runbook uses it; if it is ever needed it can be reset from
   the dashboard.
4. Wait for the project to finish provisioning.

Record, from the project's settings:

| What                                 | Where it is                | Used in                                |
| ------------------------------------ | -------------------------- | -------------------------------------- |
| Project reference                    | Project settings → General | Every `remote-db.sh` command           |
| API address                          | Connect dialog             | `NEXT_PUBLIC_SUPABASE_URL`             |
| Publishable key (`sb_publishable_…`) | Settings → API Keys        | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

Do **not** copy the secret key anywhere. Nothing uses it.

## 2. Check two platform settings before applying anything

1. **Signing keys.** Settings → JWT keys. The project should be using an
   asymmetric signing key; this is the default for new projects (the preview
   issues ES256 session tokens). The apps verify session tokens against the
   project's published keys. If the project shows only a legacy shared secret,
   the apps still work — verification falls back to asking the Auth server on
   every request — but it is slower; rotate to an asymmetric key.
2. **Scheduled jobs.** Integrations → Cron → enable. The migrations schedule
   two jobs if the scheduler is available and skip them silently if it is not
   (step 4 checks).

## 3. Apply the migrations

The database is built only from `supabase/migrations/`, in filename order.

**Do not apply `supabase/scripts/local-shim.sql`.** It imitates, for a plain
PostgreSQL, the roles and schemas that a Supabase project already has.

```bash
supabase/scripts/remote-db.sh status <project-reference>
```

```bash
supabase/scripts/remote-db.sh push <project-reference>
```

`push` sends each pending migration through the Management API's SQL endpoint
in one transaction, together with its row in
`supabase_migrations.schema_migrations` (the table the Supabase command line
uses, so `supabase db push` would agree later). It stops at the first error,
and nothing from the failing file is kept. Statements run as the `postgres`
role, which on a hosted project is **not** a superuser (it has `BYPASSRLS`).
`status` afterwards should list every file as `applied`.

⚠ **What differed from local, and how it was fixed.**

| Difference                                                                                                                                                      | Fix                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A function may pin an extension's setting (`set pg_trgm.word_similarity_threshold`) only once the extension's library is loaded, unless the role is a superuser | `…081200_search.sql` calls `extensions.word_similarity('a', 'a')` first                                                                                                                |
| The seed's unpaid SINPE Móvil order is cancelled by `expire-unpaid-orders` 30 minutes after seeding (locally there is no scheduler, so it waited for ever)      | The suites now place their own unpaid order (`pg_temp.unpaid_order` in `supabase/tests/_helpers.sql`); 030, 050 and 080 had failed on any database seeded more than 30 minutes earlier |
| A shared preview gains orders after seeding (the smoke test in step 8 places one)                                                                               | `070_api.sql` counts the console's orders against the tables instead of the seed's fixed numbers                                                                                       |

Compared and found **equal** between a local build and the hosted project:
the privileges of `anon` and `authenticated` on every table, sequence, function
and schema of ours; row-level security on every table; every policy; owners;
`search_path` and `security definer` on every function; and the default
privileges of `postgres` (nothing is granted to `anon`, `authenticated` or
`PUBLIC` by default). Platform settings that matter: the Data API exposes only
`public` and `graphql_public`, `pg_graphql` is not enabled, and `anon` has a
3-second and `authenticated` an 8-second statement timeout.

## 4. Confirm the database is what the migrations say

Write these to a file and run it with `remote-db.sh sql <project-reference>
<file>` (or paste them into the dashboard's SQL editor):

```sql
select count(*) from public.districts;            -- 494
select id, active from public.delivery_zones;      -- gam-core and gam-extended active; national not
select key, value from public.app_settings;        -- payments_mode "sandbox"
select jobname, schedule from cron.job;            -- expire-unpaid-orders, refresh-product-signals
```

Then, once the project has been up for ten minutes, check that the scheduler
really runs the jobs:

```sql
select j.jobname, d.status, count(*), max(d.start_time)
from cron.job_run_details d join cron.job j using (jobid) group by 1, 2;
```

On the preview, `expire-unpaid-orders` had run 6 times in its first 25
minutes, every run `succeeded` in under 0.06 s, and at 18:55 it cancelled the
seed's unpaid SINPE Móvil order, 33 minutes after it was placed (12 runs, none
failed). `refresh-product-signals` runs
daily at 08:17 UTC, so it has no history on the first day.

Then read the security and performance advisors (Advisors in the dashboard,
or `GET /v1/projects/<ref>/advisors/security` and `…/performance` on the
Management API). A table without row-level security, or a function with a
mutable search path, is a defect: fix it in a migration, not in the dashboard.
On the preview, after the seed, the test suites and `…082200_platform.sql`:

| Finding                                                              | Count | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS enabled, no policy: `private.audit_log`, `private.outbox_events` | 2     | Accepted: only definer functions touch them, and `private` is not exposed                                                                                                                                                                                                                                                                                                                                                                                                        |
| Security-definer function executable by `authenticated`              | 69    | Accepted: the API is definer functions that check the caller themselves (the suites prove the refusals)                                                                                                                                                                                                                                                                                                                                                                          |
| Security-definer function executable by `anon`                       | 4     | Accepted for now; misuse was tried as a visitor, see below                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Leaked-password protection off                                       | 1     | Needs the Pro plan; turn it on in production (step 6)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Unindexed foreign keys                                               | 39    | Accepted: they point at small reference tables (districts, cantons, zones, fee schedules, brands, categories) or at parents that are never deleted (products, offers, SKUs, warehouses, locations, routes, orders), or at staff who acted on a row. `…082200_platform.sql` indexed the 7 on a real query or delete path (order items' shipments and returns, seller ledger accounts, seller stock, and the account-deletion checks on order events, stock movements and reviews) |
| Unused indexes                                                       | 19    | Accepted: the database holds only demo data; look again after a month of real traffic                                                                                                                                                                                                                                                                                                                                                                                            |
| Multiple permissive policies (one table, one role, `select`)         | 16    | Accepted: each is a read policy plus a staff `for all` write policy on a small table. The apps do not read tables directly, so the extra policy costs nothing on the API path. Split the `for all` policies into insert/update/delete if a table ever serves direct reads at volume                                                                                                                                                                                              |

**The four functions a visitor can call**, tried on the preview with only the
publishable key:

- `delivery_estimate` — handling days are clamped to 0–10, unknown postal
  codes return nothing, a 1 MB postal code returns nothing in 0.15 s. No issue.
- `checkout_quote` — prices up to the whole request before refusing more than
  the allowed number of lines: 20 000 lines (1.3 MB) took 0.7 s and came back
  `too_many_lines`. Bounded by the 3-second visitor timeout; low risk. Checking
  `jsonb_array_length` first would make it constant.
- `reviewer_display_name` — returns "first name and initial" for **any**
  account id, including staff and drivers, not only reviewers. Reviewers' ids
  are public anyway (`reviews.user_id` is readable by visitors); other ids are
  random and cannot be enumerated. Low risk; it should take a review id
  instead, and `user_id` should leave the visitors' column grant on `reviews`.
- `report_content` — a visitor can file reports without limit (20 in 1.2 s
  were all accepted), about targets that do not exist, with any well-formed
  e-mail address; each also queues an outbox event. Medium risk to the
  moderation queue (spam, storage), and higher if reporters are ever e-mailed.
  Before production: check that the target exists and is visible, and limit
  reports per address and per target per day.

## 5. Seed the preview and run the access tests

**Preview only. Never on a production project.** The seed creates demo
accounts that share a password.

The seed (`supabase/seed.sql`) inserts users directly into the Auth schema,
then places, pays, picks, packs, routes and delivers orders by calling the
real functions as those users. It runs unchanged on a hosted project and
locally: the local shim's `auth.users` and `auth.identities` have the same
columns as the real ones. What a password sign-in on the real Auth service
needs, checked against a real sign-up on the preview:

- `auth.users`: `instance_id` `00000000-0000-0000-0000-000000000000`, `aud`
  and `role` `authenticated`, a bcrypt `encrypted_password` (pgcrypto's
  `crypt(…, gen_salt('bf', 10))`, `$2a$`), `email_confirmed_at` set,
  `raw_app_meta_data` `{"provider":"email","providers":["email"]}`, and the
  token columns (`confirmation_token`, `recovery_token`,
  `email_change_token_new`, `email_change`, `email_change_token_current`,
  `phone_change`, `phone_change_token`, `reauthentication_token`) as empty
  strings — the Auth service fails on NULL in them. `id` has no default on
  the real table.
- `auth.identities`: one row with `provider` `email`, `provider_id` the user's
  id as text, and `identity_data` with `sub`, `email`, `email_verified` and
  `phone_verified`. The `email` column is generated.

Generate a random password into a file only you can read, without it appearing
on screen, then seed. The script refuses unless the project's `payments_mode`
is `sandbox`, `YUNTERA_SEED_CONFIRM` equals the project reference, and the
project has no sellers or demo accounts yet. It hashes the password in the
database (sent as a query parameter) and puts only the hash in the seed, which
runs as one transaction in one request — it is applied whole or not at all,
and running it again after a timeout either refuses (it finished) or starts
clean (it did not).

```bash
(umask 077; head -c 256 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 32 > ~/yuntera-preview-demo-password.txt)
```

```bash
YUNTERA_SEED_CONFIRM=<project-reference> YUNTERA_SEED_PASSWORD="$(cat ~/yuntera-preview-demo-password.txt)" supabase/scripts/remote-db.sh seed <project-reference>
```

On the preview it took 3 seconds and printed `Seeded: 11 demo accounts, 5
sellers, 27 products, 17 orders.` Row counts in every table matched a local
seed exactly.

Accounts (all `@yuntera.example`): `comprador`, `comprador2`, `comprador3`
(shoppers); `vendedor` (seller: TecnoCasa and Ferretería El Higuerón),
`cafetal`, `sendero`, `bazar` (sellers; Bazar Nuevo is pending approval);
`bodega` (warehouse lead, SJO1); `repartidor`, `repartidor2` (drivers);
`central` (staff, admin). To change their password later, run an `update
auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 10))
where email like '%@yuntera.example'` with the password as a query parameter,
never in the statement text.

Then prove sign-in on the real Auth service: `POST
<API address>/auth/v1/token?grant_type=password` with the publishable key as
`apikey` should return 200 for each kind of account, and `400
invalid_credentials` for a wrong password or an unknown address. With the
returned token, `/rest/v1/rpc/<function>` should succeed for what the account
may do and fail with `forbidden` (or `not_a_driver`, or `forbidden` for
another seller's id) otherwise; without a token, visitor functions answer and
every other function is `401 permission denied`. All of this held on the
preview.

Now the most important check in this runbook. Run the SQL test suites against
the real project:

```bash
supabase/scripts/remote-db.sh test <project-reference>
```

Each suite runs in a transaction that is rolled back, so it leaves no data
behind (on the preview, row counts of every table were the same before and
after; order-number sequences do advance). `020_access.sql` and `070_api.sql`
prove that each kind of user sees only what they should **on this platform**.
If either fails, stop: the project is not safe to put on the internet. All
eight passed on the preview.

⚠ Some suites still count seed rows (active products, sellers). They pass on a
freshly seeded preview; if people have since added listings or sellers there,
a failure that names a count is the data, not access control — read it before
acting.

## 6. Configure sign-in

Through the Management API (`PATCH /v1/projects/<ref>/config/auth`) or
Authentication → settings in the dashboard. Read the current values first;
the full object contains secrets, so print only the fields you change.

| Setting                            | Management API field                                  | Preview (set 21 Nov 2026)       | Production                    |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------- | ----------------------------- |
| Site URL                           | `site_url`                                            | Not set yet (`localhost:3000`)  | `https://www.yuntera.cr`      |
| Additional redirect URLs           | `uri_allow_list`                                      | Not set yet                     | Each app's production address |
| Sign-ups allowed                   | `disable_signup` = false                              | Yes                             | Yes                           |
| E-mail provider                    | `external_email_enabled`                              | Enabled                         | Enabled                       |
| Confirm e-mail                     | `mailer_autoconfirm` (true means **no** confirmation) | **Off** — see the warning below | On                            |
| Minimum password length            | `password_min_length`                                 | 8, to match the apps' forms     | 8 or more                     |
| Leaked-password protection         | `password_hibp_enabled`                               | Off: needs the Pro plan         | On                            |
| Multi-factor authentication (TOTP) | `mfa_totp_enroll_enabled`, `mfa_totp_verify_enabled`  | Enabled                         | Enabled                       |
| Custom SMTP                        | `smtp_*`                                              | Not needed                      | **Required**                  |

The Site URL and redirect URLs are set once the apps' Vercel addresses exist
(step 7).

Then check sign-up end to end: sign up a throwaway address under `.example`
through `<API address>/auth/v1/signup`. On the preview it returned a session
straight away (confirmation off), the trigger on `auth.users` created the
`profiles` row with the name given at sign-up, and the new account could call
`my_profile`, `my_roles` and `my_addresses` but not `ops_overview`. Delete the
throwaway account afterwards (`delete from auth.users where email = …`; its
identity, sessions and profile go with it) and check that nothing of it is left
in `auth.users`, `auth.identities`, `auth.sessions`, `auth.refresh_tokens` or
`public.profiles`.

⚠ A session token stays valid until it expires (an hour) even after its
account is deleted: the Data API checks the token's signature, not the
account. Functions then see a user that no longer exists (`my_profile` returns
null). This is how Supabase works; keep it in mind when disabling an account.

⚠ **E-mail confirmation and password reset are not finished in the apps.**
With confirmation on, sign-up correctly tells the person to check their e-mail,
but there is no page in the storefront that receives the confirmation link, and
there is no "forgot my password" flow at all. For the preview, confirmation is
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
inserted directly. Sign up through the app with the owner's e-mail, then run:

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
