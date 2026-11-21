/**
 * The cart: a list of offer ids and quantities, kept on the phone.
 *
 * The same rules as the website's cart cookie (apps/web/src/lib/cart.ts): at
 * most 40 lines and 10 units a line, and no prices. Prices and stock are read
 * fresh from the database whenever the cart is shown and again when the order
 * is placed, so nothing stored here can change what anything costs.
 */

export const MAX_LINES = 40;
export const MAX_UNITS_PER_LINE = 10;

/** Used for delivery estimates until the shopper chooses a district: San José centre. */
export const DEFAULT_POSTAL_CODE = "10101";

export interface CartItem {
  offerId: string;
  quantity: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a stored cart. Stored data is input: anything malformed is dropped, never trusted. */
export function parseCart(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const items: CartItem[] = [];
    for (const entry of value.slice(0, MAX_LINES)) {
      const offerId = (entry as { o?: unknown })?.o;
      const quantity = (entry as { q?: unknown })?.q;
      if (typeof offerId !== "string" || !UUID.test(offerId) || seen.has(offerId)) continue;
      if (typeof quantity !== "number" || !Number.isInteger(quantity)) continue;
      if (quantity < 1 || quantity > MAX_UNITS_PER_LINE) continue;
      seen.add(offerId);
      items.push({ offerId, quantity });
    }
    return items;
  } catch {
    return [];
  }
}

/** The stored form: as compact as the web's cookie. */
export const serializeCart = (items: CartItem[]) =>
  JSON.stringify(items.map((item) => ({ o: item.offerId, q: item.quantity })));

export type AddResult =
  | { items: CartItem[]; error?: undefined }
  | { error: string; items?: undefined };

/** Adds units of an offer, capped per line. Same words as the website when the cart is full. */
export function addToCart(items: CartItem[], offerId: string, quantity: number): AddResult {
  if (!UUID.test(offerId) || !Number.isInteger(quantity) || quantity < 1) {
    return { error: "Elija una cantidad válida." };
  }
  const existing = items.find((item) => item.offerId === offerId);
  if (!existing && items.length >= MAX_LINES) {
    return { error: "Su carrito está lleno. Complete este pedido antes de agregar más productos." };
  }
  const next = Math.min((existing?.quantity ?? 0) + quantity, MAX_UNITS_PER_LINE);
  return {
    items: existing
      ? items.map((item) => (item === existing ? { ...item, quantity: next } : item))
      : [...items, { offerId, quantity: Math.min(quantity, MAX_UNITS_PER_LINE) }],
  };
}

/** Sets a line's quantity; zero removes it. */
export function setQuantity(items: CartItem[], offerId: string, quantity: number): CartItem[] {
  if (quantity <= 0) return items.filter((item) => item.offerId !== offerId);
  const capped = Math.min(Math.trunc(quantity), MAX_UNITS_PER_LINE);
  return items.map((item) => (item.offerId === offerId ? { ...item, quantity: capped } : item));
}

export const cartUnits = (items: CartItem[]) =>
  items.reduce((total, item) => total + item.quantity, 0);

/** A district's 5-digit postal code: province 1–7, then four digits. */
export const isPostalCode = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[1-7]\d{4}$/.test(value);
