import { describe, expect, it } from "vitest";
import {
  bayesianRating,
  composeTextScore,
  DEFAULT_RANKING,
  expandQuery,
  mergeSponsored,
  normalizeQuery,
  priceScore,
  rankResults,
  type SearchCandidate,
  scoreCandidate,
  TEXT_RELEVANCE,
} from "./search";

const candidate = (over: Partial<SearchCandidate> = {}): SearchCandidate => ({
  productId: "p1",
  textScore: 0.8,
  ratingSum: 0,
  ratingCount: 0,
  unitsSold30d: 20,
  views30d: 800,
  inStock: true,
  promiseDays: 1,
  priceIndex: 1,
  returnRate: 0.02,
  ageDays: 120,
  ...over,
});

describe("query normalisation", () => {
  it("strips accents, case and punctuation, folding ñ like the database does", () => {
    expect(normalizeQuery("  Cafetera  ELÉCTRICA, 12 tazas! ")).toBe("cafetera electrica 12 tazas");
    expect(normalizeQuery("Niño/niña")).toBe("nino nina");
    expect(normalizeQuery("¿¡...!?")).toBe("");
  });

  it("expands everyday Tico words into catalogue vocabulary", () => {
    expect(expandQuery("refri").expansions).toEqual(["refrigeradora"]);
    expect(expandQuery("Abanico de pie").expansions).toContain("ventilador");
    expect(expandQuery("coffee maker").expansions).toContain("cafetera");
  });

  it("does not repeat terms the shopper already typed", () => {
    const q = expandQuery("tele televisor");
    expect(q.terms).toEqual(["tele", "televisor"]);
    expect(q.expansions).toEqual(["pantalla"]);
  });

  it("handles empty and unknown queries", () => {
    expect(expandQuery("")).toEqual({ normalized: "", terms: [], expansions: [] });
    expect(expandQuery("xyzzy").expansions).toEqual([]);
  });
});

describe("bayesian rating", () => {
  it("starts at the prior and converges on the real average", () => {
    expect(bayesianRating(0, 0)).toBe(4.0);
    expect(bayesianRating(5, 1)).toBeCloseTo(4.11, 2);
    expect(bayesianRating(4.7 * 300, 300)).toBeCloseTo(4.68, 2);
  });

  it("ranks many good reviews above one perfect review", () => {
    expect(bayesianRating(4.7 * 300, 300)).toBeGreaterThan(bayesianRating(5, 1));
  });

  it("rejects negative inputs", () => {
    expect(() => bayesianRating(-1, 1)).toThrow(RangeError);
  });
});

describe("price score", () => {
  it("is 0.5 at the typical price and monotonic around it", () => {
    expect(priceScore(1)).toBe(0.5);
    expect(priceScore(0.5)).toBe(1);
    expect(priceScore(0.25)).toBe(1);
    expect(priceScore(1.5)).toBe(0.25);
    expect(priceScore(2)).toBe(0);
    expect(priceScore(3)).toBe(0);
    expect(priceScore(0.75)).toBeGreaterThan(priceScore(1));
  });

  it("is neutral when there is no comparable price", () => {
    expect(priceScore(0)).toBe(0.5);
    expect(priceScore(Number.NaN)).toBe(0.5);
  });
});

describe("ranking", () => {
  it("keeps relevance in charge: quality cannot rescue an irrelevant result", () => {
    const ranked = rankResults([
      candidate({ productId: "relevant", textScore: 0.9, unitsSold30d: 0, views30d: 10 }),
      candidate({
        productId: "popular-but-off-topic",
        textScore: 0.3,
        unitsSold30d: 5_000,
        views30d: 20_000,
        ratingSum: 4.9 * 900,
        ratingCount: 900,
      }),
    ]);
    expect(ranked[0]?.productId).toBe("relevant");
  });

  it("uses quality to order equally relevant results", () => {
    const ranked = rankResults([
      candidate({ productId: "plain" }),
      candidate({
        productId: "loved",
        ratingSum: 4.8 * 250,
        ratingCount: 250,
        unitsSold30d: 400,
        views30d: 6_000,
      }),
    ]);
    expect(ranked.map((r) => r.productId)).toEqual(["loved", "plain"]);
  });

  it("demotes out-of-stock and high-return products", () => {
    const base = scoreCandidate(candidate());
    expect(scoreCandidate(candidate({ inStock: false })).score).toBeLessThan(base.score);
    expect(scoreCandidate(candidate({ returnRate: 0.3 })).score).toBeLessThan(base.score);
  });

  it("rewards faster delivery and better prices", () => {
    const base = scoreCandidate(candidate());
    expect(scoreCandidate(candidate({ promiseDays: 0 })).score).toBeGreaterThan(base.score);
    expect(scoreCandidate(candidate({ promiseDays: 6 })).score).toBeLessThan(base.score);
    expect(scoreCandidate(candidate({ priceIndex: 0.8 })).score).toBeGreaterThan(base.score);
  });

  it("gives new listings a temporary boost so they can earn signals", () => {
    const fresh = scoreCandidate(candidate({ ageDays: 3 }));
    const old = scoreCandidate(candidate({ ageDays: 300 }));
    expect(fresh.quality).toBeCloseTo(old.quality * DEFAULT_RANKING.newListingBoost, 12);
  });

  it("keeps scores within 0–1 for extreme inputs", () => {
    const extremes = [
      candidate({ textScore: 5, unitsSold30d: 1e9, views30d: 0, ratingSum: 5e6, ratingCount: 1e6 }),
      candidate({ textScore: -1, promiseDays: -3, priceIndex: -2, returnRate: 9 }),
    ];
    for (const r of rankResults(extremes)) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic on ties", () => {
    const ranked = rankResults([candidate({ productId: "b" }), candidate({ productId: "a" })]);
    expect(ranked.map((r) => r.productId)).toEqual(["a", "b"]);
  });

  it("rejects weights that do not sum to one", () => {
    expect(() =>
      rankResults([candidate()], {
        ...DEFAULT_RANKING,
        weights: { rating: 1, popularity: 1, conversion: 0, speed: 0, price: 0 },
      }),
    ).toThrow(RangeError);
  });
});

describe("sponsored placement", () => {
  const organic = ["a", "b", "c", "d", "e", "f", "g"].map((productId) => ({ productId }));

  it("puts ads in their slots and labels them", () => {
    const merged = mergeSponsored(organic, [{ productId: "ad1" }, { productId: "ad2" }], [0, 5]);
    expect(merged.map((m) => m.productId)).toEqual([
      "ad1",
      "a",
      "b",
      "c",
      "d",
      "ad2",
      "e",
      "f",
      "g",
    ]);
    expect(merged.filter((m) => m.sponsored).map((m) => m.productId)).toEqual(["ad1", "ad2"]);
  });

  it("shows an advertised product once, in its paid slot", () => {
    const merged = mergeSponsored(organic, [{ productId: "c" }], [0]);
    expect(merged.map((m) => m.productId)).toEqual(["c", "a", "b", "d", "e", "f", "g"]);
    expect(merged.filter((m) => m.productId === "c")).toHaveLength(1);
  });

  it("never pads the end of a page with leftover ads", () => {
    const merged = mergeSponsored(
      [{ productId: "a" }],
      [{ productId: "ad1" }, { productId: "ad2" }, { productId: "ad3" }],
      [0, 1, 2],
    );
    expect(merged.map((m) => m.productId)).toEqual(["ad1", "ad2", "ad3", "a"]);
    expect(mergeSponsored([], [{ productId: "ad1" }])).toEqual([]);
  });

  it("ignores duplicate ads", () => {
    const merged = mergeSponsored(organic, [{ productId: "ad1" }, { productId: "ad1" }], [0, 1]);
    expect(merged.filter((m) => m.sponsored)).toHaveLength(1);
  });
});

describe("text relevance", () => {
  const match = (over: Partial<Parameters<typeof composeTextScore>[0]> = {}) =>
    composeTextScore({
      exact: true,
      rank: 0.5,
      headMatch: false,
      categoryMatch: false,
      wordSimilarity: 1,
      ...over,
    });

  it("ranks the product that IS the thing above one that mentions it", () => {
    // Measured on the demo catalogue for the query "laptop": the backpack that
    // mentions a laptop has the higher raw rank, and must still lose.
    const laptop = match({ rank: 0.5238, headMatch: true, categoryMatch: true });
    const backpack = match({ rank: 0.5455 });
    expect(laptop).toBeGreaterThan(backpack);
    expect(laptop - backpack).toBeGreaterThan(0.15);
  });

  it("uses rank to order matches with the same structure", () => {
    expect(match({ rank: 0.6 })).toBeGreaterThan(match({ rank: 0.1 }));
  });

  it("never lets a typo-only match outscore an exact one", () => {
    const worstExact = match({ rank: 0 });
    const bestFuzzy = match({ exact: false, wordSimilarity: 1 });
    expect(worstExact).toBe(TEXT_RELEVANCE.exactFloor);
    expect(bestFuzzy).toBe(TEXT_RELEVANCE.fuzzyCeiling);
    expect(worstExact).toBeGreaterThan(bestFuzzy);
  });

  it("stays within 0–1 and tops out at exactly 1", () => {
    expect(match({ rank: 9, headMatch: true, categoryMatch: true })).toBeCloseTo(1, 12);
    expect(match({ exact: false, wordSimilarity: -3 })).toBe(0);
    const t = TEXT_RELEVANCE;
    expect(t.exactFloor + t.rankWeight + t.headMatchBonus + t.categoryMatchBonus).toBeCloseTo(
      1,
      12,
    );
  });
});
