/**
 * The order in which stock rows are taken, from real sessions
 * (20261121084300_warehouse_stock.sql). A release to picking
 * (private.release_order_to_fulfillment, run when a payment is confirmed)
 * takes the order's stock rows (stock_levels) first, by product, shop and
 * warehouse, as place_order does. Every other function that takes the stock
 * rows of several products or shops in one transaction must take them in
 * that same order, or the two can wait for each other until PostgreSQL ends
 * one with a deadlock (40P01), which a shopper sees as a payment that did not
 * go through.
 *
 *   (i)  the unpaid-order sweep (private.expire_unpaid_orders, every five
 *        minutes) against a payment confirmation of two products whose
 *        expired orders come in the opposite order: the sweep cancels many
 *        orders in one transaction, so it takes the stock rows of all of them
 *        first, in the global order;
 *   (ii) packing a parcel (private.consume_shipment_stock) and cancelling an
 *        order (private.cancel_order_internal) that hold one product from two
 *        shops, against a payment confirmation of the same two offers: their
 *        loops sort by product, shop and warehouse.
 *
 * Each race is made to happen, not hoped for: a third session holds a row
 * the sweep or the packing needs between its two stock rows, the
 * confirmation starts while it waits there, then the third session lets go.
 * Without the fixed order the two then wait for each other. For (ii) the
 * order of the two shops' rows on disk is flipped between rounds, since the
 * unsorted loop follows it.
 *
 * Every race is rolled back. The file's own shopper, orders, the second
 * shop's offer and its stock row are removed at the end, so the suite passes
 * on a used database and twice in a row.
 */

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 90_000 });

const db = contractDatabase();
const SHOPPER = "carrera-orden-stock@yuntera.example";
const ROUNDS = 4;

type Session = { client: pg.PoolClient; pid: number };
type Offer = { id: string; sku_id: string; seller_id: string };

describe.skipIf(!db.enabled)(
  "the order stock rows are taken in (against a seeded database)",
  () => {
    let pool: pg.Pool;
    let shopperId = "";
    let addressId = "";
    let warehouseId = "";
    /** Two products of one shop (Tienda Sendero); `low` has the lower sku_id. */
    let low: Offer = { id: "", sku_id: "", seller_id: "" };
    let high: Offer = { id: "", sku_id: "", seller_id: "" };
    /** The same product from a second shop (this file's fixture). */
    let second: Offer = { id: "", sku_id: "", seller_id: "" };
    const placed: string[] = [];

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
      await pool.query(
        `insert into auth.users (id, email, raw_user_meta_data)
       select gen_random_uuid(), $1::text, '{"full_name": "Prueba Orden Stock"}'
        where not exists (select 1 from auth.users where email = $1::text)`,
        [SHOPPER],
      );
      await pool.query(
        `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
       select s.id, 'Casa', 'Prueba Orden Stock', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
         from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
        where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
          and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
        [SHOPPER],
      );
      await db.connect();
      await cleanUp();
      shopperId =
        (await db.query<{ id: string }>("select id from auth.users where email = $1", [SHOPPER]))
          .rows[0]?.id ?? "";
      addressId = (await db.as(SHOPPER).myAddresses()).find((a) => a.is_default)?.id ?? "";
      warehouseId =
        (await db.query<{ id: string }>("select id from public.warehouses where code = 'SJO1'"))
          .rows[0]?.id ?? "";

      const offers = await db.query<Offer>(
        `select o.id, o.sku_id, o.seller_id
         from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug in ('balon-futbol-sendero-5', 'rompecabezas-volcanes-500')
          and o.fulfillment = 'platform' and o.status = 'active'
          and o.seller_id = (select id from public.sellers where slug = 'tienda-sendero')
        order by o.sku_id`,
      );
      expect(offers.rows, "the seed lacks the two warehouse products").toHaveLength(2);
      [low, high] = offers.rows as [Offer, Offer];

      // The product that sorts first, also sold from the warehouse by a
      // second shop: the schema allows it (offers are unique per product, shop
      // and condition), the seed has none.
      const cafetal =
        (
          await db.query<{ id: string }>(
            "select id from public.sellers where slug = 'cafetal-los-santos'",
          )
        ).rows[0]?.id ?? "";
      const inserted = await db.query<Offer>(
        `insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days, status)
       select o.sku_id, $2, o.price_minor, 'platform', o.handling_days, 'active'
         from public.offers o where o.id = $1
       returning id, sku_id, seller_id`,
        [low.id, cafetal],
      );
      second = inserted.rows[0] ?? second;
      await db.query(
        "insert into public.stock_levels (warehouse_id, sku_id, seller_id, on_hand) values ($1, $2, $3, 10)",
        [warehouseId, second.sku_id, second.seller_id],
      );
    });

    // A shopper may hold three unpaid orders: each test's go.
    afterEach(cancelOrders);

    afterAll(async () => {
      await cleanUp();
      await pool?.end();
      await db.close();
    });

    /** This file's orders cancelled and deleted; the second shop's offer and stock gone. */
    async function cleanUp() {
      await cancelOrders();
      await db.query(
        `delete from public.orders o using auth.users u
        where u.id = o.user_id and u.email = $1 and o.status = 'cancelled'`,
        [SHOPPER],
      );
      await db.query(
        `delete from public.stock_levels l using public.sellers s, public.skus k, public.products p
        where s.id = l.seller_id and s.slug = 'cafetal-los-santos' and k.id = l.sku_id
          and p.id = k.product_id and p.slug in ('balon-futbol-sendero-5', 'rompecabezas-volcanes-500')`,
      );
      await db.query(
        `delete from public.offers o using public.sellers s, public.skus k, public.products p
        where s.id = o.seller_id and s.slug = 'cafetal-los-santos' and k.id = o.sku_id
          and p.id = k.product_id and p.slug in ('balon-futbol-sendero-5', 'rompecabezas-volcanes-500')`,
      );
    }

    /** This file's orders that are not cancelled yet, cancelled. */
    async function cancelOrders() {
      const { rows } = await db.query<{ id: string }>(
        `select o.id from public.orders o join auth.users u on u.id = o.user_id
        where u.email = $1 and o.status <> 'cancelled'`,
        [SHOPPER],
      );
      for (const row of rows) {
        await db.query("select private.cancel_order_internal($1, 'Prueba de orden de stock')", [
          row.id,
        ]);
      }
    }

    async function place(
      lines: { offer: Offer; quantity: number }[],
      paymentMethod: "card" | "cash_on_delivery",
    ) {
      const order = await db.as(SHOPPER).placeOrder({
        items: lines.map((line) => ({ offerId: line.offer.id, quantity: line.quantity })),
        addressId,
        paymentMethod,
        idempotencyKey: `orden-stock-${Date.now()}-${placed.length}`,
      });
      placed.push(order.order_id);
      return order.order_id;
    }

    /** A transaction kept open: as the shopper, or (no email) as the database owner, as cron runs. */
    async function session(asShopper: boolean): Promise<Session> {
      const client = await pool.connect();
      await client.query("begin");
      if (asShopper) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: shopperId, role: "authenticated", aal: "aal1" }),
        ]);
        await client.query("set local role authenticated");
      }
      const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      return { client, pid: rows[0]?.pid ?? 0 };
    }

    async function waitsForLock(pid: number, ms = 5000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const { rows } = await db.query<{ waiting: boolean }>(
          "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
          [pid],
        );
        if (rows[0]?.waiting) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    }

    const outcome = (query: Promise<unknown>) =>
      query.then(
        () => "",
        (error: Error & { code?: string }) =>
          error.code === "40P01" || error.code === "40001" ? `LOCK ${error.code}` : error.message,
      );

    /**
     * `holder` takes `hold` and keeps it; `writer` runs `write` and stops on
     * it; the shopper confirms `order`'s payment; then the holder lets go.
     * Everything is rolled back. Returns each one's outcome and whether each
     * waited.
     */
    async function race(
      hold: string,
      holdArgs: unknown[],
      write: string,
      writeArgs: unknown[],
      order: string,
    ) {
      const holder = await session(false);
      const writer = await session(false);
      const shopper = await session(true);
      try {
        await holder.client.query(hold, holdArgs);
        const writing = outcome(writer.client.query(write, writeArgs));
        const writerWaited = await waitsForLock(writer.pid);
        const confirming = outcome(
          shopper.client.query("select public.confirm_sandbox_payment($1)", [order]),
        );
        const shopperWaited = await waitsForLock(shopper.pid);
        await holder.client.query("rollback");
        const writerOutcome = await writing;
        await writer.client.query("rollback");
        const shopperOutcome = await confirming;
        return { writer: writerOutcome, writerWaited, shopper: shopperOutcome, shopperWaited };
      } finally {
        for (const s of [holder, writer, shopper]) {
          await s.client.query("rollback").catch(() => undefined);
          s.client.release();
        }
      }
    }

    it("(i) the unpaid-order sweep and a payment confirmation of the same two products", async () => {
      // Two expired card orders, the older of the product that sorts last;
      // then a card order of both, whose payment is confirmed during the sweep.
      const olderOfHigh = await place([{ offer: high, quantity: 1 }], "card");
      const newerOfLow = await place([{ offer: low, quantity: 1 }], "card");
      await db.query(
        "update public.orders set placed_at = now() - interval '2 hours' where id = $1",
        [olderOfHigh],
      );
      await db.query(
        "update public.orders set placed_at = now() - interval '1 hour' where id = $1",
        [newerOfLow],
      );
      const both = await place(
        [
          { offer: low, quantity: 1 },
          { offer: high, quantity: 1 },
        ],
        "card",
      );

      for (let round = 0; round < ROUNDS; round++) {
        // The sweep stops before the second order's stock row: its
        // reservation is held. Without the fixed order, it holds the stock row
        // of `high` there, and the confirmation holds `low` and waits for it.
        const result = await race(
          `select 1 from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
          where i.order_id = $1 for share of r`,
          [newerOfLow],
          "select private.expire_unpaid_orders()",
          [],
          both,
        );
        expect(result, `round ${round}`).toEqual({
          writer: "",
          writerWaited: true,
          shopper: "",
          shopperWaited: true,
        });
      }
      // Nothing was kept: the three orders still wait for their payment.
      const { rows } = await db.query<{ status: string }>(
        "select status from public.orders where id = any($1) order by placed_at",
        [[olderOfHigh, newerOfLow, both]],
      );
      expect(rows.map((row) => row.status)).toEqual([
        "pending_payment",
        "pending_payment",
        "pending_payment",
      ]);
    });

    /** Moves one shop's rows of `order` to the end of their tables, so a scan meets them last. */
    async function rewrite(order: string, sellerId: string) {
      await db.query(
        `update public.inventory_reservations r set quantity = r.quantity
         from public.order_items i where i.id = r.order_item_id and i.order_id = $1 and r.seller_id = $2`,
        [order, sellerId],
      );
      await db.query(
        `update public.shipment_items si set quantity = si.quantity
         from public.order_items i where i.id = si.order_item_id and i.order_id = $1 and i.seller_id = $2`,
        [order, sellerId],
      );
    }

    /** One product from two shops: packing or cancelling one order, confirming another. */
    async function twoShops(write: (order: string, shipment: string) => [string, unknown[]]) {
      // A cash order is released at once; the card order waits for its payment.
      const held = await place(
        [
          { offer: low, quantity: 1 },
          { offer: second, quantity: 1 },
        ],
        "cash_on_delivery",
      );
      const shipment =
        (
          await db.query<{ id: string }>(
            "select id from public.shipments where order_id = $1 and origin_warehouse_id = $2",
            [held, warehouseId],
          )
        ).rows[0]?.id ?? "";
      const paying = await place(
        [
          { offer: second, quantity: 2 },
          { offer: low, quantity: 2 },
        ],
        "card",
      );
      const [sql, args] = write(held, shipment);
      const lastShop = low.seller_id > second.seller_id ? low : second;
      for (let round = 0; round < ROUNDS; round++) {
        // Both shops' rows on disk in one order, then the other.
        await rewrite(held, round % 2 === 0 ? low.seller_id : second.seller_id);
        // The writer stops on the stock row of the shop that sorts last: a
        // stock write updates the shop's offer (what shoppers can buy), and
        // that offer row is held. Without the fixed order it may already hold
        // the other shop's stock row there, which the confirmation takes first.
        const result = await race(
          "select 1 from public.offers where id = $1 for update",
          [lastShop.id],
          sql,
          args,
          paying,
        );
        expect(result, `round ${round}`).toEqual({
          writer: "",
          writerWaited: true,
          shopper: "",
          shopperWaited: true,
        });
      }
      const { rows } = await db.query<{ reserved: number }>(
        `select coalesce(sum(reserved), 0)::integer as reserved from public.stock_levels
        where warehouse_id = $1 and sku_id = $2 and seller_id = $3`,
        [warehouseId, second.sku_id, second.seller_id],
      );
      expect(rows[0]?.reserved, "both orders still hold the second shop's units").toBe(3);
    }

    it("(ii) packing an order of one product from two shops, during a payment confirmation of the same offers", async () => {
      await twoShops((_order, shipment) => [
        "select private.consume_shipment_stock($1)",
        [shipment],
      ]);
    });

    it("(iii) cancelling an order of one product from two shops, during a payment confirmation of the same offers", async () => {
      await twoShops((order) => [
        "select private.cancel_order_internal($1, 'Prueba de orden de stock')",
        [order],
      ]);
    });
  },
);
