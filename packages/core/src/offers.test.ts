import { describe, expect, it } from "vitest";
import { DEFAULT_OFFER_CONFIG, type OfferCandidate, selectFeaturedOffer } from "./offers";

const offer = (over: Partial<OfferCandidate> = {}): OfferCandidate => ({
  offerId: "o1",
  sellerId: "s1",
  priceMinor: 2_000_000,
  shippingMinor: 0,
  availableQuantity: 5,
  promiseDays: 1,
  fulfilledByPlatform: false,
  sellerScore: 90,
  sellerStatus: "active",
  condition: "new",
  listedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("featured offer", () => {
  it("returns nothing when there are no candidates", () => {
    expect(selectFeaturedOffer([])).toEqual({ featured: null, ranked: [] });
  });

  it("prefers the lower landed price, counting shipping", () => {
    const { featured } = selectFeaturedOffer([
      offer({ offerId: "cheap-item", priceMinor: 1_900_000, shippingMinor: 250_000 }),
      offer({ offerId: "free-ship", priceMinor: 2_000_000, shippingMinor: 0 }),
    ]);
    expect(featured?.offer.offerId).toBe("free-ship");
    expect(featured?.landedMinor).toBe(2_000_000);
  });

  it("lets a much faster, platform-fulfilled offer beat a slightly cheaper one", () => {
    const { featured } = selectFeaturedOffer([
      offer({ offerId: "slow", priceMinor: 1_960_000, promiseDays: 5 }),
      offer({ offerId: "fast", priceMinor: 2_000_000, promiseDays: 1, fulfilledByPlatform: true }),
    ]);
    expect(featured?.offer.offerId).toBe("fast");
  });

  it("does not let speed excuse a clearly worse price", () => {
    const { featured, ranked } = selectFeaturedOffer([
      offer({ offerId: "fair", priceMinor: 2_000_000, promiseDays: 3 }),
      offer({
        offerId: "pricey",
        priceMinor: 2_400_000,
        promiseDays: 0,
        fulfilledByPlatform: true,
      }),
    ]);
    expect(featured?.offer.offerId).toBe("fair");
    expect(ranked.find((r) => r.offer.offerId === "pricey")?.ineligibleReason).toBe(
      "price_not_competitive",
    );
  });

  it("never features out-of-stock, suspended, low-score or used offers", () => {
    const { featured, ranked } = selectFeaturedOffer([
      offer({ offerId: "oos", priceMinor: 1_000_000, availableQuantity: 0 }),
      offer({ offerId: "suspended", priceMinor: 1_000_000, sellerStatus: "suspended" }),
      offer({ offerId: "low", priceMinor: 1_000_000, sellerScore: 40 }),
      offer({ offerId: "used", priceMinor: 1_000_000, condition: "used" }),
      offer({ offerId: "ok", priceMinor: 2_000_000 }),
    ]);
    expect(featured?.offer.offerId).toBe("ok");
    const reasons = Object.fromEntries(ranked.map((r) => [r.offer.offerId, r.ineligibleReason]));
    expect(reasons).toEqual({
      ok: null,
      oos: "out_of_stock",
      suspended: "seller_suspended",
      low: "seller_score_too_low",
      used: "not_new",
    });
  });

  it("judges price competitiveness against eligible offers only", () => {
    // The out-of-stock bargain must not disqualify the offer people can actually buy.
    const { featured } = selectFeaturedOffer([
      offer({ offerId: "ghost", priceMinor: 1_000_000, availableQuantity: 0 }),
      offer({ offerId: "real", priceMinor: 2_000_000 }),
    ]);
    expect(featured?.offer.offerId).toBe("real");
  });

  it("returns no featured offer when every candidate is ineligible", () => {
    const { featured, ranked } = selectFeaturedOffer([offer({ availableQuantity: 0 })]);
    expect(featured).toBeNull();
    expect(ranked).toHaveLength(1);
  });

  it("breaks exact ties by listing date, then id", () => {
    const { ranked } = selectFeaturedOffer([
      offer({ offerId: "b", listedAt: "2026-03-01T00:00:00Z" }),
      offer({ offerId: "a", listedAt: "2026-03-01T00:00:00Z" }),
      offer({ offerId: "c", listedAt: "2026-02-01T00:00:00Z" }),
    ]);
    expect(ranked.map((r) => r.offer.offerId)).toEqual(["c", "a", "b"]);
  });

  it("is independent of input order", () => {
    const offers = [
      offer({ offerId: "x", priceMinor: 2_050_000, promiseDays: 1, sellerScore: 95 }),
      offer({ offerId: "y", priceMinor: 2_000_000, promiseDays: 3, sellerScore: 80 }),
      offer({ offerId: "z", priceMinor: 2_100_000, promiseDays: 1, fulfilledByPlatform: true }),
    ];
    const forward = selectFeaturedOffer(offers).ranked.map((r) => r.offer.offerId);
    const backward = selectFeaturedOffer([...offers].reverse()).ranked.map((r) => r.offer.offerId);
    expect(backward).toEqual(forward);
  });

  it("exposes a breakdown that sums to the score", () => {
    const { featured } = selectFeaturedOffer([offer({ fulfilledByPlatform: true })]);
    expect(featured).not.toBeNull();
    if (!featured) return;
    const { price, speed, seller, platformFulfillment } = featured.breakdown;
    expect(price + speed + seller + platformFulfillment).toBeCloseTo(featured.score, 12);
    expect(featured.score).toBeLessThanOrEqual(1);
  });

  it("rejects weights that do not sum to one", () => {
    expect(() =>
      selectFeaturedOffer([offer()], {
        ...DEFAULT_OFFER_CONFIG,
        weights: { price: 0.9, speed: 0.9, seller: 0, platformFulfillment: 0 },
      }),
    ).toThrow(RangeError);
  });
});
