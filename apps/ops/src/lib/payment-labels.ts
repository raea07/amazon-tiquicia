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
  wrong_environment: {
    label: "De otro entorno",
    text: "Se pagó en el entorno del procesador que el modo de pagos ya había dejado (por ejemplo, una página abierta antes del cambio). No se aplicó solo.",
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
  wrong_mode: "De otro entorno (sin efecto)",
  wrong_environment: "De otro entorno (por revisar)",
  recorded: "Registrados",
  received: "Recibidos",
};

/** Where an attempt at the gateway stands, in words (never the status code). */
export const ATTEMPT_STATUS: Record<string, string> = {
  creating: "preparándose",
  open: "página de pago abierta",
  processing: "esperando la confirmación",
  failed: "rechazado",
  succeeded: "pagado",
  review: "dinero por revisar",
  cancel_requested: "deteniéndose",
  cancelled: "detenido",
  expired: "vencido",
  error: "no se pudo preparar",
};

/** Why the gateway declined a payment or refused a refund, in words. */
export const GATEWAY_FAILURE: Record<string, string> = {
  declined: "el banco no lo aprobó",
  authentication_failed: "no se completó la verificación del banco",
  insufficient_funds: "fondos insuficientes",
  expired_card: "tarjeta vencida",
  merchant_cannot_process: "el procesador no puede procesarlo",
  refused: "el procesador lo rechazó",
  send_unconfirmed:
    "no se supo si llegó al procesador: revise su panel antes de enviarlo otra vez o transferirlo",
  create_unconfirmed: "no se supo si el procesador lo creó",
  create_failed: "el procesador no lo creó",
  timeout: "el procesador no respondió a tiempo",
};

export const gatewayFailure = (code: string | null | undefined) =>
  code ? (GATEWAY_FAILURE[code] ?? "el procesador no dio el motivo") : null;
