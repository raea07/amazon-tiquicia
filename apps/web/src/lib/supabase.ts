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
 * Neither holds a privileged key: this app has only the publishable key, and
 * every call is checked by the database's grants and row-level security.
 */

function env(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"): string {
  // Read with a literal key so the value is inlined at build time.
  const value =
    name === "NEXT_PUBLIC_SUPABASE_URL"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) {
    throw new Error(`${name} is not set. Copy apps/web/.env.example to .env.local.`);
  }
  return value;
}

const transportFor = (client: SupabaseClient): RpcTransport => ({
  rpc: (fn, args) => client.rpc(fn, args),
});

let anonymous: Api | undefined;

export function publicApi(): Api {
  anonymous ??= createApi(
    transportFor(
      createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    ),
  );
  return anonymous;
}

export async function sessionClient(): Promise<SupabaseClient> {
  const store = await cookies();
  // Checking a session compares its expiry with the clock, so this only makes
  // sense for a live request — never for a page prepared ahead of time.
  await connection();
  return createServerClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Server Components cannot set cookies. The proxy refreshes the
            // session on every request, so a skipped write here is harmless.
          }
        },
      },
    },
  );
}

export async function sessionApi(): Promise<Api> {
  return createApi(transportFor(await sessionClient()));
}
