/**
 * Operations and catalogue changes at the same moment, from two real sessions
 * (20261121084000_console_operations.sql, 20261121084100_catalogue_followups.sql).
 * The SQL suites run in one transaction each and cannot show a race: here the
 * first session holds its transaction open, the second starts and waits behind
 * it (checked in pg_stat_activity), then the first commits. What is checked is
 * what both leave behind together, and that no lock error reaches a caller.
 *
 *   (i)   Two staff switch off the last two zones that serve districts: one is
 *         accepted, and a district is still served.
 *   (ii)  A district move that empties one of the last two serving zones
 *         against switching off the other, in both orders: never both, and
 *         no deadlock.
 *   (iii) A location switched off against stock being put into it, in both
 *         orders: no stock ends up in a location that is off.
 *   (iv)  A brand deleted against a merge into it, and against a correction
 *         that gives a product that brand (sellers never name a brand; the
 *         correction is the only other writer), in both orders: no product
 *         names a brand that does not exist, and no foreign-key error.
 *
 * These tests switch off zones the shop delivers to, for a moment, and commit
 * it. The package's contract files therefore run one at a time
 * (vitest.config.ts), so no other suite sees the shop without a zone.
 *
 * What these tests change they undo, through the functions where there is
 * one and directly where there is none (the zones' revisions, the
 * districts' zone, the test location, the stock ledger rows of the test
 * adjustment, the test brands and product), so the suite passes on a used
 * database and twice in a row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const STAFF = "central@yuntera.example";
const WAREHOUSE = "bodega@yuntera.example";
const ZONE = "contrato-carrera";
const LOCATION = "Y-97-97-Z";
const NOTE = "Conteo de la prueba de carrera";

type Session = { client: pg.PoolClient; pid: number };

describe.skipIf(!db.enabled)(
  "operations changes at the same time (against a seeded database)",
  () => {
    let pool: pg.Pool;
    const ids = new Map<string, string>();
    let zonesBefore: Array<{ id: string; active: boolean; revision: number; updated_at: string }> =
      [];

    beforeAll(async () => {
      await db.connect();
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
      const { rows } = await db.query<{ email: string; id: string }>(
        "select email, id from auth.users where email = any($1)",
        [[STAFF, WAREHOUSE]],
      );
      for (const row of rows) ids.set(row.email, row.id);
      expect(ids.size, "database is not seeded — run pnpm db:local:reset").toBe(2);
      zonesBefore = (
        await db.query<{ id: string; active: boolean; revision: number; updated_at: string }>(
          "select id, active, revision, updated_at from public.delivery_zones order by id",
        )
      ).rows;
      // The seed's state, which the zone races start from: two zones serve.
      const { rows: serving } = await db.query<{ id: string }>(
        `select z.id from public.delivery_zones z
          where z.active and private.zone_serves(z.id) order by z.id`,
      );
      expect(serving.map((z) => z.id)).toEqual(["gam-core", "gam-extended"]);
    });

    afterAll(async () => {
      // Leave the seed as it was even if a test stopped half way.
      await restoreZones();
      await db.query("delete from public.delivery_zones where id = $1", [ZONE]);
      await removeTestLocation();
      await removeTestBrands();
      await pool?.end();
      await db.close();
    });

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
    async function waitsForLock(pid: number, ms = 5000) {
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
          // A lock error (deadlock 40P01, serialisation 40001) is never acceptable.
          error.code === "40P01" || error.code === "40001" ? `LOCK ${error.code}` : error.message,
      );

    /**
     * Runs `first` in one session and `second` in another: the second starts
     * while the first holds its transaction, must wait for it, and runs on
     * after the first commits. Each commits if it was accepted.
     */
    async function race(
      first: { as: string; sql: string; args?: unknown[] },
      second: { as: string; sql: string; args?: unknown[] },
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
        const waited = await waitsForLock(b.pid);
        await a.client.query("commit");
        const secondOutcome = await later;
        await b.client.query(secondOutcome ? "rollback" : "commit");
        return { first: firstOutcome, second: secondOutcome, waited };
      } finally {
        await a.client.query("rollback").catch(() => undefined);
        await b.client.query("rollback").catch(() => undefined);
        a.client.release();
        b.client.release();
      }
    }

    const revision = async (zone: string) =>
      (
        await db.query<{ revision: number }>(
          "select revision from public.delivery_zones where id = $1",
          [zone],
        )
      ).rows[0]?.revision ?? 0;

    const servedDistricts = async () =>
      Number(
        (
          await db.query<{ n: string }>(
            `select count(*) as n from private.district_zones() dz
               join public.delivery_zones z on z.id = dz.zone_id
              where z.active and dz.served`,
          )
        ).rows[0]?.n ?? 0,
      );

    /** The seed's zones as they were before the suite, revisions included. */
    async function restoreZones() {
      for (const zone of zonesBefore) {
        await db.query(
          "update public.delivery_zones set active = $2, revision = $3, updated_at = $4 where id = $1",
          [zone.id, zone.active, zone.revision, zone.updated_at],
        );
      }
    }

    it("(i) accepts one of two staff switching off the last two serving zones", async () => {
      const [core, extended] = [await revision("gam-core"), await revision("gam-extended")];
      try {
        const result = await race(
          {
            as: STAFF,
            sql: "select public.ops_set_zone_active('gam-core', false, $1)",
            args: [core],
          },
          {
            as: STAFF,
            sql: "select public.ops_set_zone_active('gam-extended', false, $1)",
            args: [extended],
          },
        );
        expect(result).toEqual({ first: "", second: "zone_last_active", waited: true });
        expect(await servedDistricts()).toBeGreaterThan(0);
      } finally {
        await restoreZones();
      }
      expect(await servedDistricts()).toBeGreaterThan(90);
    });

    it("(ii) never lets a district move and a zone switched off leave nothing served", async () => {
      // A third zone serving one district, the national zone's first; then the
      // extended zone off: the core zone and this one are the last two.
      const { rows } = await db.query<{
        postal_code: string;
        zone_id: string | null;
        served: boolean;
      }>(
        `select d.postal_code, d.zone_id, d.served from public.districts d
           join private.district_zones() dz on dz.postal_code = d.postal_code
          where dz.zone_id = 'national' and dz.served
          order by d.postal_code limit 1`,
      );
      const district = rows[0];
      expect(district, "the seed has no district in the national zone").toBeDefined();
      if (!district) return;
      const staff = db.as(STAFF, "aal2");
      try {
        await staff.opsCreateZone(ZONE, {
          name: "Zona de carrera",
          cutoffHour: 12,
          processingWeekdays: [1, 2, 3, 4, 5],
          deliveryWeekdays: [1, 2, 3, 4, 5],
          transitMinDays: 1,
          transitMaxDays: 2,
          shippingFeeMinor: 200_000,
          freeShippingThresholdMinor: null,
          codAvailable: false,
        });
        await staff.opsMoveDistricts([district.postal_code], ZONE);
        await staff.opsSetZoneActive(ZONE, true, await revision(ZONE));
        await staff.opsSetZoneActive("gam-extended", false, await revision("gam-extended"));

        // The move first: the zone switched off after it finds nothing else served.
        let result = await race(
          {
            as: STAFF,
            sql: "select public.ops_move_districts($1, null)",
            args: [[district.postal_code]],
          },
          {
            as: STAFF,
            sql: "select public.ops_set_zone_active('gam-core', false, $1)",
            args: [await revision("gam-core")],
          },
        );
        expect(result).toEqual({ first: "", second: "zone_last_active", waited: true });
        expect(await servedDistricts()).toBeGreaterThan(0);
        // Back as before the race: the district served by the test zone again.
        await staff.opsMoveDistricts([district.postal_code], ZONE);

        // The zone switched off first: the move that would empty the other is refused.
        result = await race(
          {
            as: STAFF,
            sql: "select public.ops_set_zone_active('gam-core', false, $1)",
            args: [await revision("gam-core")],
          },
          {
            as: STAFF,
            sql: "select public.ops_move_districts($1, null)",
            args: [[district.postal_code]],
          },
        );
        expect(result).toEqual({ first: "", second: "districts_none_served", waited: true });
        expect(await servedDistricts()).toBeGreaterThan(0);
      } finally {
        await restoreZones();
        await db.query(
          "update public.districts set zone_id = $2, served = $3 where postal_code = $1",
          [district.postal_code, district.zone_id, district.served],
        );
        await db.query("delete from public.delivery_zones where id = $1", [ZONE]);
      }
      expect(await servedDistricts()).toBeGreaterThan(90);
    });

    /** The test location, its stock and the ledger rows of the test adjustments, gone. */
    async function removeTestLocation() {
      const { rows } = await db.query<{ id: string }>(
        "select id from public.warehouse_locations where code = $1",
        [LOCATION],
      );
      const location = rows[0]?.id;
      if (!location) return;
      // Stock still there goes back out the way it came in (the availability
      // trigger follows), then the immutable ledger rows of the test go.
      const { rows: stock } = await db.query<{
        warehouse_id: string;
        sku_id: string;
        seller_id: string;
        quantity: number;
      }>(
        `select l.warehouse_id, b.sku_id, b.seller_id, b.quantity
           from public.bin_stock b join public.warehouse_locations l on l.id = b.location_id
          where b.location_id = $1 and b.quantity > 0`,
        [location],
      );
      for (const row of stock) {
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
          "delete from public.stock_movements where to_location_id = $1 or from_location_id = $1",
          [location],
        );
        await client.query("commit");
      } finally {
        client.release();
      }
      await db.query("delete from public.bin_stock where location_id = $1", [location]);
      await db.query("delete from public.warehouse_locations where id = $1", [location]);
    }

    it("(iii) puts no stock into a location being switched off", async () => {
      const staff = db.as(STAFF, "aal2");
      const { rows } = await db.query<{ warehouse_id: string; sku_id: string; seller_id: string }>(
        `select l.warehouse_id, b.sku_id, b.seller_id
           from public.bin_stock b
           join public.warehouse_locations l on l.id = b.location_id
           join public.warehouses w on w.id = l.warehouse_id and w.kind = 'platform'
          where b.quantity > 0 and l.kind = 'pick'
          order by l.code, b.sku_id limit 1`,
      );
      const stock = rows[0];
      expect(stock, "the seed has no stock in the platform warehouse").toBeDefined();
      if (!stock) return;
      const created = await staff.opsCreateLocation(stock.warehouse_id, LOCATION, "storage");
      const location = created.id;
      const adjust = {
        as: WAREHOUSE,
        sql: "select public.wms_adjust_stock($1, $2, $3, 2, $4)",
        args: [location, stock.sku_id, stock.seller_id, NOTE],
      };
      const switchOff = {
        as: STAFF,
        sql: "select public.ops_set_location_active($1, false)",
        args: [location],
      };
      const stockInLocationsOff = async () =>
        Number(
          (
            await db.query<{ n: string }>(
              `select coalesce(sum(b.quantity), 0) as n from public.bin_stock b
                 join public.warehouse_locations l on l.id = b.location_id
                where not l.active and b.quantity > 0`,
            )
          ).rows[0]?.n ?? 0,
        );
      const before = await stockInLocationsOff();
      try {
        // Stock first: the switch-off waits for it, then sees the units.
        let result = await race(adjust, switchOff);
        expect(result).toEqual({ first: "", second: "location_has_stock", waited: true });
        expect(await stockInLocationsOff()).toBe(before);

        // Emptied again; then the switch-off first: the stock waits, then is refused.
        await removeStock(location, stock);
        result = await race(switchOff, adjust);
        expect(result).toEqual({ first: "", second: "location_not_found", waited: true });
        expect(await stockInLocationsOff()).toBe(before);
        const { rows: inside } = await db.query<{ n: string }>(
          "select coalesce(sum(quantity), 0) as n from public.bin_stock where location_id = $1",
          [location],
        );
        expect(Number(inside[0]?.n)).toBe(0);
      } finally {
        await removeTestLocation();
      }
    });

    /** The test adjustment taken back out, through the warehouse's own function. */
    async function removeStock(location: string, stock: { sku_id: string; seller_id: string }) {
      await db.as(WAREHOUSE, "aal2").wmsAdjustStock({
        locationId: location,
        skuId: stock.sku_id,
        sellerId: stock.seller_id,
        delta: -2,
        note: NOTE,
      });
    }

    /** The test brands and product, gone. */
    async function removeTestBrands() {
      await db.query("delete from public.products where slug = 'producto-de-carrera'");
      await db.query(
        "delete from public.brands where slug like 'marca-carrera-%' and merged_into_id is not null",
      );
      await db.query("delete from public.brands where slug like 'marca-carrera-%'");
    }

    it("(iv) never leaves a product naming a brand that was deleted", async () => {
      const brokenReferences = async () =>
        Number(
          (
            await db.query<{ n: string }>(
              `select count(*) as n from public.products p
                where p.brand_id is not null
                  and not exists (select 1 from public.brands b where b.id = p.brand_id)`,
            )
          ).rows[0]?.n ?? 0,
        );
      const staff = db.as(STAFF, "aal2");
      try {
        // A product of nobody's shop (so a correction plans no message), in
        // review, naming the brand that is merged.
        const target = (
          await staff.opsCreateBrand("Marca Carrera Destino", "marca-carrera-destino")
        ).id;
        const duplicate = (
          await staff.opsCreateBrand("Marca Carrera Duplicada", "marca-carrera-duplicada")
        ).id;
        const { rows } = await db.query<{ id: string }>(
          `insert into public.products (slug, title, category_id, status, brand_id)
           select 'producto-de-carrera', 'Producto de la prueba de carrera', c.id, 'pending_review', $1
             from public.categories c where c.slug = 'libros'
           returning id`,
          [duplicate],
        );
        const product = rows[0]?.id ?? "";
        expect(product).not.toBe("");

        // A merge into the brand first: the deletion counts the moved product.
        let result = await race(
          { as: STAFF, sql: "select public.ops_merge_brands($1, $2)", args: [duplicate, target] },
          { as: STAFF, sql: "select public.ops_delete_brand($1)", args: [target] },
        );
        expect(result).toEqual({ first: "", second: "brand_in_use", waited: true });
        expect(await brokenReferences()).toBe(0);

        // A correction away from it, then the deletion first: the merge finds it gone.
        await staff.opsCorrectProduct({
          productId: product,
          clearBrand: true,
          note: "Quitamos la marca de la prueba de carrera.",
        });
        const other = (await staff.opsCreateBrand("Marca Carrera Otra", "marca-carrera-otra")).id;
        await db.query("update public.products set brand_id = $2 where id = $1", [product, other]);
        result = await race(
          { as: STAFF, sql: "select public.ops_delete_brand($1)", args: [target] },
          { as: STAFF, sql: "select public.ops_merge_brands($1, $2)", args: [other, target] },
        );
        expect(result).toEqual({ first: "", second: "brand_not_found", waited: true });
        expect(await brokenReferences()).toBe(0);

        // A correction that gives the brand, against its deletion, both ways.
        const given = (await staff.opsCreateBrand("Marca Carrera Dada", "marca-carrera-dada")).id;
        const correct = {
          as: STAFF,
          sql: "select public.ops_correct_product($1, null, $2, false, 'La marca correcta es otra.')",
          args: [product, given],
        };
        const remove = { as: STAFF, sql: "select public.ops_delete_brand($1)", args: [given] };
        result = await race(correct, remove);
        expect(result).toEqual({ first: "", second: "brand_in_use", waited: true });
        expect(await brokenReferences()).toBe(0);

        const gone = (await staff.opsCreateBrand("Marca Carrera Ida", "marca-carrera-ida")).id;
        result = await race(
          { as: STAFF, sql: "select public.ops_delete_brand($1)", args: [gone] },
          {
            as: STAFF,
            sql: "select public.ops_correct_product($1, null, $2, false, 'La marca correcta es otra.')",
            args: [product, gone],
          },
        );
        expect(result).toEqual({ first: "", second: "brand_not_found", waited: true });
        expect(await brokenReferences()).toBe(0);
        const { rows: after } = await db.query<{ brand_id: string | null }>(
          "select brand_id from public.products where id = $1",
          [product],
        );
        expect(after[0]?.brand_id).toBe(given);
      } finally {
        await removeTestBrands();
      }
    });
  },
);
