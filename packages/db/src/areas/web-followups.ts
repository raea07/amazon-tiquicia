/**
 * The apps' own limit on sign-in, sign-up, account e-mails, e-mailed codes,
 * asking for the current password again and session refreshes (finding WEB-2
 * of the review of 21 November 2026).
 *
 * The apps call these as a visitor, with keyed hashes of the visitor's address
 * and of the e-mail typed; see packages/next-kit/src/server/auth-guard.ts.
 *
 * SQL: supabase/migrations/20261121083300_web_followups.sql.
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

/** What each limit covers. The numbers live in `private.auth_limit_rule`. */
export const authLimitAction = z.enum(["sign_in", "sign_up", "email", "code", "reauth", "refresh"]);
export type AuthLimitAction = z.infer<typeof authLimitAction>;

/** A keyed hash as the database stores it: 64 lowercase hex digits. */
const digest = z.string().regex(/^[0-9a-f]{64}$/);

export const authLimitReservation = z.object({
  /** Null when the limit is reached: the call to Auth must not be made. */
  attempt_id: z.uuid().nullable(),
  /** How long until the limit lets this visitor or account try again; 0 when allowed. */
  retry_after_seconds: z.number().int().min(0),
});
export type AuthLimitReservation = z.infer<typeof authLimitReservation>;

export interface AuthLimitRequest {
  action: AuthLimitAction;
  /** Keyed hash of the visitor's address, or null when no trustworthy address is known. */
  addressHash: string | null;
  /** Keyed hash of the account (the e-mail typed), or null for a refresh. */
  accountHash: string | null;
  /** This browser signed in to that account before: the account's own limits are skipped. */
  knownDevice?: boolean;
  /**
   * The apps' proof that they are the caller (a keyed hash only the apps can
   * compute). Checked once the project keeps its digest in Vault.
   */
  caller?: string | null;
}

export const webFollowupsErrors = {
  invalid_limit_request: {
    "es-CR": "No pudimos procesar ese intento de ingreso. Recargue la página e inténtelo de nuevo.",
    en: "We could not process that sign-in attempt. Reload the page and try again.",
  },
  auth_limit_caller: {
    "es-CR": "No pudimos procesar ese intento de ingreso. Inténtelo de nuevo en un momento.",
    en: "We could not process that sign-in attempt. Try again in a moment.",
  },
} as const satisfies Messages;

export const webFollowupsApi = ({ call, run }: Caller) => ({
  /** Counts one attempt before it goes to Auth, or says how long to wait. */
  authLimitReserve: (input: AuthLimitRequest) => {
    digest.nullable().parse(input.addressHash);
    digest.nullable().parse(input.accountHash);
    digest.nullish().parse(input.caller);
    return call(
      "auth_limit_reserve",
      {
        p_action: authLimitAction.parse(input.action),
        p_address_hash: input.addressHash ?? undefined,
        p_account_hash: input.accountHash ?? undefined,
        p_known_device: input.knownDevice ?? false,
        p_caller: input.caller ?? undefined,
      },
      authLimitReservation,
    );
  },
  /** The attempt succeeded (right password or code, accepted refresh): it does not count as a failure. */
  authLimitRelease: (attemptId: string) => run("auth_limit_release", { p_attempt_id: attemptId }),
});
