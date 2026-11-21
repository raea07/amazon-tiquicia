"use server";

/**
 * Catalogue staff decide on photos: with a new listing, as a change to a
 * published one, or one photo at a time. Approving also publishes the files.
 *
 * Publishing is done here, under the staff member's own session: the
 * approval is recorded first, and only then do the storage rules let this
 * person copy that photo's files from the private bucket to the public one.
 * Before anything is approved, the bytes of each waiting file are read back
 * and checked to be a real JPEG, PNG or WebP, because the storage service
 * believes whatever type the uploader declared. The shop shows a photo once
 * its copy is confirmed.
 */

import { PHOTO_BUCKETS, type PhotoFormat, sniffImage } from "@yuntera/core";
import type { Api, OpsPhotoReview } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  deleteUnneededPhotoFiles,
  GENERIC_ERROR,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  sessionClient,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

const NOT_A_PHOTO = "El archivo no es una foto válida: su contenido no corresponde a una imagen.";

async function requireCatalogStaff(): Promise<Api> {
  if (!(await currentStaff())) redirectTo(signInPath("/catalogo"));
  return sessionApi();
}

/**
 * Reads back every waiting photo of a listing and refuses those whose bytes
 * are not the picture they claim to be. Answers how many were refused.
 */
async function refuseFakePhotos(api: Api, item: OpsPhotoReview | undefined): Promise<number> {
  if (!item) return 0;
  const storage = (await sessionClient()).storage.from(PHOTO_BUCKETS.pending);
  let refused = 0;
  for (const photo of item.after.filter((p) => p.state === "pending")) {
    let real = true;
    for (const size of [400, 800, 1600]) {
      const { data } = await storage.download(photo.template.replace("{w}", String(size)));
      const head = data ? new Uint8Array(await data.slice(0, 16).arrayBuffer()) : null;
      if (!head || sniffImage(head) !== (photo.format as PhotoFormat)) real = false;
    }
    if (!real) {
      await api.opsRejectPhoto(photo.photo_id, NOT_A_PHOTO);
      refused += 1;
    }
  }
  return refused;
}

/**
 * Copies a listing's approved photos to the public bucket and confirms them,
 * then deletes what is no longer needed. Answers how many still wait.
 */
async function publishApprovedPhotos(api: Api, productId: string): Promise<number> {
  const storage = (await sessionClient()).storage.from(PHOTO_BUCKETS.pending);
  for (const photo of await api.opsPhotoFilesToPublish(productId)) {
    for (const path of photo.paths) {
      const { error } = await storage.copy(path, path, { destinationBucket: PHOTO_BUCKETS.public });
      // Already there from an earlier attempt: that is what we wanted.
      const code = (error as { code?: string } | null)?.code;
      if (error && code !== "KeyAlreadyExists" && code !== "ResourceAlreadyExists") {
        console.warn(`photo publish: ${code ?? error.message}`);
      }
    }
  }
  const { waiting } = await api.opsConfirmPhotosPublished(productId);
  await deleteUnneededPhotoFiles(null);
  return waiting;
}

const published = (waiting: number, done: string) =>
  waiting === 0
    ? done
    : `${done} Algunas fotos aprobadas aún no se pudieron publicar; use «Publicar fotos» para intentarlo de nuevo.`;

async function queueEntry(api: Api, productId: string) {
  return (await api.opsPhotosForReview()).find((entry) => entry.product_id === productId);
}

/** Publishes or rejects a new listing, with its photos. */
export async function reviewNewListing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = z.uuid().safeParse(formData.get("productId"));
  if (!productId.success) return { error: GENERIC_ERROR };
  const approve = formData.get("decision") === "yes";
  const note = String(formData.get("note") ?? "").trim();
  const api = await requireCatalogStaff();

  const state = await attempt(
    async () => {
      const refused = approve
        ? await refuseFakePhotos(api, await queueEntry(api, productId.data))
        : 0;
      await api.opsReviewProduct(productId.data, approve, note || null);
      if (!approve) return "Producto rechazado; el vendedor ve el motivo.";
      const waiting = await publishApprovedPhotos(api, productId.data);
      await refreshShopCatalog();
      return published(
        waiting,
        refused > 0
          ? `Producto publicado. ${refused === 1 ? "Una foto no era" : `${refused} fotos no eran`} una imagen válida y se rechazó.`
          : "Producto publicado con sus fotos.",
      );
    },
    typed(formData, "note"),
  );
  if (state.ok) refresh();
  return state;
}

/** Approves or rejects a published listing's photo change as a whole. */
export async function reviewPhotoChange(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = z.uuid().safeParse(formData.get("productId"));
  const revision = z.string().min(8).max(64).safeParse(formData.get("revision"));
  if (!productId.success || !revision.success) return { error: GENERIC_ERROR };
  const approve = formData.get("decision") === "yes";
  const note = String(formData.get("note") ?? "").trim();
  const api = await requireCatalogStaff();

  const state = await attempt(
    async () => {
      let current = revision.data;
      if (approve) {
        const entry = await queueEntry(api, productId.data);
        // The seller changed something since the page was drawn: say so rather
        // than approve what nobody looked at.
        if (entry && entry.revision !== current) {
          await api.opsReviewPhotoChange(productId.data, current, approve, note || null);
        }
        if ((await refuseFakePhotos(api, entry)) > 0) {
          current = (await queueEntry(api, productId.data))?.revision ?? current;
        }
      }
      await api.opsReviewPhotoChange(productId.data, current, approve, note || null);
      if (!approve) {
        await deleteUnneededPhotoFiles(null);
        return "Cambio de fotos rechazado; el vendedor ve el motivo y la tienda no cambia.";
      }
      const waiting = await publishApprovedPhotos(api, productId.data);
      await refreshShopCatalog();
      return published(waiting, "Cambio de fotos aprobado: la tienda ya muestra las fotos nuevas.");
    },
    typed(formData, "note"),
  );
  if (state.ok) refresh();
  return state;
}

/** Rejects one waiting photo with a reason the seller reads. */
export async function rejectPhoto(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const photoId = z.uuid().safeParse(formData.get("photoId"));
  if (!photoId.success) return { error: GENERIC_ERROR };
  const reason = String(formData.get("note") ?? "").trim();
  const api = await requireCatalogStaff();
  const state = await attempt(
    async () => {
      await api.opsRejectPhoto(photoId.data, reason);
      await deleteUnneededPhotoFiles(null);
      return "Foto rechazada; el vendedor ve el motivo.";
    },
    typed(formData, "note"),
  );
  if (state.ok) refresh();
  return state;
}

/** Tries again to publish approved photos whose files did not reach the public bucket. */
export async function retryPhotoPublishing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = z.uuid().safeParse(formData.get("productId"));
  if (!productId.success) return { error: GENERIC_ERROR };
  const api = await requireCatalogStaff();
  const state = await attempt(async () => {
    const waiting = await publishApprovedPhotos(api, productId.data);
    await refreshShopCatalog();
    return published(waiting, "Fotos publicadas.");
  });
  if (state.ok) refresh();
  return state;
}
