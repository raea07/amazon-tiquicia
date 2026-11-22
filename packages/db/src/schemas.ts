/**
 * The shape of every payload the API returns.
 *
 * These schemas are the client's half of the contract with the database
 * functions in supabase/migrations/*_api_*.sql. Responses are parsed through
 * them at the boundary, so a mismatch surfaces as one clear error at the call
 * site instead of an undefined somewhere in a component. `contract.test.ts`
 * calls the real functions and checks their output against these schemas.
 *
 * Conventions: money is an integer count of céntimos (`*_minor`); dates are
 * `YYYY-MM-DD` strings in Costa Rican time; timestamps are ISO strings.
 */

import { ORDER_STATUSES, SHIPMENT_STATUSES } from "@yuntera/core";
import { z } from "zod";

// ── Building blocks ─────────────────────────────────────────────────────────

const id = z.uuid();
const money = z.number().int();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);

export const orderStatus = z.enum(ORDER_STATUSES);
export const shipmentStatus = z.enum(SHIPMENT_STATUSES);
export const paymentMethod = z.enum(["card", "sinpe_movil", "cash_on_delivery", "bank_transfer"]);
export const paymentStatus = z.enum([
  "pending",
  "authorized",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
export const fulfillment = z.enum(["platform", "seller"]);
export const sellerStatus = z.enum(["pending", "active", "suspended", "closed"]);
export const sellerHealth = z.enum(["excelente", "bien", "en_riesgo", "critico"]);
export const productStatus = z.enum(["draft", "pending_review", "active", "rejected", "archived"]);
export const offerStatus = z.enum(["active", "paused", "archived"]);
export const stopStatus = z.enum(["pending", "arrived", "delivered", "failed", "skipped"]);
export const routeStatus = z.enum(["draft", "assigned", "in_progress", "completed", "cancelled"]);
export const pickStatus = z.enum(["open", "in_progress", "done", "short", "cancelled"]);
export const staffRole = z.enum(["admin", "ops", "support", "finance", "catalog"]);
export const failureReason = z.enum([
  "nobody_home",
  "wrong_address",
  "refused",
  "cannot_pay",
  "unsafe",
  "damaged",
  "other",
]);
export const returnKind = z.enum(["withdrawal", "warranty", "damaged", "wrong_item"]);
export const complaintCategory = z.enum([
  "delivery",
  "product",
  "payment",
  "seller",
  "privacy",
  "other",
]);
export const reportReason = z.enum([
  "illegal_product",
  "counterfeit",
  "unsafe",
  "misleading",
  "intellectual_property",
  "abuse",
  "other",
]);

const promise = z.object({ earliest: date, latest: date });

// ── Browse ──────────────────────────────────────────────────────────────────

export const productCard = z.object({
  product_id: id,
  slug: z.string(),
  title: z.string(),
  brand_name: z.string().nullable(),
  category_slug: z.string(),
  image_path: z.string().nullable(),
  min_price_minor: money,
  list_price_minor: money.nullable(),
  in_stock: z.boolean(),
  fulfilled_by_platform: z.boolean(),
  best_handling_days: z.number().int().nullable(),
  rating_sum: z.number().int(),
  rating_count: z.number().int(),
  made_in_cr: z.boolean(),
  score: z.number(),
  total_count: z.number().int(),
});
export type ProductCard = z.infer<typeof productCard>;

export const suggestion = z.object({ title: z.string(), slug: z.string() });

export const category = z.object({
  slug: z.string(),
  parent_slug: z.string().nullable(),
  name_es: z.string(),
  name_en: z.string(),
  sort: z.number().int(),
  product_count: z.number().int(),
});
export type Category = z.infer<typeof category>;

export const district = z.object({
  postal_code: z.string(),
  district: z.string(),
  canton_code: z.string(),
  canton: z.string(),
  province_code: z.number().int(),
  province: z.string(),
  zone_id: z.string(),
  zone_active: z.boolean(),
});
export type District = z.infer<typeof district>;

export const deliveryEstimate = z.object({
  zone_id: z.string(),
  zone_active: z.boolean(),
  earliest: date,
  latest: date,
  shipping_fee_minor: money,
  free_shipping_threshold_minor: money.nullable(),
  cod_available: z.boolean(),
});
export type DeliveryEstimate = z.infer<typeof deliveryEstimate>;

const categoryRef = z.object({ slug: z.string(), name_es: z.string(), name_en: z.string() });

export const productOffer = z.object({
  offer_id: id,
  seller: z.object({
    slug: z.string(),
    trade_name: z.string(),
    score: z.number().int(),
    health: sellerHealth,
  }),
  price_minor: money,
  list_price_minor: money.nullable(),
  condition: z.enum(["new", "refurbished", "used"]),
  fulfillment,
  handling_days: z.number().int(),
  /** Capped at 10: the page needs "in stock" and "few left", not the seller's exact count. */
  available: z.number().int().min(0).max(10),
  listed_at: timestamp,
  promise: promise.nullable(),
});
export type ProductOffer = z.infer<typeof productOffer>;

export const relatedProduct = z.object({
  slug: z.string(),
  title: z.string(),
  min_price_minor: money,
  list_price_minor: money.nullable(),
  in_stock: z.boolean(),
  rating_sum: z.number().int(),
  rating_count: z.number().int(),
  fulfilled_by_platform: z.boolean(),
  image_path: z.string().nullable(),
  kind: z.enum(["bought_together", "similar"]),
});

export const productReview = z.object({
  id,
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string().nullable(),
  created_at: timestamp,
  seller_reply: z.string().nullable(),
  author: z.string(),
});

export const productPage = z.object({
  id,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  bullet_points: z.array(z.string()),
  brand: z.string().nullable(),
  made_in_cr: z.boolean(),
  warranty_months: z.number().int(),
  tax_rate_bps: z.number().int(),
  rating_sum: z.number().int(),
  rating_count: z.number().int(),
  rating_histogram: z.record(z.string(), z.number().int()),
  category: categoryRef,
  breadcrumbs: z.array(categoryRef),
  images: z.array(z.object({ path: z.string(), alt: z.string() })),
  zone: z
    .object({
      id: z.string(),
      active: z.boolean(),
      shipping_fee_minor: money,
      free_shipping_threshold_minor: money.nullable(),
      cod_available: z.boolean(),
    })
    .nullable(),
  skus: z.array(
    z.object({
      id,
      code: z.string(),
      variant_name: z.string(),
      offers: z.array(productOffer),
    }),
  ),
  reviews: z.array(productReview),
  related: z.array(relatedProduct),
});
export type ProductPage = z.infer<typeof productPage>;

// ── Cart and checkout ───────────────────────────────────────────────────────

export const cartLine = z.object({
  offer_id: id,
  buyable: z.boolean(),
  product_slug: z.string().nullable(),
  title: z.string().nullable(),
  variant_name: z.string().nullable(),
  image_path: z.string().nullable(),
  seller_name: z.string().nullable(),
  price_minor: money.nullable(),
  list_price_minor: money.nullable(),
  available: z.number().int(),
  fulfillment: fulfillment.nullable(),
  handling_days: z.number().int().nullable(),
});
export type CartLine = z.infer<typeof cartLine>;

export const quoteIssue = z.enum([
  "cart_empty",
  "too_many_lines",
  "invalid_quantity",
  "offer_unavailable",
  "zone_not_served",
]);

export const quote = z.object({
  issue: quoteIssue.nullable(),
  unavailable_offer_id: id.nullable().optional(),
  items_total_minor: money.optional(),
  shipping_minor: money.nullable().optional(),
  total_minor: money.nullable().optional(),
  tax_included_minor: money.optional(),
  free_shipping_threshold_minor: money.nullable().optional(),
  zone: z.object({ id: z.string(), name: z.string(), active: z.boolean() }).nullable().optional(),
  promise: promise.nullable().optional(),
  cod_available: z.boolean().optional(),
  payments_mode: z.enum(["sandbox", "test", "live"]).optional(),
});
export type Quote = z.infer<typeof quote>;

export const placedOrder = z.object({
  order_id: id,
  order_number: z.string(),
  status: orderStatus,
  total_minor: money,
  shipping_minor: money.optional(),
  promise_earliest: date.optional(),
  promise_latest: date.optional(),
  sinpe_reference: z.string().nullable().optional(),
  replayed: z.boolean(),
});
export type PlacedOrder = z.infer<typeof placedOrder>;

export const orderAction = z.object({ order_id: id, status: orderStatus });

// ── Account ─────────────────────────────────────────────────────────────────

export const roles = z.object({
  user_id: id,
  full_name: z.string().nullable(),
  staff_role: staffRole.nullable(),
  sellers: z.array(
    z.object({
      id,
      slug: z.string(),
      trade_name: z.string(),
      status: sellerStatus,
      role: z.enum(["owner", "admin", "staff"]),
    }),
  ),
  driver: z
    .object({
      id,
      status: z.enum(["pending", "active", "suspended", "offboarded"]),
      full_name: z.string(),
    })
    .nullable(),
  warehouses: z.array(
    z.object({ id, code: z.string(), name: z.string(), role: z.enum(["associate", "lead"]) }),
  ),
});
export type Roles = z.infer<typeof roles>;

export const profile = z.object({
  id,
  email: z.string().nullable(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  phone_verified: z.boolean(),
  locale: z.enum(["es-CR", "en"]),
  marketing_opt_in: z.boolean(),
});
export type Profile = z.infer<typeof profile>;

export const address = z.object({
  id,
  label: z.string().nullable(),
  recipient_name: z.string(),
  phone: z.string(),
  postal_code: z.string(),
  senas: z.string(),
  lat: z.number(),
  lng: z.number(),
  plus_code: z.string().nullable(),
  is_default: z.boolean(),
  district: z.string(),
  canton: z.string(),
  province: z.string(),
  zone_id: z.string(),
  zone_active: z.boolean(),
});
export type Address = z.infer<typeof address>;

export const orderSummary = z.object({
  order_number: z.string(),
  status: orderStatus,
  placed_at: timestamp,
  total_minor: money,
  payment_method: paymentMethod,
  promise_earliest: date,
  promise_latest: date,
  delivered_at: timestamp.nullable(),
  item_count: z.number().int(),
  first_title: z.string().nullable(),
  first_image_path: z.string().nullable(),
});
export type OrderSummary = z.infer<typeof orderSummary>;

export const orderDetail = z.object({
  id,
  order_number: z.string(),
  status: orderStatus,
  placed_at: timestamp,
  confirmed_at: timestamp.nullable(),
  delivered_at: timestamp.nullable(),
  cancelled_at: timestamp.nullable(),
  cancel_reason: z.string().nullable(),
  items_total_minor: money,
  shipping_minor: money,
  discount_minor: money,
  total_minor: money,
  tax_included_minor: money,
  payment_method: paymentMethod,
  promise_earliest: date,
  promise_latest: date,
  withdrawal_deadline: date,
  warranty_until: date.nullable(),
  /** Present only while there is still something to hand over. */
  delivery_pin: z.string().nullable(),
  can_cancel: z.boolean(),
  address: z.object({
    recipient_name: z.string(),
    phone: z.string(),
    postal_code: z.string(),
    senas: z.string(),
    lat: z.number(),
    lng: z.number(),
    plus_code: z.string().nullable(),
    district: z.string().nullable(),
    canton: z.string().nullable(),
  }),
  payment: z
    .object({
      method: paymentMethod,
      status: paymentStatus,
      amount_minor: money,
      provider: z.string(),
      sinpe_reference: z.string().nullable(),
      captured_at: timestamp.nullable(),
    })
    .nullable(),
  items: z.array(
    z.object({
      id,
      title: z.string(),
      variant_name: z.string(),
      image_path: z.string().nullable(),
      product_slug: z.string().nullable(),
      seller_name: z.string().nullable(),
      unit_price_minor: money,
      quantity: z.number().int(),
      line_total_minor: money,
      fulfillment,
      review: z
        .object({
          rating: z.number().int(),
          title: z.string().nullable(),
          body: z.string().nullable(),
        })
        .nullable(),
      returned_quantity: z.number().int(),
    }),
  ),
  shipments: z.array(
    z.object({
      id,
      tracking_code: z.string(),
      status: shipmentStatus,
      package_count: z.number().int(),
      attempt_count: z.number().int(),
      promise_latest: date,
      delivered_at: timestamp.nullable(),
      item_ids: z.array(id).nullable(),
      driver_first_name: z.string().nullable(),
    }),
  ),
  timeline: z.array(
    z.object({
      at: timestamp,
      kind: z.enum(["order_status", "shipment_status", "payment", "note"]),
      from_status: z.string().nullable(),
      to_status: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
export type OrderDetail = z.infer<typeof orderDetail>;

// ── Seller centre ───────────────────────────────────────────────────────────

export const sellerOverview = z.object({
  seller: z.object({
    id,
    slug: z.string(),
    trade_name: z.string(),
    description: z.string().nullable(),
    status: sellerStatus,
    score: z.number().int(),
    health: sellerHealth,
    approved_at: timestamp.nullable(),
  }),
  account: z.object({
    legal_name: z.string(),
    id_type: z.enum(["fisica", "juridica", "dimex", "nite"]),
    id_number: z.string(),
    tax_regime: z.enum(["general", "simplificado"]),
    contact_email: z.string(),
    contact_phone: z.string(),
    fiscal_address: z.string(),
    kyc_status: z.enum(["pending", "verified", "rejected"]),
    kyc_notes: z.string().nullable(),
    payout_iban_masked: z.string().nullable(),
    payout_holder_name: z.string().nullable(),
    sinpe_movil_number: z.string().nullable(),
  }),
  counts: z.object({
    listings_active: z.number().int(),
    listings_in_review: z.number().int(),
    listings_rejected: z.number().int(),
    offers_out_of_stock: z.number().int(),
    to_pack: z.number().int(),
    open_returns: z.number().int(),
  }),
  sales_30d: z.object({ orders: z.number().int(), units: z.number().int(), gross_minor: money }),
  payable_minor: money,
});
export type SellerOverview = z.infer<typeof sellerOverview>;

export const sellerListing = z.object({
  product_id: id,
  product_slug: z.string(),
  title: z.string(),
  product_status: productStatus,
  rejection_reason: z.string().nullable(),
  category_slug: z.string(),
  image_path: z.string().nullable(),
  sku_id: id,
  sku_code: z.string(),
  variant_name: z.string(),
  offer_id: id,
  price_minor: money,
  list_price_minor: money.nullable(),
  offer_status: offerStatus,
  fulfillment,
  handling_days: z.number().int(),
  available_quantity: z.number().int(),
  is_featured: z.boolean().nullable(),
  competing_offers: z.number().int(),
});
export type SellerListing = z.infer<typeof sellerListing>;

export const createdListing = z.object({
  product_id: id,
  slug: z.string(),
  sku_id: id,
  offer_id: id,
});

export const sellerStockRow = z.object({
  warehouse_id: id,
  warehouse_code: z.string(),
  warehouse_name: z.string(),
  warehouse_kind: z.enum(["platform", "seller"]),
  sku_id: id,
  sku_code: z.string(),
  title: z.string(),
  variant_name: z.string(),
  on_hand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
});
export type SellerStockRow = z.infer<typeof sellerStockRow>;

export const sellerStatementRow = z.object({
  order_number: z.string(),
  placed_at: timestamp,
  order_status: orderStatus,
  payment_method: paymentMethod,
  schedule_version: z.string(),
  items_gross_minor: money,
  referral_fee_minor: money,
  fulfillment_fee_minor: money,
  payment_fee_minor: money,
  fees_net_minor: money,
  fees_tax_minor: money,
  payout_minor: money,
});
export type SellerStatementRow = z.infer<typeof sellerStatementRow>;

export const sellerOrderLine = z.object({
  order_item_id: id,
  order_number: z.string(),
  order_status: orderStatus,
  placed_at: timestamp,
  promise_latest: date,
  title: z.string(),
  variant_name: z.string(),
  quantity: z.number().int(),
  unit_price_minor: money,
  line_total_minor: money,
  fulfillment,
  shipment_id: id.nullable(),
  shipment_status: shipmentStatus.nullable(),
  tracking_code: z.string().nullable(),
  /** First name and coarse location only; a seller cannot contact or locate the shopper. */
  buyer_first_name: z.string(),
  district: z.string().nullable(),
  canton: z.string().nullable(),
});
export type SellerOrderLine = z.infer<typeof sellerOrderLine>;

export const sellerParcel = z.object({
  shipment_id: id,
  tracking_code: z.string(),
  status: shipmentStatus,
  order_number: z.string(),
  placed_at: timestamp,
  promise_latest: date,
  origin: z.string(),
  items: z.array(
    z.object({
      title: z.string(),
      variant_name: z.string(),
      quantity: z.number().int(),
      sku_code: z.string(),
      image_path: z.string().nullable(),
    }),
  ),
});
export type SellerParcel = z.infer<typeof sellerParcel>;

export const sellerLocations = z.object({
  /** The seller's own dispatch points, where our drivers collect. */
  own: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      address: z.string(),
      postal_code: z.string().nullable(),
      active: z.boolean(),
    }),
  ),
  /** Yuntera warehouses that accept stock from sellers. */
  platform: z.array(z.object({ id, code: z.string(), name: z.string(), address: z.string() })),
});
export type SellerLocations = z.infer<typeof sellerLocations>;

export const sellerInbound = z.object({
  inbound_id: id,
  reference: z.string(),
  status: z.enum(["draft", "in_transit", "receiving", "received", "closed", "cancelled"]),
  expected_on: date.nullable(),
  created_at: timestamp,
  received_at: timestamp.nullable(),
  warehouse_name: z.string(),
  lines: z
    .array(
      z.object({
        sku_code: z.string(),
        title: z.string(),
        variant_name: z.string(),
        expected: z.number().int(),
        received: z.number().int(),
        damaged: z.number().int(),
      }),
    )
    .nullable(),
});
export type SellerInbound = z.infer<typeof sellerInbound>;

// ── Warehouse ───────────────────────────────────────────────────────────────

export const wmsBoard = z.object({
  warehouse: z.object({ id, code: z.string(), name: z.string() }),
  shipments: z.array(
    z.object({
      shipment_id: id,
      tracking_code: z.string(),
      status: shipmentStatus,
      order_number: z.string(),
      promise_latest: date,
      placed_at: timestamp,
      units: z.number().int(),
      lines: z.number().int(),
      short: z.boolean(),
    }),
  ),
  inbound: z.array(
    z.object({
      inbound_id: id,
      reference: z.string(),
      status: z.string(),
      expected_on: date.nullable(),
      seller_name: z.string(),
      lines: z
        .array(
          z.object({
            line_id: id,
            sku_code: z.string(),
            title: z.string(),
            variant_name: z.string(),
            expected: z.number().int(),
            received: z.number().int(),
            damaged: z.number().int(),
          }),
        )
        .nullable(),
    }),
  ),
});
export type WmsBoard = z.infer<typeof wmsBoard>;

export const wmsShipment = z.object({
  shipment_id: id,
  tracking_code: z.string(),
  status: shipmentStatus,
  order_number: z.string(),
  promise_latest: date,
  package_count: z.number().int(),
  weight_grams: z.number().int().nullable(),
  expected_weight_grams: z.number().int(),
  tasks: z.array(
    z.object({
      task_id: id,
      status: pickStatus,
      quantity: z.number().int(),
      picked_quantity: z.number().int(),
      location_id: id.nullable(),
      location_code: z.string().nullable(),
      sku_code: z.string(),
      gtin: z.string().nullable(),
      title: z.string(),
      variant_name: z.string(),
      image_path: z.string().nullable(),
    }),
  ),
});
export type WmsShipment = z.infer<typeof wmsShipment>;

export const wmsSku = z.object({
  sku_id: id,
  sku_code: z.string(),
  gtin: z.string().nullable(),
  title: z.string(),
  variant_name: z.string(),
  bins: z.array(
    z.object({
      location_id: id,
      location_code: z.string(),
      seller_id: id,
      seller_name: z.string(),
      quantity: z.number().int(),
    }),
  ),
});
export type WmsSku = z.infer<typeof wmsSku>;

export const wmsLocation = z.object({
  id,
  code: z.string(),
  kind: z.enum(["receiving", "storage", "pick", "packing", "staging", "returns", "damaged"]),
});

// ── Driver ──────────────────────────────────────────────────────────────────

export const driverStop = z.object({
  stop_id: id,
  sequence: z.number().int(),
  status: stopStatus,
  eta_minute: z.number().int().nullable(),
  recipient_name: z.string(),
  phone: z.string(),
  senas: z.string(),
  lat: z.number(),
  lng: z.number(),
  plus_code: z.string().nullable(),
  package_count: z.number().int(),
  cod_amount_minor: money,
  cod_collected_minor: money,
  failure_reason: z.string().nullable(),
  pin_attempts_left: z.number().int(),
  tracking_code: z.string(),
  completed_at: timestamp.nullable(),
});
export type DriverStop = z.infer<typeof driverStop>;

export const driverRoute = z.object({
  route_id: id,
  code: z.string(),
  status: routeStatus,
  service_date: date,
  planned_km: z.number().nullable(),
  planned_minutes: z.number().int().nullable(),
  started_at: timestamp.nullable(),
  completed_at: timestamp.nullable(),
  depot: z.object({ name: z.string(), address: z.string(), lat: z.number(), lng: z.number() }),
  cash_to_hand_in_minor: money,
  stops: z.array(driverStop),
});
export type DriverRoute = z.infer<typeof driverRoute>;

export const driverDay = z.object({
  driver: z.object({
    id,
    full_name: z.string(),
    status: z.string(),
    vehicle_type: z.enum(["motorcycle", "car", "van", "bicycle"]),
    plate: z.string().nullable(),
  }),
  routes: z.array(driverRoute),
});
export type DriverDay = z.infer<typeof driverDay>;

/**
 * Result of completing a stop. Door-side outcomes (wrong code, wrong cash) come
 * back as data rather than as errors, so the failed attempt is recorded.
 */
export const stopResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), route_completed: z.boolean() }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["wrong_pin", "pin_locked", "cod_amount_mismatch", "recipient_required"]),
    attempts_left: z.number().int().optional(),
    expected_minor: money.optional(),
  }),
]);
export type StopResult = z.infer<typeof stopResult>;

export const stopFailed = z.object({ ok: z.literal(true), route_completed: z.boolean() });

// ── Internal console ────────────────────────────────────────────────────────

export const opsOverview = z.object({
  orders: z.record(z.string(), z.number().int()),
  orders_today: z.number().int(),
  revenue_today_minor: money,
  late_shipments: z.number().int(),
  awaiting_dispatch: z.number().int(),
  failed_deliveries: z.number().int(),
  sellers_pending: z.number().int(),
  listings_in_review: z.number().int(),
  open_complaints: z.number().int(),
  open_returns: z.number().int(),
  open_reports: z.number().int(),
  open_settlements: z.number().int(),
  payments_mode: z.enum(["sandbox", "test", "live"]),
});
export type OpsOverview = z.infer<typeof opsOverview>;

export const opsOrderRow = z.object({
  order_number: z.string(),
  status: orderStatus,
  placed_at: timestamp,
  total_minor: money,
  payment_method: paymentMethod,
  payment_status: paymentStatus.nullable(),
  recipient_name: z.string(),
  canton: z.string().nullable(),
  promise_latest: date,
  shipment_statuses: z.array(z.string()),
  is_late: z.boolean(),
});
export type OpsOrderRow = z.infer<typeof opsOrderRow>;

export const opsSellerRow = z.object({
  id,
  slug: z.string(),
  trade_name: z.string(),
  status: sellerStatus,
  score: z.number().int(),
  health: sellerHealth,
  legal_name: z.string(),
  id_type: z.enum(["fisica", "juridica", "dimex", "nite"]),
  id_number: z.string(),
  tax_regime: z.string(),
  contact_email: z.string(),
  contact_phone: z.string(),
  kyc_status: z.enum(["pending", "verified", "rejected"]),
  created_at: timestamp,
  listings: z.number().int(),
});
export type OpsSellerRow = z.infer<typeof opsSellerRow>;

export const opsListingRow = z.object({
  product_id: id,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  bullet_points: z.array(z.string()),
  category_slug: z.string(),
  seller_name: z.string().nullable(),
  seller_status: sellerStatus.nullable(),
  price_minor: money.nullable(),
  created_at: timestamp,
});
export type OpsListingRow = z.infer<typeof opsListingRow>;

export const dispatchBoard = z.object({
  date,
  depots: z.array(
    z.object({ id, code: z.string(), name: z.string(), lat: z.number(), lng: z.number() }),
  ),
  ready: z.array(
    z.object({
      shipment_id: id,
      tracking_code: z.string(),
      status: shipmentStatus,
      order_number: z.string(),
      origin_code: z.string(),
      origin_kind: z.enum(["platform", "seller"]),
      recipient_name: z.string(),
      lat: z.number(),
      lng: z.number(),
      canton: z.string().nullable(),
      weight_grams: z.number().int(),
      package_count: z.number().int(),
      promise_latest: date,
      attempt_count: z.number().int(),
      cash_on_delivery: z.boolean(),
    }),
  ),
  drivers: z.array(
    z.object({
      id,
      full_name: z.string(),
      vehicle_type: z.enum(["motorcycle", "car", "van", "bicycle"]),
      capacity_kg: z.number(),
      phone: z.string(),
      active_routes: z.number().int(),
      position: z.object({ lat: z.number(), lng: z.number(), recorded_at: timestamp }).nullable(),
    }),
  ),
  routes: z.array(
    z.object({
      route_id: id,
      code: z.string(),
      status: routeStatus,
      service_date: date,
      driver_name: z.string().nullable(),
      planned_km: z.number().nullable(),
      planned_minutes: z.number().int().nullable(),
      started_at: timestamp.nullable(),
      completed_at: timestamp.nullable(),
      stops: z.array(
        z.object({
          stop_id: id,
          sequence: z.number().int(),
          status: stopStatus,
          recipient_name: z.string(),
          lat: z.number(),
          lng: z.number(),
          tracking_code: z.string(),
          cod_amount_minor: money,
          failure_reason: z.string().nullable(),
          completed_at: timestamp.nullable(),
        }),
      ),
    }),
  ),
});
export type DispatchBoard = z.infer<typeof dispatchBoard>;

export const opsSettlementRow = z.object({
  route_id: id,
  route_code: z.string(),
  service_date: date,
  driver_name: z.string(),
  cod_expected_minor: money,
  cod_handed_minor: money.nullable(),
  status: z.enum(["open", "settled", "short"]),
  note: z.string().nullable(),
  settled_at: timestamp.nullable(),
});
export type OpsSettlementRow = z.infer<typeof opsSettlementRow>;

export const careQueues = z.object({
  complaints: z.array(
    z.object({
      id,
      category: complaintCategory,
      description: z.string(),
      status: z.string(),
      created_at: timestamp,
      order_number: z.string().nullable(),
      customer: z.string().nullable(),
    }),
  ),
  returns: z.array(
    z.object({
      id,
      kind: returnKind,
      quantity: z.number().int(),
      reason: z.string().nullable(),
      status: z.string(),
      refund_due_on: date.nullable(),
      created_at: timestamp,
      title: z.string(),
      order_number: z.string(),
      seller_name: z.string().nullable(),
      customer: z.string().nullable(),
      /** What the shopper paid for the returned units, and so what goes back to them. */
      amount_minor: money,
    }),
  ),
  reports: z.array(
    z.object({
      id,
      target_type: z.enum(["product", "review", "seller"]),
      target_id: id,
      reason: reportReason,
      details: z.string().nullable(),
      status: z.string(),
      created_at: timestamp,
      /** The product title, seller name or start of the review that was reported. */
      target_label: z.string().nullable(),
    }),
  ),
});
export type CareQueues = z.infer<typeof careQueues>;

export const refundResult = z.object({ refund_minor: money, seller_debit_minor: money });

export const opsDriverRow = z.object({
  id,
  full_name: z.string(),
  phone: z.string(),
  status: z.enum(["pending", "active", "suspended", "offboarded"]),
  vehicle_type: z.enum(["motorcycle", "car", "van", "bicycle"]),
  plate: z.string().nullable(),
  capacity_kg: z.number(),
  license_expires_on: date.nullable(),
  inspection_expires_on: date.nullable(),
  insurance_expires_on: date.nullable(),
  documents_expired: z.boolean(),
});
export type OpsDriverRow = z.infer<typeof opsDriverRow>;

export const auditEntry = z.object({
  id: z.number().int(),
  at: timestamp,
  actor_id: id.nullable(),
  action: z.string(),
  table_name: z.string(),
  row_key: z.string().nullable(),
  old_row: z.record(z.string(), z.unknown()).nullable(),
  new_row: z.record(z.string(), z.unknown()).nullable(),
});
