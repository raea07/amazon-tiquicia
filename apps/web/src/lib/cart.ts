import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";

/**
 * The cart lives in a cookie: a list of offer ids and quantities, nothing else.
 *
 * Why a cookie and not a database table: a visitor can fill a cart before
 * having an account, browsing costs no database writes, and there is nothing
 * to clean up. Prices are deliberately NOT stored here — they are read fresh
 * from the database every time the cart is shown and again when the order is
 * placed, so editing the cookie cannot change what anything costs.
 */

const CART_COOKIE = "yt_cart";
const LOCATION_COOKIE = "yt_cp";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export const MAX_LINES = 40;
export const MAX_UNITS_PER_LINE = 10;

/** Used for delivery estimates until the shopper chooses their district: San José centre. */
export const DEFAULT_POSTAL_CODE = "10101";

const cartSchema = z
  .array(
    z.object({
      o: z.uuid(),
      q: z.number().int().min(1).max(MAX_UNITS_PER_LINE),
    }),
  )
  .max(MAX_LINES);

export interface CartItem {
  offerId: string;
  quantity: number;
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: THIRTY_DAYS,
} as const;

export async function readCart(): Promise<CartItem[]> {
  const raw = (await cookies()).get(CART_COOKIE)?.value;
  if (!raw) return [];
  try {
    // A cookie is user input: anything that does not parse is treated as empty.
    return cartSchema.parse(JSON.parse(raw)).map((line) => ({ offerId: line.o, quantity: line.q }));
  } catch {
    return [];
  }
}

export async function writeCart(items: CartItem[]): Promise<void> {
  const store = await cookies();
  if (items.length === 0) {
    store.delete(CART_COOKIE);
    return;
  }
  const compact = items.slice(0, MAX_LINES).map((item) => ({
    o: item.offerId,
    q: Math.min(Math.max(1, Math.trunc(item.quantity)), MAX_UNITS_PER_LINE),
  }));
  store.set(CART_COOKIE, JSON.stringify(compact), cookieOptions);
}

export const cartUnits = (items: CartItem[]) =>
  items.reduce((total, item) => total + item.quantity, 0);

/** The district the shopper wants deliveries estimated for, and whether they chose it. */
export async function readLocation(): Promise<{ postalCode: string; chosen: boolean }> {
  const value = (await cookies()).get(LOCATION_COOKIE)?.value;
  return value && /^[1-7]\d{4}$/.test(value)
    ? { postalCode: value, chosen: true }
    : { postalCode: DEFAULT_POSTAL_CODE, chosen: false };
}

export async function writeLocation(postalCode: string): Promise<void> {
  (await cookies()).set(LOCATION_COOKIE, postalCode, { ...cookieOptions, maxAge: THIRTY_DAYS * 6 });
}
