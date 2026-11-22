/**
 * Contract tests for the seller listings area (areas/seller-listings.ts): the
 * answers of the real database functions match its schemas, for the right
 * caller, and wrong callers get a typed refusal. Everything a test changes is
 * put back at the end, so the other suites see the seed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)("seller listings contract (against a seeded database)", () => {
  const ids: Record<string, string> = {};
  const offersAdded: string[] = [];
  const requestsMade: string[] = [];

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query<{ key: string; id: string }>(
      `select 'ferreteria' as key, id::text from public.sellers where slug = 'ferreteria-el-higueron'
       union all select 'tecnocasa', id::text from public.sellers where slug = 'tecnocasa'
       union all select 'sendero', id::text from public.sellers where slug = 'tienda-sendero'
       union all select 'botella_sku', k.id::text from public.skus k join public.products p on p.id = k.product_id
                 where p.slug = 'botella-termica-sendero-750ml'
       union all select 'camiseta', id::text from public.products where slug = 'camiseta-algodon-sendero'
       union all select 'small', k.id::text from public.skus k join public.products p on p.id = k.product_id
                 where p.slug = 'camiseta-algodon-sendero' and k.variant_name = 'Talla S'
       union all select 'puzzle', id::text from public.products where slug = 'rompecabezas-volcanes-500'`,
    );
    for (const row of rows) ids[row.key] = row.id;
    expect(Object.keys(ids).length, "database is not seeded — run pnpm db:local:reset").toBe(7);
  });

  afterAll(async () => {
    for (const offer of offersAdded) {
      await db.query("delete from private.offer_additions where offer_id = $1", [offer]);
      await db.query("delete from public.offers where id = $1", [offer]);
    }
    for (const request of requestsMade) {
      await db.query("delete from public.seller_change_requests where id = $1", [request]);
    }
    await db.query("delete from public.shop_logos where seller_id = $1", [ids.tecnocasa]);
    await db.query("update public.skus set active = true where id = $1", [ids.small]);
    await db.query("update public.products set status = 'active' where id = $1", [ids.puzzle]);
    await db.query(
      `delete from private.outbox_events
       where topic in ('offer.added', 'product.variant_changed', 'product.unpublished', 'seller.change_requested')
         and created_at > now() - interval '1 hour'
         and (payload ->> 'seller_id' in ($1, $2) or payload ->> 'product_id' in ($3, $4))`,
      [ids.ferreteria, ids.tecnocasa, ids.camiseta, ids.puzzle],
    );
    await db.close();
  });

  const ferreteria = () => db.as("vendedor@yuntera.example");
  const sendero = () => db.as("sendero@yuntera.example");
  const shopper = () => db.as("comprador@yuntera.example");
  const staff = () => db.as("central@yuntera.example");

  it("finds published products of other shops, and adds an offer to one", async () => {
    const found = await ferreteria().sellerCatalogSearch(ids.ferreteria ?? "", "botella térmica");
    const bottle = found.find((match) => match.slug === "botella-termica-sendero-750ml");
    expect(bottle).toMatchObject({ own_listing: false, shop_name: "Tienda Sendero" });
    expect(bottle?.variants[0]).toMatchObject({ my_offer_id: null, offer_count: 1 });

    const added = await ferreteria().sellerAddOffer({
      sellerId: ids.ferreteria ?? "",
      skuId: ids.botella_sku ?? "",
      priceMinor: 950_000,
      fulfillment: "seller",
      handlingDays: 1,
    });
    offersAdded.push(added.offer_id);
    expect(added).toMatchObject({ outcome: "added", slug: "botella-termica-sendero-750ml" });

    const page = await db.as().getProduct("botella-termica-sendero-750ml");
    const offers = page?.skus[0]?.offers ?? [];
    expect(offers.map((offer) => offer.seller.slug)).toEqual([
      "tienda-sendero",
      "ferreteria-el-higueron",
    ]);
    expect(offers[0]?.seller.logo).toBeNull();

    await expect(
      ferreteria().sellerAddOffer({
        sellerId: ids.ferreteria ?? "",
        skuId: ids.botella_sku ?? "",
        priceMinor: 950_000,
        fulfillment: "seller",
        handlingDays: 1,
      }),
    ).rejects.toMatchObject({ code: "offer_exists" });
    await expect(
      shopper().sellerCatalogSearch(ids.ferreteria ?? "", "botella"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("offers a visitor's cart another shop's offer when the one in it cannot be bought", async () => {
    // The offer added above has no stock yet; the creating shop's has.
    const added = offersAdded[0] ?? "";
    const alternatives = await db.as().cartAlternatives([added]);
    expect(alternatives).toHaveLength(1);
    expect(alternatives[0]).toMatchObject({
      offer_id: added,
      product_slug: "botella-termica-sendero-750ml",
      seller_name: "Tienda Sendero",
    });
    expect(alternatives[0]?.alternative_offer_id).not.toBe(added);
    expect(alternatives[0]?.available).toBeGreaterThan(0);
    // A line that can be bought, or an offer that does not exist: nothing.
    await expect(
      db.as().cartAlternatives([alternatives[0]?.alternative_offer_id ?? ""]),
    ).resolves.toEqual([]);
    await expect(
      db.as().cartAlternatives(["00000000-0000-4000-8000-000000000000"]),
    ).resolves.toEqual([]);
  });

  it("shows staff which other shops' offers a listing edit would pause", async () => {
    const queue = await staff().opsListingEditsForReview();
    for (const edit of queue) expect(Array.isArray(edit.pauses_offers)).toBe(true);
    await expect(
      staff().opsReviewListingEdit("00000000-0000-4000-8000-000000000000", true, null, true),
    ).rejects.toMatchObject({ code: "edit_not_found" });
    await expect(shopper().opsListingEditsForReview()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("switches a variant off and on, and says what happened", async () => {
    const listing = await sendero().sellerListing(ids.camiseta ?? "");
    expect(listing.variants).toHaveLength(3);
    expect(listing.variants.every((variant) => variant.active)).toBe(true);
    expect(listing.other_shops).toBe(0);
    expect(listing.paused_other_shops).toBe(0);

    await expect(sendero().sellerSetVariantActive(ids.small ?? "", false)).resolves.toMatchObject({
      outcome: "variant_off",
    });
    await expect(sendero().sellerSetVariantActive(ids.small ?? "", true)).resolves.toMatchObject({
      outcome: "variant_on",
    });
    await expect(ferreteria().sellerSetVariantActive(ids.small ?? "", false)).rejects.toMatchObject(
      {
        code: "listing_not_found",
      },
    );
  });

  it("takes a listing back to draft", async () => {
    await expect(sendero().sellerUnpublishListing(ids.puzzle ?? "")).resolves.toMatchObject({
      status: "draft",
      edit_withdrawn: false,
    });
    await expect(sendero().sellerUnpublishListing(ids.puzzle ?? "")).rejects.toMatchObject({
      code: "listing_not_published",
    });
    await expect(db.as().getProduct("rompecabezas-volcanes-500")).resolves.toBeNull();
  });

  it("lists the shop's paused offers", async () => {
    await expect(ferreteria().sellerPausedOffers(ids.ferreteria ?? "")).resolves.toEqual([]);
    await expect(shopper().sellerPausedOffers(ids.ferreteria ?? "")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("asks for a new description and shows it to staff", async () => {
    const request = await ferreteria().sellerRequestShopDescription(
      ids.tecnocasa ?? "",
      "Electrónica con garantía local.",
    );
    requestsMade.push(request);
    const front = await ferreteria().sellerShopFront(ids.tecnocasa ?? "");
    expect(front).toMatchObject({
      slug: "tecnocasa",
      can_edit: true,
      description_request: { status: "pending", kind: "description" },
    });
    const changes = await ferreteria().sellerShopChanges(ids.tecnocasa ?? "");
    expect(changes.requests.some((item) => item.kind === "description")).toBe(true);
    const queue = await staff().opsShopChangeRequests("pending");
    expect(queue.find((item) => item.id === request)).toMatchObject({
      kind: "description",
      proposed: { description: "Electrónica con garantía local." },
      can_decide: true,
    });
    await expect(
      shopper().sellerRequestShopDescription(ids.tecnocasa ?? "", "Hola"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reserves a logo, and gives staff an empty queue until one is sent", async () => {
    const reserved = await ferreteria().sellerReserveLogo(ids.tecnocasa ?? "");
    expect(reserved.files.map((file) => file.size)).toEqual([400, 800, 1600]);
    expect(reserved.files[0]?.path).toBe(`${ids.tecnocasa}/logo/${reserved.logo_id}/400.jpg`);
    await expect(
      ferreteria().sellerFinishLogo(ids.tecnocasa ?? "", reserved.logo_id, 1200, 1200),
    ).rejects.toMatchObject({ code: "photo_upload_incomplete" });
    await expect(staff().opsLogosForReview()).resolves.toEqual([]);
    await expect(ferreteria().sellerWithdrawLogo(ids.tecnocasa ?? "")).resolves.toBeUndefined();
    await expect(ferreteria().sellerRemoveLogo(ids.tecnocasa ?? "")).resolves.toBe(false);
    await expect(sendero().sellerReserveLogo(ids.tecnocasa ?? "")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("gives visitors an active shop's page, and nothing for any other", async () => {
    const shop = await db.as().getShop("tecnocasa");
    expect(shop).toMatchObject({ slug: "tecnocasa", trade_name: "TecnoCasa", logo: null });
    expect(shop?.products.length).toBeGreaterThan(3);
    await expect(db.as().getShop("bazar-nuevo")).resolves.toBeNull();
    await expect(db.as().getShop("no-existe")).resolves.toBeNull();
    await expect(db.as().shopPathExists("shop", "tecnocasa")).resolves.toBe(true);
    await expect(db.as().shopPathExists("shop", "bazar-nuevo")).resolves.toBe(false);
  });
});
