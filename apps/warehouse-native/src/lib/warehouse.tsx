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
import { readChoice, STORAGE_KEY, writeChoice } from "./choice";

export type Warehouse = Roles["warehouses"][number];

interface WarehouseValue {
  /** The warehouse the worker is working in now. */
  warehouse: Warehouse;
  /** Every warehouse this account is assigned to. */
  warehouses: Warehouse[];
  choose(id: string): void;
}

const WarehouseContext = createContext<WarehouseValue | null>(null);

/** Removes the saved choice: called when the worker signs out. */
export function forgetWarehouse() {
  appStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/**
 * Which warehouse the worker is in. Someone assigned to several chooses on
 * the board; the choice is kept on the phone (one entry, for the account
 * signed in, removed at sign-out) and falls back to the first assignment if
 * that assignment is removed.
 * The database still checks the assignment on every call.
 */
export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { roles, viewer } = useSession();
  const warehouses = useMemo(() => roles?.warehouses ?? [], [roles]);
  const [chosen, setChosen] = useState<string | null>(null);
  const userId = viewer?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    appStorage
      .getItem(STORAGE_KEY)
      .then((saved) => {
        const id = readChoice(saved, userId);
        if (live && id) setChosen(id);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [userId]);

  const choose = useCallback(
    (id: string) => {
      setChosen(id);
      if (userId) {
        appStorage.setItem(STORAGE_KEY, writeChoice(userId, id)).catch(() => {});
      }
    },
    [userId],
  );

  const warehouse = warehouses.find((w) => w.id === chosen) ?? warehouses[0];
  const value = useMemo(
    () => (warehouse ? { warehouse, warehouses, choose } : null),
    [warehouse, warehouses, choose],
  );
  // The root layout shows these screens only to someone with an assignment.
  if (!value) return null;
  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse(): WarehouseValue {
  const value = useContext(WarehouseContext);
  if (!value) throw new Error("useWarehouse outside WarehouseProvider");
  return value;
}

/** Query keys of the floor, shared by the screens that read and refresh them. */
export const keys = {
  board: (warehouseId: string) => ["wms-board", warehouseId] as const,
  locations: (warehouseId: string) => ["wms-locations", warehouseId] as const,
  shipment: (shipmentId: string) => ["wms-shipment", shipmentId] as const,
  lookup: (warehouseId: string, code: string) => ["wms-sku", warehouseId, code] as const,
  returning: (warehouseId: string) => ["wms-returning", warehouseId] as const,
  stockLocations: (warehouseId: string) => ["wms-stock-locations", warehouseId] as const,
  location: (warehouseId: string, code: string) => ["wms-location", warehouseId, code] as const,
};
