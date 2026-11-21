/**
 * Product pictures as the shop shows them, in server and client components.
 *
 * A picture's path comes from the database in one of two forms:
 *   - an approved photo: `<seller>/<product>/<photo>/{w}.jpg`, served from the
 *     project's public storage bucket in three sizes (400, 800, 1600 px on the
 *     longest side), made by the seller's device before upload;
 *   - a placeholder drawing of the demo catalogue: a path on the shop itself.
 *
 * Photos are plain `<img>` with `srcset`, so the browser picks the smallest
 * copy that is sharp enough. Nothing goes through a paid image optimiser.
 */

import { isPhotoTemplate, type PhotoSize, photoSrcSet, photoUrl } from "@yuntera/core";

// Read with a literal key so it is inlined at build time, also in the browser.
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/** An absolute address for a picture, for link previews and search engines. */
export function pictureAddress(path: string, size: PhotoSize = 1600): string {
  return isPhotoTemplate(path) ? photoUrl(API_URL, path, size) : path;
}

export interface ProductImageProps {
  path: string;
  /** Empty when the picture sits next to text that already names the product. */
  alt: string;
  /** How wide it is drawn, as in the `sizes` attribute, e.g. "(min-width: 1024px) 25vw, 50vw". */
  sizes: string;
  /** The page's main picture: fetch it first, never lazily. */
  priority?: boolean;
  className?: string;
}

export function ProductImage({ path, alt, sizes, priority = false, className }: ProductImageProps) {
  const photo = isPhotoTemplate(path);
  return (
    // biome-ignore lint/performance/noImgElement: sizes are made before upload; no optimiser is used
    <img
      src={photo ? photoUrl(API_URL, path, 800) : path}
      srcSet={photo ? photoSrcSet(API_URL, path) : undefined}
      sizes={photo ? sizes : undefined}
      alt={alt}
      // The frame around it fixes the shape, so nothing moves when it arrives.
      width={800}
      height={800}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding={priority ? "sync" : "async"}
      className={className}
    />
  );
}
