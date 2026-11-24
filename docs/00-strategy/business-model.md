# Business model

Yuntera earns a commission on each sale plus fees for the services a seller
chooses to use, and spends most of it on delivering the order. This document
works one order through the numbers, shows what break-even depends on, and
names the three numbers that decide whether the model works. The conclusion up
front: the model is thin on small baskets and lives or dies on route density.

**How to read the figures.** _Code_ means a working assumption already written
into `packages/core/src/fees.ts`. _Fact sheet_ means sourced in
[`research/costa-rica-fact-sheet.md`](../research/costa-rica-fact-sheet.md).
_Assumption_ means a planning guess that the pilot must replace with a measured
value. No figure here is a result.

The [pricing strategy](pricing-strategy.md) proposes what to charge and works out
the month with named staff; the [go-to-market](go-to-market.md) budget and the
[team structure](team-structure.md) cost the people. Their owner questions are in
[owner decisions](owner-decisions.md).

## Revenue lines

| Line                | Who pays                                       | When it starts                            | Basis                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Referral commission | Seller                                         | Pilot                                     | Percentage of the item price, by category (code: 8%–15%, default 12%, floor ₡150 per unit)                                                                                                   |
| Fulfilment fee      | Seller, when stock sits in a Yuntera warehouse | Pilot                                     | Per unit, by size tier (code: ₡900 / ₡1,400 / ₡2,400 / ₡4,900)                                                                                                                               |
| Payment fee         | Seller                                         | Pilot                                     | Percentage of the amount collected plus a fixed amount per order, by payment method (code: SINPE Móvil 1.5%; card 3.9% + ₡180); meant to pass through the gateway's cost, not to earn margin |
| Shipping charge     | Shopper                                        | Pilot                                     | Flat by zone, free above a basket threshold (assumption; see [pricing and fees](../01-product/pricing-and-fees.md))                                                                          |
| Storage fee         | Seller, for slow stock                         | Launch                                    | Per unit per month after a free period (assumption)                                                                                                                                          |
| Sponsored placement | Seller                                         | Later, once there is traffic worth buying | Cost per click, always labelled _Patrocinado_                                                                                                                                                |
| Membership          | Shopper                                        | Later                                     | Flat fee for free delivery; only once order frequency is known                                                                                                                               |

Fees charged to sellers are a service and carry 13% IVA on top
([fact sheet, section 1](../research/costa-rica-fact-sheet.md#1-tax-and-iva)).
All revenue figures below are net of IVA.

## One order, worked through

A shopper in the GAM core buys one household item for ₡20,000 (IVA included),
stored in the Yuntera warehouse, size tier _pequeño_, paid by SINPE Móvil, with
₡1,500 shipping.

|                                                        |     Amount | Source                                                                                                                |
| ------------------------------------------------------ | ---------: | --------------------------------------------------------------------------------------------------------------------- |
| **Revenue, net of IVA**                                |            |                                                                                                                       |
| Referral commission, 12% of ₡20,000                    |     ₡2,400 | Code                                                                                                                  |
| Fulfilment fee, tier _pequeño_                         |     ₡1,400 | Code                                                                                                                  |
| Payment fee charged to the seller, 1.5% of ₡20,000     |       ₡300 | Code                                                                                                                  |
| Shipping paid by the shopper, ₡1,500 less 13% IVA      |     ₡1,327 | Assumption                                                                                                            |
| **Total revenue**                                      | **₡5,427** |                                                                                                                       |
| **Variable cost**                                      |            |                                                                                                                       |
| Payment gateway, SINPE Móvil 1.5% of ₡21,500 collected |       ₡323 | [Fact sheet, section 5](../research/costa-rica-fact-sheet.md#5-payments) (published ONVO rate, low–medium confidence) |
| Last-mile delivery, per delivered stop                 |     ₡1,800 | Assumption: ₡45,000 fully loaded driver-day ÷ 25 delivered stops                                                      |
| Pick and pack labour                                   |       ₡500 | Assumption                                                                                                            |
| Packaging                                              |       ₡200 | Assumption                                                                                                            |
| Allowance for failed deliveries, returns and refunds   |       ₡120 | Assumption: 4% of orders at about ₡3,000 each                                                                         |
| Customer support                                       |       ₡150 | Assumption                                                                                                            |
| **Total variable cost**                                | **₡3,093** |                                                                                                                       |
| **Contribution per order**                             | **₡2,334** | About 12% of the item price                                                                                           |

The seller in this example receives ₡15,367: ₡20,000 less ₡4,100 of fees and
₡533 of IVA on those fees. That figure is computed by the fee engine
([fees and settlement](../04-algorithms/fees-and-settlement.md#worked-example));
the contribution is this document's arithmetic on top of it, and every cost
line marked _assumption_ is a guess.

### The same order at other basket sizes

Same assumptions; only the item changes.

| Item                                       | Category and tier           | Revenue | Variable cost | Contribution |
| ------------------------------------------ | --------------------------- | ------: | ------------: | -----------: |
| ₡8,000                                     | Hogar, _sobre_              |  ₡3,307 |        ₡2,913 |         ₡394 |
| ₡20,000                                    | Hogar, _pequeño_            |  ₡5,427 |        ₡3,093 |       ₡2,334 |
| ₡50,000, shipping free above the threshold | Electrónica (8%), _pequeño_ |  ₡6,150 |        ₡3,520 |       ₡2,630 |

A mix of baskets earns less than a single basket of the same average. With 30%
at ₡8,000, 40% at ₡20,000 and 30% at ₡35,000 (average ₡20,900), the early-launch
month earns ₡281,760 less than with ₡20,000 baskets throughout, because the
₡8,000 orders and the free-delivery orders pull it down
([pricing strategy](pricing-strategy.md) §3.3, 24 November 2026).

Two things stand out. A small basket barely pays for its own delivery. And a
basket two and a half times larger contributes only a little more once
shipping is free and the commission rate is lower: the free-shipping threshold
and the electronics rate both need care.

### The payment fee is a pass-through, with two leaks

An earlier version of the fee schedule charged sellers 3.5% for card payments
and 1% for SINPE Móvil, below the gateway prices in the fact sheet. The
schedule now follows the cheaper published gateway: 3.9% plus ₡180 per card
payment (standing for US$0.35 at an assumed ₡515 or so per dollar) and 1.5%
for SINPE Móvil. At the banks' selling rate of 18 November 2026, ₡450 per
dollar, US$0.35 is ₡157.50, so ₡180 is ₡22.50 above the list price
([market research](../research/market-and-costs-2026-11.md) §6.4, read 24
November 2026); owner decision D38 sets the card fee before cards go on. On the ₡20,000 item the seller is charged ₡960 by card or
₡300 by SINPE Móvil, which is what the gateway would charge on that ₡20,000.

So the payment line is designed to break even, not to earn. It still leaks in
two places:

- **Yuntera pays the gateway's percentage on the shipping it collects.** The
  seller's fee is computed on the item; the gateway charges on the whole
  ₡21,500. That is the ₡23 gap between ₡300 charged and ₡323 paid in the table
  above, and about ₡59 on a card payment. It is a real cost of the delivery
  service and is counted as one.
- **The published prices are not a contract.** They are list prices at
  low-to-medium confidence, one gateway also charges a fee per payout to a
  seller, and the fixed fee moves with the exchange rate. Until a gateway
  contract is signed, treat the payment line as break-even at best.

Card payments also trigger withholdings by the acquirer: up to 6% of the net
sale on account of IVA and 2% on account of income tax
([fact sheet, section 1](../research/costa-rica-fact-sheet.md#1-tax-and-iva)).
These are advances on tax, not costs, but they tie up cash, and whose cash
depends on who is the merchant of record. That is a question for the accountant
([open questions](../08-open-questions.md)).

## Cost drivers

| Driver                              | What moves it                                                            | Lever                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Last-mile cost per delivered stop   | Stops per driver-day, first-attempt success rate, distance between stops | Dense zones, map-pin addresses, delivery-day notifications, order cutoff discipline                   |
| Warehouse labour per order          | Units per order, walking distance, errors                                | Location discipline, scanning, batch picking once volume allows                                       |
| Payment processing                  | Method mix, gateway contract                                             | Steer to SINPE Móvil; pass cost through transparently                                                 |
| Refunds, returns, failed deliveries | Listing accuracy, seller quality, promise accuracy                       | Seller score (`packages/core/src/sellers.ts`), conservative promises (`packages/core/src/promise.ts`) |
| Fraud and cash-on-delivery refusals | Order risk rules                                                         | `packages/core/src/risk.ts`: prepayment required for risky cash orders                                |
| Fixed costs                         | Warehouse rent, software, insurance, accounting, the founder's time      | Stay on free tiers; smallest viable warehouse; no hires before the pilot proves demand                |

## Break-even logic

Each order leaves a contribution. Fixed monthly costs divided by that
contribution is the number of orders needed to stop losing money each month.

| Fixed costs per month (assumption) | Contribution per order | Orders per month to break even | Per operating day (26 days) |
| ---------------------------------: | ---------------------: | -----------------------------: | --------------------------: |
|                           ₡750,000 |                 ₡2,334 |                            322 |                          12 |
|                         ₡1,500,000 |                 ₡2,334 |                            643 |                          25 |
|                         ₡1,500,000 |                 ₡1,200 |                          1,250 |                          48 |
|                         ₡3,000,000 |                 ₡2,334 |                          1,286 |                          49 |

Both columns of inputs are assumptions: the fixed-cost levels are illustrative
round numbers, not a budget, and the contribution is the worked order above.
The ₡1,200 row shows what happens if baskets are smaller or delivery costs more
than assumed.

For a month with named people, the launch team (one driver, one warehouse
associate, one sales agent) breaks even at about 585 orders, 22 to 23 a day,
with ₡20,000 baskets, and about 25 a day with mixed baskets
([pricing strategy](pricing-strategy.md) §3.3). The per-order labour lines above
(delivery ₡1,800, picking ₡500, support ₡150) leave out leads, spare drivers,
sales, catalogue and finance staff: with them, payroll per order stays ₡754–₡815
above ₡2,450 even at 1,000 orders a day ([team structure](team-structure.md) §5).
So a budget must carry the overhead roles, or density must exceed 25 stops.

The table hides the hardest part: **a driver-day costs the same whether it
delivers 8 stops or 25.** At 8 stops, the assumed ₡45,000 driver-day is ₡5,625
per stop and every order loses money. The ₡2,300 before IVA in the
[fact sheet, section 7](../research/costa-rica-fact-sheet.md#7-last-mile-and-labour)
is Correos' self-service locker price. Its Pymexpress volume tariff is lower:
₡1,756.19 to ₡2,005.53 before IVA for the first kilo inside the GAM, by
monthly volume, each tier needing prior authorisation from Correos' Dirección
de Pymes, plus ₡1,500 to ₡2,000 for a home pickup (correos.go.cr/tarifas,
read 24 November 2026). One driver at about 25 stops over 26 days is the
451-or-more tier, ₡1,756.19. Against it, an own driver costs the same as
Correos at **about 25 delivered stops a day**: 24.5 with one ₡2,000 pickup a
day, before IVA; about 22 if Yuntera cannot credit Correos' IVA (for the
accountant to confirm); 19.6 at the locker price before authorisation
([go-to-market](go-to-market.md) §6). At this model's own 25 stops, an own
driver only breaks even with Correos; an earlier version of this document said
"roughly 20", from the locker price.

The consequence for the plan: in the pilot, one driver (possibly the founder)
covers the dense core and a carrier takes everything else. Drivers are added
when a zone's daily volume fills a route, not before. See the
[roadmap](../01-product/roadmap.md).

## The three numbers that decide the model

1. **Contribution per order.** Driven by average basket value and the effective
   take rate. If baskets cluster under about ₡10,000, delivery eats the margin
   and the answer is a higher free-shipping threshold, a minimum order, or
   different categories.
2. **Delivered stops per driver-day.** Sets the cost of the largest variable
   line. It is a function of order density per zone and first-attempt success.
3. **Repeat rate: the share of shoppers who order again within 60 days.**
   Acquiring a shopper costs money once; the model only pays if they return.
   A marketplace nobody comes back to cannot be fixed with marketing.

The pilot exists to measure these three. Every figure marked _assumption_ above
should be replaced by a measured value before any decision to spend on growth.
