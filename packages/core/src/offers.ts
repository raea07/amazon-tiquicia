/**
 * Featured-offer selection.
 *
 * One catalogue product can be sold by several sellers. The product page shows
 * one offer by default ("oferta destacada") and lists the rest. This module
 * decides which, and — deliberately — explains why.
 *
 * Design rules:
 *  1. The score is a published formula over facts a seller can change: landed
 *     price, delivery speed, their own performance. No hidden inputs.
 *  2. The platform's own retail offers, if it ever has any, compete under the
 *     same formula. `fulfilledByPlatform` earns a bonus because it measurably
 *     improves delivery reliability, and any seller can opt into it.
 *  3. Ties are broken deterministically so the result is stable across requests.
 */

export interface OfferCandidate {
  offerId: string;
  sellerId: string;
  /** Tax-inclusive item price in minor units. */
  priceMinor: number;
  /** Shipping the buyer would pay for this offer to their address. */
  shippingMinor: number;
  availableQuantity: number;
  /** Calendar days until the promised delivery date (0 = today). */
  promiseDays: number;
  fulfilledByPlatform: boolean;
  /** Seller performance score, 0–100 (see sellers/score.ts). */
  sellerScore: number;
  sellerStatus: "active" | "at_risk" | "suspended";
  condition: "new" | "refurbished" | "used";
  /** ISO timestamp the offer was created; older wins a full tie. */
  listedAt: string;
}

export interface OfferWeights {
  price: number;
  speed: number;
  seller: number;
  platformFulfillment: number;
}

export interface OfferSelectionConfig {
  weights: OfferWeights;
  /** Offers costing more than this multiple of the cheapest landed price are not featured. */
  maxLandedPriceRatio: number;
  /** Sellers below this score are listed but never featured. */
  minSellerScore: number;
}

export const DEFAULT_OFFER_CONFIG: OfferSelectionConfig = {
  weights: { price: 0.55, speed: 0.25, seller: 0.15, platformFulfillment: 0.05 },
  maxLandedPriceRatio: 1.15,
  minSellerScore: 60,
};

export type IneligibleReason =
  | "out_of_stock"
  | "seller_suspended"
  | "seller_score_too_low"
  | "not_new"
  | "price_not_competitive";

export interface ScoredOffer {
  offer: OfferCandidate;
  landedMinor: number;
  eligible: boolean;
  ineligibleReason: IneligibleReason | null;
  score: number;
  /** Each component's contribution, already multiplied by its weight. */
  breakdown: { price: number; speed: number; seller: number; platformFulfillment: number };
}

export interface OfferSelection {
  featured: ScoredOffer | null;
  /** Every candidate, best first; ineligible offers sort after eligible ones. */
  ranked: ScoredOffer[];
}

export function selectFeaturedOffer(
  candidates: readonly OfferCandidate[],
  config: OfferSelectionConfig = DEFAULT_OFFER_CONFIG,
): OfferSelection {
  const { weights } = config;
  const weightTotal = weights.price + weights.speed + weights.seller + weights.platformFulfillment;
  if (Math.abs(weightTotal - 1) > 1e-9) {
    throw new RangeError(`Offer weights must sum to 1, got ${weightTotal}`);
  }

  const landed = (o: OfferCandidate) => o.priceMinor + o.shippingMinor;

  // Pass 1: eligibility that does not depend on other offers.
  const baseReason = (o: OfferCandidate): IneligibleReason | null => {
    if (o.availableQuantity <= 0) return "out_of_stock";
    if (o.sellerStatus === "suspended") return "seller_suspended";
    if (o.sellerScore < config.minSellerScore) return "seller_score_too_low";
    if (o.condition !== "new") return "not_new";
    return null;
  };

  const viable = candidates.filter((o) => baseReason(o) === null);
  const cheapest = viable.length ? Math.min(...viable.map(landed)) : 0;
  const fastest = viable.length ? Math.min(...viable.map((o) => o.promiseDays)) : 0;

  const scored: ScoredOffer[] = candidates.map((offer) => {
    const landedMinor = landed(offer);
    let reason = baseReason(offer);
    if (!reason && cheapest > 0 && landedMinor > cheapest * config.maxLandedPriceRatio) {
      reason = "price_not_competitive";
    }

    // Price: 1.0 for the cheapest landed price, falling in proportion.
    const priceScore = landedMinor > 0 ? Math.min(1, cheapest / landedMinor) : 1;
    // Speed: 1.0 for the fastest promise; each extra day costs progressively less.
    const speedScore = 1 / (1 + Math.max(0, offer.promiseDays - fastest));
    const sellerScore = Math.min(100, Math.max(0, offer.sellerScore)) / 100;

    const breakdown = {
      price: weights.price * priceScore,
      speed: weights.speed * speedScore,
      seller: weights.seller * sellerScore,
      platformFulfillment: offer.fulfilledByPlatform ? weights.platformFulfillment : 0,
    };
    const score =
      breakdown.price + breakdown.speed + breakdown.seller + breakdown.platformFulfillment;

    return {
      offer,
      landedMinor,
      eligible: reason === null,
      ineligibleReason: reason,
      score,
      breakdown,
    };
  });

  scored.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.score - a.score ||
      a.landedMinor - b.landedMinor ||
      a.offer.listedAt.localeCompare(b.offer.listedAt) ||
      a.offer.offerId.localeCompare(b.offer.offerId),
  );

  const top = scored[0];
  return { featured: top?.eligible ? top : null, ranked: scored };
}
