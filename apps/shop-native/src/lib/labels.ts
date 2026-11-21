import { ORDER_STATUS_LABEL, type OrderStatus, type ShipmentStatus } from "@yuntera/core";
import type { Tone } from "@yuntera/expo-kit/theme";

/**
 * Status words and their colours, as the website shows them
 * (packages/ui/src/commerce.tsx; `labels.test.ts` compares the two). The
 * colour is never the only signal: the word is always shown.
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

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: "Por preparar",
  picking: "En preparación",
  packed: "Empacado",
  ready_for_dispatch: "Listo para salir",
  out_for_delivery: "En camino",
  delivered: "Entregado",
  delivery_failed: "Entrega fallida",
  returning: "De regreso",
  returned: "Devuelto",
  cancelled: "Cancelado",
};

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
