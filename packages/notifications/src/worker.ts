/**
 * The worker's loop (research note 6.3 to 6.8): plan pending events, claim a
 * batch with a lease, render, freeze the exact request, send, record the
 * outcome; repeat until the queue is empty or the time budget is spent. Then
 * fetch push receipts that are due. Safe to run at any time and from several
 * places at once: the database hands each message to one worker.
 */

import { costaRicaParts } from "./format.ts";
import type { Links } from "./templates/catalog.ts";
import { render, type Sender, TemplateMissing } from "./templates/render.ts";
import type {
  Channel,
  ChannelAdapter,
  ClaimedDelivery,
  Clock,
  DeliveryQueue,
  DeliveryUpdate,
  Logger,
} from "./types.ts";

export interface WorkerSettings {
  env: string;
  links: Links;
  sender: Sender;
  whatsappLanguage: string;
  quietHours: boolean;
  timeoutMs: number;
}

export interface WorkerDeps {
  queue: DeliveryQueue;
  adapters: Partial<Record<Channel, ChannelAdapter>>;
  settings: WorkerSettings;
  fetch: typeof fetch;
  clock: Clock;
  logger: Logger;
  workerId: string;
  /** Push receipts (Expo). */
  receipts?: (
    refs: string[],
  ) => Promise<{ updates: DeliveryUpdate[]; disableTokens: string[] } | null>;
}

export interface RunOptions {
  budgetMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
  receiptsAfterSeconds?: number;
}

export interface RunStats {
  planned: number;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  receipts: number;
}

/** Delivery-day news may go at any hour; everything else waits for the morning. */
const QUIET_EXEMPT = new Set(["shipment_out_for_delivery", "shipment_delivery_failed"]);

/** When a message to a phone may go, or null for now (21:00 to 07:00 Costa Rica time is quiet). */
export function quietUntil(channel: Channel, template: string, now: Date): Date | null {
  if (channel === "email" || QUIET_EXEMPT.has(template)) return null;
  const { hour } = costaRicaParts(now);
  if (hour >= 7 && hour < 21) return null;
  // Next 07:00 in Costa Rica (UTC−6), i.e. 13:00 UTC.
  const next = new Date(now);
  next.setUTCHours(13, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export const idempotencyKey = (env: string, id: string, generation: number) =>
  `yt/${env}/${id}/${generation}`;

export async function runOnce(deps: WorkerDeps, options: RunOptions = {}): Promise<RunStats> {
  const {
    budgetMs = 100_000,
    batchSize = 20,
    leaseSeconds = 120,
    receiptsAfterSeconds = 900,
  } = options;
  const started = deps.clock.now().getTime();
  const stats: RunStats = {
    planned: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    receipts: 0,
  };
  const timeLeft = () => budgetMs - (deps.clock.now().getTime() - started);

  while (timeLeft() > 0) {
    const planned = await deps.queue.plan(100);
    stats.planned += planned;
    const batch = await deps.queue.claim(deps.workerId, batchSize, leaseSeconds);
    stats.claimed += batch.length;
    for (const delivery of batch) {
      const outcome = await processOne(deps, delivery).catch(async (error: unknown) => {
        deps.logger.error("unexpected error", {
          id: delivery.id,
          error: String(error).slice(0, 200),
        });
        await deps.queue
          .fail(delivery.id, deps.workerId, {
            kind: "retry",
            code: "worker_error",
            message: "Unexpected worker error.",
            newKey: false,
          })
          .catch(() => null);
        return "failed" as const;
      });
      stats[outcome] += 1;
    }
    if (batch.length === 0 && planned === 0) break;
  }

  if (deps.receipts && timeLeft() > 0) {
    const due = await deps.queue.receiptsDue(100, receiptsAfterSeconds);
    const refs = due.flatMap((row) => row.ticket_ids);
    if (refs.length > 0) {
      const result = await deps.receipts(refs);
      if (result) {
        for (const update of result.updates) await deps.queue.applyUpdate(update);
        if (result.disableTokens.length > 0) await deps.queue.disableTokens(result.disableTokens);
        stats.receipts += result.updates.length;
      }
    }
  }
  return stats;
}

type Outcome = "sent" | "failed" | "skipped" | "deferred";

async function processOne(deps: WorkerDeps, d: ClaimedDelivery): Promise<Outcome> {
  const { queue, workerId, settings, logger } = deps;

  // Commercial messages only with a recorded consent, checked again here.
  if (d.category === "marketing" && !d.commercial_consent) {
    await queue.skip(d.id, workerId, "no_commercial_consent");
    return "skipped";
  }
  // Even with consent, a commercial message may only be built by
  // templates/commercial.ts (label, unsubscribe link, List-Unsubscribe,
  // sender identification). No commercial template and no one-step
  // unsubscribe page exist yet, so none is sent: it never falls through to the
  // ordinary transactional templates.
  if (d.category === "marketing") {
    await queue.fail(d.id, workerId, {
      kind: "permanent",
      code: "commercial_frame_required",
      message: "Commercial messages are built only through the commercial frame.",
      newKey: false,
    });
    return "failed";
  }

  if (settings.quietHours) {
    const until = quietUntil(d.channel, d.template, deps.clock.now());
    if (until) {
      await queue.defer(d.id, workerId, until);
      return "deferred";
    }
  }

  const adapter = deps.adapters[d.channel];
  if (!adapter) {
    await queue.fail(d.id, workerId, {
      kind: "config",
      code: "no_adapter",
      message: `No adapter for ${d.channel}.`,
      newKey: false,
    });
    return "failed";
  }

  let content: ReturnType<typeof render>;
  try {
    content = render({
      template: d.template,
      channel: d.channel,
      vars: d.vars,
      name: d.to.name ?? null,
      links: settings.links,
      sender: settings.sender,
      whatsappLanguage: settings.whatsappLanguage,
    });
  } catch (error) {
    if (!(error instanceof TemplateMissing)) throw error;
    await queue.fail(d.id, workerId, {
      kind: "permanent",
      code: "no_template",
      message: error.message,
      newKey: false,
    });
    return "failed";
  }

  const message = {
    deliveryId: d.id,
    idempotencyKey: idempotencyKey(settings.env, d.id, d.generation),
    generation: d.generation,
    category: d.category,
    template: d.template,
    to: d.to,
    content,
    frozenRequestBody: d.request_body,
  };

  // The same bytes on every retry of this generation, under the same key.
  let requestBody = d.request_body;
  if (!requestBody) {
    requestBody = adapter.buildRequest(message);
    if (!(await queue.freeze(d.id, workerId, d.generation, requestBody))) {
      logger.warn("lease lost before sending", { id: d.id });
      return "skipped";
    }
  }

  const result = await adapter.send(
    { ...message, requestBody },
    { fetch: deps.fetch, timeoutMs: settings.timeoutMs },
  );
  if (result.disableTokens && result.disableTokens.length > 0) {
    await queue.disableTokens(result.disableTokens);
  }
  if (result.ok) {
    await queue.sent(
      d.id,
      workerId,
      result.provider,
      result.providerMessageId,
      result.pushTicketIds,
    );
    logger.info("sent", { id: d.id, channel: d.channel, template: d.template });
    return "sent";
  }
  if (result.kind === "recipient") {
    await queue.skip(d.id, workerId, result.code);
    return "skipped";
  }
  const status = await queue.fail(
    d.id,
    workerId,
    { kind: result.kind, code: result.code, message: result.message, newKey: result.newKey },
    result.retryAfterSeconds,
  );
  logger.warn("send failed", { id: d.id, channel: d.channel, code: result.code, now: status });
  return "failed";
}
