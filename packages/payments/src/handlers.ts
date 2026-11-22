/**
 * The two HTTP entry points, as plain `(Request) => Promise<Response>`
 * functions. supabase/functions/payments-* wrap them in `Deno.serve`; the
 * local stack (tools/dev-notify's functions host) serves the very same
 * functions from Node, as it does the notification ones.
 *
 *   payments-webhook  the gateway's signed notifications
 *   payments-worker   woken by pg_cron / pg_net with a worker token
 */

import type { PaymentsConfig } from "./config.ts";
import { onvoGateway } from "./onvo.ts";
import { rpcPaymentsQueue } from "./rpc.ts";
import {
  type Clock,
  consoleLogger,
  type Logger,
  type PaymentGateway,
  type PaymentsQueue,
  systemClock,
  WebhookSignatureError,
} from "./types.ts";
import { runPaymentsOnce } from "./worker.ts";

export interface HandlerDeps {
  fetch?: typeof fetch;
  clock?: Clock;
  logger?: Logger;
  queue?: PaymentsQueue;
  gateway?: PaymentGateway;
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

export function gatewayFor(
  config: PaymentsConfig,
  fetchImpl: typeof fetch = fetch,
): PaymentGateway {
  return onvoGateway(
    {
      baseUrl: config.onvo.baseUrl,
      secretKey: config.onvo.secretKey,
      webhookSecrets: config.onvo.webhookSecrets,
      sinpeNumber: config.onvo.sinpeNumber,
      timeoutMs: config.timeoutMs,
      environment: config.environment,
    },
    fetchImpl,
  );
}

/**
 * The gateway's notifications. The signature is checked on the raw body
 * before anything else; then the event is recorded and applied by the
 * database in one call (one transaction). Answers 2xx once it is recorded,
 * whatever it meant (ONVO retries anything else), 400 for a bad signature,
 * and 500 when the database could not record it, so that ONVO tries again.
 */
export function createPaymentsWebhookHandler(config: PaymentsConfig, deps: HandlerDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const clock = deps.clock ?? systemClock;
  const queue = deps.queue ?? rpcPaymentsQueue(config.api, fetchImpl);
  const gateway = deps.gateway ?? gatewayFor(config, fetchImpl);

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (config.onvo.webhookSecrets.length === 0) {
      // Not set up yet: ask the gateway to come back rather than lose it.
      return json(503, { error: "not_configured" }, { "retry-after": "600" });
    }
    const raw = await request.text();
    let event: Awaited<ReturnType<PaymentGateway["parseWebhook"]>>;
    try {
      event = await gateway.parseWebhook({
        rawBody: raw,
        headers: request.headers,
        now: clock.now(),
      });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        logger.warn("webhook refused", { reason: error.reason });
        return json(400, { error: "invalid_signature" });
      }
      throw error;
    }
    if (event.type === "endpoint.test") return json(200, { received: true, outcome: "test" });
    try {
      const outcome = await queue.event(event);
      logger.info("webhook recorded", { type: event.provider_type, outcome });
      return json(200, { received: true, outcome });
    } catch (error) {
      logger.error("webhook not recorded", {
        type: event.provider_type,
        error: String(error).slice(0, 200),
      });
      return json(500, { error: "not_recorded" });
    }
  };
}

/** The worker, woken with its token. `?wait=1` runs in the request (the local host's tick). */
export function createPaymentsWorkerHandler(config: PaymentsConfig, deps: HandlerDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const queue = deps.queue ?? rpcPaymentsQueue(config.api, fetchImpl);
  const gateway = deps.gateway ?? gatewayFor(config, fetchImpl);
  let running: Promise<unknown> | null = null;

  const run = () =>
    runPaymentsOnce({
      config,
      gateway,
      queue,
      clock: deps.clock ?? systemClock,
      logger,
      workerId: deps.workerId ?? `payments-${crypto.randomUUID()}`,
    });

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (!sameSecret(request.headers.get("x-worker-token") ?? "", config.workerToken)) {
      return json(401, { error: "unauthorized" });
    }
    if (new URL(request.url).searchParams.get("wait") === "1") {
      if (running) await running.catch(() => null);
      return json(200, await run());
    }
    if (!running) {
      running = run()
        .then((stats) => {
          if (stats.tasks > 0) logger.info("run finished", { ...stats });
        })
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
