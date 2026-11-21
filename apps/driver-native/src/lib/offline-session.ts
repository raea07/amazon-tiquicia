/**
 * Keeps a driver signed in through a start-up without signal.
 *
 * An access token lasts about an hour. When the app starts after that with no
 * connection, supabase-js cannot refresh it: `getSession()` answers "no
 * session" with a retryable network error, and the first auth event says the
 * same, although the session is still in storage and will refresh as soon as
 * the signal returns. Read as "signed out", that would show the sign-in
 * screen (which needs signal) and hide the route saved on the phone, which is
 * exactly when the driver needs it.
 *
 * So, in this app only, a session that is still stored when supabase-js
 * reports none counts as signed in. Nothing is trusted that the server would
 * not check again: every call still carries the token, an expired token is
 * refused, and the first refresh that the server itself rejects removes the
 * stored session and signs the driver out (supabase-js does that, with a
 * SIGNED_OUT event). Only a refresh that could not reach the server is
 * treated this way.
 *
 * The kit's SessionProvider is shared by the four apps and is left as it is;
 * this wraps the one client this app uses, before the provider reads it.
 */

import { isAuthRetryableFetchError, type Session } from "@supabase/supabase-js";

/** The parts of `supabase.auth` this touches. */
export interface AuthLike {
  getSession(): Promise<{ data: { session: Session | null }; error: unknown }>;
  onAuthStateChange(
    callback: (event: string, session: Session | null) => void | Promise<void>,
  ): unknown;
}

/** A stored session as supabase-js writes it, or null if what is stored is not one. */
export function parseStoredSession(text: string | null): Session | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<Session> | null;
    if (
      value &&
      typeof value.access_token === "string" &&
      typeof value.refresh_token === "string" &&
      typeof value.user?.id === "string"
    ) {
      return value as Session;
    }
  } catch {
    // Not a session.
  }
  return null;
}

const WRAPPED = Symbol.for("yuntera-ruta.offline-session");

/**
 * Wraps `getSession` and `onAuthStateChange` of one client so a session kept
 * in storage, which could not be refreshed for lack of signal, still counts.
 * `readStored` returns the stored session (null when there is none).
 */
export function keepSessionWithoutSignal(
  auth: AuthLike,
  readStored: () => Promise<Session | null>,
): void {
  const marked = auth as AuthLike & { [WRAPPED]?: true };
  if (marked[WRAPPED]) return;
  marked[WRAPPED] = true;

  const getSession = auth.getSession.bind(auth);
  auth.getSession = async () => {
    const result = await getSession();
    if (result.data.session || !isAuthRetryableFetchError(result.error)) return result;
    const stored = await readStored().catch(() => null);
    return stored ? { data: { session: stored }, error: null } : result;
  };

  const onAuthStateChange = auth.onAuthStateChange.bind(auth);
  auth.onAuthStateChange = (callback) =>
    onAuthStateChange(async (event, session) => {
      // The first event of a start-up whose refresh could not reach the
      // server says "no session"; supabase-js has kept it in storage, and
      // removes it only when the server itself rejects it.
      if (event === "INITIAL_SESSION" && session === null) {
        const stored = await readStored().catch(() => null);
        return callback(event, stored);
      }
      return callback(event, session);
    });
}
