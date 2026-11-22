/**
 * The database side of the worker, over the Data API: `POST /rest/v1/rpc/<fn>`
 * with the server-side secret key, so each call runs as the service_role and
 * reaches only the `worker_invoice_*` functions granted to it. The same
 * pattern as packages/notifications/src/queue/rpc.ts.
 */

import type { ClaimedInvoice, HealthReport, InvoiceQueue, Outcome } from "./types.ts";

export class QueueError extends Error {
  constructor(
    readonly fn: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(`${fn} failed: ${status} ${code}`);
  }
}

export function rpcQueue(
  api: { url: string; secretKey: string },
  fetchImpl: typeof fetch,
): InvoiceQueue {
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const response = await fetchImpl(`${api.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: api.secretKey,
        authorization: `Bearer ${api.secretKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) {
      let code = "unknown";
      try {
        const body = JSON.parse(text) as { message?: string; code?: string };
        code = body.message && /^[a-z_]+$/.test(body.message) ? body.message : (body.code ?? code);
      } catch {
        // keep "unknown"
      }
      throw new QueueError(fn, response.status, code);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    plan: (limit) => call<number>("worker_invoice_plan", { p_limit: limit }),
    claim: async (workerId, limit, leaseSeconds) =>
      (await call<ClaimedInvoice[] | null>("worker_invoice_claim", {
        p_worker: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      })) ?? [],
    signed: (id, workerId, xml, sha256) =>
      call<string | null>("worker_invoice_signed", {
        p_id: id,
        p_worker: workerId,
        p_xml: xml,
        p_sha256: sha256,
      }),
    record: (id, workerId, outcome: Outcome) =>
      call<string | null>("worker_invoice_record", {
        p_id: id,
        p_worker: workerId,
        p_outcome: outcome,
      }),
    hint: (clave) => call<boolean>("worker_invoice_hint", { p_clave: clave }),
    health: async (report: HealthReport) => {
      await call<null>("worker_invoice_health", { p_report: report });
    },
  };
}
