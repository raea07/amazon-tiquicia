/**
 * The three HTTP entry points, as plain `(Request) => Promise<Response>`
 * functions. supabase/functions/* wraps them in `Deno.serve`; the local stack
 * (tools/dev-notify) serves the very same functions from Node.
 *
 *   notify-worker   woken by pg_cron / pg_net with a worker token; plans and sends
 *   bird-webhook    Bird's delivery reports, signature checked on the raw body
 *   auth-email      Supabase Auth's Send Email Hook: account e-mails, sent at once
 */

import { birdEmail } from "./channels/bird-email.ts";
import { birdSms } from "./channels/bird-sms.ts";
import { birdWhatsApp } from "./channels/bird-whatsapp.ts";
import { expoPush, expoReceipts } from "./channels/expo-push.ts";
import type { NotifyConfig } from "./config.ts";
import { rpcQueue } from "./queue/rpc.ts";
import { authEmails, type SendEmailHookPayload } from "./templates/auth.ts";
import {
  type Clock,
  consoleLogger,
  type DeliveryQueue,
  type Logger,
  systemClock,
} from "./types.ts";
import { parseBirdEvent } from "./webhooks/bird.ts";
import { verifyStandardWebhook } from "./webhooks/standard.ts";
import { runOnce } from "./worker.ts";

export interface HandlerDeps {
  fetch?: typeof fetch;
  clock?: Clock;
  logger?: Logger;
  queue?: DeliveryQueue;
  /** Keeps the instance alive for work after the response (EdgeRuntime.waitUntil). */
  waitUntil?: (work: Promise<unknown>) => void;
  workerId?: string;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function adaptersFor(config: NotifyConfig) {
  const bird = { baseUrl: config.bird.baseUrl, apiKey: config.bird.apiKey };
  return {
    email: birdEmail({
      ...bird,
      from: config.bird.from,
      replyTo: config.bird.replyTo,
      env: config.env,
    }),
    whatsapp: birdWhatsApp({ ...bird, from: config.bird.whatsappFrom }),
    sms: birdSms({ ...bird, from: config.bird.smsFrom }),
    push: expoPush(config.expo),
  };
}

const senderOf = (config: NotifyConfig) => ({ ...config.sender, replyTo: config.bird.replyTo });

export function createWorkerHandler(config: NotifyConfig, deps: HandlerDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const queue = deps.queue ?? rpcQueue(config.api, fetchImpl);
  let running: Promise<unknown> | null = null;

  const run = () =>
    runOnce(
      {
        queue,
        adapters: adaptersFor(config),
        settings: {
          env: config.env,
          links: config.links,
          sender: senderOf(config),
          whatsappLanguage: config.bird.whatsappLanguage,
          quietHours: config.quietHours,
          timeoutMs: config.timeoutMs,
        },
        fetch: fetchImpl,
        clock: deps.clock ?? systemClock,
        logger,
        workerId: deps.workerId ?? `worker-${crypto.randomUUID()}`,
        receipts: (refs) =>
          expoReceipts(config.expo, refs, { fetch: fetchImpl, timeoutMs: config.timeoutMs }),
      },
      { budgetMs: 100_000 },
    );

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (!sameSecret(request.headers.get("x-worker-token") ?? "", config.workerToken)) {
      return json(401, { error: "unauthorized" });
    }
    // One run at a time per instance; another kick while it runs is a no-op.
    if (new URL(request.url).searchParams.get("wait") === "1") {
      if (running) await running.catch(() => null);
      const stats = await run();
      return json(200, stats);
    }
    if (!running) {
      running = run()
        .then((stats) => logger.info("run finished", { ...stats }))
        .catch((error: unknown) =>
          logger.error("run failed", { error: String(error).slice(0, 200) }),
        )
        .finally(() => {
          running = null;
        });
      deps.waitUntil?.(running);
    }
    return json(202, { accepted: true });
  };
}

export function createBirdWebhookHandler(config: NotifyConfig, deps: HandlerDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const queue = deps.queue ?? rpcQueue(config.api, fetchImpl);
  const clock = deps.clock ?? systemClock;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    // The raw bytes, before anything parses them.
    const raw = await request.text();
    const verdict = await verifyStandardWebhook(
      raw,
      request.headers,
      config.bird.webhookSecrets,
      clock.now().getTime(),
    );
    if (!verdict.ok) {
      logger.warn("webhook refused", { reason: verdict.reason });
      return json(401, { error: verdict.reason });
    }
    const updates = parseBirdEvent(raw);
    const outcomes: string[] = [];
    try {
      for (const [index, update] of updates.entries()) {
        // One webhook can carry two facts (a rejection and an opt-out); each is applied once.
        outcomes.push(
          await queue.applyUpdate(update, index === 0 ? verdict.id : `${verdict.id}#${index}`),
        );
      }
    } catch (error) {
      // Not recorded: answer an error so Bird delivers it again.
      logger.error("webhook not applied", { error: String(error).slice(0, 200) });
      return json(500, { error: "not_applied" });
    }
    return json(200, { received: true, outcomes });
  };
}

export function createAuthEmailHandler(config: NotifyConfig, deps: HandlerDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const clock = deps.clock ?? systemClock;
  const adapter = adaptersFor(config).email;
  const hookError = (status: number, message: string, headers: Record<string, string> = {}) =>
    json(status, { error: { http_code: status, message } }, headers);

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return hookError(405, "Method not allowed");
    const raw = await request.text();
    const verdict = await verifyStandardWebhook(
      raw,
      request.headers,
      config.authHookSecrets,
      clock.now().getTime(),
    );
    if (!verdict.ok) return hookError(401, "Invalid signature");

    let payload: SendEmailHookPayload;
    try {
      payload = JSON.parse(raw) as SendEmailHookPayload;
      if (!payload.user?.email || !payload.email_data?.email_action_type) throw new Error("shape");
    } catch {
      return hookError(400, "Unexpected payload");
    }

    const emails = authEmails(payload, { ...config.sender, replyTo: config.bird.replyTo });
    for (const [index, email] of emails.entries()) {
      const message = {
        deliveryId: `${verdict.id}-${index}`,
        // Auth retries the hook with the same webhook id: the same key, no second e-mail.
        idempotencyKey: `auth/${verdict.id}/${index}`,
        category: "authentication" as const,
        template: email.template,
        to: { channel: "email" as const, email: email.to },
        content: email.rendered,
      };
      // Auth allows five seconds for the call and its retries: two for Bird.
      const result = await adapter.send(
        { ...message, requestBody: adapter.buildRequest(message) },
        { fetch: fetchImpl, timeoutMs: Math.min(config.timeoutMs, 2000) },
      );
      if (!result.ok) {
        logger.warn("auth e-mail not sent", { template: email.template, code: result.code });
        if (result.kind === "retry" || result.kind === "account") {
          return hookError(503, "E-mail provider unavailable", { "retry-after": "1" });
        }
        return hookError(500, "E-mail could not be sent");
      }
    }
    return json(200, {});
  };
}
