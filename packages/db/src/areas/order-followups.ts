/**
 * Order and operations follow-ups found on the hosted preview: the delivery
 * fee refunded when nobody went to the door, staff stopping a packed parcel,
 * the parcels in the shopper's order list, a removed stop's parcel told from
 * a failed delivery, districts with a zone of their own, and a single closed
 * day removed.
 *
 * SQL: supabase/migrations/20261121084200_order_followups.sql.
 *
 * Several methods here replace a core or area method with the same name and
 * a wider schema (the database answers one or two more fields). The new
 * fields have defaults, so an app built from this code still parses the
 * answer of a database that does not have the migration yet.
 */

import { z } from "zod";
import { orderDetail, orderSummary, shipmentStatus } from "../schemas";
import { returnedShipmentResult, returningShipment } from "./integrity";
import {
  opsCanton,
  opsCantonDistricts,
  opsDistrict,
  opsOpenRoute,
  opsRouteStop,
} from "./operations";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);
const count = z.number().int().min(0);

// ── The shopper's orders ────────────────────────────────────────────────────

/** A parcel as the order list sees it: enough to say where the order stands. */
export const orderListShipment = z.object({
  status: shipmentStatus,
  attempt_count: count,
  /** Staff stopped it before it left the warehouse (isStoppedShipment). */
  recalled: z.boolean().default(false),
});
export type OrderListShipment = z.infer<typeof orderListShipment>;

/** One order of the shopper's list, with its parcels (since 084200). */
export const orderSummaryWithShipments = orderSummary.extend({
  shipments: z.array(orderListShipment).default([]),
  /**
   * Money is held for the shopper: a payment captured and not all refunded.
   * Null from a database without the field: the list then promises nothing.
   */
  paid: z.boolean().nullable().default(null),
});
export type OrderSummaryWithShipments = z.infer<typeof orderSummaryWithShipments>;

const orderDetailShipment = orderDetail.shape.shipments.element.extend({
  /** Staff stopped it before it left the warehouse. */
  recalled: z.boolean().default(false),
  /** Operations staff can still stop it (ops_recall_shipment); always false for the shopper. */
  can_recall: z.boolean().default(false),
  /** Stopped by staff and never out on a route (since 085000; false from an older database). */
  stopped_before_leaving: z.boolean().default(false),
  /** How many of each order line travel in this parcel (a line can be split). */
  units: z
    .array(z.object({ order_item_id: id, quantity: z.number().int().positive() }))
    .default([]),
});

/** One order in full, each parcel saying whether it was stopped (since 084200). */
export const orderDetailWithRecall = orderDetail.extend({
  shipments: z.array(orderDetailShipment),
  /** Each line of a parcel stopped before it left says so (since 085000). */
  timeline: z.array(
    orderDetail.shape.timeline.element.extend({
      stopped_before_leaving: z.boolean().default(false),
    }),
  ),
});
export type OrderDetailWithRecall = z.infer<typeof orderDetailWithRecall>;

// ── Parcels stopped before they left ────────────────────────────────────────

export const recalledShipment = z.object({
  shipment_id: id,
  tracking_code: z.string(),
  order_number: z.string(),
  status: z.literal("returning"),
  /** The route its stop was removed from, when it was planned on one. */
  route_code: z.string().nullable(),
});
export type RecalledShipment = z.infer<typeof recalledShipment>;

/** A parcel on its way back, and whether it never left the building. */
export const returningShipmentWithOrigin = returningShipment.extend({
  never_left: z.boolean().default(false),
  recalled_at: timestamp.nullable().default(null),
});
export type ReturningShipmentWithOrigin = z.infer<typeof returningShipmentWithOrigin>;

/** A returned parcel checked in, with the delivery fee given back with it (0 if not). */
export const returnedShipmentWithFee = returnedShipmentResult.extend({
  delivery_fee_refund_minor: z.number().int().nonnegative().default(0),
});
export type ReturnedShipmentWithFee = z.infer<typeof returnedShipmentWithFee>;

// ── The console ─────────────────────────────────────────────────────────────

/** A stop of an open route, with its parcel's attempts at the door. */
export const opsRouteStopWithAttempts = opsRouteStop.extend({
  attempt_count: count.default(0),
});
export type OpsRouteStopWithAttempts = z.infer<typeof opsRouteStopWithAttempts>;

export const opsOpenRouteWithAttempts = opsOpenRoute.extend({
  stops: z.array(opsRouteStopWithAttempts),
});
export type OpsOpenRouteWithAttempts = z.infer<typeof opsOpenRouteWithAttempts>;

export const opsCantonWithOwnZones = opsCanton.extend({
  /** Districts of the canton with a zone of their own instead of the canton's. */
  own_zone_count: count.default(0),
});
export type OpsCantonWithOwnZones = z.infer<typeof opsCantonWithOwnZones>;

export const opsDistrictWithOwnZone = opsDistrict.extend({
  /** It has a zone of its own; otherwise it follows its canton's. */
  own_zone: z.boolean().default(false),
});
export type OpsDistrictWithOwnZone = z.infer<typeof opsDistrictWithOwnZone>;

export const opsCantonDistrictsWithOwnZones = opsCantonDistricts.extend({
  districts: z.array(opsDistrictWithOwnZone),
});
export type OpsCantonDistrictsWithOwnZones = z.infer<typeof opsCantonDistrictsWithOwnZones>;

export const removedClosureDay = z.object({ zone_id: z.string(), day });
export type RemovedClosureDay = z.infer<typeof removedClosureDay>;

/** What the database accepts as a reason to stop a parcel: at least five letters. */
export const RECALL_REASON_MIN_LETTERS = 5;

export const orderFollowupsErrors = {
  returns_location_missing: {
    "es-CR":
      "La bodega no tiene una zona de devoluciones activa, así que no se recibió el paquete. Pida a operaciones que active una ubicación de devoluciones y vuelva a intentarlo.",
    en: "The warehouse has no returns area switched on, so the parcel was not received. Ask operations to switch on a returns location and try again.",
  },
  shipment_not_recallable: {
    "es-CR":
      "Ese paquete ya no se puede detener desde aquí: va en camino, ya se entregó o ya viene de regreso. Recargue la página para ver dónde está. Si falló una entrega, devuélvalo a la bodega desde Despacho.",
    en: "That parcel can no longer be stopped here: it is on its way, delivered or already coming back. Reload the page to see where it is. If a delivery failed, send it back to the warehouse from Dispatch.",
  },
  shipment_on_started_route: {
    "es-CR":
      "Ese paquete va en una ruta que ya salió. Quite la parada en Rutas detenidas y, cuando vuelva, devuélvalo a la bodega.",
    en: "That parcel is on a route that has already left. Remove the stop in Stuck routes and send it back to the warehouse when it returns.",
  },
} as const satisfies Messages;

export const orderFollowupsApi = ({ call }: Caller) => ({
  /** Replaces the core method: the same list, with each order's parcels. */
  myOrders: (limit?: number, offset?: number) =>
    call("my_orders", { p_limit: limit, p_offset: offset }, z.array(orderSummaryWithShipments)),
  /** Replaces the core method: each parcel says whether it was stopped. */
  getOrder: (orderNumber: string) =>
    call("get_order", { p_order_number: orderNumber }, orderDetailWithRecall),
  /** Sends a packed parcel (or one on a route not started) back to the shelves. */
  opsRecallShipment: (shipmentId: string, reason: string) =>
    call("ops_recall_shipment", { p_shipment_id: shipmentId, p_reason: reason }, recalledShipment),
  /** Replaces the integrity area's method: each parcel says whether it never left. */
  wmsReturningShipments: (warehouseId: string) =>
    call(
      "wms_returning_shipments",
      { p_warehouse_id: warehouseId },
      z.array(returningShipmentWithOrigin),
    ),
  /** Replaces the integrity area's method: also what came back of the delivery fee. */
  wmsReceiveReturnedShipment: (shipmentId: string, resellable = true, note: string | null = null) =>
    call(
      "wms_receive_returned_shipment",
      { p_shipment_id: shipmentId, p_resellable: resellable, p_note: note },
      returnedShipmentWithFee,
    ),
  /** Replaces the operations area's method: each stop with its parcel's attempts. */
  opsOpenRoutes: () => call("ops_open_routes", {}, z.array(opsOpenRouteWithAttempts)),
  /** Replaces the operations area's method: how many districts have a zone of their own. */
  opsDistrictCantons: () => call("ops_district_cantons", {}, z.array(opsCantonWithOwnZones)),
  /** Replaces the operations area's method: which districts have a zone of their own. */
  opsCantonDistricts: (cantonCode: string) =>
    call("ops_canton_districts", { p_canton_code: cantonCode }, opsCantonDistrictsWithOwnZones),
  /** Removes a day closed on its own (no period), today or later. */
  opsRemoveZoneClosureDay: (zoneId: string, closedDay: string) =>
    call("ops_remove_zone_closure_day", { p_zone_id: zoneId, p_day: closedDay }, removedClosureDay),
});
