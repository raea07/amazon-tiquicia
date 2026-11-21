/**
 * The warehouse a worker chose, as kept on the phone. One entry per phone,
 * not one per account: a shared shift phone keeps only the last worker's
 * choice, and none once they sign out. No React Native here, so
 * `choice.test.ts` runs it in Node.
 */
export const STORAGE_KEY = "yuntera-bodega:warehouse";

/** What is written: whose choice it is, and the warehouse. */
export const writeChoice = (userId: string, warehouseId: string) =>
  JSON.stringify({ userId, warehouseId });

/** The saved choice, if it belongs to this account; null for anything else. */
export function readChoice(saved: string | null, userId: string): string | null {
  if (!saved) return null;
  try {
    const value = JSON.parse(saved) as { userId?: unknown; warehouseId?: unknown } | null;
    return value?.userId === userId && typeof value.warehouseId === "string"
      ? value.warehouseId
      : null;
  } catch {
    return null;
  }
}
