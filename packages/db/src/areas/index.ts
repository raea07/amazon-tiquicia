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
import { followupsApi, followupsErrors } from "./followups";
import { integrityApi, integrityErrors } from "./integrity";
import { invoicingApi, invoicingErrors } from "./invoicing";
import { limitsApi, limitsErrors } from "./limits";
import { listingsApi, listingsErrors } from "./listings";
import * as notifications from "./notifications";
import { paymentsApi, paymentsErrors } from "./payments";
import * as peoplePayouts from "./people-payouts";
import { photosApi, photosErrors } from "./photos";
import { sellerListingsApi, sellerListingsErrors } from "./seller-listings";
import type { Caller, Messages } from "./types";
import { webFollowupsApi, webFollowupsErrors } from "./web-followups";

// The listings, integrity, limits, followups, payments, invoicing and seller-listings areas name their exports uniquely, so
// they are star-exported. The other areas export `errors` and `api`, which
// would clash with each other, so their schemas and types are re-exported by
// name.
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
export * from "./followups";
export * from "./integrity";
export * from "./invoicing";
export * from "./limits";
export * from "./listings";
export {
  type ChannelChoicesInput,
  COMMERCIAL_CONSENT_VERSION,
  type DeadLetters,
  type NotificationRow,
  type NotificationSettings,
  type SellerNotificationSettings,
  type ShopChannelChoicesInput,
} from "./notifications";
export * from "./payments";
export type {
  AuditTrailEntry,
  CreatedPayoutRun,
  OpsDriverRecord,
  OpsStaffMember,
  OpsWarehouseTeam,
  PayoutBlock,
  PayoutDetailRequest,
  PayoutPreview,
  PayoutRun,
  PayoutRunSummary,
  PayoutStatus,
  SaveDriverInput,
  SellerPayoutDetails,
  SellerPayouts,
  WarehouseRole,
} from "./people-payouts";
export * from "./photos";
export * from "./seller-listings";
export type { Caller, Messages } from "./types";
export * from "./web-followups";

export const areaErrors = {
  ...peoplePayouts.errors,
  ...listingsErrors,
  ...account.errors,
  ...notifications.errors,
  ...photosErrors,
  ...integrityErrors,
  ...limitsErrors,
  ...followupsErrors,
  ...webFollowupsErrors,
  ...paymentsErrors,
  ...invoicingErrors,
  ...sellerListingsErrors,
} as const satisfies Messages;

export const areaApi = (caller: Caller) => ({
  ...peoplePayouts.api(caller),
  ...listingsApi(caller),
  ...account.api(caller),
  ...notifications.api(caller),
  ...photosApi(caller),
  ...integrityApi(caller),
  ...limitsApi(caller),
  ...webFollowupsApi(caller),
  ...paymentsApi(caller),
  ...invoicingApi(caller),
  // After listings and limits: some of its methods replace theirs (see seller-listings.ts).
  ...sellerListingsApi(caller),
  // Last: some of its methods replace core ones (see followups.ts).
  ...followupsApi(caller),
});
