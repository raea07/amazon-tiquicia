/**
 * The typed client for the Yuntera API.
 *
 * `createApi` wraps anything that can call a database function — in the apps,
 * a Supabase client — and returns one method per API function, with typed
 * arguments, a validated result, and errors normalised to `ApiError`.
 *
 * It is transport-agnostic on purpose: the same code runs in a Next.js server
 * component, in the Expo apps, and in tests against a local database.
 */

import { z } from "zod";
import { ApiError, type TransportError, toApiError } from "./errors";
import * as s from "./schemas";

/** The one capability the client needs. A supabase-js client satisfies it as is. */
export interface RpcTransport {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: TransportError | null; status?: number }>;
}

/** Drops `undefined` so the database's own defaults apply to omitted arguments. */
function compact(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
}

export interface PlaceOrderInput {
  items: Array<{ offerId: string; quantity: number }>;
  addressId: string;
  paymentMethod: z.infer<typeof s.paymentMethod>;
  /** Generated once per checkout attempt; a retry with the same key returns the same order. */
  idempotencyKey: string;
  /** The total the shopper saw. The order is refused if the real total differs. */
  expectedTotalMinor?: number;
}

export interface SaveAddressInput {
  id?: string;
  label?: string | null;
  recipientName: string;
  phone: string;
  postalCode: string;
  senas: string;
  lat: number;
  lng: number;
  plusCode?: string | null;
  makeDefault?: boolean;
}

export interface SearchInput {
  query?: string | null;
  categorySlug?: string | null;
  minPriceMinor?: number | null;
  maxPriceMinor?: number | null;
  inStockOnly?: boolean;
  madeInCr?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating" | "newest";
  limit?: number;
  offset?: number;
}

export interface CreateListingInput {
  sellerId: string;
  title: string;
  categorySlug: string;
  description?: string | null;
  bulletPoints?: string[];
  priceMinor: number;
  fulfillment: z.infer<typeof s.fulfillment>;
  handlingDays: number;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  submit?: boolean;
}

export interface CreateRouteInput {
  serviceDate: string;
  depotWarehouseId: string;
  stops: Array<{ shipmentId: string; sequence: number; etaMinute?: number }>;
  driverId?: string | null;
  plannedKm?: number;
  plannedMinutes?: number;
}

export interface CompleteStopInput {
  stopId: string;
  pin: string;
  recipientName: string;
  codCollectedMinor?: number;
  photoPath?: string | null;
  lat?: number | null;
  lng?: number | null;
}

const toItems = (items: PlaceOrderInput["items"]) =>
  items.map((item) => ({ offer_id: item.offerId, quantity: item.quantity }));

export function createApi(transport: RpcTransport) {
  async function call<T>(
    fn: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: Awaited<ReturnType<RpcTransport["rpc"]>>;
    try {
      response = await transport.rpc(fn, compact(args));
    } catch (cause) {
      throw new ApiError("network", { cause });
    }
    if (response.error) throw toApiError(response.error, response.status ?? null);

    const parsed = schema.safeParse(response.data);
    if (!parsed.success) {
      // The database answered with a shape this client does not expect: a
      // contract break, not something the user did.
      throw new ApiError("invalid_response", { detail: fn, cause: parsed.error });
    }
    return parsed.data;
  }

  const run = (fn: string, args: Record<string, unknown> = {}) =>
    call(fn, args, z.unknown()).then(() => undefined);

  return {
    // ── Browse (no account needed) ──────────────────────────────────────────
    searchProducts: (input: SearchInput = {}) =>
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
        },
        z.array(s.productCard),
      ),
    suggestProducts: (prefix: string, limit?: number) =>
      call("suggest_products", { p_prefix: prefix, p_limit: limit }, z.array(s.suggestion)),
    listCategories: () => call("list_categories", {}, z.array(s.category)),
    listDistricts: () => call("list_districts", {}, z.array(s.district)),
    deliveryEstimate: (postalCode: string, handlingDays = 0) =>
      call(
        "delivery_estimate",
        { p_postal_code: postalCode, p_handling_days: handlingDays },
        z.array(s.deliveryEstimate),
      ).then((rows) => rows[0] ?? null),
    getProduct: (slug: string, postalCode?: string | null) =>
      call(
        "get_product",
        { p_slug: slug, p_postal_code: postalCode ?? undefined },
        s.productPage.nullable(),
      ),
    cartLines: (offerIds: string[]) =>
      call("cart_lines", { p_offer_ids: offerIds }, z.array(s.cartLine)),
    checkoutQuote: (items: PlaceOrderInput["items"], postalCode: string) =>
      call("checkout_quote", { p_items: toItems(items), p_postal_code: postalCode }, s.quote),
    reportContent: (input: {
      targetType: "product" | "review" | "seller";
      targetId: string;
      reason: z.infer<typeof s.reportReason>;
      details?: string | null;
      email?: string | null;
    }) =>
      call(
        "report_content",
        {
          p_target_type: input.targetType,
          p_target_id: input.targetId,
          p_reason: input.reason,
          p_details: input.details ?? undefined,
          p_email: input.email ?? undefined,
        },
        z.uuid(),
      ),

    // ── Account ─────────────────────────────────────────────────────────────
    myRoles: () => call("my_roles", {}, s.roles.nullable()),
    myProfile: () => call("my_profile", {}, s.profile.nullable()),
    updateProfile: (input: {
      fullName: string;
      phone?: string | null;
      locale?: "es-CR" | "en";
      marketingOptIn?: boolean;
    }) =>
      run("update_profile", {
        p_full_name: input.fullName,
        p_phone: input.phone ?? undefined,
        p_locale: input.locale,
        p_marketing_opt_in: input.marketingOptIn,
      }),
    recordConsent: (purpose: string, policyVersion: string) =>
      run("record_consent", { p_purpose: purpose, p_policy_version: policyVersion }),
    myAddresses: () => call("my_addresses", {}, z.array(s.address)),
    saveAddress: (input: SaveAddressInput) =>
      call(
        "save_address",
        {
          p_recipient_name: input.recipientName,
          p_phone: input.phone,
          p_postal_code: input.postalCode,
          p_senas: input.senas,
          p_lat: input.lat,
          p_lng: input.lng,
          p_plus_code: input.plusCode ?? undefined,
          p_label: input.label ?? undefined,
          p_make_default: input.makeDefault,
          p_id: input.id,
        },
        z.uuid(),
      ),
    deleteAddress: (addressId: string) => run("delete_address", { p_id: addressId }),

    // ── Orders ──────────────────────────────────────────────────────────────
    placeOrder: (input: PlaceOrderInput) =>
      call(
        "place_order",
        {
          p_items: toItems(input.items),
          p_address_id: input.addressId,
          p_payment_method: input.paymentMethod,
          p_idempotency_key: input.idempotencyKey,
          p_expected_total_minor: input.expectedTotalMinor,
        },
        s.placedOrder,
      ),
    confirmSandboxPayment: (orderId: string) =>
      call("confirm_sandbox_payment", { p_order_id: orderId }, s.orderAction),
    cancelOrder: (orderId: string, reason?: string) =>
      call("cancel_order", { p_order_id: orderId, p_reason: reason }, s.orderAction),
    myOrders: (limit?: number, offset?: number) =>
      call("my_orders", { p_limit: limit, p_offset: offset }, z.array(s.orderSummary)),
    getOrder: (orderNumber: string) =>
      call("get_order", { p_order_number: orderNumber }, s.orderDetail),
    submitReview: (input: {
      orderItemId: string;
      rating: number;
      title?: string | null;
      body?: string | null;
    }) =>
      call(
        "submit_review",
        {
          p_order_item_id: input.orderItemId,
          p_rating: input.rating,
          p_title: input.title ?? undefined,
          p_body: input.body ?? undefined,
        },
        z.uuid(),
      ),
    requestReturn: (input: {
      orderItemId: string;
      kind: z.infer<typeof s.returnKind>;
      quantity: number;
      reason?: string | null;
    }) =>
      call(
        "request_return",
        {
          p_order_item_id: input.orderItemId,
          p_kind: input.kind,
          p_quantity: input.quantity,
          p_reason: input.reason ?? undefined,
        },
        z.uuid(),
      ),
    fileComplaint: (input: {
      category: z.infer<typeof s.complaintCategory>;
      description: string;
      orderNumber?: string | null;
    }) =>
      call(
        "file_complaint",
        {
          p_category: input.category,
          p_description: input.description,
          p_order_number: input.orderNumber ?? undefined,
        },
        z.uuid(),
      ),

    // ── Seller centre ───────────────────────────────────────────────────────
    createSeller: (input: {
      tradeName: string;
      slug: string;
      legalName: string;
      idType: "fisica" | "juridica" | "dimex" | "nite";
      idNumber: string;
      contactEmail: string;
      contactPhone: string;
      fiscalAddress: string;
    }) =>
      call(
        "create_seller",
        {
          p_trade_name: input.tradeName,
          p_slug: input.slug,
          p_legal_name: input.legalName,
          p_id_type: input.idType,
          p_id_number: input.idNumber,
          p_contact_email: input.contactEmail,
          p_contact_phone: input.contactPhone,
          p_fiscal_address: input.fiscalAddress,
        },
        z.uuid(),
      ),
    sellerOverview: (sellerId: string) =>
      call("seller_overview", { p_seller_id: sellerId }, s.sellerOverview),
    sellerListings: (sellerId: string) =>
      call("seller_listings", { p_seller_id: sellerId }, z.array(s.sellerListing)),
    sellerCreateListing: (input: CreateListingInput) =>
      call(
        "seller_create_listing",
        {
          p_seller_id: input.sellerId,
          p_title: input.title,
          p_category_slug: input.categorySlug,
          p_description: input.description ?? null,
          p_bullet_points: input.bulletPoints ?? [],
          p_price_minor: input.priceMinor,
          p_fulfillment: input.fulfillment,
          p_handling_days: input.handlingDays,
          p_weight_grams: input.weightGrams,
          p_length_cm: input.lengthCm,
          p_width_cm: input.widthCm,
          p_height_cm: input.heightCm,
          p_submit: input.submit,
        },
        s.createdListing,
      ),
    sellerUpdateOffer: (input: {
      offerId: string;
      priceMinor: number;
      status: z.infer<typeof s.offerStatus>;
      handlingDays?: number;
      listPriceMinor?: number | null;
    }) =>
      run("seller_update_offer", {
        p_offer_id: input.offerId,
        p_price_minor: input.priceMinor,
        p_status: input.status,
        p_handling_days: input.handlingDays,
        p_list_price_minor: input.listPriceMinor ?? undefined,
      }),
    sellerStock: (sellerId: string) =>
      call("seller_stock", { p_seller_id: sellerId }, z.array(s.sellerStockRow)),
    sellerSetStock: (warehouseId: string, skuId: string, quantity: number) =>
      run("seller_set_stock", {
        p_warehouse_id: warehouseId,
        p_sku_id: skuId,
        p_quantity: quantity,
      }),
    sellerStatements: (sellerId: string, limit?: number, offset?: number) =>
      call(
        "seller_statements",
        { p_seller_id: sellerId, p_limit: limit, p_offset: offset },
        z.array(s.sellerStatementRow),
      ),
    sellerOrderLines: (sellerId: string, limit?: number, offset?: number) =>
      call(
        "seller_order_lines",
        { p_seller_id: sellerId, p_limit: limit, p_offset: offset },
        z.array(s.sellerOrderLine),
      ),
    sellerToPack: (sellerId: string) =>
      call("seller_to_pack", { p_seller_id: sellerId }, z.array(s.sellerParcel)),
    sellerMarkPacked: (shipmentId: string, weightGrams: number, packageCount = 1) =>
      run("seller_mark_packed", {
        p_shipment_id: shipmentId,
        p_weight_grams: weightGrams,
        p_package_count: packageCount,
      }),
    sellerReplyReview: (reviewId: string, reply: string) =>
      run("seller_reply_review", { p_review_id: reviewId, p_reply: reply }),
    sellerCreateInbound: (input: {
      warehouseId: string;
      sellerId: string;
      lines: Array<{ skuId: string; quantity: number }>;
      expectedOn?: string | null;
    }) =>
      call(
        "seller_create_inbound",
        {
          p_warehouse_id: input.warehouseId,
          p_seller_id: input.sellerId,
          p_lines: input.lines.map((l) => ({ sku_id: l.skuId, quantity: l.quantity })),
          p_expected_on: input.expectedOn ?? undefined,
        },
        z.uuid(),
      ),

    sellerLocations: (sellerId: string) =>
      call("seller_locations", { p_seller_id: sellerId }, s.sellerLocations),
    sellerSaveLocation: (input: {
      sellerId: string;
      name: string;
      address: string;
      postalCode: string;
      lat: number;
      lng: number;
    }) =>
      call(
        "seller_save_location",
        {
          p_seller_id: input.sellerId,
          p_name: input.name,
          p_address: input.address,
          p_postal_code: input.postalCode,
          p_lat: input.lat,
          p_lng: input.lng,
        },
        z.uuid(),
      ),
    sellerInbounds: (sellerId: string) =>
      call("seller_inbounds", { p_seller_id: sellerId }, z.array(s.sellerInbound)),

    // ── Warehouse ───────────────────────────────────────────────────────────
    wmsBoard: (warehouseId: string) =>
      call("wms_board", { p_warehouse_id: warehouseId }, s.wmsBoard),
    wmsShipment: (shipmentId: string) =>
      call("wms_shipment", { p_shipment_id: shipmentId }, s.wmsShipment),
    wmsFindSku: (warehouseId: string, code: string) =>
      call("wms_find_sku", { p_warehouse_id: warehouseId, p_code: code }, s.wmsSku.nullable()),
    wmsLocations: (warehouseId: string) =>
      call("wms_locations", { p_warehouse_id: warehouseId }, z.array(s.wmsLocation)),
    wmsStartPicking: (shipmentId: string) =>
      run("wms_start_picking", { p_shipment_id: shipmentId }),
    wmsConfirmPick: (taskId: string, quantity: number, locationId?: string | null) =>
      run("wms_confirm_pick", {
        p_task_id: taskId,
        p_quantity: quantity,
        p_location_id: locationId ?? undefined,
      }),
    wmsPackShipment: (shipmentId: string, weightGrams: number, packageCount = 1) =>
      run("wms_pack_shipment", {
        p_shipment_id: shipmentId,
        p_weight_grams: weightGrams,
        p_package_count: packageCount,
      }),
    wmsReceive: (input: {
      inboundLineId: string;
      goodQuantity: number;
      damagedQuantity: number;
      locationId: string;
    }) =>
      run("wms_receive", {
        p_inbound_line_id: input.inboundLineId,
        p_good_quantity: input.goodQuantity,
        p_damaged_quantity: input.damagedQuantity,
        p_location_id: input.locationId,
      }),
    wmsAdjustStock: (input: {
      locationId: string;
      skuId: string;
      sellerId: string;
      delta: number;
      note: string;
    }) =>
      run("wms_adjust_stock", {
        p_location_id: input.locationId,
        p_sku_id: input.skuId,
        p_seller_id: input.sellerId,
        p_delta: input.delta,
        p_note: input.note,
      }),

    // ── Driver ──────────────────────────────────────────────────────────────
    driverToday: () => call("driver_today", {}, s.driverDay),
    driverStartRoute: (routeId: string) => run("driver_start_route", { p_route_id: routeId }),
    driverArrive: (stopId: string) => run("driver_arrive", { p_stop_id: stopId }),
    driverCompleteStop: (input: CompleteStopInput) =>
      call(
        "driver_complete_stop",
        {
          p_stop_id: input.stopId,
          p_pin: input.pin,
          p_recipient_name: input.recipientName,
          p_cod_collected_minor: input.codCollectedMinor,
          p_photo_path: input.photoPath ?? undefined,
          p_lat: input.lat ?? undefined,
          p_lng: input.lng ?? undefined,
        },
        s.stopResult,
      ),
    driverFailStop: (input: {
      stopId: string;
      reason: z.infer<typeof s.failureReason>;
      lat?: number | null;
      lng?: number | null;
    }) =>
      call(
        "driver_fail_stop",
        {
          p_stop_id: input.stopId,
          p_reason: input.reason,
          p_lat: input.lat ?? undefined,
          p_lng: input.lng ?? undefined,
        },
        s.stopFailed,
      ),
    driverReportPosition: (lat: number, lng: number, accuracyM?: number) =>
      run("driver_report_position", { p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM }),

    // ── Internal console ────────────────────────────────────────────────────
    opsOverview: () => call("ops_overview", {}, s.opsOverview),
    opsOrders: (
      input: {
        status?: z.infer<typeof s.orderStatus> | null;
        query?: string | null;
        limit?: number;
        offset?: number;
      } = {},
    ) =>
      call(
        "ops_orders",
        {
          p_status: input.status ?? undefined,
          p_query: input.query ?? undefined,
          p_limit: input.limit,
          p_offset: input.offset,
        },
        z.array(s.opsOrderRow),
      ),
    opsSellers: (status?: z.infer<typeof s.sellerStatus> | null) =>
      call("ops_sellers", { p_status: status ?? undefined }, z.array(s.opsSellerRow)),
    opsListingsForReview: () => call("ops_listings_for_review", {}, z.array(s.opsListingRow)),
    opsDispatchBoard: (date?: string | null) =>
      call("ops_dispatch_board", { p_date: date ?? undefined }, s.dispatchBoard),
    opsSettlements: (status: "open" | "settled" | "short" | null = "open") =>
      call("ops_settlements", { p_status: status }, z.array(s.opsSettlementRow)),
    opsCareQueues: () => call("ops_care_queues", {}, s.careQueues),
    opsCreateRoute: (input: CreateRouteInput) =>
      call(
        "ops_create_route",
        {
          p_service_date: input.serviceDate,
          p_depot_warehouse_id: input.depotWarehouseId,
          p_stops: input.stops.map((stop) => ({
            shipment_id: stop.shipmentId,
            sequence: stop.sequence,
            eta_minute: stop.etaMinute,
          })),
          p_driver_id: input.driverId ?? undefined,
          p_planned_km: input.plannedKm,
          p_planned_minutes: input.plannedMinutes,
        },
        z.uuid(),
      ),
    opsAssignRoute: (routeId: string, driverId: string) =>
      run("ops_assign_route", { p_route_id: routeId, p_driver_id: driverId }),
    opsSettleRoute: (routeId: string, handedMinor: number, note?: string | null) =>
      run("ops_settle_route", {
        p_route_id: routeId,
        p_handed_minor: handedMinor,
        p_note: note ?? undefined,
      }),
    opsReturnShipment: (shipmentId: string) =>
      run("ops_return_shipment", { p_shipment_id: shipmentId }),
    opsReviewProduct: (productId: string, approve: boolean, reason?: string | null) =>
      run("ops_review_product", {
        p_product_id: productId,
        p_approve: approve,
        p_reason: reason ?? undefined,
      }),
    opsSetSellerStatus: (
      sellerId: string,
      status: z.infer<typeof s.sellerStatus>,
      note?: string | null,
    ) =>
      run("ops_set_seller_status", {
        p_seller_id: sellerId,
        p_status: status,
        p_note: note ?? undefined,
      }),
    opsDecideReturn: (returnId: string, approve: boolean, note?: string | null) =>
      run("ops_decide_return", {
        p_return_id: returnId,
        p_approve: approve,
        p_note: note ?? undefined,
      }),
    opsCompleteReturn: (returnId: string, note?: string | null) =>
      call(
        "ops_complete_return",
        { p_return_id: returnId, p_note: note ?? undefined },
        s.refundResult,
      ),
    opsResolveComplaint: (complaintId: string, resolution: string, close = true) =>
      run("ops_resolve_complaint", {
        p_complaint_id: complaintId,
        p_resolution: resolution,
        p_close: close,
      }),
    opsResolveReport: (reportId: string, action: boolean, resolution: string) =>
      run("ops_resolve_report", {
        p_report_id: reportId,
        p_action: action,
        p_resolution: resolution,
      }),
    opsConfirmPayment: (orderId: string, bankReference: string) =>
      run("ops_confirm_payment", { p_order_id: orderId, p_bank_reference: bankReference }),
    opsDrivers: () => call("ops_drivers", {}, z.array(s.opsDriverRow)),
    opsSetDriverStatus: (driverId: string, status: z.infer<typeof s.opsDriverRow>["status"]) =>
      run("ops_set_driver_status", { p_driver_id: driverId, p_status: status }),
    auditEntries: (table?: string | null, limit?: number) =>
      call("audit_entries", { p_table: table ?? undefined, p_limit: limit }, z.array(s.auditEntry)),
  };
}

export type Api = ReturnType<typeof createApi>;
