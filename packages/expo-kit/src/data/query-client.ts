import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@yuntera/db";
import * as Network from "expo-network";
import { AppState, Platform } from "react-native";

/**
 * Reading and caching API data.
 *
 * TanStack Query keeps each answer under a key, shows it at once next time and
 * refreshes it in the background. Changes are never held while offline (see
 * `networkMode` below); an app that wants an offline queue keeps one of its
 * own that the person can see, as the drivers' app does (lib/driver.tsx).
 */

/** The `detail` of the network error a read gets when it never answered in time. */
export const READ_TIMED_OUT = "read_timed_out";

/**
 * Only a request that never arrived is worth repeating; a refusal is an
 * answer. A read that timed out is not repeated by itself: the person was
 * already kept waiting, and the screen offers "Intentar de nuevo".
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return (
    failureCount < 2 &&
    error instanceof ApiError &&
    error.code === "network" &&
    error.detail !== READ_TIMED_OUT
  );
}

/** What an app may set on its cache (see `AppProviders`). */
export interface QueryClientOptions {
  /**
   * How long a read may go unanswered before it counts as failed, in
   * milliseconds. Without it a read that never answers leaves a screen
   * loading, or its pull spinner turning, with no way to ask again. Reads
   * only: a change is never cut short, since the database may still apply it.
   */
  readTimeoutMs?: number;
}

/** The cache's per-query settings that `useApiQuery` reads (TanStack's `meta`). */
export interface ReadMeta {
  readTimeoutMs?: number;
}

/**
 * The read, or a network error (detail READ_TIMED_OUT) once `ms` passed
 * without an answer. The request itself is left to finish; its answer is
 * not used. Without `ms`, the read as it is.
 */
export function withReadTimeout<T>(read: Promise<T>, ms: number | undefined): Promise<T> {
  if (!ms || ms <= 0) return read;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError("network", { detail: READ_TIMED_OUT })), ms);
  });
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

/** The time limit a query's `meta` carries, if any. */
export const readTimeoutOf = (meta: unknown): number | undefined => {
  const value = (meta as ReadMeta | undefined)?.readTimeoutMs;
  return typeof value === "number" ? value : undefined;
};

export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  const meta: ReadMeta | undefined = options.readTimeoutMs
    ? { readTimeoutMs: options.readTimeoutMs }
    : undefined;
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        // Every read of this cache: useApiQuery and the listing apply it.
        meta: meta as Record<string, unknown> | undefined,
      },
      mutations: {
        retry: false,
        // TanStack's default ('online') holds a mutation while the phone is
        // offline and sends it by itself when the network comes back, long
        // after the person gave up on it: a team member removed or an
        // invitation sent without anyone pressing anything. A change is sent
        // when pressed or not at all; offline it fails at once with the
        // network message, and nothing waits. (The drivers' app keeps its own
        // explicit queue for deliveries: lib/driver.tsx.)
        networkMode: "always",
      },
    },
  });
}

let wired = false;

/**
 * Tells the cache when the app comes back to the screen and when the phone
 * has a network, so it refreshes at the right moments. Browsers report both
 * themselves; on a phone they come from AppState and expo-network. Neither
 * proves the API is reachable: a failed request is still the truth.
 */
export function wireAppLifecycle(): void {
  if (wired || Platform.OS === "web") return;
  wired = true;
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener("change", (state) =>
      setFocused(state === "active"),
    );
    return () => subscription.remove();
  });
  onlineManager.setEventListener((setOnline) => {
    const subscription = Network.addNetworkStateListener((state) =>
      setOnline(state.isConnected !== false),
    );
    Network.getNetworkStateAsync()
      .then((state) => setOnline(state.isConnected !== false))
      .catch(() => undefined);
    return () => subscription.remove();
  });
}
