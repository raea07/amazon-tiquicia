import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  ACTIVITY_COOKIE,
  activityValue,
  addressHash,
  callerProof,
  clientAddress,
  ENDED_COOKIE,
  guardKey,
  PER_PERSON_COOKIES,
  readActivity,
  type SessionVerdict,
  sessionPolicy,
  sessionVerdict,
  signedInAt,
} from "../guard";
import { keepCookiesIfLimited, refreshLimiter } from "./refresh-limit";

/**
 * Keeps a signed-in person's session fresh, and ends it when it has lived too
 * long for this app (WEB-5).
 *
 * Access tokens are short-lived. Server Components cannot write cookies, so
 * this is the one place a renewed token can be stored: it runs before the
 * request is rendered, verifies the session and, when the token was renewed,
 * sets the new cookies on the response.
 *
 * Each app's session has a lifetime (`SESSION_POLICIES` in guard.ts, chosen by
 * the app's `YUNTERA_APP`, which next-kit/config sets at build time): from the
 * moment the person signed in, and in the console also since their last
 * request. A session past either ends here, closed: the refresh token is
 * revoked at Auth, the cookies are removed, and the request goes on without a
 * session, so the page sends the person to sign in with the address they were
 * on, and sign-in brings them back to it. A short note cookie tells the
 * sign-in page why.
 *
 * Token refreshes made here count against the visitor's address in the apps'
 * own limit (refresh-limit.ts), not only against Auth's limit, which sees the
 * server's address.
 *
 * It does nothing at all for visitors without a session cookie, so public
 * pages stay as fast as their cached shell allows. It is NOT the authorization
 * layer: every page and action checks the session itself, and the database
 * enforces access regardless.
 *
 * Each app re-exports this from its own `src/proxy.ts` together with a
 * `config.matcher`, which the framework requires to be written there.
 */
export async function refreshSession(request: NextRequest) {
  // An e-mail link whose address Auth did not accept falls back to the site
  // URL itself (https://…/?token_hash=…&type=…). Send it on to the page that
  // verifies links, so it still works. Nothing is verified here.
  const { searchParams, pathname } = request.nextUrl;
  if (pathname !== "/auth/confirm" && searchParams.has("token_hash") && searchParams.has("type")) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/confirm";
    target.search = "";
    target.searchParams.set("token_hash", searchParams.get("token_hash") ?? "");
    target.searchParams.set("type", searchParams.get("type") ?? "");
    return NextResponse.redirect(target);
  }

  const hasSession = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!hasSession || !url || !key) return NextResponse.next({ request });

  const policy = sessionPolicy(process.env.YUNTERA_APP);
  const guard = guardKey(process.env);
  const address = clientAddress(request.headers, process.env);
  const secure = process.env.NODE_ENV === "production";
  const outgoing = new Map<string, { value: string; options: Record<string, unknown> }>();
  // The cookies the page behind will see. Kept here and handed on as the
  // request's Cookie header at the end, rather than by changing
  // `request.cookies`: the framework copies such changes into the response as
  // extra Set-Cookie headers without our options (not HttpOnly, no expiry),
  // which would undo a removal and show the token to scripts.
  const jar = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]));

  // A refresh the limit refused leaves the cookies exactly as they came.
  const limiter = refreshLimiter(
    guard.ok && address ? addressHash(guard.value, address) : null,
    guard.ok ? callerProof(guard.value) : null,
  );
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: keepCookiesIfLimited(limiter, (list) => {
        for (const { name, value, options } of list) {
          if (value) jar.set(name, value);
          else jar.delete(name);
          // Hidden from scripts, like every session cookie: see SESSION_COOKIE.
          // The browser keeps it no longer than this app's session lives.
          outgoing.set(name, {
            value,
            options: {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure,
              path: "/",
              ...(value ? { maxAge: policy.maxAgeSeconds } : {}),
            },
          });
        }
      }),
    },
    global: {
      fetch: limiter.fetch,
    },
  });

  // Verifies the token and renews it if it has expired.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; session_id?: unknown; amr?: unknown } | undefined;

  const now = Math.floor(Date.now() / 1000);
  let verdict: SessionVerdict = "ok";
  if (claims?.sub) {
    const sessionId = typeof claims.session_id === "string" ? claims.session_id : "";
    const activity =
      guard.ok && sessionId
        ? readActivity(guard.value, sessionId, request.cookies.get(ACTIVITY_COOKIE)?.value)
        : null;
    verdict = sessionVerdict(policy, signedInAt(claims), activity, now);
    if (
      verdict === "ok" &&
      policy.idleSeconds !== null &&
      guard.ok &&
      sessionId &&
      !isPrefetch(request)
    ) {
      outgoing.set(ACTIVITY_COOKIE, {
        value: activityValue(guard.value, sessionId, now),
        options: { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: policy.idleSeconds },
      });
    }
  }

  if (verdict !== "ok") {
    // Revokes this session's refresh token at Auth; then, whatever Auth said,
    // the cookies go, so the browser holds nothing that still works.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    for (const cookie of request.cookies.getAll()) {
      if (!cookie.name.startsWith("sb-") && cookie.name !== ACTIVITY_COOKIE) continue;
      jar.delete(cookie.name);
      outgoing.set(cookie.name, { value: "", options: { path: "/", maxAge: 0 } });
    }
    // What this person left in the browser goes with the session.
    for (const { name, path } of PER_PERSON_COOKIES) {
      jar.delete(name);
      outgoing.set(name, { value: "", options: { path, maxAge: 0 } });
    }
    outgoing.set(ENDED_COOKIE, {
      value: verdict,
      options: { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 15 * 60 },
    });
  }

  const headers = new Headers(request.headers);
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  else headers.delete("cookie");
  const response = NextResponse.next({ request: { headers } });
  // Written as plain Set-Cookie headers, not through `response.cookies`: the
  // framework copies cookies set that way into the page's cookie store and
  // sends them a second time without their attributes, which would keep a
  // removed session cookie alive and drop HttpOnly from a renewed one.
  for (const [name, { value, options }] of outgoing) {
    response.headers.append("set-cookie", serializeCookie(name, value, options));
  }
  return response;
}

/** One Set-Cookie header. Values come from Auth or from us and are cookie-safe; anything else is encoded. */
export function serializeCookie(
  name: string,
  value: string,
  options: {
    path?: unknown;
    maxAge?: unknown;
    httpOnly?: unknown;
    secure?: unknown;
    sameSite?: unknown;
    [other: string]: unknown;
  },
): string {
  const safe = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)
    ? value
    : encodeURIComponent(value);
  const parts = [
    `${name}=${safe}`,
    `Path=${typeof options.path === "string" ? options.path : "/"}`,
  ];
  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
    if (options.maxAge <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (typeof options.sameSite === "string") {
    parts.push(
      `SameSite=${options.sameSite[0]?.toUpperCase()}${options.sameSite.slice(1).toLowerCase()}`,
    );
  }
  return parts.join("; ");
}

/** A link prefetched in the background is not the person doing something. */
function isPrefetch(request: NextRequest): boolean {
  return (
    request.headers.has("next-router-prefetch") ||
    request.headers.get("sec-purpose")?.includes("prefetch") === true ||
    request.headers.get("purpose") === "prefetch"
  );
}
