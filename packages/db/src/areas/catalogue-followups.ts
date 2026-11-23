/**
 * Catalogue follow-ups: deleting a brand nobody names, and the brand list
 * that says which brands can be deleted. (The other follow-up, product pages
 * that refuse a product not on sale by themselves, changes no payload.)
 *
 * SQL: supabase/migrations/20261121084100_catalogue_followups.sql.
 */

import { z } from "zod";
import { opsBrand } from "./catalogue";
import type { Caller, Messages } from "./types";

const id = z.uuid();

/** A brand in the console, with its products in every status. */
export const opsBrandWithUse = opsBrand.extend({
  /** Products naming it in any status, archived and drafts included. */
  all_product_count: z.number().int().min(0),
  /** No product names it and it was not merged into another. */
  deletable: z.boolean(),
});
export type OpsBrandWithUse = z.infer<typeof opsBrandWithUse>;

export const deletedBrand = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  /** Brands merged into it, removed with it. */
  merged_removed: z.number().int().min(0),
});
export type DeletedBrand = z.infer<typeof deletedBrand>;

export const catalogueFollowupsErrors = {
  brand_in_use: {
    "es-CR":
      "Hay productos con esta marca, así que no se puede eliminar. Únala a otra marca o quítela del filtro de la tienda.",
    en: "Products carry this brand, so it cannot be deleted. Merge it into another brand or take it out of the shop's filter.",
  },
} as const satisfies Messages;

export const catalogueFollowupsApi = ({ call }: Caller) => ({
  /** Replaces the catalogue area's method: the same list, with what can be deleted. */
  opsCatalogBrands: () => call("ops_catalog_brands", {}, z.array(opsBrandWithUse)),
  /** Deletes a brand no product names (`brand_in_use` carries how many do). */
  opsDeleteBrand: (brandId: string) =>
    call("ops_delete_brand", { p_brand_id: brandId }, deletedBrand),
});
