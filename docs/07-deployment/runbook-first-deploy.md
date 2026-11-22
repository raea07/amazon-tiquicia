# Runbook: first deployment

Step by step, from nothing to a working preview on the real platforms, and what
changes for production. Written for the owner, or anyone repeating it for
production, with the Supabase and Vercel dashboards open.

**Read this first.**

- **Steps 1–8 were done for the preview on 21 November 2026** (project
  `yuntera`, reference `lfulotisyeyooxecwnox`, US East, Postgres 17, free
  plan), first up to migration `082400`, then again for `082500` to
  `082700` (account security, notifications, product photos), then for
  `082800` to `083100` (the security hardening), and **on 22 November 2026
  for `083200` to `083500`** (the follow-ups, payments, invoicing), with the
  four apps redeployed each time. What was run for those four is under
  [What was done on the preview, 22 November 2026](#what-was-done-on-the-preview-22-november-2026).
  Four more (`083510`, `083600`, `083700`, `083900`) went on **the same
  evening**, again with the four apps redeployed: the preview has 37
  migrations
  ([what was done](#what-was-done-on-the-preview-22-november-2026-evening)).
  Each step says what was actually run and what differed from the local
  build. Places that differed, or still may, are marked ⚠.
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

### Migrations 20261121082500 to 20261121082700

Account security, notifications and product photos. **Applied to the preview
on 21 November 2026** with `remote-db.sh push`, in order, each in one
transaction; all three went through at the first try (1.7 s together), so
the project has 25 migrations. Nothing in them had to change for the
platform. What was checked there, and how to repeat it:

1. **The per-request check is registered and honoured.** `082500` registers
   `public.check_request` as `pgrst.db_pre_request` for role `authenticator`
   in this database (`alter role … in database … set`) and sends
   `notify pgrst, 'reload config'`. On the hosted project `postgres` holds `authenticator` with the admin option, so
   the statement is allowed. Confirm it took:

   ```sql
   select s.setdatabase, s.setconfig from pg_db_role_setting s
   join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator';
   ```

   On the preview: the platform's own row for all databases
   (`session_preload_libraries`, the 8-second timeouts) and ours for database
   `postgres`, `pgrst.db_pre_request=public.check_request`. The Data API
   honours it straight away: a throwaway account signed up, called
   `my_orders` (200), signed out, and the same access token then got
   `400 session_ended` from `my_orders` and `my_roles`; a new sign-in worked
   again.

   **What it costs.** Inside the database, `check_request` for a signed-in
   caller with a live session takes about 0.1 ms (95–108 µs over 2 000 calls,
   against 3 µs for an empty loop and 0.7–0.8 ms for `my_roles` itself).
   Through the API from outside, 30 sequential calls in two rounds as the
   demo shopper: `my_roles` median 54–55 ms before the migration and 59–60 ms
   after (fastest 48–49 ms before, 56–57 ms after); a visitor's call
   (`shop_path_exists`) 56–60 ms before and 62–63 ms after, which is within
   the noise of the network. A signed-in request is about 5 ms slower end
   to end, most of it the extra statement PostgREST runs, not the check.
   Not tried: the notification worker's secret key (never used here).

2. **The second factor counts in the database.** With a throwaway account:
   enrolled a TOTP factor through Auth's own API (`POST /auth/v1/factors`,
   challenge, verify with a code computed locally); a new password-only
   session (aal1) got `second_factor_required` from `my_orders` and
   `my_addresses` and was answered by `my_security` and `mfa_attempt_status`;
   the second step (reserve, challenge, verify) gave aal2 and `my_orders`
   answered. Five wrong codes sent the apps' way (`mfa_reserve_attempt` before
   each, Auth answering `422 mfa_verification_failed`) locked the account:
   the sixth reservation came back with `locked: true` and
   `retry_after_seconds: 899`. The factor was then removed with the aal2
   session. Auth's factor e-mails (`mailer_notifications_mfa_*`) are off, so
   none of this sent mail.
3. **The functions that write the sign-in tables may do so.** The tables
   belong to `supabase_auth_admin`, and `postgres`, which owns our functions,
   has select, insert, update and delete on `auth.users`, `auth.sessions`,
   `auth.identities`, `auth.mfa_factors`, `auth.mfa_challenges`,
   `auth.one_time_tokens`, `auth.refresh_tokens` and `auth.audit_log_entries`:

   ```sql
   select t, has_table_privilege(p.proowner, t, 'select,update,delete')
   from pg_proc p, unnest(array['auth.users','auth.sessions','auth.identities',
     'auth.mfa_factors','auth.one_time_tokens','auth.audit_log_entries']) t
   where p.proname = 'ops_reset_staff_factor';
   ```

   `ops_reset_staff_factor` was run as the demo administrator's claims on a
   throwaway account made staff for the purpose, which had a real verified
   factor and a session, in a transaction that was rolled back: it removed
   1 factor and ended 1 session and wrote its audit row; after the rollback
   the factor was still there. `delete_my_account` was run for real three
   times (once over the API, twice from the shop's "Eliminar mi cuenta"):
   the old token got `session_ended`, the refresh token was refused, the old
   address got `invalid_credentials`, and the same address signed up again as
   a new account. Searching every row of every table in `public`, `private`,
   `auth` and `storage` for the person's address, names, phone and address
   text found nothing; the sign-in row was left with the
   `cuenta-eliminada.invalid` address, an empty password, no NULL in the
   token columns (Auth fails on those) and no identity or session. Auth's own
   user listing (`GET /auth/v1/admin/users`) needs the secret key, which this
   runbook never uses, so it was not called; Auth did load the row without
   error when the old token was presented (`403 session_not_found`, not a
   500). **Open Authentication → Users in the dashboard once** to see the
   listing itself.

   One thing the deletion does not touch: `auth.flow_state`, where Auth keeps
   the state of a sign-in or reset that used PKCE. It holds the user id, not
   personal data; one row was left after a deletion and removed by hand.

4. **A migration may create the storage buckets and rules.** It may:

   ```sql
   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
   select policyname, cmd, roles from pg_policies where schemaname = 'storage';
   ```

   gave `product-photos-pending` (private) and `product-photos` (public),
   both 2 MiB and JPEG/PNG/WebP, and the three rules (add, read, delete) for
   `authenticated` exactly as the migration writes them. `storage.buckets`
   has triggers that refuse lifecycle settings to anyone but the storage
   service; the migration sets none, so the insert passes. The service then
   behaved as the rules say, from outside (the photo journey, step 8): a
   visitor gets `NoSuchBucket` from the private bucket's public address and
   `NoSuchKey` for a download or a signed link; the shop's own seller cannot
   sign a link to a waiting file (for 60 s or ten years) but can download it;
   an upload address asked for with `x-upsert: true` is refused by the rule
   (`AccessDenied`); a 3 MB file gets `EntityTooLarge` and an SVG
   `InvalidMimeType` from the service; another shop gets `AccessDenied` or
   `NoSuchKey` for signing, deleting and copying. So the service does set
   `storage.operation` and `request.headers`.

5. **The image library works in the hosted console.** It does. Staff
   approved test photos in `/catalogo` on the deployed console; the 400, 800
   and 1600 files appeared in the public bucket, each the reviewed picture at
   exactly that width, and the shop showed them with their alternative text.

Differences found on the platform, and what was done:

| Difference                                                                                                                                                                                                                               | Fix                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The seed ran before `082600`, and the migration gives jobs only to events written after it, so the seed's 87 events have none (nothing old is ever sent). `100_notifications.sql` expected them                                          | The suite routes them itself inside its rolled-back transaction                                                                                                                                                     |
| A hosted database refuses a `dblink` connection to itself without a password, and the Management API holds none. Part 2 of `100_notifications.sql` (two workers at once) needs that                                                      | It detects this and ends with a row named `skipped`; `remote-db.sh test` prints it, `local-db.sh test` prints it and fails in CI (`CI=true`). It runs locally                                                       |
| `storage.objects` refuses any `DELETE` unless `storage.allow_delete_query` is `'true'` (the service sets it for its own deletes); its unique index on `(bucket_id, name)` is partial (object versioning), so `ON CONFLICT` cannot use it | `105_product_photos.sql` sets the setting, as the service does, and no longer imitates the upsert probe with `ON CONFLICT`. The console's own deletions through the service worked (every waiting copy was cleaned) |
| A deleted public photo was still served by the CDN for a short while after the deletion (seen at once; gone when checked three minutes later)                                                                                            | Nothing to fix; a taken-down photo is visible for a few minutes, besides browsers' own caches                                                                                                                       |

The suites: `remote-db.sh test` passes all 14 files on the preview, with
part 2 of `100_notifications.sql` reported as skipped. Row counts of all 111
tables in `public`, `private`, `auth` and `storage` were the same before and
after; `dblink` was not left installed.

Scheduled jobs: `082600` enables `pg_net` and schedules `notify-sweep` every
30 seconds and `cron-history-cleanup` weekly. Without the Vault secrets the
sweep does nothing and succeeds (60 runs in the first half hour, about 15 ms
each, no HTTP request queued). It writes a row of job history every 30
seconds; the weekly clean-up keeps a week of them.

### Migrations 20261121082800 to 20261121083100

The fixes from the internal security review: the lockdown (`082800`), the
integrity of money and returns (`082900`), limits (`083000`) and the merge
with the features before them (`083100`). **Applied to the preview on
21 November 2026 at 23:42 UTC**, so it has 29 migrations; what happened
there follows the list. Before that they were applied locally, in order, on
top of a database built to `082700` with the old demo data and some activity
(an order placed, paid, delivered after one wrong code, a withdrawal opened
on it, a duplicate withdrawal planted, a wrong code on an order still on its
way): all four went in, and the checks below gave the expected answers. Do
this in order.

1. **Before `082900`, read-only:** no order has two `order_capture` or two
   `order_refund` ledger transactions, and no order has two cash stops in
   `pending`, `arrived` or `delivered`. Otherwise the unique indexes fail and
   the migration rolls back.

   ```sql
   select order_id, kind, count(*) from public.ledger_transactions
   where kind in ('order_capture', 'order_refund') group by 1, 2 having count(*) > 1;
   select s.order_id, count(*) from public.route_stops rs
   join public.shipments s on s.id = rs.shipment_id
   where rs.cod_amount_minor > 0 and rs.status in ('pending', 'arrived', 'delivered')
   group by 1 having count(*) > 1;
   ```

2. **Apply** with `remote-db.sh push`; `status` should list 29 files.
3. **Default privileges for new tables.** The platform's own defaults (for
   `supabase_admin`) cannot be changed by `postgres`; those of `postgres` must
   give the API roles nothing, globally and in every schema except `auth` and
   `storage`:

   ```sql
   select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl
   from pg_default_acl where defaclrole = 'postgres'::regrole;
   ```

   No entry may name `anon`, `authenticated` or PUBLIC. Then
   `remote-db.sh test` with `020_access.sql` and `110_lockdown.sql` must pass;
   110 fails on any table privilege, unlisted function or write policy.
4. **No write policy and no readable table:**

   ```sql
   select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and p.polcmd <> 'r';   -- 0
   select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'S')
     and (has_table_privilege('anon', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'select'));  -- 0
   ```

5. **The storage rules after the lockdown.** They call only owner's-rights
   helpers, so nothing should change; repeat the storage checks of the
   previous section (a seller uploads into a reserved path, another shop is
   refused, a visitor reads only the public bucket) and run
   `105_product_photos.sql`.
6. **The data repairs.** Every order has a delivery code; wrong attempts on
   stops of open orders were carried to their order; open returns that
   repeated units, had no delivered goods or sat on an unpaid or cancelled
   order are closed with a note; every cash stop names its order:

   ```sql
   select (select count(*) from public.orders) as orders,
          (select count(*) from private.delivery_codes) as codes;
   select status, resolution_note, count(*) from public.return_requests group by 1, 2;
   select count(*) filter (where cod_order_id is null) from public.route_stops
   where cod_amount_minor > 0;   -- 0
   ```

7. **Payout accounts.** After `083000` an account finance never approved is
   not paid, and the preview's were loaded before approvals existed:
   `select count(*) filter (where payout_approved_at is not null) from public.seller_private`
   is 0 there. Until finance approves them again (the seller sends the same
   account), payout runs answer `nothing_to_pay`, and `085`, `095_shared_fee_payouts`
   and `115` fail there for that reason only (locally, with the accounts
   approved, they pass). Stamping them by SQL is a deliberate decision for
   the owner.
8. **The suites.** `remote-db.sh test` for all 17 files, after step 7.
9. **Redeploy the four web apps**; all four changed.

**What was done on the preview, 21–22 November 2026.**

1. Both read-only checks returned no rows (17 capture or refund
   transactions and 3 cash stops existed, none doubled).
2. Recorded first: the row count of all 111 tables in `public`, `private`,
   `auth` and `storage` (2 166 rows); the privileges of `anon`,
   `authenticated` and PUBLIC on our relations in `public` (76 table grants:
   56 to `authenticated`, 20 `SELECT` to `anon`, plus column grants on 13
   tables); and 30 timed calls each, through the API from outside, of
   `shop_path_exists` as a visitor and `my_roles` as the demo shopper
   (medians 57 and 60 ms in the first round, 54 and 56 ms in the second;
   fastest 50 and 52 ms).
3. `push`: ⚠ `082800` failed at once with _permission denied to set
   parameter "pg_trgm.word_similarity_threshold"_ and nothing was kept. It
   recreates the two search functions, which pin that setting, and the
   migration role may do so only once pg_trgm's library is loaded in the
   session (the same difference as `081200`, first table above). The file now
   calls `extensions.word_similarity('a', 'a')` first; the second `push`
   applied all four in 2.2 s. `status` lists 29 files. A local reset and all
   17 suites passed with the change (lane 19).
4. **Default privileges.** `postgres` now has, globally, only
   `{postgres=X}` for functions (PUBLIC cannot execute new functions), and in
   `public` only `postgres` and `service_role` on new tables, sequences and
   functions. What still names `anon` or `authenticated`, and why it is not
   reached by our migrations:
   - `postgres` in `storage`: everything on new tables, sequences and
     functions to `anon` and `authenticated`. The platform sets this; the
     lockdown leaves the platform's schemas alone. It applies only to objects
     `postgres` creates in `storage`, and `postgres` owns none there (every
     table and function in `storage` belongs to `supabase_storage_admin`, in
     `auth` to `supabase_auth_admin`). Low risk while no migration or
     dashboard query creates objects in `storage`; `postgres` could revoke
     it with `alter default privileges for role postgres in schema storage
     revoke all on tables from anon, authenticated` (and sequences,
     functions), which is the owner's decision.
   - `supabase_admin` in `public`, `graphql` and `graphql_public`: everything
     to `anon` and `authenticated`. `postgres` cannot change these. They apply
     to objects the platform itself creates there, for example an extension
     enabled in `public` from the dashboard. Today `supabase_admin` owns no
     table or function in `public`, and `pg_graphql` is not enabled. Enable
     extensions in `extensions`, never in `public`; `110_lockdown.sql` fails
     on any table privilege that appears in `public` or `private`.
   - Not a default privilege, but found here: `pg_net` (enabled by `082600`)
     lets `anon` and `authenticated` use schema `net`, execute
     `net.http_get`/`http_post`/… and read `net._http_response`. The Data API
     exposes only `public` and `graphql_public` (`Accept-Profile: net` gets
     `406 PGRST106`), so nobody reaches it over HTTP. A revoke on `net` for
     the API roles would close it for good; also the owner's decision.

   The rest held: no privilege of `anon` or `authenticated` on any table,
   view, sequence or column in `public` or `private` (0 by `aclexplode`, 0 by
   `has_*_privilege`, and the statement of point 4 gave 0); no policy other
   than for `select` (57 read policies remain); row-level security on all 80
   tables (62 public, 18 private). From outside, every table path answered
   `401` to a visitor and `403` to the shopper (`42501`), reads and writes.
5. **Storage.** `105_product_photos.sql` passed on its own. Through the
   storage API, as a visitor and as `vendedor` (TecnoCasa), only reads and
   refused writes: the waiting bucket by its public address gives _Bucket not
   found_; download and a signed link for a waiting path, of the shop's own
   (a rejected photo's) or another shop's, give `not_found`; listing the
   waiting bucket returns nothing; an upload into another shop's path, an
   overwrite of a published photo with `x-upsert` (the same bytes) or `PUT`,
   and an upload address with `x-upsert` give `Unauthorized`; the published
   photo was byte for byte the same afterwards. ⚠ No photo is waiting for
   review on the preview, and making one would need a write as a seller, so
   "a waiting file cannot be fetched" rests on the suite (which makes waiting
   rows in its rolled-back transaction) and on the refusals above, not on a
   real waiting file.
6. **Repairs.** 19 orders, 19 codes in `private.delivery_codes`,
   `orders.delivery_pin` gone. Each demo shopper read, through the API, the
   code of each of their open orders (7) and it equalled the stored one
   (compared by hash, never printed); delivered and cancelled orders show no
   code, as designed; another shopper's order is `order_not_found`. The
   preview had no return requests, so nothing was closed. The one wrong
   attempt on a stop (YT-100114) was on a delivered order and correctly not
   carried. All 3 cash stops name their own order.
7. **Payout accounts.** Stamped, as a deliberate change to the demo data,
   with one guarded statement: `payout_approved_at = now()` only where it was
   null and holder and last four digits match the seed (Cafetal Los Santos
   4066, TecnoCasa 6789, Ferretería El Higuerón 8637, Sendero 6777), raising
   unless exactly four rows matched. Four were; Bazar Nuevo (no account) was
   left alone; `payout_approved_by` stays null as in the seed; the audit
   trigger wrote one row each. The payout preview now pays three shops (the
   fourth is below the minimum); no payout run was created.
8. **Suites.** ⚠ The first full run failed four files, each for a reason in
   the test: `070_api` counted TecnoCasa's nine seed offers (the preview has
   a tenth from the photo test; it now compares with the tables and still
   requires the nine); `115_integrity` inserted sign-in rows without an id
   (the real `auth.users` has no default); `120_limits` timed the first call
   of `checkout_quote` and of `place_order` in a fresh session, which
   includes compiling the function (0.17–0.28 s here; the second call takes
   0.1 ms), so each is now called once on an empty cart first, limits
   unchanged; and `110_lockdown` demanded no default grant in any schema,
   including the platform's `storage` (point 4). `110` now leaves `storage`
   out and instead, where `supabase_storage_admin` exists, fails if
   `postgres` owns anything in `storage`. Then all 17 passed, three runs in
   a row, part 2 of `100_notifications.sql` skipped as before; locally all 17
   passed in lane 19. Row counts were identical before and after every run.
9. **Per-request check.** The shopper's token after sign-out got
   `400 session_ended` from `my_orders`, `my_roles` and `my_addresses`; a new
   sign-in worked. 30 timed calls again, in three sets: medians 55–65 ms for
   the visitor and 57–74 ms for the shopper, fastest 49–53 ms, against 54–57
   and 56–60 before: within the noise of the network.
10. **The window and the redeploy.** Between the push (23:42:52) and the
    first new deployment (23:57) the old apps ran against the new database.
    Every function the old client calls still existed; signed-in pages of all
    four apps (shop home, product, cart, orders, an order, account; seller
    home, listings, orders, payouts, stock; console home, orders, support,
    dispatch, sellers, payouts, cash; route and warehouse) loaded with no
    error before and after the push. Nothing was seen to break; actions were
    not tried in that window. The merged code reads no setting the projects
    lack (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
    `NEXT_PUBLIC_SITE_URL` on all four, `NEXT_PUBLIC_SHOP_URL` and
    `SHOP_REFRESH_KEY` where listed in step 7), so none was added. Deployed
    one at a time with Vercel CLI 65.12.1 (`--token` with a dummy value; the
    proxy adds the credential); each restored its cache and ran a full
    `next build` in 20–26 s: web `dpl_9TWf5TKW8ThfXtt5Rr3wQ7EWztbo`, vende
    `dpl_J7edsEr8W55zkFGz3VCgRHrk5zrd`, central
    `dpl_9XKkdZNhZJ2W6Zu4jPYLkLuP3ZpC`, campo
    `dpl_8ha5ta91P2EJPvK9CnfvXMmEfD3n`. Without a bypass, all 12 addresses of
    the four deployments redirect to `vercel.com/sso-api`.
11. **Smoke test** through a bypass (step 8), in Playwright, failing on any
    console error, page error, failed request or 5xx. All passed:
    - Regression at 1280 and 390 px: home (CSP, HSTS), a misspelt search, a
      product, the cart, sign-in (cookie `HttpOnly`, `Secure`), no payment
      method chosen in advance, SINPE Móvil, the simulated payment, the
      delivery code on the order page, "Mis pedidos", sign-out (orders
      YT-100359 and YT-100360); the seller centre as `vendedor`, the console
      as `central`, the route as `repartidor` and the warehouse as `bodega`,
      each signed in and out, nothing scrolled sideways.
    - The code: staff's `get_order` and `ops_delivery_code` returned no code
      for the 9 open orders; 446 responses (2.3 MB) received by staff on the
      console's orders, dispatch and support pages and all 9 order pages, by
      `bodega` on the board and 6 parcels and by `repartidor` on the route
      and both stops contained none of the 9 codes. A wrong code on stop
      YT500011 (YT-100011) at 390 px: _"Ese código no es. Quedan 4 intentos.
      Pídale al cliente que lo lea de su pedido."_; the console shows
      "Intentos fallidos del código: 1 de 5" and "El código de entrega solo lo
      ve el cliente".
    - A return on YT-100114: the shopper claimed one unit as damaged from the
      shop; staff approved it in `/atencion`, which offered no refund until
      the goods were recorded back, then refunded ₡19 900 once (one register
      row, one `return_refund` transaction of four entries summing to zero,
      payment `partially_refunded`). Posting it again: `invalid_return_state`.
      ⚠ Asking again for the same unit is refused (`invalid_quantity`), but
      the message the apps show for that code is about the cart ("Revise las
      cantidades: hay un máximo por producto en cada pedido."), not about a
      unit already returned. The shop no longer offers the form for that
      unit, so only a stale tab would see it; the message should change.
    - `sendero` asked for a new contact phone; staff saw it in
      `/cambios-tienda`, a rejection without a reason was refused, then
      rejected with one; the seller read it at 1280 and 390 px; the shop's
      contact is exactly as before.
    - The console as `central`, read only, at both widths: shop changes,
      seller payouts, drivers, staff, sellers, support, dispatch, cash,
      warehouses, catalogue, photos, messages, security, audit and two order
      pages.
12. **Afterwards.** Vercel listed no runtime error and no log line for any
    of the four projects from 23:30 to 00:13. The scheduled jobs succeeded
    every time since the push (`expire-unpaid-orders` 6 runs, about 32 ms;
    `notify-sweep` 60 runs, about 17 ms; the daily and weekly ones were not
    due); no HTTP request was queued and Vault holds no secret, so nothing
    was sent. Advisors, against the table in step 4: security 191 findings —
    `authenticated` may execute 155 definer functions (was 69) and `anon` 11
    (was 4), because the lockdown made the read functions definer functions,
    as designed; RLS with no policy on 23 tables (was 2: the dropped write
    policies leave 18 private tables and 5 public ones that only definer
    functions touch, and no API role holds a privilege on any); leaked-
    password protection off (Pro plan); `pg_net` in `public` (since `082600`,
    see point 4). The 16 "multiple permissive policies" are gone with the
    write policies. Performance: 68 unindexed foreign keys (was 39; the new
    tables' references to orders, users and items) and 14 unused indexes
    (was 19), both on demo-sized data.

The bypass secrets were made and revoked as in step 8; afterwards each
project listed none.

**For production**, the same steps on the throwaway project built for it:
the migrations now apply unchanged, so step 3 should go through at the
first `push`; repeat points 1, 4, 6 and 8 as written; point 7 does not apply
(finance approves real accounts in the console); and decide first about the
`storage` defaults and the `net` grants of point 4.

### Migrations 083200 and 083300

The database follow-ups (`083200`: the scan check at picking, checked driver
positions and action times, the district of each stop, withdrawing a return,
the final state of an order with a parcel delivered and one returned, the
fee-floor re-check, new messages, the network extension's revoke) and the web
follow-ups (`083300`: the apps' own sign-in limit). **Applied to the hosted
preview on 22 November 2026, with `083400` and `083500`, and the four apps
redeployed**; what happened is under
[What was done on the preview, 22 November 2026](#what-was-done-on-the-preview-22-november-2026).
Both were applied locally, in order, on top of a database built to `083100`
with that era's demo data and committed activity (returns, refunds, an order
with one parcel delivered and one returned, messages): both went in without
error; the four orders in that state became delivered with their windows
never shorter; every one of the 13 refunds got a confirmation
(`before_confirmations`) and no new "refund completed" message was announced;
the three cantons and 13 districts spelt "De", "Del" or "Y" were corrected;
`anon` and `authenticated` lost the use of `net`; the lockdown guard passed;
a fee change on that data paused 5 offers and planned and prepared one message
per shop.

The new apps and the new database depend on each other: the new field app
sends a scan code that the old `wms_confirm_pick` does not take, the new apps
refuse to sign anyone in without `auth_limit_reserve`, and the old field app
cannot pick any more once `083200` is in (`scan_required`). Keep the time
between step 3 and step 6 short, and do it outside warehouse hours.

Do this in order.

1. **Generate `AUTH_GUARD_KEY`** on your own machine, without printing it,
   into a file only you can read:

   ```bash
   (umask 077; openssl rand -hex 32 > ~/yuntera-auth-guard-key.txt)
   ```

   One value for all four apps. It must be 32 characters or more and not one
   of the repository's example values, or the apps treat it as missing.
2. **Set it on all four Vercel projects BEFORE redeploying**, as a sensitive
   variable for Production (`yuntera-web`, `yuntera-vende`,
   `yuntera-central`, `yuntera-campo`), from the file so it never appears on
   screen or in the shell history:

   ```bash
   VERCEL_ORG_ID=<team id> VERCEL_PROJECT_ID=<project id> \
     vercel env add AUTH_GUARD_KEY --environment production --sensitive --yes < ~/yuntera-auth-guard-key.txt
   ```

   Check in each project that it is listed (its value is hidden). While
   there: `SHOP_REFRESH_KEY` must be 32 characters or more and not
   `local-development-only` on the shop, the seller centre and the console,
   or the catalogue refresh is switched off (the shop answers 404 and the
   callers log it). Set nothing for the visitor's address on Vercel (the apps
   read `x-vercel-forwarded-for`); `AUTH_CLIENT_IP_HEADER` and
   `AUTH_CLIENT_IP_HOPS` are only for another host. **Never set
   `YUNTERA_LOCAL_RUN`** on Vercel or any deployment: it relaxes the key
   checks for the local stack and CI.
3. **Apply both migrations** with `remote-db.sh push`. Before that, read-only,
   to know what the one-off changes of `083200` will touch:

   ```sql
   -- orders that will become delivered (a parcel delivered, the rest returned)
   select o.order_number from public.orders o
   where o.status in ('shipped', 'partially_shipped')
     and exists (select 1 from public.shipments s where s.order_id = o.id and s.status = 'delivered')
     and not exists (select 1 from public.shipments s where s.order_id = o.id
                     and s.status not in ('delivered', 'returned', 'cancelled'));
   -- refunds that will be marked confirmed without a message
   select count(*) from private.refunds;
   ```

   Then `remote-db.sh status` must list 31 files as applied. What `083200`
   changes in the data, once: those orders become delivered, with
   `delivered_at` the end of their last parcel and the withdrawal window and
   warranty counted from then (never shorter than before); every refund
   already booked gets a row in `private.refund_confirmations` marked
   `before_confirmations` (so nothing is announced again); the joining words
   in canton and district names go lower case ("Montes de Oca"). It also
   drops the old signatures of `wms_confirm_pick`, `driver_arrive`,
   `driver_fail_stop` and `driver_report_position`, and stops a payment
   marked refunded from announcing "refund completed" (that now waits for
   `private.confirm_refund`).
4. **Check the network extension's grants**, right after `083200` and again
   after any upgrade, disable or re-enable of `pg_net`:

   ```sql
   -- all four must be false
   select has_schema_privilege('anon', 'net', 'usage'),
          has_schema_privilege('authenticated', 'net', 'usage'),
          has_function_privilege('authenticated', 'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'execute')
            and has_schema_privilege('authenticated', 'net', 'usage'),
          has_table_privilege('authenticated', 'net._http_response', 'select');
   -- no row for anon or authenticated
   select p.proname, a.grantee::regrole, a.privilege_type
   from pg_proc p, aclexplode(p.proacl) a
   where p.pronamespace = 'net'::regnamespace and a.grantee in ('anon'::regrole, 'authenticated'::regrole);
   -- if present, the platform may grant again when the extension is re-created
   select 1 from pg_event_trigger where evtname = 'issue_pg_net_access';
   ```

   If a check fails, the platform's own role made the grant: run section 8
   of `083200` again (it is idempotent); if that does not take, ask Supabase
   support or record it as an accepted limit. Then confirm that the
   `notify-sweep` job still succeeds (`cron.job_run_details`) and that
   `select private.notify_kick();` runs without error. Details are in
   [access control](../03-data/access-control.md).
5. **Run the suites** with `remote-db.sh test`: all 20 files, including
   `125_followups.sql` (its `net_grants` block runs the same checks as point 4
   and fails while either role can still use `net`), `130_web_followups.sql`
   (its Vault stand-in is skipped against a real Vault) and
   `135_merge_followups.sql`.
6. **Redeploy the four web apps**, one at a time, with `vercel deploy --prod`
   as in step 7. After the redeploy: staff and field users are signed out
   once (their sessions are older than the new 12-hour limit), and the
   console ends a session after 30 idle minutes; shoppers stay signed in up to
   90 days and sellers up to 30 days from their sign-in. A session that ends
   sends the person to sign in and back to the page they were on.
7. **Store the digest of the key in the project's Vault**, so that only the
   apps can call the sign-in limit. Compute it without printing the key (the
   digest itself is not the key, and cannot be turned back into it or into
   the apps' proof):

   ```bash
   (umask 077; AUTH_GUARD_KEY="$(cat ~/yuntera-auth-guard-key.txt)" node -e '
     const c = require("node:crypto");
     const proof = c.createHmac("sha256", process.env.AUTH_GUARD_KEY.trim()).update("auth-limit-caller").digest("hex");
     const digest = c.createHash("sha256").update(proof).digest("hex");
     process.stdout.write(`select vault.create_secret(${"\x27"}${digest}${"\x27"}, ${"\x27"}auth_limit_caller_digest${"\x27"});\n`);
   ' > ~/yuntera-auth-digest.sql)
   supabase/scripts/remote-db.sh sql <project-reference> ~/yuntera-auth-digest.sql
   rm ~/yuntera-auth-digest.sql
   ```

   (The same value is `printf %s "$(printf %s auth-limit-caller | openssl dgst
   -sha256 -hmac "$KEY" -r | cut -d' ' -f1)" | sha256sum`, but that puts the
   key on a command line.) Then sign in to each app once with a demo account:
   it must work. If sign-in now fails everywhere with the generic message, the
   digest does not match the key the apps hold: fix the digest with
   `select vault.update_secret((select id from vault.secrets where name = 'auth_limit_caller_digest'), '<digest>');`.
   **When the key changes**, change it on the four projects and update the
   digest together; the console's activity cookies and the "known browser"
   marks are signed with it, so console sessions end and every browser counts
   as new once.
8. **Optional, together or not at all: the human check.** Create a Cloudflare
   Turnstile widget for the apps' domains; set its public site key as
   `NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY` on all four projects and redeploy
   (it is read at build time); and switch on CAPTCHA protection with the
   Turnstile secret in Supabase Auth (Bot and Abuse Protection). Turning on
   only one side breaks sign-in: Auth then refuses every sign-in without a
   token, or the forms send one Auth does not check. Not tried on a real
   deployment.
9. **Production only (Pro plan):** switch on Auth's session time-box
   (12 hours) and inactivity timeout, so a refresh token copied out of a
   browser also ends; keep e-mail confirmation on. From now on run the
   preview's `auth-config.sh apply` with `YUNTERA_PREVIEW_CONFIRM=<ref>`.

**What breaks if a step is skipped.**

- Without `AUTH_GUARD_KEY` on a project (or with a short or example value),
  that app signs nobody in, signs nobody up and sends no reset e-mail: it
  answers with a generic message and logs the reason without the value. Token
  refreshes still go ahead (and are logged), so people already signed in stay
  signed in. Different values on different projects only split the counts
  per app, but break the Vault check of point 7 for all but one.
- Without `083300` applied, the new apps fail closed in the same way (the
  function they ask does not exist).
- Without `083200` applied, the new field app cannot confirm a pick (the
  database refuses the extra argument) and the drivers' new times and the
  return withdrawal fail; with `083200` applied and the old apps still
  deployed, picking in the old field app is refused (`scan_required`).
- Without the digest in Vault (point 7), everything works, but anyone holding
  the public key can add rows to the sign-in limit's table; they count against
  nobody and are removed within two hours. With a digest that does not match
  the apps' key, every sign-in fails closed.
- Without point 4, visitors and signed-in users may still be able to use
  `net` (not reachable through the Data API, which does not expose it).

### Migrations 083400 and 083500

Payments through a gateway (`083400`: attempts at ONVO, its signed
notifications, money kept for finance, gateway refunds completed only on the
gateway's confirmation, fees, the modes `sandbox`, `test` and `live`) and
electronic invoices (`083500`: the platform's own documents for Hacienda,
numbered without gaps, signed and sent by a worker). **Applied to the hosted
preview on 22 November 2026** (below). They go on top of `083200` and `083300`, never before:
`083400` builds on the refund confirmations of `083200`, and `083500` on both.
Applying them does not connect anything: the preview stays in `sandbox`, the
two workers are not deployed, and nothing reaches ONVO or Hacienda until the
owner has the provider's keys and the tax registration with its credentials
(`docs/06-operations/payments.md` and `invoicing.md`, "set-up").

What they change in a database that already has data, once:

- `083400`: `payments` gains `environment` and `gateway_reference` (empty for
  every existing payment); `ledger_transactions` accepts three new kinds; the
  register's refunds get their way back from now on. A refund booked before
  and never confirmed (booked in `test` or `live` mode after `083200`) gets
  one now, by transfer for real money; in a project that stayed in `sandbox`,
  every refund is already confirmed and nothing changes. Redefined:
  `refund_units` (the payment's status now follows the money, not the
  booking), `cancel_order_internal`, `confirm_refund`,
  `refund_confirm_when_nothing_moves`, `ops_confirm_payment` (refuses a
  gateway payment outside sandbox) and `account_deletion_blockers` (waits for
  money still owed). Adds the `pg_cron` job `payments-sweep` (every minute),
  which does nothing until the worker's Vault secret exists.
- `083500`: `electronic_invoices` gains the columns of a real document; the
  outbox gets a second consumer, `invoice`, for `payment.captured` and
  `fiscal.refund_booked` from now on (orders paid before have no job and get
  no document); `invoicing_issuer` starts with Hacienda's fictitious example
  and `ready: false`, so nothing is numbered and the jobs wait in order;
  `invoicing_policy.simulated_payments` is false, so the preview's simulated
  orders never become documents even once the issuer is set up. Redefines
  `delete_my_account` (erases payer details and unused factura requests; keeps
  issued documents) and adds a trigger on `auth.users`
  (`invoice_forget_receiver`). Adds the `pg_cron` job `invoice-sweep`
  (every 30 seconds).

Do this in order.

1. **Check that `083200` and `083300` are applied** (`remote-db.sh status`
   lists 31 files) and that `payments_mode` is `sandbox`:

   ```sql
   select value from public.app_settings where key = 'payments_mode';   -- "sandbox"
   -- refunds that 083400 will give a way back (expected 0 on the preview)
   select count(*) from private.refunds r
   where not exists (select 1 from private.refund_confirmations c where c.refund_id = r.id);
   ```

   If the count is not 0, stop and look at those refunds first: each will
   become a transfer for finance to make and record.
2. **Check that the platform lets the migration owner create a trigger on
   `auth.users`** (the existing `on_auth_user_created` says it does):

   ```sql
   select has_table_privilege(current_user, 'auth.users', 'TRIGGER');   -- true
   ```

3. **Apply both migrations** with `remote-db.sh push`; `remote-db.sh status`
   must then list 33 files. The demo seed (`remote-db.sh seed`, preview
   only) sets `invoicing_issuer.ready` and `invoicing_policy.simulated_payments`
   to true for Hacienda's fictitious demo issuer: if the preview is seeded
   again after this, set both back to false before any invoice worker is
   deployed there.
4. **Check what they left**:

   ```sql
   select value from public.app_settings where key = 'payments_mode';             -- still "sandbox"
   select value ->> 'ready' from public.app_settings where key = 'invoicing_issuer';             -- false
   select value ->> 'simulated_payments' from public.app_settings where key = 'invoicing_policy'; -- false
   select jobname, schedule from cron.job where jobname in ('payments-sweep', 'invoice-sweep');
   -- every refund has a confirmation or a way back
   select count(*) from private.refunds r
   where not exists (select 1 from private.refund_confirmations c where c.refund_id = r.id)
     and not exists (select 1 from private.gateway_refunds g where g.refund_id = r.id);           -- 0
   -- no API role can reach the new tables or the workers' functions
   select has_function_privilege('authenticated', 'public.worker_payments_event(jsonb)', 'execute'),
          has_function_privilege('authenticated', 'public.worker_invoice_plan(integer)', 'execute');  -- false, false
   ```

   Refunds booked before `083400` keep their amount in `refunds_payable`
   (what is owed to shoppers): nothing recorded their money leaving, because
   nothing moved it then. From `083400` on, that account equals the refunds
   not yet completed plus that older amount; finance may clear the older
   amount with an adjustment once the accountant agrees.

   Then watch `cron.job_run_details` for a few minutes: both sweeps must
   succeed (without the Vault secrets `payments_worker_token` and
   `invoice_worker_token` they wake nobody; that is expected).
5. **Run the suites** with `remote-db.sh test`: all 25 files, including
   `135_payments.sql`, `140_invoicing.sql`, `145_refunds_end_to_end.sql` and
   `150_payments_invoicing_guard.sql`. The invoicing suite's concurrency test
   (`packages/db/src/contract.invoicing.test.ts`) makes its own copy of the
   database and is for the local stack only.
6. **Redeploy the four web apps** (step 7), one at a time. The shop then shows
   the payment step and the order's documents; in `sandbox` nothing changes
   for a shopper (the simulation stays), and no document appears.
7. **A smoke test in sandbox**: a purchase with the simulation, then its
   cancellation. The order page shows the refund as completed, the shopper's
   messages hold one "refund requested" (none for a sandbox cancellation)
   and one "refund completed", and:

   ```sql
   select g.channel, g.status, c.reference from private.gateway_refunds g
   join private.refund_confirmations c on c.refund_id = g.refund_id
   order by g.requested_at desc limit 1;   -- simulated, succeeded, sandbox
   ```

**Not before the owner's set-up.** Do not deploy `payments-worker`,
`payments-webhook`, `invoice-worker` or `hacienda-callback`, do not run
`deploy-payments.sh` or `deploy-invoicing.sh`, do not set
`invoicing_issuer.ready`, and do not change `payments_mode`, until ONVO's
contract and keys (with a webhook secret per environment) and Hacienda's
registration, sandbox credentials and signing key exist. Then follow the
set-up and rehearsal in [payments](../06-operations/payments.md) and
[invoicing](../06-operations/invoicing.md): the `test` mode and Hacienda's
sandbox first, never live before the lawyer's and the accountant's answers.

**What to check on the hosted project that the local runs could not.** That
`pg_cron` runs both sweeps and `pg_net` is still closed to the API roles after
the migrations (step 4 of the section above); that the trigger on
`auth.users` exists and an account deletion through the apps still succeeds
there; that the suites pass on the platform; and the duration of each
migration (both took under a second locally on the demo data).

### What was done on the preview, 22 November 2026

All four migrations, `083200` to `083500`, in one sitting (06:00 to 06:40
UTC), in the order of both sections above. Vercel CLI 65.12.1, Playwright
in headless Chromium, the Management API through the network proxy.

1. **Recorded first.** Row counts of all 120 tables in `public`, `private`,
   `auth`, `storage`, `vault` and `net` (2 498 rows); 30 timed calls of
   `shop_path_exists` as a visitor (median 67 ms, fastest 47 ms) and of
   `my_roles` as `comprador` after one sign-in (median 56 ms, fastest 53 ms);
   the old apps' signed-in pages (shop, seller centre, console, route,
   warehouse: 20 pages) loaded without an error.
2. **`AUTH_GUARD_KEY`.** Generated with the command of point 1 into
   `/root/yuntera-auth-guard-key.txt` (mode 600) and set on the four projects
   with the command of point 2 (the CLI says "Removed trailing newline from
   stdin input"); each lists it as a sensitive Production variable. The other
   settings the merged code reads were all there (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`,
   `ENABLE_EXPERIMENTAL_COREPACK` on all four, `NEXT_PUBLIC_SHOP_URL` on the
   seller centre and the console, `SHOP_REFRESH_KEY` on those and the shop);
   nothing was added, `YUNTERA_LOCAL_RUN` and the Turnstile key were not set.
   After the redeploy the shop answered `401` (not `404`) to a refresh with a
   wrong key, so its `SHOP_REFRESH_KEY` is usable.
3. **Read-only checks, then `push`.** No order in `shipped` or
   `partially_shipped` had a parcel delivered and the rest returned; 2
   refunds; `payments_mode` `sandbox`; `has_table_privilege(current_user,
   'auth.users', 'TRIGGER')` true. `push` applied all four at the first try
   in 2.6 s (06:05:59 to 06:06:02); `status` lists 33 files. No platform
   difference this time.
4. **What they left.**
   - Both refunds got a row in `private.refund_confirmations`, reference
     `before_confirmations`, at their booking time; no `refund.completed`
     event was written; no refund lacks a confirmation or a way back, and
     `private.gateway_refunds` was empty. The cantons "Vázquez De Coronado",
     "Montes De Oca" and "Montes De Oro" and 13 districts lost their capital
     joining word. No order was in the delivered-and-returned state.
   - ⚠ **The network extension's grants are still there.** All four checks
     of point 4 are true. The schema's ACL is
     `{supabase_admin=UC/supabase_admin,=U/supabase_admin,…,anon=U/supabase_admin,authenticated=U/supabase_admin,…}`;
     its two tables give everyone (PUBLIC) every privilege and its functions
     give PUBLIC execute, all granted by `supabase_admin`, and
     `issue_pg_net_access` exists. `postgres` holds only `U` without grant
     option, so its revoke changes nothing (no error); running section 8 of
     `083200` again changed nothing. The Data API still refuses the schema
     (`406 PGRST106` for `Accept-Profile: net`). Recorded as a platform limit
     for the owner to take to Supabase support or accept; `125_followups.sql`
     fails on it (point 6).
   - The scheduled jobs: `payments-sweep`, `invoice-sweep` and
     `auth-attempts-cleanup` were added; from the push to 06:34 every run of
     every job succeeded (`invoice-sweep` and `notify-sweep` 56 each,
     `payments-sweep` 28, `expire-unpaid-orders` 5, 5 to 27 ms on average);
     `select private.notify_kick();` ran without error; `net.http_request_queue`
     and `net._http_response` stayed empty.
   - `payments_mode` still `"sandbox"`; `invoicing_issuer.ready` and
     `invoicing_policy.simulated_payments` false; no electronic invoice; the
     two worker functions not executable by `anon` or `authenticated`.
   - The guard: 94 tables (62 public, 32 private, 14 new), row-level security
     on all, 0 table, sequence or column privileges for `anon`,
     `authenticated` or PUBLIC (by `has_table_privilege` and by `aclexplode`),
     0 write policies (57 read policies), no definer function without a fixed
     `search_path`; the default privileges of `postgres` as before.
     `anon` may execute 13 functions in `public` (11 before: the two limit
     functions) and `authenticated` 181 (155).
   - What is owed to shoppers (`refunds_payable`): −1 990 000 céntimos, that
     is ₡19,900 owed, all from the return refund on YT-100114 booked at 00:09
     before these migrations. The other refund booked before (₡6,450) did not
     go through that account. Not adjusted.
5. **The digest.** Computed and stored with the commands of point 7 (the
   file under `/root`, mode 600, removed straight after); `vault.secrets`
   holds `auth_limit_caller_digest` only. `auth_limit_reserve` as a visitor
   without a proof, with a random proof and with an empty one answers
   `auth_limit_caller`; after the redeploy every app signed its demo user in.
6. **Suites.** ⚠ The first run failed nine files. One for the platform
   (`125_followups`, its last check, `net_grants`: point 4); the other eight
   for reasons in the tests, all about a preview seeded before invoicing and
   used by earlier smoke tests, each fixed without loosening what it proves:
   - `050` looked for the seed's cash stop only while `pending`; a wrong code
     at the door had left it `arrived`, which is still open.
   - `095` counted the deleted person's invitations, orders and reviews as a
     fresh seed has them (a revoked invitation and a seventh order exist);
     it now compares with what the person had before.
   - `095`, `130` and `135_merge_followups` called the sign-in limit without
     the apps' proof, which the digest now refuses. `_helpers.sql` has
     `pg_temp.set_caller_digest`, which sets the digest for the suite's own
     rolled-back transaction; `130` now tests the caller check against the
     real Vault there instead of skipping it.
   - `095`, `140` and `145` relied on the seed's settings for the demo issuer
     (ready, simulated money documented), and `140` on invoice jobs for the
     seed's payments; a database seeded before `083500` never got them, by
     design. They get them for their own transaction only
     (`pg_temp.seed_invoicing_settings`, and in `140` the jobs the route
     makes).
   - `135_payments` and `145` (`check_money`) required what is owed to
     shoppers to equal the refunds not completed; the ₡19,900 above stays
     there with nothing recording it leaving, so refunds confirmed
     `before_confirmations` without a way back are now counted apart.

   Then 23 of 24 files pass on the platform, part 2 of `100_notifications`
   skipped as before; `125_followups` fails at its last block only (sections
   1 to 7 run before it and pass). Locally all 24 pass with the changes
   (lane 19, fresh reset). Row counts were identical before and after the
   runs (134 tables, 2 555 rows), and the digest was unchanged afterwards.
   Run again after the browser checks of point 8, `140_invoicing` fails as
   well ("every job planned"): it counts every invoice job and document in
   the database, and the three simulated purchases and one cancellation those
   checks left are counted with the seed's. That is a fault in the test, not
   in what the database allows; the suites are being changed to assert on
   their own fixtures.
7. **Redeploy.** One at a time from the repository root with `vercel deploy
   --prod --yes --token dummy`, 30 to 40 s each: web
   `dpl_12nCw68ahpdAfkvuEMhwrTrVxc8h` (ready 06:19:20), vende
   `dpl_6paYVhBG7mqzCDo86Ky5hLtgcMbx`, central
   `dpl_5usvPFn9DaDvSn7vo7L8xCs9eACo`, campo
   `dpl_BYDzN2bmfP32cZeCcpZBW9kn1F3W` (ready 06:21:14). Without a bypass all
   12 addresses (each deployment's own, `<project>.vercel.app` and
   `<project>-sports-calendar.vercel.app`) answer `302` to
   `vercel.com/sso-api`, at `/` and at `/ingresar`. **The window**: from the
   push to the field app's redeploy, about 15 minutes; the old apps' 20
   signed-in pages loaded right after the push as before; picking in the old
   field app would have been refused (`scan_required`, the call it makes was
   tried on the API afterwards); no other action was tried in the window, and
   no warehouse work was going on.
8. **Smoke test** through a bypass made and revoked as in step 8 (the API
   now wants exactly 32 letters and digits), sent to the four `vercel.app`
   hosts only, failing on console errors, page errors, failed requests and
   5xx. Every script passed with no error:
   - Regression at 1280 and 390 px: home (CSP, HSTS), `licuadra` finds the
     blender, a product, choosing another zone (the "Actualizando la fecha de
     entrega…" notice was seen while the new date came), cart with IVA,
     sign-in as `comprador` (cookie `HttpOnly`, `Secure`), no payment method
     chosen in advance, SINPE Móvil, the simulated payment, a four-digit
     delivery code, "Mis pedidos", "Cerrar sesión" (YT-100783, YT-100784;
     YT-100782 from a run that stopped at a check, later cancelled); the
     seller centre, the console, the route and the warehouse as their demo
     users, signed in and out, nothing scrolled sideways. Session cookies:
     shop 90 days, seller centre 30 days, console and field app 12 hours.
   - Sign-in limit, with two throwaway accounts under `yuntera.example`
     signed up through the shop (consent box unticked at first; with
     confirmation off each was signed in at once): wrong passwords for the
     first from another browser until "Hubo demasiados intentos de ingreso.
     Por seguridad, espere 14 minutos y vuelva a intentarlo. Si no recuerda
     la contraseña, puede restablecerla con «Olvidé mi contraseña».", the
     address kept in the form; meanwhile the second signed in at 390 px. ⚠
     This network leaves through several addresses (5 attempts arrived from
     4), so the per-address bucket filled only after 21 wrong passwords; the
     6th, with the right password, still signed in. Sign-up with the first
     account's address showed "Revise su correo… Le enviamos un correo…" and
     nothing about an existing account; a new address is signed in at once
     instead, as expected with confirmation off. Auth sent nothing (it
     answers `user_already_exists` without e-mail when confirmation is off).
     Both accounts deleted themselves with "Eliminar mi cuenta" (the first
     from its own browser while the limit held it elsewhere); afterwards they
     do not sign in, and they have no session, identity or name left. ⚠ The
     first run lost the throwaways' random passwords when it stopped early;
     they were given new ones by a guarded `update` on exactly those two
     addresses, passed as a query parameter, and the second run kept them in
     a mode-600 file, removed at the end.
   - The console as `central`: all 18 sections by its menu at 1280 px and
     by the folded menu at 390 px; a search for "Andrés" found 6 orders with
     the name in neither the address bar nor any request; `/cobros` says
     "Modo de pagos: Simulación" and shows "Reembolsos por pagar ₡19 900";
     `/cobros/ajustes` "Modo actual: Simulación" and that the payment service
     has not reported; `/cobros/revision` and `/cobros/reembolsos` load;
     `/comprobantes` "La facturación electrónica no está configurada… no se
     emite ningún comprobante"; `/tarifas` loads.
   - The field app at 390 px, on YT-100783's parcel: another product's real
     code (YT-100784's) refused by the API (`scanned_wrong_item`) and on the
     screen ("Ese código no es el de este producto…"); no code at all is
     `scan_required`; the right code in lower case with spaces confirmed the
     line. `repartidor`'s eight stops all carry a district and cantón; the
     route and the open stop show "San Pedro, Montes de Oca".
   - `comprador` at 390 px withdrew the claim an earlier test left open on
     YT-100010; a second tab then asking for the same unit while this round's
     own claim was open got "Esas unidades ya están en otra solicitud de
     devolución…"; that claim was withdrawn too. Both rows now read "Usted
     retiró esta solicitud."
   - `central` closed the nine test reports on `cafe-molido-tarrazu-340g`
     with "Descartar el reporte" and the note "Reportes de una prueba
     automática del sitio de prueba; no había nada que corregir."; the
     product stays active.
   - Point 7 of the 083400 section: YT-100782 (paid by the simulation)
     cancelled by the shopper; the order page shows "Reembolsos ₡5 400
     Completado … en modo de prueba, sin dinero real"; the gateway refund is
     `simulated`, `succeeded`, confirmation `sandbox`; events `order.cancelled`
     and `refund.completed`, no `refund.requested`. Its invoice jobs wait
     (`pending`, 0 attempts) and `invoice_money_documented` is false for all
     three orders, so they will never be documented on the preview.
   - Afterwards a token after sign-out got `400 session_ended` from
     `my_orders`, `my_roles` and `my_addresses`; 30 timed calls again:
     medians 60 ms (visitor) and 53 ms (shopper), fastest 48 and 49 ms.
9. **Afterwards.** Vercel listed no runtime error and no log line for the
   four projects from 05:55 to 06:34. Every scheduled job succeeded (above).
   Advisors, against the round before: security 233 findings (was 191) —
   `authenticated` may execute 181 definer functions (155), `anon` 13 (11:
   the sign-in limit's two), RLS with no policy on 37 tables (23: the 14 new
   private tables, reached only through definer functions), leaked-password
   protection off and `pg_net` in `public` as before. Performance: 76
   unindexed foreign keys (68) and 16 unused indexes (14), on demo data.

The bypass secrets were revoked; each project lists none and all 12 addresses
redirect to the login again.

⚠ **Found, not fixed here** (STATUS, "Things to know"): cash on delivery
taken in sandbox counts as real money for invoicing
(`invoice_money_documented` checks only the sandbox provider and the test
environment), so it would be documented once an issuer is set up; the
console's invoices page and the shopper's order page say slightly wrong
things in simulation. Both are fixed by `083510`, merged since and not yet
applied ([Migrations 083510 to 083900](#migrations-083510-to-083900)).

**For production**, on the throwaway project built for it: do points 1 to 3
of the 083200 section and point 1 of the 083400 section first, all four
migrations in one `push` (they went in unchanged here); store the digest
before the first sign-in; expect the `net` grants to be the platform's as
here, and decide with Supabase support before launch; the suites should pass
as they did here on a fresh project except `125`'s last check; keep
`payments_mode` and the invoicing settings as they are until the owner's
set-up; and with e-mail confirmation on, check that sign-up with an existing
address and with a new one look the same, which the preview cannot show.

### Migrations 083510 to 083900

Four migrations merged on 22 November 2026 and applied to the hosted preview
the same evening (it now has 37; what was done is under
[What was done on the preview, 22 November 2026, evening](#what-was-done-on-the-preview-22-november-2026-evening)).
Apply them in filename order, which is also the order they need, in one
sitting:

1. `20261121083510_invoicing_fixes.sql`: simulated money kept out of
   invoicing, and what the console and the order page say about it.
2. `20261121083600_seller_listings.sql`: offers on another shop's product,
   variants on and off, a listing back to draft, the shop's description and
   logo, offers paused below the price floor.
3. `20261121083700_console_catalogue.sql`: categories, brands, search
   synonyms, review moderation, staff corrections and take-downs.
4. `20261121083900_native_accounts.sql`: the consent source on the two
   notification-settings functions.

`083510` sorts before `083600` and `083700` although it was written without
them; none of the three redefines a function another of them changes, so the
order is safe. None needs a worker, and none may be deployed for them: the
invoice jobs that `083510` ends are ended by the migration itself and by the
`invoice-sweep` job that is already scheduled, and the messages `083600` and
`083700` add are only planned, as every other message is until a worker
exists.

What they change in a database that already has data, once:

- `083510`: `payments` gains `simulated`, decided for every captured payment
  with the payments mode in force **when it was captured** (read from the
  `app_settings` audit trail by `private.payments_mode_at`), so applying it in
  any mode is safe; from now on a trigger decides it at capture. Every
  waiting invoice job for money that never gets a document (simulated money
  while `invoicing_policy.simulated_payments` is off) ends as done with
  `last_error` `simulated_money`: on the preview, the 3 waiting
  `payment.captured` jobs and the 1 waiting `fiscal.refund_booked` job.
  Redefined: `invoice_money_documented`, `open_gateway_refund`,
  `ops_resolve_payment_review` (cash or a hand-confirmed transfer in test mode
  is refunded by transfer), `invoice_plan` and `invoice_sweep`. New:
  `ops_invoicing_state` (finance) and `my_order_invoicing` (the order's
  shopper).
- `083600` and `083700`: the paused offers, hidden reviews and waiting shop
  and listing changes already on the preview stay as they are and appear in
  the new screens; existing categories, brands and reviews keep their state.
  STATUS ("Things to know", seller listings and the console catalogue) lists
  the rules they bring.
- `083900`: `set_my_notification_settings` and
  `seller_set_notification_settings` are dropped and created again with one
  more argument, `p_source`, defaulting to the website's own value
  (`web_cuenta`, `seller_cuenta`), and granted again to `authenticated`
  only. Nothing is rewritten. The websites keep working unchanged; the
  shopper app already in Google Play's internal testing (built from
  `3f251c3`) keeps working too, but its consents are still logged as given
  on the website until it is rebuilt.

Do this in order.

1. **Check the starting point**: `remote-db.sh status` lists 33 applied
   files and these four pending, and nothing else pending.

   ```sql
   select value from public.app_settings where key = 'payments_mode';             -- "sandbox" on the preview
   select value ->> 'simulated_payments' from public.app_settings where key = 'invoicing_policy'; -- false
   -- invoice jobs waiting now (4 on the preview: 3 captures, 1 refund)
   select e.topic, count(*) from private.outbox_jobs j join private.outbox_events e on e.id = j.event_id
   where j.consumer = 'invoice' and j.status <> 'done' group by 1;
   ```

2. **Apply the four** with `remote-db.sh push`; `status` then lists 37 files.
3. **Check what they left**:

   ```sql
   -- every captured payment is decided; on the preview all of them are simulated
   select simulated, count(*) from public.payments
   where status in ('captured', 'partially_refunded', 'refunded') group by 1; -- no null
   -- the jobs for simulated money ended without a document
   select j.status, j.last_error, count(*) from private.outbox_jobs j where j.consumer = 'invoice' group by 1, 2;
   -- exactly one function of each name, the new form
   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
   and p.proname in ('set_my_notification_settings', 'seller_set_notification_settings'); -- two rows, each ending in ", text)"
   select has_function_privilege('anon', 'public.set_my_notification_settings(boolean, boolean, boolean, boolean, text, boolean, text, bigint, text)', 'execute'); -- false
   ```

4. **Run the suites** with `remote-db.sh test`: all 28 files, among them
   `152_invoicing_fixes.sql`, `155_seller_listings.sql`,
   `160_console_catalogue.sql` and `170_native_accounts.sql`. Each runs in
   one transaction that is rolled back and asserts only on its own rows or
   on differences from a baseline, so the preview's orders, simulated
   payments, reviews, paused offers and waiting changes do not disturb them
   (`supabase/scripts/used-db-check.sh` proves this on a lane made to look
   like the preview). Two rows say `skipped`, as before, and no other:
   `125_followups.sql` `net_grants` (the platform's grants on schema `net`,
   made by `supabase_admin`) and `100_notifications.sql` part 2 (two workers
   at once: it needs no other session on the database and a second
   connection through `dblink`, which the hosted project refuses).
5. **Redeploy the four web apps together** (step 7): the console reads the
   new `ops_invoicing_state` fields and the catalogue screens, the shop the
   order page's invoicing texts, the brand filter and the category menu, the
   seller centre the listing and shop screens. An app deployed before the
   migrations would call functions that do not exist yet.
6. **Rebuild the shopper and seller apps after `083900` is applied**, never
   before: they now send `p_source`, which the old functions do not accept.
   Send the store builds from that code only once the preview has all four
   migrations. The drivers' and warehouse apps call neither function.
7. **A smoke test**: in the console's Comprobantes page the simulation
   notice and no "dinero real" while the preview is in `sandbox`; on a paid
   order's page in the shop the sentence for simulated money; the
   notification settings saved once from the shop's account page (the
   consent log row says `web_cuenta`).

**Not verified anywhere but locally:** Auth's rate limits on password checks
and reset e-mails (the native apps' "Olvidé mi contraseña") are not exercised
by the local API stand-in; the reset links the apps request go to
`<shop website>/auth/confirm`, which must be in the hosted project's Auth
redirect allow-list (set `EXPO_PUBLIC_SHOP_URL` in an app's build if the
website's address differs from the planned one). No native app built after
`3f251c3` has talked to the preview.

### What was done on the preview, 22 November 2026, evening

All four migrations, `083510` to `083900`, in one sitting (21:59 to 22:45
UTC), in the order above. Vercel CLI 65.12.1, Playwright in headless
Chromium, the Management API through the network proxy; worktree at
`60d7f05`.

1. **Recorded first.** `status`: 33 applied, these four pending, nothing
   else. Row counts of all 137 tables in `public`, `private`, `auth`,
   `storage`, `vault`, `net`, `cron` and `supabase_migrations` (8 882 rows).
   `payments_mode` `"sandbox"`, `invoicing_issuer.ready` false,
   `invoicing_policy.simulated_payments` false, `require_staff_mfa` false;
   invoice jobs waiting: 3 `payment.captured` and 1 `fiscal.refund_booked`
   (all `pending`); 0 table privileges of `anon` or `authenticated` in
   `public` and `private` (the 42 rows `information_schema` lists for the app
   roles are the platform's own, in `storage`, `realtime` and `extensions`);
   the 7 scheduled jobs, every run succeeded; 11 demo accounts, 0 second
   factors (the other 4 rows of `auth.users` are deleted throwaways,
   anonymised); `vault.secrets` holds `auth_limit_caller_digest` only; no
   Edge Function deployed (`GET /v1/projects/<ref>/functions` answers `[]`).
   Offer order and ratings of the 8 products with most offers or reviews
   (`audifonos-inalambricos-nimbo-aire`, `camiseta-algodon-sendero`,
   `cafe-molido-tarrazu-340g` among them). The old apps' 25 pages (visitor,
   `comprador`, `vendedor`, `central`, `repartidor`, `bodega`) loaded without
   an error, and the shopper app's client of `3f251c3` answered every read.
2. **Read-only checks.** No product `rejected` (26 active, 1 waiting for
   review, 1 archived), so no take-down the new columns would not know about;
   the 9 content reports are all `dismissed`; no hidden review (21
   published); no listing edit waiting (2 approved) and no shop change
   waiting (1 contact change rejected); all 31 offers active,
   `fee_floor_breaches` empty; no category slug that is reserved, malformed
   or deeper than three levels, no two siblings with the same folded name;
   no malformed brand slug and no two brands with the same folded name;
   payments: 21 `sandbox` and 2 `cash` captured or refunded, all in sandbox
   (25 changes of the settings are in the audit trail).
3. **`push`** applied all four at the first try in 2.2 s (22:07:21 to
   22:07:24); `status` lists 37. No platform difference; no file was edited.
4. **What they left.** Settings unmoved. Every captured or refunded payment
   has `simulated` true (23); the 3 capture jobs and the refund job ended
   `done` / `simulated_money`; 0 electronic invoices, 0 fiscal counters. The
   guard: 97 tables in `public` and `private` (3 new: `shop_logos`,
   `category_slug_aliases`, `private.offer_additions`), row-level security on
   all, 0 table, sequence or column privileges for the app roles (by
   `has_table_privilege` and by `aclexplode`), 0 write policies (58 read
   policies: the new staff read policy on `category_slug_aliases`), no
   definer function without an empty `search_path`, no non-definer function
   in `public` the app roles may call. A visitor may now call 17 functions
   (13 before: `cart_alternatives`, `category_redirect`, `get_shop`,
   `list_brands` added), `authenticated` 228 (181). One function of each
   notification-settings name, the new form, not executable by `anon`.
   `search_products` exists only with ten arguments. A token after sign-out
   still gets `400 session_ended`. The scheduled jobs kept succeeding. The 8
   products' offer order and ratings were identical. One setting was added
   (`max_new_offers_per_day_per_seller`).
5. **Suites**: all 28 pass at the first run (59 s); the only `skipped` rows
   are `125_followups` `net_grants` and part 2 of `100_notifications`. Row
   counts before and after the run were identical except for one session of
   a browser check running at the same time and the scheduler's history. No
   test or file had to change.
6. **Redeploy**, one at a time from the repository root with `vercel deploy
   --prod --yes --token dummy`, 25 to 35 s each: web
   `dpl_JBesEfvhktdf3RDwDZSNrUTbqSRy` (ready 22:16:50), vende
   `dpl_4B2XAJxRUCfL2y8zK8pqW2GUowz5`, central
   `dpl_9smbCZahkLWxYx5Z8sxhzJ8GU8vD`, campo
   `dpl_4D2v2sRnpGQj9A4rFutfAgDhDxyb` (ready 22:18:33). Without a bypass all
   12 addresses answer `302` to `vercel.com/sso-api` at `/` and `/ingresar`.
   **The window** (22:07 to 22:18): the old apps' 25 pages and 7 more
   (notification settings in the shop and the seller centre, an order page,
   the console's review queue, Comprobantes and Cobros) loaded against the new
   database; no action was tried. The old console's listing-edit approval
   would still have answered: the new `ops_review_listing_edit` takes the old
   three named arguments (the fourth has a default).
7. **The Android build of `3f251c3`.** That commit's own API client
   (`packages/db` with its response schemas), driven with the calls the
   shopper app makes, as a visitor and as `comprador`, after the push: search
   with all nine named arguments and with the subsets the home page and the
   listings send, suggestions, categories, districts, two product pages, the
   cart's lines and quote, roles, profile, addresses, orders, an order, its
   payment and its returns. Every call answered and matched the old schemas
   (the visitor's personal calls are refused `not_authenticated`, as
   before). The build never calls the notification-settings functions; its
   settings write is `update_profile` and `set_my_commercial_consent(p_opt_in,
   p_text_version, p_source)`: both sent with the stored values and
   answered. `set_my_notification_settings` with the old eight names and the
   stored values (as the old websites send it) answered too; it raised
   `comprador`'s settings version from 0 to 1.
8. **Smoke test** through a bypass made and revoked as before, sent to the
   four `vercel.app` hosts only, failing on console errors, page errors,
   failed requests and 5xx; none occurred.
   - Shop, at 1280 and 390 px, as a visitor and as `comprador`: the 14
     departments in the menu; search with and without `marca=nimbo`; the
     headphones' two offers, Sendero's (in stock, cheaper) first and
     TecnoCasa's below; `/tienda/tecnocasa`, and `404` for an unknown shop;
     the cart with IVA; checkout with no method chosen and the simulation
     notice; SINPE Móvil paid by the simulation (YT-101164, 1280 px only),
     its four-digit code on the shopper's own order page, and "Este pedido
     se pagó en modo de prueba, sin dinero real, así que no se emite ningún
     comprobante electrónico."; on YT-100010 (no delivery fee) "Este pedido no
     tuvo costo de entrega, así que Yuntera no le emite ningún comprobante.";
     sign-out. The new payment was decided `simulated` at capture and its
     invoice job ended `simulated_money` within the sweep. The shopper then
     cancelled it: refunded in the simulation, its refund job ended the same
     way.
   - Seller centre as `cafetal`: the catalogue search found Sendero's bottle
     ("Publicado por Tienda Sendero"); an offer at ₡25 000 with no stock;
     Productos listed it with "De otra tienda" and "Usted cambia su precio y
     sus existencias…" visible and no "Editar"; the bottle's page listed the
     offer below Sendero's; "Dejar de vender este producto" took it out of
     the list and the page. Cafetal's six listings have one variant each, so
     no variant can be switched off there (`last_variant`; the screen shows no
     variants section); Sendero's T-shirt's "Talla S" was switched off (gone
     from the shop within 17 s) and on again (back at the next look).
   - **The logo against the real storage service.** The browser uploaded
     three renditions of a 600 × 600 JPEG (8 953 bytes) with signed upload
     links to `product-photos-pending/<seller id>/logo/<logo id>/{400,800,1600}.jpg`
     (5 276, 8 939, 8 939 bytes: no rendition is larger than the original);
     both buckets take JPEG, PNG and WebP up to 2 MiB per file. While it
     waited: a visitor got `400 Bucket not found` at the public address and
     `Object not found` at the private one; a shopper and another shop
     (`sendero`) got `Object not found`; cafetal read its own files; a list
     of the folder came back empty for a visitor and for `sendero`; an
     overwrite by either was refused by row-level security; nothing was in
     the public bucket. Staff saw it through a signed link. On approval the
     console wrote the public sizes into `product-photos` (3 835, 6 284,
     6 284 bytes, `max-age=604800`), removed the waiting files, and the shop
     page and cafetal's product page showed it at the next look. Cafetal then
     removed it with "Quitar el logotipo": the logo is `removed`, the shop
     shows none, and its three public files stay in the bucket, unlinked
     (nothing in the product deletes them).
   - Console as `central`, at 1280 and 390 px: the nine catalogue screens
     (review queue with listing edits, a product, categories, brands, search,
     reviews, photos, logos, shop changes), none scrolled sideways. The
     Prueba description and the logo approved and shown on
     `/tienda/cafetal-los-santos`; a second request with the original text,
     approved, put the description back. A category "Prueba" under "Hecho en
     Costa Rica", the carreta filed in it by a staff correction (same
     commission), listed on `/c/hecho-en-cr`; renamed "Prueba renombrada"
     (`/c/prueba` answered `308` to `/c/prueba-renombrada`); hidden (out of
     the department page, its page `404`, the carreta still at its address and
     in search); the carreta corrected back to Artesanía and the category
     deleted (both addresses `404`). The header menu lists departments only,
     so it never showed the sub-category. Brands "Prueba Uno" and "Prueba
     Dos" created, Uno merged into Dos, Dos taken out of the filter; neither
     was ever in the shop's filter (no products). The synonym "pruebazeta" →
     "chorreador" made a search find the chorreador and, removed, nothing.
     The libreta's review hidden ("No trata del producto") and shown again:
     the product page went to "Todavía no tiene reseñas" and back to 3 of 5.
     The carreta taken down (`404`) and put back (`200`). On the hosted cache
     every one of these showed on the first look after the change, 2 to 4 s
     later. Comprobantes says "Ningún pago con dinero real espera
     comprobante." and "Este ambiente simula los pagos… 4 pagos simulados se
     cerraron sin comprobante." (orders, not jobs: the 3 closed by the
     migration and YT-101164).
   - **A catalogue form with JavaScript off** (`javaScriptEnabled: false`):
     the hosted console streams the page's content into hidden containers its
     scripts reveal, so without JavaScript the categories page shows only
     its menu, title and introduction; the create form is in the page but
     hidden and cannot be used by a person. Submitted natively by the
     browser anyway ("Prueba sin JavaScript"), the action ran (the category
     was created; then deleted) and the app answered `200 text/html`, 772 KB
     of streamed script chunks without an `<html>` or `<main>`: a blank page.
     Locally the journey blocks only the script files, so the inline scripts
     that reveal the content still run there.
   - Field app at 390 and 1280 px: `/bodega` as `bodega` and `/ruta` as
     `repartidor`, no delivery code, signed out.
9. **Afterwards.** Vercel since the deployments: no runtime error on the
   shop or the field app; 27 error lines on the console and 5 on the seller
   centre, all "The shop did not refresh its catalogue: HTTP 302, redirected
   to vercel.com" (the known effect of the shop's Vercel login). The
   scheduled jobs all succeeded. Advisors against the round before: security
   286 findings (233): `authenticated` may execute 228 definer functions
   (181), `anon` 17 (13), RLS with no policy on 39 tables (37: `shop_logos`
   and `private.offer_additions`, reached only through definer functions);
   performance 99 (92): 85 unindexed foreign keys (76), 14 unused indexes
   (16). The bypass secrets were revoked; each project lists none and all 12
   addresses redirect to the login again. Settings, the guard, the digest,
   the second factors (0), the demo accounts (11) and the absence of any Edge
   Function were as recorded at the start.

What this round left on the preview: YT-101164 of `comprador`, paid and
cancelled in the simulation (its refund, ledger rows and jobs); cafetal's
withdrawn offer on the bottle (`private.offer_additions` counts it against
the day's cap); three shop-change requests of cafetal (the Prueba
description and the original, both approved; the earlier rejected one); the
removed logo's row and its three public files; brands "Prueba Uno" (merged)
and "Prueba Dos" (out of the filter, no products), visible only in the
console, since brands cannot be deleted; `comprador`'s notification settings
at version 1 with the same values; 35 audit entries and 23 outbox events
(messages only planned, none sent); 36 sessions of demo accounts left to
expire. Nothing named Prueba is visible to a visitor: categories, brand
filter, search, shop page and redirects were checked through the API.

**For production**: the same order; the read-only checks of point 2 matter
only on a database with data. The suites should pass as here. The JavaScript-
off behaviour of point 8 is the framework's streaming, the same in
production.

## 4. Confirm the database is what the migrations say

Write these to a file and run it with `remote-db.sh sql <project-reference>
<file>` (or paste them into the dashboard's SQL editor):

```sql
select count(*) from public.districts;            -- 494
select id, active from public.delivery_zones;      -- gam-core and gam-extended active; national not
select key, value from public.app_settings;        -- payments_mode "sandbox"
select jobname, schedule from cron.job;            -- expire-unpaid-orders, refresh-product-signals,
                                                -- notify-sweep, cron-history-cleanup (082600)
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

| Setting                            | Management API field                                  | Preview (set 21 Nov 2026)                                    | Production                      |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| Site URL                           | `site_url`                                            | The shop's `vercel.app` address                              | `https://www.yuntera.cr`        |
| Additional redirect URLs           | `uri_allow_list`                                      | Each app's `/auth/confirm`                                   | Each app's production address   |
| Sign-ups allowed                   | `disable_signup` = false                              | Yes                                                          | Yes                             |
| E-mail provider                    | `external_email_enabled`                              | Enabled                                                      | Enabled                         |
| Confirm e-mail                     | `mailer_autoconfirm` (true means **no** confirmation) | **Off**: turn on with SMTP                                   | On                              |
| Minimum password length            | `password_min_length`                                 | 8, to match the apps' forms                                  | 8 or more                       |
| Leaked-password protection         | `password_hibp_enabled`                               | Off: needs the Pro plan                                      | On                              |
| Multi-factor authentication (TOTP) | `mfa_totp_enroll_enabled`, `mfa_totp_verify_enabled`  | Enabled                                                      | Enabled                         |
| Code length in e-mails             | `mailer_otp_length`                                   | 6 (the platform's default was 8)                             | 6                               |
| E-mail templates and subjects      | `mailer_templates_*`, `mailer_subjects_*`             | ⚠ Supabase's defaults: refused without SMTP on the free plan | Ours, from `supabase/templates` |
| Custom SMTP                        | `smtp_*`                                              | Not set                                                      | **Required**                    |

The Site URL and redirect URLs are set once the apps' Vercel addresses exist
(step 7). The redirect list must hold each app's `/auth/confirm` address: every
e-mail link goes there. `supabase/scripts/auth-config.sh plan <ref> preview`
shows, and `apply` sets, these settings and the Spanish e-mail templates
from `supabase/auth/*.json` and `supabase/templates` (it reads the result back
and lists any field that did not take). Both print field names only.

⚠ **Run on the preview on 21 November 2026**, with
`YUNTERA_SHOP_URL=https://yuntera-web.vercel.app` and `YUNTERA_REDIRECT_URLS`
the four apps' `https://<app>.vercel.app/auth/confirm`. The first `apply` was
refused as a whole: _"Email template modification is not available for free
tier projects using the default email provider"_. The script now leaves
templates and subjects out, and says so, while neither the project nor the
settings file has custom SMTP. It then changed exactly two fields,
`uri_allow_list` (from the four apps' `/**` to their `/auth/confirm` pages)
and `mailer_otp_length` (8 to 6), and read back no difference. Confirmation
stayed off (`mailer_autoconfirm` true).

What that means on the preview until custom SMTP is set:

- Account e-mails would go out in Supabase's default English words, with a
  link through Auth's `/verify` address rather than the app's
  `/auth/confirm?token_hash=…`. The apps' confirmation page reads only
  `token_hash`, so such a link is not expected to finish a reset (not tried).
- Auth refuses to send anything to a `.example` address
  (`email_address_invalid`, which the shop logs and hides from the person),
  and the built-in sender mails only members of the Supabase organisation,
  about twice an hour. The reset flow was therefore tested by storing a
  recovery token on a throwaway account the way Auth stores one
  (`sha224(e-mail + code)` in `auth.users.recovery_token` and
  `auth.one_time_tokens`) and opening the link our template would send.
  Sending is not verified.

Run `apply` again once SMTP is set; the templates go then.

**Which e-mails Auth sends.** Until the messaging provider is set up, Auth
sends the account e-mails itself with the templates in `supabase/templates`,
through the custom SMTP below. Once Bird is set up, the Send Email Hook
(`auth-email`, [notifications](../06-operations/notifications.md)) sends them
instead, in the same words (a test keeps the two equal); SMTP stays as the
standby.

Then check sign-up end to end: sign up a throwaway address under `.example`
through `<API address>/auth/v1/signup`. On the preview it returned a session
straight away (confirmation off), the trigger on `auth.users` created the
`profiles` row with the name given at sign-up, and the new account could call
`my_profile`, `my_roles` and `my_addresses` but not `ops_overview`. Delete the
throwaway account afterwards (`delete from auth.users where email = …`; its
identity, sessions and profile go with it) and check that nothing of it is left
in `auth.users`, `auth.identities`, `auth.sessions`, `auth.refresh_tokens` or
`public.profiles`.

Accounts are deleted with `delete_my_account` (each app's "Eliminar mi
cuenta"), which anonymises the sign-in record instead of deleting it, so use
it rather than `delete from auth.users` once orders exist. Once migration
`082500` is applied, a token whose session ended (sign-out, password change,
factor reset, deletion) stops working at once, through `check_request`
(step 3); before that it stayed valid until it expired.

E-mail confirmation and password reset exist in all four apps since
21 November 2026, verified against the local stand-in only. Keep confirmation
off on the preview until custom SMTP (or the provider) is set up.

**Custom SMTP.** Supabase's built-in e-mail sender is for testing: it is
heavily rate-limited and not meant for real users. Production needs an SMTP
provider with the sending domain authenticated (SPF, DKIM, DMARC). The
provider is not chosen.

**Staff and a second factor.** The database can require a second factor for
staff (`require_staff_mfa`). Turning it on is one statement by an admin:

```sql
update public.app_settings set value = 'true' where key = 'require_staff_mfa';
```

The console has the screens (Cuenta → Verificación en dos pasos, and the
second step at sign-in). Turn it on only once at least two administrators have
enrolled an authenticator, so either can reset the other's from `/seguridad`
(the screen warns otherwise); the break-glass procedure for a lost last
authenticator is in
[security-program.md](../05-security-compliance/security-program.md). Whatever
the setting, a staff member or seller who has a factor counts only after the
code.

**The first admin.** Staff are ordinary accounts with a row in
`staff_members`, and only an admin can add one — so the first has to be
inserted directly. Sign up through the app with the owner's e-mail, then run:

```sql
insert into public.staff_members (user_id, role)
select id, 'admin' from auth.users where email = '<owner e-mail>';
```

In the preview the seed already provides `central@yuntera.example` as an admin.

## 7. Create the Vercel projects

Done for the preview on 21 November 2026. One project per app, **not connected
to the Git repository**: a connected project builds on every push, and four
projects would each build for every commit. Deploys are uploads, on demand.

| Project           | Root directory | Preview address                    |
| ----------------- | -------------- | ---------------------------------- |
| `yuntera-web`     | `apps/web`     | https://yuntera-web.vercel.app     |
| `yuntera-vende`   | `apps/seller`  | https://yuntera-vende.vercel.app   |
| `yuntera-central` | `apps/ops`     | https://yuntera-central.vercel.app |
| `yuntera-campo`   | `apps/field`   | https://yuntera-campo.vercel.app   |

What lives in the repository, so a second environment builds the same way:
each app's `vercel.json` (framework, the `iad1` region next to the database,
and an `installCommand` that installs only that app and what it depends on,
`pnpm install --frozen-lockfile --filter @yuntera/<app>... --filter yuntera`;
the console's includes `sharp`, a declared dependency of `apps/ops`),
`engines.node` in each app's `package.json`, and the
`ENABLE_EXPERIMENTAL_COREPACK` pass-through in `turbo.json`, which makes the
hosted build use the pnpm version named in `packageManager`.

What has to be set on each project, in the dashboard or through the API:

1. **Root Directory** as above, with **Include files outside the root
   directory** on. The apps import workspace packages (`@yuntera/core`,
   `@yuntera/db`, …) from `packages/`; with this setting the build finds them.
2. Node.js 22.x.
3. **Deployment Protection → Vercel Authentication → All Deployments.** The
   team's default, "Standard", leaves the production `vercel.app` address
   public; "All Deployments" puts every address behind a Vercel login. Keep it
   on all four projects until the name has passed its trademark search and the
   shop is meant to be public; the console stays protected after that.
4. Environment variables, for the environment being deployed:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `NEXT_PUBLIC_SITE_URL` (the app's own address) and
   `ENABLE_EXPERIMENTAL_COREPACK=1`; on `yuntera-vende` and `yuntera-central`
   also `NEXT_PUBLIC_SHOP_URL` (the shop's address); and on `yuntera-web`,
   `yuntera-vende` and `yuntera-central` the same `SHOP_REFRESH_KEY`, one
   random value of 48 or more characters stored as a sensitive variable, which
   lets the seller centre and the console ask the shop to drop its cached
   catalogue ([what they are](environments.md#settings-per-app)); and, from
   the follow-ups on, `AUTH_GUARD_KEY` on all four, the same random value of
   32 or more characters stored as a sensitive variable (see
   [Migrations 083200 and 083300](#migrations-083200-and-083300)). Only
   Production has them today: a Vercel preview deployment would not reach the
   database.

Then deploy from the repository root, one app at a time (the team builds one
deployment at a time):

```bash
VERCEL_ORG_ID=<team id> VERCEL_PROJECT_ID=<project id> vercel deploy --prod
```

Redeployed after `082500`–`082700` on 21 November 2026 (Vercel CLI 65.12.1
through `npx`; where a proxy adds the credential, the CLI still wants a
`--token`, and it refuses a dummy value that contains `-`). No variable was
missing: the merged code reads only the ones above. Each build restored the
project's build cache, ran a full `next build` (turbo cache miss) and took
23–29 s from start to ready: web `dpl_DS1knYVgsotEko8j1nLFz1bPVJ3E`, vende
`dpl_Cc6BBRea5HBxNA1zQEabAJJ3fz7Z`, central
`dpl_53ETd7fLaDxTpe5D7QHxZnA2xZaW`, campo `dpl_Fdj5UcemBzV6g114GziHWQzZHDeq`.
The console's build installs `sharp`, and it ran there (step 3, point 5).

**Seed the database before building the shop.** Catalogue pages are
prerendered from the live database at build time. A shop built against an empty
database serves an empty home page until the cached copy refreshes on the next
visit (about a minute).

**Plan.** The owner's team is on Vercel's Pro plan, which is billed by use.
Vercel Authentication is included. Password Protection is a paid extra per
project and is not enabled; nothing else that bills was turned on.

## 8. Smoke test

First, without a Vercel login, every address of all four projects must redirect
to `vercel.com/sso-api`. For automated checks, generate a Protection Bypass for
Automation on the project, send it as the `x-vercel-protection-bypass` header
to the `vercel.app` hosts only, and revoke it when the check is done.

Then, on the deployed storefront, with the browser's developer tools open on
the Console and Network tabs. Every step should work with no error in the
console and no blocked request.

On 21 November 2026 steps 1–15 passed against the preview at desktop width and
at 390 px, including step 5 and the pick, pack, route and delivery chain in the
paragraph after the table (order YT-100114, route R-1034), and so did the
screens added that day: staff, drivers, warehouse workers, payout preview,
listing edits with review, and the 404 answers. Not yet done there: step 16 on
a real phone, step 17, a staff role other than administrator (the demo data has
only an administrator), and creating a payout run.

**After `082500`–`082700`, the same day.** The bypass secrets were made
without ever showing them: a random value generated in the shell into a
chmod-600 file and registered with `PATCH
/v1/projects/<id>/protection-bypass` (`{"generate":{"secret":…}}`), sent by
Playwright through a route for the four `vercel.app` hosts only, and revoked
the same way (`{"revoke":{"secret":…,"regenerate":false}}`); afterwards each
project listed no bypass and every address redirected to the login again.
Playwright failed a run on any console error, page error, 5xx or failed
request. Results:

- Regression, at 1280 and 390 px (28 checks): home (with CSP and HSTS),
  search with a typo, a product, the cart, sign-in as `comprador` (cookie
  `HttpOnly` and `Secure`), "Mis pedidos", sign-out; the seller centre as
  `vendedor`, the console as `central` and the field app as `repartidor`, each
  signed in and out. All passed, nothing scrolled sideways.
- Photos: the repository's `product-photos` journey, run against the preview
  with the shop's one-minute cache waited out (the console cannot ask the
  protected shop to refresh). Everything in step 3 above held. Two checks
  failed for reasons that were not defects and are now handled: the seller's
  preview was read before it had loaded (the journey now waits), and a
  deleted public file was still served by the CDN for a short while. The
  test listing was archived from the seller centre afterwards; the shop
  answers 404 for it and the catalogue is back to 26 active listings.
- Account, at 390 px, with a throwaway shopper signed up through the shop:
  the reset link (see step 6 for how its token was made), the new password,
  the old one refused, a change while signed in, the notification settings
  saved with the commercial consent unticked, "Eliminar mi cuenta" refusing
  a wrong password and then deleting, the same address signing up again,
  and that account deleted too. All passed.
- Console as `central`, read-only, at both widths: an order's "Mensajes"
  section, the stuck-messages page and the security page, which warns that
  no administrator has the second factor. All passed.
- Vercel runtime errors afterwards: the refused reset e-mail
  (`email_address_invalid`, step 6) on the shop, and "The shop did not
  refresh its catalogue: HTTP 302, redirected to vercel.com" on the seller
  centre and the console (below). Nothing on the field app.

While the shop is behind Vercel Authentication, the console's and the seller
centre's request to refresh the shop's catalogue is redirected to the Vercel
login and logged as an error; the shop shows approved edits within about a
minute anyway. The request works once the shop is public.

| #   | Do                                                        | Expect                                                                                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Open the home page                                        | Categories and products appear; fonts load; response headers include `content-security-policy` and `strict-transport-security` |
| 2   | Search `licuadra`                                         | The blender is found despite the typo                                                                                          |
| 3   | Search `laptop`                                           | The laptop is first, the backpack ("Salveque urbano…") second                                                                  |
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
| 15  | Open another shopper's order number by typing its address | "No encontramos esa página" (the status is 200: personal pages are streamed, see decision 6)                                   |
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
- [ ] E-mail confirmation on; custom SMTP configured and tested. Set SMTP
      **before** `auth-config.sh apply`, or the e-mail templates are left out
      (step 6). Then send one real reset to a mailbox you can read and follow
      its link to the end: on the preview the sending and the e-mail's own
      link were never tried.
- [ ] After step 3, repeat the checks of "Migrations 20261121082500 to
      20261121082700" (the per-request check, the second factor, a test
      deletion, the storage rules) on a throwaway project built the same way;
      `remote-db.sh test` will report part 2 of `100_notifications.sql` as
      skipped there, as on the preview.
- [ ] The notification sweep (`notify-sweep`) starts doing work only once the
      Vault secrets exist. Events written between the migration and that
      moment are planned when the worker first runs, so on a project that
      has had test activity, look at `private.outbox_jobs` before deploying
      the worker.
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
