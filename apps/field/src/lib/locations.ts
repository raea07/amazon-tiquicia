import type { WmsStockLocation } from "@yuntera/db";
import type { Route } from "next";

/** What each kind of location is called on the warehouse's screens. */
export const LOCATION_KIND: Record<WmsStockLocation["kind"], string> = {
  storage: "Almacenaje",
  pick: "Alisto",
  receiving: "Recepción",
  packing: "Empaque",
  staging: "Despacho",
  returns: "Devoluciones",
  damaged: "Dañados",
};

/** A location's page, by the code on its label. */
export const locationHref = (code: string) =>
  `/bodega/ubicacion?codigo=${encodeURIComponent(code)}` as Route;

export const units = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;

/** What a move did, in the words the location's page shows after it. */
export const movedText = (quantity: number, to: string) =>
  quantity === 1
    ? `Se movió 1 unidad a ${to}. Guárdela allí ahora.`
    : `Se movieron ${units(quantity)} a ${to}. Guárdelas allí ahora.`;

/**
 * A move or a count the database refused because the product has left the
 * location meanwhile (its row is no longer on the page). The same words as
 * the warehouse app's `goneText`.
 */
export const goneText = (action: "move" | "count", skuCode: string) =>
  `${action === "move" ? "No se movió nada" : "No se corrigió nada"}: el producto ${skuCode} ya no está en esta ubicación, porque alguien lo alistó, lo movió o corrigió la cantidad mientras tanto. ${action === "move" ? "Búsquelo en «Buscar un producto» para ver dónde está." : "Revise la ubicación y vuelva a contar."}`;
