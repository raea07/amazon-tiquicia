import "server-only";
import { PHOTO_BUCKETS, type PhotoSize, photoUrl } from "@yuntera/core";
import type { ProductPhoto } from "@yuntera/db";
import { apiEnv, sessionApi, sessionClient } from "./supabase";

/**
 * Where the browser can show each photo, for the seller centre and the
 * console. A published photo is shown from its public address. One that is
 * not public yet is shown through a link signed for the person looking (a
 * member of the shop, or catalogue staff), valid for fifteen minutes: the
 * waiting files are private, and the link is made here, under their session.
 */
export async function photoPreviews(
  photos: ProductPhoto[],
  size: PhotoSize = 400,
): Promise<Map<string, string>> {
  const previews = new Map<string, string>();
  const { url } = apiEnv();
  const waiting: { id: string; path: string }[] = [];
  for (const photo of photos) {
    if (photo.published) previews.set(photo.photo_id, photoUrl(url, photo.template, size));
    else if (photo.state !== "rejected") {
      waiting.push({ id: photo.photo_id, path: photo.template.replace("{w}", String(size)) });
    }
  }
  if (waiting.length > 0) {
    const { data } = await (await sessionClient()).storage
      .from(PHOTO_BUCKETS.pending)
      .createSignedUrls(
        waiting.map((w) => w.path),
        15 * 60,
      );
    for (const signed of data ?? []) {
      const match = waiting.find((w) => w.path === signed.path);
      if (match && signed.signedUrl) previews.set(match.id, signed.signedUrl);
    }
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
