# Notifications

What Yuntera tells people, by which channel, how a message that does not go
out is handled, and what has to be set up in Bird, Meta, Expo and Supabase
before anything is sent for real.

Sources: `supabase/migrations/20261121082600_notifications.sql` (the queue and
who gets what), `packages/notifications` (templates, providers, the worker),
`supabase/functions/*` (the three Edge Functions), and the research note
`docs/research/notifications-email-whatsapp-push.md` with its fact-check.

**State on 21 November 2026.** Built and tested end to end on a development
machine, against a local fake of Bird and Expo. **Never run against the real
Bird, Meta, Expo or Supabase services**; nothing has been deployed or sent.

## What is sent, to whom, when

The table below is checked against the planner in the migration by
`packages/notifications/src/docs.test.ts`: a change to who gets what fails
the tests until this table says the same.

Channels: `email` always for the messages of an order (it is the receipt);
`push` only to a phone where the person signed in to a Yuntera app and kept
app notifications on; `whatsapp` only when the person (or the shop) switched
it on and gave a mobile number; `sms` only when switched on, and only when
neither push nor WhatsApp can reach them. Staff messages go to a shared team
mailbox, not to each person.

<!-- BEGIN notification-table -->

| Event                       | Template                        | Who                    | Channels                           |
| --------------------------- | ------------------------------- | ---------------------- | ---------------------------------- |
| `order.placed`              | `order_placed`                  | shopper                | `email`, `push`, `whatsapp`        |
| `order.placed`              | `staff_payment_to_confirm`      | finance team           | `email`                            |
| `payment.captured`          | `payment_received`              | shopper                | `email`, `push`                    |
| `order.released`            | `seller_new_order`              | each shop in the order | `email`, `whatsapp`, `push`        |
| `order.cancelled`           | `order_cancelled`               | shopper                | `email`, `push`                    |
| `order.cancelled`           | `seller_order_cancelled`        | each shop in the order | `email`, `push`                    |
| `refund.requested`          | `refund_initiated`              | shopper                | `email`                            |
| `refund.completed`          | `refund_completed`              | shopper                | `email`, `push`                    |
| `shipment.scheduled`        | `shipment_scheduled`            | shopper                | `email`, `push`                    |
| `shipment.out_for_delivery` | `shipment_out_for_delivery`     | shopper                | `push`, `whatsapp`, `email`, `sms` |
| `shipment.delivered`        | `shipment_delivered`            | shopper                | `email`, `push`                    |
| `shipment.delivery_failed`  | `shipment_delivery_failed`      | shopper                | `push`, `whatsapp`, `email`, `sms` |
| `shipment.delivery_failed`  | `staff_delivery_failed`         | operations team        | `email`                            |
| `return.requested`          | `return_received`               | shopper                | `email`                            |
| `return.requested`          | `return_approved`               | shopper                | `email`                            |
| `return.requested`          | `staff_return_requested`        | care team              | `email`                            |
| `return.decided`            | `return_approved`               | shopper                | `email`, `push`                    |
| `return.decided`            | `return_rejected`               | shopper                | `email`, `push`                    |
| `return.received`           | `return_goods_received`         | shopper                | `email`, `push`                    |
| `delivery_code.locked`      | `delivery_code_locked`          | shopper                | `email`, `push`                    |
| `delivery_code.locked`      | `staff_delivery_code_locked`    | care team              | `email`                            |
| `delivery_code.released`    | `delivery_code_released`        | shopper                | `email`, `push`                    |
| `complaint.filed`           | `complaint_received`            | shopper                | `email`                            |
| `complaint.filed`           | `staff_complaint_filed`         | care team              | `email`                            |
| `complaint.answered`        | `complaint_answered`            | shopper                | `email`                            |
| `case.answered`             | `case_answered`                 | shopper                | `email`, `push`                    |
| `content.reported`          | `staff_content_reported`        | trust team             | `email`                            |
| `report.resolved`           | `report_resolved`               | whoever reported it    | `email`                            |
| `product.reviewed`          | `seller_listing_approved`       | the listing's shop     | `email`, `push`                    |
| `product.reviewed`          | `seller_listing_rejected`       | the listing's shop     | `email`, `push`                    |
| `product.staff_changed`     | `seller_listing_staff_change`   | the listing's shop     | `email`, `push`                    |
| `seller.status_changed`     | `seller_account_status`         | the shop               | `email`                            |
| `seller.member_invited`     | `seller_invitation`             | the invited account    | `email`, `push`                    |
| `seller.change_decided`     | `seller_change_decided`         | the shop               | `email`, `push`                    |
| `payout_details.decided`    | `seller_payout_account_decided` | the shop               | `email`, `push`                    |
| `payout.paid`               | `seller_payout_paid`            | the shop               | `email`, `push`                    |
| `fees.offers_paused`        | `seller_offers_paused_fees`     | the shop               | `email`, `push`                    |
| `route.assigned`            | `driver_route_assigned`         | the driver             | `push`                             |

Since wave 9 (`084700`): an answer to any case other than a complaint (a
return, a report, a recorded contact) plans `case_answered`, by e-mail and
push, through `ops_answer_case`; its event is recorded as already processed,
because no worker consumer reads that topic. Like `complaint_answered`, it
says an answer is waiting in the shopper's account and on the order's page,
never the answer itself. The answer times the messages promise come from
`packages/core/src/service-times.ts` (the targets of `private.case_targets`):
`complaint_received` promises a written answer within 5 working days (it said
10 before wave 9; the law's 10 working days stay in the staff template), and
`return_received` 1 working day for a withdrawal and 2 working hours for a
damaged, wrong or warranty item (it said 3 working days). A test in
`packages/notifications` keeps the templates' words equal to core's.

<!-- END notification-table -->

One message is planned outside the table's planner: when catalogue staff
confirm a listing edit that pauses other shops' offers (migration 083600),
`ops_review_listing_edit` itself plans `seller_offers_paused_edit` (`email`,
`push`) for each of those shops, from an event `listing_edit.offers_paused`
it records for them. Only the approval knows which offers it paused, so the
planner, which reads events after commit, could not tell.

When each event happens:

- `order.placed`, `payment.captured`, `order.released`, `order.cancelled`,
  `refund.requested` come from checkout and payment; `order.released` follows
  payment (or comes at once for cash on delivery).
- `shipment.scheduled` when a parcel is put on a route (the evening before,
  per the logistics playbook); `shipment.out_for_delivery` when the driver
  starts the route; `shipment.delivered` / `shipment.delivery_failed` at the
  door; `route.assigned` when a route gets its driver. These four are emitted
  by triggers added by this migration.
- `refund.completed` when a refund's confirmation is recorded
  (`private.confirm_refund`, migration 083200): in sandbox mode when the
  refund's transaction commits, after its `refund.requested`; in live mode
  only when the payment gateway work calls it with the gateway's or bank's
  reference. Marking a payment refunded no longer announces anything.
- Refunds of one order booked by one transaction together with a delivery-fee
  refund (the goods of the last parcel and the fee, when an order whose
  parcels came back without anyone going to the door is cancelled; migration 084600) are announced as one: `refund_initiated` once, on the fee's
  `refund.requested`, and `refund_completed` once, on the event of the last of
  them to be confirmed, both with the total (`amount_minor`) and the fee's
  part (`delivery_fee_minor`; the text says "el envío incluido"). The other
  events of the group plan nothing (`private.refund_announcement`).
  "Refund arrived" therefore waits for the last refund of the group: when the
  goods' refund is confirmed and the fee's is still open (its gateway refund
  not answered yet, or failed and waiting for finance to record a bank
  transfer), the shopper is told nothing about the goods until the fee is
  confirmed too, and then once, with the total. A gateway refund that fails
  sends no event, so finance's transfer is what releases the message. A refund
  settled at the door is never part of a group, and refunds of different
  orders never are, also when one transaction books them (the unpaid-order
  sweep books none: it cancels only unpaid orders; `175_refunds_across_streams`). Every
  other refund, a fee or goods refunded alone, a later separate refund, is
  announced on its own as before. Planning such an event again plans nothing
  new.
- `return.received`, `delivery_code.locked`, `delivery_code.released`,
  `seller.member_invited` (only for an account that had the address when it
  was invited, and planned only to that account's confirmed address),
  `seller.change_decided`, `payout_details.decided`, `payout.paid` and
  `fees.offers_paused` come from the functions of those steps (migration
  083200 added their messages).
- An invitation is mailed at most once per shop and invited account in 14
  days (an invitation's life): renewing it, or revoking and sending it again,
  emits the event each time but plans no second message, so a shop cannot use
  our sender to flood an account. The invitation still shows in the invited
  account's seller centre.
- `fees.offers_paused` is emitted once per shop for one fee change, however
  many fee tables it touches; the message lists and counts the shop's paused
  offers when it is written.
- A message whose variables cannot be worked out is set aside as a dead
  letter (`render_failed`, "no se pudo preparar el mensaje") instead of
  stopping the worker's whole batch.
- `product.staff_changed` (migration 083700) when catalogue staff correct a
  listing's category or brand, take it down (also from a content report) or
  put it back. One template says which, with the reason, and for a
  correction the old and new category and brand, the commission and IVA
  when they change, and whether the listing is on sale (`on_sale`; staff may
  correct one that is in review, rejected or taken down).
- The rest come from the care, catalogue and seller-verification screens.
- `invoice.requested` is for electronic invoicing and sends nothing here.

The texts are in `packages/notifications/src/templates/catalog.ts` (Spanish,
_usted_). Rules every message follows, enforced by tests:

- **Never** the delivery code, an address, an identification number or
  payment details. A message points to the order page instead. (This is
  stricter than the research note, which proposed SINPE instructions in the
  order e-mail.)
- Nothing promotional in a transactional message.
- Every e-mail names the sender: legal name, legal id, postal address and a
  reply address that is read (Decreto 35205 art. 32).
- WhatsApp, SMS and push wait between 21:00 and 07:00 Costa Rica time, except
  "va en camino" and "no pudimos entregar". "Va en camino" expires after four
  hours and "fecha de entrega" after a day: a stale message is dropped, not
  sent late.
- Messages of one order go out in event order per channel ("va en camino"
  never overtakes "pedido recibido"); different channels do not wait for
  each other.

Account e-mails (confirm the address, reset the password, change of e-mail,
security notices) are not in the queue, and there are two ways they go out:

- **Until the provider is set up**, Supabase Auth sends them itself, with the
  templates in `supabase/templates` (applied by
  `supabase/scripts/auth-config.sh`) and Auth's own mailer or the custom SMTP
  configured there.
- **Once Bird is set up and the Send Email Hook is switched on** (step 6
  below), Auth calls the `auth-email` function instead, which renders them
  with the same layout as every other e-mail and sends them through Bird at
  once (research note 3.3). Auth's templates are then not used; the SMTP
  settings stay as the standby.

Both say the same thing: the words live in
`packages/notifications/src/templates/account-texts.ts`, and a test
(`account-texts.test.ts`) checks every template in `supabase/templates`
against them, sentence by sentence. Both link to the app's `/auth/confirm`
with `token_hash` and `type`, and carry the same 6-digit code. Change a text
in both places together, or the test fails.

## How it works

1. A business function writes an event (`private.outbox_events`) in the same
   transaction as the change. A trigger adds a job for each consumer that
   registered the topic (`private.outbox_routes`; this one is `notify`).
2. The worker (`notify-worker`, an Edge Function) is woken every 30 seconds by
   `pg_cron` and right after new events by `pg_net`. Each run:
   - plans: turns each pending job into one row per recipient and channel in
     `private.notification_deliveries`, and marks the job done, in one
     transaction. A second run, or two at once, plans nothing twice;
   - claims up to 20 due messages with a two-minute lease, reads the
     address and the facts the template needs, and skips (with a reason)
     anything the person switched off or that is suppressed;
   - freezes the exact request, sends it with the idempotency key
     `yt/<env>/<message id>/<generation>`, and records the outcome;
   - checks Expo receipts for push sent more than 15 minutes ago.
3. Bird reports delivery to `bird-webhook` (signature checked on the raw
   body; each webhook applied once; out-of-order reports never move a message
   backwards). Hard bounces, complaints, unsubscribes and WhatsApp opt-outs
   go to the suppression list and, for unsubscribes, withdraw the commercial
   consent. Every request carries its generation in `metadata`; a report
   about an earlier generation (a request that staff or the worker have since
   replaced) is ignored.

Only the worker can call the `worker_*` functions: they are granted to the
`service_role` alone and each checks the caller again. The worker calls them
over the Data API with a secret key.

## When a message does not go out

| What happened                                                                                                   | What the worker does                                                                                                                                     | What staff see                                                 |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| No answer, a timeout, a 5xx, a 429, "request in progress"                                                       | Retries with the **same key and bytes**: 15 s, 30 s, 1, 2, 4 … 60 min (±20 %), ten tries in about two hours, inside Bird's three-hour idempotency window | Nothing until it gives up                                      |
| Bird refuses the request (400, 404, 422: bad recipient, unknown template, closed WhatsApp window)               | Dead letter at once                                                                                                                                      | **Detenido** · el proveedor rechazó el mensaje                 |
| Bad key, wrong region, unverified account (401, 403, 412, 421)                                                  | Dead letter, and the channel pauses 15 minutes                                                                                                           | **Detenido** and a "canal en pausa" notice                     |
| Wallet empty or quota reached (402)                                                                             | Holds 15 minutes without spending a try, then sends as a **new request** (Bird keeps a refused answer per key for three hours)                           | Nothing; after a day of holds, a dead letter                   |
| Person switched the channel off, address suppressed, no address, no device                                      | Skipped, with the reason                                                                                                                                 | **No se envió** and why                                        |
| Ten tries failed                                                                                                | Dead letter                                                                                                                                              | **Detenido** · el proveedor no respondió a tiempo              |
| Accepted, then reported as a temporary failure (e-mail soft bounce; WhatsApp or SMS `undelivered` or `expired`) | Back to the ordinary retries, as a **new request** (Bird kept the first one); a dead letter when no tries are left or the news is stale                  | Nothing until it gives up                                      |
| Accepted, then reported as a permanent failure (hard bounce, `rejected`, WhatsApp or SMS `failed`)              | **No entregado**: final; a hard bounce also suppresses the address                                                                                       | **No entregado** and why, on the same page as the dead letters |

**What staff do** (console, **Mensajes**, care and admin roles):

The **Mensajes** page lists both kinds of message that reached nobody: the
dead letters (**Detenido**, the worker gave up) and the ones the provider
accepted and later reported undelivered (**No entregado**). Both can be sent
again from there.

1. Read the reason on the stuck message. A rejection usually means a wrong
   address or a template Meta has not approved; a configuration problem
   means a key or the sending domain (tell whoever administers Bird).
2. Fix the cause, then press **Reenviar**. It sends the message again as a
   new request, under a new key. If the first one did arrive after all, the
   person gets it twice; the button says so.
3. Each order's page lists its messages and their status (who, channel,
   template; never the content or the address).

A message that keeps failing for one person while others go out is almost
always their address: ask them to correct it in their account.

## Preferences and consent

- **Shoppers** (`/cuenta/notificaciones`): e-mail, WhatsApp, SMS and app
  notifications, and the mobile number for WhatsApp and SMS. E-mail cannot be
  switched off while an order is in progress, and order messages always go by
  e-mail. Switching WhatsApp on records the time: that is the opt-in Meta
  requires. Channels and the commercial consent are saved together in one
  call (`set_my_notification_settings`), all or nothing; the page sends back
  the `version` it was loaded with, and a save from a tab that is out of date
  is refused with a request to reload instead of silently undoing a change
  made elsewhere.
- **Shops** (`vende…/cuenta/notificaciones`): the shop's contact address
  (e-mail, always on), WhatsApp to a mobile number, and the seller app. Shops
  have no SMS channel, so the page does not offer it. Only owners and admins
  can change it.
- **Commercial messages**: a separate box that starts unticked, is never
  required for anything, and can be withdrawn at any time, effective at once.
  When and how it was given (screen and wording version) is kept, append-only,
  in `private.commercial_consent_log`, and mirrored in `public.consents`
  (purpose `marketing`) and `profiles.marketing_opt_in`. The profile form no
  longer changes it. This workstream sends **no** commercial message; the
  consent check exists in the planner, again at claim time, and in the worker,
  and `templates/commercial.ts` is the only way to build one (it adds
  "Publicidad" at the start of subject and body, the free opt-out link and the
  sender's identification).
- **Suppression** (`private.notification_suppressions`): hard bounces and
  manual blocks stop everything to that address; complaints and unsubscribes
  stop commercial mail only; a WhatsApp or SMS opt-out stops that channel for
  that number. Typing a number into a settings page proves nothing about who
  holds the phone, so an opted-out number cannot be switched on there (the
  page says to send `START` from that phone). Only the phone itself lifts it:
  Bird's `preference.granted` webhook (after `START`) becomes `opted_in` and
  lifts the suppression; the person then switches the channel on again.
- **Push tokens**: `register_push_token` moves a token to another account
  only when it was signed out (unregistered, or reported dead by Expo) or the
  call names the same `device_id`; knowing someone's token is not enough.
- **Account e-mails** (the Auth hook): every link goes to `/auth/confirm` on
  the origin of `redirect_to` (or the site URL), with `token_hash` and `type`.
  That is the route the account-security work adds to every app, and the
  redirect target its `confirmUrl()` gives Auth; the token never goes to any
  other page.

## Team mailboxes

Staff messages go to `private.notify_mailboxes`. It is empty until set; until
then those messages are skipped ("sin dirección"). With SQL, as the owner:

```sql
insert into private.notify_mailboxes (team, email) values
  ('finance', '<FINANCE_MAILBOX>'), ('ops', '<OPS_MAILBOX>'),
  ('support', '<SUPPORT_MAILBOX>'), ('trust', '<TRUST_MAILBOX>');
```

## Before anything is sent for real

Nothing below has been done. Values in angle brackets are placeholders.

### Bird

1. Check the organisation's region (key prefix `bk_us1_` or `bk_eu1_`); it
   fixes the API host (`BIRD_API_URL`), the SMTP host and the DNS targets.
2. Finish any pending check in **Identity Center** (some calls answer `412`
   until it is done).
3. Move the e-mail plan off Free (50 e-mails a day, no overage) to Startup
   (US$15 monthly deposit, also spendable on WhatsApp and SMS) before real
   orders; add funds and a low-balance alert.
4. **Sending domain**: add `<SENDING_DOMAIN>` (a subdomain such as
   `mail.<ROOT_DOMAIN>`) under **Email > Domains** and publish the records
   below; wait until sending shows as verified.
5. **API keys** (**Platform tools > API keys**), one set per environment:
   the worker key (`emails:write`, `whatsapp:write`, `sms:write`) and an Auth
   SMTP key (`emails:write` only, set under **Email > SMTP** to transactional
   with tracking off). Keys go into the secret stores below, never into chat
   or git.
6. **Webhook** (**Platform tools > Webhooks**) to
   `https://<PROJECT_REF>.supabase.co/functions/v1/bird-webhook`, with these
   events: `email.delivered`, `email.bounced`, `email.out_of_band_bounce`,
   `email.rejected`, `email.complained`, `email.unsubscribed`,
   `email.list_unsubscribed`, `email_suppression.created`,
   `preference.revoked`, `preference.granted`, `preference.deleted`,
   `whatsapp.sent`, `whatsapp.delivered`, `whatsapp.read`, `whatsapp.failed`,
   `whatsapp.rejected`, `sms.delivered`, `sms.undelivered`, `sms.failed`,
   `sms.rejected`, `sms.expired`. Copy the `whsec_…` secret when it is shown
   (only once).
7. **WhatsApp**: connect the number (see Meta), fill the business profile,
   create and submit the four Spanish utility templates in
   `packages/notifications/whatsapp/` (none is submitted), and add Spanish
   opt-out keywords (`BAJA`, `ALTO`, `NO MAS`) as a keyword rule with
   `country: "CR"`; the templates' footers tell people to reply `BAJA`.
   Keep Bird's `START` opt-in keyword: the settings page tells a person whose
   number opted out to send it, and its `preference.granted` webhook is what
   lifts the opt-out.
8. **SMS**, only if the fallback is wanted: enable Costa Rica under
   **SMS > Destinations** with a daily spend limit. Carriers overwrite the
   `Yuntera` sender.
9. Leave e-mail content storage off unless there is a reason to keep bodies.

### DNS (placeholders; copy the exact values from Bird's domain page)

| Type  | Host                                          | Value                                                  | Why                                      |
| ----- | --------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| TXT   | `<DKIM_SELECTOR>._domainkey.<SENDING_DOMAIN>` | `v=DKIM1; k=rsa; p=<DKIM_PUBLIC_KEY>`                  | DKIM (required)                          |
| CNAME | `send.<SENDING_DOMAIN>`                       | `<BIRD_REGION>.bounce.bird.com`                        | return path and SPF alignment (required) |
| TXT   | `_dmarc.<SENDING_DOMAIN>`                     | `v=DMARC1; p=none; rua=mailto:<DMARC_REPORTS_MAILBOX>` | DMARC (required; tighten later)          |
| CNAME | `links.<SENDING_DOMAIN>`                      | `<BIRD_REGION>.links.bird.com`                         | only if tracking is ever turned on       |

No SPF record at the apex is needed for Bird, and no MX for the sending
domain. Domains that send no mail (`.com`, `.app` if not primary): `TXT
v=spf1 -all`, `_dmarc TXT v=DMARC1; p=reject;`, `MX 0 .` (standard practice,
not re-verified). `ayuda@<ROOT_DOMAIN>` must be a real, read mailbox: it is
the reply address every message gives.

### Meta (WhatsApp)

1. A business portfolio in the company's legal name, with two-factor sign-in
   for its admins.
2. A number for notifications that can receive an SMS or call and is not on
   WhatsApp (or the support number through coexistence). Whether Bird sells
   +506 numbers is unconfirmed; the owner's own number from a local operator
   works.
3. Display name "Yuntera" and the business profile.
4. Business verification, started early (up to 14 business days): without it,
   250 recipients a day and two numbers.
5. Approve Bird's access in the Embedded Signup window; a live website with
   the privacy policy and terms.

### Expo (push)

1. One Expo project per app; turn on **enhanced push security** and create
   an access token for the worker (`EXPO_ACCESS_TOKEN`).
2. Apple push key and Firebase (FCM v1) credentials uploaded to EAS.
3. The native apps call `register_push_token` after sign-in and
   `unregister_push_token` at sign-out (not built yet: no native app exists).

### Supabase

1. Extensions `pg_cron` and `pg_net` (the migration schedules the sweep when
   they exist).
2. Vault secrets `project_url` (`https://<PROJECT_REF>.supabase.co`) and
   `notify_worker_token` (32+ random bytes):

   ```sql
   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
   select vault.create_secret('<RANDOM_TOKEN>', 'notify_worker_token');
   ```

3. A **secret key** for the worker only (Settings > API Keys), so it can be
   revoked on its own.
4. Edge Function **secrets** (Settings > Edge Functions > Secrets, or
   `supabase secrets set`), never in the repository:

   | Secret                    | Value                                                          |
   | ------------------------- | -------------------------------------------------------------- |
   | `NOTIFY_SECRET_KEY`       | the worker's Supabase secret key                               |
   | `NOTIFY_WORKER_TOKEN`     | the same token as the Vault secret                             |
   | `BIRD_API_KEY`            | the Bird worker key                                            |
   | `BIRD_WEBHOOK_SECRETS`    | the webhook's `whsec_…` (two, space-separated, while rotating) |
   | `SEND_EMAIL_HOOK_SECRETS` | the Auth hook's `v1,whsec_…`                                   |
   | `EXPO_ACCESS_TOKEN`       | the Expo access token                                          |

5. Non-secret settings, set by `supabase/scripts/deploy-notifications.sh`:
   `NOTIFY_ENV`, `NOTIFY_API_URL`, `NOTIFY_SHOP_URL`, `NOTIFY_SELLER_URL`,
   `NOTIFY_OPS_URL`, `NOTIFY_FIELD_URL`, `NOTIFY_SENDING_DOMAIN`,
   `NOTIFY_REPLY_TO`, `NOTIFY_LEGAL_NAME`, `NOTIFY_LEGAL_ID`,
   `NOTIFY_POSTAL_ADDRESS`, `BIRD_API_URL`, `BIRD_WHATSAPP_FROM`,
   `BIRD_WHATSAPP_LANGUAGE`, `BIRD_SMS_FROM`, `EXPO_PUSH_URL`. The legal name,
   legal id and postal address appear in every e-mail: set the real ones
   before the first send.
6. **Auth**: custom SMTP with the Bird SMTP key (`us1.smtp.bird.com`, port
   587, user `bird`) as the standby, then the **Send Email Hook** pointing at
   `https://<PROJECT_REF>.supabase.co/functions/v1/auth-email` with its
   secret. Raise the hourly e-mail limit on the Rate Limits page (it applies
   with the hook too).
7. Deploy the three functions with `verify_jwt = false` (their tokens and
   signatures are the authentication):

   ```bash
   SUPABASE_ACCESS_TOKEN=… supabase/scripts/deploy-notifications.sh deploy <PROJECT_REF>
   ```

   The script uses the Management API, like `remote-db.sh`. It has **not**
   been run.

## Running it locally

`tools/dev/stack.sh up <lane>` starts, besides the apps, the worker (the same
handlers, served from Node) and a fake of Bird and Expo
(`tools/dev-notify`). The fake keeps what it accepted at
`<fake>/_fake/messages`, shows an e-mail at `<fake>/_fake/messages/<id>/html`,
and can be told to reject, fail, time out, rate-limit or run out of wallet
(`POST /_fake/behaviour`). Quiet hours are off locally. The seed's
`@yuntera.example` addresses are accepted by the fake; real Bird refuses them
(`422`), so never point a worker with seed data at Bird.

Tests: `supabase/tests/100_notifications.sql` (the queue, as each role and
from two sessions at once), `packages/notifications` unit tests (every
template with realistic and hostile data, each adapter against the recorded
request and response shapes, webhook signatures, the worker loop with a fake
clock), `packages/db/src/contract.notifications.test.ts`, and the
`notifications` browser journey.

## Not verified, not built

- Nothing has run against real Bird, Meta, Expo or Supabase. In particular:
  that a Supabase secret key makes `auth.jwt() ->> 'role'` read
  `service_role` inside the functions (the worker check relies on it;
  Supabase's documentation shows secret keys carrying a JWT template with
  `role: service_role`, but it was not tried); the Management API upload in
  `deploy-notifications.sh` (several `file` parts with repository paths); the
  `preference.revoked` and `preference.granted` webhooks' field names; that
  Bird echoes `metadata.generation` on every event (without it, a late report
  is still matched only to a request not yet recorded, never to a newer one);
  that Bird sends a final soft bounce as `email.bounced` with
  `bounce_type: "soft"` rather than retrying silently; Bird's Spanish
  language code for WhatsApp; SMS delivery in Costa Rica.
- Phone numbers are not verified (no one-time code: it would need a real
  send). A person can enter a number that is not theirs; the opt-out rule
  above stops this from overriding the holder's `STOP`, but a number that
  never opted out can still be entered by someone else.
- No commercial message can be sent: the worker refuses any `marketing`
  delivery (`commercial_frame_required`) until a commercial template is built
  through `templates/commercial.ts` and the one-step unsubscribe page it
  links to (for example `/baja`) exists in the shop; neither exists yet.
- No daily e-mail digest of dead letters to staff (section 8's
  `staff_notification_failures`); staff see them in the console.
- No automatic clean-up of old delivery rows yet; the request body is cleared
  as soon as a message reaches a final state, so old rows hold ids and status
  only. A retention period belongs in the privacy document.
- In live payments mode nothing calls `private.confirm_refund` yet: until the
  gateway integration does, a live refund is announced as started and never
  as completed.
- No checkout wording about which channels will be used; the settings page
  explains it.
- The native apps that would register push tokens do not exist yet.
