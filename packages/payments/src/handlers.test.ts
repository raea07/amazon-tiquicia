/**
 * The webhook receiver and the worker loop, with a fake clock, a fake
 * gateway and a fake database queue that records events once by id (as
 * private.payment_events does).
 */

import { describe, expect, it } from "vitest";
import type { PaymentsConfig } from "./config.ts";
import { createPaymentsWebhookHandler, createPaymentsWorkerHandler } from "./handlers.ts";
import { signOnvoWebhook } from "./signature.ts";
import {
  type Clock,
  GatewayError,
  type GatewayPayment,
  type Logger,
  type NormalisedEvent,
  type PaymentGateway,
  type PaymentsQueue,
  type PaymentTask,
} from "./types.ts";
import { returnUrls } from "./worker.ts";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const config: PaymentsConfig = {
  environment: "test",
  api: { url: "http://127.0.0.1:1", secretKey: "sb_secret_test" },
  workerToken: "worker-token",
  links: { shop: "https://shop.example", appScheme: "yuntera" },
  onvo: {
    baseUrl: "http://127.0.0.1:2",
    secretKey: "onvo_test_secret_key_x",
    webhookSecrets: ["whsec_current"],
    accountId: null,
    sinpeNumber: "+50670196686",
  },
  timeoutMs: 1000,
};

function fakeClock(start: string): Clock & { advance(seconds: number): void } {
  let now = new Date(start).getTime();
  return {
    now: () => new Date(now),
    advance: (seconds) => {
      now += seconds * 1000;
    },
  };
}

function fakeQueue(tasks: PaymentTask[][] = []) {
  const seen = new Set<string>();
  const events: NormalisedEvent[] = [];
  const reports: Array<Record<string, unknown>> = [];
  let failNext = false;
  const queue: PaymentsQueue = {
    hello: async (input) => ({
      mode: "test",
      gateway: "onvo",
      active: input.environment === "test",
    }),
    claim: async () => tasks.shift() ?? [],
    report: async (_worker, report) => {
      reports.push(report);
      return "recorded";
    },
    event: async (event) => {
      if (failNext) {
        failNext = false;
        throw new Error("database unavailable");
      }
      events.push(event);
      if (seen.has(event.event_id)) return "duplicate";
      seen.add(event.event_id);
      return "applied";
    },
  };
  return {
    queue,
    events,
    reports,
    failOnce: () => {
      failNext = true;
    },
  };
}

const envelope = {
  id: "evt_1",
  object: "event",
  createdAt: "2026-11-21T12:00:00.000Z",
  mode: "test",
  accountId: "acct",
  type: "checkout_session.succeeded",
  data: {
    object: {
      id: "cs_1",
      paymentIntentId: "pi_1",
      amountTotal: 2_150_000,
      currency: "CRC",
      paymentStatus: "paid",
      status: "complete",
      metadata: { attemptId: "a1" },
    },
  },
};

async function delivery(body: string, secrets: string[], at: Date, id = "evt_1") {
  return new Request("http://local/functions/v1/payments-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-onvo-signature": await signOnvoWebhook(body, secrets, Math.floor(at.getTime() / 1000)),
      "x-onvo-event-id": id,
    },
    body,
  });
}

describe("the webhook receiver", () => {
  it("records a valid event and answers 200 with what the database made of it", async () => {
    const clock = fakeClock("2026-11-21T12:00:02Z");
    const db = fakeQueue();
    const handler = createPaymentsWebhookHandler(config, {
      queue: db.queue,
      clock,
      logger: silent,
    });
    const raw = JSON.stringify(envelope);
    const response = await handler(await delivery(raw, ["whsec_current"], clock.now()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "applied" });
    expect(db.events[0]).toMatchObject({
      event_id: "evt_1",
      type: "payment.succeeded",
      payment: { session_reference: "cs_1", reference: "pi_1", amount_minor: 2_150_000 },
    });
  });

  it("refuses a tampered body, the wrong secret and a stale delivery with 400, recording nothing", async () => {
    const clock = fakeClock("2026-11-21T12:00:02Z");
    const db = fakeQueue();
    const handler = createPaymentsWebhookHandler(config, {
      queue: db.queue,
      clock,
      logger: silent,
    });
    const raw = JSON.stringify(envelope);

    const signed = await delivery(raw, ["whsec_current"], clock.now());
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: raw.replace("2150000", "1"),
    });
    expect((await handler(tampered)).status).toBe(400);
    expect((await handler(await delivery(raw, ["whsec_someone_else"], clock.now()))).status).toBe(
      400,
    );

    const old = await delivery(raw, ["whsec_current"], clock.now());
    clock.advance(301);
    expect((await handler(old)).status).toBe(400);
    expect(db.events).toHaveLength(0);
  });

  it("a replay inside the window reaches the database, which applies it once", async () => {
    const clock = fakeClock("2026-11-21T12:00:02Z");
    const db = fakeQueue();
    const handler = createPaymentsWebhookHandler(config, {
      queue: db.queue,
      clock,
      logger: silent,
    });
    const raw = JSON.stringify(envelope);
    const first = await handler(await delivery(raw, ["whsec_current"], clock.now()));
    clock.advance(30);
    const again = await handler(await delivery(raw, ["whsec_current"], clock.now()));
    expect(((await first.json()) as { outcome: string }).outcome).toBe("applied");
    expect(((await again.json()) as { outcome: string }).outcome).toBe("duplicate");
  });

  it("accepts either secret during a rotation", async () => {
    const clock = fakeClock("2026-11-21T12:00:02Z");
    const db = fakeQueue();
    const rotating = {
      ...config,
      onvo: { ...config.onvo, webhookSecrets: ["whsec_current", "whsec_next"] },
    };
    const handler = createPaymentsWebhookHandler(rotating, {
      queue: db.queue,
      clock,
      logger: silent,
    });
    const raw = JSON.stringify(envelope);
    expect((await handler(await delivery(raw, ["whsec_next"], clock.now()))).status).toBe(200);
    expect(
      (await handler(await delivery(raw, ["whsec_old", "whsec_current"], clock.now()))).status,
    ).toBe(200);
  });

  it("answers 500 when the database could not record it, so the gateway delivers it again", async () => {
    const clock = fakeClock("2026-11-21T12:00:02Z");
    const db = fakeQueue();
    const handler = createPaymentsWebhookHandler(config, {
      queue: db.queue,
      clock,
      logger: silent,
    });
    const raw = JSON.stringify(envelope);
    db.failOnce();
    expect((await handler(await delivery(raw, ["whsec_current"], clock.now()))).status).toBe(500);
    expect((await handler(await delivery(raw, ["whsec_current"], clock.now()))).status).toBe(200);
  });

  it("answers the connection test without the database, and 503 before it is set up", async () => {
    const clock = fakeClock("2026-11-21T12:00:02Z");
    const db = fakeQueue();
    const handler = createPaymentsWebhookHandler(config, {
      queue: db.queue,
      clock,
      logger: silent,
    });
    const test = JSON.stringify({
      id: "evt_t",
      type: "webhook_endpoint.test",
      mode: "test",
      data: {},
    });
    const response = await handler(await delivery(test, ["whsec_current"], clock.now(), "evt_t"));
    expect(response.status).toBe(200);
    expect(db.events).toHaveLength(0);

    const unset = { ...config, onvo: { ...config.onvo, webhookSecrets: [] } };
    const notReady = createPaymentsWebhookHandler(unset, {
      queue: db.queue,
      clock,
      logger: silent,
    });
    expect(
      (await notReady(await delivery(test, ["whsec_current"], clock.now(), "evt_t"))).status,
    ).toBe(503);
  });
});

function fakeGateway(
  overrides: Partial<PaymentGateway> = {},
): PaymentGateway & { calls: string[] } {
  const calls: string[] = [];
  const paid: GatewayPayment = {
    gateway: "onvo",
    reference: "pi_1",
    sessionReference: "cs_1",
    status: "succeeded",
    amountMinor: 2_150_000,
    currency: "CRC",
    updatedAt: "2026-11-21T12:01:00.000Z",
    nextAction: { kind: "none" },
    feeMinor: 84_000,
    refundedMinor: 0,
    metadata: {},
  };
  return {
    id: "onvo",
    calls,
    createPayment: async (input) => {
      calls.push(`create ${input.method} ${input.amountMinor} ${input.returnUrl}`);
      return {
        ...paid,
        status: "open",
        reference: null,
        nextAction: { kind: "redirect", url: "https://pay/cs_1" },
      };
    },
    getPayment: async () => {
      calls.push("get");
      return paid;
    },
    cancelPayment: async (ref) => {
      calls.push(`cancel ${ref.sessionReference ?? ref.reference}`);
    },
    refund: async (input) => {
      calls.push(`refund ${input.reference} ${input.amountMinor}`);
      return {
        reference: "rf_1",
        paymentReference: input.reference,
        status: "pending",
        amountMinor: input.amountMinor,
        currency: "CRC",
        updatedAt: null,
      };
    },
    getRefund: async () => ({
      reference: "rf_1",
      paymentReference: "pi_1",
      status: "succeeded",
      amountMinor: 1000,
      currency: "CRC",
      updatedAt: "2026-11-21T13:00:00.000Z",
    }),
    parseWebhook: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

const worker = (db: ReturnType<typeof fakeQueue>, gateway: PaymentGateway) =>
  createPaymentsWorkerHandler(config, {
    queue: db.queue,
    gateway,
    clock: fakeClock("2026-11-21T12:00:00Z"),
    logger: silent,
    workerId: "w1",
  });

const wake = (token = "worker-token") =>
  new Request("http://local/functions/v1/payments-worker?wait=1", {
    method: "POST",
    headers: { "x-worker-token": token },
  });

describe("the worker", () => {
  it("needs its token", async () => {
    const db = fakeQueue();
    expect((await worker(db, fakeGateway())(wake("wrong"))).status).toBe(401);
  });

  it("creates an attempt at the gateway with the database's amount and our return address", async () => {
    const db = fakeQueue([
      [
        {
          kind: "create",
          attempt_id: "a1",
          order_id: "o1",
          payment_id: "p1",
          order_number: "YT-100500",
          method: "card",
          amount_minor: 2_150_000,
          currency: "CRC",
          return_to: "web",
          expires_at: "2026-11-21T12:30:00Z",
          customer: { name: "Ana", email: "ana@example.com" },
          payer: null,
        },
      ],
    ]);
    const gateway = fakeGateway();
    const response = await worker(db, gateway)(wake());
    expect(await response.json()).toMatchObject({ active: true, tasks: 1, done: 1 });
    expect(gateway.calls).toEqual([
      "create card 2150000 https://shop.example/pedidos/YT-100500/pago/retorno",
    ]);
    expect(db.reports[0]).toMatchObject({
      kind: "created",
      outcome: "created",
      session_reference: "cs_1",
      checkout_url: "https://pay/cs_1",
      status: "open",
    });
  });

  it("reports a lost answer as unknown and never sends the create again", async () => {
    const db = fakeQueue([
      [
        {
          kind: "create",
          attempt_id: "a1",
          order_id: "o1",
          payment_id: "p1",
          order_number: "YT-1",
          method: "card",
          amount_minor: 1000,
          currency: "CRC",
          return_to: "app",
          expires_at: "2026-11-21T12:30:00Z",
          customer: null,
          payer: null,
        },
      ],
    ]);
    let creates = 0;
    const gateway = fakeGateway({
      createPayment: async () => {
        creates++;
        throw new GatewayError("unknown", "timeout", null, false);
      },
    });
    await worker(db, gateway)(wake());
    expect(creates).toBe(1);
    expect(db.reports).toEqual([
      { kind: "created", attempt_id: "a1", outcome: "unknown", retryable: false, code: "timeout" },
    ]);
  });

  it("asks about an unconfirmed attempt and hands the answer to the database as an event", async () => {
    const db = fakeQueue([
      [
        {
          kind: "check",
          attempt_id: "a1",
          order_number: "YT-1",
          method: "card",
          session_reference: "cs_1",
          intent_reference: null,
        },
      ],
    ]);
    await worker(db, fakeGateway())(wake());
    expect(db.events[0]).toMatchObject({
      source: "poll",
      type: "payment.succeeded",
      attempt_id: "a1",
      event_id: "poll:a1:succeeded:2026-11-21T12:01:00.000Z",
      payment: { reference: "pi_1", fee_minor: 84_000 },
    });
  });

  it("sends a refund once and reports the gateway's id; a refusal is final, a lost answer unknown", async () => {
    const refundTask = (id: string): PaymentTask => ({
      kind: "refund",
      gateway_refund_id: id,
      order_number: "YT-1",
      payment_reference: "pi_1",
      provider_refund_reference: null,
      amount_minor: 1000,
      currency: "CRC",
      reason: "requested_by_customer",
      known_refunded_minor: 0,
    });
    const db = fakeQueue([[refundTask("g1"), refundTask("g2"), refundTask("g3")]]);
    let n = 0;
    const gateway = fakeGateway({
      refund: async (input) => {
        n++;
        if (n === 2) throw new GatewayError("refused", "insufficient_funds", 422, false);
        if (n === 3) throw new GatewayError("unknown", "timeout", null, false);
        return {
          reference: "rf_1",
          paymentReference: input.reference,
          status: "pending",
          amountMinor: input.amountMinor,
          currency: "CRC",
          updatedAt: null,
        };
      },
    });
    await worker(db, gateway)(wake());
    expect(db.reports.map((r) => [r.gateway_refund_id, r.outcome])).toEqual([
      ["g1", "accepted"],
      ["g2", "refused"],
      ["g3", "unknown"],
    ]);
    expect(n).toBe(3);
  });

  it("for a send whose answer was lost, reports what the gateway has refunded", async () => {
    const db = fakeQueue([
      [
        {
          kind: "refund_check",
          gateway_refund_id: "g1",
          order_number: "YT-1",
          payment_reference: "pi_1",
          provider_refund_reference: null,
          amount_minor: 1000,
          currency: "CRC",
          reason: "requested_by_customer",
          known_refunded_minor: 0,
        },
      ],
    ]);
    await worker(db, fakeGateway())(wake());
    expect(db.reports[0]).toEqual({
      kind: "refund_checked",
      gateway_refund_id: "g1",
      provider_refunded_minor: 0,
    });
  });

  it("does nothing when the database's mode is not its environment", async () => {
    const db = fakeQueue([[{ kind: "check" } as PaymentTask]]);
    const live = createPaymentsWorkerHandler(
      {
        ...config,
        environment: "live",
        onvo: { ...config.onvo, secretKey: "onvo_live_secret_key_x" },
      },
      { queue: db.queue, gateway: fakeGateway(), logger: silent },
    );
    expect(await (await live(wake())).json()).toMatchObject({ active: false, tasks: 0 });
  });

  it("sends a native shopper back to the app by its deep link", () => {
    expect(returnUrls(config, "YT-1", "app")).toEqual({
      returnUrl: "yuntera://pedidos/YT-1?pago=retorno",
      cancelUrl: "yuntera://pedidos/YT-1?pago=cancelado",
    });
  });
});
