import {
  type OrderStatus,
  type ShipmentStatus,
  statusLabels,
  statusWord,
  statusWordMap,
} from "@yuntera/core";
import type { SellerListing, SellerOverview, SellerPayouts } from "@yuntera/db";
import type { Tone } from "@yuntera/expo-kit/theme";

/**
 * How the app words each state, in the seller centre's words
 * (apps/seller/src/lib/labels.ts and the pages that define their own) and the
 * shop's status colours (packages/ui/src/commerce.tsx). Status words come
 * from packages/core status-words (§4.3), as a seller reads them. The word is
 * always shown; colour is never the only signal.
 */

type Labelled = { label: string; tone: Tone };

export const PRODUCT_STATUS: Record<SellerListing["product_status"], Labelled> = statusLabels(
  "product_status",
  "seller",
  {
    draft: "neutral",
    pending_review: "warning",
    active: "success",
    rejected: "danger",
    archived: "neutral",
  },
);

export const SELLER_HEALTH: Record<SellerOverview["seller"]["health"], Labelled> = {
  excelente: { label: "Excelente", tone: "success" },
  bien: { label: "Bien", tone: "info" },
  en_riesgo: { label: "En riesgo", tone: "warning" },
  critico: { label: "Crítico", tone: "danger" },
};

export const SHOP_STATUS: Record<SellerOverview["seller"]["status"], Labelled> = statusLabels(
  "seller_status",
  "seller",
  { pending: "warning", active: "success", suspended: "danger", closed: "neutral" },
);

export const KYC_STATUS: Record<SellerOverview["account"]["kyc_status"], Labelled> = statusLabels(
  "kyc_status",
  "seller",
  { pending: "warning", verified: "success", rejected: "danger" },
);

export const FULFILLMENT_LABEL: Record<SellerListing["fulfillment"], string> = {
  platform: "Yuntera almacena y despacha",
  seller: "Usted despacha, Yuntera entrega",
};

export const INBOUND_STATUS: Record<string, Labelled> = statusLabels("inbound_status", "seller", {
  draft: "neutral",
  in_transit: "info",
  receiving: "warning",
  received: "success",
  closed: "neutral",
  cancelled: "neutral",
});

export const PAYOUT_STATUS: Record<SellerPayouts["payouts"][number]["status"], Labelled> =
  statusLabels("payouts", "seller", { scheduled: "info", paid: "success", failed: "danger" });

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

/** An order's status as a seller reads it («Por preparar», not «Pedido confirmado»). */
export const orderLabel = (status: OrderStatus) =>
  statusWord("order_status", status, { viewer: "seller" }).word;

/** A parcel's words as a seller reads them. */
export const SHIPMENT_STATUS_LABEL: Readonly<Record<ShipmentStatus, string>> = statusWordMap(
  "shipment_status",
  "seller",
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
