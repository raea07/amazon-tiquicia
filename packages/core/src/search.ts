/**
 * Search: query understanding and result ranking.
 *
 * Retrieval happens in Postgres (full-text + trigram, see the `search_products`
 * SQL function), which returns candidates with a text-relevance score. This
 * module does the two things that are easier to reason about and test in code:
 * normalising what the shopper typed, and re-ranking candidates with business
 * signals. The SQL function applies the same formula so results can be paged
 * in the database; this implementation is the specification it is tested against.
 */

/**
 * Lowercases, strips accents and punctuation, collapses whitespace.
 *
 * "ñ" folds to "n" on purpose: Postgres `unaccent` does the same to the indexed
 * text, and shoppers on phones and foreign keyboards routinely type "nino".
 * Query and document must be folded identically or they stop matching.
 */
export function normalizeQuery(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The most a search box may send. Longer input is cut, not refused, so a
 * pasted paragraph still searches its start. The database applies the same
 * bound before searching (private.bounded_search_text, in the limits
 * migration), so a request made without the app costs no more than one made
 * with it; a unit test keeps the two equal.
 */
export const SEARCH_INPUT_LIMITS = { maxChars: 200, maxWords: 12 } as const;

/** Cuts a query to the first 200 characters, then to its first 12 words. */
export function boundSearchText(input: string): string {
  const chars = Array.from(input).slice(0, SEARCH_INPUT_LIMITS.maxChars).join("").trim();
  if (chars === "") return "";
  return chars.split(/\s+/).slice(0, SEARCH_INPUT_LIMITS.maxWords).join(" ");
}

/**
 * Everyday Costa Rican words mapped to the catalogue's vocabulary. The live
 * list is a database table curated from zero-result searches; this seed covers
 * the obvious ones so day-one search does not feel foreign.
 */
export const SEED_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  compu: ["computadora", "laptop"],
  laptop: ["computadora portatil"],
  tele: ["televisor", "pantalla"],
  pantalla: ["televisor"],
  refri: ["refrigeradora"],
  cel: ["celular", "telefono"],
  abanico: ["ventilador"],
  tenis: ["zapatos deportivos", "zapatillas"],
  jacket: ["chaqueta", "abrigo"],
  sueta: ["sueter", "abrigo"],
  coffee: ["cafe"],
  "coffee maker": ["cafetera"],
  chorreador: ["cafetera"],
  olla: ["cacerola"],
  "olla arrocera": ["arrocera"],
  audifonos: ["auriculares", "headphones"],
  parlante: ["bocina", "altavoz"],
  cargador: ["adaptador"],
  salveque: ["mochila"],
  bulto: ["mochila"],
  foco: ["linterna"],
  bombillo: ["foco", "lampara led"],
  zacate: ["cesped"],
  chapia: ["cortadora de cesped", "motoguadana"],
};

export interface ExpandedQuery {
  normalized: string;
  terms: string[];
  /** Extra phrases to OR into retrieval, at lower weight than the original terms. */
  expansions: string[];
}

export function expandQuery(
  input: string,
  synonyms: Readonly<Record<string, readonly string[]>> = SEED_SYNONYMS,
): ExpandedQuery {
  const normalized = normalizeQuery(input);
  const terms = normalized ? normalized.split(" ") : [];
  const expansions = new Set<string>();

  const whole = synonyms[normalized];
  if (whole) for (const s of whole) expansions.add(s);
  for (const term of terms) {
    const match = synonyms[term];
    if (match) for (const s of match) expansions.add(s);
  }
  for (const term of terms) expansions.delete(term);
  expansions.delete(normalized);

  return { normalized, terms, expansions: [...expansions] };
}

/**
 * Bayesian average: pulls a product's rating toward the catalogue mean until it
 * has enough reviews to be trusted. One 5-star review must not outrank 4.7
 * across 300.
 */
export function bayesianRating(
  ratingSum: number,
  ratingCount: number,
  prior = { mean: 4.0, weight: 8 },
): number {
  if (ratingCount < 0 || ratingSum < 0) throw new RangeError("Rating inputs must be non-negative");
  return (prior.mean * prior.weight + ratingSum) / (prior.weight + ratingCount);
}

/**
 * Text relevance: how well a product matches the words typed, before any
 * business signal is considered.
 *
 * Term frequency alone cannot tell a product that IS the thing searched for
 * from one that merely mentions it: for "laptop", a backpack "con compartimento
 * para laptop" out-scores the laptop itself. Two structural signals fix that,
 * and both are visible to a seller writing a listing:
 *   headMatch     — the title begins with the query (Spanish product titles
 *                   lead with the noun: "Laptop …", "Café …", "Cargador …")
 *   categoryMatch — the query matches the product's category name
 *
 * Exact matches always score at least `exactFloor`; a product found only by
 * typo tolerance scores below that, so a near miss never outranks a hit on
 * text alone.
 */
export const TEXT_RELEVANCE = {
  exactFloor: 0.55,
  rankWeight: 0.25,
  headMatchBonus: 0.12,
  categoryMatchBonus: 0.08,
  fuzzyCeiling: 0.5,
  /** Typo-only matches are shown only when fewer exact matches than this exist. */
  fuzzyFallbackBelow: 4,
} as const;

export interface TextMatch {
  /** True when the product matched the query's words; false when found only by typo tolerance. */
  exact: boolean;
  /** Normalised full-text rank, 0–1. */
  rank: number;
  headMatch: boolean;
  categoryMatch: boolean;
  /** Word-level trigram similarity between the query and the title, 0–1. */
  wordSimilarity: number;
}

export function composeTextScore(m: TextMatch): number {
  const t = TEXT_RELEVANCE;
  if (!m.exact) return t.fuzzyCeiling * clamp01(m.wordSimilarity);
  return (
    t.exactFloor +
    t.rankWeight * clamp01(m.rank) +
    (m.headMatch ? t.headMatchBonus : 0) +
    (m.categoryMatch ? t.categoryMatchBonus : 0)
  );
}

export interface SearchCandidate {
  productId: string;
  /** Text relevance from retrieval, 0–1. */
  textScore: number;
  ratingSum: number;
  ratingCount: number;
  /** Units sold in the trailing 30 days. */
  unitsSold30d: number;
  /** Sessions that viewed the product in the trailing 30 days. */
  views30d: number;
  inStock: boolean;
  /** Calendar days to the best delivery promise for this shopper. */
  promiseDays: number;
  /** Featured price ÷ median price of comparable products; 1 = typical. */
  priceIndex: number;
  /** Share of delivered units returned, 0–1. */
  returnRate: number;
  /** Days since the product was first listed. */
  ageDays: number;
}

export interface RankingWeights {
  rating: number;
  popularity: number;
  conversion: number;
  speed: number;
  price: number;
}

export interface RankingConfig {
  /** Exponent on text relevance. >1 makes relevance dominate; <1 lets quality reorder more. */
  relevanceExponent: number;
  weights: RankingWeights;
  /** Multiplier applied to out-of-stock products. */
  outOfStockPenalty: number;
  /** Listings younger than this get a temporary boost so they can earn signals. */
  newListingDays: number;
  newListingBoost: number;
}

export const DEFAULT_RANKING: RankingConfig = {
  relevanceExponent: 1.5,
  weights: { rating: 0.3, popularity: 0.25, conversion: 0.2, speed: 0.15, price: 0.1 },
  outOfStockPenalty: 0.25,
  newListingDays: 21,
  newListingBoost: 1.1,
};

export interface RankedResult {
  productId: string;
  score: number;
  quality: number;
  components: {
    rating: number;
    popularity: number;
    conversion: number;
    speed: number;
    price: number;
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Price competitiveness from a price index (this price ÷ typical price).
 * Typical price scores 0.5; half the typical price or less scores 1; double or
 * more scores 0. Linear in between, so there is no cliff to game.
 */
export function priceScore(priceIndex: number): number {
  if (!Number.isFinite(priceIndex) || priceIndex <= 0) return 0.5;
  if (priceIndex <= 1) return 0.5 + 0.5 * clamp01((1 - priceIndex) / 0.5);
  return 0.5 * clamp01(2 - priceIndex);
}

/** Scores one candidate. Exposed so it can be unit-tested and mirrored in SQL. */
export function scoreCandidate(
  c: SearchCandidate,
  config: RankingConfig = DEFAULT_RANKING,
): RankedResult {
  const rating = clamp01((bayesianRating(c.ratingSum, c.ratingCount) - 1) / 4);
  // log scale: 0 units → 0, ~1 000 units/month → 1.
  const popularity = clamp01(Math.log10(1 + c.unitsSold30d) / 3);
  // Smoothed conversion (add 1 sale per 50 views as prior), capped at a 15% rate → 1.
  const conversion = clamp01((c.unitsSold30d + 1) / (c.views30d + 50) / 0.15);
  const speed = 1 / (1 + Math.max(0, c.promiseDays));
  const price = priceScore(c.priceIndex);

  const w = config.weights;
  const components = { rating, popularity, conversion, speed, price };
  let quality =
    w.rating * rating +
    w.popularity * popularity +
    w.conversion * conversion +
    w.speed * speed +
    w.price * price;

  // Returns are the strongest signal that a listing misleads; penalise up to 30%.
  quality *= 1 - 0.3 * clamp01(c.returnRate / 0.25);
  if (c.ageDays <= config.newListingDays) quality *= config.newListingBoost;
  if (!c.inStock) quality *= config.outOfStockPenalty;

  const relevance = clamp01(c.textScore) ** config.relevanceExponent;
  // Quality can at most double a result's score: relevance stays in charge.
  const score = relevance * (0.5 + 0.5 * clamp01(quality));
  return { productId: c.productId, score, quality, components };
}

/** Ranks candidates best-first. Stable and deterministic: ties fall back to productId. */
export function rankResults(
  candidates: readonly SearchCandidate[],
  config: RankingConfig = DEFAULT_RANKING,
): RankedResult[] {
  const total = Object.values(config.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-9)
    throw new RangeError(`Ranking weights must sum to 1, got ${total}`);
  return candidates
    .map((c) => scoreCandidate(c, config))
    .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
}

/**
 * Interleaves sponsored results into organic ones at fixed slots. Sponsored
 * items must already be relevant (they come from the same retrieval), are never
 * duplicated, and are returned flagged so the UI can label them "Patrocinado".
 */
export function mergeSponsored<T extends { productId: string }>(
  organic: readonly T[],
  sponsored: readonly T[],
  slots: readonly number[] = [0, 5, 11],
): Array<T & { sponsored: boolean }> {
  const seen = new Set<string>();
  const ads = sponsored.filter((s) => {
    if (seen.has(s.productId)) return false;
    seen.add(s.productId);
    return true;
  });
  // An advertised product appears once, in its paid slot, not again organically.
  const rest = organic.filter((o) => !seen.has(o.productId));
  const slotSet = new Set(slots);

  const out: Array<T & { sponsored: boolean }> = [];
  let ad = 0;
  let org = 0;
  // Ads only ever occupy their slots; once organic results run out we stop,
  // so a page is never padded with a tail of advertising.
  while (org < rest.length) {
    const nextAd = ads[ad];
    if (nextAd && slotSet.has(out.length)) {
      out.push({ ...nextAd, sponsored: true });
      ad++;
      continue;
    }
    const item = rest[org];
    if (!item) break;
    out.push({ ...item, sponsored: false });
    org++;
  }
  return out;
}
