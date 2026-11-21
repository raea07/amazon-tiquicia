import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";

/**
 * "The catalogue changed: stop serving the copies you kept."
 *
 * The seller centre and the staff console call this after something a shopper
 * should see at once: an edit to a published listing was approved, or a
 * listing was archived. Catalogue reads are cached for about a minute (see
 * lib/data.ts); the shop's own Server Actions drop them with `updateTag`, but
 * the other apps run in other processes and can only ask over HTTP.
 *
 * Every cached catalogue read carries the `catalog` tag, so one call drops the
 * product page, the category listings and the search results together, and the
 * next visitor reads the database (`expire: 0`: no stale copy is served while
 * the new one is fetched, because the caller has just changed what it shows).
 *
 * Dropping the whole catalogue cache on demand would let anyone make every
 * visit read the database, so the caller must present SHOP_REFRESH_KEY, a
 * server-only setting shared with the apps that call this. Without the
 * setting the address does not exist. Without the call nothing breaks: the
 * caches expire on their own within the minute.
 */
export async function POST(request: Request) {
  const expected = process.env.SHOP_REFRESH_KEY;
  if (!expected) return new Response(null, { status: 404 });
  if (!sameSecret(request.headers.get("x-refresh-key") ?? "", expected)) {
    return new Response(null, { status: 401 });
  }
  revalidateTag("catalog", { expire: 0 });
  return new Response(null, { status: 204 });
}

/** Compares in constant time (hashing first makes the lengths equal). */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
