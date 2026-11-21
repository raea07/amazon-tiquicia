"use server";

/**
 * Server Actions for the account-security screens, shared by every app:
 * password reset, e-mail confirmation, password change, the second factor and
 * account deletion. Each re-reads the session, validates its input, talks to
 * Auth or the database, and reports back as ActionState. Auth's own error
 * codes become messages through `authErrorMessage`; nothing Auth or the
 * database says is shown as is.
 *
 * Every call that changes the session (verifying a link or code, a second
 * factor, a new password) runs here, in an action, because only actions and
 * route handlers may write the session cookie.
 */

import { ApiError, authErrorMessage, waitText } from "@yuntera/db";
import { isEmail, isLinkType, isTokenHash, normaliseCode, passwordProblem } from "../auth-rules";
import { safeReturnPath } from "../paths";
import type { ActionState } from "../types";
import { confirmUrl, getSecurity, passwordIsCorrect, qrDataUri } from "./account";
import { GENERIC_ERROR, isRedirect, messageOf } from "./actions";
import { getViewer, redirectTo } from "./session";
import { sessionApi, sessionClient } from "./supabase";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const returnTo = (formData: FormData) => safeReturnPath(field(formData, "siguiente") || "/");

/**
 * After the first sign-in of a confirmed account: records the consent given on
 * the sign-up form (carried in the account's metadata, because with
 * confirmation on there was no session to record it with) and clears it.
 */
async function settleSignUp(metadata: Record<string, unknown> | undefined): Promise<string> {
  const version = typeof metadata?.consent_version === "string" ? metadata.consent_version : null;
  const next = safeReturnPath(typeof metadata?.return_to === "string" ? metadata.return_to : "/");
  if (version) {
    try {
      const api = await sessionApi();
      await api.recordConsent("terms", version);
      await api.recordConsent("privacy", version);
      const supabase = await sessionClient();
      await supabase.auth.updateUser({ data: { consent_version: null, return_to: null } });
    } catch (cause) {
      console.error(cause);
    }
  }
  return next;
}

// ── Password reset ──────────────────────────────────────────────────────────

/** Sends the reset e-mail. Answers the same whether or not the address has an account. */
export async function requestPasswordReset(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = field(formData, "email").toLowerCase();
  if (!isEmail(email)) return { error: "Escriba un correo válido.", values: { email } };
  const supabase = await sessionClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: confirmUrl() });
  // A limit hit or an unknown address must look exactly like success: anything
  // else would tell a stranger whether the address has an account here.
  if (error && error.code !== "over_email_send_rate_limit") console.error(error.code);
  return {
    ok: "Si esa dirección tiene una cuenta en Yuntera, le acabamos de enviar un correo con un enlace y un código de 6 dígitos. Si no le llega en unos minutos, revise el correo no deseado.",
    step: "code",
    values: { email },
  };
}

/** The 6-digit code from the reset e-mail, typed instead of following the link. */
export async function verifyRecoveryCode(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = field(formData, "email").toLowerCase();
  const code = normaliseCode(formData.get("code"));
  const values = { email };
  if (!isEmail(email)) return { error: "Escriba un correo válido.", values, step: "code" };
  if (!code) return { error: "El código tiene 6 dígitos.", values, step: "code" };
  const supabase = await sessionClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
  if (error) return { error: authErrorMessage(error), values, step: "code" };
  redirectTo("/recuperar/nueva");
}

/** Sets the new password at the end of a reset. Ends every other session of the account. */
export async function setNewPassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer) {
    return {
      error:
        "El enlace o el código ya no sirve: venció o ya se usó. Pida un correo nuevo para restablecer su contraseña.",
    };
  }
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password, {
    repeat: String(formData.get("repeat") ?? ""),
    email: viewer.email,
  });
  if (problem) return { error: problem };

  const supabase = await sessionClient();
  // A reset session has not passed the second step; an account with a factor
  // passes it here, or Auth refuses the change (insufficient_aal).
  const security = await getSecurity();
  if (security?.factorId && security.aal !== "aal2") {
    const failure = await passSecondStep(security.factorId, formData.get("code"));
    if (failure) return failure;
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(error) };
  return {
    ok: "Listo: su contraseña cambió. Cerramos las demás sesiones abiertas de su cuenta, en cualquier aparato; ahí tendrá que ingresar de nuevo.",
    step: "done",
  };
}

// ── E-mail confirmation ─────────────────────────────────────────────────────

/**
 * Verifies an e-mail link (the token hash in /auth/confirm) when the person
 * presses the button on that page. Never on the page load itself: mail
 * scanners open links, and a one-time token must survive them.
 */
export async function confirmEmailLink(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");
  if (!isTokenHash(tokenHash) || !isLinkType(type)) {
    return { error: authErrorMessage({ code: "otp_expired" }), data: { type: String(type) } };
  }
  const supabase = await sessionClient();
  // Exactly these two keys: anything else in the body makes Auth refuse it.
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return { error: authErrorMessage(error), data: { type } };

  if (type === "recovery") redirectTo("/recuperar/nueva");
  if (type === "email_change") redirectTo("/cuenta");
  redirectTo(await settleSignUp(data.user?.user_metadata));
}

/** The 6-digit code from the confirmation e-mail. */
export async function confirmEmailCode(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = field(formData, "email").toLowerCase();
  const code = normaliseCode(formData.get("code"));
  const values = { email };
  if (!code) return { error: "El código tiene 6 dígitos.", values, step: "confirm-email" };
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) return { error: authErrorMessage(error), values, step: "confirm-email" };
  redirectTo(await settleSignUp(data.user?.user_metadata));
}

/** Sends the confirmation e-mail again, within Auth's limit of one a minute. */
export async function resendConfirmation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = field(formData, "email").toLowerCase();
  const values = { email };
  if (!isEmail(email)) return { error: "Escriba un correo válido.", values, step: "confirm-email" };
  const supabase = await sessionClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmUrl() },
  });
  if (error) return { error: authErrorMessage(error), values, step: "confirm-email" };
  return {
    ok: `Le enviamos otro correo a ${email}. Si no le llega, puede pedir otro en ${waitText(60)}.`,
    values,
    step: "confirm-email",
  };
}

// ── Password change while signed in ─────────────────────────────────────────

export async function changePassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer?.email) return { error: "Inicie sesión para continuar." };
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!current) return { error: "Escriba su contraseña actual." };
  const problem = passwordProblem(password, {
    repeat: String(formData.get("repeat") ?? ""),
    email: viewer.email,
  });
  if (problem) return { error: problem };
  if (!(await passwordIsCorrect(viewer.email, current))) {
    return { error: "La contraseña actual no coincide." };
  }
  const supabase = await sessionClient();
  // `current_password` is ignored unless the project requires it; sent so the
  // form keeps working if that setting is switched on.
  const { error } = await supabase.auth.updateUser({ password, current_password: current });
  if (error) return { error: authErrorMessage(error) };
  return {
    ok: "Listo: su contraseña cambió. Cerramos las demás sesiones abiertas de su cuenta.",
  };
}

// ── Second factor ───────────────────────────────────────────────────────────

/**
 * Challenges and verifies one code for `factorId`, inside the database's
 * limit on wrong codes. Returns the failure as form state, or null on success
 * (the session then carries aal2 and its cookie is rewritten).
 */
async function passSecondStep(factorId: string, raw: unknown): Promise<ActionState | null> {
  const code = normaliseCode(raw);
  if (!code) return { error: "Escriba los 6 dígitos que muestra su aplicación de autenticación." };
  const api = await sessionApi();
  const status = await api.mfaAttemptStatus();
  if (status.locked) {
    return {
      error: `${authErrorMessage({ code: "mfa_locked" })} Podrá intentarlo de nuevo en ${waitText(status.retry_after_seconds)}.`,
    };
  }
  const supabase = await sessionClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (!error) return null;
  if (error.code === "mfa_verification_failed") {
    const after = await api.mfaRecordFailure();
    const tail = after.locked
      ? ` Por seguridad, espere ${waitText(after.retry_after_seconds)} antes de intentarlo de nuevo.`
      : ` Le quedan ${after.attempts_left} ${after.attempts_left === 1 ? "intento" : "intentos"} antes de una pausa de 15 minutos.`;
    return { error: `${authErrorMessage(error)}${tail}` };
  }
  return { error: authErrorMessage(error) };
}

/** The second step at sign-in. */
export async function verifySecondFactor(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const security = await getSecurity();
  if (!security) redirectTo("/ingresar");
  const next = returnTo(formData);
  if (security.aal === "aal2") redirectTo(next);
  if (!security.factorId) redirectTo(next);
  const failure = await passSecondStep(security.factorId, formData.get("code"));
  if (failure) return failure;
  redirectTo(next);
}

/** Starts enrolling an authenticator app: a new secret, shown as a QR code and as text. */
export async function startEnrolment(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const security = await getSecurity();
  if (!security) return { error: "Inicie sesión para continuar." };
  if (security.factorId && security.aal !== "aal2") {
    return { error: authErrorMessage({ code: "insufficient_aal" }) };
  }
  const supabase = await sessionClient();
  try {
    // Half-finished attempts from an earlier visit go first, or Auth refuses a
    // second one with the same name.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const stale of factors?.all ?? []) {
      if (stale.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Yuntera ${new Date().toISOString().slice(0, 16)}`,
      issuer: "Yuntera",
    });
    if (error || data.type !== "totp") return { error: authErrorMessage(error) };
    return {
      step: "scan",
      data: { factorId: data.id, qr: qrDataUri(data.totp.uri), secret: data.totp.secret },
    };
  } catch (error) {
    if (isRedirect(error)) throw error;
    console.error(error);
    return { error: GENERIC_ERROR };
  }
}

/** Finishes enrolling with the first code from the app; the session becomes aal2. */
export async function confirmEnrolment(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const factorId = field(formData, "factorId");
  const keep = { step: "scan", data: previous.data };
  if (!(await getViewer())) redirectTo("/ingresar");
  if (!/^[0-9a-f-]{36}$/i.test(factorId)) return { ...keep, error: GENERIC_ERROR };
  const failure = await passSecondStep(factorId, formData.get("code"));
  if (failure) return { ...keep, ...failure };
  const next = field(formData, "siguiente");
  // A redirect rather than a message: the new session cookie makes the page
  // behind render again anyway, and the "manage" view shows the outcome.
  redirectTo(next ? safeReturnPath(next) : "/dos-pasos?estado=activada");
}

/**
 * Removes the authenticator after a fresh code from it, so a session left open
 * on someone else's computer cannot switch the protection off. With
 * `intent=replace`, goes on to enrol a new one.
 */
export async function removeSecondFactor(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const security = await getSecurity();
  if (!security?.factorId)
    return { error: "Su cuenta no tiene la verificación en dos pasos activada." };
  const failure = await passSecondStep(security.factorId, formData.get("code"));
  if (failure) return failure;
  const supabase = await sessionClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: security.factorId });
  if (error) return { error: authErrorMessage(error) };
  // The token in the cookie still says aal2 until it is renewed.
  await supabase.auth.refreshSession();
  redirectTo(
    formData.get("intent") === "replace"
      ? "/dos-pasos?estado=cambiar"
      : "/dos-pasos?estado=quitada",
  );
}

// ── Account deletion ────────────────────────────────────────────────────────

export async function deleteAccount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer?.email) redirectTo("/ingresar?siguiente=%2Fcuenta%2Feliminar");
  if (formData.get("entiendo") !== "on") {
    return {
      error: "Marque la casilla para confirmar que entiende que esto no se puede deshacer.",
    };
  }
  const password = String(formData.get("password") ?? "");
  if (!password || !(await passwordIsCorrect(viewer.email, password))) {
    return { error: "La contraseña no coincide. Escríbala de nuevo para confirmar." };
  }
  try {
    await (await sessionApi()).deleteMyAccount();
  } catch (error) {
    if (error instanceof ApiError) return { error: error.userMessage("es-CR") };
    return { error: messageOf(error) };
  }
  // The sessions are already gone on the server; this clears the cookie.
  const supabase = await sessionClient();
  await supabase.auth.signOut({ scope: "local" });
  redirectTo("/cuenta-eliminada");
}
