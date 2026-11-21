/**
 * Order and shipment lifecycles as explicit state machines.
 *
 * The database enforces the same transitions with a trigger (see the
 * `enforce_*_transition` functions); this copy lets every client show only the
 * actions that are valid and lets tests assert the two never drift.
 */

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
  packed: ["ready_for_dispatch", "cancelled"],
  ready_for_dispatch: ["out_for_delivery", "cancelled"],
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
  const dispatched = live.filter((s) =>
    ["out_for_delivery", "delivered", "delivery_failed", "returning", "returned"].includes(s),
  ).length;

  if (delivered === live.length) return "delivered";
  if (dispatched === live.length) return "shipped";
  if (dispatched > 0) return "partially_shipped";
  if (live.some((s) => s !== "pending")) return "processing";
  return current === "confirmed" ? "confirmed" : "processing";
}

/** Buyer-facing wording. Statuses are internal; customers read sentences. */
export const ORDER_STATUS_LABEL: Readonly<Record<OrderStatus, { "es-CR": string; en: string }>> = {
  pending_payment: { "es-CR": "Esperando el pago", en: "Awaiting payment" },
  payment_review: { "es-CR": "Verificando el pago", en: "Verifying payment" },
  confirmed: { "es-CR": "Pedido confirmado", en: "Order confirmed" },
  processing: { "es-CR": "Preparando su pedido", en: "Preparing your order" },
  partially_shipped: {
    "es-CR": "Parte del pedido va en camino",
    en: "Part of your order is on its way",
  },
  shipped: { "es-CR": "En camino", en: "On its way" },
  delivered: { "es-CR": "Entregado", en: "Delivered" },
  completed: { "es-CR": "Completado", en: "Completed" },
  cancelled: { "es-CR": "Cancelado", en: "Cancelled" },
  refunded: { "es-CR": "Reembolsado", en: "Refunded" },
};
