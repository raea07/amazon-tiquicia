import "server-only";
import { ApiError, authErrorMessage } from "@yuntera/db";
import { cookies } from "next/headers";
import { isEmail, passwordProblem } from "../auth-rules";
import { PER_PERSON_COOKIES } from "../guard";
import { safeReturnPath } from "../paths";
import type { ActionState } from "../types";
import { confirmUrl } from "./account";
import { captchaToken, reserveAttempt } from "./auth-guard";
import { redirectTo } from "./session";
import { sessionApi, sessionClient } from "./supabase";

/**
 * Helpers for Server Actions. (This file is not itself a "use server" module:
 * each app declares its own actions and calls these. The account-security
 * actions every app shares as they are live in account-actions.ts.)
 */

export const GENERIC_ERROR = "Algo salió mal de nuestro lado. Inténtelo de nuevo en un momento.";

/** Text that is safe to show for any failure. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.userMessage("es-CR");
  // Never show an unexpected error's text: it may describe internals.
  console.error(error);
  return GENERIC_ERROR;
}

/** The named text fields of a form, to echo back so the form keeps them. */
export function typed(formData: FormData, ...names: string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}

/** `redirect()` works by throwing; let that through instead of reporting it as a failure. */
export function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

/**
 * Runs one API call for a form and reports the outcome as form state.
 * `run` returns the success message.
 */
export async function attempt(
  run: () => Promise<string>,
  values?: Record<string, string>,
): Promise<ActionState> {
  try {
    return { ok: await run() };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageOf(error), values };
  }
}

/**
 * Signs in with e-mail and password, then goes to the form's `siguiente` path,
 * by way of the second step when the account has an authenticator.
 */
export async function passwordSignIn(formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const values = { email };
  if (!isEmail(email)) {
    return { error: "Escriba un correo válido.", values };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres.", values };
  }

  // Counted before the password goes to Auth, per visitor and per account
  // (auth-guard.ts); a right password gives the attempt back below.
  const attempt = await reserveAttempt("sign_in", { email });
  if ("error" in attempt) return { error: attempt.error, values };

  const supabase = await sessionClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: captchaToken(formData) },
  });
  if (error?.code === "email_not_confirmed") {
    // Auth says this only once the password was right, so it tells nothing to
    // someone who does not know the password.
    await attempt.succeeded();
    return { error: authErrorMessage(error), values, step: "confirm-email" };
  }
  if (error && AUTH_BUSY.has(error.code ?? "")) {
    return { error: authErrorMessage(error), values };
  }
  // One message for "no such account" and "wrong password": saying which would
  // tell a stranger whether an e-mail address has an account here.
  if (error) return { error: "El correo o la contraseña no coinciden.", values };
  await attempt.succeeded();

  const next = safeReturnPath(String(formData.get("siguiente") ?? "/"));
  // The account's factors come with the session just created: no extra request.
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.nextLevel === "aal2" && level.currentLevel !== "aal2") {
    redirectTo(`/verificar?siguiente=${encodeURIComponent(next)}`);
  }
  redirectTo(next);
}

/**
 * Auth's own refusals that are about the request, not the account: its limit
 * or the human check. Said as such (the same for every address), rather than
 * as a wrong password.
 */
const AUTH_BUSY = new Set(["over_request_rate_limit", "captcha_failed"]);

/** The version of the terms and privacy policy a new account agrees to. */
export const POLICY_VERSION = "2026-11";

/**
 * Creates an account with e-mail and password and goes to the form's
 * `siguiente` path. When the project confirms e-mail addresses, Auth returns
 * no session: the form then shows the "check your e-mail" step, and the
 * consent given here is recorded once the address is confirmed (it travels in
 * the account's metadata until then, with the path to return to).
 */
export async function passwordSignUp(formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const values = { email, fullName };
  if (fullName.length < 3 || fullName.length > 120) {
    return { error: "Escriba su nombre completo.", values };
  }
  if (!isEmail(email)) {
    return { error: "Escriba un correo válido.", values };
  }
  const problem = passwordProblem(password, { email });
  if (problem) return { error: problem, values };
  // Consent must be express: an unticked box stops the sign-up.
  if (formData.get("acepta") !== "on") {
    return {
      error: "Para crear la cuenta debe aceptar los términos y la política de privacidad.",
      values,
    };
  }

  const next = safeReturnPath(String(formData.get("siguiente") ?? "/"));
  const attempt = await reserveAttempt("sign_up", { email });
  if ("error" in attempt) return { error: attempt.error, values };

  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, consent_version: POLICY_VERSION, return_to: next },
      emailRedirectTo: confirmUrl(),
      captchaToken: captchaToken(formData),
    },
  });
  // An address that already has an account (WEB-M1). With e-mail confirmation
  // on, Auth answers as for a new address and sends nothing, so the screen is
  // the same. With it off, Auth says `user_already_exists`; the screen is still
  // the one a new address gets with confirmation on, but a new address is then
  // signed in at once, which a stranger can see (docs/03-data/access-control.md).
  if (!data.session && (!error || error.code === "user_already_exists")) {
    return { ok: signUpSent(email), values: { email }, step: "confirm-email" };
  }
  if (error) {
    return {
      error:
        error.code === "weak_password" ||
        error.code === "over_email_send_rate_limit" ||
        AUTH_BUSY.has(error.code ?? "")
          ? authErrorMessage(error)
          : "No pudimos crear la cuenta. Revise los datos e inténtelo de nuevo.",
      values,
    };
  }

  try {
    const api = await sessionApi();
    await api.recordConsent("terms", POLICY_VERSION);
    await api.recordConsent("privacy", POLICY_VERSION);
    await supabase.auth.updateUser({ data: { consent_version: null, return_to: null } });
  } catch (cause) {
    console.error(cause);
  }
  redirectTo(next);
}

/** What every sign-up that waits for its e-mail is told, whether or not the address was new. */
export const signUpSent = (email: string) =>
  `Le enviamos un correo a ${email} con un enlace y un código de 6 dígitos para confirmar la cuenta.`;

/**
 * Signs out of this browser only. (Auth's default would end every session of
 * the account on every device, and keep the cookie when Auth is unreachable.)
 */
export async function endSession(to = "/"): Promise<never> {
  const supabase = await sessionClient();
  await supabase.auth.signOut({ scope: "local" });
  await forgetPersonalCookies();
  redirectTo(to);
}

/** Removes what one person's work left in this browser (a search typed in the console). */
export async function forgetPersonalCookies(): Promise<void> {
  const store = await cookies();
  // Always, not only when this request carried them: a cookie for another
  // path (/pedidos) does not come with a request for this one.
  for (const { name, path } of PER_PERSON_COOKIES) store.delete({ name, path });
}
