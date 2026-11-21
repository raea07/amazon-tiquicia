/**
 * What the drivers' app sends later when there is no signal: arriving at a
 * stop, a failed delivery, and position reports. A delivery against the
 * customer's code is never queued: the code is checked on the server, so it
 * needs the connection there and then (the stop screen says so), and the
 * code is never written to the phone.
 *
 * The queue itself is packages/expo-kit/src/offline/queue.ts. This file says
 * what each kind of entry means to the API, and when a refusal really means
 * "already done" (an arrival sent twice because its first answer was lost).
 */

import { type Api, ApiError } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import {
  createOfflineQueue,
  type FlushResult,
  type QueueEntry,
  type SendOutcome,
} from "@yuntera/expo-kit/offline";
import { sessionStorage } from "@yuntera/expo-kit/supabase";
import type { FailureReason, QueuedStopAction } from "./route";

export interface ArrivePayload {
  stopId: string;
}
export interface FailPayload {
  stopId: string;
  reason: FailureReason;
  lat: number | null;
  lng: number | null;
}
export interface PositionPayload {
  lat: number;
  lng: number;
  accuracy: number | null;
}

/**
 * Kept in the encrypted app storage (the same arrangement as the session),
 * because positions and stop ids are the driver's personal data. Each entry
 * belongs to the account that queued it and is never sent as anyone else.
 */
export const outbox = createOfflineQueue({
  store: sessionStorage,
  key: "yuntera-ruta.outbox.v1",
  // All three are safe to send again when it is unknown whether the first
  // try arrived: the database refuses a second arrival or failure for the
  // same stop (handled below as "already done"), and a position only
  // overwrites the last one.
  repeatable: () => true,
  // A route lasts a day; what is older than that no longer means anything.
  maxAgeMs: 36 * 60 * 60 * 1000,
  failedMessage:
    "No pudimos enviar esta acción. Revise la parada y, si hace falta, regístrela de nuevo.",
});

/**
 * A request with no answer after this long counts as "no signal". On a phone
 * in a dead zone a request can hang for a minute before the system gives up;
 * the driver should not wait that long at a door.
 */
export const ANSWER_WITHIN_MS = 20_000;

/** Rejects with a network error when the answer takes too long. The request itself may still arrive. */
export function timed<T>(request: Promise<T>, ms = ANSWER_WITHIN_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError("network")), ms);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

export const isNoAnswer = (error: unknown) =>
  !(error instanceof ApiError) ||
  error.code === "network" ||
  (error.status !== null && error.status >= 500);

/** The stop's status on the server now, or null if it cannot be read. */
async function statusOnServer(api: Api, stopId: string) {
  const day = await timed(api.driverToday());
  for (const route of day.routes) {
    const stop = route.stops.find((candidate) => candidate.stop_id === stopId);
    if (stop) return stop.status;
  }
  return null;
}

/** Sends one entry and says how it went. Never throws. */
export function sendWith(api: Api) {
  return async (entry: QueueEntry): Promise<SendOutcome> => {
    try {
      if (entry.kind === "arrive") {
        const { stopId } = entry.payload as ArrivePayload;
        try {
          await timed(api.driverArrive(stopId));
          return { result: "done" };
        } catch (error) {
          if (isNoAnswer(error)) return { result: "offline" };
          // Refused: if the stop is no longer pending, the arrival is moot
          // (it was recorded already, or the stop was closed since).
          const status = await statusOnServer(api, stopId);
          if (status && status !== "pending") return { result: "done" };
          return { result: "rejected", message: messageOf(error) };
        }
      }
      if (entry.kind === "fail") {
        const payload = entry.payload as FailPayload;
        try {
          await timed(api.driverFailStop(payload));
          return { result: "done" };
        } catch (error) {
          if (isNoAnswer(error)) return { result: "offline" };
          const status = await statusOnServer(api, payload.stopId);
          if (status === "failed") return { result: "done" };
          if (status === "delivered") {
            return {
              result: "rejected",
              message:
                "Esa parada ya figuraba como entregada, así que no se registró como no entregada.",
            };
          }
          return { result: "rejected", message: messageOf(error) };
        }
      }
      if (entry.kind === "position") {
        const { lat, lng, accuracy } = entry.payload as PositionPayload;
        try {
          await timed(api.driverReportPosition(lat, lng, accuracy ?? undefined));
        } catch (error) {
          if (isNoAnswer(error)) return { result: "offline" };
          // Not on a route any more: nothing for the driver to do about it.
        }
        return { result: "done" };
      }
      return { result: "rejected", message: "No reconocemos esta acción." };
    } catch (error) {
      // Re-reading the route after a refusal failed for lack of signal.
      return isNoAnswer(error)
        ? { result: "offline" }
        : { result: "rejected", message: messageOf(error) };
    }
  };
}

let api: Api | null = null;

/** Called by the app when a driver is signed in (and with null when not). */
export function connectOutbox(next: Api | null): void {
  api = next;
}

/** Sends what is waiting, if a driver is signed in. Also used by the location task. */
export function flushOutbox(): Promise<FlushResult | null> {
  return api ? outbox.flush(sendWith(api)) : Promise.resolve(null);
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

/** The queued entries that change how a stop reads. */
export function queuedStopActions(entries: readonly QueueEntry[]): QueuedStopAction[] {
  return entries.flatMap((entry): QueuedStopAction[] => {
    if (entry.status === "rejected") return [];
    if (entry.kind === "arrive") {
      return [{ kind: "arrive", stopId: (entry.payload as ArrivePayload).stopId }];
    }
    if (entry.kind === "fail") {
      const payload = entry.payload as FailPayload;
      return [{ kind: "fail", stopId: payload.stopId, reason: payload.reason }];
    }
    return [];
  });
}
