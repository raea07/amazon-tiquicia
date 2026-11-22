/**
 * The second step of a sign-in, for an account that has an authenticator app
 * (a time-based code, as on the website's /ingresar/verificar). Pure rules
 * and words; session.tsx calls Auth and the database, forms.tsx draws the
 * screen. No React Native import, so `second-step.test.ts` runs in Node.
 *
 * What Auth and the database do, the same as the website's action
 * (packages/next-kit/src/server/account-actions.ts, `passSecondStep`):
 *
 * 1. `mfa_reserve_attempt` counts the attempt before the code leaves, so a
 *    burst of tries cannot outrun the database's limit (5 wrong codes, then a
 *    pause of up to 15 minutes). A null `attempt_id` means the pause is on:
 *    the code is not sent at all.
 * 2. `auth.mfa.challengeAndVerify` checks the code; on success supabase-js
 *    stores the new session, which now says "aal2".
 * 3. `mfa_attempt_succeeded`, with that session, gives the reservation back.
 *
 * The code is held only in the form's state while it is typed: never stored,
 * never logged, and cleared after every attempt.
 */

import type { Session } from "@supabase/supabase-js";
import { authErrorMessage, type MfaReservation, waitText } from "@yuntera/db";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decodes a JWT's payload (base64url JSON). No signature check: the server checks the token. */
function payloadOf(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  const text = part.replace(/-/g, "+").replace(/_/g, "/");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text) {
    const index = BASE64.indexOf(char);
    if (index < 0) continue; // padding
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  try {
    const json = decodeURIComponent(
      bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""),
    );
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Whether this session still has to pass the second step: the account has a
 * verified factor and the token says only "aal1". The same reading as
 * supabase-js's getAuthenticatorAssuranceLevel, done here without a call so
 * the app never treats such a session as signed in, not even for a moment.
 */
export function needsSecondStep(session: Pick<Session, "access_token" | "user"> | null): boolean {
  if (!session) return false;
  const verified = (session.user.factors ?? []).some((factor) => factor.status === "verified");
  if (!verified) return false;
  return payloadOf(session.access_token)?.aal !== "aal2";
}

/** The verified authenticator to ask the code for. */
export function totpFactorId(session: Pick<Session, "user"> | null): string | null {
  const factor = (session?.user.factors ?? []).find(
    (candidate) => candidate.status === "verified" && candidate.factor_type === "totp",
  );
  return factor?.id ?? null;
}

/** A 6-digit code as people type it ("123 456", "123-456"), or null. As on the website. */
export function normaliseCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export const CODE_REQUIRED = "Escriba los 6 dígitos que muestra su aplicación de autenticación.";

/** The pause is on: nothing was sent. */
export function lockedMessage(reservation: Pick<MfaReservation, "retry_after_seconds">): string {
  return `${authErrorMessage({ code: "mfa_locked" })} Podrá intentarlo de nuevo en ${waitText(
    reservation.retry_after_seconds,
  )}.`;
}

/** Auth said no. A wrong code says how many tries are left, or that the pause began. */
export function refusedMessage(
  error: { code?: string | null },
  reservation: Pick<MfaReservation, "locked" | "attempts_left" | "retry_after_seconds">,
): string {
  if (error.code !== "mfa_verification_failed") return authErrorMessage(error);
  const tail = reservation.locked
    ? ` Por seguridad, espere ${waitText(reservation.retry_after_seconds)} antes de intentarlo de nuevo.`
    : ` Le quedan ${reservation.attempts_left} ${
        reservation.attempts_left === 1 ? "intento" : "intentos"
      } antes de una pausa de 15 minutos.`;
  return `${authErrorMessage(error)}${tail}`;
}

/**
 * What the database lets a session halfway through the second step call
 * (public.check_request in 20261121082500_account_security.sql): the
 * second step's own calls. Everything else is refused with
 * second_factor_required, even the catalogue a visitor may read.
 */
export const SECOND_STEP_CALLS: ReadonlySet<string> = new Set([
  "my_security",
  "my_roles",
  "mfa_attempt_status",
  "mfa_reserve_attempt",
  "mfa_attempt_succeeded",
]);

/**
 * Whether a call is sent as a visitor (with the app's public key instead of
 * the person's token). Halfway through the second step the token would be
 * refused for anything but the second step itself, so the shop's home,
 * search and categories are read as a visitor reads them, and the screens
 * for signed-in people send the person to the code first. Personal calls
 * never go this way: the kit's personal queries wait for the second step,
 * and as a visitor they would be refused anyway.
 */
export const callsAsVisitor = (status: string, fn: string): boolean =>
  status === "secondStep" && !SECOND_STEP_CALLS.has(fn);
