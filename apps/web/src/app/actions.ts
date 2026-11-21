"use server";

/**
 * Everything a shopper can change, as Server Actions.
 *
 * Each action re-reads the session itself rather than trusting the page that
 * rendered the form, validates its input, and calls the API. Authorization
 * proper happens in the database; these checks exist to give a good message
 * and a sensible redirect. Errors come back as text safe to show the user.
 */

import { parsePhone } from "@yuntera/core";
import {
  type ActionState,
  endSession,
  GENERIC_ERROR,
  isRedirect,
  messageOf,
  passwordSignIn,
  passwordSignUp,
  typed,
} from "@yuntera/next-kit/server";
import type { Route } from "next";
import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type CartItem,
  MAX_LINES,
  MAX_UNITS_PER_LINE,
  readCart,
  writeCart,
  writeLocation,
} from "@/lib/cart";
import { getViewer, safeReturnPath, signInUrl } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

const GENERIC = GENERIC_ERROR;

// ── Cart ────────────────────────────────────────────────────────────────────

const addSchema = z.object({
  offerId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(MAX_UNITS_PER_LINE),
});

export async function addToCart(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addSchema.safeParse({
    offerId: formData.get("offerId"),
    quantity: formData.get("quantity") ?? 1,
  });
  if (!parsed.success) return { error: "Elija una cantidad válida." };

  const cart = await readCart();
  const existing = cart.find((line) => line.offerId === parsed.data.offerId);
  if (!existing && cart.length >= MAX_LINES) {
    return { error: "Su carrito está lleno. Complete este pedido antes de agregar más productos." };
  }
  const quantity = Math.min((existing?.quantity ?? 0) + parsed.data.quantity, MAX_UNITS_PER_LINE);
  const next: CartItem[] = existing
    ? cart.map((line) => (line === existing ? { ...line, quantity } : line))
    : [...cart, { offerId: parsed.data.offerId, quantity }];
  await writeCart(next);

  if (formData.get("intent") === "buy") redirect("/pagar");
  return { ok: "Agregado al carrito." };
}

export async function updateCartLine(formData: FormData): Promise<void> {
  const parsed = z
    .object({ offerId: z.uuid(), quantity: z.coerce.number().int().min(0).max(MAX_UNITS_PER_LINE) })
    .safeParse({ offerId: formData.get("offerId"), quantity: formData.get("quantity") });
  if (!parsed.success) return;

  const cart = await readCart();
  await writeCart(
    parsed.data.quantity === 0
      ? cart.filter((line) => line.offerId !== parsed.data.offerId)
      : cart.map((line) =>
          line.offerId === parsed.data.offerId ? { ...line, quantity: parsed.data.quantity } : line,
        ),
  );
}

export async function setLocation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const postalCode = String(formData.get("postalCode") ?? "");
  if (!/^[1-7]\d{4}$/.test(postalCode))
    return { error: "Elija la provincia, el cantón y el distrito." };
  await writeLocation(postalCode);
  redirect(safeReturnPath(String(formData.get("siguiente") ?? "/")) as Route);
}

// ── Session ─────────────────────────────────────────────────────────────────

export async function signIn(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return passwordSignIn(formData);
}

export async function signUp(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return passwordSignUp(formData);
}

export async function signOut(): Promise<void> {
  await endSession("/");
}

// ── Addresses ───────────────────────────────────────────────────────────────

const addressSchema = z.object({
  recipientName: z.string().trim().min(3, "Escriba el nombre completo de quien recibe.").max(120),
  phone: z.string().trim(),
  postalCode: z.string().regex(/^[1-7]\d{4}$/, "Elija la provincia, el cantón y el distrito."),
  senas: z
    .string()
    .trim()
    .min(15, "Agregue más detalle a las señas: referencias, color de la casa, portón.")
    .max(500),
  lat: z.coerce.number().min(8, "Marque la ubicación de entrega.").max(11.25),
  lng: z.coerce.number().min(-86).max(-82.5),
  plusCode: z.string().trim().optional(),
  label: z.string().trim().max(40).optional(),
});

export async function saveAddress(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const returnTo = safeReturnPath(String(formData.get("siguiente") ?? "/cuenta"));
  if (!(await getViewer())) redirect(signInUrl(returnTo));

  const values = typed(formData, "recipientName", "phone", "senas");
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error:
        issue?.path[0] === "lat" || issue?.path[0] === "lng"
          ? "Marque la ubicación de entrega: use su ubicación actual o escriba su código Plus."
          : (issue?.message ?? GENERIC),
      values,
    };
  }
  const phone = parsePhone(parsed.data.phone);
  if (!phone) return { error: "Escriba un teléfono costarricense de 8 dígitos.", values };

  try {
    const api = await sessionApi();
    await api.saveAddress({
      recipientName: parsed.data.recipientName,
      phone: phone.e164,
      postalCode: parsed.data.postalCode,
      senas: parsed.data.senas,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      plusCode: parsed.data.plusCode || null,
      label: parsed.data.label || null,
      makeDefault: true,
    });
  } catch (error) {
    return { error: messageOf(error), values };
  }
  await writeLocation(parsed.data.postalCode);
  redirect(returnTo as Route);
}

export async function deleteAddress(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("addressId"));
  if (!id.success || !(await getViewer())) return;
  try {
    await (await sessionApi()).deleteAddress(id.data);
    refresh();
  } catch (error) {
    console.error(error);
  }
}

// ── Checkout ────────────────────────────────────────────────────────────────

const orderSchema = z.object({
  addressId: z.uuid("Elija la dirección de entrega."),
  paymentMethod: z.enum(["sinpe_movil", "card", "cash_on_delivery"], "Elija cómo desea pagar."),
  // Generated when the checkout page was rendered: a double click or a retry
  // after a timeout resends the same key and gets the same order back.
  idempotencyKey: z.string().min(8).max(80),
  expectedTotalMinor: z.coerce.number().int().positive(),
});

export async function placeOrder(_previous: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await getViewer())) redirect(signInUrl("/pagar"));

  const parsed = orderSchema.safeParse({
    addressId: formData.get("addressId"),
    paymentMethod: formData.get("paymentMethod"),
    idempotencyKey: formData.get("idempotencyKey"),
    expectedTotalMinor: formData.get("expectedTotalMinor"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC };

  const cart = await readCart();
  if (cart.length === 0) return { error: "Su carrito está vacío." };

  let orderNumber: string;
  try {
    const api = await sessionApi();
    const order = await api.placeOrder({ items: cart, ...parsed.data });
    orderNumber = order.order_number;
  } catch (error) {
    return { error: messageOf(error) };
  }

  await writeCart([]);
  updateTag("catalog"); // stock changed: refresh cached availability
  redirect(`/pedidos/${orderNumber}?nuevo=1` as Route);
}

// ── Orders ──────────────────────────────────────────────────────────────────

/** Runs an order action for the signed-in shopper and reports the outcome as form state. */
async function orderAction(
  orderNumber: string,
  run: (api: Awaited<ReturnType<typeof sessionApi>>) => Promise<string>,
): Promise<ActionState> {
  if (!(await getViewer())) redirect(signInUrl(`/pedidos/${orderNumber}`));
  try {
    const ok = await run(await sessionApi());
    refresh(); // the page behind the form shows the order: redraw it with the new state
    return { ok };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageOf(error) };
  }
}

export async function simulatePayment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const orderId = z.uuid().safeParse(formData.get("orderId"));
  if (!orderId.success) return { error: GENERIC };
  return orderAction(orderNumber, async (api) => {
    await api.confirmSandboxPayment(orderId.data);
    return "Pago de prueba registrado. Ya estamos preparando su pedido.";
  });
}

export async function cancelOrder(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const orderId = z.uuid().safeParse(formData.get("orderId"));
  if (!orderId.success) return { error: GENERIC };
  const state = await orderAction(orderNumber, async (api) => {
    const result = await api.cancelOrder(orderId.data, "Cancelado por el cliente");
    return result.status === "refunded"
      ? "Pedido cancelado. El reembolso va por el mismo medio con el que usted pagó."
      : "Pedido cancelado. No se le cobró nada.";
  });
  if (state.ok) updateTag("catalog");
  return state;
}

export async function submitReview(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      orderItemId: z.uuid(),
      rating: z.coerce.number().int().min(1, "Elija de 1 a 5 estrellas.").max(5),
      body: z.string().trim().max(4000).optional(),
    })
    .safeParse({
      orderItemId: formData.get("orderItemId"),
      rating: formData.get("rating"),
      body: formData.get("body") ?? undefined,
    });
  const values = typed(formData, "rating", "body");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC, values };

  const state = await orderAction(String(formData.get("orderNumber") ?? ""), async (api) => {
    await api.submitReview({ ...parsed.data, body: parsed.data.body || null });
    return "Gracias por su reseña. Ya está publicada.";
  });
  if (state.ok) updateTag("catalog");
  return state.error ? { ...state, values } : state;
}

export async function requestReturn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      orderItemId: z.uuid(),
      kind: z.enum(["withdrawal", "warranty", "damaged", "wrong_item"], "Elija el motivo."),
      quantity: z.coerce.number().int().min(1),
      reason: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      orderItemId: formData.get("orderItemId"),
      kind: formData.get("kind"),
      quantity: formData.get("quantity") ?? 1,
      reason: formData.get("reason") ?? undefined,
    });
  const values = typed(formData, "kind", "quantity", "reason");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC, values };

  const state = await orderAction(String(formData.get("orderNumber") ?? ""), async (api) => {
    await api.requestReturn({ ...parsed.data, reason: parsed.data.reason || null });
    return parsed.data.kind === "withdrawal"
      ? "Devolución aprobada. Le contactaremos para recoger el producto, sin costo para usted; cuando llegue a nuestra bodega le reembolsamos por el mismo medio de pago."
      : "Recibimos su solicitud. Le respondemos en un máximo de 2 días hábiles.";
  });
  return state.error ? { ...state, values } : state;
}

export async function updateProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await getViewer())) redirect(signInUrl("/cuenta"));
  const values = typed(formData, "fullName", "phone");
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (fullName.length < 3) return { error: "Escriba su nombre completo.", values };

  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = rawPhone ? parsePhone(rawPhone) : null;
  if (rawPhone && !phone)
    return { error: "Escriba un teléfono costarricense de 8 dígitos.", values };

  try {
    await (await sessionApi()).updateProfile({
      fullName,
      phone: phone?.e164 ?? null,
    });
    refresh(); // the header greets the person by name
    return { ok: "Datos guardados.", values };
  } catch (error) {
    return { error: messageOf(error), values };
  }
}
