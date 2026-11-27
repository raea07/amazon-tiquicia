# Customer service

Service is where Yuntera's promise is either kept or exposed. This document
sets the channels and response targets, the mechanics of refunds and returns
aligned with the legal minimums, how disputes with sellers are settled, and the
complaint mechanism the law requires. The guiding rule: the shopper gets a
clear answer and their money first; who was at fault is settled afterwards and
out of their sight.

Legal references are in the
[fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection).
Targets and thresholds are **assumptions to validate** in the pilot.

## Channels

| Channel           | Role                                         | Notes                                                                                                                                                                            |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp Business | Primary                                      | One published number. The working assumption is that this is where Costa Rican shoppers expect to reach a business; the research could not source this, so the pilot confirms it |
| Order page        | Self-service                                 | Track, cancel before dispatch, request withdrawal, report a problem. Every request opened here carries the order with it                                                         |
| Email             | Formal and written record                    | _ayuda@yuntera.cr_; receipts, refund confirmations, complaint responses                                                                                                          |
| Phone             | Outbound, when writing is not working        | No inbound call centre in the pilot                                                                                                                                              |
| Seller support    | WhatsApp and email, separate number or label | Sellers and shoppers are not mixed in one queue                                                                                                                                  |

Hours in the pilot: Monday to Saturday, the same days deliveries run. The hours
are published; outside them an automatic reply says when a person will answer.

Every conversation is linked to an order or an account and summarised in a
note, so the next person does not ask the shopper to repeat themselves.

## Response targets

| Situation                                                   | First human response                             | Resolution                                                    |
| ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Order out for delivery today (where is it, change of plans) | 15 minutes during service hours                  | Same day                                                      |
| Delivery failed or late                                     | Yuntera contacts the shopper first, the same day | New date or refund agreed the same day                        |
| Wrong, damaged or missing item                              | 2 working hours                                  | Replacement dispatched or refund issued within 2 working days |
| Withdrawal or return request                                | 1 working day                                    | Refund within the legal 8 calendar days                       |
| Payment question                                            | 2 working hours                                  | 1 working day                                                 |
| Seller question                                             | 1 working day                                    | 3 working days                                                |
| Formal complaint                                            | Acknowledged in 1 working day                    | Written answer within 5 working days                          |
| Any other question                                          | 1 working day                                    | 5 working days                                                |

Being late against these targets is itself an exception: the case says
"Atrasado" in Casos, and Hoy and Salud del sistema count it.

These targets are the rows of `private.case_targets` in the database, which
computes every due date; the words shoppers read come from
`packages/core/src/service-times.ts`, and a test keeps this table, those rows
and those words equal. A return for a damaged, wrong or warranty item takes
the "Wrong, damaged or missing item" row; a report about a listing or review
takes the complaint's. **A working day** is Monday to Friday, without the
holidays under Operación → Feriados, ending at midnight Costa Rica time; a
**working hour** counts between 08:00 and 17:00 of a working day. Both are
assumptions until the service hours are published (owner question D56):
service runs Monday to Saturday, so a target counted this way may end a day
later than promised, never earlier.

## Tone

Costa Rican Spanish, _usted_, plain and warm. Say what happened, what Yuntera
will do, and by when. No scripts that avoid the word "perdón". Never ask the
shopper to contact the seller: Yuntera does that.

## Cancellations

| When                        | What the shopper can do                                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before payment is confirmed | Cancel from the order page; nothing is charged. If the payment does not arrive in time, the order is cancelled by itself and its page says "Cancelamos su pedido porque no recibimos el pago a tiempo", that nothing was charged and to order again; a transfer that arrived late is refunded              |
| Paid, not yet dispatched    | Cancel from the order page; full refund including shipping                                                                                                                                                                                                                                                 |
| Paid, already packed        | The shopper cannot cancel any more; support asks operations to stop the parcel (staff order page, "Detener el paquete"). The order reads "Se está cancelando"; once the warehouse checks the parcel in, the order is cancelled and everything paid comes back, shipping included (nobody went to the door) |
| Out for delivery            | Refuse at the door or contact support; full refund of the items; treated as a withdrawal                                                                                                                                                                                                                   |
| Delivered                   | Withdrawal or warranty, below                                                                                                                                                                                                                                                                              |

## Withdrawal (_derecho de retracto_)

- **Who and when.** Any shopper, without giving a reason, within **8 business
  days of delivery**. The law counts from the sale; Yuntera's policy counts
  from delivery, which is never less.
- **Exceptions**, stated on the product page before purchase: consumables and
  personal-care items once opened or used, perishables, made-to-measure goods,
  special orders.
- **How.** From the order page, or by message. Yuntera confirms in writing,
  arranges collection on a delivery route, and inspects the item on arrival.
- **Condition.** The item is returned complete. Trying a product is not using
  it up; the inspection looks for damage or evident use beyond that, and a
  dispute over condition is decided in the shopper's favour unless the
  evidence is clear.
- **Refund.** Within **8 calendar days**, by the **same payment method**. The
  clock runs from the request. For card payments the refund goes back to the
  card; for SINPE Móvil, back to the paying number.
- **Cash on delivery orders.** The default assumed is a refund by SINPE Móvil
  to the shopper's number with their written agreement; whether that satisfies
  "the same payment method" is a question for the lawyer
  ([open questions](../08-open-questions.md)). If the shopper insists on cash,
  it is delivered by a driver.
- **Shipping.** In the pilot the original shipping charge is refunded and the
  collection is free. Whether return shipping may be charged later is a lawyer
  question.

## Warranty

- The legal minimum is **30 business days from delivery**, and the burden of
  proof is on the merchant. A longer manufacturer or seller warranty, where
  there is one, is shown on the product page.
- The shopper reports the fault from the order page with a description and a
  photo or video.
- Remedies, at the shopper's choice where the law gives one: repair,
  replacement or refund. Yuntera collects the item at no charge.
- Yuntera gives the shopper the remedy without waiting for the seller to
  agree. The seller is then asked to make it good under the seller agreement.

## Late or failed delivery

- **Late against the promised date.** Yuntera tells the shopper before the date
  passes and offers a new date or cancellation with a full refund. By law the
  shopper is entitled to the refund.
- **Nobody home.** One free re-delivery on a day the shopper chooses.
- **Second failed attempt.** The order is cancelled. The items are refunded in
  full; the default assumed is that the shipping charge is not refunded when
  both failures were the shopper's, subject to the lawyer's confirmation.
- **The delivery fee when a parcel comes back** (the owner's decision of
  23 November 2026): refunded too when nobody went to the shopper's door
  (staff took the parcel off a route, or stopped it before it left);
  kept after a real attempt at the door or when another parcel was
  delivered. The shopper then gets two refund messages, one for the goods and
  one for the fee. When the fee is kept, the shopper's order page (web and
  app) says so: "El envío (₡1 500) no se devuelve porque fuimos a entregarlo
  a su dirección."
- **What the shopper reads meanwhile.** While every parcel left is coming
  back, the order says "Se está cancelando" with no date and no delivery
  code; while every parcel left waits in the warehouse to go out again, it
  says "Entrega reprogramada". Neither says "En camino". The shopper app
  build already in testing (`3f251c3`) still shows the old words.
- **A closed day that should not be.** A single closed day made before
  closure periods existed can be opened again under **Operación → Cierres**
  ("Abrir ese día"); the zone delivers that day again.

## Refund mechanics

| Paid with        | Refund goes to                              | Expected time to reach the shopper                                              |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| Card             | The same card, through the gateway          | Depends on the issuing bank; the shopper is told the date the refund was issued |
| SINPE Móvil      | The same number                             | Same day it is approved                                                         |
| Cash on delivery | SINPE Móvil with consent, or cash by driver | Within the 8 calendar days                                                      |

Rules:

- A refund is approved by a person and recorded with the reason. Above a
  threshold (proposal: ₡50,000) a second person approves once there is a
  second person.
- Partial refunds state exactly which items and amounts.
- A refund reverses the seller's commission for those items and produces a
  credit note for the original invoice
  ([compliance](../05-security-compliance/compliance-costa-rica.md)).
- The shopper receives a written confirmation with the amount, method and
  date. When an order is cancelled because its parcels came back with nobody
  at the door, the goods and the delivery fee are two refunds but one
  message: one "refund started" and one "refund arrived", each with the
  total, "el envío incluido". "Refund arrived" waits for the last of them: if
  the fee's refund is stuck (the gateway has not confirmed, or finance has
  not recorded the transfer), the shopper hears nothing about the goods
  either until it is done.
- A cancelled order says why on its page when the system cancelled it (no
  payment in time, parcels came back) or the shopper did. When staff cancel,
  the reason staff type stays with staff (the shopper's apps never receive
  it): the page says "Cancelamos este pedido" and points to Ayuda, so be
  ready to explain. When the parcels came back after a real attempt at the
  door, the page says only the products' money comes back and that the
  delivery fee stays because someone went to the address.
- Open refunds are reviewed daily; none may reach day 8.

## Disputes with sellers

The shopper is never a party to these.

| Cause                                                                 | Who bears the cost                                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Item not as described, defective, or wrong item sent to the warehouse | Seller: refund, both delivery legs, and the commission is returned                                                      |
| Stock the seller declared but did not have                            | Seller; counts toward their cancellation rate                                                                           |
| Damage or loss in the warehouse or in transit; picking error          | Yuntera; the seller is paid as if the sale completed, or the unit's value is reimbursed                                 |
| Withdrawal with the item in resellable condition                      | Seller refunds the sale and keeps the unit; Yuntera absorbs delivery in the pilot (assumption to validate with sellers) |
| Withdrawal with the item no longer resellable                         | Decided on the inspection photos; default split to be defined in the seller agreement                                   |

Process: Yuntera records the evidence (inbound count, pick scan, delivery
record, inspection photos), states its decision and the reason in writing, and
the seller has 5 working days to contest it with their own evidence. A second
person reviews contested decisions once there is one. Repeated defects feed
the seller's performance score (`packages/core/src/sellers.ts`), which can
suspend an account; a suspended seller is told why and can appeal.

## Complaints

The law requires a free complaint mechanism, and Ley 10946 will add an internal
complaint system for platform decisions from about mid-2027.

1. **How to complain.** A form linked from every page footer and every order
   (`/reclamo` on the website, "Presentar un reclamo" in the shopper app),
   and by email or WhatsApp. Free, in Spanish. The aim is that no account is
   needed to complain about an order with its number; **today the form needs
   an account** (the database's `file_complaint` requires one). A complaint
   that arrives by WhatsApp, phone or e-mail is recorded by staff with
   **Registrar un contacto** (topic "Reclamo formal") and gets the same
   targets.
2. **Acknowledgement** within 1 working day, with a reference number.
3. **A written answer** within 5 working days: what was found, what Yuntera
   will do, and how to escalate.
4. **Escalation.** The answer states that the shopper may take the matter to
   the Comisión Nacional del Consumidor through MEIC.
5. **Register.** Every complaint, its category, the outcome and the time taken
   is recorded. The register is reviewed monthly for patterns; a pattern is a
   product or operations defect to fix, not a support problem.

The same mechanism serves sellers and reporters who disagree with a moderation
or suspension decision.

### Reports about listings and reviews

Anyone can report a listing or a review as illegal, counterfeit, unsafe or
misleading. A person reviews each report, records the decision and the reason,
and tells the reporter and the seller. Reviews are removed only for illegal
content, personal data or irrelevance, never for being negative: the law
requires that negative reviews be published.

## Working cases in the console

Every request has a case under **Casos** in the staff console. Complaints,
return requests and content reports open one by themselves. A WhatsApp,
phone or e-mail conversation is recorded with **Registrar un contacto** on
the order's page (or the customer's page when no order is involved), with
the channel, the topic and a one-line summary. The topic sets the targets
above. The case shows when the first response and the resolution are due,
and says "A tiempo", "Vence pronto" or "Atrasado".

1. Open the oldest case first. Use **Asignarme el caso** so colleagues know
   who has it.
2. Write what you found in **Nota interna**. The customer never sees notes.
   Never write the delivery code. The console refuses a note, an answer, a
   contact summary, or an answer or note written in Atención, that holds it,
   saves nothing of that step, records the refusal on Auditoría, and after
   three refusals in an hour stops you writing for that hour. Four-digit
   numbers count too: after 20 in an hour, write without them or wait.
3. Answer in **Respuesta al cliente**. Start from **Usar una respuesta
   guardada** when one fits, then adjust it. The customer reads the answer in
   their account ("Sus consultas") and on the order's page; a message tells
   them an answer is waiting, never what it says.
4. Use **Responder y cerrar** when nothing more is needed. **Responder** keeps
   the case open. A return or a report is decided in **Atención**: its case
   closes by itself then, so only **Responder** is offered. A closed case can
   be reopened, and it then counts as reopened in the monthly report.
5. **Ver el cliente** shows one customer's orders, returns, complaints and
   cases. Their phone and e-mail appear only with **Mostrar contacto**, which
   asks why; the reason is recorded on Auditoría. If a customer typed their own
   delivery code into a complaint, staff read it as "••••".
6. Review **Informe del mes** on the first working day of each month: cases by
   type, first responses on time, complaints answered within 5 working days,
   refunds within the legal period, reopened cases.

Who reads which case: support and administrators every case; operations the
cases tied to an order; finance payments and refunds; catalogue staff the
reports about listings. Only support and administrators answer, assign,
reopen, record contacts and reveal a contact. When a customer deletes their
account, the text of their cases is erased and an open contact closes.

## What support is measured on

| Metric                                                             | Why                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Contacts per 100 orders                                            | The best support is the contact that was not needed               |
| Share of late deliveries where Yuntera contacted the shopper first | Being told is the difference between a delay and a broken promise |
| Refunds issued within the legal period                             | Must be 100%                                                      |
| First-response time against target                                 |                                                                   |
| Complaints answered within 5 working days                          |                                                                   |
| Reopened cases                                                     | A sign the first answer did not solve it                          |
