import {
  daysBetween,
  type OfferCandidate,
  selectFeaturedOffer,
  toCostaRicaTime,
} from "@yuntera/core";
import type { ProductOffer, ProductPage } from "@yuntera/db";

/**
 * Which offer a product page features and in what order the others follow:
 * the same rule as the website (apps/web/src/app/p/[slug]/page.tsx), using
 * the featured-offer scoring in packages/core.
 */
export function toCandidate(offer: ProductOffer, today: string): OfferCandidate {
  return {
    offerId: offer.offer_id,
    sellerId: offer.seller.slug,
    priceMinor: offer.price_minor,
    // Shipping is charged per order, not per offer, so it does not separate offers here.
    shippingMinor: 0,
    availableQuantity: offer.available,
    promiseDays: offer.promise
      ? Math.max(0, daysBetween(today, offer.promise.latest))
      : offer.fulfillment === "platform"
        ? 1
        : 1 + offer.handling_days,
    fulfilledByPlatform: offer.fulfillment === "platform",
    sellerScore: offer.seller.score,
    sellerStatus:
      offer.seller.health === "critico"
        ? "suspended"
        : offer.seller.health === "en_riesgo"
          ? "at_risk"
          : "active",
    condition: offer.condition,
    listedAt: offer.listed_at,
  };
}

export type Sku = ProductPage["skus"][number];

/** The option shown first: the one asked for, else the first in stock, else the first. */
export function chooseSku(product: ProductPage, requested: string | undefined): Sku | undefined {
  return (
    product.skus.find((k) => k.code === requested) ??
    product.skus.find((k) => k.offers.some((o) => o.available > 0)) ??
    product.skus[0]
  );
}

export function rankOffers(offers: ProductOffer[], now = new Date()) {
  const today = toCostaRicaTime(now).date;
  const selection = selectFeaturedOffer(offers.map((offer) => toCandidate(offer, today)));
  const byId = new Map(offers.map((offer) => [offer.offer_id, offer]));
  const featured = selection.featured ? byId.get(selection.featured.offer.offerId) : undefined;
  const others = selection.ranked
    .map((scored) => byId.get(scored.offer.offerId))
    .filter((offer): offer is ProductOffer => offer !== undefined && offer !== featured);
  return { featured, others };
}
