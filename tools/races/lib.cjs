/*
 * Shared harness for the stock-lock races. See README.md.
 *
 * Everything here talks to ONE local database given by URL: a lane's database
 * (yuntera_lane1 .. yuntera_lane19, or a lane's scratch copy such as
 * yuntera_lane12_pre) on 127.0.0.1 or localhost. It never reads a hosted
 * project. Passwords are the local defaults of the lanes.
 */
"use strict";

const path = require("node:path");
const { createRequire } = require("node:module");

// The checkout this harness lives in (tools/races).
const CHECKOUT = path.resolve(__dirname, "../..");
// The pg module packages/db depends on, resolved from that package.
const pg = createRequire(path.join(CHECKOUT, "packages/db/package.json"))("pg");

const BARRIER = 7_707_001; // advisory lock key every racer of a round waits on
const TIMEOUT = "20s"; // statement_timeout of every racer
const SHOPPERS = 8;
const SHOPPER = (n) => `carrera-w7-${n}@yuntera.example`;
const STAFF = "central@yuntera.example";
const WORKER = "bodega@yuntera.example";
// Demo users some families act as: the driver of family G, the owner of Tienda Sendero (E).
const OTHERS = ["repartidor@yuntera.example", "sendero@yuntera.example"];
const LOCATIONS = ["W7-01", "W7-02", "W7-03"];
const RAISED = {
  max_unpaid_orders_per_account: 100000,
  max_held_units_per_account: 1000000,
  max_open_cod_orders_new_account: 100000,
  max_units_per_line: 100000,
};

function args() {
  const url = process.argv[2];
  const rounds = Number(process.argv[3] || 100);
  const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
  if (!url || !/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    console.error(
      "usage: node <race>.cjs postgres://...@127.0.0.1:5432/<db> [rounds] [scenario-regex]",
    );
    console.error("Only a local database (127.0.0.1 or localhost) is accepted.");
    process.exit(2);
  }
  if (!laneDatabase(url)) {
    console.error(
      "Refusing: the database must be a lane's own (yuntera_lane1 .. yuntera_lane19, or such a name",
    );
    console.error(
      "followed by _<word>, e.g. yuntera_lane12_pre). Lane 0 (yuntera_local) and every other database",
    );
    console.error("are refused: each round cancels open orders and rewrites shelves.");
    process.exit(2);
  }
  return { url, rounds, only };
}

/** The database name of a URL is a lane's own: yuntera_lane1..19, optionally _suffix. Never lane 0's. */
function laneDatabase(url) {
  let name;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return false;
  }
  return /^yuntera_lane([1-9]|1[0-9])(_[a-z0-9]+)?$/.test(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Harness {
  constructor(url) {
    this.url = url;
    this.pool = new pg.Pool({ connectionString: url, max: 30 });
    this.ids = new Map();
    this.offers = new Map(); // key -> {id, sku_id, seller_id, sku_code, slug}
    this.loc = new Map();
    this.savedSettings = {};
  }

  q(sql, params) {
    return this.pool.query(sql, params);
  }

  async setup() {
    const one = async (sql, p) => (await this.q(sql, p)).rows[0];
    this.warehouseId = (await one("select id from public.warehouses where code = 'SJO1'")).id;
    // Shoppers of the harness's own, with the demo shopper's address.
    for (let n = 1; n <= SHOPPERS; n++) {
      await this.q(
        `insert into auth.users (id, email, raw_user_meta_data)
         select gen_random_uuid(), $1::text, '{"full_name": "Prueba Carrera Siete"}'
          where not exists (select 1 from auth.users where email = $1::text)`,
        [SHOPPER(n)],
      );
      await this.q(
        `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
         select s.id, 'Casa', 'Prueba Carrera Siete', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
           from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
          where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
            and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
        [SHOPPER(n)],
      );
    }
    const users = await this.q(
      `select u.email, u.id, (select a.id from public.addresses a where a.user_id = u.id and a.is_default and a.deleted_at is null) as address
         from auth.users u where u.email = any($1)`,
      [[STAFF, WORKER, ...OTHERS, ...Array.from({ length: SHOPPERS }, (_, i) => SHOPPER(i + 1))]],
    );
    this.address = new Map();
    for (const row of users.rows) {
      this.ids.set(row.email, row.id);
      this.address.set(row.email, row.address);
    }
    if (!this.ids.get(STAFF) || !this.ids.get(WORKER)) throw new Error("database is not seeded");

    // Limits on unpaid orders per account raised for the harness (restored at the end).
    for (const [key, value] of Object.entries(RAISED)) {
      const row = await one("select value from public.app_settings where key = $1", [key]);
      this.savedSettings[key] = row ? row.value : null;
      await this.q("update public.app_settings set value = $2::jsonb where key = $1", [
        key,
        JSON.stringify(value),
      ]);
    }

    // Every platform offer of the seed with no reservation of the seed's own orders.
    const offers = await this.q(
      `select o.id, o.sku_id, o.seller_id, k.code as sku_code, p.slug, s.slug as shop
         from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id join public.sellers s on s.id = o.seller_id
        where o.fulfillment = 'platform' and o.status = 'active'
        order by o.sku_id, o.seller_id`,
    );
    const seedReserved = new Set(
      (
        await this.q(
          `select distinct r.sku_id || '/' || r.seller_id as k from public.inventory_reservations r
             join public.order_items i on i.id = r.order_item_id join public.orders o on o.id = i.order_id
             join auth.users u on u.id = o.user_id
            where r.status = 'active' and u.email not like 'carrera-w7-%'`,
        )
      ).rows.map((r) => r.k),
    );
    this.pool20 = [];
    for (const o of offers.rows) {
      if (seedReserved.has(`${o.sku_id}/${o.seller_id}`)) continue;
      if (o.slug === "balon-futbol-sendero-5" && o.shop === "tienda-sendero")
        this.offers.set("balon", o);
      if (o.slug === "rompecabezas-volcanes-500" && o.shop === "tienda-sendero")
        this.offers.set("puzzle", o);
      this.pool20.push(o);
    }
    const [lowKey, highKey] =
      this.offers.get("balon").sku_id < this.offers.get("puzzle").sku_id
        ? ["balon", "puzzle"]
        : ["puzzle", "balon"];
    this.offers.set("low", this.offers.get(lowKey));
    this.offers.set("high", this.offers.get(highKey));
    // The product that sorts first, also sold from the warehouse by a second shop.
    const cafetal = (await one("select id from public.sellers where slug = 'cafetal-los-santos'"))
      .id;
    const low = this.offers.get("low");
    let second = await one(
      "select o.id, o.sku_id, o.seller_id from public.offers o where o.sku_id = $1 and o.seller_id = $2",
      [low.sku_id, cafetal],
    );
    if (!second) {
      second = await one(
        `insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days, status)
         select o.sku_id, $2, o.price_minor, 'platform', o.handling_days, 'active' from public.offers o where o.id = $1
         returning id, sku_id, seller_id`,
        [low.id, cafetal],
      );
    }
    await this.q(
      `insert into public.stock_levels (warehouse_id, sku_id, seller_id, on_hand) values ($1, $2, $3, 0)
       on conflict do nothing`,
      [this.warehouseId, second.sku_id, second.seller_id],
    );
    this.offers.set("second", { ...second, sku_code: low.sku_code, slug: low.slug });
    this.pool20 = this.pool20
      .filter((o) => ![low.id, this.offers.get("high").id, second.id].includes(o.id))
      .filter(
        (o, i, all) =>
          all.findIndex((x) => x.sku_id === o.sku_id && x.seller_id === o.seller_id) === i,
      )
      .slice(0, 20);

    // Twenty products for the large sweep: when the seed has fewer free ones, the
    // second shop also sells some of them from the warehouse (as "second" above).
    for (const o of offers.rows) {
      if (this.pool20.length >= 20) break;
      if (o.shop === "cafetal-los-santos" || seedReserved.has(`${o.sku_id}/${o.seller_id}`))
        continue;
      if ([low.sku_id, this.offers.get("high").sku_id].includes(o.sku_id)) continue;
      if (this.pool20.some((x) => x.sku_id === o.sku_id && x.seller_id === cafetal)) continue;
      let extra = await one(
        "select o.id, o.sku_id, o.seller_id from public.offers o where o.sku_id = $1 and o.seller_id = $2",
        [o.sku_id, cafetal],
      );
      if (!extra) {
        extra = await one(
          `insert into public.offers (sku_id, seller_id, price_minor, fulfillment, handling_days, status)
           select o.sku_id, $2, o.price_minor, 'platform', o.handling_days, 'active' from public.offers o where o.id = $1
           returning id, sku_id, seller_id`,
          [o.id, cafetal],
        );
      }
      await this.q(
        "insert into public.stock_levels (warehouse_id, sku_id, seller_id, on_hand) values ($1, $2, $3, 0) on conflict do nothing",
        [this.warehouseId, extra.sku_id, extra.seller_id],
      );
      this.pool20.push({ ...extra, sku_code: o.sku_code, slug: `${o.slug}@cafetal` });
    }
    if (this.pool20.length < 20)
      throw new Error(`only ${this.pool20.length} products for the large sweep`);

    for (const code of LOCATIONS) {
      const row = await one(
        `insert into public.warehouse_locations (warehouse_id, code, kind, active)
         values ($1, $2, 'storage', true)
         on conflict (warehouse_id, code) do update set active = true, kind = 'storage' returning id`,
        [this.warehouseId, code],
      );
      this.loc.set(code, row.id);
    }
    this.loc.set(
      "DEV-01",
      (
        await one(
          "select id from public.warehouse_locations where warehouse_id = $1 and code = 'DEV-01'",
          [this.warehouseId],
        )
      ).id,
    );
    // Anything the seed left expired is cleared first, so a sweep's count is the harness's own.
    const cleared = (await one("select private.expire_unpaid_orders() as n")).n;
    if (cleared) {
      process.stdout.write(
        `setup: the sweep cancelled ${cleared} expired order(s) left in the database\n`,
      );
    }
  }

  async teardown() {
    try {
      await this.cancelAll();
      for (const [key, value] of Object.entries(this.savedSettings)) {
        if (value !== null)
          await this.q("update public.app_settings set value = $2::jsonb where key = $1", [
            key,
            JSON.stringify(value),
          ]);
      }
    } finally {
      await this.pool.end();
    }
  }

  /** Every open order of the harness's shoppers cancelled (packed ones stay: they hold no reservation). */
  async cancelAll() {
    const { rows } = await this.q(
      `select o.id from public.orders o join auth.users u on u.id = o.user_id
        where u.email like 'carrera-w7-%' and o.status in ('pending_payment', 'payment_review', 'confirmed', 'processing')
          and not exists (select 1 from public.shipments s where s.order_id = o.id and s.status not in ('pending', 'picking', 'cancelled'))`,
    );
    for (const row of rows) {
      await this.q("select private.cancel_order_internal($1, 'Prueba de carrera siete')", [row.id]);
    }
  }

  /**
   * The shelves of the products put to a known layout: bins of these products in
   * SJO1 replaced by `layout` ({code: units}), on_hand made the bins plus the units
   * picked into open parcels, reserved made the active reservations. Direct writes
   * as the database owner (the ledger is not written for them).
   */
  async layout(keys, layout) {
    await this.cancelAll();
    for (const key of keys) {
      const o = this.offer(key);
      await this.q(
        `delete from public.bin_stock b using public.warehouse_locations l
          where l.id = b.location_id and l.warehouse_id = $1 and b.sku_id = $2 and b.seller_id = $3`,
        [this.warehouseId, o.sku_id, o.seller_id],
      );
      for (const [code, units] of Object.entries(layout)) {
        if (units > 0) {
          await this.q(
            "insert into public.bin_stock (location_id, sku_id, seller_id, quantity) values ($1, $2, $3, $4)",
            [this.loc.get(code), o.sku_id, o.seller_id, units],
          );
        }
      }
      await this.q(
        `update public.stock_levels l
            set on_hand = (select coalesce(sum(b.quantity), 0) from public.bin_stock b join public.warehouse_locations wl on wl.id = b.location_id
                            where wl.warehouse_id = l.warehouse_id and b.sku_id = l.sku_id and b.seller_id = l.seller_id)
                        + ${PICKED_OPEN},
                reserved = (select coalesce(sum(r.quantity), 0) from public.inventory_reservations r
                             where r.warehouse_id = l.warehouse_id and r.sku_id = l.sku_id and r.seller_id = l.seller_id and r.status = 'active')
          where l.warehouse_id = $1 and l.sku_id = $2 and l.seller_id = $3`,
        [this.warehouseId, o.sku_id, o.seller_id],
      );
    }
  }

  /**
   * The harness's own products, built as the database owner with ids chosen
   * here, so every database build gets the same lock order (the seed's ids are
   * random). Idempotent. See FIXTURE below for what each one is for.
   */
  async ownFixture() {
    if (this.offers.has("x1")) return;
    const one = async (sql, p) => (await this.q(sql, p)).rows[0];
    const sendero = (await one("select id from public.sellers where slug = 'tienda-sendero'")).id;
    const cafetal = (await one("select id from public.sellers where slug = 'cafetal-los-santos'"))
      .id;
    const like = await one(
      "select category_id, brand_id from public.products where slug = 'balon-futbol-sendero-5'",
    );
    for (const p of FIXTURE.products) {
      await this.q(
        `insert into public.products (id, slug, title, description, category_id, brand_id, status, created_by_seller_id)
         values ($1, $2, $3, 'Producto de la prueba de carreras.', $4, $5, 'active', $6)
         on conflict (id) do update set status = 'active'`,
        [p.id, p.slug, p.title, like.category_id, like.brand_id, sendero],
      );
    }
    for (const k of FIXTURE.skus) {
      await this.q(
        `insert into public.skus (id, product_id, code, variant_name, weight_grams, length_cm, width_cm, height_cm)
         values ($1, $2, $3, $4, 500, 20, 15, 10)
         on conflict (id) do update set active = true`,
        [k.id, k.product, k.code, k.variant],
      );
    }
    for (const o of FIXTURE.offers) {
      const seller = o.shop === "sendero" ? sendero : cafetal;
      await this.q(
        `insert into public.offers (id, sku_id, seller_id, price_minor, fulfillment, handling_days, status, created_at)
         values ($1, $2, $3, $4, 'platform', 0, 'active', $5)
         on conflict (id) do update set status = 'active', price_minor = excluded.price_minor, list_price_minor = null`,
        [o.id, o.sku, seller, o.price, o.created],
      );
      await this.q(
        `insert into public.stock_levels (warehouse_id, sku_id, seller_id, on_hand) values ($1, $2, $3, 0)
         on conflict do nothing`,
        [this.warehouseId, o.sku, seller],
      );
      const k = FIXTURE.skus.find((x) => x.id === o.sku);
      this.offers.set(o.key, {
        id: o.id,
        sku_id: o.sku,
        seller_id: seller,
        sku_code: k.code,
        slug: `${o.key}@${o.shop}`,
        product_id: k.product,
      });
    }
    this.fixtureProducts = FIXTURE.products.map((p) => p.id);
  }

  /**
   * Each product's stored summary against one computed here from scratch
   * (the rule of private.refresh_product_summary, written independently).
   * Returns violations.
   */
  async summaryCheck(productIds) {
    const { rows } = await this.q(SUMMARY_CHECK, [productIds]);
    return rows.map(
      (r) =>
        `product ${r.slug}: stored ${JSON.stringify(r.stored)} <> computed ${JSON.stringify(r.computed)}`,
    );
  }

  offer(key) {
    const o = typeof key === "string" ? this.offers.get(key) : key;
    if (!o) throw new Error(`no offer ${key}`);
    return o;
  }

  /** A session in an open transaction: as a demo user (email) or, with null, as the database owner (as cron runs). */
  async session(as) {
    const client = await this.pool.connect();
    await client.query("begin");
    await client.query(`set local statement_timeout = '${TIMEOUT}'`);
    if (as) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: this.ids.get(as), role: "authenticated", aal: "aal2" }),
      ]);
      await client.query("set local role authenticated");
    }
    const pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
    return { client, pid };
  }

  /** One call as a user, committed. Throws what it threw. */
  async call(as, sql, params) {
    const s = await this.session(as);
    try {
      const res = await s.client.query(sql, params);
      await s.client.query("commit");
      return res.rows[0];
    } catch (e) {
      await s.client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      s.client.release();
    }
  }

  async place(shopper, lines, method = "card") {
    const items = lines.map(([key, quantity]) => ({ offer_id: this.offer(key).id, quantity }));
    const row = await this.call(
      SHOPPER(shopper),
      "select public.place_order($1::jsonb, $2, $3::public.payment_method, $4) as r",
      [
        JSON.stringify(items),
        this.address.get(SHOPPER(shopper)),
        method,
        `w7-${Date.now()}-${Math.random()}`,
      ],
    );
    return row.r.order_id;
  }

  placeArgs(shopper, lines, method = "card") {
    const items = lines.map(([key, quantity]) => ({ offer_id: this.offer(key).id, quantity }));
    return {
      as: SHOPPER(shopper),
      sql: "select public.place_order($1::jsonb, $2, $3::public.payment_method, $4)",
      args: [
        JSON.stringify(items),
        this.address.get(SHOPPER(shopper)),
        method,
        `w7-${Date.now()}-${Math.random()}`,
      ],
    };
  }

  async expire(orderIds, minutesAgo = 120) {
    await this.q(
      "update public.orders set placed_at = now() - make_interval(mins => $2) where id = any($1)",
      [orderIds, minutesAgo],
    );
  }

  async shipmentOf(orderId) {
    return (
      await this.q(
        "select id from public.shipments where order_id = $1 and origin_warehouse_id = $2",
        [orderId, this.warehouseId],
      )
    ).rows[0]?.id;
  }

  async tasks(shipmentId) {
    return (
      await this.q(
        `select t.id, t.quantity, t.picked_quantity, t.location_id, k.code as sku_code
           from public.pick_tasks t join public.skus k on k.id = t.sku_id
          where t.shipment_id = $1 and t.status <> 'cancelled' order by t.sku_id, t.seller_id`,
        [shipmentId],
      )
    ).rows;
  }

  async startPicking(shipmentId) {
    await this.call(WORKER, "select public.wms_start_picking($1)", [shipmentId]);
  }

  async pick(task) {
    await this.call(WORKER, "select public.wms_confirm_pick($1, $2, null, $3)", [
      task.id,
      task.quantity,
      task.sku_code,
    ]);
  }

  /** A cash order released at once, its picking started, `picked` of its tasks picked. */
  async cashInPicking(shopper, lines, picked = "all") {
    const order = await this.place(shopper, lines, "cash_on_delivery");
    const shipment = await this.shipmentOf(order);
    await this.startPicking(shipment);
    const tasks = await this.tasks(shipment);
    const n = picked === "all" ? tasks.length : picked;
    for (const t of tasks.slice(0, n)) await this.pick(t);
    return { order, shipment, tasks };
  }

  /**
   * One round: every actor opens its session, waits on the barrier, and all are let
   * go together. Each commits as soon as its call ends (or rolls back on error).
   * `hold` (optional) is a session that takes a lock before the barrier opens and
   * lets go `holdMs` after (forces an interleaving). Returns one outcome per actor.
   */
  async race(actors, { hold = null, holdMs = 150 } = {}) {
    const ctl = await this.pool.connect();
    let holder = null;
    const sessions = [];
    try {
      await ctl.query("select pg_advisory_lock($1)", [BARRIER]);
      if (hold) {
        holder = await this.session(hold.as ?? null);
        await holder.client.query(hold.sql, hold.args);
      }
      for (const a of actors) sessions.push(await this.session(a.as));
      const runs = actors.map((a, i) => {
        const s = sessions[i];
        const t = { start: 0, end: 0 };
        const p = s.client
          .query("select pg_advisory_xact_lock_shared($1)", [BARRIER])
          .then(async () => {
            if (a.delayMs) await sleep(a.delayMs);
            t.start = Date.now();
            const res = await s.client.query(a.sql, a.args);
            t.end = Date.now();
            if (a.commit === false) await s.client.query("rollback");
            else await s.client.query("commit");
            return { name: a.name, outcome: "", ms: t.end - t.start, row: res.rows[0] };
          })
          .catch(async (e) => {
            t.end = Date.now();
            await s.client.query("rollback").catch(() => undefined);
            return { name: a.name, outcome: classify(e), ms: t.end - t.start, error: e };
          });
        return p;
      });
      // Wait until every racer is queued on the barrier, then open it.
      const deadline = Date.now() + 10000;
      for (;;) {
        const { rows } = await ctl.query(
          "select count(*)::int as n from pg_locks where locktype = 'advisory' and objid = $1 and not granted",
          [BARRIER],
        );
        if (rows[0].n >= actors.length || Date.now() > deadline) break;
        await sleep(2);
      }
      await ctl.query("select pg_advisory_unlock($1)", [BARRIER]);
      if (holder) {
        await sleep(holdMs);
        await holder.client.query("rollback");
      }
      return await Promise.all(runs);
    } finally {
      await ctl.query("select pg_advisory_unlock_all()").catch(() => undefined);
      ctl.release();
      if (holder) {
        await holder.client.query("rollback").catch(() => undefined);
        holder.client.release();
      }
      for (const s of sessions) s.client.release();
    }
  }

  /**
   * What must be true after a round, for the given products and orders. Returns a
   * list of violations (empty when all is well).
   */
  async check(keys, orders = []) {
    const bad = [];
    for (const key of keys) {
      const o = this.offer(key);
      const label = typeof key === "string" ? key : key.slug;
      const { rows } = await this.q(
        `select l.on_hand, l.reserved,
                (select coalesce(sum(b.quantity), 0)::int from public.bin_stock b join public.warehouse_locations wl on wl.id = b.location_id
                  where wl.warehouse_id = l.warehouse_id and b.sku_id = l.sku_id and b.seller_id = l.seller_id) as bins,
                (${PICKED_OPEN})::int as picked,
                (select coalesce(sum(r.quantity), 0)::int from public.inventory_reservations r
                  where r.warehouse_id = l.warehouse_id and r.sku_id = l.sku_id and r.seller_id = l.seller_id and r.status = 'active') as active,
                (select f.available_quantity from public.offers f where f.id = $4) as available,
                (select min(b.quantity) from public.bin_stock b where b.sku_id = l.sku_id and b.seller_id = l.seller_id and b.quantity < 0) as negative
           from public.stock_levels l where l.warehouse_id = $1 and l.sku_id = $2 and l.seller_id = $3`,
        [this.warehouseId, o.sku_id, o.seller_id, o.id],
      );
      const r = rows[0];
      if (!r) continue;
      if (r.on_hand !== r.bins + r.picked)
        bad.push(`${label}: on_hand ${r.on_hand} <> bins ${r.bins} + picked ${r.picked}`);
      if (r.reserved !== r.active)
        bad.push(`${label}: reserved ${r.reserved} <> active reservations ${r.active}`);
      if (r.available !== r.on_hand - r.reserved)
        bad.push(
          `${label}: available ${r.available} <> on_hand - reserved ${r.on_hand - r.reserved}`,
        );
      if (r.negative !== null) bad.push(`${label}: a bin holds ${r.negative}`);
      const over = await this.q(
        `select wl.code, b.quantity, private.location_promised(b.location_id, b.sku_id, b.seller_id) as promised
           from public.bin_stock b join public.warehouse_locations wl on wl.id = b.location_id
          where b.sku_id = $1 and b.seller_id = $2 and wl.warehouse_id = $3
            and private.location_promised(b.location_id, b.sku_id, b.seller_id) > b.quantity`,
        [o.sku_id, o.seller_id, this.warehouseId],
      );
      for (const x of over.rows)
        bad.push(`${label}: ${x.code} promised ${x.promised} of ${x.quantity}`);
      // A task sent to a location with none of the product at all.
      const nowhere = await this.q(
        `select count(*)::int as n from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
          where t.sku_id = $1 and t.seller_id = $2 and t.status in ('open', 'in_progress') and s.status in ('pending', 'picking')
            and not exists (select 1 from public.bin_stock b where b.location_id = t.location_id and b.sku_id = t.sku_id and b.seller_id = t.seller_id)`,
        [o.sku_id, o.seller_id],
      );
      if (nowhere.rows[0].n > 0)
        bad.push(`${label}: ${nowhere.rows[0].n} open task(s) at a location without the product`);
    }
    if (orders.length) {
      const { rows } = await this.q(ORDER_CHECK, [orders]);
      for (const r of rows) {
        const where = `order ${r.order_number} (${r.status})`;
        if (r.status === "cancelled") {
          if (r.active_res > 0) bad.push(`${where}: ${r.active_res} active reservation(s) left`);
          if (r.live_shipments > 0)
            bad.push(`${where}: ${r.live_shipments} parcel(s) not cancelled`);
          if (r.live_tasks > 0) bad.push(`${where}: ${r.live_tasks} pick task(s) open`);
          if (r.captured > 0 && r.cancel_refunds !== 1)
            bad.push(
              `${where}: captured ${r.captured} with ${r.cancel_refunds} cancellation refund(s)`,
            );
          if (r.captured > 0 && r.refunded !== r.captured)
            bad.push(`${where}: captured ${r.captured}, refunded ${r.refunded}`);
          if (r.ledger_net !== 0)
            bad.push(
              `${where}: ledger accounts of the order net ${r.ledger_net} (non-zero accounts ${r.ledger_accounts_off})`,
            );
          if (r.payments_live > 0)
            bad.push(`${where}: ${r.payments_live} payment(s) still pending or authorized`);
        } else if (r.status === "pending_payment") {
          if (r.captured > 0) bad.push(`${where}: a captured payment on an unpaid order`);
          if (r.tasks > 0) bad.push(`${where}: pick tasks before payment`);
        } else if (["confirmed", "processing"].includes(r.status)) {
          if (r.method === "card" && r.captured === 0)
            bad.push(`${where}: confirmed without a captured payment`);
          if (r.res_total === 0) bad.push(`${where}: no reservation at all`);
        }
        if (r.captures > 1) bad.push(`${where}: ${r.captures} payments captured`);
        if (r.cancel_refunds > 1) bad.push(`${where}: ${r.cancel_refunds} cancellation refunds`);
        if (r.captured_events > 1)
          bad.push(`${where}: ${r.captured_events} payment.captured events`);
        if (r.cancelled_events > 1)
          bad.push(`${where}: ${r.cancelled_events} order.cancelled events`);
        if (
          r.status === "cancelled" &&
          r.cancelled_events !== 1 &&
          r.reason !== "Los paquetes regresaron sin entregarse"
        )
          bad.push(`${where}: ${r.cancelled_events} order.cancelled events`);
      }
    }
    return bad;
  }
}

/*
 * The harness's own catalogue (ownFixture), with ids chosen so the lock order
 * is the same on every database build:
 *
 *   product X  (id ...0b): variants x1 (SKU ...0101) and x2 (SKU ...0103), sold by Tienda Sendero;
 *   product Y  (id ...0a): one variant (SKU ...0102), sold by Tienda Sendero ("low") and by
 *              Cafetal Los Santos ("second");
 *   product Z  (id ...0c): one variant (SKU ...0201), sold by Tienda Sendero ("z1", the cheaper)
 *              and by Cafetal Los Santos ("z2").
 *
 * So by SKU, x1 < y < x2: a writer of [x1, low] takes X then Y, a writer of
 * [second, x2] takes Y then X (family E). By product id Y < X: a walk over a
 * shop's products in id order takes Y then X, the opposite of [x1, low].
 * Every offer is warehouse-fulfilled from SJO1.
 */
const FX = (n) => `e8000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const FIXTURE = {
  products: [
    { id: FX(0x0b), slug: "carrera-producto-x", title: "Producto X de la carrera" },
    { id: FX(0x0a), slug: "carrera-producto-y", title: "Producto Y de la carrera" },
    { id: FX(0x0c), slug: "carrera-producto-z", title: "Producto Z de la carrera" },
  ],
  skus: [
    { id: FX(0x0101), product: FX(0x0b), code: "CARRERA-X1", variant: "Uno" },
    { id: FX(0x0102), product: FX(0x0a), code: "CARRERA-Y", variant: "" },
    { id: FX(0x0103), product: FX(0x0b), code: "CARRERA-X2", variant: "Dos" },
    { id: FX(0x0201), product: FX(0x0c), code: "CARRERA-Z", variant: "" },
  ],
  offers: [
    {
      key: "x1",
      id: FX(0x1101),
      sku: FX(0x0101),
      shop: "sendero",
      price: 1200000,
      created: "2026-01-01T00:00:00Z",
    },
    {
      key: "low",
      id: FX(0x1102),
      sku: FX(0x0102),
      shop: "sendero",
      price: 1250000,
      created: "2026-01-01T00:00:00Z",
    },
    {
      key: "x2",
      id: FX(0x1103),
      sku: FX(0x0103),
      shop: "sendero",
      price: 1300000,
      created: "2026-01-01T00:00:00Z",
    },
    {
      key: "second",
      id: FX(0x2102),
      sku: FX(0x0102),
      shop: "cafetal",
      price: 1260000,
      created: "2026-01-02T00:00:00Z",
    },
    {
      key: "z1",
      id: FX(0x1201),
      sku: FX(0x0201),
      shop: "sendero",
      price: 1400000,
      created: "2026-01-01T00:00:00Z",
    },
    {
      key: "z2",
      id: FX(0x2201),
      sku: FX(0x0201),
      shop: "cafetal",
      price: 1500000,
      created: "2026-01-02T00:00:00Z",
    },
  ],
};

// The listing summary computed from scratch, compared with what is stored.
const SUMMARY_CHECK = `
with c as (
  select p.id, p.slug,
    jsonb_build_object('offer_count', p.offer_count, 'featured', p.featured_offer_id, 'min', p.min_price_minor,
      'list', p.list_price_minor, 'in_stock', p.in_stock, 'platform', p.fulfilled_by_platform,
      'handling', p.best_handling_days) as stored,
    (select jsonb_build_object('offer_count', (select count(*) from public.offers o join public.skus k on k.id = o.sku_id
                                                join public.sellers s on s.id = o.seller_id
                                               where k.product_id = p.id and k.active and o.status = 'active' and s.status = 'active'),
       'featured', b.id, 'min', b.price_minor, 'list', b.list_price_minor, 'in_stock', coalesce(b.available_quantity > 0, false),
       'platform', coalesce(b.fulfillment = 'platform', false), 'handling', b.handling_days)
       from (select 1) one
       left join lateral (select o.* from public.offers o join public.skus k on k.id = o.sku_id
                            join public.sellers s on s.id = o.seller_id
                           where k.product_id = p.id and k.active and o.status = 'active' and s.status = 'active'
                             and o.condition = 'new'
                           order by o.available_quantity > 0 desc, o.price_minor, o.created_at, o.id limit 1) b on true) as computed
  from public.products p where p.id = any($1::uuid[]))
select slug, stored, computed from c where stored <> computed`;

// Units picked off a shelf into a parcel that is still being picked.
const PICKED_OPEN = `(select coalesce(sum(t.picked_quantity), 0) from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
   where s.status = 'picking' and t.status <> 'cancelled' and t.warehouse_id = l.warehouse_id and t.sku_id = l.sku_id and t.seller_id = l.seller_id)`;

const ORDER_CHECK = `
select o.id, o.order_number, o.status::text as status, o.payment_method::text as method, o.cancel_reason as reason,
  (select count(*)::int from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
    where i.order_id = o.id and r.status = 'active') as active_res,
  (select count(*)::int from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
    where i.order_id = o.id) as res_total,
  (select count(*)::int from public.shipments s where s.order_id = o.id and s.status not in ('cancelled', 'returned')) as live_shipments,
  (select count(*)::int from public.pick_tasks t join public.shipments s on s.id = t.shipment_id
    where s.order_id = o.id and t.status in ('open', 'in_progress', 'short')) as live_tasks,
  (select count(*)::int from public.pick_tasks t join public.shipments s on s.id = t.shipment_id where s.order_id = o.id) as tasks,
  (select coalesce(sum(p.amount_minor), 0)::bigint from public.payments p
    where p.order_id = o.id and p.status in ('captured', 'refunded', 'partially_refunded'))::float8 as captured,
  (select count(*)::int from public.payments p where p.order_id = o.id and p.captured_at is not null) as captures,
  (select count(*)::int from public.payments p where p.order_id = o.id and p.status in ('pending', 'authorized')) as payments_live,
  (select count(*)::int from private.refunds f where f.order_id = o.id and f.reason = 'order_cancelled') as cancel_refunds,
  (select coalesce(sum(f.amount_minor), 0) from private.refunds f where f.order_id = o.id)::float8 as refunded,
  (select coalesce(sum(abs(n)), 0) from (select sum(e.amount_minor) as n from public.ledger_entries e
     join public.ledger_transactions t on t.id = e.transaction_id where t.order_id = o.id group by e.account_id) x)::float8 as ledger_net,
  (select count(*)::int from (select 1 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
     where t.order_id = o.id group by e.account_id having sum(e.amount_minor) <> 0) x) as ledger_accounts_off,
  (select count(*)::int from private.outbox_events v where v.topic = 'payment.captured' and v.payload ->> 'order_id' = o.id::text) as captured_events,
  (select count(*)::int from private.outbox_events v where v.topic = 'order.cancelled' and v.payload ->> 'order_id' = o.id::text) as cancelled_events
from public.orders o where o.id = any($1)`;

function classify(e) {
  if (e.code === "40P01") return "DEADLOCK";
  if (e.code === "40001") return "SERIALIZATION";
  if (e.code === "57014") return "TIMEOUT";
  return e.message || String(e);
}

/** A tally of outcomes per actor name, of violations, and of rounds that went wrong. */
class Tally {
  constructor(name) {
    this.name = name;
    this.rounds = 0;
    this.outcomes = {};
    this.wrongRounds = 0;
    this.violations = {};
    this.lockRounds = 0;
    this.timeoutRounds = 0;
    this.maxMs = {};
    this.examples = [];
  }
  add(results, violations) {
    this.rounds++;
    let lock = false;
    let timeout = false;
    for (const r of results) {
      const k = `${r.name}: ${r.outcome || "ok"}`;
      this.outcomes[k] = (this.outcomes[k] || 0) + 1;
      if (r.outcome === "DEADLOCK" || r.outcome === "SERIALIZATION") lock = true;
      if (r.outcome === "TIMEOUT") timeout = true;
      this.maxMs[r.name] = Math.max(this.maxMs[r.name] || 0, r.ms);
    }
    if (lock) this.lockRounds++;
    if (timeout) this.timeoutRounds++;
    if (violations.length) {
      this.wrongRounds++;
      for (const v of violations) {
        const k = v.replace(/YT-\d+/g, "YT-n").replace(/-?\d+/g, "N");
        this.violations[k] = (this.violations[k] || 0) + 1;
      }
      if (this.examples.length < 3) this.examples.push(violations);
    }
  }
  line() {
    const outs = Object.entries(this.outcomes)
      .map(([k, v]) => `${k} ${v}`)
      .join("; ");
    return `${this.name} | rounds ${this.rounds} | lock-error rounds ${this.lockRounds} | timeout rounds ${this.timeoutRounds} | wrong rounds ${this.wrongRounds} | ${outs} | max ms ${JSON.stringify(this.maxMs)}`;
  }
}

/** Runs each scenario `rounds` times and prints one line per scenario (and a JSON summary). */
async function main(family, scenarios) {
  const { url, rounds, only } = args();
  const h = new Harness(url);
  const lines = [];
  const db = url.replace(/^.*\//, "");
  try {
    await h.setup();
    for (const sc of scenarios) {
      if (only && !only.test(sc.name)) continue;
      const tally = new Tally(sc.name);
      const t0 = Date.now();
      for (let round = 0; round < (sc.rounds ? Math.min(sc.rounds, rounds) : rounds); round++) {
        try {
          const ctx = sc.setup ? await sc.setup(h, round) : {};
          const results = await h.race(
            sc.actors(h, ctx, round),
            sc.options ? sc.options(h, ctx, round) : {},
          );
          const violations = [
            ...(await h.check(sc.products || [], ctx.orders || [])),
            ...(sc.verify ? await sc.verify(h, ctx, results, round) : []),
          ];
          tally.add(results, violations);
        } catch (e) {
          tally.add(
            [{ name: "harness", outcome: `HARNESS ${e.message}`, ms: 0 }],
            [`harness error: ${e.message}`],
          );
        }
      }
      const line = `${db} | ${tally.line()} | ${(Date.now() - t0) / 1000}s`;
      process.stdout.write(`${line}\n`);
      if (tally.examples.length) {
        process.stdout.write(`   examples: ${JSON.stringify(tally.examples)}\n`);
      }
      if (Object.keys(tally.violations).length) {
        process.stdout.write(`   violations: ${JSON.stringify(tally.violations)}\n`);
      }
      lines.push({ db, family, ...tally, seconds: (Date.now() - t0) / 1000 });
    }
  } finally {
    await h.teardown();
  }
  const out = process.env.RACE_JSON;
  if (out)
    require("node:fs").appendFileSync(out, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

module.exports = { Harness, Tally, main, pg, SHOPPER, STAFF, WORKER, sleep, laneDatabase };
