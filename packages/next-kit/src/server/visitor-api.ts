import { createClient } from "@supabase/supabase-js";
import { type Api, createApi } from "@yuntera/db";

/**
 * The API as a visitor: the publishable key, no cookies, no session. The
 * sign-in limit is asked this way, before anyone is signed in, and also from
 * the proxy, which cannot import the `server-only` modules. Kept per process.
 */
let visitor: Api | undefined;

export function visitorApi(): Api | null {
  if (visitor) return visitor;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  visitor = createApi({ rpc: (fn, args) => client.rpc(fn, args) });
  return visitor;
}
