import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@yuntera/db";
import * as Network from "expo-network";
import { AppState, Platform } from "react-native";

/**
 * Reading and caching API data.
 *
 * TanStack Query keeps each answer under a key, shows it at once next time and
 * refreshes it in the background. The drivers' and warehouse apps will later
 * wrap this same client in a persisted provider and queue mutations while
 * offline (see docs/research/expo-native-apps.md §4f); nothing here has to
 * change for that: pass the client from `createQueryClient()` to
 * `PersistQueryClientProvider` instead of `DataProvider`.
 */

/** Only a request that never arrived is worth repeating; a refusal is an answer. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && error instanceof ApiError && error.code === "network";
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
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
