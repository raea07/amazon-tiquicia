/**
 * Product rows, shelves and routes taken in one order, from real sessions
 * (20261121084400_stock_lock_order.sql). Each race is made to happen, not
 * hoped for: a third session holds the row one writer needs, the other
 * writer starts while it waits, then the third session lets go. Without the
 * fixes in 084400 each of these ended with a deadlock (40P01) for one of the
 * two, or with a wrong listing or a unit lost; the 100-round runs are in
 * tools/races (families C, E, F and G).
 *
 *   (i)   a sale that leaves an offer in stock (5 units to 4) never waits for
 *         its product's row: the summary depends on whether an offer has
 *         units, not on how many, so the product row is not written;
 *   (ii)  two checkouts that take the last unit of two different offers of
 *         one product at once: the product ends out of stock (before 084400
 *         the second wrote a summary computed before the first committed);
 *   (iii) a staff cancellation of a picked order against a count of the same
 *         product on the same shelf (the cancellation took the shelf before
 *         the stock row; a count takes the stock row first);
 *   (iv)  a staff cancellation of a half-picked order against the picker
 *         confirming its other line: the unit picked comes back too;
 *   (v)   staff stopping a parcel while its driver starts the route.
 *
 * Fixtures are this file's own: two products with chosen ids (X with two
 * variants, Z sold by two shops), a shelf in SJO1, a shopper, a driver of its
 * own (so the demo driver's day is untouched) and, for (v), two packed cash
 * orders planned on one route. Races (i), (iii) and (v) are rolled back;
 * (ii) and (iv) commit and are undone after each round. At the end the
 * route's parcels are stopped and checked back in and the route is closed;
 * the file's cancelled orders are deleted. The suite passes on a used
 * database and twice in a row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const db = contractDatabase();
const SHOPPER = "carrera-producto@yuntera.example";
const DRIVER = "carrera-conductor@yuntera.example";
const STAFF = "central@yuntera.example";
const WORKER = "bodega@yuntera.example";
const SHELF = "C8-01";
const ROUNDS = 3;

const id = (n: number) => `c8000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const PRODUCT_X = id(0x0a);
const PRODUCT_Z = id(0x0b);
const SKU = { x1: id(0x101), x2: id(0x102), z: id(0x103) };
const OFFER = { x1: id(0x201), x2: id(0x202), z1: id(0x203), z2: id(0x204) };

type Session = { client: pg.PoolClient; pid: number };

describe.skipIf(!db.enabled)(
  "product rows, shelves and routes taken in one order (against a seeded database)",
  () => {
    let pool: pg.Pool;
    const users = new Map<string, string>();
    let warehouseId = "";
    let shelfId = "";
    let sendero = "";
    let cafetal = "";

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
      await db.connect();
      for (const [email, name] of [
        [SHOPPER, "Prueba Carrera Producto"],
        [DRIVER, "Prueba Carrera Conductor"],
      ] as const) {
        await db.query(
          `insert into auth.users (id, email, raw_user_meta_data)
           select gen_random_uuid(), $1::text, jsonb_build_object('full_name', $2::text)
            where not exists (select 1 from auth.users where email = $1::text)`,
          [email, name],
        );
      }
      await db.query(
        `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
         select s.id, 'Casa', 'Prueba Carrera Producto', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
           from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
          where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
            and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
        [SHOPPER],
      );
      await db.query(
        `insert into public.drivers (user_id, status, full_name, phone, id_number, vehicle_type, plate, capacity_kg,
                                     license_class, license_expires_on, inspection_expires_on, insurance_expires_on)
         select u.id, 'active', 'Prueba Carrera Conductor', '+50688990099', '199990001', 'motorcycle', 'MOT-990099', 40,
                'A2', current_date + 400, current_date + 200, current_date + 300
           from auth.users u where u.email = $1
         on conflict (user_id) do update set status = 'active'`,
        [DRIVER],
      );
      const { rows } = await db.query<{ email: string; id: string }>(
        "select email, id from auth.users where email = any($1)",
        [[SHOPPER, DRIVER, STAFF, WORKER]],
      );
      for (const row of rows) users.set(row.email, row.id);

      const one = async <T extends pg.QueryResultRow>(sql: string, args: unknown[] = []) =>
        (await db.query<T>(sql, args)).rows[0] as T;
      warehouseId = (
        await one<{ id: string }>("select id from public.warehouses where code = 'SJO1'")
      ).id;
      sendero = (
        await one<{ id: string }>("select id from public.sellers where slug = 'tienda-sendero'")
      ).id;
      cafetal = (
        await one<{ id: string }>("select id from public.sellers where slug = 'cafetal-los-santos'")
      ).id;
      shelfId = (
        await one<{ id: string }>(
          `insert into public.warehouse_locations (warehouse_id, code, kind, active) values ($1, $2, 'storage', true)
           on conflict (warehouse_id, code) do update set active = true, kind = 'storage' returning id`,
          [warehouseId, SHELF],
        )
      ).id;
      const like = await one<{ category_id: string; brand_id: string | null }>(
        "select category_id, brand_id from public.products where slug = 'balon-futbol-sendero-5'",
      );
      for (const [pid, slug, title] of [
        [PRODUCT_X, "carrera-contrato-producto-x", "Producto X de la prueba de contrato"],
        [PRODUCT_Z, "carrera-contrato-producto-z", "Producto Z de la prueba de contrato"],
      ]) {
        await db.query(
          `insert into public.products (id, slug, title, description, category_id, brand_id, status, created_by_seller_id)
           values ($1, $2, $3, 'Prueba de contrato.', $4, $5, 'active', $6)
           on conflict (id) do update set status = 'active'`,
          [pid, slug, title, like.category_id, like.brand_id, sendero],
        );
      }
      for (const [sku, product, code] of [
        [SKU.x1, PRODUCT_X, "CARRERA-C-X1"],
        [SKU.x2, PRODUCT_X, "CARRERA-C-X2"],
        [SKU.z, PRODUCT_Z, "CARRERA-C-Z"],
      ]) {
        await db.query(
          `insert into public.skus (id, product_id, code, weight_grams, length_cm, width_cm, height_cm)
           values ($1, $2, $3, 500, 20, 15, 10) on conflict (id) do update set active = true`,
          [sku, product, code],
        );
      }
      for (const [offer, sku, seller, price] of [
        [OFFER.x1, SKU.x1, sendero, 1200000],
        [OFFER.x2, SKU.x2, sendero, 1300000],
        [OFFER.z1, SKU.z, sendero, 1400000],
        [OFFER.z2, SKU.z, cafetal, 1500000],
      ] as const) {
        await db.query(
          `insert into public.offers (id, sku_id, seller_id, price_minor, fulfillment, handling_days, status)
           values ($1, $2, $3, $4, 'platform', 0, 'active')
           on conflict (id) do update set status = 'active', price_minor = excluded.price_minor`,
          [offer, sku, seller, price],
        );
        await db.query(
          `insert into public.stock_levels (warehouse_id, sku_id, seller_id, on_hand) values ($1, $2, $3, 0)
           on conflict do nothing`,
          [warehouseId, sku, seller],
        );
      }
      await cleanUp();
    });

    afterAll(async () => {
      await cleanUp().catch(() => undefined);
      await pool?.end();
      await db.close();
    });

    /** Open orders of this file cancelled, then deleted; its route closed. */
    async function cleanUp() {
      const { rows } = await db.query<{ id: string }>(
        `select o.id from public.orders o join auth.users u on u.id = o.user_id
          where u.email = $1 and o.status in ('pending_payment', 'payment_review', 'confirmed', 'processing')
            and not exists (select 1 from public.shipments s where s.order_id = o.id
                            and s.status not in ('pending', 'picking', 'cancelled'))`,
        [SHOPPER],
      );
      for (const row of rows) {
        await db.query("select private.cancel_order_internal($1, 'Prueba de contrato')", [row.id]);
      }
      await db.query(
        `delete from public.orders o using auth.users u
          where u.id = o.user_id and u.email = $1 and o.status = 'cancelled'
            and not exists (select 1 from public.shipments s where s.order_id = o.id and s.status = 'returned')`,
        [SHOPPER],
      );
    }

    /** The shelf of the products set to `units` each, on hand to match, nothing reserved. */
    async function layout(units: Record<string, number>) {
      await cleanUp();
      for (const [sku, seller, n] of [
        [SKU.x1, sendero, units.x1 ?? 0],
        [SKU.x2, sendero, units.x2 ?? 0],
        [SKU.z, sendero, units.z1 ?? 0],
        [SKU.z, cafetal, units.z2 ?? 0],
      ] as const) {
        // Every location of SJO1 (units checked back in by (v) land in the returns area).
        await db.query(
          `delete from public.bin_stock b using public.warehouse_locations wl
            where wl.id = b.location_id and wl.warehouse_id = $1 and b.sku_id = $2 and b.seller_id = $3`,
          [warehouseId, sku, seller],
        );
        if (n > 0) {
          await db.query(
            "insert into public.bin_stock (location_id, sku_id, seller_id, quantity) values ($1, $2, $3, $4)",
            [shelfId, sku, seller, n],
          );
        }
        await db.query(
          `update public.stock_levels l set on_hand = $4, reserved = 0
            where l.warehouse_id = $1 and l.sku_id = $2 and l.seller_id = $3`,
          [warehouseId, sku, seller, n],
        );
      }
    }

    /** A transaction kept open: as a demo user, or (null) as the database owner. */
    async function session(email: string | null): Promise<Session> {
      const client = await pool.connect();
      await client.query("begin");
      if (email) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: users.get(email), role: "authenticated", aal: "aal2" }),
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

    async function finish(...sessions: Session[]) {
      for (const s of sessions) {
        await s.client.query("rollback").catch(() => undefined);
        s.client.release();
      }
    }

    const address = async () =>
      (
        await db.query<{ id: string }>(
          "select a.id from public.addresses a join auth.users u on u.id = a.user_id where u.email = $1 and a.is_default and a.deleted_at is null",
          [SHOPPER],
        )
      ).rows[0]?.id ?? "";
    let keys = 0;
    const placeSql = "select public.place_order($1::jsonb, $2, $3::public.payment_method, $4)";
    const placeArgs = async (lines: [string, number][], method: "card" | "cash_on_delivery") => [
      JSON.stringify(lines.map(([offer, quantity]) => ({ offer_id: offer, quantity }))),
      await address(),
      method,
      `carrera-producto-${Date.now()}-${keys++}`,
    ];

    /** A cash order (released at once), its picking started, the first `picked` lines picked. */
    async function cashInPicking(lines: [string, number][], picked: number) {
      const placed = await run(
        SHOPPER,
        `${placeSql} as r`,
        await placeArgs(lines, "cash_on_delivery"),
      );
      const order = (placed as { r: { order_id: string } }).r.order_id;
      const shipment =
        (
          await db.query<{ id: string }>("select id from public.shipments where order_id = $1", [
            order,
          ])
        ).rows[0]?.id ?? "";
      await run(WORKER, "select public.wms_start_picking($1)", [shipment]);
      const { rows: tasks } = await db.query<{
        id: string;
        quantity: number;
        code: string;
        location_id: string;
      }>(
        `select t.id, t.quantity, k.code, t.location_id from public.pick_tasks t join public.skus k on k.id = t.sku_id
          where t.shipment_id = $1 order by t.sku_id`,
        [shipment],
      );
      for (const t of tasks.slice(0, picked)) {
        await run(WORKER, "select public.wms_confirm_pick($1, $2, null, $3)", [
          t.id,
          t.quantity,
          t.code,
        ]);
      }
      return { order, shipment, tasks };
    }

    /** One call as a user, committed. */
    async function run(email: string | null, sql: string, args: unknown[]) {
      const s = await session(email);
      try {
        const res = await s.client.query(sql, args);
        await s.client.query("commit");
        return res.rows[0];
      } finally {
        await s.client.query("rollback").catch(() => undefined);
        s.client.release();
      }
    }

    const summary = async (product: string) =>
      (
        await db.query<{ stored: unknown; computed: unknown }>(
          `select jsonb_build_object('featured', p.featured_offer_id, 'in_stock', p.in_stock, 'min', p.min_price_minor,
                    'count', p.offer_count) as stored,
                  (select jsonb_build_object('featured', b.id, 'in_stock', coalesce(b.available_quantity > 0, false),
                     'min', b.price_minor,
                     'count', (select count(*) from public.offers o join public.skus k on k.id = o.sku_id
                               join public.sellers s on s.id = o.seller_id
                               where k.product_id = p.id and k.active and o.status = 'active' and s.status = 'active'))
                     from (select 1) one left join lateral (
                       select o.* from public.offers o join public.skus k on k.id = o.sku_id
                       join public.sellers s on s.id = o.seller_id
                       where k.product_id = p.id and k.active and o.status = 'active' and s.status = 'active'
                         and o.condition = 'new'
                       order by o.available_quantity > 0 desc, o.price_minor, o.created_at, o.id limit 1) b on true) as computed
             from public.products p where p.id = $1`,
          [product],
        )
      ).rows[0];

    it("(i) a sale that leaves the offer in stock does not wait for its product's row", async () => {
      await layout({ x1: 5 });
      for (let round = 0; round < ROUNDS; round++) {
        const holder = await session(null);
        const shopper = await session(SHOPPER);
        try {
          await holder.client.query(
            "select 1 from public.products where id = $1 for no key update",
            [PRODUCT_X],
          );
          const buying = outcome(
            shopper.client.query(placeSql, await placeArgs([[OFFER.x1, 1]], "card")),
          );
          const settled = await Promise.race([
            buying,
            new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 3000)),
          ]);
          expect(settled, `round ${round}`).toBe("");
        } finally {
          await finish(holder, shopper);
        }
      }
    });

    it("(ii) two checkouts of the last unit of two offers of one product leave it out of stock", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await layout({ z1: 1, z2: 1 });
        const holder = await session(null);
        const one = await session(SHOPPER);
        const two = await session(SHOPPER);
        try {
          // A third session holds the product row as a refresh does; both
          // checkouts reach their refresh while it is held.
          await holder.client.query(
            "select 1 from public.products where id = $1 for no key update",
            [PRODUCT_Z],
          );
          const first = outcome(
            one.client
              .query(placeSql, await placeArgs([[OFFER.z1, 1]], "card"))
              .then(() => one.client.query("commit")),
          );
          expect(await waitsForLock(one.pid), `round ${round}: first waited`).toBe(true);
          const second = outcome(
            two.client
              .query(placeSql, await placeArgs([[OFFER.z2, 1]], "card"))
              .then(() => two.client.query("commit")),
          );
          expect(await waitsForLock(two.pid), `round ${round}: second waited`).toBe(true);
          await holder.client.query("rollback");
          expect([await first, await second], `round ${round}`).toEqual(["", ""]);
          const s = await summary(PRODUCT_Z);
          expect(s?.stored, `round ${round}: the summary`).toEqual(s?.computed);
          expect(
            (s?.stored as { in_stock: boolean } | undefined)?.in_stock,
            `round ${round}: out of stock`,
          ).toBe(false);
        } finally {
          await finish(holder, one, two);
        }
      }
      await cleanUp();
      const s = await summary(PRODUCT_Z);
      expect(s?.stored).toEqual(s?.computed);
    });

    it("(iii) a staff cancellation of a picked order and a count of the same shelf", async () => {
      await layout({ x2: 10 });
      const held = await cashInPicking([[OFFER.x2, 2]], 1);
      for (let round = 0; round < ROUNDS; round++) {
        const holder = await session(null);
        const cancel = await session(STAFF);
        const count = await session(WORKER);
        try {
          // The cancellation stops at its reservations, after its first locks.
          await holder.client.query(
            `select 1 from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
              where i.order_id = $1 for share of r`,
            [held.order],
          );
          const cancelling = outcome(
            cancel.client.query("select public.cancel_order($1, 'Prueba de contrato')", [
              held.order,
            ]),
          );
          expect(await waitsForLock(cancel.pid), `round ${round}: cancellation waited`).toBe(true);
          const counting = outcome(
            count.client.query(
              "select public.wms_adjust_stock($1, $2, $3, 1, 'Conteo de la prueba de contrato', null)",
              [shelfId, SKU.x2, sendero],
            ),
          );
          expect(await waitsForLock(count.pid), `round ${round}: count waited`).toBe(true);
          await holder.client.query("rollback");
          expect(await cancelling, `round ${round}: cancellation`).toBe("");
          await cancel.client.query("rollback");
          expect(await counting, `round ${round}: count`).toBe("");
        } finally {
          await finish(holder, cancel, count);
        }
      }
    });

    it("(iv) a staff cancellation of a half-picked order and a pick of its other line", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await layout({ x1: 10, x2: 10 });
        const x = await cashInPicking(
          [
            [OFFER.x1, 1],
            [OFFER.x2, 1],
          ],
          1,
        );
        const second = x.tasks[1];
        if (!second) throw new Error("fixture: two tasks");
        const holder = await session(null);
        const pick = await session(WORKER);
        const cancel = await session(STAFF);
        try {
          // The pick takes its task, then waits for its shelf row.
          await holder.client.query(
            "select 1 from public.bin_stock where location_id = $1 and sku_id = $2 and seller_id = $3 for share",
            [second.location_id, SKU.x2, sendero],
          );
          const picking = outcome(
            pick.client
              .query("select public.wms_confirm_pick($1, $2, null, $3)", [
                second.id,
                second.quantity,
                second.code,
              ])
              .then(() => pick.client.query("commit")),
          );
          expect(await waitsForLock(pick.pid), `round ${round}: pick waited`).toBe(true);
          const cancelling = outcome(
            cancel.client
              .query("select public.cancel_order($1, 'Prueba de contrato')", [x.order])
              .then(() => cancel.client.query("commit")),
          );
          expect(await waitsForLock(cancel.pid), `round ${round}: cancellation waited`).toBe(true);
          await holder.client.query("rollback");
          expect([await picking, await cancelling], `round ${round}`).toEqual(["", ""]);
          // Both units are back on their shelves: on hand is the shelves again.
          const { rows } = await db.query<{ on_hand: number; shelves: number }>(
            `select l.on_hand, (select coalesce(sum(b.quantity), 0)::int from public.bin_stock b
                                 join public.warehouse_locations wl on wl.id = b.location_id
                                where wl.warehouse_id = l.warehouse_id and b.sku_id = l.sku_id and b.seller_id = l.seller_id) as shelves
               from public.stock_levels l where l.warehouse_id = $1 and l.seller_id = $2 and l.sku_id = any($3)`,
            [warehouseId, sendero, [SKU.x1, SKU.x2]],
          );
          for (const row of rows)
            expect(row.on_hand, `round ${round}: a unit picked and not put back`).toBe(row.shelves);
        } finally {
          await finish(holder, pick, cancel);
        }
      }
    });

    it("(v) staff stopping a parcel while its driver starts the route", async () => {
      await layout({ x1: 10, z1: 10 });
      const parcels: string[] = [];
      for (const offer of [OFFER.x1, OFFER.z1]) {
        const x = await cashInPicking([[offer, 1]], 1);
        await run(WORKER, "select public.wms_pack_shipment($1, 900, 1::smallint)", [x.shipment]);
        parcels.push(x.shipment);
      }
      const driverId =
        (
          await db.query<{ id: string }>("select d.id from public.drivers d where d.user_id = $1", [
            users.get(DRIVER),
          ])
        ).rows[0]?.id ?? "";
      const today =
        (await db.query<{ d: string }>("select private.cr_today()::text as d")).rows[0]?.d ?? "";
      const route = (
        await run(STAFF, "select public.ops_create_route($1::date, $2, $3::jsonb, $4) as id", [
          today,
          warehouseId,
          JSON.stringify(parcels.map((shipment_id) => ({ shipment_id }))),
          driverId,
        ])
      ).id as string;
      try {
        for (let round = 0; round < ROUNDS; round++) {
          const holder = await session(null);
          const start = await session(DRIVER);
          const recall = await session(STAFF);
          try {
            await holder.client.query("select 1 from public.routes where id = $1 for share", [
              route,
            ]);
            const starting = outcome(
              start.client.query("select public.driver_start_route($1)", [route]),
            );
            expect(await waitsForLock(start.pid), `round ${round}: start waited`).toBe(true);
            const recalling = outcome(
              recall.client.query("select public.ops_recall_shipment($1, 'Prueba de contrato')", [
                parcels[0],
              ]),
            );
            expect(await waitsForLock(recall.pid), `round ${round}: stop waited`).toBe(true);
            await holder.client.query("rollback");
            expect(await starting, `round ${round}: start`).toBe("");
            await start.client.query("rollback");
            expect(await recalling, `round ${round}: stop`).toBe("");
          } finally {
            await finish(holder, start, recall);
          }
        }
      } finally {
        // The parcels come back to the building and the route is closed.
        for (const shipment of parcels) {
          await run(
            STAFF,
            "select public.ops_recall_shipment($1, 'Fin de la prueba de contrato')",
            [shipment],
          );
          await run(WORKER, "select public.wms_receive_returned_shipment($1, true, null)", [
            shipment,
          ]);
        }
        await run(STAFF, "select public.ops_close_route($1, 'Fin de la prueba de contrato')", [
          route,
        ]);
      }
    });
  },
);
