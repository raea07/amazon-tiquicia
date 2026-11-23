/**
 * Units that come back from a parcel, at the same moment as the warehouse's
 * stock tools, from two real sessions (20261121084200_order_followups.sql
 * against 20261121084300_warehouse_stock.sql).
 *
 *   (i)   checking in a returned parcel (wms_receive_returned_shipment) while
 *         a second session moves the same product off the returns location
 *         the units land on (wms_move_stock), 100 times;
 *   (ii)  the same check-in while a second session corrects the count of the
 *         product on that returns location (wms_adjust_stock), 100 times;
 *   (iii) staff stopping a packed parcel (ops_recall_shipment) while a second
 *         session moves or corrects the parcel's product, and while it packs
 *         another parcel of the same product (wms_pack_shipment), and staff
 *         trying to stop a parcel at the very moment it is being packed.
 *
 * Both calls of a pair start at the same moment, the first sent first in one
 * round and second in the next, so every order in which PostgreSQL can take
 * their locks is tried. What is checked: no caller gets a lock error
 * (deadlock 40P01, serialisation 40001), each call has its expected outcome,
 * and no unit is lost or made, both on the test locations (what is there is
 * what the counts and check-ins put there) and for the shop (its on-hand
 * units equal the units on every location of the warehouse plus the units
 * picked into parcels still being picked, as before the test).
 *
 * The receive-against-move and receive-against-count orders are what the
 * header of 084300 promises: the check-in takes the shop's stock row, then the
 * returns location's row of the product (private.apply_stock_change); a move
 * takes only the two locations' rows, in location order; a count takes the
 * stock row, then the location's row. ops_recall_shipment touches no stock at
 * all (packing consumed it already).
 *
 * Fixtures: a returns location of this file's own, sorted before the seed's
 * DEV-01, so check-ins land on it; a storage shelf of its own; an order on
 * cash on delivery (no money, no refund, no documents) whose parcel is
 * stopped and checked in again and again: between rounds, as the superuser,
 * the parcel is put back to "returning" and its order back to "processing"
 * with the lifecycle triggers off (`session_replication_role = replica`),
 * because a parcel is checked in only once in real life. Everything is
 * undone at the end, so the suite passes on a used database and twice in a
 * row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

const db = contractDatabase();
const STAFF = "central@yuntera.example";
const WORKER = "bodega@yuntera.example";
const SHOPPER = "carrera-devuelto@yuntera.example";
const RETURNS = "D-00-00-A";
const SHELF = "Y-95-01-A";
const CODES = [RETURNS, SHELF];
const NOTE = "Conteo de la prueba de carrera de devoluciones";
const ROUNDS = 100;

type Session = { client: pg.PoolClient; pid: number };
type Step = { as: string; sql: string; args?: unknown[] };

describe.skipIf(!db.enabled)(
  "returned units against the stock tools (against a seeded database)",
  () => {
    let pool: pg.Pool;
    const ids = new Map<string, string>();
    const loc = new Map<string, string>();
    let warehouseId = "";
    let product = { sku_id: "", seller_id: "", sku_code: "", offer_id: "" };
    let unexplainedBefore = 0;
    const orders: string[] = [];
    let returnedShipment = "";
    let returnedOrder = "";
    let pickingShipment = "";

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
      await pool.query(
        `insert into auth.users (id, email, raw_user_meta_data)
       select gen_random_uuid(), $1::text, '{"full_name": "Prueba Carrera Devuelto"}'
        where not exists (select 1 from auth.users where email = $1::text)`,
        [SHOPPER],
      );
      await pool.query(
        `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
       select s.id, 'Casa', 'Prueba Carrera Devuelto', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
         from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
        where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
          and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
        [SHOPPER],
      );
      await db.connect();
      await cleanUp();
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
        `select o.sku_id, o.seller_id, k.code as sku_code, o.id as offer_id
         from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug = 'libreta-tapa-dura-a5' and o.fulfillment = 'platform' limit 1`,
      );
      expect(found.rows[0], "the seed has no notebook in the warehouse").toBeDefined();
      if (found.rows[0]) product = found.rows[0];
      unexplainedBefore = await unexplained();

      // The two locations: a returns area (only the database creates those) and a shelf.
      await db.query(
        `insert into public.warehouse_locations (warehouse_id, code, kind, active) values ($1, $2, 'returns', true)`,
        [warehouseId, RETURNS],
      );
      loc.set(RETURNS, (await locationId(RETURNS)) ?? "");
      loc.set(
        SHELF,
        (await db.as(STAFF, "aal2").opsCreateLocation(warehouseId, SHELF, "storage")).id,
      );
      const worker = db.as(WORKER);
      const units = { skuId: product.sku_id, sellerId: product.seller_id, note: NOTE };
      await worker.wmsAdjustStock({ locationId: at(SHELF), delta: 10, ...units });
      await worker.wmsAdjustStock({ locationId: at(RETURNS), delta: 5, ...units });

      // Parcel 1: picked from the test shelf, packed, then stopped by staff.
      returnedOrder = await placeOrder("1");
      returnedShipment = await pickFromShelf(returnedOrder);
      await worker.wmsPackShipment(returnedShipment, 900, 1);
      await db
        .as(STAFF, "aal2")
        .opsRecallShipment(returnedShipment, "Prueba de carrera de devoluciones");
      // Parcel 2: picked from the test shelf, left in picking (packed only inside rolled-back rounds).
      const second = await placeOrder("2");
      pickingShipment = await pickFromShelf(second);
      expect(await unexplained()).toBe(unexplainedBefore);
    });

    afterAll(async () => {
      for (const order of orders) {
        await db
          .query("select private.cancel_order_internal($1, 'Prueba de carrera de devoluciones')", [
            order,
          ])
          .catch(() => undefined);
      }
      await cleanUp();
      await pool?.end();
      await db.close();
    });

    const at = (code: string) => loc.get(code) ?? "";

    async function locationId(code: string) {
      return (
        await db.query<{ id: string }>(
          "select id from public.warehouse_locations where warehouse_id = $1 and code = $2",
          [warehouseId, code],
        )
      ).rows[0]?.id;
    }

    async function placeOrder(key: string) {
      const shopper = db.as(SHOPPER);
      const address = (await shopper.myAddresses()).find((a) => a.is_default);
      const placed = await shopper.placeOrder({
        items: [{ offerId: product.offer_id, quantity: 1 }],
        addressId: address?.id ?? "",
        paymentMethod: "cash_on_delivery",
        idempotencyKey: `carrera-devuelto-${key}-${Date.now()}`,
      });
      orders.push(placed.order_id);
      return placed.order_id;
    }

    /** Points the order's pick at the test shelf (fixture) and picks it there. */
    async function pickFromShelf(orderId: string) {
      const task = (
        await db.query<{ id: string; shipment_id: string }>(
          `select t.id, t.shipment_id from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where s.order_id = $1`,
          [orderId],
        )
      ).rows[0];
      await db.query("update public.pick_tasks set location_id = $2 where id = $1", [
        task?.id,
        at(SHELF),
      ]);
      const worker = db.as(WORKER);
      await worker.wmsStartPicking(task?.shipment_id ?? "");
      await worker.wmsConfirmPick(task?.id ?? "", 1, null, product.sku_code);
      return task?.shipment_id ?? "";
    }

    /** On hand minus (every location of SJO1 + units picked into parcels still being picked). */
    async function unexplained() {
      const { rows } = await db.query<{ n: number }>(
        `select ((select coalesce(sum(l.on_hand), 0) from public.stock_levels l
                 where l.warehouse_id = $1 and l.sku_id = $2 and l.seller_id = $3)
             - (select coalesce(sum(b.quantity), 0) from public.bin_stock b
                  join public.warehouse_locations wl on wl.id = b.location_id
                 where wl.warehouse_id = $1 and b.sku_id = $2 and b.seller_id = $3)
             - (select coalesce(sum(m.quantity), 0) from public.stock_movements m
                  join public.shipments s on s.id = m.reference_id
                 where m.warehouse_id = $1 and m.reason = 'pick' and m.reference_type = 'shipment'
                   and s.status = 'picking' and m.sku_id = $2 and m.seller_id = $3))::integer as n`,
        [warehouseId, product.sku_id, product.seller_id],
      );
      return rows[0]?.n ?? 0;
    }

    async function bin(code: string) {
      const { rows } = await db.query<{ n: number }>(
        "select coalesce((select quantity from public.bin_stock where location_id = $1 and sku_id = $2 and seller_id = $3), 0)::integer as n",
        [at(code), product.sku_id, product.seller_id],
      );
      return rows[0]?.n ?? 0;
    }

    /** Fixture between rounds: the parcel is on its way back again, its order open. */
    async function sendBackAgain(status: "returning" | "packed" = "returning") {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local session_replication_role = replica");
        await client.query(
          `update public.shipments set status = $2::public.shipment_status,
                recalled_at = case when $2::text = 'packed' then null else recalled_at end
          where id = $1`,
          [returnedShipment, status],
        );
        await client.query(
          "update public.orders set status = 'processing', cancelled_at = null, cancel_reason = null where id = $1",
          [returnedOrder],
        );
        await client.query("commit");
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    }

    /** The test locations, their rows and their ledger rows gone; the shop's total back. */
    async function cleanUp() {
      // Orders of an earlier run that stopped half-way: cancelled (picked units go back), then gone.
      const { rows: open } = await db.query<{ id: string }>(
        `select o.id from public.orders o join auth.users u on u.id = o.user_id
        where u.email = $1 and o.status not in ('cancelled', 'refunded')`,
        [SHOPPER],
      );
      for (const order of open) {
        await db
          .query("select private.cancel_order_internal($1, 'Prueba de carrera de devoluciones')", [
            order.id,
          ])
          .catch(() => undefined);
      }
      const { rows } = await db.query<{ id: string }>(
        "select wl.id from public.warehouse_locations wl join public.warehouses w on w.id = wl.warehouse_id where w.code = 'SJO1' and wl.code = any($1)",
        [CODES],
      );
      const located = rows.map((row) => row.id);
      if (located.length > 0) {
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
        await db.query(
          "update public.pick_tasks set location_id = null where location_id = any($1)",
          [located],
        );
        await db.query("delete from public.bin_stock where location_id = any($1)", [located]);
        await db.query("delete from public.warehouse_locations where id = any($1)", [located]);
      }
      await db.query(
        `delete from public.orders o using auth.users u
        where u.id = o.user_id and u.email = $1`,
        [SHOPPER],
      );
    }

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

    /** The error a call ended with ("" when accepted); lock errors are marked. */
    const outcome = (query: Promise<unknown>) =>
      query.then(
        () => "",
        (error: Error & { code?: string }) =>
          error.code === "40P01" || error.code === "40001" ? `LOCK ${error.code}` : error.message,
      );

    /**
     * Starts both calls at the same moment, each in its own session; whichever
     * answers first ends its transaction first (commit when accepted and kept),
     * so the other, if it waits for it, can go on.
     */
    async function together(first: Step, second: Step, keep = true) {
      const a = await session(first.as);
      const b = await session(second.as);
      try {
        const sessions = [a, b];
        const pending = [
          outcome(a.client.query(first.sql, first.args)).then((result) => ({ index: 0, result })),
          outcome(b.client.query(second.sql, second.args)).then((result) => ({ index: 1, result })),
        ];
        const results = ["", ""];
        const done = await Promise.race(pending);
        results[done.index] = done.result;
        await sessions[done.index]?.client.query(keep && !done.result ? "commit" : "rollback");
        const other = await pending[1 - done.index];
        if (other) {
          results[other.index] = other.result;
          await sessions[other.index]?.client.query(keep && !other.result ? "commit" : "rollback");
        }
        return results as [string, string];
      } finally {
        for (const s of [a, b]) {
          await s.client.query("rollback").catch(() => undefined);
          s.client.release();
        }
      }
    }

    const receive: Step = {
      as: WORKER,
      sql: "select public.wms_receive_returned_shipment($1, true, null)",
      args: [] as unknown[],
    };
    const receiveStep = () => ({ ...receive, args: [returnedShipment] });
    const moveOff = (quantity = 1): Step => ({
      as: WORKER,
      sql: "select public.wms_move_stock($1, $2, $3, $4, $5)",
      args: [at(RETURNS), at(SHELF), product.sku_id, product.seller_id, quantity],
    });
    const count = (code: string, delta: number): Step => ({
      as: WORKER,
      sql: "select public.wms_adjust_stock($1, $2, $3, $4, $5)",
      args: [at(code), product.sku_id, product.seller_id, delta, NOTE],
    });
    const recall: () => Step = () => ({
      as: STAFF,
      sql: "select public.ops_recall_shipment($1, 'Prueba de carrera de devoluciones')",
      args: [returnedShipment],
    });

    it(`(i) a check-in and a move off the returns location, ${ROUNDS} times`, async () => {
      const before = (await bin(RETURNS)) + (await bin(SHELF));
      const lockErrors: string[] = [];
      let received = 0;
      for (let round = 0; round < ROUNDS; round += 1) {
        await sendBackAgain();
        const [x, y] =
          round % 2 === 0
            ? await together(receiveStep(), moveOff())
            : await together(moveOff(), receiveStep()).then(([m, r]) => [r, m] as [string, string]);
        for (const result of [x, y]) if (result.startsWith("LOCK")) lockErrors.push(result);
        expect([x, y], `round ${round}`).toEqual(["", ""]);
        received += 1;
      }
      expect(lockErrors).toEqual([]);
      // Every check-in put one unit on the test locations; the moves only shifted them.
      expect((await bin(RETURNS)) + (await bin(SHELF))).toBe(before + received);
      expect(await bin(RETURNS)).toBe(5);
      expect(await unexplained()).toBe(unexplainedBefore);
    });

    it(`(ii) a check-in and a count correction of the returns location, ${ROUNDS} times`, async () => {
      const before = (await bin(RETURNS)) + (await bin(SHELF));
      let expected = before;
      for (let round = 0; round < ROUNDS; round += 1) {
        await sendBackAgain();
        const delta = round % 4 < 2 ? -1 : 1;
        const [received, counted] =
          round % 2 === 0
            ? await together(receiveStep(), count(RETURNS, delta))
            : await together(count(RETURNS, delta), receiveStep()).then(
                ([c, r]) => [r, c] as [string, string],
              );
        expect([received, counted], `round ${round}`).toEqual(["", ""]);
        expected += 1 + delta;
      }
      expect((await bin(RETURNS)) + (await bin(SHELF))).toBe(expected);
      expect(await unexplained()).toBe(unexplainedBefore);
    });

    it("(iii) staff stopping a parcel against a move, a count and packing of the same product", async () => {
      const before = (await bin(RETURNS)) + (await bin(SHELF));
      let expected = before;
      for (let round = 0; round < 40; round += 1) {
        // The parcel is packed again (its stock long consumed); staff stop it.
        await sendBackAgain("packed");
        const other =
          round % 4 === 0
            ? moveOff()
            : round % 4 === 1
              ? count(SHELF, -1)
              : round % 4 === 2
                ? count(SHELF, 1)
                : {
                    as: WORKER,
                    sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
                    args: [pickingShipment],
                  };
        const packing = round % 4 === 3;
        // Packing is rolled back each time (both sessions), so it can be tried again.
        const [stopped, moved] =
          round % 8 < 4
            ? await together(recall(), other, !packing)
            : await together(other, recall(), !packing).then(
                ([m, s]) => [s, m] as [string, string],
              );
        expect([stopped, moved], `round ${round}`).toEqual(["", ""]);
        if (!packing && round % 4 === 1) expected -= 1;
        if (!packing && round % 4 === 2) expected += 1;
        const status = (
          await db.query<{ status: string }>("select status from public.shipments where id = $1", [
            returnedShipment,
          ])
        ).rows[0]?.status;
        expect(status).toBe(packing ? "packed" : "returning");
      }
      expect((await bin(RETURNS)) + (await bin(SHELF))).toBe(expected);
      expect(await unexplained()).toBe(unexplainedBefore);
    });

    it("(v) a move off a shelf while a new order is released to picking (rolled back), 50 times", async () => {
      // private.release_order_to_fulfillment takes the candidate shelves FOR KEY
      // SHARE before it names one; a move holds them FOR UPDATE. Both run at
      // once and are rolled back, so nothing is left of either.
      const shopperId = ids.get(SHOPPER);
      const address = (
        await db.query<{ id: string }>(
          "select id from public.addresses where user_id = $1 and is_default and deleted_at is null",
          [shopperId],
        )
      ).rows[0]?.id;
      for (let round = 0; round < 50; round += 1) {
        // Paid in the same call (the simulation), so it is released to picking at once.
        const place: Step = {
          as: SHOPPER,
          sql: `select public.confirm_sandbox_payment(
                (public.place_order($1::jsonb, $2, 'sinpe_movil', $3) ->> 'order_id')::uuid)`,
          args: [
            JSON.stringify([{ offer_id: product.offer_id, quantity: 1 }]),
            address,
            `carrera-devuelto-v-${Date.now()}-${round}`,
          ],
        };
        const [placed, moved] =
          round % 2 === 0
            ? await together(place, moveOff(), false)
            : await together(moveOff(), place, false).then(([m, p]) => [p, m] as [string, string]);
        expect([placed, moved], `round ${round}`).toEqual(["", ""]);
      }
      expect(await unexplained()).toBe(unexplainedBefore);
    });

    it(`(iv) staff stopping the very parcel that is being packed, ${ROUNDS} times (rolled back)`, async () => {
      // The packing parcel is "picking": only once it is packed can staff stop it.
      const pack: Step = {
        as: WORKER,
        sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
        args: [pickingShipment],
      };
      const stopIt: Step = {
        as: STAFF,
        sql: "select public.ops_recall_shipment($1, 'Prueba de carrera de devoluciones')",
        args: [pickingShipment],
      };
      const seen = new Set<string>();
      for (let round = 0; round < ROUNDS; round += 1) {
        const [packed, stopped] =
          round % 2 === 0
            ? await together(pack, stopIt, false)
            : await together(stopIt, pack, false).then(([s, p]) => [p, s] as [string, string]);
        expect(packed, `round ${round}`).toBe("");
        // Stopped after the packing (it waited for it), or refused because it was still being picked.
        expect(["", "shipment_not_recallable"], `round ${round}`).toContain(stopped);
        seen.add(stopped);
      }
      const status = (
        await db.query<{ status: string }>("select status from public.shipments where id = $1", [
          pickingShipment,
        ])
      ).rows[0]?.status;
      expect(status).toBe("picking");
      expect(await unexplained()).toBe(unexplainedBefore);
    });
  },
);
