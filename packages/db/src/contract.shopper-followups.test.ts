/**
 * Shopper follow-ups (20261121084600_shopper_followups.sql), against a seeded
 * database, called the way the API calls them:
 *
 *   - cart_alternatives with the cart's district answers in the shape of
 *     areas/shopper-followups.ts, and each alternative's `promise` is the date
 *     the offer's own product page gives for that district at the same moment
 *     (served zones, a zone switched off, no district);
 *   - a caller that does not know the new argument or field (the web shop and
 *     the shopper app before this change, whose schema is seller-listings'
 *     `cartAlternative`) still gets an answer that parses. The store build of
 *     commit 3f251c3 does not call this function (checked in the repository's
 *     history when git can show it).
 *
 * What it changes and puts back: Tienda Sendero's offer of the earphones is
 * paused (by the shop itself, as its seller centre does) and set on sale
 * again at its old price and handling days.
 */

import { execFileSync } from "node:child_process";
import { callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { cartAlternative } from "./areas/seller-listings";
import { datedCartAlternative } from "./areas/shopper-followups";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();
const EARPHONES = "audifonos-inalambricos-nimbo-aire";
const SENDERO = "sendero@yuntera.example";

describe.skipIf(!db.enabled)("shopper follow-ups contract (against a seeded database)", () => {
  let sendero: { id: string; price_minor: number; handling_days: number; status: string };
  let tecnocasa: string;
  const districts: Record<string, string> = {};

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query<{
      slug: string;
      id: string;
      price_minor: string;
      handling_days: number;
      status: string;
    }>(
      `select s.slug, o.id::text, o.price_minor::text, o.handling_days, o.status::text
       from public.offers o join public.sellers s on s.id = o.seller_id
       join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
       where p.slug = $1 and s.slug in ('tienda-sendero', 'tecnocasa')`,
      [EARPHONES],
    );
    const own = rows.find((row) => row.slug === "tienda-sendero");
    const other = rows.find((row) => row.slug === "tecnocasa");
    if (!own || !other) throw new Error("database is not seeded — run pnpm db:local:reset");
    sendero = {
      id: own.id,
      price_minor: Number(own.price_minor),
      handling_days: own.handling_days,
      status: own.status,
    };
    tecnocasa = other.id;
    const zones = await db.query<{ zone: string; postal_code: string }>(
      `select coalesce(d.zone_id, c.zone_id) as zone, min(d.postal_code) as postal_code
       from public.districts d join public.cantons c on c.code = d.canton_code
       where d.served group by 1`,
    );
    for (const row of zones.rows) districts[row.zone] = row.postal_code;
    await db.as(SENDERO).sellerUpdateOffer({
      offerId: sendero.id,
      priceMinor: sendero.price_minor,
      status: "paused",
      handlingDays: sendero.handling_days,
    });
  });

  afterAll(async () => {
    if (sendero) {
      await db.as(SENDERO).sellerUpdateOffer({
        offerId: sendero.id,
        priceMinor: sendero.price_minor,
        status: sendero.status === "paused" ? "paused" : "active",
        handlingDays: sendero.handling_days,
      });
    }
    await db.close();
  });

  /** The date TecnoCasa's offer shows on its product page for a district. */
  async function pageDate(postalCode: string | null) {
    const page = await db.as().getProduct(EARPHONES, postalCode);
    const offer = page?.skus.flatMap((sku) => sku.offers).find((o) => o.offer_id === tecnocasa);
    expect(offer, "TecnoCasa's offer is on the product page").toBeDefined();
    return offer?.promise ?? null;
  }

  it("gives the product page's date for the cart's district, as a visitor and signed in", async () => {
    expect(Object.keys(districts)).toEqual(expect.arrayContaining(["gam-core", "gam-extended"]));
    for (const [zone, postalCode] of Object.entries(districts)) {
      for (const who of [undefined, "comprador@yuntera.example"]) {
        const [cart, page] = await Promise.all([
          db.as(who).cartAlternatives([sendero.id], postalCode),
          pageDate(postalCode),
        ]);
        expect(cart, `${zone}: one alternative`).toHaveLength(1);
        expect(cart[0]?.alternative_offer_id).toBe(tecnocasa);
        expect(cart[0]?.promise ?? null, `${zone} (${postalCode}), ${who ?? "a visitor"}`).toEqual(
          page,
        );
        if (zone !== "national") expect(cart[0]?.promise, `${zone} delivers`).not.toBeNull();
      }
    }
  });

  it("gives no date where the product page gives none", async () => {
    const [none] = await db.as().cartAlternatives([sendero.id]);
    expect(none?.promise).toBeNull();
    expect(await pageDate(null)).toBeNull();
    const [unknown] = await db.as().cartAlternatives([sendero.id], "99999");
    expect(unknown?.promise).toBeNull();
  });

  it("still answers callers that do not know the district or the date", async () => {
    if (!process.env.DATABASE_URL) return;
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      // Only the offers, as the web shop and the shopper app sent them before.
      const result = await callRpc(pool, "cart_alternatives", { p_offer_ids: [sendero.id] }, null);
      expect(result.ok).toBe(true);
      const old = z.array(cartAlternative).parse(result.ok ? result.data : null);
      expect(old[0]?.alternative_offer_id).toBe(tecnocasa);
      // And the new answer, read with the old schema: the extra field is ignored.
      const dated = await callRpc(
        pool,
        "cart_alternatives",
        { p_offer_ids: [sendero.id], p_postal_code: districts["gam-core"] },
        null,
      );
      expect(z.array(cartAlternative).safeParse(dated.ok ? dated.data : null).success).toBe(true);
      expect(z.array(datedCartAlternative).safeParse(dated.ok ? dated.data : null).success).toBe(
        true,
      );
    } finally {
      await pool.end();
    }
  });

  it("is not called by the store build of commit 3f251c3", () => {
    let files: string;
    try {
      files = execFileSync(
        "git",
        ["grep", "-l", "cart_alternatives\\|cartAlternatives", "3f251c3", "--", "apps/shop-native"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch (error) {
      // `git grep` exits 1 when nothing matches; any other failure means the
      // commit is not in this checkout (a shallow clone), and there is nothing to compare.
      const status = (error as { status?: number }).status;
      if (status !== 1) return;
      files = "";
    }
    expect(files.trim()).toBe("");
  });
});
