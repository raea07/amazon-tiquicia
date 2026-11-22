/**
 * Follow-ups found by the reviews of the apps and the tests on the preview:
 *
 *   Picking       the code the worker scanned goes with the pick, and the
 *                 database refuses another product's.
 *   Drivers       positions are checked; offline actions say when they
 *                 happened; each stop of the day says its district and cantón.
 *   Returns       a request still waiting for a decision can be withdrawn.
 *   Fees          offers a new fee schedule left below the price floor.
 *
 * Some methods here replace a core method of the same name (they are spread
 * after the core ones in createApi): `wmsConfirmPick`, `driverArrive`,
 * `driverFailStop` and `driverReportPosition` take the new arguments,
 * `driverToday` reads the stops' district and `opsDispatchBoard` the flags
 * of each stop. Callers that pass only the old
 * arguments work as before.
 *
 * SQL: supabase/migrations/20261121083200_followups.sql.
 */

import { z } from "zod";
import {
  dispatchBoard,
  driverDay,
  driverRoute,
  driverStop,
  type failureReason,
  stopFailed,
} from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);

/** A stop of the driver's day, with the district and cantón of the address. */
export const placedDriverStop = driverStop.extend({
  district: z.string().nullable(),
  canton: z.string().nullable(),
});
export type PlacedDriverStop = z.infer<typeof placedDriverStop>;
export const placedDriverRoute = driverRoute.extend({ stops: z.array(placedDriverStop) });
export type PlacedDriverRoute = z.infer<typeof placedDriverRoute>;
export const placedDriverDay = driverDay.extend({ routes: z.array(placedDriverRoute) });
export type PlacedDriverDay = z.infer<typeof placedDriverDay>;

/**
 * The dispatch board, each stop also saying when the server received its
 * closing and whether the position given at the door lay outside the
 * service area (kept, flagged for Central).
 */
const boardRoute = dispatchBoard.shape.routes.element;
export const flaggedDispatchStop = boardRoute.shape.stops.element.extend({
  completed_received_at: timestamp.nullable(),
  pod_outside_area: z.boolean(),
});
export type FlaggedDispatchStop = z.infer<typeof flaggedDispatchStop>;
export const flaggedDispatchBoard = dispatchBoard.extend({
  routes: z.array(boardRoute.extend({ stops: z.array(flaggedDispatchStop) })),
});
export type FlaggedDispatchBoard = z.infer<typeof flaggedDispatchBoard>;

/** What withdrawing a return request left. */
export const withdrawnReturn = z.object({
  id,
  status: z.literal("rejected"),
  withdrawn_at: timestamp,
});
export type WithdrawnReturn = z.infer<typeof withdrawnReturn>;

/** An offer a fee change paused because a sale would no longer cover its fees. */
export const feeFloorBreach = z.object({
  offer_id: id,
  seller_id: id,
  shop_name: z.string(),
  product_title: z.string(),
  variant_name: z.string(),
  sku_code: z.string(),
  schedule_version: z.string(),
  price_minor: z.number().int().positive(),
  /** The lowest price that covers the fees now, in céntimos; null when none does. */
  min_price_minor: z.number().int().positive().nullable(),
  paused_at: timestamp,
});
export type FeeFloorBreach = z.infer<typeof feeFloorBreach>;

/** A time for the database, as an ISO string. */
const when = (at: Date | string | null | undefined) =>
  at == null ? undefined : typeof at === "string" ? at : at.toISOString();

/**
 * When an action happened, as the phone's clock says, together with that
 * clock's time now (`p_sent_at`). The database takes only the difference (how
 * long the phone held the action), so a phone clock that is minutes or hours
 * off does not get every queued action refused as "in the future".
 */
const happened = (at: Date | string | null | undefined) => {
  const occurred = when(at);
  return occurred === undefined
    ? { p_occurred_at: undefined, p_sent_at: undefined }
    : { p_occurred_at: occurred, p_sent_at: new Date().toISOString() };
};

export const followupsErrors = {
  // ── Picking ──
  scan_required: {
    "es-CR": "Escanee o escriba el código del producto antes de confirmar las unidades que tomó.",
    en: "Scan or type the product's code before confirming the units you took.",
  },
  scanned_wrong_item: {
    "es-CR":
      "Ese código no es el de este producto. Revise que tomó el correcto y vuelva a escanearlo.",
    en: "That code is not this product's. Check that you took the right one and scan it again.",
  },

  // ── Drivers ──
  invalid_position: {
    "es-CR":
      "La ubicación del teléfono no es válida. Active la ubicación o inténtelo sin ella; la entrega se registra igual.",
    en: "The phone's location is not valid. Turn location on or try without it; the delivery is recorded all the same.",
  },
  position_outside_area: {
    "es-CR":
      "La ubicación del teléfono está fuera de Costa Rica, así que no se guardó. Revise que la ubicación esté activa.",
    en: "The phone's location is outside Costa Rica, so it was not saved. Check that location is turned on.",
  },
  action_time_in_future: {
    "es-CR":
      "La hora del teléfono está adelantada, así que no se registró. Corrija la hora del teléfono y vuelva a enviarlo.",
    en: "The phone's clock is ahead, so this was not recorded. Correct the phone's time and send it again.",
  },
  action_time_too_old: {
    "es-CR":
      "Esta acción tiene más de un día y ya no se puede registrar. Avise a Central qué pasó en esa parada.",
    en: "This action is more than a day old and can no longer be recorded. Tell Central what happened at that stop.",
  },

  // ── Returns ──
  units_already_in_return: {
    "es-CR":
      "Esas unidades ya están en otra solicitud de devolución. Vea en el pedido en qué va; si la abrió por error, puede retirarla mientras la revisamos.",
    en: "Those units are already in another return request. See on the order where it stands; if you opened it by mistake, you can withdraw it while we review it.",
  },
  return_more_than_received: {
    "es-CR": "Puede devolver como máximo las unidades que recibió de este producto.",
    en: "You can return at most the units of this product you received.",
  },
  return_not_withdrawable: {
    "es-CR":
      "Esta solicitud ya no se puede retirar: ya la revisamos. Si necesita cambiar algo, escríbanos.",
    en: "This request can no longer be withdrawn: it has already been reviewed. If something needs to change, write to us.",
  },

  // ── Refunds ──
  refund_not_found: {
    "es-CR": "No encontramos ese reembolso.",
    en: "We could not find that refund.",
  },
} as const satisfies Messages;

export const followupsApi = ({ call, run }: Caller) => ({
  /**
   * Confirms one pick line. `code` is what the worker scanned or typed; the
   * database compares it with the product's own codes and refuses another
   * product's. Confirming no new unit (a line left short) needs no code.
   */
  wmsConfirmPick: (
    taskId: string,
    quantity: number,
    locationId?: string | null,
    code?: string | null,
  ) =>
    run("wms_confirm_pick", {
      p_task_id: taskId,
      p_quantity: quantity,
      p_location_id: locationId ?? undefined,
      p_code: code ?? undefined,
    }),
  /** The driver's day; each stop says its district and cantón. */
  driverToday: () => call("driver_today", {}, placedDriverDay),
  /** Arrival at a stop; `occurredAt` when it is sent after the fact (no signal). */
  driverArrive: (stopId: string, occurredAt?: Date | string | null) =>
    run("driver_arrive", { p_stop_id: stopId, ...happened(occurredAt) }),
  driverFailStop: (input: {
    stopId: string;
    reason: z.infer<typeof failureReason>;
    lat?: number | null;
    lng?: number | null;
    occurredAt?: Date | string | null;
  }) =>
    call(
      "driver_fail_stop",
      {
        p_stop_id: input.stopId,
        p_reason: input.reason,
        p_lat: input.lat ?? undefined,
        p_lng: input.lng ?? undefined,
        ...happened(input.occurredAt),
      },
      stopFailed,
    ),
  driverReportPosition: (
    lat: number,
    lng: number,
    accuracyM?: number,
    occurredAt?: Date | string | null,
  ) =>
    run("driver_report_position", {
      p_lat: lat,
      p_lng: lng,
      p_accuracy_m: accuracyM,
      ...happened(occurredAt),
    }),
  /** The shopper withdraws a return request that is still waiting for a decision. */
  withdrawReturnRequest: (returnId: string) =>
    call("withdraw_return_request", { p_return_id: returnId }, withdrawnReturn),
  /** The dispatch board; each stop says whether its door position was flagged. */
  opsDispatchBoard: (date?: string | null) =>
    call("ops_dispatch_board", { p_date: date ?? undefined }, flaggedDispatchBoard),
  /** Finance and catalogue staff: offers a fee change paused, still paused. */
  opsFeeFloorBreaches: () => call("ops_fee_floor_breaches", {}, z.array(feeFloorBreach)),
});
