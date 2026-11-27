/**
 * Which commit each web app was built from, for the console's Versiones panel.
 *
 * The commit is not a secret, but nothing needs to tell it to visitors either
 * (it says when the site last changed). So each app answers
 * `GET /api/version` only to a caller that sends `x-yuntera-version-proof`,
 * a keyed hash of AUTH_GUARD_KEY, the server-only key all four apps already
 * share; anyone else gets 404, as for an address that does not exist.
 *
 * The commit is the one value of build-commit.mjs, read once when the app
 * is built and inlined as YUNTERA_BUILD_COMMIT (next-kit/config): the
 * value given at deploy time wins, then Vercel's VERCEL_GIT_COMMIT_SHA
 * (set for a deployment from a Git connection), else unknown, and the panel
 * says so. The error reports name their release with the same value, so it
 * is also in the browser code (a commit is not a secret); this route only
 * keeps it from being listed to anyone who asks.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { commitFrom } from "../build-commit.mjs";
import { type AppName, guardKey } from "./guard";

type Env = Record<string, string | undefined>;

export const VERSION_HEADER = "x-yuntera-version-proof";

/** The proof the console sends; derived, so the key itself never travels. */
export const versionProof = (key: string) =>
  createHmac("sha256", key).update("app-version").digest("hex");

/** The commit by the one rule (build-commit.mjs), or null when nothing said. */
export function buildCommit(env: Env): string | null {
  return commitFrom(env);
}

/**
 * The commit this app was built from: the value the build inlined (written
 * out as `process.env.YUNTERA_BUILD_COMMIT` so the framework replaces it).
 */
export function builtCommit(): string | null {
  return commitFrom({ YUNTERA_BUILD_COMMIT: process.env.YUNTERA_BUILD_COMMIT });
}

function same(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** What `GET /api/version` answers. */
export function versionResponse(
  app: AppName,
  request: Request,
  env: Env,
  commit: string | null = buildCommit(env),
): Response {
  const key = guardKey(env);
  const given = request.headers.get(VERSION_HEADER) ?? "";
  if (!key.ok || !given || !same(given, versionProof(key.value))) {
    return new Response(null, { status: 404 });
  }
  return Response.json({ app, commit }, { headers: { "cache-control": "no-store" } });
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
