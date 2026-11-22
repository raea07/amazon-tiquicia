"use server";

/**
 * The shop's logo: reserve one and get its upload addresses, finish it, take
 * back one that waits for review, stop showing the current one.
 *
 * As with product photos (photo-actions.ts), the files never pass through this
 * server: the browser sends the three sizes it made straight to the private
 * bucket with one-time addresses made here under the seller's own session,
 * and catalogue staff review it before the shop shows it.
 */

import {
  logoPath,
  PHOTO_BUCKETS,
  PHOTO_CONTENT_TYPE,
  PHOTO_RULES,
  type PhotoSize,
  sniffImage,
} from "@yuntera/core";
import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  getViewer,
  messageOf,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  sessionClient,
  signInPath,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentShop, type Shop } from "@/lib/shop";

async function shopForAction(): Promise<Shop> {
  const session = await currentShop();
  if (!session) redirectTo((await getViewer()) ? "/registro" : signInPath("/tienda"));
  return session.shop;
}

export interface LogoUploadTarget {
  logoId: string;
  contentType: string;
  /** One address per size, valid once, for a direct upload from the browser. */
  uploads: { size: number; url: string }[];
}

/** Reserves a logo and makes one upload address for each of its sizes. */
export async function startLogoUpload(): Promise<{ error: string } | { target: LogoUploadTarget }> {
  const shop = await shopForAction();
  try {
    const api = await sessionApi();
    const reserved = await api.sellerReserveLogo(shop.id, "jpeg");
    const bucket = (await sessionClient()).storage.from(reserved.bucket);
    const uploads = [];
    for (const file of reserved.files) {
      const { data, error } = await bucket.createSignedUploadUrl(file.path);
      if (error || !data) {
        await api.sellerWithdrawLogo(shop.id).catch(() => undefined);
        return { error: "No pudimos preparar la subida del logotipo. Inténtelo de nuevo." };
      }
      uploads.push({ size: file.size, url: data.signedUrl });
    }
    return {
      target: { logoId: reserved.logo_id, contentType: reserved.content_type, uploads },
    };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

const finishSchema = z.object({
  logoId: z.uuid(),
  width: z.number().int().min(1).max(1600),
  height: z.number().int().min(1).max(1600),
});

/**
 * The files are uploaded: check that each really is a JPEG (the storage
 * service believes the declared type), then send the logo for review.
 */
export async function finishLogoUpload(input: z.input<typeof finishSchema>): Promise<ActionState> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const shop = await shopForAction();
  const { logoId, width, height } = parsed.data;
  const api = await sessionApi();
  try {
    const storage = (await sessionClient()).storage.from(PHOTO_BUCKETS.pending);
    for (const size of PHOTO_RULES.sizes) {
      const { data } = await storage.download(logoPath(shop.id, logoId, size as PhotoSize, "jpeg"));
      const head = data ? new Uint8Array(await data.slice(0, 16).arrayBuffer()) : null;
      if (!head || sniffImage(head) !== "jpeg" || data?.type !== PHOTO_CONTENT_TYPE.jpeg) {
        await api.sellerWithdrawLogo(shop.id).catch(() => undefined);
        return {
          error:
            "Ese archivo no es una imagen JPG válida, así que no lo guardamos. Elija una imagen de su teléfono o computadora.",
        };
      }
    }
  } catch (error) {
    return { error: messageOf(error) };
  }
  const state = await attempt(async () => {
    await api.sellerFinishLogo(shop.id, logoId, width, height);
    return "Enviamos el logotipo a revisión. Mientras tanto la tienda muestra el que ya tenía.";
  });
  if (state.ok) refresh();
  return state;
}

/** Takes back the logo that waits for review. */
export async function withdrawLogo(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction();
  const state = await attempt(async () => {
    await (await sessionApi()).sellerWithdrawLogo(shop.id);
    return "Retiramos el logotipo que esperaba revisión.";
  });
  if (state.ok) refresh();
  return state;
}

/** Stops showing the current logo. Showing less needs no review. */
export async function removeLogo(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const shop = await shopForAction();
  if (formData.get("confirma") !== "on") {
    return { error: "Marque la casilla para confirmar que quiere quitar el logotipo." };
  }
  const state = await attempt(async () => {
    const removed = await (await sessionApi()).sellerRemoveLogo(shop.id);
    if (removed) await refreshShopCatalog();
    return removed ? "Quitamos el logotipo de su tienda." : "Su tienda no tenía logotipo.";
  });
  if (state.ok) refresh();
  return state;
}
