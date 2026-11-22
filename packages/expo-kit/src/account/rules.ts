/**
 * The account screens' rules and words, the same as the websites'
 * (packages/next-kit/src/auth-rules.ts for passwords, the account pages in
 * packages/next-kit/src/account/pages.tsx for what a deletion erases and
 * keeps, packages/next-kit/src/server/account-actions.ts for the answers).
 * A copy, because next-kit depends on Next.js, which a native bundle must not
 * pull in; `rules.test.ts` runs the web's cases against it and reads the
 * web's deletion page so the two cannot drift.
 *
 * Pure: no React Native import, so the tests run in Node.
 */

import { apps } from "@yuntera/brand";
import { type DeletionBlocker, messageFor } from "@yuntera/db";

/** Matches the project's Auth setting (`password_min_length`). */
export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt, which Auth uses, reads only the first 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

/** Shown next to every new-password field, before anything is sent. */
export const PASSWORD_RULES = [
  `Al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  "Que no sea su correo ni una palabra fácil de adivinar.",
] as const;

export const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

/** What is wrong with a new password, in words a person can act on, or null. */
export function passwordProblem(
  password: string,
  options: { repeat?: string; email?: string | null } = {},
): string | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return "La contraseña es demasiado larga. Use una de menos de 70 caracteres.";
  }
  if (options.email && password.trim().toLowerCase() === options.email.trim().toLowerCase()) {
    return "La contraseña no puede ser su correo.";
  }
  if (options.repeat !== undefined && options.repeat !== password) {
    return "Las dos contraseñas no coinciden. Escríbala igual en ambos campos.";
  }
  return null;
}

// ── Password reset ──────────────────────────────────────────────────────────

/**
 * The answer to a reset request, whether or not the address has an account
 * (anything else would tell a stranger who is registered). The website's
 * answer also mentions a 6-digit code; the apps cannot take one yet (see
 * docs), so theirs speaks of the link only.
 */
export const RESET_SENT =
  "Si esa dirección tiene una cuenta en Yuntera, le acabamos de enviar un correo con un enlace. Si no le llega en unos minutos, revise el correo no deseado.";

/** What happens after the link, said on the screen that sent it. */
export const RESET_NEXT =
  "El enlace del correo abre el sitio web de Yuntera en el navegador del teléfono: ahí elige la contraseña nueva. Después vuelva a esta aplicación e ingrese con su correo y la contraseña nueva.";

/** The shop's planned public address, for a build that names none (EXPO_PUBLIC_SHOP_URL). */
export const DEFAULT_WEBSITE = `https://${apps.shop.host}`;

/**
 * Where the reset e-mail's link points: the website's own /auth/confirm,
 * which shows a button and checks the token only when it is pressed (mail
 * scanners open links), then asks for the new password.
 */
export const resetLinkFor = (website: string) => `${website.replace(/\/+$/, "")}/auth/confirm`;

export const PASSWORD_CHANGED =
  "Listo: su contraseña cambió. Cerramos las demás sesiones abiertas de su cuenta.";

export const CURRENT_PASSWORD_WRONG = "La contraseña actual no coincide.";

// ── Account deletion ────────────────────────────────────────────────────────

/** What deleting an account erases and what the law makes Yuntera keep: the web's words. */
export const DELETION_TERMS = {
  erased: {
    title: "Qué borramos",
    items: [
      "Su nombre, teléfono y correo, y la contraseña: ya no podrá ingresar.",
      "Sus direcciones de entrega y la ubicación marcada en el mapa.",
      "Sus consentimientos y preferencias de comunicación.",
      "En sus pedidos anteriores, el nombre, el teléfono y las señas de entrega; la ubicación queda solo aproximada (cerca de un kilómetro).",
      "Su verificación en dos pasos y todas sus sesiones abiertas.",
      "Su nombre en las reseñas que escribió: quedan publicadas como «Cliente».",
    ],
  },
  kept: {
    title: "Qué conservamos y por qué",
    text: "Los pedidos, sus pagos, los comprobantes electrónicos y los registros contables se conservan durante el plazo que exige la ley tributaria (cinco años para los comprobantes electrónicos), porque Yuntera y los vendedores deben poder demostrar cada venta ante Hacienda. Quedan sin su nombre ni sus datos de contacto: ya no se pueden relacionar con usted. Guardamos además que hubo una eliminación, con la fecha, sin datos de quién fue.",
  },
  after: {
    title: "Después",
    text: "La eliminación es inmediata y no se puede deshacer. Si más adelante quiere volver, puede crear una cuenta nueva con el mismo correo; empezará desde cero.",
  },
} as const;

/** Said in the apps only: what leaves this phone, beyond what the web page says. */
export const DELETION_ON_THIS_PHONE =
  "En este teléfono cerramos la sesión y borramos lo que la aplicación guardó de su cuenta.";

export const DELETION_CONFIRM_LABEL =
  "Entiendo que mi cuenta se elimina para siempre y que no se puede recuperar.";
export const DELETION_UNTICKED =
  "Marque la casilla para confirmar que entiende que esto no se puede deshacer.";
export const DELETION_PASSWORD_WRONG =
  "La contraseña no coincide. Escríbala de nuevo para confirmar.";

/** The page shown once the account is gone (the web's /cuenta-eliminada). */
export const ACCOUNT_DELETED = {
  title: "Su cuenta fue eliminada",
  text: "Borramos sus datos personales y cerramos todas sus sesiones. Los pedidos y comprobantes que la ley nos obliga a guardar quedaron sin su nombre ni sus datos de contacto.",
  again: "Si quiere volver, puede crear una cuenta nueva con cualquier correo, también el mismo.",
} as const;

/** Why the account cannot go yet, one sentence each, most urgent first. */
export const blockerMessages = (blockers: readonly DeletionBlocker[]): string[] =>
  blockers.map((code) => messageFor(code, "es-CR"));

/** "Conservaremos 3 pedidos sin sus datos…", as on the web. */
export function ordersKeptText(ordersKept: number): string {
  return ordersKept > 0
    ? `Conservaremos ${ordersKept} ${ordersKept === 1 ? "pedido" : "pedidos"} sin sus datos, como se explica arriba.`
    : "No tiene pedidos que debamos conservar.";
}
