import { revalidateTag } from "next/cache";
import { z } from "zod";
import { shopPathOf } from "@/lib/shop-paths";

/**
 * "This product's page may have changed."
 *
 * The seller centre and the staff console call this after something a shopper
 * should see at once: an edit was approved, a listing was published or
 * archived. Catalogue reads are cached for about a minute (see lib/data.ts);
 * this drops the cached copies of that product, and of the listings it appears
 * in, so the next visitor reads the database again.
 *
 * It needs no key because it cannot change what the shop says, only when the
 * shop next reads the database, and the shop already drops the same caches
 * every time an order is placed. Without this call nothing breaks: the caches
 * expire on their own within the minute.
 */
export async function POST(request: Request) {
  const body = z.object({ slug: z.string() }).safeParse(await request.json().catch(() => null));
  const path = body.success ? shopPathOf(`/p/${body.data.slug}`) : null;
  if (!path || path === "malformed") return new Response(null, { status: 400 });

  // `expire: 0`: do not serve the old copy while a new one is fetched. The
  // caller has just changed the product and the next visitor must see it.
  revalidateTag(`product:${path.slug}`, { expire: 0 });
  revalidateTag("catalog", "max");
  return new Response(null, { status: 204 });
}
