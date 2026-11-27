import type { NotificationRow } from "@yuntera/db";
import type { Tone } from "@yuntera/ui";

/** How the console names each message. The body is never shown here. */
export const TEMPLATE: Record<string, string> = {
  order_placed: "Pedido recibido",
  payment_received: "Pago recibido",
  shipment_scheduled: "Fecha de entrega",
  shipment_out_for_delivery: "Va en camino",
  shipment_delivered: "Entregado",
  shipment_delivery_failed: "Entrega fallida",
  order_cancelled: "Pedido cancelado",
  refund_initiated: "Reembolso iniciado",
  refund_completed: "Reembolso hecho",
  return_received: "Devolución recibida",
  return_approved: "Devolución aprobada",
  return_rejected: "Devolución no aprobada",
  complaint_received: "Reclamo recibido",
  complaint_answered: "Reclamo respondido",
  case_answered: "Caso respondido",
  report_resolved: "Reporte revisado",
  seller_new_order: "Pedido nuevo (tienda)",
  seller_order_cancelled: "Pedido cancelado (tienda)",
  seller_listing_approved: "Producto publicado",
  seller_listing_rejected: "Producto con cambios",
  seller_account_status: "Estado de la tienda",
  driver_route_assigned: "Ruta asignada",
  staff_payment_to_confirm: "Pago por confirmar",
  staff_delivery_failed: "Entrega fallida (equipo)",
  staff_return_requested: "Devolución (equipo)",
  staff_complaint_filed: "Reclamo (equipo)",
  staff_content_reported: "Contenido reportado",
};

export const CHANNEL: Record<string, string> = {
  email: "Correo",
  whatsapp: "WhatsApp",
  sms: "SMS",
  push: "Notificación",
};

const TEAM: Record<string, string> = {
  finance: "finanzas",
  ops: "operaciones",
  support: "atención",
  trust: "confianza",
};

export function audienceOf(row: NotificationRow): string {
  switch (row.audience) {
    case "shopper":
      return "Cliente";
    case "seller":
      return row.seller_name ? `Tienda ${row.seller_name}` : "Tienda";
    case "driver":
      return "Repartidor";
    case "reporter":
      return "Quien reportó";
    case "staff":
      return `Equipo de ${TEAM[row.team ?? ""] ?? "Yuntera"}`;
  }
}

export const NOTIFICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "En cola", tone: "neutral" },
  sending: { label: "Enviando", tone: "info" },
  sent: { label: "Enviado", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  failed: { label: "No entregado", tone: "danger" },
  skipped: { label: "No se envió", tone: "neutral" },
  expired: { label: "Vencido", tone: "neutral" },
  dead: { label: "Detenido", tone: "danger" },
};

/** Why a message was not sent, in words staff can act on. */
export const SKIP_REASON: Record<string, string> = {
  no_address: "sin dirección o número",
  channel_off: "la persona lo desactivó",
  no_device: "sin teléfono registrado",
  no_commercial_consent: "sin consentimiento para publicidad",
  suppressed_hard_bounce: "el correo rebota",
  suppressed_manual: "dirección bloqueada",
  suppressed_opt_out: "la persona pidió no recibir más",
  no_recipient: "la cuenta ya no existe",
  DeviceNotRegistered: "la aplicación ya no está instalada",
};

/** What went wrong, in words; the raw provider code is never shown. */
export function failureOf(code: string | null): string {
  if (!code) return "no se pudo entregar";
  if (code === "render_failed") return "no se pudo preparar el mensaje; avise al equipo técnico";
  if (/^bounce|bounced/.test(code)) return "el correo rebotó";
  if (/^(401|403|412|421)\b|no_api_key|no_sender|no_adapter/.test(code)) {
    return "falta configurar el proveedor de mensajes";
  }
  if (/^402\b|quota_exceeded|insufficient_balance/.test(code))
    return "no hay saldo en el proveedor";
  if (/^(400|404|409|422)\b|rejected|recipient/.test(code))
    return "el proveedor rechazó el mensaje";
  if (/^(5\d\d|429)\b|timeout|network|lease_expired|worker_error|TypeError/.test(code)) {
    return "el proveedor no respondió a tiempo";
  }
  if (code === "no_template" || code === "commercial_frame_required")
    return "no hay plantilla para este canal";
  if (/undeliver|expired/.test(code)) return "no llegó a la persona";
  return "no se pudo entregar";
}
