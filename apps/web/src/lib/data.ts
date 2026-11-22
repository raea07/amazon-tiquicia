import "server-only";
import type { CatalogSearchInput } from "@yuntera/db";
import {
  CATALOG_TAG,
  CATEGORIES_TAG,
  productPageTags,
  suggestionTags,
} from "@yuntera/next-kit/cache-tags";
import { cacheLife, cacheTag } from "next/cache";
import { publicApi } from "./supabase";

/**
 * Catalogue reads, shared by every visitor and therefore cached.
 *
 * Lifetimes are chosen by how wrong a stale answer can be:
 *   - Categories and districts change by deploy or by staff action: hours/days
 *     (the refresh endpoint drops categories when staff change them).
 *   - Prices, stock and search results: the `minutes` profile (revalidated every
 *     minute in the background). A shopper can briefly see a price or "in stock"
 *     that just changed; that is safe because checkout re-prices and re-checks
 *     stock in the database and refuses with a clear message if they differ.
 *
 * Nothing user-specific may be read here — these results are served to everyone.
 *
 * Tags (packages/next-kit/src/cache-tags.ts): every catalogue read carries
 * `catalog`, which only the protected refresh endpoint drops; a product page
 * also carries its product and its offers, which the shop's own actions drop
 * when they change them, and nothing more.
 */

export async function getCategories() {
  "use cache";
  cacheLife("hours");
  // Not the catalogue tag: the menu is part of every page's prepared shell, which
  // must survive an ordinary catalogue refresh. When staff change categories the
  // console asks the refresh endpoint to drop this tag as well.
  cacheTag(CATEGORIES_TAG);
  return publicApi().listCategories();
}

/** The brands of the listing filter, in a category and below it when one is given. */
export async function getBrands(categorySlug: string | null) {
  "use cache";
  cacheLife("minutes");
  cacheTag(CATALOG_TAG);
  return publicApi().listBrands(categorySlug);
}

export async function getDistricts() {
  "use cache";
  cacheLife("days");
  cacheTag("districts");
  return publicApi().listDistricts();
}

export async function searchCatalog(input: CatalogSearchInput) {
  "use cache";
  cacheLife("minutes");
  cacheTag(CATALOG_TAG);
  return publicApi().searchProducts(input);
}

export async function getProductPage(slug: string, postalCode: string | null) {
  "use cache";
  cacheLife("minutes");
  const product = await publicApi().getProduct(slug, postalCode);
  const offers = product?.skus.flatMap((sku) => sku.offers.map((offer) => offer.offer_id)) ?? [];
  cacheTag(...productPageTags(slug, offers));
  return product;
}

export async function getSuggestions(prefix: string) {
  "use cache";
  cacheLife("minutes");
  // Tagged so a take-down drops the suggestions too (WEB-6).
  cacheTag(...suggestionTags());
  return publicApi().suggestProducts(prefix, 6);
}
