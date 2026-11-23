/**
 * What the cart says about a line that can no longer be bought, in the
 * website's words (apps/web/src/app/carrito/page.tsx, `UnavailableLine`), and
 * the delivery date of another shop's offer, as the product page says it.
 *
 * Pure, with no React Native import, so `cart-wording.test.ts` checks it.
 */

import { format, money } from "@yuntera/core";
import type { CartAlternative, CartLine } from "@yuntera/db";

const formatPrice = (amountMinor: number) => format(money(amountMinor));

export interface UnavailableNote {
  title: string;
  body: string;
  /** The swap button's words, when another shop sells the same variant. */
  swapLabel?: string;
}

/**
 * Whose offer ran out and, when another shop sells the same variant, who and
 * at what price (the price the cart and the checkout then charge, read fresh
 * from the same offer). Otherwise, that it is gone and what to do.
 */
export function unavailableNote(
  line: Pick<CartLine, "title" | "seller_name" | "available">,
  alternative: Pick<
    CartAlternative,
    "title" | "variant_name" | "seller_name" | "price_minor" | "available"
  > | null,
  quantity: number,
): UnavailableNote {
  if (!alternative) {
    return {
      title: line.title ?? "Producto no disponible",
      body: `${
        line.seller_name
          ? `La oferta de ${line.seller_name} ya no está disponible`
          : "Ya no está disponible"
      } y ninguna otra tienda lo vende ahora. Quítelo para continuar con su compra.`,
    };
  }
  const what = `${alternative.title}${alternative.variant_name ? `, ${alternative.variant_name}` : ""}`;
  const soldOut = Boolean(line.seller_name) && line.available === 0;
  const gone = line.seller_name
    ? soldOut
      ? `La oferta de ${line.seller_name} se agotó.`
      : `La oferta de ${line.seller_name} ya no está a la venta.`
    : "La oferta que eligió ya no está a la venta.";
  const fewer = quantity > alternative.available ? ` (le quedan ${alternative.available})` : "";
  return {
    title: what,
    body: `${gone} ${alternative.seller_name} lo vende a ${formatPrice(alternative.price_minor)}${fewer}.`,
    swapLabel: `Cambiar a la oferta de ${alternative.seller_name}`,
  };
}

/** The line under the cart when something cannot be bought (the website's words). */
export const unavailableFooter = (anyAlternative: boolean) =>
  anyAlternative
    ? "Cambie o quite los productos que ya no están disponibles para continuar. El total cambia cuando lo haga."
    : "Quite los productos no disponibles para continuar. El total cambia cuando lo haga.";

/** "Llega el martes 24 de noviembre", or a range, as the product page says it. */
export function arrivalText(
  promise: { earliest: string; latest: string },
  day: (value: string) => string,
): string {
  return promise.earliest === promise.latest
    ? `Llega el ${day(promise.latest)}`
    : `Llega entre el ${day(promise.earliest)} y el ${day(promise.latest)}`;
}
