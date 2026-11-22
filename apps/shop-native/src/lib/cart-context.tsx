import { appStorage } from "@yuntera/expo-kit/supabase";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addToCart,
  type CartItem,
  cartUnits,
  DEFAULT_POSTAL_CODE,
  isPostalCode,
  parseCart,
  serializeCart,
  setQuantity,
} from "./cart";

const CART_KEY = "yt_cart";
const LOCATION_KEY = "yt_cp";

interface CartValue {
  ready: boolean;
  items: CartItem[];
  units: number;
  /** Returns an error message, or null when the units were added. */
  add(offerId: string, quantity: number): string | null;
  setQuantity(offerId: string, quantity: number): void;
  clear(): void;
  /** The district deliveries are estimated for, and whether the shopper chose it. */
  postalCode: string;
  locationChosen: boolean;
  setLocation(postalCode: string): void;
  /** Empties the cart and forgets the district, here and on the phone (after an account deletion). */
  forget(): Promise<void>;
}

const CartContext = createContext<CartValue | null>(null);

/** The cart and the chosen district, kept on this phone between launches. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [location, setLocationState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    let active = true;
    Promise.all([appStorage.getItem(CART_KEY), appStorage.getItem(LOCATION_KEY)])
      .then(([cart, postalCode]) => {
        if (!active) return;
        setItems(parseCart(cart));
        setLocationState(isPostalCode(postalCode) ? postalCode : null);
      })
      .catch(() => undefined)
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: CartItem[]) => {
    setItems(next);
    itemsRef.current = next;
    const write =
      next.length === 0
        ? appStorage.removeItem(CART_KEY)
        : appStorage.setItem(CART_KEY, serializeCart(next));
    write.catch(() => undefined);
  }, []);

  const value = useMemo<CartValue>(
    () => ({
      ready,
      items,
      units: cartUnits(items),
      add: (offerId, quantity) => {
        const result = addToCart(itemsRef.current, offerId, quantity);
        if (!result.items) return result.error;
        persist(result.items);
        return null;
      },
      setQuantity: (offerId, quantity) => persist(setQuantity(itemsRef.current, offerId, quantity)),
      clear: () => persist([]),
      postalCode: location ?? DEFAULT_POSTAL_CODE,
      locationChosen: location !== null,
      setLocation: (postalCode) => {
        if (!isPostalCode(postalCode)) return;
        setLocationState(postalCode);
        appStorage.setItem(LOCATION_KEY, postalCode).catch(() => undefined);
      },
      forget: async () => {
        setItems([]);
        itemsRef.current = [];
        setLocationState(null);
        await Promise.all([appStorage.removeItem(CART_KEY), appStorage.removeItem(LOCATION_KEY)]);
      },
    }),
    [ready, items, location, persist],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>.");
  return value;
}
