/**
 * Contract tests for the staff catalogue tools and what the shop reads
 * because of them (areas/catalogue.ts): the answers of the real database
 * functions match the schemas, for the right caller, and the wrong caller
 * gets a typed refusal.
 *
 * What these tests change they undo: the category and the synonym they add
 * are removed, the brand is deleted again, and the review they hide is shown
 * again, so the other contract suites see the seeded catalogue. (Corrections
 * and take-downs, which plan messages to sellers, are covered by
 * supabase/tests/160_console_catalogue.sql instead.)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)("catalogue contract (against a seeded database)", () => {
  let review = "";

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query<{ id: string }>(
      `select r.id from public.reviews r
       join public.order_items i on i.id = r.order_item_id
       join public.orders o on o.id = i.order_id
       join public.products p on p.id = r.product_id
       where o.order_number = 'YT-100004' and p.slug = 'cafe-molido-tarrazu-340g'`,
    );
    review = rows[0]?.id ?? "";
    expect(review, "database is not seeded — run pnpm db:local:reset").not.toBe("");
  });

  afterAll(async () => {
    // Leave the seed as it was if a test stopped half way.
    await staff()
      .opsShowReview(review)
      .catch(() => undefined);
    await staff()
      .opsRemoveSearchSynonym("contratito")
      .catch(() => undefined);
    await db.query("delete from public.categories where slug like 'contrato-prueba%'");
    await db.query("delete from public.brands where slug = 'marca-de-contrato'");
    await db.close();
  });

  const staff = () => db.as("central@yuntera.example");
  const shopper = () => db.as("comprador@yuntera.example");

  it("gives a visitor the brand filter and the search by brand", async () => {
    const visitor = db.as();
    const brands = await visitor.listBrands();
    expect(brands.map((brand) => brand.slug)).toContain("volcan");
    expect(brands.every((brand) => brand.product_count > 0)).toBe(true);
    expect((await visitor.listBrands("cafe")).map((brand) => brand.slug)).toEqual([
      "cafetal-los-santos",
    ]);
    const volcan = await visitor.searchProducts({ brandSlug: "volcan", limit: 60 });
    expect(volcan.length).toBeGreaterThan(0);
    expect(volcan.every((product) => product.brand_name === "Volcán")).toBe(true);
    expect(await visitor.categoryRedirect("no-existe")).toBeNull();
  });

  it("gives catalogue staff the tree, the brands, the synonyms and a preview", async () => {
    const api = staff();
    const categories = await api.opsCatalogCategories();
    const audio = categories.find((category) => category.slug === "audio");
    expect(audio).toMatchObject({ parent_slug: "electronica", depth: 2, visible: true });
    expect(audio?.referral_bps).toBe(800);
    const brands = await api.opsCatalogBrands();
    expect(brands.find((brand) => brand.slug === "nimbo")?.active_product_count).toBeGreaterThan(0);
    const synonyms = await api.opsSearchSynonyms();
    expect(synonyms.find((synonym) => synonym.term === "refri")?.expansions).toEqual([
      "refrigeradora",
    ]);
    const preview = await api.opsSearchPreview("Audífonos");
    expect(preview.query).toBe("audifonos");
    expect(preview.synonyms.map((synonym) => synonym.term)).toEqual(["audifonos"]);
    expect(preview.results.map((result) => result.slug)).toContain(
      "audifonos-inalambricos-nimbo-aire",
    );
    const product = await api.opsCatalogProduct("licuadora-volcan-600w");
    expect(product).toMatchObject({ status: "active", taken_down: false, edit_pending: false });
    expect(product.category.slug).toBe("cocina-electrica");
  });

  it("refuses everyone else", async () => {
    await expect(shopper().opsCatalogCategories()).rejects.toMatchObject({ code: "forbidden" });
    await expect(shopper().opsReviews()).rejects.toMatchObject({ code: "forbidden" });
    await expect(db.as().opsCatalogBrands()).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(staff().opsCatalogProduct("no-existe")).rejects.toMatchObject({
      code: "catalog_product_not_found",
    });
  });

  it("creates, renames and deletes a category; the old address redirects", async () => {
    const api = staff();
    const created = await api.opsCreateCategory({ nameEs: "Contrato prueba" });
    expect(created.slug).toBe("contrato-prueba");
    expect(created.visible).toBe(true);
    const renamed = await api.opsUpdateCategory({
      categoryId: created.id,
      slug: "contrato-prueba-nueva",
    });
    expect(renamed).toEqual({
      id: created.id,
      slug: "contrato-prueba-nueva",
      previous_slug: "contrato-prueba",
    });
    expect(await db.as().categoryRedirect("contrato-prueba")).toBe("contrato-prueba-nueva");
    const row = (await api.opsCatalogCategories()).find((category) => category.id === created.id);
    expect(row?.aliases).toEqual(["contrato-prueba"]);
    await expect(api.opsCreateCategory({ nameEs: "Otra", slug: "buscar" })).rejects.toMatchObject({
      code: "category_slug_reserved",
    });
    await api.opsDeleteCategory(created.id);
    expect(await db.as().categoryRedirect("contrato-prueba")).toBeNull();
  });

  it("creates a brand and refuses a duplicate", async () => {
    const api = staff();
    const brand = await api.opsCreateBrand("Marca de contrato");
    expect(brand).toMatchObject({ slug: "marca-de-contrato", name: "Marca de contrato" });
    await expect(api.opsCreateBrand("MARCA DE CONTRATO")).rejects.toMatchObject({
      code: "brand_name_taken",
    });
  });

  it("adds and removes a synonym, normalised the way search reads it", async () => {
    const api = staff();
    expect(await api.opsAddSearchSynonym("  Contratito ", ["Licuadora"])).toEqual({
      term: "contratito",
      expansions: ["licuadora"],
    });
    const found = await db.as().searchProducts({ query: "contratito" });
    expect(found.map((product) => product.slug)).toContain("licuadora-volcan-600w");
    await api.opsRemoveSearchSynonym("contratito");
    await expect(api.opsAddSearchSynonym("de", ["licuadora"])).rejects.toMatchObject({
      code: "synonym_too_common",
    });
  });

  it("hides a review, tells its author why, and shows it again", async () => {
    const api = staff();
    const page = await api.opsReviews("all", review);
    expect(page.total).toBe(1);
    expect(page.reviews[0]).toMatchObject({ id: review, hidden: false, rating: 4 });
    expect(Object.keys(page.reviews[0] ?? {})).not.toContain("user_id");

    await api.opsHideReview(review, "off_topic", "Habla de otra tienda.");
    const hidden = await api.opsReviews("hidden");
    expect(hidden.reviews.map((row) => row.id)).toContain(review);
    const mine = await shopper().myOrderReviews("YT-100004");
    expect(mine.find((row) => row.hidden)).toMatchObject({
      hidden_reason: "off_topic",
      reply_hidden: false,
    });
    await expect(
      db.as("comprador2@yuntera.example").myOrderReviews("YT-100004"),
    ).rejects.toMatchObject({ code: "order_not_found" });
    const product = await db.as().getProduct("cafe-molido-tarrazu-340g");
    expect(product?.reviews.map((row) => row.id)).not.toContain(review);

    await api.opsShowReview(review);
    expect((await shopper().myOrderReviews("YT-100004")).every((row) => !row.hidden)).toBe(true);
  });
});
