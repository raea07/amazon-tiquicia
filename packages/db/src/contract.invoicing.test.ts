/**
 * Electronic invoices: the real functions' answers match the client's schemas
 * for each role, and the consecutive number stays gap-free with two planners
 * at once (two real sessions, the second waiting on the first's lock, the
 * pattern of contract.integrity.test.ts).
 *
 * Planning and the worker's steps commit, so this file builds its own copy
 * of the database next to the one in DATABASE_URL (same migrations, same
 * seed, built by supabase/scripts/local-db.sh) and drops it at the end. Its
 * name is the shared database's name plus `_invoicing`, or
 * INVOICING_DB_NAME when set. The worker is played with the service role's
 * claims, as the Data API gives them to the worker's secret key.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { type Claims, callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Api, createApi } from "./api";
import { ApiError } from "./errors";

const shared = process.env.DATABASE_URL;
const copyName =
  process.env.INVOICING_DB_NAME ?? `${shared ? new URL(shared).pathname.slice(1) : ""}_invoicing`;
const withDatabase = (name: string) => {
  const target = new URL(shared ?? "postgres://localhost/postgres");
  target.pathname = `/${name}`;
  return target.toString();
};
const localDb = fileURLToPath(new URL("../../../supabase/scripts/local-db.sh", import.meta.url));
const RUN = Date.now().toString(36);
const WORKER: Claims = { sub: "", role: "service_role" };

let pool: pg.Pool;
const ids = new Map<string, string>();

const lookup = async <T = unknown>(sql: string, params: unknown[] = []) =>
  (await pool.query<{ r: T }>(sql, params)).rows[0]?.r as T;

/** The API as a demo user (or a visitor when omitted), over the copy. */
function as(email?: string): Api {
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

async function worker<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const result = await callRpc(pool, fn, args, WORKER);
  if (!result.ok) throw new Error(`${fn}: ${JSON.stringify(result.error)}`);
  return result.data as T;
}

const codeOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) => (error instanceof ApiError ? error.code : String(error)),
  );

interface Session {
  client: pg.PoolClient;
  pid: number;
}
const live = new Set<Session>();

/** A session with an open transaction, acting as the invoice worker. */
async function openWorker(): Promise<Session> {
  const client = await pool.connect();
  const pid =
    (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid ?? 0;
  await client.query("begin");
  await client.query(
    "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true), set_config('role', 'service_role', true)",
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

/** A fresh shopper with the demo shopper's address. */
async function shopper(tag: string) {
  const email = `factura-${tag}-${RUN}@yuntera.example`;
  const id = await lookup<string>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"full_name": "Prueba Factura"}') returning id as r`,
    [email],
  );
  await pool.query(
    `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
     select $1, 'Casa', 'Prueba Factura', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
     from public.addresses a join auth.users u on u.id = a.user_id
     where u.email = 'comprador@yuntera.example' and a.is_default`,
    [id],
  );
  ids.set(email, id);
  return email;
}

/** Places and pays an order for one unit of the product, as the shopper. */
async function paidOrder(email: string, slug: string, key: string) {
  const offer = await lookup<string>(
    `select o.id as r from public.offers o join public.skus k on k.id = o.sku_id
     join public.products p on p.id = k.product_id where p.slug = $1
     order by (o.fulfillment = 'platform') desc, o.price_minor desc, o.id limit 1`,
    [slug],
  );
  const api = as(email);
  const address = (await api.myAddresses()).find((a) => a.is_default);
  const order = await api.placeOrder({
    items: [{ offerId: offer, quantity: 1 }],
    addressId: address?.id ?? "",
    paymentMethod: "sinpe_movil",
    idempotencyKey: key,
  });
  await api.confirmSandboxPayment(order.order_id);
  return order;
}

/** Plays the worker for one document: sign (a stand-in XML), received, then Hacienda's answer. */
async function answer(invoiceId: string, state: "aceptado" | "rechazado", detail: string) {
  // Only this document is due, so the claims below hand out exactly it.
  await pool.query(
    "update public.electronic_invoices set next_attempt_at = now() + interval '1 day' where id <> $1 and status in ('pending', 'sent')",
    [invoiceId],
  );
  await pool.query("update public.electronic_invoices set next_attempt_at = now() where id = $1", [
    invoiceId,
  ]);
  const claimed = await worker<Array<{ id: string; document: { clave: string } }>>(
    "worker_invoice_claim",
    {
      p_worker: "contract",
      p_limit: 50,
      p_lease_seconds: 60,
    },
  );
  const doc = claimed.find((c) => c.id === invoiceId);
  if (!doc) throw new Error("document not claimed");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Documento><Clave>${doc.document.clave}</Clave>${"<x>firmado</x>".repeat(20)}</Documento>`;
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  await worker("worker_invoice_signed", {
    p_id: invoiceId,
    p_worker: "contract",
    p_xml: xml,
    p_sha256: sha(xml),
  });
  await worker("worker_invoice_record", {
    p_id: invoiceId,
    p_worker: "contract",
    p_outcome: { event: "received", http_status: 201 },
  });
  // Others claimed alongside are let go as they were.
  await pool.query(
    "update public.electronic_invoices set locked_by = null, locked_until = null where locked_by = 'contract' and id <> $1",
    [invoiceId],
  );
  await pool.query("update public.electronic_invoices set next_attempt_at = now() where id = $1", [
    invoiceId,
  ]);
  await worker("worker_invoice_claim", { p_worker: "contract", p_limit: 50, p_lease_seconds: 60 });
  const response = `<MensajeHacienda><Clave>${doc.document.clave}</Clave><Mensaje>${state === "aceptado" ? 1 : 3}</Mensaje><DetalleMensaje>${detail}</DetalleMensaje></MensajeHacienda>`;
  await worker("worker_invoice_record", {
    p_id: invoiceId,
    p_worker: "contract",
    p_outcome: {
      event: "answer",
      state,
      response_xml: response,
      response_sha256: sha(response),
      message: state === "aceptado" ? "1" : "3",
      detail,
    },
  });
  await pool.query(
    "update public.electronic_invoices set locked_by = null, locked_until = null where locked_by = 'contract'",
  );
}

/** Per counter: numbers 1..n with no gap and no repeat, and the counter at n. */
async function numbersAreContiguous() {
  const { rows } = await pool.query<{ ok: boolean; document_type: string }>(
    `select e.document_type,
            (count(*) = max(e.sequence_number) and count(distinct e.sequence_number) = count(*)
             and max(e.sequence_number) = max(f.last_number)) as ok
     from public.electronic_invoices e
     join private.fiscal_counters f on f.document_type = e.document_type
     group by e.document_type`,
  );
  return rows;
}

describe.skipIf(!shared)("invoicing contract and concurrency", () => {
  let buyer = "";
  let order = { order_id: "", order_number: "" };

  beforeAll(async () => {
    execFileSync("bash", [localDb, "reset"], {
      env: { ...process.env, PG_ADMIN_URL: withDatabase("postgres"), PG_DB_NAME: copyName },
      stdio: "ignore",
      timeout: 180_000,
    });
    pool = new pg.Pool({ connectionString: withDatabase(copyName), max: 8 });
    const { rows } = await pool.query<{ email: string; id: string }>(
      "select email, id from auth.users where email like '%@yuntera.example'",
    );
    for (const row of rows) ids.set(row.email, row.id);
    if (!ids.has("central@yuntera.example"))
      throw new Error("the copy of the database was not seeded");
    // The seed's backlog first, so the tests below work on their own events.
    await worker("worker_invoice_plan", { p_limit: 1000 });
    buyer = await shopper("buyer");
  }, 240_000);

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

  it("asks for a factura at checkout and refuses what is not an identification", async () => {
    const api = as(buyer);
    const key = `contract-factura-${RUN}`;
    expect(
      await codeOf(
        api.setCheckoutInvoiceReceiver(key, {
          idType: "juridica",
          idNumber: "1234",
          name: "Empresa",
        }),
      ),
    ).toBe("invoice_receiver_id_invalid");
    expect(
      await api.setCheckoutInvoiceReceiver(key, {
        idType: "juridica",
        idNumber: "3-101-654321",
        name: "Empresa de Prueba S.A.",
        email: "facturas@example.com",
      }),
    ).toEqual({ requested: true });
    order = await paidOrder(buyer, "libreta-tapa-dura-a5", key);
    expect(await worker<number>("worker_invoice_plan", { p_limit: 100 })).toBe(1);
    expect(await codeOf(as().myOrderInvoices(order.order_number))).not.toBeNull();
  });

  it("returns the shopper's documents, whole, with their files once answered", async () => {
    const api = as(buyer);
    const [doc] = await api.myOrderInvoices(order.order_number);
    expect(doc).toMatchObject({
      kind: "delivery",
      document_type: "01",
      status: "pending",
      has_xml: false,
    });
    expect(await codeOf(api.invoiceFile(doc?.id ?? "", "xml"))).toBe("invoice_file_not_ready");

    await answer(doc?.id ?? "", "aceptado", "Aceptado");
    const detail = await api.invoiceDetail(doc?.id ?? "");
    expect(detail.status).toBe("accepted");
    expect(detail.receiver).toMatchObject({
      id_type: "02",
      id_number: "3101654321",
      name: "Empresa de Prueba S.A.",
    });
    expect(detail.summary.total).toMatch(/^\d+\.\d{5}$/);
    expect(detail.lines[0]?.unit).toBe("Os");
    const xml = await api.invoiceFile(doc?.id ?? "", "xml");
    expect(xml.file_name).toBe(`${detail.clave}.xml`);
    const response = await api.invoiceFile(doc?.id ?? "", "response");
    expect(response.file_name).toBe(`${detail.clave}_respuesta.xml`);

    expect(await codeOf(as("comprador2@yuntera.example").invoiceDetail(doc?.id ?? ""))).toBe(
      "invoice_not_found",
    );
    expect(await codeOf(as("comprador2@yuntera.example").myOrderInvoices(order.order_number))).toBe(
      "order_not_found",
    );
  });

  it("returns a shop's fee invoices to its team and to finance only", async () => {
    const sendero = await lookup<string>(
      "select id as r from public.sellers where slug = 'tienda-sendero'",
    );
    const list = await as("sendero@yuntera.example").sellerFeeInvoices(sendero, 20);
    const fee = list.find((row) => row.order_number === order.order_number);
    expect(fee).toMatchObject({ kind: "fees", document_type: "01", seller_name: "Tienda Sendero" });
    const detail = await as("sendero@yuntera.example").invoiceDetail(fee?.id ?? "");
    expect(detail.payments[0]).toMatchObject({ code: "99" });
    expect(await codeOf(as("cafetal@yuntera.example").sellerFeeInvoices(sendero, 20))).toBe(
      "forbidden",
    );
    expect(await codeOf(as(buyer).invoiceDetail(fee?.id ?? ""))).toBe("invoice_not_found");
    expect(
      (await as("central@yuntera.example").sellerFeeInvoices(sendero, 20)).length,
    ).toBeGreaterThan(0);
  });

  it("shows finance the rejected document with Hacienda's reason, replaces it once, and retries a held one", async () => {
    const staff = as("central@yuntera.example");
    const sendero = await lookup<string>(
      "select id as r from public.sellers where slug = 'tienda-sendero'",
    );
    const fee = (await staff.sellerFeeInvoices(sendero, 20)).find(
      (row) => row.order_number === order.order_number,
    );
    await answer(fee?.id ?? "", "rechazado", "Receptor no inscrito en el registro tributario");

    const screen = await staff.opsInvoices(null, 20);
    const rejected = screen.rejected.find((row) => row.id === fee?.id);
    expect(rejected?.hacienda_message).toBe("Receptor no inscrito en el registro tributario");
    expect(screen.counts.accepted).toBeGreaterThanOrEqual(1);
    expect(screen.daily).toHaveLength(14);
    expect(screen.issuer_ready).toBe(true);

    const replacement = await staff.opsReplaceInvoice(fee?.id ?? "");
    expect(replacement.consecutivo).not.toBe(fee?.consecutivo);
    expect(replacement.replaces_id).toBe(fee?.id);
    expect(replacement.references_clave).toBe(fee?.clave);
    expect(replacement.reference_code).toBe("16");
    expect(await codeOf(staff.opsReplaceInvoice(fee?.id ?? ""))).toBe("invoice_already_replaced");
    expect(await codeOf(as("sendero@yuntera.example").opsReplaceInvoice(replacement.id))).toBe(
      "forbidden",
    );

    await pool.query(
      "update public.electronic_invoices set held_reason = 'summary_total' where id = $1",
      [replacement.id],
    );
    const retried = await staff.opsRetryInvoice(replacement.id);
    expect(retried.status).toBe("pending");
    expect(await codeOf(staff.opsRetryInvoice(replacement.id))).toBe("invoice_not_retryable");
  });

  describe("two planners at once", () => {
    it("the second waits for the first's number, then takes the next one: no gap, no repeat", async () => {
      const a1 = await paidOrder(await shopper("race-a"), "libreta-tapa-dura-a5", `race-a-${RUN}`);
      const b1 = await paidOrder(await shopper("race-b"), "libreta-tapa-dura-a5", `race-b-${RUN}`);

      const a = await openWorker();
      await a.client.query("select public.worker_invoice_plan(1)");
      const b = await openWorker();
      const second = b.client.query("select public.worker_invoice_plan(1) as n");
      expect(await blocked(b.pid)).toBe(true);
      await end(a, "commit");
      expect((await second).rows[0]?.n).toBe(1);
      await end(b, "commit");

      const numbers = await pool.query<{
        order_id: string;
        sequence_number: string;
        document_type: string;
      }>(
        `select order_id, sequence_number::text, document_type from public.electronic_invoices
         where order_id in ($1, $2) order by document_type, sequence_number`,
        [a1.order_id, b1.order_id],
      );
      const facturas = numbers.rows
        .filter((r) => r.document_type === "01")
        .map((r) => Number(r.sequence_number));
      expect(new Set(facturas).size).toBe(facturas.length);
      for (const row of await numbersAreContiguous()) expect(row).toMatchObject({ ok: true });
    });

    it("when the first rolls back, the second takes its number, and nothing is skipped", async () => {
      const a1 = await paidOrder(await shopper("race-c"), "libreta-tapa-dura-a5", `race-c-${RUN}`);
      await paidOrder(await shopper("race-d"), "libreta-tapa-dura-a5", `race-d-${RUN}`);
      const before = await lookup<string>(
        "select last_number::text as r from private.fiscal_counters where document_type = '01'",
      );

      const a = await openWorker();
      await a.client.query("select public.worker_invoice_plan(1)");
      const b = await openWorker();
      const second = b.client.query("select public.worker_invoice_plan(1) as n");
      expect(await blocked(b.pid)).toBe(true);
      await end(a, "rollback");
      expect((await second).rows[0]?.n).toBe(1);
      await end(b, "commit");
      expect(
        await lookup<string>(
          "select last_number::text as r from private.fiscal_counters where document_type = '01'",
        ),
      ).toBe(String(Number(before) + 1));

      // The rolled-back job is planned again, with the next number.
      expect(await worker<number>("worker_invoice_plan", { p_limit: 10 })).toBe(1);
      expect(
        await lookup<number>(
          "select count(*)::int as r from public.electronic_invoices where order_id = $1",
          [a1.order_id],
        ),
      ).toBeGreaterThan(0);
      for (const row of await numbersAreContiguous()) expect(row).toMatchObject({ ok: true });
    });
  });
});
