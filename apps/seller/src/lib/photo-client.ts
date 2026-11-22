/**
 * What the seller's browser does with a chosen picture before anything leaves
 * the device, and the upload itself. Used only by client components.
 *
 * Resizing here is not a nicety. The free plan has no image transformation
 * and the web host's optimiser is billed per image, so these copies are the
 * only sizes the shop will ever have: 400, 800 and 1600 px on the longest
 * side, as JPEG. Drawing the picture onto a canvas and encoding it again also
 * drops everything else the original carried, such as the place it was taken
 * and the phone that took it.
 *
 * None of this is trusted by the server: the buckets limit size and declared
 * type, the storage rules limit who may write where, and the seller centre
 * checks the bytes of every file before the photo is recorded.
 */

import {
  checkDimensions,
  checkSourceFile,
  PHOTO_RULES,
  type PhotoProblem,
  renditionSizes,
} from "@yuntera/core";
import type { ActionState } from "@yuntera/next-kit/client";
import { finishPhotoUpload, removePhoto, startPhotoUpload } from "@/app/photo-actions";

export interface PreparedPhoto {
  /** A local id for the list on screen. */
  key: string;
  name: string;
  /** Pixel size of the largest copy. */
  width: number;
  height: number;
  files: { size: number; blob: Blob }[];
  /** An address for the 800 px copy, to show it before it is uploaded. */
  preview: string;
}

export const PROBLEM_MESSAGE: Record<PhotoProblem | "unreadable" | "encode", string> = {
  not_an_image:
    "no es una foto: elija un archivo JPG, PNG o WebP (cambiarle el nombre a un archivo no lo convierte en foto)",
  vector_image: "es un dibujo SVG, que no aceptamos por seguridad: súbalo como foto JPG o PNG",
  too_large: "pesa más de 25 MB: elija una foto más liviana",
  too_small: `es muy pequeña: necesita al menos ${PHOTO_RULES.minEdge} píxeles en su lado más largo`,
  too_many: `ya tiene el máximo de ${PHOTO_RULES.maxPhotos} fotos`,
  unreadable: "no se pudo abrir: puede estar dañada o en un formato que su navegador no lee",
  encode: "no se pudo preparar en este navegador: inténtelo con otra foto o en otro navegador",
};

export class PhotoProblemError extends Error {
  constructor(readonly problem: keyof typeof PROBLEM_MESSAGE) {
    super(problem);
  }
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new PhotoProblemError("encode");
  // JPEG has no transparency: transparent parts of a PNG become white, not black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob && blob.type === "image/jpeg"
          ? resolve(blob)
          : reject(new PhotoProblemError("encode")),
      "image/jpeg",
      quality,
    ),
  );
}

/** Checks, opens, resizes and re-encodes one chosen file. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const problem = checkSourceFile({ size: file.size, type: file.type, bytes: head });
  if (problem) throw new PhotoProblemError(problem);

  let bitmap: ImageBitmap;
  try {
    // "from-image" turns a phone photo the way it was held.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoProblemError("unreadable");
  }
  try {
    const tooSmall = checkDimensions(bitmap.width, bitmap.height);
    if (tooSmall) throw new PhotoProblemError(tooSmall);

    const sizes = renditionSizes(bitmap.width, bitmap.height);
    const largest = sizes[sizes.length - 1];
    if (!largest) throw new PhotoProblemError("encode");
    const base = draw(bitmap, largest.width, largest.height);
    const files: PreparedPhoto["files"] = [];
    for (const rendition of sizes) {
      const canvas =
        rendition.size === largest.size ? base : draw(base, rendition.width, rendition.height);
      // A busy picture can come out heavy; step the quality down until it fits.
      let blob: Blob | null = null;
      for (const quality of [0.85, 0.75, 0.65, 0.5]) {
        blob = await encode(canvas, quality);
        if (blob.size <= PHOTO_RULES.maxBytes) break;
      }
      if (!blob || blob.size > PHOTO_RULES.maxBytes) throw new PhotoProblemError("encode");
      files.push({ size: rendition.size, blob });
    }
    const preview = files.find((f) => f.size === 800) ?? files[0];
    if (!preview) throw new PhotoProblemError("encode");
    return {
      key: crypto.randomUUID(),
      name: file.name,
      width: largest.width,
      height: largest.height,
      files,
      preview: URL.createObjectURL(preview.blob),
    };
  } finally {
    bitmap.close();
  }
}

/** What the storage service said when it refused a file, in words for the seller. */
function refusal(status: number, body: string): string {
  let code = "";
  try {
    code = String((JSON.parse(body) as { code?: unknown }).code ?? "");
  } catch {
    // not JSON
  }
  if (code === "EntityTooLarge") return "La foto pesa demasiado para guardarla.";
  if (code === "InvalidMimeType") return "Ese tipo de archivo no se acepta como foto.";
  if (code === "ExpiredToken" || code === "InvalidJWT") {
    return "La subida tardó demasiado. Inténtelo de nuevo.";
  }
  return status === 0
    ? "Se perdió la conexión mientras subía la foto. Revise su conexión e inténtelo de nuevo."
    : "No pudimos guardar la foto. Inténtelo de nuevo.";
}

/** Sends one file to its upload address, reporting progress from 0 to 1. */
export function put(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    // What storage-js sends for a raw upload. The address carries the permission.
    request.setRequestHeader("content-type", contentType);
    request.setRequestHeader("cache-control", "max-age=604800");
    request.setRequestHeader("x-upsert", "false");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key) request.setRequestHeader("apikey", key);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(refusal(request.status, request.responseText)));
    request.onerror = () => reject(new Error(refusal(0, "")));
    request.send(blob);
  });
}

/**
 * Uploads a prepared photo to a listing and records it with its text.
 * `onProgress` gets the share of all its bytes sent so far.
 */
export async function uploadPhoto(
  productId: string,
  photo: PreparedPhoto,
  alt: string,
  onProgress: (fraction: number) => void,
): Promise<ActionState> {
  const started = await startPhotoUpload(productId);
  if ("error" in started) return { error: started.error };
  const { target } = started;
  const total = photo.files.reduce((sum, f) => sum + f.blob.size, 0);
  let done = 0;
  try {
    for (const file of photo.files) {
      const upload = target.uploads.find((u) => u.size === file.size);
      if (!upload) return { error: "No pudimos preparar la subida de la foto." };
      await put(upload.url, file.blob, target.contentType, (fraction) =>
        onProgress((done + fraction * file.blob.size) / total),
      );
      done += file.blob.size;
    }
  } catch (error) {
    // Give the reservation back, with whatever part of it arrived.
    await removePhoto(productId, target.photoId).catch(() => undefined);
    return { error: error instanceof Error ? error.message : "No pudimos guardar la foto." };
  }
  onProgress(1);
  return finishPhotoUpload({
    productId,
    photoId: target.photoId,
    alt,
    width: photo.width,
    height: photo.height,
  });
}
