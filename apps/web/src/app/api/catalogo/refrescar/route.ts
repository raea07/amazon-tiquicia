import { createHash, timingSafeEqual } from "node:crypto";
import { CATALOG_TAG, CATEGORIES_TAG } from "@yuntera/next-kit/cache-tags";
import { checkSecret } from "@yuntera/next-kit/guard";
import { revalidateTag } from "next/cache";

/**
 * "The catalogue changed: stop serving the copies you kept."
 *
 * The seller centre and the staff console call this after something a shopper
 * should see at once: an edit to a published listing was approved, a listing
 * was archived or rejected, content was taken down after a report, a shop was
 * suspended or closed. Catalogue reads are cached for about a minute (see
 * lib/data.ts); the shop's own Server Actions drop only the product pages they
 * changed, with `updateTag`, but the other apps run in other processes and can
 * only ask over HTTP.
 *
 * Every cached catalogue read carries the `catalog` tag, so one call drops the
 * product pages, the category listings, the search results and the search
 * suggestions together, and the next visitor reads the database (`expire: 0`:
 * no stale copy is served while the new one is fetched, because the caller has
 * just changed what it shows).
 *
 * The caller must present SHOP_REFRESH_KEY, a server-only setting shared with
 * the apps that call this, so that a visitor cannot empty the whole cache at
 * will. That is all the key does: it does not stop database reads in general
 * (a new search query is a cache miss for anyone), which is the job of the
 * edge's rate limits. Outside a local run the key must be at least 32
 * characters and not one of the example values in the repository (WEB-8);
 * otherwise, as without the setting, the address does not exist, and the
 * reason is logged. Without the call nothing breaks: the caches expire on
 * their own within the minute.
 */
export async function POST(request: Request) {
  const key = checkSecret("SHOP_REFRESH_KEY", process.env.SHOP_REFRESH_KEY, process.env);
  if (!key.ok) {
    if (process.env.SHOP_REFRESH_KEY) console.error(`Catalogue refresh is off: ${key.reason}.`);
    return new Response(null, { status: 404 });
  }
  if (!sameSecret(request.headers.get("x-refresh-key") ?? "", key.value)) {
    return new Response(null, { status: 401 });
  }
  revalidateTag(CATALOG_TAG, { expire: 0 });
  // Staff changed categories: the menu, which is part of every page's prepared
  // shell, is dropped too. Only then, so other refreshes keep the shells.
  if (request.headers.get("x-refresh-scope") === "categories") {
    revalidateTag(CATEGORIES_TAG, { expire: 0 });
  }
  return new Response(null, { status: 204 });
}

/** Compares in constant time (hashing first makes the lengths equal). */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
