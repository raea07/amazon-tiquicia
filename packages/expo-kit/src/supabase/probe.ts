import { createClient } from "@supabase/supabase-js";
import type { PasswordCheck } from "../account/flows";
import type { PublicEnv } from "./client";

/**
 * Checks a password that a person types again (before a password change or
 * a deletion), the way the websites do (`passwordIsCorrect` in
 * packages/next-kit/src/server/account.ts): a sign-in on a client of its
 * own, which keeps its session in memory only, under its own storage key, and
 * ends it at once. The app's own session, in the secure store, is not read or
 * changed, and nothing of this one is written anywhere.
 */
export function passwordCheckFor(env: PublicEnv): PasswordCheck {
  return async (email, password) => {
    const probe = createClient(env.supabaseUrl, env.supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "yuntera-password-check",
      },
    });
    const { data, error } = await probe.auth.signInWithPassword({ email, password });
    if (error) {
      const offline =
        error.name === "AuthRetryableFetchError" ||
        /network|fetch|timeout|offline/i.test(error.message ?? "");
      if (offline) return "offline";
      if (error.status === 429 || error.code === "over_request_rate_limit") return "limited";
      return "wrong";
    }
    if (!data.session) return "wrong";
    // Ends this check's session on the server too; a failure leaves a session
    // nobody holds, which expires on its own.
    await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
    return "right";
  };
}
