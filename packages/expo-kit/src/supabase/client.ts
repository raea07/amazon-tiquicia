import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { sessionStorage } from "./session-storage";

/**
 * The public settings an app is built with. Both are public by design: the
 * publishable key only identifies the project, and every call is checked by
 * the database's grants and row-level security. No app holds a privileged key.
 */
export interface PublicEnv {
  supabaseUrl: string;
  supabaseKey: string;
}

/**
 * Reads the settings an app was built with. Each app passes its own
 * `process.env.EXPO_PUBLIC_*` values, written out literally, because that is
 * the form Expo inlines into the bundle at build time.
 */
export function publicEnv(values: { url?: string; key?: string }): PublicEnv {
  if (!values.url || !values.key) {
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. Copy .env.example to .env.local.",
    );
  }
  return { supabaseUrl: values.url, supabaseKey: values.key };
}

let client: SupabaseClient | undefined;
let refreshSubscription: { remove(): void } | undefined;

/** One client per app, created on first use. */
export function getSupabase(env: PublicEnv): SupabaseClient {
  if (client) return client;
  client = createClient(env.supabaseUrl, env.supabaseKey, {
    auth: {
      storage: sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      // A phone has no address bar for a sign-in link to land in.
      detectSessionInUrl: false,
    },
  });

  // On a phone, refresh the session only while the app is on screen; calls
  // made in the background (a location task) refresh an expired token
  // themselves before they are sent. Browsers manage this on their own.
  if (Platform.OS !== "web" && !refreshSubscription) {
    const current = client;
    refreshSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void current.auth.startAutoRefresh();
      else void current.auth.stopAutoRefresh();
    });
  }
  return client;
}
