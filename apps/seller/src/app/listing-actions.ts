"use server";

/**
 * Changing a listing after it was created: edit it, take back an edit that is
 * waiting for review, archive it.
 *
 * Like every action here: re-read the session, validate the input, call the
 * API, and answer with text that is safe to show. The database decides whether
 * the person may do it and whether the change needs a review.
 */

import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  getViewer,
  redirectTo,
  refreshShopProduct,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentShop } from "@/lib/shop";

/** Someone with a shop, or a redirect to sign in (or to register a shop). */
async function requireSeller(returnTo: string): Promise<void> {
  if (await currentShop()) return;
  redirectTo((await getViewer()) ? "/registro" : signInPath(returnTo));
}

const EDIT_FIELDS = [
  "title",
  "categorySlug",
  "bullets",
  "description",
  "weightGrams",
  "lengthCm",
  "widthCm",
  "heightCm",
] as const;

const editSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "El título debe tener al menos 5 letras.")
    .max(200, "El título es demasiado largo."),
  categorySlug: z.string().min(1, "Elija la categoría."),
  description: z.string().trim().max(10_000, "La descripción es demasiado larga.").optional(),
  weightGrams: z.coerce
    .number("Escriba el peso en gramos.")
    .int("Escriba el peso en gramos, sin decimales.")
    .min(1, "Escriba el peso en gramos.")
    .max(30_000, "Por ahora no manejamos productos de más de 30 kg."),
  lengthCm: z.coerce.number().min(0.1, "Escriba el largo en centímetros.").max(200),
  widthCm: z.coerce.number().min(0.1, "Escriba el ancho en centímetros.").max(200),
  heightCm: z.coerce.number().min(0.1, "Escriba el alto en centímetros.").max(200),
});

export async function updateListing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, ...EDIT_FIELDS);
  const productId = z.uuid().safeParse(formData.get("productId"));
  const skuId = z.uuid().safeParse(formData.get("skuId"));
  if (!productId.success || !skuId.success) return { error: GENERIC_ERROR, values };
  await requireSeller(`/productos/${productId.data}`);

  const parsed = editSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR, values };
  const bulletPoints = (values.bullets ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (bulletPoints.length > 8) return { error: "Use como máximo 8 características.", values };

  const state = await attempt(async () => {
    const result = await (await sessionApi()).sellerUpdateListing({
      productId: productId.data,
      skuId: skuId.data,
      title: parsed.data.title,
      categorySlug: parsed.data.categorySlug,
      description: parsed.data.description || null,
      bulletPoints,
      weightGrams: parsed.data.weightGrams,
      lengthCm: parsed.data.lengthCm,
      widthCm: parsed.data.widthCm,
      heightCm: parsed.data.heightCm,
      submit: formData.get("intent") !== "draft",
    });
    if (result.outcome === "in_review") {
      return "Enviamos sus cambios a revisión. Su publicación sigue a la venta tal como está hasta que los aprobemos.";
    }
    return result.outcome === "submitted"
      ? "Producto enviado a revisión con sus cambios."
      : "Cambios guardados. Todavía no lo hemos enviado a revisión.";
  }, values);
  if (state.ok) refresh();
  return state;
}

export async function withdrawListingEdit(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = z.uuid().safeParse(formData.get("productId"));
  if (!productId.success) return { error: GENERIC_ERROR };
  await requireSeller(`/productos/${productId.data}`);

  const state = await attempt(async () => {
    await (await sessionApi()).sellerWithdrawListingEdit(productId.data);
    return "Retiramos su cambio. La publicación queda como está.";
  });
  if (state.ok) refresh();
  return state;
}

export async function archiveListing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = z.uuid().safeParse(formData.get("productId"));
  if (!productId.success) return { error: GENERIC_ERROR };
  await requireSeller(`/productos/${productId.data}`);
  // Taking a product off sale is deliberate: the box must be ticked.
  if (formData.get("confirma") !== "on") {
    return { error: "Marque la casilla para confirmar que quiere archivar el producto." };
  }

  const state = await attempt(async () => {
    const api = await sessionApi();
    const listing = await api.sellerListing(productId.data);
    await api.sellerArchiveListing(productId.data);
    // Shoppers should stop seeing it now, not when the shop's cache next expires.
    await refreshShopProduct(listing.slug);
    return "Producto archivado. Ya no aparece en la tienda.";
  });
  if (state.ok) refresh();
  return state;
}
