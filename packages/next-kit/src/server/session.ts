import "server-only";
import { ApiError, type Roles } from "@yuntera/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { signInPath } from "../paths";
import { sessionApi, sessionClient } from "./supabase";

export interface Viewer {
  id: string;
  email: string | null;
  name: string | null;
}

type RedirectTarget = Parameters<typeof redirect>[0];

/** `redirect()` to a path built at run time; each app's route types cannot know it. */
export function redirectTo(path: string): never {
  redirect(path as RedirectTarget);
}

/**
 * The signed-in user, or null. The token's signature is verified against the
 * auth server's published keys (`getClaims`) — a cookie is never trusted on its
 * own word. Memoised per request so several components can ask without
 * repeating the work. Reads cookies: call only inside a <Suspense> boundary.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const metadata = (claims.user_metadata ?? {}) as { full_name?: unknown };
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    name: typeof metadata.full_name === "string" ? metadata.full_name : null,
  };
});

/**
 * Sends visitors to sign in, and brings them back to `returnTo` afterwards.
 * A session that has not yet passed the account's second step goes to that
 * step first (the database refuses it anything else in any case).
 */
export async function requireViewer(returnTo: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirectTo(signInPath(returnTo));
  const { secondStepPath } = await import("./account");
  const step = await secondStepPath(returnTo);
  if (step) redirectTo(step);
  return viewer;
}

/**
 * What the signed-in person may act as: staff role, shops, driver, warehouses.
 * Read from the database on every request — never from the token — so removing
 * someone's role takes effect at once. This decides what the screens show; the
 * database decides again, independently, on every call.
 */
export const getRoles = cache(async (): Promise<Roles | null> => {
  if (!(await getViewer())) return null;
  return whileSessionLives((await sessionApi()).myRoles());
});

/**
 * The database refuses a token whose session has ended (signed out elsewhere,
 * password changed, factor reset, account deleted) with `session_ended`, even
 * while the token itself has not expired. The per-request checks pass such a
 * session to /auth/salir, which clears its cookie, instead of failing the page.
 */
export async function whileSessionLives<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && error.code === "session_ended") redirectTo("/auth/salir");
    throw error;
  }
}

export async function requireRoles(returnTo: string): Promise<Roles> {
  const roles = await getRoles();
  if (!roles) redirectTo(signInPath(returnTo));
  return roles;
}
