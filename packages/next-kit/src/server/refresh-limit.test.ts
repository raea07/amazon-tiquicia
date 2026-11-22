/**
 * WEB-2, review of 22 November 2026: the refresh limit must never sign anyone
 * out. Exercised against the real session client (@supabase/ssr over
 * @supabase/auth-js), wired the way proxy.ts and supabase.ts wire it, with an
 * expired access token in the browser's cookie: the test sees what the
 * browser would be told to do with its cookies.
 */
import { createServerClient } from "@supabase/ssr";
import { describe, expect, it, vi } from "vitest";
import { keepCookiesIfLimited, refreshLimiter } from "./refresh-limit";

vi.mock("./visitor-api", () => ({ visitorApi: () => null }));

const API = "http://127.0.0.1:9";
const ADDRESS = "a".repeat(64);
const CALLER = "c".repeat(64);
const COOKIE = "sb-127-auth-token";

function expiredCookie() {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: "header.payload.signature",
    refresh_token: "r-123",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now - 120,
    user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated" },
  };
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

const limit = (attemptId: string | null) => ({
  authLimitReserve: vi.fn(async () => ({
    attempt_id: attemptId,
    retry_after_seconds: attemptId ? 0 : 300,
  })),
  authLimitRelease: vi.fn(async () => undefined),
});

/** A session client as the apps build it; answers the cookie writes it asked for. */
async function refreshThrough(limiter: ReturnType<typeof refreshLimiter>) {
  const writes: { name: string; value: string }[] = [];
  const client = createServerClient(API, "sb_publishable_test", {
    global: { fetch: limiter.fetch },
    cookies: {
      getAll: () => [{ name: COOKIE, value: expiredCookie() }],
      setAll: keepCookiesIfLimited(limiter, (list) => {
        for (const { name, value } of list) writes.push({ name, value });
      }),
    },
  });
  const { data } = await client.auth.getSession();
  return { session: data.session, writes };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("WEB-2: the refresh limit", () => {
  it("leaves the session cookies alone when the limit refuses (people sharing an address stay signed in)", async () => {
    const api = limit(null);
    const auth = vi.fn<typeof fetch>();
    const limiter = refreshLimiter(ADDRESS, CALLER, { api: () => api, fetch: auth });
    const started = Date.now();
    const { session, writes } = await refreshThrough(limiter);
    // Not signed in for this request, at once (no half-minute of retries)…
    expect(session).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    // …but nothing reached Auth and the browser is told to remove nothing.
    expect(auth).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(limiter.refused()).toBe(true);
    expect(api.authLimitReserve).toHaveBeenCalledWith({
      action: "refresh",
      addressHash: ADDRESS,
      accountHash: null,
      caller: CALLER,
    });
  });

  it("for contrast: without the guard on the cookie writer, the same refusal removes the session", async () => {
    const api = limit(null);
    const limiter = refreshLimiter(ADDRESS, CALLER, { api: () => api, fetch: vi.fn() });
    const writes: { name: string; value: string }[] = [];
    const client = createServerClient(API, "sb_publishable_test", {
      global: { fetch: limiter.fetch },
      cookies: {
        getAll: () => [{ name: COOKIE, value: expiredCookie() }],
        setAll: (list) => {
          for (const { name, value } of list) writes.push({ name, value });
        },
      },
    });
    await client.auth.getSession();
    expect(writes.some((write) => write.name.startsWith(COOKIE) && write.value === "")).toBe(true);
  });

  it("gives an accepted refresh back, so honest refreshes are never counted", async () => {
    const api = limit("11111111-1111-4111-8111-111111111111");
    const renewed = {
      access_token: "h.p.s",
      refresh_token: "r-124",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated" },
    };
    const auth = vi.fn<typeof fetch>(async () => json(200, renewed));
    const limiter = refreshLimiter(ADDRESS, CALLER, { api: () => api, fetch: auth });
    const { writes } = await refreshThrough(limiter);
    expect(auth).toHaveBeenCalledOnce();
    expect(api.authLimitRelease).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(writes.length).toBeGreaterThan(0);
  });

  it("keeps a refresh Auth refused counted, and lets Auth's own refusal end the session", async () => {
    const api = limit("22222222-2222-4222-8222-222222222222");
    const auth = vi.fn<typeof fetch>(async () =>
      json(400, { code: "refresh_token_not_found", msg: "x" }),
    );
    const limiter = refreshLimiter(ADDRESS, CALLER, { api: () => api, fetch: auth });
    const { writes } = await refreshThrough(limiter);
    expect(api.authLimitRelease).not.toHaveBeenCalled();
    expect(writes.some((write) => write.value === "")).toBe(true);
  });

  it("counts nothing without a trustworthy visitor address, and nothing but refreshes", async () => {
    const api = limit(null);
    const auth = vi.fn<typeof fetch>(async () => json(200, {}));
    await refreshLimiter(null, CALLER, { api: () => api, fetch: auth }).fetch(
      `${API}/auth/v1/token?grant_type=refresh_token`,
    );
    await refreshLimiter(ADDRESS, CALLER, { api: () => api, fetch: auth }).fetch(
      `${API}/auth/v1/token?grant_type=password`,
    );
    expect(api.authLimitReserve).not.toHaveBeenCalled();
    expect(auth).toHaveBeenCalledTimes(2);
  });
});
