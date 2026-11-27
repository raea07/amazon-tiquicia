import {
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type ShipmentStatus,
  statusWordMap,
} from "@yuntera/core";
import type { Tone } from "@yuntera/expo-kit/theme";

/**
 * Status words and their colours, as the website shows them to the shopper.
 * The words come from packages/core status-words (§4.3); the colours match
 * packages/ui/src/commerce.tsx. The colour is never the only signal: the word
 * is always shown.
 */

export const ORDER_TONE: Record<OrderStatus, Tone> = {
  pending_payment: "warning",
  payment_review: "warning",
  confirmed: "info",
  processing: "info",
  partially_shipped: "info",
  shipped: "info",
  delivered: "success",
  completed: "success",
  cancelled: "neutral",
  refunded: "neutral",
};

export const orderLabel = (status: OrderStatus) => ORDER_STATUS_LABEL[status]["es-CR"];

/** A parcel's words as the shopper reads them (packages/core status-words). */
export const SHIPMENT_STATUS_LABEL: Readonly<Record<ShipmentStatus, string>> = statusWordMap(
  "shipment_status",
  "shopper",
);

export const SHIPMENT_TONE: Record<ShipmentStatus, Tone> = {
  pending: "neutral",
  picking: "info",
  packed: "info",
  ready_for_dispatch: "info",
  out_for_delivery: "info",
  delivered: "success",
  delivery_failed: "danger",
  returning: "warning",
  returned: "neutral",
  cancelled: "neutral",
};

export const PAYMENT_LABEL = {
  card: "Tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "Efectivo contra entrega",
  bank_transfer: "Transferencia",
} as const;
