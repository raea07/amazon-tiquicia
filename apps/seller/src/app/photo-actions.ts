"use server";

/**
 * A listing's photos: reserve one and get its upload addresses, finish it with
 * its text, reorder and retext, remove, and take back a change that waits.
 *
 * The photo's files never pass through this server: the browser sends them
 * straight to storage with one-time upload addresses made here under the
 * seller's own session (the storage rules check, at that moment, that this
 * seller may add exactly those files). Like every action: re-read the session,
 * validate, call the API, answer with text that is safe to show.
 */

import {
  PHOTO_BUCKETS,
  PHOTO_CONTENT_TYPE,
  PHOTO_RULES,
  type PhotoSize,
  photoPath,
  sniffImage,
} from "@yuntera/core";
import {
  type ActionState,
  attempt,
  deleteUnneededPhotoFiles,
  GENERIC_ERROR,
  getViewer,
  messageOf,
  redirectTo,
  sessionApi,
  sessionClient,
  signInPath,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentShop } from "@/lib/shop";

async function requireSeller(returnTo: string): Promise<void> {
  if (await currentShop()) return;
  redirectTo((await getViewer()) ? "/registro" : signInPath(returnTo));
}

const id = z.uuid();

const deleteUnneededFiles = (productId: string) => deleteUnneededPhotoFiles(productId);

/**
 * Changing the photos of a listing that waits for review sends it back to
 * draft (staff must not publish photos they did not see): say so.
 */
const BACK_TO_DRAFT =
  " Como cambió las fotos mientras el producto esperaba revisión, volvió a borrador: envíelo a revisión de nuevo cuando termine.";
const backToDraft = (before: string, after: string) =>
  before === "pending_review" && after === "draft" ? BACK_TO_DRAFT : "";

export interface PhotoUploadTarget {
  photoId: string;
  contentType: string;
  /** One address per size, valid once, for a direct upload from the browser. */
  uploads: { size: number; url: string }[];
}

/** Reserves a photo and makes one upload address for each of its sizes. */
export async function startPhotoUpload(
  productId: string,
): Promise<{ error: string } | { target: PhotoUploadTarget }> {
  const product = id.safeParse(productId);
  if (!product.success) return { error: GENERIC_ERROR };
  await requireSeller(`/productos/${product.data}`);

  try {
    await deleteUnneededFiles(product.data);
    const reserved = await (await sessionApi()).sellerReservePhoto(product.data, "jpeg");
    const bucket = (await sessionClient()).storage.from(reserved.bucket);
    const uploads = [];
    for (const file of reserved.files) {
      const { data, error } = await bucket.createSignedUploadUrl(file.path);
      if (error || !data) {
        await (await sessionApi()).sellerRemovePhoto(reserved.photo_id).catch(() => undefined);
        return { error: "No pudimos preparar la subida de la foto. Inténtelo de nuevo." };
      }
      uploads.push({ size: file.size, url: data.signedUrl });
    }
    return {
      target: { photoId: reserved.photo_id, contentType: reserved.content_type, uploads },
    };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

const finishSchema = z.object({
  productId: id,
  photoId: id,
  alt: z.string().max(400),
  width: z.number().int().min(1).max(1600),
  height: z.number().int().min(1).max(1600),
});

/**
 * The files are uploaded: check that each really is a JPEG (the storage
 * service believes the declared type; a client that skipped the browser's
 * resizing could have sent anything), then record the photo with its text.
 */
export async function finishPhotoUpload(input: z.input<typeof finishSchema>): Promise<ActionState> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const { productId, photoId, alt, width, height } = parsed.data;
  await requireSeller(`/productos/${productId}`);

  const api = await sessionApi();
  let before = "";
  try {
    const { seller_id: sellerId, status } = await api.sellerPhotos(productId);
    before = status;
    const storage = (await sessionClient()).storage.from(PHOTO_BUCKETS.pending);
    for (const size of PHOTO_RULES.sizes) {
      const { data } = await storage.download(
        photoPath(sellerId, productId, photoId, size as PhotoSize, "jpeg"),
      );
      const head = data ? new Uint8Array(await data.slice(0, 16).arrayBuffer()) : null;
      if (!head || sniffImage(head) !== "jpeg" || data?.type !== PHOTO_CONTENT_TYPE.jpeg) {
        // Not what it claims to be: drop it and its files.
        await api.sellerRemovePhoto(photoId).catch(() => undefined);
        await deleteUnneededFiles(productId);
        return {
          error:
            "Ese archivo no es una foto JPG válida, así que no lo guardamos. Elija una foto de su teléfono o computadora.",
        };
      }
    }
  } catch (error) {
    return { error: messageOf(error) };
  }
  const state = await attempt(async () => {
    const finished = await api.sellerFinishPhoto(photoId, alt, width, height);
    return `Foto agregada.${backToDraft(before, finished.listing_status)}`;
  });
  if (state.ok) refresh();
  return state;
}

const orderSchema = z.object({
  productId: id,
  items: z.array(z.object({ photoId: id, alt: z.string().max(400) })).max(PHOTO_RULES.maxPhotos),
});

/** Saves the order and the text of every photo. */
export async function savePhotos(input: z.input<typeof orderSchema>): Promise<ActionState> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  await requireSeller(`/productos/${parsed.data.productId}`);
  const state = await attempt(async () => {
    const api = await sessionApi();
    const { status: before } = await api.sellerPhotos(parsed.data.productId);
    const saved = await api.sellerSavePhotos(parsed.data.productId, parsed.data.items);
    return saved.outcome === "in_review"
      ? "Guardamos el orden y los textos. Como el producto está publicado, los revisamos antes de mostrarlos; mientras tanto la tienda muestra las fotos aprobadas."
      : `Guardamos el orden y los textos de las fotos.${backToDraft(before, saved.listing_status)}`;
  });
  if (state.ok) refresh();
  return state;
}

/** Removes a photo; on a published listing the removal waits for review. */
export async function removePhoto(productId: string, photoId: string): Promise<ActionState> {
  const product = id.safeParse(productId);
  const photo = id.safeParse(photoId);
  if (!product.success || !photo.success) return { error: GENERIC_ERROR };
  await requireSeller(`/productos/${product.data}`);
  const state = await attempt(async () => {
    const api = await sessionApi();
    const { status: before } = await api.sellerPhotos(product.data);
    const { outcome, listing_status: after } = await api.sellerRemovePhoto(photo.data);
    if (outcome === "removed") {
      await deleteUnneededFiles(product.data);
      return `Quitamos la foto.${backToDraft(before, after)}`;
    }
    return "La foto se quitará cuando aprobemos el cambio. Mientras tanto la tienda la sigue mostrando.";
  });
  if (state.ok) refresh();
  return state;
}

/** Takes back every photo change waiting on a published listing. */
export async function withdrawPhotoChanges(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const product = id.safeParse(formData.get("productId"));
  if (!product.success) return { error: GENERIC_ERROR };
  await requireSeller(`/productos/${product.data}`);
  const state = await attempt(async () => {
    await (await sessionApi()).sellerWithdrawPhotoChanges(product.data);
    await deleteUnneededFiles(product.data);
    return "Retiramos sus cambios de fotos. La tienda sigue mostrando las fotos aprobadas.";
  });
  if (state.ok) refresh();
  return state;
}

/**
 * Sends a listing that was just created as a draft (so its photos could be
 * added) to review, unchanged otherwise.
 */
export async function sendListingToReview(productId: string): Promise<ActionState> {
  const product = id.safeParse(productId);
  if (!product.success) return { error: GENERIC_ERROR };
  await requireSeller(`/productos/${product.data}`);
  return attempt(async () => {
    const api = await sessionApi();
    const listing = await api.sellerListing(product.data);
    const content = listing.content;
    await api.sellerUpdateListing({
      productId: product.data,
      skuId: content.sku_id,
      title: content.title,
      categorySlug: content.category_slug,
      description: content.description,
      bulletPoints: content.bullet_points,
      weightGrams: content.weight_grams,
      lengthCm: content.length_cm,
      widthCm: content.width_cm,
      heightCm: content.height_cm,
      submit: true,
    });
    return "Producto enviado a revisión con sus fotos.";
  });
}
