import { statusLabels } from "@yuntera/core";
import type { SellerListing, SellerOverview } from "@yuntera/db";
import type { Tone } from "@yuntera/ui";

/**
 * How the seller centre words each state. One place, so screens agree. Status
 * words come from packages/core status-words (§4.3), as a seller reads them.
 */

export const PRODUCT_STATUS: Record<
  SellerListing["product_status"],
  { label: string; tone: Tone }
> = statusLabels("product_status", "seller", {
  draft: "neutral",
  pending_review: "warning",
  active: "success",
  rejected: "danger",
  archived: "neutral",
});

export const SELLER_HEALTH: Record<
  SellerOverview["seller"]["health"],
  { label: string; tone: Tone }
> = {
  excelente: { label: "Excelente", tone: "success" },
  bien: { label: "Bien", tone: "info" },
  en_riesgo: { label: "En riesgo", tone: "warning" },
  critico: { label: "Crítico", tone: "danger" },
};

export const FULFILLMENT_LABEL: Record<SellerListing["fulfillment"], string> = {
  platform: "Yuntera almacena y despacha",
  seller: "Usted despacha, Yuntera entrega",
};

export const INBOUND_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "inbound_status",
  "seller",
  {
    draft: "neutral",
    in_transit: "info",
    receiving: "warning",
    received: "success",
    closed: "neutral",
    cancelled: "neutral",
  },
);
