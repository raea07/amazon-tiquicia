/**
 * The two HTTP entry points, as plain `(Request) => Promise<Response>`
 * functions. supabase/functions/* wraps them in `Deno.serve`; the local stack
 * (tools/dev-hacienda) serves the very same functions from Node.
 *
 *   invoice-worker     woken by pg_cron / pg_net with a worker token; plans,
 *                      signs, sends and polls
 *   hacienda-callback  Hacienda's answer, posted to …/hacienda-callback/<token>.
 *                      Unauthenticated by Hacienda's design, so it is only a
 *                      hint: the worker asks Hacienda again before anything changes
 */

import { importSigningKey, parseCertificate } from "./certificate.ts";
import type { InvoiceConfig } from "./config.ts";
import { HaciendaClient, parseAnswer } from "./hacienda.ts";
import { rpcQueue } from "./queue.ts";
import type { Signer } from "./signature.ts";
import { type Clock, consoleLogger, type InvoiceQueue, type Logger, systemClock } from "./types.ts";
import { runOnce } from "./worker.ts";

export interface HandlerDeps {
  fetch?: typeof fetch;
  clock?: Clock;
  logger?: Logger;
  queue?: InvoiceQueue;
  waitUntil?: (work: Promise<unknown>) => void;
  workerId?: string;
  /** Tests and the local stack hand a signer directly; otherwise it comes from the settings. */
  signer?: () => Promise<Signer>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The signer from the settings, made once per instance; the key is non-extractable. */
export function signerFromConfig(config: InvoiceConfig): () => Promise<Signer> {
  let made: Promise<Signer> | null = null;
  return () => {
    made ??= (async () => ({
      key: await importSigningKey(config.signing.keyPem, config.signing.pin || undefined),
      certificate: parseCertificate(config.signing.certificatePem),
      certificateDigest: config.signing.certificateDigest,
    }))();
    made.catch(() => {
      made = null;
    });
    return made;
  };
}

export function createInvoiceWorker(config: InvoiceConfig, deps: HandlerDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const clock = deps.clock ?? systemClock;
  const queue = deps.queue ?? rpcQueue(config.api, fetchImpl);
  const client = new HaciendaClient(config.hacienda, fetchImpl, clock);
  const signer = deps.signer ?? signerFromConfig(config);
  const workerId = deps.workerId ?? `invoice-worker-${crypto.randomUUID()}`;
  let running: Promise<unknown> | null = null;

  const run = async () => {
    // The certificate's expiry is reported on every run, so staff see it coming.
    try {
      const { certificate } = await signer();
      await queue.health({
        certificate_subject: certificate.subjectName,
        certificate_issuer: certificate.issuerName,
        certificate_not_after: certificate.notAfter.toISOString(),
        environment: config.env,
        error: null,
      });
    } catch (error) {
      await queue
        .health({
          certificate_subject: null,
          certificate_issuer: null,
          certificate_not_after: null,
          environment: config.env,
          error: String(error instanceof Error ? error.message : error).slice(0, 200),
        })
        .catch(() => null);
    }
    return runOnce(
      { queue, client, signer, clock, logger, workerId, callbackUrl: config.callbackUrl || null },
      { budgetMs: 100_000 },
    );
  };

  const start = () => {
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
    return running;
  };

  const handler = async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (!sameSecret(request.headers.get("x-worker-token") ?? "", config.workerToken)) {
      return json(401, { error: "unauthorized" });
    }
    if (new URL(request.url).searchParams.get("wait") === "1") {
      if (running) await running.catch(() => null);
      const stats = await run();
      return json(200, stats);
    }
    start();
    return json(202, { accepted: true });
  };
  return Object.assign(handler, { start, queue });
}

export function createHaciendaCallback(
  config: InvoiceConfig,
  wake: () => unknown,
  deps: HandlerDeps = {},
) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const queue = deps.queue ?? rpcQueue(config.api, fetchImpl);

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const token = new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";
    if (!sameSecret(token, config.callbackToken)) return json(404, { error: "not_found" });
    const raw = await request.text();
    if (raw.length > 2_000_000) return json(413, { error: "too_large" });
    const answer = parseAnswer(raw);
    if (answer?.clave && /^[A-Za-z0-9]{50}$/.test(answer.clave)) {
      try {
        // Only a hint: the worker asks Hacienda itself before recording anything.
        await queue.hint(answer.clave);
        wake();
      } catch (error) {
        logger.error("callback not recorded", { error: String(error).slice(0, 200) });
        // Hacienda tries three times on anything but 200; polling covers the rest.
        return json(500, { error: "not_recorded" });
      }
    } else {
      logger.warn("callback without a usable clave");
    }
    return json(200, { received: true });
  };
}
