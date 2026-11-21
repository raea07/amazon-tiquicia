/**
 * The provider-neutral shapes the worker is built on (section 7 of
 * docs/research/notifications-email-whatsapp-push.md). Nothing here knows Bird
 * or Expo; the adapters in ./channels do.
 *
 * This package uses web-standard globals only (fetch, crypto.subtle,
 * TextEncoder) and imports with explicit `.ts` extensions, so the same files
 * run under Node for the tests and the local stack, and under Deno as
 * Supabase Edge Functions.
 */

export type Channel = "email" | "whatsapp" | "sms" | "push";
export type Category = "transactional" | "marketing" | "authentication";
export type AppId = "shop" | "seller" | "driver" | "warehouse";

export type Recipient =
  | { channel: "email"; email: string; name?: string | null }
  | { channel: "whatsapp" | "sms"; phone: string; name?: string | null }
  | { channel: "push"; app: AppId; tokens: string[]; name?: string | null };

export interface RenderedEmail {
  channel: "email";
  subject: string;
  html: string;
  text: string;
  /** Which sender address: orders, account or sellers. */
  from: "orders" | "account" | "sellers";
}
export interface RenderedWhatsApp {
  channel: "whatsapp";
  templateSlug: string;
  language: string;
  parameters: Record<string, string>;
}
export interface RenderedSms {
  channel: "sms";
  text: string;
}
export interface RenderedPush {
  channel: "push";
  title: string;
  body: string;
  data: Record<string, string>;
  channelId?: string;
  collapseId?: string;
  tag?: string;
  ttlSeconds?: number;
  priority?: "default" | "normal" | "high";
}
export type Rendered = RenderedEmail | RenderedWhatsApp | RenderedSms | RenderedPush;

export interface OutboundMessage {
  /** Our id: the provider's `reference` and `metadata.delivery_id`. */
  deliveryId: string;
  /** "yt/<env>/<deliveryId>/<generation>". */
  idempotencyKey: string;
  category: Category;
  template: string;
  to: Recipient;
  content: Rendered;
  /** Exact request bytes from an earlier attempt; when present the adapter resends them. */
  frozenRequestBody?: string | null;
}

/** How a failure is handled; see `worker_notify_fail` in the migration. */
export type FailureKind = "retry" | "permanent" | "config" | "account" | "recipient";

export type SendResult =
  | {
      ok: true;
      provider: string;
      providerMessageId: string;
      requestBody: string;
      pushTicketIds?: string[];
      /** Push tokens a ticket said are dead. */
      disableTokens?: string[];
    }
  | {
      ok: false;
      provider: string;
      requestBody?: string;
      kind: FailureKind;
      code: string;
      message: string;
      /** The provider kept this refusal: the next attempt must be a new request under a new key. */
      newKey: boolean;
      retryAfterSeconds?: number;
      disableTokens?: string[];
    };

export interface ProviderIo {
  fetch: typeof fetch;
  /** Milliseconds before a request is abandoned (and retried later). */
  timeoutMs: number;
}

export interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: "bird" | "expo";
  /** The exact request body this adapter would send, so it can be frozen first. */
  buildRequest(message: OutboundMessage): string;
  send(message: OutboundMessage & { requestBody: string }, io: ProviderIo): Promise<SendResult>;
}

export type DeliveryStatus =
  | "sent"
  | "delivered"
  | "read"
  | "bounced"
  | "failed"
  | "rejected"
  | "complained"
  | "unsubscribed"
  | "opted_out";

export interface DeliveryUpdate {
  provider: string;
  providerMessageId?: string;
  /** From echoed metadata. */
  deliveryId?: string;
  channel?: Channel;
  status: DeliveryStatus;
  permanent: boolean;
  /** Provider timestamp; updates are applied monotonically. */
  occurredAt: string;
  reason?: string;
  /** For suppression mirroring only. */
  recipientAddress?: string;
}

/** One message as the database hands it to the worker (`worker_notify_claim`). */
export interface ClaimedDelivery {
  id: string;
  channel: Channel;
  category: Category;
  template: string;
  locale: string;
  audience: string;
  generation: number;
  attempts: number;
  request_body: string | null;
  commercial_consent: boolean;
  to: Recipient;
  vars: Record<string, unknown>;
}

export interface DeliveryQueue {
  plan(limit: number): Promise<number>;
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedDelivery[]>;
  freeze(id: string, workerId: string, generation: number, requestBody: string): Promise<boolean>;
  sent(
    id: string,
    workerId: string,
    provider: string,
    providerMessageId: string,
    pushTicketIds?: string[],
  ): Promise<boolean>;
  fail(
    id: string,
    workerId: string,
    failure: { kind: FailureKind; code: string; message: string; newKey: boolean },
    retryAfterSeconds?: number,
  ): Promise<string | null>;
  defer(id: string, workerId: string, until: Date): Promise<boolean>;
  skip(id: string, workerId: string, reason: string): Promise<boolean>;
  disableTokens(tokens: string[]): Promise<number>;
  receiptsDue(
    limit: number,
    olderThanSeconds: number,
  ): Promise<Array<{ id: string; ticket_ids: string[] }>>;
  applyUpdate(update: DeliveryUpdate, webhookId?: string): Promise<string>;
}

export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Logs carry ids, codes and counts only: never an address, a name or message text. */
export const consoleLogger: Logger = {
  info: (message, fields) => console.info(`[notify] ${message}`, fields ?? ""),
  warn: (message, fields) => console.warn(`[notify] ${message}`, fields ?? ""),
  error: (message, fields) => console.error(`[notify] ${message}`, fields ?? ""),
};
