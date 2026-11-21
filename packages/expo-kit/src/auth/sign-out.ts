import type { SupabaseClient } from "@supabase/supabase-js";

type Auth = Pick<SupabaseClient["auth"], "signOut" | "getSession">;

/**
 * Signs this phone out, whatever the network does, and says whether it did.
 *
 * A global sign-out (the web's default) revokes every session on the server,
 * but supabase-js removes the stored session only after that request
 * succeeds. With no connection, or a 5xx from the auth server, it returns an
 * error instead of throwing and keeps the person signed in. In that case the
 * session is removed locally (scope "local" removes it before it tries the
 * request). A session the server has already ended (403 session_not_found)
 * is removed by the global call itself.
 *
 * Resolves to false only when the phone could not be cleared: the secure
 * store refused the deletion, so the session is still readable and
 * supabase-js has not announced SIGNED_OUT. The app then stays visibly signed
 * in and the person can try again; nothing claims a sign-out that did not
 * happen.
 */
export async function signOutDevice(auth: Auth): Promise<boolean> {
  try {
    const { error } = await auth.signOut();
    if (error == null) return true;
  } catch {
    // Either the stored session could not be removed or a SIGNED_OUT listener
    // threw after it was; the local sign-out below and the check tell which.
  }
  try {
    await auth.signOut({ scope: "local" });
    return true;
  } catch {
    // A throwing SIGNED_OUT listener (the session is gone) or a secure store
    // that refused the deletion (it is not): read back to know which.
  }
  try {
    const { data, error } = await auth.getSession();
    return error == null && data.session == null;
  } catch {
    return false;
  }
}
