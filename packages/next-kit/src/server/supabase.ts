import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Api, createApi, type RpcTransport } from "@yuntera/db";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * Two ways to reach the API, with a deliberate difference:
 *
 *   publicApi()   no cookies, no user. Safe to call inside `'use cache'`,
 *                 because its results are the same for everyone.
 *   sessionApi()  carries the signed-in user's session from cookies. Reads the
 *                 request, so it must run inside a <Suspense> boundary and its
 *                 results must never be put in a shared cache.
 *
 * Neither holds a privileged key: the apps have only the publishable key, and
 * every call is checked by the database's grants and row-level security.
 */

export function apiEnv(): { url: string; key: string } {
  // Read with literal keys so the values are inlined at build time.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. Copy .env.example to .env.local.",
    );
  }
  return { url, key };
}

/**
 * How session cookies are stored. No script in the page ever needs the token
 * (every API call is made on the server), so the cookie is hidden from
 * JavaScript: an injected script cannot read and send it elsewhere.
 */
export const SESSION_COOKIE = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

const transportFor = (client: SupabaseClient): RpcTransport => ({
  rpc: (fn, args) => client.rpc(fn, args),
});

let anonymous: Api | undefined;

export function publicApi(): Api {
  if (!anonymous) {
    const { url, key } = apiEnv();
    anonymous = createApi(
      transportFor(
        createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }),
      ),
    );
  }
  return anonymous;
}

export async function sessionClient(): Promise<SupabaseClient> {
  const store = await cookies();
  // Checking a session compares its expiry with the clock, so this only makes
  // sense for a live request — never for a page prepared ahead of time.
  await connection();
  const { url, key } = apiEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, { ...options, ...SESSION_COOKIE });
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so a skipped write here is harmless.
        }
      },
    },
  });
}

export async function sessionApi(): Promise<Api> {
  return createApi(transportFor(await sessionClient()));
}
