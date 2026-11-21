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

import * as notifications from "./notifications";
import type { Caller, Messages } from "./types";

export {
  type ChannelChoicesInput,
  COMMERCIAL_CONSENT_VERSION,
  type DeadLetters,
  type NotificationRow,
  type NotificationSettings,
  type SellerNotificationSettings,
  type ShopChannelChoicesInput,
} from "./notifications";
export type { Caller, Messages } from "./types";

export const areaErrors = { ...notifications.errors } as const satisfies Messages;

export const areaApi = (caller: Caller) => ({ ...notifications.api(caller) });
