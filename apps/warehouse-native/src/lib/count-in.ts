/**
 * Counting a product the location does not list onto it: the checks the
 * screen runs before calling the API, and its words, as the web app runs
 * them (`apps/field`, /bodega/ubicacion, count-in-actions.ts and
 * count-in.tsx), without React. `count-in.test.ts` runs them in Node. The
 * database checks again and has the last word (a shop with no stock record
 * here, a location switched off, a product counted or moved here meanwhile).
 */

import { COUNT_IN_LIMITS, reasonLetters, STOCK_LIMITS } from "@yuntera/db";
import { plural } from "./floor";

/** The kinds of location that take counted units (the database's count_not_shelf rule). */
export const takesCounts = (kind: string) =>
  kind === "storage" || kind === "pick" || kind === "returns" || kind === "receiving";

/** Why a location offers no count of a new product, or null when it does. */
export function noCountHere(location: { active: boolean; kind: string }): string | null {
  if (!location.active) {
    return "Esta ubicación está desactivada: aquí no se cuentan productos nuevos. Llévelos a un estante activo y cuéntelos allí.";
  }
  if (!takesCounts(location.kind)) {
    return "En esta zona no se suman unidades: lo que se guarda aquí no se vende. Si están en buen estado, llévelas a un estante y cuéntelas allí; si no, avise a operaciones.";
  }
  return null;
}

/** A count of a new product: the shop chosen, a whole number from 1 to 10 000, and a reason. */
export function parseCountIn(input: {
  sellerId: string | null;
  quantity: string;
  note: string;
}): { sellerId: string; quantity: number; note: string } | { error: string } {
  if (!input.sellerId) return { error: "Elija de qué tienda son las unidades." };
  const text = input.quantity.trim();
  const quantity = Number(text);
  const [least, most] = COUNT_IN_LIMITS.quantity;
  if (!/^\d{1,6}$/.test(text) || quantity < least || quantity > most) {
    return {
      error:
        "Escriba cuántas unidades contó: un número entero desde 1 hasta 10 000. Si son más, avise a operaciones.",
    };
  }
  const note = input.note.trim();
  if (reasonLetters(note) < STOCK_LIMITS.reasonLetters || note.length > STOCK_LIMITS.reasonLength) {
    return {
      error: "Escriba el motivo con al menos 5 letras, por ejemplo «estaban detrás de otra caja».",
    };
  }
  return { sellerId: input.sellerId, quantity, note };
}

/** What the button says, with the number typed when it is one. */
export function countInButton(quantity: string, locationCode: string): string {
  const text = quantity.trim();
  return /^\d{1,6}$/.test(text) && Number(text) > 0
    ? `Sumar ${plural(Number(text), "unidad", "unidades")} a ${locationCode}`
    : `Sumar las unidades a ${locationCode}`;
}

/** The answer after a count, as on the web. */
export const countedInText = (quantity: number, skuCode: string) =>
  `Se ${quantity === 1 ? "sumó" : "sumaron"} ${plural(quantity, "unidad", "unidades")} de ${skuCode} a esta ubicación: ya aparece en la lista. La tienda ve el conteo y su motivo en su inventario.`;

/** A product no shop keeps in this warehouse: its first units come in with a receipt. */
export const receiptText = (warehouseName: string) =>
  `Ninguna tienda tiene existencias registradas de este producto en ${warehouseName}. Las primeras unidades de una tienda entran con una recepción: búsquela en «Mercadería por recibir», en el inicio de Bodega. Si la tienda no anunció el envío, avise a operaciones.`;

/** A shop whose units the location already lists. */
export const listedText = (sellerName: string, onShelf: number) =>
  `Ya está en esta ubicación, de ${sellerName}${onShelf > 0 ? ` (${onShelf} en el estante)` : ""}: corrija la cantidad en su línea, en la lista de arriba.`;

/** A shop that sells the product from elsewhere. */
export const elsewhereText = (sellerName: string) =>
  `${sellerName} también vende este producto, pero no tiene existencias registradas en esta bodega: sus primeras unidades entran con una recepción.`;

/** Nothing found for what was typed. */
export const notFoundText = (warehouseName: string, query: string) =>
  `Ningún producto que se guarde en ${warehouseName} tiene el código o el nombre «${query}». Revise el código o pruebe con otra parte del nombre.`;

/** What the lookup accepts: from 2 to 80 characters. */
export const searchable = (query: string) => {
  const text = query.trim();
  return text.length >= COUNT_IN_LIMITS.query[0] && text.length <= COUNT_IN_LIMITS.query[1];
};

/**
 * The results after a refusal, read again: each product shown before keeps
 * its place, with what the new read says about it (now listed here, say).
 * A product the new read does not return stays as it was shown, so a refused
 * form never disappears with what was typed and its refusal; the worker is
 * never told that a product they just saw does not exist.
 */
export function keepResults<T extends { sku_id: string }>(previous: T[] | null, next: T[]): T[] {
  if (!previous || previous.length === 0) return next;
  return previous.map((shown) => next.find((fresh) => fresh.sku_id === shown.sku_id) ?? shown);
}
