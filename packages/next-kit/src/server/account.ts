import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import qrcode from "qrcode-generator";
import { cache } from "react";
import { safeReturnPath } from "../paths";
import { getViewer, whileSessionLives } from "./session";
import { apiEnv, SESSION_COOKIE, sessionApi, sessionClient } from "./supabase";

/**
 * Server-side helpers for the account-security screens: where e-mail links
 * point, what the current session has passed, and checks that need Auth.
 */

/** This app's own address, for links in e-mails (`redirectTo`). Must be on Auth's allow-list. */
export function confirmUrl(): string | undefined {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  return site ? `${site.replace(/\/$/, "")}/auth/confirm` : undefined;
}

export interface Security {
  /** Assurance level of the current session: "aal2" once the second step is passed. */
  aal: "aal1" | "aal2";
  /** The verified authenticator, when the account has one. */
  factorId: string | null;
  /** Active staff while `require_staff_mfa` is on. */
  mfaRequired: boolean;
  isStaff: boolean;
}

/**
 * What the current session has passed, read fresh: the factors from Auth
 * (`GET /user`; the copy inside the cookie can be stale) and the staff rule
 * from the database. Memoised per request. Null for visitors.
 */
export const getSecurity = cache(async (): Promise<Security | null> => {
  if (!(await getViewer())) return null;
  const supabase = await sessionClient();
  const [{ data: factors }, mine] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    whileSessionLives((await sessionApi()).mySecurity()),
  ]);
  const verified = factors?.totp.find((factor) => factor.status === "verified");
  return {
    aal: mine.aal === "aal2" ? "aal2" : "aal1",
    factorId: verified?.id ?? null,
    mfaRequired: mine.mfa_required,
    isStaff: mine.is_staff,
  };
});

/**
 * Where a session must go before anything else, or null when it may continue:
 * the second step when the account has a factor and has not passed it, and,
 * where `enforceRequirement` is set (the console), enrolment for staff who
 * must have a factor and have none.
 */
export async function secondStepPath(
  returnTo: string,
  enforceRequirement = false,
): Promise<string | null> {
  const security = await getSecurity();
  if (!security) return null;
  const next = encodeURIComponent(safeReturnPath(returnTo));
  if (security.factorId && security.aal !== "aal2") return `/verificar?siguiente=${next}`;
  if (enforceRequirement && security.mfaRequired && !security.factorId) {
    return `/dos-pasos?siguiente=${next}`;
  }
  return null;
}

/**
 * Checks a password without touching the browser's session: signs in on a
 * throwaway client with no cookies, then ends that extra session at once.
 * Used before changing the password and before deleting the account.
 */
export async function passwordIsCorrect(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<boolean> {
  const { url, key } = apiEnv();
  const probe: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  if (error || !data.session) return false;
  await probe.auth.signOut({ scope: "local" });
  return true;
}

/**
 * An SVG QR code for an otpauth address, drawn on our own server: the secret
 * inside it is never sent to a QR-code service or any other third party.
 */
export function qrDataUri(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ── Recovery sessions ───────────────────────────────────────────────────────

/**
 * A session that came from a reset link or code may set a new password without
 * the current one; no other session may. Two things prove it, both checked on
 * the server: an HttpOnly cookie naming the session, written by the action that
 * verified the recovery link or code, and the session's own sign-in methods
 * (`amr`, signed by Auth) showing an e-mailed code or link used within the
 * last half hour. Someone at a browser left signed in therefore meets the
 * current-password form on the account page, never this one.
 */
const RECOVERY_COOKIE = "yt-recuperacion";
const RECOVERY_WINDOW_SECONDS = 30 * 60;

/** The claims inside an access token, unverified: only for tokens Auth just handed us. */
function claimsOf(accessToken: string): Record<string, unknown> {
  const payload = accessToken.split(".")[1] ?? "";
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/** After a recovery link or code was verified: marks this session as one. */
export async function markRecoverySession(accessToken: string | undefined): Promise<void> {
  const sessionId = accessToken ? claimsOf(accessToken).session_id : undefined;
  if (typeof sessionId !== "string") return;
  (await cookies()).set(RECOVERY_COOKIE, sessionId, {
    ...SESSION_COOKIE,
    maxAge: RECOVERY_WINDOW_SECONDS,
  });
}

/** Whether the signed-in session came from a recovery link or code, recently. */
export async function isRecoverySession(): Promise<boolean> {
  const marker = (await cookies()).get(RECOVERY_COOKIE)?.value;
  if (!marker) return false;
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as { session_id?: unknown; amr?: unknown } | undefined;
  if (error || !claims || claims.session_id !== marker) return false;
  const now = Date.now() / 1000;
  const methods = Array.isArray(claims.amr) ? claims.amr : [];
  return methods.some((entry: unknown) => {
    const { method, timestamp } = (entry ?? {}) as { method?: unknown; timestamp?: unknown };
    return (
      (method === "otp" || method === "recovery" || method === "magiclink") &&
      typeof timestamp === "number" &&
      now - timestamp < RECOVERY_WINDOW_SECONDS
    );
  });
}

const RECOVERY_DONE = "hecho";

/**
 * The new password is set: the session is an ordinary one from now on. The
 * marker says so for a few minutes, so the page behind the form (which renders
 * again because the cookie changed) shows the outcome instead of the form.
 */
export async function clearRecoverySession(): Promise<void> {
  (await cookies()).set(RECOVERY_COOKIE, RECOVERY_DONE, { ...SESSION_COOKIE, maxAge: 5 * 60 });
}

/** Whether this browser has just finished a reset. */
export async function recoveryJustFinished(): Promise<boolean> {
  return (await cookies()).get(RECOVERY_COOKIE)?.value === RECOVERY_DONE;
}

// ── Ended sessions ──────────────────────────────────────────────────────────

/**
 * GET /auth/salir in every app: where a page sends a session the database
 * says has ended. Clears the cookie only when Auth agrees the session is gone,
 * so a link to this address cannot sign anyone out, and goes to sign-in.
 */
export async function endedSession(): Promise<Response> {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getUser();
  // No user from Auth, for a reason other than Auth being unreachable.
  const unreachable = error && (error.status === undefined || error.status >= 500);
  const gone = !data.user && !unreachable;
  if (gone) await supabase.auth.signOut({ scope: "local" });
  // A relative address keeps the browser on the host it came from.
  return new Response(null, { status: 303, headers: { location: gone ? "/ingresar" : "/" } });
}
