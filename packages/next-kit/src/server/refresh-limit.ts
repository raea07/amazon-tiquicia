import type { Api } from "@yuntera/db";
import { visitorApi } from "./visitor-api";

/**
 * Counts token refreshes that Auth refused against the visitor's address, in
 * the apps' own limit (WEB-2). Auth limits `/auth/v1/token` by address, and
 * every refresh comes from the app's server, so without this one visitor
 * sending made-up session cookies could spend the refreshes of everyone served
 * from that server.
 *
 * Each refresh reserves an attempt before it goes to Auth; one that Auth
 * accepted gives it back, so only refused refreshes (made-up or revoked
 * tokens) count. Many honest people behind one shared address (a mobile
 * carrier's, an office's) are therefore not counted at all.
 *
 * When the limit refuses, the refresh does not reach Auth and the session
 * client is answered like Auth's own limit (429), so it gives up at once
 * rather than retrying for half a minute. It would then drop the session; the
 * cookie writers in proxy.ts and supabase.ts ask `refused()` and keep the
 * browser's cookies as they are (`keepCookiesIfLimited`). The person is just
 * not signed in for this one request, and the next request after the wait
 * renews the token as usual: nobody is signed out because someone sharing
 * their address abused it (review of 22 November 2026).
 *
 * When the limit cannot be asked, the refresh goes ahead: a fault in the limit
 * must not sign everybody out. Without a trustworthy visitor address
 * (`addressHash` null) nothing is counted, rather than putting every visitor
 * in one bucket.
 */
export interface RefreshLimiter {
  fetch: typeof fetch;
  /** Whether the limit refused a refresh in this request. */
  refused: () => boolean;
}

export function refreshLimiter(
  addressHash: string | null,
  caller: string | null = null,
  deps: {
    api?: () => Pick<Api, "authLimitReserve" | "authLimitRelease"> | null;
    fetch?: typeof fetch;
  } = {},
): RefreshLimiter {
  const send = deps.fetch ?? ((input, init) => fetch(input, init));
  const apiOf = deps.api ?? visitorApi;
  let refused = false;
  const limited: typeof fetch = async (input, init) => {
    if (!addressHash || !isRefresh(input)) return send(input, init);
    const api = apiOf();
    let attemptId: string | null = null;
    try {
      const reservation = await api?.authLimitReserve({
        action: "refresh",
        addressHash,
        accountHash: null,
        caller,
      });
      if (reservation && reservation.attempt_id === null) {
        refused = true;
        return new Response(
          JSON.stringify({
            code: "over_request_rate_limit",
            msg: `Too many refused session refreshes from this address. Try again after ${reservation.retry_after_seconds} seconds.`,
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      attemptId = reservation?.attempt_id ?? null;
    } catch (error) {
      console.error("Refresh limit could not be asked; refreshing anyway", error);
    }
    const response = await send(input, init);
    if (response.ok && attemptId && api) {
      try {
        await api.authLimitRelease(attemptId);
      } catch (error) {
        console.error("Refresh limit: an accepted refresh could not be given back", error);
      }
    }
    return response;
  };
  return { fetch: limited, refused: () => refused };
}

/**
 * A session client's `setAll` that writes nothing once the limit has refused a
 * refresh in this request: the session client would otherwise remove the
 * browser's session cookies.
 */
export function keepCookiesIfLimited<List>(
  limiter: RefreshLimiter,
  setAll: (list: List) => void,
): (list: List) => void {
  return (list) => {
    if (limiter.refused()) return;
    setAll(list);
  };
}

function isRefresh(input: Parameters<typeof fetch>[0]): boolean {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(target);
    return (
      url.pathname.endsWith("/auth/v1/token") &&
      url.searchParams.get("grant_type") === "refresh_token"
    );
  } catch {
    return false;
  }
}
