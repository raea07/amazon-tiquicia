/**
 * Staff catalogue tools: categories, brands, search synonyms, review
 * moderation and staff corrections to a product. Also what the shop reads
 * because of them: the brand filter, old category addresses, the search with
 * a brand, and the author's view of a hidden review.
 *
 * SQL: supabase/migrations/20261121083700_console_catalogue.sql.
 */

import { z } from "zod";
import { productCard, productStatus } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);

// ── What the shop reads ─────────────────────────────────────────────────────

/** A brand a shopper can filter by. */
export const shopBrand = z.object({
  slug: z.string(),
  name: z.string(),
  product_count: z.number().int(),
  /** Addresses that used to mean this brand (before a rename, or of a brand merged into it). */
  former_slugs: z.array(z.string()),
});
export type ShopBrand = z.infer<typeof shopBrand>;

/** The search box and the listing filters, with the brand (by its address). */
export interface CatalogSearchInput {
  query?: string | null;
  categorySlug?: string | null;
  brandSlug?: string | null;
  minPriceMinor?: number | null;
  maxPriceMinor?: number | null;
  inStockOnly?: boolean;
  madeInCr?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating" | "newest";
  limit?: number;
  offset?: number;
}

/** Why a review, or the seller's reply to it, is hidden. A low rating is never one. */
export const REVIEW_HIDE_REASONS = [
  "offensive",
  "personal_data",
  "off_topic",
  "spam",
  "not_genuine",
  "illegal",
  "rules",
] as const;
export const reviewHideReason = z.enum(REVIEW_HIDE_REASONS);
export type ReviewHideReason = z.infer<typeof reviewHideReason>;

/** What the author of a review reads on their own order page. */
export const myOrderReview = z.object({
  order_item_id: id,
  hidden: z.boolean(),
  hidden_reason: reviewHideReason.nullable(),
  hidden_at: timestamp.nullable(),
  reply_hidden: z.boolean(),
  reply_hidden_reason: reviewHideReason.nullable(),
});
export type MyOrderReview = z.infer<typeof myOrderReview>;

// ── Categories ──────────────────────────────────────────────────────────────

export const opsCategory = z.object({
  id,
  slug: z.string(),
  parent_id: id.nullable(),
  parent_slug: z.string().nullable(),
  name_es: z.string(),
  name_en: z.string(),
  sort: z.number().int(),
  /** 1 for a department, 2 under it, 3 at most. */
  depth: z.number().int().min(1),
  /** Switched on (its own setting). */
  active: z.boolean(),
  /** Shows in the shop: it and every category above it are switched on. */
  visible: z.boolean(),
  child_count: z.number().int(),
  /** Products filed directly in it, in any state but archived. */
  product_count: z.number().int(),
  active_product_count: z.number().int(),
  /** Something refers to it (a product in any state, a past order): it can only be hidden. */
  in_use: z.boolean(),
  /** The commission its products pay, in basis points. */
  referral_bps: z.number().int(),
  /** Its own rate, rather than its parent's or the schedule's. */
  own_referral: z.boolean(),
  /** Old addresses, newest first, which the shop redirects here. */
  aliases: z.array(z.string()),
});
export type OpsCategory = z.infer<typeof opsCategory>;

export const createdCategory = z.object({ id, slug: z.string() });
export const updatedCategory = z.object({
  id,
  slug: z.string(),
  previous_slug: z.string().nullable(),
});

// ── Brands ──────────────────────────────────────────────────────────────────

export const opsBrand = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  active: z.boolean(),
  /** Old names (merged or renamed brands) that search still finds. */
  aliases: z.array(z.string()),
  /** Earlier filter addresses, which still show this brand. */
  former_slugs: z.array(z.string()),
  merged_into: z.object({ id, name: z.string(), slug: z.string() }).nullable(),
  merged_at: timestamp.nullable(),
  product_count: z.number().int(),
  active_product_count: z.number().int(),
});
export type OpsBrand = z.infer<typeof opsBrand>;

export const savedBrand = z.object({ id, slug: z.string(), name: z.string() });
export const brandMerge = z.object({ into_id: id, moved: z.number().int() });

// ── Synonyms ────────────────────────────────────────────────────────────────

export const searchSynonym = z.object({
  term: z.string(),
  expansions: z.array(z.string()),
  created_at: timestamp,
});
export type SearchSynonym = z.infer<typeof searchSynonym>;

export const addedSynonym = z.object({ term: z.string(), expansions: z.array(z.string()) });

export const searchPreview = z.object({
  /** The query as search reads it. */
  query: z.string(),
  /** The synonyms that widen it. */
  synonyms: z.array(z.object({ term: z.string(), expansions: z.array(z.string()) })),
  total: z.number().int(),
  results: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      brand_name: z.string().nullable(),
      category_slug: z.string(),
    }),
  ),
});
export type SearchPreview = z.infer<typeof searchPreview>;

// ── Reviews ─────────────────────────────────────────────────────────────────

export const REVIEW_FILTERS = ["all", "reported", "low", "replied", "hidden"] as const;
export const reviewFilter = z.enum(REVIEW_FILTERS);
export type ReviewFilter = z.infer<typeof reviewFilter>;

export const opsReview = z.object({
  id,
  product_slug: z.string(),
  product_title: z.string(),
  seller_name: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string().nullable(),
  created_at: timestamp,
  /** As the shop shows it ("María F."), never more. */
  author: z.string(),
  hidden: z.boolean(),
  hidden_reason: reviewHideReason.nullable(),
  hidden_at: timestamp.nullable(),
  seller_reply: z.string().nullable(),
  seller_replied_at: timestamp.nullable(),
  reply_hidden: z.boolean(),
  reply_hidden_reason: reviewHideReason.nullable(),
  open_reports: z.number().int(),
  report_reasons: z.array(z.string()),
});
export type OpsReview = z.infer<typeof opsReview>;

export const opsReviewPage = z.object({
  total: z.number().int(),
  page_size: z.number().int(),
  reviews: z.array(opsReview),
});
export type OpsReviewPage = z.infer<typeof opsReviewPage>;

// ── Products ────────────────────────────────────────────────────────────────

export const opsCatalogProduct = z.object({
  id,
  slug: z.string(),
  title: z.string(),
  status: productStatus,
  seller_name: z.string().nullable(),
  category: z.object({ id, slug: z.string(), name_es: z.string(), visible: z.boolean() }),
  brand: z.object({ id, name: z.string() }).nullable(),
  referral_bps: z.number().int(),
  tax_rate_bps: z.number().int(),
  rejection_reason: z.string().nullable(),
  /** Taken down by staff (by this screen or from a report): it can be put back. */
  taken_down: z.boolean(),
  taken_down_at: timestamp.nullable(),
  /** The seller changed it after the take-down: it cannot be put back, only sent to review. */
  changed_since_take_down: z.boolean(),
  /** A seller's change waits for review: decide it before correcting. */
  edit_pending: z.boolean(),
  offer_count: z.number().int(),
  rating_sum: z.number().int(),
  rating_count: z.number().int(),
});
export type OpsCatalogProduct = z.infer<typeof opsCatalogProduct>;

export interface CorrectProductInput {
  productId: string;
  categoryId?: string | null;
  brandId?: string | null;
  clearBrand?: boolean;
  note: string;
}

// ── Messages ────────────────────────────────────────────────────────────────

export const catalogueErrors = {
  category_slug_invalid: {
    "es-CR":
      "La dirección solo puede tener letras sin tildes, números y guiones, entre 2 y 60 caracteres.",
    en: "The address may only have plain letters, digits and hyphens, 2 to 60 characters.",
  },
  category_slug_reserved: {
    "es-CR": "Esa dirección la usa la tienda para otra cosa. Elija otra.",
    en: "The shop uses that address for something else. Choose another.",
  },
  category_slug_taken: {
    "es-CR": "Esa dirección ya es de otra categoría, o lo fue y sigue llevando a ella. Elija otra.",
    en: "That address belongs to another category, or did and still leads to it. Choose another.",
  },
  category_name_invalid: {
    "es-CR": "Escriba un nombre de entre 2 y 60 caracteres.",
    en: "Write a name of 2 to 60 characters.",
  },
  category_name_taken: {
    "es-CR": "Ya hay una categoría con ese nombre en el mismo lugar del menú.",
    en: "There is already a category with that name in the same place of the menu.",
  },
  category_too_deep: {
    "es-CR":
      "El menú tiene como máximo tres niveles: departamento, categoría y subcategoría. Elija un lugar más arriba.",
    en: "The menu has three levels at most: department, category and sub-category. Choose a place higher up.",
  },
  category_cycle: {
    "es-CR": "Una categoría no puede quedar dentro de sí misma ni de una de sus subcategorías.",
    en: "A category cannot be placed inside itself or one of its sub-categories.",
  },
  category_unchanged: {
    "es-CR": "No hay nada que cambiar: la categoría ya está así.",
    en: "There is nothing to change: the category is already like that.",
  },
  category_move_changes_fees: {
    "es-CR":
      "Con ese cambio, productos que ya están a la venta pagarían otra comisión. Las comisiones solo cambian con una actualización de tarifas; elija un lugar con la misma comisión.",
    en: "That move would change the commission of products already on sale. Commissions change only with a fee update; choose a place with the same commission.",
  },
  category_at_edge: {
    "es-CR": "Ya está en ese extremo de la lista.",
    en: "It is already at that end of the list.",
  },
  category_has_children: {
    "es-CR": "Tiene subcategorías: muévalas o elimínelas antes, o mejor ocúltela.",
    en: "It has sub-categories: move or delete them first, or hide it instead.",
  },
  category_in_use: {
    "es-CR":
      "Tiene productos o pedidos que la nombran, así que no se puede eliminar. Puede ocultarla.",
    en: "Products or orders refer to it, so it cannot be deleted. You can hide it.",
  },
  brand_name_invalid: {
    "es-CR": "Escriba un nombre de marca de entre 2 y 60 caracteres.",
    en: "Write a brand name of 2 to 60 characters.",
  },
  brand_slug_invalid: {
    "es-CR":
      "La dirección de la marca solo puede tener letras sin tildes, números y guiones, entre 2 y 60 caracteres.",
    en: "The brand's address may only have plain letters, digits and hyphens, 2 to 60 characters.",
  },
  brand_name_taken: {
    "es-CR":
      "Ya hay una marca con ese nombre, o es el nombre anterior de una. Si son la misma, únalas.",
    en: "A brand already has that name, or had it before. If they are the same, merge them.",
  },
  brand_slug_taken: {
    "es-CR": "Esa dirección ya es de otra marca. Elija otra.",
    en: "That address belongs to another brand. Choose another.",
  },
  brand_not_found: {
    "es-CR": "No encontramos esa marca, o ya se unió a otra. Recargue la página.",
    en: "We could not find that brand, or it was merged into another. Reload the page.",
  },
  brand_merged: {
    "es-CR": "Esa marca ya se unió a otra; los cambios se hacen en la que quedó.",
    en: "That brand was merged into another; make changes on the one that remains.",
  },
  brand_unchanged: {
    "es-CR": "No hay nada que cambiar: la marca ya está así.",
    en: "There is nothing to change: the brand is already like that.",
  },
  brand_merge_same: {
    "es-CR": "Elija dos marcas distintas: la duplicada y la que queda.",
    en: "Choose two different brands: the duplicate and the one that remains.",
  },
  brand_merge_into_hidden: {
    "es-CR":
      "La marca que queda está fuera del filtro de la tienda, y los productos unidos saldrían del filtro con ella. Vuelva a ofrecerla en el filtro antes de unir.",
    en: "The brand that remains is out of the shop's filter, and the merged products would leave the filter with it. Offer it in the filter again before merging.",
  },
  synonym_invalid: {
    "es-CR":
      "Escriba palabras de entre 2 y 60 letras o números (hasta cuatro palabras), y al menos una búsqueda equivalente.",
    en: "Write words of 2 to 60 letters or digits (up to four words), and at least one equivalent search.",
  },
  synonym_too_common: {
    "es-CR":
      "Esa palabra es tan común que la búsqueda la ignora o la encuentra en casi todo. Use una más específica.",
    en: "That word is so common that search ignores it or finds it almost everywhere. Use a more specific one.",
  },
  synonym_too_many: {
    "es-CR": "Un sinónimo puede tener como máximo ocho búsquedas equivalentes.",
    en: "A synonym may have eight equivalent searches at most.",
  },
  synonym_duplicate: {
    "es-CR":
      "Hay una búsqueda equivalente repetida, o igual a la palabra misma. Deje cada una una sola vez.",
    en: "An equivalent search is repeated, or equal to the word itself. Keep each one once.",
  },
  synonym_exists: {
    "es-CR":
      "Esa palabra ya tiene sinónimos. Quítela de la lista y agréguela de nuevo para cambiarlos.",
    en: "That word already has synonyms. Remove it from the list and add it again to change them.",
  },
  synonym_not_found: {
    "es-CR": "Esa palabra ya no tiene sinónimos. Recargue la página.",
    en: "That word no longer has synonyms. Reload the page.",
  },
  review_reason_invalid: {
    "es-CR": "Elija el motivo de la lista.",
    en: "Choose the reason from the list.",
  },
  review_already_hidden: {
    "es-CR": "Esta reseña ya está oculta.",
    en: "This review is already hidden.",
  },
  review_not_hidden: {
    "es-CR": "Esta reseña ya se muestra.",
    en: "This review is already shown.",
  },
  review_has_no_reply: {
    "es-CR": "Esta reseña no tiene respuesta del vendedor.",
    en: "This review has no reply from the seller.",
  },
  review_reply_already_hidden: {
    "es-CR": "La respuesta del vendedor ya está oculta.",
    en: "The seller's reply is already hidden.",
  },
  review_reply_not_hidden: {
    "es-CR": "La respuesta del vendedor ya se muestra.",
    en: "The seller's reply is already shown.",
  },
  review_filter_invalid: {
    "es-CR": "Ese filtro de reseñas no existe. Elija uno de la lista.",
    en: "That review filter does not exist. Choose one from the list.",
  },
  product_not_active: {
    "es-CR": "Este producto no está publicado, así que no hay nada que retirar.",
    en: "This product is not published, so there is nothing to take down.",
  },
  product_not_correctable: {
    "es-CR": "Este producto está archivado o en borrador; no se corrige desde aquí.",
    en: "This product is archived or a draft; it is not corrected from here.",
  },
  listing_edit_pending: {
    "es-CR":
      "El vendedor tiene un cambio de este producto en revisión. Decídalo primero en Productos por revisar.",
    en: "The seller has a change to this product waiting for review. Decide it first under Products to review.",
  },
  correction_unchanged: {
    "es-CR": "No hay nada que corregir: el producto ya tiene esa categoría y esa marca.",
    en: "There is nothing to correct: the product already has that category and brand.",
  },
  correction_below_fee_floor: {
    "es-CR":
      "En esa categoría la comisión es mayor y alguna oferta de este producto quedaría por debajo de lo que cuesta venderla. Pida al vendedor que ajuste el precio antes.",
    en: "That category's commission is higher and an offer of this product would sell below what the fees cost. Ask the seller to adjust the price first.",
  },
  listing_changed_since_take_down: {
    "es-CR":
      "El vendedor cambió este producto después de que lo retiramos, y esos cambios no se han revisado. No se puede volver a publicar así: el vendedor debe enviarlo a revisión.",
    en: "The seller changed this product after it was taken down, and those changes have not been reviewed. It cannot be put back like this: the seller must send it for review.",
  },
  product_not_taken_down: {
    "es-CR":
      "Este producto no está retirado por el equipo. Si el vendedor lo cambió y lo envió a revisión, decídalo en Productos por revisar.",
    en: "This product was not taken down by staff. If the seller changed it and sent it for review, decide it under Products to review.",
  },
} as const satisfies Messages;

// ── Methods ─────────────────────────────────────────────────────────────────

export const catalogueApi = ({ call, run }: Caller) => ({
  /**
   * Search results, category pages and home shelves, now with a brand filter.
   * Replaces the core method of the same name (it sends the same arguments,
   * plus the brand).
   */
  searchProducts: (input: CatalogSearchInput = {}) =>
    call(
      "search_products",
      {
        p_query: input.query ?? undefined,
        p_category_slug: input.categorySlug ?? undefined,
        p_min_price_minor: input.minPriceMinor ?? undefined,
        p_max_price_minor: input.maxPriceMinor ?? undefined,
        p_in_stock_only: input.inStockOnly,
        p_made_in_cr: input.madeInCr,
        p_sort: input.sort,
        p_limit: input.limit,
        p_offset: input.offset,
        p_brand_slug: input.brandSlug ?? undefined,
      },
      z.array(productCard),
    ),
  /** The brands of the shop's filter (in a category and below it, when given). */
  listBrands: (categorySlug?: string | null) =>
    call("list_brands", { p_category_slug: categorySlug ?? undefined }, z.array(shopBrand)),
  /** The current address of a category that used to be at `slug`, or null. */
  categoryRedirect: (slug: string) =>
    call("category_redirect", { p_slug: slug }, z.string().nullable()),
  /** Which of the caller's reviews on this order are hidden, and why. */
  myOrderReviews: (orderNumber: string) =>
    call("my_order_reviews", { p_order_number: orderNumber }, z.array(myOrderReview)),

  // Categories
  opsCatalogCategories: () => call("ops_catalog_categories", {}, z.array(opsCategory)),
  opsCreateCategory: (input: {
    nameEs: string;
    nameEn?: string | null;
    slug?: string | null;
    parentId?: string | null;
  }) =>
    call(
      "ops_create_category",
      {
        p_name_es: input.nameEs,
        p_name_en: input.nameEn ?? undefined,
        p_slug: input.slug ?? undefined,
        p_parent_id: input.parentId ?? undefined,
      },
      createdCategory,
    ),
  opsUpdateCategory: (input: {
    categoryId: string;
    nameEs?: string | null;
    nameEn?: string | null;
    slug?: string | null;
  }) =>
    call(
      "ops_update_category",
      {
        p_category_id: input.categoryId,
        p_name_es: input.nameEs ?? null,
        p_name_en: input.nameEn ?? undefined,
        p_slug: input.slug ?? undefined,
      },
      updatedCategory,
    ),
  opsMoveCategory: (categoryId: string, parentId: string | null) =>
    run("ops_move_category", { p_category_id: categoryId, p_parent_id: parentId }),
  opsShiftCategory: (categoryId: string, direction: -1 | 1) =>
    run("ops_shift_category", { p_category_id: categoryId, p_direction: direction }),
  opsSetCategoryActive: (categoryId: string, active: boolean) =>
    run("ops_set_category_active", { p_category_id: categoryId, p_active: active }),
  opsDeleteCategory: (categoryId: string) =>
    run("ops_delete_category", { p_category_id: categoryId }),

  // Brands
  opsCatalogBrands: () => call("ops_catalog_brands", {}, z.array(opsBrand)),
  opsCreateBrand: (name: string, slug?: string | null) =>
    call("ops_create_brand", { p_name: name, p_slug: slug ?? undefined }, savedBrand),
  opsUpdateBrand: (brandId: string, name: string | null, slug?: string | null) =>
    call(
      "ops_update_brand",
      { p_brand_id: brandId, p_name: name, p_slug: slug ?? undefined },
      savedBrand,
    ),
  opsSetBrandActive: (brandId: string, active: boolean) =>
    run("ops_set_brand_active", { p_brand_id: brandId, p_active: active }),
  opsMergeBrands: (fromId: string, intoId: string) =>
    call("ops_merge_brands", { p_from_id: fromId, p_into_id: intoId }, brandMerge),

  // Synonyms
  opsSearchSynonyms: () => call("ops_search_synonyms", {}, z.array(searchSynonym)),
  opsAddSearchSynonym: (term: string, expansions: string[]) =>
    call("ops_add_search_synonym", { p_term: term, p_expansions: expansions }, addedSynonym),
  opsRemoveSearchSynonym: (term: string) => run("ops_remove_search_synonym", { p_term: term }),
  opsSearchPreview: (query: string) =>
    call("ops_search_preview", { p_query: query }, searchPreview),

  // Reviews
  opsReviews: (filter: ReviewFilter = "all", reviewId?: string | null, offset = 0) =>
    call(
      "ops_reviews",
      { p_filter: filter, p_review_id: reviewId ?? undefined, p_offset: offset },
      opsReviewPage,
    ),
  opsHideReview: (reviewId: string, reason: ReviewHideReason, note?: string | null) =>
    run("ops_hide_review", { p_review_id: reviewId, p_reason: reason, p_note: note ?? undefined }),
  opsShowReview: (reviewId: string) => run("ops_show_review", { p_review_id: reviewId }),
  opsHideReviewReply: (reviewId: string, reason: ReviewHideReason, note?: string | null) =>
    run("ops_hide_review_reply", {
      p_review_id: reviewId,
      p_reason: reason,
      p_note: note ?? undefined,
    }),
  opsShowReviewReply: (reviewId: string) => run("ops_show_review_reply", { p_review_id: reviewId }),

  // Products
  opsCatalogProduct: (ref: string) =>
    call("ops_catalog_product", { p_ref: ref }, opsCatalogProduct),
  opsCorrectProduct: (input: CorrectProductInput) =>
    call(
      "ops_correct_product",
      {
        p_product_id: input.productId,
        p_category_id: input.categoryId ?? undefined,
        p_brand_id: input.brandId ?? undefined,
        p_clear_brand: input.clearBrand ?? false,
        p_note: input.note,
      },
      opsCatalogProduct,
    ),
  opsTakeDownProduct: (productId: string, reason: string) =>
    run("ops_take_down_product", { p_product_id: productId, p_reason: reason }),
  opsRestoreProduct: (productId: string, note: string) =>
    run("ops_restore_product", { p_product_id: productId, p_note: note }),
});
