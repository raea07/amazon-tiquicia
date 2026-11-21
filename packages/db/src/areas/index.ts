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

import { listingsApi, listingsErrors } from "./listings";
import * as peoplePayouts from "./people-payouts";
import { photosApi, photosErrors } from "./photos";
import type { Caller, Messages } from "./types";

// The listings area names its exports uniquely, so it is star-exported. The
// people-payouts area exports `errors` and `api`, which would clash with any
// other area that does the same, so its types are re-exported by name.
export * from "./listings";
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
export type { Caller, Messages } from "./types";

export const areaErrors = {
  ...peoplePayouts.errors,
  ...listingsErrors,
  ...photosErrors,
} as const satisfies Messages;

export const areaApi = (caller: Caller) => ({
  ...peoplePayouts.api(caller),
  ...listingsApi(caller),
  ...photosApi(caller),
});
