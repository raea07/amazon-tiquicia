/**
 * Contract tests for counting a product into a location that has no record
 * of it (areas/count-into-location.ts): the answers of the real database
 * functions match the schemas, for the right caller; the wrong caller and
 * every refusal arrive typed; and two saves of the same new product into the
 * same shelf at the same moment, from two real sessions, end with ONE count.
 * What each function refuses and leaves behind is proved in
 * supabase/tests/172_count_into_location.sql.
 *
 * What these tests change they undo: the units counted into the test
 * locations leave the shop's totals again, then the test ledger rows,
 * shelves and locations are removed, so the other contract suites see the
 * seeded data (and the warehouse's 19 locations), and the suite passes twice
 * in a row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";
import { messageFor } from "./errors";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const WORKER = "bodega@yuntera.example";
const STAFF = "central@yuntera.example";
const CODES = ["Y-71-01-A", "Y-71-02-A", "Y-71-03-A"] as const;
const NOTE = "Conteo de la prueba de contrato";

describe.skipIf(!db.enabled)("count into a location (against a seeded database)", () => {
  let pool: pg.Pool;
  const ids = new Map<string, string>();
  const loc = new Map<string, string>();
  let warehouseId = "";
  let notebook = { sku_id: "", seller_id: "", sku_code: "" };
  let earphones = { sku_id: "", sku_code: "", tecnocasa: "", sendero: "" };

  const at = (code: (typeof CODES)[number]) => loc.get(code) ?? "";

  /** The test locations, their shelves and their ledger rows, gone; the units leave the totals. */
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
    await db.query("delete from public.bin_stock where location_id = any($1)", [located]);
    await db.query("delete from public.warehouse_locations where id = any($1)", [located]);
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    await db.connect();
    await removeTestLocations();
    const { rows } = await db.query<{ email: string; id: string }>(
      "select email, id from auth.users where email = any($1)",
      [[STAFF, WORKER]],
    );
    for (const row of rows) ids.set(row.email, row.id);
    warehouseId =
      (await db.query<{ id: string }>("select id from public.warehouses where code = 'SJO1'"))
        .rows[0]?.id ?? "";
    const found = await db.query<typeof notebook>(
      `select o.sku_id, o.seller_id, k.code as sku_code
         from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug = 'libreta-tapa-dura-a5' and o.fulfillment = 'platform' limit 1`,
    );
    expect(found.rows[0], "the seed has no notebook in the warehouse").toBeDefined();
    if (found.rows[0]) notebook = found.rows[0];
    // Sold by TecnoCasa from the warehouse and by Tienda Sendero from its own site.
    const two = await db.query<typeof earphones>(
      `select k.id as sku_id, k.code as sku_code, t.seller_id as tecnocasa, s.seller_id as sendero
         from public.offers t join public.offers s on s.sku_id = t.sku_id and s.fulfillment = 'seller'
         join public.skus k on k.id = t.sku_id
        where t.fulfillment = 'platform' and s.seller_id = $1 limit 1`,
      [notebook.seller_id],
    );
    expect(two.rows[0], "the seed has no product sold by two shops").toBeDefined();
    if (two.rows[0]) earphones = two.rows[0];
    const staff = db.as(STAFF, "aal2");
    for (const code of CODES) {
      loc.set(code, (await staff.opsCreateLocation(warehouseId, code, "storage")).id);
    }
  });

  afterAll(async () => {
    await removeTestLocations();
    await pool?.end();
    await db.close();
  });

  const worker = () => db.as(WORKER);

  it("finds a product by code and by name, with its shops", async () => {
    const byCode = await worker().wmsCountCandidates(
      at("Y-71-01-A"),
      notebook.sku_code.toLowerCase(),
    );
    expect(byCode).toHaveLength(1);
    expect(byCode[0]).toMatchObject({
      sku_id: notebook.sku_id,
      sku_code: notebook.sku_code,
      shops: [{ seller_id: notebook.seller_id, stock_record: true, listed: false, on_shelf: 0 }],
    });
    const byName = await worker().wmsCountCandidates(at("Y-71-01-A"), "libreta");
    expect(byName.some((c) => c.sku_id === notebook.sku_id)).toBe(true);
    const shared = await worker().wmsCountCandidates(at("Y-71-01-A"), earphones.sku_code);
    expect(shared[0]?.shops.map((s) => [s.seller_id, s.stock_record])).toEqual([
      [earphones.tecnocasa, true],
      [earphones.sendero, false],
    ]);
    expect(await worker().wmsCountCandidates(at("Y-71-01-A"), "x")).toEqual([]);
    const text = JSON.stringify(byName);
    expect(text).not.toMatch(/senas|phone|recipient|email|full_name|on_hand/);
  });

  it("refuses the wrong caller and what may not be counted, typed", async () => {
    for (const email of [
      "comprador@yuntera.example",
      "vendedor@yuntera.example",
      "repartidor@yuntera.example",
    ]) {
      await expect(
        db.as(email).wmsCountCandidates(at("Y-71-01-A"), "libreta"),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        db.as(email).wmsCountIntoLocation({
          locationId: at("Y-71-01-A"),
          skuId: notebook.sku_id,
          sellerId: notebook.seller_id,
          quantity: 2,
          note: NOTE,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(db.as().wmsCountCandidates(at("Y-71-01-A"), "libreta")).rejects.toMatchObject({
      code: "not_authenticated",
    });
    // A shop that sells it with no stock record here: a receipt, not a count.
    const refused = await worker()
      .wmsCountIntoLocation({
        locationId: at("Y-71-01-A"),
        skuId: earphones.sku_id,
        sellerId: earphones.sendero,
        quantity: 2,
        note: NOTE,
      })
      .catch((error: Error & { code?: string }) => error);
    expect(refused).toMatchObject({ code: "count_no_stock_record" });
    expect(messageFor("count_no_stock_record")).toContain("recepción");
    // A location switched off.
    await db.as(STAFF, "aal2").opsSetLocationActive(at("Y-71-03-A"), false);
    await expect(
      worker().wmsCountIntoLocation({
        locationId: at("Y-71-03-A"),
        skuId: notebook.sku_id,
        sellerId: notebook.seller_id,
        quantity: 2,
        note: NOTE,
      }),
    ).rejects.toMatchObject({ code: "location_inactive" });
    await db.as(STAFF, "aal2").opsSetLocationActive(at("Y-71-03-A"), true);
  });

  it("counts two units in, then refuses the same save again", async () => {
    const input = {
      locationId: at("Y-71-01-A"),
      skuId: notebook.sku_id,
      sellerId: notebook.seller_id,
      quantity: 2,
      note: NOTE,
    };
    const counted = await worker().wmsCountIntoLocation(input);
    expect(counted).toEqual({
      location_id: at("Y-71-01-A"),
      location_code: "Y-71-01-A",
      sku_id: notebook.sku_id,
      sku_code: notebook.sku_code,
      seller_id: notebook.seller_id,
      quantity: 2,
      on_shelf: 2,
    });
    const here = await worker().wmsLocationStock(warehouseId, "Y-71-01-A");
    expect(here?.items.map((item) => [item.sku_id, item.on_shelf])).toEqual([[notebook.sku_id, 2]]);
    const again = await worker()
      .wmsCountIntoLocation(input)
      .catch((error: Error & { code?: string; detail?: string }) => error);
    expect(again).toMatchObject({ code: "count_already_listed" });
    expect(messageFor("count_already_listed")).toContain("propia línea");
    const shelf = await worker().wmsLocationStock(warehouseId, "Y-71-01-A");
    expect(shelf?.items[0]?.on_shelf).toBe(2);
  });

  it("two saves at the same moment end with one count, not the sum", async () => {
    const session = async () => {
      const client = await pool.connect();
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ids.get(WORKER), role: "authenticated", aal: "aal2" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      return { client, pid: rows[0]?.pid ?? 0 };
    };
    const save = (quantity: number) => ({
      sql: "select public.wms_count_into_location($1, $2, $3, $4, $5)",
      args: [at("Y-71-02-A"), notebook.sku_id, notebook.seller_id, quantity, NOTE],
    });
    const before = (
      await db.query<{ n: number }>(
        "select on_hand as n from public.stock_levels where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
        [warehouseId, notebook.sku_id, notebook.seller_id],
      )
    ).rows[0]?.n;
    const a = await session();
    const b = await session();
    try {
      await a.client.query(save(2).sql, save(2).args);
      const later = b.client.query(save(3).sql, save(3).args).then(
        () => "",
        (error: Error & { code?: string }) =>
          error.code === "40P01" || error.code === "40001" ? `LOCK ${error.code}` : error.message,
      );
      // The second waits for the first (the warehouse row, then the shop's stock row).
      let waited = false;
      for (let i = 0; i < 200 && !waited; i++) {
        const { rows } = await db.query<{ waiting: boolean }>(
          "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
          [b.pid],
        );
        waited = Boolean(rows[0]?.waiting);
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waited).toBe(true);
      await a.client.query("commit");
      const second = await later;
      await b.client.query("rollback");
      expect(second).toBe("count_already_listed");
    } finally {
      await a.client.query("rollback").catch(() => undefined);
      await b.client.query("rollback").catch(() => undefined);
      a.client.release();
      b.client.release();
    }
    const shelf = await worker().wmsLocationStock(warehouseId, "Y-71-02-A");
    expect(shelf?.items.map((item) => item.on_shelf)).toEqual([2]);
    const after = (
      await db.query<{ n: number }>(
        "select on_hand as n from public.stock_levels where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
        [warehouseId, notebook.sku_id, notebook.seller_id],
      )
    ).rows[0]?.n;
    expect(after).toBe((before ?? 0) + 2);
  });
});
