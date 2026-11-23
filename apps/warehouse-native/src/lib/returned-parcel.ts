// How a parcel waiting to be received back reads on the floor: where it
// comes from in plain words (stopped before it left, taken off a route, or
// back after attempts at the door), never "0 intentos de entrega".
import { plural } from "./floor";

export type ReturningParcel = {
  units: number;
  lines: number;
  order_number: string;
  attempt_count: number;
  /** Staff stopped it before it left the warehouse (since migration 084200). */
  never_left?: boolean;
};

/** The badge beside the tracking code. */
export function returnedParcelBadge(parcel: ReturningParcel): string {
  return parcel.never_left ? "Nunca salió de la bodega" : "De vuelta";
}

/** The line under the tracking code. */
export function returnedParcelDetails(parcel: ReturningParcel): string {
  const origin = parcel.never_left
    ? "Central lo detuvo antes de que saliera: recíbalo y guarde las unidades en la zona de devoluciones"
    : parcel.attempt_count === 0
      ? "lo quitaron de una ruta, sin intento de entrega"
      : plural(parcel.attempt_count, "intento de entrega", "intentos de entrega");
  return `${plural(parcel.units, "unidad", "unidades")} en ${plural(
    parcel.lines,
    "línea",
    "líneas",
  )} · pedido ${parcel.order_number} · ${origin}`;
}

/** What the shopper gets back, said after the check-in (0: nothing was paid). */
export function refundedText(
  goodsMinor: number,
  feeMinor: number,
  price: (minor: number) => string,
) {
  if (goodsMinor + feeMinor <= 0) return "";
  return feeMinor > 0
    ? ` Al cliente se le devuelven ${price(goodsMinor + feeMinor)}, el envío incluido.`
    : ` Al cliente se le devuelven ${price(goodsMinor)}.`;
}
