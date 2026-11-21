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

## Revenue lines

| Line                | Who pays                                       | When it starts                            | Basis                                                                                                               |
| ------------------- | ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Referral commission | Seller                                         | Pilot                                     | Percentage of the item price, by category (code: 8%–15%, default 12%, floor ₡150 per unit)                          |
| Fulfilment fee      | Seller, when stock sits in a Yuntera warehouse | Pilot                                     | Per unit, by size tier (code: ₡900 / ₡1,400 / ₡2,400 / ₡4,900)                                                      |
| Payment fee         | Seller                                         | Pilot                                     | Percentage of the amount collected, by payment method; meant to pass through the gateway's cost, not to earn margin |
| Shipping charge     | Shopper                                        | Pilot                                     | Flat by zone, free above a basket threshold (assumption; see [pricing and fees](../01-product/pricing-and-fees.md)) |
| Storage fee         | Seller, for slow stock                         | Launch                                    | Per unit per month after a free period (assumption)                                                                 |
| Sponsored placement | Seller                                         | Later, once there is traffic worth buying | Cost per click, always labelled _Patrocinado_                                                                       |
| Membership          | Shopper                                        | Later                                     | Flat fee for free delivery; only once order frequency is known                                                      |

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
| Payment fee charged to the seller, 1%                  |       ₡200 | Code (being revised, see below)                                                                                       |
| Shipping paid by the shopper, ₡1,500 less 13% IVA      |     ₡1,327 | Assumption                                                                                                            |
| **Total revenue**                                      | **₡5,327** |                                                                                                                       |
| **Variable cost**                                      |            |                                                                                                                       |
| Payment gateway, SINPE Móvil 1.5% of ₡21,500 collected |       ₡323 | [Fact sheet, section 5](../research/costa-rica-fact-sheet.md#5-payments) (published ONVO rate, low–medium confidence) |
| Last-mile delivery, per delivered stop                 |     ₡1,800 | Assumption: ₡45,000 fully loaded driver-day ÷ 25 delivered stops                                                      |
| Pick and pack labour                                   |       ₡500 | Assumption                                                                                                            |
| Packaging                                              |       ₡200 | Assumption                                                                                                            |
| Allowance for failed deliveries, returns and refunds   |       ₡120 | Assumption: 4% of orders at about ₡3,000 each                                                                         |
| Customer support                                       |       ₡150 | Assumption                                                                                                            |
| **Total variable cost**                                | **₡3,093** |                                                                                                                       |
| **Contribution per order**                             | **₡2,234** | About 11% of the item price                                                                                           |

The seller in this example receives ₡15,480: ₡20,000 less ₡4,000 of fees and
₡520 of IVA on those fees.

### The same order at other basket sizes

Same assumptions; only the item changes.

| Item                                       | Category and tier           | Revenue | Variable cost | Contribution |
| ------------------------------------------ | --------------------------- | ------: | ------------: | -----------: |
| ₡8,000                                     | Hogar, _sobre_              |  ₡3,267 |        ₡2,913 |         ₡354 |
| ₡20,000                                    | Hogar, _pequeño_            |  ₡5,327 |        ₡3,093 |       ₡2,234 |
| ₡50,000, shipping free above the threshold | Electrónica (8%), _pequeño_ |  ₡5,900 |        ₡3,520 |       ₡2,380 |

Two things stand out. A small basket barely pays for its own delivery. And a
basket two and a half times larger contributes almost the same once shipping is
free and the commission rate is lower: the free-shipping threshold and the
electronics rate both need care.

### The payment fee is currently under water

The code charges sellers 3.5% for card payments and 1% for SINPE Móvil. The
gateway rates in the fact sheet are higher: about 3.9% plus US$0.35 per card
transaction and 1.5% for SINPE Móvil at the cheaper of the two gateways found.
On the ₡20,000 order paid by card, the gateway would cost about ₡1,014 (taking
US$0.35 as ₡175 at an assumed ₡500 per dollar) against ₡700 charged. The
engineering workstream is revising the fee schedule to the gateway's actual
cost, including the fixed per-transaction component. Until the gateway contract
is signed, treat the payment line as break-even at best.

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
|                           ₡750,000 |                 ₡2,234 |                            336 |                          13 |
|                         ₡1,500,000 |                 ₡2,234 |                            672 |                          26 |
|                         ₡1,500,000 |                 ₡1,200 |                          1,250 |                          48 |
|                         ₡3,000,000 |                 ₡2,234 |                          1,343 |                          52 |

The table hides the hardest part: **a driver-day costs the same whether it
delivers 8 stops or 25.** At 8 stops, the assumed ₡45,000 driver-day is ₡5,625
per stop and every order loses money. Correos Pymexpress delivers a small
parcel within the GAM for ₡2,300 before IVA
([fact sheet, section 7](../research/costa-rica-fact-sheet.md#7-last-mile-and-labour)).
Under these assumptions an own driver only beats that price above roughly 20
delivered stops per day.

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
