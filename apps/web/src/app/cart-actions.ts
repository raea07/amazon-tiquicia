"use server";

/**
 * A cart line whose offer can no longer be bought (sold out, paused, its shop
 * no longer selling) swapped for another shop's offer of the same variant,
 * the one the cart page proposed. The cookie holds only offer ids and
 * quantities, so this changes the id and keeps the quantity; prices and
 * stock are read fresh when the cart is shown and again when the order is
 * placed, so the swap cannot change what anything costs.
 */

import { z } from "zod";
import { MAX_UNITS_PER_LINE, readCart, writeCart } from "@/lib/cart";

const swapSchema = z.object({ from: z.uuid(), to: z.uuid() });

export async function swapCartOffer(formData: FormData): Promise<void> {
  const parsed = swapSchema.safeParse({ from: formData.get("from"), to: formData.get("to") });
  if (!parsed.success || parsed.data.from === parsed.data.to) return;
  const { from, to } = parsed.data;

  const cart = await readCart();
  const line = cart.find((item) => item.offerId === from);
  if (!line) return;
  const existing = cart.find((item) => item.offerId === to);
  // The other shop's offer already in the cart: the two lines become one.
  const next = existing
    ? cart
        .filter((item) => item.offerId !== from)
        .map((item) =>
          item.offerId === to
            ? { ...item, quantity: Math.min(item.quantity + line.quantity, MAX_UNITS_PER_LINE) }
            : item,
        )
    : cart.map((item) => (item.offerId === from ? { ...item, offerId: to } : item));
  await writeCart(next);
}
