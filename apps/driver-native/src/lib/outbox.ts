/**
 * What the drivers' app sends later when there is no signal: arriving at a
 * stop, a failed delivery, and position reports. A delivery against the
 * customer's code is never queued: the code is checked on the server, so it
 * needs the connection there and then (the stop screen says so), and the
 * code is never written to the phone.
 *
 * The queue itself is packages/expo-kit/src/offline/queue.ts; what each kind
 * of entry means to the API is send.ts.
 */

import type { Api, ApiError } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { createOfflineQueue, type FlushResult } from "@yuntera/expo-kit/offline";
import { appStorage } from "@yuntera/expo-kit/supabase";
import { ageLimit, expiredMessage, type PositionPayload, sendWith } from "./send";

export {
  ANSWER_WITHIN_MS,
  type ArrivePayload,
  type FailPayload,
  isNoAnswer,
  isRefusal,
  type PositionPayload,
  queuedStopActions,
  timed,
} from "./send";

/**
 * Kept in the app's ordinary storage, which the operating system encrypts
 * with the device and keeps to this app (the kit ships no cipher). It is
 * rewritten with every position, and the location task writes it while the
 * screen is locked. Entries hold stop ids, failure reasons and the driver's
 * positions, never a customer's name, phone or address (the screens look
 * those up in the day). Each entry belongs to the account that queued it and
 * is never sent as anyone else: positions go at sign-out, all of an
 * account's entries go when it loses access or another account signs in on
 * the phone, and every entry has an age limit (send.ts).
 */
export const outbox = createOfflineQueue({
  store: appStorage,
  key: "yuntera-ruta.outbox.v1",
  // All three are safe to send again when it is unknown whether the first
  // try arrived: the database refuses a second arrival or failure for the
  // same stop (handled in send.ts as "already done"), and a position only
  // overwrites the last one.
  repeatable: () => true,
  // A position goes stale in minutes and is then dropped; an arrival or a
  // failure waits a day (as long as the database takes the time it happened),
  // and is then reported, not dropped.
  maxAgeMs: ageLimit,
  expiredMessage,
  failedMessage:
    "No pudimos enviar esta acción. Revise la parada y, si hace falta, regístrela de nuevo.",
});

let api: Api | null = null;
let onRefused: (error: ApiError) => void = () => undefined;

/** Called by the app when a driver is signed in (and with null when not). */
export function connectOutbox(next: Api | null, refused?: (error: ApiError) => void): void {
  api = next;
  onRefused = refused ?? (() => undefined);
}

/** Sends what is waiting, if a driver is signed in. Also used by the location task. */
export function flushOutbox(): Promise<FlushResult | null> {
  return api
    ? outbox.flush(sendWith(api, { messageOf, onRefused: (error) => onRefused(error) }))
    : Promise.resolve(null);
}

/** A position from the phone: replaces any position still waiting, then tries to send. */
export async function reportPosition(point: PositionPayload): Promise<void> {
  if (outbox.snapshot().owner === null) return;
  try {
    await outbox.enqueue("position", point, { coalesce: "position" });
  } catch {
    return; // signed out in the meantime
  }
  void flushOutbox();
}
