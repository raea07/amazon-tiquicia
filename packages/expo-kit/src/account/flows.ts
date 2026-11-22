/**
 * What the account screens do, step by step, with Auth and the database
 * passed in, so `flows.test.ts` runs every branch in Node. The same steps,
 * checks and words as the websites' Server Actions
 * (packages/next-kit/src/server/account-actions.ts): requestPasswordReset,
 * changePassword and deleteAccount.
 *
 * One difference: the websites count these attempts in the database first
 * (the sign-in limit, with a key only the web servers hold). An app cannot
 * hold that key, so its calls meet Auth's own per-address limits only, as
 * its sign-in already does.
 */

import { ApiError, authErrorMessage, type DeletionResult } from "@yuntera/db";
import { GENERIC_ERROR, messageOf } from "../errors";
import {
  CURRENT_PASSWORD_WRONG,
  DELETION_PASSWORD_WRONG,
  DELETION_UNTICKED,
  isEmail,
  PASSWORD_CHANGED,
  passwordProblem,
  RESET_SENT,
} from "./rules";

export interface Outcome {
  ok?: string;
  error?: string;
}

/** The subset of an Auth error these flows read. Its text is never shown. */
interface AuthFailure {
  code?: string | null;
  status?: number | null;
  name?: string;
  message?: string | null;
}

const isNetworkFailure = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ((error as AuthFailure).name === "AuthRetryableFetchError" ||
    (error as AuthFailure).name === "TypeError" ||
    /network|fetch|timeout|offline/i.test((error as AuthFailure).message ?? ""));

const NETWORK = () => messageOf(new TypeError("Network request failed"));

/**
 * Whether a password is this account's, asked of Auth on a client of its
 * own (supabase/probe.ts) so the session on the phone is not touched.
 * "offline": Auth could not be reached, which says nothing about the password;
 * "limited": Auth's limit on sign-ins was reached, which says nothing either.
 */
export type PasswordCheck = (
  email: string,
  password: string,
) => Promise<"right" | "wrong" | "offline" | "limited">;

/** Auth's own limit on sign-ins was reached: the same words as the sign-in screen. */
export const TOO_MANY_TRIES =
  "Demasiados intentos seguidos. Espere un minuto e inténtelo de nuevo.";

// ── Password reset ──────────────────────────────────────────────────────────

export interface ResetAuth {
  resetPasswordForEmail(email: string): Promise<{ error: AuthFailure | null }>;
}

/**
 * Sends the reset e-mail. Answers the same whether or not the address has an
 * account, and also when Auth's own limit on e-mails is reached: only a
 * missing connection is said as such, which tells nobody anything.
 */
export async function requestPasswordReset(auth: ResetAuth, raw: string): Promise<Outcome> {
  const email = raw.trim().toLowerCase();
  if (!isEmail(email)) return { error: "Escriba un correo válido." };
  try {
    const { error } = await auth.resetPasswordForEmail(email);
    if (error && isNetworkFailure(error)) return { error: NETWORK() };
  } catch (error) {
    if (isNetworkFailure(error)) return { error: NETWORK() };
    // Anything else still gets the same answer as success.
  }
  return { ok: RESET_SENT };
}

// ── Password change while signed in ─────────────────────────────────────────

export interface PasswordAuth {
  updateUser(attributes: {
    password: string;
    current_password?: string;
  }): Promise<{ error: AuthFailure | null }>;
}

export async function changePassword(
  input: { email: string | null; current: string; password: string; repeat: string },
  deps: { check: PasswordCheck; auth: PasswordAuth },
): Promise<Outcome> {
  if (!input.email) return { error: "Inicie sesión para continuar." };
  if (!input.current) return { error: "Escriba su contraseña actual." };
  const problem = passwordProblem(input.password, { repeat: input.repeat, email: input.email });
  if (problem) return { error: problem };
  try {
    const checked = await deps.check(input.email, input.current);
    if (checked === "offline") return { error: NETWORK() };
    if (checked === "limited") return { error: TOO_MANY_TRIES };
    if (checked === "wrong") return { error: CURRENT_PASSWORD_WRONG };
    // `current_password` is ignored unless the project requires it; sent so
    // the form keeps working if that setting is switched on (as on the web).
    const { error } = await deps.auth.updateUser({
      password: input.password,
      current_password: input.current,
    });
    if (error) return { error: isNetworkFailure(error) ? NETWORK() : authErrorMessage(error) };
    return { ok: PASSWORD_CHANGED };
  } catch (error) {
    return { error: isNetworkFailure(error) ? NETWORK() : GENERIC_ERROR };
  }
}

// ── Account deletion ────────────────────────────────────────────────────────

export interface DeletionDeps {
  check: PasswordCheck;
  /** `delete_my_account`, with the session on the phone. */
  deleteMyAccount(): Promise<DeletionResult>;
  /**
   * Removes what this app keeps of the account on the phone, beyond the
   * session: an offline queue, a saved day, a remembered shop, a cart. Its
   * failure does not stop the sign-out.
   */
  forgetDevice(): Promise<void>;
  /**
   * Removes the session from the secure store (a local sign-out: the
   * database has already ended every session). Resolves to false when the
   * store refused.
   */
  signOutDevice(): Promise<boolean>;
  /** Clears what the app holds in memory (the data cache). */
  clearMemory(): void;
}

export type DeletionOutcome = { error: string } | { deleted: DeletionResult; signedOut: boolean };

/**
 * Deletes the signed-in account, as the website's `deleteAccount`: the box
 * ticked, the password typed again and right, then `delete_my_account`;
 * afterwards nothing of the account stays on the phone.
 */
export async function deleteAccount(
  input: { email: string | null; password: string; understood: boolean },
  deps: DeletionDeps,
): Promise<DeletionOutcome> {
  if (!input.email) return { error: "Inicie sesión para continuar." };
  if (!input.understood) return { error: DELETION_UNTICKED };
  if (!input.password) return { error: DELETION_PASSWORD_WRONG };
  let checked: Awaited<ReturnType<PasswordCheck>>;
  try {
    checked = await deps.check(input.email, input.password);
  } catch (error) {
    return { error: isNetworkFailure(error) ? NETWORK() : GENERIC_ERROR };
  }
  if (checked === "offline") return { error: NETWORK() };
  if (checked === "limited") return { error: TOO_MANY_TRIES };
  if (checked === "wrong") return { error: DELETION_PASSWORD_WRONG };

  let deleted: DeletionResult;
  try {
    deleted = await deps.deleteMyAccount();
  } catch (error) {
    if (error instanceof ApiError) return { error: error.userMessage("es-CR") };
    return { error: messageOf(error) };
  }
  try {
    await deps.forgetDevice();
  } catch {
    // Nothing in it is a session; the sign-out below still runs.
  }
  let signedOut = false;
  try {
    signedOut = await deps.signOutDevice();
  } catch {
    signedOut = false;
  }
  deps.clearMemory();
  return { deleted, signedOut };
}
