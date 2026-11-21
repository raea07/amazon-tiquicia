/**
 * A fake of the provider APIs the worker calls, for development and tests
 * only. It answers like Bird (e-mail, WhatsApp, SMS) and Expo (push send and
 * receipts) as described in docs/research/notifications-email-whatsapp-push.md,
 * keeps every accepted message in a local outbox, and reports delivery back
 * through signed webhooks, as Bird does. It sends nothing anywhere else.
 *
 * It can be told to misbehave, per channel and recipient:
 *   reject    422, kept for the key like Bird keeps a refusal
 *   fail      500, not kept
 *   timeout   no answer for 30 seconds
 *   ratelimit 429 with Retry-After: 1
 *   wallet    402 WalletInsufficientBalance
 *
 * Control endpoints (all under /_fake):
 *   GET  /_fake/messages[?channel=&to=&delivery_id=&template=]   the local outbox
 *   GET  /_fake/messages/<id>/html                               an e-mail as the person would see it
 *   GET  /_fake/attempts                                         every request, accepted or not
 *   POST /_fake/behaviour {rules: [{mode, channel?, to?, times?}]}
 *   POST /_fake/deliver {id, status?}                            send a delivery webhook now
 *   POST /_fake/reset
 */

import { signStandardWebhook } from "@yuntera/notifications";

export type Mode = "reject" | "fail" | "timeout" | "ratelimit" | "wallet";
export interface Rule {
  mode: Mode;
  channel?: "email" | "whatsapp" | "sms" | "push";
  /** E-mail address or phone number, exact. */
  to?: string;
  /** How many requests the rule applies to; unlimited when absent. */
  times?: number;
}

export interface FakeMessage {
  id: string;
  channel: "email" | "whatsapp" | "sms" | "push";
  to: string;
  deliveryId: string | null;
  template: string | null;
  idempotencyKey: string | null;
  subject?: string;
  text?: string;
  html?: string;
  parameters?: Record<string, string>;
  pushTitle?: string;
  pushBody?: string;
  status: "accepted" | "delivered";
  acceptedAt: string;
  webhooks: string[];
}

export interface Attempt {
  channel: string;
  to: string;
  deliveryId: string | null;
  idempotencyKey: string | null;
  status: number;
  replay: boolean;
  at: string;
}

export interface FakeOptions {
  webhookUrl?: string;
  webhookSecret?: string;
  /** Milliseconds after acceptance before the delivery webhook is sent; negative turns it off. */
  deliverAfterMs?: number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const birdError = (status: number, type: string, code: string, name: string, message: string) =>
  json(status, { error: { type, code, name, message, request_id: `req_${crypto.randomUUID()}` } });

export function createFake(options: FakeOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const log = options.log ?? (() => {});
  let messages: FakeMessage[] = [];
  let attempts: Attempt[] = [];
  let rules: Rule[] = [];
  /** idempotency key → the exact body and the answer kept for it. */
  let kept = new Map<string, { body: string; status: number; answer: unknown }>();
  let sequence = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function ruleFor(channel: string, to: string): Rule | undefined {
    const rule = rules.find(
      (r) =>
        (!r.channel || r.channel === channel) && (!r.to || r.to.toLowerCase() === to.toLowerCase()),
    );
    if (rule && rule.times !== undefined) {
      rule.times -= 1;
      if (rule.times <= 0) rules = rules.filter((r) => r !== rule);
    }
    return rule;
  }

  async function webhook(message: FakeMessage, status: string) {
    if (!options.webhookUrl || !options.webhookSecret) return;
    const type = message.channel === "email" ? `email.${status}` : `${message.channel}.${status}`;
    const data: Record<string, unknown> =
      message.channel === "email"
        ? {
            email_id: message.id,
            recipient: message.to,
            recipient_role: "to",
            metadata: { delivery_id: message.deliveryId },
            tags: [],
          }
        : {
            [`${message.channel}_id`]: message.id,
            direction: "outbound",
            to: { phone_number: message.to },
            metadata: { delivery_id: message.deliveryId },
            tags: null,
          };
    const body = JSON.stringify({ type, timestamp: new Date().toISOString(), data });
    const id = `msg_fake_${crypto.randomUUID()}`;
    const headers = await signStandardWebhook(
      body,
      options.webhookSecret,
      id,
      Math.floor(Date.now() / 1000),
    );
    try {
      const response = await fetchImpl(options.webhookUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body,
      });
      message.webhooks.push(`${type} → ${response.status}`);
      if (response.ok && (status === "delivered" || status === "read"))
        message.status = "delivered";
      log(`webhook ${type} for ${message.id}: ${response.status}`);
    } catch (error) {
      message.webhooks.push(`${type} → unreachable`);
      log(`webhook ${type} for ${message.id} not delivered: ${String(error)}`);
    }
  }

  function scheduleDelivery(message: FakeMessage) {
    const delay = options.deliverAfterMs ?? 300;
    if (delay < 0) return;
    const timer = setTimeout(async () => {
      timers.delete(timer);
      if (message.channel === "whatsapp" || message.channel === "sms")
        await webhook(message, "sent");
      await webhook(message, "delivered");
    }, delay);
    timers.add(timer);
  }

  async function bird(request: Request, channel: "email" | "whatsapp" | "sms"): Promise<Response> {
    const auth = request.headers.get("authorization") ?? "";
    if (!/^Bearer bk_[a-z0-9]+_\S+$/.test(auth)) {
      return birdError(
        401,
        "authentication_error",
        "E01001",
        "Unauthorized",
        "Missing or invalid API key.",
      );
    }
    const raw = await request.text();
    const key = request.headers.get("idempotency-key");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return birdError(400, "invalid_request_error", "E02000", "InvalidJson", "Body is not JSON.");
    }
    const to =
      channel === "email"
        ? String((body.to as Array<{ email?: string }> | undefined)?.[0]?.email ?? "")
        : String(body.to ?? "");
    const deliveryId =
      String((body.metadata as { delivery_id?: unknown } | undefined)?.delivery_id ?? "") || null;
    const record = (status: number, replay = false) =>
      attempts.push({
        channel,
        to,
        deliveryId,
        idempotencyKey: key,
        status,
        replay,
        at: new Date().toISOString(),
      });

    // Idempotency as Bird documents it: the same key and bytes replay the kept answer.
    if (key) {
      const previous = kept.get(key);
      if (previous) {
        if (previous.body !== raw) {
          record(409);
          return birdError(
            409,
            "idempotency_error",
            "E01005",
            "IdempotencyKeyReuse",
            "Key reused with a different request.",
          );
        }
        record(previous.status, true);
        return json(previous.status, previous.answer, { "idempotency-replay": "true" });
      }
    }

    const rule = ruleFor(channel, to);
    if (rule?.mode === "timeout") {
      record(0);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      return birdError(504, "api_error", "E00000", "Timeout", "Took too long.");
    }
    if (rule?.mode === "fail") {
      record(500);
      return birdError(500, "api_error", "E00001", "InternalError", "Something went wrong.");
    }
    if (rule?.mode === "ratelimit") {
      record(429);
      return new Response(
        JSON.stringify({
          error: { type: "rate_limit_error", code: "E01003", name: "RateLimited" },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "1" },
        },
      );
    }
    const keep = (status: number, answer: unknown) => {
      if (key) kept.set(key, { body: raw, status, answer });
      record(status);
      return json(status, answer);
    };
    if (rule?.mode === "wallet") {
      return keep(402, {
        error: {
          type: "payment_required",
          code: "E03001",
          name: "WalletInsufficientBalance",
          message: "Top up the wallet.",
        },
      });
    }
    if (rule?.mode === "reject") {
      return keep(422, {
        error: {
          type: "invalid_request_error",
          code: "E02010",
          name: "RecipientRejected",
          message: `Recipient ${to} was rejected.`,
        },
      });
    }
    if (
      channel === "email" &&
      (body.parameters !== undefined || body.category !== "transactional")
    ) {
      return keep(422, {
        error: {
          type: "invalid_request_error",
          code: "E02011",
          name: "UnexpectedField",
          message: "Transactional mail must not carry parameters.",
        },
      });
    }
    if (channel !== "email" && !/^\+\d{8,15}$/.test(to)) {
      return keep(422, {
        error: {
          type: "invalid_request_error",
          code: "E15001",
          name: "WhatsAppInvalidRecipient",
          message: "Invalid recipient.",
        },
      });
    }

    sequence += 1;
    const prefix = channel === "email" ? "em" : channel === "whatsapp" ? "wam" : "sms";
    const id = `${prefix}_fake_${sequence.toString().padStart(6, "0")}`;
    const template = body.template as
      | { slug?: string; parameters?: Record<string, string> }
      | undefined;
    const message: FakeMessage = {
      id,
      channel,
      to,
      deliveryId,
      template:
        template?.slug ??
        (body.tags as Array<{ name: string; value: string }> | undefined)?.find(
          (t) => t.name === "template",
        )?.value ??
        null,
      idempotencyKey: key,
      ...(channel === "email"
        ? {
            subject: String(body.subject ?? ""),
            text: String(body.text ?? ""),
            html: String(body.html ?? ""),
          }
        : {}),
      ...(channel === "sms" ? { text: String(body.text ?? "") } : {}),
      ...(template?.parameters ? { parameters: template.parameters } : {}),
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      webhooks: [],
    };
    messages.push(message);
    log(`accepted ${channel} ${id} (${message.template ?? "?"})`);
    scheduleDelivery(message);
    return keep(202, { id, status: "accepted" });
  }

  async function expoSend(request: Request): Promise<Response> {
    const raw = await request.text();
    const list = JSON.parse(raw) as Array<{
      to: string;
      title?: string;
      body?: string;
      data?: Record<string, string>;
    }>;
    const tickets = list.map((m) => {
      const rule = ruleFor("push", m.to);
      attempts.push({
        channel: "push",
        to: m.to,
        deliveryId: null,
        idempotencyKey: null,
        status: rule ? 200 : 200,
        replay: false,
        at: new Date().toISOString(),
      });
      if (rule?.mode === "reject")
        return { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } };
      sequence += 1;
      const id = `ticket_fake_${sequence}`;
      messages.push({
        id,
        channel: "push",
        to: m.to,
        deliveryId: null,
        template: null,
        idempotencyKey: null,
        pushTitle: m.title ?? "",
        pushBody: m.body ?? "",
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        webhooks: [],
      });
      return { status: "ok", id };
    });
    return json(200, { data: tickets });
  }

  async function expoReceipts(request: Request): Promise<Response> {
    const { ids } = (await request.json()) as { ids: string[] };
    const data: Record<string, unknown> = {};
    for (const id of ids) {
      const message = messages.find((m) => m.id === id);
      if (message) {
        message.status = "delivered";
        data[id] = { status: "ok" };
      }
    }
    return json(200, { data });
  }

  async function control(request: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    if (request.method === "POST" && path === "/_fake/reset") {
      messages = [];
      attempts = [];
      rules = [];
      kept = new Map();
      return json(200, { reset: true });
    }
    if (request.method === "POST" && path === "/_fake/behaviour") {
      const body = (await request.json()) as { rules?: Rule[] };
      rules = (body.rules ?? []).map((r) => ({ ...r }));
      return json(200, { rules });
    }
    if (request.method === "POST" && path === "/_fake/deliver") {
      const body = (await request.json()) as { id: string; status?: string };
      const message = messages.find((m) => m.id === body.id);
      if (!message) return json(404, { error: "unknown message" });
      await webhook(message, body.status ?? "delivered");
      return json(200, message);
    }
    if (request.method === "GET" && path === "/_fake/attempts") return json(200, attempts);
    const html = /^\/_fake\/messages\/([^/]+)\/html$/.exec(path);
    if (request.method === "GET" && html) {
      const message = messages.find((m) => m.id === html[1]);
      if (!message?.html) return json(404, { error: "no such e-mail" });
      return new Response(message.html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (request.method === "GET" && path === "/_fake/messages") {
      const filter = (name: string) => url.searchParams.get(name);
      return json(
        200,
        messages.filter(
          (m) =>
            (!filter("channel") || m.channel === filter("channel")) &&
            (!filter("to") || m.to.toLowerCase() === filter("to")?.toLowerCase()) &&
            (!filter("delivery_id") || m.deliveryId === filter("delivery_id")) &&
            (!filter("template") || m.template === filter("template")),
        ),
      );
    }
    return json(404, { error: `no fake route for ${request.method} ${path}` });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_fake/")) return control(request, url);
    if (request.method === "POST" && url.pathname === "/v1/email/messages")
      return bird(request, "email");
    if (request.method === "POST" && url.pathname === "/v1/whatsapp/messages")
      return bird(request, "whatsapp");
    if (request.method === "POST" && url.pathname === "/v1/sms/messages")
      return bird(request, "sms");
    if (request.method === "POST" && url.pathname === "/--/api/v2/push/send")
      return expoSend(request);
    if (request.method === "POST" && url.pathname === "/--/api/v2/push/getReceipts")
      return expoReceipts(request);
    return json(404, { error: { type: "not_found_error", message: `No route ${url.pathname}` } });
  }

  return {
    handle,
    messages: () => messages,
    attempts: () => attempts,
    close: () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
