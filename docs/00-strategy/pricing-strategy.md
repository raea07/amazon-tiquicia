# Pricing strategy proposal

**What it is.** A proposal for what Yuntera charges sellers and shoppers at the pilot and the public launch, written on 24 November 2026. It changes no fee in the code or the database.

**Conclusion 1.** Today's seller fees sit inside the published range for general goods: 8% to 15% commission. Keep them for the pilot. Do not claim Yuntera is cheaper than selling on Instagram. Sell time saved and new buyers. On a ₡20,000 home item kept in the warehouse and paid by SINPE Móvil, the seller receives ₡15,367.

**Conclusion 2 (order break-even).** With a paid driver, an order stops losing money at about 20 delivered stops per driver-day, if the basket is ₡15,000 or more. At 10 stops, almost every order loses money, whatever the commission. This is not the Correos comparison: Correos costs less than an own driver below about 24 to 25 stops (section 3.2).

**Conclusion 3.** Keep the ₡25,000 free-delivery threshold. Use a dated free-delivery window at the public launch, not a lower threshold. Offer the first sellers a written price lock to a fixed date and free set-up help, not a fee cut.

**The month.** With the launch team on salary, the month breaks even at about 24 orders a day with a ₡20,000 basket, and about 27 a day with a realistic mix of baskets. A founder-run pilot at 10 orders a day roughly breaks even, with the founder unpaid (section 3.3).

**What the owner must decide.** Seven numbered questions in [section 7](#7-decisions-for-the-owner): commission, the card fee, the free-delivery threshold, the seller offer, the shopper offer, the storage fee and the notice period.

---

## How to read this document

- **Repository** means the figure is in the code, the database or a document in this repository. The file is named.
- **Verified** means I read it in the source on 24 November 2026. The address is in [Sources](#sources).
- **Research** means the market research of 24 November 2026 read it. I did not re-open that source.
- **Estimate** means arithmetic in this document. **Assumption** means a guess with a range, to be measured in the pilot.
- Dollar figures use **₡449 per US dollar**: the banks' selling rate of 18 November 2026 was ₡450 to ₡452, and the Monex low on 19 November 2026 was ₡444.45 (research, press).
- All amounts are in colones. Item prices and delivery charges include 13% IVA. Seller fees carry 13% IVA on top.
- Statements about law or tax are **for the lawyer or accountant to confirm**, unless `docs/05-security-compliance/compliance-costa-rica.md` already settles them. That document's requirements stand as written.

---

## 1. What the product charges today

The schedule is version `2026-11-assumptions`. Every amount in it is labelled an assumption in the repository. Nothing has been shown to a seller.

Where each number lives:

| Number                                          | Database                                                                     | Code                                                   | Who can change it today                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Commission by category                          | `categories.referral_bps` (migration `20261121080450_catalog_reference.sql`) | `referralBpsByCategory` in `packages/core/src/fees.ts` | A migration only                                    |
| Default commission, ₡150 floor, 13% IVA on fees | `fee_schedules` (migration `20261121080800_finance.sql`)                     | `DEFAULT_FEE_SCHEDULE`                                 | A migration only                                    |
| Fulfilment tiers                                | `fee_fulfillment_tiers` (same migration)                                     | `fulfillmentTiers`                                     | A migration only                                    |
| Payment fee by method                           | `fee_payment_methods` (same migration)                                       | `paymentBpsByMethod`, `paymentFixedMinorByMethod`      | A migration only                                    |
| Delivery charge and free-delivery threshold     | `delivery_zones` (migration `20261121080300_geography_data.sql`)             | Not mirrored in code                                   | Operations staff, in the console (Operación, zones) |

### 1.1 Seller commission

A percentage of the IVA-inclusive item price, charged only when an item sells. A sub-category takes its parent's rate.

| Category                                                | Rate |
| ------------------------------------------------------- | ---: |
| Electrónica, Computación, Celulares, Abarrotes          |   8% |
| Electrodomésticos, Hecho en Costa Rica                  |  10% |
| Hogar, Ferretería, Deportes, Juguetes, Mascotas, Libros |  12% |
| Belleza                                                 |  13% |
| Moda                                                    |  15% |
| Any other category (schedule default)                   |  12% |

A floor of ₡150 per unit applies. The floor never exceeds the item's price.

Every one of the 14 top-level categories has its own rate, and every sub-category inherits its parent's (`20261121080450_catalog_reference.sql`; `private.referral_bps_for_category` in `20261121080400_catalog.sql`). The schedule default applies only to a new top-level category that staff create without a rate. Coffee sits under Abarrotes y café, at 8%. Staff cannot move a product to a category with different fees (`ops_move_category`, `20261121083700_console_catalogue.sql`).

### 1.2 Fulfilment and storage

Charged per unit when the stock ships from a Yuntera warehouse. The smallest tier that fits both weight and longest side applies.

| Tier    | Up to | Longest side | Fee per unit |
| ------- | ----: | -----------: | -----------: |
| Sobre   | 500 g |        30 cm |         ₡900 |
| Pequeño |  2 kg |        45 cm |       ₡1,400 |
| Mediano | 10 kg |        60 cm |       ₡2,400 |
| Grande  | 30 kg |       120 cm |       ₡4,900 |

Larger items cannot be stored. There is **no storage fee**, no listing fee and no monthly fee. A seller who ships from their own premises pays no fulfilment fee. A seller can save a pickup place (`seller_save_location`, `docs/03-data/api-reference.md`), but no driver route collects from it yet: `docs/01-product/scope-by-app.md` puts "Pickups from sellers on the same route" under Later. In the pilot, each parcel a shop packs is arranged with the shop one by one.

### 1.3 Payment fee charged to the seller

| Method           | Rate | Fixed, once per order | Basis in the repository                                                |
| ---------------- | ---: | --------------------: | ---------------------------------------------------------------------- |
| SINPE Móvil      | 1.5% |                     — | A gateway's published price (third-party source)                       |
| Card             | 3.9% |                  ₡180 | 3.9% + US$0.35; ₡180 assumed ₡515 per dollar                           |
| Cash on delivery | 2.0% |                  ₡300 | Assumption: counting, carrying and depositing cash, refused deliveries |
| Bank transfer    | 0.5% |                     — | Assumption, not researched                                             |

The database charges the rate on the items only. Shipping belongs to Yuntera and is never passed to a seller (`docs/04-algorithms/fees-and-settlement.md`). When several sellers share an order, they share the fixed amount in proportion to what each sold.

Fees are worked out when the payment is captured, from the schedule marked active at that moment (`private.post_order_capture` in `20261121080800_finance.sql` calls `private.compute_seller_fees`, which reads `fee_schedules where active`, `20261121082400_fixes.sql`). For cash on delivery, capture happens at the door. The schedule's `effective_from` date is stored but no function reads it.

Cards are not switched on until the open launch in the roll-out proposal (`docs/00-strategy/rollout-plan.md`, decision 1). Until then, the card row does not apply to any order.

### 1.4 What the shopper pays

| Zone                           | Delivery charge |        Free from | Status       |
| ------------------------------ | --------------: | ---------------: | ------------ |
| GAM central (`gam-core`)       |          ₡1,500 | ₡25,000 of items | Active       |
| GAM extendida (`gam-extended`) |          ₡2,000 | ₡35,000 of items | Active       |
| Resto del país (`national`)    |          ₡3,900 |             None | Switched off |

Item prices are set by the seller and include IVA. One delivery charge applies per order, however many sellers it has. The threshold compares the items total with `>=`: a basket of exactly ₡25,000 travels free (`20261121081000_checkout.sql`). There is no surcharge for any payment method. There are **no discount codes**: `orders.discount_minor` exists and is always zero.

Cash on delivery is refused above ₡150,000 today (a setting staff can change, `docs/08-open-questions.md` question 59). The roll-out proposal recommends ₡50,000 for the pilot (its decision 2). Read the setting on the day before printing any limit.

### 1.5 Refunds: who bears what

From `docs/04-algorithms/fees-and-settlement.md` and decision 43 (`STATUS.md`):

| Event                                                        | Shopper gets back               | Seller                                                                                    | Yuntera                                             |
| ------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Cancelled before the parcel leaves                           | Everything                      | Nothing charged                                                                           | Nothing kept                                        |
| Item returned                                                | The item's price                | Gives back what it was paid for the unit; **keeps paying** the payment and warehouse fees | Gives back its commission and that commission's IVA |
| Parcel came back, nobody ever went to the door               | Item and delivery charge        | As above                                                                                  | Refunds the delivery charge                         |
| Delivery attempted, or another parcel of the order delivered | Item; the delivery charge stays | As above                                                                                  | Keeps the delivery charge                           |

Example from that document: a ₡20,000 warehouse item paid by SINPE Móvil and returned leaves the seller ₡1,921 out of pocket (₡1,400 warehouse fee, ₡300 payment fee, ₡221 IVA on them).

**This split is an engineer's rule, not a decision.** Whether a seller may bear fees on a withdrawal the law grants the shopper, and who pays when Yuntera damaged the item, are open questions 30 and 32 for the owner and the lawyer. Question 32's working answer is that returns are free for the shopper in the pilot. Refunds are booked; no code sends the money yet.

### 1.6 Three worked orders

The seller's side is the product's own arithmetic (`computeSellerStatement` in `packages/core/src/fees.ts`). Order A's statement and order B's statement match the cases tested in `packages/core/src/fees.test.ts` and listed in `docs/04-algorithms/fees-and-settlement.md`. Order C is new; it uses the same formula and adds up to the céntimo.

The company's costs are not in the product. They come from section 3: delivery at 25 stops per driver-day (₡1,800 a stop), pick and pack ₡500, packaging ₡200, returns allowance ₡120, support ₡150. All are assumptions.

**Order A, small.** One ₡8,000 kitchen item (Hogar, 12%), stored in the warehouse (tier sobre), paid by SINPE Móvil, delivered in GAM central.

| Line                                                               |                                      Amount |
| ------------------------------------------------------------------ | ------------------------------------------: |
| **Shopper pays** (₡8,000 item + ₡1,500 delivery)                   |                               **₡9,500.00** |
| Commission, 12% of ₡8,000                                          |                                     ₡960.00 |
| Fulfilment, sobre                                                  |                                     ₡900.00 |
| Payment fee, 1.5% of ₡8,000                                        |                                     ₡120.00 |
| Fees before IVA                                                    |                                   ₡1,980.00 |
| IVA on fees, 13%                                                   |                                     ₡257.40 |
| **Seller receives**                                                | **₡5,762.60** (fees are 28.0% of the price) |
| Company keeps, before IVA: fees ₡1,980.00 + delivery ₡1,327.43     |                                   ₡3,307.43 |
| IVA collected for Hacienda: ₡257.40 + ₡172.57                      |                                     ₡429.97 |
| Check: ₡5,762.60 + ₡3,307.43 + ₡429.97                             |                                   ₡9,500.00 |
| Company pays: gateway, 1.5% of ₡9,500                              |                                    −₡142.50 |
| Company pays: delivery, pick and pack, packaging, returns, support |                                  −₡2,770.00 |
| **Contribution per order**                                         |                                 **₡394.93** |

**Order B, seller ships: a later case.** One ₡20,000 household item (Hogar, 12%), packed by the seller and collected by a Yuntera driver, paid by card, delivered in GAM central. This order cannot happen in the pilot: driver pickups from sellers are "Later" in `scope-by-app.md`, and cards come at the open launch. It shows what the model looks like once both exist.

| Line                                                                                                                             |                 Amount |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------: |
| **Shopper pays** (₡20,000 + ₡1,500)                                                                                              |         **₡21,500.00** |
| Commission, 12%                                                                                                                  |              ₡2,400.00 |
| Payment fee, 3.9% of ₡20,000 = ₡780, plus ₡180                                                                                   |                ₡960.00 |
| Fees before IVA                                                                                                                  |              ₡3,360.00 |
| IVA on fees                                                                                                                      |                ₡436.80 |
| **Seller receives**                                                                                                              | **₡16,203.20** (19.0%) |
| Company keeps, before IVA: ₡3,360.00 + ₡1,327.43                                                                                 |              ₡4,687.43 |
| IVA collected: ₡436.80 + ₡172.57                                                                                                 |                ₡609.37 |
| Check                                                                                                                            |             ₡21,500.00 |
| Company pays: gateway, 3.9% of ₡21,500 = ₡838.50, plus US$0.35 = ₡157.15                                                         |               −₡995.65 |
| Company pays: delivery stop ₡1,800, a third of a pickup stop ₡600 (assumption: 3 parcels per pickup), returns ₡120, support ₡150 |             −₡2,670.00 |
| **Contribution per order**                                                                                                       |          **₡1,021.78** |

Card acquirers may withhold up to 6% on account of IVA and 2% on account of income tax. That ties up cash, not profit. Whose cash depends on who is the merchant of record: **for the accountant to confirm** (open question 24).

**Order C, large.** One ₡50,000 electronics item (Electrónica, 8%), stored in the warehouse (tier pequeño), paid in cash at the door, delivered free in GAM central.

| Line                                                               |                 Amount |
| ------------------------------------------------------------------ | ---------------------: |
| **Shopper pays** (delivery free above ₡25,000)                     |         **₡50,000.00** |
| Commission, 8%                                                     |              ₡4,000.00 |
| Fulfilment, pequeño                                                |              ₡1,400.00 |
| Payment fee, 2% of ₡50,000 = ₡1,000, plus ₡300                     |              ₡1,300.00 |
| Fees before IVA                                                    |              ₡6,700.00 |
| IVA on fees                                                        |                ₡871.00 |
| **Seller receives**                                                | **₡42,429.00** (15.1%) |
| Company keeps, before IVA                                          |              ₡6,700.00 |
| IVA collected                                                      |                ₡871.00 |
| Check                                                              |             ₡50,000.00 |
| Company pays: no gateway; cash handling **not measured**           |        ₡0.00 + unknown |
| Company pays: delivery, pick and pack, packaging, returns, support |             −₡2,770.00 |
| **Contribution per order, before cash handling**                   |          **₡3,930.00** |

What the three show:

1. The small order barely pays for itself, even at 25 stops a day.
2. At list prices, payment is a loss line on every card order. The seller pays ₡960; the gateway takes ₡995.65, because it also charges on the delivery charge. Section 2.2 explains why the card list price itself is uncertain.
3. Fees take 28% of a ₡8,000 warehouse item and 15% of a ₡50,000 one. Say so to sellers before they list.

**The pilot's typical sale** is between A and C: a ₡20,000 Hogar item kept in the warehouse (pequeño), paid by SINPE Móvil. Fees are ₡2,400 + ₡1,400 + ₡300 = ₡4,100, plus ₡533 IVA. The seller receives **₡15,367** (fees 23.2% of the price). Its contribution is ₡2,335 at 25 stops (section 3.2). This is the figure for the sales pitch.

---

## 2. Benchmarks

### 2.1 Commission

| Who                                                                | Commission                                         | Other fees                                                         | Source                       | Confidence                              |
| ------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------- | --------------------------------------- |
| Amazon United States                                               | Most categories 15%; consumer electronics 8%       | Minimum US$0.30; Professional plan US$39.99 a month                | sell.amazon.com/pricing      | Verified                                |
| Amazon Mexico                                                      | Most categories 15%; electronics and computers 10% | Minimum MXN 8; plan free 12 months, then MXN 75 or MXN 600 a month | vender.amazon.com.mx/precios | Research, verified there                |
| Mercado Libre Mexico                                               | About 8% to 17% (Clásica), 11% to 21.5% (Premium)  | Fixed fee per unit under MXN 299                                   | Seller blogs                 | Research, third party; sources disagree |
| Uber Eats, Costa Rica                                              | 25% to 29% per order, delivery included            | —                                                                  | El Financiero, 15 Jul 2026   | Verified                                |
| PedidosYa, Costa Rica                                              | 25% base, negotiable                               | —                                                                  | Same                         | Verified                                |
| TicoMarket                                                         | 0%                                                 | Membership from ₡2,500 a month                                     | ticomarket.com               | Research, low                           |
| Walmart Marketplace, Pyme Store BAC, Boxful, Correos digital pilot | Not published                                      | Not published                                                      | Research                     | —                                       |
| **Yuntera today**                                                  | **8% to 15%, default 12%**                         | ₡150 floor; no monthly fee                                         | `fees.ts`                    | Repository                              |

**Where Yuntera sits.** Inside the 8% to 15% range for general goods. Its electronics rate (8%) equals Amazon United States and sits below Amazon Mexico (10%). Its seller fees, IVA included, take 15% to 28% of the price (section 1.6), and the shopper pays delivery on top. The delivery apps take 25% to 29% with delivery included. **Do not claim "cheaper than the delivery apps" in general.** It is true for a ₡20,000 warehouse order (23.2%) and false for a ₡8,000 one (28.0%).

### 2.2 Payment

| Who                          | Card            | SINPE Móvil                           | Source                                                                                                 | Confidence     |
| ---------------------------- | --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------- |
| Tilopay                      | 4.25% + US$0.35 | 2% + US$0.35                          | tilopay.com/tarifas; no monthly fee                                                                    | Verified       |
| ONVO                         | 3.9% + US$0.35  | 1.5%; US$3 per payout                 | Repository fact sheet, third-party comparison of 20 Oct 2026; ONVO's page refused the research request | Low to medium  |
| Person-to-person SINPE Móvil | —               | Free within the central bank's limits | Repository fact sheet                                                                                  | Verified there |
| **Yuntera charges sellers**  | 3.9% + ₡180     | 1.5%                                  | `fees.ts`                                                                                              | Repository     |

US$0.35 at ₡449 is ₡157.15. The ₡180 in the code is ₡22.85 above that list price.

Three points the repository already records change the card figures (`docs/research/payments-gateways-costa-rica.md` lines 9, 68–70, 234–237; `docs/06-operations/payments.md`, questions for the lawyer):

1. **A cap on card fees.** The central bank's Reglamento del Sistema de Tarjetas de Pago (published 18 December 2025) caps the local acquiring commission at **1.95%**, all the acquirer's charges included. The central bank lists ONVO and Tilopay as acquirers. Their published 3.9% and 4.25% are above the cap on their face, and how they comply is not public. So 3.9% + US$0.35 may be wrong for Costa Rican cards. **For the lawyer to confirm**, after a written answer from the gateway.
2. **IVA on the gateway's fee.** No price page says whether 13% IVA is added. The research budgets it on top until the gateway confirms. Whether Yuntera can credit it is **for the accountant to confirm**.
3. **A payout fee.** ONVO charges US$3 (₡1,347) per payout: about ₡35,000 a month if paid out every working day, about ₡5,800 if weekly. The tables in section 3 leave it out.

The seller centre tells sellers the payment cost "es lo que cobra el medio de pago y se traslada sin recargo" (passed through without a markup; `apps/seller/src/components/listing-form.tsx`). On the seller's own items, the list cost is 3.9% + ₡157.15, and the seller pays 3.9% + ₡180. Decision 2 resolves this before cards are switched on.

### 2.3 Delivery a seller would otherwise buy

Correos de Costa Rica, Pymexpress volume tariff, GAM to GAM, first kilo, **before 13% IVA**, with prior authorisation by its small-business office (correos.go.cr/tarifas, verified):

| Monthly parcels | First kilo | Each extra kilo |
| --------------- | ---------: | --------------: |
| 5 to 24         |  ₡2,005.53 |       ₡1,061.95 |
| 25 to 200       |  ₡1,962.17 |       ₡1,038.99 |
| 201 to 450      |  ₡1,853.76 |         ₡981.59 |
| 451 or more     |  ₡1,756.19 |         ₡929.92 |

Home pickup costs ₡1,500 for 1 to 3 parcels, ₡1,700 for 4 to 6, ₡1,900 for 7 to 10 and ₡2,000 for 11 or more, before IVA (same page, verified). Whether Correos collects cash on delivery is **not confirmed** (research).

### 2.4 Free-delivery thresholds

| Who                                   | Free from                          | Speed and payment                                                        | Source                                                                         | Confidence            |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------- |
| Amazon Bazaar, Costa Rica             | ₡10,000                            | Two weeks or less; international cards only; free returns within 15 days | El Financiero, article of 9 Nov 2025, read 24 Nov 2026; terms may have changed | Verified, a year old  |
| Amazon, Costa Rica                    | US$35 on eligible orders           | Days to weeks                                                            | Repository fact sheet                                                          | Medium                |
| Mercado Libre Mexico, Chile, Colombia | MXN 299; CLP 19,990; COP 60,000    | —                                                                        | Seller blogs                                                                   | Research, third party |
| **Yuntera today**                     | **₡25,000** (₡35,000 extended GAM) | Next delivery day; SINPE Móvil, card or cash                             | `delivery_zones`                                                               | Repository            |

**Where Yuntera sits.** Its threshold is 2.5 times Amazon Bazaar's. It is faster, takes SINPE Móvil and cash, and has a local claim route. Bazaar's speed and payment terms are the comparison to make, not the threshold.

### 2.5 Storage

Amazon Mexico charges MXN 0.36 per cubic decimetre a month from January to September and MXN 0.53 from October to December (research, verified there). No peso exchange rate was read, so no colón figure is given. Boxful's prices in Costa Rica are not published.

### 2.6 What a seller pays to sell alone

The seller's real alternative is Instagram or WhatsApp, a SINPE Móvil payment and a courier (research §3.5). On a ₡20,000 sale, with the **shopper paying delivery in every row**:

| Route                                                    | Seller's cost, IVA included | Without IVA a registered seller deducts |
| -------------------------------------------------------- | --------------------------: | --------------------------------------: |
| Personal SINPE Móvil, shopper pays the courier           |   ₡0 plus the seller's time |                                      ₡0 |
| Tilopay SINPE Móvil (2% + US$0.35), shopper pays courier |              ₡557.15 (2.8%) |   ₡557.15 (Tilopay's IVA is not stated) |
| Yuntera, warehouse, SINPE Móvil (the pilot case)         |              ₡4,633 (23.2%) |                          ₡4,100 (20.5%) |
| Yuntera, seller ships, card (order B, later)             |           ₡3,796.80 (19.0%) |                          ₡3,360 (16.8%) |

If the seller pays the courier instead, a small seller pays Correos ₡2,266.25 a parcel (5–24 tier, ₡2,005.53 + IVA, with Correos' prior authorisation) plus a home pickup of ₡1,695 with IVA for 1 to 3 parcels. At 3 parcels a pickup, the Tilopay route then costs ₡3,388.40 (16.9%). Without the authorisation, the locker price is ₡2,300 and the seller drives the parcel there.

**On fees alone, Yuntera is not the cheapest route.** Like for like, selling alone costs the seller 0% to 3%; Yuntera costs 17% to 23%. What Yuntera adds is demand, no fake payment receipts, collection and delivery done for the seller, and one place that answers for the delivery. The sales pitch must sell those, with the seller's real payout shown.

---

## 3. Unit economics

### 3.1 Cost figures

| Cost                                    |                                       Figure used | How it was built                                                                                                                                                                               | Status                                 |
| --------------------------------------- | ------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Driver labour per day                   |                                           ₡21,715 | Light-vehicle driver minimum ₡13,523.69 a day, ₡405,710.70 a month (MTSS 2026 list, verified) × 1.3916 for employer charges 26.83%, aguinaldo 8.33% and vacation about 4% (research) ÷ 26 days | Estimate at the legal minimum          |
| Fuel per day                            |                                            ₡6,725 | 100 km at 12 km a litre × ₡807 a litre (November 2026 price, research, press)                                                                                                                  | Assumption on km and consumption       |
| Vehicle, insurance, maintenance, phone  |                          ₡12,000 to ₡20,000 a day | No dealer price or insurance quote found                                                                                                                                                       | Assumption                             |
| **Driver-day**                          |            **₡45,000** (range ₡40,400 to ₡48,400) | Sum of the three; equals the business model's figure                                                                                                                                           | Estimate                               |
| Pick and pack                           |                                     ₡500 an order | Warehouse labourer minimum ₡373,092.30 a month (MTSS, verified) × 1.3916 ÷ 26 ÷ 8 = ₡2,496 an hour; about 12 minutes an order                                                                  | Minutes are an assumption              |
| Packaging                               |                                              ₡200 | `business-model.md`                                                                                                                                                                            | Assumption                             |
| Returns and failed deliveries           |                                              ₡120 | 4% of orders at about ₡3,000 each, `business-model.md`                                                                                                                                         | Assumption                             |
| Support                                 |                                              ₡150 | `business-model.md`; no benchmark for contacts per order found (research)                                                                                                                      | Assumption                             |
| Gateway                                 |             1.5% SINPE Móvil; 3.9% + ₡157.15 card | Section 2.2                                                                                                                                                                                    | Third-party list price                 |
| Customer-service person                 |                                  ₡564,587 a month | Office clerk minimum ₡405,710.70 × 1.3916                                                                                                                                                      | Estimate                               |
| Warehouse worker                        |                                  ₡519,195 a month | ₡373,092.30 × 1.3916                                                                                                                                                                           | Estimate                               |
| Warehouse rent                          |                       ₡449,000 a month for 100 m² | US$10 per m² at ₡449; small spaces not found; industrial listings US$7.25 to 9.00 per m² plus about US$0.85 maintenance (research)                                                             | Assumption, range ₡359,000 to ₡629,000 |
| Software, accounting, insurance, phones | ₡300,000 a month (₡400,000 at the highest volume) | Nothing quoted                                                                                                                                                                                 | Assumption                             |

The 26.83% employer charges already include a 1% reference rate for INS work-risk insurance; the real INS rate varies by activity. An employer with fewer than 5 permanent non-farm workers does not pay the 1.5% INA charge, so the pilot may pay 25.33% (multiplier about 1.377). Both points come from Alegra (updated 7 Oct 2026, research) and are **for the accountant to confirm**. This document keeps 1.3916 everywhere, which slightly overstates pilot labour.

Minimum wages rise 1.70% on 1 January 2027 (MTSS communiqué CP-022-2026, research). The market usually pays more than the minimum; section 3.3 shows the effect of paying 20% more. Fuel prices are set every month; re-read the price before using ₡807. Whether a motorbike courier is a "Mensajero" or a "Conductor de vehículo liviano", and whether couriers are employees, are **for the lawyer or accountant to confirm**. The founder's own pay and marketing are not in the main tables; section 3.3 shows their effect.

### 3.2 When an order stops losing money

Contribution per order: a warehouse order in Hogar (12%), paid by SINPE Móvil, in GAM central, at today's fees. Tier sobre for ₡8,000, pequeño above.

|                  Basket | 10 stops a day | 20 stops | 25 stops | 30 stops |
| ----------------------: | -------------: | -------: | -------: | -------: |
|                  ₡8,000 |        −₡2,305 |     −₡55 |     ₡395 |     ₡695 |
|                 ₡15,000 |          −₡965 |   ₡1,285 |   ₡1,735 |   ₡2,035 |
|                 ₡20,000 |          −₡365 |   ₡1,885 |   ₡2,335 |   ₡2,635 |
|                 ₡24,990 |           ₡234 |   ₡2,484 |   ₡2,934 |   ₡3,234 |
| ₡25,000 (free delivery) |        −₡1,070 |   ₡1,180 |   ₡1,630 |   ₡1,930 |
|                 ₡35,000 |           ₡130 |   ₡2,380 |   ₡2,830 |   ₡3,130 |
|                 ₡50,000 |         ₡1,930 |   ₡4,180 |   ₡4,630 |   ₡4,930 |

The ₡20,000 and ₡8,000 rows at 25 stops match `business-model.md` (₡2,334 and ₡394) to within ₡1 of rounding.

**Break-even basket** (pequeño tier):

| Stops a day | Basket that breaks even, delivery charged | Basket that breaks even, delivery free |
| ----------: | ----------------------------------------: | -------------------------------------: |
|          10 |                                   ₡23,042 |                                ₡33,917 |
|          20 |                                    ₡4,292 |                                ₡15,167 |
|          25 |                                      ₡542 |                                ₡11,417 |
|          30 |              Every basket in tier pequeño |                                 ₡8,917 |

**Break-even commission** on a ₡20,000 basket: 13.8% at 10 stops, 2.6% at 20, 0.3% at 25. On a ₡15,000 basket: 18.4%, 3.4% and 0.4%.

Reading:

1. **Drop density matters more than the commission.** At 10 stops, no commission in the published range saves a ₡15,000 order. At 20 stops, almost any commission does.
2. **The free-delivery threshold creates a dip.** An order of ₡25,000 earns ₡1,304 less than one of ₡24,990. At 10 stops, orders from ₡25,000 to ₡33,917 lose money.
3. **The small order is the weak one.** ₡8,000 breaks even only above about 20 stops. A sobre item under about ₡2,200 still loses money at 30 stops (₡115 on a ₡1,000 item).
4. **A seller-shipped card order (order B, a later case)** loses ₡2,578 at 10 stops and earns ₡422 at 20, because of the pickup stop and the card cost.

**GAM extendida** (active; ₡2,000 charge, free from ₡35,000). Stops there are farther apart, so fewer fit in a day. Same assumptions otherwise:

|                  Basket | 10 stops a day | 15 stops | 20 stops |
| ----------------------: | -------------: | -------: | -------: |
|                 ₡20,000 |            ₡70 |   ₡1,570 |   ₡2,320 |
| ₡35,000 (free delivery) |           ₡130 |   ₡1,630 |   ₡2,380 |

**Own driver or Correos.** Replacing one driver at 22 to 25 stops means 570 to 650 parcels a month, which is Correos' "451 or more" tier (₡1,756.19 before IVA). With a ₡2,000 daily pickup, Correos then costs less than an own ₡45,000 driver-day below about **24 to 25 stops**, before IVA. If Yuntera cannot credit Correos' 13% IVA, the figure falls to about 21 to 22 stops (**for the accountant to confirm**). The volume tariff needs Correos' prior authorisation; before it, the locker price of ₡2,300 gives about 20 stops, plus the drive to the locker. The business model's "about 20 stops" used that locker price. Correos does not check the delivery code, and its cash collection is not confirmed. So Correos suits out-of-zone parcels, not the core promise.

### 3.3 The month

Average order assumed ₡20,000, warehouse, SINPE Móvil, Hogar. The founder is unpaid in every column. Marketing is not included.

The founder-run pilot follows the staffing in the team-structure and go-to-market proposals: the founder drives, packs and answers customers, a backup person covers 8 days a month (₡150,600, team-structure §5), and the warehouse is 20 m². The launch team also follows team structure: one driver, one warehouse associate and one sales agent, with the founder on customer service. A customer-service person joins at about 60 orders a day.

|                                               |                       Pilot, founder-run | Pilot, hired staff |  Early launch |    Full core zone |
| --------------------------------------------- | ---------------------------------------: | -----------------: | ------------: | ----------------: |
| Orders a day (26 days)                        |                                       10 |                 10 |            25 |                60 |
| Orders a month                                |                                      260 |                260 |           650 |             1,560 |
| Stops per driver-day                          |                             10 (founder) |      10 (1 driver) | 25 (1 driver) |    30 (2 drivers) |
| Revenue before IVA                            |                               ₡1,411,132 |         ₡1,411,132 |    ₡3,527,830 |        ₡8,466,791 |
| Per-order costs (gateway, packaging, returns) |                                 ₡167,050 |           ₡167,050 |      ₡417,625 |        ₡1,002,300 |
| Drivers                                       | Fuel ₡174,850; vehicle ₡312,000–₡520,000 |         ₡1,170,000 |    ₡1,170,000 |        ₡2,340,000 |
| Warehouse workers                             |                          Backup ₡150,600 |       ₡519,195 (1) |  ₡519,195 (1) |    ₡1,038,390 (2) |
| Sales agent                                   |                             ₡0 (founder) |       ₡0 (founder) |      ₡584,132 |          ₡584,132 |
| Customer service                              |                             ₡0 (founder) |       ₡0 (founder) |  ₡0 (founder) |          ₡564,587 |
| Rent                                          |                          ₡89,800 (20 m²) |  ₡449,000 (100 m²) |      ₡449,000 | ₡898,000 (200 m²) |
| Software, accounting, insurance               |                                 ₡300,000 |           ₡300,000 |      ₡300,000 |          ₡400,000 |
| **Result for the month**                      |                   **₡8,800 to ₡216,800** |    **−₡1,194,113** |   **₡87,878** |    **₡1,639,382** |
| **Per order**                                 |                          **₡34 to ₡834** |        **−₡4,593** |      **₡135** |        **₡1,051** |

Staff costs here replace the per-order pick, pack and support figures of section 3.2, so nothing is counted twice. The sales agent is Agente de ventas ₡419,755.80 × 1.3916 (MTSS 2026 list; team structure rounds it to ₡584,100). The founder-run vehicle line is the 3.1 assumption for vehicle, insurance and phone × 26 days. The go-to-market lean budget (₡450,000 to ₡942,000 a month, its §9) shows cash out without revenue; this table nets the revenue. Use one warehouse size per stage: 20 m² in the pilot, 100 m² from the launch.

What moves the result at early launch (650 orders):

| Change                                                                                            | Result for the month | Break-even                          |
| ------------------------------------------------------------------------------------------------- | -------------------: | ----------------------------------- |
| As above, ₡20,000 basket                                                                          |              ₡87,878 | 632 orders, 24 a day                |
| ₡15,000 basket                                                                                    |            −₡302,120 | 723 orders, 28 a day                |
| ₡30,000 basket (delivery free)                                                                    |              ₡19,673 | 646 orders, 25 a day                |
| Mixed baskets: 30% at ₡8,000, 40% at ₡20,000, 30% at ₡35,000 (70% under ₡25,000; average ₡20,900) |            −₡193,882 | 695 orders, 27 a day                |
| Wages 20% above the minimum (driver labour, associate, sales agent)                               |            −₡245,705 | 702 orders, 27 a day                |
| Each ₡500,000 a month of founder pay or marketing                                                 |            −₡412,122 | about 105 more orders, 4 more a day |

- A mix of baskets with a higher average earns less than one ₡20,000 basket. The ₡8,000 orders and the free-delivery orders both pull it down.
- **Cash timing.** On SINPE Móvil, the gateway pays out the next working day and sellers are paid from 10 days after delivery (`STATUS.md`). So Yuntera holds sellers' money for about two weeks. That money is the sellers', not working capital; whether holding it needs SUGEF registration is **for the lawyer to confirm** (payments research, point c). The cash Yuntera needs is the sum of its monthly losses and one-off costs until the month breaks even. Card withholdings (section 1.6) add to it from the open launch.
- Every figure rests on the assumptions in section 3.1. The pilot must replace them.

---

## 4. The proposal

### 4.1 Launch prices

| Fee                     | Proposal for the pilot and the launch                                     | Reason                                                                                |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Commission by category  | **Keep the table** (decision 1)                                           | Inside the published range; density, not commission, decides the margin               |
| ₡150 floor              | Keep                                                                      | Covers handling on very cheap items                                                   |
| Fulfilment tiers        | Keep ₡900 / ₡1,400 / ₡2,400 / ₡4,900                                      | Sobre covers its ₡700 of pick, pack and packaging; time the real minutes in the pilot |
| Storage                 | None in the pilot (decision 6)                                            | A seller who is testing should not pay for standing still                             |
| SINPE Móvil fee         | Keep 1.5%                                                                 | Equals ONVO's SINPE Móvil price as a third party reports it; confirm in the contract  |
| Card fee                | **Set from the gateway's written answer before cards go on** (decision 2) | The 1.95% cap may make 3.9% wrong, and the seller centre promises no markup           |
| Cash on delivery        | Keep 2.0% + ₡300 to the seller; nothing extra for the shopper             | Measure refusals and deposit trips before changing it                                 |
| Delivery charge         | Keep ₡1,500 central, ₡2,000 extended                                      | Already below the cost of a stop at 25 stops (₡1,327 before IVA against ₡1,800)       |
| Free-delivery threshold | **Keep ₡25,000 and ₡35,000** (decision 3)                                 | Lowering it loses about ₡1,305 on every order in between                              |
| Notice of a fee change  | 30 days (decision 7)                                                      | `pricing-and-fees.md` already proposes it                                             |

### 4.2 Introductory offers

**For the first sellers (decision 4).** Recommended:

1. **A written price lock to a fixed date.** For a seller who joins before the public launch, today's fees do not rise before a calendar date the owner prints in the text (for example, 6 months after the planned launch). A printed date can be checked; "6 months from the launch" cannot, because the launch date is an estimate. A lower fee always applies.
   - **What the lock means in the product.** The engine has one schedule for all sellers and no per-seller rates. So the lock freezes the whole public schedule until that date, for every seller.
   - **What it excludes.** The lock text names the storage fee for slow stock (decision 6) as excluded, with 30 days' notice. Otherwise a storage fee at the launch would break the lock.
   - **For the lawyer to confirm:** the lock wording.
2. **Free set-up help.** Staff photograph and list the seller's first 20 products. The seller brings the first stock to the warehouse; a driver pickup is not built. The cost is staff time; no code changes.
3. **No fee cut.** A 4-point commission cut costs ₡800 an order on a ₡20,000 basket: ₡520,000 a month at early launch, which turns its result negative. The engine has no per-seller rates, and a rebate by hand in the ledger is not allowed.

**For shoppers (decision 5).** Recommended:

1. **In the closed pilot, charge delivery as normal.** The pilot must measure whether the charge stops a purchase (`pricing-and-fees.md`). Free delivery would hide the answer.
2. **At the public launch, free delivery on every order in the served cantons for 14 days**, with stated start and end dates. The served cantons are those switched on by then under the roll-out plan, not necessarily all of GAM central. The offer names them.
3. **How staff switch it on.** The zone's threshold cannot be set to ₡0; the lowest the console accepts is ₡1 (`ops_update_zone`, `20261121084000_console_operations.sql`). The workable setting is a delivery fee of ₡0 with the threshold empty. The cart then shows "Gratis", but the product page reads "Envío ₡0." (`apps/web/src/app/p/[slug]/page.tsx`). Before the launch, a developer changes that line to read "Envío gratis", and staff check the page with the setting on a test zone. Nothing ends the window automatically: staff set the fee and threshold back on the end date.
4. Cost, estimated: 25 orders a day, 70% under ₡25,000 (assumption), ₡1,305 each, for 14 days = about **₡320,000**.
5. A first-order discount code needs development first: discounts are not modelled, and their IVA and invoice treatment is **for the accountant to confirm**.

This is the one decision on a shopper launch offer. The marketing pack's posts and flyer follow its answer.

How offers end: each offer names its end date in its own text. The owner names one person to make the change on that date, and checks it in the console audit trail (`/auditoria`) the next day.

### 4.3 What to charge later, and what must be true first

| Revenue                                                  | When                       | What must be true first                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage fee for slow stock                               | Public launch              | Measured cost per shelf space; a built charge (not built today); 30 days' notice; a free period of at least 90 days; named as excluded in the price-lock text             |
| Sponsored results                                        | Roadmap phase 3            | Enough searches per category to sell; labelled "Patrocinado"; ranking rules published; checked against Ley 10946 (in force from about June 2027) by the lawyer; not built |
| Seller subscription (lower commission for a monthly fee) | After the launch           | Sellers with steady monthly sales; a benefit worth paying for; Amazon charges US$39.99 a month (verified) as a reference; not built                                       |
| Shopper membership (free delivery for a monthly fee)     | After repeat rate is known | 60-day repeat rate measured; order frequency known (`business-model.md`); not built                                                                                       |
| Delivery outside the GAM at cost plus handling           | Roadmap phase 4            | A carrier contract; the Correos small-business authorisation                                                                                                              |
| Paid services: photos, inbound pickup, return handling   | Any time after the pilot   | Measured staff minutes per service; a price list sellers can read                                                                                                         |

Storage example, for scale only: 100 m² at ₡449,000 a month with about 120 m³ of shelf space costs about ₡3,742 per m³ a month. A 10-litre box then costs about ₡37 a month to store. The fee's purpose is to clear dead stock, not to earn.

### 4.4 Showing prices: the law

From `docs/05-security-compliance/compliance-costa-rica.md` (settled there) and the regulation read by the research (Decreto 37899-MEIC, consolidated text of 7 January 2026):

1. **Total price before paying.** The shown price includes taxes, delivery and every charge, with a breakdown. The product already shows the delivery charge on the product page and itemises the checkout. Settled in the compliance document.
2. **Nothing pre-ticked.** A review step comes before the pay button. Settled.
3. **Promotions** must state how long they last and guarantee the stock. A limited quantity must be stated. What an advert promises is enforceable (art. 55 b, i, j; research).
4. **A former price** shown beside a sale price must be real. MEIC's June 2026 inspection found adverts without the former price or benefit, without dates and without stock (31% of 26 adverts broke a rule; research).
5. **Prices in colones.** MEIC flagged prices in dollars without the exchange rate. Yuntera stores and shows colones only.
6. **No terms tied to a payment method** without the lawyer's view. MEIC flagged conditions tied to a payment method. A "pay with SINPE Móvil and save" offer is **for the lawyer to confirm** first.
7. **Statistics in adverts** need identified, checkable sources (art. 55 g). Do not print a market-share figure.
8. **"Garantía"** may be used only for terms better than the legal warranty, and the advert must say what they are (art. 55 h).
9. **Ley 10946** (from about June 2027) adds advertising transparency and bans manipulative design. The research already lists it.

### 4.5 Showing prices: what to do

No Costa Rican study of price perception was found. These are common retail practices. Test each one in the pilot.

| Practice                             | Proposal                                                     | Needs development?                                                       |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Show what is left for free delivery  | Yes: a true amount is information, not pressure              | Yes: the cart shows only "Envío" and "Gratis" today (`carrito/page.tsx`) |
| Sale prices ending in 990            | The seller's choice; Yuntera's own fees stay round numbers   | No                                                                       |
| Seller centre shows the payout first | Yes: "Usted recibe" before the fee lines                     | Yes: the listing form puts it last today (`listing-form.tsx`)            |
| Fees as a share of the price         | Show the share for the seller's own product before they list | Yes: the form shows amounts, not a share                                 |
| Delivery charge on the product page  | Keep, as today                                               | No                                                                       |
| Countdown clocks, "only 2 left"      | Only when true, with the real end date or stock              | Not built; build only with real data behind it                           |

Words for customers (Spanish uses the product's money format):

| Where                     | Español (usted)                                                                                                                                                                                           | English                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cart, below the threshold | Le faltan ₡6 500 para que el envío sea gratis.                                                                                                                                                            | You are ₡6 500 away from free delivery.                                                                                                                                                             |
| Launch offer banner       | Envío gratis en todos los pedidos a [cantones] del [fecha de inicio] al [fecha de fin]. Sin monto mínimo. Vea los cantones incluidos: [enlace].                                                           | Free delivery on every order to [cantons] from [start date] to [end date]. No minimum. See which cantons are included: [link].                                                                      |
| Seller pitch              | Si vende un artículo de hogar de ₡20 000, lo guardamos en nuestra bodega y el cliente paga con SINPE Móvil, usted recibe ₡15 367. Antes de publicar le mostramos lo que recibe en su categoría.           | If you sell a ₡20 000 home item, we keep it in our warehouse and the customer pays by SINPE Móvil, you receive ₡15 367. Before you list, we show you what you receive in your category.             |
| Seller price lock         | Si se une antes del [fecha], sus tarifas no suben antes del [fecha fija]. Si bajan, usted paga la tarifa más baja. No incluye un cargo por almacenaje prolongado, que se anunciaría con 30 días de aviso. | If you join before [date], your fees do not rise before [fixed date]. If they fall, you pay the lower fee. This does not include a charge for long storage, which would be announced 30 days ahead. |
| Fee change notice         | Sus tarifas cambian el [fecha]. Los pedidos pagados antes de esa fecha conservan las tarifas actuales. Un pedido contra entrega se cobra con la tarifa del día en que se entrega.                         | Your fees change on [date]. Orders paid before that date keep the current fees. A cash-on-delivery order is charged at the fee of the day it is delivered.                                          |

The seller figure ₡15 367 is the pilot's typical sale (section 1.6): Hogar, tier pequeño, SINPE Móvil at 1.5%. It changes by category: a Moda seller receives less, an Electrónica seller more. `pricing-and-fees.md` says to quote sellers a range until a gateway is contracted; at a 2% SINPE Móvil rate, the same sale pays ₡15 254. So print "₡15 254 a ₡15 367" until the contract, or the single figure after it. If fees change, the line changes. The price-lock and launch-window wording are **for the lawyer to confirm**.

---

## 5. What changing a price takes

| To change                                                        | Where                                                           | How                                                                                                                                     | Checks                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A commission rate                                                | `categories.referral_bps`                                       | A new migration; the same rate in `referralBpsByCategory` in `fees.ts`                                                                  | No parity test covers category rates today (see "Needed elsewhere")                                          |
| Default commission, floor, fulfilment tiers, payment fees        | `fee_schedules`, `fee_fulfillment_tiers`, `fee_payment_methods` | A new migration adding a schedule with a new version, switched active; `DEFAULT_FEE_SCHEDULE` changed in the same commit                | The parity test in `packages/core/src/cr/compliance.test.ts`; `fees.test.ts`; `supabase/tests/040_money.sql` |
| Delivery charge or threshold                                     | `delivery_zones`                                                | Console, Operación, "Zonas de entrega" (`/operacion`), the zone's edit form (operations staff, `ops_update_zone`); takes effect at once | Audited; orders already placed keep their charge                                                             |
| Expected gateway cost (for reconciliation, not what sellers pay) | `gateway_expected_fees`                                         | Console, Cobros, Ajustes (administrator, with a reason)                                                                                 | Audited                                                                                                      |

What happens after a seller-fee change:

1. Offers whose price no longer covers the fees are paused, and each shop is told the minimum price. Staff see them at `/tarifas` in the console.
2. Orders already paid keep their statement. `seller_order_fees` is written once, at capture, and never recomputed. A cash-on-delivery order is captured at the door, so one placed before the change and delivered after it pays the new fees.
3. A new schedule takes effect when the migration that marks it active is applied, whatever its `effective_from` says. Apply that migration on the announced date.
4. The documents to update: `docs/01-product/pricing-and-fees.md`, `docs/04-algorithms/fees-and-settlement.md`, `docs/00-strategy/business-model.md`, `docs/03-data/api-reference.md` if a function changes, and `STATUS.md`.

**Must not be done by hand:**

- Editing a fee table in the live database. App roles cannot write these tables (migration `20261121083000_limits.sql`, section 11); a change made directly bypasses review and the parity test.
- Editing a past order's fees or a seller's balance.
- Paying a seller a rebate as a hand-written ledger entry. There is no function for it.
- Changing seller fees during the pilot (open question 11: "announce before the pilot, not during").
- Starting a delivery offer in the console without a named person and a date to end it.

There is no console screen for seller fees, and no database function to change them. `STATUS.md` lists this as not built.

---

## 6. Plan

| Step                                                                                                                                                                             | Who                                    | Done when                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Owner answers the seven questions in section 7                                                                                                                                | Owner                                  | Answers recorded in `docs/02-architecture/decisions.md`                       |
| 2. Show the pilot's typical sale and orders A and C to 10 to 15 target sellers; ask what they net today                                                                          | Owner or the seller-recruitment person | Notes for each seller: accepted, refused, the reason                          |
| 3. Get written quotes: gateway contract rate and its answer on the 1.95% card cap, Correos small-business authorisation, an INS work-risk quote, warehouse rent for 50 to 200 m² | Owner                                  | Quotes filed; section 3.1 updated                                             |
| 4. Payroll quote per role                                                                                                                                                        | Accountant                             | A written quote per role                                                      |
| 5. Confirm the law points in section 4.4 (payment-method offers, free-delivery window, price lock wording)                                                                       | Lawyer                                 | A written answer per point                                                    |
| 6. Point the parity test at the newest fee migration and add category rates to it                                                                                                | Developer                              | The test fails when a category rate differs between SQL and code              |
| 7. During the pilot, record stops per driver-day, minutes per pick and pack, basket values, cash refusals and contacts per order                                                 | Owner (operations lead once hired)     | A weekly sheet with each number                                               |
| 8. After 4 weeks of pilot data, re-run sections 3.2 and 3.3 with measured numbers                                                                                                | Owner with the developer               | This document updated; a new fee schedule proposed only if the numbers say so |
| 9. Announce any new schedule 30 days before it applies, then apply its migration on that date                                                                                    | Owner with the developer               | Message sent to every seller; the migration applied on the announced date     |

---

## 7. Decisions for the owner

1. **Seller commission for the pilot and the launch.**
   - A. Keep today's table, 8% to 15% by category. **(recommended)** It sits inside the published range, and section 3.2 shows density, not commission, decides the margin.
   - B. One flat 10% for every category. Simpler to explain; a ₡20,000 Hogar seller receives ₡452 more, an electronics seller ₡452 less, and the company earns less on Hogar, Belleza and Moda.
   - C. Raise Hogar, Ferretería, Deportes, Juguetes, Mascotas and Libros from 12% to 15%, as Amazon does. Earns ₡600 more on a ₡20,000 Hogar order; the seller receives ₡678 less, and recruitment gets harder. Needs a migration for `categories.referral_bps` and the same rates in `fees.ts`. (Raising the schedule default would change nothing: every category has its own rate.)

2. **The card fee (3.9% + ₡180; cards come at the open launch).** The central bank caps local card acquiring at 1.95%, and the seller centre says the cost passes through "sin recargo" (section 2.2).
   - A. Before cards are switched on, ask the gateway in writing how the 1.95% cap applies and whether IVA is added. Then set the card fee to the contracted cost, with the fixed part at or below the dollar amount at that day's rate. **(recommended)** Cards are not in the pilot, so waiting costs nothing, and it keeps the seller centre's "sin recargo" true.
   - B. Keep 3.9% + ₡180 and change the seller-centre wording to say the fixed part is rounded up to cover exchange-rate moves. Needs a small change to the seller form and the lawyer's view on the wording.
   - C. Lower the fixed part now to ₡157 (US$0.35 at ₡449). The seller receives ₡26 more per card order (₡23 plus its IVA); at list prices the company loses ₡58.65 per card order instead of ₡35.65.

3. **Free-delivery threshold in GAM central (₡25,000; Amazon Bazaar used ₡10,000 in November 2025; check its current page before answering).**
   - A. Keep ₡25,000; compete on next-day delivery, SINPE Móvil, cash and a local claim route. **(recommended)** At 20 stops a ₡15,000 order earns ₡1,285 with the charge and loses ₡20 without it.
   - B. Lower it to ₡15,000. Shoppers save ₡1,500 on orders of ₡15,000 to ₡24,999; the company loses about ₡1,305 on each.
   - C. Lower it to ₡10,000. Matches Bazaar; a ₡12,000 order at 20 stops goes from ₡925 to −₡380.

4. **Offer for the first sellers.**
   - A. A written price lock to a fixed calendar date (about 6 months after the planned launch), storage fee excluded, plus free set-up of the first 20 products. **(recommended)** It costs staff time, not margin, and needs no development. It freezes the public schedule for everyone until that date.
   - B. Commission 4 points lower for everyone for 90 days. A ₡20,000 seller receives ₡904 more per sale; the company loses ₡520,000 a month at early launch.
   - C. No fulfilment fee for 90 days. A seller receives ₡1,582 more per warehouse sale; the company loses ₡910,000 a month at early launch.

5. **Offer for shoppers.**
   - A. Normal delivery charge in the pilot; free delivery in the served cantons for 14 stated days at the public launch. **(recommended)** The pilot can still measure the effect of the charge, and the launch window costs about ₡320,000. It needs one line changed on the product page first (section 4.2).
   - B. Build a first-order discount code. Targets new shoppers only, but needs development and the accountant's answer on IVA.
   - C. No shopper offer. Costs nothing; the launch has no price message.

6. **Storage fee.**
   - A. None in the pilot; at the launch, a fee on units stored more than 90 days, set at measured cost, with 30 days' notice. **(recommended)** It clears dead stock without charging sellers who are testing. The price-lock text names it as excluded. The charge is not built.
   - B. A fee from the first day. Earns little (about ₡37 a month per 10-litre box) and deters new sellers.
   - C. Never charge; ask sellers to remove stock after 180 days. No revenue, more staff work.

7. **Notice before a fee change.**
   - A. 30 days. **(recommended)** Already proposed in `pricing-and-fees.md`, and long enough for a seller to reprice.
   - B. 60 days. Safer for sellers; slower to fix a wrong fee.
   - C. 15 days. Faster; sellers have little time to react.

---

## Assumptions to verify

| Assumption                                       | Range                                                                                    | How to verify                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Driver-day ₡45,000                               | ₡40,400 to ₡48,400                                                                       | Payroll quote, vehicle quote, fuel log for 4 pilot weeks        |
| Stops per driver-day                             | 8 to 30                                                                                  | Pilot route records                                             |
| Pick and pack 12 minutes an order                | 6 to 20 minutes                                                                          | Time 50 pilot orders                                            |
| Packaging ₡200                                   | ₡100 to ₡400                                                                             | Supplier invoices                                               |
| Returns allowance ₡120 an order                  | ₡60 to ₡300                                                                              | Pilot returns and failed deliveries                             |
| Support ₡150 an order                            | ₡75 to ₡400                                                                              | Contacts per 100 orders in the pilot                            |
| Gateway rates (ONVO list prices)                 | Cards 1.95% (the cap) to 4.25% + US$0.35; SINPE Móvil 1.5% to 2%; IVA on the fee unknown | The signed contract and the gateway's written answer on the cap |
| Exchange rate ₡449                               | ₡440 to ₡520                                                                             | Central bank rate on the contract date                          |
| Rent ₡449,000 for 100 m²                         | ₡359,000 to ₡629,000                                                                     | Three listings near the first sellers                           |
| Software, accounting, insurance ₡300,000 a month | ₡200,000 to ₡500,000                                                                     | Quotes                                                          |
| Average basket ₡20,000                           | ₡8,000 to ₡35,000                                                                        | Pilot order data; no Costa Rican source publishes one           |
| 70% of launch orders under ₡25,000               | 50% to 90%                                                                               | Pilot order data                                                |
| 3 parcels per seller pickup                      | 1 to 10                                                                                  | Pilot pickup records                                            |
| Cash-handling cost                               | Unknown                                                                                  | Pilot: minutes at the door, deposit trips, refusals             |
| Employer multiplier 1.3916                       | 1.36 to 1.45 (about 1.377 with no INA at pilot size)                                     | Accountant; INS work-risk rate by activity                      |
| Founder's vehicle in the pilot                   | ₡12,000 to ₡20,000 a day                                                                 | Insurance quote; fuel and repair log                            |

---

## Sources

**Opened for this document on 24 November 2026**

1. Correos de Costa Rica, Tarifas (Pymexpress volume tariff and home pickup) — https://correos.go.cr/tarifas/
2. Tilopay, Tarifas — https://tilopay.com/tarifas
3. MTSS, Lista de salarios mínimos por ocupación 2026 (Decreto 45303-MTSS) — https://www.mtss.go.cr/temas-laborales/salarios/lista_salarios_minimos_2026.pdf
4. Amazon, Selling on Amazon pricing (United States) — https://sell.amazon.com/pricing
5. El Financiero, Amazon Bazaar launch (published 9 Nov 2025) — https://www.elfinancierocr.com/tecnologia/amazon-contraataca-a-temu-estrena-su-seccion/TIZ3DKNZ4ZH4DMOEZV6XNJQLPI/story/
6. El Financiero, "La rebelión del delivery" (15 Jul 2026) — https://www.elfinancierocr.com/negocios/la-rebelion-del-delivery-los-restaurantes-de-costa/OSEH7STGYRH5VJQTNRWBHKDDDE/story/

**Read by the market research of 24 November 2026, used here as it reports them**

7. Amazon México, Precios — https://vender.amazon.com.mx/precios
8. MTSS, comunicado CP-022-2026 (28 Oct 2026), 2027 increase — https://www.mtss.go.cr/prensa/comunicados/2026/octubre/cp_022_2026.html
9. Alegra, employer charges (updated 7 Oct 2026) — https://blog.alegra.com/costa-rica/salario-minimo-costa-rica/
10. Decreto 37899-MEIC, consolidated print of 7 Jan 2026, arts. 55 and 59 — micitt.go.cr (full address in the research report)
11. Infobae, MEIC digital-advertising inspection (17 Jun 2026) — https://www.infobae.com/costa-rica/2026/06/18/ministerio-de-economia-industria-y-comercio-de-costa-rica-detecto-incumplimientos-en-el-31-de-la-publicidad-digital-por-el-dia-del-padre/
12. El Observador, exchange-rate low (Nov 2026) — https://observador.cr/dolar-marca-nuevo-minimo-historico-en-monex-cae-a-44445/ ; Diario Extra, bank rates — https://www.diarioextra.com/noticia/dolar-cierra-la-semana-en-¢449/
13. Repretel and Diario Extra, November 2026 fuel prices (search results; addresses in the research report)
14. Encuentra24 warehouse listings and Delfino on CBRE's industrial report (May 2026) — https://delfino.cr/2026/05/mercado-industrial-y-logistico-en-costa-rica-mantiene-alta-demanda-y-consolida-su-crecimiento-en-la-region-segun-informe-de-cbre
15. TicoMarket — https://www.ticomarket.com/
16. Mercado Libre Mexico commission and threshold guides (third party; addresses in the research report)

**Repository files**

`packages/core/src/fees.ts`, `packages/core/src/fees.test.ts`, `packages/core/src/money.ts`, `packages/core/src/cr/compliance.test.ts`, `packages/core/src/promise.ts`; migrations `20261121080300_geography_data.sql`, `20261121080400_catalog.sql`, `20261121080450_catalog_reference.sql`, `20261121080800_finance.sql`, `20261121082400_fixes.sql`, `20261121081000_checkout.sql`, `20261121083000_limits.sql`, `20261121083200_followups.sql`, `20261121083700_console_catalogue.sql`, `20261121084000_console_operations.sql`; `apps/ops/src/app/tarifas/page.tsx`, `apps/ops/src/app/cobros/ajustes/page.tsx`, `apps/seller/src/components/listing-form.tsx`, `apps/web/src/app/carrito/page.tsx`, `apps/web/src/app/p/[slug]/page.tsx`; `STATUS.md`; `docs/00-strategy/business-model.md`; `docs/01-product/pricing-and-fees.md`, `roadmap.md`, `scope-by-app.md`; `docs/06-operations/payments.md`; `docs/research/payments-gateways-costa-rica.md`; from the same strategy pack, `docs/00-strategy/go-to-market.md`, `rollout-plan.md` and `team-structure.md`; `docs/04-algorithms/fees-and-settlement.md`; `docs/05-security-compliance/compliance-costa-rica.md`; `docs/08-open-questions.md`; `docs/research/costa-rica-fact-sheet.md`.
