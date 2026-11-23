/**
 * Warehouse stock: what a location holds, moving stock between locations,
 * correcting a count, the shop's stock history and the staff list of moves
 * and corrections.
 *
 * SQL: supabase/migrations/20261121084300_warehouse_stock.sql (its header
 * says what each refuses and why). Two methods replace core ones of the same
 * name (this area is spread after the core methods in createApi):
 * `wmsFindSku` reads each bin's promised and free units, and
 * `wmsAdjustStock` also sends the quantity the screen showed. Callers that
 * pass only the old arguments work as before.
 */

import { z } from "zod";
import { wmsSku } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const count = z.number().int().min(0);
const timestamp = z.string().min(10);
const locationKind = z.enum([
  "receiving",
  "storage",
  "pick",
  "packing",
  "staging",
  "returns",
  "damaged",
]);

/** What the database accepts (wms_move_stock, wms_adjust_stock). */
export const STOCK_LIMITS = {
  /** Units in one move. */
  moveQuantity: [1, 100_000],
  /** Units one correction may add or take away. */
  adjustDelta: 10_000,
  /** Letters the reason of a correction needs, at least. */
  reasonLetters: 5,
  reasonLength: 500,
  moveNoteLength: 200,
} as const;

/** Letters in a reason, as the database counts them. */
export const reasonLetters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;

// ── Reads ───────────────────────────────────────────────────────────────────

/** A location in the warehouse's list: the switched-on ones and any switched off that still holds stock. */
export const wmsStockLocation = z.object({
  id,
  code: z.string(),
  kind: locationKind,
  active: z.boolean(),
  /** A storage or picking shelf: stock can be moved into it. */
  shelf: z.boolean(),
  units: count,
  /** Products (of any shop) on it. */
  products: count,
  /** Units open picks still wait for here. */
  promised: count,
});
export type WmsStockLocation = z.infer<typeof wmsStockLocation>;

export const wmsLocationItem = z.object({
  sku_id: id,
  sku_code: z.string(),
  gtin: z.string().nullable(),
  title: z.string(),
  variant_name: z.string(),
  /** The shop that owns these units. */
  seller_id: id,
  seller_name: z.string(),
  on_shelf: count,
  /** Units open picks still wait for here. */
  promised: count,
  /** On the shelf and not promised: what may be moved or counted away. */
  free: count,
  /** Picked from here into parcels still being picked: they come back if the order is cancelled. */
  picked_waiting: count,
});
export type WmsLocationItem = z.infer<typeof wmsLocationItem>;

export const wmsLocationStock = z.object({
  id,
  code: z.string(),
  kind: locationKind,
  active: z.boolean(),
  shelf: z.boolean(),
  warehouse: z.object({ id, code: z.string(), name: z.string() }),
  units: count,
  promised: count,
  free: count,
  picked_units: count,
  open_tasks: count,
  items: z.array(wmsLocationItem),
});
export type WmsLocationStock = z.infer<typeof wmsLocationStock>;

/** The barcode lookup, each bin also with its promised and free units. */
export const wmsSkuStock = wmsSku.extend({
  bins: z.array(
    wmsSku.shape.bins.element.extend({
      promised: count,
      free: count,
      location_active: z.boolean(),
      location_kind: locationKind,
    }),
  ),
});
export type WmsSkuStock = z.infer<typeof wmsSkuStock>;

export const wmsMoveResult = z.object({
  movement_id: z.number().int(),
  quantity: z.number().int().min(1),
  from: z.object({ id, code: z.string(), on_shelf: count, free: count }),
  to: z.object({ id, code: z.string(), on_shelf: count }),
});
export type WmsMoveResult = z.infer<typeof wmsMoveResult>;

export const STOCK_HISTORY_KINDS = [
  "received",
  "shipped",
  "returned",
  "warehouse_count",
  "own_count",
  "other",
] as const;

/** One change to a shop's on-hand stock. Never who in the warehouse made it. */
export const sellerStockHistoryEntry = z.object({
  id: z.number().int(),
  at: timestamp,
  warehouse_id: id,
  warehouse_name: z.string(),
  warehouse_kind: z.enum(["platform", "seller"]),
  sku_id: id,
  sku_code: z.string(),
  title: z.string(),
  variant_name: z.string(),
  /** Units added (positive) or taken away (negative). */
  change: z.number().int(),
  kind: z.enum(STOCK_HISTORY_KINDS),
  /** The warehouse's reason, for its count corrections only. */
  note: z.string().nullable(),
});
export type SellerStockHistoryEntry = z.infer<typeof sellerStockHistoryEntry>;

/** A move or a count correction, for operations staff to review. */
export const opsStockChange = z.object({
  id: z.number().int(),
  at: timestamp,
  kind: z.enum(["move", "correction"]),
  warehouse_code: z.string(),
  /** Who did it; null when the account is gone. */
  actor_name: z.string().nullable(),
  sku_code: z.string(),
  title: z.string(),
  variant_name: z.string(),
  seller_name: z.string(),
  quantity: z.number().int().min(1),
  /** 0 for a move; the units added or taken away for a correction. */
  change: z.number().int(),
  from_code: z.string().nullable(),
  to_code: z.string().nullable(),
  note: z.string().nullable(),
});
export type OpsStockChange = z.infer<typeof opsStockChange>;

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface MoveStockInput {
  fromLocationId: string;
  toLocationId: string;
  skuId: string;
  sellerId: string;
  quantity: number;
  note?: string | null;
}

export interface AdjustStockInput {
  locationId: string;
  skuId: string;
  sellerId: string;
  /** Units added (positive) or taken away (negative). */
  delta: number;
  note: string;
  /** The units the screen showed on the shelf: refused (`count_changed`) if the shelf changed since. */
  expected?: number | null;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export const warehouseStockErrors = {
  location_inactive: {
    "es-CR":
      "Esa ubicación está desactivada: no se puede guardar mercadería en ella. Elija otra ubicación o pida a operaciones que la active.",
    en: "That location is switched off: goods cannot be put there. Choose another location or ask operations to switch it on.",
  },
  move_same_location: {
    "es-CR": "La ubicación de destino es la misma de origen. Elija otra ubicación.",
    en: "The target location is the same as the source. Choose another location.",
  },
  move_other_warehouse: {
    "es-CR":
      "Esa ubicación es de otra bodega. Solo se mueve mercadería entre ubicaciones de la misma bodega.",
    en: "That location belongs to another warehouse. Stock only moves between locations of the same warehouse.",
  },
  move_target_not_shelf: {
    "es-CR":
      "Solo se mueve mercadería a un estante de almacenaje o de alisto. Si una unidad está dañada, corrija la cantidad.",
    en: "Stock only moves to a storage or picking shelf. If a unit is damaged, correct the count instead.",
  },
  move_nothing_here: {
    "es-CR":
      "En esa ubicación no hay unidades de ese producto de esa tienda. Actualice la pantalla.",
    en: "That location holds no units of that product of that shop. Refresh the screen.",
  },
  move_exceeds_free: {
    "es-CR":
      "Son más unidades de las que están libres en la ubicación: las demás esperan a pedidos que se están alistando. Mueva menos unidades.",
    en: "That is more than the free units here: the others are waiting for orders being picked. Move fewer units.",
  },
  count_changed: {
    "es-CR":
      "La cantidad en el estante cambió mientras usted contaba (alguien alistó, movió o corrigió). Vuelva a contar con la cantidad nueva.",
    en: "The quantity on the shelf changed while you were counting (someone picked, moved or corrected it). Count again with the new quantity.",
  },
  adjust_below_zero: {
    "es-CR": "No se pueden quitar más unidades de las que hay en la ubicación.",
    en: "You cannot take away more units than the location holds.",
  },
  adjust_below_promised: {
    "es-CR":
      "Hay pedidos esperando unidades de esta ubicación. No corrija la cantidad: avise a operaciones para que resuelva esos pedidos primero.",
    en: "Orders are waiting for units from this location. Do not correct the count: tell operations so they resolve those orders first.",
  },
  adjust_below_reserved: {
    "es-CR":
      "Esa corrección dejaría en la bodega menos unidades de las que los clientes ya compraron. No corrija la cantidad: avise a operaciones.",
    en: "That correction would leave fewer units in the warehouse than shoppers already bought. Do not correct the count: tell operations.",
  },
} as const satisfies Messages;

// ── Methods ─────────────────────────────────────────────────────────────────

export const warehouseStockApi = ({ call, run }: Caller) => ({
  /** The warehouse's locations a worker can open, with what each holds. */
  wmsStockLocations: (warehouseId: string) =>
    call("wms_stock_locations", { p_warehouse_id: warehouseId }, z.array(wmsStockLocation)),
  /** A location by the code on its label, with what it holds; null when there is none. */
  wmsLocationStock: (warehouseId: string, code: string) =>
    call(
      "wms_location_stock",
      { p_warehouse_id: warehouseId, p_code: code },
      wmsLocationStock.nullable(),
    ),
  /** Replaces the core method: each bin also says its promised and free units. */
  wmsFindSku: (warehouseId: string, code: string) =>
    call("wms_find_sku", { p_warehouse_id: warehouseId, p_code: code }, wmsSkuStock.nullable()),
  wmsMoveStock: (input: MoveStockInput) =>
    call(
      "wms_move_stock",
      {
        p_from_location_id: input.fromLocationId,
        p_to_location_id: input.toLocationId,
        p_sku_id: input.skuId,
        p_seller_id: input.sellerId,
        p_quantity: input.quantity,
        p_note: input.note ?? undefined,
      },
      wmsMoveResult,
    ),
  /** Replaces the core method: also sends the quantity the screen showed, when given. */
  wmsAdjustStock: (input: AdjustStockInput) =>
    run("wms_adjust_stock", {
      p_location_id: input.locationId,
      p_sku_id: input.skuId,
      p_seller_id: input.sellerId,
      p_delta: input.delta,
      p_note: input.note,
      p_expected: input.expected ?? undefined,
    }),
  /** Every change to the shop's on-hand stock, newest first (moves and picks are not listed). */
  sellerStockHistory: (sellerId: string, limit?: number) =>
    call(
      "seller_stock_history",
      { p_seller_id: sellerId, p_limit: limit },
      z.array(sellerStockHistoryEntry),
    ),
  /** Moves and count corrections in every Yuntera warehouse, newest first. */
  opsStockChanges: (limit?: number) =>
    call("ops_stock_changes", { p_limit: limit }, z.array(opsStockChange)),
});
