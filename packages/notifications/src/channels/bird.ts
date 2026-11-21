/**
 * Bird's platform API (https://{us1|eu1}.platform.bird.com): e-mail, WhatsApp
 * and SMS share authentication, idempotency, errors and rate limits
 * (research note sections 1 and 2).
 *
 * Idempotency, with the fact-check's correction applied: Bird keeps a
 * request's answer for three hours per key, refusals included. So a retry
 * after a network error, a 5xx, a 429 or a "request still in progress"
 * (409 E01004) resends the same bytes under the same key; a retry after any
 * other refusal must be a new request under a new key ("generation").
 */

import type { OutboundMessage, ProviderIo, SendResult } from "../types.ts";
import { type HttpAnswer, parseJson, post, retryAfter, scrub } from "./http.ts";

/** Echoed back on every webhook, so a report names the request it is about. */
export const generationOf = (message: OutboundMessage) =>
  message.generation === undefined ? {} : { generation: String(message.generation) };

export interface BirdSettings {
  baseUrl: string;
  apiKey: string;
}

interface BirdError {
  error?: { type?: string; code?: string; name?: string; message?: string };
}

/** Maps Bird's answer to what the worker does next. */
export function classifyBird(
  answer: HttpAnswer | { networkError: string },
  requestBody: string,
): SendResult {
  const provider = "bird";
  if ("networkError" in answer) {
    return {
      ok: false,
      provider,
      requestBody,
      kind: "retry",
      code: answer.networkError,
      message: "The provider did not answer.",
      newKey: false,
    };
  }
  const json = parseJson(answer.text);
  if (answer.status >= 200 && answer.status < 300) {
    const id = (json as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.length > 0) {
      return { ok: true, provider, providerMessageId: id, requestBody };
    }
    return {
      ok: false,
      provider,
      requestBody,
      kind: "retry",
      code: "no_id",
      message: "Accepted without an id.",
      newKey: false,
    };
  }

  const error = (json as BirdError | null)?.error ?? {};
  const code = [answer.status, error.code, error.name].filter(Boolean).join(" ");
  const message = scrub(error.message ?? answer.text);
  const after = retryAfter(answer.headers);
  const base = { ok: false as const, provider, requestBody, code, message };

  if (answer.status === 429)
    return { ...base, kind: "retry", newKey: false, retryAfterSeconds: after ?? 60 };
  if (answer.status === 409 && error.code === "E01004") {
    return { ...base, kind: "retry", newKey: false, retryAfterSeconds: Math.max(after ?? 0, 30) };
  }
  if (answer.status >= 500) {
    return {
      ...base,
      kind: "retry",
      newKey: false,
      retryAfterSeconds: error.code === "E01033" ? Math.max(after ?? 0, 30) : after,
    };
  }
  // From here on Bird kept the refusal: whatever happens next is a new request.
  if (
    answer.status === 401 ||
    answer.status === 403 ||
    answer.status === 421 ||
    answer.status === 412
  ) {
    return { ...base, kind: "config", newKey: true };
  }
  if (answer.status === 402)
    return { ...base, kind: "account", newKey: true, retryAfterSeconds: 900 };
  if (
    answer.status === 400 ||
    answer.status === 404 ||
    answer.status === 409 ||
    answer.status === 422
  ) {
    return { ...base, kind: "permanent", newKey: true };
  }
  return { ...base, kind: "retry", newKey: true, retryAfterSeconds: after };
}

export async function sendToBird(
  settings: BirdSettings,
  path: string,
  message: OutboundMessage & { requestBody: string },
  io: ProviderIo,
): Promise<SendResult> {
  if (!settings.apiKey) {
    return {
      ok: false,
      provider: "bird",
      kind: "config",
      code: "no_api_key",
      message: "BIRD_API_KEY is not set.",
      newKey: false,
    };
  }
  const answer = await post(
    io.fetch,
    `${settings.baseUrl.replace(/\/$/, "")}${path}`,
    {
      authorization: `Bearer ${settings.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "idempotency-key": message.idempotencyKey,
    },
    message.requestBody,
    io.timeoutMs,
  );
  return classifyBird(answer, message.requestBody);
}

/** Tag values: letters, digits, "_" and "-" only, at most 64 characters. */
export const tagValue = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
