import { describe, expect, it } from "vitest";
import { compareOffers, type OfferCandidate, selectFeaturedOffer, totalForShopper } from "./offers";

const offer = (over: Partial<OfferCandidate> = {}): OfferCandidate => ({
  offerId: "00000000-0000-4000-8000-000000000001",
  sellerId: "s1",
  priceMinor: 2_000_000,
  shippingMinor: 0,
  availableQuantity: 5,
  condition: "new",
  listedAt: "2026-01-01T00:00:00+00:00",
  ...over,
});

const ids = (list: OfferCandidate[]) => list.map((o) => o.offerId);

/**
 * The same cases as block "offer order" of supabase/tests/155_seller_listings.sql,
 * which builds these offers in the database and checks the listing summary
 * and get_product against them. Change one, change both.
 */
const ORDER_CASES: { name: string; offers: OfferCandidate[]; expected: string[] }[] = [
  {
    name: "in stock before out of stock, even when dearer",
    offers: [
      offer({ offerId: "a1", priceMinor: 1_500_000, availableQuantity: 0 }),
      offer({ offerId: "a2", priceMinor: 2_500_000, availableQuantity: 3 }),
    ],
    expected: ["a2", "a1"],
  },
  {
    name: "then the lower price",
    offers: [
      offer({ offerId: "b1", priceMinor: 2_100_000 }),
      offer({ offerId: "b2", priceMinor: 1_990_000 }),
      offer({ offerId: "b3", priceMinor: 2_000_000 }),
    ],
    expected: ["b2", "b3", "b1"],
  },
  {
    name: "then the older offer",
    offers: [
      offer({ offerId: "c1", listedAt: "2026-03-01T10:00:00+00:00" }),
      offer({ offerId: "c2", listedAt: "2026-02-01T10:00:00+00:00" }),
    ],
    expected: ["c2", "c1"],
  },
  {
    name: "then the id, for offers listed in the same instant",
    offers: [offer({ offerId: "d2" }), offer({ offerId: "d1" })],
    expected: ["d1", "d2"],
  },
];

describe("the order of a variant's offers", () => {
  for (const c of ORDER_CASES) {
    it(c.name, () => {
      expect(ids(selectFeaturedOffer(c.offers).ranked)).toEqual(c.expected);
    });
  }

  it("counts shipping when it differs by offer", () => {
    const { featured } = selectFeaturedOffer([
      offer({ offerId: "cheap-item", priceMinor: 1_900_000, shippingMinor: 250_000 }),
      offer({ offerId: "free-ship", priceMinor: 2_000_000, shippingMinor: 0 }),
    ]);
    expect(featured?.offerId).toBe("free-ship");
    expect(totalForShopper(featured as OfferCandidate)).toBe(2_000_000);
  });

  it("keeps the microseconds the database returns", () => {
    const earlier = offer({ offerId: "z9", listedAt: "2026-01-01T00:00:00.000101+00:00" });
    const later = offer({ offerId: "a0", listedAt: "2026-01-01T00:00:00.000102+00:00" });
    expect(compareOffers(earlier, later)).toBeLessThan(0);
  });

  it("compares ids as PostgreSQL orders uuids, whatever their case", () => {
    const a = offer({ offerId: "0A000000-0000-4000-8000-000000000000" });
    const b = offer({ offerId: "09000000-0000-4000-8000-000000000000" });
    expect(ids(selectFeaturedOffer([a, b]).ranked)).toEqual([b.offerId, a.offerId]);
  });

  it("is the same whatever order the offers arrive in", () => {
    const list = [
      offer({ offerId: "e1", priceMinor: 1_000_000, availableQuantity: 0 }),
      offer({ offerId: "e2", priceMinor: 2_000_000 }),
      offer({ offerId: "e3", priceMinor: 1_500_000 }),
      offer({ offerId: "e4", priceMinor: 1_500_000, listedAt: "2025-12-01T00:00:00+00:00" }),
    ];
    const expected = ["e4", "e3", "e2", "e1"];
    expect(ids(selectFeaturedOffer(list).ranked)).toEqual(expected);
    expect(ids(selectFeaturedOffer([...list].reverse()).ranked)).toEqual(expected);
  });
});

describe("the offer shown first", () => {
  it("is nothing when there are no offers", () => {
    expect(selectFeaturedOffer([])).toEqual({ featured: null, ranked: [] });
  });

  it("is the first new offer: a cheaper used one is listed, not shown first", () => {
    const { featured, ranked } = selectFeaturedOffer([
      offer({ offerId: "used", priceMinor: 1_000_000, condition: "used" }),
      offer({ offerId: "new", priceMinor: 2_000_000 }),
    ]);
    expect(featured?.offerId).toBe("new");
    expect(ids(ranked)).toEqual(["used", "new"]);
  });

  it("is an out-of-stock new offer when no offer has stock, so the page can say so", () => {
    const { featured } = selectFeaturedOffer([
      offer({ offerId: "x", availableQuantity: 0, priceMinor: 3_000_000 }),
      offer({ offerId: "y", availableQuantity: 0, priceMinor: 2_000_000 }),
    ]);
    expect(featured?.offerId).toBe("y");
  });

  it("does not change the list it was given", () => {
    const list = [offer({ offerId: "f2", priceMinor: 2 }), offer({ offerId: "f1", priceMinor: 1 })];
    selectFeaturedOffer(list);
    expect(ids(list)).toEqual(["f2", "f1"]);
  });
});
