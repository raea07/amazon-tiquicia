# Operating the platform

The routines that keep a deployed Yuntera safe: backups and how to prove they
work, what to do when something breaks, how to rotate keys, how the database
is changed, and what it all costs.

Nothing is deployed yet, so everything here is a procedure to adopt, not a
record of practice. Each section says what exists today.

## Backups and the restore drill

**What exists today:** nothing, because there is no project. What the platform
provides depends on the plan:

|                      | Free plan                             | Paid plan            | Paid plan + point-in-time recovery                                                |
| -------------------- | ------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| Automatic backups    | None                                  | Daily, kept 7 days   | Continuous                                                                        |
| Worst-case data loss | Everything since your own last export | Up to 24 hours       | About 2 minutes                                                                   |
| Cost                 | US$0                                  | Included in the plan | About US$100 a month for 7 days of history, and it requires a larger compute size |

Source: Supabase's backup documentation, read November 2026. Database backups
do not include files in Storage.

**What 24 hours of loss means here.** Orders that shoppers paid for would
vanish from the database while the money stays with the gateway; stock,
seller balances and the ledger would be a day stale. That is recoverable by
hand at ten orders a day and not at a thousand. So:

1. **From the first real order: a paid plan.** Daily backups.
2. **Also from the first real order: your own nightly export**, kept outside
   Supabase. It protects against losing the project itself — a deleted
   project's backups are deleted with it — and against a billing or account
   problem.

   ```bash
   supabase db dump --linked -f yuntera-$(date +%F).sql
   ```

   Encrypt it, store it somewhere unrelated to Supabase, keep 30 days. This is
   a script to write and schedule; it does not exist.
3. **Point-in-time recovery when a day's orders are worth more than it
   costs.** A rule of thumb to revisit: when a typical day's order value
   exceeds a few months of the add-on's price.

### The restore drill

A backup that has never been restored is a hope. Do this before launch and
every quarter.

1. Create a scratch project (or a local database).
2. Restore: from the dashboard for a platform backup, or by loading the
   nightly export.
3. Check it:

   ```sql
   -- The ledger balances: every transaction sums to zero.
   select count(*) as unbalanced from (
     select transaction_id from public.ledger_entries
     group by transaction_id having sum(amount_minor) <> 0
   ) t;                                             -- 0

   -- Stock is consistent.
   select count(*) from public.stock_levels where reserved > on_hand;   -- 0

   -- Reservations match what stock says is reserved.
   select count(*) as mismatched from (
     select l.warehouse_id, l.sku_id, l.seller_id, l.reserved,
            coalesce(sum(r.quantity) filter (where r.status = 'active'), 0) as active
     from public.stock_levels l
     left join public.inventory_reservations r
       on (r.warehouse_id, r.sku_id, r.seller_id) = (l.warehouse_id, l.sku_id, l.seller_id)
     group by 1, 2, 3, 4
   ) s where reserved <> active;                    -- 0

   -- The newest order is as recent as you expect.
   select max(placed_at) from public.orders;
   ```

4. Point a local copy of the storefront at it and place a test order.
5. Record how long the restore took and what was newer than the backup. Those
   two numbers are the real recovery time and recovery point.
6. Delete the scratch project.

The three consistency queries are also worth running nightly on production;
any non-zero result is an incident.

## Incident response

The security programme has the breach procedure and its legal clock: people
affected by a personal-data breach must be told within **5 business days**
([security programme](../05-security-compliance/security-program.md#incident-response)).
This section is the operational side: what you can actually do, quickly, with
what is built.

### First fifteen minutes

1. **Write down the time** and what was seen.
2. **Stop the harm** with the narrowest switch that works (table below).
3. **Tell the people affected by the stop** — a line on the site, a message to
   sellers or drivers — before diagnosing.
4. Then find the cause.

### Switches that exist

| To stop…                         | Do                                                                                                                                         | Who can         | Takes effect                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------ |
| New orders everywhere            | Set every zone inactive: `update public.delivery_zones set active = false;` Checkout then refuses with "Todavía no entregamos en esa zona" | `ops`, `admin`  | Immediately at checkout. Catalogue pages keep showing delivery dates until their cache refreshes |
| New orders in one zone           | The same, for one zone                                                                                                                     | `ops`, `admin`  | Immediately                                                                                      |
| Cash on delivery                 | `update public.delivery_zones set cod_available = false;` or lower `cod_max_order_minor`                                                   | `ops` / `admin` | Immediately                                                                                      |
| Deliveries on a given day        | Add the zone and day to `zone_closures`; promises skip it                                                                                  | `ops`           | New promises only                                                                                |
| A seller                         | `ops_set_seller_status(seller, 'suspended', note)` — their offers disappear from the store                                                 | `ops`           | Immediately; cached pages within minutes                                                         |
| A listing                        | `ops_review_product(product, false, reason)` or archive it                                                                                 | `catalog`       | As above                                                                                         |
| A staff member's access          | Set `staff_members.active = false`; then ban the account in Supabase Auth to end their session                                             | `admin`         | Next request                                                                                     |
| A driver's access                | Set `drivers.status = 'suspended'`                                                                                                         | `ops`           | Next request                                                                                     |
| A bad deployment                 | Vercel: promote the previous deployment (instant rollback)                                                                                 | Owner           | Seconds                                                                                          |
| A whole app                      | Vercel: pause the project, or enable deployment protection                                                                                 | Owner           | Seconds                                                                                          |
| Everything touching the database | Supabase: pause the project, or restrict network access                                                                                    | Owner           | Minutes. Last resort: every app stops                                                            |
| A leaked key                     | Rotate it ([below](#rotating-keys))                                                                                                        | Owner           | Minutes                                                                                          |

There is no "maintenance mode" page and no switch that hides prices or the
catalogue; those would need building.

### After a bad database change

Migrations are forward-only. If one caused the problem:

1. Stop writes if data is being damaged (zones inactive).
2. Fix forward with a new migration if the fix is clear.
3. If data was destroyed, restore: to a point in time if that add-on is on,
   otherwise from the last backup — and reconcile what happened since by hand
   from the gateway's records and the outbox.

### Contacts

To be filled in before launch and kept on paper as well: gateway support and
its fraud line; Supabase support; Vercel support; the domain registrar; the
lawyer; the accountant; the backup person for operations.

### Afterwards

Within two weeks, a short written account without blame: what happened, the
timeline, what it cost, and the one change that would have prevented it.

## Rotating keys

| Key                                                       | Rotate when                                                                   | How                                                                                                                                                                                                            | Downtime                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Publishable key**                                       | Yearly; or if you want to cut off an old build                                | Create a new key in Settings → API Keys. Update `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in every Vercel project and redeploy. Confirm traffic on the new key, then delete the old one                           | None if done in that order              |
| **Session signing key**                                   | Yearly; immediately if the private key could have leaked                      | Settings → JWT keys: create a standby key, rotate to it, and revoke the previous one only after the longest session token lifetime has passed. The apps fetch the public keys from the project, so no redeploy | None                                    |
| **Secret key**                                            | Not in use. When a worker uses one: yearly, and on any staff change           | Each worker gets its own named key; create the replacement, update the function's secret, delete the old key                                                                                                   | None                                    |
| **Legacy `anon` / `service_role` keys**                   | Disable once, at setup                                                        | Settings → API Keys                                                                                                                                                                                            | —                                       |
| **Database password**                                     | Yearly; when anyone who knew it leaves                                        | Reset in Database settings; update the password manager and any CI secret                                                                                                                                      | Connections using the old password drop |
| **Payment gateway keys**                                  | Per the gateway's guidance; on any suspicion                                  | In the gateway's console; update the Edge Function secret                                                                                                                                                      | Coordinate with a quiet hour            |
| **SMTP credentials**                                      | Yearly                                                                        | In the mail provider; update Supabase Auth settings                                                                                                                                                            | None                                    |
| **Preview demo password**                                 | Whenever the preview has been shown to someone new who should not keep access | Re-seed the preview with a new `app.seed_password`                                                                                                                                                             | Preview data resets                     |
| **Personal access tokens** (Supabase CLI, Vercel, GitHub) | Yearly; on device loss                                                        | Each platform's account settings                                                                                                                                                                               | None                                    |

**When someone leaves** — staff, a contractor, a driver:

1. Deactivate their row: `staff_members`, `seller_members`, `warehouse_staff`
   or `drivers`. Their permissions end on the next request.
2. Ban or delete the account in Supabase Auth to end the session.
3. Remove them from the Supabase organisation, the Vercel team, the GitHub
   repository, the gateway console, the mail provider, the password manager.
4. Rotate anything they knew: the database password, the preview password.
5. Check `audit_entries` for what they changed recently.

**If a key leaks**, treat it as an incident: rotate first, then look at the
logs for what was done with it. The publishable key is public by design and
its exposure is not a leak; a secret key, the database password or the signing
key's private part is.

## Migrations policy

The database is the system, so changing it is the riskiest routine act.

**Before the first deployment** the migration files may still be edited in
place, since no database depends on them. **From the first deployment on:**

1. **Append-only.** Never edit or delete a migration that has been applied
   anywhere. Every change is a new file named
   `YYYYMMDDHHMMSS_what_it_does.sql`.
2. **Forward-only.** There are no down migrations. A mistake is fixed by the
   next migration. This is honest about what is possible: you cannot un-drop a
   column.
3. **One concern per migration**, small enough to read in full.
4. **It must build from zero.** `pnpm db:local:reset` and `pnpm db:local:test`
   pass with the new file, and so do the unit tests — the parity tests read
   the SQL and will fail if a constant changed on one side only.
5. **Destructive changes go in two steps**, in separate deploys. Add the new
   column or table and have the functions write both; later, once nothing reads
   the old one, remove it. Never rename or drop in the same release that stops
   using something.
6. **A new table brings its own protection in the same file:**
   `enable row level security`, the minimum grants, a policy for each granted
   operation, and a block in `supabase/tests/020_access.sql`. The blanket
   "enable row-level security on every table" statement ran once, in the
   access-control migration; it does not cover tables created later.
7. **A new or changed function** follows the
   [checklist](../03-data/access-control.md#checklist-adding-a-function-safely).
   Two traps: grants belong to a function's exact argument list, so changing
   the arguments creates a new function that nobody can call until it is
   granted — and leaves the old one behind until it is dropped. And replacing
   a function's body takes effect instantly for every app, including old
   builds still open in someone's browser: change payloads additively.
8. **Reference data is data.** New fee schedules, zones, holidays and
   categories are rows, inserted by a migration or by staff through the
   console — never by editing an old migration. A fee change is a new
   `fee_schedules` version with an effective date, mirrored in
   `packages/core/src/fees.ts`.
9. **Order of rollout.** Preview first; run the smoke test; then production,
   by a person, at a quiet hour, with a fresh export taken immediately before.
   Apply the database change before deploying an app that needs it, and make
   the change compatible with the app version that is already live.
10. **No hand edits in production.** Not to schema, and not to business data.
    A correction to an order, a stock count or the ledger goes through a
    function or a recorded script, so the audit trail explains it. The ledger
    and the stock ledger cannot be edited at all; corrections are new entries.

Long-running statements — building an index on a large table, backfilling a
column — need care once tables are big: create indexes concurrently, backfill
in batches. Not a concern at pilot size; a concern later.

## What it costs

Every figure is a published list price as read in November 2026, or carried
from the research, and **must be checked against the provider's current
pricing page** before relying on it. Per-transaction costs are in the
[business model](../00-strategy/business-model.md). Nothing has been bought.

### Platform, per month

| Item                             |  Preview |                                                                            Production, minimum | Notes                                                                                                                                                      | Source                |
| -------------------------------- | -------: | ---------------------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Supabase organisation plan       |     US$0 |                                                                                          US$25 | Or US$0 extra if the project goes in the owner's existing paid organisation                                                                                | Supabase pricing docs |
| Supabase compute for the project |     US$0 |                                                                                        US$0–10 | The plan includes a US$10 compute credit, which covers one smallest-size project. In the existing organisation that credit is already used, so about US$10 | Supabase pricing docs |
| Point-in-time recovery, 7 days   |        — | US$0 at first; about US$100 when adopted, plus roughly US$5 for the larger compute it requires | Optional; see backups                                                                                                                                      | Supabase PITR docs    |
| Vercel                           |     US$0 |                                                                    About US$20 per team member | The free plan excludes commercial use. **Estimate from memory; verify**                                                                                    | Vercel pricing page   |
| Transactional e-mail (SMTP)      |     US$0 |                                                                                        US$0–20 | Provider not chosen; most have a free tier that covers a pilot. **Estimate**                                                                               | —                     |
| Error monitoring, uptime checks  |     US$0 |                                                                                           US$0 | Free tiers are enough to start. **Estimate**                                                                                                               | —                     |
| Off-site backup storage          |        — |                                                                                     Under US$1 | A few small encrypted files. **Estimate**                                                                                                                  | —                     |
| **Total**                        | **US$0** |                                                                             **About US$45–75** | Before point-in-time recovery; without transaction fees                                                                                                    |                       |

### Per year

| Item                              |           Cost | Source                                                                         |
| --------------------------------- | -------------: | ------------------------------------------------------------------------------ |
| `yuntera.com`                     |    About US$12 | [Naming report](../brand/naming.md)                                            |
| `yuntera.app`                     |    About US$15 | Naming report                                                                  |
| `yuntera.cr`                      | US$70 plus IVA | [Fact sheet, section 9](../research/costa-rica-fact-sheet.md#9-business-setup) |
| Trademark, per class              |          US$50 | Fact sheet, section 9                                                          |
| PRODHAB registration, if required |         US$200 | [Open question 35](../08-open-questions.md)                                    |

### Per transaction

| Item                          | Cost                         | Source                                                         |
| ----------------------------- | ---------------------------- | -------------------------------------------------------------- |
| Card payment                  | 3.9%–4.25% + US$0.35         | Fact sheet, section 5; published prices, low–medium confidence |
| SINPE Móvil through a gateway | 1.5%–2%, up to US$0.35 fixed | Same                                                           |
| Gateway payout to a seller    | US$3 at one gateway          | Same                                                           |

### Not costed here

The costs that will dwarf the platform's: the driver, the storage space,
packaging, insurance, the lawyer, the accountant, the invoicing provider, a
penetration test. They are in the business model as assumptions, or not yet
estimated at all. The native apps, when built, add developer accounts with
Apple and Google.

### When the platform bill grows

| Trigger                                           | Change                                | Roughly                                  |
| ------------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| Database CPU or memory regularly near its limit   | Next compute size                     | Each step about doubles the compute line |
| A day's orders are worth protecting to the minute | Point-in-time recovery                | About US$100 a month                     |
| More people need to deploy                        | More Vercel seats                     | Per seat                                 |
| Traffic beyond the plan's included usage          | Usage-based overage on both platforms | Set spend caps and alerts on day one     |

Set a spending cap or a billing alert on both platforms before anything is
public. A marketplace with no orders should cost what the table says, and a
bill that does not is the earliest warning of abuse.
