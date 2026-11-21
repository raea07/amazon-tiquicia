# Search ranking

How the storefront decides which products match what a shopper typed, and in
what order to show them. One function serves search results, category pages
and the home-page shelves.

- Specification: `packages/core/src/search.ts`
- Implementation: `public.search_products` and `public.suggest_products` in
  `supabase/migrations/20261121081200_search.sql`
- Tests: `packages/core/src/search.test.ts`, `supabase/tests/060_search.sql`,
  and a parity test that reads the SQL and fails if its constants drift from
  the TypeScript

## Goal

Show the thing the shopper asked for first, then let quality decide among
things that match about equally well. Relevance stays in charge: no amount of
popularity lets a product that barely matches outrank one that plainly does.
And every signal is something a seller can see and change.

## Inputs

| Input                                                                            | Source                                     | State                               |
| -------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------- |
| The query                                                                        | What the shopper typed                     | —                                   |
| Product title, brand, category, description, bullet points                       | `products.search_vector`, built by trigger | Working                             |
| Local vocabulary                                                                 | `search_synonyms` (27 terms seeded)        | Working                             |
| Rating sum and count                                                             | Trigger on reviews                         | Working                             |
| Units sold in the last 30 days                                                   | Nightly job where a scheduler exists       | Working where scheduled             |
| Whether the featured offer ships from a Yuntera warehouse, and its handling days | Listing summary on the product             | Working                             |
| In stock or not                                                                  | Listing summary                            | Working                             |
| Days since first published                                                       | `published_at`                             | Working                             |
| Views in the last 30 days                                                        | `products.views_30d`                       | **Not collected.** Stays 0          |
| Price relative to comparable products                                            | `products.price_index`                     | **Not computed.** Stays 1 (typical) |
| Return rate                                                                      | `products.return_rate`                     | **Not computed.** Stays 0           |

The three signals that are not yet fed do no harm at their defaults, but they
also do nothing: until jobs maintain them, ranking among equally relevant
products is driven by ratings, recent sales, delivery speed and stock.

## Step 1 — understand the query

1. **Fold.** Lowercase and strip accents, so `Cafetera eléctrica` and
   `cafetera electrica` are the same. `ñ` folds to `n` on purpose: shoppers on
   phones and foreign keyboards type `nino`, and the indexed text is folded the
   same way. The query and the document must be folded identically or they stop
   matching.
2. **Expand with synonyms.** The whole query and each of its words are looked
   up in `search_synonyms`; any expansions are added as alternatives. `refri`
   also finds `refrigeradora`; `salveque` also finds `mochila`; `compu` finds
   `computadora` and `laptop`.

## Step 2 — retrieve

A product is a candidate if it is active, has a buyable price, passes the
filters (category, price range, in stock only, made in Costa Rica), and either:

- **matches exactly** — its search document contains the query's words, by
  PostgreSQL full-text search with the accent-insensitive Spanish
  configuration `public.es`; or
- **nearly matches** — a word in its title is similar enough to the query to be
  a typo, by trigram _word_ similarity at a threshold of **0.55**.

Word similarity, not whole-string similarity, is what makes typo tolerance
work. Measured on the demo catalogue, `licuadra` against
"Licuadora Volcán 600 W vaso de vidrio 1,5 L":

| Measure                 | Score | Would match?                      |
| ----------------------- | ----: | --------------------------------- |
| Whole-string similarity |  0.16 | No — a long title drowns one word |
| Word similarity         |  0.67 | Yes                               |

The threshold was set from measured typos, which scored between 0.58 and 0.86,
while unrelated words scored near zero.

**Near matches are a fallback.** They are shown only when fewer than **4**
products match exactly. A shopper who typed a real word that has plenty of
results does not get look-alikes mixed in.

## Step 3 — text relevance

How well the product matches the words, before any business signal.

```
exact match:   0.55 + 0.25 × rank + 0.12 × headMatch + 0.08 × categoryMatch
typo only:     0.50 × wordSimilarity
```

| Term            | Meaning                                                     |
| --------------- | ----------------------------------------------------------- |
| `rank`          | Normalised full-text rank, 0–1                              |
| `headMatch`     | 1 when the title begins with the query                      |
| `categoryMatch` | 1 when the query matches the name of the product's category |

Why the two structural signals exist: term frequency alone cannot tell a
product that _is_ the thing searched for from one that merely mentions it. For
`laptop`, a backpack "con compartimento para laptop" out-scored the laptop
itself on rank alone. Spanish product titles lead with the noun — "Laptop …",
"Café …", "Cargador …" — so a title that begins with the query, in a category
the query names, is almost always the thing itself.

An exact match scores at least 0.55 and a typo-only match at most 0.50, so a
near miss never outranks a hit on text alone.

## Step 4 — quality

```
quality = 0.30 × rating
        + 0.25 × popularity
        + 0.20 × conversion
        + 0.15 × speed
        + 0.10 × price
quality = quality × (1 − 0.3 × min(1, returnRate ÷ 0.25))
quality = quality × 1.1   if first published within the last 21 days
quality = quality × 0.25  if out of stock
```

| Component    | Formula                                                                                            | Reading                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rating`     | `(bayesian − 1) ÷ 4`, where `bayesian = (4.0 × 8 + ratingSum) ÷ (8 + ratingCount)`                 | A product's average is pulled toward 4.0 until it has enough reviews to be trusted. One 5-star review gives 4.11, not 5; 300 reviews averaging 4.7 give 4.68 |
| `popularity` | `log10(1 + unitsSold30d) ÷ 3`, capped at 1                                                         | Logarithmic: about 1,000 units a month reaches the cap; the first sales matter most                                                                          |
| `conversion` | `(unitsSold30d + 1) ÷ (views30d + 50) ÷ 0.15`, capped at 1                                         | Smoothed, so a product with 1 view and 1 sale is not "100%"                                                                                                  |
| `speed`      | `1 ÷ (1 + promiseDays)`                                                                            | See the limit below on what "promise days" is in SQL                                                                                                         |
| `price`      | 0.5 at the typical price; 1 at half the typical price or less; 0 at double or more; linear between | No cliff to game                                                                                                                                             |

The return-rate penalty is the strongest signal that a listing misleads; it
removes up to 30% of quality at a 25% return rate.

The 21-day boost exists so a new listing can earn its first signals instead of
being buried under products that already have them.

## Step 5 — final score

```
final = textRelevance ^ 1.5 × (0.5 + 0.5 × quality)
```

Quality can at most double a result's score. Raising relevance to the power
1.5 widens the gap between a strong and a weak text match, so quality reorders
neighbours rather than leapfrogging tiers.

Ties are broken by product id, so the order is stable from one request to the
next.

When the shopper chooses another sort — price ascending or descending, best
rated (by the same Bayesian average), newest — that key comes first and the
score breaks ties. A page holds at most 60 results.

## Worked example

A shopper searches `laptop`. Two products match exactly.

|                               |                 Laptop Nimbo Libro 14" | Backpack "con compartimento para laptop" |
| ----------------------------- | -------------------------------------: | ---------------------------------------: |
| Full-text rank (illustrative) |                                   0.10 |                                     0.20 |
| Title begins with the query   |                                    yes |                                       no |
| Category matches the query    |                                    yes |                                       no |
| **Text relevance**            | 0.55 + 0.025 + 0.12 + 0.08 = **0.775** |                  0.55 + 0.05 = **0.600** |
| Reviews                       |                                   none |                        10, averaging 4.8 |
| Units sold, 30 days           |                                      0 |                                       40 |
| Views, 30 days                |                                      0 |                                      400 |
| rating                        |                                  0.750 |                                    0.861 |
| popularity                    |                                      0 |                                    0.538 |
| conversion                    |                                  0.133 |                                    0.607 |
| speed (1 promise day)         |                                    0.5 |                                      0.5 |
| price (typical)               |                                    0.5 |                                      0.5 |
| **Quality**                   |                              **0.377** |                                **0.639** |
| Relevance ^ 1.5               |                                  0.682 |                                    0.465 |
| **Final**                     |              0.682 × 0.688 = **0.470** |                0.465 × 0.820 = **0.381** |

The backpack is the more popular, better-reviewed product and mentions the
word more often. The laptop still ranks first, because it is what was asked
for. The figures were computed with `scoreCandidate` and `composeTextScore`;
the rank values are illustrative, the rest follows from the formulas.

On the demo catalogue the same query returns the laptop first and the backpack
second; `licuadra` returns the blender; both are asserted in
`supabase/tests/060_search.sql` and were confirmed in a real browser.

## What it deliberately does not use

- **Who the seller is.** No seller is favoured, including any future retail
  offers by Yuntera itself.
- **Payments to Yuntera.** There is no paid ranking. The specification includes
  `mergeSponsored`, which places labelled sponsored results in fixed slots
  (positions 1, 6 and 12) and never duplicates them organically — but no
  advertising system exists and the SQL function does not call it.
- **Anything about the shopper.** No purchase history, no browsing history, no
  location. Two people typing the same query see the same order.
- **Margin.** Yuntera's commission rate on a category does not enter the score.

## How it is explained to shoppers and sellers

Ley 10946 will require transparency about recommender systems
([fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection)).
The storefront already publishes the rule at `/ayuda#como-ordenamos`: a short
explanation whose percentages are read from `DEFAULT_RANKING` and
`DEFAULT_OFFER_CONFIG` at build time, so the page cannot disagree with the
code. The seller centre should carry the same explanation. A fuller wording,
proposed for when a lawyer reviews the transparency text:

> **Cómo ordenamos los resultados**
>
> Primero mostramos los productos que mejor coinciden con lo que usted
> escribió: los que llevan esas palabras en el nombre y pertenecen a esa
> categoría van antes que los que solo las mencionan.
>
> Entre productos que coinciden por igual, damos preferencia a los que tienen
> mejores reseñas, a los que más se han vendido recientemente, a los que llegan
> más rápido y a los que tienen existencias. Un producto con pocas reseñas no
> le gana a uno con muchas solo por tener una calificación perfecta.
>
> Ningún vendedor puede pagar para aparecer más arriba. Si en el futuro
> mostramos resultados patrocinados, van a estar marcados como
> **Patrocinado**.
>
> No usamos su historial de compras ni su ubicación para ordenar los
> resultados. Puede cambiar el orden a precio, calificación o más recientes
> cuando quiera.

## Known limits

- **Speed is a proxy in SQL.** The specification scores speed from the
  delivery promise for the shopper's zone. `search_products` does not take a
  postal code; it uses 1 day when the featured offer ships from a Yuntera
  warehouse and `1 + handling days` otherwise. Search order is therefore the
  same in every zone.
- **Three signals are not fed** (views, price index, return rate), as listed
  under Inputs.
- **No search log.** Nothing records queries, zero-result searches or clicks,
  so the synonym list cannot yet be curated from evidence and none of the
  metrics below can be measured.
- **One language.** The index is Spanish. An English query matches only where
  the words coincide or a synonym bridges them (`coffee` → `cafe`).
- **Typo tolerance looks only at the title**, and only kicks in below four
  exact matches.
- **Scale.** Full-text and trigram indexes in PostgreSQL are comfortable for a
  catalogue of this size. No load test has been run; see the
  [scaling path](../02-architecture/overview.md#scaling-path).

## What to measure before changing a constant

Add a query log first. Then, per change, compare before and after on:

| Measure                                                                      | Why                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Share of searches with zero results                                          | Missing synonyms, missing catalogue, or tolerance too strict |
| Share of searches where the shopper opens one of the first three results     | Whether the top of the list is right                         |
| Average position of the result that was opened                               | Whether good results are buried                              |
| Searches followed by another search without opening anything                 | The first answer was wrong                                   |
| Share of results shown through typo tolerance, and how often they are opened | Whether 0.55 is too loose or too tight                       |
| Orders per search, by query                                                  | The outcome that matters                                     |

Change one constant at a time, keep the TypeScript and SQL values identical
(the parity test will insist), and write down the before and after.
