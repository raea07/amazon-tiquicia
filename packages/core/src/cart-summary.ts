/**
 * The cart's summary when nothing in it can be bought now (every line's offer
 * ran out, was paused or its shop stopped selling). The price check
 * (checkout_quote) still answers with the zone's delivery fee and date, but
 * there is nothing to deliver: the web shop and the shopper app then show no
 * total to pay and no date, and say what to do instead.
 */

/** Whether a cart with these lines has nothing that can be bought now. */
export function cartHasNothingToBuy(lines: ReadonlyArray<{ buyable: boolean }>): boolean {
  return lines.length > 0 && lines.every((line) => !line.buyable);
}

/** What the summary says instead of a total and a date. */
export const NOTHING_TO_BUY_NOTE =
  "Ahora no hay nada en su carrito que se pueda comprar. Cambie cada producto por la oferta de otra tienda, si la hay, o quítelo; entonces le mostramos el total y la fecha de entrega.";
