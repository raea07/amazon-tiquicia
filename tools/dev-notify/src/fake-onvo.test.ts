import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type CreatePaymentInput,
  normaliseOnvoEvent,
  onvoGateway,
  verifyOnvoSignature,
} from "@yuntera/payments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeOnvo } from "./fake-onvo.ts";

const SECRET = "whsec_fake_test";

/** A webhook receiver that records what the fake sends, after checking its signature. */
function receiver() {
  const received: Array<{ type: string; id: string; valid: boolean }> = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      const verdict = await verifyOnvoSignature(
        body,
        String(req.headers["x-onvo-signature"] ?? ""),
        [SECRET],
        Math.floor(Date.now() / 1000),
      );
      const event = normaliseOnvoEvent(JSON.parse(body));
      received.push({ type: event.provider_type, id: event.event_id, valid: verdict.ok });
      res.writeHead(200);
      res.end("{}");
    });
  });
  return {
    received,
    start: () =>
      new Promise<string>((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`),
        ),
      ),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const until = async (what: string, check: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe("the fake payment gateway", () => {
  let hook: ReturnType<typeof receiver>;
  let fake: ReturnType<typeof createFakeOnvo>;
  let gateway: ReturnType<typeof onvoGateway>;

  beforeEach(async () => {
    hook = receiver();
    const url = await hook.start();
    fake = createFakeOnvo({
      webhookUrl: url,
      webhookSecrets: [SECRET],
      publicUrl: "http://fake.test",
      sinpeDelayMs: 50,
      refundDelayMs: 50,
    });
    // In process, as fetch would be over the network: an aborted request rejects.
    const impl = ((input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
        fake.handle(new Request(input, init)).then(resolve, reject);
      })) as typeof fetch;
    gateway = onvoGateway(
      {
        baseUrl: "http://fake.test",
        secretKey: "onvo_test_secret_key_unit",
        webhookSecrets: [SECRET],
        sinpeNumber: "+50670196686",
        timeoutMs: 1000,
        environment: "test",
      },
      impl,
    );
  });
  afterEach(async () => {
    fake.close();
    await hook.stop();
  });

  it("refuses a live key", async () => {
    const response = await fake.handle(
      new Request("http://fake.test/v1/payment-intents", {
        method: "POST",
        headers: { authorization: "Bearer onvo_live_secret_key_x" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("serves a hosted page whose approval sends signed session and intent events", async () => {
    const payment = await gateway.createPayment({
      attemptId: "a",
      paymentId: "p",
      orderId: "o",
      orderNumber: "YT-1",
      amountMinor: 1_000_000,
      currency: "CRC",
      method: "card",
      customer: {},
      returnUrl: "http://shop/r",
      cancelUrl: "http://shop/c",
      expiresAt: new Date(),
    });
    expect(payment.nextAction).toMatchObject({ kind: "redirect" });
    const page = await fake.handle(new Request(`http://fake.test/pay/${payment.sessionReference}`));
    expect(await page.text()).toContain("fake-approve");
    const approved = await fake.handle(
      new Request(`http://fake.test/pay/${payment.sessionReference}/act`, {
        method: "POST",
        body: new URLSearchParams({ action: "approve" }),
      }),
    );
    expect(approved.headers.get("location")).toBe("http://shop/r");
    await until("two events", () => hook.received.length === 2);
    expect(hook.received.map((e) => e.type).sort()).toEqual([
      "checkout_session.succeeded",
      "payment_intent.succeeded",
    ]);
    expect(hook.received.every((e) => e.valid)).toBe(true);
    expect(await gateway.getPayment({ sessionReference: payment.sessionReference })).toMatchObject({
      status: "succeeded",
      feeMinor: 56_745,
    });
  });

  it("matches a SINPE Móvil transfer by the payer and the exact amount", async () => {
    const payment = await gateway.createPayment({
      attemptId: "a",
      paymentId: "p",
      orderId: "o",
      orderNumber: "YT-2",
      amountMinor: 500_000,
      currency: "CRC",
      method: "sinpe_movil",
      customer: {},
      sinpe: { payer: { kind: "national", number: "113931919" }, phoneE164: "+50688881111" },
      returnUrl: "x",
      cancelUrl: "y",
      expiresAt: new Date(),
    });
    expect(payment.status).toBe("processing");
    const send = (body: unknown) =>
      fake.handle(
        new Request("http://fake.test/_fake/sinpe/transfer", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    // Another account, or another amount: not this payment.
    expect(await (await send({ identification: "02-0000-0000", amount: 500_000 })).json()).toEqual({
      matched: null,
    });
    expect(await (await send({ identification: "01-1393-1919", amount: 400_000 })).json()).toEqual({
      matched: null,
    });
    expect(await (await send({ identification: "01-1393-1919", amount: 500_000 })).json()).toEqual({
      matched: payment.reference,
    });
    await until("succeeded", () =>
      hook.received.some((e) => e.type === "payment_intent.succeeded"),
    );
    expect(hook.received.filter((e) => e.type === "mobile_transfer.received")).toHaveLength(2);
  });

  it("can lose the answer to a refund it did create", async () => {
    const payment = await gateway.createPayment({
      attemptId: "a",
      paymentId: "p",
      orderId: "o",
      orderNumber: "YT-3",
      amountMinor: 500_000,
      currency: "CRC",
      method: "sinpe_movil",
      customer: {},
      sinpe: { payer: { kind: "national", number: "113931919" }, phoneE164: "+50688888888" },
      returnUrl: "x",
      cancelUrl: "y",
      expiresAt: new Date(),
    });
    await until("paid", () => hook.received.some((e) => e.type === "payment_intent.succeeded"));
    await fake.handle(
      new Request("http://fake.test/_fake/behaviour", {
        method: "POST",
        body: '{"refunds":"lose"}',
      }),
    );
    await expect(
      gateway.refund({
        refundId: "r",
        reference: payment.reference ?? "",
        amountMinor: 100_000,
        reason: "other",
      }),
    ).rejects.toMatchObject({ kind: "unknown" });
    await until("refund settled", () => hook.received.some((e) => e.type === "refund.succeeded"));
    expect((await gateway.getPayment({ reference: payment.reference })).refundedMinor).toBe(
      100_000,
    );
  });
  it("can be down or slow at its API, which the adapter reports as an unknown outcome", async () => {
    const input: CreatePaymentInput = {
      attemptId: "a-down",
      paymentId: "p",
      orderId: "o",
      orderNumber: "YT-4",
      amountMinor: 500_000,
      currency: "CRC",
      method: "card",
      customer: {},
      returnUrl: "http://shop.test/retorno",
      cancelUrl: "http://shop.test/cancelado",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    };
    const set = (behaviour: Record<string, unknown>) =>
      fake.handle(
        new Request("http://fake.test/_fake/behaviour", {
          method: "POST",
          body: JSON.stringify(behaviour),
        }),
      );
    await set({ api: "down" });
    await expect(gateway.createPayment(input)).rejects.toMatchObject({ kind: "unknown" });
    await set({ api: "slow", apiDelayMs: 1500 });
    await expect(gateway.createPayment(input)).rejects.toMatchObject({
      kind: "unknown",
      code: "timeout",
    });
    await set({ api: "up" });
    expect((await gateway.createPayment(input)).nextAction).toMatchObject({ kind: "redirect" });
  });
});
