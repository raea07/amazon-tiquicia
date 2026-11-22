/**
 * The rules and words of the driver's day, the same as the drivers' web app
 * (apps/field/src/app/ruta and components/driver-forms.tsx), plus what the
 * phone adds: actions waiting in the queue are shown as already taken.
 *
 * Pure functions with no React Native import.
 */

import { format, money, parseColones } from "@yuntera/core";
import type { DriverDay, DriverRoute, DriverStop } from "@yuntera/db";
import type { Tone } from "@yuntera/expo-kit/theme";

/** ₡12 500: the kit's formatPrice, the same core function, without the kit's screen components. */
const formatPrice = (amountMinor: number) => format(money(amountMinor));

export type StopStatus = DriverStop["status"];

export const STOP_LABEL: Record<StopStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "neutral" },
  arrived: { label: "En la puerta", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  failed: { label: "No entregado", tone: "danger" },
  skipped: { label: "Omitida", tone: "neutral" },
};

/** The reasons the web offers, in its order and words. */
export const FAILURE_REASONS = [
  { value: "nobody_home", title: "No había nadie" },
  { value: "wrong_address", title: "La dirección está mal" },
  { value: "refused", title: "No quisieron recibirlo" },
  { value: "cannot_pay", title: "No tenían el efectivo completo" },
  { value: "unsafe", title: "No era seguro entregar" },
  { value: "damaged", title: "El paquete se dañó" },
  { value: "other", title: "Otro motivo" },
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number]["value"];

export const reasonTitle = (value: string | null | undefined) =>
  FAILURE_REASONS.find((reason) => reason.value === value)?.title ?? "Otro motivo";

export const isOpen = (stop: Pick<DriverStop, "status">) =>
  stop.status === "pending" || stop.status === "arrived";

export const parcels = (count: number) => `${count} ${count === 1 ? "bulto" : "bultos"}`;

/** A stop as shown: with what the phone has not sent yet applied on top. */
export type ShownStop = DriverStop & { unsent: boolean };
export type ShownRoute = Omit<DriverRoute, "stops"> & { stops: ShownStop[] };

/** What the queue holds that changes how a stop reads. */
export interface QueuedStopAction {
  kind: "arrive" | "fail";
  stopId: string;
  reason?: string;
}

/**
 * The day as the driver should see it: the server's answer with the actions
 * still waiting in the queue applied, so an arrival or a failed delivery
 * taken without signal reads as done (and marked "por enviar").
 */
export function withQueued(day: DriverDay, queued: QueuedStopAction[]): ShownRoute[] {
  return day.routes.map((route) => ({
    ...route,
    stops: route.stops.map((stop): ShownStop => {
      let shown: ShownStop = { ...stop, unsent: false };
      for (const action of queued) {
        if (action.stopId !== stop.stop_id || !isOpen(shown)) continue;
        if (action.kind === "arrive" && shown.status === "pending") {
          shown = { ...shown, status: "arrived", unsent: true };
        } else if (action.kind === "fail") {
          shown = {
            ...shown,
            status: "failed",
            failure_reason: action.reason ?? "other",
            unsent: true,
          };
        }
      }
      return shown;
    }),
  }));
}

/**
 * The part of the day worth keeping on the phone for a dead zone, and no
 * more: the routes still to be driven (assigned or in progress), and for
 * stops already closed on the server no phone number, since nobody needs to
 * call a customer whose parcel is delivered or on its way back. Finished and
 * cancelled routes, which driver_today returns for a day, are shown while
 * there is signal but never written to the phone.
 */
export function keptOnPhone(day: DriverDay): DriverDay {
  return {
    ...day,
    routes: day.routes
      .filter((route) => route.status === "assigned" || route.status === "in_progress")
      .map((route) => ({
        ...route,
        stops: route.stops.map((stop) => (isOpen(stop) ? stop : { ...stop, phone: "" })),
      })),
  };
}

/** The next stop to go to: the first open one, skipping those left for later. */
export function nextStop(route: ShownRoute, later: ReadonlySet<string> = new Set()) {
  const open = route.stops.filter(isOpen);
  return open.find((stop) => !later.has(stop.stop_id)) ?? open[0];
}

export interface RouteSummary {
  delivered: number;
  total: number;
  open: number;
  packages: number;
  /** In progress with every stop closed (some perhaps still to be sent), or completed. */
  finished: boolean;
}

export function summarise(route: ShownRoute): RouteSummary {
  const open = route.stops.filter(isOpen).length;
  return {
    delivered: route.stops.filter((stop) => stop.status === "delivered").length,
    total: route.stops.length,
    open,
    packages: route.stops.reduce((sum, stop) => sum + stop.package_count, 0),
    finished: route.status === "completed" || (route.status === "in_progress" && open === 0),
  };
}

/** A route on which position sharing belongs: started, with a stop still to visit. */
export const needsTracking = (routes: ShownRoute[]) =>
  routes.some((route) => route.status === "in_progress" && route.stops.some(isOpen));

/** Where a stop sits: its route and itself. */
export function findStop(routes: ShownRoute[], stopId: string) {
  for (const route of routes) {
    const stop = route.stops.find((candidate) => candidate.stop_id === stopId);
    if (stop) return { route, stop };
  }
  return null;
}

/**
 * Counting cash at the door. The server takes only the exact amount due; a
 * driver carries a small float for change (logistics playbook, "Cash on
 * delivery"). So the driver types what the customer hands over, the phone
 * says how much change to give, and what is recorded as collected is the
 * amount due.
 */
export type CashCount =
  | { state: "empty" }
  | { state: "invalid"; message: string }
  | { state: "short"; message: string }
  | {
      state: "ok";
      collectedMinor: number;
      changeMinor: number;
      message: string;
      /** So much change that a typing slip is likelier than a real payment: confirm first. */
      confirm: boolean;
    };

/**
 * Change above this asks the driver to confirm the amount first: a 0 too
 * many outdoors is easy to type, and it is more than the float a driver
 * carries (the playbook proposes ₡20 000).
 */
export const CONFIRM_CHANGE_ABOVE_MINOR = 2_000_000;

export function countCash(dueMinor: number, typed: string): CashCount {
  if (typed.trim() === "") return { state: "empty" };
  const handed = parseColones(typed);
  if (handed === null) return { state: "invalid", message: "Escriba cuánto efectivo recibió." };
  // Cash is counted in whole colones: no coin smaller than ₡5 circulates.
  if (handed % 100 !== 0) {
    return { state: "invalid", message: "Escriba el monto en colones, sin céntimos." };
  }
  if (handed < dueMinor) {
    return {
      state: "short",
      message: `Faltan ${formatPrice(dueMinor - handed)}. Sin el monto completo no se entrega.`,
    };
  }
  const change = handed - dueMinor;
  const confirm = change > CONFIRM_CHANGE_ABOVE_MINOR;
  return {
    state: "ok",
    collectedMinor: dueMinor,
    changeMinor: change,
    confirm,
    message:
      change === 0
        ? "Monto exacto: no hay vuelto."
        : confirm
          ? `Dé ${formatPrice(change)} de vuelto. Es mucho vuelto: revise que el monto recibido esté bien escrito.`
          : `Dé ${formatPrice(change)} de vuelto.`,
  };
}

/** The web's checks before the code goes to the server, with its words. */
export function checkDelivery(input: {
  pin: string;
  recipientName: string;
  cash: CashCount | null;
  /** The driver confirmed a large amount of change (see CashCount.confirm). */
  cashConfirmed?: boolean;
}): string | null {
  if (input.pin.replace(/\D/g, "").length !== 4) return "Pídale al cliente su código de 4 dígitos.";
  if (input.recipientName.trim().length < 3) return "Escriba el nombre de quien recibe.";
  if (input.cash) {
    if (input.cash.state === "empty") return "Escriba cuánto efectivo recibió.";
    if (input.cash.state === "invalid" || input.cash.state === "short") return input.cash.message;
    if (input.cash.confirm && !input.cashConfirmed) {
      return "Confirme el monto que recibió antes de entregar.";
    }
  }
  return null;
}

/**
 * A locked code: after five wrong codes on an ORDER (counted across its
 * parcels, stops and routes) the database refuses every code, the right one
 * included, until Central releases it, which gives the shopper a new code.
 */
export const LOCKED_CODE_MESSAGE =
  "El código de este pedido quedó bloqueado por demasiados intentos. No entregue el paquete. Llame a Central: si lo desbloquean, el cliente verá un código nuevo en su pedido; si no, márquelo como no entregado.";

/** What the driver is told for each door-side refusal of `driver_complete_stop`. */
export function refusalMessage(result: {
  error: "wrong_pin" | "pin_locked" | "cod_amount_mismatch" | "recipient_required";
  attempts_left?: number;
  expected_minor?: number;
}): string {
  switch (result.error) {
    case "wrong_pin":
      // The last attempt used up: say the same as the lock, not "Quedan 0 intentos".
      if (result.attempts_left === 0) return refusalMessage({ error: "pin_locked" });
      return `Ese código no es. ${
        result.attempts_left === 1
          ? "Queda 1 intento"
          : `Quedan ${result.attempts_left ?? 0} intentos`
      }. Pídale al cliente que lo lea de su pedido.`;
    case "pin_locked":
      return LOCKED_CODE_MESSAGE;
    case "cod_amount_mismatch":
      return `Debe cobrar exactamente ${formatPrice(result.expected_minor ?? 0)}. Sin el monto completo no se entrega.`;
    case "recipient_required":
      return "Escriba el nombre de quien recibe.";
  }
}

/**
 * The notice above the code field. The attempts are the order's, so wrong
 * codes typed at another parcel of the same order count too.
 */
export function attemptsNotice(left: number): string | null {
  if (left > 2) return null;
  if (left === 0) return LOCKED_CODE_MESSAGE;
  return left === 1
    ? "Le queda 1 intento de código para este pedido."
    : `Le quedan ${left} intentos de código para este pedido.`;
}

/** The phone's maps app, for directions to a point. */
export function directionsUrl(lat: number, lng: number, os: string): string {
  if (os === "ios") return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
  // Android hands a geo: address to whichever maps app the driver uses.
  if (os === "android") return `geo:${lat},${lng}?q=${lat},${lng}`;
  return googleMapsUrl(lat, lng);
}

export const googleMapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

export const wazeUrl = (lat: number, lng: number) =>
  `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;

export const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
