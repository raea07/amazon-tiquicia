# Risk and trust

Two rule-based scores — one for orders, one for sellers — and the trust
controls that are actually enforced today. Read the state column first: the
two scores are specified and tested, and **neither is wired into a running
flow yet**.

| Piece                                 | Where                                           | State                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Order risk score                      | `packages/core/src/risk.ts` (`assessOrderRisk`) | Specified and unit-tested (`trust.test.ts`). `orders.risk_score` and `risk_decision` exist as columns; nothing computes or stores them |
| Seller performance score              | `packages/core/src/sellers.ts` (`scoreSeller`)  | Specified and unit-tested (`trust.test.ts`). `sellers.score` and `health` exist with defaults; no job recomputes them                  |
| Cash-on-delivery limits               | `place_order`, `delivery_zones`, `app_settings` | Enforced                                                                                                                               |
| Delivery PIN with attempt limit       | `driver_complete_stop`                          | Enforced                                                                                                                               |
| Verified-purchase reviews             | `submit_review`                                 | Enforced                                                                                                                               |
| Listing review before publication     | Triggers on `products`; `ops_review_product`    | Enforced                                                                                                                               |
| Seller approval before selling        | `create_seller`, `ops_set_seller_status`        | Enforced                                                                                                                               |
| Notice-and-action reports, complaints | `report_content`, `file_complaint`              | Enforced as intake; handling is by staff                                                                                               |
| Audit log of sensitive changes        | `private.audit_log`                             | Enforced                                                                                                                               |

---

## Order risk score

### Goal

Decide how much friction an order gets before it is accepted, in a way that
can be explained to a reviewer and, on request, to the customer. Friction
should fall on behaviour that looks like fraud, not on kinds of people.

### Inputs

All are facts about the account's behaviour and this order.

| Signal                                           | Meaning                                       |
| ------------------------------------------------ | --------------------------------------------- |
| Order total; payment method                      | This order                                    |
| Account age in hours                             |                                               |
| Phone verified; e-mail verified                  |                                               |
| Delivered orders                                 | Orders this account has received successfully |
| Refused cash orders                              | Refused or failed cash-on-delivery attempts   |
| Orders in the last hour; in the last 24 hours    | Velocity                                      |
| Failed payments in the last 24 hours             | Card testing                                  |
| Other accounts sharing this payment instrument   | By a gateway fingerprint, never a card number |
| Other accounts created on this device in 30 days |                                               |
| Prior chargebacks or confirmed fraud             |                                               |
| Median value of the account's past orders        |                                               |
| Address added within the last hour               |                                               |

### Rules

Each rule that fires adds points and records why, in Spanish, so the reason can
be shown.

| Rule                                 | Fires when                                                   | Points |
| ------------------------------------ | ------------------------------------------------------------ | -----: |
| `prior_chargeback`                   | The account has a chargeback or confirmed fraud              |    +50 |
| `cod_refusals`                       | Cash on delivery, and two or more past refusals              |    +40 |
| `shared_instrument`                  | The payment instrument was used on three or more accounts    |    +35 |
| `cod_high_value_first_order`         | Cash on delivery, total ₡75,000 or more, no delivered orders |    +35 |
| `device_farm`                        | Four or more accounts created from the device in 30 days     |    +30 |
| `card_testing`                       | Three or more failed payments in 24 hours                    |    +30 |
| `new_account_high_value`             | Account under one hour old and total ₡250,000 or more        |    +30 |
| `velocity_hour`                      | Four or more orders in an hour                               |    +25 |
| `velocity_day`                       | Ten or more orders in 24 hours                               |    +15 |
| `phone_unverified`                   | Phone not verified                                           |    +15 |
| `unusual_basket`                     | Total more than eight times the account's median order       |    +15 |
| `new_address_on_established_account` | New address, existing customer, paying by card               |    +10 |
| `email_unverified`                   | E-mail not verified                                          |     +5 |
| `established_customer`               | Five or more delivered orders and no chargebacks             |    −20 |

Earned trust lowers the score but can never excuse a chargeback history: the
discount does not apply to an account that has one.

### Decision

The points are summed and clamped to 0–100.

| Score  | Decision  | What happens                                                                                                                              |
| ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0–29   | `approve` | Nothing                                                                                                                                   |
| 30–59  | `step_up` | Ask for something specific: verify the phone; prepay instead of cash; 3-D Secure for a card. A step-up always asks for at least one thing |
| 60–84  | `review`  | Hold for a person                                                                                                                         |
| 85–100 | `decline` | Refuse                                                                                                                                    |

### Worked examples

Computed with `assessOrderRisk`.

| Order                                                                                              | Rules that fire                                                   | Score | Decision                                |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----: | --------------------------------------- |
| ₡29,800 by SINPE Móvil; account three weeks old, phone and e-mail verified, three delivered orders | none                                                              |     0 | `approve`                               |
| ₡90,000 cash on delivery; first order, phone not verified                                          | `cod_high_value_first_order` +35, `phone_unverified` +15          |    50 | `step_up`: verify the phone, and prepay |
| Cash on delivery; two past refusals; phone and e-mail unverified                                   | `cod_refusals` +40, `phone_unverified` +15, `email_unverified` +5 |    60 | `review`                                |

### What it deliberately does not use

**The delivery district, the customer's name, nationality, or type of
identification.** Scoring by neighbourhood is redlining: it punishes people for
where they live, and Costa Rican data-protection law restricts automated
decisions built on such attributes. A unit test
(`packages/core/src/trust.test.ts`) asserts that the signals contain no such
field, so adding one would fail the build.

Also not used: gender, age, device brand, or anything inferred about the person
rather than observed about the account.

### Known limits

- **Not wired.** `place_order` does not call it. Several inputs are not
  collected at all: there is no device identifier, no payment-instrument
  fingerprint (there is no gateway), no failed-payment log, and no phone
  verification flow.
- **The points and thresholds are judgement, not fitted to data.** There is no
  labelled fraud data. Expect to retune every one of them.
- **A step-up needs flows that do not exist**: phone verification, forcing
  prepayment, 3-D Secure.
- **A `review` decision needs a queue and a person**, with a service level,
  or orders will sit.
- **Rules can be probed.** Anyone who learns them can stay just under a
  threshold. That is acceptable for a transparent first version and is the
  reason to keep the list short and behavioural.

---

## Controls that are enforced today

These are in the database and apply to every order.

| Control                                   | Rule                                                                                                                      | Where                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Cash-on-delivery ceiling                  | An order over `cod_max_order_minor` (₡150,000 as seeded) cannot be paid in cash                                           | `place_order` → `cod_not_available`                      |
| Cash on delivery by zone                  | A zone can switch cash on delivery off                                                                                    | `delivery_zones.cod_available`                           |
| Quantity limits                           | At most 10 units of one offer and 40 distinct offers per order                                                            | `app_settings`; `place_order`                            |
| Price integrity                           | Totals are recomputed from the database's own prices; a total that differs from what the shopper confirmed is refused     | `place_order` → `price_changed`                          |
| Stock hold                                | An unpaid order releases its stock after 30 minutes                                                                       | `private.expire_unpaid_orders`, where a scheduler exists |
| Proof of delivery                         | A stop completes only with the shopper's PIN, the recipient's name, and the exact cash due; five wrong PINs lock the stop | `driver_complete_stop`                                   |
| The PIN is never sent to the driver       |                                                                                                                           | `driver_today`                                           |
| Sandbox payments cannot run in production | The simulator refuses unless `payments_mode` is `sandbox`                                                                 | `confirm_sandbox_payment`                                |

The cash ceiling and the 30-minute hold are assumptions to tune in the pilot.

---

## Seller performance score

### Goal

One number, 0–100, for how reliably a seller serves customers. It is meant to
feed featured-offer selection and search, and to drive health warnings in the
seller centre with the single most useful thing to fix.

### Inputs

Over the trailing 60 days: orders; late shipments; cancellations by the seller
before shipping; defects (orders with a negative review, an upheld claim or a
chargeback); tracked shipments out of seller-fulfilled shipments; and the
median hours to first reply to a buyer message.

### Smoothing

Small samples are noisy: one late shipment out of two is not a 50% problem.
Each rate is estimated as if the seller already had some typical history:

```
smoothed rate = (events + priorMean × priorStrength) ÷ (orders + priorStrength)
```

| Rate           | Typical value assumed | Worth this many orders of evidence |
| -------------- | --------------------: | ---------------------------------: |
| Late shipments |                    4% |                                 20 |
| Cancellations  |                    2% |                                 20 |
| Defects        |                    1% |                                 30 |
| Tracking       |                   95% |                                 20 |

A new seller starts at the typical rates and converges on their own as orders
accumulate.

### Scoring

Each dimension earns a share of its points: full marks at or better than
target, zero at the failure point, linear in between.

| Dimension      | Points | Target           | Zero at  |
| -------------- | -----: | ---------------- | -------- |
| Defects        |     35 | 1% or lower      | 5%       |
| Late shipments |     25 | 4% or lower      | 16%      |
| Cancellations  |     20 | 2.5% or lower    | 10%      |
| Tracking       |     10 | 95% or higher    | 70%      |
| Response time  |     10 | 24 hours or less | 72 hours |

| Score    | Health      |
| -------- | ----------- |
| 90–100   | _excelente_ |
| 75–89    | _bien_      |
| 60–74    | _en riesgo_ |
| below 60 | _crítico_   |

The **top issue** is the dimension costing the most points, reported only if
it costs at least one.

**Enforcement needs evidence.** Until a seller has 10 orders in the window, the
score gates nothing: their standing is `active` whatever the number. After
that, _en riesgo_ maps to `at_risk` and _crítico_ to `suspended` for the
purposes of the featured offer.

### Worked examples

Computed with `scoreSeller`.

| Seller                                                                       |      Smoothed late rate | Score | Health      | Top issue      | Enforced?            |
| ---------------------------------------------------------------------------- | ----------------------: | ----: | ----------- | -------------- | -------------------- |
| No orders yet                                                                |                    4.0% |   100 | _excelente_ | none           | No                   |
| 2 orders, 1 late                                                             |   (1 + 0.8) ÷ 22 = 8.2% |    91 | _excelente_ | late shipments | No — under 10 orders |
| 100 orders: 10 late, 2 cancelled, 1 defect, all tracked, replies in 12 hours | (10 + 0.8) ÷ 120 = 9.0% |    90 | _excelente_ | late shipments | Yes                  |

The third seller ships one order in ten late and still scores 90. That is the
scoring as written: late shipments are worth 25 points and a 9% rate loses
about 10 of them. Whether that is too lenient is exactly the kind of thing to
decide with pilot data.

### What it deliberately does not use

- **Sales volume or revenue.** A large seller gets no credit for being large.
- **Price.** Being expensive is not a performance defect.
- **Rating averages directly.** Only clearly negative outcomes count as
  defects, so a seller is not punished for honest four-star reviews.
- **Anything about who the seller is**: tax regime, location, how long they
  have been registered.

### Known limits

- **Not computed.** No job gathers the metrics or writes `sellers.score`. Every
  seller has the default of 90 and _bien_ unless set by hand.
- **Several inputs do not exist yet.** There is no buyer–seller messaging, so
  no response time; "defect" needs upheld claims and chargebacks, which need
  the returns resolution flow and a gateway.
- **Late shipments need a definition in data.** The intent is "packed after the
  dispatch date the promise required"; the dispatch date is computed but not
  stored on the shipment.
- **The score in SQL would be a nightly snapshot**, so a seller's standing
  could lag a day behind their behaviour.

---

## Reviews, reports and complaints

- **Reviews** can be written only by the account that bought the product, only
  after the order is delivered, and once per purchase line. They are published
  immediately. Moderation may remove a review that breaks content rules —
  insults, personal data, off-topic — and never for a low rating. The seller
  may reply publicly (a later reply replaces the earlier one); they cannot edit
  or remove the review. Ratings feed
  ranking through a Bayesian average
  ([search ranking](search-ranking.md#step-4--quality)).
- **Content reports** can be filed by anyone, signed in or not, against a
  listing, a review or a seller. Only support and catalogue staff read the
  queue.
- **Complaints** are the shopper's free channel, optionally tied to one of
  their own orders.
- **Withdrawals** inside the legal window are approved automatically — a right,
  not a request to be judged — with a refund due date eight calendar days out.
  Other return claims wait for a decision by staff (`ops_decide_return`); a
  refusal must be explained in writing. Recording the refund is a separate step
  (`ops_complete_return`).

How these are handled operationally is in
[customer service](../06-operations/customer-service.md).

## What to measure before wiring or tuning either score

| Measure                                                                                  | Why                                                                              |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Cash-on-delivery refusal rate, by order value and by first-time versus returning shopper | Sets the cash rules and the ceiling                                              |
| Chargebacks and confirmed fraud, with the signals each order had                         | The labelled data every threshold needs                                          |
| Orders that would have been stepped up or held, and how many of those were fine          | The cost of friction; false positives lose real customers                        |
| Late, cancelled and defective orders per seller, per month                               | Whether the targets are achievable by honest small sellers                       |
| Wrong-PIN attempts and locked stops                                                      | Whether five is the right limit, and whether shoppers have their PIN at the door |
| Time from a content report or complaint to its resolution                                | A legal duty under Ley 10946 once in force                                       |
