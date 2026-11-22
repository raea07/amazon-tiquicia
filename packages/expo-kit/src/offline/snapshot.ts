/**
 * The last good answer to a read, kept on the phone so a screen stays
 * readable without a connection (a driver's route in a dead zone).
 *
 * One value per key, stamped with the account it belongs to and when it was
 * saved. It is returned only to that same account and only while it is
 * fresh. Anything else is not just hidden but removed from the store when it
 * is next read: a value saved by another account (a change of account on a
 * shared phone), one older than `maxAgeMs`, or one that cannot be read.
 * `prune()` does the same when nobody is signed in, so an expired value does
 * not wait on the phone for the next sign-in.
 *
 * What it holds can be other people's personal data (names, phones,
 * addresses). The kit ships no cipher (docs/02-architecture/decisions.md
 * §18), so the app chooses the store: the operating system encrypts ordinary
 * app storage with the device and keeps it to the app
 * (docs/05-security-compliance/privacy.md says what the drivers' app keeps
 * there and for how long). Apps save as little as the screen needs, clear it
 * at sign-out and when access is lost, and keep `maxAgeMs` short. Nothing
 * here writes to the log.
 */

import type { QueueStore } from "./queue";

export interface Snapshot<T> {
  owner: string;
  savedAt: number;
  value: T;
}

export interface SnapshotCache<T> {
  /**
   * The saved value for this account, or null. A value that is someone
   * else's, too old or unreadable is removed from the store as well.
   */
  load(owner: string): Promise<Snapshot<T> | null>;
  save(owner: string, value: T): Promise<void>;
  /** Removes a value that is too old or unreadable, whoever saved it. */
  prune(): Promise<void>;
  clear(): Promise<void>;
}

type Read<T> =
  | { kind: "none" }
  | { kind: "bad" }
  | { kind: "ok"; snapshot: Snapshot<T>; expired: boolean };

export function createSnapshotCache<T>(options: {
  store: QueueStore;
  key: string;
  maxAgeMs: number;
  now?: () => number;
}): SnapshotCache<T> {
  const { store, key, maxAgeMs, now = Date.now } = options;

  async function read(): Promise<Read<T>> {
    let text: string | null;
    try {
      text = await store.getItem(key);
    } catch {
      return { kind: "none" }; // the store did not answer: nothing to show, nothing known to remove
    }
    if (!text) return { kind: "none" };
    try {
      const parsed = JSON.parse(text) as Partial<Snapshot<T>>;
      if (
        typeof parsed.owner !== "string" ||
        typeof parsed.savedAt !== "number" ||
        !("value" in parsed)
      ) {
        return { kind: "bad" };
      }
      const age = now() - parsed.savedAt;
      return { kind: "ok", snapshot: parsed as Snapshot<T>, expired: age > maxAgeMs || age < 0 };
    } catch {
      return { kind: "bad" };
    }
  }

  async function remove(): Promise<void> {
    try {
      await store.removeItem(key);
    } catch {
      // Nothing stored, or the store is unavailable: the next read tries again.
    }
  }

  return {
    async load(owner) {
      const found = await read();
      if (found.kind === "none") return null;
      if (found.kind === "bad" || found.expired || found.snapshot.owner !== owner) {
        await remove();
        return null;
      }
      return found.snapshot;
    },
    async save(owner, value) {
      const snapshot: Snapshot<T> = { owner, savedAt: now(), value };
      try {
        await store.setItem(key, JSON.stringify(snapshot));
      } catch {
        // A full or locked store: the screen still works, just not offline.
      }
    },
    async prune() {
      const found = await read();
      if (found.kind === "bad" || (found.kind === "ok" && found.expired)) await remove();
    },
    clear: remove,
  };
}
