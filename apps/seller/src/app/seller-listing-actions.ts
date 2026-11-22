"use server";

/**
 * Actions that came back after the lockdown closed the tables: an offer on a
 * product another shop created, a variant switched off and on, a listing back
 * to draft, an offer a fee change paused put back on sale at a price that
 * covers the fees, and the shop's description.
 *
 * Like every action here: re-read the session, validate the input, call the
 * API, answer with text that is safe to show. The database decides whether
 * the person may do it. What shoppers see changed, so the shop is told to
 * drop its cached catalogue (best effort; it catches up by itself in about a
 * minute when that call is lost).
 */

import {
  format,
  money,
  normaliseShopDescription,
  parseColones,
  SHOP_DESCRIPTION_MAX,
} from "@yuntera/core";
import { ApiError } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  getViewer,
  isRedirect,
  messageOf,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentShop, type Shop } from "@/lib/shop";

async function shopForAction(returnTo: string): Promise<Shop> {
  const session = await currentShop();
  if (!session) redirectTo((await getViewer()) ? "/registro" : signInPath(returnTo));
  return session.shop;
}

/** The database's refusal, with the lowest price it would take when it gives one. */
function priceRefusal(error: unknown): string {
  if (error instanceof ApiError && error.code === "price_below_fees" && error.detail) {
    return `${messageOf(error)} El precio mínimo para este producto es ${format(money(Number(error.detail)))}.`;
  }
  return messageOf(error);
}

// ── An offer on a product another shop created ──────────────────────────────

export async function addOffer(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const shop = await shopForAction("/productos/ofrecer");
  const values = typed(formData, "price", "listPrice", "fulfillment", "handlingDays");
  const skuId = z.uuid().safeParse(formData.get("skuId"));
  const fulfillment = z.enum(["platform", "seller"]).safeParse(values.fulfillment);
  if (!skuId.success) return { error: GENERIC_ERROR, values };
  if (!fulfillment.success) return { error: "Elija quién guarda y despacha el producto.", values };

  const priceMinor = parseColones(values.price ?? "");
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500.", values };
  const listPriceMinor = values.listPrice?.trim() ? parseColones(values.listPrice) : null;
  if (values.listPrice?.trim() && !listPriceMinor) {
    return { error: "El precio regular no es un monto válido.", values };
  }
  if (listPriceMinor && listPriceMinor <= priceMinor) {
    return {
      error:
        "El precio regular debe ser mayor que el precio de venta. Si no hay rebaja, déjelo vacío.",
      values,
    };
  }
  let handlingDays: number | null = null;
  if (fulfillment.data === "seller") {
    handlingDays = Number(values.handlingDays ?? "");
    if (!(Number.isInteger(handlingDays) && handlingDays >= 0 && handlingDays <= 10)) {
      return { error: "Indique en cuántos días hábiles lo tiene listo, de 0 a 10.", values };
    }
  }

  try {
    const added = await (await sessionApi()).sellerAddOffer({
      sellerId: shop.id,
      skuId: skuId.data,
      priceMinor,
      listPriceMinor,
      fulfillment: fulfillment.data,
      handlingDays,
    });
    await refreshShopCatalog();
    // No refresh() here: the search result would redraw as "already offered"
    // and take the confirmation with it. The list shows it on the next visit.
    return {
      ok:
        added.outcome === "resumed"
          ? "Su oferta volvió a la venta con el precio nuevo."
          : fulfillment.data === "platform"
            ? "Agregamos su oferta. Envíe mercadería a la bodega desde Inventario: se puede comprar en cuanto la recibamos."
            : "Agregamos su oferta. Indique sus existencias en Inventario para que se pueda comprar.",
    };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: priceRefusal(error), values };
  }
}

// ── Variants and draft ──────────────────────────────────────────────────────

const VARIANT_DONE = {
  variant_off:
    "Variante retirada: ya no se puede pedir. Los pedidos que ya tiene y sus existencias no cambian.",
  variant_on: "La variante está a la venta otra vez.",
  offer_paused:
    "Otra tienda también vende esta variante, así que sigue en la tienda para ella: pusimos en pausa solo su oferta.",
  offer_resumed: "Su oferta de esta variante está a la venta otra vez.",
  unchanged: "No había nada que cambiar.",
} as const;

export async function setVariantActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const skuId = z.uuid().safeParse(formData.get("skuId"));
  const productId = z.uuid().safeParse(formData.get("productId"));
  const active = z.enum(["on", "off"]).safeParse(formData.get("set"));
  if (!skuId.success || !productId.success || !active.success) return { error: GENERIC_ERROR };
  await shopForAction(`/productos/${productId.data}`);

  const state = await attempt(async () => {
    const changed = await (await sessionApi()).sellerSetVariantActive(
      skuId.data,
      active.data === "on",
    );
    if (changed.outcome !== "unchanged") await refreshShopCatalog();
    return VARIANT_DONE[changed.outcome];
  });
  if (state.ok) refresh();
  return state;
}

export async function unpublishListing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = z.uuid().safeParse(formData.get("productId"));
  if (!productId.success) return { error: GENERIC_ERROR };
  await shopForAction(`/productos/${productId.data}`);
  // Taking a product out of the shop is deliberate: the box must be ticked.
  if (formData.get("confirma") !== "on") {
    return { error: "Marque la casilla para confirmar que quiere volverlo a borrador." };
  }

  let withdrawn = false;
  try {
    withdrawn = (await (await sessionApi()).sellerUnpublishListing(productId.data)).edit_withdrawn;
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageOf(error) };
  }
  await refreshShopCatalog();
  // The page changes shape (a draft has no "back to draft" box), so it says
  // what happened itself.
  redirectTo(
    `/productos/${productId.data}?estado=${withdrawn ? "borrador-sin-cambio" : "borrador"}`,
  );
}

// ── Offers paused below the price floor ─────────────────────────────────────

/** A new price, and the offer back on sale, in one step. */
export async function resumePausedOffer(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await shopForAction("/productos");
  const values = typed(formData, "price");
  const offerId = z.uuid().safeParse(formData.get("offerId"));
  if (!offerId.success) return { error: GENERIC_ERROR, values };
  const priceMinor = parseColones(values.price ?? "");
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500.", values };
  const listPrice = z.coerce.number().int().positive().safeParse(formData.get("listPriceMinor"));

  try {
    await (await sessionApi()).sellerUpdateOffer({
      offerId: offerId.data,
      priceMinor,
      // A "regular price" stays only while it is still above the new price.
      listPriceMinor: listPrice.success && listPrice.data > priceMinor ? listPrice.data : null,
      status: "active",
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: priceRefusal(error), values };
  }
  await refreshShopCatalog();
  refresh();
  return { ok: "Precio guardado. Su oferta está a la venta otra vez." };
}

// ── The shop's description ──────────────────────────────────────────────────

export async function requestShopDescription(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction("/tienda");
  const values = typed(formData, "description");
  const text = normaliseShopDescription(values.description ?? "") ?? "";
  if (text.length > SHOP_DESCRIPTION_MAX) {
    return {
      error: `La descripción puede tener hasta ${SHOP_DESCRIPTION_MAX} caracteres; esta tiene ${text.length}.`,
      values,
    };
  }
  const state = await attempt(async () => {
    await (await sessionApi()).sellerRequestShopDescription(shop.id, text);
    return text
      ? "Enviamos la descripción a revisión. Mientras tanto la tienda muestra la que ya tenía."
      : "Pedimos quitar la descripción. Mientras lo revisamos la tienda sigue mostrándola.";
  }, values);
  if (state.ok) refresh();
  return state;
}
