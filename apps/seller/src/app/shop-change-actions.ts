"use server";

/**
 * Server Actions for changing the shop's public name, its fiscal details and
 * its contact. None of them changes anything at once: each sends a request
 * that staff approve, because the name is what shoppers trust, the fiscal
 * details are what was verified, and the contact phone is the number finance
 * calls to confirm a change of payout account.
 */

import { parsePhone } from "@yuntera/core";
import {
  type ActionState,
  attempt,
  getViewer,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentShop } from "@/lib/shop";

async function shopForAction() {
  const session = await currentShop();
  if (!session) redirectTo((await getViewer()) ? "/registro" : signInPath("/cuenta"));
  return session.shop;
}

const SENT =
  "Solicitud enviada. La revisamos y le avisamos aquí; mientras tanto sigue vigente lo que ya teníamos.";

export async function requestShopName(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction();
  const values = typed(formData, "tradeName");
  const tradeName = (values.tradeName ?? "").trim().replace(/\s+/g, " ");
  if (tradeName.length < 2 || tradeName.length > 80) {
    return { error: "Escriba el nombre nuevo de la tienda (entre 2 y 80 letras).", values };
  }
  const state = await attempt(async () => {
    await (await sessionApi()).sellerRequestShopChange({
      sellerId: shop.id,
      kind: "shop_name",
      tradeName,
    });
    return SENT;
  }, values);
  if (state.ok) refresh();
  return state;
}

export async function requestContact(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction();
  const values = typed(formData, "contactEmail", "contactPhone");
  const contactEmail = (values.contactEmail ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail) || contactEmail.length > 254) {
    return { error: "Escriba un correo de contacto válido.", values };
  }
  const phone = parsePhone(values.contactPhone ?? "");
  if (!phone) return { error: "Escriba un teléfono costarricense de 8 dígitos.", values };
  const state = await attempt(async () => {
    await (await sessionApi()).sellerRequestShopChange({
      sellerId: shop.id,
      kind: "contact",
      contactEmail,
      contactPhone: phone.e164,
    });
    return "Solicitud enviada. Le llamamos al teléfono que ya teníamos para confirmarla; mientras tanto ese sigue siendo el de la tienda.";
  }, values);
  if (state.ok) refresh();
  return state;
}

const fiscal = z.object({
  taxRegime: z.enum(["general", "simplificado"], "Elija el régimen tributario."),
  fiscalAddress: z
    .string()
    .trim()
    .min(15, "Escriba la dirección fiscal completa: provincia, cantón, distrito y señas.")
    .max(500, "La dirección fiscal es demasiado larga."),
  postalCode: z
    .string()
    .trim()
    .regex(/^(\d{5})?$/, "El código postal tiene 5 dígitos.")
    .optional(),
  economicActivityCode: z
    .string()
    .trim()
    .regex(/^(\d{4,6})?$/, "El código de actividad económica tiene de 4 a 6 dígitos.")
    .optional(),
});

export async function requestFiscal(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction();
  const values = typed(
    formData,
    "taxRegime",
    "fiscalAddress",
    "postalCode",
    "economicActivityCode",
  );
  const parsed = fiscal.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revise los datos fiscales.", values };
  }
  const state = await attempt(async () => {
    await (await sessionApi()).sellerRequestShopChange({
      sellerId: shop.id,
      kind: "fiscal",
      taxRegime: parsed.data.taxRegime,
      fiscalAddress: parsed.data.fiscalAddress,
      postalCode: parsed.data.postalCode || null,
      economicActivityCode: parsed.data.economicActivityCode || null,
    });
    return SENT;
  }, values);
  if (state.ok) refresh();
  return state;
}

export async function withdrawShopChange(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await shopForAction();
  const id = z.uuid().safeParse(formData.get("requestId"));
  if (!id.success) return { error: "No encontramos esa solicitud. Recargue la página." };
  const state = await attempt(async () => {
    await (await sessionApi()).sellerWithdrawShopChange(id.data);
    return "Solicitud retirada.";
  });
  if (state.ok) refresh();
  return state;
}
