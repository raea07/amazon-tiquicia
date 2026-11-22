/**
 * Payments through the gateway: what the shopper sees of an order's payment
 * and starts, and what finance works with (payments with their gateway
 * references and fees, money waiting for a decision, refunds on their way, a
 * daily reconciliation, the mode and the expected fees).
 *
 * SQL: supabase/migrations/20261121083400_payments.sql. How staff work with
 * it: docs/06-operations/payments.md. The worker's own functions
 * (`worker_payments_*`) are deliberately not here: only the server-side key
 * can call them, and packages/payments calls them itself.
 */

import { z } from "zod";
import { orderStatus, paymentMethod, paymentStatus } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const money = z.number().int();
const timestamp = z.string().min(10);

export const paymentsMode = z.enum(["sandbox", "test", "live"]);
export type PaymentsMode = z.infer<typeof paymentsMode>;

/**
 * Where an order's payment stands, for the screen to say what to do:
 *   cash         cash on delivery: nothing to pay now
 *   paid         the money arrived
 *   cancelled    the order was cancelled before it was paid
 *   simulated    sandbox: the simulation button
 *   manual       a transfer finance confirms by hand
 *   start        nothing started at the gateway yet (or the last try ended)
 *   preparing    the gateway's page or the transfer is being prepared
 *   pay          card: go to the gateway's page
 *   transfer     SINPE Móvil: send the transfer to the number shown
 *   confirming   back from the gateway's page, waiting for its word
 *   failed       declined; may try again
 *   error        could not be prepared; may try again
 *   review       money arrived but did not match (or came after the order
 *                was cancelled, or in the gateway environment the mode had
 *                left): finance is checking; see `money_in_review`
 */
export const paymentStage = z.enum([
  "cash",
  "paid",
  "cancelled",
  "simulated",
  "manual",
  "start",
  "preparing",
  "pay",
  "transfer",
  "confirming",
  "failed",
  "error",
  "review",
]);
export type PaymentStage = z.infer<typeof paymentStage>;

export const gatewayRefundStatus = z.enum([
  "requested",
  "sending",
  "sent",
  "unknown",
  "succeeded",
  "failed",
]);
export type GatewayRefundStatus = z.infer<typeof gatewayRefundStatus>;
export const refundChannel = z.enum(["gateway", "transfer", "simulated"]);
export type RefundChannel = z.infer<typeof refundChannel>;

export const paymentReviewKind = z.enum([
  "unknown_reference",
  "amount_mismatch",
  "currency_mismatch",
  "late",
  "paid_twice",
  "unmatched_transfer",
  "unknown_refund",
  "wrong_environment",
  "dispute",
]);
export type PaymentReviewKind = z.infer<typeof paymentReviewKind>;

export const paymentReviewStatus = z.enum([
  "open",
  "accepted",
  "attached",
  "refunding",
  "refunded",
  "dismissed",
]);

export const orderPayment = z.object({
  order_id: id,
  order_number: z.string(),
  order_status: orderStatus,
  mode: paymentsMode,
  method: paymentMethod,
  status: paymentStatus,
  provider: z.string(),
  amount_minor: money,
  currency: z.string(),
  stage: paymentStage,
  expires_at: timestamp,
  can_start: z.boolean(),
  attempts_left: z.number().int().nonnegative(),
  manual_confirmation: z.boolean(),
  attempt: z
    .object({
      id,
      status: z.string(),
      method: paymentMethod,
      checkout_url: z.string().nullable(),
      sinpe_destination: z.string().nullable(),
      suggested_description: z.string(),
      failure_code: z.string().nullable(),
      returned: z.boolean(),
      created_at: timestamp,
      /** Staff only; null for the shopper. */
      session_reference: z.string().nullable(),
      intent_reference: z.string().nullable(),
    })
    .nullable(),
  /**
   * Money the gateway took for this order that finance is deciding about
   * (open), or is sending back (refunding, refunded): the shopper paid, so
   * the page says so whatever the order's status. Null when there is none.
   */
  money_in_review: z
    .object({
      kind: paymentReviewKind,
      status: paymentReviewStatus,
      amount_minor: money.nullable(),
      currency: z.string().nullable(),
      created_at: timestamp,
    })
    .nullable(),
  refunds: z.array(
    z.object({
      id,
      amount_minor: money,
      channel: refundChannel,
      status: gatewayRefundStatus,
      requested_at: timestamp,
      completed_at: timestamp.nullable(),
      provider_refund_reference: z.string().nullable(),
      failure_code: z.string().nullable(),
    }),
  ),
});
export type OrderPayment = z.infer<typeof orderPayment>;

/** Whose account pays a SINPE Móvil transfer. The gateway accepts only a transfer from it. */
export interface SinpePayer {
  kind: "national" | "resident" | "legal_entity";
  /** As typed: dashes and spaces are removed. */
  number: string;
  /** Eight digits or +506 and eight digits. */
  phone: string;
}

export const paymentReview = z.object({
  id,
  kind: paymentReviewKind,
  status: paymentReviewStatus,
  provider: z.string(),
  environment: z.string().nullable(),
  order_number: z.string().nullable(),
  order_status: orderStatus.nullable(),
  payment_reference: z.string().nullable(),
  amount_minor: money.nullable(),
  currency: z.string().nullable(),
  detail: z.string().nullable(),
  created_at: timestamp,
  resolved_order_number: z.string().nullable(),
  resolution_note: z.string().nullable(),
  resolved_at: timestamp.nullable(),
  can_refund: z.boolean(),
  can_accept: z.boolean(),
  can_attach: z.boolean(),
  refund: z.object({ status: gatewayRefundStatus, channel: refundChannel }).nullable(),
});
export type PaymentReview = z.infer<typeof paymentReview>;

export const gatewayRefund = z.object({
  id,
  order_number: z.string().nullable(),
  reason: z.enum(["order_cancelled", "return", "parcel_returned", "review"]),
  payment_method: paymentMethod.nullable(),
  channel: refundChannel,
  status: gatewayRefundStatus,
  amount_minor: money,
  currency: z.string(),
  payment_reference: z.string().nullable(),
  provider_refund_reference: z.string().nullable(),
  failure_code: z.string().nullable(),
  send_count: z.number().int().nonnegative(),
  requested_at: timestamp,
  sent_at: timestamp.nullable(),
  completed_at: timestamp.nullable(),
  failed_at: timestamp.nullable(),
  bank_reference: z.string().nullable(),
  can_retry: z.boolean(),
  can_record_transfer: z.boolean(),
});
export type GatewayRefund = z.infer<typeof gatewayRefund>;

export const gatewayPaymentRow = z.object({
  id,
  order_number: z.string(),
  method: paymentMethod,
  provider: z.string(),
  environment: z.string().nullable(),
  status: paymentStatus,
  amount_minor: money,
  currency: z.string(),
  provider_reference: z.string().nullable(),
  gateway_reference: z.string().nullable(),
  session_reference: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  created_at: timestamp,
  captured_at: timestamp.nullable(),
  expected_fee_minor: money.nullable(),
  reported_fee_minor: money.nullable(),
  fee_source: z.enum(["gateway", "statement"]).nullable(),
  fee_difference_minor: money.nullable(),
  can_record_fee: z.boolean(),
});
export type GatewayPaymentRow = z.infer<typeof gatewayPaymentRow>;

const countAmount = z.object({ count: z.number().int(), amount_minor: money });

export const paymentReconciliation = z.object({
  date: z.string(),
  mode: paymentsMode,
  gateway: z.string(),
  captured: z.array(
    z.object({
      method: paymentMethod,
      provider: z.string(),
      count: z.number().int(),
      amount_minor: money,
      expected_fee_minor: money,
      reported_fee_minor: money,
      fees_missing: z.number().int(),
    }),
  ),
  refunds_completed: countAmount,
  refunds_open: countAmount.extend({ failed: z.number().int() }),
  reviews_open: countAmount,
  attempts: z.object({
    created: z.number().int(),
    succeeded: z.number().int(),
    /** succeeded + failed + review + stopped + waiting = created. */
    failed: z.number().int(),
    review: z.number().int(),
    stopped: z.number().int(),
    waiting: z.number().int(),
    /** Every attempt the gateway declined, also those stopped since (the shopper tried again). */
    declined: z.number().int(),
    checked_by_worker: z.number().int(),
  }),
  events: z.array(z.object({ outcome: z.string(), count: z.number().int() })),
  ledger: z.object({
    gateway_clearing_minor: money,
    refunds_payable_minor: money,
    gateway_fees_minor: money,
  }),
});
export type PaymentReconciliation = z.infer<typeof paymentReconciliation>;

const expectedFee = z.object({ bps: z.number().int(), fixed_minor: money });

export const paymentSettings = z.object({
  mode: paymentsMode,
  gateway: z.string(),
  expected_fees: z.object({ card: expectedFee.optional(), sinpe_movil: expectedFee.optional() }),
  can_change: z.boolean(),
  environments: z.array(
    z.object({
      environment: z.enum(["test", "live"]),
      keys_ready: z.boolean(),
      webhook_ready: z.boolean(),
      account_ref: z.string().nullable(),
      reported_at: timestamp,
      recent: z.boolean(),
    }),
  ),
  open_work: z.object({ attempts: z.number().int(), refunds: z.number().int() }),
});
export type PaymentSettings = z.infer<typeof paymentSettings>;

export const paymentsErrors = {
  payments_mode_invalid: {
    "es-CR": "Ese modo de pagos no existe. Elija prueba local, prueba de la pasarela o real.",
    en: "That payments mode does not exist. Choose local sandbox, the gateway's test environment or live.",
  },
  payments_mode_note_required: {
    "es-CR": "Escriba el motivo del cambio (al menos 10 caracteres): queda en la auditoría.",
    en: "Write the reason for the change (at least 10 characters): it goes in the audit trail.",
  },
  payments_provider_not_ready: {
    "es-CR":
      "La pasarela de ese entorno no está lista: el servicio de pagos no ha reportado llaves y secreto del aviso en los últimos 15 minutos. Revise la configuración y vuelva a intentarlo.",
    en: "The gateway for that environment is not ready: the payments service has not reported keys and a webhook secret in the last 15 minutes. Check the set-up and try again.",
  },
  payments_work_open: {
    "es-CR":
      "Hay pagos o reembolsos en curso en la pasarela. Espere a que terminen antes de cambiar el modo.",
    en: "Payments or refunds are still in progress at the gateway. Wait for them to finish before changing the mode.",
  },
  gateway_not_in_use: {
    "es-CR":
      "Este sitio está en modo de prueba y no cobra por la pasarela. Use el botón de simulación.",
    en: "This site is in sandbox mode and does not charge through the gateway. Use the simulation button.",
  },
  payment_not_startable: {
    "es-CR": "Este pedido ya no espera un pago. Recargue la página para ver cómo está.",
    en: "This order is no longer waiting for a payment. Reload the page to see where it stands.",
  },
  payment_expired: {
    "es-CR":
      "Se acabó el tiempo para pagar este pedido y sus productos se liberaron. Haga el pedido de nuevo.",
    en: "The time to pay this order ran out and its products were released. Place the order again.",
  },
  payment_attempts_exhausted: {
    "es-CR":
      "Ya intentó pagar este pedido varias veces. Pruebe con otro medio de pago haciendo un pedido nuevo, o escríbanos.",
    en: "You have tried to pay this order several times. Try another payment method with a new order, or write to us.",
  },
  payer_id_invalid: {
    "es-CR":
      "Revise la identificación de quien paga: cédula física de 9 dígitos, DIMEX de 12 o cédula jurídica de 10, tal como la tiene su banco.",
    en: "Check the payer's identification: a 9-digit national id, a 12-digit DIMEX or a 10-digit company id, as the bank has it.",
  },
  payer_phone_invalid: {
    "es-CR": "Escriba el número de celular con SINPE Móvil desde el que va a pagar, de 8 dígitos.",
    en: "Enter the 8-digit mobile number with SINPE Móvil you will pay from.",
  },
  payment_event_invalid: {
    "es-CR": "El aviso de la pasarela no se pudo leer.",
    en: "The gateway's notification could not be read.",
  },
  confirmed_by_gateway: {
    "es-CR":
      "Este pago lo confirma la pasarela sola. Si el dinero llegó y no se aplicó, búsquelo en Cobros, Por revisar.",
    en: "The gateway confirms this payment itself. If the money arrived and was not applied, look for it in Payments, To review.",
  },
  payment_review_action_invalid: {
    "es-CR": "Eso no se puede hacer con este movimiento. Recargue la página y elija otra opción.",
    en: "That cannot be done with this item. Reload the page and choose another option.",
  },
  payment_review_note_required: {
    "es-CR": "Escriba una nota que explique la decisión.",
    en: "Write a note explaining the decision.",
  },
  payment_review_not_found: {
    "es-CR": "No encontramos ese movimiento. Recargue la página.",
    en: "We could not find that item. Reload the page.",
  },
  payment_review_closed: {
    "es-CR": "Ese movimiento ya se resolvió. Recargue la página para ver cómo quedó.",
    en: "That item was already settled. Reload the page to see how.",
  },
  payment_review_applied: {
    "es-CR":
      "Ese dinero ya es el pago de un pedido: no se puede aplicar ni devolver otra vez desde aquí. Ciérrelo con una nota.",
    en: "That money is already an order's payment: it cannot be applied or refunded again from here. Close it with a note.",
  },
  payment_review_mismatch: {
    "es-CR":
      "Ese pedido no puede recibir este dinero: tiene que estar esperando el pago y por el mismo monto en colones.",
    en: "That order cannot take this money: it must be waiting for payment, for the same amount in colones.",
  },
  gateway_refund_not_found: {
    "es-CR": "No encontramos ese reembolso. Recargue la página.",
    en: "We could not find that refund. Reload the page.",
  },
  gateway_refund_state: {
    "es-CR": "Ese reembolso cambió mientras tanto. Recargue la página para ver cómo está.",
    en: "That refund changed in the meantime. Reload the page to see where it stands.",
  },
  bank_reference_invalid: {
    "es-CR": "Escriba el número de comprobante de la transferencia (de 4 a 60 caracteres).",
    en: "Enter the transfer's receipt number (4 to 60 characters).",
  },
  payment_not_found: {
    "es-CR": "No encontramos un pago por la pasarela con ese dato. Recargue la página.",
    en: "We could not find a gateway payment with that detail. Reload the page.",
  },
  payment_fee_invalid: {
    "es-CR": "Revise el monto de la comisión: en colones, sin pasar del total del pago.",
    en: "Check the fee amount: in colones, not more than the payment's total.",
  },
  payment_fee_recorded: {
    "es-CR": "La comisión de este pago ya estaba registrada.",
    en: "This payment's fee was already recorded.",
  },
} as const satisfies Messages;

export const paymentsApi = ({ call, run }: Caller) => ({
  /** The shopper's (or staff's) view of an order's payment. */
  orderPayment: (orderNumber: string) =>
    call("order_payment", { p_order_number: orderNumber }, orderPayment),

  /** Starts paying at the gateway, or returns the attempt already open. */
  startPayment: (orderId: string, options: { payer?: SinpePayer; returnTo?: "web" | "app" } = {}) =>
    call(
      "start_payment",
      {
        p_order_id: orderId,
        p_payer: options.payer ?? null,
        p_return_to: options.returnTo ?? "web",
      },
      orderPayment,
    ),

  /** The shopper is back from the gateway's page: a hint to check now. */
  paymentReturned: (orderId: string) =>
    call("payment_returned", { p_order_id: orderId }, orderPayment),

  opsPaymentReviews: (openOnly = true) =>
    call("ops_payment_reviews", { p_open_only: openOnly }, z.array(paymentReview)),

  opsResolvePaymentReview: (
    reviewId: string,
    action: "accept" | "attach" | "refund" | "dismiss",
    note: string,
    orderNumber?: string,
  ) =>
    call(
      "ops_resolve_payment_review",
      {
        p_review_id: reviewId,
        p_action: action,
        p_order_number: orderNumber ?? null,
        p_note: note,
      },
      paymentReview,
    ),

  opsGatewayRefunds: (openOnly = true) =>
    call("ops_gateway_refunds", { p_open_only: openOnly }, z.array(gatewayRefund)),

  opsRetryGatewayRefund: (refundId: string) =>
    call("ops_retry_gateway_refund", { p_id: refundId }, gatewayRefund),

  opsRecordRefundTransfer: (refundId: string, bankReference: string, note?: string) =>
    call(
      "ops_record_refund_transfer",
      { p_id: refundId, p_bank_reference: bankReference, p_note: note ?? null },
      gatewayRefund,
    ),

  /** What the gateway charged, from its statement, for a payment it did not report. */
  opsRecordPaymentFee: (paymentId: string, feeMinor: number, note?: string) =>
    run("ops_record_payment_fee", {
      p_payment_id: paymentId,
      p_fee_minor: feeMinor,
      p_note: note ?? null,
    }),

  opsPayments: (date?: string, limit = 200) =>
    call("ops_payments", { p_date: date ?? null, p_limit: limit }, z.array(gatewayPaymentRow)),

  opsPaymentReconciliation: (date?: string) =>
    call("ops_payment_reconciliation", { p_date: date ?? null }, paymentReconciliation),

  opsPaymentSettings: () => call("ops_payment_settings", {}, paymentSettings),

  opsSetPaymentsMode: (mode: PaymentsMode, note: string) =>
    call("ops_set_payments_mode", { p_mode: mode, p_note: note }, paymentSettings),

  opsSetExpectedGatewayFee: (
    method: "card" | "sinpe_movil",
    bps: number,
    fixedMinor: number,
    note: string,
  ) =>
    call(
      "ops_set_expected_gateway_fee",
      { p_method: method, p_bps: bps, p_fixed_minor: fixedMinor, p_note: note },
      paymentSettings,
    ),
});
