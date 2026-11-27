import { ApiError } from "@yuntera/db";

/**
 * The database answers null when a staff text held the customer's delivery
 * code: nothing was written, and the refusal is on the audit trail. Used by
 * every door that writes a text the customer reads (Casos and Atención).
 */
export function refusedForCode<T>(result: T | null): T {
  if (result === null) throw new ApiError("note_contains_code");
  return result;
}
