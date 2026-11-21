import "server-only";
import type { SearchInput } from "@yuntera/db";
import { cacheLife, cacheTag } from "next/cache";
import { publicApi } from "./supabase";

/**
 * Catalogue reads, shared by every visitor and therefore cached.
 *
 * Lifetimes are chosen by how wrong a stale answer can be:
 *   - Categories and districts change by deploy or by staff action: hours/days.
 *   - Prices, stock and search results: the `minutes` profile (revalidated every
 *     minute in the background). A shopper can briefly see a price or "in stock"
 *     that just changed; that is safe because checkout re-prices and re-checks
 *     stock in the database and refuses with a clear message if they differ.
 *
 * Nothing user-specific may be read here — these results are served to everyone.
 */

export async function getCategories() {
  "use cache";
  cacheLife("hours");
  cacheTag("categories");
  return publicApi().listCategories();
}

export async function getDistricts() {
  "use cache";
  cacheLife("days");
  cacheTag("districts");
  return publicApi().listDistricts();
}

export async function searchCatalog(input: SearchInput) {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  return publicApi().searchProducts(input);
}

export async function getProductPage(slug: string, postalCode: string | null) {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog", `product:${slug}`);
  return publicApi().getProduct(slug, postalCode);
}

export async function getSuggestions(prefix: string) {
  "use cache";
  cacheLife("minutes");
  return publicApi().suggestProducts(prefix, 6);
}
