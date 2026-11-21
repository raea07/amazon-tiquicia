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
    sms: flag("sms"),
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
  if ((values.whatsapp || values.sms) && !phone) {
    return {
      error: "Para recibir avisos por WhatsApp o SMS, escriba un número de celular.",
      values,
    };
  }

  try {
    const api = await sessionApi();
    await api.sellerSetNotificationSettings(session.shop.id, {
      whatsapp: values.whatsapp === "on",
      sms: values.sms === "on",
      push: values.push === "on",
      phone: phone?.e164 ?? null,
    });
    await api.sellerSetCommercialConsent(
      session.shop.id,
      values.commercial === "on",
      COMMERCIAL_CONSENT_VERSION,
      "seller_cuenta",
    );
    refresh();
    return { ok: "Guardamos las preferencias de su tienda.", values };
  } catch (error) {
    return { error: messageOf(error), values };
  }
}
