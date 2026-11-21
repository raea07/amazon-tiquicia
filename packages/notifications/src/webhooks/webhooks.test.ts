import { describe, expect, it } from "vitest";
import { configFromEnv } from "../config.ts";
import { createBirdWebhookHandler } from "../handlers.ts";
import type { DeliveryQueue, DeliveryUpdate } from "../types.ts";
import { parseBirdEvent } from "./bird.ts";
import { signStandardWebhook, verifyStandardWebhook } from "./standard.ts";

// The example from the Standard Webhooks specification.
const SPEC_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const SPEC_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const SPEC_TS = 1614265330;
const SPEC_BODY = '{"test": 2432232314}';
const SPEC_SIGNATURE = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

const headersOf = (record: Record<string, string>) => new Headers(record);

describe("Standard Webhooks signature", () => {
  it("matches the specification's own example", async () => {
    const signed = await signStandardWebhook(SPEC_BODY, SPEC_SECRET, SPEC_ID, SPEC_TS);
    expect(signed["webhook-signature"]).toBe(SPEC_SIGNATURE);
    const verdict = await verifyStandardWebhook(
      SPEC_BODY,
      headersOf(signed),
      [SPEC_SECRET],
      SPEC_TS * 1000,
    );
    expect(verdict).toEqual({ ok: true, id: SPEC_ID, timestamp: SPEC_TS });
  });

  it("refuses a tampered body", async () => {
    const signed = await signStandardWebhook(SPEC_BODY, SPEC_SECRET, SPEC_ID, SPEC_TS);
    const verdict = await verifyStandardWebhook(
      '{"test": 2432232315}',
      headersOf(signed),
      [SPEC_SECRET],
      SPEC_TS * 1000,
    );
    expect(verdict).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses the wrong secret", async () => {
    const signed = await signStandardWebhook(SPEC_BODY, SPEC_SECRET, SPEC_ID, SPEC_TS);
    const verdict = await verifyStandardWebhook(
      SPEC_BODY,
      headersOf(signed),
      [`whsec_${btoa("another secret")}`],
      SPEC_TS * 1000,
    );
    expect(verdict.ok).toBe(false);
  });

  it("refuses a stale or future timestamp", async () => {
    const signed = await signStandardWebhook(SPEC_BODY, SPEC_SECRET, SPEC_ID, SPEC_TS);
    for (const offset of [301, -301]) {
      const verdict = await verifyStandardWebhook(
        SPEC_BODY,
        headersOf(signed),
        [SPEC_SECRET],
        (SPEC_TS + offset) * 1000,
      );
      expect(verdict).toEqual({ ok: false, reason: "stale" });
    }
  });

  it("accepts either secret during a rotation, and Supabase's v1,whsec_ format", async () => {
    const signed = await signStandardWebhook(SPEC_BODY, SPEC_SECRET, SPEC_ID, SPEC_TS);
    const rotating = { ...signed, "webhook-signature": `v1,AAAA ${signed["webhook-signature"]}` };
    expect(
      (
        await verifyStandardWebhook(
          SPEC_BODY,
          headersOf(rotating),
          [`whsec_${btoa("old")}`, SPEC_SECRET],
          SPEC_TS * 1000,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await verifyStandardWebhook(
          SPEC_BODY,
          headersOf(signed),
          [`v1,${SPEC_SECRET}`],
          SPEC_TS * 1000,
        )
      ).ok,
    ).toBe(true);
  });

  it("refuses missing headers", async () => {
    expect(await verifyStandardWebhook(SPEC_BODY, new Headers(), [SPEC_SECRET])).toEqual({
      ok: false,
      reason: "missing_headers",
    });
  });
});

describe("Bird events", () => {
  it("reads an e-mail hard bounce (section 1.6)", () => {
    const [update] = parseBirdEvent(
      JSON.stringify({
        type: "email.bounced",
        timestamp: "2026-07-23T14:51:47.107Z",
        data: {
          email_id: "em_01",
          recipient: "ana@correo.cr",
          metadata: { delivery_id: "7b0c" },
          bounce_type: "hard",
          bounce_class: 10,
        },
      }),
    );
    expect(update).toMatchObject({
      provider: "bird",
      channel: "email",
      providerMessageId: "em_01",
      deliveryId: "7b0c",
      status: "bounced",
      permanent: true,
      recipientAddress: "ana@correo.cr",
      occurredAt: "2026-07-23T14:51:47.107Z",
    });
  });

  it("reads WhatsApp delivery and an opt-out rejection (sections 2.5, 2.7)", () => {
    expect(
      parseBirdEvent(
        JSON.stringify({
          type: "whatsapp.delivered",
          timestamp: "t",
          data: { whatsapp_id: "wam_1", metadata: { delivery_id: "d" } },
        }),
      )[0],
    ).toMatchObject({ status: "delivered", providerMessageId: "wam_1", channel: "whatsapp" });
    const rejected = parseBirdEvent(
      JSON.stringify({
        type: "whatsapp.rejected",
        timestamp: "t",
        data: {
          whatsapp_id: "wam_2",
          to: { phone_number: "+50688881234" },
          error: { code: "recipient_suppressed" },
        },
      }),
    );
    expect(rejected.map((u) => u.status)).toEqual(["rejected", "opted_out"]);
    expect(rejected[1]?.recipientAddress).toBe("+50688881234");
  });

  it("ignores what it does not act on", () => {
    expect(parseBirdEvent(JSON.stringify({ type: "email.opened", data: {} }))).toEqual([]);
    expect(parseBirdEvent("not json")).toEqual([]);
  });
});

describe("the webhook receiver", () => {
  const secret = `whsec_${btoa("local webhook secret for tests")}`;
  const config = configFromEnv(
    (name) =>
      ({
        NOTIFY_API_URL: "http://api.test",
        NOTIFY_SECRET_KEY: "sb_secret_test",
        NOTIFY_WORKER_TOKEN: "t",
        BIRD_WEBHOOK_SECRETS: secret,
      })[name],
  );
  const now = 1_790_000_000;

  function memoryQueue() {
    const seen = new Set<string>();
    const applied: DeliveryUpdate[] = [];
    const queue = {
      applyUpdate: async (update: DeliveryUpdate, webhookId?: string) => {
        if (webhookId && seen.has(webhookId)) return "duplicate";
        if (webhookId) seen.add(webhookId);
        applied.push(update);
        return "applied";
      },
    } as unknown as DeliveryQueue;
    return { queue, applied };
  }

  const body = JSON.stringify({
    type: "email.delivered",
    timestamp: "2026-11-21T18:00:00Z",
    data: { email_id: "em_9", metadata: { delivery_id: "d9" } },
  });

  async function post(
    handler: (r: Request) => Promise<Response>,
    raw: string,
    headers: Record<string, string>,
  ) {
    return handler(
      new Request("http://functions.test/bird-webhook", { method: "POST", body: raw, headers }),
    );
  }

  it("applies a valid event once, and a replay of it never again", async () => {
    const { queue, applied } = memoryQueue();
    const handler = createBirdWebhookHandler(config, {
      queue,
      clock: { now: () => new Date(now * 1000), sleep: async () => {} },
    });
    const headers = await signStandardWebhook(body, secret, "msg_1", now);
    const first = await post(handler, body, headers);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, outcomes: ["applied"] });
    const replay = await post(handler, body, headers);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ received: true, outcomes: ["duplicate"] });
    expect(applied).toHaveLength(1);
  });

  it("refuses a tampered body, a wrong secret and a stale timestamp", async () => {
    const { queue, applied } = memoryQueue();
    const handler = createBirdWebhookHandler(config, {
      queue,
      clock: { now: () => new Date(now * 1000), sleep: async () => {} },
    });
    const good = await signStandardWebhook(body, secret, "msg_2", now);
    expect((await post(handler, body.replace("em_9", "em_8"), good)).status).toBe(401);
    expect(
      (
        await post(
          handler,
          body,
          await signStandardWebhook(body, `whsec_${btoa("nope")}`, "msg_3", now),
        )
      ).status,
    ).toBe(401);
    expect(
      (await post(handler, body, await signStandardWebhook(body, secret, "msg_4", now - 3600)))
        .status,
    ).toBe(401);
    expect(applied).toHaveLength(0);
  });

  it("answers an error when the update could not be recorded, so Bird tries again", async () => {
    const queue = {
      applyUpdate: async () => Promise.reject(new Error("db down")),
    } as unknown as DeliveryQueue;
    const handler = createBirdWebhookHandler(config, {
      queue,
      clock: { now: () => new Date(now * 1000), sleep: async () => {} },
      logger: { info() {}, warn() {}, error() {} },
    });
    expect(
      (await post(handler, body, await signStandardWebhook(body, secret, "msg_5", now))).status,
    ).toBe(500);
  });
});
