/**
 * What each kind of queued driver action means to the API, and when a
 * refusal really means "already done" (an arrival sent twice because its
 * first answer was lost). Pure: no React Native import, so `send.test.ts`
 * runs it against a fake API. The queue itself is
 * packages/expo-kit/src/offline/queue.ts; outbox.ts puts the two together.
 */

import { type Api, ApiError } from "@yuntera/db";
import type { QueueEntry, SendOutcome } from "@yuntera/expo-kit/offline";
import { type FailureReason, type QueuedStopAction, reasonTitle } from "./route";

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
  /** When the phone read it, in milliseconds since 1970 (the queue's time if absent). */
  at?: number;
}

/** The calls the queue makes. */
export type DriverCalls = Pick<
  Api,
  "driverArrive" | "driverFailStop" | "driverReportPosition" | "driverToday"
>;

/**
 * How long an entry may wait. A position is worth sending only while it is
 * recent: an old one shows Central a place the driver left long ago (the
 * server keeps the newest it has, by when it was read). An arrival or a
 * failure still matters for the rest of the day; the database takes the
 * time it happened for up to a day (action_time_too_old after that).
 */
export const POSITION_MAX_AGE_MS = 5 * 60 * 1000;
export const STOP_ACTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * When the action happened: the moment it was queued (the driver pressed the
 * button then, with or without signal), or for a position the moment the
 * phone read it. The database checks the bounds and keeps the time it
 * received it as well.
 */
export const happenedAt = (entry: QueueEntry) =>
  new Date((entry.payload as Partial<PositionPayload>).at ?? entry.createdAt);
export const ageLimit = (entry: QueueEntry) =>
  entry.kind === "position" ? POSITION_MAX_AGE_MS : STOP_ACTION_MAX_AGE_MS;

/** A stop action that never went out is reported, not dropped: Central has to hear about it. */
export const expiredMessage = (entry: QueueEntry) =>
  entry.kind === "position"
    ? null
    : "Esta acción quedó sin enviar más de un día y ya no se enviará. Avise a Central qué pasó en esa parada.";

/**
 * A queued action for a stop that is no longer on any of the driver's routes.
 * When a driver stops being active the database hands their unfinished stops
 * to a new route for dispatch, so an arrival or a failure saved before that
 * reaches nobody: Central has to hear what happened there.
 */
export const MOVED_STOP_MESSAGE =
  "Esta parada ya no está en sus rutas: Central la pasó a otra ruta, así que esto no se registró. Avise a Central qué pasó en ella.";

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

/** The server answered, and the answer was no. */
export const isRefusal = (error: unknown): error is ApiError =>
  error instanceof ApiError && !isNoAnswer(error);

/** The stop as the server has it now, or null if it is not on the driver's day. */
async function stopOnServer(api: DriverCalls, stopId: string) {
  const day = await timed(api.driverToday());
  for (const route of day.routes) {
    const stop = route.stops.find((candidate) => candidate.stop_id === stopId);
    if (stop) return stop;
  }
  return null;
}

export interface SendDeps {
  /** The Spanish words for an error (the kit's messageOf). */
  messageOf(error: unknown): string;
  /**
   * Told about every refusal from the server, so the app can check again
   * whether the driver still has access (a suspended driver's calls are all
   * refused, a position report included).
   */
  onRefused?(error: ApiError): void;
}

/** Sends one entry and says how it went. Never throws. */
export function sendWith(api: DriverCalls, deps: SendDeps) {
  const { messageOf, onRefused = () => undefined } = deps;
  return async (entry: QueueEntry): Promise<SendOutcome> => {
    try {
      if (entry.kind === "arrive") {
        const { stopId } = entry.payload as ArrivePayload;
        try {
          await timed(api.driverArrive(stopId, happenedAt(entry)));
          return { result: "done" };
        } catch (error) {
          if (!isRefusal(error)) return { result: "offline" };
          onRefused(error);
          // Refused: if the stop is no longer pending, the arrival is moot
          // (it was recorded already, or the stop was closed since).
          const stop = await stopOnServer(api, stopId);
          if (!stop) return { result: "rejected", message: MOVED_STOP_MESSAGE };
          if (stop.status !== "pending") return { result: "done" };
          return { result: "rejected", message: messageOf(error) };
        }
      }
      if (entry.kind === "fail") {
        const payload = entry.payload as FailPayload;
        try {
          await timed(api.driverFailStop({ ...payload, occurredAt: happenedAt(entry) }));
          return { result: "done" };
        } catch (error) {
          if (!isRefusal(error)) return { result: "offline" };
          onRefused(error);
          const stop = await stopOnServer(api, payload.stopId);
          if (!stop) return { result: "rejected", message: MOVED_STOP_MESSAGE };
          if (stop.status === "failed") {
            // The same failure sent twice (its first answer was lost): done.
            if (stop.failure_reason === payload.reason) return { result: "done" };
            // Someone (another screen, Central) recorded it first, with another reason.
            return {
              result: "rejected",
              message: `Esta parada ya estaba registrada como no entregada, con el motivo «${reasonTitle(
                stop.failure_reason,
              )}». No se cambió.`,
            };
          }
          if (stop.status === "delivered") {
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
          await timed(api.driverReportPosition(lat, lng, accuracy ?? undefined, happenedAt(entry)));
        } catch (error) {
          if (!isRefusal(error)) return { result: "offline" };
          // Not on a route any more, or no longer an active driver: nothing
          // to show for a position, but the app checks the driver's access.
          onRefused(error);
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
