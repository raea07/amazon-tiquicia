import { createClient } from "@supabase/supabase-js";
import { type Api, createApi } from "@yuntera/db";

/**
 * Which shop addresses stand for one thing in the catalogue, and whether that
 * thing exists.
 *
 * Product and category pages send their prepared shell at once and fill in
 * the catalogue data afterwards. By then the response has already started
 * with "200 OK", so the page itself can no longer answer "404 Not Found" for
 * an address that leads nowhere. The proxy asks here first, before any page
 * is sent. (This module is used by the proxy, so it must not read cookies or
 * depend on anything that only exists while a page renders.)
 */

export type ShopPath = { kind: "product" | "category"; slug: string };

/** The only shape a product or category address can have (see the slug rules in the database). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 120;

/**
 * Reads a path. `null`: not a product or category page, nothing to check.
 * `"malformed"`: looks like one but could never be a real address, so it is
 * not found without asking anyone.
 */
export function shopPathOf(pathname: string): ShopPath | "malformed" | null {
  const match = /^\/(p|c)\/([^/]*)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = match[2] ?? "";
  if (slug.length > MAX_SLUG_LENGTH || !SLUG.test(slug)) return "malformed";
  return { kind: match[1] === "p" ? "product" : "category", slug };
}

let api: Api | undefined;

/**
 * Asks the catalogue whether the page exists: one indexed lookup that returns
 * a single yes or no. If the question cannot be asked (the API is unreachable
 * or not configured) the answer is "yes": the page then renders and reports
 * the problem itself, which is better than calling the whole catalogue missing.
 */
function catalogueApi(): Api | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!api) {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    api = createApi({ rpc: (fn, args) => client.rpc(fn, args) });
  }
  return api;
}

export async function shopPathExists(path: ShopPath): Promise<boolean> {
  const client = catalogueApi();
  if (!client) return true;
  try {
    return await client.shopPathExists(path.kind, path.slug);
  } catch (error) {
    console.error("Could not check whether a shop page exists", error);
    return true;
  }
}

/**
 * Where a category that was renamed lives now: staff keep the old address
 * working, and the shop answers it with a permanent redirect so links and
 * search engines follow. Null when the address was never a category's, or
 * the category no longer shows (then it is "not found", as before).
 */
export async function categoryRedirect(slug: string): Promise<string | null> {
  const client = catalogueApi();
  if (!client) return null;
  try {
    const target = await client.categoryRedirect(slug);
    return target && SLUG.test(target) && target !== slug ? target : null;
  } catch (error) {
    console.error("Could not look up an old category address", error);
    return null;
  }
}
