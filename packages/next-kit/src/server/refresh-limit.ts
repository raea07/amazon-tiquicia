import { visitorApi } from "./visitor-api";

/**
 * A `fetch` for the session client that counts each token refresh against the
 * visitor's address in the apps' own limit before it goes to Auth (WEB-2).
 * Auth limits `/auth/v1/token` by address, and every refresh comes from the
 * app's server, so without this one visitor sending made-up session cookies
 * could spend the refreshes of everyone served from that server.
 *
 * Refused: an answer like Auth's own limit (429, `over_request_rate_limit`),
 * so the session client gives up at once and drops that session, as it would
 * for Auth's. When the limit cannot be asked, the refresh goes ahead: a fault
 * in the limit must not sign everybody out. Without a trustworthy visitor
 * address (`addressHash` null) nothing is counted, rather than putting every
 * visitor in one bucket.
 */
export function limitedAuthFetch(addressHash: string | null): typeof fetch {
  return async (input, init) => {
    if (addressHash && isRefresh(input)) {
      const api = visitorApi();
      try {
        const reservation = await api?.authLimitReserve({
          action: "refresh",
          addressHash,
          accountHash: null,
        });
        if (reservation && reservation.attempt_id === null) {
          return new Response(
            JSON.stringify({
              code: "over_request_rate_limit",
              msg: `Too many session refreshes from this address. Try again after ${reservation.retry_after_seconds} seconds.`,
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }
      } catch (error) {
        console.error("Refresh limit could not be asked; refreshing anyway", error);
      }
    }
    return fetch(input, init);
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
