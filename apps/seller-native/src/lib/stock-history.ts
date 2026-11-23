/**
 * The shop's stock history (seller_stock_history), in the seller centre's
 * words (apps/seller/src/app/inventario/page.tsx, "Historial de existencias").
 * Pure, so the words are unit-tested against the seller centre's source.
 */

import type { SellerStockHistoryEntry } from "@yuntera/db";

export const HISTORY_HEADING = "Historial de existencias";
export const HISTORY_INTRO =
  "Cada cambio en las unidades que usted tiene, del más reciente al más antiguo (los últimos 50). Cuando la bodega corrige un conteo, aquí ve cuántas unidades y por qué.";
export const HISTORY_EMPTY = "Todavía no hay cambios.";
/** As many entries as the seller centre shows. */
export const HISTORY_LIMIT = 50;

export const HISTORY_KIND: Record<SellerStockHistoryEntry["kind"], string> = {
  received: "Recibidas",
  shipped: "Salieron en un pedido",
  returned: "Volvieron de una entrega que no se hizo",
  warehouse_count: "Corrección de conteo de la bodega",
  own_count: "Su conteo",
  other: "Otro cambio",
};

/** "+3 unidades", "−1 unidad": the sign always shown, never colour alone. */
export const historyChange = (change: number) =>
  `${change > 0 ? "+" : "−"}${Math.abs(change)} ${Math.abs(change) === 1 ? "unidad" : "unidades"}`;

/** "Motivo: …" when the warehouse wrote one. */
export const historyReason = (note: string | null) => (note ? `Motivo: ${note}` : null);
