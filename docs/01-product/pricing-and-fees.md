# Pricing and fees

This is a proposal, not a price list. The [pricing strategy](../00-strategy/pricing-strategy.md)
(24 November 2026) proposes what to keep and change for the pilot and the
launch, and its owner questions are D20 to D25 and D38 in
[owner decisions](../00-strategy/owner-decisions.md). It sets the structure of what sellers pay
and what shoppers pay for delivery, explains why every fee is itemised and
published, and says how the rules that rank offers are disclosed. The structure
is implemented and tested in `packages/core/src/fees.ts`; the amounts in it are
working assumptions that must be validated with real sellers before anything is
announced.

## Principles

1. **A seller can compute their payout before listing.** No fee depends on
   something they cannot see.
2. **Every fee pays for something named.** Commission pays for demand, the
   fulfilment fee for handling, the payment fee for the gateway.
3. **Pass-through costs are passed through, not marked up.** The payment fee
   tracks what the gateway charges.
4. **The shopper sees one total.** IVA and shipping are included before the pay
   button, with a breakdown, as the law requires
   ([fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection)).

## What sellers pay

All amounts below are the current values in `DEFAULT_FEE_SCHEDULE` and are
**assumptions to validate**. Fees are a service invoiced by Yuntera and carry
13% IVA on top.

### Referral commission

A percentage of the IVA-inclusive item price, charged only when an item sells.

| Category                                                | Rate |
| ------------------------------------------------------- | ---: |
| Electrónica, computación, celulares, abarrotes          |   8% |
| Electrodomésticos, hecho en Costa Rica                  |  10% |
| Hogar, ferretería, deportes, juguetes, mascotas, libros |  12% |
| Belleza                                                 |  13% |
| Moda                                                    |  15% |
| Any other category                                      |  12% |

A floor of ₡150 per unit applies, so that very cheap items still cover the cost
of handling them. The floor never exceeds the price of the item.

### Fulfilment fee

Charged per unit when the stock ships from a Yuntera warehouse. It covers
storage for a free period, picking, packing and the packaging.

| Tier      | Up to | Longest side up to | Fee per unit |
| --------- | ----: | -----------------: | -----------: |
| _Sobre_   | 500 g |              30 cm |         ₡900 |
| _Pequeño_ |  2 kg |              45 cm |       ₡1,400 |
| _Mediano_ | 10 kg |              60 cm |       ₡2,400 |
| _Grande_  | 30 kg |             120 cm |       ₡4,900 |

Items beyond the largest tier are not accepted for warehouse fulfilment in the
Pilot.

### Payment fee

A percentage of the amount collected for the seller, by payment method, plus a
fixed amount per order where the method has one. It is meant to pass the cost
of collecting the money through, not to earn margin.

| Method           | In code today | Basis                                                                                        |
| ---------------- | ------------: | -------------------------------------------------------------------------------------------- |
| SINPE Móvil      |          1.5% | Published gateway price: 1.5% at the cheaper gateway found, 2% + US$0.35 at the other        |
| Card             |   3.9% + ₡180 | Published gateway price: 3.9% + US$0.35 at the cheaper gateway, 4.25% + US$0.35 at the other |
| Cash on delivery |   2.0% + ₡300 | **Assumption.** No gateway; the cost is handling cash and refused deliveries                 |
| Bank transfer    |          0.5% | **Assumption.** Not researched                                                               |

Gateway figures are published list prices from the
[fact sheet, section 5](../research/costa-rica-fact-sheet.md#5-payments), at
low-to-medium confidence. The code follows the cheaper of the two gateways
found, and ₡180 stands for US$0.35 at an assumed exchange rate of about ₡515
per dollar. At the banks' selling rate of 18 November 2026, ₡450 per dollar,
US$0.35 is ₡157.50, so ₡180 is ₡22.50 above the list price, while the seller
centre says the cost "se traslada sin recargo"
([market research](../research/market-and-costs-2026-11.md) §6.4, read 24
November 2026; owner decision D38). These replace an earlier schedule (3.5% for cards, 1% for SINPE
Móvil) that was below cost. They are still not contracted rates: until a
gateway is chosen ([open question](../08-open-questions.md)), quote sellers a
range, not a figure.

The fixed amount is charged once per order, as a gateway charges it once per
payment. When an order has items from several sellers they share it in
proportion to what each sold, to the céntimo; see
[fees and settlement](../04-algorithms/fees-and-settlement.md#the-calculation).

### A statement a seller can check

The pilot's typical sale is a ₡20,000 household item stored in a Yuntera
warehouse (tier _pequeño_, ₡1,400) and paid by SINPE Móvil: the seller receives
₡15,367.00 (₡20,000 less ₡4,100 of fees and ₡533 of IVA). That is the case the
product supports today, and the figure the seller pieces lead with.

The tested case below is a later one: a seller who ships the item themselves,
paid by card. Cards come at the open launch and driver pickups from sellers are
"Later" in [scope by app](scope-by-app.md). For a ₡20,000 household item sold by
a seller who ships it themselves, paid by card, the tested example in `packages/core/src/fees.test.ts` — replayed
through a real order in `supabase/tests/040_money.sql` — gives:

| Line                               |         Amount |
| ---------------------------------- | -------------: |
| Sale                               |     ₡20,000.00 |
| Referral commission, 12%           |     −₡2,400.00 |
| Payment fee, 3.9% (₡780) plus ₡180 |       −₡960.00 |
| IVA on fees, 13% of ₡3,360         |       −₡436.80 |
| **Payout**                         | **₡16,203.20** |

More cases, and the full calculation, are in
[fees and settlement](../04-algorithms/fees-and-settlement.md#worked-example).

The engine guarantees that payout plus fees equals the money collected, to the
céntimo, for every combination tested.

### Not charged in the Pilot

No listing fee, no monthly subscription, no storage fee, no advertising. The
Pilot's purpose is to learn what sellers will pay for, and a seller who is
experimenting should not be billed for standing still. A storage fee for stock
that does not move is proposed for Launch.

## What shoppers pay for delivery

Product prices are set by sellers and shown IVA-inclusive. Delivery is a
separate, flat charge by zone. Zones and service levels are defined in
`SERVICE_PRESETS` in `packages/core/src/promise.ts`.

| Zone                | Service                                               | Proposed charge |  Free above |
| ------------------- | ----------------------------------------------------- | --------------: | ----------: |
| GAM core            | Next delivery day, Monday to Saturday, order by 14:00 |          ₡1,500 |     ₡25,000 |
| GAM extended        | 1–2 delivery days, order by 12:00                     |          ₡2,000 |     ₡35,000 |
| Rest of the country | 2–5 business days by carrier, from Phase 4            |    Carrier cost | Not offered |

Every amount in this table is an **assumption to validate**. Two reference
points keep it honest: Correos charges ₡2,300 before IVA for a small parcel
within the GAM at its self-service locker
([fact sheet, section 7](../research/costa-rica-fact-sheet.md#7-last-mile-and-labour)),
and its Pymexpress volume tariff, with prior authorisation, is ₡1,756.19 to
₡2,005.53 before IVA by monthly volume for parcels dropped off; if Correos
collects, ₡1,500 to ₡2,000 a collection plus ₡1,890 a small parcel
(correos.go.cr/tarifas, read 24 November 2026); Amazon Bazaar shipped free from
₡10,000 at its launch (El Financiero, 9 November 2025, read 24 November 2026;
terms may have changed);
and the [business model](../00-strategy/business-model.md) shows that a
free-shipping threshold set too low erases the margin on mid-sized baskets.

Rules that do not change with the amounts:

- One delivery charge per order, however many sellers are in it.
- The charge is shown on the product page for the shopper's zone, not first
  revealed at checkout.
- Cash on delivery carries no surcharge for the shopper. Orders that the risk
  rules flag are asked to prepay instead (`packages/core/src/risk.ts`).

## Why fees are itemised and published

- **Trust.** Small sellers have been surprised by marketplace deductions
  elsewhere. A seller who can reproduce their statement by hand does not need
  to call support.
- **Fewer disputes.** Every line on a statement maps to a published rule.
- **Tax.** Yuntera invoices its fees electronically with IVA; the seller
  deducts that IVA. The statement and the invoice must match line for line.
- **It is cheap to do.** The fee engine already produces the breakdown.

The fee schedule carries a version identifier. A change of fees is announced in
advance (proposal: 30 days, owner decision D24). It applies to every order paid
after the new schedule is switched on, not only to orders placed after it: the
fees are computed when the payment is captured, from the schedule marked
active at that moment (`private.post_order_capture` calls
`private.compute_seller_fees`, which reads `fee_schedules where active`;
migrations `20261121080800_finance.sql` and `20261121082400_fixes.sql`). A
cash-on-delivery order is captured at the door, so one placed before a change
and delivered after it pays the new fees. Orders already paid keep their
statement. The schedule's `effective_from` date is stored but no function
reads it, so a new schedule takes effect when the migration that marks it
active is applied (checked in the code on 24 November 2026).

## How ranking rules are disclosed

When several sellers offer the same product, one offer is shown by default.
Which one, and the order of search results, decides who sells. Yuntera
publishes the rules.

**Featured offer** (`packages/core/src/offers.ts`). Published in the seller
centre in plain Spanish:

- What counts: the total price to the shopper including shipping (55%),
  delivery speed (25%), the seller's performance score (15%), and whether the
  offer is fulfilled from a Yuntera warehouse (5%).
- What disqualifies an offer: no stock, a suspended seller, a performance score
  below 60, a condition other than new, or a total price more than 15% above
  the cheapest eligible offer.
- What does not count: who the seller is, how long they have been on the
  platform beyond tie-breaking, or any payment to Yuntera.
- Each seller sees their own offer's score and the component costing them most.

**Search ranking** (`packages/core/src/search.ts`). Relevance to the query comes
first; quality signals (rating, sales, conversion, delivery speed, price
relative to similar products, return rate) reorder results that are similarly
relevant. New listings get a temporary boost so they can earn signals.

**Sponsored results**, when they exist, occupy fixed positions, are labelled
_Patrocinado_, and must still be relevant to the search.

The percentages are the current code values and may be tuned; the commitment is
that whatever they are, they are published.

This matters beyond fairness. Ley 10946, in force from about June 2027,
requires transparency about recommender systems and advertising and bans
manipulative interface design
([fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection)).
Publishing the rules from day one means there is nothing to retrofit.

## What must be validated before this is fixed

| Question                                                                | How to find out                                                                                                           | Decides                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Will sellers accept 8%–15% commission plus fulfilment fees?             | Show the worked statement to 10–15 target sellers before the Pilot; ask what they net today through Instagram and courier | Commission rates                         |
| What does handling a unit actually cost?                                | Time the Pilot: minutes per receive, putaway, pick, pack; packaging spend                                                 | Fulfilment tiers                         |
| Which gateway, at what contracted rate?                                 | Quotes from the gateways; see [open questions](../08-open-questions.md)                                                   | Payment fee                              |
| What basket sizes do shoppers build?                                    | Pilot order data                                                                                                          | Free-shipping threshold, minimum order   |
| Does a delivery charge stop the purchase?                               | Compare conversion across the threshold in the Pilot                                                                      | Shipping charges                         |
| How often is cash on delivery refused?                                  | Pilot refusal rate                                                                                                        | Cash-on-delivery fee and risk thresholds |
| Is a cash refund acceptable for cash orders, or must it be SINPE Móvil? | Lawyer                                                                                                                    | Refund mechanics                         |
