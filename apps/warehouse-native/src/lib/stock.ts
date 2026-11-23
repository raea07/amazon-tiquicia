/**
 * The checks the stock screens run before calling the API, as the web app
 * (`apps/field`, /bodega/ubicacion) runs them, without React. Every text is
 * the web's own. `stock.test.ts` runs them in Node. The database checks
 * again and has the last word (free units, a shelf that changed meanwhile).
 */

import { reasonLetters, STOCK_LIMITS } from "@yuntera/db";
import { plural } from "./floor";

const WHOLE = /^\d{1,6}$/;

/** A move: a whole number of units from 1 up to what is free, and a target chosen. */
export function parseMove(input: {
  quantity: string;
  toLocationId: string | null;
  free: number;
}): { quantity: number; toLocationId: string } | { error: string } {
  if (!input.toLocationId) return { error: "Elija a qué estante lo mueve." };
  const text = input.quantity.trim();
  const quantity = Number(text);
  if (!WHOLE.test(text) || quantity < STOCK_LIMITS.moveQuantity[0]) {
    return { error: "Escriba cuántas unidades mueve: un número entero desde 1." };
  }
  if (quantity > input.free) {
    return {
      error: `Solo hay ${plural(input.free, "unidad libre", "unidades libres")} para mover: las demás esperan a pedidos.`,
    };
  }
  return { quantity, toLocationId: input.toLocationId };
}

/** A count: what is on the shelf now, different from what is recorded, and a reason. */
export function parseCount(input: {
  counted: string;
  note: string;
  expected: number;
}): { counted: number; delta: number; note: string } | { error: string } {
  const text = input.counted.trim();
  if (!WHOLE.test(text)) {
    return { error: "Escriba cuántas unidades contó: un número entero desde 0." };
  }
  const counted = Number(text);
  const delta = counted - input.expected;
  if (delta === 0)
    return { error: "Contó lo mismo que está registrado: no hay nada que corregir." };
  if (Math.abs(delta) > STOCK_LIMITS.adjustDelta) {
    return {
      error: "Una corrección no puede cambiar más de 10 000 unidades. Avise a operaciones.",
    };
  }
  const note = input.note.trim();
  if (reasonLetters(note) < STOCK_LIMITS.reasonLetters || note.length > STOCK_LIMITS.reasonLength) {
    return { error: "Escriba el motivo con al menos 5 letras, por ejemplo «faltan 2, caja rota»." };
  }
  return { counted, delta, note };
}

/** What the worker sees while typing a count, before confirming it. */
export function differenceText(counted: string, onShelf: number): string {
  const text = counted.trim();
  if (!WHOLE.test(text)) return "Escriba lo que contó para ver la diferencia.";
  const delta = Number(text) - onShelf;
  if (delta === 0) return "Coincide con lo registrado: no hay nada que corregir.";
  return `Diferencia: ${delta > 0 ? "+" : "−"}${plural(Math.abs(delta), "unidad", "unidades")} (${
    delta > 0 ? "sobran" : "faltan"
  }). Quedarán ${plural(Number(text), "unidad", "unidades")}.`;
}

/** The answer after a correction, as on the web. */
export const countedText = (counted: number, delta: number) =>
  `Cantidad corregida: ahora hay ${plural(counted, "unidad", "unidades")} (${delta > 0 ? "+" : "−"}${Math.abs(delta)}). La tienda ve la corrección y su motivo en su inventario.`;

/** The answer after a move, as on the web. */
export const movedText = (quantity: number, to: string) =>
  quantity === 1
    ? `Se movió 1 unidad a ${to}. Guárdela allí ahora.`
    : `Se movieron ${plural(quantity, "unidad", "unidades")} a ${to}. Guárdelas allí ahora.`;

/**
 * A move or a count the database refused because the product has left the
 * location meanwhile (its card, and the form with the refusal, are gone
 * once the location is read again). The web's words (`goneText` in
 * apps/field/src/lib/locations.ts).
 */
export const goneText = (action: "move" | "count", skuCode: string) =>
  `${action === "move" ? "No se movió nada" : "No se corrigió nada"}: el producto ${skuCode} ya no está en esta ubicación, porque alguien lo alistó, lo movió o corrigió la cantidad mientras tanto. ${action === "move" ? "Búsquelo en «Buscar un producto» para ver dónde está." : "Revise la ubicación y vuelva a contar."}`;

/** Whether a refused product is no longer listed in the location as read again. */
export const refusedAndGone = (
  refused: { skuId: string; sellerId: string } | null,
  items: ReadonlyArray<{ sku_id: string; seller_id: string }>,
) =>
  refused !== null &&
  !items.some((item) => item.sku_id === refused.skuId && item.seller_id === refused.sellerId);
