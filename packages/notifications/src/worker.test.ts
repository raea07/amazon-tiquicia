/**
 * The worker's loop with a fake clock, an in-memory queue that follows the
 * database's rules (lease, back-off, generation, dead letter) and scripted
 * adapters.
 */

import { describe, expect, it } from "vitest";
import { configFromEnv } from "./config.ts";
import { createAuthEmailHandler, createWorkerHandler } from "./handlers.ts";
import type {
  ChannelAdapter,
  ClaimedDelivery,
  Clock,
  DeliveryQueue,
  FailureKind,
  SendResult,
} from "./types.ts";
import { signStandardWebhook } from "./webhooks/standard.ts";
import { idempotencyKey, quietUntil, runOnce } from "./worker.ts";

const silent = { info() {}, warn() {}, error() {} };

function fakeClock(start: string): Clock & { advance(ms: number): void } {
  let now = new Date(start).getTime();
  return {
    now: () => new Date(now),
    sleep: async (ms) => {
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

interface Row extends ClaimedDelivery {
  status: string;
  availableAt: number;
  lockedBy: string | null;
  maxAttempts: number;
  sentWith?: string;
  skipReason?: string;
  lastCode?: string;
}

function memoryQueue(clock: Clock, rows: Array<Partial<Row>>) {
  const store: Row[] = rows.map((row, index) => ({
    id: `d${index}`,
    channel: "email",
    category: "transactional",
    template: "payment_received",
    locale: "es-CR",
    audience: "shopper",
    generation: 0,
    attempts: 0,
    request_body: null,
    commercial_consent: true,
    to: { channel: "email", email: "ana@correo.cr", name: "Ana" },
    vars: { order_number: "YT-100123", total_minor: 100_000, payment_method: "card" },
    status: "pending",
    availableAt: 0,
    lockedBy: null,
    maxAttempts: 3,
    ...row,
  }));
  const own = (id: string, worker: string) =>
    store.find((r) => r.id === id && r.lockedBy === worker && r.status === "sending");
  const queue: DeliveryQueue = {
    plan: async () => 0,
    claim: async (worker, limit) => {
      const due = store
        .filter((r) => r.status === "pending" && r.availableAt <= clock.now().getTime())
        .slice(0, limit);
      for (const r of due) {
        r.status = "sending";
        r.lockedBy = worker;
        r.attempts += 1;
      }
      return due.map((r) => ({ ...r }));
    },
    freeze: async (id, worker, generation, body) => {
      const r = own(id, worker);
      if (!r || r.generation !== generation) return false;
      r.request_body ??= body;
      return true;
    },
    sent: async (id, worker) => {
      const r = own(id, worker);
      if (!r) return false;
      r.status = "sent";
      r.lockedBy = null;
      r.request_body = null;
      return true;
    },
    fail: async (
      id,
      worker,
      failure: { kind: FailureKind; code: string; newKey: boolean },
      retryAfter,
    ) => {
      const r = own(id, worker);
      if (!r) return null;
      r.lastCode = failure.code;
      r.lockedBy = null;
      if (failure.kind === "account") {
        r.status = "pending";
        r.attempts -= 1;
        r.availableAt = clock.now().getTime() + Math.max(retryAfter ?? 0, 900) * 1000;
      } else if (failure.kind === "retry" && r.attempts < r.maxAttempts) {
        r.status = "pending";
        r.availableAt =
          clock.now().getTime() + Math.max(retryAfter ?? 0, 15 * 2 ** (r.attempts - 1)) * 1000;
      } else {
        r.status = "dead";
      }
      if (failure.newKey && r.status === "pending") {
        r.generation += 1;
        r.request_body = null;
      }
      if (r.status === "dead") r.request_body = null;
      return r.status;
    },
    defer: async (id, worker, until) => {
      const r = own(id, worker);
      if (!r) return false;
      r.status = "pending";
      r.attempts -= 1;
      r.lockedBy = null;
      r.availableAt = until.getTime();
      return true;
    },
    skip: async (id, worker, reason) => {
      const r = own(id, worker);
      if (!r) return false;
      r.status = "skipped";
      r.skipReason = reason;
      r.lockedBy = null;
      return true;
    },
    disableTokens: async (tokens) => tokens.length,
    receiptsDue: async () => [],
    applyUpdate: async () => "applied",
  };
  return { queue, store };
}

/** An adapter that answers from a script and records what it was asked to send. */
function scripted(answers: Array<Partial<SendResult> & { ok: boolean }>) {
  const sends: Array<{ key: string; body: string }> = [];
  const adapter: ChannelAdapter = {
    channel: "email",
    provider: "bird",
    buildRequest: (message) =>
      JSON.stringify({
        subject: message.content.channel === "email" ? message.content.subject : "",
      }),
    send: async (message) => {
      sends.push({ key: message.idempotencyKey, body: message.requestBody });
      const answer = answers.shift() ?? { ok: true };
      return answer.ok
        ? {
            ok: true,
            provider: "bird",
            providerMessageId: `em_${sends.length}`,
            requestBody: message.requestBody,
          }
        : ({
            provider: "bird",
            code: "x",
            message: "x",
            newKey: false,
            kind: "retry",
            ...answer,
          } as SendResult);
    },
  };
  return { adapter, sends };
}

const settings = {
  env: "test",
  links: {
    shop: "https://www.yuntera.cr",
    seller: "https://vende.yuntera.cr",
    ops: "https://central.yuntera.cr",
    field: "https://ruta.yuntera.cr",
  },
  sender: {
    legalName: "Yuntera S.A.",
    legalId: "3-101",
    postalAddress: "San José",
    replyTo: "ayuda@yuntera.cr",
  },
  whatsappLanguage: "es",
  quietHours: true,
  timeoutMs: 100,
};
// 10:00 in Costa Rica.
const MORNING = "2026-11-21T16:00:00Z";

function deps(clock: Clock, queue: DeliveryQueue, adapter: ChannelAdapter) {
  return {
    queue,
    adapters: { email: adapter, push: adapter },
    settings,
    fetch: fetch,
    clock,
    logger: silent,
    workerId: "w1",
  };
}

describe("the worker loop", () => {
  it("sends and records the provider's id", async () => {
    const clock = fakeClock(MORNING);
    const { queue, store } = memoryQueue(clock, [{}]);
    const { adapter, sends } = scripted([{ ok: true }]);
    const stats = await runOnce(deps(clock, queue, adapter));
    expect(stats).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(store[0]?.status).toBe("sent");
    expect(sends[0]?.key).toBe(idempotencyKey("test", "d0", 0));
    expect(sends[0]?.body).toContain("Recibimos el pago");
  });

  it("retries a network failure with the same key and the same bytes", async () => {
    const clock = fakeClock(MORNING);
    const { queue, store } = memoryQueue(clock, [{}]);
    const { adapter, sends } = scripted([
      { ok: false, kind: "retry", newKey: false },
      { ok: true },
    ]);
    await runOnce(deps(clock, queue, adapter));
    expect(store[0]?.status).toBe("pending");
    expect(store[0]?.request_body).toBeTruthy();
    clock.advance(16_000);
    await runOnce(deps(clock, queue, adapter));
    expect(store[0]?.status).toBe("sent");
    expect(sends.map((s) => s.key)).toEqual(["yt/test/d0/0", "yt/test/d0/0"]);
    expect(sends[1]?.body).toBe(sends[0]?.body);
  });

  it("uses a new key after a refusal the provider keeps (the generation rule)", async () => {
    const clock = fakeClock(MORNING);
    const { queue, store } = memoryQueue(clock, [{}]);
    const { adapter, sends } = scripted([
      { ok: false, kind: "account", code: "402", newKey: true },
      { ok: true },
    ]);
    await runOnce(deps(clock, queue, adapter));
    expect(store[0]).toMatchObject({
      status: "pending",
      generation: 1,
      attempts: 0,
      request_body: null,
    });
    clock.advance(15 * 60_000);
    await runOnce(deps(clock, queue, adapter));
    expect(sends.map((s) => s.key)).toEqual(["yt/test/d0/0", "yt/test/d0/1"]);
    expect(store[0]?.status).toBe("sent");
  });

  it("dead-letters a permanent failure at once, and a retry after the last attempt", async () => {
    const clock = fakeClock(MORNING);
    const { queue, store } = memoryQueue(clock, [{}, { id: "d1" }]);
    const { adapter } = scripted([
      { ok: false, kind: "permanent", code: "422", newKey: true },
      { ok: false, kind: "retry" },
      { ok: false, kind: "retry" },
      { ok: false, kind: "retry" },
    ]);
    for (let i = 0; i < 4; i++) {
      await runOnce(deps(clock, queue, adapter));
      clock.advance(3600_000);
    }
    expect(store[0]?.status).toBe("dead");
    expect(store[1]).toMatchObject({ status: "dead", attempts: 3 });
  });

  it("stops when the lease is lost before sending", async () => {
    const clock = fakeClock(MORNING);
    const { queue, store } = memoryQueue(clock, [{}]);
    const { adapter, sends } = scripted([{ ok: true }]);
    const stolen: DeliveryQueue = { ...queue, freeze: async () => false };
    const stats = await runOnce(deps(clock, stolen, adapter));
    expect(sends).toHaveLength(0);
    expect(stats.sent).toBe(0);
    expect(store[0]?.status).toBe("sending"); // whoever holds the lease now decides
  });

  it("holds phone messages during quiet hours, but not delivery-day news or e-mail", async () => {
    const night = fakeClock("2026-11-22T04:30:00Z"); // 22:30 in Costa Rica
    const { queue, store } = memoryQueue(night, [
      {
        channel: "push",
        to: { channel: "push", app: "shop", tokens: ["ExponentPushToken[aaaaaaaaaa]"] },
      },
      { id: "d1", channel: "email" },
    ]);
    const { adapter } = scripted([{ ok: true }, { ok: true }]);
    const stats = await runOnce(deps(night, queue, adapter));
    expect(stats).toMatchObject({ deferred: 1, sent: 1 });
    expect(new Date(store[0]?.availableAt ?? 0).toISOString()).toBe("2026-11-22T13:00:00.000Z");
    expect(quietUntil("whatsapp", "shipment_out_for_delivery", night.now())).toBeNull();
    expect(quietUntil("sms", "order_placed", new Date("2026-11-22T12:59:00Z"))?.toISOString()).toBe(
      "2026-11-22T13:00:00.000Z",
    );
    expect(quietUntil("push", "order_placed", new Date(MORNING))).toBeNull();
  });

  it("never sends a commercial message without a recorded consent", async () => {
    const clock = fakeClock(MORNING);
    const { queue, store } = memoryQueue(clock, [
      { category: "marketing", commercial_consent: false },
    ]);
    const { adapter, sends } = scripted([]);
    await runOnce(deps(clock, queue, adapter));
    expect(sends).toHaveLength(0);
    expect(store[0]).toMatchObject({ status: "skipped", skipReason: "no_commercial_consent" });
  });

  it("dead-letters a template that has nothing for the channel", async () => {
    const clock = fakeClock(MORNING);
    const { queue, store } = memoryQueue(clock, [
      {
        channel: "push",
        template: "refund_initiated",
        to: { channel: "push", app: "shop", tokens: ["t"] },
      },
    ]);
    const { adapter } = scripted([]);
    await runOnce(deps(clock, queue, adapter));
    expect(store[0]).toMatchObject({ status: "dead", lastCode: "no_template" });
  });

  it("stops at the time budget", async () => {
    const clock = fakeClock(MORNING);
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `d${i}` }));
    const { queue } = memoryQueue(clock, rows);
    const { adapter } = scripted([]);
    const slow: ChannelAdapter = {
      ...adapter,
      send: async (message) => {
        clock.advance(10_000);
        return adapter.send(message, { fetch, timeoutMs: 1 });
      },
    };
    const stats = await runOnce(deps(clock, queue, slow), { budgetMs: 100_000, batchSize: 5 });
    expect(stats.sent).toBe(10);
  });
});

describe("the worker endpoint", () => {
  const config = configFromEnv(
    (name) =>
      ({
        NOTIFY_API_URL: "http://api.test",
        NOTIFY_SECRET_KEY: "s",
        NOTIFY_WORKER_TOKEN: "wake-up-token-123",
      })[name],
  );

  it("is woken only with the worker token", async () => {
    const clock = fakeClock(MORNING);
    const { queue } = memoryQueue(clock, []);
    const handler = createWorkerHandler(config, { queue, clock, logger: silent });
    const call = (token?: string) =>
      handler(
        new Request("http://f.test/notify-worker?wait=1", {
          method: "POST",
          headers: token ? { "x-worker-token": token } : {},
        }),
      );
    expect((await call()).status).toBe(401);
    expect((await call("wrong-token-xxxxxxx")).status).toBe(401);
    const ok = await call("wake-up-token-123");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ claimed: 0 });
  });
});

describe("the Auth e-mail hook", () => {
  const secret = `v1,whsec_${btoa("auth hook secret for tests")}`;
  const config = configFromEnv(
    (name) =>
      ({
        NOTIFY_API_URL: "http://api.test",
        NOTIFY_SECRET_KEY: "s",
        NOTIFY_WORKER_TOKEN: "t",
        BIRD_API_KEY: "bk_us1_test",
        SEND_EMAIL_HOOK_SECRETS: secret,
      })[name],
  );
  const body = JSON.stringify({
    user: { id: "u", email: "ana@correo.cr" },
    email_data: {
      token: "123456",
      token_hash: "h",
      redirect_to: "https://www.yuntera.cr/auth/confirm",
      email_action_type: "recovery",
      site_url: "https://www.yuntera.cr",
    },
  });

  async function call(answer: () => Promise<Response>) {
    const keys: string[] = [];
    const handler = createAuthEmailHandler(config, {
      logger: silent,
      fetch: (async (_url: string, init: RequestInit) => {
        keys.push((init.headers as Record<string, string>)["idempotency-key"] ?? "");
        return answer();
      }) as unknown as typeof fetch,
    });
    const headers = await signStandardWebhook(
      body,
      secret,
      "msg_auth_1",
      Math.floor(Date.now() / 1000),
    );
    const response = await handler(
      new Request("http://f.test/auth-email", { method: "POST", body, headers }),
    );
    return { response, keys };
  }

  it("sends the e-mail under a key tied to the hook call", async () => {
    const { response, keys } = await call(
      async () => new Response('{"id":"em_1"}', { status: 202 }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(keys).toEqual(["auth/msg_auth_1/0"]);
  });

  it("asks Auth to retry when Bird is down", async () => {
    const { response } = await call(async () => new Response("{}", { status: 503 }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.json()).toMatchObject({ error: { http_code: 503 } });
  });

  it("refuses an unsigned call", async () => {
    const handler = createAuthEmailHandler(config, { logger: silent });
    const response = await handler(
      new Request("http://f.test/auth-email", { method: "POST", body }),
    );
    expect(response.status).toBe(401);
  });
});
