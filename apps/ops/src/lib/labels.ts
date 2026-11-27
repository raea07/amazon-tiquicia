import { statusLabels, statusWordMap } from "@yuntera/core";
import type { Tone } from "@yuntera/ui";

/**
 * How the console words each state. One place, so screens agree. The status
 * words come from packages/core status-words (§4.3), as staff read them; the
 * colours stay here until the status stamp replaces the badge.
 */

/** An order's status as staff read it («Por preparar», not «Pedido confirmado»). */
export const ORDER_STATUS_STAFF = statusWordMap("order_status", "staff");

/** The cash a driver hands in at the end of a route. */
export const SETTLEMENT_STATUS: Readonly<Record<string, string>> = statusWordMap(
  "driver_settlements",
  "staff",
);

/** A shopper's complaint. */
export const COMPLAINT_STATUS: Readonly<Record<string, string>> = statusWordMap(
  "complaints",
  "staff",
);

export const STAFF_ROLE: Record<string, string> = {
  admin: "Administración",
  ops: "Operaciones",
  support: "Atención al cliente",
  finance: "Finanzas",
  catalog: "Catálogo",
};

export const PAYMENT_METHOD: Record<string, string> = {
  card: "Tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "Contra entrega",
  bank_transfer: "Transferencia",
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "payment_status",
  "staff",
  {
    pending: "warning",
    authorized: "info",
    captured: "success",
    failed: "danger",
    cancelled: "neutral",
    refunded: "neutral",
    partially_refunded: "neutral",
  },
);

export const SELLER_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "seller_status",
  "staff",
  { pending: "warning", active: "success", suspended: "danger", closed: "neutral" },
);

export const DRIVER_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "driver_status",
  "staff",
  { pending: "warning", active: "success", suspended: "danger", offboarded: "neutral" },
);

export const ROUTE_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "route_status",
  "staff",
  {
    draft: "warning",
    assigned: "info",
    in_progress: "info",
    completed: "success",
    cancelled: "neutral",
  },
);

export const STOP_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "stop_status",
  "staff",
  {
    pending: "neutral",
    arrived: "info",
    delivered: "success",
    failed: "danger",
    skipped: "neutral",
  },
);

export const VEHICLE: Record<string, string> = {
  motorcycle: "Moto",
  car: "Carro",
  van: "Microbús de carga",
  bicycle: "Bicicleta",
};

export const RETURN_KIND: Record<string, string> = {
  withdrawal: "Retracto (sin motivo)",
  warranty: "Garantía",
  damaged: "Llegó dañado",
  wrong_item: "Producto equivocado",
};

export const RETURN_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "return_requests",
  "staff",
  { requested: "warning", approved: "info", received: "info" },
);

export const COMPLAINT_CATEGORY: Record<string, string> = {
  delivery: "Entrega",
  product: "Producto",
  payment: "Pago",
  seller: "Vendedor",
  privacy: "Datos personales",
  other: "Otro",
};

export const REPORT_REASON: Record<string, string> = {
  illegal_product: "Producto ilegal",
  counterfeit: "Falsificación",
  unsafe: "Inseguro",
  misleading: "Engañoso",
  intellectual_property: "Propiedad intelectual",
  abuse: "Abuso",
  other: "Otro",
};

export const FAILURE_REASON: Record<string, string> = {
  nobody_home: "No había nadie",
  wrong_address: "Dirección incorrecta",
  refused: "Lo rechazaron",
  cannot_pay: "No tenían el efectivo",
  unsafe: "Zona insegura",
  damaged: "Paquete dañado",
  other: "Otro",
};
