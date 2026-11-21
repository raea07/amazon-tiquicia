/**
 * The last good answer to a read, kept on the phone so a screen stays
 * readable without a connection (a driver's route in a dead zone).
 *
 * One value per key, stamped with the account it belongs to and when it was
 * saved. It is returned only to that same account and only while it is
 * fresh; anything else reads as nothing. What it holds can be personal data
 * (names, phones, addresses), so apps give it the encrypted store, clear it
 * at sign-out, and keep `maxAgeMs` short.
 */

import type { QueueStore } from "./queue";

export interface Snapshot<T> {
  owner: string;
  savedAt: number;
  value: T;
}

export interface SnapshotCache<T> {
  /** The saved value for this account, or null (none, someone else's, too old, unreadable). */
  load(owner: string): Promise<Snapshot<T> | null>;
  save(owner: string, value: T): Promise<void>;
  clear(): Promise<void>;
}

export function createSnapshotCache<T>(options: {
  store: QueueStore;
  key: string;
  maxAgeMs: number;
  now?: () => number;
}): SnapshotCache<T> {
  const { store, key, maxAgeMs, now = Date.now } = options;
  return {
    async load(owner) {
      try {
        const text = await store.getItem(key);
        if (!text) return null;
        const parsed = JSON.parse(text) as Partial<Snapshot<T>>;
        if (parsed.owner !== owner || typeof parsed.savedAt !== "number") return null;
        if (now() - parsed.savedAt > maxAgeMs || !("value" in parsed)) return null;
        return parsed as Snapshot<T>;
      } catch {
        return null;
      }
    },
    async save(owner, value) {
      const snapshot: Snapshot<T> = { owner, savedAt: now(), value };
      try {
        await store.setItem(key, JSON.stringify(snapshot));
      } catch {
        // A full or locked store: the screen still works, just not offline.
      }
    },
    async clear() {
      try {
        await store.removeItem(key);
      } catch {
        // Nothing stored, or the store is unavailable: nothing to remove.
      }
    },
  };
}
