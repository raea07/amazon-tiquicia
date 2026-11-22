/**
 * Everything the driver's screens share: the day's routes (from the API, or
 * the copy saved on the phone when there is no signal), the queue of actions
 * waiting to be sent, position sharing, and the actions themselves.
 *
 * The database checks every call; what is decided here is only what the
 * phone shows and when it sends.
 */

import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { ApiError, type DriverDay } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { type Access, useAccess, useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import {
  createSnapshotCache,
  type QueueEntry,
  type QueueSnapshot,
  useQueue,
} from "@yuntera/expo-kit/offline";
import { appStorage } from "@yuntera/expo-kit/supabase";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { askNoticePermission, noticePermission } from "./notice";
import {
  type ArrivePayload,
  connectOutbox,
  type FailPayload,
  flushOutbox,
  isNoAnswer,
  isRefusal,
  outbox,
  queuedStopActions,
  timed,
} from "./outbox";
import {
  type FailureReason,
  findStop,
  keptOnPhone,
  needsTracking,
  type QueuedStopAction,
  refusalMessage,
  type ShownRoute,
  withQueued,
} from "./route";
import {
  askLocationPermission,
  currentPoint,
  isTracking,
  locationPermission,
  type Permission,
  startTracking,
  stopTracking,
} from "./tracking";

/**
 * Whether our explanation screen (/ubicacion) must come before sharing: the
 * location permission is not granted yet, or, on Android 13 and later, the
 * phone has not yet been asked whether the app may show the sharing notice.
 */
export async function needsExplanation(): Promise<boolean> {
  return (
    (await locationPermission()) !== "granted" || (await noticePermission()) === "undetermined"
  );
}

/** A saved day older than this is removed, read or not. */
export const SAVED_DAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The routes still to drive, kept on the phone so they stay readable without
 * signal (keptOnPhone in route.ts says what is kept). They hold customers'
 * names, phones and addresses. They live in the app's ordinary storage, which
 * the operating system encrypts with the device and keeps to this app (the
 * kit ships no cipher; docs/02-architecture/decisions.md §28 and
 * docs/05-security-compliance/privacy.md say why), and they are removed at
 * sign-out, at a change of account, when access is lost and after a day.
 */
const savedDay = createSnapshotCache<DriverDay>({
  store: appStorage,
  key: "yuntera-ruta.day.v1",
  maxAgeMs: SAVED_DAY_MAX_AGE_MS,
});

const DAY_KEY = ["driver-today"] as const;
const RETRY_EVERY_MS = 15_000;
/** Refusals come in bursts (every queued action of a suspended driver): check access at most this often. */
const RECHECK_ACCESS_EVERY_MS = 10_000;
/** How long an arrival or a failed delivery waits for the server before it is left queued. */
const WAIT_FOR_ANSWER_MS = 4_000;

export type Tracking = "off" | "starting" | "on" | "denied" | "gps_off" | "failed";

export type DeliverOutcome =
  | { kind: "delivered"; routeCompleted: boolean }
  | { kind: "refused"; message: string; clearPin: boolean }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export interface DriverValue {
  /** The routes as shown, with unsent actions applied. Null while nothing is known yet. */
  routes: ShownRoute[] | null;
  driverName: string | null;
  loading: boolean;
  /** Could not load and nothing is saved: the error to show. */
  error: unknown;
  retry(): void;
  refreshing: boolean;
  /** When the routes on screen are the copy saved on the phone: when it was saved. */
  savedAt: number | null;
  /** The API did not answer the last time the phone tried. */
  offline: boolean;
  /** Reads the day again now (a stop screen does when it opens). */
  refresh(): void;
  queue: QueueSnapshot;
  /** What waited for the signal has just all been sent. */
  drained: boolean;
  sendNow(): Promise<void>;
  dismiss(id: string): Promise<void>;
  tracking: Tracking;
  permission: Permission | null;
  /** Starts sharing; asks for the permission first if it has not been asked. */
  shareLocation(): Promise<Tracking>;
  startRoute(routeId: string): Promise<string | null>;
  arrive(stopId: string): Promise<{ queued: boolean; error?: string }>;
  fail(
    stopId: string,
    reason: FailureReason,
  ): Promise<{ queued: boolean; error?: string; routeCompleted: boolean }>;
  deliver(input: {
    stopId: string;
    pin: string;
    recipientName: string;
    codCollectedMinor: number;
  }): Promise<DeliverOutcome>;
  /** Stops left for later ("Dejar pendiente y seguir"), only on this phone. */
  later: ReadonlySet<string>;
  leaveForLater(stopId: string): void;
  /** Resolves to false when the phone could not be signed out (the kit's signOutDevice). */
  signOut(): Promise<boolean>;
}

const DriverContext = createContext<DriverValue | null>(null);

/** Access as the navigator should treat it: offline with a saved day counts as allowed. */
export interface DriverAccess {
  access: Access;
  /** Signed in, roles unreadable (no signal), and this account's day is saved here. */
  offlineAllowed: boolean;
  /** Still finding out whether a day is saved. */
  deciding: boolean;
}

const AccessContext = createContext<DriverAccess>({
  access: "checking",
  offlineAllowed: false,
  deciding: true,
});

export function DriverProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const { viewer, api, reloadRoles, supabase } = session;
  const access = useAccess("driver");
  const client = useQueryClient();
  const userId = viewer?.id ?? null;
  const [tracking, setTracking] = useState<Tracking>("off");
  const [permission, setPermission] = useState<Permission | null>(null);

  // An expired day goes at start-up whoever is signed in, even nobody.
  useEffect(() => {
    void savedDay.prune();
  }, []);

  // The day saved on this phone for this account, read once per sign-in
  // (the read removes another account's) and kept in step with each save.
  const [saved, setSaved] = useState<{
    owner: string | null;
    day: DriverDay | null;
    savedAt: number | null;
    loaded: boolean;
  }>({ owner: null, day: null, savedAt: null, loaded: false });
  useEffect(() => {
    let active = true;
    setSaved({ owner: userId, day: null, savedAt: null, loaded: userId === null });
    if (!userId) return;
    void savedDay.load(userId).then((snapshot) => {
      if (!active) return;
      setSaved({
        owner: userId,
        day: snapshot?.value ?? null,
        savedAt: snapshot?.savedAt ?? null,
        loaded: true,
      });
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const savedLoaded = saved.loaded && saved.owner === userId;
  const offlineAllowed = access === "unavailable" && savedLoaded && saved.day !== null;
  const inside = access === "allowed" || offlineAllowed;
  const accessValue = useMemo<DriverAccess>(
    () => ({ access, offlineAllowed, deciding: access === "unavailable" && !savedLoaded }),
    [access, offlineAllowed, savedLoaded],
  );

  // Access is read at sign-in and when the app comes back to the screen, but
  // during a route the screen stays on and the app never leaves it. So any
  // refusal from the server (a suspended driver's calls are all refused, a
  // position report included) is a reason to read it again; a lost access
  // then stops everything below.
  const lastRecheck = useRef(0);
  const recheckAccess = useCallback(() => {
    const now = Date.now();
    if (now - lastRecheck.current < RECHECK_ACCESS_EVERY_MS) return;
    lastRecheck.current = now;
    void reloadRoles();
  }, [reloadRoles]);
  const noteRefusal = useCallback(
    (error: unknown) => {
      if (isRefusal(error)) recheckAccess();
    },
    [recheckAccess],
  );

  // The queue belongs to whoever is signed in as a driver; nobody else's is shown or sent.
  useEffect(() => {
    void outbox.setOwner(inside ? userId : null);
    connectOutbox(inside ? api : null, noteRefusal);
    if (inside) void flushOutbox();
  }, [inside, userId, api, noteRefusal]);
  const queue = useQueue(outbox);

  const day = useApiQuery(DAY_KEY, (a) => timed(a.driverToday()), {
    personal: true,
    enabled: inside,
    refetchInterval: (query) => (query.state.status === "error" ? RETRY_EVERY_MS : 60_000),
  });

  // Nothing of the day stays on the phone, and nothing more is sent from it.
  const forgetDay = useCallback(async (owner: string | null) => {
    await stopTracking();
    setTracking("off");
    setSaved((current) => ({ ...current, day: null, savedAt: null }));
    await savedDay.clear();
    // The server refuses whatever a driver without access sends; positions
    // never outlive the session.
    await outbox.discard(
      (entry) => entry.kind === "position" || (owner !== null && entry.owner === owner),
    );
  }, []);

  // A good answer is saved for offline use and proves the connection is back.
  // It also carries the driver's status, read every minute: a driver Central
  // has suspended stops seeing customers' details and sharing the position
  // at once, while the roles are read again.
  const suspended = day.data !== undefined && day.data.driver.status !== "active";
  useEffect(() => {
    if (!day.data || !userId || !inside) return;
    if (day.data.driver.status !== "active") {
      void forgetDay(userId);
      void reloadRoles();
      return;
    }
    const kept = keptOnPhone(day.data);
    void savedDay.save(userId, kept);
    setSaved({ owner: userId, day: kept, savedAt: Date.now(), loaded: true });
    if (access === "unavailable") void reloadRoles();
  }, [day.data, userId, inside, access, reloadRoles, forgetDay]);

  // A day kept past its limit is not shown, even with the app left open.
  useEffect(() => {
    if (saved.savedAt === null) return;
    const left = saved.savedAt + SAVED_DAY_MAX_AGE_MS - Date.now();
    const timer = setTimeout(
      () => {
        setSaved((current) => ({ ...current, day: null, savedAt: null }));
        void savedDay.prune();
      },
      Math.max(0, left),
    );
    return () => clearTimeout(timer);
  }, [saved.savedAt]);
  // A refusal of the day itself (no longer a driver) also means reading access again.
  useEffect(() => {
    if (day.isError) noteRefusal(day.error);
  }, [day.isError, day.error, noteRefusal]);

  // Lost access: the same. The account's unsent actions go too, since the
  // server would refuse them.
  // The day read before access was lost goes from memory too: when Central
  // makes the driver active again, their unfinished stops are on a new route
  // (the database hands them back to dispatch), so the old one must not show.
  useEffect(() => {
    if (access !== "denied") return;
    void forgetDay(userId);
    client.removeQueries({ queryKey: ["user", userId ?? "anonymous", ...DAY_KEY] });
  }, [access, userId, forgetDay, client]);

  // Signed out (or the session ended on the server). Not the "signed out"
  // state a start-up without signal can pass through (offline-session.ts):
  // only an actual SIGNED_OUT event clears the day saved on the phone.
  useEffect(() => {
    if (access === "signedOut") {
      void stopTracking();
      setTracking("off");
    }
  }, [access]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") void forgetDay(null);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, forgetDay]);

  // Actions the server has just taken stay applied until the day is read
  // again, so a stop does not flick back to "Pendiente" in between.
  const [justSent, setJustSent] = useState<Array<{ action: QueuedStopAction; at: number }>>([]);
  const previous = useRef<readonly QueueEntry[]>([]);
  useEffect(() => {
    const gone = previous.current.filter(
      (entry) =>
        entry.status !== "rejected" &&
        entry.owner === queue.owner &&
        !queue.entries.some((current) => current.id === entry.id),
    );
    previous.current = queue.entries;
    const actions = queuedStopActions(gone);
    if (actions.length === 0) return;
    const at = Date.now();
    setJustSent((list) => [...list, ...actions.map((action) => ({ action, at }))]);
    // Whoever sent them (a screen, the timer, the location task): read the day again.
    void client.invalidateQueries({ queryKey: ["user", queue.owner ?? "anonymous", ...DAY_KEY] });
  }, [queue.entries, queue.owner, client]);

  const shownDay = suspended ? null : (day.data ?? (saved.owner === userId ? saved.day : null));
  const routes = useMemo(() => {
    if (!shownDay) return null;
    const recent = justSent
      .filter((item) => item.at > day.dataUpdatedAt)
      .map((item) => item.action);
    return withQueued(shownDay, [...recent, ...queuedStopActions(queue.entries)]);
  }, [shownDay, queue.entries, justSent, day.dataUpdatedAt]);
  const noAnswer = day.isError && isNoAnswer(day.error);
  const offline =
    noAnswer ||
    !onlineManager.isOnline() ||
    (queue.lastFlush?.offline === true && queue.pending > 0) ||
    offlineAllowed;

  // "Todo enviado" is worth saying only after actions waited for the signal.
  const [drained, setDrained] = useState(false);
  const waitedForSignal = useRef(false);
  const stopActionsWaiting = queue.entries.some(
    (entry) => entry.status !== "rejected" && entry.kind !== "position",
  );
  useEffect(() => {
    if (stopActionsWaiting && queue.lastFlush?.offline) waitedForSignal.current = true;
    else if (!stopActionsWaiting && waitedForSignal.current) {
      waitedForSignal.current = false;
      setDrained(true);
    }
  }, [stopActionsWaiting, queue.lastFlush]);
  useEffect(() => {
    if (!drained) return;
    const timer = setTimeout(() => setDrained(false), 30_000);
    return () => clearTimeout(timer);
  }, [drained]);

  // ── Sending what waits ──
  const refreshDay = useCallback(
    () => client.invalidateQueries({ queryKey: ["user", userId ?? "anonymous", ...DAY_KEY] }),
    [client, userId],
  );
  const refresh = useCallback(() => void refreshDay(), [refreshDay]);
  const sendNow = useCallback(async () => {
    const result = await flushOutbox();
    if (result && (result.sent > 0 || result.rejected > 0)) await refreshDay();
    if (result && !result.offline && access === "unavailable") void reloadRoles();
  }, [refreshDay, access, reloadRoles]);

  useEffect(() => {
    if (!inside || queue.pending === 0) return;
    const timer = setInterval(() => void sendNow(), RETRY_EVERY_MS);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void sendNow();
    });
    const online = onlineManager.subscribe((isOnline) => {
      if (isOnline) void sendNow();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
      online();
    };
  }, [inside, queue.pending, sendNow]);

  // ── Position sharing ──
  const routeNeedsTracking = routes ? needsTracking(routes) : null;

  useEffect(() => {
    if (!inside) return;
    void locationPermission().then(setPermission);
    // Still running from before (the app's JavaScript reloaded): show it as on.
    void isTracking().then((running) => running && setTracking("on"));
  }, [inside]);

  // The route ended (every stop closed, here or on the server): stop sharing.
  // Sign-out and lost access stop it too (above, and in signOut).
  useEffect(() => {
    if (routeNeedsTracking === false) {
      void stopTracking();
      setTracking((current) => (current === "on" || current === "starting" ? "off" : current));
    }
  }, [routeNeedsTracking]);

  const shareLocation = useCallback(async (): Promise<Tracking> => {
    setTracking("starting");
    let allowed = await locationPermission();
    if (allowed === "undetermined") allowed = await askLocationPermission();
    setPermission(allowed);
    // Android 13+: the notice shown while the position is shared needs its
    // own permission, asked once, right here (the explanation screen says so).
    // A "no" does not stop the sharing; only the notice stays hidden.
    if (allowed === "granted" && (await noticePermission()) === "undetermined") {
      await askNoticePermission();
    }
    const started = allowed === "granted" ? await startTracking() : "denied";
    setTracking(started);
    return started;
  }, []);

  // ── Actions ──
  const startRoute = useCallback(
    async (routeId: string) => {
      try {
        await timed(api.driverStartRoute(routeId));
      } catch (error) {
        noteRefusal(error);
        return isNoAnswer(error)
          ? "Para iniciar la ruta necesita señal: Central tiene que saber que salió. Intente de nuevo en un momento."
          : messageOf(error);
      }
      await refreshDay();
      return null;
    },
    [api, refreshDay, noteRefusal],
  );

  const queueAndSend = useCallback(
    async (kind: "arrive" | "fail", payload: ArrivePayload | FailPayload) => {
      try {
        const entry = await outbox.enqueue(kind, payload);
        // Wait a little for the answer; with a weak signal the action stays
        // queued and goes on being sent, and the driver does not wait at the door.
        const result = await Promise.race([
          flushOutbox(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_FOR_ANSWER_MS)),
        ]);
        const left = outbox.snapshot().entries.find((candidate) => candidate.id === entry.id);
        if (left?.status === "rejected") {
          // Shown on the screen that made it, so it need not wait in the list.
          await outbox.dismiss(entry.id);
          return { queued: false, error: left.message };
        }
        if (!left || (result && (result.sent > 0 || result.rejected > 0))) await refreshDay();
        return { queued: left !== undefined };
      } catch (error) {
        return { queued: false, error: messageOf(error) };
      }
    },
    [refreshDay],
  );

  const arrive = useCallback(
    (stopId: string) => queueAndSend("arrive", { stopId }),
    [queueAndSend],
  );

  const fail = useCallback(
    async (stopId: string, reason: FailureReason) => {
      const point = await currentPoint();
      const result = await queueAndSend("fail", {
        stopId,
        reason,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
      });
      if (result.error || result.queued) return { ...result, routeCompleted: false };
      // Sent: the refreshed day says whether that was the route's last open stop.
      const fresh = client.getQueryData<DriverDay>(["user", userId ?? "anonymous", ...DAY_KEY]);
      const found = fresh ? findStop(withQueued(fresh, []), stopId) : null;
      return { ...result, routeCompleted: found?.route.status === "completed" };
    },
    [queueAndSend, client, userId],
  );

  const deliver = useCallback<DriverValue["deliver"]>(
    async (input) => {
      // An arrival still waiting goes first, so the server sees them in order.
      if (outbox.snapshot().pending > 0) {
        const sent = await flushOutbox();
        if (sent?.offline) return { kind: "offline" };
      }
      const point = await currentPoint();
      try {
        const result = await timed(
          api.driverCompleteStop({
            stopId: input.stopId,
            pin: input.pin,
            recipientName: input.recipientName,
            codCollectedMinor: input.codCollectedMinor,
            lat: point?.lat ?? null,
            lng: point?.lng ?? null,
          }),
        );
        await refreshDay();
        if (!result.ok) {
          return {
            kind: "refused",
            message: refusalMessage(result),
            clearPin: result.error === "wrong_pin" || result.error === "pin_locked",
          };
        }
        return { kind: "delivered", routeCompleted: result.route_completed };
      } catch (error) {
        if (isNoAnswer(error)) return { kind: "offline" };
        noteRefusal(error);
        // A first try whose answer was lost may have delivered it already.
        if (error instanceof ApiError && error.code === "invalid_stop_state") {
          await refreshDay();
          const fresh = client.getQueryData<DriverDay>(["user", userId ?? "anonymous", ...DAY_KEY]);
          const found = fresh ? findStop(withQueued(fresh, []), input.stopId) : null;
          if (found?.stop.status === "delivered") {
            return { kind: "delivered", routeCompleted: found.route.status === "completed" };
          }
        }
        return { kind: "error", message: messageOf(error) };
      }
    },
    [api, refreshDay, client, userId, noteRefusal],
  );

  const [later, setLater] = useState<ReadonlySet<string>>(new Set());
  const leaveForLater = useCallback(
    (stopId: string) => setLater((current) => new Set([...current, stopId])),
    [],
  );
  const lastUser = useRef(userId);
  useEffect(() => {
    if (lastUser.current !== userId) setLater(new Set());
    lastUser.current = userId;
  }, [userId]);

  const signOut = useCallback(async () => {
    await stopTracking();
    setTracking("off");
    await savedDay.clear();
    await outbox.discard((entry) => entry.kind === "position");
    await outbox.setOwner(null);
    connectOutbox(null);
    return session.signOut();
  }, [session]);

  const value: DriverValue = {
    routes,
    driverName: shownDay?.driver.full_name ?? viewer?.name ?? null,
    loading: !routes && (day.isPending || !savedLoaded),
    error: !routes && day.isError ? day.error : null,
    retry: () => void day.refetch(),
    refresh,
    refreshing: day.isRefetching,
    savedAt: !day.data && saved.day ? saved.savedAt : null,
    offline,
    queue,
    drained,
    sendNow,
    dismiss: (id) => outbox.dismiss(id),
    tracking,
    permission,
    shareLocation,
    startRoute,
    arrive,
    fail,
    deliver,
    later,
    leaveForLater,
    signOut,
  };

  return (
    <AccessContext.Provider value={accessValue}>
      <DriverContext.Provider value={value}>{children}</DriverContext.Provider>
    </AccessContext.Provider>
  );
}

export function useDriver(): DriverValue {
  const value = useContext(DriverContext);
  if (!value) throw new Error("useDriver must be used inside <DriverProvider>.");
  return value;
}

export const useDriverAccess = () => useContext(AccessContext);
