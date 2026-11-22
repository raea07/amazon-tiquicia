/**
 * The ONVO Pay adapter: requests and responses as the research note
 * documents them (§6.1 to §6.7), translated into the provider-neutral types.
 *
 *   card         POST /v1/checkout/sessions/one-time-link: ONVO's hosted page
 *                takes the card and runs 3-D Secure; no card data ever reaches
 *                us (SAQ A, note §5.1).
 *   SINPE Móvil  POST /v1/payment-intents, POST /v1/payment-methods (the
 *                payer's identification and phone), POST
 *                /v1/payment-intents/{id}/confirm. The shopper then transfers
 *                the exact amount to ONVO's number; ONVO accepts only a
 *                transfer from that payer for that amount.
 *   refunds      POST /v1/refunds, GET /v1/refunds/{id}.
 *   webhooks     X-Onvo-Signature (./signature.ts), envelope { id, type,
 *                mode, data.object }.
 *
 * Where the note marks something UNVERIFIED the code says so: the fee per
 * payment (no field is documented: `latestCharge.fee` is read if present,
 * otherwise finance records it from the statement), and how much of a
 * payment was refunded (taken as amount − receivedAmount).
 */

import { verifyOnvoSignature } from "./signature.ts";
import {
  type CreatePaymentInput,
  type Environment,
  GatewayError,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type GatewayRefund,
  type NormalisedEvent,
  type PayerId,
  type PaymentGateway,
  type RefundInput,
  WebhookSignatureError,
} from "./types.ts";

export interface OnvoSettings {
  baseUrl: string;
  secretKey: string;
  webhookSecrets: string[];
  /** ONVO's SINPE Móvil number (+506 7019 6686 unless ONVO assigns us one). */
  sinpeNumber: string;
  timeoutMs: number;
  environment: Environment;
}

export const ONVO_DEFAULT_SINPE_NUMBER = "+50670196686";

type Json = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const strings = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(obj(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

/** ONVO's identification types (note §6.4) and their printed format. */
export function onvoIdentification(payer: PayerId): {
  identification: string;
  identificationType: number;
} {
  const n = payer.number.replace(/\D/g, "");
  switch (payer.kind) {
    case "national":
      // 9-digit cédula 1-2345-6789 is written 01-2345-6789.
      return {
        identification: `0${n.slice(0, 1)}-${n.slice(1, 5)}-${n.slice(5, 9)}`,
        identificationType: 0,
      };
    case "resident":
      return { identification: n, identificationType: 1 };
    case "legal_entity":
      return {
        identification: `${n.slice(0, 1)}-${n.slice(1, 4)}-${n.slice(4, 10)}`,
        identificationType: 3,
      };
  }
}

/** A payment intent's status, in our terms (note §6.3). */
export function intentStatus(intent: Json): GatewayPaymentStatus {
  switch (intent.status) {
    case "succeeded":
    case "refunded":
    case "partially_refunded":
      return "succeeded";
    case "processing":
    case "requires_capture":
      return "processing";
    case "requires_action":
      return "requires_action";
    case "canceled":
      return "cancelled";
    case "failed":
      return "failed";
    case "requires_payment_method":
      // Back to the start after a decline: the attempt failed, the intent can still be paid.
      return intent.lastPaymentError ? "failed" : "open";
    default:
      return "open";
  }
}

function failureOf(intent: Json): { code: string; message: string } | undefined {
  const error = obj(intent.lastPaymentError);
  const charge = obj(intent.latestCharge);
  const code = str(error.code) ?? str(charge.failureCode);
  if (!code) return undefined;
  return { code, message: str(error.message) ?? str(charge.failureMessage) ?? code };
}

/** UNVERIFIED: ONVO documents no fee field on intents or charges; one is read if it is there. */
function feeOf(intent: Json): number | null {
  return num(obj(intent.latestCharge).fee);
}

function refundedOf(intent: Json): number | null {
  const amount = num(intent.amount);
  const received = num(intent.receivedAmount);
  if (amount === null || received === null) return null;
  return intent.status === "refunded" || intent.status === "partially_refunded"
    ? Math.max(amount - received, 0)
    : 0;
}

function fromIntent(intent: Json, sessionReference: string | null): GatewayPayment {
  const status = intentStatus(intent);
  return {
    gateway: "onvo",
    reference: str(intent.id),
    sessionReference,
    status,
    amountMinor: num(intent.amount) ?? 0,
    currency: str(intent.currency) ?? "CRC",
    updatedAt: str(intent.updatedAt),
    nextAction: { kind: "none" },
    failure: failureOf(intent),
    feeMinor: feeOf(intent),
    refundedMinor: refundedOf(intent),
    metadata: strings(intent.metadata),
  };
}

function fromRefund(refund: Json): GatewayRefund {
  const status =
    refund.status === "succeeded" ? "succeeded" : refund.status === "failed" ? "failed" : "pending";
  const failure = obj(refund.failure);
  const code = str(failure.code) ?? str(refund.failureReason);
  return {
    reference: str(refund.id) ?? "",
    paymentReference: str(refund.paymentIntentId),
    status,
    amountMinor: num(refund.amount) ?? 0,
    currency: str(refund.currency) ?? "CRC",
    updatedAt: str(refund.updatedAt),
    failure: code ? { code, message: str(failure.message) ?? code } : undefined,
  };
}

/** Event types the note lists (§6.5), in our terms. */
const EVENT_TYPES: Record<string, NormalisedEvent["type"]> = {
  "checkout_session.succeeded": "payment.succeeded",
  "checkout_session.expired": "payment.expired",
  "payment_intent.succeeded": "payment.succeeded",
  "payment_intent.processing": "payment.processing",
  "payment_intent.failed": "payment.failed",
  "payment_intent.canceled": "payment.cancelled",
  "refund.created": "refund.created",
  "refund.succeeded": "refund.succeeded",
  "refund.failed": "refund.failed",
  "mobile_transfer.received": "transfer.received",
  "dispute.created": "dispute.opened",
  "dispute.updated": "dispute.updated",
  "dispute.closed": "dispute.closed",
  "webhook_endpoint.test": "endpoint.test",
};

/** Turns ONVO's webhook envelope into the event the database applies. */
export function normaliseOnvoEvent(envelope: Json): NormalisedEvent {
  const providerType = str(envelope.type) ?? "";
  const type = EVENT_TYPES[providerType] ?? "ignored";
  const object = obj(obj(envelope.data).object);
  const base = {
    provider: "onvo" as const,
    event_id: str(envelope.id) ?? "",
    source: "webhook" as const,
    environment: (envelope.mode === "live" ? "live" : "test") as Environment,
    type,
    provider_type: providerType,
    occurred_at: str(envelope.createdAt),
  };
  if (providerType.startsWith("checkout_session.")) {
    return {
      ...base,
      payment: {
        reference: str(object.paymentIntentId),
        session_reference: str(object.id),
        status: str(object.paymentStatus) ?? str(object.status) ?? "",
        amount_minor: num(object.amountTotal),
        currency: str(object.currency),
        updated_at: str(object.updatedAt),
        failure_code: null,
        fee_minor: null,
        metadata: strings(object.metadata),
      },
    };
  }
  if (providerType.startsWith("payment_intent.")) {
    const failure = failureOf(object);
    return {
      ...base,
      payment: {
        reference: str(object.id),
        session_reference: null,
        status: str(object.status) ?? "",
        // What arrived: for a transfer in parts, succeeded comes once all of it has.
        amount_minor: num(object.receivedAmount) || num(object.amount),
        currency: str(object.currency),
        updated_at: str(object.updatedAt),
        failure_code: failure?.code ?? null,
        fee_minor: feeOf(object),
        metadata: strings(object.metadata),
      },
    };
  }
  if (providerType.startsWith("refund.")) {
    const refund = fromRefund(object);
    return {
      ...base,
      refund: {
        reference: refund.reference || null,
        payment_reference: refund.paymentReference,
        status: refund.status,
        amount_minor: num(object.amount),
        currency: str(object.currency),
        updated_at: refund.updatedAt,
        failure_code: refund.failure?.code ?? null,
      },
    };
  }
  if (providerType === "mobile_transfer.received") {
    return {
      ...base,
      transfer: {
        reference: str(object.SINPERefNumber) ?? str(object.id),
        payment_reference: str(object.paymentIntentId),
        amount_minor: num(object.amount),
        currency: str(object.currency) ?? "CRC",
        description: str(object.description),
      },
    };
  }
  if (providerType.startsWith("dispute.")) {
    return {
      ...base,
      dispute: {
        reference: str(object.id),
        payment_reference: str(object.paymentIntentId),
        status: str(object.status),
        amount_minor: num(object.amount),
        respond_by: str(object.responseDueAt),
      },
    };
  }
  return base;
}

export function onvoGateway(
  settings: OnvoSettings,
  fetchImpl: typeof fetch = fetch,
): PaymentGateway {
  const base = settings.baseUrl.replace(/\/$/, "");

  /**
   * One request. Answers the body on 2xx; otherwise throws a GatewayError that
   * says whether the gateway created nothing (refused) or might have
   * (unknown). Only a connection refused before sending, a 429 or a 4xx is
   * "refused"; a timeout or a 5xx is "unknown".
   */
  async function call(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${settings.secretKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const cause = obj((error as { cause?: unknown }).cause);
      if (cause.code === "ECONNREFUSED")
        throw new GatewayError("refused", "unreachable", null, true);
      throw new GatewayError(
        "unknown",
        controller.signal.aborted ? "timeout" : "network_error",
        null,
        method === "GET",
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let json: Json = {};
    try {
      json = text ? obj(JSON.parse(text)) : {};
    } catch {
      // not JSON: keep {}
    }
    if (response.ok) return json;
    // Domain errors carry `code`; validation errors only a message list.
    const code =
      str(json.code) ?? (response.status === 400 ? "validation_error" : `http_${response.status}`);
    if (response.status === 429) throw new GatewayError("refused", "rate_limited", 429, true);
    if (response.status >= 500)
      throw new GatewayError("unknown", code, response.status, method === "GET");
    throw new GatewayError("refused", code, response.status, false);
  }

  async function getIntent(
    id: string,
    sessionReference: string | null = null,
  ): Promise<GatewayPayment> {
    return fromIntent(
      await call("GET", `/v1/payment-intents/${encodeURIComponent(id)}`),
      sessionReference,
    );
  }

  return {
    id: "onvo",

    async createPayment(input: CreatePaymentInput): Promise<GatewayPayment> {
      const metadata = {
        attemptId: input.attemptId,
        orderId: input.orderId,
        paymentId: input.paymentId,
        orderNumber: input.orderNumber,
      };
      const description = `Pedido ${input.orderNumber}`;
      if (input.method === "card") {
        // One line for the whole order, so the amount charged is exactly ours.
        const session = await call("POST", "/v1/checkout/sessions/one-time-link", {
          lineItems: [
            { quantity: 1, unitAmount: input.amountMinor, currency: input.currency, description },
          ],
          ...(input.customer.name ? { customerName: input.customer.name } : {}),
          ...(input.customer.email ? { customerEmail: input.customer.email } : {}),
          redirectUrl: input.returnUrl,
          cancelUrl: input.cancelUrl,
          paymentMethodTypes: ["card"],
          metadata,
        });
        const url = str(session.url);
        if (!str(session.id) || !url)
          throw new GatewayError("unknown", "malformed_session", 201, false);
        return {
          gateway: "onvo",
          reference: str(session.paymentIntentId),
          sessionReference: str(session.id),
          status: "open",
          amountMinor: input.amountMinor,
          currency: input.currency,
          updatedAt: str(session.updatedAt),
          nextAction: { kind: "redirect", url },
          feeMinor: null,
          refundedMinor: 0,
          metadata,
        };
      }

      if (!input.sinpe) throw new GatewayError("refused", "payer_missing", null, false);
      const intent = await call("POST", "/v1/payment-intents", {
        amount: input.amountMinor,
        currency: input.currency,
        description,
        metadata,
      });
      const intentId = str(intent.id);
      if (!intentId) throw new GatewayError("unknown", "malformed_intent", 201, false);
      try {
        const method = await call("POST", "/v1/payment-methods", {
          type: "mobile_number",
          mobileNumber: { ...onvoIdentification(input.sinpe.payer), number: input.sinpe.phoneE164 },
          billing: {
            ...(input.customer.name ? { name: input.customer.name } : {}),
            ...(input.customer.email ? { email: input.customer.email } : {}),
          },
        });
        const methodId = str(method.id);
        if (!methodId) throw new GatewayError("unknown", "malformed_payment_method", 201, false);
        // Confirmed before the shopper sees the instructions: ONVO refuses a
        // transfer when no intent is waiting for it.
        const confirmed = await call(
          "POST",
          `/v1/payment-intents/${encodeURIComponent(intentId)}/confirm`,
          {
            paymentMethodId: methodId,
          },
        );
        const payment = fromIntent(confirmed, null);
        return {
          ...payment,
          status: payment.status === "open" ? "processing" : payment.status,
          nextAction: {
            kind: "sinpe_transfer",
            destinationPhoneE164: settings.sinpeNumber,
            amountMinor: input.amountMinor,
            requiredDescription: null,
            suggestedDescription: description,
          },
        };
      } catch (error) {
        if (error instanceof GatewayError) {
          if (error.kind === "refused") {
            // The payer was not accepted: nothing can be paid on that intent.
            await call("POST", `/v1/payment-intents/${encodeURIComponent(intentId)}/cancel`).catch(
              () => null,
            );
          }
          throw new GatewayError(error.kind, error.code, error.status, false, {
            reference: intentId,
          });
        }
        throw error;
      }
    },

    async getPayment(ref): Promise<GatewayPayment> {
      if (ref.reference) return getIntent(ref.reference, ref.sessionReference ?? null);
      if (!ref.sessionReference) throw new GatewayError("refused", "no_reference", null, false);
      const session = await call(
        "GET",
        `/v1/checkout/sessions/${encodeURIComponent(ref.sessionReference)}`,
      );
      const intentId = str(session.paymentIntentId);
      if (intentId) return getIntent(intentId, ref.sessionReference);
      const status: GatewayPaymentStatus =
        session.status === "expired"
          ? "expired"
          : session.paymentStatus === "paid"
            ? "succeeded"
            : "open";
      const amount = num(session.amountTotal) ?? 0;
      return {
        gateway: "onvo",
        reference: null,
        sessionReference: ref.sessionReference,
        status,
        amountMinor: amount,
        currency: str(session.currency) ?? "CRC",
        updatedAt: str(session.updatedAt),
        nextAction:
          str(session.url) && status === "open"
            ? { kind: "redirect", url: String(session.url) }
            : { kind: "none" },
        feeMinor: null,
        refundedMinor: null,
        metadata: strings(session.metadata),
      };
    },

    async cancelPayment(ref): Promise<void> {
      if (ref.sessionReference) {
        await call(
          "POST",
          `/v1/checkout/sessions/${encodeURIComponent(ref.sessionReference)}/expire`,
        );
        return;
      }
      if (ref.reference) {
        await call("POST", `/v1/payment-intents/${encodeURIComponent(ref.reference)}/cancel`);
        return;
      }
      throw new GatewayError("refused", "no_reference", null, false);
    },

    async refund(input: RefundInput): Promise<GatewayRefund> {
      return fromRefund(
        await call("POST", "/v1/refunds", {
          paymentIntentId: input.reference,
          amount: input.amountMinor,
          reason: input.reason,
          ...(input.note ? { description: input.note.slice(0, 200) } : {}),
        }),
      );
    },

    async getRefund(reference: string): Promise<GatewayRefund> {
      return fromRefund(await call("GET", `/v1/refunds/${encodeURIComponent(reference)}`));
    },

    async parseWebhook({ rawBody, headers, now }): Promise<NormalisedEvent> {
      const verdict = await verifyOnvoSignature(
        rawBody,
        headers.get("x-onvo-signature"),
        settings.webhookSecrets,
        Math.floor(now.getTime() / 1000),
      );
      if (!verdict.ok) throw new WebhookSignatureError(verdict.reason);
      let envelope: Json;
      try {
        envelope = obj(JSON.parse(rawBody));
      } catch {
        throw new WebhookSignatureError("malformed_body");
      }
      const event = normaliseOnvoEvent(envelope);
      // The id in the header is the same across retries and resends; the body's must agree.
      const headerId = headers.get("x-onvo-event-id");
      if (!event.event_id || (headerId && headerId !== event.event_id)) {
        throw new WebhookSignatureError("event_id_mismatch");
      }
      return event;
    },
  };
}
