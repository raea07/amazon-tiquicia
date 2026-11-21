"use server";

/**
 * Staff steps added with the integrity fixes of 21 November 2026: recording
 * that a return came back, checking in a parcel that came back undelivered,
 * and releasing a locked delivery code. Same pattern as actions.ts: re-read
 * the session, validate, call the API (which checks the staff role itself),
 * and redraw the screen behind the form when it worked.
 */

import { format, money } from "@yuntera/core";
import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
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
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  const state = await attempt(async () => run(await sessionApi()), values);
  if (state.ok) refresh();
  return state;
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
