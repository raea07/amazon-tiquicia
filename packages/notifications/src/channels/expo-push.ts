/**
 * Expo push (research note section 4): `POST /--/api/v2/push/send` with one
 * message per token (at most 100, all of one app), then receipts with
 * `POST /--/api/v2/push/getReceipts` about 15 minutes later. Expo has no
 * idempotency key; `collapseId` and `tag` keep a rare duplicate from showing
 * twice on the phone. Push carries no personal detail: it says what happened
 * and opens the app.
 */

import type {
  ChannelAdapter,
  DeliveryUpdate,
  OutboundMessage,
  ProviderIo,
  SendResult,
} from "../types.ts";
import { parseJson, post, retryAfter, scrub } from "./http.ts";

export interface ExpoSettings {
  baseUrl: string;
  /** Needed once enhanced push security is on (it should be). */
  accessToken: string;
}

interface Ticket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const headers = (settings: ExpoSettings) => ({
  accept: "application/json",
  "content-type": "application/json",
  ...(settings.accessToken ? { authorization: `Bearer ${settings.accessToken}` } : {}),
});

/** A stored ticket reference: "<ticket id> <token>", so a receipt can disable its token. */
export const ticketRef = (id: string, token: string) => `${id} ${token}`;
export const splitTicketRef = (ref: string) => {
  const [id = "", token = ""] = ref.split(" ");
  return { id, token };
};

export function expoPush(settings: ExpoSettings): ChannelAdapter {
  return {
    channel: "push",
    provider: "expo",
    buildRequest(message: OutboundMessage) {
      if (message.content.channel !== "push" || message.to.channel !== "push") {
        throw new Error("expoPush renders push only");
      }
      const c = message.content;
      return JSON.stringify(
        message.to.tokens.slice(0, 100).map((to) => ({
          to,
          title: c.title,
          body: c.body,
          data: c.data,
          sound: "default",
          ...(c.channelId ? { channelId: c.channelId } : {}),
          ...(c.priority ? { priority: c.priority } : {}),
          ...(c.ttlSeconds ? { ttl: c.ttlSeconds } : {}),
          ...(c.collapseId ? { collapseId: c.collapseId } : {}),
          ...(c.tag ? { tag: c.tag } : {}),
        })),
      );
    },
    async send(message, io): Promise<SendResult> {
      const provider = "expo";
      // The tokens in the order they were sent: read from the frozen request itself.
      const sent = parseJson(message.requestBody);
      const tokens = Array.isArray(sent)
        ? sent.map((m) => String((m as { to?: unknown }).to ?? ""))
        : [];
      const answer = await post(
        io.fetch,
        `${settings.baseUrl.replace(/\/$/, "")}/--/api/v2/push/send`,
        headers(settings),
        message.requestBody,
        io.timeoutMs,
      );
      const base = {
        ok: false as const,
        provider,
        requestBody: message.requestBody,
        newKey: false,
      };
      if ("networkError" in answer) {
        return {
          ...base,
          kind: "retry",
          code: answer.networkError,
          message: "Expo did not answer.",
        };
      }
      const json = parseJson(answer.text) as {
        data?: Ticket[];
        errors?: Array<{ code?: string; message?: string }>;
      } | null;
      if (answer.status === 429) {
        return {
          ...base,
          kind: "retry",
          code: "429 TOO_MANY_REQUESTS",
          message: "Rate limited.",
          retryAfterSeconds: retryAfter(answer.headers) ?? 30,
        };
      }
      if (answer.status >= 500) {
        return { ...base, kind: "retry", code: String(answer.status), message: scrub(answer.text) };
      }
      if (answer.status >= 400 || !Array.isArray(json?.data)) {
        const code = json?.errors?.[0]?.code ?? String(answer.status);
        return {
          ...base,
          kind: code === "UNAUTHORIZED" ? "config" : "permanent",
          code: `${answer.status} ${code}`,
          message: scrub(json?.errors?.[0]?.message ?? answer.text),
        };
      }

      const tickets = json.data;
      const ok: string[] = [];
      const dead: string[] = [];
      const errors: string[] = [];
      tickets.forEach((ticket, index) => {
        const token = tokens[index] ?? "";
        if (ticket.status === "ok" && ticket.id) ok.push(ticketRef(ticket.id, token));
        else if (ticket.details?.error === "DeviceNotRegistered") dead.push(token);
        else errors.push(ticket.details?.error ?? "error");
      });
      if (ok.length > 0) {
        const first = splitTicketRef(ok[0] ?? "").id;
        return {
          ok: true,
          provider,
          providerMessageId: first,
          requestBody: message.requestBody,
          pushTicketIds: ok,
          disableTokens: dead,
        };
      }
      if (dead.length > 0 && errors.length === 0) {
        return {
          ...base,
          kind: "recipient",
          code: "DeviceNotRegistered",
          message: "No live device.",
          disableTokens: dead,
        };
      }
      const code = errors[0] ?? "error";
      return {
        ...base,
        kind:
          code === "MessageTooBig"
            ? "permanent"
            : code === "InvalidCredentials" || code === "MismatchSenderId"
              ? "config"
              : "retry",
        code,
        message: "Expo refused the notification.",
        disableTokens: dead,
      };
    },
  };
}

/**
 * Receipts for tickets sent at least 15 minutes ago. Returns one update per
 * ticket that has a receipt, and the tokens to disable.
 */
export async function expoReceipts(
  settings: ExpoSettings,
  refs: string[],
  io: ProviderIo,
): Promise<{ updates: DeliveryUpdate[]; disableTokens: string[] } | null> {
  const byId = new Map(refs.map((ref) => [splitTicketRef(ref).id, splitTicketRef(ref).token]));
  const ids = [...byId.keys()].slice(0, 1000);
  if (ids.length === 0) return { updates: [], disableTokens: [] };
  const answer = await post(
    io.fetch,
    `${settings.baseUrl.replace(/\/$/, "")}/--/api/v2/push/getReceipts`,
    headers(settings),
    JSON.stringify({ ids }),
    io.timeoutMs,
  );
  if ("networkError" in answer || answer.status >= 300) return null;
  const json = parseJson(answer.text) as { data?: Record<string, Ticket> } | null;
  const updates: DeliveryUpdate[] = [];
  const disableTokens: string[] = [];
  const now = new Date().toISOString();
  for (const [id, receipt] of Object.entries(json?.data ?? {})) {
    const error = receipt.details?.error;
    if (error === "DeviceNotRegistered") disableTokens.push(byId.get(id) ?? "");
    updates.push({
      provider: "expo",
      providerMessageId: id,
      channel: "push",
      status: receipt.status === "ok" ? "delivered" : "failed",
      permanent: receipt.status !== "ok",
      occurredAt: now,
      ...(error ? { reason: error } : {}),
    });
  }
  return { updates, disableTokens: disableTokens.filter(Boolean) };
}
