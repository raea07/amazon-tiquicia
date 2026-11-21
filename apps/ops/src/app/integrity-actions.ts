"use server";

/**
 * Staff steps added with the integrity fixes of 21 November 2026: recording
 * that a return came back, closing one whose goods never came, checking in a
 * parcel that came back undelivered, releasing a locked delivery code, and
 * cancelling an order. Same pattern as actions.ts: re-read the session,
 * validate, call the API (which checks the staff role itself), and redraw the
 * screen behind the form — also when the API refused because the screen was
 * out of date (another tab, another person), so it shows what is true now.
 */

import { format, money } from "@yuntera/core";
import { ApiError } from "@yuntera/db";
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
  values?: Record<string, string>,
  explain?: (error: ApiError) => string | null,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  try {
    const ok = await run(await sessionApi());
    refresh();
    return { ok };
  } catch (error) {
    if (isRedirect(error)) throw error;
    // A refusal by the database means the screen may be out of date: redraw it.
    if (
      error instanceof ApiError &&
      !["network", "unknown", "invalid_response"].includes(error.code)
    ) {
      refresh();
    }
    const explained = error instanceof ApiError ? explain?.(error) : null;
    return { error: explained ?? messageOf(error), values };
  }
}

const uuid = (formData: FormData, name: string) => z.uuid().safeParse(formData.get(name));
const condition = z.enum(["resellable", "damaged"]);
const orderNumber = z.string().regex(/^YT-\d{4,12}$/);

/** The goods of an approved return arrived: in a condition to sell again, or not. */
export async function receiveReturn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "condition", "note");
  const returnId = uuid(formData, "returnId");
  if (!returnId.success) return { error: GENERIC_ERROR, values };
  const state = condition.safeParse(values.condition);
  if (!state.success) return { error: "Indique en qué estado llegó el producto.", values };
  return staffAction(
    "/atencion",
    async (api) => {
      await api.opsReceiveReturn(returnId.data, state.data === "resellable", values.note || null);
      return state.data === "resellable"
        ? "Recibido y de vuelta a la venta. Ya puede registrar el reembolso."
        : "Recibido como dañado; no vuelve a la venta. Ya puede registrar el reembolso.";
    },
    values,
  );
}

/** An approved return whose goods never came back is closed, with a reason the shopper reads. */
export async function closeReturn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "note");
  const returnId = uuid(formData, "returnId");
  if (!returnId.success) return { error: GENERIC_ERROR, values };
  if ((values.note ?? "").trim().length < 10) {
    return {
      error: "Explique al cliente por qué se cierra, por ejemplo cuándo intentamos recogerlo.",
      values,
    };
  }
  return staffAction(
    "/atencion",
    async (api) => {
      await api.opsDecideReturn(returnId.data, false, (values.note ?? "").trim());
      return "Devolución cerrada; el cliente ve el motivo en su pedido.";
    },
    values,
  );
}

/**
 * Staff cancel an order. The refusals are worded for staff, not for the
 * shopper: an order already cancelled, or one with a parcel packed (which
 * comes back through the returned-parcel check-in instead).
 */
export async function staffCancelOrder(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "note");
  const orderId = uuid(formData, "orderId");
  const number = orderNumber.safeParse(formData.get("orderNumber"));
  if (!orderId.success || !number.success) return { error: GENERIC_ERROR, values };
  const reason = (values.note ?? "").trim();
  if (reason.length < 5) return { error: "Escriba el motivo de la cancelación.", values };
  return staffAction(
    `/pedidos/${number.data}`,
    async (api) => {
      const result = await api.cancelOrder(orderId.data, reason);
      return result.status === "refunded"
        ? "Pedido cancelado y marcado para reembolso."
        : "Pedido cancelado. No se había cobrado.";
    },
    values,
    (error) => {
      if (error.code !== "too_late_to_cancel") return null;
      if (error.detail === "cancelled" || error.detail === "refunded") {
        return "Este pedido ya estaba cancelado. La página ya muestra cómo quedó.";
      }
      return "Ya hay un paquete empacado o en camino, así que no se puede cancelar. Si el cliente no lo quiere, que lo rechace en la entrega; al volver a bodega se recibe como devuelto y se le reembolsa.";
    },
  );
}

/** A parcel that came back undelivered is checked in at the warehouse. */
export async function receiveReturnedParcel(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "condition", "note");
  const shipmentId = uuid(formData, "shipmentId");
  const number = orderNumber.safeParse(formData.get("orderNumber"));
  if (!shipmentId.success || !number.success) return { error: GENERIC_ERROR, values };
  const state = condition.safeParse(values.condition);
  if (!state.success) return { error: "Indique en qué estado llegó el paquete.", values };
  return staffAction(
    `/pedidos/${number.data}`,
    async (api) => {
      const result = await api.wmsReceiveReturnedShipment(
        shipmentId.data,
        state.data === "resellable",
        values.note || null,
      );
      const stock =
        state.data === "resellable"
          ? "Las unidades volvieron al inventario."
          : "Quedó registrado como dañado.";
      return result.refund_minor > 0
        ? `${stock} Se registró el reembolso de ${format(money(result.refund_minor))} al cliente.`
        : stock;
    },
    values,
  );
}

/** After speaking with the shopper, staff release a locked delivery code. */
export async function releaseDeliveryCode(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "note");
  const orderId = uuid(formData, "orderId");
  const number = orderNumber.safeParse(formData.get("orderNumber"));
  if (!orderId.success || !number.success) return { error: GENERIC_ERROR, values };
  if ((values.note ?? "").trim().length < 5) {
    return { error: "Escriba con quién habló y qué confirmó.", values };
  }
  return staffAction(
    `/pedidos/${number.data}`,
    async (api) => {
      await api.opsReleaseDeliveryCode(orderId.data, (values.note ?? "").trim());
      return "Código liberado. El cliente ya ve un código nuevo en su pedido.";
    },
    values,
  );
}
