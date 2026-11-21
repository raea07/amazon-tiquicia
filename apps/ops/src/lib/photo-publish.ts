import "server-only";
import {
  checkDecodedPhoto,
  type DecodedPhotoProblem,
  PHOTO_BUCKETS,
  PHOTO_CONTENT_TYPE,
  PHOTO_RULES,
  type PhotoFormat,
  sniffImage,
} from "@yuntera/core";
import type { Api, PhotoFileToPublish } from "@yuntera/db";
import { deleteUnneededPhotoFiles, sessionClient } from "@yuntera/next-kit/server";
import sharp, { type Metadata, type Sharp } from "sharp";

/**
 * Publishing approved photos, under the staff member's own session.
 *
 * The seller's files are never copied to the shop. For each approved photo the
 * console reads the largest waiting copy, the one staff looked at in the
 * review, decodes it here, checks it is the picture that was recorded, and
 * writes all three public sizes made from it. So whatever a client uploaded as
 * the smaller sizes never reaches the shop, and nothing the original carried
 * (location, the device, comments, a second file hidden after the picture)
 * survives: the encoder writes pixels only.
 *
 * The database then confirms each photo whose three public files exist, and
 * refuses any whose waiting files were uploaded again after it was finished
 * (what was read here might not be what staff saw).
 */

/** Words for the seller when the console refuses a photo it cannot publish. */
const REFUSED: Record<DecodedPhotoProblem, string> = {
  not_an_image:
    "El archivo de la foto no es una imagen que podamos abrir, así que no la publicamos. Súbala de nuevo desde su teléfono o computadora.",
  wrong_format:
    "El archivo de la foto no es del tipo con que se subió, así que no la publicamos. Súbala de nuevo desde su teléfono o computadora.",
  wrong_size:
    "La foto no tiene el tamaño con que se subió, así que no la publicamos. Súbala de nuevo desde su teléfono o computadora.",
};

/** Seconds browsers may keep a public copy (one week; see the migration). */
const PUBLIC_CACHE_SECONDS = "604800";

type Rendition = { path: string; bytes: Buffer };

/** The three public sizes of one photo, or why it cannot be published. */
export async function renditionsOf(
  photo: PhotoFileToPublish,
  source: Uint8Array,
): Promise<{ files: Rendition[] } | { problem: DecodedPhotoProblem }> {
  // The bytes say what the file is before any decoder looks at it, so a
  // drawing (which the image library could also read) is never opened.
  if (sniffImage(source.subarray(0, 512)) !== photo.format) return { problem: "not_an_image" };
  const largest = Math.max(...PHOTO_RULES.sizes);
  let decoded: Metadata;
  try {
    decoded = await sharp(source, { limitInputPixels: largest * largest, pages: 1 }).metadata();
  } catch {
    return { problem: "not_an_image" };
  }
  // Pixel size as shown, after the orientation the file asks for.
  const turned = (decoded.orientation ?? 1) >= 5;
  const problem = checkDecodedPhoto(
    {
      format: decoded.format,
      width: turned ? decoded.height : decoded.width,
      height: turned ? decoded.width : decoded.height,
    },
    { format: photo.format, width: photo.width, height: photo.height },
  );
  if (problem) return { problem };

  const files: Rendition[] = [];
  try {
    for (const [index, size] of PHOTO_RULES.sizes.entries()) {
      const path = photo.paths[index];
      if (!path) return { problem: "not_an_image" };
      const image = sharp(source, { limitInputPixels: largest * largest, pages: 1 })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
      const bytes = await encode(image, photo.format).toBuffer();
      if (bytes.length > PHOTO_RULES.maxBytes) return { problem: "wrong_size" };
      files.push({ path, bytes });
    }
  } catch {
    return { problem: "not_an_image" };
  }
  return { files };
}

function encode(image: Sharp, format: PhotoFormat): Sharp {
  // No .withMetadata(): the output carries the pixels and nothing else.
  if (format === "png") return image.png({ compressionLevel: 9 });
  if (format === "webp") return image.webp({ quality: 82 });
  return image.jpeg({ quality: 82, mozjpeg: true });
}

/**
 * Publishes a listing's approved photos and confirms them, then deletes what
 * is no longer needed. Answers how many still wait for their files, and how
 * many were refused.
 */
export async function publishApprovedPhotos(
  api: Api,
  productId: string,
): Promise<{ waiting: number; refused: number }> {
  const storage = (await sessionClient()).storage;
  let refused = 0;
  for (const photo of await api.opsPhotoFilesToPublish(productId)) {
    const { data } = await storage.from(PHOTO_BUCKETS.pending).download(photo.source);
    if (!data) {
      console.warn("photo publish: the waiting copy could not be read");
      continue;
    }
    const made = await renditionsOf(photo, new Uint8Array(await data.arrayBuffer()));
    if ("problem" in made) {
      await api.opsRemovePhoto(photo.photo_id, REFUSED[made.problem]);
      refused += 1;
      continue;
    }
    for (const file of made.files) {
      const { error } = await storage.from(PHOTO_BUCKETS.public).upload(file.path, file.bytes, {
        contentType: PHOTO_CONTENT_TYPE[photo.format],
        cacheControl: PUBLIC_CACHE_SECONDS,
        upsert: false,
      });
      // Already there from an earlier attempt, made from the same reviewed copy.
      const code = (error as { code?: string } | null)?.code;
      if (error && code !== "KeyAlreadyExists" && code !== "ResourceAlreadyExists") {
        console.warn(`photo publish: ${code ?? error.message}`);
      }
    }
  }
  const confirmed = await api.opsConfirmPhotosPublished(productId);
  await deleteUnneededPhotoFiles(null);
  return { waiting: confirmed.waiting, refused: refused + confirmed.refused };
}
