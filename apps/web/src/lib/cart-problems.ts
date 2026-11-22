import "server-only";
import type { CartItem } from "@/lib/cart";
import { publicApi } from "@/lib/supabase";

/**
 * When the database refuses an order because a product ran out or is no
 * longer on sale, the shopper is owed which one and what to do next, not a
 * general "one of the products". Read the cart again and name each line that
 * cannot be bought as it is: gone (change it to another shop's offer or
 * remove it, on the cart page) or fewer units left than asked. Null when
 * every line looks fine again (the caller then shows the database's message).
 */
export async function describeCartProblem(cart: CartItem[]): Promise<string | null> {
  const lines = await publicApi().cartLines(cart.map((item) => item.offerId));
  const quantityOf = new Map(cart.map((item) => [item.offerId, item.quantity]));
  const problems: string[] = [];
  let gone = false;
  for (const line of lines) {
    const name = line.title ? `«${line.title}»` : "un producto de su carrito";
    const shop = line.seller_name ? ` de ${line.seller_name}` : "";
    const quantity = quantityOf.get(line.offer_id) ?? 1;
    if (!line.buyable) {
      gone = true;
      problems.push(
        line.seller_name && line.available === 0
          ? `ya no quedan unidades de ${name}${shop}`
          : `${name}${shop} ya no está a la venta`,
      );
    } else if (quantity > line.available) {
      problems.push(
        `de ${name}${shop} quedan ${line.available} ${line.available === 1 ? "unidad" : "unidades"}`,
      );
    }
  }
  if (problems.length === 0) return null;
  const list = problems.join("; ");
  return gone
    ? `No pudimos confirmar el pedido: ${list}. Vuelva al carrito: si otra tienda lo vende, puede cambiarlo por esa oferta; si no, quítelo.`
    : `No pudimos confirmar el pedido: ${list}. Vuelva al carrito y ajuste la cantidad.`;
}
