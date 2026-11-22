"use server";

/**
 * Paying an order through the payment gateway (test and live modes).
 *
 * The shop never talks to the gateway: it asks the database to start an
 * attempt (the amount is the order's own), the server-side payments worker
 * creates it at the gateway, and the shop then sends the shopper to the
 * gateway's own page (card) or shows where to transfer (SINPE Móvil). The
 * order is paid when the gateway's signed notification says so; nothing the
 * browser does or says makes it paid.
 */

import type { OrderPayment } from "@yuntera/db";
import { type ActionState, isRedirect, messageOf, typed } from "@yuntera/next-kit/server";
import type { Route } from "next";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getViewer, signInUrl } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

const orderFields = z.object({
  orderId: z.uuid(),
  orderNumber: z.string().regex(/^YT-\d{4,12}$/),
});

const sinpeFields = z.object({
  kind: z.enum(["national", "resident", "legal_entity"], {
    error: "Elija el tipo de identificación de quien paga.",
  }),
  number: z
    .string()
    .trim()
    .regex(/^[0-9\s-]{9,16}$/, "Escriba el número de identificación tal como lo tiene su banco."),
  phone: z
    .string()
    .trim()
    .regex(
      /^(\+?506)?[\s-]?[5-8]\d{3}[\s-]?\d{4}$/,
      "Escriba el celular con SINPE Móvil, de 8 dígitos.",
    ),
});

/** Gives the worker a moment to prepare the attempt at the gateway (about a second locally). */
async function waitFor(
  api: Awaited<ReturnType<typeof sessionApi>>,
  orderNumber: string,
  ready: (payment: OrderPayment) => boolean,
): Promise<OrderPayment> {
  let payment = await api.orderPayment(orderNumber);
  for (let i = 0; i < 16 && !ready(payment); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    payment = await api.orderPayment(orderNumber);
  }
  return payment;
}

/** Only an address of the gateway's own page, never one taken from the request. */
function gatewayPage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.hostname === "127.0.0.1"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export async function startCardPayment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = orderFields.safeParse({
    orderId: formData.get("orderId"),
    orderNumber: formData.get("orderNumber"),
  });
  if (!parsed.success) return { error: "No pudimos leer el pedido. Recargue la página." };
  if (!(await getViewer())) redirect(signInUrl(`/pedidos/${parsed.data.orderNumber}`));

  let page: string | null = null;
  let stage: OrderPayment["stage"] | null = null;
  try {
    const api = await sessionApi();
    await api.startPayment(parsed.data.orderId, { returnTo: "web" });
    const payment = await waitFor(api, parsed.data.orderNumber, (p) => p.stage !== "preparing");
    page = gatewayPage(payment.attempt?.checkout_url);
    stage = payment.stage;
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageOf(error) };
  }
  if (page) redirect(page as Route);
  refresh();
  if (stage === "error") {
    return {
      error:
        "No pudimos conectar con el procesador de pagos. No se le cobró nada; inténtelo de nuevo en un momento.",
    };
  }
  return { ok: "Estamos preparando la página de pago. Esta página se actualiza sola." };
}

export async function startSinpePayment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "kind", "number", "phone");
  const order = orderFields.safeParse({
    orderId: formData.get("orderId"),
    orderNumber: formData.get("orderNumber"),
  });
  if (!order.success) return { error: "No pudimos leer el pedido. Recargue la página.", values };
  const payer = sinpeFields.safeParse({
    kind: formData.get("kind") || undefined,
    number: formData.get("number"),
    phone: formData.get("phone"),
  });
  if (!payer.success) return { error: payer.error.issues[0]?.message, values };
  if (!(await getViewer())) redirect(signInUrl(`/pedidos/${order.data.orderNumber}`));

  try {
    const api = await sessionApi();
    await api.startPayment(order.data.orderId, { payer: payer.data, returnTo: "web" });
    await waitFor(api, order.data.orderNumber, (p) => p.stage !== "preparing");
  } catch (error) {
    return { error: messageOf(error), values };
  }
  refresh();
  return { ok: "Listo: ya puede hacer la transferencia con los datos de arriba." };
}
