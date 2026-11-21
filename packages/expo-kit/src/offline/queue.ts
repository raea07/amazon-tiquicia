/**
 * A queue of actions taken on the phone while the API could not be reached,
 * sent later, in the order they were taken, and never applied twice.
 *
 * Built for the drivers' app (arrived at a stop, a failed delivery, position
 * reports) and kept free of anything driver-specific so the warehouse and
 * seller apps can use it later. It holds plain data only: what to send is
 * decided by the app's `send` function, passed to `flush`.
 *
 * The rules, each covered by `queue.test.ts`:
 *
 * - **Order.** Entries are sent one at a time in the order they were added.
 *   When one cannot be delivered (no connection), the pass stops there, so a
 *   later action never overtakes an earlier one.
 * - **Never twice.** Only one pass runs at a time; an entry is removed as soon
 *   as the server has taken it, before the next one is sent, and the removal
 *   is written to storage first. An entry is marked "sending" in storage
 *   before it leaves; if the app dies before the answer arrives, the outcome
 *   is unknown, and on the next start the entry is sent again only if the app
 *   says repeating it is harmless (`repeatable`). Otherwise it is set aside as
 *   rejected with a message, for a person to check.
 * - **A refusal does not block the rest.** An entry the server refuses (the
 *   stop was already closed, the route ended) is kept as "rejected" with the
 *   message to show, and the pass carries on with the next one.
 * - **Survives restarts.** Every change is written to the store it is given
 *   (the encrypted app storage on a phone).
 * - **One account's actions are never sent as another's.** Each entry
 *   records who queued it. Only the signed-in account's entries are shown and
 *   sent; another account's stay stored, untouched, until that account signs
 *   in again on this phone or they expire (`maxAgeMs`).
 * - **Coalescing.** An entry added with a `coalesce` key replaces a pending
 *   entry of the same account with the same key (only the latest position
 *   matters), so a long time offline does not pile up hundreds of reports.
 */

/** What the queue needs from storage. AsyncStorage and the kit's storages fit as they are. */
export interface QueueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type EntryStatus = "pending" | "sending" | "rejected";

export interface QueueEntry<P = unknown> {
  id: string;
  /** The account that queued it (the user id). */
  owner: string;
  /** What kind of action this is, for the app's `send` ("arrive", "position"…). */
  kind: string;
  payload: P;
  /** When it was queued, in milliseconds since 1970. */
  createdAt: number;
  coalesce?: string;
  status: EntryStatus;
  /** Times a pass tried it and got no answer. */
  attempts: number;
  /** For a rejected entry: what to tell the person. */
  message?: string;
}

/** What happened when the app tried to send one entry. */
export type SendOutcome =
  /** The server took it (or it had already been applied). It leaves the queue. */
  | { result: "done" }
  /** No answer: no connection, a timeout. It stays, and the pass stops here. */
  | { result: "offline" }
  /** The server answered no. It is kept aside with the message, and the pass goes on. */
  | { result: "rejected"; message: string };

export type Send = (entry: QueueEntry) => Promise<SendOutcome>;

export interface FlushResult {
  sent: number;
  rejected: number;
  /** True when the pass stopped because an entry could not be delivered. */
  offline: boolean;
  /** Pending entries of the current account left after the pass. */
  remaining: number;
}

export interface QueueSnapshot {
  owner: string | null;
  /** The current account's entries, oldest first. */
  entries: readonly QueueEntry[];
  pending: number;
  rejected: number;
  flushing: boolean;
  /** How the last pass ended, if one has run since the app started. */
  lastFlush: FlushResult | null;
}

export interface QueueOptions {
  store: QueueStore;
  /** The storage key. One per app and purpose, e.g. "yuntera-ruta.queue.v1". */
  key: string;
  /** Whether sending this entry again after an unknown outcome is harmless. */
  repeatable?: (entry: QueueEntry) => boolean;
  /** Shown for an entry set aside because its outcome is unknown and it may not be repeated. */
  unknownOutcomeMessage?: string;
  /** Shown for an entry that failed in an unexpected way too many times. */
  failedMessage?: string;
  /** Entries older than this are dropped when the queue is read. */
  maxAgeMs?: number;
  /** Times an entry may throw (a bug, not a lack of signal) before it is set aside. */
  maxAttempts?: number;
  now?: () => number;
  newId?: () => string;
}

const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
function defaultId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isEntry(value: unknown): value is QueueEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.owner === "string" &&
    typeof entry.kind === "string" &&
    typeof entry.createdAt === "number" &&
    (entry.status === "pending" || entry.status === "sending" || entry.status === "rejected")
  );
}

export interface OfflineQueue {
  /** Reads the stored queue. Every other method waits for it; calling it again does nothing. */
  load(): Promise<void>;
  /** Who is signed in (null: nobody). Only their entries are shown and sent. */
  setOwner(owner: string | null): Promise<void>;
  /** Adds an action for the signed-in account. Throws if nobody is signed in. */
  enqueue<P>(kind: string, payload: P, options?: { coalesce?: string }): Promise<QueueEntry<P>>;
  /** Sends the signed-in account's pending entries, in order. One pass at a time. */
  flush(send: Send): Promise<FlushResult>;
  /** Removes one entry of the signed-in account (a rejected one, once read). */
  dismiss(id: string): Promise<void>;
  /** Removes the entries that match, whoever queued them. */
  discard(match: (entry: QueueEntry) => boolean): Promise<void>;
  snapshot(): QueueSnapshot;
  subscribe(listener: () => void): () => void;
}

export function createOfflineQueue(options: QueueOptions): OfflineQueue {
  const {
    store,
    key,
    repeatable = () => false,
    unknownOutcomeMessage = "No sabemos si esta acción llegó. Revísela antes de repetirla.",
    failedMessage = "No pudimos enviar esta acción. Revísela antes de repetirla.",
    maxAgeMs = DAY,
    maxAttempts = 5,
    now = Date.now,
    newId = defaultId,
  } = options;

  let entries: QueueEntry[] = [];
  let owner: string | null = null;
  let flushing: Promise<FlushResult> | null = null;
  let lastFlush: FlushResult | null = null;
  let loading: Promise<void> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let cached: QueueSnapshot | null = null;
  const listeners = new Set<() => void>();

  const changed = () => {
    cached = null;
    for (const listener of listeners) listener();
  };

  /** Writes the whole queue, one write after another, so an older state never lands last. */
  const persist = () => {
    const text = JSON.stringify(entries);
    writing = writing
      .then(() => (entries.length === 0 ? store.removeItem(key) : store.setItem(key, text)))
      // Storage that refuses a write (full, locked) must not stop the queue in
      // memory; the next change tries again.
      .catch(() => undefined);
    return writing;
  };

  const load = () => {
    loading ??= (async () => {
      let stored: unknown = [];
      try {
        const text = await store.getItem(key);
        stored = text ? JSON.parse(text) : [];
      } catch {
        stored = [];
      }
      const oldest = now() - maxAgeMs;
      const fromStore = (Array.isArray(stored) ? stored : []).filter(isEntry);
      // Entries added before the stored ones were read are newer: they go after.
      entries = [...fromStore, ...entries]
        .filter((entry) => entry.createdAt >= oldest)
        .map((entry): QueueEntry => {
          if (entry.status !== "sending") return entry;
          // The app stopped while this was on its way: did it arrive?
          return repeatable(entry)
            ? { ...entry, status: "pending" }
            : { ...entry, status: "rejected", message: unknownOutcomeMessage };
        });
      await persist();
      changed();
    })();
    return loading;
  };

  const mine = () => (owner === null ? [] : entries.filter((entry) => entry.owner === owner));

  const replace = (id: string, next: QueueEntry | null) => {
    entries = next
      ? entries.map((entry) => (entry.id === id ? next : entry))
      : entries.filter((entry) => entry.id !== id);
  };

  async function pass(send: Send): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, rejected: 0, offline: false, remaining: 0 };
    const account = owner;
    while (account !== null && owner === account) {
      const next = entries.find((entry) => entry.owner === account && entry.status === "pending");
      if (!next) break;
      const sending: QueueEntry = { ...next, status: "sending" };
      replace(next.id, sending);
      await persist();
      changed();

      let outcome: SendOutcome;
      try {
        outcome = await send(sending);
      } catch {
        // `send` is meant to answer, not throw. A throw is a bug or something
        // unforeseen: try again later, but not for ever.
        const attempts = sending.attempts + 1;
        const failed = attempts >= maxAttempts;
        replace(sending.id, {
          ...sending,
          attempts,
          status: failed ? "rejected" : "pending",
          ...(failed ? { message: failedMessage } : {}),
        });
        await persist();
        changed();
        if (failed) {
          result.rejected += 1;
          continue;
        }
        result.offline = true;
        break;
      }

      if (outcome.result === "done") {
        replace(sending.id, null);
        result.sent += 1;
      } else if (outcome.result === "rejected") {
        replace(sending.id, { ...sending, status: "rejected", message: outcome.message });
        result.rejected += 1;
      } else {
        replace(sending.id, { ...sending, status: "pending", attempts: sending.attempts + 1 });
        result.offline = true;
      }
      await persist();
      changed();
      if (result.offline) break;
    }
    result.remaining = mine().filter((entry) => entry.status === "pending").length;
    return result;
  }

  return {
    load,

    async setOwner(next) {
      await load();
      if (owner === next) return;
      owner = next;
      lastFlush = null;
      changed();
    },

    async enqueue<P>(kind: string, payload: P, opts: { coalesce?: string } = {}) {
      await load();
      if (owner === null)
        throw new Error("Nobody is signed in: there is no one to queue this for.");
      const entry: QueueEntry<P> = {
        id: newId(),
        owner,
        kind,
        payload,
        createdAt: now(),
        status: "pending",
        attempts: 0,
        ...(opts.coalesce ? { coalesce: opts.coalesce } : {}),
      };
      if (opts.coalesce) {
        const account = owner;
        entries = entries.filter(
          (other) =>
            !(
              other.owner === account &&
              other.coalesce === opts.coalesce &&
              other.status === "pending"
            ),
        );
      }
      entries = [...entries, entry];
      await persist();
      changed();
      return entry;
    },

    async flush(send) {
      await load();
      if (flushing) return flushing;
      flushing = (async () => {
        changed();
        try {
          const result = await pass(send);
          lastFlush = result;
          return result;
        } finally {
          flushing = null;
          changed();
        }
      })();
      return flushing;
    },

    async dismiss(id) {
      await load();
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || entry.owner !== owner || entry.status === "sending") return;
      replace(id, null);
      await persist();
      changed();
    },

    async discard(match) {
      await load();
      const before = entries.length;
      entries = entries.filter((entry) => entry.status === "sending" || !match(entry));
      if (entries.length === before) return;
      await persist();
      changed();
    },

    snapshot() {
      if (cached) return cached;
      const list = mine();
      cached = {
        owner,
        entries: list,
        pending: list.filter((entry) => entry.status !== "rejected").length,
        rejected: list.filter((entry) => entry.status === "rejected").length,
        flushing: flushing !== null,
        lastFlush,
      };
      return cached;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
