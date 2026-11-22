import type { GatewayRefundStatus, PaymentReviewKind, PaymentsMode } from "@yuntera/db";
import type { Tone } from "@yuntera/ui";

export const MODE: Record<PaymentsMode, { label: string; text: string }> = {
  sandbox: {
    label: "Simulación",
    text: "Nada pasa por el procesador: un botón simula cada pago. Solo para el sitio de prueba.",
  },
  test: {
    label: "Pruebas del procesador",
    text: "Los pagos pasan por el entorno de pruebas del procesador, con tarjetas y números de prueba. No se mueve dinero real.",
  },
  live: {
    label: "Real",
    text: "Los pagos y reembolsos pasan por el procesador con dinero real.",
  },
};

export const REVIEW_KIND: Record<PaymentReviewKind, { label: string; text: string }> = {
  unknown_reference: {
    label: "Pago sin intento conocido",
    text: "El procesador cobró algo que no corresponde a ningún intento registrado.",
  },
  amount_mismatch: {
    label: "Monto distinto",
    text: "Llegó un monto distinto al del pedido. No se aplicó.",
  },
  currency_mismatch: {
    label: "Moneda distinta",
    text: "Llegó en otra moneda. No se aplicó.",
  },
  late: {
    label: "Llegó tarde",
    text: "El pago llegó cuando el pedido ya estaba cancelado o vencido.",
  },
  paid_twice: {
    label: "Pagado dos veces",
    text: "El pedido ya estaba pagado y llegó otro pago.",
  },
  unmatched_transfer: {
    label: "Transferencia sin pedido",
    text: "Una transferencia SINPE Móvil que el procesador no pudo asociar (por ejemplo, desde otra cuenta).",
  },
  unknown_refund: {
    label: "Reembolso no solicitado",
    text: "El procesador reporta un reembolso que el sistema no pidió (¿hecho a mano en su panel?).",
  },
  dispute: {
    label: "Contracargo",
    text: "El banco del cliente disputa el cobro. Responda en el panel del procesador antes del plazo.",
  },
};

export const REFUND_STATUS: Record<GatewayRefundStatus, { label: string; tone: Tone }> = {
  requested: { label: "Solicitado", tone: "warning" },
  sending: { label: "Enviándose", tone: "info" },
  sent: { label: "Enviado, sin confirmar", tone: "info" },
  unknown: { label: "Respuesta perdida: se verifica", tone: "warning" },
  succeeded: { label: "Completado", tone: "success" },
  failed: { label: "Falló", tone: "danger" },
};

export const REFUND_CHANNEL: Record<string, string> = {
  gateway: "Por el procesador",
  transfer: "Transferencia de finanzas",
  simulated: "Simulado",
};

export const REFUND_REASON: Record<string, string> = {
  order_cancelled: "Pedido cancelado",
  return: "Devolución",
  parcel_returned: "Paquete devuelto",
  review: "Pago por revisar",
};

export const EVENT_OUTCOME: Record<string, string> = {
  applied: "Aplicados",
  duplicate: "Repetidos (sin efecto)",
  stale: "Viejos (sin efecto)",
  ignored: "Ignorados",
  unmatched: "Sin coincidencia",
  mismatch: "No coinciden",
  late: "Tarde",
  paid_twice: "Pagado dos veces",
  wrong_mode: "De otro entorno",
  recorded: "Registrados",
  received: "Recibidos",
};
