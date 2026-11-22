/**
 * The shop's cache tags, in one place, so what an action drops is exactly
 * what it changed (WEB-3, WEB-6). Every shared catalogue read carries
 * CATALOG_TAG, which only the protected refresh endpoint drops as a whole
 * (staff take-downs, a suspended shop, an approved edit). The shop's own
 * actions, which any signed-in shopper can repeat, drop only the tags of the
 * products and offers they touched.
 *
 * Nothing about a person is ever in a tag or in a tagged read: these are reads
 * through `publicApi()`, the same for everyone.
 */

export const CATALOG_TAG = "catalog";
export const SUGGESTIONS_TAG = "suggestions";
/** At most this many tags are dropped by one action; a cart has at most 20 lines. */
const MAX_TAGS = 40;

const SAFE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const productTag = (slug: string) => `product:${slug}`;
export const offerTag = (offerId: string) => `offer:${offerId.toLowerCase()}`;

/** The tags of one product page: the whole catalogue, the product, and each of its offers. */
export function productPageTags(slug: string, offerIds: readonly string[] = []): string[] {
  return [CATALOG_TAG, productTag(slug), ...offerIds.filter((id) => UUID.test(id)).map(offerTag)];
}

/** Search suggestions: dropped with the catalogue, never by a shopper's action. */
export const suggestionTags = () => [CATALOG_TAG, SUGGESTIONS_TAG];

/** After an order is placed: the pages of the offers bought, whose stock changed. */
export function tagsForOffers(offerIds: readonly string[]): string[] {
  return unique(offerIds.filter((id) => UUID.test(id)).map(offerTag));
}

/** After an order is cancelled or a review is published: the pages of those products. */
export function tagsForProducts(slugs: readonly (string | null | undefined)[]): string[] {
  return unique(
    slugs
      .filter((slug): slug is string => typeof slug === "string" && SAFE.test(slug))
      .map(productTag),
  );
}

const unique = (tags: string[]) => [...new Set(tags)].slice(0, MAX_TAGS);
