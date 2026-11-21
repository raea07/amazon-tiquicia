# Go-live checklist

Everything that must be true before a stranger pays real money. It is long
because most of what stands between this repository and a real order is not
software.

Each item is marked with what it is: **Build** (code that does not exist yet),
**Configure** (a setting), **Decide** (the owner, with advice), or **Do** (a
task in the real world). An unticked **Build** item in the first three sections
means the platform cannot take a real order at all.

Related: [open questions](../08-open-questions.md) for the decisions,
[compliance](../05-security-compliance/compliance-costa-rica.md) for the legal
basis, [roadmap](../01-product/roadmap.md) for the order of things.

## 1. Payments leave sandbox

Today `payments_mode` is `sandbox` and every payment is simulated.

- [ ] **Decide** the gateway and sign the contract
      ([open questions 6–8](../08-open-questions.md)). Confirm in writing: the
      contracted rates and fixed fees, whether its marketplace flow supports
      SINPE Móvil, who is merchant of record, settlement timing, and the
      refund and chargeback process.
- [ ] **Build** the gateway integration:
  - [ ] Card details entered only on the gateway's hosted fields or page. No
        card number ever reaches Yuntera's servers or database.
  - [ ] A server-side webhook handler (a Supabase Edge Function) that verifies
        the gateway's signature and calls `private.capture_payment`. This is
        the first code that needs a secret; it lives in the function's secrets.
  - [ ] SINPE Móvil matching. Today the shopper is shown a reference code and
        finance staff confirm each transfer by hand against the bank statement
        (`ops_confirm_payment`). That works for a pilot and stops working at
        volume: have the gateway match transfers and notify the webhook.
  - [ ] Refunds through the gateway, by the same payment method. The database
        emits `refund.requested`; nothing listens.
  - [ ] Failed and abandoned payments update the payment row.
- [ ] **Build** the outbox worker that delivers events
      ([decision 12](../02-architecture/decisions.md#12-outbox-events-for-work-outside-the-transaction)).
- [ ] **Configure** `payments_mode = live`. This disables
      `confirm_sandbox_payment`.
- [ ] **Do** a real end-to-end payment and a real refund, of a small amount,
      with each method, on production, before announcing anything.
- [ ] **Decide** the cash-on-delivery ceiling and whether cash is offered at
      launch at all.
- [ ] **Build** the fix for the fixed payment fee being charged once per seller
      ([fees](../04-algorithms/fees-and-settlement.md#what-the-database-does-and-where-it-differs-from-the-specification)),
      and update the fee schedule to the contracted rates in both the SQL rows
      and `packages/core/src/fees.ts`.
- [ ] **Confirm in writing** with the gateway what PCI DSS obligations remain
      with Yuntera under the hosted-fields model.

## 2. Legal entity, tax and invoicing

- [ ] **Do** incorporate the company; register with Hacienda; open the business
      bank account ([open questions 3–4](../08-open-questions.md)).
- [ ] **Decide**, with the accountant: who is the taxpayer for each sale; how
      card withholdings apply; whether the delivery charge is invoiced by
      Yuntera at 13% ([open questions 21–29](../08-open-questions.md)).
- [ ] **Build** electronic invoicing for what Yuntera itself must invoice: its
      fees to sellers, and the delivery charge to shoppers. The
      `electronic_invoices` table records state; nothing issues, signs or
      submits a document. In practice this means integrating a certified
      invoicing provider.
- [ ] **Decide** how sellers' own invoices to shoppers are issued in the pilot
      (each seller from their own system is the default) and how the shopper
      receives them.
- [ ] **Do** register the SINPE Móvil numbers Yuntera collects on, as the
      decree requires.
- [ ] **Do** replace the placeholders in the storefront footer — "entidad en
      formación", "cédula jurídica pendiente" — with the real legal name,
      identification number and address: merchant identity is among the
      mandatory online disclosures
      ([fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection)).
- [ ] **Build** seller payouts: a function that creates a payout, posts it to
      the ledger and records the bank reference. Until then payouts are manual
      and must be recorded by hand.
- [ ] **Decide** who bears which fees when an item is returned, and whether
      shipping is refunded. The code currently returns the commission to the
      seller and leaves them the payment and warehouse fees
      ([fees](../04-algorithms/fees-and-settlement.md#returning-part-of-an-order));
      that was an engineering default, not a decision.
- [ ] **Build** the step that actually sends a refund to the shopper and
      records the money leaving. Refunds are booked in the ledger and not paid.

## 3. Terms, privacy and consumer law

- [ ] **Do** have a lawyer write or review: terms and conditions, the seller
      agreement, the privacy notice, the driver agreement, and the returns
      policy. The texts in the storefront's help page and in
      [privacy](../05-security-compliance/privacy.md) are drafts.
- [ ] **Decide** whether registration with PRODHAB is required
      ([open question 35](../08-open-questions.md)), and do it if so.
- [ ] **Do** create the privacy mailbox named in the consent text and decide
      who answers it within the internal deadline.
- [ ] **Build** the data-subject flows the privacy notice promises: export of a
      person's data, and account deletion that respects the records the law
      requires keeping.
- [ ] **Build** retention jobs for the periods in the privacy document — once
      those periods are confirmed; they are assumptions today.
- [ ] **Build** e-mail confirmation handling and a password-reset flow in the
      apps ([runbook, step 6](runbook-first-deploy.md#6-configure-sign-in)).
- [ ] **Build** transactional messages: order confirmation, payment received,
      out for delivery with the PIN reminder, delivered, refund issued. The
      order confirmation by e-mail is what
      [compliance](../05-security-compliance/compliance-costa-rica.md) relies
      on as the shopper's durable receipt.
- [ ] **Confirm** the withdrawal, refund and warranty periods and how they are
      counted, with the lawyer. The code implements 8 business days from
      delivery, 8 calendar days to refund, and 30 business days of warranty.
- [ ] **Re-check** everything in the fact sheet's
      ["recently changed"](../research/costa-rica-fact-sheet.md#recently-changed--re-check-before-launch)
      list.

## 4. Security

- [ ] **Configure** `require_staff_mfa = true`, after the console can enrol and
      challenge a second factor. Every staff account enrolled.
- [ ] **Confirm** in the browser's developer tools that the session cookie is
      `HttpOnly` and `Secure` on the live site. The apps set both (the Supabase
      server library's own default is not `HttpOnly`; see `SESSION_COOKIE` in
      `packages/next-kit`), because no script in the page ever needs the token
      ([decision 7](../02-architecture/decisions.md#7-a-static-content-security-policy-with-unsafe-inline-scripts)).
- [ ] **Confirm** no third-party script has been added to any app. If one has,
      revisit the Content-Security-Policy decision.
- [ ] **Configure** rate limits and bot protection: Supabase Auth's limits and
      CAPTCHA for sign-up and sign-in; Vercel's firewall rules for the apps.
- [ ] **Configure** leaked-password protection and the password policy.
- [ ] **Configure** the internal console on its own domain, not indexed, with
      deployment protection or an allow-list in front of it.
- [ ] **Do** run the access test suites against a project built exactly like
      production ([runbook, step 5](runbook-first-deploy.md#5-seed-the-preview-and-run-the-access-tests)).
- [ ] **Do** run Supabase's security advisors and resolve every finding.
- [ ] **Configure** storage buckets and their policies before any upload
      feature ships: seller images, proof-of-delivery photos.
- [ ] **Do** disable the legacy API keys on the project; only the publishable
      key is used.
- [ ] **Do** confirm that no secret key is present in any Vercel project's
      environment variables or in the repository's history.
- [ ] **Do** an independent penetration test before public launch.
- [ ] **Configure** dependency and secret scanning in CI.

## 5. Backups and recovery

- [ ] **Configure** production on a paid plan: daily backups exist.
- [ ] **Decide** on point-in-time recovery. Daily backups mean losing up to a
      day of orders and payments in the worst case; point-in-time recovery
      narrows that to minutes at roughly US$100 a month plus a larger compute
      size. A reasonable position for the pilot: daily backups, plus the
      nightly export below; turn on point-in-time recovery when a day's orders
      are worth more than its cost.
- [ ] **Configure** a nightly logical export (`supabase db dump`) to storage
      outside Supabase, encrypted, kept for 30 days.
- [ ] **Do** a restore drill: restore a backup into a scratch project, run the
      checks in [operations](operations.md#backups-and-the-restore-drill), and
      write down how long it took. A backup that has never been restored is a
      hope, not a backup.

## 6. Monitoring and on-call

- [ ] **Configure** error monitoring in every app, with personal data scrubbed
      from reports. Nothing is installed today.
- [ ] **Configure** uptime checks on each app's home page and on a database
      function.
- [ ] **Configure** alerts, to the founder's phone, for: an app down; error
      rate above normal; the database near its connection, CPU or disk limits;
      a cron job that did not run; outbox events unprocessed for more than a
      few minutes; a payment webhook failing.
- [ ] **Build** the daily operational checks as a screen or a saved query:
      orders paid but not picked, parcels packed but not dispatched, routes not
      settled, late shipments, returns awaiting a decision, complaints open.
- [ ] **Decide** who is on call and what "on call" means for a one-person
      company: hours covered, the backup person, and what shoppers are told
      outside them.
- [ ] **Do** write the incident contacts into
      [operations](operations.md#incident-response): gateway support,
      Supabase support, Vercel support, the lawyer, the accountant.

## 7. Operations are ready

- [ ] **Do** recruit and sign the first sellers
      ([open question 10](../08-open-questions.md)).
- [ ] **Do** engage drivers on a basis the lawyer has approved in writing, with
      insurance in place ([open questions 17–20](../08-open-questions.md)).
- [ ] **Do** set up the storage space: shelving, bin labels matching
      `warehouse_locations`, packaging, a scale, a label printer.
- [ ] **Configure** zones, cutoffs, shipping fees, the free-shipping threshold
      and the holiday calendar for the year.
- [ ] **Configure** the real categories and their commission rates.
- [ ] **Do** a full dress rehearsal with real people and a real parcel: list,
      receive, order, pay, pick, pack, route, deliver with PIN, collect cash,
      settle, return, refund.
- [ ] **Do** set up the support channel and its hours
      ([customer service](../06-operations/customer-service.md)).

## 8. The apps

- [ ] All four apps deployed and smoke-tested on production.
- [ ] **Decide** whether the mobile web app is enough for drivers in the
      launch zones, from the rehearsal: signal on real routes, and whether
      dispatch needs live positions
      ([decision 4](../02-architecture/decisions.md#4-one-mobile-web-app-for-drivers-and-warehouse-native-apps-deferred)).
- [ ] Accessibility checked on the purchase journey with a keyboard and a
      screen reader.
- [ ] Performance measured on a mid-range Android phone over mobile data.
- [ ] Demo data and demo accounts do not exist in production.
- [ ] The browser journey test is committed and runs in CI.

## 9. Brand

- [ ] **Do** register the domains. None is registered.
- [ ] **Do** the trademark search and filing
      ([naming report](../brand/naming.md)).
- [ ] **Do** reserve the social handles.
- [ ] If the name must change: edit `packages/brand/src/brand.ts` and the logo,
      then follow the manual list in
      [decision 14](../02-architecture/decisions.md#14-the-name-lives-in-one-file).
