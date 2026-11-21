import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import qrcode from "qrcode-generator";
import { cache } from "react";
import { safeReturnPath } from "../paths";
import { getViewer } from "./session";
import { apiEnv, sessionApi, sessionClient } from "./supabase";

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
    (await sessionApi()).mySecurity(),
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
export async function passwordIsCorrect(email: string, password: string): Promise<boolean> {
  const { url, key } = apiEnv();
  const probe: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
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
