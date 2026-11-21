import "server-only";
import { ApiError } from "@yuntera/db";
import { safeReturnPath } from "../paths";
import type { ActionState } from "../types";
import { redirectTo } from "./session";
import { sessionApi, sessionClient } from "./supabase";

/**
 * Helpers for Server Actions. (This file is not itself a "use server" module:
 * each app declares its own actions and calls these.)
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

/** Signs in with e-mail and password, then goes to the form's `siguiente` path. */
export async function passwordSignIn(formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const values = { email };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Escriba un correo válido.", values };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres.", values };
  }

  const supabase = await sessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for "no such account" and "wrong password": saying which would
  // tell a stranger whether an e-mail address has an account here.
  if (error) return { error: "El correo o la contraseña no coinciden.", values };

  redirectTo(safeReturnPath(String(formData.get("siguiente") ?? "/")));
}

/** The version of the terms and privacy policy a new account agrees to. */
export const POLICY_VERSION = "2026-11";

/**
 * Creates an account with e-mail and password, records the consent given on
 * the form, then goes to the form's `siguiente` path.
 */
export async function passwordSignUp(formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const values = { email, fullName };
  if (fullName.length < 3 || fullName.length > 120) {
    return { error: "Escriba su nombre completo.", values };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Escriba un correo válido.", values };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres.", values };
  }
  // Consent must be express: an unticked box stops the sign-up.
  if (formData.get("acepta") !== "on") {
    return {
      error: "Para crear la cuenta debe aceptar los términos y la política de privacidad.",
      values,
    };
  }

  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) {
    return {
      error:
        error.code === "user_already_exists"
          ? "Ya existe una cuenta con ese correo. Inicie sesión."
          : "No pudimos crear la cuenta. Revise los datos e inténtelo de nuevo.",
      values,
    };
  }
  if (!data.session) {
    return { ok: "Le enviamos un correo para confirmar su cuenta. Ábralo para continuar." };
  }

  try {
    const api = await sessionApi();
    await api.recordConsent("terms", POLICY_VERSION);
    await api.recordConsent("privacy", POLICY_VERSION);
  } catch (cause) {
    console.error(cause);
  }
  redirectTo(safeReturnPath(String(formData.get("siguiente") ?? "/")));
}

export async function endSession(to = "/"): Promise<never> {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirectTo(to);
}
