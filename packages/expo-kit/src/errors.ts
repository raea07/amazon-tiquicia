/**
 * What to tell a person when something fails. Never a code, never the text of
 * an unexpected error (it may describe internals): the Spanish messages that
 * packages/db keeps for every code the database raises, or a calm general one.
 *
 * The same rules as `packages/next-kit/src/server/actions.ts`, so the web and
 * the apps say the same thing for the same failure.
 */

import { ApiError, messageFor } from "@yuntera/db";

export const GENERIC_ERROR = "Algo salió mal de nuestro lado. Inténtelo de nuevo en un momento.";
export const SIGN_IN_FAILED = "El correo o la contraseña no coinciden.";

function looksLikeNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // fetch() rejects with a TypeError ("Network request failed" on React
  // Native, "Failed to fetch" in browsers) when there is no connection.
  return error.name === "TypeError" || /network|fetch|timeout|offline/i.test(error.message);
}

/** Text that is safe to show for any failure of an API call. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.userMessage("es-CR");
  if (looksLikeNetworkFailure(error)) return messageFor("network", "es-CR");
  return GENERIC_ERROR;
}

/** The subset of supabase-js's AuthError the sign-in screens look at. */
interface AuthFailure {
  code?: string | null;
  status?: number | null;
  name?: string;
  message?: string;
}

const isAuthFailure = (error: unknown): error is AuthFailure =>
  typeof error === "object" && error !== null;

/**
 * Why a sign-in failed. "No such account" and "wrong password" get the same
 * message: saying which would tell a stranger whether an address has an account.
 */
export function signInMessage(error: unknown): string {
  if (!isAuthFailure(error)) return GENERIC_ERROR;
  if (error.name === "AuthRetryableFetchError" || looksLikeNetworkFailure(error)) {
    return messageFor("network", "es-CR");
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Demasiados intentos seguidos. Espere un minuto e inténtelo de nuevo.";
  }
  return SIGN_IN_FAILED;
}

/** Why creating an account failed. */
export function signUpMessage(error: unknown): string {
  if (!isAuthFailure(error)) return GENERIC_ERROR;
  if (error.name === "AuthRetryableFetchError" || looksLikeNetworkFailure(error)) {
    return messageFor("network", "es-CR");
  }
  if (error.code === "user_already_exists") {
    return "Ya existe una cuenta con ese correo. Inicie sesión.";
  }
  return "No pudimos crear la cuenta. Revise los datos e inténtelo de nuevo.";
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The checks the web runs before calling the auth server, with its words. */
export function validateSignIn(email: string, password: string): string | null {
  if (!EMAIL.test(email.trim())) return "Escriba un correo válido.";
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  return null;
}

export function validateSignUp(input: {
  fullName: string;
  email: string;
  password: string;
  accepted: boolean;
}): string | null {
  const name = input.fullName.trim();
  if (name.length < 3 || name.length > 120) return "Escriba su nombre completo.";
  const basic = validateSignIn(input.email, input.password);
  if (basic) return basic;
  // Consent must be express: an unticked box stops the sign-up.
  if (!input.accepted) {
    return "Para crear la cuenta debe aceptar los términos y la política de privacidad.";
  }
  return null;
}
