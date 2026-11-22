# Status

Updated 21 November 2026, after account security, notifications and product
photos were merged with people management, seller payouts, the fixes to known
limitations and the native apps, and then applied and tried on the hosted
preview. This is the honest state
of the project: what exists, how far it was checked, and what only the owner
can do.

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
organisation, with all 25 migrations applied and the demo data loaded. The last
three (account security, notifications, product photos) were applied and tried
there on 21 November 2026, and the four apps were redeployed with them; the
notification worker is not deployed, so nothing is sent. The
four web apps are deployed as a preview on Vercel at
`yuntera-web`, `yuntera-vende`, `yuntera-central` and `yuntera-campo` (each
`.vercel.app`); every address is behind a Vercel login, and the projects are
not connected to the Git repository. A shopper app for iOS and Android exists
with every shopping flow of the website, and the seller, driver and warehouse
apps have every flow of their web counterparts (the drivers' app also shares
the position during a route and works without signal); none of those three
has been built for a phone yet. The shopper app's first store build for Android
exists and waits for your Google key to go to Play's internal testing; no
build has run on a phone or simulator yet. Payments and
invoices are still simulated or missing, and no message is sent for real (see
"Not built").

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
3. **Open a pull request for this branch** (`claude/vigilant-edison-lh64v2`)
   when you want it on `main`. I did not open one because you had not asked.
   The CI workflow will run for the first time then; its steps were run by hand
   here but it has never run on GitHub.
4. **Business set-up that only you can do:** the legal entity and its
   registration with Hacienda, a payment gateway contract (cards and SINPE
   Móvil), the electronic-invoicing provider, a bank account, and the support
   mailboxes the screens mention (`ayuda@yuntera.cr` does not exist yet).
5. **Set up messaging before any message can be sent.** Nothing reaches a
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
6. **Decide on e-mail for the preview.** Supabase refuses our Spanish e-mail
   templates on a free project that uses its built-in sender, so the preview
   still has Supabase's default English ones, whose link the apps' confirmation
   page does not read. The built-in sender also mails only members of your
   Supabase organisation, and never a `.example` address. Custom SMTP (or the
   messaging provider in item 5) fixes all three; then run
   `supabase/scripts/auth-config.sh apply lfulotisyeyooxecwnox preview` again
   and send yourself one real password reset. Until then, keep e-mail
   confirmation off there.
7. **Open Authentication → Users in the Supabase dashboard once** and check it
   loads. Accounts deleted through the apps stay there, anonymised; Auth read
   such a row without error, but its user listing needs the secret key, which
   nothing here uses, so the listing itself was not opened.
8. **Know what the preview costs.** The Vercel projects are on your Pro plan,
   which bills by use. The Supabase project is in the free organisation.
9. **Before the native apps go to a store:**
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

| Part                 | Where                                                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop                 | `apps/web`                                                         | Home, search with typo tolerance, categories, product pages with competing offers and a delivery date, cart, checkout with SINPE Móvil, card or cash on delivery, orders with tracking and delivery code, returns, reviews, account, help. An unknown product or category address answers "not found" (404). Product photos in a gallery and in every list. Password reset, e-mail confirmation, notification settings (channels, WhatsApp number, commercial consent), account deletion, and a public page on how to delete an account                              |
| Seller centre        | `apps/seller`                                                      | Shop registration, listings with an itemised fee preview, editing a listing (changes to a published one wait for review), prices, stock, stock sent to the warehouse, packing, per-order statements, what is available, pending and on its way to the bank, and a request to change the payout account. A photo manager on each listing (resized in the browser, reviewed before they show), the shop's notification settings, an optional second factor                                                                                                             |
| Internal console     | `apps/ops`                                                         | Daily queues, orders, manual confirmation of transfers, route planning and dispatch, cash settlement, returns and refunds, complaints, content reports, product and listing-edit review, seller verification, staff, drivers, warehouse workers, payout account approvals, payout runs, audit trail. Photo review and take-down, the messages each order produced and the stuck ones with a resend button, staff's second factor (enrolment, the second step at sign-in, an administrator's reset of a colleague's)                                                  |
| Routes and warehouse | `apps/field`                                                       | Driver: the day's route, navigation links, delivery against the customer's code, cash, failed deliveries, position sharing. Warehouse: pick lists with scan check, packing, receiving, stock lookup. Password reset and account deletion as in the other apps                                                                                                                                                                                                                                                                                                        |
| Database             | `supabase/`                                                        | 25 migrations, 74 tables (60 public, 14 private), 146 functions (135 for the apps, 11 server-side only), two storage buckets with their rules, row-level security on every table, double-entry ledger, stock ledger, the 494 districts of Costa Rica with delivery zones, demo data                                                                                                                                                                                                                                                                                  |
| Domain logic         | `packages/core`                                                    | Money and IVA, fees, featured-offer choice, search ranking, sourcing, delivery promise, routing, risk scoring, seller score, Costa Rican identifiers, IBANs, phones and Plus Codes                                                                                                                                                                                                                                                                                                                                                                                   |
| Native apps          | `apps/*-native`, `packages/expo-kit`                               | Expo SDK 58. Shopper app: every shopper flow of the website. Seller app (Yuntera Vende): every seller-centre flow, packing to payouts and shop registration. Drivers' app (Yuntera Ruta): every driver flow, plus position sharing during a route and work without signal. Warehouse app (Yuntera Bodega): picking by camera or hand scanner, packing, receiving, stock lookup. The three ask for the second factor. `packages/expo-kit` is what all four share. None of the three has been built for a phone yet; until then, their users work in the web apps, too |
| Notifications        | `packages/notifications`, `supabase/functions`, `tools/dev-notify` | A planner in the database turns each event into one message per person and channel, exactly once; a worker sends them by e-mail, WhatsApp, SMS and push with retries and dead letters; signed delivery reports; quiet hours; suppressions; account e-mails in the same words as Auth's templates. Runs locally against fake providers only                                                                                                                                                                                                                           |
| Shared code          | `packages/{brand,ui,db,next-kit}`                                  | Brand tokens and logo, components, the typed API client with a message for every error, and what all apps share (session, security headers, forms)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Documentation        | `docs/`                                                            | Strategy, product scope, architecture and decisions, data model, access control, API reference, one document per algorithm, security and compliance, operations, deployment runbook and go-live checklist, research notes for the next phase                                                                                                                                                                                                                                                                                                                         |
| Brand                | `docs/brand/`, `packages/brand/`                                   | Naming report, brand book ([published page](https://claude.ai/artifact/MJv6X1GarCNg1sZfuGjxfT), private to you until you share it; text in `docs/brand/brand-book.md`), logo files                                                                                                                                                                                                                                                                                                                                                                                   |

How the new parts work, in short:

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
  suppressions) and keeps the orders and ledger the law requires, detached from
  them. It waits while an order, return, refund or complaint is open, or while
  the person alone runs an open shop.
- **Messages.** Order and shop events become messages by e-mail, WhatsApp, SMS
  and push, per person's choices. Order messages always go by e-mail; WhatsApp
  and SMS need a mobile number; a number that sent STOP is switched back on
  only from that phone. Commercial messages need a separate consent, which
  starts unticked.
- **Photos.** Sellers upload into a private bucket; staff review the largest
  size; the console then writes the three public sizes from that copy, so
  only what staff saw, without location data, reaches the shop. Staff can take
  down any photo.

## How it was checked

On a development machine, after the last change, on the combination of
everything above (lane 1 of `tools/dev/stack.sh`, each suite on a freshly
seeded database):

| Check                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests           | 918 pass (core 256, native kit 286, notifications 196, seller app 36, shared web code 30, drivers' app 26, brand 21, API client 19, local API 16, warehouse app 16, shopper app 11, fake providers 5); the native counts are from the merge of the three staff apps, in lane 5                                                                                                                                                                                                                                                                 |
| Database tests       | 14 files pass on PostgreSQL 16: access control per role, checkout, money, fulfilment, search, delivery promise, the API, the back office, people and payouts, the fixes, one order from three sellers paid out end to end, account security (second factor, per-request check, deletion searched for in every row of every table after the person had messages and, as a seller, a photo), notifications, product photos                                                                                                                       |
| API contract tests   | 74 pass in 8 files: every screen's payload, called as each role, matches the types the apps use                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Browser journeys     | 13 pass in Chromium, each on a freshly seeded database, with no console errors or server errors: shopper, seller, staff, driver and warehouse, people, payouts, listing edits, the shop's 404 answers, password reset, staff's second factor, account deletion, notifications (against the fake providers) and product photos. The first full run failed once in password reset, because the journey read a page before its answer had streamed in on this loaded machine; the journey now waits for it, and the second full run passed all 13 |
| Native journeys      | 5 pass (242 checks) through the web export of the native apps, in Chromium at phone size, each on a freshly seeded database (lane 5, after the merge of the seller, driver and warehouse apps): shopper (27), seller (62, with a seller's second step), driver (70, with a stretch without signal, a suspension mid-route and what is left on the phone), warehouse (47, picking by scan) and staff (36: the right and wrong kinds of account for the three staff apps, and signing out offline)                                               |
| Callers of the API   | Probed through the local API: a visitor, a shopper, staff without a factor, staff with a factor before the second step (refused everything but the second step's own calls), the notification worker's secret key (answered, about 9 ms a call on this loaded machine), and a token after sign-out (`session_ended`)                                                                                                                                                                                                                           |
| Native configuration | For each of the four apps in each variant: Expo's configuration resolves (public and introspect), versions match Expo SDK 58, expo-doctor passes 20 of 20, the iOS, Android and web bundles export with no duplicate-React warning and the bundle scan finds no cipher; every purpose string is Spanish                                                                                                                                                                                                                                        |
| Lint and types       | No lint errors (96 warnings and 195 notes, of kinds already there) and no type errors in the 17 typecheck tasks                                                                                                                                                                                                                                                                                                                                                                                                                                |

Money and the documented example still hold: every ledger transaction sums to
zero, a seller's available + pending + in transit equals the ledger balance,
and the fee example (₡20,000, hogar, card, shipped by the seller) still pays
out ₡16,203.20.

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
SMTP and refuses to send to `.example` addresses ("What needs you", item 6).

The test data from this round is gone: the throwaway accounts were removed,
and the test listing (a coffee maker of TecnoCasa) was archived. What stays:
that archived listing with its six photo records and the public files of its
two approved photos, and one notification job for its review, which a worker
would plan once it is deployed.

What these checks do **not** cover, stated plainly:

- **The hosted preview was smoke-tested, not exhaustively tested.** Not tried
  there: a staff role other than administrator, creating a payout run, a
  seller with a second factor, the notification worker's secret key, and a
  real phone.
- **No real money, messages or invoices.** Payments are in sandbox mode; no
  gateway or electronic-invoicing provider is connected. Messages go only to
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

- Payment gateway integration (cards, SINPE Móvil confirmation by webhook).
  Today finance confirms transfers by hand in the console and cards cannot be
  charged.
- Electronic invoices to Hacienda. The data model and the events exist; nothing
  sends them.
- Sending messages for real. The pipeline, the worker, the templates and the
  screens are built, but nothing is sent until you set up the messaging
  provider ("What needs you"). The four WhatsApp templates are written and not
  submitted. Phone numbers for WhatsApp and SMS are not verified by a code.
  Not built: commercial messages (no template and no one-step unsubscribe
  page), the daily staff summary of stuck messages, a clean-up of old message
  rows, a refund-completed message for staff-approved return refunds, and the
  team mailboxes (staff messages are skipped until you add them).
- A scheduled clean-up of unused photo files. Files nothing needs are deleted
  only when a seller or catalogue staff act.
- A bank connection for payouts. Transfers are made by hand and recorded in
  the console.

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
- Seller app: inviting members, changing the shop's contact phone or e-mail
  (not on the web either), and "use my current location" for a pickup place
  (only a Plus Code; the app has no location permission). Its terms and
  privacy links point at www.yuntera.cr unless `EXPO_PUBLIC_SHOP_URL` is set.
- Drivers' app: a stop's district is not shown (`driver_today` does not return
  it); actions sent after a dead zone are stamped with the time they arrive,
  not the time they happened; starting a route needs signal; a driver
  suspended while the phone has no signal keeps the saved route until a call
  gets through (at most a day).
- Warehouse app: scanning the bin as well as the product, and a cycle-count
  adjustment screen (neither is in the web app).
- Database checks the apps cannot make alone: `wms_confirm_pick` does not
  compare the scanned code, `wms_receive` accepts more than was announced,
  `driver_today` answers a suspended driver, and `driver_fail_stop`,
  `driver_complete_stop` and `driver_report_position` do not range-check
  coordinates.

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

- A refund returns the commission to the seller but not the payment and
  warehouse fees. That is a policy choice I made; confirm or change it.
- Unit economics, launch thresholds and data-retention periods in the strategy
  documents are estimates and say so.
- Payout accounts that existed before today are not marked as approved by
  finance. They are refused only if the account number fails its check.
- A seller can no longer change the shop's contact phone or e-mail (finance
  calls that phone to confirm a change of payout account). They need a
  reviewed way to do it.
- A package above the largest warehouse size (120 cm or 30 kg) gets no
  warehouse fee. It should be refused or priced.
- Another shopper's order page shows "not found" but answers with status 200
  rather than 404.
- A visitor can file any number of content reports, including about things that
  do not exist: there is no rate limit and no check that the target exists.
  This must be fixed before production.
- The shop refreshes its cached catalogue when a listing edit is approved or a
  listing is archived, through a key (`SHOP_REFRESH_KEY`) set to the same
  value on the shop, the seller centre and the console. It is set on the
  preview, but while the shop sits behind the Vercel login the request cannot
  reach it and is logged as an error; changes still appear within about a
  minute. It works once the shop is public.
- After a shopper chooses a delivery zone on a product page, the old date and
  shipping price stay on screen for a few seconds before the new ones replace
  them, with nothing showing that an update is on its way.
- Wrong second-factor codes are limited to five in 15 minutes per account only
  for codes sent through the apps. Codes sent to Auth directly meet only its
  per-address limit until Auth's verification hook is enabled (Team plan).
- A shop that traded and closed keeps its legal name and identification number
  for the tax retention period, so the same cédula cannot open a new shop
  during that time.
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

## Running it

[`README.md`](README.md) has the commands and the demo accounts. Five minutes
from a clean checkout to all four apps running locally.
