"use server";

/**
 * The shopper's notification settings. Like the other actions, this re-reads
 * the session, validates its input and calls the API; the database decides
 * (and refuses, for example, to switch e-mail off while an order is open).
 */

import { parsePhone } from "@yuntera/core";
import { COMMERCIAL_CONSENT_VERSION } from "@yuntera/db";
import { type ActionState, messageOf, typed } from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getViewer, signInUrl } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

const settingsSchema = z.object({
  email: z.boolean(),
  whatsapp: z.boolean(),
  sms: z.boolean(),
  push: z.boolean(),
  commercial: z.boolean(),
  phone: z.string().trim().max(20),
  /** What the page was loaded with: a save from an out-of-date tab is refused. */
  version: z.coerce.number().int().nonnegative(),
});

export async function saveNotificationSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await getViewer())) redirect(signInUrl("/cuenta/notificaciones"));
  const values = {
    phone: typed(formData, "phone").phone ?? "",
    email: formData.get("email") === "on" ? "on" : "",
    whatsapp: formData.get("whatsapp") === "on" ? "on" : "",
    sms: formData.get("sms") === "on" ? "on" : "",
    push: formData.get("push") === "on" ? "on" : "",
    commercial: formData.get("commercial") === "on" ? "on" : "",
  };
  const parsed = settingsSchema.safeParse({
    email: values.email === "on" || formData.get("emailLocked") === "1",
    whatsapp: values.whatsapp === "on",
    sms: values.sms === "on",
    push: values.push === "on",
    commercial: values.commercial === "on",
    phone: values.phone,
    version: formData.get("version"),
  });
  if (!parsed.success) return { error: "Revise los datos del formulario.", values };
  const input = parsed.data;

  const phone = input.phone ? parsePhone(input.phone) : null;
  if (input.phone && (!phone || !/^\+506[5-8]\d{7}$/.test(phone.e164))) {
    return {
      error:
        "Escriba un número de celular costarricense de 8 dígitos, que empiece por 5, 6, 7 u 8.",
      values,
    };
  }
  if ((input.whatsapp || input.sms) && !phone) {
    return {
      error: "Para recibir avisos por WhatsApp o SMS, escriba su número de celular.",
      values,
    };
  }

  try {
    // Channels and consent in one call: saved together or not at all.
    await (await sessionApi()).setMyNotificationSettings({
      email: input.email,
      whatsapp: input.whatsapp,
      sms: input.sms,
      push: input.push,
      phone: phone?.e164 ?? null,
      commercial: input.commercial,
      textVersion: COMMERCIAL_CONSENT_VERSION,
      version: input.version,
    });
    refresh();
    return { ok: "Guardamos sus preferencias. Se aplican desde el próximo aviso.", values };
  } catch (error) {
    return { error: messageOf(error), values };
  }
}
