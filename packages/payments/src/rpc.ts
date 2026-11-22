/**
 * The database side of the payments worker, over the Data API:
 * `POST /rest/v1/rpc/<fn>` with the worker's own secret key, so each call runs
 * as the service_role and reaches only the four `worker_payments_*`
 * functions granted to it (the same pattern as packages/notifications).
 */

import type { NormalisedEvent, PaymentsQueue, PaymentTask } from "./types.ts";

export class QueueError extends Error {
  constructor(
    readonly fn: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(`${fn} failed: ${status} ${code}`);
  }
}

export function rpcPaymentsQueue(
  api: { url: string; secretKey: string },
  fetchImpl: typeof fetch,
): PaymentsQueue {
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
    hello: (input) =>
      call("worker_payments_hello", {
        p_provider: input.provider,
        p_environment: input.environment,
        p_account: input.account,
        p_keys_ready: input.keysReady,
        p_webhook_ready: input.webhookReady,
      }),
    claim: async (workerId, limit, leaseSeconds) =>
      (await call<PaymentTask[] | null>("worker_payments_claim", {
        p_worker: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      })) ?? [],
    report: (workerId, report) =>
      call<string>("worker_payments_report", { p_worker: workerId, p_report: report }),
    event: (event: NormalisedEvent) => call<string>("worker_payments_event", { p_event: event }),
  };
}
