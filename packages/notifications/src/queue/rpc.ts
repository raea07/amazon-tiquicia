/**
 * The database side of the worker, over the Data API: `POST /rest/v1/rpc/<fn>`
 * with the server-side secret key, so each call runs as the service_role and
 * reaches only the `worker_*` functions granted to it.
 */

import type { ClaimedDelivery, DeliveryQueue, DeliveryUpdate } from "../types.ts";

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
): DeliveryQueue {
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
    plan: (limit) => call<number>("worker_notify_plan", { p_limit: limit }),
    claim: async (workerId, limit, leaseSeconds) =>
      (await call<ClaimedDelivery[] | null>("worker_notify_claim", {
        p_worker: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      })) ?? [],
    freeze: (id, workerId, generation, requestBody) =>
      call<boolean>("worker_notify_freeze", {
        p_id: id,
        p_worker: workerId,
        p_generation: generation,
        p_request_body: requestBody,
      }),
    sent: (id, workerId, provider, providerMessageId, pushTicketIds) =>
      call<boolean>("worker_notify_sent", {
        p_id: id,
        p_worker: workerId,
        p_provider: provider,
        p_provider_message_id: providerMessageId,
        p_push_ticket_ids: pushTicketIds ?? null,
      }),
    fail: (id, workerId, failure, retryAfterSeconds) =>
      call<string | null>("worker_notify_fail", {
        p_id: id,
        p_worker: workerId,
        p_kind: failure.kind,
        p_code: failure.code,
        p_message: failure.message,
        p_new_key: failure.newKey,
        p_retry_after_seconds: retryAfterSeconds ?? null,
      }),
    defer: (id, workerId, until) =>
      call<boolean>("worker_notify_defer", {
        p_id: id,
        p_worker: workerId,
        p_until: until.toISOString(),
      }),
    skip: (id, workerId, reason) =>
      call<boolean>("worker_notify_skip", { p_id: id, p_worker: workerId, p_reason: reason }),
    disableTokens: (tokens) =>
      call<number>("worker_push_disable", { p_tokens: tokens, p_reason: "DeviceNotRegistered" }),
    receiptsDue: async (limit, olderThanSeconds) =>
      (await call<Array<{ id: string; ticket_ids: string[] }> | null>("worker_push_receipts_due", {
        p_limit: limit,
        p_older_than_seconds: olderThanSeconds,
      })) ?? [],
    applyUpdate: (update: DeliveryUpdate, webhookId?: string) =>
      call<string>("worker_notify_apply_update", {
        p_update: {
          provider: update.provider,
          provider_message_id: update.providerMessageId ?? null,
          delivery_id: update.deliveryId ?? null,
          generation: update.generation ?? null,
          channel: update.channel ?? null,
          status: update.status,
          occurred_at: update.occurredAt,
          reason: update.reason ?? null,
          permanent: update.permanent,
          recipient_address: update.recipientAddress ?? null,
        },
        p_webhook_id: webhookId ?? null,
      }),
  };
}
