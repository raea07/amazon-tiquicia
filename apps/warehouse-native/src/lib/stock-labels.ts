import type { WmsStockLocation } from "@yuntera/db";

/** What each kind of location is called, as on the web's warehouse screens. */
export const LOCATION_KIND: Record<WmsStockLocation["kind"], string> = {
  storage: "Almacenaje",
  pick: "Alisto",
  receiving: "Recepción",
  packing: "Empaque",
  staging: "Despacho",
  returns: "Devoluciones",
  damaged: "Dañados",
};
