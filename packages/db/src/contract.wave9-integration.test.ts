/**
 * Old callers against the merged database of wave 9 (084700, 084800, 085000),
 * each with its OWN code: the client of that commit is taken from git into
 * packages/db/build/ (ignored by git) and called as it is, schemas and all.
 *
 *   - The shopper app's store build (3f251c3, on testers' phones). Of the 29
 *     functions it calls, these answer differently or run new code since
 *     this wave: request_return and withdraw_return_request (the return's
 *     case follows by trigger, 084700), checkout_quote (private.price_items,
 *     085000), get_order (redefined in 085000, a new optional field),
 *     cart_lines and cancel_order (085000; their store-build answers are
 *     checked in contract.frozen-callers and contract.wave8-followups).
 *   - The web apps of 12ec48c (on the hosted preview until the next deploy,
 *     which comes after the migrations): the cart with an id-only line, an
 *     order cancelled for the new reason, a complaint filed from the shop and
 *     answered from the old Atención (the case follows by trigger).
 *
 * What it leaves: one return request (withdrawn) and one complaint
 * (answered), with their cases, of comprador2; one cancelled order of its own
 * shopper. Without git or that commit, the suite says so and skips.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { callRpc } from "@yuntera/dev-api/rpc";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const SHOPPER = "comprador2@yuntera.example";
const STAFF = "central@yuntera.example";
const ROOT = join(__dirname, "../../..");

type OldApi = Record<string, (...args: never[]) => Promise<unknown>>;

/** The packages/db/src of a commit, unpacked once into packages/db/build. */
function oldSource(commit: string): string | null {
  const dir = join(__dirname, "../build", `frozen-${commit}`);
  if (existsSync(join(dir, "packages/db/src/api.ts"))) return dir;
  try {
    mkdirSync(dir, { recursive: true });
    const archive = join(dir, "src.tar");
    execFileSync("git", ["-C", ROOT, "archive", "-o", archive, commit, "packages/db/src"], {
      stdio: "ignore",
    });
    execFileSync("tar", ["-xf", archive, "-C", dir], { stdio: "ignore" });
    // Only the client is needed: the old tests must not be found and run.
    for (const name of readdirSync(join(dir, "packages/db/src"), { recursive: true })) {
      if (String(name).endsWith(".test.ts")) rmSync(join(dir, "packages/db/src", String(name)));
    }
    return dir;
  } catch {
    return null;
  }
}

async function oldApi(commit: string, email: string, ids: Map<string, string>, pool: unknown) {
  const dir = oldSource(commit);
  if (!dir) return null;
  const mod = (await import(join(dir, "packages/db/src/api.ts"))) as {
    createApi: (t: unknown) => OldApi;
  };
  return mod.createApi({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      const result = await callRpc(pool as never, fn, args, {
        sub: ids.get(email) ?? "",
        role: "authenticated",
        aal: "aal2",
      });
      return result.ok
        ? { data: result.data, error: null, status: 200 }
        : { data: null, error: result.error, status: result.status };
    },
  });
}

describe.skipIf(!db.enabled)("old callers against wave 9 (against a seeded database)", () => {
  const ids = new Map<string, string>();
  let pool: unknown;
  let returnId = "";
  let complaintId = "";

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query<{ email: string; id: string }>(
      "select email, id from auth.users where email = any($1)",
      [[SHOPPER, STAFF]],
    );
    for (const row of rows) ids.set(row.email, row.id);
    const pg = await import("pg");
    pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await (pool as { end: () => Promise<void> } | undefined)?.end();
    await db.close();
  });

  it("the store build (3f251c3): a return, its withdrawal, the quote and the order page", async () => {
    const app = await oldApi("3f251c3", SHOPPER, ids, pool);
    if (!app) return void console.warn("git cannot show 3f251c3: skipped");
    const { rows } = await db.query<{ order_number: string; item_id: string; postal: string }>(
      `select o.order_number, i.id as item_id, o.ship_postal_code as postal
         from public.orders o
         join auth.users u on u.id = o.user_id
         join public.order_items i on i.order_id = o.id
        where u.email = $1 and o.status = 'delivered' and o.warranty_until >= current_date
          and not exists (select 1 from public.return_requests r where r.order_item_id = i.id)
        order by o.placed_at, i.id limit 1`,
      [SHOPPER],
    );
    const line = rows[0];
    expect(line, "a delivered line of comprador2 without a return").toBeDefined();
    if (!line) return;

    returnId = (await app.requestReturn?.({
      orderItemId: line.item_id,
      kind: "damaged",
      quantity: 1,
      reason: "Llegó con la esquina rota.",
    } as never)) as string;
    expect(returnId).toMatch(/^[0-9a-f-]{36}$/);
    const opened = await db.query<{ status: string }>(
      "select status from private.cases where return_id = $1",
      [returnId],
    );
    expect(opened.rows[0]?.status, "the trigger opened the return's case").toBe("open");

    const returns = (await app.myOrderReturns?.(line.order_number as never)) as Array<{
      id: string;
    }>;
    expect(returns.some((r) => r.id === returnId)).toBe(true);
    await app.withdrawReturnRequest?.(returnId as never);
    const closed = await db.query<{ status: string }>(
      "select status from private.cases where return_id = $1",
      [returnId],
    );
    expect(closed.rows[0]?.status, "the withdrawal closed the case").toBe("closed");

    const offer = await db.query<{ id: string }>(
      `select o.id from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug = 'libreta-tapa-dura-a5' and o.fulfillment = 'platform' and o.status = 'active'`,
    );
    const quote = (await app.checkoutQuote?.(
      [{ offerId: offer.rows[0]?.id ?? "", quantity: 1 }] as never,
      line.postal as never,
    )) as { issue: string | null; total_minor?: number };
    expect(quote.issue).toBeNull();
    expect(quote.total_minor).toBeGreaterThan(0);

    const order = (await app.getOrder?.(line.order_number as never)) as { order_number: string };
    expect(order.order_number).toBe(line.order_number);
  });

  it("the web apps of 12ec48c: an id-only cart line, the new reason, a complaint answered in Atención", async () => {
    const shop = await oldApi("12ec48c", SHOPPER, ids, pool);
    const staff = await oldApi("12ec48c", STAFF, ids, pool);
    if (!shop || !staff) return void console.warn("git cannot show 12ec48c: skipped");

    // A line of an offer the caller may not see answers its id alone (085000).
    const unknown = "e9000000-0000-4000-8000-000000000196";
    const lines = (await shop.cartLines?.([unknown] as never)) as Array<{
      offer_id: string;
      buyable: boolean;
      title: string | null;
    }>;
    expect(lines).toEqual([
      expect.objectContaining({ offer_id: unknown, buyable: false, title: null }),
    ]);

    // An order placed by the old shop, cancelled for the reason 085000 adds
    // (written as the check-in writes it: the order's status and reason).
    const offer = await db.query<{ id: string }>(
      `select o.id from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug = 'libreta-tapa-dura-a5' and o.fulfillment = 'platform' and o.status = 'active'`,
    );
    const address = await db.query<{ id: string }>(
      `select a.id from public.addresses a join auth.users u on u.id = a.user_id
        where u.email = $1 and a.is_default and a.deleted_at is null`,
      [SHOPPER],
    );
    const placed = (await shop.placeOrder?.({
      items: [{ offerId: offer.rows[0]?.id ?? "", quantity: 1 }],
      addressId: address.rows[0]?.id ?? "",
      paymentMethod: "sinpe_movil",
      idempotencyKey: `contrato-196-${Date.now()}`,
    } as never)) as { order_id: string; order_number: string };
    await db.query(
      "select private.cancel_order_internal($1, 'Los paquetes no salieron de la bodega')",
      [placed.order_id],
    );
    const order = (await shop.getOrder?.(placed.order_number as never)) as {
      status: string;
      cancel_reason: string | null;
    };
    expect(order.status).toBe("cancelled");
    expect(order.cancel_reason).toBe("Los paquetes no salieron de la bodega");
    const list = (await shop.myOrders?.()) as Array<{ order_number: string }>;
    expect(list.some((o) => o.order_number === placed.order_number)).toBe(true);

    // A complaint from the old shop, answered from the old Atención.
    complaintId = (await shop.fileComplaint?.({
      category: "other",
      description: "Prueba 196 de contrato: quiero cambiar la dirección de mi cuenta.",
      orderNumber: null,
    } as never)) as string;
    const queues = (await staff.opsCareQueues?.()) as { complaints: Array<{ id: string }> };
    expect(queues.complaints.some((c) => c.id === complaintId)).toBe(true);
    await staff.opsResolveComplaint?.(
      complaintId as never,
      "Le cambiamos la dirección de su cuenta. Gracias por avisarnos." as never,
      true as never,
    );
    const kase = await db.query<{ status: string; answers: string }>(
      `select k.status, (select count(*) from private.case_entries e where e.case_id = k.id and e.kind = 'answer')::text as answers
         from private.cases k where k.complaint_id = $1`,
      [complaintId],
    );
    expect(kase.rows[0]).toEqual({ status: "closed", answers: "1" });
  });
});
