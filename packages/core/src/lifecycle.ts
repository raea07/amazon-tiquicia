/**
 * Order and shipment lifecycles as explicit state machines.
 *
 * The database enforces the same transitions with a trigger (see the
 * `enforce_*_transition` functions); this copy lets every client show only the
 * actions that are valid and lets tests assert the two never drift.
 */

import { statusWord } from "./status-words";

export const ORDER_STATUSES = [
  "pending_payment",
  "payment_review",
  "confirmed",
  "processing",
  "partially_shipped",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ["payment_review", "confirmed", "cancelled"],
  payment_review: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["partially_shipped", "shipped", "cancelled"],
  // Cancelled from here only when every parcel came back without being
  // delivered (wms_receive_returned_shipment); nobody can ask for it.
  partially_shipped: ["shipped", "delivered", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: ["completed", "refunded"],
  completed: ["refunded"],
  cancelled: ["refunded"],
  refunded: [],
};

export const SHIPMENT_STATUSES = [
  "pending",
  "picking",
  "packed",
  "ready_for_dispatch",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returning",
  "returned",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  pending: ["picking", "cancelled"],
  picking: ["packed", "pending", "cancelled"],
  // Back to the shelves (returning) when staff stop it before it left
  // (ops_recall_shipment).
  packed: ["ready_for_dispatch", "returning", "cancelled"],
  // Back to packed when dispatch takes it off a route before it left; to the
  // shelves when staff stop it on a route that has not started.
  ready_for_dispatch: ["out_for_delivery", "packed", "returning", "cancelled"],
  out_for_delivery: ["delivered", "delivery_failed"],
  // A failed attempt is retried or the parcel starts its way back.
  delivery_failed: ["ready_for_dispatch", "returning"],
  delivered: [],
  returning: ["returned"],
  returned: [],
  cancelled: [],
};

export function canTransition<S extends string>(
  table: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  return table[from]?.includes(to) ?? false;
}

export const canOrderTransition = (from: OrderStatus, to: OrderStatus) =>
  canTransition(ORDER_TRANSITIONS, from, to);

export const canShipmentTransition = (from: ShipmentStatus, to: ShipmentStatus) =>
  canTransition(SHIPMENT_TRANSITIONS, from, to);

/** States from which nothing further can happen. */
export function terminalStates<S extends string>(table: Readonly<Record<S, readonly S[]>>): S[] {
  return (Object.keys(table) as S[]).filter((s) => table[s].length === 0);
}

/**
 * Derives the order status implied by its shipments. Payment states are owned
 * by the payment flow and are never overridden here.
 */
export function orderStatusFromShipments(
  current: OrderStatus,
  shipments: readonly ShipmentStatus[],
): OrderStatus {
  const paymentOwned: OrderStatus[] = [
    "pending_payment",
    "payment_review",
    "cancelled",
    "refunded",
    "completed",
  ];
  if (paymentOwned.includes(current) || shipments.length === 0) return current;

  const live = shipments.filter((s) => s !== "cancelled");
  if (live.length === 0) return current;

  const delivered = live.filter((s) => s === "delivered").length;
  // Every parcel has ended: delivered, or back at the warehouse undelivered.
  // With at least one delivered, nothing more can happen to the order.
  const ended = live.filter((s) => s === "delivered" || s === "returned").length;
  const dispatched = live.filter((s) =>
    ["out_for_delivery", "delivered", "delivery_failed", "returning", "returned"].includes(s),
  ).length;

  let target: OrderStatus;
  if (delivered > 0 && ended === live.length) target = "delivered";
  else if (dispatched === live.length) target = "shipped";
  else if (dispatched > 0) target = "partially_shipped";
  else if (live.some((s) => s !== "pending")) target = "processing";
  else target = current === "confirmed" ? "confirmed" : "processing";
  // Never back: a parcel re-planned after a failed attempt and taken off its
  // route again is packed, but the order that went out stays where it is.
  const rank = (status: OrderStatus) => ORDER_PROGRESS.indexOf(status);
  return rank(target) < rank(current) ? current : target;
}

/**
 * The order statuses that follow its parcels, in the order they come
 * (private.sync_order_status has the same list between its markers).
 */
export const ORDER_PROGRESS: readonly OrderStatus[] = [
  "confirmed",
  "processing",
  "partially_shipped",
  "shipped",
  "delivered",
];

/**
 * Buyer-facing wording. Statuses are internal; customers read sentences.
 *
 * The shopper's words of status-words.ts (§4.3 of the design system), in the
 * shape today's callers read. Every other viewer asks `statusWord` with its
 * own viewer.
 */
export const ORDER_STATUS_LABEL: Readonly<Record<OrderStatus, { "es-CR": string; en: string }>> =
  Object.fromEntries(
    ORDER_STATUSES.map((status) => [
      status,
      {
        "es-CR": statusWord("order_status", status, { viewer: "shopper" }).word,
        en: statusWord("order_status", status, { viewer: "shopper", locale: "en" }).word,
      },
    ]),
  ) as Record<OrderStatus, { "es-CR": string; en: string }>;

/**
 * A parcel back at the warehouse's door without anyone having tried to
 * deliver it: staff took its stop off a route while the driver had it
 * (ops_remove_route_stop), which moves it to delivery_failed without counting
 * an attempt. The shopper is told it was rescheduled, not that delivery
 * failed; dispatch sees it was taken off a route.
 */
export function isRescheduledShipment(status: ShipmentStatus, attemptCount: number): boolean {
  return status === "delivery_failed" && attemptCount === 0;
}

/**
 * An order "on its way" (shipped or partly shipped) whose parcels still to
 * deliver were all rescheduled (isRescheduledShipment): none is on its way to
 * the shopper, so the order's heading says "Entrega reprogramada" rather than
 * "En camino". Delivered and cancelled parcels do not count; with no parcel
 * left to deliver, it is not.
 */
export function isRescheduledOrder(
  status: OrderStatus,
  shipments: ReadonlyArray<{ status: ShipmentStatus; attempt_count: number }>,
): boolean {
  if (status !== "shipped" && status !== "partially_shipped") return false;
  const open = shipments.filter((s) => s.status !== "delivered" && s.status !== "cancelled");
  return open.length > 0 && open.every((s) => isRescheduledShipment(s.status, s.attempt_count));
}

/**
 * A parcel staff stopped before it left the warehouse (ops_recall_shipment):
 * it waits to be checked back onto the shelves, and its goods are refunded
 * when the warehouse confirms. Nobody is bringing it to the shopper.
 */
export function isStoppedShipment(status: ShipmentStatus, recalled: boolean): boolean {
  return status === "returning" && recalled;
}

/**
 * An order that is being called off: every parcel still to deliver was
 * stopped before it left (isStoppedShipment), so the order ends cancelled
 * once the warehouse receives them, and its money goes back then. Shown as
 * such instead of "En camino" or "Preparando su pedido". With a parcel
 * delivered (the order is not cancelled then: only the stopped parcel's
 * goods go back), one still on its way, or none left to deliver, it is not.
 */
export function isOrderBeingStopped(
  status: OrderStatus,
  shipments: ReadonlyArray<{ status: ShipmentStatus; recalled?: boolean }>,
): boolean {
  if (!["confirmed", "processing", "partially_shipped", "shipped"].includes(status)) return false;
  if (shipments.some((s) => s.status === "delivered")) return false;
  const open = shipments.filter(
    (s) => s.status !== "delivered" && s.status !== "cancelled" && s.status !== "returned",
  );
  return open.length > 0 && open.every((s) => isStoppedShipment(s.status, s.recalled === true));
}

/**
 * How an order stands while every parcel still to deliver is on its way
 * back to the warehouse (`returning`: staff stopped it, or it was taken off a
 * route or failed at the door and sent back). Nobody is bringing anything to
 * the shopper, so it never reads "En camino", the promised date or the
 * delivery code. `cancels`: nothing of it was delivered, so it ends
 * cancelled when the warehouse receives them (wms_receive_returned_shipment);
 * otherwise only those parcels' goods go back. `stopped`: every such parcel
 * was stopped by staff in the warehouse (isOrderBeingStopped). Null when some
 * parcel may still reach the shopper, or the order has ended.
 */
export function orderComingBack(
  status: OrderStatus,
  shipments: ReadonlyArray<{ status: ShipmentStatus; recalled?: boolean }>,
): { cancels: boolean; stopped: boolean } | null {
  if (!["confirmed", "processing", "partially_shipped", "shipped"].includes(status)) return null;
  const open = shipments.filter(
    (s) => s.status !== "delivered" && s.status !== "cancelled" && s.status !== "returned",
  );
  if (open.length === 0 || !open.every((s) => s.status === "returning")) return null;
  return {
    cancels: !shipments.some((s) => s.status === "delivered"),
    stopped: open.every((s) => s.recalled === true),
  };
}

/**
 * A parcel that went out, came back to the warehouse after a failed attempt,
 * was planned on a new route and then taken off it again by staff
 * (ops_remove_route_stop moves it back to `packed`), or that waits planned
 * on a new route that has not started: it sits in the warehouse and will go
 * out again. Its promised date no longer holds.
 */
export function waitsForNewAttempt(status: ShipmentStatus, attemptCount: number): boolean {
  return (status === "packed" || status === "ready_for_dispatch") && attemptCount > 0;
}

/**
 * How an order "on its way" (shipped or partly shipped) stands when no
 * parcel of it is out for delivery any more and those still to deliver wait
 * in the warehouse to go out again (or come back to it): rescheduled after
 * staff took it off a route (isRescheduledShipment), failed at the door and
 * not yet sent again, or planned again after a failed attempt and taken off
 * that route too (waitsForNewAttempt). Nothing is on its way to the
 * shopper, so the order never reads "En camino" or the old date.
 * `failedAttempt`: some such parcel just failed at the door and waits for
 * the next working day. Null when a parcel is out for delivery, every parcel
 * still to deliver is coming back (orderComingBack says so), one is still
 * being prepared for the first time, or the order has ended. It covers every
 * order isRescheduledOrder covers.
 */
export function orderAwaitingNewAttempt(
  status: OrderStatus,
  shipments: ReadonlyArray<{ status: ShipmentStatus; attempt_count: number }>,
): { failedAttempt: boolean } | null {
  if (status !== "shipped" && status !== "partially_shipped") return null;
  const open = shipments.filter(
    (s) => s.status !== "delivered" && s.status !== "cancelled" && s.status !== "returned",
  );
  if (open.length === 0) return null;
  if (open.some((s) => s.status === "out_for_delivery")) return null;
  if (open.every((s) => s.status === "returning")) return null;
  const waiting = (s: { status: ShipmentStatus; attempt_count: number }) =>
    s.status === "returning" ||
    s.status === "delivery_failed" ||
    waitsForNewAttempt(s.status, s.attempt_count);
  if (!open.every(waiting)) return null;
  return {
    failedAttempt: open.some((s) => s.status === "delivery_failed" && s.attempt_count > 0),
  };
}

/** The shopper's line for such an order, instead of "Llega el …". */
export function awaitingNewAttemptLine(failedAttempt: boolean): string {
  return failedAttempt
    ? "No pudimos entregarlo. Lo intentaremos de nuevo el próximo día hábil."
    : "Reprogramamos la entrega. Le avisaremos cuando vuelva a salir hacia usted.";
}

/**
 * Whether an order that ends cancelled because its parcels came back gets
 * its delivery fee back too: nothing of it was delivered and no parcel ever
 * had an attempt at the shopper's door. A stop staff removed is not an
 * attempt (isRescheduledShipment), nor is a parcel stopped before it left.
 * The database applies the same rule when the warehouse receives the last
 * parcel (wms_receive_returned_shipment, private.order_had_door_attempt,
 * which also reads the stops a driver marked failed; driver_fail_stop counts
 * an attempt on the parcel each time, so the two agree).
 */
export function deliveryFeeComesBack(
  shipments: ReadonlyArray<{ status: ShipmentStatus; attempt_count: number }>,
): boolean {
  return (
    shipments.length > 0 &&
    shipments.every((s) => s.status !== "delivered" && s.attempt_count === 0)
  );
}

/**
 * The sentence that tells a shopper why the delivery fee stays charged when
 * the order is cancelled because its parcels came back (or is being
 * cancelled that way) after a real attempt at the door: the other side of
 * deliveryFeeComesBack. Null when there is nothing to explain: the fee comes
 * back, the order had no delivery fee, or nothing was paid. `fee` is the fee
 * as the screen writes money (for example "₡1 500").
 */
export function deliveryFeeKeptLine(input: {
  shipments: ReadonlyArray<{ status: ShipmentStatus; attempt_count: number }>;
  shippingMinor: number;
  paid: boolean;
  fee: string;
}): string | null {
  if (!input.paid || input.shippingMinor <= 0 || input.shipments.length === 0) return null;
  if (deliveryFeeComesBack(input.shipments)) return null;
  return `El envío (${input.fee}) no se devuelve porque fuimos a entregarlo a su dirección.`;
}
