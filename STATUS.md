# Status

Updated 23 November 2026, after the staff operations tools were merged on
top: the console's Operación section (delivery zones, districts, holidays,
zone closures, warehouse locations, stuck routes, and the operational
settings for administrators; migration `084000`), and two catalogue
follow-ups (deleting a brand nobody names, and product pages that refuse a
product not on sale at the helper; migration `084100`). **Neither migration is
on the hosted preview yet**: the preview holds the 37 migrations up to
`083900` and the web code of 22 November; the repository has 39. The steps
for that trip are in the
[runbook](docs/07-deployment/runbook-first-deploy.md#migrations-084000-and-084100).

Before that, on 22 November 2026, four more pieces were merged on top. The
invoicing fixes found on the hosted preview (simulated money, cash on
delivery in sandbox included, never gets an electronic document; the
console's and the order page's texts in simulation; the document writer's
escaping proven; every database suite holds on a used database; migration
`083510`). The seller actions the lockdown had closed (offers on another
shop's product, variants on and off, a listing back to draft, the shop's
description and logo, offers paused below the price floor; migration
`083600`) and the console's catalogue tools (categories, brands, search
synonyms, review moderation, staff corrections and take-downs; migration
`083700`). And the account screens inside the four native apps (deleting
the account, the password reset and change, the shopper's second step,
reporting a listing, message channels, the seller's team, invitations, shop
changes and notification settings; migration `083900`). **On the evening of
22 November 2026 all four were applied to the hosted preview, which now has
37 migrations, and its four web apps were redeployed with this code**; the
suites pass there and the browser checks passed (what was done and what
differed is in the
[runbook](docs/07-deployment/runbook-first-deploy.md#what-was-done-on-the-preview-22-november-2026-evening)).
The preview still simulates payments and no worker is deployed. The shopper
app's Android build was sent to
Google Play's internal testing on 22 November 2026 and waits for you to
release it ("What needs you", item 11). Before them, the payment gateway and
electronic invoicing were merged on top of both follow-ups: payments through ONVO in two new modes
(`test`, `live`) with cards on its hosted page, SINPE Móvil matched by the
payer, refunds sent through it and completed only on its confirmation, and a
finance section in the console (migration `083400`); and the platform's own
electronic documents for Hacienda, signed and sent by a worker, shown on the
shopper's order and in the seller's statements (migration `083500`). Both
work only against local fakes. **On 22 November 2026 all four migrations
(`083200` to `083500`) were applied to the hosted preview, then 33, and its
four web apps were redeployed with that code.** The preview **still
simulates payments** (`payments_mode` is `sandbox`), no worker is deployed
(notifications, payments, invoicing), and nothing is invoiced: the issuer is
not set up. What was done and what differed is in the runbook, sections
[083200 and 083300](docs/07-deployment/runbook-first-deploy.md#migrations-083200-and-083300)
and [083400 and 083500](docs/07-deployment/runbook-first-deploy.md#migrations-083400-and-083500).
This is the honest state of the project: what exists, how far it was checked,
and what only the owner can do.

## In one paragraph

Yuntera is a marketplace with its own warehouse and delivery, designed for
Costa Rica. The whole product works on a development machine: a shopper can
search, buy and pay; a seller can register, list with photos, edit listings,
sell on another shop's product, switch variants off and on, describe the shop
and give it a logo, stock, pack and see what they will be paid; staff can
verify sellers, review products, photos, logos and listing edits, run the
catalogue (categories, brands, search synonyms, reviews, corrections and
take-downs), run operations (delivery zones, districts, holidays, zone
closures, warehouse locations, stuck routes and the platform's operational
settings), add staff, drivers and warehouse workers,
plan routes, settle cash, refund returns and pay sellers; a driver can deliver
against the customer's code; a warehouse worker can pick, pack and receive.
Everyone can reset a password, confirm their e-mail and delete their account;
staff and sellers can add a second factor; messages for every step of an order
are planned and sent, but only to local fake providers. **A hosted preview
exists.** The database is a Supabase project in your separate free
organisation, with 37 of the repository's 39 migrations applied (the
operations tools and the catalogue follow-ups are not there yet; the security review's fixes,
both follow-ups, payments, invoicing and its fixes, seller listings, the
console catalogue and the native accounts included), and the demo data loaded.
Payments there are simulated, and no worker is deployed, so nothing is sent,
charged or invoiced. Since the review, apps and visitors can reach the database
only through its functions: no table is readable or writable directly. The
four web apps are deployed as a preview on Vercel at
`yuntera-web`, `yuntera-vende`, `yuntera-central` and `yuntera-campo` (each
`.vercel.app`); every address is behind a Vercel login, and the projects are
not connected to the Git repository. A shopper app for iOS and Android exists
with every shopping flow of the website, and the seller, driver and warehouse
apps have the flows of their web counterparts (the drivers' app also shares
the position during a route and works without signal); all four now delete
the account, reset and change the password inside the app; none of those
three has been built for a phone yet. The shopper app's Android build
(version code 4, from commit `3f251c3`, before the account screens) is in
Google Play's internal testing as a draft release that you still have to
release; no iPhone build exists, and no build has run on a phone or
simulator yet.
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
      schema, so nobody can reach them over the internet (checked again on
      22 November: `406`, "Invalid schema: net"). **Migration `083200`'s
      revoke does not hold on the hosted project:** the grants belong to the
      platform's own role (`supabase_admin`), to `anon`, `authenticated` and
      to everyone (PUBLIC), and `postgres` cannot take back a grant it did not
      make. Running the revoke again changed nothing. Only Supabase support
      can remove them, or you accept it as a limit; until then
      `125_followups.sql` fails there at its last check, on purpose.

   Migrations `082800` to `083100` are applied to the preview (that item is
   done), and the four web apps are redeployed with them. The four demo
   shops' payout accounts were loaded before approvals existed; I stamped
   exactly those four as approved, as the seed does, so payout runs on the
   preview include them again.
4. **Tell the accountant about ₡19,900 owed to shoppers.** The account
   "Reembolsos por pagar a clientes" on the preview holds ₡19,900 (the
   refunded damaged-item return on YT-100114, booked on 22 November before
   `083400`). Nothing recorded that money leaving, because in sandbox nothing
   moved it; it stays there until finance clears it with an adjustment the
   accountant agrees to. I did not adjust it. (Migrations `083200` to
   `083500` are on the preview and the apps redeployed: that item is done.
   `AUTH_GUARD_KEY` is in a file only root can read on the machine that did
   it, `/root/yuntera-auth-guard-key.txt`; keep it or replace it on all four
   projects together with the digest in Vault, as the runbook says.)
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
       delete an account. All four native apps now can too, but the store
       builds made so far come from `3f251c3`, before that work; both stores
       require it in the app at the first public submission. The preview has
       had migration `083900` since 22 November 2026 (evening), so a build
       with it can be made now; none has been made or tried against the
       preview yet.
    5. Decide whether the four apps keep one shared icon, as the brand book
       says today, or get icons that tell them apart in the store.
    6. An Apple Developer Program membership (US$99 a year) for any iOS build on
       a phone, TestFlight or the App Store, and a Google Play Console account
       (US$25). Demo accounts on the hosted project for the stores' reviewers.
    7. **Release the Android draft in Play Console.** The build
       `a20ef1d8-a926-40d4-947d-823cd87be32a` (version 0.1.0, version code 4,
       commit `3f251c3`) was sent to the internal testing track on
       22 November 2026 (submission `8d09854a-da67-4919-afe6-114fc50f633f`);
       your Google key is uploaded on Expo. Because the app was never
       published, it arrived as a draft: add testers and start its rollout
       ([store-testing.md](docs/07-deployment/store-testing.md), Part 1,
       steps 6 to 8). No iPhone build exists yet: run the iPhone command in
       Part 2 once, interactively, from commit `3f251c3` (`git checkout
       3f251c3` after cloning), so both stores carry the same code. That
       build keeps working against the updated preview: every call it makes
       was tried there after the migrations and answered. The team account has used 4 of
       its 15 Android builds and 2 of its 15 iOS builds in the cycle from
       1 November to 1 December 2026; nothing was billed.

## What is built

| Part                 | Where                                                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop                 | `apps/web`                                                         | Home, search with typo tolerance and a brand filter, categories (an old category address redirects to its new one), product pages with competing offers in one order (in stock, cheapest, oldest) each with its shop's logo and a link to the shop's page (`/tienda/<slug>`) and a delivery date, a cart that offers another shop's offer when the chosen one runs out, a notice on the order page when staff hid one of the shopper's reviews, cart, checkout with SINPE Móvil, card or cash on delivery, orders with tracking and delivery code, returns with where each stands (a request still waiting for staff can be withdrawn), reviews, account, help, a page to report a listing. An unknown product or category address answers "not found" (404). Product photos in a gallery and in every list. Password reset, e-mail confirmation, notification settings (channels, WhatsApp number, commercial consent), account deletion, and a public page on how to delete an account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Seller centre        | `apps/seller`                                                      | Shop registration, listings with an itemised fee preview, editing a listing (changes to a published one wait for review), prices, stock, stock sent to the warehouse, packing, per-order statements, what is available, pending and on its way to the bank, a request to change the payout account, and the team (invitations that the invited person accepts) and requests to change the shop's name, fiscal details or contact. Selling an existing product of another shop (found by name, brand or barcode, no review), switching variants off and on, taking a listing back to draft, the Tienda page (description and logo, both reviewed), and offers paused below the price floor with the reason and a one-step fix. A photo manager on each listing (resized in the browser, reviewed before they show), the shop's notification settings, an optional second factor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Internal console     | `apps/ops`                                                         | Daily queues, orders, manual confirmation of transfers, route planning and dispatch, cash settlement, returns and refunds, complaints, content reports, product and listing-edit review, seller verification, staff, drivers, warehouse workers, payout account approvals, payout runs, audit trail, shop-change requests, routes released by a driver who stopped being active, recording a return's goods back, checking in a returned parcel and releasing a locked delivery code. Photo review and take-down, the messages each order produced and the stuck ones with a resend button, staff's second factor (enrolment, the second step at sign-in, an administrator's reset of a colleague's). Offers a fee change paused (`/tarifas`), a listing edit that would pause other shops' offers shown with a confirmation, shops' logos (`/catalogo/logotipos`) and descriptions (`/cambios-tienda`). Catálogo: categories (create, rename with redirect, move, order, hide, delete if unused), brands (create, rename, hide, merge), search synonyms with a preview, review moderation with reasons, and correcting, taking down and putting back a published product (the console's catalogue forms work without JavaScript), and on dispatch a door position outside the country or a closing received late. Order search by name without the name in the address; navigation that folds into a menu on a phone. Operación (084000): delivery zones (create, edit, switch off and on, delete if unused), districts moved between zones or marked not served with a preview of what they touch, holidays, zone closures with an end that can change, warehouse locations, stuck routes (remove a pending stop, close a route) and, for administrators, the operational settings; brands deleted when no product names them (084100); the order page tells a parcel taken off a route from a failed delivery |
| Routes and warehouse | `apps/field`                                                       | Driver: the day's route with each stop's district, navigation links, delivery against the customer's code, cash, failed deliveries, position sharing. Warehouse: pick lists with the scanned code checked by the database, packing, receiving, stock lookup, checking in a returned parcel. A suspended driver sees a plain message and no route. Password reset and account deletion as in the other apps. A stop Central removed reads "Omitida" with what to do with the parcel, and the route's count leaves it out ("0 de 1 entregadas · 1 omitida")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Database             | `supabase/`                                                        | 39 migrations (37 on the hosted preview), 98 tables (65 public, 33 private), 276 functions in `public` (254 for signed-in users, 17 of them also open to visitors, 22 server-side only), no table, view or sequence reachable by an app role, two storage buckets with their rules, row-level security on every table as a second lock, double-entry ledger, one register for every refund and one way back for each, stock ledger, the 494 districts of Costa Rica with delivery zones, demo data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Domain logic         | `packages/core`                                                    | Money and IVA, fees, the offer order (one rule shared with the database by a parity test), search ranking, sourcing, delivery promise, routing, risk scoring, seller score, Costa Rican identifiers, IBANs, phones and Plus Codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Native apps          | `apps/*-native`, `packages/expo-kit`                               | Expo SDK 58. Shopper app: every shopper flow of the website. Seller app (Yuntera Vende): the seller centre's flows from packing to payouts and shop registration, the team and invitations, the reviewed changes to the shop's name, fiscal details and contact, where its description and logo stand (written and uploaded in the seller centre), and the shop's notification settings. Drivers' app (Yuntera Ruta): every driver flow, plus position sharing during a route and work without signal; each stop shows its district, and actions queued without signal keep the time they happened. Warehouse app (Yuntera Bodega): picking by camera or hand scanner, packing, receiving, checking in returned parcels, stock lookup. All four delete the account (the password typed again, blockers explained, nothing left on the phone afterwards), send the password-reset link (which opens the website) and change the password; the shopper app asks for the second step inside the app, reports a listing and saves message channels with the commercial consent, the consent logged as given in the app. The three ask for the second factor. `packages/expo-kit` is what all four share. None of the three has been built for a phone yet; until then, their users work in the web apps, too                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Notifications        | `packages/notifications`, `supabase/functions`, `tools/dev-notify` | A planner in the database turns each event into one message per person and channel, exactly once; a worker sends them by e-mail, WhatsApp, SMS and push with retries and dead letters; signed delivery reports; quiet hours; suppressions; account e-mails in the same words as Auth's templates. Runs locally against fake providers only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Payments             | `packages/payments`, `supabase/functions`, `tools/dev-notify`      | Three modes: `sandbox` (the simulation), `test` and `live` through ONVO. Cards on ONVO's hosted page (3-D Secure there), SINPE Móvil matched by the payer's identification; an order is paid only on ONVO's signed notification or the worker's own question, applied once under the order's lock. Money that does not match is kept for finance. Refunds sent once and completed only on ONVO's confirmation; cash and hand-confirmed transfers paid back by finance by transfer. A pay step on the shop's and the shopper app's order page; the console's Cobros section (review, refunds, reconciliation, mode and fees). Runs locally against a fake ONVO only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Electronic invoices  | `packages/invoicing`, `supabase/functions`, `tools/dev-hacienda`   | Version 4.4 documents issued by the platform: a tiquete (or a factura, if asked at checkout) for the delivery fee, a fee factura to each seller, credit notes on cancellations and returns; numbered without gaps, signed XAdES-EPES, sent once, answers recorded. Simulated money (the sandbox simulation, the gateway's test environment, cash on delivery taken while payments are in sandbox), decided once when it is captured, never gets a document unless `invoicing_policy.simulated_payments` says so; its jobs end on their own. On the shopper's order page, in the seller's statements, and in the console's Comprobantes section (rejected, waiting, unsent, replace and retry). Runs locally against a fake of Hacienda only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Shared code          | `packages/{brand,ui,db,next-kit}`                                  | Brand tokens and logo, components, the typed API client with a message for every error, and what all apps share (session and its lifetime, the sign-in limit, security headers, forms, cache tags)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Documentation        | `docs/`                                                            | Strategy, product scope, architecture and decisions, data model, access control, API reference, one document per algorithm, security and compliance, operations, deployment runbook and go-live checklist, research notes for the next phase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Brand                | `docs/brand/`, `packages/brand/`                                   | Naming report, brand book ([published page](https://claude.ai/artifact/MJv6X1GarCNg1sZfuGjxfT), private to you until you share it; text in `docs/brand/brand-book.md`), logo files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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

On a development machine on 23 November 2026, after the last change, with the
operations tools and the catalogue follow-ups merged (lane 15 of
`tools/dev/stack.sh`; the store build's client in a lane 15 transaction):

| Check              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests         | 1319 pass in 15 packages (native kit 338, core 296, notifications 271, shared web code 90, invoicing 73, seller app 54, payments 40, drivers' app 33, shopper app 28, API client 25, brand 21, local API 16, warehouse app 16, fake providers and gateway 10, fake of Hacienda 8)                                                                                                                                                         |
| Database tests     | 30 files pass on PostgreSQL 16, twice in a row on the same database, no skipped row: the 28 before, the operations tools (165) and the catalogue follow-ups (166). `used-db-check.sh 15 quick` and `15 all` (every browser journey first, on one database) pass                                                                                                                                                                           |
| API contract tests | 172 pass in 25 files, one file at a time (`packages/db/vitest.config.ts`); among them the operations races (two real sessions for each of four races, in both orders where it matters, and a stock write held between its two writes while a location is switched off or renamed) and the apps' payloads for a district not served and a stop staff removed                                                                               |
| Browser journeys   | 25 pass in Chromium, each on a freshly seeded database, with no console errors or server errors: the 23 before, the console operations and the console follow-ups (a holiday's counts, the district form's message, the confirmation boxes kept after a refusal, stops removed before and after the route starts in the driver's count, parcels to collect and the dispatch card, the staff order page and its history, deleting a brand) |
| Native journeys    | 9 pass (420 checks) through the web export of the native apps, in Chromium at phone size, each on a freshly seeded database: the 8 before and a stop Central removed in the drivers' app; the bundle scan finds no cipher                                                                                                                                                                                                                 |
| The store build    | The shopper app's client and schemas of `3f251c3`, driven with every call that build makes (45 answered and parsed; 4 refused by business rules, as they would be on the hosted preview), also with a district not served and a stop removed                                                                                                                                                                                              |
| Lint and types     | No lint errors (169 warnings and 366 notes, of kinds already there) and no type errors in the 20 typecheck tasks                                                                                                                                                                                                                                                                                                                          |

Before that, on 22 November 2026, after the last change then, on the combination of
everything above with both follow-ups, payments, invoicing, the invoicing
fixes, seller listings, the console catalogue and the native apps' account
screens merged (lanes 13 and 14 of `tools/dev/stack.sh`, each suite on a
freshly seeded database unless it says otherwise):

| Check                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests           | 1301 pass in 15 packages (native kit 338, core 281, notifications 271, shared web code 89, invoicing 73, seller app 54, payments 40, drivers' app 31, shopper app 28, API client 25, brand 21, local API 16, warehouse app 16, fake providers and gateway 10, fake of Hacienda 8); the seller app's tests read the seller centre's shop page for the description and logo texts                                                                                                                                                                                                                                                                                                                                                                                                   |
| Database tests       | 28 files pass on PostgreSQL 16 with the stack stopped, no skipped row: the 26 of the previous round, the invoicing fixes (152) and the native accounts (170). All 28 pass again, without a reset, after the API contract tests. `supabase/scripts/used-db-check.sh 13 quick` and `13 all` (all 23 browser journeys first, on one database without resets) pass: every suite twice on a database made to look like the preview, the row count of all 109 tables unchanged, the only skipped row `125_followups` `net_grants` as designed, a suite broken on purpose failing alone, and the role the script creates removed at the end                                                                                                                                              |
| API contract tests   | 155 pass in 21 files (the invoicing fixes' and the native accounts' among them): every screen's payload, called as each role, matches the types the apps use; the race tests run two database sessions at once, with a 60-second timeout for a loaded machine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Browser journeys     | 23 pass in Chromium, each on a freshly seeded database, with no console errors or server errors: the 21 of the previous round, the invoicing states and the document writer's escaping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Native journeys      | 8 pass (414 checks) through the web export of the native apps, in Chromium at phone size, each on a freshly seeded database: the 5 of the previous round and the account screens of the shopper, seller and field apps (including the shop's description and logo in the seller app); no cipher or hash implementation in any bundle                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Callers of the API   | Probed through the local API: a visitor, a shopper, staff without a factor, staff with a factor before the second step (refused everything but the second step's own calls), the notification worker's secret key (answered, about 9 ms a call on this loaded machine), and a token after sign-out (`session_ended`)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Native configuration | For the shopper app in the store variant after the merge: the introspected configuration resolves (`com.yuntera.shop`, no non-exempt encryption), `expo install --check` finds every package at Expo SDK 58's version (`expo-web-browser` ~58.1.0 included), expo-doctor passes 20 of 20, and the iOS and Android bundles export; the bundle scan finds no cipher in them, nor in the four web exports (the invoicing signer is server-side code and reaches no bundle). The other three apps did not change. Not run again after the account screens: they added no dependency, permission, entitlement, native module or `EXPO_PUBLIC_` variable, and left `app.config.ts`, `eas.json`, versions and build numbers as they were; only the web exports and their bundle scan ran |
| Lint and types       | No lint errors (159 warnings and 333 notes, of kinds already there) and no type errors in the 20 typecheck tasks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

On the hosted preview, on 22 November 2026 (21:59 to 22:45 UTC), after
applying migrations `083510` to `083900` and redeploying the four apps. The
commands and numbers are in the
[runbook](docs/07-deployment/runbook-first-deploy.md#what-was-done-on-the-preview-22-november-2026-evening).

| Check              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before applying    | 33 applied, these four pending. No product rejected, no hidden review, no listing edit or shop change waiting, no offer paused, no category or brand address the new rules would refuse. Payments in sandbox, the issuer not set up, 3 capture jobs and 1 refund job waiting for invoicing                                                                                                                                                                                      |
| Applying           | All four went in at the first try, in 2.2 seconds; no platform difference, no file changed                                                                                                                                                                                                                                                                                                                                                                                      |
| One-off changes    | Every captured payment was marked simulated; the 4 waiting invoice jobs ended as "simulated money"; nothing was issued (0 documents)                                                                                                                                                                                                                                                                                                                                            |
| Guard              | No app role holds any privilege on any of the 97 tables (3 new), sequence or column; no write policy; row-level security on everywhere; every function a definer with an empty search path. Visitors may now call 17 functions (the shop page, the cart's other offer, the brand filter and old category addresses added). One notification-settings function of each name. A token after sign-out is still refused                                                             |
| Database tests     | All 28 files pass on the platform at the first run. The only "skipped" rows are `125_followups` `net_grants` (the platform's grants on `net`) and part 2 of `100_notifications` (a second connection is refused). The suites left every table as they found it                                                                                                                                                                                                                  |
| Old apps, new data | For the 11 minutes before the redeploy the old apps' 32 pages loaded; no action was tried                                                                                                                                                                                                                                                                                                                                                                                       |
| The Android build  | The API client of `3f251c3`, with the calls the shopper app makes, as a visitor and as the demo shopper: search with the nine old arguments, categories, product pages, the cart, orders, an order, the profile and its consent save. Every call answered and matched that build's response schemas                                                                                                                                                                             |
| Browser checks     | At 1280 and 390 px, with no console error, failed request or server error: the shop (menu, search with a brand filter, two offers in the new order, a shop page, a simulated SINPE Móvil purchase with its code and the invoicing sentences); the seller centre (an offer on another shop's product, withdrawn; a variant off and on; a description and a logo); every console catalogue screen and each of its tools, with the shop following on the first look; the field app |
| Logo storage       | Verified against the real storage service: the waiting files go to the private bucket, which no visitor, shopper or other shop can read, list or overwrite; staff read them through a signed link; approval writes the public sizes and removes the waiting ones                                                                                                                                                                                                                |
| Afterwards         | No runtime error on the shop and the field app; on the console and the seller centre only the known "shop did not refresh" (the Vercel login); the scheduled jobs all succeeded; nothing was sent                                                                                                                                                                                                                                                                               |

What this round left on the preview, on purpose: YT-101164 of `comprador`,
paid and then cancelled in the simulation; cafetal's withdrawn offer on
Sendero's bottle; cafetal's description put back by a second approved
request; its test logo removed by the shop (the three public files stay in
the bucket, unlinked); two brands "Prueba Uno" (merged) and "Prueba Dos" (out
of the shop's filter), which only the console shows; once `084100` is on the
preview, deleting "Prueba Dos" from Catálogo → Marcas removes both. Every other Prueba item was deleted. Nothing named Prueba is
visible to a visitor.

On the hosted preview, on 22 November 2026 (06:00 to 06:40 UTC), after
applying migrations `083200` to `083500` and redeploying the four apps. The
commands and numbers are in the runbook, section
[083200 and 083300](docs/07-deployment/runbook-first-deploy.md#migrations-083200-and-083300).

| Check              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before applying    | No order was waiting to become delivered; two refunds were booked; payments in sandbox; the migration role may add a trigger on the sign-in table. `AUTH_GUARD_KEY` was set on all four projects first; nothing else was missing                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Applying           | All four went in at the first try, in 2.6 seconds; no platform difference this time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| One-off changes    | Both refunds got a confirmation marked "before confirmations" and no "refund completed" was announced again; three cantons and 13 districts were corrected ("Montes de Oca", which the drivers' app now shows); no order was in the delivered-and-returned state, so none changed                                                                                                                                                                                                                                                                                                                                                                          |
| Guard              | No app role holds any privilege on any of the 94 tables (14 of them new), view, sequence or column; no write policy; row-level security on everywhere; the workers' functions are closed to the app roles. The network extension's grants are **not** gone ("What needs you", item 3)                                                                                                                                                                                                                                                                                                                                                                      |
| Payments, invoices | Still in sandbox; the simulated payment works; a cancellation of a simulated purchase showed the refund as completed ("en modo de prueba, sin dinero real"). The issuer is not ready, simulated money is not documented, and no document exists. The three new scheduled jobs succeed every run and wake nobody                                                                                                                                                                                                                                                                                                                                            |
| Sign-in limit      | The key's digest is in Vault: a call without the apps' proof is refused; every app signs people in. With two throwaway accounts: wrong passwords until the limit, then "Hubo demasiados intentos de ingreso. Por seguridad, espere 14 minutos…", while the second account signed in. The guesses spread over several of this network's addresses, so the limit held after 21 wrong passwords, not 5                                                                                                                                                                                                                                                        |
| Sessions           | The shop's cookie lasts 90 days, the seller centre's 30, the console's and the field app's 12 hours. A token after sign-out is refused at once; calls take as long as before                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Database tests     | 23 of 24 files passed on the platform before the browser checks; `125_followups` fails at its last check only, on the network extension's grants (above). Run again after the browser checks, `140_invoicing` fails too: it counts every invoice job and document in the database, and the simulated purchases those checks left are counted with the seed's (a fault in the test, being fixed; nothing is issued). Six suites first failed for reasons in the tests, all about a used preview seeded before invoicing (see the runbook); each was fixed without loosening what it proves and passes locally. The suites left every table as they found it |
| Old apps, new data | For the 15 minutes before the redeploy the old apps' pages loaded against the new database; the old field app could not have confirmed a pick in that time (`scan_required`); no action was tried                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Browser checks     | At 1280 and 390 px, with no console error, failed request or server error: a purchase with SINPE Móvil to the delivery code, with the zone's "update coming" notice; one page of each other app; every console section at both widths; the order search keeping names out of addresses; the finance pages in simulation; a wrong product refused at picking and the right one accepted; a stop's district; a return withdrawn                                                                                                                                                                                                                              |
| Afterwards         | No runtime error or log line on the four apps; the scheduled jobs all succeeded; nothing was sent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

What this round left on the preview, on purpose: three orders of
`comprador` (YT-100782 cancelled and refunded in the simulation, YT-100783
with its one line picked, YT-100784 paid and waiting); on YT-100010 the
earlier test's open claim and this round's own claim, both withdrawn by the
shopper; the nine test reports on the Tarrazú coffee closed as tests; two
deleted throwaway accounts (their sign-in records anonymised, as every
deletion does); about 20 sessions of demo accounts left to expire; and 25
sign-in-limit rows, which go within two hours.

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
- **The follow-ups, payments and invoicing on the hosted preview were
  smoke-tested, not exhaustively.** Not tried there: `test` or `live` payment
  mode, any worker (none is deployed), the gateway's notifications, a real
  invoice or Hacienda, the Turnstile check, a refresh-limit wait, an idle
  console session timing out, a fee change, a driver's offline queue, and the
  sign-up screens with e-mail confirmation on (it stays off on the preview,
  so a new address is signed in at once while an existing one sees "Revise su
  correo").
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
- **The native apps have not run on a phone.** The shopper app was built in
  the cloud in your personal Expo account (a preview Android file and an iOS
  Simulator build, now unused) and in the project `yuntera` of your Expo team
  account, where your company's Apple certificate and App Store Connect key
  also live. The Android store build `a20ef1d8-a926-40d4-947d-823cd87be32a`
  (version 0.1.0, version code 4, identifier `com.yuntera.shop`, commit
  `3f251c3`) was sent to Google Play's internal testing track on 22 November
  2026 as a draft release (submission
  `8d09854a-da67-4919-afe6-114fc50f633f`), with your Google key uploaded on
  Expo; it reaches no tester until you release it
  ([`docs/07-deployment/store-testing.md`](docs/07-deployment/store-testing.md)
  has the steps for both stores). No iPhone store build exists yet; run it
  from `3f251c3`. The account screens inside the apps came after `3f251c3`
  and are in no store build. Nothing has
  been started on a phone or a simulator: cloud simulators need a paid Expo
  plan, so the first real look will be a tester's phone. Store-testing builds
  talk to the hosted preview with demo data. While the
  shop is behind the Vercel login, product pictures cannot load in the app; it
  shows a placeholder instead. The web export proves the screens, navigation,
  Spanish text and API calls; it does **not** prove the secure storage of the
  session, the fonts, permission prompts, location, camera, gestures, keyboard
  and safe areas of a real phone. For the account screens in particular: the
  removal of the session and of the app's data from the phone after a
  deletion, entering the second-step code, and following the reset e-mail's
  link from a phone's mail app to the website and back to the app (the
  journey follows the link only through Auth, because the website is not
  running during the native journeys). Auth's rate limits on password checks
  and reset e-mails on the hosted project are not exercised locally (the
  local API stand-in does not enforce them; unit tests use stand-ins).
- **The four newest migrations on the hosted preview were smoke-tested, not
  exhaustively.** Not tried there: a hidden department (only a hidden
  sub-category), a category move, a brand rename, hiding a seller's reply, a
  report acted on as a take-down, a listing edit that pauses another shop's
  offer, a listing back to draft, the cart's other-offer swap, a shop
  closing and handing over its listings, a staff role other than
  administrator, and any native app built after `3f251c3` (none has been
  built against the new functions).
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
  know"): editing fees.
- A screen (or function) to move stock between warehouse locations. A
  location holding stock can be switched off only once orders empty it.
- Editing or removing single-day zone closures that have no period (made
  before `084000`); the console lists them read-only. There are none in the
  seed.
- Sign-in limits as settings: they are constants inside functions, so the
  settings screen cannot show them (if they ever become settings they are
  protected by default).

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
- A reset code typed into the app. The reset e-mail's link opens the
  website, where the new password is set, and the person then signs in to
  the app again; a code in the app needs a mail server of our own, because
  the hosted project cannot change the e-mail's text without one.
- Universal links (opening a yuntera.cr address in the app). No domain serves
  the files the phones check; the apps answer only addresses in their own
  schemes (`yuntera://`, `yuntera-ruta://` and so on), and those were not
  tested.
- Seller app, compared with the seller centre: writing the shop's
  description and uploading its logo (the account screen shows where each
  stands, lets a waiting description be withdrawn and says that both are done
  in the seller centre, under "Tienda"), the seller actions of `083600`
  (offers on another shop's product, variants on and off, a listing back to
  draft, paused offers), photos (above) and "use my current location" for a
  pickup place (only a Plus Code; the app has no location permission). Its terms and privacy links point at
  www.yuntera.cr unless `EXPO_PUBLIC_SHOP_URL` is set.
- Drivers' app: starting a route and delivering against the code need
  signal; a driver suspended while the phone has no signal keeps the
  saved route until a call gets through (at most a day). Notification
  settings are not in the drivers' or the warehouse app, as the web field app
  has none.
- Warehouse app: scanning the bin as well as the product, and a cycle-count
  adjustment screen (neither is in the web app).
- Shopper app: a cart line whose offer sold out says it is no longer
  available; the website offers another shop's offer for it
  (`cart_alternatives`), the app does not yet. There is no brand filter in
  the app's search (the website has one), and its category menu is kept for
  up to an hour, so a category staff just hid can still show there for that
  long (its products stay on sale, as on the website). A product taken down
  shows "No encontramos ese producto".

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
- **Operations through functions, with the shop always delivering somewhere**
  ([decision 41](docs/02-architecture/decisions.md#41-operations-staff-change-zones-districts-the-calendar-settings-locations-and-stuck-routes-through-functions)):
  districts can be "not served"; a holiday is refused on a day with routes
  and needs a confirmation on a day with promised orders; overlapping
  closures are refused; every setting not on the operational list is
  protected; a parcel taken off a route before it left goes back to packed;
  the shop always keeps at least one served district; a stop removed by staff
  shows the shopper "Entrega reprogramada".
- **Brands are deleted only when nothing names them**
  ([decision 42](docs/02-architecture/decisions.md#42-brands-are-deleted-only-when-nothing-names-them-product-pages-refuse-what-is-not-on-sale-at-the-helper)).

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
  existed as direct table writes and the lockdown closed those: editing fees
  and changing a protected setting (the deployment runbook does it). Zones,
  districts, holidays, closures, operational settings and warehouse
  locations came back in `084000`, the seller's actions in `083600`, the
  catalogue's in `083700`.
- Unit economics, launch thresholds and data-retention periods in the strategy
  documents are estimates and say so.
- A payout account finance never approved is not paid. The hosted preview's
  demo accounts were loaded before approvals existed; on 21 November 2026 the
  four the seed treats as approved were stamped approved there by one guarded
  statement, so the preview matches a fresh seed again.
- Dispatch removes pending stops and closes routes under Operación → Rutas
  detenidas (`084000`). The parcel goes back to packed (not yet with the
  driver), to `delivery_failed` with no attempt counted and no message (with
  the driver), or stays cancelled; the cash plan moves; the ledger is
  untouched.
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
  - The hosted preview stores the key's digest in Vault since 22 November,
    and a call without the apps' proof is refused there. A project without
    the digest lets anyone with the public key add rows to the sign-in
    limit's table (they count against nobody and go within two hours).
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
  - The `pg_net` revoke does not take on the hosted project ("What needs
    you", item 3); the API does not expose the schema.
  - Cash on delivery taken in sandbox mode counts as real money for
    invoicing: `invoice_money_documented` treats only the sandbox provider and
    the gateway's test environment as simulated. Nothing is issued while the
    issuer is not set up, but once it is, a new sandbox cash order on the
    preview would get documents. Fixed by `083510` (below), applied there on
    22 November 2026 (evening): apply it before the issuer is set up anywhere
    with demo cash orders.
  - The console's invoices page says the payments waiting "will be issued in
    order" once the issuer is set up; simulated ones never will. The shopper's
    order page without a delivery fee says both that Yuntera issues no
    document and that it issues one for the delivery. Both fixed by `083510` and the
    redeployed console and shop.
  - Sign-in limits were tried from a network that leaves through several
    addresses, so the strict per-address limit was met only after about 20
    wrong passwords; the per-address behaviour as such is covered by the
    local journey.
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
  - Between applying `083200` and redeploying the field app, the old field app
    cannot confirm a pick (`scan_required`): 15 minutes on the preview on
    22 November.
- **Seller listings and the console catalogue (`083600`, `083700`), merged
  on 22 November 2026, on the hosted preview since that evening:**
  - One offer order everywhere (in stock first, then the lowest price, then
    the older offer): search, category pages, the product page, the seller's
    "featured" badge and the cart's alternative. It replaced the weighted
    featured-offer score ([decision 39](docs/02-architecture/decisions.md#39-one-offer-order-everywhere-and-shared-listings-without-review)).
  - An offer on another shop's product needs no review: only active,
    verified shops, at most 30 new ones a day. A "live" offer, the kind that
    keeps the creating shop from taking its listing back to draft, archiving
    it or switching a variant off, is one on sale from an active shop; a
    paused one holds nothing back, and a shop can withdraw its offer for good.
  - A listing edit that would pause other shops' offers is listed in the
    console review and needs staff to tick a confirmation; each paused shop
    is then told (`seller_offers_paused_edit`, e-mail and push).
  - When a shop closes, each listing another active shop still sells passes
    to the shop with the oldest offer on sale (or the oldest paused one), with
    its published photos; a listing staff took down passes on still taken
    down. The closed shop's description, logo and waiting detail changes go.
    The shop that takes a listing over cannot remove the photos the closed
    shop uploaded; staff can.
  - Hiding a category takes it and everything under it out of the menus,
    category pages and sellers' choices (a new listing, an edit, finding a
    product to offer on, a listing edit approved into it); its products stay
    on sale, in search, on their shop's page and at their own address
    ([decision 40](docs/02-architecture/decisions.md#40-catalogue-staff-change-the-catalogue-through-functions-hiding-is-not-taking-down)).
  - A taken-down product is put back only as it was reviewed: once its shop
    changed it, or sent it to review, there is nothing to put back. A seller
    cannot take a taken-down listing back to draft (it is not on sale).
  - A hidden review keeps its row and leaves the rating; its author reads why
    on the order page. The reviewer is not messaged, there is no
    reconsideration queue, and a seller who edits a hidden reply keeps it
    hidden until staff show it.
  - The logo upload is verified against the real storage service on the
    preview (22 November, evening): the browser uploads three sizes with
    signed links to the private bucket `product-photos-pending`, under
    `<seller id>/logo/<logo id>/`, JPEG, PNG or WebP up to 2 MiB each; while
    it waits no visitor, shopper or other shop can read, list or overwrite
    it, and its shop and staff can read it; approval writes the public sizes
    to `product-photos` and removes the waiting files. A logo the shop removes
    stops showing, but its public files stay in the bucket, unlinked: nothing
    deletes them. Not verified: the race of two sessions adding the
    same variant's offer in `seller_add_offer` was checked by hand with two
    database sessions, not by an automated test (the catalogue's two races,
    the rating and the category depth, have contract tests). No message was
    really sent: the new messages were only planned. The native shopper app
    does not offer another shop's offer for a sold-out cart line yet, and the
    native seller app has no screens for these seller actions (it shows where
    the description and logo stand and says they are changed in the seller
    centre).
  - A form the browser posts itself, before an app's scripts have run (or
    when they never load), does what it says, but the page Next.js sends
    back for it is empty: seen on the console's catalogue forms and on the
    sign-in of the shop and the console alike. Nothing is lost; the next
    visit shows the outcome. On the hosted console with JavaScript switched
    off in the browser it is worse: the page's content is streamed into
    hidden containers that only its scripts reveal, so the forms are not
    visible at all; a form submitted anyway does what it says, and the
    answer is a blank page (772 KB of script, no page around it).
  - On the preview, every catalogue change (a category, its address, hiding
    it, a synonym, a review, a take-down, a description, a logo) showed in the
    shop at the first look after it, 2 to 4 seconds later.
  - Brands could not be deleted then: the two test brands of 22 November
    ("Prueba Uno", merged into "Prueba Dos", which is out of the filter) are
    visible in the console only, until `084100` lets staff delete them.
- **The invoicing fixes (`083510`), merged on 22 November 2026, on the
  hosted preview since that evening:**
  - One rule decides whether money is simulated: the sandbox simulation,
    the gateway's test environment, and cash on delivery taken while
    payments are in `sandbox`. Cash collected while payments are in `test`
    is real money. It is decided once, when the payment is captured, and kept
    in `payments.simulated`; payments captured before the migration are
    decided with the mode in force when each was captured (from the settings'
    audit trail), so applying it in any mode is safe. Invoicing, the refund
    channel and refunds of money kept for review all follow it: such money
    never gets a document unless `invoicing_policy.simulated_payments` is on
    (local work, a rehearsal), and its invoice jobs end on their own as
    `simulated_money` instead of waiting for the issuer. On the preview the
    migration ended the 3 waiting capture jobs and the 1 waiting refund job,
    and a purchase made afterwards was marked simulated at capture and its
    job ended the same way within the sweep.
    Real cash collected in `test` mode is documented, and refunded by
    transfer.
  - The console's Comprobantes page and the shopper's order page say what is
    true in simulation, while the issuer is not set up, and once it is. The
    console counts orders, not jobs; in a rehearsal it calls waiting simulated
    payments "de ensayo", never "dinero real", and counts refunds waiting for
    their credit note apart. The "Por día" explanation still describes the
    general rule in simulation.
  - The document writer's escaping is proven at the writer and end to end
    against the fake of Hacienda (checked with libxml2 against the official
    schemas): hostile text stays text, and an e-mail carrying markup is
    refused. A product's name never reaches the platform's documents, so it
    is proven at the writer only. The order-page sentence for a paid,
    documented order whose document has not appeared yet, and the state where
    the seller issues the delivery fee's document, are not checked by a
    journey.
  - Every database suite holds on a used database: each asserts on its own
    fixtures or on differences from a baseline, and leaves no row behind.
    `supabase/scripts/used-db-check.sh <lane> quick|all` proves it on a lane
    (refusing any other database): it makes the lane look like the preview,
    runs every suite twice, compares the row count of every table and needs a
    suite broken on purpose to fail; it removes the role it creates when it
    ends. CI runs `quick` (that step has not run on GitHub yet). Part 2 of
    `100_notifications` (two workers at once) runs only when no other
    session is connected: with a lane's stack up, and on the hosted project,
    it shows a "skipped" row; in CI any skipped row fails the run.
  - On the preview after the migrations, all 28 suites pass; `125_followups`
    `net_grants` and `100_notifications` part 2 report "skipped", for the
    reasons above, and nothing else skips or fails.
- **The native apps' account screens (`083900`), merged on 22 November 2026,
  on the hosted preview since that evening:**
  - `set_my_notification_settings` and `seller_set_notification_settings`
    take one more argument, `p_source`: where the consent was given (`web_cuenta`
    or `shop_app`; `seller_cuenta` or `seller_app`). The old forms are
    dropped, so there is one function of each name. The websites send
    nothing and keep their own value; the apps send theirs. `083900` is on
    the preview, so the shopper and seller apps can now be built with it. The
    shopper build already in Play's internal testing (`3f251c3`) keeps
    working: it never calls these two functions, and every call it makes
    answered on the updated preview with that build's own client.
  - The reset e-mail's link opens `<shop website>/auth/confirm`: that address
    must be in the hosted project's Auth redirect allow-list, and an app's
    build needs `EXPO_PUBLIC_SHOP_URL` if the website's address differs from
    the planned one.
  - Changes in the native apps are never queued while offline: they fail with
    the network message (only the drivers' app keeps an explicit offline
    queue). Halfway through the second step the shopper app reads the
    catalogue as a visitor and sends personal screens to the code screen. The
    notification screens reload what is stored after a "changed elsewhere"
    refusal.

- **The operations tools (`084000`) and the catalogue follow-ups
  (`084100`), merged on 23 November 2026, NOT on the hosted preview yet:**
  - Switching a zone off stops new orders there at once; orders placed keep
    their zone, fee, promise and route. A district marked not served keeps
    its zone for the record; saved addresses there stay saved and cannot be
    chosen until it is served again; seller pickup points there are refused.
  - The shop always keeps a place it delivers to: the last active zone that
    serves a district cannot be switched off, a zone with no served district
    cannot be switched on, and no district move may leave nothing served.
    Proved with two real sessions at once (`contract.operations-races`). A
    new zone gets its districts while it is off, then is switched on.
  - A warehouse location cannot be switched off while it holds stock, is
    named in an open pick task, or has units picked from it into parcels
    still being picked (cancelling those orders puts them back there). A
    trigger keeps stock out of a location that is off. There is no tool to
    move stock between locations. Switching off, renaming or creating a
    location locks the warehouse `FOR NO KEY UPDATE`, so it never deadlocks
    with a stock write (a review found 28 deadlocks in 300 simultaneous pairs
    with `FOR UPDATE`; a race test now holds a stock write between its two
    writes and fails with the old lock).
  - A stop staff remove while the driver has the parcel: `delivery_failed`
    with `attempt_count` 0, no message, the status entry hidden; the
    shopper's order page (web and native) says "Entrega reprogramada";
    dispatch and the staff order page say "quitado de una ruta, sin intento
    de entrega", and the staff order history says the same instead of a
    status code; the driver's count, the parcels the driver is told to
    collect and the dispatch card leave the stop out. A stop removed before
    the route starts tells the driver not to collect that parcel. The order's
    heading says "Entrega reprogramada" when every parcel still to deliver
    was rescheduled; **the shopper's list of orders still says "En camino"**
    for such an order (`my_orders` carries no parcel states). **Left as it is:** a
    parcel that had a real failed attempt, went out again and was then
    removed by staff has `attempt_count` 1, so the shopper still reads "No
    pudimos entregarlo". The shopper app in the stores' test tracks
    (`3f251c3`) shows any removed stop as "Entrega fallida" until rebuilt.
  - Colón inputs in the console accept whole colones in Costa Rican form
    ("1.500", "1 500", "1.500,00") and refuse céntimos. A closure cancelled
    before it started stays on Cierres for 7 days with "Volver a cerrar". A
    closure that starts today reads "En curso · Empezó hoy", and ending it
    says it is cancelled (no day of it had passed). After a refusal, the
    confirmation boxes on Ajustes and Feriados stay as they were ticked.
    Names and reasons staff type lose invisible characters (Hangul fillers
    and tag characters included) and Unicode spaces count as spaces.
  - Every place the shop names an area it does not deliver to says "por
    ahora" with a next step, in the web and the native apps; help and landing
    texts describe the Gran Área Metropolitana as today's area.
  - A brand is deleted only when no product names it in any status; the
    brands merged into it go with it and their addresses are free again. A
    product page opens for the public only while the product is on sale; its
    own shop and staff still see it (their preview).
  - The `packages/db` contract files now run one at a time: the zone races
    commit, for a moment, a shop with its zones off.
  - The journeys that take stops off a route build their own route from new
    orders of the third demo shopper, so the seed's route R-1003 and waiting
    orders stay as the database suites expect. `020_access`,
    `050_fulfillment` and `095_account_security` now also hold when other
    journeys drove R-1003 to the end or the warehouse took a shopper's order
    further (`used-db-check.sh all` failed on them before).
  - Not verified: real PostgREST passing the new functions' array and JSON
    arguments (only the local API stand-in), anything on the hosted preview,
    and the native apps on a phone (their screens ran only as web exports).

## Running it

[`README.md`](README.md) has the commands and the demo accounts. Five minutes
from a clean checkout to all four apps running locally.
