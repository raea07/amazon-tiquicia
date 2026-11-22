# Status

Updated 22 November 2026, after the payment gateway and electronic invoicing
were merged on top of both follow-ups: payments through ONVO in two new modes
(`test`, `live`) with cards on its hosted page, SINPE Móvil matched by the
payer, refunds sent through it and completed only on its confirmation, and a
finance section in the console (migration `083400`); and the platform's own
electronic documents for Hacienda, signed and sent by a worker, shown on the
shopper's order and in the seller's statements (migration `083500`). Both
work only against local fakes. **Migrations `083200`, `083300`, `083400` and
`083500` are NOT on the hosted preview yet, and the web apps there are NOT
redeployed with these changes**: the preview still runs the 29 migrations and
the apps of the earlier round, and **it still simulates payments** (the steps
are in the runbook, sections
[083200 and 083300](docs/07-deployment/runbook-first-deploy.md#migrations-083200-and-083300)
and [083400 and 083500](docs/07-deployment/runbook-first-deploy.md#migrations-083400-and-083500)).
This is the honest state of the project: what exists, how far it was checked,
and what only the owner can do.

## In one paragraph

Yuntera is a marketplace with its own warehouse and delivery, designed for
Costa Rica. The whole product works on a development machine: a shopper can
search, buy and pay; a seller can register, list with photos, edit listings,
stock, pack and see what they will be paid; staff can verify sellers, review
products, photos and listing edits, add staff, drivers and warehouse workers,
plan routes, settle cash, refund returns and pay sellers; a driver can deliver
against the customer's code; a warehouse worker can pick, pack and receive.
Everyone can reset a password, confirm their e-mail and delete their account;
staff and sellers can add a second factor; messages for every step of an order
are planned and sent, but only to local fake providers. **A hosted preview
exists.** The database is a Supabase project in your separate free
organisation, with all 29 migrations applied, the security review's fixes
included, and the demo data loaded. The notification worker is not deployed, so
nothing is sent. Since the review, apps and visitors can reach the database
only through its functions: no table is readable or writable directly. The
four web apps are deployed as a preview on Vercel at
`yuntera-web`, `yuntera-vende`, `yuntera-central` and `yuntera-campo` (each
`.vercel.app`); every address is behind a Vercel login, and the projects are
not connected to the Git repository. A shopper app for iOS and Android exists
with every shopping flow of the website, and the seller, driver and warehouse
apps have the flows of their web counterparts (the drivers' app also shares
the position during a route and works without signal; the sellers' app still
lacks the shop's team and the reviewed changes to its details, see "Not
built"); none of those three has been built for a phone yet. The shopper
app's first store build for Android exists and waits for your Google key to
go to Play's internal testing; no build has run on a phone or simulator yet.
Payments and electronic invoices now exist as code, run against local fakes
of the gateway and of Hacienda: nothing has charged a card, refunded money or
sent a document to Hacienda, and no message is sent for real (see "Not
built").

## What needs you

In the order that unblocks the most.

1. **Register `yuntera.cr` and do the trademark search.** `yuntera.com` and
   `yuntera.app` were bought on 21 November 2026 through your Vercel team
   (registrant: Astra Vier Solutions; auto-renew on; US$12.03 and US$9.99 for
   the first year). `yuntera.cr` cannot be bought there: register it at NIC
   Costa Rica or a reseller. The availability checks are **not** a trademark
   search; that has to be done at the Registro Nacional before the name is used
   in public. Details are in [`docs/brand/naming.md`](docs/brand/naming.md).
2. **Have a Costa Rican lawyer and an accountant read the compliance
   documents.** They were written from public sources by an AI, not by a
   professional: consumer law, electronic invoicing, IVA on a marketplace,
   data protection, and how drivers are engaged. See
   [`docs/05-security-compliance/`](docs/05-security-compliance/) and the open
   questions in [`docs/08-open-questions.md`](docs/08-open-questions.md). The
   four research notes in [`docs/research/`](docs/research/) were fact-checked
   on 21 November 2026 and add these questions for them:
   1. The central bank caps what a card acquirer may take from a merchant on
      Costa Rican cards at 1.95%, but the gateways' published card prices
      (3.9% + US$0.35 and 4.25% + US$0.35) are above it. The card cost in the
      fee schedule is therefore an assumption.
   2. Collecting shoppers' money and paying sellers out may require
      registration with the financial supervisor (SUGEF) above a volume the
      press puts at about US$400,000 in 12 months.
   3. Strong customer authentication (3-D Secure) is required for online
      payments with Costa Rican cards.
   4. Whether a platform seller report was already due for 2025.
   5. Store accounts in the company's name need a legal
      entity, a D-U-N-S number, a public website and a work e-mail on the
      company's own domain.
3. **Decide two small privilege questions the hosted run left open**
   ([runbook](docs/07-deployment/runbook-first-deploy.md#migrations-20261121082800-to-20261121083100),
   point 4). Neither is reachable today; both are a one-line revoke if you
   want them closed before production:
   1. Supabase gives visitors and signed-in users everything on any table,
      sequence or function that `postgres` creates in the `storage` schema.
      Nothing of ours is there, and the lockdown leaves the platform's schemas
      alone, so the guard test now proves that `postgres` owns nothing in
      `storage` instead of failing on the platform's setting.
   2. The `pg_net` extension lets visitors and signed-in users call its web
      request functions and read its responses. The API does not expose its
      schema, so nobody can reach them over the internet. Migration `083200`
      revokes this; whether the revoke holds on the hosted project, and after
      an upgrade of the extension, must be checked there with the queries in
      the runbook once it is applied.

   Migrations `082800` to `083100` are applied to the preview (that item is
   done), and the four web apps are redeployed with them. The four demo
   shops' payout accounts were loaded before approvals existed; I stamped
   exactly those four as approved, as the seed does, so payout runs on the
   preview include them again.
4. **Take migrations `083200` and `083300` to the preview and redeploy the
   four web apps**, in the order the
   [runbook](docs/07-deployment/runbook-first-deploy.md#migrations-083200-and-083300)
   gives: generate `AUTH_GUARD_KEY` and set it on all four Vercel projects
   **before** redeploying (the new apps sign nobody in without it), apply both
   migrations, check the network extension's grants, run the suites,
   redeploy, then store the key's digest in the project's Vault. Staff and
   field users are signed out once by the new session limits.
   Then **`083400` and `083500`**, by their own
   [runbook section](docs/07-deployment/runbook-first-deploy.md#migrations-083400-and-083500):
   the preview stays in sandbox mode, nothing is invoiced, and the payments
   and invoice workers are not deployed until you have ONVO's keys and the tax
   credentials (item 6).
5. **Open a pull request for this branch** (`claude/vigilant-edison-lh64v2`)
   when you want it on `main`. I did not open one because you had not asked.
   The CI workflow will run for the first time then; its steps were run by hand
   here but it has never run on GitHub.
6. **Business set-up that only you can do:** the legal entity, a bank
   account, and the support mailboxes the screens mention (`ayuda@yuntera.cr`
   does not exist yet).
   1. **Payments:** a contract with ONVO, its onboarding and payout account,
      the written questions to ONVO, a webhook endpoint and secret per
      environment, the Supabase and Vault secrets, then
      `supabase/scripts/deploy-payments.sh` (never run) and a rehearsal in
      `test` mode before `live`. Every step:
      [`docs/06-operations/payments.md`](docs/06-operations/payments.md).
   2. **Electronic invoices:** registration with Hacienda as an electronic
      issuer (TRIBU-CR) with the activity codes, the company's real data in
      `invoicing_issuer`, the sandbox user and password, a signing key and its
      PIN, the secrets, `supabase/scripts/deploy-invoicing.sh` (never run) and
      certification in Hacienda's sandbox before production. Every step:
      [`docs/06-operations/invoicing.md`](docs/06-operations/invoicing.md).
   3. **For the lawyer:** whether the central bank's 1.95% cap on card
      acquiring allows the gateway's published card price; whether collecting
      shoppers' money and paying sellers needs SUGEF registration; how long
      fiscal documents naming a deleted shopper must be kept.
   4. **For the accountant** (the full list of 14 is in invoicing.md): who
      issues the delivery fee's document; fee facturas per order or per
      settlement; the CABYS codes and how fees netted from a payout are coded;
      the credit-note codes; the platform report to Hacienda; ONVO's IVA
      withholding and the IVA on its fee; whose SINPE Móvil number is
      registered; what to do with a number left unused by a replaced document;
      the retention period (10 years set until answered).
7. **Set up messaging before any message can be sent.** Nothing reaches a
   real person until you do; every step is in
   [`docs/06-operations/notifications.md`](docs/06-operations/notifications.md),
   "Before anything is sent for real". In short:
   1. Bird: confirm the region, move the e-mail plan off Free, add and verify
      the sending domain (DKIM, return path, DMARC), create the worker's key
      and an SMTP key, create the webhook and keep its secret, fund the
      wallet, connect the WhatsApp number, submit the four WhatsApp templates
      in `packages/notifications/whatsapp/` (written, not submitted) and add
      the BAJA, ALTO, NO MAS opt-out keywords for Costa Rica.
   2. Meta: a business portfolio in the legal name, the notifications number,
      business verification, and the privacy policy and terms published.
   3. Expo: one project per app with enhanced push security, an access token
      for the worker, and the Apple and Android push credentials.
   4. Supabase: the Vault secrets, a secret key for the worker alone, the Edge
      Function secrets, then `supabase/scripts/deploy-notifications.sh` (not
      run), Auth's custom SMTP and the Send Email Hook, and the team mailboxes.
   5. The real legal name, legal id and postal address for e-mail footers
      (`NOTIFY_LEGAL_*`).
8. **Decide on e-mail for the preview.** Supabase refuses our Spanish e-mail
   templates on a free project that uses its built-in sender, so the preview
   still has Supabase's default English ones, whose link the apps' confirmation
   page does not read. The built-in sender also mails only members of your
   Supabase organisation, and never a `.example` address. Custom SMTP (or the
   messaging provider in item 7) fixes all three; then run
   `supabase/scripts/auth-config.sh apply lfulotisyeyooxecwnox preview` again
   and send yourself one real password reset. Until then, keep e-mail
   confirmation off there.
9. **Open Authentication → Users in the Supabase dashboard once** and check it
   loads. Accounts deleted through the apps stay there, anonymised; Auth read
   such a row without error, but its user listing needs the secret key, which
   nothing here uses, so the listing itself was not opened.
10. **Know what the preview costs.** The Vercel projects are on your Pro plan,
    which bills by use. The Supabase project is in the free organisation.
11. **Before the native apps go to a store:**
    1. The four store identifiers are settled (you chose them on 21 November
       2026, and they can never change after the first upload):
       `com.yuntera.shop`, `com.yuntera.vende`, `com.yuntera.ruta` and
       `com.yuntera.bodega`, with `.dev` and `.preview` for test builds. The
       shopper app is registered under its identifier in Google Play Console.
    2. Apple's export-compliance question is answered in the apps. They ship
       no encryption of their own: the saved session is kept only in the
       phone's Keychain or Keystore-backed secure store, and all four apps
       declare that they use no non-exempt encryption
       (`usesNonExemptEncryption: false`). A guard test on dependencies and
       source, and a scan of every exported bundle (`stack.sh native` and CI),
       keep that true. People signed in to an earlier test build sign in once
       more. Unverified until a build is on a phone: the real size limits per
       stored value, behaviour after a restore to a new device, reading the
       session while the phone is locked, and App Store Connect actually
       skipping the question.
    3. The first Android build asked for the fingerprint and biometric
       permissions (`USE_BIOMETRIC`, `USE_FINGERPRINT`), which the secure-storage
       library brings in and no app uses. They are now removed in all four
       apps' configuration; check the permissions list of the next Android
       build to confirm.
    4. Publish a privacy policy at a public address. The account-deletion page
       exists (the shop's `/ayuda/eliminar-cuenta`) and every web app can
       delete an account; the native apps do not yet, and both stores require
       it in the app at the first submission.
    5. Decide whether the four apps keep one shared icon, as the brand book
       says today, or get icons that tell them apart in the store.
    6. An Apple Developer Program membership (US$99 a year) for any iOS build on
       a phone, TestFlight or the App Store, and a Google Play Console account
       (US$25). Demo accounts on the hosted project for the stores' reviewers.

## What is built

| Part                 | Where                                                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop                 | `apps/web`                                                         | Home, search with typo tolerance, categories, product pages with competing offers and a delivery date, cart, checkout with SINPE Móvil, card or cash on delivery, orders with tracking and delivery code, returns with where each stands (a request still waiting for staff can be withdrawn), reviews, account, help, a page to report a listing. An unknown product or category address answers "not found" (404). Product photos in a gallery and in every list. Password reset, e-mail confirmation, notification settings (channels, WhatsApp number, commercial consent), account deletion, and a public page on how to delete an account                                                                                                                                                                                                                                                                                   |
| Seller centre        | `apps/seller`                                                      | Shop registration, listings with an itemised fee preview, editing a listing (changes to a published one wait for review), prices, stock, stock sent to the warehouse, packing, per-order statements, what is available, pending and on its way to the bank, a request to change the payout account, and the team (invitations that the invited person accepts) and requests to change the shop's name, fiscal details or contact. A photo manager on each listing (resized in the browser, reviewed before they show), the shop's notification settings, an optional second factor                                                                                                                                                                                                                                                                                                                                                |
| Internal console     | `apps/ops`                                                         | Daily queues, orders, manual confirmation of transfers, route planning and dispatch, cash settlement, returns and refunds, complaints, content reports, product and listing-edit review, seller verification, staff, drivers, warehouse workers, payout account approvals, payout runs, audit trail, shop-change requests, routes released by a driver who stopped being active, recording a return's goods back, checking in a returned parcel and releasing a locked delivery code. Photo review and take-down, the messages each order produced and the stuck ones with a resend button, staff's second factor (enrolment, the second step at sign-in, an administrator's reset of a colleague's). Offers a fee change paused (`/tarifas`), and on dispatch a door position outside the country or a closing received late. Order search by name without the name in the address; navigation that folds into a menu on a phone |
| Routes and warehouse | `apps/field`                                                       | Driver: the day's route with each stop's district, navigation links, delivery against the customer's code, cash, failed deliveries, position sharing. Warehouse: pick lists with the scanned code checked by the database, packing, receiving, stock lookup, checking in a returned parcel. A suspended driver sees a plain message and no route. Password reset and account deletion as in the other apps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Database             | `supabase/`                                                        | 33 migrations, 94 tables (62 public, 32 private), 203 functions in `public` (181 for signed-in users, 13 open to visitors, 21 server-side only), no table, view or sequence reachable by an app role, two storage buckets with their rules, row-level security on every table as a second lock, double-entry ledger, one register for every refund and one way back for each, stock ledger, the 494 districts of Costa Rica with delivery zones, demo data                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Domain logic         | `packages/core`                                                    | Money and IVA, fees, featured-offer choice, search ranking, sourcing, delivery promise, routing, risk scoring, seller score, Costa Rican identifiers, IBANs, phones and Plus Codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Native apps          | `apps/*-native`, `packages/expo-kit`                               | Expo SDK 58. Shopper app: every shopper flow of the website. Seller app (Yuntera Vende): the seller centre's flows from packing to payouts and shop registration, except the team and the requests to change the shop's details. Drivers' app (Yuntera Ruta): every driver flow, plus position sharing during a route and work without signal; each stop shows its district, and actions queued without signal keep the time they happened. Warehouse app (Yuntera Bodega): picking by camera or hand scanner, packing, receiving, checking in returned parcels, stock lookup. The three ask for the second factor. `packages/expo-kit` is what all four share. None of the three has been built for a phone yet; until then, their users work in the web apps, too                                                                                                                                                               |
| Notifications        | `packages/notifications`, `supabase/functions`, `tools/dev-notify` | A planner in the database turns each event into one message per person and channel, exactly once; a worker sends them by e-mail, WhatsApp, SMS and push with retries and dead letters; signed delivery reports; quiet hours; suppressions; account e-mails in the same words as Auth's templates. Runs locally against fake providers only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Payments             | `packages/payments`, `supabase/functions`, `tools/dev-notify`      | Three modes: `sandbox` (the simulation), `test` and `live` through ONVO. Cards on ONVO's hosted page (3-D Secure there), SINPE Móvil matched by the payer's identification; an order is paid only on ONVO's signed notification or the worker's own question, applied once under the order's lock. Money that does not match is kept for finance. Refunds sent once and completed only on ONVO's confirmation; cash and hand-confirmed transfers paid back by finance by transfer. A pay step on the shop's and the shopper app's order page; the console's Cobros section (review, refunds, reconciliation, mode and fees). Runs locally against a fake ONVO only                                                                                                                                                                                                                                                                |
| Electronic invoices  | `packages/invoicing`, `supabase/functions`, `tools/dev-hacienda`   | Version 4.4 documents issued by the platform: a tiquete (or a factura, if asked at checkout) for the delivery fee, a fee factura to each seller, credit notes on cancellations and returns; numbered without gaps, signed XAdES-EPES, sent once, answers recorded. On the shopper's order page, in the seller's statements, and in the console's Comprobantes section (rejected, waiting, unsent, replace and retry). Runs locally against a fake of Hacienda only                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Shared code          | `packages/{brand,ui,db,next-kit}`                                  | Brand tokens and logo, components, the typed API client with a message for every error, and what all apps share (session and its lifetime, the sign-in limit, security headers, forms, cache tags)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Documentation        | `docs/`                                                            | Strategy, product scope, architecture and decisions, data model, access control, API reference, one document per algorithm, security and compliance, operations, deployment runbook and go-live checklist, research notes for the next phase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Brand                | `docs/brand/`, `packages/brand/`                                   | Naming report, brand book ([published page](https://claude.ai/artifact/MJv6X1GarCNg1sZfuGjxfT), private to you until you share it; text in `docs/brand/brand-book.md`), logo files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

How the new parts work, in short:

- **Functions are the only door.** Since the security review of 21 November
  2026 signed-in users and visitors hold no privilege on any table, view or
  sequence; every function runs with its owner's rights and checks its
  caller; row-level security stays underneath. A guard test fails if a later
  migration brings a table privilege back or adds a function outside the
  documented lists.
- **Refunds and returns.** Every refund goes through one register that refuses
  the same thing twice, more units than were bought and more money than was
  collected. A return is refunded only after staff record the goods back;
  staff can close an approved return whose goods never came back. Functions
  that move an order's money take the order's lock first, so two calls on one
  order queue up. Cancelling is refused once a parcel is packed.
- **The delivery code** lives where no app role can read it; the shopper reads
  it on their order page, nobody else. Wrong codes are counted per order
  across parcels and routes and logged with the driver; after five the order
  locks until staff release it with a new code.
- **Limits.** Per account and per target, never per network address: open
  reports, complaints, listings in review, drafts, inbound shipments,
  invitations, unpaid orders and held units each have a cap (a setting), and
  search text, carts and orders are bounded before any work is done. A
  visitor's report must be about something that exists and is public.
- **Shops.** Joining a shop needs the invited person's yes. The shop's name,
  fiscal details and contact change through requests staff approve; a contact
  change and a payout-account request never overlap. A pending or suspended
  shop cannot send listings for review; a closed one only reads; a suspended
  shop's own listings leave the shop.
- **Access that ends at once.** A driver who is suspended or offboarded loses
  their routes at once (unstarted ones go back to dispatch; one under way is
  split so the cash stays with who collected it).
- **Signing in has its own limit** in the web apps, counted in the database
  per visitor address and per account: wrong passwords, sign-ups, reset and
  confirmation e-mails, e-mailed codes, the current password asked again, and
  refused token refreshes. Only keyed hashes are stored, for two hours, with
  a key only the apps hold (`AUTH_GUARD_KEY`). Nothing looks the account up,
  so the answer says nothing about whether an e-mail has an account; one
  stranger cannot lock the owner out, and the owner's usual browser is never
  held by the account's limits. Sign-up with an existing address shows the
  same screen as a new one (with e-mail confirmation on). Turnstile is wired
  into the forms and off until its keys are set.
- **Sessions end per app:** 90 days in the shop, 30 in the seller centre,
  12 hours in the console and the field app, and after 30 idle minutes in the
  console. The person is sent to sign in and brought back to the page.
- **The shop's cache** drops only the product and offer pages an action
  changed; take-downs, shop suspensions and listing rejections refresh it.
- **The warehouse and the drivers, checked in the database:** picking
  compares the scanned code with the product's own codes (any usual spelling
  of a barcode); a driver's position is checked, and one outside Costa Rica
  is refused live and flagged at a door; actions queued without signal keep
  the time they happened, corrected for a phone clock that is off.
- **Returns and fees.** A second request for a unit already in a return has
  its own message; a shopper can withdraw a request still waiting for staff;
  an order with a parcel delivered and the rest returned ends delivered. A fee
  change (a new schedule, the active one's amounts, a category's commission,
  payment or warehouse fees) pauses offers left below the price floor, lists
  them for staff and tells each shop once.

- **Paying sellers.** What a shop is owed comes from the ledger and is split
  three ways: _pending_ (on orders not delivered, or delivered fewer than 10
  days ago), _in transit_ (in a payout run, not yet confirmed) and _available_.
  Finance previews a cut-off date, creates a payout run, makes the transfers
  by hand from the list the console gives (there is no bank connection), and
  marks each payout paid with the bank's reference, or failed. Shops below
  ₡5,000, suspended, or without a valid account are left out and told why.
- **Payout accounts.** A seller cannot change the payout account directly: they
  ask, and finance approves after checking. Nobody approves their own request
  or one for a shop they belong to.
- **Fees on an order from several sellers.** The fixed part of the payment fee
  (₡180 on a card) is charged once per order and shared between the sellers in
  proportion to what each sold.
- **Stock in several places.** One order line can be filled from several
  locations of the same offer; each location sends its own parcel.
- **The second factor counts in the database.** A staff member or seller with
  an authenticator gets nothing with the password alone, whatever
  `require_staff_mfa` says. Before every request the database checks the
  session: signing out, a password change, a factor reset or a deletion ends
  every token at once, not an hour later.
- **Deleting an account** erases or anonymises everything that identifies the
  person (including notification settings, consent history, push tokens and
  suppressions, invitations sent to them, the delivery codes of their orders
  and their shop-change requests that never took effect) and keeps the orders,
  ledger and refund register the law requires, detached from them. It waits while an order, return, refund or complaint is open, or while
  the person alone runs an open shop.
- **Payments and refunds.** Paying is a step on the order page: the shop
  never talks to the gateway; a server-side worker does, with its own key,
  and the order is paid only on the gateway's word. A refund is booked once,
  sent once, settled once and confirmed once; "refund completed" follows the
  money, not the booking, in every mode
  ([returns and refunds](docs/04-algorithms/returns-and-refunds.md#one-refund-four-pieces)).
- **Electronic invoices.** The outbox's second consumer makes each document
  exactly once from the capture and from each refund; a credit note waits for
  its order's documents; a job never gives up, and finance sees why one is
  stuck. Money that was never real gets no documents on a real project.
- **Messages.** Order and shop events become messages by e-mail, WhatsApp, SMS
  and push, per person's choices. Since the follow-ups also: a return
  approved and its goods received, a delivery code locked (to the shopper and
  support) and released, an invitation to a shop (to the invited account only,
  at most once per shop in 14 days), a shop change or payout account decided,
  a payout paid, and offers paused by a fee change. A message that cannot be
  prepared becomes a dead letter instead of stopping the others. Order messages always go by e-mail; WhatsApp
  and SMS need a mobile number; a number that sent STOP is switched back on
  only from that phone. Commercial messages need a separate consent, which
  starts unticked.
- **Photos.** Sellers upload into a private bucket; staff review the largest
  size; the console then writes the three public sizes from that copy, so
  only what staff saw, without location data, reaches the shop. Staff can take
  down any photo.

## How it was checked

On a development machine, after the last change, on the combination of
everything above with both follow-ups, payments and invoicing merged (lanes 7
and 8 of `tools/dev/stack.sh`, each suite on a freshly seeded database):

| Check                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests           | 1182 pass (native kit 287, core 266, notifications 252, shared web code 88, invoicing 63, payments 40, seller app 39, drivers' app 31, API client 25, brand 21, shopper app 21, local API 16, warehouse app 16, fake providers and gateway 10, fake of Hacienda 7)                                                                                                                                                                                                                                           |
| Database tests       | 24 files pass on PostgreSQL 16: the 20 of the previous round (account deletion now also with a payment attempt's payer details, a factura and its credit note in the person's name, and a refund paid back by transfer), payments (135), invoicing (140), one refund of each kind walked through the register, the gateway refund, the confirmation and the credit note (145), and the new functions at the per-request check (150)                                                                          |
| API contract tests   | 130 pass in 16 files: every screen's payload, called as each role, matches the types the apps use; the race tests run two database sessions at once (also a payment against a cancellation, an attempt against the session that creates it, and two invoice planners at once on their own copy of the database)                                                                                                                                                                                              |
| Browser journeys     | 19 pass in Chromium, each on a freshly seeded database, with no console errors or server errors, all in one run at the first try: the 17 of the previous round, payments (card, SINPE Móvil, a decline, the gateway down and back, money kept for finance, a refund through the fake gateway) and invoicing (documents against the fake of Hacienda, a factura at checkout, a rejection replaced, the shopper's and the seller's documents)                                                                  |
| Native journeys      | 5 pass (279 checks) through the web export of the native apps, in Chromium at phone size, each on a freshly seeded database: shopper, seller, driver, warehouse and staff, as in the previous round. The shopper app's new pay step for the gateway is covered by unit tests only (it needs `test` or `live` mode and a real browser session to the gateway's page)                                                                                                                                          |
| Callers of the API   | Probed through the local API: a visitor, a shopper, staff without a factor, staff with a factor before the second step (refused everything but the second step's own calls), the notification worker's secret key (answered, about 9 ms a call on this loaded machine), and a token after sign-out (`session_ended`)                                                                                                                                                                                         |
| Native configuration | For the shopper app in the store variant after the merge: the introspected configuration resolves (`com.yuntera.shop`, no non-exempt encryption), `expo install --check` finds every package at Expo SDK 58's version (`expo-web-browser` ~58.1.0 included), expo-doctor passes 20 of 20, and the iOS and Android bundles export; the bundle scan finds no cipher in them, nor in the four web exports (the invoicing signer is server-side code and reaches no bundle). The other three apps did not change |
| Lint and types       | No lint errors (141 warnings and 269 notes, of kinds already there) and no type errors in the 20 typecheck tasks                                                                                                                                                                                                                                                                                                                                                                                             |

Money and the documented example still hold: every ledger transaction sums to
zero, a seller's available + pending + in transit equals the ledger balance,
the fee example (₡20,000, hogar, card, shipped by the seller) still pays out
₡16,203.20, and the three-seller order is paid out end to end. After every
block of the money suite no refund is outside the register, none exceeds what
was collected, and no line has more units refunded or in returns than bought.

Migrations `083400` and `083500` were also applied, in order, on top of a
database built to `083300` with the demo data and committed activity
(simulated purchases, a cancellation, a refunded return, a paid order, and a
cancellation in live mode of real money that nothing had confirmed), the way
the hosted preview would get them: both went in, in under a quarter of a
second each; no order, payment, refund, confirmation or message changed,
except the one refund nothing had confirmed, which got its way back (a
transfer for finance, with its amount moved to what is owed to shoppers; with
simulated money instead, it settled and was confirmed and announced once);
every ledger transaction still sums to zero; no invoice job was made for old
events; the issuer is not ready and simulated money is not documented; the
lockdown guard and the per-request check suite passed there. The refunds
booked before `083400` stay in what is owed to shoppers (₡3,900 on that data):
nothing records their money leaving, because nothing moved it then.

Migrations `083200` and `083300` were also applied, in order, on top of a
database built to `083100` with that era's demo data and committed activity
(the money-and-returns suite and part of the notifications suite of that
time), the way the hosted preview is: both went in; the four orders with a
parcel delivered and the rest returned became delivered, with windows never
shorter; all 13 refunds got a confirmation and no "refund completed" was
announced again; three cantons and 13 districts lost their capital "De";
visitors and signed-in users lost the use of `net`; the lockdown guard
passed; a fee change on that data paused 5 offers and prepared one message
per shop. Earlier, the four migrations before them were applied the same way
on top of a database built to `082700`: all four went in; every order got its delivery code, a wrong code
on an order still on its way was carried over, a duplicate withdrawal was
closed, every cash stop names its order, no table is readable by an app role
and no write policy is left. On that database the payout suites fail with
`nothing_to_pay` until the demo payout accounts are approved; with them
approved, they pass.

On the hosted preview, on 21 and 22 November 2026, after applying migrations
`082800` to `083100` and redeploying the four apps. The commands and numbers
are in the
[runbook](docs/07-deployment/runbook-first-deploy.md#migrations-20261121082800-to-20261121083100).

| Check              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before applying    | No order had two payments taken or two refunds booked, and none had two cash stops open, so the new unique rules could go in                                                                                                                                                                                                                                                                                                                                   |
| Applying           | The first file stopped at once on a platform difference already known from the search migration (it may set a search setting only after loading the extension) and left nothing behind. Fixed in the file; then all four went in, in 2 seconds                                                                                                                                                                                                                 |
| Lockdown           | Visitors and signed-in users hold no privilege on any table, view, sequence or column; every table path answers "permission denied" from outside; no write policy is left; row-level security is on all 80 tables. What the platform still grants by default is in "What needs you", item 3                                                                                                                                                                    |
| Storage            | The photo suite passes there. Through the storage service, a visitor and a seller were refused the waiting photos, another shop's files and any overwrite. No photo was waiting for review on the preview, so that refusal was not tried on a real waiting file                                                                                                                                                                                                |
| Data repairs       | Every order has its delivery code, and each shopper reads the right one on each open order. There were no returns to close. Every cash stop names its order                                                                                                                                                                                                                                                                                                    |
| Database tests     | All 17 files pass, three times in a row, part 2 of notifications skipped as before. Four first failed for reasons in the tests (a count of seed rows, a sign-in row without an id, a timing that included compiling a function, and a check that did not allow for the platform's own storage setting); each was fixed without loosening what it proves, and passes locally too. The suites left every table as they found it                                  |
| Per-request check  | A token used after sign-out is still refused at once. Calls take about as long as before (within the network's noise)                                                                                                                                                                                                                                                                                                                                          |
| Old apps, new data | For the 15 minutes before the redeploy, the old apps' pages all loaded against the new database; nothing broke that was seen (no action was tried in that window)                                                                                                                                                                                                                                                                                              |
| Browser checks     | At 1280 and 390 px, with no console error, failed request or server error: a purchase with SINPE Móvil to the delivery code; one page of each other app; the delivery code on no staff, warehouse or driver screen nor in any of the 446 responses they received; a driver's wrong code says how many tries are left; a damaged-item return approved, received and refunded once; a contact change rejected with a reason the seller reads; 16 console screens |
| Afterwards         | No runtime error on the four apps; the scheduled jobs all succeeded; nothing was sent                                                                                                                                                                                                                                                                                                                                                                          |

What this round left on the preview, on purpose: the four demo payout
accounts marked approved; two paid SINPE Móvil orders of `comprador`
(YT-100359 and YT-100360, waiting to be picked); a refunded damaged-item
return on YT-100114; one wrong delivery code on YT-100011, whose stop on
route R-1003 is now marked "arrived"; and a rejected contact-phone request of
Tienda Sendero. Eleven sessions of `comprador`, `vendedor` and `central`
from runs that stopped early were left to expire rather than deleted.

On the hosted preview, on 21 November 2026, after applying migrations `082500`
to `082700` (all three went in unchanged) and redeploying the four apps. The
commands and numbers are in the
[runbook](docs/07-deployment/runbook-first-deploy.md#migrations-20261121082500-to-20261121082700).

| Check              | Result                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database tests     | All 14 files pass on the platform. Part 2 of the notifications file (two workers at once) cannot run there, because a hosted database will not open a second connection to itself without a password; it says "skipped" there and still runs locally and in CI. The suites left every table as they found it |
| Per-request check  | Switched on by the migration. A token used after sign-out is refused with "session ended" at once. It costs about 0.1 ms inside the database; through the API a signed-in call went from about 55 ms to about 60 ms, and a visitor's call did not measurably change                                          |
| Second factor      | With an authenticator enrolled through Supabase's own sign-in service, a password-only session gets nothing but the second-step functions; after the code, everything; five wrong codes lock the second step for 15 minutes                                                                                  |
| Sign-in tables     | The functions may write them. An administrator's reset of a colleague's factor worked (tried and rolled back); three real account deletions left nothing personal in any table, ended the session at once, and the address could sign up again                                                               |
| Storage            | The migration created both buckets and their rules. The storage service refused what the rules and the buckets say: a visitor, another shop, a link to a waiting photo, an upload that could replace a file, a file too large, an SVG                                                                        |
| Photos and `sharp` | A seller added photos, staff approved them in the console, the console made the three public sizes from the reviewed copy, the shop showed them with their text; a rejected photo's reason reached the seller                                                                                                |
| Browser checks     | At 1280 and 390 px, with no console error, failed request or server error: shop, seller centre, console and field app as their demo users; the photo flow; password reset, password change, notification settings and account deletion with a throwaway shopper; the console's messages and security pages   |

Differences from a local build, all handled: the seed's events from before the
notifications migration are never sent (the test now accounts for that);
storage refuses direct deletes and its unique index is partial (the photo test
now does what the storage service does); a deleted public photo stays served
by the CDN for a few minutes; Supabase refuses our e-mail templates without
SMTP and refuses to send to `.example` addresses ("What needs you", item 8).

The test data from this round is gone: the throwaway accounts were removed,
and the test listing (a coffee maker of TecnoCasa) was archived. What stays:
that archived listing with its six photo records and the public files of its
two approved photos, and one notification job for its review, which a worker
would plan once it is deployed.

What these checks do **not** cover, stated plainly:

- **The security review's fixes on the hosted preview were smoke-tested, not
  exhaustively.** The platform questions are answered there: its default
  privileges (what is left is in "What needs you", item 3), the storage rules
  after the lockdown, the data repairs and the suites. Not tried there:
  refusing a real waiting photo (none was waiting), the limits and
  invitations in the browser, a suspended driver losing their routes, a
  locked delivery code released by staff, actions in the old apps during the
  15 minutes before the redeploy, and anything in the native apps.
- **The hosted preview was smoke-tested, not exhaustively tested.** Not tried
  there: a staff role other than administrator, creating a payout run, a
  seller with a second factor, the notification worker's secret key, and a
  real phone.
- **No real money, messages or invoices.** Payments are in sandbox mode on
  the preview; the gateway and Hacienda were only ever their local fakes. Messages go only to
  local fake providers; account e-mails land in the local API's own mailbox.
  Payouts are bank transfers made by hand; the list the console produces is
  not any bank's upload format.
- **Account e-mails on the real Auth service.** No e-mail was sent: Supabase
  will not send to the test addresses, and refuses our templates without SMTP.
  The reset was tried from its link onwards, with the token stored the way
  Auth stores it. E-mail confirmation (off on the preview), the templates as
  Auth renders them, and the second step of the staff screens in the console
  were not tried there.
- **Photos in real browsers and phones.** Resizing in the browser was tried in
  headless Chromium only; Safari, Firefox on phones, iPhone (HEIC) photos and
  the camera button were not.
- **No real phones.** The drivers' app was tested in a phone-sized desktop
  browser with a simulated location.
- **The native apps have not run on a phone.** On 21 November 2026 the
  shopper app was built in the cloud three times, all successful at the first
  try: a preview Android file and an iOS Simulator build in your personal Expo
  account (now unused), and the first Android **store** build (`.aab`, version
  0.1.0, build 2, identifier `com.yuntera.shop`) in the project `yuntera` of
  your Expo team account, where your company's Apple certificate and App Store
  Connect key also live. The store build has not been sent to Google Play: that
  waits for your Google service-account key on Expo's website
  ([`docs/07-deployment/store-testing.md`](docs/07-deployment/store-testing.md)
  has the steps for both stores). No iPhone store build exists yet. Nothing has
  been started on a phone or a simulator: cloud simulators need a paid Expo
  plan, so the first real look will be a tester's phone. Store-testing builds
  talk to the hosted preview with demo data. While the
  shop is behind the Vercel login, product pictures cannot load in the app; it
  shows a placeholder instead. The web export proves the screens, navigation,
  Spanish text and API calls; it does **not** prove the secure storage of the
  session, the fonts, permission prompts, location, camera, gestures, keyboard
  and safe areas of a real phone.
- **No load testing**, no security review by a third party.

## Not built

These are missing, not hidden. The first group blocks a public launch.

**Before launch**

- **Payments and invoices exist as code against fakes, not for real use.**
  The gateway integration (cards on ONVO's page, SINPE Móvil matched by the
  payer, refunds through it) and the electronic documents (tiquete or factura
  for the delivery fee, fee facturas to sellers, credit notes) run only
  against `tools/dev-notify`'s fake ONVO and `tools/dev-hacienda`. Missing for
  real use: the contract and keys with ONVO, the tax registration with its
  signing key and sandbox credentials, the four Edge Functions deployed
  (`payments-worker`, `payments-webhook`, `invoice-worker`,
  `hacienda-callback`), and the lawyer's and accountant's answers ("What
  needs you", item 6). Not proven without them: that ONVO's real API and
  webhooks match the research note, that Hacienda accepts the signature, and
  the native app's return from the gateway's page on a phone. Not built:
  disputes beyond a review item, ONVO payouts matched to the bank, sellers'
  own documents for the goods, fee facturas per settlement period, e-mailing
  documents, a PDF, deleting documents after the retention period.
- Sending messages for real. The pipeline, the worker, the templates and the
  screens are built, but nothing is sent until you set up the messaging
  provider ("What needs you"). The four WhatsApp templates are written and not
  submitted. Phone numbers for WhatsApp and SMS are not verified by a code.
  Not built: commercial messages (no template and no one-step unsubscribe
  page), the daily staff summary of stuck messages, a clean-up of old message
  rows, and the team mailboxes (staff messages are skipped until you add
  them).
- A scheduled clean-up of unused photo files. Files nothing needs are deleted
  only when a seller or catalogue staff act.
- A bank connection for payouts. Transfers are made by hand and recorded in
  the console.
- Functions for the actions that existed only as direct writes (see "Things to
  know").

**Native apps** (all four have their screens; none of the seller, driver and
warehouse apps has been built for a phone yet, so until then sellers, drivers
and the warehouse use the web apps)

- Push notifications. The database and the worker can send them, but no app
  registers its phone yet, and the package's permission and entitlement are
  removed on purpose until that work starts (the drivers' app may show only
  the notice of its location service).
- Taking or uploading photos from the phone: product photos in the seller app
  (the server side exists) and delivery photos in the drivers' app. The seller
  app's camera and photo texts come back with that work.
- Password reset and account deletion inside the apps. The database function
  for deletion exists; both stores require it in the app before the first
  submission. The shopper app still sends an account with a second factor to
  the website (the other three ask for the code).
- Universal links (opening a yuntera.cr address in the app). No domain serves
  the files the phones check; the apps answer only addresses in their own
  schemes (`yuntera://`, `yuntera-ruta://` and so on), and those were not
  tested.
- Seller app, compared with the seller centre: the team (inviting someone,
  accepting or declining an invitation, changing a member's role, leaving a
  shop) and the reviewed requests to change the shop's public name, fiscal
  details or contact phone and e-mail. The app says to use the seller centre
  for those. Also missing: the shop's notification settings, photos (above)
  and "use my current location" for a pickup place (only a Plus Code; the app
  has no location permission). Its terms and privacy links point at
  www.yuntera.cr unless `EXPO_PUBLIC_SHOP_URL` is set.
- Drivers' app: starting a route and delivering against the code need
  signal; a driver suspended while the phone has no signal keeps the
  saved route until a call gets through (at most a day). Notification
  settings are not in the app.
- Warehouse app: scanning the bin as well as the product, and a cycle-count
  adjustment screen (neither is in the web app).
- Shopper app: reporting a listing (the shop's `/reportar` page) and the
  choice of channels for messages are on the website only (the commercial
  consent is in the app).

**Later**

- English. The interface is Spanish only; error messages already exist in both.
- Background location for drivers and camera barcode scanning in the web app
  (both exist in the native apps, unverified on a phone).
- Sponsored listings, promotions and coupons, a map on the dispatch screen,
  bulk listing upload.

## Decisions I made for you

Each is recorded with its reasoning in
[`docs/02-architecture/decisions.md`](docs/02-architecture/decisions.md). The
ones worth knowing about:

- **The name Yuntera**, pending the trademark search.
- **One PostgreSQL database with the business rules inside it.** The apps call
  database functions; they hold no privileged key. Suited to one or two people;
  the document says what would make this the wrong choice and when.
- **A web app for drivers and the warehouse instead of native apps.** It works
  on any phone today and I could verify it; native builds I could not. The cost
  is no background location and no offline mode. The native driver and
  warehouse apps now have their screens, and the drivers' app shares the
  position and works without signal; the web app stays what drivers and the
  warehouse use until those apps have run on a phone.
- **Native apps share one kit and the web's API.** All four use Expo, call the
  same database functions through the same typed client, and keep the session
  in the phone's secure store. The drivers' day kept for a dead zone is in the
  app's ordinary storage, which the phone encrypts, and is removed within a day.
- **Own drivers and a delivery code.** The customer's 4-digit code is checked
  on the server and is never shown to the driver or to staff.
- **Fees are assumptions.** Commission by category, warehouse fee by size and
  payment costs passed through at cost. The numbers come from public research
  on local gateways and are labelled as assumptions everywhere they appear.
- **Sellers are paid 10 days after delivery, from ₡5,000.** Both are settings
  an administrator can change.
- **No billable cloud resources and no pull request without your say-so.**

## Things to know before trusting the numbers

Found while building or reviewing; none is fixed by pretending otherwise.

- **Refund policy choices to confirm or change:** a refund returns the
  commission to the seller but not the payment and warehouse fees; shipping is
  not refunded when a parcel comes back undelivered; every return, a
  withdrawal included, is refunded only once the goods are recorded back at the
  warehouse.
- **Cash on delivery collects the whole order at the first parcel handed
  over** (less the goods of parcels already on their way back). A parcel that
  comes back after that is refunded by transfer, which needs the shopper's
  bank details that nothing collects yet. Collecting per parcel needs partial
  captures, which do not exist.
- **Actions that have no screen and no function**, because they only ever
  existed as direct table writes and the lockdown closed those: a seller
  offering on another shop's existing listing, switching a variant off or
  taking a live listing back to draft, editing the shop's description or logo,
  moderating reviews, editing categories, brands, search synonyms, fees,
  delivery zones, holidays, zone closures, districts and settings, and ops
  creating warehouse locations. Each needs a function before anyone can do it
  again, staff included (an administrator can still do it in the database).
- Unit economics, launch thresholds and data-retention periods in the strategy
  documents are estimates and say so.
- A payout account finance never approved is not paid. The hosted preview's
  demo accounts were loaded before approvals existed; on 21 November 2026 the
  four the seed treats as approved were stamped approved there by one guarded
  statement, so the preview matches a fresh seed again.
- There is no function to remove a stop from, or close, a route that got
  stuck before the review (new ones cannot get stuck: cancelling after packing
  is refused).
- No message is sent when a returned parcel is settled at the door (that
  event has no consumer yet).
- **A refund is one mechanism**: booked once in the register, sent at most
  once, settled once (ledger, the payment's status), confirmed and announced
  once, credited once on the fiscal documents
  ([returns and refunds](docs/04-algorithms/returns-and-refunds.md#one-refund-four-pieces)).
  The payment shows "refunded" when the money has gone back, no longer when
  the refund is booked. Cash on delivery taken in test or live mode,
  transfers confirmed by hand and real money refunded after the mode changed
  are paid back by finance by transfer and recorded with the bank's
  reference; the demo's cash in sandbox is settled as a simulation. A refund whose send got no
  answer is never sent again by itself: after an hour it goes to finance.
- Money taken in sandbox or in the gateway's test environment is never
  documented on a real project (`invoicing_policy.simulated_payments` is
  false; the local seed sets it true for the demo). Orders paid before
  `083500` is applied get no documents.
- A factura is offered at checkout only when the order has a delivery fee.
  An account deletion keeps the documents issued in the person's name (the
  law requires it); only finance can read them afterwards.
- Money the gateway takes after an order was cancelled, paid twice or in an
  environment the mode has left is kept for finance's review, never applied
  or dropped by itself.
- A shopper's stale tab that cancels an already-cancelled order gets the
  generic "too late to cancel" text; only the console has its own wording.
- The limits stop one account, not one person with many free accounts, and
  apart from sign-in there is no limit per minute at the edge (search,
  checkout). There is no request-size limit of our own on the hosted Data API;
  it is an accepted limit, with its reasons, in the security programme.
- That an invitation sent before the person registered can be accepted once
  they confirm their e-mail was checked only with the local Auth stand-in,
  which confirms addresses at sign-up.
- Another shopper's order page shows "not found" but answers with status 200
  rather than 404.
- The shop refreshes its cached catalogue when a listing edit is approved or a
  listing is archived, through a key (`SHOP_REFRESH_KEY`) set to the same
  value on the shop, the seller centre and the console. It is set on the
  preview, but while the shop sits behind the Vercel login the request cannot
  reach it and is logged as an error; changes still appear within about a
  minute. It works once the shop is public.
- Wrong second-factor codes are limited to five in 15 minutes per account only
  for codes sent through the apps. Codes sent to Auth directly meet only its
  per-address limit until Auth's verification hook is enabled (Team plan).
- A shop that traded and closed keeps its legal name and identification number
  for the tax retention period. The same cédula can register a new shop, but
  that shop cannot be verified while the closed one stays verified with it.
- No screen changes an account's e-mail address yet.
- Some provider behaviour was tried only against the fake: that Bird repeats a
  message's generation in its delivery reports, the fields of its opt-in
  report, and the shape of a late soft bounce. The Edge Functions' Deno check
  was not repeated after the last fixes.
- Catalogue staff can still sign links of any lifetime to photos waiting for
  review through the API (the console signs them for 15 minutes). A taken-down
  photo may stay in browsers' caches for up to a week; on the preview,
  Supabase's CDN stopped serving one within a few minutes.
- Deleting an account leaves Auth's record of an unfinished sign-in or reset
  (`auth.flow_state`), which holds the account's id and nothing personal.
  The deletion should remove them too; one was removed by hand on the
  preview.
- Storage abuse is limited per listing (8 photos) and per shop (40 waiting,
  100 new a day), not by total size.
- **Left open by the follow-ups' reviews:**
  - Sign-in: a guesser with many addresses gets up to 50 wrong passwords and
    30 wrong codes per account in 15 minutes (one address gets 5); that is
    the price of a stranger being unable to lock the owner out. Vercel's
    firewall and Turnstile are the next layers, and neither is set up.
  - While another visitor at the same address has used up the refresh limit
    (120 refused refreshes in 10 minutes), a person whose access token has
    expired is treated as signed out for those requests; nothing is deleted,
    and the token is renewed after the wait.
  - Until the hosted project stores the key's digest in Vault, anyone with
    the public key can add rows to the sign-in limit's table (they count
    against nobody and go within two hours). Not tried against a real Vault.
  - With e-mail confirmation off, as on the preview, a new address is signed
    in at once at sign-up, so a stranger can still tell it from an existing
    one there.
  - Turnstile, Vercel's address headers and Auth's own session time-box were
    not tried on a real deployment; the pinned CI workflow has not run on
    GitHub. The native apps' sessions are not covered by the new lifetimes.
  - A seller's pause, stock change or price change does not refresh the
    shop's cache; the shop catches up within its cache lifetime (about a
    minute). Offers paused by a fee change catch up the same way.
  - Auth's own refusal by its human check is shown with the generic message.
  - The `pg_net` revoke is not verified on the hosted project, nor whether the
    platform grants it again on an upgrade (runbook, "Migrations 083200 and
    083300", point 4).
  - The phone-clock correction of queued driver actions is tested in the
    database and the web export only, not on a phone; if the phone's clock
    jumps while an action waits, the time can still be off.
  - The dispatch screen's out-of-area flag and late-sync note are covered by
    the database and contract tests only, not by a browser journey.
  - District names still lack their accents in the source data ("San
    Francisco de Dos Rios"); only the capitals of "de", "del" and "y" were
    fixed.
  - A shop that invites the same account again within 14 days sends no
    second e-mail (the invitation still shows in the seller centre). A message
    for an invitation is planned when the worker next runs, so one that was
    declined or withdrawn within that minute is still announced.
  - The seller centre has no screen for offers paused by a fee change beyond
    their paused status and the message; staff see them on `/tarifas`.
  - Between applying `083200` on the preview and redeploying the field app,
    the old field app cannot confirm a pick (`scan_required`).

## Running it

[`README.md`](README.md) has the commands and the demo accounts. Five minutes
from a clean checkout to all four apps running locally.
