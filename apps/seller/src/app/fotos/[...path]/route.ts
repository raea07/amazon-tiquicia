import { PHOTO_BUCKETS, PHOTO_CONTENT_TYPE } from "@yuntera/core";
import { sessionClient } from "@yuntera/next-kit/server";

/**
 * A photo of the seller's own listing that is not public yet, for the photo
 * manager: `/fotos/<seller>/<product>/<photo>/<size>.<ext>`.
 *
 * The file is downloaded here under the seller's own session, and the storage
 * rules decide: only a member of the shop, and only a file that is part of a
 * review (being uploaded, waiting, or approved but not yet public). Sellers
 * are not allowed to sign links to waiting files, because a signed link works
 * for anyone, for as long as it was signed for; this address works only for
 * the signed-in seller and is kept by their browser for a few minutes.
 */

const PATH =
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/(400|800|1600)\.(jpg|png|webp)$/;

const notFound = () =>
  new Response(null, { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(_request: Request, { params }: RouteContext<"/fotos/[...path]">) {
  const path = (await params).path.join("/");
  if (!PATH.test(path)) return notFound();
  const { data } = await (await sessionClient()).storage.from(PHOTO_BUCKETS.pending).download(path);
  if (!data) return notFound();
  // Served only as one of the photo types the bucket accepts, never sniffed as
  // anything else, and in a sandbox: whatever the bytes are, they stay a picture.
  const type = (Object.values(PHOTO_CONTENT_TYPE) as string[]).find((t) => t === data.type);
  if (!type) return notFound();
  const bytes = new Uint8Array(await data.arrayBuffer());
  return new Response(bytes, {
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
