/**
 * Lock conflicts: two changes of the same thing at the same moment.
 *
 * PostgreSQL ends one of two transactions that wait for each other with
 * SQLSTATE 40P01 (deadlock detected), and a serialisable transaction that
 * cannot be ordered with another with 40001. Either way the database rolled
 * the whole call back: nothing was changed, and the same call made again
 * normally succeeds. The hosted Data API passes the SQLSTATE through in the
 * `code` of its JSON error (HTTP 500), as the local stand-in does
 * (tools/dev-api/src/rpc.ts). Without this mapping such a call read as
 * "something went wrong on our side", which says neither that nothing
 * happened nor that trying again is safe.
 *
 * No database function raises `try_again` itself, so this area has no
 * methods; errors.test.ts counts the codes below as raised by the database.
 */

import type { Messages } from "./types";

export const lockConflictErrors = {
  try_again: {
    "es-CR":
      "Alguien más cambiaba lo mismo en ese momento, así que no se guardó nada. Inténtelo de nuevo.",
    en: "Someone else was changing the same thing at that moment, so nothing was saved. Please try again.",
  },
} as const satisfies Messages;

/** SQLSTATE codes the database answers with when it rolled a call back for a lock conflict. */
export const LOCK_CONFLICT_SQLSTATES = {
  "40P01": "try_again",
  "40001": "try_again",
} as const satisfies Record<string, keyof typeof lockConflictErrors>;

/** The error code for a lock-conflict SQLSTATE, or null for any other. */
export function lockConflictCode(sqlstate: string | null | undefined): "try_again" | null {
  if (!sqlstate || !Object.hasOwn(LOCK_CONFLICT_SQLSTATES, sqlstate)) return null;
  return LOCK_CONFLICT_SQLSTATES[sqlstate as keyof typeof LOCK_CONFLICT_SQLSTATES];
}
