"use server";

/**
 * Finance's work on payments through the gateway: settling money that did
 * not match an order, refunds that failed or go by transfer, fees from the
 * gateway's statement, and (administrators) the payments mode and the
 * expected fees. Each action re-reads the session, validates its input and
 * calls the API; the database checks the role on every call.
 */

import { parseColones } from "@yuntera/core";
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

async function financeAction(
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
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

const RESOLVED: Record<string, string> = {
  accept: "Pago aplicado al pedido. El pedido pasó a preparación.",
  attach: "Pago aplicado al pedido indicado. El pedido pasó a preparación.",
  refund: "Devolución solicitada. Aparece en Reembolsos hasta que el procesador la confirme.",
  dismiss: "Movimiento cerrado con su nota.",
};

export async function resolvePaymentReview(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "resolution", "note", "orderNumber");
  const review = uuid(formData, "reviewId");
  const action = z
    .enum(["accept", "attach", "refund", "dismiss"])
    .safeParse(formData.get("resolution"));
  if (!review.success) return { error: GENERIC_ERROR, values };
  if (!action.success) return { error: "Elija qué hacer con este movimiento.", values };
  const note = text(formData, "note");
  if (note.length < 4) return { error: "Escriba una nota que explique la decisión.", values };
  const orderNumber = text(formData, "orderNumber").toUpperCase();
  if (action.data === "attach" && !/^YT-\d{4,12}$/.test(orderNumber)) {
    return {
      error: "Escriba el número del pedido al que corresponde, por ejemplo YT-100123.",
      values,
    };
  }
  return financeAction(
    "/cobros/revision",
    async (api) => {
      await api.opsResolvePaymentReview(
        review.data,
        action.data,
        note,
        action.data === "attach" ? orderNumber : undefined,
      );
      return RESOLVED[action.data] ?? "Listo.";
    },
    values,
  );
}

export async function retryGatewayRefund(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const refund = uuid(formData, "refundId");
  if (!refund.success) return { error: GENERIC_ERROR };
  return financeAction("/cobros/reembolsos", async (api) => {
    await api.opsRetryGatewayRefund(refund.data);
    return "Se enviará de nuevo al procesador en unos segundos.";
  });
}

export async function recordRefundTransfer(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "bankReference", "note");
  const refund = uuid(formData, "refundId");
  if (!refund.success) return { error: GENERIC_ERROR, values };
  const reference = text(formData, "bankReference");
  if (reference.length < 4) {
    return { error: "Escriba el número de comprobante de la transferencia.", values };
  }
  return financeAction(
    "/cobros/reembolsos",
    async (api) => {
      await api.opsRecordRefundTransfer(
        refund.data,
        reference,
        text(formData, "note") || undefined,
      );
      return "Reembolso registrado como completado. Se le avisa al cliente.";
    },
    values,
  );
}

export async function recordPaymentFee(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "fee");
  const payment = uuid(formData, "paymentId");
  if (!payment.success) return { error: GENERIC_ERROR, values };
  const fee = parseColones(text(formData, "fee"));
  if (fee === null)
    return { error: "Escriba la comisión en colones, por ejemplo 1 250,50.", values };
  return financeAction(
    "/cobros",
    async (api) => {
      await api.opsRecordPaymentFee(payment.data, fee, "Del estado de cuenta del procesador");
      return "Comisión registrada.";
    },
    values,
  );
}

export async function setPaymentsMode(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "mode", "note");
  const mode = z.enum(["sandbox", "test", "live"]).safeParse(formData.get("mode"));
  if (!mode.success) return { error: "Elija el modo de pagos.", values };
  const note = text(formData, "note");
  if (note.length < 10)
    return { error: "Escriba el motivo del cambio (al menos 10 caracteres).", values };
  return financeAction(
    "/cobros/ajustes",
    async (api) => {
      const settings = await api.opsSetPaymentsMode(mode.data, note);
      return `Modo de pagos cambiado a «${MODE_LABEL[settings.mode]}». Quedó en la auditoría.`;
    },
    values,
  );
}

const MODE_LABEL = { sandbox: "simulación", test: "pruebas del procesador", live: "real" } as const;

export async function setExpectedFee(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "method", "percent", "fixed", "note");
  const method = z.enum(["card", "sinpe_movil"]).safeParse(formData.get("method"));
  if (!method.success) return { error: "Elija el medio de pago.", values };
  const percent = Number(text(formData, "percent").replace(",", "."));
  if (!Number.isFinite(percent) || percent < 0 || percent > 20) {
    return { error: "Escriba el porcentaje entre 0 y 20, por ejemplo 3,9.", values };
  }
  const fixed = parseColones(text(formData, "fixed") || "0");
  if (fixed === null)
    return { error: "Escriba el monto fijo en colones, por ejemplo 180.", values };
  const note = text(formData, "note");
  if (note.length < 10)
    return { error: "Escriba de dónde sale la tarifa (al menos 10 caracteres).", values };
  return financeAction(
    "/cobros/ajustes",
    async (api) => {
      await api.opsSetExpectedGatewayFee(method.data, Math.round(percent * 100), fixed, note);
      return "Comisión esperada actualizada. Se usa para los pagos que entren desde ahora.";
    },
    values,
  );
}
