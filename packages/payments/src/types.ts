/**
 * The provider-neutral payment layer (research note §8, adapted to what the
 * database stores). Orders never see a provider: the database keeps attempts,
 * events and refunds in these terms, and an adapter (./onvo.ts) translates to
 * and from one gateway. A second gateway is a second adapter; nothing about
 * orders changes.
 */

export type GatewayId = "onvo";
export type Environment = "test" | "live";
export type OnlineMethod = "card" | "sinpe_movil";

/** Costa Rican identification of whoever's account pays a SINPE Móvil transfer. Digits only. */
export interface PayerId {
  kind: "national" | "resident" | "legal_entity";
  number: string;
}

export interface CreatePaymentInput {
  /** Our attempt id: sent as metadata, so a payment whose creation answer was lost can still be recognised. */
  attemptId: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  /** Céntimos, an integer; always read from the database. */
  amountMinor: number;
  currency: "CRC";
  method: OnlineMethod;
  customer: { name?: string | null; email?: string | null };
  /** Required for SINPE Móvil. */
  sinpe?: { payer: PayerId; phoneE164: string };
  /** Where the gateway's page sends the shopper back: a web address or an app deep link. */
  returnUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export type NextAction =
  | { kind: "redirect"; url: string }
  | {
      kind: "sinpe_transfer";
      destinationPhoneE164: string;
      amountMinor: number;
      /** Null when the gateway matches by payer and amount, as ONVO does. */
      requiredDescription: string | null;
      suggestedDescription: string;
    }
  | { kind: "none" };

export type GatewayPaymentStatus =
  | "open"
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export interface GatewayPayment {
  gateway: GatewayId;
  /** The id refunds are made against (ONVO: the payment intent). May be unknown until paid. */
  reference: string | null;
  /** The hosted session, when there is one. */
  sessionReference: string | null;
  status: GatewayPaymentStatus;
  amountMinor: number;
  currency: string;
  updatedAt: string | null;
  nextAction: NextAction;
  failure?: { code: string; message: string };
  /** What the gateway says it charged, when it says so (see onvo.ts on why this may be null). */
  feeMinor: number | null;
  /** How much of it has been refunded at the gateway, when the gateway says. */
  refundedMinor: number | null;
  metadata: Record<string, string>;
}

export interface RefundInput {
  /** Our gateway refund id. */
  refundId: string;
  /** GatewayPayment.reference */
  reference: string;
  amountMinor: number;
  reason: "requested_by_customer" | "fraudulent" | "duplicate" | "other";
  note?: string;
}

export interface GatewayRefund {
  reference: string;
  paymentReference: string | null;
  status: "pending" | "succeeded" | "failed";
  amountMinor: number;
  currency: string;
  updatedAt: string | null;
  failure?: { code: string; message: string };
}

/**
 * An event as the database applies it (private.payments_apply_event). Field
 * names are the database's. Never carries a name, an identification, an
 * e-mail or anything from a card field.
 */
export interface NormalisedEvent {
  provider: GatewayId;
  event_id: string;
  source: "webhook" | "poll";
  environment: Environment;
  type:
    | "payment.open"
    | "payment.processing"
    | "payment.succeeded"
    | "payment.failed"
    | "payment.cancelled"
    | "payment.expired"
    | "refund.created"
    | "refund.succeeded"
    | "refund.failed"
    | "transfer.received"
    | "dispute.opened"
    | "dispute.updated"
    | "dispute.closed"
    | "endpoint.test"
    | "ignored";
  provider_type: string;
  occurred_at: string | null;
  /** Poll answers only: the attempt the worker asked about. */
  attempt_id?: string;
  payment?: {
    reference: string | null;
    session_reference: string | null;
    status: string;
    amount_minor: number | null;
    currency: string | null;
    updated_at: string | null;
    failure_code: string | null;
    fee_minor: number | null;
    metadata: Record<string, string>;
  };
  refund?: {
    reference: string | null;
    payment_reference: string | null;
    status: string;
    amount_minor: number | null;
    currency: string | null;
    updated_at: string | null;
    failure_code: string | null;
  };
  transfer?: {
    reference: string | null;
    payment_reference: string | null;
    amount_minor: number | null;
    currency: string | null;
    description: string | null;
  };
  dispute?: {
    reference: string | null;
    payment_reference: string | null;
    status: string | null;
    amount_minor: number | null;
    respond_by: string | null;
  };
}

/**
 * What a failed call to the gateway means for retrying it, since ONVO offers
 * no idempotency key: `refused` — the gateway answered and created nothing (a
 * 4xx, or the connection was refused before anything was sent); `unknown` —
 * the answer was lost or the gateway erred (a timeout, a 5xx), so the object
 * may exist and must be looked up before anything is sent again.
 */
export class GatewayError extends Error {
  constructor(
    readonly kind: "refused" | "unknown",
    readonly code: string,
    readonly status: number | null,
    readonly retryable: boolean,
    /** Something was created before the failing step (ONVO's SINPE flow takes three calls). */
    readonly partial?: { reference?: string },
  ) {
    super(`gateway ${kind}: ${code}${status ? ` (${status})` : ""}`);
  }
}

export class WebhookSignatureError extends Error {
  constructor(readonly reason: string) {
    super(`webhook signature: ${reason}`);
  }
}

export interface PaymentGateway {
  readonly id: GatewayId;
  /** Called once per attempt: the caller stores the result, and never repeats a call whose answer was lost. */
  createPayment(input: CreatePaymentInput): Promise<GatewayPayment>;
  /** The source of truth when a notification is late or the shopper came back first. */
  getPayment(ref: {
    reference?: string | null;
    sessionReference?: string | null;
  }): Promise<GatewayPayment>;
  /** Stops a payment that has not succeeded (ONVO: cancel the intent, expire the session). */
  cancelPayment(ref: {
    reference?: string | null;
    sessionReference?: string | null;
  }): Promise<void>;
  refund(input: RefundInput): Promise<GatewayRefund>;
  getRefund(reference: string): Promise<GatewayRefund>;
  /** Checks authenticity on the raw body, then normalises. Throws WebhookSignatureError. */
  parseWebhook(request: { rawBody: string; headers: Headers; now: Date }): Promise<NormalisedEvent>;
}

/** The database side, over the Data API with the payments worker's own secret key. */
export interface PaymentsQueue {
  hello(input: {
    provider: GatewayId;
    environment: Environment;
    account: string | null;
    keysReady: boolean;
    webhookReady: boolean;
  }): Promise<{ mode: string; gateway: string; active: boolean }>;
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<PaymentTask[]>;
  report(workerId: string, report: Record<string, unknown>): Promise<string>;
  event(event: NormalisedEvent): Promise<string>;
}

export type PaymentTask =
  | {
      kind: "create";
      attempt_id: string;
      order_id: string;
      payment_id: string;
      order_number: string;
      method: OnlineMethod;
      amount_minor: number;
      currency: string;
      return_to: "web" | "app";
      expires_at: string;
      customer: { name: string | null; email: string | null } | null;
      payer: { kind: PayerId["kind"]; number: string; phone: string } | null;
    }
  | {
      kind: "cancel" | "check";
      attempt_id: string;
      order_number: string;
      method: OnlineMethod;
      session_reference: string | null;
      intent_reference: string | null;
    }
  | {
      kind: "refund" | "refund_check" | "refund_poll";
      gateway_refund_id: string;
      order_number: string | null;
      payment_reference: string | null;
      provider_refund_reference: string | null;
      amount_minor: number;
      currency: string;
      reason: RefundInput["reason"];
      known_refunded_minor: number;
    };

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Logs carry ids, codes and counts only: never a name, an identification or an amount owed by a person. */
export const consoleLogger: Logger = {
  info: (message, fields) => console.info(`[payments] ${message}`, fields ?? ""),
  warn: (message, fields) => console.warn(`[payments] ${message}`, fields ?? ""),
  error: (message, fields) => console.error(`[payments] ${message}`, fields ?? ""),
};
