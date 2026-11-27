/**
 * Which commit each web app was built from, for the console's Versiones panel.
 *
 * The commit is not a secret, but nothing needs to tell it to visitors either
 * (it says when the site last changed). So each app answers
 * `GET /api/version` only to a caller that sends `x-yuntera-version-proof`,
 * a keyed hash of AUTH_GUARD_KEY, the server-only key all four apps already
 * share; anyone else gets 404, as for an address that does not exist.
 *
 * Where the commit comes from, in this order:
 *   1. YUNTERA_BUILD_COMMIT: set by tools/dev/stack.sh for a lane, or by any
 *      deployment that is not Vercel (the output of `git rev-parse HEAD`);
 *   2. VERCEL_GIT_COMMIT_SHA: Vercel sets it on every deployment from git
 *      (one of its system environment variables, available to the server
 *      while "Automatically expose System Environment Variables" is on, the
 *      default).
 * Neither is a NEXT_PUBLIC_ value: the commit never goes into the pages.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type AppName, guardKey } from "./guard";

type Env = Record<string, string | undefined>;

export const VERSION_HEADER = "x-yuntera-version-proof";

/** The proof the console sends; derived, so the key itself never travels. */
export const versionProof = (key: string) =>
  createHmac("sha256", key).update("app-version").digest("hex");

/** The commit this server runs, or null when the deployment did not say. */
export function buildCommit(env: Env): string | null {
  const raw = (env.YUNTERA_BUILD_COMMIT || env.VERCEL_GIT_COMMIT_SHA || "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(raw) ? raw : null;
}

function same(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** What `GET /api/version` answers. */
export function versionResponse(app: AppName, request: Request, env: Env): Response {
  const key = guardKey(env);
  const given = request.headers.get(VERSION_HEADER) ?? "";
  if (!key.ok || !given || !same(given, versionProof(key.value))) {
    return new Response(null, { status: 404 });
  }
  return Response.json(
    { app, commit: buildCommit(env) },
    { headers: { "cache-control": "no-store" } },
  );
}

export type AppVersion =
  | { state: "known"; commit: string }
  | { state: "unknown" }
  | { state: "unreachable" }
  | { state: "not_configured" };

/** Asks another app which commit it runs (server side, 3 seconds at most). */
export async function fetchAppVersion(
  baseUrl: string | undefined,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<AppVersion> {
  const key = guardKey(env);
  if (!baseUrl || !key.ok) return { state: "not_configured" };
  try {
    const response = await fetchImpl(new URL("/api/version", baseUrl), {
      headers: { [VERSION_HEADER]: versionProof(key.value) },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { state: "unreachable" };
    const body = (await response.json()) as { commit?: unknown };
    return typeof body.commit === "string" && /^[0-9a-f]{7,40}$/.test(body.commit)
      ? { state: "known", commit: body.commit }
      : { state: "unknown" };
  } catch {
    return { state: "unreachable" };
  }
}
