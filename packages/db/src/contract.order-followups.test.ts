/**
 * Order and operations follow-ups (20261121084200_order_followups.sql),
 * against a seeded database:
 *
 *   - every answer that changed or is new, called as the right person,
 *     matches the client's schemas;
 *   - the answers of my_orders and get_order still parse with the schemas of
 *     the store build of commit 3f251c3 (frozen below, and compared with that
 *     commit's file when git can show it);
 *   - two parcels of one order received at the same moment, in two real
 *     sessions, in both orders: the delivery fee comes back exactly once and
 *     never more than was paid, and no lock error reaches a caller.
 *
 * What it leaves: a throwaway shopper of its own (a new address each run)
 * with two cancelled and refunded orders, and a route of the second demo
 * driver, closed with every stop removed, with its ₡0 cash count open (not
 * settled: contract.test.ts counts the seed's settled ones).
 * The seed's orders, routes and the first demo driver are not touched, so it
 * passes on a used database and twice in a row.
 */

import { execFileSync } from "node:child_process";
import { deliveryFeeComesBack, ORDER_STATUSES, SHIPMENT_STATUSES } from "@yuntera/core";
import { callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const STAFF = "central@yuntera.example";
const WAREHOUSE = "bodega@yuntera.example";
const SELLER = "vendedor@yuntera.example";
const DRIVER = "repartidor2@yuntera.example";
const DEMO_SHOPPER = "comprador@yuntera.example";
const SHOPPER = `seguimiento-${Date.now()}@yuntera.example`;

// ── The store build's schemas (commit 3f251c3, packages/db/src/schemas.ts) ──
// Copied word for word; the test below compares them with that commit's file.
const id = z.uuid();
const money = z.number().int();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);
const orderStatus = z.enum(ORDER_STATUSES);
const shipmentStatus = z.enum(SHIPMENT_STATUSES);
const paymentMethod = z.enum(["card", "sinpe_movil", "cash_on_delivery", "bank_transfer"]);
const paymentStatus = z.enum([
  "pending",
  "authorized",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
const fulfillment = z.enum(["platform", "seller"]);
// BEGIN 3f251c3 orderSummary
export const orderSummary = z.object({
  order_number: z.string(),
  status: orderStatus,
  placed_at: timestamp,
  total_minor: money,
  payment_method: paymentMethod,
  promise_earliest: date,
  promise_latest: date,
  delivered_at: timestamp.nullable(),
  item_count: z.number().int(),
  first_title: z.string().nullable(),
  first_image_path: z.string().nullable(),
});
// END 3f251c3 orderSummary
// BEGIN 3f251c3 orderDetail
export const orderDetail = z.object({
  id,
  order_number: z.string(),
  status: orderStatus,
  placed_at: timestamp,
  confirmed_at: timestamp.nullable(),
  delivered_at: timestamp.nullable(),
  cancelled_at: timestamp.nullable(),
  cancel_reason: z.string().nullable(),
  items_total_minor: money,
  shipping_minor: money,
  discount_minor: money,
  total_minor: money,
  tax_included_minor: money,
  payment_method: paymentMethod,
  promise_earliest: date,
  promise_latest: date,
  withdrawal_deadline: date,
  warranty_until: date.nullable(),
  /** Present only while there is still something to hand over. */
  delivery_pin: z.string().nullable(),
  can_cancel: z.boolean(),
  address: z.object({
    recipient_name: z.string(),
    phone: z.string(),
    postal_code: z.string(),
    senas: z.string(),
    lat: z.number(),
    lng: z.number(),
    plus_code: z.string().nullable(),
    district: z.string().nullable(),
    canton: z.string().nullable(),
  }),
  payment: z
    .object({
      method: paymentMethod,
      status: paymentStatus,
      amount_minor: money,
      provider: z.string(),
      sinpe_reference: z.string().nullable(),
      captured_at: timestamp.nullable(),
    })
    .nullable(),
  items: z.array(
    z.object({
      id,
      title: z.string(),
      variant_name: z.string(),
      image_path: z.string().nullable(),
      product_slug: z.string().nullable(),
      seller_name: z.string().nullable(),
      unit_price_minor: money,
      quantity: z.number().int(),
      line_total_minor: money,
      fulfillment,
      review: z
        .object({
          rating: z.number().int(),
          title: z.string().nullable(),
          body: z.string().nullable(),
        })
        .nullable(),
      returned_quantity: z.number().int(),
    }),
  ),
  shipments: z.array(
    z.object({
      id,
      tracking_code: z.string(),
      status: shipmentStatus,
      package_count: z.number().int(),
      attempt_count: z.number().int(),
      promise_latest: date,
      delivered_at: timestamp.nullable(),
      item_ids: z.array(id).nullable(),
      driver_first_name: z.string().nullable(),
    }),
  ),
  timeline: z.array(
    z.object({
      at: timestamp,
      kind: z.enum(["order_status", "shipment_status", "payment", "note"]),
      from_status: z.string().nullable(),
      to_status: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
// END 3f251c3 orderDetail

type Order = { orderId: string; orderNumber: string; platform: string; seller: string };
type Session = { client: pg.PoolClient; pid: number };

describe.skipIf(!db.enabled)("order follow-ups (against a seeded database)", () => {
  let pool: pg.Pool;
  const ids = new Map<string, string>();
  let platformWarehouse = "";
  let routeId = "";
  const orders: Order[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
    // A shopper of this run, with the demo shopper's address as its own.
    await pool.query(
      `with u as (
         insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), $1, '{"full_name": "Prueba Contrato Seguimiento"}') returning id)
       insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
       select u.id, 'Casa', 'Prueba Contrato Seguimiento', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
       from u, public.addresses a join auth.users x on x.id = a.user_id
       where x.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null`,
      [SHOPPER],
    );
    await db.connect();
    const { rows } = await pool.query<{ email: string; id: string }>(
      "select email, id from auth.users where email = any($1)",
      [[STAFF, WAREHOUSE, SELLER, DRIVER, SHOPPER, DEMO_SHOPPER]],
    );
    for (const row of rows) ids.set(row.email, row.id);
    expect(ids.size, "database is not seeded — run pnpm db:local:reset").toBe(6);
    platformWarehouse =
      (await pool.query<{ id: string }>("select id from public.warehouses where code = 'SJO1'"))
        .rows[0]?.id ?? "";

    // Two orders, each with a parcel of the warehouse and one of a seller.
    for (const key of ["a", "b"])
      orders.push(await packedOrder(`contrato-seguimiento-${Date.now()}-${key}`));
    // The warehouse's parcels are stopped on the shelf; the sellers' go out on
    // a route of the second demo driver and are taken off it (no attempt).
    const staff = db.as(STAFF, "aal2");
    for (const order of orders) {
      const stopped = await staff.opsRecallShipment(
        order.platform,
        "Prueba del contrato: el cliente canceló",
      );
      expect(stopped).toMatchObject({
        status: "returning",
        order_number: order.orderNumber,
        route_code: null,
      });
    }
    const driver = (
      await pool.query<{ id: string }>("select id from public.drivers where user_id = $1", [
        ids.get(DRIVER),
      ])
    ).rows[0]?.id;
    routeId = await one<string>(
      STAFF,
      "select public.ops_create_route($4::date, $1::uuid, $2::jsonb, $3::uuid)::text as v",
      [
        platformWarehouse,
        JSON.stringify(orders.map((o) => ({ shipment_id: o.seller }))),
        driver,
        (await pool.query<{ d: string }>("select private.cr_today()::text as d")).rows[0]?.d,
      ],
    );
    await one(DRIVER, "select public.driver_start_route($1::uuid)::text as v", [routeId]);
    for (const order of orders) {
      const stop = (
        await pool.query<{ id: string }>(
          "select id from public.route_stops where route_id = $1 and shipment_id = $2",
          [routeId, order.seller],
        )
      ).rows[0]?.id;
      await one(
        STAFF,
        "select public.ops_remove_route_stop($1::uuid, 'Prueba del contrato: cancelado')::text as v",
        [stop],
      );
      await one(STAFF, "select public.ops_return_shipment($1::uuid)::text as v", [order.seller]);
    }
  });

  afterAll(async () => {
    // The route closed, whatever happened above.
    try {
      if (!routeId) return;
      const open = await pool.query<{ id: string; status: string }>(
        "select rs.id, r.status from public.route_stops rs join public.routes r on r.id = rs.route_id where r.id = $1 and rs.status in ('pending', 'arrived')",
        [routeId],
      );
      for (const stop of open.rows) {
        await one(
          STAFF,
          "select public.ops_remove_route_stop($1::uuid, 'Cierre del contrato')::text as v",
          [stop.id],
        );
      }
      const route = await pool.query<{ status: string }>(
        "select status from public.routes where id = $1",
        [routeId],
      );
      if (route.rows[0] && ["draft", "assigned", "in_progress"].includes(route.rows[0].status)) {
        await one(
          STAFF,
          "select public.ops_close_route($1::uuid, 'Cierre del contrato')::text as v",
          [routeId],
        );
      }
    } finally {
      await pool?.end();
      await db.close();
    }
  });

  /** Runs one statement as a person, in its own committed transaction; answers its column `v`. */
  async function one<T = unknown>(email: string, sql: string, args: unknown[] = []): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ids.get(email), role: "authenticated", aal: "aal2" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ v: T }>(sql, args);
      await client.query("commit");
      return rows[0]?.v as T;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Places, pays and packs an order of the run's shopper: a notebook (the warehouse's) and a bulb (a seller's). */
  async function packedOrder(key: string): Promise<Order> {
    // Looked up directly (the shopper's role reads no table); the order itself goes through place_order.
    const setup = (
      await pool.query<{ items: unknown; address: string }>(
        `select (select jsonb_agg(jsonb_build_object('offer_id', o.id, 'quantity', 1))
                   from public.offers o join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
                  where p.slug in ('libreta-tapa-dura-a5', 'bombillo-led-9w-4u') and k.variant_name = ''
                    and o.status = 'active') as items,
                (select a.id::text from public.addresses a where a.user_id = $1::uuid and a.is_default) as address`,
        [ids.get(SHOPPER)],
      )
    ).rows[0];
    const placed = await one<{ order_id: string; order_number: string }>(
      SHOPPER,
      "select public.place_order($1::jsonb, $2::uuid, 'card', $3) as v",
      [JSON.stringify(setup?.items), setup?.address, key],
    );
    await one(SHOPPER, "select public.confirm_sandbox_payment($1::uuid)::text as v", [
      placed.order_id,
    ]);
    const shipments = (
      await pool.query<{ id: string; kind: string }>(
        `select s.id, w.kind from public.shipments s join public.warehouses w on w.id = s.origin_warehouse_id
          where s.order_id = $1 order by w.kind`,
        [placed.order_id],
      )
    ).rows;
    const platform = shipments.find((s) => s.kind === "platform")?.id ?? "";
    const seller = shipments.find((s) => s.kind === "seller")?.id ?? "";
    expect(
      platform && seller,
      "the order has a parcel of the warehouse and one of a seller",
    ).toBeTruthy();
    await one(STAFF, "select public.wms_start_picking($1::uuid)::text as v", [platform]);
    const tasks = (
      await pool.query<{ id: string; quantity: number; code: string }>(
        `select t.id, t.quantity, k.code from public.pick_tasks t join public.skus k on k.id = t.sku_id
          where t.shipment_id = $1`,
        [platform],
      )
    ).rows;
    for (const task of tasks) {
      await one(STAFF, "select public.wms_confirm_pick($1::uuid, $2, null, $3)::text as v", [
        task.id,
        task.quantity,
        task.code,
      ]);
    }
    await one(STAFF, "select public.wms_pack_shipment($1::uuid, 900, 1::smallint)::text as v", [
      platform,
    ]);
    await one(SELLER, "select public.seller_mark_packed($1::uuid, 900, 1::smallint)::text as v", [
      seller,
    ]);
    return { orderId: placed.order_id, orderNumber: placed.order_number, platform, seller };
  }

  /** The raw answer of a function as a person, unparsed, as the store build receives it. */
  async function raw(email: string, fn: string, args: Record<string, unknown>) {
    const result = await callRpc(pool, fn, args, {
      sub: ids.get(email) ?? "",
      role: "authenticated",
      aal: "aal2",
    });
    if (!result.ok) throw new Error(`${fn}: ${JSON.stringify(result.error)}`);
    return result.data;
  }

  it("keeps the store build's schemas word for word", () => {
    let original = "";
    try {
      original = execFileSync("git", ["show", "3f251c3:packages/db/src/schemas.ts"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // A checkout without that commit (a shallow clone): the copy stands as written.
      return;
    }
    const self = execFileSync("cat", [__filename], { encoding: "utf8" });
    for (const name of ["orderSummary", "orderDetail"]) {
      const block = self.slice(
        self.indexOf(`// BEGIN 3f251c3 ${name}\n`) + `// BEGIN 3f251c3 ${name}\n`.length,
        self.indexOf(`// END 3f251c3 ${name}`),
      );
      expect(block.length).toBeGreaterThan(100);
      expect(original).toContain(block);
    }
  });

  it("answers the shopper's list and order page in the new shape and the store build's", async () => {
    const shopper = db.as(SHOPPER);
    const list = await shopper.myOrders(50);
    for (const order of orders) {
      const row = list.find((o) => o.order_number === order.orderNumber);
      expect(row?.shipments).toHaveLength(2);
      expect(row?.shipments).toEqual(
        expect.arrayContaining([
          { status: "returning", attempt_count: 0, recalled: true },
          { status: "returning", attempt_count: 0, recalled: false },
        ]),
      );
      // The order page as the shopper's own client reads it.
      const detail = await shopper.getOrder(order.orderNumber);
      const stopped = detail.shipments.find((s) => s.id === order.platform);
      expect(stopped).toMatchObject({ status: "returning", recalled: true, can_recall: false });
      expect(stopped?.units).toHaveLength(1);
      // Money is held, and no code is given while every parcel comes back.
      expect(row?.paid).toBe(true);
      expect(detail.delivery_pin).toBeNull();
      // The fee will come back: nobody went to the door (packages/core says the same).
      expect(deliveryFeeComesBack(row?.shipments ?? [])).toBe(true);
    }
    // The store build of 3f251c3: the same answers through its own schemas.
    const oldList = z
      .array(orderSummary)
      .safeParse(await raw(SHOPPER, "my_orders", { p_limit: 50 }));
    expect(oldList.success, JSON.stringify(oldList.error?.issues)).toBe(true);
    for (const order of orders) {
      const oldDetail = orderDetail.safeParse(
        await raw(SHOPPER, "get_order", { p_order_number: order.orderNumber }),
      );
      expect(oldDetail.success, JSON.stringify(oldDetail.error?.issues)).toBe(true);
    }
    // And as the demo shopper, whose list holds the seed's orders at every stage.
    const seedList = z
      .array(orderSummary)
      .safeParse(await raw(DEMO_SHOPPER, "my_orders", { p_limit: 50 }));
    expect(seedList.success, JSON.stringify(seedList.error?.issues)).toBe(true);
  });

  it("answers staff, the warehouse and the console in their schemas", async () => {
    const staff = db.as(STAFF, "aal2");
    const detail = await staff.getOrder(orders[0]?.orderNumber ?? "");
    expect(detail.delivery_pin).toBeNull();
    expect(detail.shipments.every((s) => s.can_recall === false)).toBe(true);

    const returning = await db.as(WAREHOUSE).wmsReturningShipments(platformWarehouse);
    for (const order of orders) {
      expect(returning.find((r) => r.shipment_id === order.platform)).toMatchObject({
        never_left: true,
        attempt_count: 0,
      });
    }

    const routes = await staff.opsOpenRoutes();
    const route = routes.find((r) => r.route_id === routeId);
    expect(route?.stops.every((s) => s.status === "skipped" && s.attempt_count === 0)).toBe(true);

    const cantons = await staff.opsDistrictCantons();
    expect(cantons.find((c) => c.code === "101")?.own_zone_count).toBeGreaterThanOrEqual(0);
    const districts = await staff.opsCantonDistricts("101");
    expect(districts.districts.length).toBeGreaterThan(0);
    expect(districts.districts.every((d) => typeof d.own_zone === "boolean")).toBe(true);
  });

  it("removes a single closed day and answers in its schema", async () => {
    const day = (
      await pool.query<{ day: string }>(
        `select (private.cr_today() + g)::text as day from generate_series(5, 90) g
          where not exists (select 1 from public.zone_closures c where c.zone_id = 'gam-extended' and c.day = private.cr_today() + g)
          order by g desc limit 1`,
      )
    ).rows[0]?.day;
    expect(day).toBeDefined();
    await pool.query(
      "insert into public.zone_closures (zone_id, day, reason) values ('gam-extended', $1, 'capacity')",
      [day],
    );
    const removed = await db.as(STAFF, "aal2").opsRemoveZoneClosureDay("gam-extended", day ?? "");
    expect(removed).toEqual({ zone_id: "gam-extended", day });
    const left = await pool.query(
      "select 1 from public.zone_closures where zone_id = 'gam-extended' and day = $1",
      [day],
    );
    expect(left.rowCount).toBe(0);
  });

  /** A session acting as a person, inside a transaction it keeps open. */
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

  async function waitsForLock(pid: number, ms = 5000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ waiting: boolean }>(
        "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
        [pid],
      );
      if (rows[0]?.waiting) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  const outcome = (query: Promise<pg.QueryResult<{ v: { delivery_fee_refund_minor: number } }>>) =>
    query.then(
      (result) => ({ error: "", fee: Number(result.rows[0]?.v.delivery_fee_refund_minor ?? 0) }),
      (error: Error & { code?: string }) => ({
        error:
          error.code === "40P01" || error.code === "40001" ? `LOCK ${error.code}` : error.message,
        fee: 0,
      }),
    );

  const RECEIVE = "select public.wms_receive_returned_shipment($1::uuid, true, null) as v";

  it.each([
    ["the warehouse's parcel first", 0, "platform", "seller"],
    ["the seller's parcel first", 1, "seller", "platform"],
  ] as const)(
    "gives the fee back once when both parcels are received at the same moment (%s)",
    async (_label, index, firstParcel, secondParcel) => {
      const order = orders[index];
      if (!order) throw new Error("no order");
      // The warehouse receives its own parcel; Central (operations) the seller's.
      const who = (parcel: "platform" | "seller") => (parcel === "platform" ? WAREHOUSE : STAFF);
      const a = await session(who(firstParcel));
      const b = await session(who(secondParcel));
      try {
        const first = await outcome(a.client.query(RECEIVE, [order[firstParcel]]));
        expect(first.error).toBe("");
        const later = outcome(b.client.query(RECEIVE, [order[secondParcel]]));
        // The second waits for the first (the order's row), then runs on.
        expect(await waitsForLock(b.pid)).toBe(true);
        await a.client.query("commit");
        const second = await later;
        expect(second.error).toBe("");
        await b.client.query("commit");
        const shipping = Number(
          (
            await pool.query<{ s: string }>(
              "select shipping_minor::text as s from public.orders where id = $1",
              [order.orderId],
            )
          ).rows[0]?.s,
        );
        expect(shipping).toBeGreaterThan(0);
        // Only the last one gives the fee back, once.
        expect([first.fee, second.fee]).toEqual([0, shipping]);
      } finally {
        await a.client.query("rollback").catch(() => undefined);
        await b.client.query("rollback").catch(() => undefined);
        a.client.release();
        b.client.release();
      }
      const { rows } = await pool.query<{
        fees: string;
        refunded: string;
        collected: string;
        payment: string;
        order: string;
        unbalanced: string;
      }>(
        `select (select count(*) from private.refunds where order_id = $1 and reason = 'delivery_fee')::text as fees,
                private.refunded_minor($1)::text as refunded, private.order_collected_minor($1)::text as collected,
                (select status::text from public.payments where order_id = $1 order by created_at desc limit 1) as payment,
                (select status::text from public.orders where id = $1) as order,
                (select count(*) from (select e.transaction_id from public.ledger_entries e
                   join public.ledger_transactions t on t.id = e.transaction_id
                  where t.order_id = $1 group by e.transaction_id having sum(e.amount_minor) <> 0) x)::text as unbalanced`,
        [order.orderId],
      );
      expect(rows[0]).toEqual({
        fees: "1",
        refunded: rows[0]?.collected,
        collected: rows[0]?.collected,
        payment: "refunded",
        order: "refunded",
        unbalanced: "0",
      });
      // The shopper's page, as the client reads it, says so.
      const page = await db.as(SHOPPER).getOrder(order.orderNumber);
      expect(page.status).toBe("refunded");
      expect(page.timeline.some((e) => e.note?.startsWith("Le devolvemos también el envío"))).toBe(
        true,
      );
    },
  );
});
