/**
 * A count into a location (public.wms_count_into_location, 20261121084500)
 * against a staff cancellation that puts picked units back on the same shelf
 * (private.cancel_order_internal), from real sessions.
 *
 * Both take the shop's stock row before the shelf's row: the count after the
 * warehouse and the location, the cancellation (since 20261121084400) after
 * the order and its pick tasks. Before 084400 the cancellation took the shelf
 * first, and the two waited for each other until PostgreSQL ended one with a
 * deadlock (40P01): measured with tools/races (family I, I1) on the merged
 * database with the 084300 cancellation put back, 7 in 100 natural rounds and
 * 100 in 100 forced rounds; with 084400, 0.
 *
 * Each round is made to happen, not hoped for: a third session holds the
 * shelf's row FOR SHARE, the first writer starts and stops on it (after
 * taking the stock row), the second starts while it waits, then the third
 * session lets go. With one lock order that is a queue; with two it is a
 * deadlock every round.
 *
 * Every row the file makes is removed at the end (its shopper's cancelled
 * orders, the test shelf, its ledger rows), and the notebook's shelves and
 * stock row are put back as they were, so the other suites see the seed and
 * the file passes twice in a row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 90_000 });

const db = contractDatabase();
const WORKER = "bodega@yuntera.example";
const STAFF = "central@yuntera.example";
const SHOPPER = "carrera-conteo@yuntera.example";
const CODE = "Y-73-01-A";
const NOTE = "Conteo de la prueba de carreras";

type Bin = { location_id: string; quantity: number };

describe.skipIf(!db.enabled)(
  "a count into a location against a cancellation at the same shelf (against a seeded database)",
  () => {
    let pool: pg.Pool;
    const ids = new Map<string, string>();
    let warehouseId = "";
    let shelfId = "";
    let addressId = "";
    let notebook = { offer_id: "", sku_id: "", seller_id: "" };
    let binsBefore: Bin[] = [];
    let stockBefore = { on_hand: 0, reserved: 0 };
    let captured = false;

    async function owner<Row extends pg.QueryResultRow>(sql: string, args: unknown[] = []) {
      return (await db.query<Row>(sql, args)).rows;
    }

    /** The shopper's orders cancelled and deleted, the test shelf and its ledger rows gone, the notebook as it was. */
    async function cleanUp() {
      for (const row of await owner<{ id: string }>(
        `select o.id from public.orders o join auth.users u on u.id = o.user_id
          where u.email = $1 and o.status <> 'cancelled'`,
        [SHOPPER],
      )) {
        await db.query("select private.cancel_order_internal($1, 'Prueba de carreras')", [row.id]);
      }
      await db.query(
        `delete from public.orders o using auth.users u
          where u.id = o.user_id and u.email = $1 and o.status = 'cancelled'`,
        [SHOPPER],
      );
      const located = (
        await owner<{ id: string }>("select id from public.warehouse_locations where code = $1", [
          CODE,
        ])
      ).map((row) => row.id);
      if (located.length) {
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
      if (captured) {
        for (const bin of binsBefore) {
          await db.query(
            "update public.bin_stock set quantity = $4 where location_id = $1 and sku_id = $2 and seller_id = $3",
            [bin.location_id, notebook.sku_id, notebook.seller_id, bin.quantity],
          );
        }
        await db.query(
          `update public.stock_levels set on_hand = $4, reserved = $5
            where warehouse_id = $1 and sku_id = $2 and seller_id = $3`,
          [
            warehouseId,
            notebook.sku_id,
            notebook.seller_id,
            stockBefore.on_hand,
            stockBefore.reserved,
          ],
        );
      }
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
      await pool.query(
        `insert into auth.users (id, email, raw_user_meta_data)
         select gen_random_uuid(), $1::text, '{"full_name": "Prueba Carrera Conteo"}'
          where not exists (select 1 from auth.users where email = $1::text)`,
        [SHOPPER],
      );
      await pool.query(
        `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
         select s.id, 'Casa', 'Prueba Carrera Conteo', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
           from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
          where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
            and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
        [SHOPPER],
      );
      await db.connect();
      for (const row of await owner<{ email: string; id: string }>(
        "select email, id from auth.users where email = any($1)",
        [[STAFF, WORKER, SHOPPER]],
      ))
        ids.set(row.email, row.id);
      warehouseId =
        (await owner<{ id: string }>("select id from public.warehouses where code = 'SJO1'"))[0]
          ?.id ?? "";
      const [found] = await owner<typeof notebook>(
        `select o.id as offer_id, o.sku_id, o.seller_id
           from public.offers o join public.skus k on k.id = o.sku_id
           join public.products p on p.id = k.product_id
          where p.slug = 'libreta-tapa-dura-a5' and o.fulfillment = 'platform' and o.status = 'active' limit 1`,
      );
      expect(found, "the seed has no notebook in the warehouse").toBeDefined();
      if (found) notebook = found;
      // What the notebook's shelves and stock row hold now (the test shelf
      // aside, if a cut-off run left it), put back by cleanUp.
      binsBefore = await owner<Bin>(
        `select b.location_id, b.quantity from public.bin_stock b
           join public.warehouse_locations l on l.id = b.location_id
          where l.warehouse_id = $1 and b.sku_id = $2 and b.seller_id = $3 and l.code <> $4`,
        [warehouseId, notebook.sku_id, notebook.seller_id, CODE],
      );
      const [stock] = await owner<typeof stockBefore>(
        "select on_hand, reserved from public.stock_levels where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
        [warehouseId, notebook.sku_id, notebook.seller_id],
      );
      if (stock) stockBefore = stock;
      captured = true;
      await cleanUp();
      addressId = (await db.as(SHOPPER).myAddresses()).find((a) => a.is_default)?.id ?? "";
      shelfId = (await db.as(STAFF, "aal2").opsCreateLocation(warehouseId, CODE, "storage")).id;
    });

    afterAll(async () => {
      await cleanUp();
      await pool?.end();
      await db.close();
    });

    /**
     * A cash order of 2 notebooks, its pick sent to the test shelf (which got
     * exactly those 2 units by a move) and picked: the shelf's row is left at
     * 0 and the units are in the parcel.
     */
    async function pickedOrder(round: number) {
      const order = await db.as(SHOPPER).placeOrder({
        items: [{ offerId: notebook.offer_id, quantity: 2 }],
        addressId,
        paymentMethod: "cash_on_delivery",
        idempotencyKey: `carrera-conteo-${Date.now()}-${round}`,
      });
      const [task] = await owner<{ id: string; location_id: string; shipment_id: string }>(
        `select t.id, t.location_id, t.shipment_id from public.pick_tasks t
           join public.shipments s on s.id = t.shipment_id
          where s.order_id = $1 and t.status = 'open'`,
        [order.order_id],
      );
      expect(task, "the order has no open pick").toBeDefined();
      const worker = db.as(WORKER);
      await worker.wmsMoveStock({
        fromLocationId: task?.location_id ?? "",
        toLocationId: shelfId,
        skuId: notebook.sku_id,
        sellerId: notebook.seller_id,
        quantity: 2,
      });
      await db.query("update public.pick_tasks set location_id = $2 where id = $1", [
        task?.id,
        shelfId,
      ]);
      await worker.wmsStartPicking(task?.shipment_id ?? "");
      const [code] = await owner<{ code: string }>("select code from public.skus where id = $1", [
        notebook.sku_id,
      ]);
      await worker.wmsConfirmPick(task?.id ?? "", 2, null, code?.code ?? "");
      return order.order_id;
    }

    async function session(email: string | null) {
      const client = await pool.connect();
      await client.query("begin");
      if (email) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: ids.get(email), role: "authenticated", aal: "aal2" }),
        ]);
        await client.query("set local role authenticated");
      }
      const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      return { client, pid: rows[0]?.pid ?? 0 };
    }

    /** Runs the call, commits when it ends (rolls back on error) and says how it ended. */
    function run(s: { client: pg.PoolClient }, sql: string, args: unknown[]) {
      return s.client.query(sql, args).then(
        async () => {
          await s.client.query("commit");
          return "ok";
        },
        async (error: Error & { code?: string }) => {
          await s.client.query("rollback").catch(() => undefined);
          return error.code === "40P01" || error.code === "40001"
            ? `LOCK ${error.code}`
            : error.message;
        },
      );
    }

    async function waitsForLock(pid: number) {
      for (let i = 0; i < 200; i++) {
        const { rows } = await db.query<{ waiting: boolean }>(
          "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
          [pid],
        );
        if (rows[0]?.waiting) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    }

    async function shelf() {
      const [row] = await owner<{ quantity: number }>(
        "select quantity from public.bin_stock where location_id = $1 and sku_id = $2 and seller_id = $3",
        [shelfId, notebook.sku_id, notebook.seller_id],
      );
      return row?.quantity ?? 0;
    }

    for (const first of ["cancellation", "count"] as const) {
      it(`never deadlocks when the ${first} reaches the shelf first`, async () => {
        for (let round = 0; round < 3; round++) {
          const order = await pickedOrder(round);
          expect(await shelf()).toBe(0);
          const holder = await session(null);
          const cancel = await session(STAFF);
          const count = await session(WORKER);
          try {
            await holder.client.query(
              "select 1 from public.bin_stock where location_id = $1 and sku_id = $2 and seller_id = $3 for share",
              [shelfId, notebook.sku_id, notebook.seller_id],
            );
            const cancelCall = () =>
              run(cancel, "select public.cancel_order($1, 'Prueba de carreras')", [order]);
            const countCall = () =>
              run(count, "select public.wms_count_into_location($1, $2, $3, 3, $4)", [
                shelfId,
                notebook.sku_id,
                notebook.seller_id,
                NOTE,
              ]);
            const a = first === "cancellation" ? cancelCall() : countCall();
            expect(await waitsForLock(first === "cancellation" ? cancel.pid : count.pid)).toBe(
              true,
            );
            const b = first === "cancellation" ? countCall() : cancelCall();
            expect(await waitsForLock(first === "cancellation" ? count.pid : cancel.pid)).toBe(
              true,
            );
            await holder.client.query("rollback");
            const [cancelled, counted] =
              first === "cancellation" ? [await a, await b] : [await b, await a];
            expect(cancelled, `round ${round}: cancellation`).toBe("ok");
            if (first === "cancellation") {
              // The cancellation committed first: the shelf lists the product again.
              expect(counted, `round ${round}: count`).toBe("count_already_listed");
              expect(await shelf()).toBe(2);
            } else {
              expect(counted, `round ${round}: count`).toBe("ok");
              expect(await shelf()).toBe(5);
            }
          } finally {
            for (const s of [holder, cancel, count]) {
              await s.client.query("rollback").catch(() => undefined);
              s.client.release();
            }
            // The next round (and the next test) starts from an empty test shelf again.
            await cleanUpRound();
          }
        }
      });
    }

    /** The shelf's units moved back where they came from (the count's ones leave the totals). */
    async function cleanUpRound() {
      for (const row of await owner<{ id: string }>(
        `select o.id from public.orders o join auth.users u on u.id = o.user_id
          where u.email = $1 and o.status <> 'cancelled'`,
        [SHOPPER],
      )) {
        await db.query("select private.cancel_order_internal($1, 'Prueba de carreras')", [row.id]);
      }
      const units = await shelf();
      if (units > 0) {
        await db.query(
          "update public.bin_stock set quantity = 0 where location_id = $1 and sku_id = $2 and seller_id = $3",
          [shelfId, notebook.sku_id, notebook.seller_id],
        );
      }
      for (const bin of binsBefore) {
        await db.query(
          "update public.bin_stock set quantity = $4 where location_id = $1 and sku_id = $2 and seller_id = $3",
          [bin.location_id, notebook.sku_id, notebook.seller_id, bin.quantity],
        );
      }
      await db.query(
        "update public.stock_levels set on_hand = $4 where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
        [warehouseId, notebook.sku_id, notebook.seller_id, stockBefore.on_hand],
      );
    }
  },
);
