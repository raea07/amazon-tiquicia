/**
 * Listings after they are created: editing, review of edits to published
 * listings, archiving, and the shop's "does this address exist" check.
 *
 * SQL: supabase/migrations/20261121082400_fixes.sql.
 */

import { z } from "zod";
import { productStatus } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);

/** The part of a listing its seller can change, plus the package of one variant. */
export const listingContent = z.object({
  title: z.string(),
  description: z.string().nullable(),
  bullet_points: z.array(z.string()),
  category_slug: z.string(),
  category_name: z.string(),
  sku_id: id,
  weight_grams: z.number().int(),
  length_cm: z.number(),
  width_cm: z.number(),
  height_cm: z.number(),
});
export type ListingContent = z.infer<typeof listingContent>;

/** The fields of `listingContent` a review compares, in the order they are shown. */
export const listingEditField = z.enum([
  "title",
  "category_slug",
  "bullet_points",
  "description",
  "weight_grams",
  "length_cm",
  "width_cm",
  "height_cm",
]);
export type ListingEditField = z.infer<typeof listingEditField>;

/** One listing as its seller edits it. */
export const sellerListingDetail = z.object({
  product_id: id,
  slug: z.string(),
  seller_id: id,
  status: productStatus,
  /** Why a new listing was rejected, while it has not been sent again. */
  rejection_reason: z.string().nullable(),
  /** What the listing says now (for a published one: what shoppers see). */
  content: listingContent,
  variants: z.array(z.object({ sku_id: id, sku_code: z.string(), variant_name: z.string() })),
  /** A change to a published listing that is waiting for review. */
  pending: z
    .object({ request_id: id, submitted_at: timestamp, proposed: listingContent })
    .nullable(),
  /** The seller's latest change, when it was refused and nothing newer replaced it. */
  last_rejection: z
    .object({ decided_at: timestamp, reason: z.string(), proposed: listingContent })
    .nullable(),
  /** Another seller also sells from this page, so it cannot be archived. */
  shared: z.boolean(),
});
export type SellerListingDetail = z.infer<typeof sellerListingDetail>;

/** Per product in a seller's list: may they edit it, and is a change of theirs waiting or refused. */
export const sellerListingEdit = z.object({
  product_id: id,
  editable: z.boolean(),
  edit_status: z.enum(["pending", "rejected"]).nullable(),
  edit_reason: z.string().nullable(),
  edit_at: timestamp.nullable(),
});
export type SellerListingEdit = z.infer<typeof sellerListingEdit>;

export const listingUpdateResult = z.object({
  product_id: id,
  slug: z.string(),
  status: productStatus,
  /**
   * `saved`: changed in place, not sent. `submitted`: changed in place and sent
   * for review. `in_review`: the listing is published and stays as it is until
   * the change is approved.
   */
  outcome: z.enum(["saved", "submitted", "in_review"]),
});
export type ListingUpdateResult = z.infer<typeof listingUpdateResult>;

/** A change to a published listing, as catalogue staff review it. */
export const opsListingEdit = z.object({
  request_id: id,
  product_id: id,
  slug: z.string(),
  seller_name: z.string(),
  submitted_at: timestamp,
  sku_code: z.string(),
  variant_name: z.string(),
  before: listingContent,
  after: listingContent,
  changed: z.array(listingEditField),
});
export type OpsListingEdit = z.infer<typeof opsListingEdit>;

export interface UpdateListingInput {
  productId: string;
  /** The variant whose package is being described; the first one when omitted. */
  skuId?: string | null;
  title: string;
  categorySlug: string;
  description?: string | null;
  bulletPoints?: string[];
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** For a listing that is not public yet: send it for review, or only save it. */
  submit?: boolean;
}

export const listingsErrors = {
  listing_not_found: {
    "es-CR": "No encontramos esa publicación entre las de su tienda.",
    en: "We could not find that listing in your shop.",
  },
  listing_not_editable: {
    "es-CR": "Esta publicación está archivada o fue retirada, así que ya no se puede cambiar.",
    en: "This listing is archived or was taken down, so it can no longer be changed.",
  },
  listing_unchanged: {
    "es-CR": "No hay cambios que enviar: la publicación ya dice exactamente eso.",
    en: "There is nothing to send: the listing already says exactly that.",
  },
  listing_shared: {
    "es-CR":
      "Otra tienda también vende desde esta publicación, así que no se puede archivar ni volver a borrador. Si usted ya no la vende, ponga su oferta en pausa.",
    en: "Another shop also sells from this listing, so it cannot be archived or taken back to draft. If you no longer sell it, pause your offer instead.",
  },
  published_listing_locked: {
    "es-CR":
      "Esta publicación ya está a la venta. Cámbiela desde «Editar»: su cambio pasa por revisión y mientras tanto la publicación sigue igual.",
    en: "This listing is already on sale. Change it from “Edit”: the change is reviewed, and the listing stays as it is meanwhile.",
  },
  edit_not_found: {
    "es-CR":
      "Ese cambio ya no está pendiente: fue decidido, retirado o reemplazado por uno más reciente. Actualice la página.",
    en: "That change is no longer waiting: it was decided, withdrawn or replaced by a newer one. Refresh the page.",
  },
} as const satisfies Messages;

export const listingsApi = ({ call, run }: Caller) => ({
  /** Whether the shop has a page for this product or category. Needs no account. */
  shopPathExists: (kind: "product" | "category", slug: string) =>
    call("shop_path_exists", { p_kind: kind, p_slug: slug }, z.boolean()),

  sellerListing: (productId: string, skuId?: string | null) =>
    call(
      "seller_listing",
      { p_product_id: productId, p_sku_id: skuId ?? undefined },
      sellerListingDetail,
    ),
  sellerListingEdits: (sellerId: string) =>
    call("seller_listing_edits", { p_seller_id: sellerId }, z.array(sellerListingEdit)),
  sellerUpdateListing: (input: UpdateListingInput) =>
    call(
      "seller_update_listing",
      {
        p_product_id: input.productId,
        p_title: input.title,
        p_category_slug: input.categorySlug,
        p_description: input.description ?? null,
        p_bullet_points: input.bulletPoints ?? [],
        p_weight_grams: input.weightGrams,
        p_length_cm: input.lengthCm,
        p_width_cm: input.widthCm,
        p_height_cm: input.heightCm,
        p_sku_id: input.skuId ?? undefined,
        p_submit: input.submit,
      },
      listingUpdateResult,
    ),
  sellerWithdrawListingEdit: (productId: string) =>
    run("seller_withdraw_listing_edit", { p_product_id: productId }),
  /** True when the listing was archived now; false when it already was. */
  sellerArchiveListing: (productId: string) =>
    call("seller_archive_listing", { p_product_id: productId }, z.boolean()),

  opsListingEditsForReview: () => call("ops_listing_edits_for_review", {}, z.array(opsListingEdit)),
  opsReviewListingEdit: (requestId: string, approve: boolean, reason?: string | null) =>
    run("ops_review_listing_edit", {
      p_request_id: requestId,
      p_approve: approve,
      p_reason: reason ?? undefined,
    }),
});
