/**
 * Seller actions that lost their door when the lockdown closed the tables:
 *
 *   Shared offers   a seller finds a published product of another shop (name,
 *                   brand, barcode) and adds its own offer to a variant.
 *   Variants        the creating shop switches a variant off and on.
 *   Draft           a published listing goes back to draft, and to review again.
 *   Shop's face     the public description (a reviewed shop change) and the
 *                   logo (through the photo pipeline), and the shop's page.
 *   Paused offers   the shop's offers a fee change, or an approved edit of the
 *                   listing they sell on, left below the price floor.
 *
 * Some methods replace one of the same name (this area is spread after the
 * listings area): `getProduct` reads each shop's logo with its offer,
 * `sellerListing` reads which variants are on and which another shop sells,
 * and `shopPathExists` also answers for a shop's page. The kind
 * "description" of a shop change is in limits.ts with the other kinds.
 *
 * SQL: supabase/migrations/20261121083600_seller_listings.sql.
 */

import { z } from "zod";
import {
  fulfillment as fulfillmentSchema,
  offerStatus,
  productOffer,
  productPage,
  productStatus,
  sellerStatus,
} from "../schemas";
import { sellerListingDetail } from "./listings";
import { photoFilesToPublish, photoFormat, photoRules } from "./photos";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);
const money = z.number().int();

// ── The product page, with each shop's logo ─────────────────────────────────

export const shopOffer = productOffer.extend({
  seller: productOffer.shape.seller.extend({
    /** The shop's published logo (a template with `{w}`), or null. */
    logo: z.string().nullable(),
  }),
});
export type ShopOffer = z.infer<typeof shopOffer>;

export const shopProductPage = productPage.extend({
  skus: z.array(productPage.shape.skus.element.extend({ offers: z.array(shopOffer) })),
});
export type ShopProductPage = z.infer<typeof shopProductPage>;

// ── An offer on another shop's product ──────────────────────────────────────

export const catalogVariant = z.object({
  sku_id: id,
  sku_code: z.string(),
  variant_name: z.string(),
  gtin: z.string().nullable(),
  /** This shop's offer on the variant, if it has one (also archived). */
  my_offer_id: id.nullable(),
  my_offer_status: offerStatus.nullable(),
  /** Offers on sale now, from shops that may trade. */
  offer_count: z.number().int(),
  /** The lowest price on sale with stock, or null. */
  lowest_price_minor: money.nullable(),
  weight_grams: z.number().int(),
  /** Whether a Yuntera warehouse can take its package. */
  fits_warehouse: z.boolean(),
});
export type CatalogVariant = z.infer<typeof catalogVariant>;

export const catalogMatch = z.object({
  product_id: id,
  slug: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  category_name: z.string(),
  image_path: z.string().nullable(),
  /** The shop that created the listing (and edits its content). */
  shop_name: z.string().nullable(),
  /** The listing is this shop's own: its offers are changed from its products. */
  own_listing: z.boolean(),
  variants: z.array(catalogVariant),
});
export type CatalogMatch = z.infer<typeof catalogMatch>;

export const addedOffer = z.object({
  offer_id: id,
  product_id: id,
  slug: z.string(),
  sku_id: id,
  /** "resumed": the shop had archived an offer on that variant, now back on sale. */
  outcome: z.enum(["added", "resumed"]),
});
export type AddedOffer = z.infer<typeof addedOffer>;

export interface AddOfferInput {
  sellerId: string;
  skuId: string;
  priceMinor: number;
  fulfillment: z.infer<typeof fulfillmentSchema>;
  /** Working days to have it ready; required when the shop ships it. */
  handlingDays?: number | null;
  listPriceMinor?: number | null;
}

// ── Variants and draft ──────────────────────────────────────────────────────

export const sellerListingVariant = z.object({
  sku_id: id,
  sku_code: z.string(),
  variant_name: z.string(),
  /** Switched on: shoppers can buy it. */
  active: z.boolean(),
  /** Another shop also sells this variant. */
  shared: z.boolean(),
  /** This shop's own offer on it. */
  own_offer_status: offerStatus.nullable(),
});
export type SellerListingVariant = z.infer<typeof sellerListingVariant>;

export const sharedListingDetail = sellerListingDetail.extend({
  variants: z.array(sellerListingVariant),
  /** How many other shops sell from this listing now. */
  other_shops: z.number().int(),
});
export type SharedListingDetail = z.infer<typeof sharedListingDetail>;

export const variantChange = z.object({
  product_id: id,
  slug: z.string(),
  sku_id: id,
  /**
   *   variant_off    nobody can order it any more
   *   variant_on     on sale again
   *   offer_paused   another shop sells it: only this shop's offer was paused
   *   offer_resumed  this shop's paused offer is on sale again
   *   unchanged      it already was that way
   */
  outcome: z.enum(["variant_off", "variant_on", "offer_paused", "offer_resumed", "unchanged"]),
});
export type VariantChange = z.infer<typeof variantChange>;

export const unpublishedListing = z.object({
  product_id: id,
  slug: z.string(),
  status: productStatus,
  /** A change that was waiting for review was withdrawn. */
  edit_withdrawn: z.boolean(),
});
export type UnpublishedListing = z.infer<typeof unpublishedListing>;

// ── Offers paused below the price floor ─────────────────────────────────────

export const pausedOffer = z.object({
  offer_id: id,
  product_id: id,
  slug: z.string(),
  title: z.string(),
  product_status: productStatus,
  variant_name: z.string(),
  sku_code: z.string(),
  image_path: z.string().nullable(),
  fulfillment: fulfillmentSchema,
  handling_days: z.number().int(),
  price_minor: money,
  list_price_minor: money.nullable(),
  /** The lowest price that covers the fees, in whole colones; null when no price does. */
  min_price_minor: money.nullable(),
  /** fee_change: the fees changed; listing_edit: the listing's package or category changed. */
  reason: z.enum(["fee_change", "listing_edit"]),
  schedule_version: z.string(),
  paused_at: timestamp,
});
export type PausedOffer = z.infer<typeof pausedOffer>;

// ── The shop's face ─────────────────────────────────────────────────────────

export const shopLogo = z.object({
  logo_id: id,
  state: z.enum(["uploading", "pending", "approved", "rejected", "removed"]),
  format: photoFormat,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  template: z.string(),
  published: z.boolean(),
  rejection_reason: z.string().nullable(),
  created_at: timestamp,
  decided_at: timestamp.nullable(),
});
export type ShopLogo = z.infer<typeof shopLogo>;

/** A shop-change request as the seller sees it (see limits.ts), here with the description. */
const descriptionRequest = z.object({
  id,
  kind: z.literal("description"),
  status: z.enum(["pending", "approved", "rejected"]),
  proposed: z.object({ description: z.string().nullable() }),
  requested_at: timestamp,
  requested_by_name: z.string().nullable(),
  decided_at: timestamp.nullable(),
  note: z.string().nullable(),
});

export const sellerShopFront = z.object({
  seller_id: id,
  slug: z.string(),
  trade_name: z.string(),
  status: sellerStatus,
  description: z.string().nullable(),
  logo: z.string().nullable(),
  /** The owner or an administrator of a shop that is not closed. */
  can_edit: z.boolean(),
  rules: photoRules,
  description_request: descriptionRequest.nullable(),
  logo_waiting: shopLogo.nullable(),
  logo_rejected: shopLogo.nullable(),
});
export type SellerShopFront = z.infer<typeof sellerShopFront>;

export const reservedLogo = z.object({
  logo_id: id,
  bucket: z.string(),
  content_type: z.string(),
  files: z.array(z.object({ size: z.number().int(), path: z.string() })),
});
export type ReservedLogo = z.infer<typeof reservedLogo>;

export const opsLogoReview = shopLogo.extend({
  /** review: waiting for a decision; publish: approved, its public files not written yet. */
  kind: z.enum(["review", "publish"]),
  seller_id: id,
  seller_name: z.string(),
  seller_slug: z.string(),
  seller_status: sellerStatus,
  current_logo: z.string().nullable(),
  /** The waiting copy staff look at (the largest). */
  review_path: z.string(),
  /** Its files were uploaded again after it was sent: it will not be approved. */
  files_changed: z.boolean(),
  /** The staff member belongs to that shop and may not decide. */
  own_shop: z.boolean(),
});
export type OpsLogoReview = z.infer<typeof opsLogoReview>;

export const logoPublished = z.object({ outcome: z.enum(["published", "waiting", "refused"]) });

export const publicShop = z.object({
  slug: z.string(),
  trade_name: z.string(),
  /** Plain text, shown as text: never markup. */
  description: z.string().nullable(),
  logo: z.string().nullable(),
  selling_since: timestamp.nullable(),
  products: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      brand_name: z.string().nullable(),
      image_path: z.string().nullable(),
      /** This shop's lowest price among its offers with stock, else among all its offers. */
      in_stock_price_minor: money.nullable(),
      price_minor: money,
      in_stock: z.boolean(),
      fulfilled_by_platform: z.boolean(),
      rating_sum: z.number().int(),
      rating_count: z.number().int(),
    }),
  ),
});
export type PublicShop = z.infer<typeof publicShop>;

// ── Errors ──────────────────────────────────────────────────────────────────

export const sellerListingsErrors = {
  variant_not_found: {
    "es-CR":
      "Ese producto ya no se puede ofrecer: no está publicado o esa variante no está a la venta. Busque de nuevo.",
    en: "That product can no longer be offered: it is not published or that variant is not on sale. Search again.",
  },
  own_listing: {
    "es-CR":
      "Ese producto es de su tienda. Cambie su precio y sus existencias desde la lista de productos.",
    en: "That product is your shop's own. Change its price and stock from your list of products.",
  },
  offer_exists: {
    "es-CR":
      "Su tienda ya ofrece esa variante. Cambie el precio o póngala a la venta desde la lista de productos.",
    en: "Your shop already offers that variant. Change its price or put it on sale from your list of products.",
  },
  too_many_new_offers: {
    "es-CR":
      "Su tienda agregó hoy el máximo de ofertas en productos de otras tiendas. Podrá agregar más mañana.",
    en: "Your shop has added the most offers on other shops' products for today. You can add more tomorrow.",
  },
  invalid_variant_state: {
    "es-CR": "Indique si la variante queda a la venta o no.",
    en: "Say whether the variant stays on sale or not.",
  },
  last_variant: {
    "es-CR":
      "Es la única variante a la venta de este producto. Para dejar de venderlo, vuélvalo a borrador o archívelo.",
    en: "It is the only variant of this product on sale. To stop selling it, take it back to draft or archive it.",
  },
  listing_not_published: {
    "es-CR": "Ese producto no está publicado, así que ya está fuera de la tienda.",
    en: "That product is not published, so it is already out of the shop.",
  },
  invalid_shop_description: {
    "es-CR": "La descripción puede tener hasta 1000 caracteres. Acórtela y envíela de nuevo.",
    en: "The description can have up to 1000 characters. Shorten it and send it again.",
  },
  logo_not_found: {
    "es-CR":
      "Ese logotipo ya no está pendiente: fue decidido, reemplazado o retirado. Actualice la página.",
    en: "That logo is no longer waiting: it was decided, replaced or withdrawn. Refresh the page.",
  },
  logo_daily_limit_reached: {
    "es-CR": "Hoy ya subió el máximo de logotipos (10). Podrá subir otro mañana.",
    en: "You have uploaded the most logos for today (10). You can upload another tomorrow.",
  },
} as const satisfies Messages;

// ── Methods ─────────────────────────────────────────────────────────────────

export const sellerListingsApi = ({ call, run }: Caller) => ({
  /** The product page, with each offer's shop and its logo. Replaces the core method. */
  getProduct: (slug: string, postalCode?: string | null) =>
    call(
      "get_product",
      { p_slug: slug, p_postal_code: postalCode ?? null },
      shopProductPage.nullable(),
    ),
  /** Whether the shop has a page for this product, category or shop. Needs no account. */
  shopPathExists: (kind: "product" | "category" | "shop", slug: string) =>
    call("shop_path_exists", { p_kind: kind, p_slug: slug }, z.boolean()),
  /** A shop's public page, or null when it has none (unknown, pending, suspended or closed). */
  getShop: (slug: string) => call("get_shop", { p_slug: slug }, publicShop.nullable()),

  sellerCatalogSearch: (sellerId: string, query: string) =>
    call("seller_catalog_search", { p_seller_id: sellerId, p_query: query }, z.array(catalogMatch)),
  sellerAddOffer: (input: AddOfferInput) =>
    call(
      "seller_add_offer",
      {
        p_seller_id: input.sellerId,
        p_sku_id: input.skuId,
        p_price_minor: input.priceMinor,
        p_fulfillment: input.fulfillment,
        p_handling_days: input.fulfillment === "platform" ? null : (input.handlingDays ?? null),
        p_list_price_minor: input.listPriceMinor ?? null,
      },
      addedOffer,
    ),

  /** The listing its shop edits, with each variant's state. Replaces the listings method. */
  sellerListing: (productId: string, skuId?: string | null) =>
    call(
      "seller_listing",
      { p_product_id: productId, p_sku_id: skuId ?? undefined },
      sharedListingDetail,
    ),
  sellerSetVariantActive: (skuId: string, active: boolean) =>
    call("seller_set_variant_active", { p_sku_id: skuId, p_active: active }, variantChange),
  sellerUnpublishListing: (productId: string) =>
    call("seller_unpublish_listing", { p_product_id: productId }, unpublishedListing),

  sellerPausedOffers: (sellerId: string) =>
    call("seller_paused_offers", { p_seller_id: sellerId }, z.array(pausedOffer)),

  sellerShopFront: (sellerId: string) =>
    call("seller_shop_front", { p_seller_id: sellerId }, sellerShopFront),
  /** Asks staff to change the shop's description; an empty text asks to remove it. */
  sellerRequestShopDescription: (sellerId: string, description: string) =>
    call(
      "seller_request_shop_description",
      { p_seller_id: sellerId, p_description: description },
      id,
    ),
  sellerReserveLogo: (sellerId: string, format: z.infer<typeof photoFormat> = "jpeg") =>
    call("seller_reserve_logo", { p_seller_id: sellerId, p_format: format }, reservedLogo),
  sellerFinishLogo: (sellerId: string, logoId: string, width: number, height: number) =>
    call(
      "seller_finish_logo",
      { p_seller_id: sellerId, p_logo_id: logoId, p_width: width, p_height: height },
      shopLogo,
    ),
  sellerWithdrawLogo: (sellerId: string) => run("seller_withdraw_logo", { p_seller_id: sellerId }),
  /** True when there was a logo to remove. */
  sellerRemoveLogo: (sellerId: string) =>
    call("seller_remove_logo", { p_seller_id: sellerId }, z.boolean()),

  opsLogosForReview: () => call("ops_logos_for_review", {}, z.array(opsLogoReview)),
  opsReviewLogo: (logoId: string, approve: boolean, reason?: string | null) =>
    run("ops_review_logo", { p_logo_id: logoId, p_approve: approve, p_reason: reason ?? null }),
  /** The approved logo's files to write, in the shape the photo publisher takes. */
  opsLogoFilesToPublish: (logoId: string) =>
    call("ops_logo_files_to_publish", { p_logo_id: logoId }, photoFilesToPublish),
  opsConfirmLogoPublished: (logoId: string) =>
    call("ops_confirm_logo_published", { p_logo_id: logoId }, logoPublished),
});
