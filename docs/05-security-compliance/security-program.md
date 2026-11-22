# Security program

This is the security baseline for Yuntera, sized so that one person can
actually run it. It names what is being protected and from whom, the controls
that answer each threat, the routine that keeps them working, and what to do
when something goes wrong. The target standard is OWASP ASVS Level 2. Nothing
here is a certification or an audit result: it separates what the design
already provides from what is still to do.

## What is being protected

| Asset                                                       | Why it matters                                 |
| ----------------------------------------------------------- | ---------------------------------------------- |
| Shoppers' identity, phone, address and map pin              | Physical-world risk: this is where people live |
| Money in flight: payments, cash on delivery, seller payouts | Direct loss                                    |
| Seller identity and bank details                            | Fraud and regulatory exposure                  |
| Stock records                                               | Wrong stock means broken promises and disputes |
| The integrity of prices, rankings and reviews               | The marketplace's credibility                  |
| Staff and administrative access                             | The key to everything above                    |

## Threat model

| Threat                                  | Actor                         | How it would happen                                                                  | Primary controls                                                                                                                                            |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account takeover                        | Outsider                      | Reused passwords, phishing, SIM swap                                                 | Passwordless or strong sign-in, leaked-password checks, rate limits, re-authentication before changing phone, address or payout details, sign-in alerts     |
| Payment fraud                           | Outsider                      | Stolen cards, card testing                                                           | Hosted payment fields (no card data touches Yuntera), 3-D Secure, velocity rules in `packages/core/src/risk.ts`                                             |
| Cash-on-delivery abuse                  | Shopper                       | Ordering with no intention to pay; repeated refusals                                 | Risk rules require prepayment for first-time high-value and repeat-refusal orders; refusal history per account                                              |
| Seller fraud and fake listings          | Seller                        | Selling goods they do not have, counterfeit or prohibited items, review manipulation | Identity verification at onboarding, manual approval, payouts only after delivery, reviews only from verified purchases, report button and moderation queue |
| Payout diversion                        | Outsider or insider           | Changing a seller's bank account                                                     | Re-authentication, a waiting period after a change, notification to the seller, audit trail                                                                 |
| Insider misuse                          | Staff                         | Looking up people, altering orders or payouts                                        | Least-privilege roles, multi-factor authentication, every staff action logged, two-person rule for payouts and refunds above a threshold                    |
| Personal data exposure through partners | Driver or seller              | Harvesting addresses and phone numbers                                               | Data minimisation by design ([privacy](privacy.md)): drivers see only their active route, sellers never see contact details while Yuntera delivers          |
| Proof-of-delivery fraud                 | Driver                        | Marking as delivered without delivering                                              | Delivery PIN known only to the shopper, attempt limits, position recorded at completion                                                                     |
| Cash theft or shortfall                 | Driver                        | Under-reporting cash collected                                                       | Expected cash known per route, same-day reconciliation, variance history                                                                                    |
| Scraping and bots                       | Outsider                      | Price scraping, inventory hoarding, credential stuffing                              | Edge rate limiting and bot rules, short reservation windows, purchase limits                                                                                |
| Supply-chain compromise                 | Outsider                      | Malicious dependency or build step                                                   | Lockfile, pinned versions, dependency and secret scanning in CI, minimal install scripts, protected main branch                                             |
| Secret leakage                          | Anyone with repository access | Keys committed or exposed to the browser                                             | No privileged database key in any web or mobile app; secrets only in platform secret stores; environment files ignored by git                               |
| Data loss                               | Accident                      | Bad migration, deleted project                                                       | Automated backups, point-in-time recovery when on a paid tier, restore drills                                                                               |

## Controls

### Access control

- **The database enforces who can see what.** Row-level security on every
  table is the design, with access decided by the signed-in person's role and
  ownership, so that a bug in an app cannot expose another person's data. The
  rules are specified in [privacy](privacy.md) and implemented and tested in
  the data layer (see `docs/03-data/`).
- **No privileged key in client-facing apps.** The web and mobile apps act only
  with the signed-in user's own permissions. Operations that need more run as
  narrowly scoped server-side functions that check the caller first.
- **Staff access** requires multi-factor authentication from Launch, is
  role-scoped, and is reviewed monthly. There are no shared accounts.
- **Sensitive actions re-authenticate:** changing payout details, phone number
  or email; issuing refunds; changing a staff role.

### Payments and card data

- Card numbers are entered into fields hosted by the payment gateway and never
  reach Yuntera's servers. This keeps the platform in the smallest PCI DSS
  self-assessment scope (SAQ A). The scope must be confirmed with the chosen
  gateway before cards go live.
- 3-D Secure is used wherever the gateway supports it; the research found that
  one large acquirer's terms shift fraud chargebacks to merchants that do not
  use it ([fact sheet, section 5](../research/costa-rica-fact-sheet.md#5-payments)).
- Payment confirmations are accepted only from the gateway's signed
  notifications, never from the browser.
- Orders and payments are idempotent: a retried request cannot create a second
  order or a second charge.

### Fraud and abuse

- Order risk is scored by published, explainable rules
  (`packages/core/src/risk.ts`). The score decides between approve, step-up
  (verify phone, prepay, or 3-D Secure), manual review and decline.
- The rules deliberately do **not** use the delivery district, name,
  nationality or type of identification. Judging people by where they live is
  discriminatory; risk is judged on behaviour. A test guards this.
- Seller performance (`packages/core/src/sellers.ts`) limits what an
  unreliable seller can do before a person reviews them.

### Secrets and configuration

- Secrets live only in the hosting platforms' secret stores. Nothing secret is
  committed; environment files are git-ignored and only example files are
  tracked.
- Keys are rotated on a schedule and immediately on any suspicion of exposure.
- Production and preview environments use separate projects and separate keys.

### Software supply chain and build

- Dependencies are pinned through the lockfile; install scripts that are not
  needed are disabled.
- CI runs lint, type checks, unit tests, dependency vulnerability scanning and
  secret scanning on every change; the main branch accepts changes only through
  reviewed pull requests with passing checks (see `docs/07-deployment/`).
- Static rules ban raw HTML injection and untyped escape hatches in code.

### Edge and application hardening

- All traffic over TLS; strict transport security; a content security policy;
  cookies that are HTTP-only, secure and same-site.
- A web application firewall, rate limiting and bot rules at the edge, tighter
  on sign-in, checkout, PIN entry and search.
- Input is validated at the server boundary; output is encoded by the
  framework; file uploads are type- and size-checked and stored outside the
  web root in access-controlled storage.

### Logging, audit and monitoring

- An append-only audit log records every staff action and every change to
  money, seller status, roles and prices: who, what, when, from where.
- Application errors go to error monitoring with personal data scrubbed.
- Alerts exist for the events that matter: repeated failed sign-ins, payment
  failure spikes, refund volume, PIN failures, cash variance.

### Backups and recovery

- Daily automated database backups; point-in-time recovery once on a tier that
  offers it (a cost decision, see [open questions](../08-open-questions.md)).
- A **restore drill** every quarter: restore the latest backup into a scratch
  project and place a test order. A backup that has never been restored is not
  a backup.
- Targets (assumptions to validate): lose no more than 24 hours of data in the
  Pilot, no more than 5 minutes from Launch; be back in service within 4 hours.

## The routine

Security that depends on remembering does not happen. This is the calendar.

| When                | What                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Every change        | CI checks pass; a second look at anything touching access rules, money or personal data                                             |
| Weekly (15 minutes) | Review dependency and secret-scan alerts; skim the audit log for staff actions; check error monitoring for new patterns             |
| Monthly             | Review who has staff, seller-team and warehouse access and remove what is not needed; review risk-rule outcomes and false positives |
| Quarterly           | Restore drill; rotate keys; re-read this document against reality; walk through the incident runbook                                |
| Before Launch       | Independent penetration test of the public apps and the access rules; fix findings before opening                                   |
| Yearly              | Re-assess against ASVS Level 2; update the threat model                                                                             |

## Incident response

A personal-data breach must be notified to the people affected within **5
business days** ([fact sheet, section 4](../research/costa-rica-fact-sheet.md#4-personal-data)).
The clock starts when the incident is known, so the first step is always to
write down the time.

1. **Record** the time, what was observed and who noticed.
2. **Contain**: revoke sessions and keys, disable the affected feature or
   account, preserve logs. Containment comes before diagnosis.
3. **Assess**: what data, whose, how many people, is it still happening.
4. **Notify**: affected people and PRODHAB with the nature of the incident, the
   data involved, what has been done and a contact; the payment gateway if
   payments are involved; the lawyer in every case.
5. **Recover**: fix the cause, restore from backup if needed, rotate anything
   that might have been exposed.
6. **Review** within two weeks: a written account without blame, and the one
   change that would have prevented it.

A one-page version of this runbook, with phone numbers, is kept outside the
systems it describes.

### The last administrator lost their authenticator

`ops_reset_staff_factor` never acts on oneself, so with a single administrator
who has lost the phone (and `require_staff_mfa` on) no screen can help. Prevent
it: keep two administrators with a factor before the setting goes on; the
console's _Seguridad_ screen warns while there are fewer.

If it happens anyway, the break-glass is a statement run by the database owner
(SQL editor of the hosted project, or `supabase/scripts/remote-db.sh psql`),
by someone other than the administrator concerned, after confirming who they
are by a channel other than e-mail:

```sql
begin;
-- Who: the administrator's id, checked against the staff list first.
delete from auth.mfa_factors where user_id = '<id>';
delete from auth.sessions where user_id = '<id>';
insert into private.audit_log (actor_id, action, table_name, row_key, old_row, new_row)
values (null, 'RESET_MFA_BREAK_GLASS', 'auth.mfa_factors', '<id>',
        jsonb_build_object('by', '<who ran this>', 'why', '<ticket or note>'), null);
commit;
```

The person then signs in with the password and enrols again at once. Record
the incident as above; the audit row is the trace.

## Internal security review, 21 November 2026

**Scope.** The database (every migration up to product photos), the four web
apps, the local API stand-in and the notification worker, as they stood on
21 November 2026. Native apps were in scope only as callers of the same
functions.

**Method.** Three reviewers worked from the code alone: one on what each kind
of caller could reach through the Data API, one on money and state
(refunds, returns, payments, cash on delivery, payouts, stock), one on abuse
(floods, enumeration, oversized input, accounts that should have lost
access). Every finding was reproduced on a local copy before it counted. Each
class of problem was then fixed by a separate workstream; each fix was
reviewed twice (security and behaviour), the review findings were fixed, and
the three were merged and tested together.

**What was found,** in classes (about fifty findings in all):

- _Direct table access._ Column grants and write policies let a seller attach
  an offer to another shop's listing, set a listing's tax rate, add a member
  to a shop or reopen a refunded return, and let staff read every delivery
  code.
- _Money that could move twice._ Concurrent or repeated calls could approve
  two returns of the last unit, refund a cancelled order and a return of it,
  or collect cash on delivery for goods that had come back.
- _Missing limits._ One account could fill the review queue, the dock or the
  report queue, take a product off sale with unpaid orders, or send inputs
  large enough to slow the database; a suspended driver kept reading
  recipients' addresses.
- _Disclosure by answer._ Shop registration said whether an identification
  number was already registered; reviewer names could be looked up for any
  account.

**What was fixed, and how it is kept fixed.** No app role holds a table
privilege; the guard suite fails if one comes back, if a function is not
owner's-rights with an empty search path, if a role may execute a function the
documented list does not name, or if a policy reads a table directly. Refunds
go through one register with database constraints and a commit-time check;
returns have a state machine; money-moving functions lock the order. The
delivery code is private and locked per order. Limits are settings tested at
their edge and on the honest path. Each finding has a test named after it in
`supabase/tests/110_lockdown.sql`, `115_integrity.sql` or `120_limits.sql`, or
in the two-session race tests (`packages/db/src/contract.integrity.test.ts`),
and all of them pass on the merged database.

**What remains open.**

- Actions that existed only as direct writes now have no function: a seller
  offering on another shop's existing listing, switching a variant off,
  editing the shop's description or logo, moderating reviews, editing
  categories, brands, synonyms, fees, zones, the calendar and settings, and
  ops creating warehouse locations.
- Nothing limits one person using many free accounts, and there is no edge
  rate limit. Sign-in, sign-up, account e-mails and codes have the apps' own
  limit per visitor and per account (decision 30), not Auth's alone, which
  counts the apps' server.
- The hardening is verified locally only; it is not applied to the hosted
  preview yet.
- A new fee schedule does not re-check offers against the price floor.

## Mapping to OWASP ASVS Level 2

ASVS is used as the checklist of record. The table maps its areas to where this
program addresses them; it uses area names rather than chapter numbers because
numbering differs between ASVS versions.

| ASVS area                          | Addressed by                                                                                               | State                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Architecture and threat modelling  | This document; `docs/02-architecture/`                                                                     | Designed                                                                         |
| Authentication                     | Managed authentication service; staff multi-factor; leaked-password checks                                 | Designed; staff MFA enforcement is a Launch to-do                                |
| Session management                 | Managed sessions; secure cookies; re-authentication for sensitive actions                                  | Designed                                                                         |
| Access control                     | Row-level security; no privileged key in clients; role checks in server functions                          | Built and tested locally; not yet verified on the real platform                  |
| Validation, sanitisation, encoding | Server-side validation; framework encoding; lint rules                                                     | Partly in the repo (lint rules, typed domain logic); the rest per app            |
| Cryptography and secrets           | Platform-managed encryption at rest and in transit; secret stores; rotation                                | Designed; rotation schedule is a to-do                                           |
| Error handling and logging         | Audit log; scrubbed error monitoring; alerts                                                               | Designed; alert thresholds are a to-do                                           |
| Data protection and privacy        | [Privacy](privacy.md): minimisation, retention, consent                                                    | Designed; retention jobs are a to-do                                             |
| Communications                     | TLS everywhere; strict transport security                                                                  | Provided by the hosting platforms; headers built in the shared app configuration |
| Business logic                     | Idempotent orders; atomic stock reservation; state machines (`packages/core/src/lifecycle.ts`); risk rules | Built and tested locally; risk rules specified but not applied to orders         |
| Files and resources                | Typed, size-limited uploads to access-controlled storage                                                   | Designed                                                                         |
| API and web services               | Every exposed function checks the caller; rate limits at the edge                                          | Designed; edge rules are a to-do                                                 |
| Configuration and build            | Pinned dependencies; CI scanning; separate environments                                                    | Partly in the repo (lockfile, lint, tests); CI and scanning not set up           |

## In the repository today, and not yet

Updated after the data layer and the storefront were built. Detail and
evidence are in [access control](../03-data/access-control.md),
[decisions](../02-architecture/decisions.md) and the
[go-live checklist](../07-deployment/go-live-checklist.md).

**Built and tested — on a local PostgreSQL, not yet on the real platform**

- Functions are the only door: signed-in users and visitors hold no privilege
  on any table, view or sequence, every function checks its caller, and
  row-level security on every table is the second lock. Test suites run as
  each kind of user and prove both what they can and cannot reach
  (`supabase/tests/020_access.sql`, `070_api.sql`), and a guard
  (`110_lockdown.sql`) fails if a later migration brings a table privilege
  back or adds a function outside the documented lists.
- No privileged key in any app. Staff are ordinary accounts whose reach comes
  from a revocable row. A second factor for staff and sellers (TOTP), enforced
  in the database: an account with a factor counts only after its code, and a
  setting can require one for every staff session (it ships switched off).
- A check before every Data API request (`check_request`): a deleted account
  or an ended session is refused at once, not when its token expires. Storage
  rules make the same checks themselves.
- Password reset, e-mail confirmation and account deletion in every app, with
  a per-account limit on wrong second-factor codes.
- The notification worker holds its own secret key and reaches only
  `worker_*` functions; provider webhooks are verified (Standard Webhooks)
  and applied once.
- Product photos: uploads only into reserved paths of a private bucket, no
  overwrite or shareable link for sellers, and every published photo
  re-encoded on the server (no location data, no hidden content).
- Orders, stock, delivery confirmation and cash settlement happen only inside
  database functions: idempotent order placement, atomic stock reservation,
  enforced status transitions, a ledger that must balance.
- An immutable audit log of changes to staff, sellers, drivers, settings, fees
  and payouts, holding no bank account number (last four digits only) and no
  personal column of a driver or a shop (only the names of those that changed).
- The delivery PIN is kept where no app role can read it, is shown only to
  the shopper, and locks the order after five wrong attempts across all its
  parcels; staff release it with a new code. Each wrong attempt is logged
  with the driver.
- One register for every refund, which refuses to refund the same thing twice
  or more than was paid; returns follow an enforced state machine; functions
  that move an order's money take its lock first.
- Limits per account and per target on everything that fills a queue or
  holds stock, and bounded inputs for visitors (see the review below).
- Security headers on the storefront, including a Content-Security-Policy —
  with the known trade-off that it allows inline scripts
  ([decision 7](../02-architecture/decisions.md#7-a-static-content-security-policy-with-unsafe-inline-scripts)).
- Risk scoring with explainable rules and a test that forbids location and
  identity inputs (`packages/core/src/risk.ts`) — specified, **not yet applied
  to orders**.
- Money as integers with invariants tested to the céntimo; strict typing; lint
  rules that ban unsafe patterns; environment files excluded from version
  control.

**Known gaps in what is built**

- No limit on calls per minute or on request size beyond platform defaults,
  except the apps' sign-in limit (per visitor address and per account, decision
  30); the database's other limits are per account and per target.
- Sessions end after 90 days in the shop, 30 in the seller centre, 12 hours in
  the console and the field app, and after 30 idle minutes in the console
  (decision 31); Auth's own time-box is not switched on (a Pro-plan setting).
- The human check (Turnstile) is wired into the sign-in forms but off until
  its keys are set in the apps and in Auth.
- The hardening of 21 November 2026 (migrations `082800` to `083100`) is
  verified on a local PostgreSQL only and is not applied to the hosted
  preview yet.
- Phone numbers for WhatsApp and SMS are not verified by a code.
- Continuous integration, dependency scanning and secret scanning are not set
  up.

**To do before Launch**

- Gateway integration with hosted fields and signed notifications; PCI scope
  confirmed in writing.
- Multi-factor authentication enrolled by at least two administrators, then
  `require_staff_mfa` turned on.
- Edge firewall, rate limits and bot rules configured.
- Error monitoring, alerting, the incident runbook with real contacts, and the
  first restore drill.
- A scheduled clean-up of photo files nothing needs. (The storage buckets and
  their rules were confirmed on the hosted preview on 21 November 2026.)
- Retention jobs, once the periods are confirmed.
- Independent penetration test.
- Lawyer-reviewed privacy notice and terms.
