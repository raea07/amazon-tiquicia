/**
 * Contract tests for listings after creation: the answers of the real
 * database functions match the schemas in areas/listings.ts, for the right
 * caller, and the wrong caller gets a typed refusal.
 *
 * These tests leave the seeded data as they found it: the one edit they make
 * is withdrawn again, so the other contract suite sees the same catalogue.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)("listings contract (against a seeded database)", () => {
  let laptop = "";
  let tecnocasa = "";

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query<{ id: string; seller: string }>(
      "select id, created_by_seller_id as seller from public.products where slug = $1",
      ["laptop-14-nimbo-libro"],
    );
    laptop = rows[0]?.id ?? "";
    tecnocasa = rows[0]?.seller ?? "";
    expect(laptop, "database is not seeded — run pnpm db:local:reset").not.toBe("");
  });

  afterAll(async () => {
    // Leave nothing waiting if a test stopped half way.
    await db
      .as("vendedor@yuntera.example")
      .sellerWithdrawListingEdit(laptop)
      .catch(() => undefined);
    await db.close();
  });

  const seller = () => db.as("vendedor@yuntera.example");
  const otherSeller = () => db.as("cafetal@yuntera.example");
  const staff = () => db.as("central@yuntera.example");

  it("tells a visitor whether a shop address exists", async () => {
    const api = db.as();
    expect(await api.shopPathExists("product", "cafe-molido-tarrazu-340g")).toBe(true);
    expect(await api.shopPathExists("product", "no-existe-este-producto")).toBe(false);
    expect(await api.shopPathExists("product", "lampara-mesa-bambu")).toBe(false); // awaiting review
    expect(await api.shopPathExists("category", "hogar")).toBe(true);
    expect(await api.shopPathExists("category", "no-existe")).toBe(false);
  });

  it("gives a seller their listing to edit, and nobody else's", async () => {
    const listing = await seller().sellerListing(laptop);
    expect(listing).toMatchObject({
      slug: "laptop-14-nimbo-libro",
      status: "active",
      seller_id: tecnocasa,
      pending: null,
      shared: false,
    });
    expect(listing.content.category_slug).toBe("laptops");
    expect(listing.variants).toHaveLength(1);
    expect(listing.content.sku_id).toBe(listing.variants[0]?.sku_id);

    await expect(otherSeller().sellerListing(laptop)).rejects.toMatchObject({
      code: "listing_not_found",
    });
    await expect(db.as("comprador@yuntera.example").sellerListing(laptop)).rejects.toMatchObject({
      code: "listing_not_found",
    });
    await expect(db.as().sellerListing(laptop)).rejects.toMatchObject({
      code: "not_authenticated",
    });
  });

  it("holds an edit to a published listing for review, with before and after", async () => {
    const before = await seller().sellerListing(laptop);
    const proposedTitle = `${before.content.title} (prueba de contrato)`;

    const result = await seller().sellerUpdateListing({
      productId: laptop,
      title: proposedTitle,
      categorySlug: before.content.category_slug,
      description: before.content.description,
      bulletPoints: before.content.bullet_points,
      weightGrams: before.content.weight_grams,
      lengthCm: before.content.length_cm,
      widthCm: before.content.width_cm,
      heightCm: before.content.height_cm,
    });
    expect(result).toMatchObject({ outcome: "in_review", status: "active" });

    // The listing itself has not changed; the proposal waits beside it.
    const waiting = await seller().sellerListing(laptop);
    expect(waiting.content.title).toBe(before.content.title);
    expect(waiting.pending?.proposed.title).toBe(proposedTitle);
    expect((await db.as().getProduct("laptop-14-nimbo-libro"))?.title).toBe(before.content.title);

    const mine = await seller().sellerListingEdits(tecnocasa);
    expect(mine.find((row) => row.product_id === laptop)).toMatchObject({
      editable: true,
      edit_status: "pending",
    });
    await expect(otherSeller().sellerListingEdits(tecnocasa)).rejects.toMatchObject({
      code: "forbidden",
    });

    const queue = await staff().opsListingEditsForReview();
    const entry = queue.find((edit) => edit.product_id === laptop);
    expect(entry).toMatchObject({
      request_id: waiting.pending?.request_id,
      seller_name: "TecnoCasa",
      changed: ["title"],
    });
    expect(entry?.before.title).toBe(before.content.title);
    expect(entry?.after.title).toBe(proposedTitle);
    await expect(seller().opsListingEditsForReview()).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      seller().opsReviewListingEdit(waiting.pending?.request_id ?? "", true),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Sending what is already published is refused with a message a person can read.
    await seller().sellerWithdrawListingEdit(laptop);
    const unchanged = await seller()
      .sellerUpdateListing({
        productId: laptop,
        title: before.content.title,
        categorySlug: before.content.category_slug,
        description: before.content.description,
        bulletPoints: before.content.bullet_points,
        weightGrams: before.content.weight_grams,
        lengthCm: before.content.length_cm,
        widthCm: before.content.width_cm,
        heightCm: before.content.height_cm,
      })
      .catch((error: unknown) => error);
    expect(unchanged).toMatchObject({ code: "listing_unchanged" });

    expect((await seller().sellerListing(laptop)).pending).toBeNull();
    expect((await staff().opsListingEditsForReview()).some((e) => e.product_id === laptop)).toBe(
      false,
    );
    await expect(seller().sellerWithdrawListingEdit(laptop)).rejects.toMatchObject({
      code: "edit_not_found",
    });
  });
});
