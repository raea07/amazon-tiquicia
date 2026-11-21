import "server-only";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sessionClient } from "./supabase";

export interface Viewer {
  id: string;
  email: string | null;
  name: string | null;
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

/** Sends visitors to sign in, and brings them back to `returnTo` afterwards. */
export async function requireViewer(returnTo: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(signInUrl(returnTo));
  return viewer;
}

export const signInUrl = (returnTo: string) =>
  `/ingresar?siguiente=${encodeURIComponent(safeReturnPath(returnTo))}` as Route;

/**
 * Only same-site paths are accepted as a return target. Without this check a
 * crafted link could bounce a shopper to another site right after they sign in.
 */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (!candidate?.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/";
  }
  return candidate;
}
