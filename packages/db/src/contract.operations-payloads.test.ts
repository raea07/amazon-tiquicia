/**
 * The payloads the shop, the seller and the drivers' apps (web and native)
 * read, in the states the operations tools (084000) can now put them in: a
 * district that is not served, and a stop staff took off a route. Each call
 * goes through the client's own schemas, as the apps make it.
 *
 * Both states are made inside one transaction that is rolled back at the end:
 * every call below runs in it, each as its own user, through a savepoint, the
 * way the local API runs a request. Nothing is left behind.
 */

import { type Claims, callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Api, createApi, type RpcTransport } from "./api";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)(
  "payloads after the operations tools (against a seeded database)",
  () => {
    let client: pg.PoolClient;
    let pool: pg.Pool;
    const ids = new Map<string, string>();

    beforeAll(async () => {
      await db.connect();
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      const { rows } = await db.query<{ email: string; id: string }>(
        "select email, id from auth.users where email like '%@yuntera.example'",
      );
      for (const row of rows) ids.set(row.email, row.id);
      client = await pool.connect();
      await client.query("begin");
    });

    afterAll(async () => {
      await client?.query("rollback");
      client?.release();
      await pool?.end();
      await db.close();
    });

    /** A client acting as the user, inside the open transaction (one savepoint per call). */
    function as(email?: string): Api {
      const claims: Claims | null = email
        ? { sub: ids.get(email) ?? "", role: "authenticated", aal: "aal2" }
        : null;
      // callRpc wants a pool and runs begin/commit itself: give it the open
      // transaction, with savepoints instead.
      const inTransaction = {
        connect: async () => ({
          query: (text: string, values?: unknown[]) => {
            if (text === "begin") return client.query("reset role; savepoint rpc");
            if (text === "commit") return client.query("release savepoint rpc; reset role");
            if (text === "rollback") return client.query("rollback to savepoint rpc; reset role");
            return client.query(text, values);
          },
          release: () => undefined,
        }),
      } as unknown as pg.Pool;
      const transport: RpcTransport = {
        rpc: async (fn, args = {}) => {
          const result = await callRpc(inTransaction, fn, args, claims);
          return result.ok
            ? { data: result.data, error: null, status: 200 }
            : { data: null, error: result.error, status: result.status };
        },
      };
      return createApi(transport);
    }

    it("reads a district that is not served as not served, everywhere", async () => {
      // San Pedro (11501), where the demo shopper's address is: not served.
      await as("central@yuntera.example").opsMoveDistricts(["11501"], null);

      const districts = await as().listDistricts();
      expect(districts.find((d) => d.postal_code === "11501")?.zone_active).toBe(false);
      expect(districts.find((d) => d.postal_code === "10101")?.zone_active).toBe(true);
      expect(await as().deliveryEstimate("11501")).toMatchObject({ zone_active: false });

      const shopper = as("comprador@yuntera.example");
      const addresses = await shopper.myAddresses();
      const sanPedro = addresses.find((a) => a.postal_code === "11501");
      expect(sanPedro?.zone_active).toBe(false);
      const { rows } = await client.query<{ id: string }>(
        `select o.id from public.offers o join public.sellers s on s.id = o.seller_id
        where o.status = 'active' and s.status = 'active' and o.available_quantity > 0
        order by o.created_at limit 1`,
      );
      const quote = await shopper.checkoutQuote(
        [{ offerId: rows[0]?.id ?? "", quantity: 1 }],
        "11501",
      );
      expect(quote).toMatchObject({ issue: "zone_not_served", promise: null });
      expect(quote.zone?.active).toBe(false);

      // A seller's pickup point there is refused.
      const { rows: shop } = await client.query<{ id: string }>(
        "select id from public.sellers where slug = 'tecnocasa'",
      );
      await expect(
        as("vendedor@yuntera.example").sellerSaveLocation({
          sellerId: shop[0]?.id ?? "",
          name: "Bodega de prueba",
          address: "Avenida central, 100 metros al norte del parque",
          postalCode: "11501",
          lat: 9.935,
          lng: -84.05,
        }),
      ).rejects.toMatchObject({ code: "zone_not_served" });
    });

    it("gives the driver a removed stop as skipped, with the route still readable", async () => {
      const central = as("central@yuntera.example");
      const route = (await central.opsOpenRoutes()).find((r) => r.code === "R-1003");
      const stop = route?.stops.find((s) => s.tracking_code === "YT500011");
      expect(stop, "the seed's R-1003 has the stop of YT500011").toBeDefined();
      await central.opsRemoveRouteStop(stop?.stop_id ?? "", "La moto se dañó en el camino.");

      const day = await as("repartidor@yuntera.example").driverToday();
      const shown = day.routes.find((r) => r.code === "R-1003");
      expect(shown?.stops.find((s) => s.tracking_code === "YT500011")?.status).toBe("skipped");
      expect(shown?.stops.filter((s) => s.status === "pending")).toHaveLength(1);

      // The shopper's order: delivery_failed with no attempt (the shop shows it rescheduled).
      const order = await as("comprador@yuntera.example").getOrder("YT-100011");
      expect(order.shipments.find((s) => s.tracking_code === "YT500011")).toMatchObject({
        status: "delivery_failed",
        attempt_count: 0,
      });

      // The warehouse's locations still parse.
      const roles = await as("bodega@yuntera.example").myRoles();
      const warehouse = roles?.warehouses[0]?.id ?? "";
      expect((await as("bodega@yuntera.example").wmsLocations(warehouse)).length).toBeGreaterThan(
        0,
      );
    });
  },
);
