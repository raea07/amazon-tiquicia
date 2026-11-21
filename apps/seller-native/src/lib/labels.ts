import { ORDER_STATUS_LABEL, type OrderStatus, type ShipmentStatus } from "@yuntera/core";
import type { SellerListing, SellerOverview, SellerPayouts } from "@yuntera/db";
import type { Tone } from "@yuntera/expo-kit/theme";

/**
 * How the app words each state, in the seller centre's words
 * (apps/seller/src/lib/labels.ts and the pages that define their own) and the
 * shop's status colours (packages/ui/src/commerce.tsx). The word is always
 * shown; colour is never the only signal.
 */

type Labelled = { label: string; tone: Tone };

export const PRODUCT_STATUS: Record<SellerListing["product_status"], Labelled> = {
  draft: { label: "Borrador", tone: "neutral" },
  pending_review: { label: "En revisión", tone: "warning" },
  active: { label: "Publicado", tone: "success" },
  rejected: { label: "Rechazado", tone: "danger" },
  archived: { label: "Archivado", tone: "neutral" },
};

export const SELLER_HEALTH: Record<SellerOverview["seller"]["health"], Labelled> = {
  excelente: { label: "Excelente", tone: "success" },
  bien: { label: "Bien", tone: "info" },
  en_riesgo: { label: "En riesgo", tone: "warning" },
  critico: { label: "Crítico", tone: "danger" },
};

export const SHOP_STATUS: Record<SellerOverview["seller"]["status"], Labelled> = {
  pending: { label: "En revisión", tone: "warning" },
  active: { label: "Activa", tone: "success" },
  suspended: { label: "Suspendida", tone: "danger" },
  closed: { label: "Cerrada", tone: "neutral" },
};

export const KYC_STATUS: Record<SellerOverview["account"]["kyc_status"], Labelled> = {
  pending: { label: "En verificación", tone: "warning" },
  verified: { label: "Verificada", tone: "success" },
  rejected: { label: "No verificada", tone: "danger" },
};

export const FULFILLMENT_LABEL: Record<SellerListing["fulfillment"], string> = {
  platform: "Yuntera almacena y despacha",
  seller: "Usted despacha, Yuntera entrega",
};

export const INBOUND_STATUS: Record<string, Labelled> = {
  draft: { label: "Borrador", tone: "neutral" },
  in_transit: { label: "En camino a la bodega", tone: "info" },
  receiving: { label: "Recibiéndose", tone: "warning" },
  received: { label: "Recibido", tone: "success" },
  closed: { label: "Cerrado", tone: "neutral" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

export const PAYOUT_STATUS: Record<SellerPayouts["payouts"][number]["status"], Labelled> = {
  scheduled: { label: "En camino a su cuenta", tone: "info" },
  paid: { label: "Pagado", tone: "success" },
  failed: { label: "No se pudo pagar", tone: "danger" },
};

export const PAYMENT_METHOD: Record<string, string> = {
  card: "Tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "Contra entrega",
  bank_transfer: "Transferencia",
};

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
