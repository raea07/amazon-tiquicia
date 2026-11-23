/**
 * Contract tests for warehouse stock (areas/warehouse-stock.ts): the answers
 * of the real database functions match the schemas, for the right caller,
 * and the wrong caller gets a typed refusal. What each function refuses, and
 * what it leaves behind, is proved in supabase/tests/168_warehouse_stock.sql;
 * the races in contract.warehouse-stock-races.test.ts.
 *
 * What these tests change they undo: the units counted into the two test
 * locations are counted out again through the same function, then the test
 * ledger rows, shelves and locations are removed, so the other contract
 * suites see the seeded data (and the warehouse's 19 locations).
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();
const WORKER = "bodega@yuntera.example";
const STAFF = "central@yuntera.example";
const CODES = ["Y-95-01-A", "Y-95-02-A"];
const NOTE = "Conteo de la prueba de contrato";

/** The test locations' ledger rows, shelves and the locations themselves, gone. */
async function removeTestLocations() {
  const { rows } = await db.query<{ id: string }>(
    "select id from public.warehouse_locations where code = any($1)",
    [CODES],
  );
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  // Units still there leave the shop's totals the way they came in.
  const { rows: left } = await db.query<{
    warehouse_id: string;
    sku_id: string;
    seller_id: string;
    quantity: number;
  }>(
    `select l.warehouse_id, b.sku_id, b.seller_id, b.quantity
       from public.bin_stock b join public.warehouse_locations l on l.id = b.location_id
      where b.location_id = any($1) and b.quantity > 0`,
    [ids],
  );
  for (const row of left) {
    await db.query(
      "update public.stock_levels set on_hand = on_hand - $4 where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
      [row.warehouse_id, row.sku_id, row.seller_id, row.quantity],
    );
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    // The ledger refuses deletes (stock_movements_immutable); the test's own rows only.
    await client.query("set local session_replication_role = replica");
    await client.query(
      "delete from public.stock_movements where to_location_id = any($1) or from_location_id = any($1)",
      [ids],
    );
    await client.query("commit");
  } finally {
    await client.end();
  }
  await db.query("delete from public.bin_stock where location_id = any($1)", [ids]);
  await db.query("delete from public.warehouse_locations where id = any($1)", [ids]);
}

describe.skipIf(!db.enabled)("warehouse stock contract (against a seeded database)", () => {
  let warehouseId = "";
  let stock = { sku_id: "", seller_id: "", sku_code: "", location_code: "" };

  beforeAll(async () => {
    await db.connect();
    await removeTestLocations();
    warehouseId =
      (await db.query<{ id: string }>("select id from public.warehouses where code = 'SJO1'"))
        .rows[0]?.id ?? "";
    const { rows } = await db.query<typeof stock>(
      `select b.sku_id, b.seller_id, k.code as sku_code, l.code as location_code
         from public.bin_stock b
         join public.warehouse_locations l on l.id = b.location_id and l.kind = 'pick'
         join public.skus k on k.id = b.sku_id
        where l.warehouse_id = $1 and b.quantity > 5
        order by l.code, k.code limit 1`,
      [warehouseId],
    );
    expect(rows[0], "the seed has no stock in the platform warehouse").toBeDefined();
    if (rows[0]) stock = rows[0];
  });

  afterAll(async () => {
    await removeTestLocations();
    await db.close();
  });

  const worker = () => db.as(WORKER);
  const staff = () => db.as(STAFF, "aal2");

  it("refuses shoppers, sellers, drivers and visitors", async () => {
    for (const email of [
      "comprador@yuntera.example",
      "vendedor@yuntera.example",
      "repartidor@yuntera.example",
    ]) {
      await expect(db.as(email).wmsStockLocations(warehouseId)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(db.as(email).wmsLocationStock(warehouseId, "A-01-01-A")).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(db.as(email).opsStockChanges()).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(db.as().wmsStockLocations(warehouseId)).rejects.toMatchObject({
      code: "not_authenticated",
    });
  });

  it("lists the locations and opens one by its code", async () => {
    const locations = await worker().wmsStockLocations(warehouseId);
    expect(locations.length).toBeGreaterThanOrEqual(19);
    const shelf = locations.find((location) => location.code === stock.location_code);
    expect(shelf).toMatchObject({ active: true, shelf: true, kind: "pick" });
    expect(shelf?.units).toBeGreaterThan(5);

    const opened = await worker().wmsLocationStock(warehouseId, stock.location_code.toLowerCase());
    expect(opened?.code).toBe(stock.location_code);
    expect(opened?.warehouse.code).toBe("SJO1");
    const item = opened?.items.find(
      (candidate) => candidate.sku_id === stock.sku_id && candidate.seller_id === stock.seller_id,
    );
    expect(item?.on_shelf).toBeGreaterThan(5);
    expect(item?.free).toBe(Math.max((item?.on_shelf ?? 0) - (item?.promised ?? 0), 0));
    expect(JSON.stringify(opened)).not.toMatch(/senas|phone|recipient|email/);
    expect(await worker().wmsLocationStock(warehouseId, "NO-EXISTE")).toBeNull();
  });

  it("finds a product's locations with what is free in each", async () => {
    const sku = await worker().wmsFindSku(warehouseId, stock.sku_code);
    const bin = sku?.bins.find((candidate) => candidate.location_code === stock.location_code);
    expect(bin).toMatchObject({ location_active: true, location_kind: "pick" });
    expect(bin?.free).toBe(Math.max((bin?.quantity ?? 0) - (bin?.promised ?? 0), 0));
  });

  it("counts units in, moves them, counts them out, and both lists show it", async () => {
    const [first, second] = [
      await staff().opsCreateLocation(warehouseId, CODES[0] ?? "", "storage"),
      await staff().opsCreateLocation(warehouseId, CODES[1] ?? "", "storage"),
    ];
    const product = { skuId: stock.sku_id, sellerId: stock.seller_id };
    await worker().wmsAdjustStock({
      locationId: first.id,
      ...product,
      delta: 3,
      note: NOTE,
      expected: 0,
    });
    // The screen's number is stale: refused, typed.
    await expect(
      worker().wmsAdjustStock({
        locationId: first.id,
        ...product,
        delta: -1,
        note: NOTE,
        expected: 9,
      }),
    ).rejects.toMatchObject({ code: "count_changed", detail: "3" });

    const moved = await worker().wmsMoveStock({
      fromLocationId: first.id,
      toLocationId: second.id,
      ...product,
      quantity: 2,
      note: "Prueba de contrato",
    });
    expect(moved).toMatchObject({
      quantity: 2,
      from: { code: CODES[0], on_shelf: 1, free: 1 },
      to: { code: CODES[1], on_shelf: 2 },
    });
    await expect(
      worker().wmsMoveStock({
        fromLocationId: first.id,
        toLocationId: second.id,
        ...product,
        quantity: 5,
      }),
    ).rejects.toMatchObject({ code: "move_exceeds_free", detail: "1" });

    const changes = await staff().opsStockChanges(20);
    const move = changes.find((change) => change.id === moved.movement_id);
    expect(move).toMatchObject({
      kind: "move",
      from_code: CODES[0],
      to_code: CODES[1],
      quantity: 2,
      change: 0,
      actor_name: "Kattia Rodríguez Salas",
    });
    expect(changes.some((change) => change.kind === "correction" && change.note === NOTE)).toBe(
      true,
    );

    // The seller sees the correction, never the move, never who.
    const { rows } = await db.query<{ email: string }>(
      `select u.email from public.seller_members m join auth.users u on u.id = m.user_id
        where m.seller_id = $1 order by m.role limit 1`,
      [stock.seller_id],
    );
    const history = await db.as(rows[0]?.email ?? "").sellerStockHistory(stock.seller_id, 10);
    expect(history[0]).toMatchObject({ kind: "warehouse_count", change: 3, note: NOTE });
    expect(history.every((entry) => entry.change !== 0)).toBe(true);
    expect(JSON.stringify(history)).not.toMatch(/Kattia|bodega@/);

    // Counted out again, through the same function.
    await worker().wmsAdjustStock({ locationId: first.id, ...product, delta: -1, note: NOTE });
    await worker().wmsAdjustStock({ locationId: second.id, ...product, delta: -2, note: NOTE });
    const emptied = await worker().wmsLocationStock(warehouseId, CODES[0] ?? "");
    expect(emptied).toMatchObject({ units: 0, items: [] });
  });
});
