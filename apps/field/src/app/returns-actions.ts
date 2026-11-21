"use server";

/**
 * The warehouse checks in a parcel that came back without being delivered:
 * its units go back on the shelf (or are recorded as damaged) and the shopper
 * gets back what they paid for them. Re-reads the session and validates; the
 * database checks that the person works at the parcel's warehouse. On
 * success the board is loaded again with a confirmation (the parcel leaves
 * the list); on a refusal it is redrawn too, so a parcel someone else
 * already checked in drops off.
 */

import { ApiError } from "@yuntera/db";
import {
  type ActionState,
  GENERIC_ERROR,
  getViewer,
  isRedirect,
  messageOf,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";

export async function checkInReturnedParcel(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "condition", "note");
  const shipmentId = z.uuid().safeParse(formData.get("shipmentId"));
  if (!shipmentId.success) return { error: GENERIC_ERROR, values };
  const condition = z.enum(["resellable", "damaged"]).safeParse(values.condition);
  if (!condition.success) return { error: "Indique en qué estado llegó el paquete.", values };
  if (!(await getViewer())) redirectTo(signInPath("/bodega"));

  try {
    await (await sessionApi()).wmsReceiveReturnedShipment(
      shipmentId.data,
      condition.data === "resellable",
      values.note?.trim() || null,
    );
  } catch (error) {
    if (isRedirect(error)) throw error;
    if (error instanceof ApiError) refresh();
    return { error: messageOf(error), values };
  }
  redirectTo(`/bodega?devuelto=${condition.data === "resellable" ? "venta" : "danado"}`);
}
