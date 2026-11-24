/**
 * The brand filter of search and category results, as the website's listing
 * has it (apps/web/src/components/catalog-listing.tsx): a brand's address in
 * `?marca=`, the brands of the category (or of the whole shop) with how many
 * products each has, and an old address (a brand renamed, or merged into
 * another) meaning the brand that has it now.
 *
 * Pure, with no React Native import, so `brand-filter.test.ts` checks it.
 */

import type { ShopBrand } from "@yuntera/db";

/** The shape of a brand's address; anything else in `?marca=` is ignored. */
const BRAND_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reads `?marca=` from the address: a brand's address, or undefined. */
export function parseBrand(value: string | undefined): string | undefined {
  const brand = value?.trim().toLowerCase();
  return brand && brand.length <= 80 && BRAND_SLUG.test(brand) ? brand : undefined;
}

/** The brand an address means: its own, or the one that took it over. */
export function currentBrand(brands: ShopBrand[], slug: string | undefined) {
  if (!slug) return undefined;
  return (
    brands.find((brand) => brand.slug === slug) ??
    brands.find((brand) => brand.former_slugs.includes(slug))
  );
}

/** Only shown when there is a choice to make, or a filter to take off. */
export const showBrandFilter = (brands: ShopBrand[], slug: string | undefined) =>
  brands.length >= 2 || Boolean(slug);

/** "Todas las marcas" first, then each brand with its count, as the website's list. */
export function brandOptions(brands: ShopBrand[]) {
  return [
    { value: "", label: "Todas las marcas" },
    ...brands.map((brand) => ({
      value: brand.slug,
      label: `${brand.name} (${brand.product_count})`,
    })),
  ];
}

/** What a listing's search query looks like to the screen (react-query's names). */
export interface ListingResults {
  isSuccess: boolean;
  /** True with `data` when asking again failed and the last answer is kept (kept-reads.ts). */
  isError?: boolean;
  isPlaceholderData?: boolean;
  data?: { pages: { total_count: number }[][] };
}

/**
 * How many products the search for the options on screen found, or null
 * while it has not answered for them yet (the first page of a new filter,
 * or another filter's results standing in). A count is only said once it is
 * the count of what is asked: "0 productos" while loading would be false.
 * When a refresh failed, the answer kept for these same options still
 * counts (the screen says above it that it could not be updated).
 */
export function settledTotal(results: ListingResults): number | null {
  if (results.isPlaceholderData || !results.data) return null;
  if (!results.isSuccess && !results.isError) return null;
  return results.data.pages[0]?.[0]?.total_count ?? 0;
}

/**
 * "Mostrando 3 productos de Nimbo" once the search has answered; before
 * that (`count` null) a line with no number, in the words of the website's
 * "Cargando productos…".
 */
export const brandSummary = (count: number | null, name: string | undefined) =>
  count === null
    ? `Cargando productos de ${name ?? "esa marca"}…`
    : `Mostrando ${count} ${count === 1 ? "producto" : "productos"} de ${name ?? "esa marca"}`;

export const BRAND_EMPTY = {
  title: "No hay productos de esa marca aquí",
  body: "Pruebe con otra marca o quite el filtro para ver todos los productos.",
  clear: "Quitar el filtro de marca",
} as const;
