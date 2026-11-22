/**
 * A fake of ONVO Pay's API, for development and tests only. It answers like
 * the requests and responses in docs/research/payments-gateways-costa-rica.md
 * (§6.1 to §6.8), serves a stand-in for ONVO's hosted payment page, and sends
 * signed webhooks (X-Onvo-Signature, §6.6) to the local payments-webhook
 * function. It reaches nothing else and moves no money.
 *
 * The hosted page (GET /pay/<session>) lets a person, or a journey, choose
 * what the card does: approve, decline, ask for the extra authentication step
 * (3-D Secure, then pass or fail it), abandon (back to the shop's cancel
 * address) or never finish.
 *
 * SINPE Móvil follows ONVO's test numbers (§6.8): +50688888888 pays after a
 * short delay, +50688884444 later, +50688889521 never, +50688883333 in two
 * halves. Any other number waits for a transfer sent with
 * POST /_fake/sinpe/transfer, which ONVO matches by the payer's
 * identification and the exact amount; one that matches nothing is reported
 * as `mobile_transfer.received` without a payment, as for a custom number.
 *
 * Control endpoints (all under /_fake):
 *   GET  /_fake/health
 *   GET  /_fake/state                         sessions, intents, refunds, events sent
 *   POST /_fake/reset
 *   POST /_fake/behaviour {refunds?, duplicate?, reorder?, drop?}
 *        refunds: succeed (default) | fail | reject (422) | lose (created, answer lost: 504) | hold
 *        duplicate: send every event twice; reorder: send pairs in reverse order;
 *        drop: send no webhook at all (only a check by the worker finds out)
 *   POST /_fake/sinpe/transfer {identification, amount, description?}
 *   POST /_fake/refunds/<id>/complete {outcome: succeeded | failed}
 *   POST /_fake/resend/<event id>             deliver an event again, late (same id)
 */

import { signOnvoWebhook } from "@yuntera/payments";

type Json = Record<string, unknown>;

export interface FakeOnvoOptions {
  webhookUrl?: string;
  webhookSecrets?: string[];
  /** Base address of this fake, for the hosted page's links. */
  publicUrl: string;
  sinpeDelayMs?: number;
  refundDelayMs?: number;
  log?: (line: string) => void;
}

interface Session {
  id: string;
  url: string;
  status: "open" | "complete" | "expired";
  paymentStatus: "unpaid" | "paid";
  paymentIntentId: string;
  amountTotal: number;
  currency: string;
  redirectUrl: string;
  cancelUrl: string;
  description: string;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  declined?: boolean;
}

interface Intent {
  id: string;
  amount: number;
  receivedAmount: number;
  currency: string;
  description: string;
  status: string;
  metadata: Record<string, string>;
  paymentMethodId: string | null;
  lastPaymentError: Json | null;
  latestCharge: Json | null;
  createdAt: string;
  updatedAt: string;
  kind: "card" | "mobile_number";
}

interface Refund {
  id: string;
  amount: number;
  currency: string;
  paymentIntentId: string;
  status: "pending" | "succeeded" | "failed";
  reason: string;
  description: string | null;
  failureReason: string | null;
  failure: Json | null;
  createdAt: string;
  updatedAt: string;
}

interface SentEvent {
  id: string;
  type: string;
  body: string;
  answers: number[];
}

const nowIso = () => new Date().toISOString();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to } });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (minor: number) =>
  `₡${(minor / 100).toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the fake "charges", to show finance a fee that differs from the expectation: 3.9% + US$0.35 at ₡507. */
export function fakeFee(kind: "card" | "mobile_number", amount: number): number {
  return kind === "card" ? Math.round(amount * 0.039) + 17_745 : Math.round(amount * 0.015);
}

export function createFakeOnvo(options: FakeOnvoOptions) {
  const log = options.log ?? (() => {});
  const sinpeDelay = options.sinpeDelayMs ?? 1500;
  const refundDelay = options.refundDelayMs ?? 800;
  let counter = 0;
  const id = (prefix: string) =>
    `${prefix}_fake${Date.now().toString(36)}${(++counter).toString(36)}`;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, work: () => Promise<void> | void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      Promise.resolve(work()).catch((error: unknown) => log(`timer failed: ${String(error)}`));
    }, ms);
    timers.add(timer);
  };

  let sessions = new Map<string, Session>();
  let intents = new Map<string, Intent>();
  let methods = new Map<string, Json>();
  let refunds = new Map<string, Refund>();
  let events: SentEvent[] = [];
  let behaviour = { refunds: "succeed", duplicate: false, reorder: false, drop: false };

  async function deliver(event: SentEvent, attempt = 1): Promise<void> {
    if (!options.webhookUrl) return;
    const secrets = options.webhookSecrets ?? [];
    const signature = await signOnvoWebhook(event.body, secrets, Math.floor(Date.now() / 1000));
    let status = 0;
    try {
      const response = await fetch(options.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "user-agent": "ONVO-Webhooks",
          "x-onvo-signature": signature,
          "x-onvo-event-id": event.id,
          "x-onvo-delivery-id": id("whd"),
          "x-onvo-attempt-id": id("wha"),
        },
        body: event.body,
      });
      status = response.status;
      await response.text();
    } catch {
      status = 0;
    }
    event.answers.push(status);
    log(`webhook ${event.type} ${event.id} → ${status || "no answer"}`);
    // Test mode retries up to three times (§6.5); here quickly.
    if ((status < 200 || status >= 300) && attempt <= 3) {
      later(500 * 2 ** attempt, () => deliver(event, attempt + 1));
    }
  }

  /** Sends events as ONVO would: at least once, in no guaranteed order. */
  function emit(list: Array<{ type: string; object: Json }>) {
    const built = list.map(({ type, object }) => {
      const event: SentEvent = {
        id: id("evt"),
        type,
        body: JSON.stringify({
          id: "",
          object: "event",
          createdAt: nowIso(),
          mode: "test",
          accountId: "acct_fake_local",
          type,
          data: { object },
        }),
        answers: [],
      };
      event.body = event.body.replace('"id":""', `"id":"${event.id}"`);
      events.push(event);
      return event;
    });
    if (behaviour.drop) return;
    const ordered = behaviour.reorder ? [...built].reverse() : built;
    ordered.forEach((event, index) => {
      later(50 + index * 150, () => deliver(event));
      if (behaviour.duplicate) later(400 + index * 150, () => deliver(event));
    });
  }

  const intentObject = (intent: Intent): Json => ({
    object: "payment_intent",
    ...intent,
    kind: undefined,
  });
  const sessionObject = (session: Session): Json => ({
    object: "checkout_session",
    id: session.id,
    url: session.url,
    status: session.status,
    paymentStatus: session.paymentStatus,
    paymentMode: "payment",
    amountSubtotal: session.amountTotal,
    amountTotal: session.amountTotal,
    currency: session.currency,
    paymentIntentId: session.paymentIntentId,
    successUrl: session.redirectUrl,
    cancelUrl: session.cancelUrl,
    metadata: session.metadata,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });

  function succeed(intent: Intent, amount = intent.amount) {
    intent.receivedAmount = Math.min(intent.amount, intent.receivedAmount + amount);
    intent.updatedAt = nowIso();
    if (intent.receivedAmount < intent.amount) {
      intent.status = "processing";
      emit([{ type: "payment_intent.processing", object: intentObject(intent) }]);
      return;
    }
    intent.status = "succeeded";
    intent.lastPaymentError = null;
    intent.latestCharge = {
      id: id("ch"),
      amount: intent.amount,
      currency: intent.currency,
      status: "succeeded",
      fee: fakeFee(intent.kind, intent.amount),
      createdAt: intent.updatedAt,
      updatedAt: intent.updatedAt,
    };
    const session = [...sessions.values()].find((s) => s.paymentIntentId === intent.id);
    const list: Array<{ type: string; object: Json }> = [
      { type: "payment_intent.succeeded", object: intentObject(intent) },
    ];
    if (session) {
      session.status = "complete";
      session.paymentStatus = "paid";
      session.updatedAt = intent.updatedAt;
      list.push({ type: "checkout_session.succeeded", object: sessionObject(session) });
    }
    emit(list);
  }

  function decline(intent: Intent, code: string, message: string) {
    intent.status = "requires_payment_method";
    intent.updatedAt = nowIso();
    intent.lastPaymentError = {
      type: "processing_error",
      code,
      message,
      paymentMethodType: "card",
    };
    intent.latestCharge = {
      id: id("ch"),
      amount: intent.amount,
      currency: intent.currency,
      status: "failed",
      failureCode: code,
      failureMessage: message,
      createdAt: intent.updatedAt,
      updatedAt: intent.updatedAt,
    };
    emit([{ type: "payment_intent.failed", object: intentObject(intent) }]);
  }

  function newIntent(
    amount: number,
    currency: string,
    description: string,
    metadata: Record<string, string>,
    kind: Intent["kind"],
  ) {
    const at = nowIso();
    const intent: Intent = {
      id: id("pi"),
      amount,
      receivedAmount: 0,
      currency,
      description,
      status: "requires_payment_method",
      metadata,
      paymentMethodId: null,
      lastPaymentError: null,
      latestCharge: null,
      createdAt: at,
      updatedAt: at,
      kind,
    };
    intents.set(intent.id, intent);
    return intent;
  }

  const strings = (value: unknown): Record<string, string> =>
    Object.fromEntries(
      Object.entries((value as Json) ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );

  function validationError(message: string) {
    return json(400, { statusCode: 400, message: [message], error: "Bad Request" });
  }
  function domainError(status: number, code: string, message: string, path: string) {
    return json(status, {
      statusCode: status,
      type: "OnvoAPIError",
      code,
      message,
      path,
      timestamp: nowIso(),
    });
  }

  function hostedPage(session: Session, step: "pay" | "challenge" | "stalled" = "pay"): Response {
    const title = "Pago con tarjeta · simulación local de la pasarela";
    const amount = money(session.amountTotal);
    const form = (action: string, label: string, testid: string, tone = "#0b5d3b") =>
      `<form method="post" action="/pay/${session.id}/act"><input type="hidden" name="action" value="${action}">` +
      `<button data-testid="${testid}" style="min-height:48px;width:100%;margin:6px 0;border:0;border-radius:8px;background:${tone};color:#fff;font-size:16px">${label}</button></form>`;
    let body: string;
    if (session.status !== "open") {
      body = `<p data-testid="fake-closed">Esta página de pago ya no está disponible (${session.status}).</p>`;
    } else if (step === "challenge") {
      body =
        `<h2>Verificación de su banco</h2><p data-testid="fake-3ds">Su banco pide confirmar que es usted (3-D Secure).</p>` +
        form("challenge_pass", "Confirmar en la aplicación del banco", "fake-3ds-pass") +
        form("challenge_fail", "No reconozco esta compra", "fake-3ds-fail", "#8a1c1c");
    } else if (step === "stalled") {
      body = `<p data-testid="fake-stalled">La página dejó de responder.</p>`;
    } else {
      body =
        `<p>Total: <strong data-testid="fake-amount">${amount}</strong></p>` +
        `<p style="color:#555">${escapeHtml(session.description)}</p>` +
        (session.declined
          ? `<p data-testid="fake-declined" style="color:#8a1c1c">El banco rechazó la tarjeta.</p>`
          : "") +
        `<label>Número de tarjeta (simulado)<input disabled value="4242 4242 4242 4242" style="display:block;width:100%;min-height:44px"></label>` +
        form("approve", "Pagar (aprobada)", "fake-approve") +
        form("challenge", "Pagar con verificación del banco", "fake-challenge") +
        form("decline", "Pagar (rechazada)", "fake-decline", "#8a1c1c") +
        form("abandon", "Volver a la tienda sin pagar", "fake-abandon", "#555") +
        form("stall", "No terminar (la página no responde)", "fake-stall", "#555");
    }
    return html(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
        `<body style="font-family:system-ui;max-width:420px;margin:24px auto;padding:0 16px"><h1 style="font-size:20px">${title}</h1>${body}</body></html>`,
    );
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── The hosted page ──────────────────────────────────────────────────
    const page = /^\/pay\/([^/]+)(\/act)?$/.exec(path);
    if (page) {
      const session = sessions.get(page[1] ?? "");
      if (!session) return html("<p>No existe.</p>", 404);
      if (method === "GET") return hostedPage(session);
      const form = new URLSearchParams(await request.text());
      const action = form.get("action");
      const intent = intents.get(session.paymentIntentId);
      if (!intent || session.status !== "open") return hostedPage(session);
      switch (action) {
        case "approve":
        case "challenge_pass":
          succeed(intent);
          return redirect(session.redirectUrl);
        case "challenge":
          intent.status = "requires_action";
          intent.updatedAt = nowIso();
          return hostedPage(session, "challenge");
        case "challenge_fail":
          decline(intent, "authentication_failed", "3-D Secure authentication failed");
          session.declined = true;
          return redirect(session.redirectUrl);
        case "decline":
          decline(intent, "declined", "Transaction declined");
          session.declined = true;
          return redirect(session.redirectUrl);
        case "abandon":
          return redirect(session.cancelUrl);
        default:
          return hostedPage(session, "stalled");
      }
    }

    // ── Control ──────────────────────────────────────────────────────────
    if (path.startsWith("/_fake/")) {
      if (path === "/_fake/health") return json(200, { ok: true });
      if (path === "/_fake/state") {
        return json(200, {
          sessions: [...sessions.values()],
          intents: [...intents.values()],
          refunds: [...refunds.values()],
          methods: [...methods.values()],
          events: events.map((e) => ({ id: e.id, type: e.type, answers: e.answers })),
          behaviour,
        });
      }
      if (path === "/_fake/reset" && method === "POST") {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        sessions = new Map();
        intents = new Map();
        methods = new Map();
        refunds = new Map();
        events = [];
        behaviour = { refunds: "succeed", duplicate: false, reorder: false, drop: false };
        return json(200, { reset: true });
      }
      const body = (await request.json().catch(() => ({}))) as Json;
      if (path === "/_fake/behaviour" && method === "POST") {
        behaviour = { ...behaviour, ...(body as Partial<typeof behaviour>) };
        return json(200, behaviour);
      }
      if (path === "/_fake/sinpe/transfer" && method === "POST") {
        const amount = Number(body.amount);
        const identification = String(body.identification ?? "");
        const match = [...intents.values()].find((intent) => {
          const pm = methods.get(intent.paymentMethodId ?? "");
          const mobile = (pm?.mobileNumber ?? {}) as Json;
          return (
            intent.status === "processing" &&
            intent.kind === "mobile_number" &&
            mobile.identification === identification &&
            intent.amount - intent.receivedAmount === amount
          );
        });
        if (match) {
          succeed(match, amount);
          return json(200, { matched: match.id });
        }
        emit([
          {
            type: "mobile_transfer.received",
            object: {
              object: "mobile_transfer",
              id: id("mt"),
              SINPERefNumber: `${Date.now()}`.padStart(25, "0"),
              amount,
              currency: "CRC",
              description: String(body.description ?? ""),
              status: "charge_not_found",
              paymentIntentId: null,
              createdAt: nowIso(),
            },
          },
        ]);
        return json(200, { matched: null });
      }
      const complete = /^\/_fake\/refunds\/([^/]+)\/complete$/.exec(path);
      if (complete && method === "POST") {
        const refund = refunds.get(complete[1] ?? "");
        if (!refund) return json(404, { error: "no refund" });
        settleRefund(refund, body.outcome === "failed" ? "failed" : "succeeded");
        return json(200, refund);
      }
      const resend = /^\/_fake\/resend\/([^/]+)$/.exec(path);
      if (resend && method === "POST") {
        const event = events.find((e) => e.id === resend[1]);
        if (!event) return json(404, { error: "no event" });
        await deliver(event, 99);
        return json(200, { resent: event.id, answers: event.answers });
      }
      return json(404, { error: "unknown control" });
    }

    // ── The API ──────────────────────────────────────────────────────────
    if (!path.startsWith("/v1/")) return json(404, { statusCode: 404, message: "Not Found" });
    const auth = request.headers.get("authorization") ?? "";
    if (!/^Bearer onvo_test_secret_key_[A-Za-z0-9_]+$/.test(auth)) {
      return domainError(401, "unauthorized", "Invalid API key", path);
    }
    const body = method === "POST" ? ((await request.json().catch(() => ({}))) as Json) : {};

    if (path === "/v1/checkout/sessions/one-time-link" && method === "POST") {
      const items = Array.isArray(body.lineItems) ? (body.lineItems as Json[]) : [];
      const total = items.reduce(
        (sum, item) => sum + Number(item.unitAmount) * Number(item.quantity),
        0,
      );
      if (!items.length || !Number.isInteger(total) || total < 26_000) {
        return validationError("lineItems must add up to at least the minimum amount");
      }
      if (typeof body.redirectUrl !== "string" || typeof body.cancelUrl !== "string") {
        return validationError("redirectUrl and cancelUrl are required");
      }
      const currency = String(items[0]?.currency ?? "CRC");
      const description = String(items[0]?.description ?? "");
      const intent = newIntent(total, currency, description, strings(body.metadata), "card");
      const sessionId = id("cs");
      const at = nowIso();
      const session: Session = {
        id: sessionId,
        url: `${options.publicUrl}/pay/${sessionId}`,
        status: "open",
        paymentStatus: "unpaid",
        paymentIntentId: intent.id,
        amountTotal: total,
        currency,
        redirectUrl: body.redirectUrl,
        cancelUrl: body.cancelUrl,
        description,
        metadata: strings(body.metadata),
        createdAt: at,
        updatedAt: at,
      };
      sessions.set(sessionId, session);
      return json(201, sessionObject(session));
    }

    const sessionPath = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(path);
    if (sessionPath) {
      const session = sessions.get(sessionPath[1] ?? "");
      if (!session) return domainError(404, "resource_missing", "Checkout session not found", path);
      if (sessionPath[2] && method === "POST") {
        if (session.status !== "open") {
          return domainError(409, "session_not_open", "The session is not open", path);
        }
        session.status = "expired";
        session.updatedAt = nowIso();
        const intent = intents.get(session.paymentIntentId);
        if (intent && intent.status !== "succeeded") intent.status = "canceled";
        return json(200, sessionObject(session));
      }
      return json(200, sessionObject(session));
    }

    if (path === "/v1/payment-intents" && method === "POST") {
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 26_000)
        return validationError("amount must be an integer");
      return json(
        201,
        intentObject(
          newIntent(
            amount,
            String(body.currency ?? "CRC"),
            String(body.description ?? ""),
            strings(body.metadata),
            "mobile_number",
          ),
        ),
      );
    }

    if (path === "/v1/payment-methods" && method === "POST") {
      const mobile = (body.mobileNumber ?? {}) as Json;
      if (
        body.type !== "mobile_number" ||
        typeof mobile.identification !== "string" ||
        mobile.identification.length !== 12 ||
        !/^\+506\d{8}$/.test(String(mobile.number))
      ) {
        return validationError("mobileNumber.identification and mobileNumber.number are required");
      }
      const pm = { id: id("pm"), type: "mobile_number", mobileNumber: mobile, createdAt: nowIso() };
      methods.set(pm.id, pm);
      return json(201, pm);
    }

    const intentPath = /^\/v1\/payment-intents\/([^/]+)(\/confirm|\/cancel)?$/.exec(path);
    if (intentPath) {
      const intent = intents.get(intentPath[1] ?? "");
      if (!intent) return domainError(404, "resource_missing", "Payment intent not found", path);
      if (intentPath[2] === "/cancel" && method === "POST") {
        if (intent.status === "succeeded") {
          return domainError(409, "payment_intent_unexpected_state", "Already succeeded", path);
        }
        intent.status = "canceled";
        intent.updatedAt = nowIso();
        emit([{ type: "payment_intent.canceled", object: intentObject(intent) }]);
        return json(200, intentObject(intent));
      }
      if (intentPath[2] === "/confirm" && method === "POST") {
        const pm = methods.get(String(body.paymentMethodId ?? ""));
        if (!pm) return domainError(422, "payment_method_invalid", "Unknown payment method", path);
        intent.paymentMethodId = String(pm.id);
        intent.status = "processing";
        intent.updatedAt = nowIso();
        emit([{ type: "payment_intent.processing", object: intentObject(intent) }]);
        const number = String(((pm.mobileNumber ?? {}) as Json).number ?? "");
        if (number === "+50688888888") later(sinpeDelay, () => succeed(intent));
        if (number === "+50688884444") later(sinpeDelay * 20, () => succeed(intent));
        if (number === "+50688883333") {
          later(sinpeDelay, () => succeed(intent, Math.floor(intent.amount / 2)));
          later(sinpeDelay * 2, () => succeed(intent, intent.amount - intent.receivedAmount));
        }
        return json(200, intentObject(intent));
      }
      return json(200, intentObject(intent));
    }

    if (path === "/v1/refunds" && method === "POST") {
      const intent = intents.get(String(body.paymentIntentId ?? ""));
      if (!intent) return domainError(404, "resource_missing", "Payment intent not found", path);
      const amount = body.amount === undefined ? intent.receivedAmount : Number(body.amount);
      if (
        !["succeeded", "partially_refunded"].includes(intent.status) ||
        !Number.isInteger(amount)
      ) {
        return domainError(422, "charge_not_refundable", "The payment cannot be refunded", path);
      }
      const pending = [...refunds.values()]
        .filter((r) => r.paymentIntentId === intent.id && r.status === "pending")
        .reduce((sum, r) => sum + r.amount, 0);
      if (amount <= 0 || amount > intent.receivedAmount - pending) {
        return domainError(422, "amount_too_large", "Refund exceeds what was received", path);
      }
      if (behaviour.refunds === "reject") {
        return domainError(422, "merchant_cannot_process", "Refunds are not available", path);
      }
      const at = nowIso();
      const refund: Refund = {
        id: id("rf"),
        amount,
        currency: intent.currency,
        paymentIntentId: intent.id,
        status: "pending",
        reason: String(body.reason ?? "requested_by_customer"),
        description: typeof body.description === "string" ? body.description : null,
        failureReason: null,
        failure: null,
        createdAt: at,
        updatedAt: at,
      };
      refunds.set(refund.id, refund);
      emit([{ type: "refund.created", object: { object: "refund", ...refund } }]);
      if (behaviour.refunds === "succeed" || behaviour.refunds === "lose") {
        later(refundDelay, () => settleRefund(refund, "succeeded"));
      } else if (behaviour.refunds === "fail") {
        later(refundDelay, () => settleRefund(refund, "failed"));
      }
      if (behaviour.refunds === "lose")
        return json(504, { statusCode: 504, message: "Gateway Timeout" });
      return json(201, { object: "refund", mode: "test", ...refund });
    }

    const refundPath = /^\/v1\/refunds\/([^/]+)$/.exec(path);
    if (refundPath && method === "GET") {
      const refund = refunds.get(refundPath[1] ?? "");
      if (!refund) return domainError(404, "resource_missing", "Refund not found", path);
      return json(200, { object: "refund", mode: "test", ...refund });
    }

    return json(404, { statusCode: 404, message: `Cannot ${method} ${path}`, error: "Not Found" });
  }

  function settleRefund(refund: Refund, outcome: "succeeded" | "failed") {
    if (refund.status !== "pending") return;
    refund.status = outcome;
    refund.updatedAt = nowIso();
    if (outcome === "failed") {
      refund.failureReason = "declined";
      refund.failure = { code: "declined", message: "The refund was declined." };
    } else {
      const intent = intents.get(refund.paymentIntentId);
      if (intent) {
        intent.receivedAmount -= refund.amount;
        intent.status = intent.receivedAmount <= 0 ? "refunded" : "partially_refunded";
        intent.updatedAt = refund.updatedAt;
      }
    }
    emit([{ type: `refund.${outcome}`, object: { object: "refund", ...refund } }]);
  }

  return {
    handle,
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
