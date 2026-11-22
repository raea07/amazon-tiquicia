import { type OfferCandidate, selectFeaturedOffer } from "@yuntera/core";
import type { ProductOffer, ProductPage } from "@yuntera/db";

/**
 * Which offer a product page shows first and in what order the others follow:
 * the same rule as the website (apps/web/src/app/p/[slug]/page.tsx) and the
 * database, from packages/core/src/offers.ts.
 */
export function toCandidate(offer: ProductOffer): OfferCandidate {
  return {
    offerId: offer.offer_id,
    sellerId: offer.seller.slug,
    priceMinor: offer.price_minor,
    // Shipping is charged per order, not per offer, so it does not separate offers here.
    shippingMinor: 0,
    availableQuantity: offer.available,
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

export function rankOffers(offers: ProductOffer[]) {
  const selection = selectFeaturedOffer(offers.map(toCandidate));
  const byId = new Map(offers.map((offer) => [offer.offer_id, offer]));
  const featured = selection.featured ? byId.get(selection.featured.offerId) : undefined;
  const others = selection.ranked
    .map((candidate) => byId.get(candidate.offerId))
    .filter((offer): offer is ProductOffer => offer !== undefined && offer !== featured);
  return { featured, others };
}
