/**
 * Areas: parts of the API added after the first cut, one file each.
 *
 * An area file (`src/areas/<name>.ts`) exports three things:
 *   - its payload schemas and types (zod), as named exports
 *   - `errors`: a message in es-CR and en for every error code its SQL raises
 *   - `api(caller)`: its methods, built on `caller.call` / `caller.run`
 *
 * Register it here in three places: the import, `areaErrors` and `areaApi`,
 * plus an `export *` line so apps can import its types from "@yuntera/db".
 * `errors.test.ts` then checks its messages against the migrations like the
 * rest, and `createApi()` returns its methods alongside the core ones.
 */

import * as account from "./account";
import type { Caller, Messages } from "./types";

// Named rather than `export *`: every area has its own `errors` and `api`.
export {
  type AccountSecurity,
  type AuthErrorCode,
  accountSecurity,
  authErrorMessage,
  authErrors,
  type DeletionBlocker,
  type DeletionCheck,
  type DeletionResult,
  deletionBlocker,
  deletionCheck,
  deletionResult,
  type FactorReset,
  factorReset,
  type MfaAttempts,
  type MfaReservation,
  mfaAttempts,
  mfaReservation,
  retryAfterSeconds,
  type StaffSecurityRow,
  staffSecurityRow,
  waitText,
} from "./account";
export type { Caller, Messages } from "./types";

export const areaErrors = { ...account.errors } as const satisfies Messages;

export const areaApi = (caller: Caller) => ({ ...account.api(caller) });
