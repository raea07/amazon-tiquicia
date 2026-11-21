/**
 * Product photos: the seller's photo manager, catalogue review and promotion
 * to the public bucket, and the list of files nobody needs any more.
 *
 * SQL: supabase/migrations/20261121082700_product_photos.sql. The files
 * themselves go through the storage service, not through these methods; the
 * paths these methods return are where they go.
 */

import { z } from "zod";
import { productStatus } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);

export const photoState = z.enum(["uploading", "pending", "approved", "rejected", "removed"]);
export type PhotoState = z.infer<typeof photoState>;

export const photoFormat = z.enum(["jpeg", "png", "webp"]);

export const photoRules = z.object({
  sizes: z.array(z.number().int()),
  max_photos: z.number().int(),
  max_bytes: z.number().int(),
  min_edge: z.number().int(),
  alt_min: z.number().int(),
  alt_max: z.number().int(),
  upload_window_minutes: z.number().int(),
});

/** One photo as its seller and catalogue staff see it. */
export const productPhoto = z.object({
  photo_id: id,
  state: photoState,
  /** The seller's order (1 is first). */
  position: z.number().int(),
  alt: z.string().nullable(),
  /** Pixel size of the largest copy. */
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  format: photoFormat,
  /** Path with `{w}` where the size goes; the same in both buckets. */
  template: z.string(),
  /** The shop shows it (or will, once its files are published). */
  live: z.boolean(),
  live_position: z.number().int().nullable(),
  live_alt: z.string().nullable(),
  /** Its files are in the public bucket. */
  published: z.boolean(),
  /** The seller asked to remove it; it stays in the shop until staff approve. */
  remove_requested: z.boolean(),
  rejection_reason: z.string().nullable(),
  created_at: timestamp,
  decided_at: timestamp.nullable(),
});
export type ProductPhoto = z.infer<typeof productPhoto>;

/** Everything the photo manager of one listing needs. */
export const sellerPhotos = z.object({
  product_id: id,
  seller_id: id,
  status: productStatus,
  rules: photoRules,
  /** Fingerprint of the proposal; changes whenever the seller changes anything. */
  revision: z.string(),
  /** A published listing has a photo change waiting for review. */
  change_waiting: z.boolean(),
  /** The working set: waiting and approved photos, in the seller's order. */
  photos: z.array(productPhoto),
  /** Approved photos the seller asked to remove, still in the shop. */
  leaving: z.array(productPhoto),
  rejected: z.array(productPhoto),
  /** What the shop shows now. */
  live: z.array(productPhoto),
});
export type SellerPhotos = z.infer<typeof sellerPhotos>;

/** A reserved photo: where each of its files goes. */
export const reservedPhoto = z.object({
  photo_id: id,
  bucket: z.string(),
  content_type: z.string(),
  files: z.array(z.object({ size: z.number().int(), path: z.string() })),
});
export type ReservedPhoto = z.infer<typeof reservedPhoto>;

export const savedPhotos = z.object({
  /** `in_review`: a published listing; the shop keeps its photos until approved. */
  outcome: z.enum(["saved", "in_review"]),
  revision: z.string(),
});

export const removedPhoto = z.object({ outcome: z.enum(["removed", "in_review"]) });

/** A listing with photos waiting for a catalogue decision. */
export const opsPhotoReview = z.object({
  product_id: id,
  slug: z.string(),
  title: z.string(),
  status: productStatus,
  seller_name: z.string(),
  /**
   * `new`: decided with the listing. `change`: a published listing's photos.
   * `publish`: approved, but the files are not yet in the public bucket.
   */
  kind: z.enum(["new", "change", "publish"]),
  revision: z.string(),
  before: z.array(productPhoto),
  after: z.array(productPhoto),
  unpublished: z.number().int(),
});
export type OpsPhotoReview = z.infer<typeof opsPhotoReview>;

export const photoFilesToPublish = z.array(
  z.object({ photo_id: id, format: photoFormat, paths: z.array(z.string()) }),
);

export const photosPublished = z.object({
  published: z.number().int(),
  waiting: z.number().int(),
});

export const storedFile = z.object({ bucket: z.string(), path: z.string() });
export type StoredFile = z.infer<typeof storedFile>;

export interface PhotoOrderItem {
  photoId: string;
  alt: string;
}

export const photosErrors = {
  photo_not_found: {
    "es-CR": "Esa foto ya no está entre las de su producto. Actualice la página.",
    en: "That photo is no longer among your product's photos. Refresh the page.",
  },
  photo_limit_reached: {
    "es-CR":
      "Este producto ya tiene el máximo de 8 fotos, contando las que esperan revisión. Quite una antes de agregar otra.",
    en: "This product already has the maximum of 8 photos, counting those waiting for review. Remove one before adding another.",
  },
  invalid_photo: {
    "es-CR":
      "El archivo no es una foto que podamos usar. Suba una foto JPG, PNG o WebP de al menos 500 píxeles de lado.",
    en: "The file is not a photo we can use. Upload a JPG, PNG or WebP photo at least 500 pixels on its longest side.",
  },
  photo_alt_required: {
    "es-CR":
      "Describa cada foto con entre 5 y 250 caracteres: qué se ve en ella, para quien no puede verla.",
    en: "Describe each photo in 5 to 250 characters: what it shows, for someone who cannot see it.",
  },
  photo_upload_incomplete: {
    "es-CR": "La foto no terminó de subirse. Vuelva a elegirla e inténtelo de nuevo.",
    en: "The photo did not finish uploading. Choose it again and try once more.",
  },
  photos_changed: {
    "es-CR":
      "Las fotos cambiaron desde que abrió esta página. Actualícela para ver las más recientes.",
    en: "The photos changed since this page was opened. Refresh it to see the latest ones.",
  },
  photo_change_not_found: {
    "es-CR": "No hay cambios de fotos pendientes en este producto. Actualice la página.",
    en: "There are no photo changes waiting on this product. Refresh the page.",
  },
} as const satisfies Messages;

export const photosApi = ({ call, run }: Caller) => ({
  sellerPhotos: (productId: string) =>
    call("seller_photos", { p_product_id: productId }, sellerPhotos),
  /** Reserves a photo; upload its files to the returned paths, then finish it. */
  sellerReservePhoto: (productId: string, format: "jpeg" | "png" | "webp" = "jpeg") =>
    call("seller_reserve_photo", { p_product_id: productId, p_format: format }, reservedPhoto),
  sellerFinishPhoto: (photoId: string, alt: string, width: number, height: number) =>
    call(
      "seller_finish_photo",
      { p_photo_id: photoId, p_alt: alt, p_width: width, p_height: height },
      productPhoto,
    ),
  /** The whole working set, in its new order, with each photo's text. */
  sellerSavePhotos: (productId: string, items: PhotoOrderItem[]) =>
    call(
      "seller_save_photos",
      {
        p_product_id: productId,
        p_items: items.map((item) => ({ photo_id: item.photoId, alt: item.alt })),
      },
      savedPhotos,
    ),
  sellerRemovePhoto: (photoId: string) =>
    call("seller_remove_photo", { p_photo_id: photoId }, removedPhoto),
  sellerWithdrawPhotoChanges: (productId: string) =>
    run("seller_withdraw_photo_changes", { p_product_id: productId }),

  opsPhotosForReview: () => call("ops_photos_for_review", {}, z.array(opsPhotoReview)),
  opsRejectPhoto: (photoId: string, reason: string) =>
    run("ops_reject_photo", { p_photo_id: photoId, p_reason: reason }),
  opsReviewPhotoChange: (
    productId: string,
    revision: string,
    approve: boolean,
    reason?: string | null,
  ) =>
    run("ops_review_photo_change", {
      p_product_id: productId,
      p_revision: revision,
      p_approve: approve,
      p_reason: reason ?? undefined,
    }),
  opsPhotoFilesToPublish: (productId: string) =>
    call("ops_photo_files_to_publish", { p_product_id: productId }, photoFilesToPublish),
  opsConfirmPhotosPublished: (productId: string) =>
    call("ops_confirm_photos_published", { p_product_id: productId }, photosPublished),
  /** Files nobody needs any more: for one listing, or (catalogue staff) everywhere. */
  photoFilesToDelete: (productId?: string | null) =>
    call("photo_files_to_delete", { p_product_id: productId ?? undefined }, z.array(storedFile)),
});
