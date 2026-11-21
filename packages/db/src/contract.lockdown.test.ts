/**
 * Contract tests for the read functions that the lockdown migration moved
 * from the caller's rights to the owner's (20261121082800_lockdown.sql). They
 * used to let row-level security decide what each caller saw; now their own
 * queries do. Called as each kind of user, the answers still match the
 * client's schemas and show each caller what they saw before: a visitor the
 * public catalogue, staff and the listing's own seller also a listing that is
 * awaiting review.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)(
  "read functions after the lockdown (against a seeded database)",
  () => {
    let pendingOffer = "";
    let liveOffer = "";

    beforeAll(async () => {
      await db.connect();
      const { rows } = await db.query<{ id: string; live: boolean }>(
        `select o.id, s.status = 'active' as live
       from public.offers o join public.sellers s on s.id = o.seller_id
       join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
       where p.slug in ('lampara-mesa-bambu', 'cafe-molido-tarrazu-340g')`,
      );
      pendingOffer = rows.find((r) => !r.live)?.id ?? "";
      liveOffer = rows.find((r) => r.live)?.id ?? "";
      expect(pendingOffer, "database is not seeded — run pnpm db:local:reset").not.toBe("");
      expect(liveOffer).not.toBe("");
    });

    afterAll(async () => {
      await db.close();
    });

    it("shows a visitor the public catalogue only", async () => {
      const api = db.as();
      const cards = await api.searchProducts({ limit: 60 });
      expect(cards.length).toBeGreaterThan(20);
      expect(cards.map((c) => c.slug)).not.toContain("lampara-mesa-bambu");
      expect((await api.suggestProducts("caf")).length).toBeGreaterThan(0);
      expect((await api.listCategories()).length).toBeGreaterThan(14);
      expect(await api.listDistricts()).toHaveLength(494);
      expect(await api.getProduct("lampara-mesa-bambu")).toBeNull();
      const page = await api.getProduct("cafe-molido-tarrazu-340g", "11501");
      expect(page?.slug).toBe("cafe-molido-tarrazu-340g");
    });

    it("gives a visitor's cart nothing from a seller awaiting approval", async () => {
      const lines = await db.as().cartLines([pendingOffer, liveOffer]);
      const pending = lines.find((l) => l.offer_id === pendingOffer);
      const live = lines.find((l) => l.offer_id === liveOffer);
      expect(pending?.buyable).toBe(false);
      expect(pending?.product_slug).toBeNull();
      expect(live?.buyable).toBe(true);
      expect(live?.product_slug).toBe("cafe-molido-tarrazu-340g");
    });

    it("still shows staff and the listing's own seller a listing awaiting review", async () => {
      expect((await db.as("central@yuntera.example").getProduct("lampara-mesa-bambu"))?.slug).toBe(
        "lampara-mesa-bambu",
      );
      expect((await db.as("bazar@yuntera.example").getProduct("lampara-mesa-bambu"))?.slug).toBe(
        "lampara-mesa-bambu",
      );
      expect(await db.as("vendedor@yuntera.example").getProduct("lampara-mesa-bambu")).toBeNull();
      const own = await db.as("bazar@yuntera.example").cartLines([pendingOffer]);
      expect(own[0]?.product_slug).toBe("lampara-mesa-bambu");
      expect(own[0]?.buyable).toBe(false);
    });

    it("gives a shopper their own orders and addresses, and a visitor neither", async () => {
      const shopper = db.as("comprador@yuntera.example");
      expect((await shopper.myOrders(50)).length).toBeGreaterThan(0);
      expect(await shopper.myAddresses()).toHaveLength(1);
      await expect(db.as().myOrders()).rejects.toMatchObject({ status: 401 });
    });
  },
);
