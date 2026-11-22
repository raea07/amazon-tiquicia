# Payments

How shoppers pay, how a payment becomes "paid", what finance does about money
that did not match and refunds that failed, and exactly what the owner must
set up with the payment gateway before a real colón is charged.

Sources: `supabase/migrations/20261121083400_payments.sql` (attempts, events,
the review list, gateway refunds, fees, the mode), `packages/payments` (the
provider-neutral interface, the ONVO adapter, the signature check, the worker
and the webhook), `supabase/functions/payments-*` (the two Edge Functions),
and the research note
[`docs/research/payments-gateways-costa-rica.md`](../research/payments-gateways-costa-rica.md)
with its fact-check, which chose **ONVO Pay** and documents its wire contract.

**State on 21 November 2026.** Built and tested end to end on a development
machine against a local fake of ONVO (`tools/dev-notify/src/fake-onvo.ts`).
**Never run against ONVO itself, in test or live**; nothing has been deployed,
no key exists, no money has moved. The fake follows the note; where the note
marks something UNVERIFIED, so does this document.

## The three modes

| Mode      | What it means                                                                                    | Who uses it                     |
| --------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| `sandbox` | No gateway. A button on the order page simulates the payment; refunds complete at once           | Development, the hosted preview |
| `test`    | Everything goes through ONVO's test environment (its test keys, test cards, test SINPE numbers)  | Rehearsal before launch         |
| `live`    | Everything goes through ONVO with real money. The simulation refuses to run (`sandbox_disabled`) | Production                      |

The mode is the setting `payments_mode`. Only an administrator changes it, in
the console (**Cobros → Modo y comisiones**), with a written reason; the
change and the reason are in the audit trail. The database refuses:

- `test` or `live` unless the payments worker reported, in the last 15
  minutes, that it holds a key for that environment (`onvo_test_secret_key_…`
  or `onvo_live_secret_key_…`) and a webhook secret (`whsec_…`)
  (`payments_provider_not_ready`). The worker reports itself every time it
  runs (every minute on Supabase);
- any change while the environment being left still has work at the gateway:
  an attempt being created, open, waiting, **declined** (ONVO's page can still
  be paid after a decline until the worker stops it) or being stopped, or a
  gateway refund not yet confirmed (`payments_work_open`): it would be
  stranded, since the worker serves the current mode only.

What happens across a change:

- **An order placed in another mode and not paid yet** (in sandbox, or in the
  other ONVO environment) is paid through the gateway of the current mode: the
  shopper's **Pagar** moves its payment there. In sandbox, any unpaid order
  shows the simulation. The simulation is shown only while the mode is
  `sandbox`, whatever mode the order was placed in.
- **Money paid in the environment the mode has left** (a page left open, an
  event that comes late) is never applied by itself and never dropped: it is
  kept for finance as **De otro entorno**, and the shopper's page says their
  money arrived and is being reviewed.
- **A refund of a payment taken in another environment** cannot go through
  the worker. Test money (ONVO's test environment, or sandbox) is not real:
  its refund completes at once as a simulation, with a note. Real money taken
  in `live` and refunded after the mode left `live` is paid by finance by
  bank transfer. A gateway refund left waiting for an environment the mode
  has left can also be paid by transfer (**Ya lo transferí**).

The seed refuses anything but `sandbox`, so a fresh database always starts
there.

## What happens for each method

### Card

1. The shopper places the order (card chosen; nothing pre-selected).
2. On the order page: **Pagar ₡… con tarjeta**. The shop asks the database to
   start an attempt; the amount and currency are the order's, never the
   browser's. The payments worker (woken at once by `pg_net`) creates an ONVO
   hosted **Checkout Session** with one line for the order total, our ids as
   metadata, and the return address `…/pedidos/<order>/pago/retorno`.
3. The shopper is sent to ONVO's own page and types the card there. Their bank
   may ask for the extra step (3-D Secure), which ONVO runs. **No card data
   ever reaches Yuntera** (SAQ A, note §5.1).
4. Back on the shop the page says **Estamos confirmando su pago … No vuelva a
   pagar** and refreshes itself. Coming back is only a hint: it asks the
   worker to check with ONVO now.
5. The order is paid when ONVO's signed notification (`checkout_session.succeeded`
   or `payment_intent.succeeded`) arrives, or when the worker's check finds the
   payment succeeded. Then the order is confirmed and released to the
   warehouse, exactly as before.
6. A decline (`payment_intent.failed`) shows **El pago no se completó … No se le
   cobró nada** with **Intentar de nuevo**, which starts a new attempt and
   stops the declined one at ONVO (a declined Checkout could otherwise still
   be paid). Five attempts per order (`max_payment_attempts_per_order`).

### SINPE Móvil

ONVO matches a transfer to an order by **the payer's identification and the
exact amount** (note §6.4), not by a code in the description.

1. On the order page the shopper gives the identification type and number and
   the mobile number of the account that will pay (a relative's or a
   company's, if so). Nothing is chosen for them.
2. The worker creates the ONVO payment intent, the payer's payment method and
   confirms it, **before** the shopper sees the instructions: ONVO refuses a
   transfer for which no intent is waiting. The payer's identification and
   phone are erased from our database as soon as ONVO has them.
3. The page shows the number (**7019-6686**, ONVO's, unless ONVO assigns us
   one), the exact amount, and that **the bank will show ONVO as the
   recipient, not Yuntera**. It refreshes itself.
4. `payment_intent.succeeded` confirms the order. **Nobody at Yuntera
   confirms it by hand**: in `test` and `live` the console's manual
   confirmation is refused for these payments (`confirmed_by_gateway`). It
   stays for bank transfers (whose payment is not the gateway's: provider
   `manual` in `test` and `live`) and, in sandbox, for SINPE Móvil.
5. Above ₡100 000 the checkout warns that many banks limit SINPE Móvil to that
   amount a day (a constant in the checkout form, not a setting).

### Cash on delivery

Unchanged: the driver collects at the first parcel handed over. Its refunds
are paid by finance by bank transfer (below).

### When orders expire

An unpaid order is cancelled after 30 minutes (`reservation_minutes`, by
`expire_unpaid_orders` every 5 minutes). Its attempts are stopped at ONVO
(the session expired, the intent cancelled), so that a late transfer is
refused by ONVO rather than arriving for a dead order. If money arrives anyway
it goes to the review list as **Llegó tarde**.

## How a notification is applied

- The signature is checked on the raw body exactly as the note says (§6.6):
  `X-Onvo-Signature: t=…,v1=…`, HMAC-SHA256 of `t + "." + body` with the whole
  `whsec_…` secret, within 300 seconds, any of two `v1` values during a
  rotation, any of two secrets on our side. A bad signature is answered 400
  and nothing is read.
- The event's id is recorded first, in the same transaction as its effect
  (`private.payment_events`, unique per gateway and id). A second delivery,
  even in parallel, waits on that row and then changes nothing.
- The order's row lock is taken before anything about its money changes, as
  every money function does. A confirmation racing a cancellation or an
  expiry waits for it and then sees it.
- Events come in any order. A success is never undone by an older failure; a
  `processing` after a success is stale, and so is one older than the decline
  already applied.
- A card's `payment_intent.succeeded` can come before the
  `checkout_session.succeeded` that tells us the intent's id. If it carries
  our attempt id in its metadata (the intent is signed, and only our key
  creates objects), it is applied to that attempt, which learns the intent's
  id; the session event is then a duplicate. If the same money was meanwhile
  kept as **Pago sin intento conocido**, that item closes itself when the
  payment is applied, and money that is already an order's payment can never
  be applied or refunded again from the review list
  (`payment_review_applied`).
- A success is applied only if its amount and currency are exactly the
  attempt's, the order still waits for its money, and it was not paid
  already. Anything else is kept for finance and changes nothing.
- The answer is 2xx once recorded, whatever it meant; 500 if the database
  could not record it, so that ONVO delivers it again (it retries for 72
  hours live, three times in test).

**Reconciliation.** An attempt that no notification has settled is asked about
by the worker (`GET` the session or intent): two minutes after it was created,
then at growing intervals up to 30 minutes, until a day after it expired, and
at once when the shopper comes back from ONVO's page. The answer is applied
like a notification. The daily page shows how many attempts were settled this
way.

## What finance does

Everything is in the console under **Cobros** (finance and administrators).

### Día y pagos (the daily reconciliation)

Per day: what was taken by method, ONVO's fee as reported against the fee we
expected, refunds completed and open, items waiting for a decision, attempts
(paid, declined, stopped, waiting, checked by the worker), notifications
received by outcome, and the ledger's balances of the gateway account and of
refunds owed to shoppers. Below, every payment with its ONVO references
(intent and session), its fee and the difference.

**Fees.** The fee ONVO reports is recorded with the payment and booked as an
expense (`gateway_fee_expense` against `gateway_clearing`). **UNVERIFIED:**
ONVO documents no fee field on intents or charges; the adapter reads
`latestCharge.fee` if ONVO sends it. Until it is known that ONVO does, finance
records each payment's fee from ONVO's statement (**Registrar** on the row),
once.

The **expected** fee is a setting, `gateway_expected_fees` (card 3.9% +
₡180, SINPE Móvil 1.5%), which an administrator changes in **Modo y
comisiones** with a reason. It is only the comparison: what sellers are
charged is the fee schedule (`fee_payment_methods`, mirrored in
`packages/core/src/fees.ts` with its parity test), unchanged.

### Por revisar (money that did not match)

| What                      | Means                                                                       | Usual resolution                                                                        |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Monto distinto / moneda   | ONVO took another amount or currency than the attempt's                     | Refund; never applied as is                                                             |
| Llegó tarde               | Paid after the order was cancelled or expired                               | Refund (or ask the shopper to order again, then refund)                                 |
| Pagado dos veces          | A second success for an order already paid                                  | Refund the second                                                                       |
| Transferencia sin pedido  | A SINPE Móvil transfer ONVO could not tie to a payment (custom number only) | Attach to its order if the amount is exact, or refund by transfer                       |
| Pago sin intento conocido | A success naming nothing of ours (e.g. a lost creation answer)              | Accept for its order if it names one and the amount is exact                            |
| De otro entorno           | Paid in the ONVO environment the mode had left (a page left open)           | Live money: refund (by transfer) or attach; test money: refund (nothing moves) or close |
| Reembolso no solicitado   | ONVO reports a refund we never asked for (made in its dashboard)            | Close with a note after checking                                                        |
| Contracargo               | A dispute. Answer in ONVO's dashboard before the deadline                   | Close with a note when settled                                                          |

Each item has the same four choices: **Aplicar al pedido** (its own order,
still waiting, same amount in colones), **Aplicar a otro pedido** (the order
number; same rule), **Devolver** (through ONVO when there is a payment to
refund against in the environment the worker serves; test money is refunded
as a simulation; otherwise by transfer), **Cerrar con nota**. A note is always
required. Money in this list is not in the ledger until it is applied to an
order. Test money only pays an order taken in test, and real money never one.
Refunding or closing an item finishes the attempt that brought the money, so
the shopper can pay the order again while it waits. The shopper's order page
says that money arrived and is being reviewed, being refunded or was refunded,
whatever the order's own status (also for a cancelled order and for an order
paid twice).

### Reembolsos

Every refund the register books (decision 26) appears here until the money has
reached the shopper:

| State                          | Means                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Solicitado                     | Booked; the worker sends it to ONVO within seconds (or finance pays it, if by transfer)                                                                                                                                                                                                                                                                                                                                                    |
| Enviado, sin confirmar         | ONVO accepted it; waiting for `refund.succeeded`                                                                                                                                                                                                                                                                                                                                                                                           |
| Respuesta perdida: se verifica | The send timed out. ONVO has no idempotency key, so it is **never sent again by itself**: for an hour (`gateway_refund_unknown_hold_minutes`) the worker reads the intent's refunded total and watches for ONVO's `refund.created`; it counts as sent only when the total covers it and every other refund of that payment whose answer was lost. After the hour it shows as **Falló** with the reason "no se supo si llegó al procesador" |
| Completado                     | ONVO confirmed it, or finance recorded the transfer                                                                                                                                                                                                                                                                                                                                                                                        |
| Falló                          | ONVO refused it (`refund.failed`, or a 4xx). Nothing reached the shopper                                                                                                                                                                                                                                                                                                                                                                   |

The shopper's order page says **En camino** until **Completado**; the "refund
completed" message, the payment's status (refunded or partly refunded), the
order's (a cancelled order becomes refunded) and the ledger entry that moves
the money out (`refund_paid`: `refunds_payable` to `gateway_clearing`, or to
`bank_operating` for a transfer) all follow the confirmation, never the
request.

**A refund that failed:** check the reason in ONVO's dashboard. Then either
**Enviar otra vez al procesador**, or pay it by bank transfer and **Ya lo
transferí** with the bank's reference. For one whose answer was lost, first
look in ONVO's dashboard whether the refund exists: if it does, do not send it
again (its `refund.succeeded` will complete it, or close it by transfer
reference); if it does not, send it again.

This departs from the note (§6.7), which allows a resend once the intent shows
nothing refunded: the note does not say that a refund still `pending` at ONVO
already shows in the intent's total, so "nothing refunded" does not prove the
first send created nothing, and a second send could pay the shopper twice.

**Cash on delivery, and transfers confirmed by hand,** are always refunded by
transfer: contact the shopper for their account (nothing collects it yet),
transfer, and record the reference. The law asks for the refund by the same
method within 8 calendar days.

**SINPE Móvil refunds through ONVO** are sent like card refunds. **UNVERIFIED:**
the note could not confirm that ONVO's refunds endpoint accepts SINPE Móvil
payments. If ONVO refuses them, they show as **Falló** and finance refunds by
transfer.

## Before anything is charged for real (the owner)

None of this has been done. Keys are never pasted into chat, e-mail or the
repository.

### ONVO

1. Create the ONVO account with a company e-mail that outlives any one person
   (onvopay.com, self-service). Test keys exist from the start.
2. Complete ONVO's onboarding (identity, facial check, the company's
   documents) and add the colón bank account for payouts; choose weekly
   payouts to begin with.
3. Ask ONVO, in writing, the questions in section 9 of the research note, in
   particular: the contracted card and SINPE Móvil rates and IVA; raising the
   US$2,000 monthly limit; whether SINPE Móvil payments can be refunded through
   the refunds API; whether intents and charges report the fee; whether an
   idempotency mechanism exists; how long a SINPE Móvil intent stays open.
4. **Test environment first.** In ONVO's Dashboard, **Developers > Webhooks**,
   create the endpoint for test mode:
   `https://<PROJECT_REF>.supabase.co/functions/v1/payments-webhook`
   (HTTPS, port 443, no redirect in front). Subscribe to:
   `checkout_session.succeeded`, `payment_intent.succeeded`,
   `payment_intent.processing`, `payment_intent.failed`,
   `payment_intent.canceled`, `refund.created`, `refund.succeeded`,
   `refund.failed`, `dispute.created`, `dispute.updated`, `dispute.closed`, and
   `mobile_transfer.received` if ONVO gives us a custom number. "Select all"
   does not include event types ONVO adds later. Copy the `whsec_…` secret
   straight into the Supabase secrets below, then press **Test connection**.
5. When test mode has passed the rehearsal (below), create the **live**
   endpoint the same way: a separate `whsec_…` secret and live keys.

### Supabase

1. Extensions `pg_cron` and `pg_net` (the migration schedules
   `payments-sweep` every minute when they exist).
2. Vault secret `payments_worker_token` (32+ random bytes; `project_url` is
   already there for notifications):

   ```sql
   select vault.create_secret('<RANDOM_TOKEN>', 'payments_worker_token');
   ```

3. A **secret key** for the payments worker only (Settings > API Keys), so it
   can be revoked on its own.
4. Edge Function **secrets** (Settings > Edge Functions > Secrets), never in
   the repository:

   | Secret                  | Value                                                                        |
   | ----------------------- | ---------------------------------------------------------------------------- |
   | `PAYMENTS_SECRET_KEY`   | the payments worker's Supabase secret key                                    |
   | `PAYMENTS_WORKER_TOKEN` | the same token as the Vault secret                                           |
   | `ONVO_SECRET_KEY`       | `onvo_test_secret_key_…` for test; `onvo_live_secret_key_…` for live         |
   | `ONVO_WEBHOOK_SECRETS`  | the endpoint's `whsec_…` (two, space-separated, for 24 hours while rotating) |

   One project talks to one ONVO environment at a time: `PAYMENTS_ENV` and the
   key's prefix must agree, or the worker reports itself not ready and the
   mode cannot be switched.
5. Non-secret settings, set by `supabase/scripts/deploy-payments.sh config`:
   `PAYMENTS_ENV` (`test` or `live`), `PAYMENTS_API_URL`
   (`https://<PROJECT_REF>.supabase.co`), `PAYMENTS_SHOP_URL`,
   `PAYMENTS_APP_SCHEME` (`yuntera`), `ONVO_API_URL`
   (`https://api.onvopay.com`), `ONVO_ACCOUNT_ID`, `ONVO_SINPE_NUMBER`
   (only if ONVO assigns us one), `PAYMENTS_PROVIDER_TIMEOUT_MS`.
6. Deploy the two functions with `verify_jwt = false` (the signature and the
   worker token are their authentication):

   ```bash
   SUPABASE_ACCESS_TOKEN=… supabase/scripts/deploy-payments.sh check  <PROJECT_REF>
   SUPABASE_ACCESS_TOKEN=… supabase/scripts/deploy-payments.sh config <PROJECT_REF>
   SUPABASE_ACCESS_TOKEN=… supabase/scripts/deploy-payments.sh deploy <PROJECT_REF>
   ```

   The script uses the Management API, like `deploy-notifications.sh`. It has
   **not** been run.
7. In the console, as an administrator: **Cobros → Modo y comisiones**, switch
   to **Pruebas del procesador** with a reason.

### The rehearsal in test mode (ONVO's own checklist, note §6.8)

With test keys: a card approved (`4242 4242 4242 4242`), one with the 3-D
Secure challenge (`4000 0000 0000 3220`), one declined (`4000 0000 0000
0002`) followed by a successful retry; SINPE Móvil with `+506 8888-8888`
(pays after 15 seconds) and `+506 8888-9521` (never pays: let the order
expire); a cancellation refunded and confirmed; a partial refund of a return;
**Test connection** from the Dashboard; one delivery resent from the
Dashboard (it must say "duplicate"). Only then create the live endpoint, set
the live key and `PAYMENTS_ENV=live`, redeploy, and switch the mode to
**Real**.

## Questions for the owner's lawyer (not resolved here)

1. **The card fee cap.** The central bank's Reglamento del Sistema de Tarjetas
   de Pago (18 Dec 2025) caps the local acquiring commission at **1.95%**, all
   the acquirer's charges included, and lists ONVO (and Tilopay and dLocal)
   among the acquiring providers. ONVO's published card price is 3.9% +
   US$0.35. How that fits the cap is not public. The expected fee is therefore
   a setting, not a constant, and the 3.9% in the fee schedule passed to
   sellers is an assumption until this is answered.
2. **Collecting for sellers and paying them out.** Yuntera collects every
   payment as the single merchant and pays sellers itself. That may be one of
   the art. 15 Ley 7786 activities (administration of third-party resources,
   systematic transfers of funds) that require registration with SUGEF above
   a "substantial" volume (press: about US$400,000 in 12 months). The answer
   decides whether sellers keep being paid by Yuntera or by the gateway
   directly (ONVO's marketplace charges one seller per payment).
3. Also open, for the accountant: ONVO's 0.777% IVA withholding and whether
   income tax is withheld on card sales; IVA on ONVO's fee; whose SINPE Móvil
   number is registered with Hacienda under Decreto 45953-H.

## Running it locally

`tools/dev/stack.sh up <lane>` starts the fake gateway on the API port + 3
next to the other fakes, and the functions host serves `payments-webhook` and
`payments-worker` (waking the worker every second, as `pg_net` and `pg_cron`
do on Supabase). The stack starts in `sandbox`; to rehearse the gateway, switch
to **Pruebas del procesador** in the console as `central@yuntera.example`.

The fake's hosted page offers approve, decline, the bank's extra step (pass or
fail), abandon and "never finishes". Its SINPE Móvil test numbers behave as
ONVO's (`+50688888888` pays after 1.5 s here); any other number waits for
`POST /_fake/sinpe/transfer {identification, amount}`. `POST /_fake/behaviour`
makes it send every event twice, in reverse order, or not at all, makes
refunds fail, be refused, be held, or be created with the answer lost, and
makes its API slow (`{"api": "slow"}`, longer than the adapter's timeout) or
down (`{"api": "down"}`, 503 for every call); see the file's header. The journey `tools/e2e/journeys/payments.cjs` runs the chain.

## Not verified, not built

- **Nothing ran against ONVO.** Every request and response shape is the
  note's; field names ONVO does not document (the fee) are read only if
  present.
- The intent created by a Checkout Session inheriting its metadata, and the
  parameters ONVO adds to the return address, are UNVERIFIED (note §6.2):
  the order is resolved from the session and the path, never from them.
- Disputes are recorded for finance; there is no evidence submission and no
  hold on the seller's payout.
- Payouts from ONVO to our bank (`payout.*` events) are ignored; matching them
  to the bank statement is manual.
- A late payment for a cancelled order is refunded only once finance decides;
  the shopper's order page says the money arrived and is being reviewed, but
  no message is sent to them about it.
- Native app: card payments open ONVO's page in the phone's browser and come
  back by the app's link; only a return through ONVO's own link back
  (`?pago=retorno`) counts as a hint, while closing the browser says nothing
  was charged. This was checked in the web export and by unit tests only,
  never on a phone.
- No load test of the webhook; ONVO's 10-second answer window is assumed to
  hold (the receiver makes one database call).
