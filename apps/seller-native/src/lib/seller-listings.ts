/**
 * The seller actions of migration 083600 that the seller centre has, with its
 * checks and its words (apps/seller/src/app/seller-listing-actions.ts and the
 * pages that use it): an offer on a product another shop created, a variant
 * switched off and on, a listing taken back to draft, an offer paused below
 * the price floor put back on sale, an offer on another shop's product
 * withdrawn for good, and the shop's description.
 *
 * Pure TypeScript with no React Native import, so it runs in the unit tests
 * (`seller-listings.test.ts`). The database checks the caller and the values
 * again; these exist to give a good message first.
 */

import { normaliseShopDescription, parseColones, SHOP_DESCRIPTION_MAX } from "@yuntera/core";
import { ApiError, type PausedOffer, type VariantChange } from "@yuntera/db";
import type { Checked } from "./rules";

// ── An offer on a product another shop created ──────────────────────────────

export interface AddOfferForm {
  price: string;
  listPrice: string;
  /** "" until the seller chooses. */
  fulfillment: string;
  handlingDays: string;
}

export interface AddOfferInput {
  priceMinor: number;
  listPriceMinor: number | null;
  fulfillment: "platform" | "seller";
  handlingDays: number | null;
}

/** apps/seller `addOffer`: the same rules in the same order, the same messages. */
export function checkAddOffer(form: AddOfferForm): Checked<AddOfferInput> {
  if (form.fulfillment !== "platform" && form.fulfillment !== "seller") {
    return { error: "Elija quién guarda y despacha el producto." };
  }
  const priceMinor = parseColones(form.price);
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500." };
  const listPriceMinor = form.listPrice.trim() ? parseColones(form.listPrice) : null;
  if (form.listPrice.trim() && !listPriceMinor) {
    return { error: "El precio regular no es un monto válido." };
  }
  if (listPriceMinor && listPriceMinor <= priceMinor) {
    return {
      error:
        "El precio regular debe ser mayor que el precio de venta. Si no hay rebaja, déjelo vacío.",
    };
  }
  let handlingDays: number | null = null;
  if (form.fulfillment === "seller") {
    handlingDays = form.handlingDays.trim() === "" ? Number.NaN : Number(form.handlingDays);
    if (!(Number.isInteger(handlingDays) && handlingDays >= 0 && handlingDays <= 10)) {
      return { error: "Indique en cuántos días hábiles lo tiene listo, de 0 a 10." };
    }
  }
  return {
    input: {
      priceMinor,
      listPriceMinor: listPriceMinor ?? null,
      fulfillment: form.fulfillment,
      handlingDays,
    },
  };
}

/** What the seller is told once the offer is added (or an archived one is back). */
export function offerAdded(outcome: "added" | "resumed", fulfillment: "platform" | "seller") {
  if (outcome === "resumed") return "Su oferta volvió a la venta con el precio nuevo.";
  return fulfillment === "platform"
    ? "Agregamos su oferta. Envíe mercadería a la bodega desde Inventario: se puede comprar en cuanto la recibamos."
    : "Agregamos su oferta. Indique sus existencias en Inventario para que se pueda comprar.";
}

/** Why the catalogue search was refused, as the seller centre's page says it. */
export function catalogRefusal(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "shop_not_approved") {
      return "Su tienda podrá vender productos de otras tiendas cuando la verifiquemos.";
    }
    if (error.code === "shop_not_active") {
      return "Su tienda no está activa, así que por ahora no puede agregar ofertas.";
    }
  }
  return fallback;
}

/** The search needs two characters, as the seller centre's page; at most 200 are sent. */
export const catalogQuery = (text: string) => text.trim().slice(0, 200);

// ── Variants and draft ──────────────────────────────────────────────────────

export const VARIANT_DONE: Record<VariantChange["outcome"], string> = {
  variant_off:
    "Variante retirada: ya no se puede pedir. Los pedidos que ya tiene y sus existencias no cambian.",
  variant_on: "La variante está a la venta otra vez.",
  offer_paused:
    "Otra tienda también vende esta variante, así que sigue en la tienda para ella: pusimos en pausa solo su oferta.",
  offer_resumed: "Su oferta de esta variante está a la venta otra vez.",
  unchanged: "No había nada que cambiar.",
};

/** Switched off, or its own offer paused: the button brings it back. */
export const bringsBack = (variant: { active: boolean; own_offer_status: string | null }) =>
  !variant.active || variant.own_offer_status === "paused";

export const UNPUBLISH_CONFIRM_NEEDED =
  "Marque la casilla para confirmar que quiere volverlo a borrador.";

/** The seller centre's "Volvió a borrador" notice. */
export const unpublished = (editWithdrawn: boolean) =>
  `Ya no aparece en la tienda ni en las búsquedas, y nadie lo puede comprar. Los pedidos que ya tenía siguen su curso.${
    editWithdrawn ? " El cambio que esperaba revisión se retiró: hágalo aquí." : ""
  } Cuando esté listo, envíelo a revisión.`;

/** "Another shop sells from this listing", with how many. */
export const sharedBy = (count: number) =>
  count <= 1
    ? "Otra tienda tiene una oferta a la venta en esta publicación"
    : `${count} tiendas más tienen una oferta a la venta en esta publicación`;

/** Shops whose offer here is paused: they hold nothing back. */
export const pausedElsewhere = (count: number) =>
  count === 0
    ? null
    : count === 1
      ? "Otra tienda tiene aquí una oferta en pausa; no lo impide, y su oferta sigue en pausa."
      : `${count} tiendas más tienen aquí una oferta en pausa; no lo impiden, y sus ofertas siguen en pausa.`;

// ── Offers paused below the price floor ─────────────────────────────────────

/** Why the offer was paused, with the day, as the seller centre's list says it. */
export function pausedReason(
  offer: Pick<PausedOffer, "reason" | "paused_at">,
  day: (value: string) => string,
): string {
  return offer.reason === "fee_change"
    ? `Las tarifas cambiaron el ${day(offer.paused_at)} y, con su precio actual, cada venta le costaría más en comisiones y cobros de lo que recibe. Por eso la pusimos en pausa.`
    : `El ${day(offer.paused_at)} se aprobó un cambio del paquete o de la categoría de esta publicación y, con su precio actual, cada venta le costaría más en tarifas de lo que recibe. Por eso la pusimos en pausa.`;
}

export const pausedHeading = (count: number) =>
  count === 1
    ? "Una oferta en pausa porque su precio ya no cubre las tarifas"
    : `${count} ofertas en pausa porque su precio ya no cubre las tarifas`;

/** apps/seller `resumePausedOffer`: a new price and on sale again, in one step. */
export function checkResumePrice(
  price: string,
  listPriceMinor: number | null,
): Checked<{ priceMinor: number; listPriceMinor: number | null }> {
  const priceMinor = parseColones(price);
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500." };
  // A "regular price" stays only while it is still above the new price.
  return {
    input: {
      priceMinor,
      listPriceMinor: listPriceMinor && listPriceMinor > priceMinor ? listPriceMinor : null,
    },
  };
}

export const RESUMED = "Precio guardado. Su oferta está a la venta otra vez.";

// ── An offer on another shop's product, withdrawn for good ──────────────────

export const WITHDRAW_CONFIRM_NEEDED = "Marque la casilla para confirmar que deja de venderlo.";
export const WITHDRAWN =
  "Dejó de venderlo: su oferta ya no aparece en la página del producto. Si quiere volver a venderlo, búsquelo en «Vender uno que ya existe».";

// ── The shop's description ──────────────────────────────────────────────────

export { SHOP_DESCRIPTION_MAX };

/**
 * apps/seller `requestShopDescription`: the text as the database will keep
 * it; "Quitar la descripción" sends an empty one, whatever the field holds.
 */
export function checkShopDescription(text: string, removing: boolean): Checked<string> {
  const cleaned = removing ? "" : (normaliseShopDescription(text) ?? "");
  if (cleaned.length > SHOP_DESCRIPTION_MAX) {
    return {
      error: `La descripción puede tener hasta ${SHOP_DESCRIPTION_MAX} caracteres; esta tiene ${cleaned.length}.`,
    };
  }
  return { input: cleaned };
}

export const descriptionSent = (text: string) =>
  text
    ? "Enviamos la descripción a revisión. Mientras tanto la tienda muestra la que ya tenía."
    : "Pedimos quitar la descripción. Mientras lo revisamos la tienda sigue mostrándola.";
