/**
 * Counting a product into a location that has no record of it: the lookup a
 * location's screen uses to find the product and the shop the units belong
 * to, and the count itself.
 *
 * SQL: supabase/migrations/20261121084500_count_into_location.sql (its
 * header says why this is not wms_adjust_stock from 0, what it refuses and
 * what it leaves: exactly what an upward count correction leaves).
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const count = z.number().int().min(0);

/** What the database accepts (wms_count_into_location): as an upward correction. */
export const COUNT_IN_LIMITS = {
  quantity: [1, 10_000],
  /** What the lookup searches for, in characters. */
  query: [2, 80],
} as const;

/** A shop that sells the product, as the location's warehouse knows it. */
export const countCandidateShop = z.object({
  seller_id: id,
  seller_name: z.string(),
  /** The shop has a stock record of this variant in this warehouse: it may be counted in. */
  stock_record: z.boolean(),
  /** The location already lists it for this shop: count it on its own line instead. */
  listed: z.boolean(),
  /** Units of this shop's product on this location now. */
  on_shelf: count,
});
export type CountCandidateShop = z.infer<typeof countCandidateShop>;

/** A product the lookup found, with every shop that sells it. */
export const countCandidate = z.object({
  sku_id: id,
  sku_code: z.string(),
  gtin: z.string().nullable(),
  title: z.string(),
  variant_name: z.string(),
  shops: z.array(countCandidateShop),
});
export type CountCandidate = z.infer<typeof countCandidate>;

export const countIntoLocationResult = z.object({
  location_id: id,
  location_code: z.string(),
  sku_id: id,
  sku_code: z.string(),
  seller_id: id,
  quantity: z.number().int().min(1),
  on_shelf: z.number().int().min(1),
});
export type CountIntoLocationResult = z.infer<typeof countIntoLocationResult>;

export interface CountIntoLocationInput {
  locationId: string;
  skuId: string;
  sellerId: string;
  /** Units found on the shelf, from 1. */
  quantity: number;
  note: string;
}

export const countIntoLocationErrors = {
  count_no_stock_record: {
    "es-CR":
      "Esa tienda no tiene existencias registradas de este producto en esta bodega, así que no se puede contar aquí: las primeras unidades entran con una recepción. Búsquela en «Mercadería por recibir»; si la tienda no anunció el envío, avise a operaciones.",
    en: "That shop has no stock record of this product in this warehouse, so it cannot be counted here: the first units come in with a receipt. Look for it under incoming goods; if the shop did not announce the shipment, tell operations.",
  },
  count_already_listed: {
    "es-CR":
      "No se guardó nada: esta ubicación ya tiene ese producto de esa tienda (alguien lo contó, lo movió aquí o un pedido lo espera aquí). Búsquelo en la lista de la ubicación y corrija la cantidad en su propia línea.",
    en: "Nothing was saved: this location already holds that product of that shop (someone counted it, moved it here, or an order is waiting for it here). Find it in the location's list and correct the count on its own line.",
  },
} as const satisfies Messages;

export const countIntoLocationApi = ({ call }: Caller) => ({
  /**
   * Products for a count into this location, by code, barcode or name (a
   * name finds only what some shop keeps in this warehouse), with their shops.
   */
  wmsCountCandidates: (locationId: string, query: string) =>
    call(
      "wms_count_candidates",
      { p_location_id: locationId, p_query: query },
      z.array(countCandidate),
    ),
  /** Counts units of a product the location does not list onto it. */
  wmsCountIntoLocation: (input: CountIntoLocationInput) =>
    call(
      "wms_count_into_location",
      {
        p_location_id: input.locationId,
        p_sku_id: input.skuId,
        p_seller_id: input.sellerId,
        p_quantity: input.quantity,
        p_note: input.note,
      },
      countIntoLocationResult,
    ),
});
