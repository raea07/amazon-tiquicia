/**
 * The channels a person (or a shop) accepts for messages, checked before
 * anything is sent, with the words of the websites' actions
 * (apps/web/src/app/notification-actions.ts for a shopper,
 * apps/seller/src/app/notification-actions.ts for a shop). The database
 * checks the same again and decides the rest (e-mail cannot be switched off
 * while an order is open; a number that sent STOP stays off).
 *
 * Pure: `notification-rules.test.ts` runs in Node.
 */

import { parsePhone } from "@yuntera/core";
import { ApiError, COMMERCIAL_CONSENT_VERSION } from "@yuntera/db";
import { messageOf } from "../errors";

export type Audience = "shopper" | "shop";

export interface ChoicesForm {
  email: boolean;
  whatsapp: boolean;
  sms: boolean;
  push: boolean;
  commercial: boolean;
  phone: string;
}

/** What one save sends: channels and consent together, or nothing. */
export interface ChoicesInput {
  email: boolean;
  whatsapp: boolean;
  sms: boolean;
  push: boolean;
  phone: string | null;
  commercial: boolean;
  textVersion: string;
  version: number;
}

export const PHONE_INVALID =
  "Escriba un número de celular costarricense de 8 dígitos, que empiece por 5, 6, 7 u 8.";

export function checkChoices(
  form: ChoicesForm,
  context: { audience: Audience; emailLocked: boolean; version: number },
): { error: string } | { input: ChoicesInput } {
  const raw = form.phone.trim().slice(0, 20);
  const phone = raw ? parsePhone(raw) : null;
  if (raw && phone?.kind !== "mobile") return { error: PHONE_INVALID };
  const shop = context.audience === "shop";
  const sms = shop ? false : form.sms;
  if ((form.whatsapp || sms) && !phone) {
    return {
      error: shop
        ? "Para recibir avisos por WhatsApp, escriba un número de celular."
        : "Para recibir avisos por WhatsApp o SMS, escriba su número de celular.",
    };
  }
  return {
    input: {
      email: form.email || context.emailLocked,
      whatsapp: form.whatsapp,
      sms,
      push: form.push,
      phone: phone?.e164 ?? null,
      commercial: form.commercial,
      textVersion: COMMERCIAL_CONSENT_VERSION,
      version: context.version,
    },
  };
}

/** The number to offer in the field: the saved one, else a mobile on the profile or the shop. */
export function phoneToOffer(saved: string | null, fallback: string | null): string {
  const phone = saved ?? (/^\+506[5-8]/.test(fallback ?? "") ? fallback : null);
  return phone?.replace("+506", "") ?? "";
}

/** "22 de noviembre de 2026", in Costa Rica's time zone, as the web shows when consent was given. */
export const grantedDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeZone: "America/Costa_Rica" }).format(
    new Date(iso),
  );

export const SAVED: Record<Audience, string> = {
  shopper: "Guardamos sus preferencias. Se aplican desde el próximo aviso.",
  shop: "Guardamos las preferencias de su tienda.",
};

/**
 * Another device or the website saved since this screen loaded, so the
 * database refused the save (notify_settings_changed). The website's message
 * says to reload the page; an app has no page, so the screen loads the
 * current settings itself and says so.
 */
export const CHANGED_ELSEWHERE: Record<Audience, string> = {
  shopper:
    "Sus preferencias cambiaron en otro teléfono o en el sitio web mientras tenía abierta esta pantalla. Ahora ve las que están guardadas: revíselas y, si quiere cambiarlas, vuelva a guardar.",
  shop: "Las preferencias de su tienda cambiaron en otro teléfono o en el sitio web mientras tenía abierta esta pantalla. Ahora ve las que están guardadas: revíselas y, si quiere cambiarlas, vuelva a guardar.",
};

/** The current settings could not be loaded after such a refusal either. */
export const CHANGED_ELSEWHERE_RELOAD_FAILED =
  "Estas preferencias cambiaron en otro teléfono o en el sitio web mientras tenía abierta esta pantalla, y no pudimos cargar las actuales. Salga de esta pantalla y vuelva a abrirla.";

export type SaveOutcome<S> =
  | { kind: "saved"; settings: S; message: string }
  | { kind: "refreshed"; settings: S; message: string }
  | { kind: "error"; message: string };

/**
 * Saves, and when the database refuses because the settings changed
 * elsewhere, loads the current ones so the screen can show them instead of
 * the stale ones it was opened with.
 */
export async function saveChoices<S>(
  audience: Audience,
  input: ChoicesInput,
  save: (input: ChoicesInput) => Promise<S>,
  reload: () => Promise<S>,
): Promise<SaveOutcome<S>> {
  try {
    return { kind: "saved", settings: await save(input), message: SAVED[audience] };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "notify_settings_changed") {
      return { kind: "error", message: messageOf(error) };
    }
  }
  try {
    return { kind: "refreshed", settings: await reload(), message: CHANGED_ELSEWHERE[audience] };
  } catch {
    return { kind: "error", message: CHANGED_ELSEWHERE_RELOAD_FAILED };
  }
}
