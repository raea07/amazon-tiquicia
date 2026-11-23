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

/** "Mostrando 3 productos de Nimbo". */
export const brandSummary = (count: number, name: string | undefined) =>
  `Mostrando ${count} ${count === 1 ? "producto" : "productos"} de ${name ?? "esa marca"}`;

export const BRAND_EMPTY = {
  title: "No hay productos de esa marca aquí",
  body: "Pruebe con otra marca o quite el filtro para ver todos los productos.",
  clear: "Quitar el filtro de marca",
} as const;
