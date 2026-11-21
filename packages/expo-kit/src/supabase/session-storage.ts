/**
 * Where the native apps keep the session: encrypted in app storage, with the
 * key in the platform's secure store (see `encrypted-storage.ts`).
 *
 * The web export uses `session-storage.web.ts` instead, because the secure
 * store does not exist in a browser.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createEncryptedStorage, type SessionStorage } from "./encrypted-storage";

// Readable after the phone has been unlocked once since it started, so a
// background task (the drivers' location updates) can still call the API
// while the screen is locked. The default would be "only while unlocked".
const keyOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const sessionStorage: SessionStorage = createEncryptedStorage({
  secure: {
    getItem: (key) => SecureStore.getItemAsync(key, keyOptions),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, keyOptions),
    removeItem: (key) => SecureStore.deleteItemAsync(key, keyOptions),
  },
  plain: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  },
  randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)),
});

/** Where an app keeps its own small, non-secret state (a cart, a chosen district). */
export const appStorage: SessionStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
