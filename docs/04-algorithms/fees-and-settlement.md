# Fees and settlement

What Yuntera charges a seller for an order, what the seller is paid, and how
every colón that moves is recorded so the books always add up.

- Specification: `packages/core/src/fees.ts` (`computeSellerStatement`),
  `packages/core/src/money.ts`
- Implementation: `private.compute_seller_fees`, `private.post_order_capture`,
  `private.post_order_refund` in
  `supabase/migrations/20261121080800_finance.sql`; cash settlement in
  `ops_settle_route` (`…081100_fulfillment.sql`); returns and manual payment
  confirmation in `ops_complete_return` and `ops_confirm_payment`
  (`…081700_api_backoffice.sql`)
- Tests: `packages/core/src/fees.test.ts`; the same cases replayed through real
  orders in `supabase/tests/040_money.sql`; a parity test that fails if the
  schedule in SQL differs from the one in TypeScript

**The amounts are assumptions.** The schedule is version
`2026-11-assumptions`. Its payment fees follow published gateway list prices at
low-to-medium confidence
([fact sheet, section 5](../research/costa-rica-fact-sheet.md#5-payments)), not
a signed contract. Nothing here has been shown to a seller. The _structure_ is
what the code guarantees.

## Goal

1. A seller can compute their payout before listing, and reproduce their
   statement by hand afterwards.
2. Every fee pays for something named.
3. Payment costs are passed through, not marked up.
4. `payout + fees = money collected`, to the céntimo, always.

## The schedule

### Referral commission

A percentage of the IVA-inclusive line total, by the product's top-level
category.

| Category                                                | Rate |
| ------------------------------------------------------- | ---: |
| Electrónica, computación, celulares, abarrotes          |   8% |
| Electrodomésticos, hecho en Costa Rica                  |  10% |
| Hogar, ferretería, deportes, juguetes, mascotas, libros |  12% |
| Belleza                                                 |  13% |
| Moda                                                    |  15% |
| Anything else                                           |  12% |

With a floor of **₡150 per unit**, capped at the line total so the fee can
never exceed the sale. In the database the rate is a column on `categories`; a
sub-category with no rate inherits its parent's, then the schedule default.

### Fulfilment fee

Per unit, only when the stock ships from a Yuntera warehouse. The smallest tier
that fits both the weight and the longest side.

| Tier      | Up to | Longest side up to | Fee per unit |
| --------- | ----: | -----------------: | -----------: |
| _sobre_   | 500 g |              30 cm |         ₡900 |
| _pequeño_ |  2 kg |              45 cm |       ₡1,400 |
| _mediano_ | 10 kg |              60 cm |       ₡2,400 |
| _grande_  | 30 kg |             120 cm |       ₡4,900 |

An item beyond the largest tier cannot be warehouse-fulfilled
(`OversizeItemError`).

### Payment fee

A rate on the amount collected for the seller, plus a fixed amount per
order, shared between the order's sellers (see below).

| Method           | Rate | Fixed | Basis                                                                                               |
| ---------------- | ---: | ----: | --------------------------------------------------------------------------------------------------- |
| Card             | 3.9% |  ₡180 | Published gateway price of 3.9% + US$0.35; ₡180 assumes an exchange rate of roughly ₡515 per dollar |
| SINPE Móvil      | 1.5% |     — | Published gateway price                                                                             |
| Cash on delivery | 2.0% |  ₡300 | **Assumption**: counting, carrying and depositing cash, and refused deliveries. Not researched      |
| Bank transfer    | 0.5% |     — | **Assumption**. Not researched                                                                      |

### IVA on fees

Yuntera's fees are a service invoiced to the seller and carry **13%** IVA on
top.

## The calculation

For one seller's part of one order:

```
referral    = Σ over lines of  min( max( round(lineTotal × rate), ₡150 × quantity ), lineTotal )
fulfilment  = Σ over warehouse-fulfilled lines of  tierFee × quantity
payment     = round(collected × methodRate) + fixedShare
feesNet     = referral + fulfilment + payment
feesTax     = round(feesNet × 13%)
payout      = collected − feesNet − feesTax
```

Rounding is to the céntimo, half away from zero, once per line shown above.
Amounts are integers of céntimos throughout; there is no floating-point money.

`fixedShare` is the seller's part of the method's fixed amount. The gateway
charges it once per payment, so it is charged once per order: with one seller
it is the whole amount; with several, each seller's part is in proportion to
their items total, by largest remainder. Each seller gets the whole céntimos
of `fixed × theirItems / allItems`; the céntimos left over go one each to the
largest remainders, a tie going to the lowest seller id; so the parts add up
to exactly the fixed amount. `splitFixedPaymentFee` in `fees.ts` and
`private.split_fixed_fee` in the database do the same integer arithmetic and
run the same cases (`supabase/tests/090_fixes.sql`, read by
`packages/core/src/cr/compliance.test.ts`).

Example, a card order (₡180 fixed) with three sellers selling ₡20,000,
₡9,900 and ₡4,200: the exact parts are ₡105.5718…, ₡52.2581… and ₡22.1699…;
their whole céntimos add up to ₡179.98, and the two céntimos left over go to
the two largest remainders (the third seller's, then the second's), so the
parts are ₡105.57, ₡52.26 and ₡22.17. With a single seller nothing changes:
the ₡20,000 example below still pays out ₡16,203.20.

## Worked example

The tested case: one household item at ₡20,000 (IVA included), shipped by the
seller, paid by card.

| Line                     | Calculation                       |         Amount |
| ------------------------ | --------------------------------- | -------------: |
| Sale                     |                                   |     ₡20,000.00 |
| Referral commission      | 12% of ₡20,000                    |     −₡2,400.00 |
| Fulfilment fee           | Seller ships it                   |          ₡0.00 |
| Payment fee              | 3.9% of ₡20,000 = ₡780, plus ₡180 |       −₡960.00 |
| Fees before tax          |                                   |      ₡3,360.00 |
| IVA on fees              | 13% of ₡3,360                     |       −₡436.80 |
| **Payout to the seller** | ₡20,000 − ₡3,360 − ₡436.80        | **₡16,203.20** |

Check: ₡16,203.20 + ₡3,796.80 = ₡20,000.00.

The same item under other choices, computed with `computeSellerStatement`:

| Fulfilment                   | Payment          | Referral | Fulfilment | Payment | IVA on fees |        Payout |
| ---------------------------- | ---------------- | -------: | ---------: | ------: | ----------: | ------------: |
| Seller ships                 | Card             |    2,400 |          0 |     960 |      436.80 | **16,203.20** |
| Yuntera warehouse, _pequeño_ | SINPE Móvil      |    2,400 |      1,400 |     300 |      533.00 | **15,367.00** |
| Yuntera warehouse, _pequeño_ | Card             |    2,400 |      1,400 |     960 |      618.80 | **14,621.20** |
| Yuntera warehouse, _pequeño_ | Cash on delivery |    2,400 |      1,400 |     700 |      585.00 | **14,915.00** |

And at other prices:

| Item                 | Terms                            |              Fees before tax |    IVA |    Payout | Fees as share of price |
| -------------------- | -------------------------------- | ---------------------------: | -----: | --------: | ---------------------: |
| ₡1,000, hogar        | Seller ships, SINPE Móvil        | 165 (the ₡150 floor applies) |  21.45 |    813.55 |                  18.6% |
| ₡8,000, hogar        | Warehouse _sobre_, SINPE Móvil   |                        1,980 | 257.40 |  5,762.60 |                  28.0% |
| ₡20,000, hogar       | Warehouse _pequeño_, SINPE Móvil |                        4,100 | 533.00 | 15,367.00 |                  23.2% |
| ₡50,000, electrónica | Warehouse _pequeño_, SINPE Móvil |                        6,150 | 799.50 | 43,050.50 |                  13.9% |

The second row is the one to show sellers honestly: on a small item stored in
the warehouse, more than a quarter of the price goes to fees and their IVA.
The seller can deduct that IVA if they are in the general regime.

## What the database does, and where it differs from the specification

When a payment is captured, `private.compute_seller_fees` writes one row per
seller to `seller_order_fees` with every line above and the schedule version,
and never recomputes it. A later change of fees does not touch past orders.

One difference from the TypeScript function, a deliberate simplification of
the current model:

|                                  | TypeScript                                   | SQL                                                                                                       |
| -------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| What the payment rate applies to | Items plus any shipping passed to the seller | Items only. Shipping is collected by Yuntera for its own delivery service and is never passed to a seller |

The fixed part of the payment fee is the same on both sides: once per order,
shared as described above (`computeOrderStatements` in TypeScript,
`private.compute_seller_fees` in SQL).

## The ledger

Every movement of money is a transaction whose entries sum to zero: debits
positive, credits negative. The database refuses to commit one that does not,
and entries can never be edited or deleted. Balances are sums of entries;
nothing stores a balance.

### Accounts

| Account                   | Kind      | Holds                                                                                              |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `gateway_clearing`        | Asset     | Money the gateway has collected and not yet settled to Yuntera                                     |
| `driver_cash`             | Asset     | Cash a driver is carrying                                                                          |
| `cash_office`             | Asset     | Cash handed in and counted                                                                         |
| `cash_over_short`         | Expense   | Differences between cash expected and cash handed in                                               |
| `seller_payable:<seller>` | Liability | What Yuntera owes each seller; one account per seller, created on first use                        |
| `commission_revenue`      | Revenue   | Referral commissions                                                                               |
| `fulfillment_revenue`     | Revenue   | Warehouse service fees                                                                             |
| `payment_fee_revenue`     | Revenue   | Recovery of collection costs                                                                       |
| `shipping_revenue`        | Revenue   | Delivery charges, net of IVA                                                                       |
| `iva_payable`             | Liability | IVA collected on fees and on shipping                                                              |
| `refunds_payable`         | Liability | What is owed back to shoppers for returned items, from the moment a return is recorded as refunded |

### Capturing an order

A shopper pays ₡21,500 by SINPE Móvil: one ₡20,000 household item stored in the
warehouse (_pequeño_), plus ₡1,500 shipping.

| Account                                        |         Debit |        Credit |
| ---------------------------------------------- | ------------: | ------------: |
| `gateway_clearing`                             |     21,500.00 |               |
| `seller_payable:<seller>`                      |               |     15,367.00 |
| `commission_revenue`                           |               |      2,400.00 |
| `fulfillment_revenue`                          |               |      1,400.00 |
| `payment_fee_revenue`                          |               |        300.00 |
| `iva_payable` (13% of ₡4,100 in fees)          |               |        533.00 |
| `shipping_revenue` (₡1,500 ÷ 1.13)             |               |      1,327.43 |
| `iva_payable` (IVA inside the shipping charge) |               |        172.57 |
| **Total**                                      | **21,500.00** | **21,500.00** |

Capture is idempotent: an order that already has a capture transaction is not
booked again, whatever calls it.

### Cash on delivery

A cash order is confirmed when it is placed — there is nothing to wait for —
and captured at the door, when the driver completes the stop with the
shopper's PIN and the exact amount. The capture is the same as above with
`driver_cash` debited instead of `gateway_clearing`.

When a route completes, a settlement is opened for what the driver collected.
Staff count the cash and record it with `ops_settle_route`. Suppose ₡29,800 was
expected and ₡29,300 handed in:

| Account           |     Debit |    Credit |
| ----------------- | --------: | --------: |
| `cash_office`     | 29,300.00 |           |
| `cash_over_short` |    500.00 |           |
| `driver_cash`     |           | 29,800.00 |

The settlement is marked `short`, and the function refuses to record any
difference without a written note from whoever counted. What happens next
between Yuntera and the driver is a labour-law question, not a software one;
see [open questions](../08-open-questions.md).

### Confirming a transfer by hand

There is no gateway yet, so a SINPE Móvil or bank-transfer payment is confirmed
by a person. Finance staff check the bank statement and call
`ops_confirm_payment` with the order and the bank's own reference; the order is
captured exactly as above, and the reference is stored so the payment can be
traced. The same bank reference cannot be used for two orders. Card payments
cannot be confirmed this way, and cash is confirmed by the driver at the door.
This is the manual path for the pilot; a gateway webhook later calls the same
internal function.

### Cancelling a paid order

A cancellation before the parcel leaves reverses the capture in full: every
entry of the original, negated. In sandbox mode this is booked immediately. In
live mode the function only emits a `refund.requested` event for the money to
be sent back by the same payment method — and nothing consumes that event yet.

### Returning part of an order

When an approved return is recorded as refunded (`ops_complete_return`), the
shopper is owed what they paid for the returned units, and the cost is split
by a rule written into the function:

- the **seller** gives back what they were paid for those units;
- **Yuntera** gives back its commission on them, and the IVA on that commission;
- the **payment fee and the warehouse fee are not returned** to the seller, on
  the reasoning that those services were provided.

Take the ₡20,000 warehouse-fulfilled item above, paid by SINPE Móvil, returned
in full. The seller had received ₡15,367.

| Account                                      |     Debit |    Credit |
| -------------------------------------------- | --------: | --------: |
| `seller_payable:<seller>`                    | 17,288.00 |           |
| `commission_revenue`                         |  2,400.00 |           |
| `iva_payable` (13% of the ₡2,400 commission) |    312.00 |           |
| `refunds_payable`                            |           | 20,000.00 |

The seller's balance falls by ₡17,288 against the ₡15,367 they were credited:
they are ₡1,921 out of pocket on a returned sale — the ₡1,400 warehouse fee,
the ₡300 payment fee, and ₡221 of IVA on those two. When only some units of a
line come back, the commission is returned in proportion.

The shipping charge is not refunded by this function, and nothing yet records
the money actually leaving: `refunds_payable` is credited and stays so until a
worker or a person sends the refund and posts the outflow.

**This split is a policy written by an engineer, not a decision.** Whether a
seller may be left bearing fees on a withdrawal the law gives the shopper
unconditionally, who bears them when the item arrived damaged in Yuntera's
hands, and whether shipping must be refunded, are questions for the owner and
the lawyer ([open questions 30–32](../08-open-questions.md)).

### Paying sellers

A seller's balance is the sum of entries on their payable account. The
`payouts` table exists to record a payment for a period with its bank
reference, and the transaction kind `payout` is defined, but **no function
creates payouts yet**. Paying sellers in the pilot is a manual bank transfer
that must be recorded by a ledger transaction debiting the seller's payable
account and crediting the account the money left from.

## What it deliberately does not do

- **No fee depends on something the seller cannot see.** No dynamic pricing,
  no per-seller negotiated rates in the engine.
- **No listing fee, subscription, storage fee or advertising charge** in this
  schedule.
- **No commission on shipping.** The delivery charge is Yuntera's own service.
- **No surcharge to the shopper for any payment method.**
- **No penalties or chargebacks are netted against a seller's balance.**
  Returns are, as described above; nothing else is, because those flows do not
  exist.

## Known limits

- **Returns refund the item price only**, with the fee split described above,
  which is unconfirmed policy. Shipping is not refunded.
- **Refunds are booked, not paid.** The ledger records what is owed back; no
  code sends money to a shopper.
- **Discounts are not modelled.** `orders.discount_minor` exists and is always
  zero.
- **Tax withholdings by card acquirers** (up to 6% on account of IVA and 2% on
  account of income tax) are not in the ledger. Whose cash they tie up depends
  on who is the merchant of record — a question for the accountant.
- **No reconciliation against the gateway or the bank.** `gateway_clearing`
  grows with every capture and nothing yet records the gateway's settlement
  into a bank account.
- **Electronic invoices are records only.** The `electronic_invoices` table
  tracks state; nothing issues, signs or sends a document.
- **Payout can be negative** on a very small order if fees exceed the sale
  after the floor and fixed fee; the specification says the caller must handle
  it and nothing does yet.

## What to measure, and what must be decided, before changing the schedule

| Question                                                                                | How to find out                                                      | Changes                                                    |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| What does the contracted gateway actually charge, including fixed fees and payout fees? | The signed contract                                                  | Payment rates and fixed amounts; possibly a per-payout fee |
| What does handling a unit cost in the warehouse?                                        | Time receiving, putaway, pick and pack in the pilot; packaging spend | Fulfilment tiers                                           |
| What does a cash order cost, including refusals?                                        | Pilot: refusal rate, minutes at the door, deposit trips              | Cash-on-delivery fee                                       |
| Will sellers accept these rates?                                                        | Show the worked statement to 10–15 target sellers before the pilot   | Referral rates                                             |
| Fees as a share of price, by basket size                                                | The table above, on real orders                                      | The floor and the smallest tier                            |

A new schedule is a new row in `fee_schedules` with its own version and
effective date; the old one stays for the orders it priced. Change both the
SQL rows and `DEFAULT_FEE_SCHEDULE` together — the parity test will fail
otherwise — and announce it to sellers in advance.
