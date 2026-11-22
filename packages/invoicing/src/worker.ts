/**
 * The worker's loop (research note 8.2): turn pending events into documents
 * (the database numbers and computes them), claim a batch with a lease, build
 * and check each document, sign it once and store the signed XML, send it,
 * and ask Hacienda for the answer when it is due. Repeat until there is
 * nothing to do or the time budget is spent.
 *
 * The clave is the idempotency key end to end. A document is signed once and
 * every later attempt sends the same stored bytes. When an earlier attempt
 * may have reached Hacienda without an answer (a timeout, a dropped
 * connection), the worker asks for the clave first and sends only if
 * Hacienda does not know it, so each document is received at most once.
 * A rejection is never fixed here: the database records it and staff issue a
 * replacement with a new number.
 */

import { buildDocument, InvalidDocument } from "./document.ts";
import { type Envelope, type HaciendaClient, toBase64 } from "./hacienda.ts";
import { fechaEmision } from "./key.ts";
import { readMessage } from "./message.ts";
import { type Signer, signDocument } from "./signature.ts";
import type { ClaimedInvoice, Clock, InvoiceQueue, Logger, Outcome } from "./types.ts";

export interface WorkerDeps {
  queue: InvoiceQueue;
  client: HaciendaClient;
  signer: () => Promise<Signer>;
  clock: Clock;
  logger: Logger;
  workerId: string;
  /** Where Hacienda posts its answer (with the unguessable token in the path), or null. */
  callbackUrl: string | null;
}

export interface RunOptions {
  budgetMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
}

export interface RunStats {
  planned: number;
  claimed: number;
  signed: number;
  sent: number;
  answered: number;
  failed: number;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function envelopeFor(
  invoice: ClaimedInvoice,
  xml: string,
  callbackUrl: string | null,
): Envelope {
  const doc = invoice.document;
  return {
    clave: doc.clave,
    fecha: fechaEmision(new Date(doc.issued_at)),
    emisor: { tipoIdentificacion: doc.issuer.id_type, numeroIdentificacion: doc.issuer.id_number },
    ...(doc.receiver
      ? {
          receptor: {
            tipoIdentificacion: doc.receiver.id_type,
            numeroIdentificacion: doc.receiver.id_number,
          },
        }
      : {}),
    ...(callbackUrl ? { callbackUrl } : {}),
    comprobanteXml: toBase64(xml),
  };
}

export async function runOnce(deps: WorkerDeps, options: RunOptions = {}): Promise<RunStats> {
  const { budgetMs = 100_000, batchSize = 10, leaseSeconds = 120 } = options;
  const started = deps.clock.now().getTime();
  const stats: RunStats = { planned: 0, claimed: 0, signed: 0, sent: 0, answered: 0, failed: 0 };
  const timeLeft = () => budgetMs - (deps.clock.now().getTime() - started);

  while (timeLeft() > 0) {
    const planned = await deps.queue.plan(100);
    stats.planned += planned;
    const batch = await deps.queue.claim(deps.workerId, batchSize, leaseSeconds);
    stats.claimed += batch.length;
    for (const invoice of batch) {
      try {
        await processOne(deps, invoice, stats);
      } catch (error) {
        stats.failed += 1;
        deps.logger.error("unexpected error", {
          id: invoice.id,
          error: String(error).slice(0, 200),
        });
        await deps.queue
          .record(invoice.id, deps.workerId, {
            event: "retry",
            http_status: null,
            code: "worker_error",
            message: "Unexpected worker error.",
            retry_after: null,
          })
          .catch(() => null);
      }
    }
    if (batch.length === 0 && planned === 0) break;
  }
  return stats;
}

async function record(
  deps: WorkerDeps,
  invoice: ClaimedInvoice,
  outcome: Outcome,
  stats: RunStats,
) {
  const status = await deps.queue.record(invoice.id, deps.workerId, outcome);
  if (outcome.event === "retry" || outcome.event === "config" || outcome.event === "invalid") {
    stats.failed += 1;
    deps.logger.warn("not done", {
      id: invoice.id,
      event: outcome.event,
      code: "code" in outcome ? outcome.code : null,
      now: status,
    });
  }
  return status;
}

async function answerOf(state: Extract<Outcome, { event: "answer" }>["state"], xml: string | null) {
  const message = xml ? readMessage(xml) : null;
  return {
    event: "answer" as const,
    state,
    response_xml: xml,
    response_sha256: xml ? await sha256Hex(xml) : null,
    message: message?.message ?? null,
    detail: message?.detail ?? null,
  };
}

async function processOne(deps: WorkerDeps, invoice: ClaimedInvoice, stats: RunStats) {
  const { client, queue } = deps;
  const clave = invoice.document.clave;

  if (invoice.phase === "poll") {
    let answer = await client.status(clave);
    if (answer.kind === "unauthorized") answer = await client.status(clave);
    await recordStatus(deps, invoice, answer, stats);
    return;
  }

  let xml = invoice.signed_xml;
  if (!xml) {
    let root: ReturnType<typeof buildDocument>;
    try {
      root = buildDocument(invoice.document);
    } catch (error) {
      if (!(error instanceof InvalidDocument)) throw error;
      await record(deps, invoice, { event: "invalid", code: error.code }, stats);
      return;
    }
    const signer = await deps.signer();
    const signedXml = await signDocument(root, signer, { signedAt: deps.clock.now() });
    const stored = await queue.signed(
      invoice.id,
      deps.workerId,
      signedXml,
      await sha256Hex(signedXml),
    );
    if (stored === null) {
      deps.logger.warn("lease lost before sending", { id: invoice.id });
      return;
    }
    xml = stored;
    stats.signed += 1;
  }

  if (invoice.submitted_before) {
    // An earlier attempt may have got in: never send the same clave twice.
    let known = await client.status(clave);
    if (known.kind === "unauthorized") known = await client.status(clave);
    if (known.kind !== "unknown") {
      await recordStatus(deps, invoice, known, stats);
      return;
    }
  }

  const envelope = envelopeFor(invoice, xml, deps.callbackUrl);
  let result = await client.submit(envelope);
  if (result.kind === "unauthorized") result = await client.submit(envelope);
  switch (result.kind) {
    case "received":
      stats.sent += 1;
      await record(
        deps,
        invoice,
        { event: "received", http_status: result.status, location: result.location },
        stats,
      );
      return;
    case "duplicate":
      stats.sent += 1;
      await record(
        deps,
        invoice,
        { event: "duplicate", http_status: result.status, cause: result.cause },
        stats,
      );
      return;
    case "refused":
      await record(
        deps,
        invoice,
        { event: "refused", http_status: result.status, cause: result.cause },
        stats,
      );
      return;
    case "unauthorized":
      await record(
        deps,
        invoice,
        {
          event: "retry",
          http_status: result.status,
          code: "unauthorized",
          message: "Token refused twice.",
          retry_after: null,
        },
        stats,
      );
      return;
    case "config":
      await record(
        deps,
        invoice,
        {
          event: "config",
          http_status: result.status,
          code: `http_${result.status}`,
          message: result.cause,
        },
        stats,
      );
      return;
    case "retry":
      await record(
        deps,
        invoice,
        {
          event: "retry",
          http_status: result.status,
          code: result.status ? `http_${result.status}` : "network",
          message: result.cause,
          retry_after: result.retryAfterSeconds,
        },
        stats,
      );
      return;
  }
}

async function recordStatus(
  deps: WorkerDeps,
  invoice: ClaimedInvoice,
  answer: Awaited<ReturnType<HaciendaClient["status"]>>,
  stats: RunStats,
) {
  switch (answer.kind) {
    case "state":
      if (answer.state === "aceptado" || answer.state === "rechazado") stats.answered += 1;
      await record(deps, invoice, await answerOf(answer.state, answer.responseXml), stats);
      return;
    case "unknown":
      await record(
        deps,
        invoice,
        { event: "unknown_clave", http_status: answer.status, cause: answer.cause },
        stats,
      );
      return;
    case "unauthorized":
      await record(
        deps,
        invoice,
        {
          event: "retry",
          http_status: answer.status,
          code: "unauthorized",
          message: "Token refused twice.",
          retry_after: null,
        },
        stats,
      );
      return;
    case "config":
      await record(
        deps,
        invoice,
        {
          event: "config",
          http_status: answer.status,
          code: `http_${answer.status}`,
          message: answer.cause,
        },
        stats,
      );
      return;
    case "retry":
      await record(
        deps,
        invoice,
        {
          event: "retry",
          http_status: answer.status,
          code: answer.status ? `http_${answer.status}` : "network",
          message: answer.cause,
          retry_after: answer.retryAfterSeconds,
        },
        stats,
      );
      return;
  }
}
