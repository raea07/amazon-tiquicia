"use server";

/**
 * Staff steps added with the order follow-ups of 23 November 2026
 * (migration 084200): stopping a packed parcel before it leaves, and
 * removing a single closed day of a zone. Same pattern as actions.ts:
 * re-read the session, validate, call the API (which checks the staff role
 * itself), and redraw the screen behind the form, also when the API refused
 * because the screen was out of date.
 */

import { ApiError, RECALL_REASON_MIN_LETTERS } from "@yuntera/db";
import {
  type ActionState,
  GENERIC_ERROR,
  isRedirect,
  messageOf,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

async function staffAction(
  returnTo: string,
  run: (api: Awaited<ReturnType<typeof sessionApi>>) => Promise<string>,
  values: Record<string, string>,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  try {
    const ok = await run(await sessionApi());
    refresh();
    return { ok };
  } catch (error) {
    if (isRedirect(error)) throw error;
    if (
      error instanceof ApiError &&
      !["network", "unknown", "invalid_response"].includes(error.code)
    ) {
      refresh();
    }
    return { error: messageOf(error), values };
  }
}

const orderNumber = z.string().regex(/^YT-\d{4,12}$/);
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;

/** Operations staff stop a packed parcel: it goes back to the shelves, and is refunded when received. */
export async function recallShipment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values: Record<string, string> = {
    ...typed(formData, "reason"),
    confirm: formData.get("confirm") === "on" ? "on" : "",
  };
  const shipmentId = z.uuid().safeParse(formData.get("shipmentId"));
  const number = orderNumber.safeParse(formData.get("orderNumber"));
  if (!shipmentId.success || !number.success) return { error: GENERIC_ERROR, values };
  const reason = (values.reason ?? "").trim();
  if (letters(reason) < RECALL_REASON_MIN_LETTERS) {
    return {
      error:
        "Escriba por qué se detiene el paquete, con al menos cinco letras. Queda en el historial.",
      values,
    };
  }
  if (values.confirm !== "on") {
    return {
      error: "Marque la casilla para confirmar que el paquete vuelve a los estantes.",
      values,
    };
  }
  return staffAction(
    `/pedidos/${number.data}`,
    async (api) => {
      const result = await api.opsRecallShipment(shipmentId.data, reason);
      return result.route_code
        ? `Paquete ${result.tracking_code} detenido y quitado de la ruta ${result.route_code}. La bodega lo recibe en «Paquetes devueltos por recibir»; entonces se reembolsa.`
        : `Paquete ${result.tracking_code} detenido. La bodega lo recibe en «Paquetes devueltos por recibir»; entonces se reembolsa.`;
    },
    values,
  );
}

/** A day a zone was closed on its own (before closure periods existed) is opened again. */
export async function removeClosureDay(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "zoneId", "day");
  const zone = z.string().min(1).max(60).safeParse(values.zoneId);
  const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(values.day);
  if (!zone.success || !day.success) return { error: GENERIC_ERROR, values };
  return staffAction(
    "/operacion/cierres",
    async (api) => {
      await api.opsRemoveZoneClosureDay(zone.data, day.data);
      return "Día abierto de nuevo: la fecha de entrega que ve la tienda ya lo cuenta.";
    },
    values,
  );
}
