/**
 * Contract tests for product photos: the answers of the real database
 * functions match the schemas in areas/photos.ts, for the right caller, and
 * the wrong caller gets a typed refusal.
 *
 * The files a seller would upload are recorded straight into storage.objects
 * here (that is the storage service's job, not the API's). Everything this
 * suite creates is deleted again at the end, so the other suites see the seed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)("photos contract (against a seeded database)", () => {
  let laptop = "";
  let photoId = "";

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query<{ id: string }>(
      "select id from public.products where slug = $1",
      ["laptop-14-nimbo-libro"],
    );
    laptop = rows[0]?.id ?? "";
    expect(laptop, "database is not seeded — run pnpm db:local:reset").not.toBe("");
  });

  afterAll(async () => {
    await db.query(
      "delete from storage.objects where bucket_id like 'product-photos%' and split_part(name, '/', 2) = $1",
      [laptop],
    );
    await db.query("delete from public.product_photos where product_id = $1", [laptop]);
    await db.close();
  });

  const seller = () => db.as("vendedor@yuntera.example");
  const otherSeller = () => db.as("cafetal@yuntera.example");
  const staff = () => db.as("central@yuntera.example");

  it("gives the seller the photo manager of a listing, and nobody else", async () => {
    const photos = await seller().sellerPhotos(laptop);
    expect(photos).toMatchObject({ product_id: laptop, status: "active", change_waiting: false });
    expect(photos.rules.sizes).toEqual([400, 800, 1600]);
    expect(photos.photos).toEqual([]);

    await expect(otherSeller().sellerPhotos(laptop)).rejects.toMatchObject({
      code: "listing_not_found",
    });
    await expect(otherSeller().sellerReservePhoto(laptop)).rejects.toMatchObject({
      code: "listing_not_found",
    });
    await expect(db.as().sellerPhotos(laptop)).rejects.toMatchObject({
      code: "not_authenticated",
    });
  });

  it("reserves, finishes and lists a photo of a published listing as a waiting change", async () => {
    const reserved = await seller().sellerReservePhoto(laptop);
    photoId = reserved.photo_id;
    expect(reserved.bucket).toBe("product-photos-pending");
    expect(reserved.files.map((f) => f.size)).toEqual([400, 800, 1600]);
    expect(reserved.files[0]?.path).toMatch(new RegExp(`/${laptop}/${photoId}/400\\.jpg$`));

    await expect(
      seller().sellerFinishPhoto(photoId, "Laptop abierta", 1600, 1200),
    ).rejects.toMatchObject({
      code: "photo_upload_incomplete",
    });
    for (const file of reserved.files) {
      await db.query(
        `insert into storage.objects (bucket_id, name, metadata)
         values ($1, $2, '{"mimetype": "image/jpeg", "size": 90000}')`,
        [reserved.bucket, file.path],
      );
    }
    await expect(
      otherSeller().sellerFinishPhoto(photoId, "Laptop abierta", 1600, 1200),
    ).rejects.toMatchObject({
      code: "photo_not_found",
    });
    const finished = await seller().sellerFinishPhoto(
      photoId,
      "Laptop abierta de frente",
      1600,
      1200,
    );
    expect(finished).toMatchObject({
      state: "pending",
      alt: "Laptop abierta de frente",
      live: false,
    });

    const photos = await seller().sellerPhotos(laptop);
    expect(photos.change_waiting).toBe(true);
    expect(photos.photos.map((p) => p.photo_id)).toEqual([photoId]);

    const saved = await seller().sellerSavePhotos(laptop, [
      { photoId, alt: "Laptop abierta vista de frente" },
    ]);
    expect(saved.outcome).toBe("in_review");
    await expect(seller().sellerSavePhotos(laptop, [])).rejects.toMatchObject({
      code: "photos_changed",
    });
  });

  it("shows catalogue staff the change with before and after", async () => {
    const queue = await staff().opsPhotosForReview();
    const item = queue.find((entry) => entry.product_id === laptop);
    expect(item).toMatchObject({ kind: "change", status: "active", unpublished: 0 });
    expect(item?.before).toEqual([]);
    expect(item?.after.map((p) => p.alt)).toEqual(["Laptop abierta vista de frente"]);
    expect(await staff().opsPhotoFilesToPublish(laptop)).toEqual([]);
    expect(await staff().opsConfirmPhotosPublished(laptop)).toEqual({ published: 0, waiting: 0 });

    await expect(seller().opsPhotosForReview()).rejects.toMatchObject({ code: "forbidden" });
    await expect(seller().photoFilesToDelete()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("removes a waiting photo at once and lists its files for deletion", async () => {
    expect(await seller().sellerRemovePhoto(photoId)).toEqual({ outcome: "removed" });
    const files = await seller().photoFilesToDelete(laptop);
    expect(files).toHaveLength(3);
    expect(files.every((f) => f.bucket === "product-photos-pending")).toBe(true);
    expect((await staff().photoFilesToDelete()).length).toBeGreaterThanOrEqual(3);
    await expect(seller().sellerRemovePhoto(photoId)).rejects.toMatchObject({
      code: "photo_not_found",
    });
    await expect(seller().sellerWithdrawPhotoChanges(laptop)).rejects.toMatchObject({
      code: "photo_change_not_found",
    });
  });
});
