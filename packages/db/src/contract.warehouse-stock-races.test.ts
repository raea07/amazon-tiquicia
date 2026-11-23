/**
 * Moving stock at the same moment as the other stock writers, from two real
 * sessions (20261121084300_warehouse_stock.sql). The SQL suite runs in one
 * transaction and cannot show a race: here the first session holds its
 * transaction open, the second starts and (where they share a lock) waits
 * behind it, checked in pg_stat_activity, then the first ends. What is
 * checked is the outcome of each, that no lock error (deadlock 40P01,
 * serialisation 40001) reaches a caller, and that no unit is lost or made:
 * the units on the test shelves plus those picked into the parcel stay what
 * the counts made them, and the shop's on-hand total moves only by the
 * counts.
 *
 *   (i)   a move against a pick from the same shelf, in both orders;
 *   (ii)  a move against a count correction of the same shelf, in both
 *         orders (the count made from what the screen showed before the move
 *         is refused, `count_changed`);
 *   (iii) a move against packing the parcel, in both orders (they share no
 *         lock: neither waits);
 *   (iv)  a move against switching a location off, in both orders (the
 *         source emptied first: switched off; the target switched off
 *         first: the move is refused, `location_inactive`).
 *
 * The parcel is this file's own (a shopper it creates, an order it places
 * and pays). What these tests change they undo: the packing is rolled back,
 * the order is cancelled (its picked units go back to the shelf), the units
 * counted in leave the shop's total, and the test ledger rows, shelves and
 * locations are removed, so the suite passes on a used database and twice
 * in a row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const STAFF = "central@yuntera.example";
const WORKER = "bodega@yuntera.example";
const SHOPPER = "carrera-bodega@yuntera.example";
const CODES = ["Y-94-01-A", "Y-94-02-A", "Y-94-03-A", "Y-94-04-A"] as const;
const NOTE = "Conteo de la prueba de carrera de bodega";

type Session = { client: pg.PoolClient; pid: number };
type Step = { as: string; sql: string; args?: unknown[] };

describe.skipIf(!db.enabled)("moving stock at the same time (against a seeded database)", () => {
  let pool: pg.Pool;
  const ids = new Map<string, string>();
  const loc = new Map<string, string>();
  let warehouseId = "";
  let product = { sku_id: "", seller_id: "", sku_code: "" };
  let orderId = "";
  let shipmentId = "";
  let taskId = "";
  let baseOnHand = 0;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
    // A shopper of this file's own, with the demo shopper's address.
    await pool.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       select gen_random_uuid(), $1::text, '{"full_name": "Prueba Carrera Bodega"}'
        where not exists (select 1 from auth.users where email = $1::text)`,
      [SHOPPER],
    );
    await pool.query(
      `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
       select s.id, 'Casa', 'Prueba Carrera Bodega', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
         from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
        where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
          and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
      [SHOPPER],
    );
    await db.connect();
    await removeTestLocations();
    const { rows } = await db.query<{ email: string; id: string }>(
      "select email, id from auth.users where email = any($1)",
      [[STAFF, WORKER, SHOPPER]],
    );
    for (const row of rows) ids.set(row.email, row.id);
    expect(ids.size, "database is not seeded — run pnpm db:local:reset").toBe(3);
    warehouseId =
      (await db.query<{ id: string }>("select id from public.warehouses where code = 'SJO1'"))
        .rows[0]?.id ?? "";
    const found = await db.query<typeof product>(
      `select o.sku_id, o.seller_id, k.code as sku_code
         from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug = 'libreta-tapa-dura-a5' and o.fulfillment = 'platform' limit 1`,
    );
    expect(found.rows[0], "the seed has no notebook in the warehouse").toBeDefined();
    if (found.rows[0]) product = found.rows[0];
    baseOnHand = await onHand();

    const staff = db.as(STAFF, "aal2");
    for (const code of CODES) {
      loc.set(code, (await staff.opsCreateLocation(warehouseId, code, "storage")).id);
    }
    const worker = db.as(WORKER);
    const units = { skuId: product.sku_id, sellerId: product.seller_id, note: NOTE };
    await worker.wmsAdjustStock({ locationId: at("Y-94-01-A"), delta: 10, ...units });
    await worker.wmsAdjustStock({ locationId: at("Y-94-03-A"), delta: 5, ...units });

    // A paid order of three units; its pick task is pointed at the first
    // shelf (fixture: picking would choose the seed's own shelf), picking started.
    const shopper = db.as(SHOPPER);
    const address = (await shopper.myAddresses()).find((a) => a.is_default);
    const offer = (
      await db.query<{ id: string }>(
        "select id from public.offers where sku_id = $1 and seller_id = $2",
        [product.sku_id, product.seller_id],
      )
    ).rows[0]?.id;
    const placed = await shopper.placeOrder({
      items: [{ offerId: offer ?? "", quantity: 3 }],
      addressId: address?.id ?? "",
      paymentMethod: "sinpe_movil",
      idempotencyKey: `carrera-bodega-${Date.now()}`,
    });
    orderId = placed.order_id;
    await shopper.confirmSandboxPayment(orderId);
    const task = (
      await db.query<{ id: string; shipment_id: string }>(
        `select t.id, t.shipment_id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = $1`,
        [orderId],
      )
    ).rows[0];
    taskId = task?.id ?? "";
    shipmentId = task?.shipment_id ?? "";
    await db.query("update public.pick_tasks set location_id = $2 where id = $1", [
      taskId,
      at("Y-94-01-A"),
    ]);
    await worker.wmsStartPicking(shipmentId);
  });

  afterAll(async () => {
    if (orderId) {
      await db
        .query("select private.cancel_order_internal($1, 'Prueba de carrera de bodega')", [orderId])
        .catch(() => undefined);
    }
    await removeTestLocations();
    await pool?.end();
    await db.close();
  });

  const at = (code: (typeof CODES)[number]) => loc.get(code) ?? "";

  async function onHand() {
    const { rows } = await db.query<{ n: number }>(
      "select coalesce(sum(on_hand), 0)::integer as n from public.stock_levels where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
      [warehouseId, product.sku_id, product.seller_id],
    );
    return rows[0]?.n ?? 0;
  }

  /** Units on the test shelves, each, and those picked into the parcel. */
  async function shelves() {
    const { rows } = await db.query<{ code: string; quantity: number }>(
      `select l.code, coalesce(b.quantity, 0)::integer as quantity
         from public.warehouse_locations l
         left join public.bin_stock b on b.location_id = l.id and b.sku_id = $2 and b.seller_id = $3
        where l.warehouse_id = $1 and l.code = any($4)`,
      [warehouseId, product.sku_id, product.seller_id, [...CODES]],
    );
    const picked = (
      await db.query<{ n: number }>(
        "select picked_quantity as n from public.pick_tasks where id = $1",
        [taskId],
      )
    ).rows[0]?.n;
    const each = Object.fromEntries(rows.map((row) => [row.code, row.quantity]));
    const total = rows.reduce((sum, row) => sum + row.quantity, 0) + (picked ?? 0);
    return { each, picked: picked ?? 0, total };
  }

  /** The test locations, their shelves and their ledger rows, gone. */
  async function removeTestLocations() {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.warehouse_locations where code = any($1)",
      [[...CODES]],
    );
    const located = rows.map((row) => row.id);
    if (located.length === 0) return;
    const { rows: left } = await db.query<{
      warehouse_id: string;
      sku_id: string;
      seller_id: string;
      quantity: number;
    }>(
      `select l.warehouse_id, b.sku_id, b.seller_id, b.quantity
         from public.bin_stock b join public.warehouse_locations l on l.id = b.location_id
        where b.location_id = any($1) and b.quantity > 0`,
      [located],
    );
    for (const row of left) {
      await db.query(
        "update public.stock_levels set on_hand = on_hand - $4 where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
        [row.warehouse_id, row.sku_id, row.seller_id, row.quantity],
      );
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      // The ledger refuses deletes (stock_movements_immutable); the test's own rows only.
      await client.query("set local session_replication_role = replica");
      await client.query(
        "delete from public.stock_movements where to_location_id = any($1) or from_location_id = any($1)",
        [located],
      );
      await client.query("commit");
    } finally {
      client.release();
    }
    await db.query("update public.pick_tasks set location_id = null where location_id = any($1)", [
      located,
    ]);
    await db.query("delete from public.bin_stock where location_id = any($1)", [located]);
    await db.query("delete from public.warehouse_locations where id = any($1)", [located]);
  }

  /** A session acting as the given demo user, inside a transaction it keeps open. */
  async function session(email: string): Promise<Session> {
    const client = await pool.connect();
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids.get(email), role: "authenticated", aal: "aal2" }),
    ]);
    await client.query("set local role authenticated");
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    return { client, pid: rows[0]?.pid ?? 0 };
  }

  /** Waits (up to `ms`) until the session is waiting for a lock; says whether it did. */
  async function waitsForLock(pid: number, ms: number) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const { rows } = await db.query<{ waiting: boolean }>(
        "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
        [pid],
      );
      if (rows[0]?.waiting) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  /** The error code a call ended with, or "" when it was accepted. */
  const outcome = (query: Promise<unknown>) =>
    query.then(
      () => "",
      (error: Error & { code?: string }) =>
        error.code === "40P01" || error.code === "40001" ? `LOCK ${error.code}` : error.message,
    );

  /**
   * Runs `first` in one session and `second` in another: the second starts
   * while the first holds its transaction, (when they share a lock) waits
   * for it, and runs on after the first ends. The first commits unless
   * `keepFirst` is false; the second commits if it was accepted and
   * `keepSecond` is not false.
   */
  async function race(
    first: Step,
    second: Step,
    options: { keepFirst?: boolean; keepSecond?: boolean; waitMs?: number } = {},
  ) {
    const a = await session(first.as);
    const b = await session(second.as);
    try {
      const firstOutcome = await outcome(a.client.query(first.sql, first.args));
      if (firstOutcome) {
        await a.client.query("rollback");
        return { first: firstOutcome, second: "not run", waited: false };
      }
      const later = outcome(b.client.query(second.sql, second.args));
      const waited = await waitsForLock(b.pid, options.waitMs ?? 5000);
      await a.client.query(options.keepFirst === false ? "rollback" : "commit");
      const secondOutcome = await later;
      await b.client.query(secondOutcome || options.keepSecond === false ? "rollback" : "commit");
      return { first: firstOutcome, second: secondOutcome, waited };
    } finally {
      await a.client.query("rollback").catch(() => undefined);
      await b.client.query("rollback").catch(() => undefined);
      a.client.release();
      b.client.release();
    }
  }

  const move = (from: (typeof CODES)[number], to: (typeof CODES)[number], quantity: number) => ({
    as: WORKER,
    sql: "select public.wms_move_stock($1, $2, $3, $4, $5)",
    args: [at(from), at(to), product.sku_id, product.seller_id, quantity],
  });
  const pick = (quantity: number) => ({
    as: WORKER,
    sql: "select public.wms_confirm_pick($1, $2, null, $3)",
    args: [taskId, quantity, product.sku_code],
  });
  const count = (code: (typeof CODES)[number], delta: number, expected: number) => ({
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, $4, $5, $6)",
    args: [at(code), product.sku_id, product.seller_id, delta, NOTE, expected],
  });

  it("(i) a move and a pick from the same shelf, in both orders", async () => {
    expect((await shelves()).total).toBe(15);
    // The move first (2 of the 7 free): the pick waits for the shelf, then takes its unit.
    let result = await race(move("Y-94-01-A", "Y-94-02-A", 2), pick(1));
    expect(result).toEqual({ first: "", second: "", waited: true });
    let now = await shelves();
    expect(now.each).toMatchObject({ "Y-94-01-A": 7, "Y-94-02-A": 2 });
    expect(now).toMatchObject({ picked: 1, total: 15 });

    // The pick first (the other two units): the move waits, then sees them gone.
    result = await race(pick(3), move("Y-94-01-A", "Y-94-02-A", 2));
    expect(result).toEqual({ first: "", second: "", waited: true });
    now = await shelves();
    expect(now.each).toMatchObject({ "Y-94-01-A": 3, "Y-94-02-A": 4 });
    expect(now).toMatchObject({ picked: 3, total: 15 });
    expect(await onHand()).toBe(baseOnHand + 15);
  });

  it("(ii) a move and a count correction of the same shelf, in both orders", async () => {
    // The count first: the move waits for the warehouse, then moves from what is left.
    let result = await race(count("Y-94-01-A", -1, 3), move("Y-94-01-A", "Y-94-02-A", 1));
    expect(result).toEqual({ first: "", second: "", waited: true });
    let now = await shelves();
    expect(now.each).toMatchObject({ "Y-94-01-A": 1, "Y-94-02-A": 5 });
    expect(now.total).toBe(14);

    // The move first: the count made from the number before it is refused.
    result = await race(move("Y-94-01-A", "Y-94-02-A", 1), count("Y-94-01-A", -1, 1));
    expect(result).toEqual({ first: "", second: "count_changed", waited: true });
    now = await shelves();
    expect(now.each).toMatchObject({ "Y-94-01-A": 0, "Y-94-02-A": 6 });
    expect(now.total).toBe(14);
    expect(await onHand()).toBe(baseOnHand + 14);
  });

  it("(iii) a move and packing the parcel, in both orders, share no lock", async () => {
    const pack = {
      as: WORKER,
      sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
      args: [shipmentId],
    };
    // The packing is accepted each time and rolled back, so the order can be
    // cancelled at the end.
    let result = await race(move("Y-94-02-A", "Y-94-01-A", 2), pack, {
      keepSecond: false,
      waitMs: 500,
    });
    expect(result).toEqual({ first: "", second: "", waited: false });
    result = await race(pack, move("Y-94-01-A", "Y-94-02-A", 2), {
      keepFirst: false,
      waitMs: 500,
    });
    expect(result).toEqual({ first: "", second: "", waited: false });
    const now = await shelves();
    expect(now.each).toMatchObject({ "Y-94-01-A": 0, "Y-94-02-A": 6 });
    expect(now.total).toBe(14);
    expect(await onHand()).toBe(baseOnHand + 14);
  });

  it("(iv) a move and switching a location off, in both orders", async () => {
    const switchOff = (code: (typeof CODES)[number]) => ({
      as: STAFF,
      sql: "select public.ops_set_location_active($1, false)",
      args: [at(code)],
    });
    // The source emptied first: the switch-off waits for it, then finds it empty.
    let result = await race(move("Y-94-03-A", "Y-94-02-A", 5), switchOff("Y-94-03-A"));
    expect(result).toEqual({ first: "", second: "", waited: true });
    // The target switched off first: the move waits for it, then is refused.
    result = await race(switchOff("Y-94-04-A"), move("Y-94-02-A", "Y-94-04-A", 1));
    expect(result).toEqual({ first: "", second: "location_inactive", waited: true });
    const now = await shelves();
    expect(now.each).toMatchObject({ "Y-94-02-A": 11, "Y-94-03-A": 0, "Y-94-04-A": 0 });
    expect(now.total).toBe(14);
    const { rows } = await db.query<{ code: string; active: boolean }>(
      "select code, active from public.warehouse_locations where code = any($1) order by code",
      [["Y-94-03-A", "Y-94-04-A"]],
    );
    expect(rows).toEqual([
      { code: "Y-94-03-A", active: false },
      { code: "Y-94-04-A", active: false },
    ]);
    expect(await onHand()).toBe(baseOnHand + 14);
  });
});
