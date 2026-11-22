/**
 * Which offer a shopper sees first.
 *
 * One catalogue product can be sold by several shops: each shop has its own
 * offer on a variant (price, stock, how it ships), and the product page,
 * search results and category pages show one of them by default. This module
 * is the rule, written once and shared by the website and the shopper app;
 * the database applies the same rule to the listing summary that search and
 * category pages read (private.refresh_product_summary) and to the order in
 * which get_product returns a variant's offers. A parity test
 * (offers.parity.test.ts) reads that SQL and compares it with OFFER_ORDER_SQL.
 *
 * The order, deterministic and published (docs/04-algorithms/featured-offer.md):
 *   1. an offer that has units to sell comes before one that has none;
 *   2. then the lower total for the shopper: the price plus the shipping the
 *      shopper would pay for this offer (shipping is charged once per order
 *      by zone today, so it is the same for every offer and the price decides);
 *   3. then the older offer (it was listed first);
 *   4. then the offer id, so two offers listed in the same instant still
 *      come out the same way on every request and on both sides.
 *
 * The offer shown first is the first NEW offer in that order; refurbished and
 * used offers are listed with the others and can be bought, never shown first.
 * Nothing else is weighed: not the shop's size, not what it pays Yuntera, not
 * Yuntera's commission, and not the seller score, which no job computes yet.
 */

export interface OfferCandidate {
  offerId: string;
  /** The shop that sells it (any stable key; the page uses the shop's slug). */
  sellerId: string;
  /** Tax-inclusive item price in céntimos. */
  priceMinor: number;
  /** Shipping the shopper would pay for this offer, in céntimos (0 while it is per order). */
  shippingMinor: number;
  availableQuantity: number;
  condition: "new" | "refurbished" | "used";
  /** When the offer was created, as the database returns it (ISO 8601). */
  listedAt: string;
}

/**
 * The ORDER BY the database uses for the same rule, as written in
 * 20261121083600_seller_listings.sql between `-- BEGIN offer_order` and
 * `-- END offer_order`. offers.parity.test.ts keeps the two equal.
 */
export const OFFER_ORDER_SQL =
  "(o.available_quantity > 0) desc, o.price_minor asc, o.created_at asc, o.id asc";

/** Price plus shipping: what the shopper pays for one unit of this offer. */
export const totalForShopper = (offer: OfferCandidate) => offer.priceMinor + offer.shippingMinor;

/** Compares two ISO timestamps by the instant they name, then by their text. */
function compareInstants(a: string, b: string): number {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  // Same millisecond (or unreadable): the database's text keeps the microseconds.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order of the rule above. Ids are compared as plain text, which for the
 * lowercase canonical form of a UUID is the order PostgreSQL gives uuids.
 */
export function compareOffers(a: OfferCandidate, b: OfferCandidate): number {
  const stocked = Number(b.availableQuantity > 0) - Number(a.availableQuantity > 0);
  if (stocked !== 0) return stocked;
  const total = totalForShopper(a) - totalForShopper(b);
  if (total !== 0) return total;
  const listed = compareInstants(a.listedAt, b.listedAt);
  if (listed !== 0) return listed;
  const left = a.offerId.toLowerCase();
  const right = b.offerId.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface OfferSelection<T extends OfferCandidate = OfferCandidate> {
  /** The offer shown first: the first new offer in order, or null when there is none. */
  featured: T | null;
  /** Every offer, in order, the featured one included. */
  ranked: T[];
}

/** Orders a variant's offers and picks the one shown first. Does not change its input. */
export function selectFeaturedOffer<T extends OfferCandidate>(
  candidates: readonly T[],
): OfferSelection<T> {
  const ranked = [...candidates].sort(compareOffers);
  const featured = ranked.find((offer) => offer.condition === "new") ?? null;
  return { featured, ranked };
}
