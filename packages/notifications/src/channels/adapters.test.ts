/**
 * Each adapter against the request and response shapes recorded in
 * docs/research/notifications-email-whatsapp-push.md (1.2, 1.3, 2.3, 2.8, 4.3, 4.4).
 */

import { describe, expect, it } from "vitest";
import type { OutboundMessage, SendResult } from "../types.ts";
import { birdEmail } from "./bird-email.ts";
import { birdSms } from "./bird-sms.ts";
import { birdWhatsApp } from "./bird-whatsapp.ts";
import { expoPush, expoReceipts } from "./expo-push.ts";

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(
  answers: Array<
    { status: number; body: unknown; headers?: Record<string, string> } | "timeout" | "reset"
  >,
) {
  const calls: Recorded[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const answer = answers.shift() ?? { status: 500, body: {} };
    if (answer === "reset") throw new TypeError("fetch failed");
    if (answer === "timeout") {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: answer.headers,
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const bird = { baseUrl: "https://us1.platform.bird.com", apiKey: "bk_us1_test" };
const email = birdEmail({
  ...bird,
  from: {
    orders: "pedidos@mail.yuntera.cr",
    account: "cuenta@mail.yuntera.cr",
    sellers: "vendedores@mail.yuntera.cr",
  },
  replyTo: "ayuda@yuntera.cr",
  env: "prod",
});

const emailMessage: OutboundMessage = {
  deliveryId: "7b0c0000-0000-4000-8000-000000000001",
  idempotencyKey: "yt/prod/7b0c0000-0000-4000-8000-000000000001/0",
  category: "transactional",
  template: "order_placed",
  to: { channel: "email", email: "ana@correo.cr", name: "Ana" },
  content: {
    channel: "email",
    subject: "Recibimos su pedido YT-000123",
    html: "<p>x</p>",
    text: "x",
    from: "orders",
  },
};

async function sendEmail(answers: Parameters<typeof fakeFetch>[0]) {
  const { impl, calls } = fakeFetch(answers);
  const requestBody = email.buildRequest(emailMessage);
  const result = await email.send({ ...emailMessage, requestBody }, { fetch: impl, timeoutMs: 50 });
  return { result, calls, requestBody };
}

describe("Bird e-mail", () => {
  it("sends the request of section 1.2", async () => {
    const { result, calls } = await sendEmail([
      { status: 202, body: { id: "em_01J", status: "accepted" } },
    ]);
    expect(result).toMatchObject({ ok: true, provider: "bird", providerMessageId: "em_01J" });
    const call = calls[0];
    expect(call?.url).toBe("https://us1.platform.bird.com/v1/email/messages");
    expect(call?.headers.authorization).toBe("Bearer bk_us1_test");
    expect(call?.headers["idempotency-key"]).toBe("yt/prod/7b0c0000-0000-4000-8000-000000000001/0");
    const body = JSON.parse(call?.body ?? "{}");
    expect(body).toEqual({
      from: { email: "pedidos@mail.yuntera.cr", name: "Yuntera" },
      to: [{ email: "ana@correo.cr", name: "Ana" }],
      reply_to: ["ayuda@yuntera.cr"],
      subject: "Recibimos su pedido YT-000123",
      html: "<p>x</p>",
      text: "x",
      category: "transactional",
      track_opens: false,
      track_clicks: false,
      tags: [
        { name: "template", value: "order_placed" },
        { name: "env", value: "prod" },
      ],
      metadata: { delivery_id: emailMessage.deliveryId, template: "order_placed" },
      reference: emailMessage.deliveryId,
    });
    // Never `parameters`: Bird would run the text as Liquid.
    expect(body).not.toHaveProperty("parameters");
  });

  it("resends the frozen bytes exactly", async () => {
    const { impl, calls } = fakeFetch([{ status: 202, body: { id: "em_1" } }]);
    const frozen = '{"frozen":true}';
    await email.send({ ...emailMessage, requestBody: frozen }, { fetch: impl, timeoutMs: 50 });
    expect(calls[0]?.body).toBe(frozen);
  });

  // The generation rule (corrections item 1): a new key after any refused
  // request except 409 E01004 and 429; the same key after network errors and 5xx.
  const cases: Array<
    [string, Parameters<typeof fakeFetch>[0][number], Partial<Extract<SendResult, { ok: false }>>]
  > = [
    ["connection reset", "reset", { kind: "retry", newKey: false }],
    ["timeout", "timeout", { kind: "retry", newKey: false, code: "timeout" }],
    ["500", { status: 500, body: {} }, { kind: "retry", newKey: false }],
    [
      "503 E01033 protection unavailable",
      {
        status: 503,
        body: { error: { type: "api_error", code: "E01033", name: "IdempotencyUnavailable" } },
      },
      { kind: "retry", newKey: false, retryAfterSeconds: 30 },
    ],
    [
      "429 rate limited",
      {
        status: 429,
        body: { error: { type: "rate_limit_error", code: "E01003", name: "RateLimited" } },
        headers: { "retry-after": "17" },
      },
      { kind: "retry", newKey: false, retryAfterSeconds: 17 },
    ],
    [
      "409 E01004 in progress",
      { status: 409, body: { error: { code: "E01004", name: "RequestInProgress" } } },
      { kind: "retry", newKey: false, retryAfterSeconds: 30 },
    ],
    [
      "409 E01005 key reused with another body",
      { status: 409, body: { error: { code: "E01005", name: "IdempotencyKeyReuse" } } },
      { kind: "permanent", newKey: true },
    ],
    [
      "422 reserved recipient domain",
      {
        status: 422,
        body: {
          error: {
            type: "invalid_request_error",
            code: "E02001",
            message: "Recipient ana@example.com is not allowed",
          },
        },
      },
      { kind: "permanent", newKey: true },
    ],
    [
      "401 bad key",
      { status: 401, body: { error: { type: "authentication_error" } } },
      { kind: "config", newKey: true },
    ],
    [
      "421 wrong region",
      { status: 421, body: { error: { type: "misdirected_error" } } },
      { kind: "config", newKey: true },
    ],
    [
      "402 wallet empty",
      { status: 402, body: { error: { name: "WalletInsufficientBalance" } } },
      { kind: "account", newKey: true },
    ],
    ["418 anything else", { status: 418, body: {} }, { kind: "retry", newKey: true }],
  ];
  for (const [label, answer, expected] of cases) {
    it(`classifies ${label}`, async () => {
      const { result } = await sendEmail([answer]);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject(expected);
    });
  }

  it("never stores an address quoted back in an error", async () => {
    const { result } = await sendEmail([
      {
        status: 422,
        body: { error: { message: "Recipient ana@example.com (+50688881234) rejected" } },
      },
    ]);
    expect(result.ok || result.message).not.toMatch(/ana@example|88881234/);
  });
});

describe("Bird WhatsApp", () => {
  it("sends a template by slug with named parameters (section 2.3)", async () => {
    const adapter = birdWhatsApp({ ...bird, from: "+50622223333" });
    const message: OutboundMessage = {
      ...emailMessage,
      template: "shipment_out_for_delivery",
      to: { channel: "whatsapp", phone: "+50688881234" },
      content: {
        channel: "whatsapp",
        templateSlug: "shipment_out_for_delivery",
        language: "es",
        parameters: { first_name: "Ana", order_number: "YT-000123", button_url: "YT-000123" },
      },
    };
    const { impl, calls } = fakeFetch([
      { status: 202, body: { id: "wam_01", status: "accepted" } },
    ]);
    const result = await adapter.send(
      { ...message, requestBody: adapter.buildRequest(message) },
      { fetch: impl, timeoutMs: 50 },
    );
    expect(result).toMatchObject({ ok: true, providerMessageId: "wam_01" });
    expect(calls[0]?.url).toBe("https://us1.platform.bird.com/v1/whatsapp/messages");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      to: "+50688881234",
      from: "+50622223333",
      template: {
        slug: "shipment_out_for_delivery",
        language: "es",
        parameters: { first_name: "Ana", order_number: "YT-000123", button_url: "YT-000123" },
      },
      tags: [{ name: "template", value: "shipment_out_for_delivery" }],
      metadata: { delivery_id: emailMessage.deliveryId },
      reference: emailMessage.deliveryId,
    });
  });

  it("echoes the request's generation in the metadata, so late reports can be told apart", () => {
    const body = JSON.parse(email.buildRequest({ ...emailMessage, generation: 3 }));
    expect(body.metadata).toEqual({
      delivery_id: emailMessage.deliveryId,
      template: emailMessage.template,
      generation: "3",
    });
  });

  it("refuses to send without our own number", async () => {
    const adapter = birdWhatsApp({ ...bird, from: "" });
    const result = await adapter.send(
      { ...emailMessage, requestBody: "{}" },
      { fetch: fakeFetch([]).impl, timeoutMs: 50 },
    );
    expect(result).toMatchObject({ ok: false, kind: "config", code: "no_sender" });
  });
});

describe("Bird SMS", () => {
  it("sends text with a transactional category (section 2.8)", async () => {
    const adapter = birdSms({ ...bird, from: "Yuntera" });
    const message: OutboundMessage = {
      ...emailMessage,
      to: { channel: "sms", phone: "+50688881234" },
      content: { channel: "sms", text: "Yuntera: su pedido va en camino." },
    };
    const { impl, calls } = fakeFetch([{ status: 202, body: { id: "sms_01" } }]);
    await adapter.send(
      { ...message, requestBody: adapter.buildRequest(message) },
      { fetch: impl, timeoutMs: 50 },
    );
    expect(calls[0]?.url).toBe("https://us1.platform.bird.com/v1/sms/messages");
    expect(JSON.parse(calls[0]?.body ?? "")).toMatchObject({
      to: "+50688881234",
      from: "Yuntera",
      text: "Yuntera: su pedido va en camino.",
      category: "transactional",
    });
  });
});

describe("Expo push", () => {
  const push = expoPush({ baseUrl: "https://exp.host", accessToken: "expo-token" });
  const message: OutboundMessage = {
    ...emailMessage,
    template: "shipment_out_for_delivery",
    to: {
      channel: "push",
      app: "shop",
      tokens: ["ExponentPushToken[aaaaaaaaaa]", "ExponentPushToken[bbbbbbbbbb]"],
    },
    content: {
      channel: "push",
      title: "Su pedido va en camino",
      body: "YT-000123 llega hoy.",
      data: { url: "/pedidos/YT-000123" },
      channelId: "pedidos",
      priority: "high",
      ttlSeconds: 14400,
      collapseId: "yt-YT-000123",
      tag: "yt-YT-000123",
    },
  };

  it("sends one message per token with collapse id and tag (section 4.3)", async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          data: [
            { status: "ok", id: "r1" },
            { status: "error", message: "x", details: { error: "DeviceNotRegistered" } },
          ],
        },
      },
    ]);
    const result = await push.send(
      { ...message, requestBody: push.buildRequest(message) },
      { fetch: impl, timeoutMs: 50 },
    );
    expect(calls[0]?.url).toBe("https://exp.host/--/api/v2/push/send");
    expect(calls[0]?.headers.authorization).toBe("Bearer expo-token");
    const sent = JSON.parse(calls[0]?.body ?? "[]");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[aaaaaaaaaa]",
      collapseId: "yt-YT-000123",
      tag: "yt-YT-000123",
      ttl: 14400,
      priority: "high",
      channelId: "pedidos",
    });
    expect(result).toMatchObject({
      ok: true,
      providerMessageId: "r1",
      pushTicketIds: ["r1 ExponentPushToken[aaaaaaaaaa]"],
      disableTokens: ["ExponentPushToken[bbbbbbbbbb]"],
    });
  });

  it("skips the recipient when every device is gone", async () => {
    const { impl } = fakeFetch([
      {
        status: 200,
        body: {
          data: [
            { status: "error", details: { error: "DeviceNotRegistered" } },
            { status: "error", details: { error: "DeviceNotRegistered" } },
          ],
        },
      },
    ]);
    const result = await push.send(
      { ...message, requestBody: push.buildRequest(message) },
      { fetch: impl, timeoutMs: 50 },
    );
    expect(result).toMatchObject({
      ok: false,
      kind: "recipient",
      disableTokens: message.to.channel === "push" ? message.to.tokens : [],
    });
  });

  it("maps request errors", async () => {
    for (const [status, body, kind] of [
      [429, { errors: [{ code: "TOO_MANY_REQUESTS" }] }, "retry"],
      [401, { errors: [{ code: "UNAUTHORIZED" }] }, "config"],
      [400, { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS" }] }, "permanent"],
      [502, {}, "retry"],
    ] as const) {
      const { impl } = fakeFetch([{ status, body }]);
      const result = await push.send(
        { ...message, requestBody: push.buildRequest(message) },
        { fetch: impl, timeoutMs: 50 },
      );
      expect(result, String(status)).toMatchObject({ ok: false, kind, newKey: false });
    }
  });

  it("reads receipts and names dead tokens (section 4.4)", async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          data: {
            r1: { status: "ok" },
            r2: { status: "error", details: { error: "DeviceNotRegistered" } },
          },
        },
      },
    ]);
    const result = await expoReceipts(
      { baseUrl: "https://exp.host", accessToken: "" },
      [
        "r1 ExponentPushToken[aaaaaaaaaa]",
        "r2 ExponentPushToken[bbbbbbbbbb]",
        "r3 ExponentPushToken[cccccccccc]",
      ],
      { fetch: impl, timeoutMs: 50 },
    );
    expect(calls[0]?.url).toBe("https://exp.host/--/api/v2/push/getReceipts");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ ids: ["r1", "r2", "r3"] });
    expect(result?.updates.map((u) => [u.providerMessageId, u.status])).toEqual([
      ["r1", "delivered"],
      ["r2", "failed"],
    ]);
    expect(result?.disableTokens).toEqual(["ExponentPushToken[bbbbbbbbbb]"]);
  });
});
