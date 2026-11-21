/**
 * Session storage that is encrypted at rest, for the phones.
 *
 * A Supabase session (two tokens and the user) is larger than the keychain
 * reliably holds (some iOS versions refuse values over about 2 KB), so the
 * session itself is kept in ordinary app storage, encrypted with AES-256 in
 * CTR mode, and only the key lives in the secure store (Keychain on iOS,
 * Keystore-backed storage on Android). A fresh key is made for every write.
 * This is the "LargeSecureStore" arrangement from Supabase's own guide.
 *
 * The stores and the random source are passed in, so the logic is tested with
 * fakes (`encrypted-storage.test.ts`) and the native modules stay at the edge
 * (`session-storage.ts`).
 */

import * as aesjs from "aes-js";

/** The three calls supabase-js makes on its `auth.storage`. */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface EncryptedStorageDeps {
  /** Holds the small per-session keys: the platform's secure store. */
  secure: SessionStorage;
  /** Holds the encrypted session: ordinary app storage. */
  plain: SessionStorage;
  /** Cryptographically secure random bytes. */
  randomBytes: (length: number) => Uint8Array;
}

/** Secure-store keys may contain only letters, digits, ".", "-" and "_". */
export function secureKeyName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

const KEY_BYTES = 32; // AES-256

export function createEncryptedStorage({
  secure,
  plain,
  randomBytes,
}: EncryptedStorageDeps): SessionStorage {
  const cipherFor = (key: Uint8Array) =>
    new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(1)) as {
      encrypt(bytes: Uint8Array): Uint8Array;
      decrypt(bytes: Uint8Array): Uint8Array;
    };

  return {
    async getItem(key) {
      const encrypted = await plain.getItem(key);
      if (!encrypted) return null;
      const keyHex = await secure.getItem(secureKeyName(key));
      // No key: the phone was restored from a backup without its keychain, or
      // the app was reinstalled. The ciphertext is useless; treat as signed out.
      if (!keyHex) return null;
      try {
        const bytes = cipherFor(aesjs.utils.hex.toBytes(keyHex)).decrypt(
          aesjs.utils.hex.toBytes(encrypted),
        );
        const text = aesjs.utils.utf8.fromBytes(bytes);
        // A key that does not match its ciphertext decrypts to noise. A session
        // is JSON, so anything that does not parse is treated as no session.
        JSON.parse(text);
        return text;
      } catch {
        return null;
      }
    },

    async setItem(key, value) {
      const aesKey = randomBytes(KEY_BYTES);
      if (aesKey.length !== KEY_BYTES) throw new Error("The random source returned too few bytes.");
      const encrypted = cipherFor(aesKey).encrypt(aesjs.utils.utf8.toBytes(value));
      // Key first: if the second write fails, the old ciphertext no longer
      // decrypts and reads as signed out, which is safe.
      await secure.setItem(secureKeyName(key), aesjs.utils.hex.fromBytes(aesKey));
      await plain.setItem(key, aesjs.utils.hex.fromBytes(encrypted));
    },

    async removeItem(key) {
      await plain.removeItem(key);
      await secure.removeItem(secureKeyName(key));
    },
  };
}
