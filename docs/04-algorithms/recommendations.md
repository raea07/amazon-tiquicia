# Recommendations

"Quienes compraron esto también llevaron…" and "Popular ahora". Simple,
explainable, and built from baskets rather than from people.

- Specification: `packages/core/src/recommendations.ts`
  (`computeCoPurchases`, `trendingScore`)
- Tests: `packages/core/src/trust.test.ts` (the co-purchase and trending
  sections)
- Storage: `public.product_relations`
- Read by: `get_product`, which returns up to eight related products for the
  product page

**State.** The maths is specified and tested. The table exists and the product
page reads it. **Nothing writes to it**: the nightly job that would compute
relations from real orders is not built. Until it is, the "Productos
parecidos" section of the product page is filled by the fallback described
below.

## Goal

Suggest products that are genuinely bought together, not the bestseller to
everyone and not statistical coincidences. Do it without knowing anything about
the person looking at the page.

## Inputs

Baskets: each order reduced to the set of product ids in it. No user, no
address, no price. The same basket from two different people is
indistinguishable.

## Co-purchase relations

For each pair of products A and B that appear together:

| Quantity   | Formula                                     | Meaning                         |
| ---------- | ------------------------------------------- | ------------------------------- |
| Support    | baskets with both ÷ all baskets             | How common the pair is          |
| Confidence | baskets with both ÷ baskets with A          | Given A, how often B            |
| Lift       | confidence ÷ (baskets with B ÷ all baskets) | How much more often than chance |
| Score      | lift × ln(1 + baskets with both)            | Lift, damped by evidence        |

Ranking by lift alone surfaces obscure coincidences: two products bought
together once, each bought only once, have enormous lift. Ranking by confidence
alone recommends the bestseller to everyone, because everything is often
bought with it. The score multiplies lift by the logarithm of how many times
the pair was actually seen, which is the usual compromise.

Filters, with their defaults:

| Rule                                             | Default     | Why                                                          |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------ |
| A pair must appear in at least this many baskets | 3           | Fewer is noise                                               |
| Lift must be at least                            | 1.2         | Only pairs bought together more often than chance            |
| Relations kept per product                       | 12          | The page shows fewer                                         |
| Baskets larger than this are ignored             | 30 products | Wholesale or scripted orders pair everything with everything |

Single-product baskets create no pairs but still count toward how often a
product is bought, so that lift is measured against real popularity.

Relations are directional: A → B and B → A are scored separately, because
confidence differs. Results are sorted by score, ties by product id.

### Worked example

Computed with `computeCoPurchases` on ten baskets:

```
{café, chorreador}  {café, chorreador}  {café, chorreador, taza}  {café, taza}  {café}
{laptop}  {laptop, mouse}  {laptop, mouse}  {laptop, mouse}  {taza}
```

| From   | To         | Baskets with both | Support |   Confidence |              Lift |             Score |
| ------ | ---------- | ----------------: | ------: | -----------: | ----------------: | ----------------: |
| café   | chorreador |                 3 |    0.30 | 3 ÷ 5 = 0.60 | 0.60 ÷ 0.30 = 2.0 | 2.0 × ln 4 = 2.77 |
| laptop | mouse      |                 3 |    0.30 | 3 ÷ 4 = 0.75 | 0.75 ÷ 0.30 = 2.5 | 2.5 × ln 4 = 3.47 |

Café and taza appear together twice. That is below the minimum of three, so no
relation is created, although taza is bought with café in two of its three
baskets. With so little data the rule prefers to say nothing.

## Trending

```
trending = Σ over days of  units sold that day × e^(−ln 2 × days ago ÷ 3)
```

Recent sales weighted with a half-life of three days. Ten units sold today
score 10; the same ten sold three days ago score 5; six days ago, 2.5. A
product selling now outranks one that sold the same amount three weeks ago.

**State:** specified and tested; not used by any query. The home page's "Lo que
más se está llevando" shelf is the ordinary search function sorted by its
quality score, which uses units sold in the last 30 days with no recency
weighting.

## What the product page shows today

`get_product` returns up to eight related products, in this order:

1. Products with a row in `product_relations` for this product, best score
   first. Today: none.
2. Otherwise, active products with a buyable price from the same category, or
   from a sibling category under the same parent, ordered by units sold in the
   last 30 days.

Each carries a `kind` — `bought_together` when it comes from a relation,
`similar` when it comes from the fallback — so the page can label the section
truthfully. With an empty relations table, everything is `similar` and the
heading is "Productos parecidos".

## What it deliberately does not use

- **The shopper.** No purchase history, no browsing history, no account
  attributes. There is no personalisation of any kind.
- **Location.** Recommendations are the same in every zone.
- **Margin or sponsorship.** A relation cannot be bought and Yuntera's
  commission does not enter the score.
- **Views.** Only completed purchases count; nothing is inferred from
  curiosity.

Because the input is anonymous baskets, this needs no personal data and no
consent beyond what processing an order already requires. That is a design
choice worth keeping: the moment recommendations depend on an individual's
history, the transparency and opt-out duties of Ley 10946 apply with full
force.

## Known limits

- **No job.** As above.
- **It needs volume.** With a minimum of three co-occurrences, a pilot with a
  few hundred orders across a few hundred products will produce almost no
  relations. This is correct behaviour and the reason the fallback exists.
- **Cancelled and refunded orders** must be excluded by the job; the pure
  function takes whatever baskets it is given.
- **Popularity leaks through.** Even with lift, a very popular product pairs
  with many things. If one product starts appearing everywhere, raise the lift
  threshold.
- **No complements versus substitutes.** Two laptops bought together by a
  business look like a "bought together" pair. Same-category pairs may need to
  be filtered or labelled differently.
- **Computed in memory.** The function builds every pair in every basket. That
  is fine as a nightly batch over a year of pilot orders and should become a
  SQL aggregation when baskets are numerous.

## Building the job, when there is data

A scheduled function that:

1. Takes orders from a trailing window (start with 180 days) whose status is
   not pending, cancelled or refunded.
2. Groups product ids by order.
3. Computes the relations with the same formulas — in SQL, tested against the
   TypeScript cases — and replaces the contents of `product_relations` for
   kind `bought_together` in one transaction.

Do not build it until the pilot has enough orders for the output to be
non-empty; an empty job is a job to maintain for nothing. The roadmap lists
recommendations under "Later".

## What to measure

| Measure                                                                | Why                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| Share of product pages with at least three `bought_together` relations | Whether there is enough data to switch the section on |
| Click-through on the section, `bought_together` versus `similar`       | Whether real relations beat the category fallback     |
| Share of orders containing a product reached through the section       | The outcome                                           |
| How many distinct products receive recommendations                     | Whether it concentrates attention on bestsellers      |
