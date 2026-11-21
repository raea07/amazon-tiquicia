"use server";

/**
 * Catalogue staff decide on photos: with a new listing, as a change to a
 * published one, one photo at a time, or taking down one that is already in
 * the shop. Approving also publishes the files (lib/photo-publish.ts): the
 * approval is recorded first, and only then do the storage rules let this
 * person write that photo's public sizes, made from the copy they reviewed.
 */

import type { Api } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  deleteUnneededPhotoFiles,
  GENERIC_ERROR,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { publishApprovedPhotos } from "@/lib/photo-publish";
import { currentStaff } from "@/lib/staff";

async function requireCatalogStaff(): Promise<Api> {
  if (!(await currentStaff())) redirectTo(signInPath("/catalogo"));
  return sessionApi();
}

/** What happened to the approved photos, after `done`. */
const published = ({ waiting, refused }: { waiting: number; refused: number }, done: string) =>
  [
    done,
    refused === 1
      ? "Una foto no se publicó porque su archivo no era la imagen revisada; el vendedor ve el motivo."
      : refused > 1
        ? `${refused} fotos no se publicaron porque sus archivos no eran las imágenes revisadas; el vendedor ve el motivo.`
        : "",
    waiting > 0
      ? "Algunas fotos aprobadas aún no se pudieron publicar; use «Publicar fotos» para intentarlo de nuevo."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

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
      // A seller who changes the photos while the listing waits sends it back
      // to draft, so this cannot publish photos added after the page was drawn.
      await api.opsReviewProduct(productId.data, approve, note || null);
      if (!approve) return "Producto rechazado; el vendedor ve el motivo.";
      const outcome = await publishApprovedPhotos(api, productId.data);
      await refreshShopCatalog();
      return published(outcome, "Producto publicado con sus fotos.");
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
      // Exactly what the page showed: if the seller changed anything since, the
      // database refuses (photos_changed) and staff look again.
      await api.opsReviewPhotoChange(productId.data, revision.data, approve, note || null);
      if (!approve) {
        await deleteUnneededPhotoFiles(null);
        return "Cambio de fotos rechazado; el vendedor ve el motivo y la tienda no cambia.";
      }
      const outcome = await publishApprovedPhotos(api, productId.data);
      await refreshShopCatalog();
      return published(outcome, "Cambio de fotos aprobado: la tienda ya muestra las fotos nuevas.");
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
    const outcome = await publishApprovedPhotos(api, productId.data);
    await refreshShopCatalog();
    return published(outcome, "Fotos publicadas.");
  });
  if (state.ok) refresh();
  return state;
}

/**
 * Takes a photo down at once: approved and in the shop, or still waiting. For
 * content that must not be shown. The seller reads the reason; its files are
 * deleted from both buckets right after.
 */
export async function takeDownPhoto(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const photoId = z.uuid().safeParse(formData.get("photoId"));
  if (!photoId.success) return { error: GENERIC_ERROR };
  const reason = String(formData.get("note") ?? "").trim();
  const api = await requireCatalogStaff();
  const state = await attempt(
    async () => {
      const done = await api.opsRemovePhoto(photoId.data, reason);
      await deleteUnneededPhotoFiles(null);
      if (done.was_public) await refreshShopCatalog();
      return done.was_public
        ? "Foto retirada de la tienda y borrada. El vendedor ve el motivo. Quien ya la tenía abierta puede seguir viéndola en su navegador hasta una semana."
        : "Foto retirada. El vendedor ve el motivo.";
    },
    typed(formData, "note"),
  );
  if (state.ok) refresh();
  return state;
}
