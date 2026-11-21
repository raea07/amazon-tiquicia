"use server";

/**
 * The shop's notification settings: the channels its contact accepts and the
 * shop's consent for commercial messages. The shop comes from the session,
 * never from the form; the database checks the person is its owner or admin.
 */

import { parsePhone } from "@yuntera/core";
import { COMMERCIAL_CONSENT_VERSION } from "@yuntera/db";
import {
  type ActionState,
  messageOf,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentShop } from "@/lib/shop";

export async function saveShopNotificationSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await currentShop();
  if (!session) redirectTo(signInPath("/cuenta/notificaciones"));
  const flag = (name: string) => (formData.get(name) === "on" ? "on" : "");
  const values = {
    phone: typed(formData, "phone").phone ?? "",
    whatsapp: flag("whatsapp"),
    push: flag("push"),
    commercial: flag("commercial"),
  };
  const raw = values.phone.trim().slice(0, 20);
  const phone = raw ? parsePhone(raw) : null;
  if (raw && phone?.kind !== "mobile") {
    return {
      error:
        "Escriba un número de celular costarricense de 8 dígitos, que empiece por 5, 6, 7 u 8.",
      values,
    };
  }
  if (values.whatsapp && !phone) {
    return {
      error: "Para recibir avisos por WhatsApp, escriba un número de celular.",
      values,
    };
  }
  const version = z.coerce.number().int().nonnegative().safeParse(formData.get("version"));
  if (!version.success) return { error: "Recargue la página e inténtelo de nuevo.", values };

  try {
    // Channels and consent in one call: saved together or not at all.
    await (await sessionApi()).sellerSetNotificationSettings(session.shop.id, {
      whatsapp: values.whatsapp === "on",
      push: values.push === "on",
      phone: phone?.e164 ?? null,
      commercial: values.commercial === "on",
      textVersion: COMMERCIAL_CONSENT_VERSION,
      version: version.data,
    });
    refresh();
    return { ok: "Guardamos las preferencias de su tienda.", values };
  } catch (error) {
    return { error: messageOf(error), values };
  }
}
