# Support desk, system health and QA tools, researched on 24 November 2026

Written 24 November 2026. Read-only review of the repository, plus vendors'
public pricing pages read on the same day.

## Short answer

There is no separate support app and no separate IT or QA app. Part of
both already lives inside the staff console (`apps/ops`).

- **Support today:** a queue of returns, complaints and content reports, the
  staff order page, order search, and a page of stuck messages with a resend
  button. There is no inbox of conversations, no internal notes, no canned
  answers, no customer view across orders and no response-time tracking.
- **IT health today:** almost nothing you can watch. No error tracking, no
  uptime checks and no alerts are installed. Some failures are visible, each
  on its own page: stuck messages, invoice problems, refunds the gateway did
  not take.
- **QA today:** strong for a team this size. 27 automated browser journeys,
  14 phone-app journeys, 35 database test files, a lane system that builds an
  isolated copy of the whole stack, demo accounts and demo data. There is no
  written release checklist for phone builds, no bug intake and no
  production-like staging other than the hosted preview.

**Recommendation:** no new apps. Add three areas to the staff console
(support desk, system health, release checks), and buy two small things: an
error tracker and an uptime monitor, both on free tiers at first. Keep
WhatsApp conversations in the WhatsApp Business app until the volume needs a
shared inbox. Reasons and the build plan follow.

---

## 1. What exists today (verified in the repository)

### 1.1 Staff console sections

Source: `apps/ops/src/lib/staff.ts` (the `SECTIONS` list) and the pages under
`apps/ops/src/app/`. Staff roles are `admin`, `ops`, `support`, `finance`,
`catalog` (`supabase/migrations/20261121080000_foundation.sql`, line 34).
`admin` sees every section. Each database function checks the role again, so
hiding a link is never the lock.

| Section (path)                            | Who                            | What it does today                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hoy (`/`)                                 | all staff                      | Counts with deadlines first: late parcels, failed deliveries, open returns, open complaints, parcels to dispatch, cash to settle, sellers to verify; a banner when payments are in test mode                                                              |
| Pedidos (`/pedidos`, `/pedidos/[numero]`) | ops, support, finance          | Order search (by number or name), the order page: items, parcels, the messages the order produced, history in words, payment and gateway attempt with the failure reason, transfer confirmation, delivery address and phone, cancel, stop a packed parcel |
| Atención (`/atencion`)                    | support, ops, finance, catalog | Three queues, oldest first: returns (approve, reject with a note to the customer, record the goods back, record the refund), complaints (answer and close, or answer and keep open), content reports (resolve)                                            |
| Mensajes (`/mensajes`)                    | support                        | Messages that could not be sent or were reported undelivered, with the reason, a link to the order and a resend button; a warning when a channel is paused because the provider refused the credentials                                                   |
| Comprobantes (`/comprobantes`)            | finance                        | Electronic invoices rejected, waiting or unsent; replace and retry                                                                                                                                                                                        |
| Cobros (`/cobros`)                        | finance                        | Payments, reconciliation, refunds the gateway did not take with a retry, payment reviews                                                                                                                                                                  |
| Personal (`/personal`)                    | admin only                     | Staff, drivers, warehouse workers and their roles                                                                                                                                                                                                         |
| Auditoría (`/auditoria`)                  | admin only                     | Append-only trail of changes to staff, sellers, bank details, fees, settings, payouts, second factors, resent messages, catalogue. Sensitive values (IBAN, SINPE, ID, phone, e-mail, address) are shown only as "changed"                                 |
| Seguridad (`/seguridad`)                  | admin only                     | Who has two-step verification; reset a colleague's; warning when fewer than two administrators have it                                                                                                                                                    |

The delivery code is never shown to staff. The function `ops_delivery_code`
returns only how the code stands, "never the code itself"
(`supabase/migrations/20261121082900_integrity.sql`, line 2035). Staff can
release a locked code with a new one (`ops_release_delivery_code`), which the
shopper receives.

### 1.2 What a support person can and cannot do today

| Need                                                       | Today  | Where / why                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find an order by number or customer name                   | Yes    | `/pedidos`, `order-search-actions.ts`                                                                                                                                                                                                        |
| See an order's parcels, history, payment and messages sent | Yes    | `/pedidos/[numero]`                                                                                                                                                                                                                          |
| Decide a return, record goods back, record a refund        | Yes    | `/atencion`, `ops_decide_return`, `ops_receive_return`, `ops_complete_return` (refund recorded by finance or support)                                                                                                                        |
| Answer a complaint in writing                              | Yes    | `/atencion`, `ops_resolve_complaint`; the customer reads the answer                                                                                                                                                                          |
| Resolve a content report                                   | Yes    | `/atencion`, `ops_resolve_report`                                                                                                                                                                                                            |
| Resend a stuck message                                     | Yes    | `/mensajes`, `ops_retry_notification`                                                                                                                                                                                                        |
| Stop a packed parcel; release a locked delivery code       | Ops    | Order page; support cannot stop a parcel, it asks operations (`customer-service.md`, Cancellations)                                                                                                                                          |
| Inbox of WhatsApp or e-mail conversations tied to an order | **No** | Nothing in the repository receives incoming messages. The notification system only sends                                                                                                                                                     |
| Internal notes on an order or customer                     | **No** | No table or function for staff notes (searched the migrations). `customer-service.md` line 27 requires "every conversation is linked to an order or an account and summarised in a note": not built                                          |
| Saved (canned) answers                                     | **No** |                                                                                                                                                                                                                                              |
| One customer across all their orders                       | **No** | No `ops_customer` function; support sees one order at a time                                                                                                                                                                                 |
| Act for a customer (sign in as them)                       | **No** | Correct as it is. Do not build it (see section 4)                                                                                                                                                                                            |
| Response-time tracking against the targets                 | **No** | Complaints have `created_at` and `resolved_at` only (`20261121080900_trust.sql`, line 187); no first-response time, no assignee, no target. `customer-service.md` says lateness against targets "appears in the operations queue": not built |
| Complaint register with category, outcome, time taken      | Partly | The `complaints` table has category, status, resolution and dates; there is no monthly report screen                                                                                                                                         |

**A gap that touches the law.** The database function `file_complaint` and
its typed method `fileComplaint` exist (`packages/db/src/api.ts`, line 276),
but no app calls them. The shop's help page (`apps/web/src/app/ayuda/page.tsx`,
line 96) tells shoppers to complain by e-mail. `customer-service.md`
("Complaints", item 1) promises "a form linked from every page footer and every
order". So today every complaint arrives by e-mail and never reaches the
console's complaint queue unless staff type it in, which they cannot do
either. Also, the help page says "Respondemos en un máximo de 2 días hábiles",
while `customer-service.md` says acknowledgement in 1 working day and a
written answer within 5. The two must agree. Whether an e-mail address alone
meets the free complaint mechanism the law requires is for the lawyer to
confirm.

Content reports do have a form on the shop (`apps/web/src/components/report-form.tsx`).
Return and withdrawal requests have a form on the order page
(`apps/web/src/components/order-actions.tsx`).

### 1.3 What someone can see about system health today

| Signal                              | Today         | Where                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stuck or undelivered messages       | Yes           | `/mensajes`                                                                                                                                                                                                                                                                                                       |
| Invoices rejected, waiting, unsent  | Yes           | `/comprobantes`; the invoice worker reports its own health and certificate expiry to `private.invoice_worker_health` (`worker_invoice_health`, `20261121083500_invoicing.sql`, line 1297), but no screen shows that row                                                                                           |
| Gateway refunds that failed         | Yes           | `/cobros`, `ops_gateway_refunds`, retry                                                                                                                                                                                                                                                                           |
| Payment attempts that failed        | Per order     | Order page shows the failure reason; no count or trend                                                                                                                                                                                                                                                            |
| Scheduled jobs                      | **No screen** | Seven `pg_cron` jobs: `expire-unpaid-orders` (every 5 min), `refresh-product-signals` (daily 08:17), `notify-sweep` (30 s), `invoice-sweep` (30 s), `payments-sweep` (every minute), `auth-attempts-cleanup` (hourly), `cron-history-cleanup` (weekly; keeps 7 days of run history). If one stops, nobody is told |
| Errors in the apps                  | **No**        | "Configure error monitoring in every app ... Nothing is installed today" (`docs/07-deployment/go-live-checklist.md`, section 6)                                                                                                                                                                                   |
| Uptime of each app                  | **No**        | Same checklist, unticked                                                                                                                                                                                                                                                                                          |
| Alerts to the founder's phone       | **No**        | Same checklist, unticked; `security-program.md` line 272 says "alert thresholds are a to-do"                                                                                                                                                                                                                      |
| Slow pages                          | **No**        | Vercel's built-in observability exists on the plan but nobody watches it (no thresholds)                                                                                                                                                                                                                          |
| Sign-in problems                    | Partly        | Failed sign-in attempts are counted for rate limits (`auth-attempts-cleanup`); no screen or alert for a spike                                                                                                                                                                                                     |
| Versions deployed and in the stores | **No screen** | Recorded by hand in `STATUS.md` (for example the shopper app build `3f251c3`, Android draft and iPhone build 0.1.0 (4))                                                                                                                                                                                           |
| Audit of staff actions              | Yes           | `/auditoria`                                                                                                                                                                                                                                                                                                      |
| Backups and restore drill           | **Not done**  | `operations.md` and the go-live checklist; the free Supabase plan has no daily backups (see section 2.4)                                                                                                                                                                                                          |

### 1.4 What exists for testing

| Item                                    | Today  | Where                                                                                                                                   |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests, lint, typecheck             | Yes    | `pnpm lint && pnpm typecheck && pnpm test`; in CI (`.github/workflows/ci.yml`)                                                          |
| Database tests                          | Yes    | 35 files in `supabase/tests/`; also run "on a used-looking database" in CI                                                              |
| API contract tests                      | Yes    | `packages/db/src/contract.test.ts`, in CI                                                                                               |
| Browser journeys                        | Yes    | 27 journeys in `tools/e2e/journeys/`, in CI with fake payment, messaging and tax providers                                              |
| Phone-app journeys                      | Yes    | 14 journeys through the web export at phone size (`STATUS.md` line 500); no build has run on a real phone yet                           |
| Isolated test stacks                    | Yes    | `tools/dev/stack.sh up <lane>` (20 lanes)                                                                                               |
| Demo accounts and data                  | Yes    | `README.md` table; `supabase/seed.sql`; local password only in the local seed                                                           |
| Reset a test environment                | Yes    | `pnpm db:local:reset`; the hosted preview is re-seeded with a new password (`operations.md` line 155)                                   |
| Staging                                 | Partly | The hosted preview acts as staging; there is no production yet                                                                          |
| Release checklist                       | Partly | `go-live-checklist.md` for the first launch; `runbook-first-deploy.md`; nothing short and repeatable for each web deploy or phone build |
| Bug intake from staff, sellers, testers | **No** | No form, no tracker named in the docs                                                                                                   |

---

## 2. What the standard looks like (researched)

### 2.1 Support desk

What a marketplace with its own delivery needs **on day one** (pilot volume,
1 to 2 people answering). This list is drawn from the repository's own
`customer-service.md`, which already sets the right targets, and from what the
help-desk vendors put in their entry plans (section 2.4):

1. One place where every request lands, tied to an order or an account.
2. A note on each case so nobody asks the customer to repeat themselves.
3. Saved answers for the five commonest questions (where is my order, change
   the date, return, refund status, payment did not go through).
4. A clock on each case against its target, and a list of cases about to be
   late.
5. One view of the customer: all their orders, returns, complaints and
   messages.
6. A complaint register that can be reported monthly.

What changes **at ten times the volume** (several people, maybe shifts):
assignment of cases to people, a shared WhatsApp inbox with several agents on
one number, macros, tags and reports by category, satisfaction surveys, a
help-centre search so fewer people write in, and a second person approving
large refunds (already a rule in `customer-service.md`).

WhatsApp matters for cost. Since 1 July 2025 Meta charges the WhatsApp
Business Platform per message. Each business number gets 1,000 free service
messages a month, and from 1 October 2026 service messages beyond that are
charged; utility templates sent in reply are also charged from 1 October 2026.
Source: developers.facebook.com/docs/whatsapp/pricing, read 24 November 2026.
The per-message rate for Costa Rica was not read; check it on the same page
before choosing a provider. The free WhatsApp Business phone app does not use
the platform and has no per-message charge, but only allows a few linked
devices and no integration (assumption from common knowledge; verify in the
app's settings).

### 2.2 System health for a small engineering team

The standard reference is Google's SRE book, chapter "Monitoring Distributed
Systems" (sre.google/sre-book/monitoring-distributed-systems, read
24 November 2026). It names four golden signals, "latency", "traffic",
"errors" and "saturation", and says "every page should be actionable" and that
alerts should follow symptoms (what is broken for users) rather than causes.

For a team of 2 to 5 that means:

| Piece                         | What it is                                                                   | Minimum for Yuntera                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Error tracking                | Every crash in the browser, server and phone apps, grouped, with the version | One project per app; personal data scrubbed (a rule in `security-program.md`)               |
| Uptime checks                 | An outside robot opens each app every few minutes                            | Shop, seller centre, console, field app, and one database function                          |
| Job monitoring ("heartbeats") | Each scheduled job pings when it finishes; silence is an alert               | The seven `pg_cron` jobs, or one health function that reads `cron.job_run_details`          |
| Logs                          | Server logs kept long enough to investigate                                  | Vercel keeps 1 day on Pro; Supabase keeps 7 days on Pro (section 2.4). Enough to start      |
| Alerts                        | A message to a phone, only for things a person must act on                   | App down; error spike; job silent; payments failing; messages stuck; invoices rejected      |
| Feature switches              | Turn a feature off without a deploy                                          | Already partly there: `app_settings` and zone switches (`operations.md`, kill-switch table) |
| Audit                         | Who changed what                                                             | Already built (`/auditoria`)                                                                |

### 2.3 QA for a small team

The usual practice for a team this size (assumption, drawn from how the
repository already works and from common practice; no single source sets it):

1. Automated tests on every change (already done, and above the norm).
2. A staging copy with fake data (the hosted preview).
3. A one-page release checklist per kind of release: a web deploy, a database
   migration, a phone build.
4. One bug intake: a short form or a shared tracker where staff, sellers and
   testers report a problem with steps, screen and version.
5. A test plan of the 10 to 15 money and delivery paths a person walks through
   on a real phone before each phone release.

### 2.4 Build or buy: prices for a team of 2 to 5

All prices in US dollars, from each vendor's public pricing page, read
24 November 2026. "Agent" means one person answering.

**Support desk**

| Option                   | Price                                                                                                                    | WhatsApp                                               | Notes                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| Zendesk Support Team     | $19 per agent per month yearly, $25 monthly                                                                              | Not in this plan                                       | zendesk.com/pricing                                   |
| Zendesk Suite Team       | $55 yearly, $69 monthly, per agent                                                                                       | Listed, "additional fees apply"                        | zendesk.com/pricing                                   |
| Freshdesk Growth / Pro   | $19 / $55 per agent per month, yearly                                                                                    | Not mentioned on the page                              | freshworks.com/freshdesk/pricing; no free plan listed |
| Help Scout Standard      | $25 per user per month yearly, $30 monthly; free plan: 5 users, 25 contacts a month                                      | Listed from Standard                                   | helpscout.com/pricing                                 |
| Chatwoot cloud           | Free for 2 agents (live chat only, 500 conversations a month); $19 per agent Startups                                    | Not named on the page; confirm                         | chatwoot.com/pricing; open source, can be self-hosted |
| Build inside the console | No licence; builder time (estimate: 2 to 3 weeks for notes, customer view, clocks, complaint intake; inbox not included) | Needs a WhatsApp platform provider to receive messages | Keeps buyer data in one place with one set of roles   |

For 2 agents, buying costs about $38 to $138 a month (Zendesk Support Team to
Zendesk Suite Team, yearly), plus WhatsApp per-message charges. Computed from
the table.

**System health**

| Option                  | Price                                                                                                                                                           | Source                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Sentry Developer (free) | 5,000 errors, 1 user, e-mail alerts, 1 uptime monitor, 1 cron monitor                                                                                           | sentry.io/pricing       |
| Sentry Team             | $26 a month yearly, $29 monthly; 50,000 errors; unlimited users                                                                                                 | sentry.io/pricing       |
| Better Stack (free)     | 10 monitors and heartbeats, 1 status page, alerts by e-mail and Slack                                                                                           | betterstack.com/pricing |
| Better Stack extra      | 50 more monitors $21–25 a month; 10 more heartbeats $17–20 a month; logs 3 GB free                                                                              | betterstack.com/pricing |
| Vercel Pro              | $20 per developer seat a month; observability included; runtime logs kept 1 day (30 with Observability Plus, $1.20 per million events); log drains $0.50 per GB | vercel.com/pricing      |
| Supabase Pro            | From $25 a month; logs 7 days; daily backups kept 7 days; never paused. Free: logs 1 day, no daily backups, paused after a week idle                            | supabase.com/pricing    |
| Build an error tracker  | Not sensible: grouping, source maps and phone crash reports are years of vendor work                                                                            | Judgement               |

**QA and bug intake**

GitHub Issues comes with the repository at no extra cost (assumption: the
repository is on GitHub, as `.github/workflows/ci.yml` shows; check the plan).
A release checklist is a document. Nothing here needs buying.

---

## 3. Separate apps, console areas or bought tools

### 3.1 Security weighs heavily

Every extra app is one more door to the buyer data, one more place to sign in
with two-step verification, one more permission system and one more audit
trail to keep. The console already has all of that: roles checked inside each
database function, two-step verification for staff, `/auditoria`, and a rule
that sensitive values are never printed. A bought help desk copies buyer names,
phones and messages to a third party, which is a privacy matter: whether it
needs a data-processing agreement and a line in the privacy notice is for the
lawyer to confirm against `docs/05-security-compliance/privacy.md`.

### 3.2 Comparison

| Area      | Separate app                                          | Area inside the console                                              | Bought tool                                                                 |
| --------- | ----------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Support   | New door, duplicate roles; no gain                    | Reuses order page, roles, audit; most of the data is already there   | Good inbox and WhatsApp; buyer data leaves; $38+ a month for 2 people       |
| IT health | New door; the data it needs is in the database anyway | Good for what the database knows: jobs, messages, invoices, payments | Needed for what the database cannot see: crashes, uptime, alerts to a phone |
| QA        | No reason                                             | A "release checks" page that reads versions and health               | GitHub Issues for bugs (free)                                               |

### 3.3 Decisions for the owner

These questions are asked once, in the [owner decisions](../00-strategy/owner-decisions.md)
list. Questions 1 and 2 are decided (24 November 2026): support and
system-health tools live inside the staff console (D1), and system health is
watched by a console page plus a free error tracker and a free uptime monitor
(D2). Still open: which error tracker (question 5, D50), bug intake and
releases (question 3, D5, which the builders do unless the owner objects) and
when a bought WhatsApp inbox comes in (question 4, D49).

---

## 4. Build specification for the recommended option

Everything below follows the project rules: new migrations, `security definer`
functions with `set search_path = ''`, the caller checked first, errors as
`private.fail('short_code')`, granted to `authenticated` only, a database test
for the right caller, the wrong caller and what is left behind, Spanish and
English messages, zod schemas and typed methods in a new file under
`packages/db/src/areas/`, a contract test, and a journey step in
`tools/e2e/journeys/`. Words on screen are Spanish, usted.

### 4.1 Roles

No new staff role is needed at first.

| Role    | Casos (support)                               | Salud del sistema                    | Versiones and release checks |
| ------- | --------------------------------------------- | ------------------------------------ | ---------------------------- |
| support | Read and work all cases; notes; saved answers | Read the message and complaint parts | —                            |
| ops     | Read cases tied to orders; notes              | Read jobs, routes, stock             | —                            |
| finance | Read cases about payments and refunds; notes  | Read payments, refunds, invoices     | —                            |
| catalog | Read cases about listings and reports         | —                                    | —                            |
| admin   | Everything; edit saved answers                | Everything                           | Everything                   |

Optional later: an `engineering` staff role that sees health and versions but
**no buyer data at all**. Adding an enum value is a migration; decide when a
developer who is not the owner joins.

### 4.2 Screens (all inside `apps/ops`)

**A. Casos** (`/casos`, `/casos/[id]`) for support.

- List: every open case, oldest first, with type (complaint, return, report,
  contact), order number, customer first name, the target and the time left,
  and a "vence pronto" and "atrasado" label in words and colour (status is
  never colour alone).
- Case page: the request, the order summary with a link to `/pedidos/[numero]`,
  the timeline of notes and answers, a field "Nota interna" (never shown to the
  customer, said on screen), a field "Respuesta al cliente" with "Usar una
  respuesta guardada", and buttons "Responder", "Responder y cerrar",
  "Asignarme el caso".
- "Registrar un contacto": staff record a WhatsApp or phone contact as a case
  against an order or account, with a one-line summary. This is how WhatsApp
  conversations reach the register without an inbox.
- Respuestas guardadas (`/casos/respuestas`): admin edits; support uses.

**B. Cliente** (`/clientes/[id]`), reached only from an order or a case, never
by browsing a list of all customers.

- First name, district, number of orders, each order with status and date,
  returns, complaints, cases. Phone and e-mail shown only to `support` and
  `admin`, behind a "Mostrar contacto" button that writes an audit row.

**C. Shop side** (`apps/web`): the complaint form the docs already promise,
linked from the footer and from each order, calling the existing
`file_complaint`. Shows the reference number and the promised answer date.
The help page's "2 días hábiles" is corrected to match `customer-service.md`.

**D. Salud del sistema** (`/salud`) for admin, and each role sees its rows.

- One line per check, in words: "Avisos: 0 detenidos", "Comprobantes: 2
  rechazados", "Reembolsos por la pasarela: 0 fallidos", "Pagos fallidos en
  la última hora: 3", "Tareas programadas: todas corrieron a tiempo" or "La
  tarea de comprobantes no corre desde las 14:05", "Firma de comprobantes:
  el certificado vence el 3 de marzo de 2027", "Intentos de ingreso fallidos
  en la última hora: 12".
- Each line links to the page where it is fixed (`/mensajes`, `/comprobantes`,
  `/cobros`).
- No buyer names, phones, addresses, e-mails or order contents on this page.
  Order numbers only.

**E. Versiones** (a panel on `/salud`, admin only): the web commit each app
reports, the latest migration applied, and the phone builds, entered by hand
until the store APIs are connected.

### 4.3 Database functions (new migration, next timestamp)

| Function                                                                | Caller                                                          | Returns or does                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ops_cases(p_status, p_limit, p_cursor)`                                | support, ops, finance, catalog, admin; each sees its case types | Open cases with `due_at`, `first_response_at`, assignee first name, customer first name, order number                                                                                                                      |
| `ops_case(p_case_id)`                                                   | as above                                                        | One case with its timeline (notes and answers)                                                                                                                                                                             |
| `ops_record_contact(p_order_id or p_user_id, p_channel, p_summary)`     | support, admin                                                  | Creates a case of type `contact`; channel is `whatsapp`, `phone` or `email`                                                                                                                                                |
| `ops_add_case_note(p_case_id, p_body)`                                  | support, ops, finance, admin                                    | Internal note; 1 to 2,000 characters; refused (`note_contains_code`) when it looks like a 6-digit delivery code, as a guard                                                                                                |
| `ops_answer_case(p_case_id, p_body, p_close)`                           | support, admin                                                  | Writes the answer the customer reads, sets `first_response_at` once, closes if asked; sends through the existing notifications                                                                                             |
| `ops_assign_case(p_case_id)`                                            | support, admin                                                  | Assigns to the caller                                                                                                                                                                                                      |
| `ops_saved_replies()` / `ops_save_reply(...)` / `ops_delete_reply(...)` | read: support, admin; write: admin                              | Saved answers                                                                                                                                                                                                              |
| `ops_customer(p_user_id)`                                               | support, ops, finance, admin                                    | First name, district, orders, returns, complaints, cases; no contact details                                                                                                                                               |
| `ops_customer_contact(p_user_id, p_reason)`                             | support, admin                                                  | Phone and e-mail; writes an audit row with the reason                                                                                                                                                                      |
| `ops_case_report(p_from, p_to)`                                         | support, admin                                                  | Counts by type and category, share answered within target, median first response, reopened cases (the measures in `customer-service.md`)                                                                                   |
| `ops_system_health()`                                                   | any staff; rows filtered by role                                | The checks listed in 4.2 D, read from `notification_deliveries`, the invoice tables and `private.invoice_worker_health`, the gateway refund register, payment attempts, `cron.job_run_details`, the sign-in attempts table |
| `health_ping()`                                                         | `anon`                                                          | Returns `{ "ok": true }` and the latest migration name, nothing else; for the uptime monitor. Only function here granted to `anon`, because an outside robot calls it                                                      |
| `ops_versions()` / `ops_set_store_build(...)`                           | admin                                                           | Versions panel                                                                                                                                                                                                             |

Tables (all with row-level security enabled and no app role reaching them
directly): `private.cases` (type, order_id, user_id, complaint_id or
return_id or report_id, channel, status, assignee, `due_at`,
`first_response_at`, `resolved_at`, `reopened_count`), `private.case_entries`
(case_id, kind `note` or `answer`, author, body, created_at),
`private.saved_replies`, `private.store_builds`. Existing complaints, returns
and reports get a case row by trigger, so the queues in `/atencion` keep
working while `/casos` grows. `due_at` comes from the targets in
`customer-service.md`, kept in one settings table; if those targets also live
in TypeScript, add a parity test in `packages/core` as the project rules require.

New error codes need a Spanish and English message each, for example
`case_not_found`, `case_closed`, `note_contains_code`, `reply_not_found`.

### 4.4 What is logged

- Every note, answer, assignment and closure: author and time, in
  `private.case_entries` (append-only: no update or delete function).
- Every reveal of a customer's phone or e-mail: `private.audit_log` with the
  reason, shown on `/auditoria` as "Vio el contacto de un cliente".
- Every saved-answer change: `private.audit_log`.
- Error tracker and server logs: no personal data. Scrub names, phones,
  e-mails, addresses and order contents before sending; never put them in a
  URL (a project rule).

### 4.5 What must never be shown

- The delivery code, to any staff role, on any of these screens, and never in
  a note or an answer (guard in `ops_add_case_note`; the answer text is
  written by staff, so the guard applies there too).
- To sellers: only a buyer's first name and district, as today. Cases are
  never visible in the seller centre.
- On `/salud` and `/versiones`: no buyer data at all.
- To a future `engineering` role: no buyer data at all.
- No "sign in as the customer". Staff act through functions that record who
  did what.

### 4.6 Bought tools set-up (no code in the apps beyond the SDK)

1. Create an error-tracking project per app (shop, seller centre, console,
   field, and the four phone apps), with personal data scrubbing on.
2. Point an uptime monitor at the four web apps and at `health_ping`.
3. Send alerts to the founder's phone, only for: app down, error spike, a
   health line turning red for more than 10 minutes (the console page can be
   polled by the uptime monitor through a second `anon` function returning
   only "ok" or "not ok", if the owner wants that).
4. Put the error-tracker key in server-side settings only; the public key the
   browser needs is public by design, but it must not carry a secret (rule on
   `NEXT_PUBLIC_` variables).

### 4.7 QA pieces

- `docs/07-deployment/release-checklist.md`: three short lists (web deploy,
  migration, phone build), each with "run the journeys that touch it", "check
  `/salud` is green after", and for phones "walk the 12 paths on a real
  phone".
- A GitHub issue template "Problema encontrado" with steps, expected, seen,
  app and version, screenshot, and a line "No incluya datos personales de
  clientes".

### 4.8 Order to build

| Step | What                                                                                  | Why first                                                 | Estimate (assumption) |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------- |
| 1    | Error tracker and uptime monitor installed; alerts to the phone                       | Today an outage would be found by a customer              | 1 day                 |
| 2    | Shop complaint form wired to `file_complaint`; help page wording fixed                | A promise in the docs that is not kept; touches the law   | 1 day                 |
| 3    | `ops_system_health`, `health_ping`, the `/salud` page                                 | Silent job failures and stuck work become visible         | 2 to 3 days           |
| 4    | Cases: tables, triggers from complaints, returns and reports, notes, record a contact | The register and the notes `customer-service.md` requires | 4 to 5 days           |
| 5    | Clocks against targets, "vence pronto" list, a line on "Hoy"                          | Response targets become something staff can see           | 2 days                |
| 6    | Customer view and audited contact reveal                                              | One customer across orders                                | 2 days                |
| 7    | Saved answers and the monthly report                                                  | Speed and the monthly complaint review                    | 2 days                |
| 8    | Release checklist, issue template, Versiones panel                                    | Repeatable releases                                       | 1 day                 |

Estimates are for one builder who knows the repository, including tests and
journeys; verify against the pace of earlier waves in `STATUS.md`.

### 4.9 What could not be verified

- Whether a shared WhatsApp inbox provider supports Costa Rican numbers and at
  what per-message rate: not read.
- Whether Chatwoot's paid cloud plans include WhatsApp: the pricing page does
  not name it.
- Whether the free WhatsApp Business app is enough for 2 people: depends on
  its linked-device limit, not read today.
- Legal: whether an e-mail address alone satisfies the free complaint
  mechanism, and whether a bought help desk needs a data-processing agreement
  and a privacy-notice line. **For the lawyer to confirm.**

## Sources

Read 24 November 2026:

- sentry.io/pricing
- zendesk.com/pricing
- freshworks.com/freshdesk/pricing
- helpscout.com/pricing
- chatwoot.com/pricing
- betterstack.com/pricing
- vercel.com/pricing
- supabase.com/pricing
- developers.facebook.com/docs/whatsapp/pricing
- sre.google/sre-book/monitoring-distributed-systems

Repository files: `apps/ops/src/lib/staff.ts`; `apps/ops/src/app/atencion/page.tsx`,
`mensajes/page.tsx`, `auditoria/page.tsx`, `seguridad/page.tsx`,
`pedidos/[numero]/page.tsx`, `page.tsx`; `apps/web/src/app/ayuda/page.tsx`;
`apps/web/src/components/report-form.tsx`, `order-actions.tsx`;
`packages/db/src/api.ts`; `supabase/migrations/20261121080000_foundation.sql`,
`20261121080900_trust.sql`, `20261121081300_moderation.sql`,
`20261121082600_notifications.sql`, `20261121082900_integrity.sql`,
`20261121083300_web_followups.sql`, `20261121083400_payments.sql`,
`20261121083500_invoicing.sql`; `docs/06-operations/customer-service.md`;
`docs/07-deployment/operations.md`, `go-live-checklist.md`;
`docs/05-security-compliance/security-program.md`; `STATUS.md`; `README.md`;
`.github/workflows/ci.yml`.
