/**
 * Account security: the second-factor helpers, an administrator recovering a
 * colleague's factor, and deleting an account
 * (supabase/migrations/20261121082500_account_security.sql).
 *
 * This file also holds the messages for Supabase Auth's own error codes
 * (`authErrors`). Those codes come from the Auth service, not from our SQL, so
 * they are kept apart from `errors` (which `errors.test.ts` checks against the
 * migrations) and looked up with `authErrorMessage`.
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

// ── Payloads ────────────────────────────────────────────────────────────────

export const accountSecurity = z.object({
  aal: z.string(),
  is_staff: z.boolean(),
  mfa_required: z.boolean(),
  staff_session_ok: z.boolean(),
});
export type AccountSecurity = z.infer<typeof accountSecurity>;

export const mfaAttempts = z.object({
  locked: z.boolean(),
  attempts_left: z.number().int().min(0),
  retry_after_seconds: z.number().int().min(0),
});
export type MfaAttempts = z.infer<typeof mfaAttempts>;

export const staffSecurityRow = z.object({
  user_id: z.uuid(),
  full_name: z.string().nullable(),
  email: z.string(),
  role: z.enum(["admin", "ops", "support", "finance", "catalog"]),
  active: z.boolean(),
  factors: z.number().int().min(0),
  is_self: z.boolean(),
});
export type StaffSecurityRow = z.infer<typeof staffSecurityRow>;

export const factorReset = z.object({
  factors_removed: z.number().int().min(0),
  sessions_ended: z.number().int().min(0),
});
export type FactorReset = z.infer<typeof factorReset>;

/** Why an account cannot be deleted yet, most urgent first. */
export const deletionBlocker = z.enum([
  "account_is_staff",
  "account_is_driver",
  "account_is_warehouse_staff",
  "account_has_open_orders",
  "account_has_open_returns",
  "account_has_open_complaints",
  "account_shop_has_stock",
  "account_shop_has_open_orders",
  "account_shop_has_balance",
]);
export type DeletionBlocker = z.infer<typeof deletionBlocker>;

export const deletionCheck = z.object({
  blockers: z.array(deletionBlocker),
  orders_kept: z.number().int().min(0),
  reviews_kept: z.number().int().min(0),
});
export type DeletionCheck = z.infer<typeof deletionCheck>;

export const deletionResult = z.object({
  orders_kept: z.number().int().min(0),
  reviews_kept: z.number().int().min(0),
});
export type DeletionResult = z.infer<typeof deletionResult>;

// ── Errors raised by the database ───────────────────────────────────────────

export const errors = {
  cannot_reset_own_factor: {
    "es-CR":
      "No puede quitar su propia verificación en dos pasos desde aquí. Pídaselo a otra persona administradora.",
    en: "You cannot remove your own two-step verification here. Ask another administrator.",
  },
  staff_not_found: {
    "es-CR": "Esa persona no forma parte del personal.",
    en: "That person is not a member of staff.",
  },
  account_is_staff: {
    "es-CR":
      "Su cuenta tiene un puesto en el personal de Yuntera. Una persona administradora debe quitárselo antes de eliminarla.",
    en: "Your account holds a Yuntera staff role. An administrator must remove it before the account can be deleted.",
  },
  account_is_driver: {
    "es-CR":
      "Su cuenta está registrada como repartidor. Pida a operaciones que le den de baja y luego podrá eliminarla.",
    en: "Your account is registered as a driver. Ask operations to offboard you, then you can delete it.",
  },
  account_is_warehouse_staff: {
    "es-CR":
      "Su cuenta está asignada a una bodega. Pida a operaciones que la retiren y luego podrá eliminarla.",
    en: "Your account is assigned to a warehouse. Ask operations to remove it, then you can delete it.",
  },
  account_has_open_orders: {
    "es-CR":
      "Tiene pedidos en curso. Espere a recibirlos o cancélelos, y luego podrá eliminar la cuenta.",
    en: "You have orders in progress. Wait until they arrive or cancel them, then you can delete the account.",
  },
  account_has_open_returns: {
    "es-CR":
      "Tiene una devolución o un reembolso sin terminar. Cuando se complete podrá eliminar la cuenta.",
    en: "You have a return or refund in progress. Once it is complete you can delete the account.",
  },
  account_has_open_complaints: {
    "es-CR":
      "Tiene un reclamo que todavía estamos atendiendo. Cuando lo cerremos podrá eliminar la cuenta.",
    en: "You have a complaint we are still handling. Once it is closed you can delete the account.",
  },
  account_shop_has_stock: {
    "es-CR":
      "Una tienda de la que usted es parte todavía tiene inventario. Retírelo o pase la tienda a otra persona antes de eliminar la cuenta.",
    en: "A shop you belong to still has stock. Remove it or hand the shop to someone else before deleting the account.",
  },
  account_shop_has_open_orders: {
    "es-CR":
      "Una tienda de la que usted es parte tiene pedidos sin entregar. Espere a que se entreguen antes de eliminar la cuenta.",
    en: "A shop you belong to has orders not yet delivered. Wait until they are delivered before deleting the account.",
  },
  account_shop_has_balance: {
    "es-CR":
      "Una tienda de la que usted es parte tiene dinero pendiente con Yuntera. Cuando quede en cero podrá eliminar la cuenta.",
    en: "A shop you belong to has money pending with Yuntera. Once it is settled you can delete the account.",
  },
} as const satisfies Messages;

// ── Errors returned by Supabase Auth ────────────────────────────────────────

/**
 * Messages for the codes Supabase Auth returns (`error.code` in auth-js; the
 * list is in docs/research/supabase-auth-storage-wire-format.md, section 3.1).
 * `mfa_locked` is ours: the database's limit on wrong codes.
 */
export const authErrors = {
  invalid_credentials: {
    "es-CR": "El correo o la contraseña no coinciden.",
    en: "The e-mail or password does not match.",
  },
  email_not_confirmed: {
    "es-CR":
      "Todavía no ha confirmado su correo. Abra el enlace o escriba el código que le enviamos.",
    en: "You have not confirmed your e-mail yet. Open the link or enter the code we sent you.",
  },
  user_already_exists: {
    "es-CR": "Ya existe una cuenta con ese correo. Inicie sesión o recupere su contraseña.",
    en: "An account with that e-mail already exists. Sign in or reset your password.",
  },
  email_exists: {
    "es-CR": "Ese correo ya pertenece a otra cuenta.",
    en: "That e-mail already belongs to another account.",
  },
  weak_password: {
    "es-CR":
      "Esa contraseña es demasiado fácil de adivinar. Use al menos 8 caracteres y evite palabras comunes.",
    en: "That password is too easy to guess. Use at least 8 characters and avoid common words.",
  },
  same_password: {
    "es-CR": "La contraseña nueva debe ser distinta de la actual.",
    en: "The new password must be different from the current one.",
  },
  otp_expired: {
    "es-CR":
      "El enlace o el código ya no sirve: venció, ya se usó o no es correcto. Pida uno nuevo.",
    en: "The link or code no longer works: it expired, was already used or is wrong. Ask for a new one.",
  },
  over_email_send_rate_limit: {
    "es-CR": "Ya le enviamos un correo hace poco. Espere un momento antes de pedir otro.",
    en: "We sent you an e-mail a moment ago. Wait a little before asking for another.",
  },
  over_request_rate_limit: {
    "es-CR": "Hubo demasiados intentos seguidos. Espere unos minutos y vuelva a intentarlo.",
    en: "There were too many attempts in a row. Wait a few minutes and try again.",
  },
  insufficient_aal: {
    "es-CR": "Antes de hacer este cambio confirme el código de su aplicación de autenticación.",
    en: "Before making this change, confirm the code from your authenticator app.",
  },
  mfa_verification_failed: {
    "es-CR": "El código no es correcto. Revise que sea el más reciente de su aplicación.",
    en: "The code is not correct. Check that it is the latest one in your app.",
  },
  mfa_challenge_expired: {
    "es-CR": "Pasó demasiado tiempo. Escriba el código que muestra ahora su aplicación.",
    en: "Too much time passed. Enter the code your app shows now.",
  },
  mfa_ip_address_mismatch: {
    "es-CR": "No pudimos comprobar el código. Escriba el que muestra ahora su aplicación.",
    en: "We could not check the code. Enter the one your app shows now.",
  },
  mfa_factor_not_found: {
    "es-CR": "No encontramos su aplicación de autenticación en esta cuenta. Vuelva a configurarla.",
    en: "We could not find your authenticator app on this account. Set it up again.",
  },
  mfa_factor_name_conflict: {
    "es-CR": "Ya hay una configuración en curso. Recargue la página y empiece de nuevo.",
    en: "A setup is already in progress. Reload the page and start again.",
  },
  too_many_enrolled_mfa_factors: {
    "es-CR": "Su cuenta ya tiene el máximo de aplicaciones de autenticación. Quite una primero.",
    en: "Your account already has the maximum number of authenticator apps. Remove one first.",
  },
  mfa_totp_enroll_not_enabled: {
    "es-CR": "La verificación en dos pasos no está disponible en este momento.",
    en: "Two-step verification is not available right now.",
  },
  mfa_totp_verify_not_enabled: {
    "es-CR": "La verificación en dos pasos no está disponible en este momento.",
    en: "Two-step verification is not available right now.",
  },
  mfa_locked: {
    "es-CR": "Escribió demasiados códigos incorrectos. Por seguridad, espere antes de reintentar.",
    en: "Too many wrong codes were entered. For your security, wait before trying again.",
  },
  reauthentication_needed: {
    "es-CR": "Por seguridad, vuelva a ingresar antes de cambiar la contraseña.",
    en: "For your security, sign in again before changing the password.",
  },
  reauthentication_not_valid: {
    "es-CR": "El código de verificación no es correcto o ya venció.",
    en: "The verification code is wrong or has expired.",
  },
  current_password_required: {
    "es-CR": "Escriba su contraseña actual.",
    en: "Enter your current password.",
  },
  current_password_invalid: {
    "es-CR": "La contraseña actual no coincide.",
    en: "The current password does not match.",
  },
  session_not_found: {
    "es-CR": "Su sesión terminó. Ingrese de nuevo.",
    en: "Your session ended. Sign in again.",
  },
  session_expired: {
    "es-CR": "Su sesión terminó. Ingrese de nuevo.",
    en: "Your session ended. Sign in again.",
  },
  refresh_token_not_found: {
    "es-CR": "Su sesión terminó. Ingrese de nuevo.",
    en: "Your session ended. Sign in again.",
  },
  refresh_token_already_used: {
    "es-CR": "Su sesión terminó. Ingrese de nuevo.",
    en: "Your session ended. Sign in again.",
  },
  bad_jwt: {
    "es-CR": "Su sesión terminó. Ingrese de nuevo.",
    en: "Your session ended. Sign in again.",
  },
  no_authorization: {
    "es-CR": "Inicie sesión para continuar.",
    en: "Sign in to continue.",
  },
  user_not_found: {
    "es-CR": "Esta cuenta ya no existe.",
    en: "This account no longer exists.",
  },
  user_banned: {
    "es-CR": "Esta cuenta está desactivada. Si cree que es un error, escríbanos.",
    en: "This account is disabled. If you think this is a mistake, contact us.",
  },
  validation_failed: {
    "es-CR": "Revise los datos: algo no tiene el formato esperado.",
    en: "Check the details: something is not in the expected format.",
  },
  signup_disabled: {
    "es-CR": "Por ahora no estamos abriendo cuentas nuevas.",
    en: "We are not opening new accounts at the moment.",
  },
  email_address_not_authorized: {
    "es-CR": "No pudimos enviar el correo a esa dirección. Escríbanos para ayudarle.",
    en: "We could not send the e-mail to that address. Contact us and we will help.",
  },
} as const satisfies Messages;

export type AuthErrorCode = keyof typeof authErrors;

const AUTH_FALLBACK = {
  "es-CR": "No pudimos completar el paso. Inténtelo de nuevo en un momento.",
  en: "We could not complete that step. Please try again in a moment.",
} as const;

/**
 * Auth's rate-limit message carries the wait: "For security purposes, you can
 * only request this after 42 seconds." Returns those seconds, or null.
 */
export function retryAfterSeconds(message: string | null | undefined): number | null {
  const match = /after (\d+) seconds?/i.exec(message ?? "");
  return match?.[1] ? Number(match[1]) : null;
}

/** "42 segundos", "1 minuto", "15 minutos". */
export function waitText(seconds: number, locale: "es-CR" | "en" = "es-CR"): string {
  const es = locale === "es-CR";
  if (seconds < 60) return `${seconds} ${es ? "segundo" : "second"}${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${es ? "minuto" : "minute"}${minutes === 1 ? "" : "s"}`;
}

/**
 * What to tell a person about an Auth error. `message` is Auth's own text,
 * read only for the number of seconds to wait; it is never shown.
 */
export function authErrorMessage(
  error: { code?: string | null; message?: string | null } | null | undefined,
  locale: "es-CR" | "en" = "es-CR",
): string {
  const code = error?.code ?? "";
  if (!(code in authErrors)) return AUTH_FALLBACK[locale];
  const text = authErrors[code as AuthErrorCode][locale];
  if (code === "over_email_send_rate_limit") {
    const seconds = retryAfterSeconds(error?.message);
    if (seconds !== null) {
      return locale === "es-CR"
        ? `Ya le enviamos un correo hace poco. Puede pedir otro en ${waitText(seconds, locale)}.`
        : `We sent you an e-mail a moment ago. You can ask for another in ${waitText(seconds, locale)}.`;
    }
  }
  return text;
}

// ── Methods ─────────────────────────────────────────────────────────────────

export const api = ({ call }: Caller) => ({
  /** The session's assurance level and whether this person must use a second factor. */
  mySecurity: () => call("my_security", {}, accountSecurity),
  /** Whether a second-factor code may be tried now (the database's limit on wrong codes). */
  mfaAttemptStatus: () => call("mfa_attempt_status", {}, mfaAttempts),
  /** Reports a code Auth refused; returns the new state of the limit. */
  mfaRecordFailure: () => call("mfa_record_failure", {}, mfaAttempts),
  /** Administrators: every member of staff and whether they have a second factor. */
  opsStaffSecurity: () => call("ops_staff_security", {}, z.array(staffSecurityRow)),
  /** Administrators: removes a colleague's second factors and ends their sessions. */
  opsResetStaffFactor: (userId: string) =>
    call("ops_reset_staff_factor", { p_user_id: userId }, factorReset),
  /** What stands in the way of deleting the signed-in account, and what would be kept. */
  accountDeletionCheck: () => call("account_deletion_check", {}, deletionCheck),
  /** Deletes the signed-in account. Irreversible. */
  deleteMyAccount: () => call("delete_my_account", {}, deletionResult),
});
