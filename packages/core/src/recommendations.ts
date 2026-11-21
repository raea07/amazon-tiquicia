/**
 * Item-to-item recommendations from co-purchase data
 * ("quienes compraron esto también llevaron…").
 *
 * For each pair of products bought together we compute:
 *   support    — share of baskets containing both
 *   confidence — P(B in basket | A in basket)
 *   lift       — confidence ÷ P(B): how much more often than chance
 *
 * Ranking by lift alone surfaces obscure coincidences; ranking by confidence
 * alone recommends the bestseller to everyone. The score is lift damped by
 * evidence (pair count), which is the standard compromise.
 *
 * In production this runs as a nightly SQL job over order lines and writes a
 * `product_relations` table; this implementation defines the maths and is what
 * that job is tested against. It needs no personal data: baskets are anonymous
 * sets of product ids.
 */

export interface Relation {
  productId: string;
  relatedId: string;
  pairCount: number;
  support: number;
  confidence: number;
  lift: number;
  score: number;
}

export interface CoPurchaseOptions {
  /** Pairs seen in fewer baskets than this are noise. */
  minPairCount?: number;
  /** Keep only pairs bought together more often than chance by this factor. */
  minLift?: number;
  /** Relations kept per product. */
  topN?: number;
  /** Baskets larger than this (wholesale, scripted) are ignored: they pair everything with everything. */
  maxBasketSize?: number;
}

export function computeCoPurchases(
  baskets: ReadonlyArray<readonly string[]>,
  options: CoPurchaseOptions = {},
): Map<string, Relation[]> {
  const { minPairCount = 3, minLift = 1.2, topN = 12, maxBasketSize = 30 } = options;

  const itemCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  let total = 0;

  for (const raw of baskets) {
    const basket = [...new Set(raw)].sort();
    if (basket.length < 2 || basket.length > maxBasketSize) {
      // Single-item baskets still count toward item frequency and the total.
      if (basket.length === 1 && basket[0]) {
        itemCount.set(basket[0], (itemCount.get(basket[0]) ?? 0) + 1);
        total++;
      }
      continue;
    }
    total++;
    for (const item of basket) itemCount.set(item, (itemCount.get(item) ?? 0) + 1);
    for (let i = 0; i < basket.length; i++) {
      for (let j = i + 1; j < basket.length; j++) {
        const key = `${basket[i]}\u0000${basket[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  const relations = new Map<string, Relation[]>();
  if (total === 0) return relations;

  const push = (productId: string, relatedId: string, pairs: number) => {
    const countA = itemCount.get(productId) ?? 0;
    const countB = itemCount.get(relatedId) ?? 0;
    if (countA === 0 || countB === 0) return;
    const support = pairs / total;
    const confidence = pairs / countA;
    const lift = confidence / (countB / total);
    if (lift < minLift) return;
    // log(1 + pairs) rewards evidence with diminishing returns.
    const score = lift * Math.log1p(pairs);
    const list = relations.get(productId) ?? [];
    list.push({ productId, relatedId, pairCount: pairs, support, confidence, lift, score });
    relations.set(productId, list);
  };

  for (const [key, pairs] of pairCount) {
    if (pairs < minPairCount) continue;
    const [a, b] = key.split("\u0000");
    if (!a || !b) continue;
    push(a, b, pairs);
    push(b, a, pairs);
  }

  for (const [productId, list] of relations) {
    list.sort((x, y) => y.score - x.score || x.relatedId.localeCompare(y.relatedId));
    relations.set(productId, list.slice(0, topN));
  }
  return relations;
}

/**
 * Trending score for "popular ahora": recent sales weighted by recency
 * (exponential decay), so a product selling today outranks one that sold the
 * same amount three weeks ago.
 */
export function trendingScore(dailyUnits: readonly number[], halfLifeDays = 3): number {
  // dailyUnits[0] is today, [1] yesterday, …
  const decay = Math.LN2 / halfLifeDays;
  return dailyUnits.reduce(
    (total, units, daysAgo) => total + units * Math.exp(-decay * daysAgo),
    0,
  );
}
