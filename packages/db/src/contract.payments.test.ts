/**
 * Payments through the gateway (20261121083400_payments.sql): every function
 * that returns data answers in the shape the client expects, called the way
 * an API request makes it; and the races the webhook must survive, with two
 * real database sessions at once (the pattern of contract.integrity.test.ts):
 * the same event delivered twice in parallel, a payment confirmed while the
 * shopper cancels, and while the order expires.
 *
 * This file switches the payments mode, so it builds its own copy of the
 * database (same migrations and seed, by supabase/scripts/local-db.sh) next
 * to the one in DATABASE_URL, named with `_payments`, and drops it at the end.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type Claims, callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type Api, createApi } from "./api";

const shared = process.env.DATABASE_URL;
const copyName =
  process.env.PAYMENTS_DB_NAME ?? `${shared ? new URL(shared).pathname.slice(1) : ""}_payments`;
const withDatabase = (name: string) => {
  const target = new URL(shared ?? "postgres://localhost/postgres");
  target.pathname = `/${name}`;
  return target.toString();
};
const url = shared ? withDatabase(copyName) : undefined;
const localDb = fileURLToPath(new URL("../../../supabase/scripts/local-db.sh", import.meta.url));
const ADMIN = "central@yuntera.example";
const FINANCE = "pagos-finanzas@yuntera.example";
const SHOPPER = "comprador@yuntera.example";
const RUN = Date.now().toString(36);

let pool: pg.Pool;
const ids = new Map<string, string>();

function api(email?: string): Api {
  const claims: Claims | null = email
    ? { sub: ids.get(email) ?? "", role: "authenticated", aal: "aal2" }
    : null;
  return createApi({
    rpc: async (fn, args = {}) => {
      const result = await callRpc(pool, fn, args, claims);
      return result.ok
        ? { data: result.data, error: null, status: 200 }
        : { data: null, error: result.error, status: result.status };
    },
  });
}

/** The payments worker, with its secret key's role. */
async function worker<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const result = await callRpc(pool, fn, args, { sub: "", role: "service_role" });
  if (!result.ok) throw new Error(result.error.message);
  return result.data as T;
}

const lookup = async <T = unknown>(sql: string, params: unknown[] = []) =>
  (await pool.query<{ r: T }>(sql, params)).rows[0]?.r as T;

interface Session {
  client: pg.PoolClient;
  pid: number;
}
const live = new Set<Session>();

/** A session with an open transaction, as a user or as the worker. */
async function open(who: string | "worker"): Promise<Session> {
  const client = await pool.connect();
  const pid =
    (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid ?? 0;
  await client.query("begin");
  const claims =
    who === "worker"
      ? { role: "service_role" }
      : { sub: ids.get(who), role: "authenticated", aal: "aal2" };
  await client.query(
    "select set_config('request.jwt.claims', $1, true), set_config('role', $2, true)",
    [JSON.stringify(claims), who === "worker" ? "service_role" : "authenticated"],
  );
  const session = { client, pid };
  live.add(session);
  return session;
}

async function end(session: Session, how: "commit" | "rollback") {
  if (!live.delete(session)) return;
  try {
    await session.client.query(how);
  } finally {
    session.client.release();
  }
}

async function one<T = unknown>(session: Session, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await session.client.query<{ r: T }>(sql, params);
  return rows[0]?.r as T;
}

async function blocked(pid: number) {
  for (let i = 0; i < 100; i++) {
    const waiting = await lookup<boolean>(
      "select wait_event_type = 'Lock' as r from pg_stat_activity where pid = $1",
      [pid],
    );
    if (waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

const codeOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: Error) => error.message,
  );

const offer = (slug: string) =>
  lookup<string>(
    `select o.id as r from public.offers o join public.skus k on k.id = o.sku_id
     join public.products p on p.id = k.product_id
     where p.slug = $1 order by (o.fulfillment = 'platform') desc, o.price_minor desc, o.id limit 1`,
    [slug],
  );

async function place(method: "card" | "sinpe_movil", key: string) {
  const shopper = api(SHOPPER);
  const address = (await shopper.myAddresses()).find((a) => a.is_default);
  const placed = await shopper.placeOrder({
    items: [{ offerId: await offer("parlante-bluetooth-nimbo-ola"), quantity: 1 }],
    addressId: address?.id ?? "",
    paymentMethod: method,
    idempotencyKey: `${key}-${RUN}`,
  });
  return placed;
}

/** The worker creates every due attempt, answering as the gateway would. */
async function createDue() {
  const tasks = await worker<Array<Record<string, string>>>("worker_payments_claim", {
    p_worker: "contract",
    p_limit: 50,
    p_lease_seconds: 60,
  });
  for (const task of tasks) {
    if (task.kind !== "create") continue;
    const tag = String(task.attempt_id).slice(0, 8);
    await worker("worker_payments_report", {
      p_worker: "contract",
      p_report: {
        kind: "created",
        attempt_id: task.attempt_id,
        outcome: "created",
        session_reference: task.method === "card" ? `cs_${tag}` : null,
        intent_reference: `pi_${tag}`,
        checkout_url: task.method === "card" ? `https://checkout.onvopay.com/pay/cs_${tag}` : null,
        sinpe_destination: task.method === "sinpe_movil" ? "+50670196686" : null,
        status: task.method === "sinpe_movil" ? "processing" : "open",
      },
    });
  }
}

async function succeeded(orderId: string, eventId: string) {
  const attempt = await lookup<{
    intent_reference: string;
    session_reference: string;
    amount_minor: string;
  }>(
    `select row_to_json(a) as r from private.payment_attempts a where a.order_id = $1
     order by a.created_at desc limit 1`,
    [orderId],
  );
  return {
    provider: "onvo",
    event_id: `${eventId}-${RUN}`,
    source: "webhook",
    environment: "test",
    type: "payment.succeeded",
    provider_type: "checkout_session.succeeded",
    occurred_at: new Date().toISOString(),
    payment: {
      reference: attempt.intent_reference,
      session_reference: attempt.session_reference,
      status: "paid",
      amount_minor: Number(attempt.amount_minor),
      currency: "CRC",
      updated_at: new Date().toISOString(),
      failure_code: null,
      fee_minor: 1234,
      metadata: {},
    },
  };
}

const EVENT = "select public.worker_payments_event($1::jsonb) as r";

/**
 * Each race opens two sessions, waits up to five seconds for the second to be
 * blocked (`blocked`) and does its own setup through the API: on a loaded
 * 4-CPU machine that takes longer than vitest's 5 s default. The timeout only
 * lets a slow machine finish; what each test proves is unchanged.
 */
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!shared)("payments: payloads and races", () => {
  beforeAll(async () => {
    execFileSync("bash", [localDb, "reset"], {
      env: { ...process.env, PG_ADMIN_URL: withDatabase("postgres"), PG_DB_NAME: copyName },
      stdio: "ignore",
      timeout: 120_000,
    });
    pool = new pg.Pool({ connectionString: url, max: 10 });
    // One shopper places many unpaid orders here; the limit is a setting (083000).
    await pool.query(
      "update public.app_settings set value = '100' where key = 'max_unpaid_orders_per_account'",
    );
    await pool.query(
      "update public.app_settings set value = '1000' where key = 'max_held_units_per_account'",
    );
    await pool.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, '{"full_name": "Prueba Finanzas"}')`,
      [FINANCE],
    );
    await pool.query(
      "insert into public.staff_members (user_id, role) select id, 'finance' from auth.users where email = $1",
      [FINANCE],
    );
    const { rows } = await pool.query<{ email: string; id: string }>(
      "select email, id from auth.users where email like '%@yuntera.example'",
    );
    for (const row of rows) ids.set(row.email, row.id);
    // The worker says it is ready for the test environment; an administrator switches.
    await worker("worker_payments_hello", {
      p_provider: "onvo",
      p_environment: "test",
      p_account: "acct_contract",
      p_keys_ready: true,
      p_webhook_ready: true,
    });
    const settings = await api(ADMIN).opsSetPaymentsMode("test", "Pruebas de contrato de pagos");
    expect(settings.mode).toBe("test");
  }, 180_000);

  afterEach(async () => {
    for (const session of [...live]) {
      await pool.query("select pg_cancel_backend($1)", [session.pid]).catch(() => null);
      await end(session, "rollback").catch(() => null);
    }
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: withDatabase("postgres") });
    await admin.connect();
    await admin.query(`drop database if exists "${copyName.replaceAll('"', "")}" with (force)`);
    await admin.end();
  });

  it("answers the shopper's payment screens in the client's shape", async () => {
    const shopper = api(SHOPPER);
    const card = await place("card", "c-card");
    expect((await shopper.orderPayment(card.order_number)).stage).toBe("start");
    const started = await shopper.startPayment(card.order_id);
    expect(started.stage).toBe("preparing");
    await createDue();
    const ready = await shopper.orderPayment(card.order_number);
    expect(ready.stage).toBe("pay");
    expect(ready.attempt?.checkout_url).toMatch(/^https:\/\/checkout\.onvopay\.com\/pay\//);
    expect(ready.attempt?.intent_reference).toBeNull();
    expect((await shopper.paymentReturned(card.order_id)).stage).toBe("confirming");

    const sinpe = await place("sinpe_movil", "c-sinpe");
    const waiting = await shopper.startPayment(sinpe.order_id, {
      payer: { kind: "national", number: "1-1393-1919", phone: "8888-8888" },
    });
    expect(waiting.stage).toBe("preparing");
    await createDue();
    const transfer = await shopper.orderPayment(sinpe.order_number);
    expect(transfer.stage).toBe("transfer");
    expect(transfer.attempt?.sinpe_destination).toBe("+50670196686");

    // Staff helping the shopper see the gateway's references too.
    const seen = await api(ADMIN).orderPayment(card.order_number);
    expect(seen.attempt?.session_reference).toMatch(/^cs_/);
  });

  it("answers finance's screens in the client's shape", async () => {
    const order = await place("card", "c-finance");
    await api(SHOPPER).startPayment(order.order_id);
    await createDue();
    expect(
      await worker("worker_payments_event", { p_event: await succeeded(order.order_id, "fin") }),
    ).toBe("applied");
    await api(SHOPPER).cancelOrder(order.order_id);
    // A transfer nobody's payment matched, kept for finance.
    await worker("worker_payments_event", {
      p_event: {
        provider: "onvo",
        event_id: `transfer-${RUN}`,
        source: "webhook",
        environment: "test",
        type: "transfer.received",
        provider_type: "mobile_transfer.received",
        transfer: {
          reference: `ref-${RUN}`,
          payment_reference: null,
          amount_minor: 1500000,
          currency: "CRC",
        },
      },
    });

    const finance = api(FINANCE);
    const payments = await finance.opsPayments();
    const row = payments.find((p) => p.order_number === order.order_number);
    expect(row?.reported_fee_minor).toBe(1234);
    expect(row?.expected_fee_minor).toBeGreaterThan(0);
    const refunds = await finance.opsGatewayRefunds(false);
    expect(refunds.find((r) => r.order_number === order.order_number)?.status).toBe("requested");
    const reviews = await finance.opsPaymentReviews();
    const review = reviews.find((r) => r.kind === "unmatched_transfer");
    expect(review?.can_attach).toBe(true);
    const dismissed = await finance.opsResolvePaymentReview(
      review?.id ?? "",
      "dismiss",
      "Devuelto por el banco del cliente.",
    );
    expect(dismissed.status).toBe("dismissed");
    const day = await finance.opsPaymentReconciliation();
    expect(day.mode).toBe("test");
    expect(day.refunds_open.count).toBeGreaterThan(0);
    const settings = await finance.opsPaymentSettings();
    expect(settings.can_change).toBe(false);
    expect(settings.environments.find((e) => e.environment === "test")?.recent).toBe(true);
    const failedRefund = refunds.find((r) => r.order_number === order.order_number);
    await expect(finance.opsRetryGatewayRefund(failedRefund?.id ?? "")).rejects.toMatchObject({
      code: "gateway_refund_state",
    });
    await expect(api(SHOPPER).opsPaymentReviews()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the same event delivered twice at once is applied once: the second waits, then is a duplicate", async () => {
    const order = await place("card", "race-dup");
    await api(SHOPPER).startPayment(order.order_id);
    await createDue();
    const event = JSON.stringify(await succeeded(order.order_id, "dup"));

    const a = await open("worker");
    expect(await one(a, EVENT, [event])).toBe("applied");
    const b = await open("worker");
    const second = one(b, EVENT, [event]);
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await second).toBe("duplicate");
    await end(b, "commit");
    expect(
      await lookup<number>(
        "select count(*)::int as r from public.ledger_transactions where order_id = $1 and kind = 'order_capture'",
        [order.order_id],
      ),
    ).toBe(1);
  });

  it("two different events of one payment at once: the second waits for the order, then changes nothing", async () => {
    const order = await place("card", "race-two");
    await api(SHOPPER).startPayment(order.order_id);
    await createDue();
    const session = await succeeded(order.order_id, "two-session");
    const intent = {
      ...session,
      event_id: `two-intent-${RUN}`,
      provider_type: "payment_intent.succeeded",
    };

    const a = await open("worker");
    expect(await one(a, EVENT, [JSON.stringify(session)])).toBe("applied");
    const b = await open("worker");
    const second = one(b, EVENT, [JSON.stringify(intent)]);
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await second).toBe("duplicate");
    await end(b, "commit");
  });

  it("a payment confirmed while the shopper cancels: cancel first, the money is kept for finance", async () => {
    const order = await place("card", "race-cancel");
    await api(SHOPPER).startPayment(order.order_id);
    await createDue();
    const event = JSON.stringify(await succeeded(order.order_id, "cancel"));

    const a = await open(SHOPPER);
    await one(a, "select public.cancel_order($1) as r", [order.order_id]);
    const b = await open("worker");
    const second = one(b, EVENT, [event]);
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await second).toBe("late");
    await end(b, "commit");
    expect(
      await lookup<string>("select status::text as r from public.orders where id = $1", [
        order.order_id,
      ]),
    ).toBe("cancelled");
    expect(
      await lookup<number>(
        "select count(*)::int as r from private.payment_reviews where order_id = $1 and kind = 'late'",
        [order.order_id],
      ),
    ).toBe(1);
    // The shopper's cancelled order still says that the money arrived.
    const seen = await api(SHOPPER).orderPayment(order.order_number);
    expect(seen.stage).toBe("review");
    expect(seen.money_in_review).toMatchObject({ kind: "late", status: "open" });
  });

  it("the intent's event, before the session names it, and the session's at once: one capture, nothing kept", async () => {
    const order = await place("card", "race-intent");
    await api(SHOPPER).startPayment(order.order_id);
    // The gateway's session is known, its intent not yet.
    const [task] = (
      await worker<Array<Record<string, string>>>("worker_payments_claim", {
        p_worker: "contract",
        p_limit: 50,
        p_lease_seconds: 60,
      })
    ).filter((t) => t.kind === "create" && t.order_id === order.order_id);
    await worker("worker_payments_report", {
      p_worker: "contract",
      p_report: {
        kind: "created",
        attempt_id: task?.attempt_id,
        outcome: "created",
        session_reference: `cs_intent_${RUN}`,
        checkout_url: `https://checkout.onvopay.com/pay/cs_intent_${RUN}`,
        status: "open",
      },
    });
    const base = await succeeded(order.order_id, "intent-first");
    const intent = {
      ...base,
      provider_type: "payment_intent.succeeded",
      payment: {
        ...base.payment,
        reference: `pi_intent_${RUN}`,
        session_reference: null,
        metadata: { attemptId: task?.attempt_id, orderId: order.order_id },
      },
    };
    const session = {
      ...base,
      event_id: `intent-second-${RUN}`,
      payment: { ...base.payment, reference: `pi_intent_${RUN}` },
    };

    const a = await open("worker");
    expect(await one(a, EVENT, [JSON.stringify(intent)])).toBe("applied");
    const b = await open("worker");
    const second = one(b, EVENT, [JSON.stringify(session)]);
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await second).toBe("duplicate");
    await end(b, "commit");
    expect(
      await lookup<number>(
        "select count(*)::int as r from private.payment_reviews where payment_reference like $1",
        [`%intent%${RUN}`],
      ),
    ).toBe(0);
    expect(
      await lookup<string>(
        "select gateway_reference as r from public.payments where order_id = $1",
        [order.order_id],
      ),
    ).toBe(`pi_intent_${RUN}`);
  });

  it("a payment confirmed while the shopper cancels: payment first, the cancellation refunds it", async () => {
    const order = await place("card", "race-pay");
    await api(SHOPPER).startPayment(order.order_id);
    await createDue();
    const event = JSON.stringify(await succeeded(order.order_id, "pay-first"));

    const a = await open("worker");
    expect(await one(a, EVENT, [event])).toBe("applied");
    const b = await open(SHOPPER);
    const cancel = codeOf(one(b, "select public.cancel_order($1) as r", [order.order_id]));
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await cancel).toBeNull();
    await end(b, "commit");
    const refund = await lookup<{ status: string; channel: string }>(
      "select row_to_json(g) as r from private.gateway_refunds g where g.order_id = $1",
      [order.order_id],
    );
    expect(refund).toMatchObject({ status: "requested", channel: "gateway" });
    expect(
      await lookup<string>("select status::text as r from public.payments where order_id = $1", [
        order.order_id,
      ]),
    ).toBe("captured");
  });

  it("a payment confirmed while the order expires: it waits, then is kept for finance", async () => {
    const order = await place("sinpe_movil", "race-expire");
    await api(SHOPPER).startPayment(order.order_id, {
      payer: { kind: "national", number: "113931919", phone: "88888888" },
    });
    await createDue();
    await pool.query(
      "update public.orders set placed_at = now() - interval '45 minutes' where id = $1",
      [order.order_id],
    );
    const event = JSON.stringify(await succeeded(order.order_id, "expire"));

    const a = await pool.connect();
    await a.query("begin");
    await a.query("select private.expire_unpaid_orders()");
    const b = await open("worker");
    const second = one(b, EVENT, [event]);
    expect(await blocked(b.pid)).toBe(true);
    await a.query("commit");
    a.release();
    expect(await second).toBe("late");
    await end(b, "commit");
    expect(
      await lookup<number>(
        "select count(*)::int as r from public.ledger_transactions where order_id = $1",
        [order.order_id],
      ),
    ).toBe(0);
  });

  it("leaves every ledger transaction balanced", async () => {
    expect(
      await lookup<number>(
        `select count(*)::int as r from (select transaction_id from public.ledger_entries
         group by transaction_id having sum(amount_minor) <> 0) x`,
      ),
    ).toBe(0);
  });
});
