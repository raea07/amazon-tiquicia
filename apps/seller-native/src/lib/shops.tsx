import type { Roles } from "@yuntera/db";
import { useSession } from "@yuntera/expo-kit/auth";
import { appStorage } from "@yuntera/expo-kit/supabase";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Shop = Roles["sellers"][number];

interface ShopValue {
  /** The shops this account belongs to, as the database reports them (never from the token). */
  shops: Shop[];
  /** The one the person is working in: the one they chose, else the first. */
  shop: Shop | null;
  /** False until the remembered choice has been read, so no other shop flashes first. */
  ready: boolean;
  choose(shopId: string): Promise<void>;
  /** Set right after a new shop was registered from the app, for the welcome message. */
  justRegistered: string | null;
  setJustRegistered(shopId: string | null): void;
}

const ShopContext = createContext<ShopValue | null>(null);

const keyFor = (userId: string) => `yuntera-vende:shop:${userId}`;

/**
 * Which shop the signed-in person is working in. Someone can belong to
 * several, as on the web (apps/seller/src/lib/shop.ts), where a cookie holds
 * the choice. Here the phone remembers it per account. Like the cookie, it is
 * a preference, not a permission: the list of shops comes from the database,
 * a remembered shop the person no longer belongs to is ignored, and every call
 * is checked by the database again.
 */
export function ShopProvider({ children }: { children: ReactNode }) {
  const { viewer, roles } = useSession();
  const userId = viewer?.id ?? null;
  const [chosen, setChosen] = useState<string | null>(null);
  const [readFor, setReadFor] = useState<string | null>(null);
  const [justRegistered, setJustRegistered] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    appStorage
      .getItem(keyFor(userId))
      .catch(() => null)
      .then((value) => {
        if (!active) return;
        setChosen(value);
        setReadFor(userId);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const choose = useCallback(
    async (shopId: string) => {
      setChosen(shopId);
      if (userId) await appStorage.setItem(keyFor(userId), shopId).catch(() => undefined);
    },
    [userId],
  );

  const value = useMemo<ShopValue>(() => {
    const shops = roles?.sellers ?? [];
    return {
      shops,
      shop: shops.find((s) => s.id === chosen) ?? shops[0] ?? null,
      ready: userId !== null && readFor === userId,
      choose,
      justRegistered,
      setJustRegistered,
    };
  }, [roles, chosen, userId, readFor, choose, justRegistered]);

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShops(): ShopValue {
  const value = useContext(ShopContext);
  if (!value) throw new Error("useShops must be used inside <ShopProvider>.");
  return value;
}

/** The shop the screens of the app work on. Only used under the "allowed" guard, where there is one. */
export function useShop(): Shop {
  const { shop } = useShops();
  if (!shop) throw new Error("useShop needs a shop: render it only for a member of one.");
  return shop;
}

/**
 * Query keys for one shop's data. Every change a seller makes refreshes the
 * whole `["seller", shopId]` family, the way the web re-renders its page
 * after an action (`refresh()`), so no screen shows a stale count.
 */
export const shopKey = (shopId: string, ...rest: string[]) => ["seller", shopId, ...rest];
