import "server-only";
import { PHOTO_BUCKETS, type PhotoSize, photoUrl } from "@yuntera/core";
import type { ProductPhoto } from "@yuntera/db";
import { apiEnv, sessionApi, sessionClient } from "./supabase";

/**
 * How a photo that is not public yet reaches the browser.
 *   "signed"  a link signed for the person looking, valid for fifteen minutes,
 *             made here under their session. Only catalogue staff may sign
 *             links to waiting files (the storage rules refuse sellers, so a
 *             seller cannot turn a photo nobody reviewed into a link anyone
 *             can open).
 *   route     the seller centre's own address for it (`<route>/<path>`), which
 *             downloads the file under the seller's session and passes it on.
 */
export type WaitingPreview = "signed" | { route: string };

/**
 * Where the browser can show each photo, for the seller centre and the
 * console. A published photo is shown from its public address; one that is
 * not public yet as `waiting` says. Rejected photos have no files to show.
 */
export async function photoPreviews(
  photos: ProductPhoto[],
  { size = 400, waiting = "signed" }: { size?: PhotoSize; waiting?: WaitingPreview } = {},
): Promise<Map<string, string>> {
  const previews = new Map<string, string>();
  const { url } = apiEnv();
  const pending: { id: string; path: string }[] = [];
  for (const photo of photos) {
    if (photo.published) previews.set(photo.photo_id, photoUrl(url, photo.template, size));
    else if (photo.state !== "rejected") {
      pending.push({ id: photo.photo_id, path: photo.template.replace("{w}", String(size)) });
    }
  }
  if (pending.length === 0) return previews;
  if (waiting !== "signed") {
    for (const item of pending) previews.set(item.id, `${waiting.route}/${item.path}`);
    return previews;
  }
  const { data } = await (await sessionClient()).storage
    .from(PHOTO_BUCKETS.pending)
    .createSignedUrls(
      pending.map((w) => w.path),
      15 * 60,
    );
  for (const signed of data ?? []) {
    const match = pending.find((w) => w.path === signed.path);
    if (match && signed.signedUrl) previews.set(match.id, signed.signedUrl);
  }
  return previews;
}

/**
 * Deletes files that nothing needs any more, through the storage service and
 * under the caller's own session (the storage rules allow exactly these): for
 * one listing, or everywhere for catalogue staff. Best effort: whatever is
 * left is listed again by the next call.
 */
export async function deleteUnneededPhotoFiles(productId?: string | null): Promise<number> {
  try {
    const files = await (await sessionApi()).photoFilesToDelete(productId ?? null);
    if (files.length === 0) return 0;
    const storage = (await sessionClient()).storage;
    let deleted = 0;
    for (const bucket of new Set(files.map((f) => f.bucket))) {
      const paths = files.filter((f) => f.bucket === bucket).map((f) => f.path);
      const { data, error } = await storage.from(bucket).remove(paths);
      if (error) console.warn(`photo cleanup: ${error.message}`);
      deleted += data?.length ?? 0;
    }
    return deleted;
  } catch (error) {
    console.warn(`photo cleanup skipped: ${error instanceof Error ? error.message : "unknown"}`);
    return 0;
  }
}
