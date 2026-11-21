/**
 * Session storage for the phones: the session lives in the platform's secure
 * store alone (the Keychain on iOS, Keystore-encrypted storage on Android,
 * through expo-secure-store). The app ships no cipher of its own; all the
 * encryption is the operating system's (decisions.md §18).
 *
 * The secure store is meant for small values. Expo's documentation says "some
 * iOS releases refused values above roughly 2048 bytes" and that Expo enforces
 * no limit; a Supabase session (two tokens and the user) is larger. So a value
 * is split into pieces of at most `PIECE_BYTES` bytes of UTF-8 (what the iOS
 * module stores: `value.data(using: .utf8)`), never splitting a character, and
 * a small manifest records which pieces make up the value.
 *
 * Layout for a Supabase key K (each name made safe by `secureStoreKey`):
 *
 *   K_m       manifest: {"v":1,"s":"x"|"y"|null,"n":pieces,"b":bytes,"h":checksum,"x":k,"y":k}
 *   K_px0…    pieces of slot x
 *   K_py0…    pieces of slot y
 *
 * The two slots alternate: a new value is written into the slot the current
 * manifest does not point to, and the manifest is rewritten last, in one
 * secure-store write. So at every moment the manifest points to a complete
 * value, or says there is none. Before pieces are written beyond what a slot
 * has held, the manifest first records the new upper bound ("x"/"y"), so every
 * piece that may exist is known and can be deleted later, even after a crash.
 * Byte length and a checksum (FNV-1a, a hash for detecting mistakes, not
 * cryptography) confirm that the pieces read back are the ones the manifest
 * describes; anything else reads as signed out and is cleaned up.
 *
 * Every call goes through one queue, so two overlapping calls never interleave.
 * The last value read or written is kept in memory, because supabase-js reads
 * the session before every API call and each secure-store read is a native
 * call. Only this queue writes these names: a second JavaScript runtime
 * writing the same session at the same time is not supported.
 *
 * The first call for a key in an installation (no marker in ordinary storage)
 * removes what the previous, encrypting adapter left (the ciphertext in
 * ordinary storage and its key in the secure store) and any pieces that
 * survived an uninstall in the iOS Keychain, then writes the marker. The person
 * signs in again once after this update, and after a reinstall, as before.
 *
 * The stores are passed in, so the logic is tested with fakes
 * (`secure-session-storage.test.ts`); `session-storage.ts` wires the real ones.
 */

/** The three calls supabase-js makes on its `auth.storage`. */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SecureSessionStorageDeps {
  /** The platform's secure store. Names passed to it are already safe. */
  secure: SessionStorage;
  /**
   * Ordinary app storage. Holds only the non-secret marker that this
   * installation has cleaned up, and the old adapter's leftovers to delete.
   */
  plain: SessionStorage;
}

/**
 * Largest piece in UTF-8 bytes: half the 2048 bytes some iOS releases refused,
 * so a piece stays clear of that limit whatever the store adds of its own.
 */
export const PIECE_BYTES = 1024;
/** Most pieces per value (64 KiB). A session is a few KiB. */
export const MAX_PIECES = 64;
/** Marks an installation whose leftovers were cleaned up. */
export const FORMAT_MARKER = "secure-store-1";

type Slot = "x" | "y";
const SLOTS: readonly Slot[] = ["x", "y"];

interface Manifest {
  v: 1;
  /** The slot holding the value, or null when there is none (a sign-out under way). */
  s: Slot | null;
  /** Number of pieces of the value. */
  n: number;
  /** UTF-8 length of the value. */
  b: number;
  /** Checksum of the value. */
  h: string;
  /** Upper bound of pieces that may exist in each slot. */
  x: number;
  y: number;
}

const ALLOWED = /^[A-Za-z0-9.-]$/;

/**
 * A name the secure store accepts ("alphanumeric characters, `.`, `-`, and
 * `_`", checked by expo-secure-store as /^[\w.-]+$/). Letters, digits, "." and
 * "-" are kept; any other character, "_" included, becomes "_" and two
 * upper-case hex digits per UTF-8 byte, so two different keys never share a
 * name. The suffixes added to it ("_m", "_px", "_py") start with a letter that
 * is not a hex digit, so they cannot be confused with an escape.
 */
export function secureStoreKey(key: string): string {
  if (key.length === 0) throw new Error("A storage key must not be empty.");
  let out = "";
  for (const char of key) {
    if (ALLOWED.test(char)) {
      out += char;
      continue;
    }
    for (const byte of utf8Bytes(char))
      out += `_${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** The name the previous, encrypting adapter used for its key (lossy). */
export function legacySecureKeyName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** The ordinary-storage name of the clean-up marker for a key. */
export function markerKey(key: string): string {
  return `yuntera.session-storage.${key}`;
}

function utf8Bytes(char: string): number[] {
  const cp = char.codePointAt(0) ?? 0;
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
  return [
    0xf0 | (cp >> 18),
    0x80 | ((cp >> 12) & 0x3f),
    0x80 | ((cp >> 6) & 0x3f),
    0x80 | (cp & 0x3f),
  ];
}

/** UTF-8 length of one character (a code point). */
function charBytes(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** UTF-8 length of a string. */
export function utf8Length(value: string): number {
  let total = 0;
  for (const char of value) total += charBytes(char.codePointAt(0) ?? 0);
  return total;
}

/**
 * Splits a value into pieces of at most `limit` UTF-8 bytes without cutting a
 * character in two. Refuses a lone surrogate, which UTF-8 cannot carry: the
 * store would give back a different string.
 */
export function splitUtf8(value: string, limit = PIECE_BYTES): string[] {
  const pieces: string[] = [];
  let current = "";
  let size = 0;
  for (const char of value) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new Error("The value has a lone surrogate and cannot be stored as UTF-8.");
    }
    const bytes = charBytes(cp);
    if (size + bytes > limit) {
      pieces.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  if (current.length > 0 || pieces.length === 0) pieces.push(current);
  return pieces;
}

/** FNV-1a over the UTF-16 code units: detects a mixture, not an attacker. */
function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const isCount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

/** The manifest, or "invalid" when the text is not one this module writes. */
function parseManifest(text: string): Manifest | "invalid" {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "invalid";
  }
  if (!raw || typeof raw !== "object") return "invalid";
  const m = raw as Record<string, unknown>;
  if (m.v !== 1) return "invalid";
  if (!(m.s === null || m.s === "x" || m.s === "y")) return "invalid";
  if (!isCount(m.x, MAX_PIECES) || !isCount(m.y, MAX_PIECES)) return "invalid";
  if (typeof m.h !== "string" || !isCount(m.b, MAX_PIECES * PIECE_BYTES)) return "invalid";
  if (!isCount(m.n, MAX_PIECES)) return "invalid";
  if (m.s !== null && (m.n < 1 || m.n > (m.s === "x" ? m.x : m.y))) return "invalid";
  return m as unknown as Manifest;
}

export function createSecureSessionStorage({
  secure,
  plain,
}: SecureSessionStorageDeps): SessionStorage {
  let tail: Promise<unknown> = Promise.resolve();
  /** Runs calls one after another, whatever each one's outcome. */
  function queued<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  }

  /** Keys whose installation clean-up has run in this process. */
  const ready = new Set<string>();
  /** The last value known to be stored, per key; absent means "read the store". */
  const cache = new Map<string, string | null>();

  const names = (key: string) => {
    const base = secureStoreKey(key);
    return {
      manifest: `${base}_m`,
      piece: (slot: Slot, index: number) => `${base}_p${slot}${index}`,
    };
  };

  async function readManifest(key: string): Promise<Manifest | "invalid" | null> {
    const text = await secure.getItem(names(key).manifest);
    return text === null ? null : parseManifest(text);
  }

  /** Whether pieces exist although there is no manifest (the first of each slot is checked). */
  async function strayPieces(key: string): Promise<boolean> {
    const name = names(key);
    for (const slot of SLOTS) {
      if ((await secure.getItem(name.piece(slot, 0))) !== null) return true;
    }
    return false;
  }

  /** Deletes the pieces of a slot from `from` up to `to`; resolves to whether all went. */
  async function deletePieces(key: string, slot: Slot, from: number, to: number): Promise<boolean> {
    const name = names(key);
    let ok = true;
    for (let index = from; index < to; index++) {
      try {
        await secure.removeItem(name.piece(slot, index));
      } catch {
        ok = false; // keep going: every piece is attempted
      }
    }
    return ok;
  }

  /**
   * Removes everything stored for a key. With a readable manifest only the
   * pieces it may cover are deleted; without one, every possible piece.
   * Resolves to whether the stored value is now unreadable.
   */
  async function purge(key: string, known?: Manifest | "invalid" | null): Promise<boolean> {
    const manifest =
      known === undefined ? await readManifest(key).catch(() => "invalid" as const) : known;
    const name = names(key);
    let unreadable = false;
    if (manifest !== null && manifest !== "invalid" && manifest.s !== null) {
      // Make the value unreadable first: a tombstone that keeps the bounds.
      try {
        await secure.setItem(
          name.manifest,
          JSON.stringify({ ...manifest, s: null, n: 0, b: 0, h: "" }),
        );
        unreadable = true;
      } catch {
        // carry on: deleting the pieces or the manifest also makes it unreadable
      }
    } else {
      unreadable = true; // no value to read (none, a tombstone, or not a manifest)
    }
    const bounds =
      manifest === null
        ? (await strayPieces(key).catch(() => true))
          ? { x: MAX_PIECES, y: MAX_PIECES }
          : { x: 0, y: 0 }
        : manifest === "invalid"
          ? { x: MAX_PIECES, y: MAX_PIECES }
          : { x: manifest.x, y: manifest.y };
    const deleted = {
      x: await deletePieces(key, "x", 0, bounds.x),
      y: await deletePieces(key, "y", 0, bounds.y),
    };
    if (deleted.x && deleted.y) {
      try {
        await secure.removeItem(name.manifest);
        unreadable = true;
      } catch {
        // the tombstone (if written) keeps the bounds for the next attempt
      }
    } else if (
      manifest !== null &&
      manifest !== "invalid" &&
      manifest.s !== null &&
      deleted[manifest.s]
    ) {
      unreadable = true; // the value's own pieces are gone
    }
    return unreadable;
  }

  /** Once per key and installation: remove the old adapter's leftovers and any Keychain survivors. */
  async function prepare(key: string): Promise<void> {
    if (ready.has(key)) return;
    if ((await plain.getItem(markerKey(key))) !== FORMAT_MARKER) {
      // The previous adapter: ciphertext in ordinary storage, key in the secure store.
      await plain.removeItem(key);
      await secure.removeItem(legacySecureKeyName(key));
      // Pieces from before an uninstall (the iOS Keychain keeps them) or from a crash.
      if (!(await purge(key))) throw new Error("The stored session could not be removed.");
      await plain.setItem(markerKey(key), FORMAT_MARKER);
    }
    ready.add(key);
  }

  async function read(key: string): Promise<string | null> {
    const manifest = await readManifest(key);
    if (manifest === null) {
      if (await strayPieces(key)) await purge(key, null).catch(() => false);
      return null;
    }
    if (manifest === "invalid" || manifest.s === null) {
      // Not a manifest, or a sign-out that did not finish: finish it.
      await purge(key, manifest).catch(() => false);
      return null;
    }
    const name = names(key);
    let value = "";
    for (let index = 0; index < manifest.n; index++) {
      const piece = await secure.getItem(name.piece(manifest.s, index));
      if (piece === null) {
        await purge(key, manifest).catch(() => false);
        return null;
      }
      value += piece;
    }
    if (utf8Length(value) !== manifest.b || checksum(value) !== manifest.h) {
      await purge(key, manifest).catch(() => false);
      return null;
    }
    return value;
  }

  async function write(key: string, value: string): Promise<void> {
    const pieces = splitUtf8(value);
    if (pieces.length > MAX_PIECES) {
      throw new Error(`The value is larger than ${MAX_PIECES * PIECE_BYTES} bytes.`);
    }
    const name = names(key);
    let current = await readManifest(key);
    if (current === "invalid") {
      if (!(await purge(key, current)))
        throw new Error("The stored session could not be replaced.");
      current = null;
    }
    const bounds = { x: current?.x ?? 0, y: current?.y ?? 0 };
    // Into the slot the manifest does not point to; it may hold a crashed write's pieces.
    const slot: Slot = current?.s === "x" ? "y" : "x";
    const base = current ?? { v: 1 as const, s: null, n: 0, b: 0, h: "" };

    // 1. Record the new upper bound before writing beyond it.
    if (bounds[slot] < pieces.length) {
      bounds[slot] = pieces.length;
      await secure.setItem(name.manifest, JSON.stringify({ ...base, ...bounds }));
    }
    // 2. The pieces. The manifest still points to the previous value.
    for (const [index, piece] of pieces.entries()) {
      await secure.setItem(name.piece(slot, index), piece);
    }
    // 3. The manifest, in one write: from here on the new value is the stored one.
    const committed: Manifest = {
      v: 1,
      s: slot,
      n: pieces.length,
      b: utf8Length(value),
      h: checksum(value),
      ...bounds,
    };
    await secure.setItem(name.manifest, JSON.stringify(committed));

    // 4. Tidy up: the other slot, and pieces beyond the new value in this one.
    const other: Slot = slot === "x" ? "y" : "x";
    if (bounds[other] > 0 || bounds[slot] > pieces.length) {
      const cleared =
        (await deletePieces(key, other, 0, bounds[other])) &&
        (await deletePieces(key, slot, pieces.length, bounds[slot]));
      if (cleared) {
        await secure
          .setItem(
            name.manifest,
            JSON.stringify({ ...committed, [other]: 0, [slot]: pieces.length }),
          )
          .catch(() => undefined); // the wider bounds stay; the next write retries
      }
    }
  }

  return {
    getItem: (key) =>
      queued(async () => {
        await prepare(key);
        if (cache.has(key)) return cache.get(key) ?? null;
        const value = await read(key);
        cache.set(key, value);
        return value;
      }),

    setItem: (key, value) =>
      queued(async () => {
        cache.delete(key);
        await prepare(key);
        await write(key, value);
        cache.set(key, value);
      }),

    removeItem: (key) =>
      queued(async () => {
        cache.delete(key);
        await prepare(key);
        if (!(await purge(key))) throw new Error("The stored session could not be removed.");
        cache.set(key, null);
      }),
  };
}
