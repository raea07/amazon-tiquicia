import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Keeps a signed-in person's session fresh.
 *
 * Access tokens are short-lived. Server Components cannot write cookies, so
 * this is the one place a renewed token can be stored: it runs before the
 * request is rendered, verifies the session and, when the token was renewed,
 * sets the new cookies on the response.
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
  const hasSession = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!hasSession || !url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          // Hidden from scripts, like every session cookie: see SESSION_COOKIE.
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
          });
        }
      },
    },
  });

  // Verifies the token and renews it if it has expired.
  await supabase.auth.getClaims();
  return response;
}
