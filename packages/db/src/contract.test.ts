/**
 * Contract tests: call the real database functions and validate what they
 * return against the client's schemas.
 *
 * This is what makes the schemas trustworthy. Each call runs the way an API
 * request does — as the `anon` or `authenticated` role with the user's claims —
 * so it exercises grants and row-level security as well as payload shape.
 *
 * Needs a seeded database: `pnpm db:local:reset`, then run with DATABASE_URL
 * set. Without it the suite is skipped (unit-test runs stay database-free).
 */

import { type Claims, callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Api, createApi, type RpcTransport } from "./api";
import { ApiError } from "./errors";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("API contract (against a seeded database)", () => {
  let pool: pg.Pool;
  const users = new Map<string, string>();

  /** A client acting as the given demo user, or as a visitor when omitted. */
  function as(email?: string): Api {
    const claims: Claims | null = email
      ? { sub: users.get(email) ?? "", role: "authenticated", aal: "aal1" }
      : null;
    const transport: RpcTransport = {
      rpc: async (fn, args = {}) => {
        const result = await callRpc(pool, fn, args, claims);
        return result.ok
          ? { data: result.data, error: null, status: 200 }
          : { data: null, error: result.error, status: result.status };
      },
    };
    return createApi(transport);
  }

  const shopper = () => as("comprador@yuntera.example");
  const seller = () => as("vendedor@yuntera.example");
  const warehouse = () => as("bodega@yuntera.example");
  const driver = () => as("repartidor@yuntera.example");
  const staff = () => as("central@yuntera.example");

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ email: string; id: string }>(
      "select email, id from auth.users where email like '%@yuntera.example'",
    );
    for (const row of rows) users.set(row.email, row.id);
    expect(users.size, "database is not seeded — run pnpm db:local:reset").toBeGreaterThan(5);
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("visitor", () => {
    it("browses the catalogue", async () => {
      const api = as();
      const results = await api.searchProducts({ query: "café", limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.slug).toMatch(/^cafe-/);

      expect((await api.searchProducts({ sort: "price_asc", limit: 60 })).length).toBe(26);
      expect((await api.suggestProducts("aud")).some((s) => s.slug.startsWith("audifonos"))).toBe(
        true,
      );
      expect((await api.listCategories()).length).toBeGreaterThan(14);
      expect((await api.listDistricts()).length).toBe(494);
    });

    it("gets a delivery estimate, or an honest no", async () => {
      const api = as();
      expect(await api.deliveryEstimate("11501")).toMatchObject({
        zone_id: "gam-core",
        zone_active: true,
      });
      expect(await api.deliveryEstimate("70101")).toMatchObject({ zone_active: false });
      expect(await api.deliveryEstimate("99999")).toBeNull();
    });

    it("opens a product page with offers, reviews and related products", async () => {
      const api = as();
      const page = await api.getProduct("audifonos-inalambricos-nimbo-aire", "11501");
      expect(page?.skus[0]?.offers).toHaveLength(2);
      expect(page?.reviews.length).toBeGreaterThan(0);
      expect(page?.breadcrumbs.map((b) => b.slug)).toEqual(["electronica", "audio"]);
      expect(await api.getProduct("lampara-mesa-bambu")).toBeNull(); // awaiting review
      expect(await api.getProduct("camiseta-algodon-sendero")).toMatchObject({
        skus: [
          { variant_name: "Talla L" },
          { variant_name: "Talla M" },
          { variant_name: "Talla S" },
        ],
      });
    });

    it("prices a cart before any account exists", async () => {
      const api = as();
      const page = await api.getProduct("cafe-molido-tarrazu-340g");
      const offerId = page?.skus[0]?.offers[0]?.offer_id ?? "";
      const [line] = await api.cartLines([offerId]);
      expect(line).toMatchObject({ buyable: true, price_minor: 495_000 });

      const quote = await api.checkoutQuote([{ offerId, quantity: 2 }], "11501");
      expect(quote).toMatchObject({
        issue: null,
        items_total_minor: 990_000,
        shipping_minor: 150_000,
        total_minor: 1_140_000,
        cod_available: true,
        payments_mode: "sandbox",
      });
      expect((await api.checkoutQuote([], "11501")).issue).toBe("cart_empty");
      expect((await api.checkoutQuote([{ offerId, quantity: 1 }], "70101")).issue).toBe(
        "zone_not_served",
      );
    });

    it("is refused by everything that needs an account", async () => {
      const api = as();
      for (const attempt of [
        () => api.myRoles(),
        () => api.myOrders(),
        () => api.myAddresses(),
        () => api.driverToday(),
        () => api.opsOverview(),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ code: "not_authenticated" });
      }
    });
  });

  describe("shopper", () => {
    it("reads their roles, profile, addresses and orders", async () => {
      const api = shopper();
      expect(await api.myRoles()).toMatchObject({ staff_role: null, sellers: [], driver: null });
      expect(await api.myProfile()).toMatchObject({ email: "comprador@yuntera.example" });
      expect(await api.myAddresses()).toHaveLength(1);

      const orders = await api.myOrders(50);
      expect(orders.length).toBeGreaterThan(3);
      for (const summary of orders) {
        const order = await api.getOrder(summary.order_number);
        expect(order.items.length).toBeGreaterThan(0);
        // The PIN is visible exactly while something is still to be handed over.
        const awaitingHandover = ["confirmed", "processing", "partially_shipped", "shipped"];
        expect(order.delivery_pin !== null).toBe(awaitingHandover.includes(order.status));
      }
    });

    it("cannot open another shopper's order", async () => {
      const others = await as("comprador2@yuntera.example").myOrders(1);
      await expect(shopper().getOrder(others[0]?.order_number ?? "")).rejects.toMatchObject({
        code: "order_not_found",
      });
    });

    it("is refused by every operations function", async () => {
      const api = shopper();
      const anyId = "00000000-0000-4000-8000-000000000000";
      for (const attempt of [
        () => api.sellerOverview(anyId),
        () => api.wmsBoard(anyId),
        () => api.opsOverview(),
        () => api.opsDispatchBoard(),
        () => api.auditEntries(),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
      }
      await expect(api.driverToday()).rejects.toMatchObject({ code: "not_a_driver" });
    });

    it("gets a typed error with a human message", async () => {
      const error = await shopper()
        .placeOrder({
          items: [],
          addressId: "00000000-0000-4000-8000-000000000000",
          paymentMethod: "card",
          idempotencyKey: "contract-test-empty",
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("cart_empty");
      expect((error as ApiError).userMessage("es-CR")).toBe("Su carrito está vacío.");
    });
  });

  describe("seller", () => {
    it("reads their shops and nothing of a competitor's", async () => {
      const api = seller();
      const roles = await api.myRoles();
      expect(roles?.sellers.map((s) => s.slug).sort()).toEqual([
        "ferreteria-el-higueron",
        "tecnocasa",
      ]);

      for (const shop of roles?.sellers ?? []) {
        const overview = await api.sellerOverview(shop.id);
        expect(overview.account.payout_iban_masked).toMatch(/^CR•• /);
        expect((await api.sellerListings(shop.id)).length).toBeGreaterThan(0);
        expect((await api.sellerStock(shop.id)).length).toBeGreaterThan(0);
        await api.sellerStatements(shop.id);
        await api.sellerOrderLines(shop.id);
        await api.sellerToPack(shop.id);
        expect((await api.sellerLocations(shop.id)).platform.length).toBeGreaterThan(0);
        await api.sellerInbounds(shop.id);
      }

      const cafetal = (await pool.query("select id from sellers where slug = 'cafetal-los-santos'"))
        .rows[0].id as string;
      await expect(api.sellerOverview(cafetal)).rejects.toMatchObject({ code: "forbidden" });
      await expect(api.sellerStatements(cafetal)).rejects.toMatchObject({ code: "forbidden" });
      await expect(api.sellerLocations(cafetal)).rejects.toMatchObject({ code: "forbidden" });
      await expect(api.sellerInbounds(cafetal)).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("warehouse associate", () => {
    it("reads the floor board and a pick list", async () => {
      const api = warehouse();
      const site = (await api.myRoles())?.warehouses[0];
      expect(site?.code).toBe("SJO1");

      const board = await api.wmsBoard(site?.id ?? "");
      expect(board.shipments.length).toBeGreaterThan(0);
      for (const parcel of board.shipments) {
        const detail = await api.wmsShipment(parcel.shipment_id);
        expect(detail.tracking_code).toBe(parcel.tracking_code);
      }
      expect((await api.wmsLocations(site?.id ?? "")).length).toBe(19);
      expect(await api.wmsFindSku(site?.id ?? "", "NO-EXISTE")).toBeNull();
    });
  });

  describe("driver", () => {
    it("reads their day, without any delivery PIN", async () => {
      const day = await driver().driverToday();
      expect(day.driver.full_name).toMatch(/^Carlos/);
      expect(day.routes[0]?.status).toBe("in_progress");
      expect(day.routes[0]?.stops.length).toBe(2);
      expect(JSON.stringify(day)).not.toMatch(/delivery_pin|"pin"/);
    });
  });

  describe("staff", () => {
    it("reads every console screen", async () => {
      const api = staff();
      expect((await api.myRoles())?.staff_role).toBe("admin");
      expect((await api.opsOverview()).payments_mode).toBe("sandbox");
      expect((await api.opsOrders()).length).toBe(17);
      expect((await api.opsOrders({ status: "delivered" })).length).toBe(10);
      expect((await api.opsSellers("pending")).length).toBe(1);
      expect((await api.opsListingsForReview()).length).toBe(1);
      const board = await api.opsDispatchBoard();
      expect(board.ready.length).toBe(1);
      expect(board.drivers.length).toBe(2);
      expect((await api.opsSettlements("settled")).length).toBe(2);
      await api.opsCareQueues();
      expect((await api.opsDrivers()).length).toBe(2);
      expect((await api.auditEntries(null, 5)).length).toBe(5);
    });
  });
});
