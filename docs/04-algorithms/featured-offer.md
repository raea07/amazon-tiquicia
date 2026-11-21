# Featured offer

When several sellers offer the same product, the product page shows one offer
by default — the _oferta destacada_ — and lists the others beneath it. Which
offer is featured decides who gets most of the sales, so the rule is a
published formula over facts a seller can change.

- Specification and implementation: `packages/core/src/offers.ts`
  (`selectFeaturedOffer`)
- Where it runs: the storefront's product page, on the offers returned by
  `get_product` (`apps/web/src/app/p/[slug]/page.tsx`)
- Tests: `packages/core/src/offers.test.ts`

## Goal

Feature the offer a reasonable shopper would choose: a competitive total
price, arriving soon, from a seller who delivers what they promise. Explain
the choice, to the shopper and to every seller on the listing.

## Inputs, per offer

| Input                                         | Source                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Price, IVA included                           | The offer                                                                                     |
| Shipping the shopper would pay for this offer | See the note on shipping below                                                                |
| Units available                               | Stock, capped at 10 in what the page receives                                                 |
| Days until the promised delivery date         | [Delivery promise](delivery-promise.md) for the shopper's zone and this offer's handling time |
| Whether it ships from a Yuntera warehouse     | The offer's fulfilment type                                                                   |
| Seller performance score, 0–100, and standing | `sellers.score`, `sellers.health` — see the limit below                                       |
| Condition: new, refurbished, used             | The offer                                                                                     |
| When the offer was created                    | Tie-break only                                                                                |

## Eligibility

An offer is listed but never featured if any of these is true. The first
matching reason is recorded.

| Reason                  | Rule                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `out_of_stock`          | No units available                                                                 |
| `seller_suspended`      | The seller's standing is suspended                                                 |
| `seller_score_too_low`  | Seller score below **60**                                                          |
| `not_new`               | Condition is not new                                                               |
| `price_not_competitive` | Total price more than **15%** above the cheapest offer that passed the rules above |

The price rule is what stops a fast, well-rated seller from being featured at
any price.

## Score

Among all offers (the score is computed for every offer so each seller can see
theirs):

```
score = 0.55 × priceScore
      + 0.25 × speedScore
      + 0.15 × sellerScore
      + 0.05 × (1 if shipped from a Yuntera warehouse, else 0)

priceScore  = cheapest total price ÷ this offer's total price     (1.0 for the cheapest)
speedScore  = 1 ÷ (1 + days slower than the fastest offer)        (1.0 for the fastest)
sellerScore = seller score ÷ 100
```

"Cheapest" and "fastest" are taken over the offers that passed the first four
eligibility rules.

The eligible offer with the highest score is featured. Ties go to the lower
total price, then the older offer, then the offer id — so the result is the
same on every request.

Why warehouse fulfilment earns 5%: it measurably improves delivery
reliability, and any seller can opt into it. It is a small weight on purpose;
it settles near-ties and nothing more.

## Worked example

The demo listing "Audífonos inalámbricos Nimbo Aire", seen from the GAM core on
Saturday 21 November 2026 at 03:42:

|                  |               TecnoCasa |                             Tienda Sendero |
| ---------------- | ----------------------: | -----------------------------------------: |
| Price            |                 ₡19,900 |                                    ₡19,500 |
| Ships from       |       Yuntera warehouse | The seller's own location, 2 handling days |
| Arrives          |      Monday 23 (2 days) |                      Wednesday 25 (4 days) |
| Seller score     |                      92 |                                         90 |
| priceScore       | 19,500 ÷ 19,900 = 0.980 |                                      1.000 |
| speedScore       |                   1.000 |                        1 ÷ (1 + 2) = 0.333 |
| Price × 0.55     |                   0.539 |                                      0.550 |
| Speed × 0.25     |                   0.250 |                                      0.083 |
| Seller × 0.15    |                   0.138 |                                      0.135 |
| Warehouse × 0.05 |                   0.050 |                                          0 |
| **Score**        |               **0.977** |                                  **0.768** |

TecnoCasa is featured although it costs ₡400 more: it arrives two days sooner.
This is what the storefront shows for that product, and Tienda Sendero's offer
appears under "Otras ofertas de este producto" with its own price, date and
buy button.

A second case, showing the price rule. Offer A: ₡10,000, arrives in 3 days,
seller score 80, shipped by the seller. Offer B: ₡12,000, arrives in 1 day,
seller score 95, from a Yuntera warehouse.

|                          |     A |                            B |
| ------------------------ | ----: | ---------------------------: |
| Score                    | 0.753 |                        0.901 |
| Total price vs. cheapest | 1.00× |                        1.20× |
| Eligible                 |   Yes | No — `price_not_competitive` |

B scores higher and is still not featured, because it is 20% dearer than A and
the limit is 15%. A is featured.

## What it deliberately does not use

- **The seller's identity or size.** A new seller with a good score competes on
  the same terms as an established one; only the tie-break looks at age.
- **Any payment to Yuntera.** Featuring cannot be bought.
- **Yuntera's commission on the sale.** A category or seller that earns Yuntera
  more is not favoured.
- **Whose offer it is.** If Yuntera ever sells on its own account, its offers
  go through the same formula.

## How it is explained

To shoppers, on the product page under "Otras ofertas de este producto", with
a link to the help page:

> Destacamos la oferta con la mejor combinación de precio, rapidez de entrega y
> desempeño del vendedor. [Cómo la elegimos](#how-it-is-explained).

The link goes to `/ayuda#como-ordenamos`, which publishes the four weights,
read from the code, and states that the other offers are always shown.

To sellers — proposed for the seller centre, not built yet — each offer should
show its own score, the component costing it the most, and if it is not
eligible, the reason in plain words:

| Reason                  | Text shown to the seller                                            |
| ----------------------- | ------------------------------------------------------------------- |
| `out_of_stock`          | _Sin existencias. Reponga inventario para volver a competir._       |
| `seller_suspended`      | _Su cuenta está suspendida._                                        |
| `seller_score_too_low`  | _Su calificación de desempeño está por debajo de 60._               |
| `not_new`               | _Solo se destacan productos nuevos._                                |
| `price_not_competitive` | _Su precio está más de un 15 % por encima de la oferta más barata._ |

`selectFeaturedOffer` already returns the per-component breakdown and the
reason for every offer, so the seller view needs no new logic.

## Known limits

- **Shipping is not part of the comparison today.** The formula compares total
  price including shipping. Yuntera charges shipping once per order by zone,
  not per offer, so the storefront passes zero shipping for every offer and the
  comparison is on item price alone. If shipping ever differs by offer — a
  seller's own courier, a surcharge for bulky items — the page must pass the
  real amounts.
- **Seller scores are not computed yet.** `sellers.score` is a stored value
  with a default of 90; the job that would recompute it from
  [seller performance](risk-and-trust.md#seller-performance-score) does not
  exist. Until it does, the seller component barely separates offers, and the
  score-below-60 rule never fires on its own.
- **Listings use a simpler rule.** Search results and category pages show one
  price per product. That comes from the listing summary maintained in SQL
  (`private.refresh_product_summary`): the cheapest buyable new offer from an
  active seller. It can differ from the offer the product page features. The
  price shown in a listing is always a price the shopper can actually buy at.
- **It runs in the app, not the database.** The product page computes it on
  each request from the offers it receives. That is fine at this scale; if
  another surface needs the same answer (an API, the cart) it should call the
  same function rather than reimplement it.
- **Per SKU.** Each variant has its own offers and its own featured offer.

## What to measure before changing a weight

| Measure                                                                                     | Why                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Share of orders that buy the featured offer versus another                                  | If shoppers often pick a different one, the formula is not matching their preference |
| Featured offer's on-time rate and defect rate versus the listing's other offers             | The formula should be choosing reliably better offers                                |
| How often the cheapest offer is not featured, and what happens to conversion when it is not | The price weight and the 15% limit                                                   |
| Number of listings where the featured seller changed in a week                              | Stability; frequent flipping frustrates sellers                                      |
| Price movement on multi-seller listings over time                                           | Whether the formula encourages healthy competition or a race that sellers abandon    |

Weights are published. Changing one means changing the help page (automatic)
and telling sellers in advance.
