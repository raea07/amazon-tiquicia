import type { ShipmentStatus } from "./lifecycle";

/**
 * The shopper's words for a parcel staff stopped in our warehouse before it
 * ever went out (ops_recall_shipment). The general words ("De regreso",
 * "Devuelto", "Paquete: devuelto") say the parcel came back, which is false
 * for one that never left. Both shopper apps (the web shop's order page and
 * the shopper app's) ask here first and fall back on their own label.
 *
 * `recalled` is get_order's flag (staff stopped it); `stoppedBeforeLeaving`
 * (since 085000) adds that it never went out on a route at all, the rule
 * the check-in uses for the order's cancellation reason
 * (CANCEL_REASON.stopped, "Los paquetes no salieron de la bodega").
 */
export function stoppedParcelLabel(
  status: ShipmentStatus,
  flags: { recalled: boolean; stoppedBeforeLeaving: boolean },
): string | null {
  // Waiting to be checked back onto the shelves: it is in our warehouse.
  if (status === "returning" && flags.recalled) return "Detenido en la bodega";
  if (status === "returned" && flags.stoppedBeforeLeaving) return "No salió de la bodega";
  return null;
}

/** A history line of such a parcel ("Paquete: …"), or null for the usual words. */
export function stoppedParcelHistory(
  toStatus: string | null,
  stoppedBeforeLeaving: boolean,
): string | null {
  if (!stoppedBeforeLeaving) return null;
  if (toStatus === "returning") return "Paquete: detenido en nuestra bodega";
  if (toStatus === "returned") return "Paquete: no salió de nuestra bodega";
  return null;
}
