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
