/**
 * The ONVO adapter against the request and response shapes in the research
 * note (§6.2 to §6.7). Each test answers with the documented body and checks
 * exactly what was sent.
 */

import { describe, expect, it } from "vitest";
import { normaliseOnvoEvent, onvoGateway, onvoIdentification } from "./onvo.ts";
import { signOnvoWebhook } from "./signature.ts";
import { type CreatePaymentInput, GatewayError, WebhookSignatureError } from "./types.ts";

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal | null;
}

function fakeFetch(answers: Array<(sent: Sent) => Response | Promise<Response> | Error>) {
  const sent: Sent[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Sent = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      signal: init?.signal,
    };
    sent.push(request);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected call ${request.method} ${request.url}`);
    const result = await answer(request);
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
  return { impl, sent };
}

const reply = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const settings = {
  baseUrl: "https://api.onvopay.com",
  secretKey: "onvo_test_secret_key_abc",
  webhookSecrets: ["whsec_one"],
  sinpeNumber: "+50670196686",
  timeoutMs: 2000,
  environment: "test" as const,
};

const input: CreatePaymentInput = {
  attemptId: "11111111-1111-4111-8111-111111111111",
  paymentId: "22222222-2222-4222-8222-222222222222",
  orderId: "33333333-3333-4333-8333-333333333333",
  orderNumber: "YT-100123",
  amountMinor: 2_150_000,
  currency: "CRC",
  method: "card",
  customer: { name: "Nombre Apellido", email: "comprador@example.com" },
  returnUrl: "https://shop/pedidos/YT-100123/pago/retorno",
  cancelUrl: "https://shop/pedidos/YT-100123/pago/retorno?cancelado=1",
  expiresAt: new Date("2026-11-21T12:30:00Z"),
};

describe("creating a card payment: hosted Checkout by redirect (§6.2)", () => {
  it("sends one line for the order total, the return addresses and our ids as metadata", async () => {
    const { impl, sent } = fakeFetch([
      reply(201, {
        id: "cs_1",
        url: "https://checkout.onvopay.com/pay/cs_1",
        status: "open",
        paymentStatus: "unpaid",
        paymentIntentId: "pi_1",
        createdAt: "2026-11-21T12:00:00.000Z",
        updatedAt: "2026-11-21T12:00:00.000Z",
      }),
    ]);
    const payment = await onvoGateway(settings, impl).createPayment(input);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.url).toBe("https://api.onvopay.com/v1/checkout/sessions/one-time-link");
    expect(sent[0]?.headers.authorization).toBe("Bearer onvo_test_secret_key_abc");
    expect(sent[0]?.body).toEqual({
      lineItems: [
        { quantity: 1, unitAmount: 2_150_000, currency: "CRC", description: "Pedido YT-100123" },
      ],
      customerName: "Nombre Apellido",
      customerEmail: "comprador@example.com",
      redirectUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      paymentMethodTypes: ["card"],
      metadata: {
        attemptId: input.attemptId,
        orderId: input.orderId,
        paymentId: input.paymentId,
        orderNumber: "YT-100123",
      },
    });
    expect(payment).toMatchObject({
      sessionReference: "cs_1",
      reference: "pi_1",
      status: "open",
      nextAction: { kind: "redirect", url: "https://checkout.onvopay.com/pay/cs_1" },
    });
  });

  it("never sends anything from a card: there is no card field to send", async () => {
    const { impl, sent } = fakeFetch([reply(201, { id: "cs_2", url: "https://x/pay/cs_2" })]);
    await onvoGateway(settings, impl).createPayment(input);
    const body = JSON.stringify(sent[0]?.body);
    for (const word of ["number", "cvv", "expMonth", "holderName"])
      expect(body).not.toContain(word);
  });
});

describe("creating a SINPE Móvil payment (§6.4)", () => {
  const sinpe: CreatePaymentInput = {
    ...input,
    method: "sinpe_movil",
    sinpe: { payer: { kind: "national", number: "113931919" }, phoneE164: "+50688888888" },
  };

  it("creates the intent, the payer's payment method and confirms, in that order", async () => {
    const { impl, sent } = fakeFetch([
      reply(201, {
        id: "pi_9",
        amount: 2_150_000,
        currency: "CRC",
        status: "requires_payment_method",
      }),
      reply(201, { id: "pm_9", type: "mobile_number" }),
      reply(201, {
        id: "pi_9",
        amount: 2_150_000,
        currency: "CRC",
        status: "processing",
        updatedAt: "2026-11-21T12:00:01.000Z",
      }),
    ]);
    const payment = await onvoGateway(settings, impl).createPayment(sinpe);
    expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
      "POST /v1/payment-intents",
      "POST /v1/payment-methods",
      "POST /v1/payment-intents/pi_9/confirm",
    ]);
    expect(sent[0]?.body).toEqual({
      amount: 2_150_000,
      currency: "CRC",
      description: "Pedido YT-100123",
      metadata: expect.objectContaining({ attemptId: input.attemptId }),
    });
    expect(sent[1]?.body).toEqual({
      type: "mobile_number",
      mobileNumber: {
        identification: "01-1393-1919",
        identificationType: 0,
        number: "+50688888888",
      },
      billing: { name: "Nombre Apellido", email: "comprador@example.com" },
    });
    expect(sent[2]?.body).toEqual({ paymentMethodId: "pm_9" });
    expect(payment).toMatchObject({
      reference: "pi_9",
      status: "processing",
      nextAction: {
        kind: "sinpe_transfer",
        destinationPhoneE164: "+50670196686",
        amountMinor: 2_150_000,
        requiredDescription: null,
      },
    });
  });

  it("cancels the intent when the payer is refused, and says nothing can be paid", async () => {
    const { impl, sent } = fakeFetch([
      reply(201, { id: "pi_8", amount: 2_150_000, currency: "CRC" }),
      reply(400, { statusCode: 400, message: ["identification invalid"], error: "Bad Request" }),
      reply(201, { id: "pi_8", status: "canceled" }),
    ]);
    const error = await onvoGateway(settings, impl)
      .createPayment(sinpe)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({
      kind: "refused",
      code: "validation_error",
      partial: { reference: "pi_8" },
    });
    expect(new URL(sent[2]?.url ?? "").pathname).toBe("/v1/payment-intents/pi_8/cancel");
  });

  it("formats each kind of identification as ONVO types it", () => {
    expect(onvoIdentification({ kind: "national", number: "113931919" })).toEqual({
      identification: "01-1393-1919",
      identificationType: 0,
    });
    expect(onvoIdentification({ kind: "resident", number: "155812345678" })).toEqual({
      identification: "155812345678",
      identificationType: 1,
    });
    expect(onvoIdentification({ kind: "legal_entity", number: "3101815764" })).toEqual({
      identification: "3-101-815764",
      identificationType: 3,
    });
  });
});

describe("what a failed call means, since there is no idempotency key (§6.10)", () => {
  it("a 4xx: nothing was created", async () => {
    const { impl } = fakeFetch([
      reply(422, { statusCode: 422, type: "OnvoAPIError", code: "amount_too_small", message: "x" }),
    ]);
    await expect(onvoGateway(settings, impl).createPayment(input)).rejects.toMatchObject({
      kind: "refused",
      code: "amount_too_small",
      retryable: false,
    });
  });

  it("a 5xx or a timeout on a create: it may exist, never retried blindly", async () => {
    const { impl } = fakeFetch([reply(502, {})]);
    await expect(onvoGateway(settings, impl).createPayment(input)).rejects.toMatchObject({
      kind: "unknown",
      retryable: false,
    });
    const slow = fakeFetch([
      (sent) =>
        new Promise<Response>((_resolve, reject) => {
          sent.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ]);
    await expect(
      onvoGateway({ ...settings, timeoutMs: 20 }, slow.impl).createPayment(input),
    ).rejects.toMatchObject({ kind: "unknown", code: "timeout" });
  });

  it("a connection refused before sending, or a 429: nothing was created, try later", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const { impl } = fakeFetch([() => refused, reply(429, {})]);
    const gateway = onvoGateway(settings, impl);
    await expect(gateway.createPayment(input)).rejects.toMatchObject({
      kind: "refused",
      retryable: true,
    });
    await expect(gateway.createPayment(input)).rejects.toMatchObject({
      kind: "refused",
      code: "rate_limited",
    });
  });
});

describe("asking about a payment (§6.2, §6.3)", () => {
  it("reads the session, then its payment intent", async () => {
    const { impl, sent } = fakeFetch([
      reply(200, {
        id: "cs_1",
        status: "complete",
        paymentStatus: "paid",
        paymentIntentId: "pi_1",
      }),
      reply(200, {
        id: "pi_1",
        amount: 500_000,
        receivedAmount: 500_000,
        currency: "CRC",
        status: "succeeded",
        updatedAt: "2026-10-21T16:10:01.000Z",
        latestCharge: { id: "ch_1", fee: 19_500 },
      }),
    ]);
    const payment = await onvoGateway(settings, impl).getPayment({ sessionReference: "cs_1" });
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual([
      "/v1/checkout/sessions/cs_1",
      "/v1/payment-intents/pi_1",
    ]);
    expect(payment).toMatchObject({
      reference: "pi_1",
      sessionReference: "cs_1",
      status: "succeeded",
      amountMinor: 500_000,
      feeMinor: 19_500,
      refundedMinor: 0,
    });
  });

  it("maps the documented intent statuses", async () => {
    const statuses: Array<[Record<string, unknown>, string]> = [
      [{ status: "requires_payment_method" }, "open"],
      [{ status: "requires_payment_method", lastPaymentError: { code: "declined" } }, "failed"],
      [{ status: "requires_action" }, "requires_action"],
      [{ status: "processing" }, "processing"],
      [{ status: "succeeded" }, "succeeded"],
      [{ status: "partially_refunded" }, "succeeded"],
      [{ status: "canceled" }, "cancelled"],
    ];
    for (const [intent, expected] of statuses) {
      const { impl } = fakeFetch([reply(200, { id: "pi", amount: 1, ...intent })]);
      expect((await onvoGateway(settings, impl).getPayment({ reference: "pi" })).status).toBe(
        expected,
      );
    }
  });

  it("reads how much was refunded from amount and receivedAmount", async () => {
    const { impl } = fakeFetch([
      reply(200, {
        id: "pi",
        amount: 500_000,
        receivedAmount: 400_000,
        status: "partially_refunded",
      }),
    ]);
    expect((await onvoGateway(settings, impl).getPayment({ reference: "pi" })).refundedMinor).toBe(
      100_000,
    );
  });

  it("stops a session by expiring it and an intent by cancelling it", async () => {
    const { impl, sent } = fakeFetch([reply(200, {}), reply(200, {})]);
    const gateway = onvoGateway(settings, impl);
    await gateway.cancelPayment({ sessionReference: "cs_1" });
    await gateway.cancelPayment({ reference: "pi_1" });
    expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
      "POST /v1/checkout/sessions/cs_1/expire",
      "POST /v1/payment-intents/pi_1/cancel",
    ]);
  });
});

describe("refunds (§6.7)", () => {
  it("sends the intent, the amount and the reason, and reads the answer", async () => {
    const { impl, sent } = fakeFetch([
      reply(201, {
        id: "rf_1",
        amount: 100_000,
        currency: "CRC",
        paymentIntentId: "pi_1",
        status: "pending",
        reason: "requested_by_customer",
      }),
      reply(200, {
        id: "rf_1",
        amount: 100_000,
        currency: "CRC",
        paymentIntentId: "pi_1",
        status: "failed",
        failureReason: "declined",
        failure: { code: "declined", message: "The refund was declined." },
      }),
    ]);
    const gateway = onvoGateway(settings, impl);
    const refund = await gateway.refund({
      refundId: "x",
      reference: "pi_1",
      amountMinor: 100_000,
      reason: "requested_by_customer",
      note: "Devolución pedido YT-100123",
    });
    expect(sent[0]?.body).toEqual({
      paymentIntentId: "pi_1",
      amount: 100_000,
      reason: "requested_by_customer",
      description: "Devolución pedido YT-100123",
    });
    expect(refund).toMatchObject({ reference: "rf_1", status: "pending", amountMinor: 100_000 });
    expect(await gateway.getRefund("rf_1")).toMatchObject({
      status: "failed",
      failure: { code: "declined" },
    });
  });
});

describe("webhooks (§6.5)", () => {
  // The success and failure events exactly as the note prints them.
  const succeeded = {
    id: "evt_vx7r5r6m33g2x9m2p8j2k1a4",
    object: "event",
    createdAt: "2026-10-21T16:10:01.000Z",
    mode: "live",
    accountId: "clacct0001",
    type: "payment_intent.succeeded",
    data: {
      object: {
        object: "payment_intent",
        id: "clpiment0001",
        amount: 500000,
        currency: "CRC",
        status: "succeeded",
        createdAt: "2026-10-21T16:09:50.000Z",
        updatedAt: "2026-10-21T16:10:01.000Z",
      },
    },
  };
  const failed = {
    id: "evt_k5ufdj5r8btq7t8esdhbpwe7",
    object: "event",
    createdAt: "2026-10-21T16:12:00.000Z",
    mode: "test",
    accountId: "clacct0001",
    type: "payment_intent.failed",
    data: {
      object: {
        object: "payment_intent",
        id: "clpiment0002",
        amount: 250000,
        capturableAmount: 0,
        receivedAmount: 0,
        currency: "CRC",
        status: "requires_payment_method",
        customerId: "clcus0002",
        metadata: { orderId: "order_1002" },
        lastPaymentError: {
          type: "processing_error",
          code: "declined",
          message: "Transaction declined",
          paymentMethodType: "card",
        },
        latestCharge: {
          id: "clch0002",
          amount: 250000,
          currency: "CRC",
          status: "failed",
          failureCode: "declined",
          failureMessage: "Transaction declined",
          createdAt: "2026-10-21T16:11:58.000Z",
          updatedAt: "2026-10-21T16:12:00.000Z",
        },
        createdAt: "2026-10-21T16:11:50.000Z",
        updatedAt: "2026-10-21T16:12:00.000Z",
      },
    },
  };
  const refundFailed = {
    id: "evt_eqf1z262w9lqzccagn8dzvjh",
    object: "event",
    createdAt: "2026-10-21T17:00:05.000Z",
    mode: "test",
    accountId: "clacct0001",
    type: "refund.failed",
    data: {
      object: {
        object: "refund",
        id: "clref0001",
        amount: 500000,
        currency: "CRC",
        status: "failed",
        failureReason: "declined",
        paymentIntentId: "clpiment0001",
        chargeId: "clch0001",
        createdAt: "2026-10-21T17:00:00.000Z",
        updatedAt: "2026-10-21T17:00:05.000Z",
        failure: { code: "declined", message: "The refund was declined." },
      },
    },
  };

  it("normalises the documented success, failure and refund events", () => {
    expect(normaliseOnvoEvent(succeeded)).toMatchObject({
      event_id: "evt_vx7r5r6m33g2x9m2p8j2k1a4",
      environment: "live",
      type: "payment.succeeded",
      payment: { reference: "clpiment0001", amount_minor: 500000, currency: "CRC" },
    });
    expect(normaliseOnvoEvent(failed)).toMatchObject({
      environment: "test",
      type: "payment.failed",
      payment: {
        reference: "clpiment0002",
        failure_code: "declined",
        metadata: { orderId: "order_1002" },
      },
    });
    expect(normaliseOnvoEvent(refundFailed)).toMatchObject({
      type: "refund.failed",
      refund: {
        reference: "clref0001",
        payment_reference: "clpiment0001",
        amount_minor: 500000,
        failure_code: "declined",
      },
    });
  });

  it("names the session for a checkout event, and keeps nothing personal", () => {
    const event = normaliseOnvoEvent({
      id: "evt_cs",
      mode: "test",
      type: "checkout_session.succeeded",
      data: {
        object: {
          id: "cs_1",
          paymentIntentId: "pi_1",
          amountTotal: 2_150_000,
          currency: "CRC",
          paymentStatus: "paid",
          customerId: "cus_1",
          metadata: { attemptId: "a" },
        },
      },
    });
    expect(event.payment).toMatchObject({
      session_reference: "cs_1",
      reference: "pi_1",
      amount_minor: 2_150_000,
    });
    expect(JSON.stringify(event)).not.toContain("cus_1");
  });

  it("marks types it does not handle as ignored, and the connection test as a test", () => {
    expect(normaliseOnvoEvent({ id: "e", type: "payout.paid", data: { object: {} } }).type).toBe(
      "ignored",
    );
    expect(normaliseOnvoEvent({ id: "e", type: "webhook_endpoint.test", data: {} }).type).toBe(
      "endpoint.test",
    );
  });

  it("checks the signature on the raw body before reading it", async () => {
    const gateway = onvoGateway(settings, fakeFetch([]).impl);
    const raw = JSON.stringify(failed);
    const now = new Date("2026-10-21T16:12:01Z");
    const t = Math.floor(now.getTime() / 1000);
    const headers = new Headers({
      "x-onvo-signature": await signOnvoWebhook(raw, ["whsec_one"], t),
      "x-onvo-event-id": failed.id,
    });
    await expect(gateway.parseWebhook({ rawBody: raw, headers, now })).resolves.toMatchObject({
      type: "payment.failed",
    });
    await expect(
      gateway.parseWebhook({ rawBody: raw.replace("250000", "1"), headers, now }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
    const otherId = new Headers(headers);
    otherId.set("x-onvo-event-id", "evt_other");
    await expect(
      gateway.parseWebhook({ rawBody: raw, headers: otherId, now }),
    ).rejects.toMatchObject({
      reason: "event_id_mismatch",
    });
  });
});
