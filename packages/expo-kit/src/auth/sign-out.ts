import type { SupabaseClient } from "@supabase/supabase-js";

type Auth = Pick<SupabaseClient["auth"], "signOut">;

/**
 * Signs this phone out, whatever the network does.
 *
 * A global sign-out (the web's default) revokes every session on the server,
 * but supabase-js removes the stored session only after that request
 * succeeds. With no connection, or a 5xx from the auth server, it returns an
 * error instead of throwing and keeps the person signed in. In that case the
 * session is removed locally (scope "local" removes it before it tries the
 * request), so the phone is always signed out when this resolves.
 */
export async function signOutDevice(auth: Auth): Promise<void> {
  let failed = false;
  try {
    const { error } = await auth.signOut();
    failed = error != null;
  } catch {
    failed = true;
  }
  if (failed) {
    try {
      await auth.signOut({ scope: "local" });
    } catch {
      // A throwing SIGNED_OUT listener: the session is already removed.
    }
  }
}
