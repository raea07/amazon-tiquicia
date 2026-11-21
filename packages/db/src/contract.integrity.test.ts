/**
 * Two calls at once. Each test opens two (or three) real database sessions,
 * starts the first call and leaves its transaction open, starts the second
 * call while the first is still open, checks that the second WAITS (the
 * database reports it blocked on a lock), then ends the first and checks what
 * the second does once it may go on. A check that is not protected by a lock
 * lets the second call through at once; these tests fail on the code before
 * 20261121082900_integrity.sql for exactly that reason.
 *
 * Every session acts the way an API request does: as `authenticated`, with
 * the user's claims. Setup uses the same functions, committed, as fresh test
 * accounts, and direct SQL only to look things up — and to read the delivery
 * code, playing the shopper.
 *
 * A race needs its setup committed, so that the second session can see it.
 * So that nothing committed here reaches the other contract tests (which
 * expect the seed exactly), this file builds its own copy of the database
 * next to the one in DATABASE_URL — same migrations, same seed, built by
 * supabase/scripts/local-db.sh — and drops it at the end. Its name is the
 * shared database's name plus `_races`, or RACES_DB_NAME when set.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const shared = process.env.DATABASE_URL;
const racesName = process.env.RACES_DB_NAME ?? `${shared ? new URL(shared).pathname.slice(1) : ""}_races`;
const withDatabase = (name: string) => {
  const target = new URL(shared ?? "postgres://localhost/postgres");
  target.pathname = `/${name}`;
  return target.toString();
};
const url = shared ? withDatabase(racesName) : undefined;
const localDb = fileURLToPath(new URL("../../../supabase/scripts/local-db.sh", import.meta.url));
const STAFF = "central@yuntera.example";
const DRIVER = "repartidor@yuntera.example";
const SELLER = "vendedor@yuntera.example";
const CAFETAL = "cafetal@yuntera.example";
const RUN = Date.now().toString(36);

let pool: pg.Pool;
const ids = new Map<string, string>();

interface Session {
  client: pg.PoolClient;
  pid: number;
}

/** Sessions still open; a failed test leaves none behind (see afterEach). */
const live = new Set<Session>();

/** A session with an open transaction, acting as the given user. */
async function open(email: string): Promise<Session> {
  const client = await pool.connect();
  const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid ?? 0;
  await client.query("begin");
  await client.query(
    "select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)",
    [JSON.stringify({ sub: ids.get(email), role: "authenticated", aal: "aal2" })],
  );
  const session = { client, pid };
  live.add(session);
  return session;
}

async function end(session: Session, how: "commit" | "rollback") {
  if (!live.delete(session)) return;
  try {
    await session.client.query(how);
  } finally {
    session.client.release();
  }
}

async function one<T = unknown>(session: Session, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await session.client.query<{ r: T }>(sql, params);
  return rows[0]?.r as T;
}

/** One committed call as a user, the way a request would make it. */
async function as<T = unknown>(email: string, sql: string, params: unknown[] = []): Promise<T> {
  const session = await open(email);
  try {
    const result = await one<T>(session, sql, params);
    await end(session, "commit");
    return result;
  } catch (error) {
    await end(session, "rollback");
    throw error;
  }
}

const lookup = async <T = unknown>(sql: string, params: unknown[] = []) =>
  (await pool.query<{ r: T }>(sql, params)).rows[0]?.r as T;

/** Resolves once the session is waiting on a lock held by another one. */
async function blocked(pid: number) {
  for (let i = 0; i < 100; i++) {
    const waiting = await lookup<boolean>(
      "select wait_event_type = 'Lock' as r from pg_stat_activity where pid = $1",
      [pid],
    );
    if (waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** The machine code a database call failed with, or null if it did not fail. */
const codeOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: Error) => error.message,
  );

async function shopper(tag: string) {
  const email = `integridad-${tag}-${RUN}@yuntera.example`;
  const id = await lookup<string>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"full_name": "Prueba Concurrencia"}')
     returning id as r`,
    [email],
  );
  await pool.query(
    `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
     select $1, 'Casa', 'Prueba Concurrencia', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
     from public.addresses a join auth.users u on u.id = a.user_id
     where u.email = 'comprador@yuntera.example' and a.is_default`,
    [id],
  );
  ids.set(email, id);
  return email;
}

const offer = (slug: string) =>
  lookup<string>(
    `select o.id as r from public.offers o join public.skus k on k.id = o.sku_id
     join public.products p on p.id = k.product_id
     where p.slug = $1 order by (o.fulfillment = 'platform') desc, o.price_minor desc, o.id limit 1`,
    [slug],
  );

const PLACE = `select public.place_order($1::jsonb,
  (select id from public.addresses where user_id = auth.uid() and is_default), $2::public.payment_method,
  $3) as r`;

async function place(email: string, lines: Record<string, number>, method: string, key: string) {
  const items = await Promise.all(
    Object.entries(lines).map(async ([slug, quantity]) => ({ offer_id: await offer(slug), quantity })),
  );
  const result = await as<{ order_id: string }>(email, PLACE, [JSON.stringify(items), method, key]);
  return result.order_id;
}

const pay = (email: string, order: string) =>
  as(email, "select public.confirm_sandbox_payment($1) as r", [order]);

async function pack(shipment: string) {
  const kind = await lookup<string>(
    `select w.kind::text as r from public.shipments s join public.warehouses w on w.id = s.origin_warehouse_id
     where s.id = $1`,
    [shipment],
  );
  if (kind === "seller") {
    await as(SELLER, "select public.seller_mark_packed($1, 900, 1::smallint) as r", [shipment]);
    return;
  }
  await as(STAFF, "select public.wms_start_picking($1) as r", [shipment]);
  const { rows } = await pool.query<{ id: string; quantity: number }>(
    "select id, quantity from public.pick_tasks where shipment_id = $1",
    [shipment],
  );
  for (const task of rows) {
    await as(STAFF, "select public.wms_confirm_pick($1, $2) as r", [task.id, task.quantity]);
  }
  await as(STAFF, "select public.wms_pack_shipment($1, 900, 1::smallint) as r", [shipment]);
}

const shipments = async (order: string) =>
  (
    await pool.query<{ id: string; kind: string }>(
      `select s.id, w.kind::text as kind from public.shipments s
       join public.warehouses w on w.id = s.origin_warehouse_id
       where s.order_id = $1 order by w.kind, s.id`,
      [order],
    )
  ).rows;

const ROUTE = `select public.ops_create_route(
  ((now() at time zone 'UTC') - interval '6 hours')::date,
  (select id from public.warehouses where code = 'SJO1'),
  (select jsonb_agg(jsonb_build_object('shipment_id', s, 'sequence', n))
   from unnest($1::uuid[]) with ordinality x (s, n)),
  $2::uuid) as r`;

/** Packs, routes and delivers an order with the shopper's code. */
async function deliver(order: string) {
  const parcels = await shipments(order);
  for (const parcel of parcels) await pack(parcel.id);
  const driver = await lookup<string>(
    "select d.id as r from public.drivers d join auth.users u on u.id = d.user_id where u.email = $1",
    [DRIVER],
  );
  const route = await as<string>(STAFF, ROUTE, [parcels.map((p) => p.id), driver]);
  await as(DRIVER, "select public.driver_start_route($1) as r", [route]);
  const code = await lookup<string>(
    "select code as r from private.delivery_codes where order_id = $1",
    [order],
  );
  for (const parcel of parcels) {
    const stop = await lookup<string>(
      "select id as r from public.route_stops where route_id = $1 and shipment_id = $2",
      [route, parcel.id],
    );
    const done = await as<{ ok: boolean }>(
      DRIVER,
      "select public.driver_complete_stop($1, $2, 'Recibe Prueba', 0) as r",
      [stop, code],
    );
    expect(done.ok).toBe(true);
  }
}

const item = (order: string) =>
  lookup<string>("select id as r from public.order_items where order_id = $1 order by id limit 1", [order]);

describe.skipIf(!shared)("integrity under concurrency (two sessions at once)", () => {
  let buyer = "";

  beforeAll(async () => {
    execFileSync("bash", [localDb, "reset"], {
      env: { ...process.env, PG_ADMIN_URL: withDatabase("postgres"), PG_DB_NAME: racesName },
      stdio: "ignore",
      timeout: 120_000,
    });
    pool = new pg.Pool({ connectionString: url, max: 10 });
    const { rows } = await pool.query<{ email: string; id: string }>(
      "select email, id from auth.users where email like '%@yuntera.example'",
    );
    for (const row of rows) ids.set(row.email, row.id);
    if (!ids.has(STAFF)) throw new Error("the copy of the database was not seeded");
    buyer = await shopper("buyer");
  }, 180_000);

  afterEach(async () => {
    // A test that failed half-way must not leave a transaction holding locks.
    for (const session of [...live]) {
      await pool.query("select pg_cancel_backend($1)", [session.pid]).catch(() => null);
      await end(session, "rollback").catch(() => null);
    }
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: withDatabase("postgres") });
    await admin.connect();
    await admin.query(`drop database if exists "${racesName.replaceAll('"', "")}" with (force)`);
    await admin.end();
  });

  it("FA-2 / INT-3: two return requests for the last unit of a line — the second waits, then is refused", async () => {
    const order = await place(buyer, { "libreta-tapa-dura-a5": 1 }, "card", `fa2-${RUN}`);
    await pay(buyer, order);
    await deliver(order);
    const line = await item(order);
    const sql = "select public.request_return($1, 'withdrawal', 1) as r";

    const a = await open(buyer);
    await one(a, sql, [line]);
    const b = await open(buyer);
    const second = codeOf(one(b, sql, [line]));
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await second).toBe("invalid_quantity");
    await end(b, "rollback");

    expect(
      await lookup<number>(
        "select count(*)::int as r from public.return_requests where order_item_id = $1 and status <> 'rejected'",
        [line],
      ),
    ).toBe(1);
  });

  it("INT-5: two routes planned at once for the two parcels of a cash order — the cash is on one stop", async () => {
    const order = await place(
      buyer,
      { "parlante-bluetooth-nimbo-ola": 1, "bombillo-led-9w-4u": 1 },
      "cash_on_delivery",
      `int5-${RUN}`,
    );
    const [platform, seller] = await shipments(order);
    if (!platform || !seller) throw new Error("expected two parcels");
    await pack(platform.id);
    await pack(seller.id);

    // Draft routes, with no driver, so nobody's day changes.
    const a = await open(STAFF);
    const first = await one<string>(a, ROUTE, [[platform.id], null]);
    const b = await open(STAFF);
    const second = one<string>(b, ROUTE, [[seller.id], null]);
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    const secondRoute = await second;
    const cash = await one<string>(
      b,
      "select cod_amount_minor::text as r from public.route_stops where route_id = $1",
      [secondRoute],
    );
    expect(cash).toBe("0");
    await end(b, "commit");

    const stops = await pool.query<{ cod: string }>(
      `select rs.cod_amount_minor::text as cod from public.route_stops rs
       join public.shipments s on s.id = rs.shipment_id where s.order_id = $1`,
      [order],
    );
    expect(stops.rows.filter((row) => row.cod !== "0")).toHaveLength(1);
    expect(first).toBeTruthy();
  });

  it("INT-7: a transfer confirmed while the shopper cancels — the confirmation waits and is refused", async () => {
    const other = await shopper("int7");
    const order = await place(other, { "libreta-tapa-dura-a5": 1 }, "sinpe_movil", `int7-${RUN}`);

    const a = await open(other);
    await one(a, "select public.cancel_order($1) as r", [order]);
    const b = await open(STAFF);
    const confirmation = codeOf(
      one(b, "select public.ops_confirm_payment($1, $2) as r", [order, `SINPE-${RUN}`]),
    );
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await confirmation).toBe("order_not_payable");
    await end(b, "rollback");

    expect(
      await lookup<string>("select status::text as r from public.payments where order_id = $1", [order]),
    ).toBe("cancelled");
    expect(
      await lookup<number>(
        "select count(*)::int as r from public.ledger_transactions where order_id = $1",
        [order],
      ),
    ).toBe(0);
  });

  it("INT-6: a retried checkout waits for the first one and gets its order, not a duplicate-key error", async () => {
    const other = await shopper("int6a");
    const items = JSON.stringify([{ offer_id: await offer("libreta-tapa-dura-a5"), quantity: 1 }]);
    const key = `int6-${RUN}`;

    const a = await open(other);
    const first = await one<{ order_id: string }>(a, PLACE, [items, "card", key]);
    const b = await open(other);
    const retry = one<{ order_id: string; replayed: boolean }>(b, PLACE, [items, "card", key]);
    expect(await blocked(b.pid)).toBe(true);
    await end(a, "commit");
    expect(await retry).toMatchObject({ order_id: first.order_id, replayed: true });
    await end(b, "commit");
    await as(other, "select public.cancel_order($1) as r", [first.order_id]);
  });

  it("INT-6: a price change during checkout waits, so the lines are written at the price of the total", async () => {
    const other = await shopper("int6b");
    const cafe = await offer("cafe-molido-tarrazu-340g");
    const before = await pool.query<{ price: string; list: string | null; status: string }>(
      "select price_minor::text as price, list_price_minor::text as list, status::text from public.offers where id = $1",
      [cafe],
    );
    const original = before.rows[0];
    if (!original) throw new Error("no offer");
    const newPrice = Number(original.price) + 100_000;
    const UPDATE = "select public.seller_update_offer($1, $2, $3::public.offer_status, null, $4) as r";

    const a = await open(other);
    const placed = await one<{ order_id: string; total_minor: number }>(a, PLACE, [
      JSON.stringify([{ offer_id: cafe, quantity: 2 }]),
      "card",
      `int6b-${RUN}`,
    ]);
    const c = await open(CAFETAL);
    const repricing = one(c, UPDATE, [cafe, newPrice, original.status, original.list]);
    expect(await blocked(c.pid)).toBe(true);
    await end(a, "commit");
    await repricing;
    await end(c, "commit");
    try {
      const order = await pool.query<{ items: string; lines: string; unit: string }>(
        `select o.items_total_minor::text as items,
                (select sum(line_total_minor) from public.order_items where order_id = o.id)::text as lines,
                (select max(unit_price_minor) from public.order_items where order_id = o.id)::text as unit
         from public.orders o where o.id = $1`,
        [placed.order_id],
      );
      expect(order.rows[0]).toEqual({
        items: String(Number(original.price) * 2),
        lines: String(Number(original.price) * 2),
        unit: original.price,
      });
    } finally {
      await as(CAFETAL, UPDATE, [cafe, Number(original.price), original.status, original.list]);
      await as(other, "select public.cancel_order($1) as r", [placed.order_id]);
    }
  });

  it("the last unit: two shoppers order it at once — the second waits and is told it is gone", async () => {
    const drill = await offer("taladro-inalambrico-roble-20v");
    const holders: Array<{ email: string; order: string }> = [];
    let left = await lookup<number>("select available_quantity as r from public.offers where id = $1", [
      drill,
    ]);
    try {
      // Other accounts hold everything but one unit (ten each at most).
      while (left > 1) {
        const take = Math.min(10, left - 1);
        const email = await shopper(`hold${holders.length}`);
        const order = await place(
          email,
          { "taladro-inalambrico-roble-20v": take },
          "sinpe_movil",
          `hold-${holders.length}-${RUN}`,
        );
        holders.push({ email, order });
        left -= take;
      }
      const first = await shopper("last1");
      const second = await shopper("last2");
      const items = JSON.stringify([{ offer_id: drill, quantity: 1 }]);

      const a = await open(first);
      const won = await one<{ order_id: string }>(a, PLACE, [items, "sinpe_movil", `last1-${RUN}`]);
      const b = await open(second);
      const lost = codeOf(one(b, PLACE, [items, "sinpe_movil", `last2-${RUN}`]));
      expect(await blocked(b.pid)).toBe(true);
      await end(a, "commit");
      expect(await lost).toBe("insufficient_stock");
      await end(b, "rollback");
      holders.push({ email: first, order: won.order_id });
      expect(
        await lookup<number>("select available_quantity as r from public.offers where id = $1", [drill]),
      ).toBe(0);
    } finally {
      for (const holder of holders) {
        await as(holder.email, "select public.cancel_order($1) as r", [holder.order]);
      }
    }
  });

  describe("payouts", () => {
    let run = "";
    let payout = "";
    let sendero = "";

    beforeAll(async () => {
      sendero = await lookup<string>("select id as r from public.sellers where slug = 'tienda-sendero'");
    });

    afterAll(async () => {
      if (payout) await pool.query("delete from public.payouts where id = $1 and status = 'scheduled'", [payout]);
      if (run) await pool.query("delete from public.payout_runs where id = $1", [run]);
    });

    it("two runs created at once: the second waits for the first", async () => {
      const cutoff = await lookup<string>(
        "select (((now() at time zone 'UTC') - interval '6 hours')::date - 2)::text as r",
      );
      const a = await open(STAFF);
      const first = codeOf(one(a, "select public.ops_create_payout_run($1::date) as r", [cutoff]));
      const b = await open(STAFF);
      const second = codeOf(one(b, "select public.ops_create_payout_run($1::date) as r", [cutoff]));
      // The first may find nothing left to pay (another suite may have paid it):
      // either way it holds the run lock until its transaction ends.
      expect([null, "nothing_to_pay"]).toContain(await first);
      expect(await blocked(b.pid)).toBe(true);
      // Nothing is kept: both are rolled back. The sequential "nothing added the
      // second time" case is in 085_people_payouts.sql.
      await end(a, "rollback");
      expect([null, "nothing_to_pay"]).toContain(await second);
      await end(b, "rollback");
    });

    it("INT-10: a refund and the payment of that seller's payout at once — the payment waits, then is refused", async () => {
      // Money is available at once (this is the test's own copy of the database),
      // so the refund comes out of what is available rather than what is pending.
      await pool.query("update public.app_settings set value = '0' where key = 'payout_hold_days'");
      // A delivered order of the seller, with its return back at the warehouse.
      const order = await place(buyer, { "libreta-tapa-dura-a5": 1 }, "card", `int10-${RUN}`);
      await pay(buyer, order);
      await deliver(order);
      const ret = await as<string>(buyer, "select public.request_return($1, 'withdrawal', 1) as r", [
        await item(order),
      ]);
      await as(STAFF, "select public.ops_receive_return($1, true, null) as r", [ret]);

      // A payout of exactly what the seller has available now.
      const available = await lookup<string>(
        `select available_minor::text as r
         from private.seller_balances(private.cr_local(now())::date, private.payout_hold_days(), $1)`,
        [sendero],
      );
      expect(Number(available)).toBeGreaterThan(0);
      run = await lookup<string>(
        `insert into public.payout_runs (code, cutoff_on, hold_days, minimum_minor)
         values ($1, date '2000-01-01' + (random() * 3000)::int, private.payout_hold_days(), 1)
         returning id as r`,
        [`PV-T${RUN}`],
      );
      payout = await lookup<string>(
        `insert into public.payouts (seller_id, run_id, amount_minor, status, reference, payout_iban, payout_holder_name)
         select $1, $2, $3, 'scheduled', $4, sp.payout_iban, sp.payout_holder_name
         from public.seller_private sp where sp.seller_id = $1
         returning id as r`,
        [sendero, run, available, `YUNTERA T${RUN}`],
      );

      const a = await open(STAFF);
      await one(a, "select public.ops_complete_return($1) as r", [ret]);
      const b = await open(STAFF);
      const payment = codeOf(
        one(b, "select public.ops_mark_payout_paid($1, $2) as r", [payout, `BNCR-${RUN}`]),
      );
      expect(await blocked(b.pid)).toBe(true);
      await end(a, "commit");
      expect(await payment).toBe("payout_exceeds_balance");
      await end(b, "rollback");
    });

    it("the same payout marked paid twice at once: the second waits for the first", async () => {
      expect(payout).not.toBe("");
      // Make it payable again for this check, then put everything back.
      await pool.query(
        `update public.payouts set amount_minor = 1 where id = $1 and status = 'scheduled'`,
        [payout],
      );
      const a = await open(STAFF);
      await one(a, "select public.ops_mark_payout_paid($1, $2) as r", [payout, `BNCR-A-${RUN}`]);
      const b = await open(STAFF);
      const second = codeOf(
        one(b, "select public.ops_mark_payout_paid($1, $2) as r", [payout, `BNCR-B-${RUN}`]),
      );
      expect(await blocked(b.pid)).toBe(true);
      await end(a, "rollback");
      // With the first one undone, the second may pay it; it is rolled back too.
      await second;
      await end(b, "rollback");
      expect(await lookup<string>("select status as r from public.payouts where id = $1", [payout])).toBe(
        "scheduled",
      );
    });
  });
});
