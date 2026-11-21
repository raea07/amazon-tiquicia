import type { SellerListing, SellerOverview } from "@yuntera/db";
import type { Tone } from "@yuntera/ui";

/** How the seller centre words each state. One place, so screens agree. */

export const PRODUCT_STATUS: Record<
  SellerListing["product_status"],
  { label: string; tone: Tone }
> = {
  draft: { label: "Borrador", tone: "neutral" },
  pending_review: { label: "En revisión", tone: "warning" },
  active: { label: "Publicado", tone: "success" },
  rejected: { label: "Rechazado", tone: "danger" },
  archived: { label: "Archivado", tone: "neutral" },
};

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

export const INBOUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  in_transit: { label: "En camino a la bodega", tone: "info" },
  receiving: { label: "Recibiéndose", tone: "warning" },
  received: { label: "Recibido", tone: "success" },
  closed: { label: "Cerrado", tone: "neutral" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};
