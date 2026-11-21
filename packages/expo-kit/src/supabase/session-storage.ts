/**
 * Where the native apps keep the session: in the platform's secure store
 * only (the Keychain on iOS, Keystore-encrypted storage on Android), split
 * into pieces the store accepts (see `secure-session-storage.ts`). The apps
 * ship no cipher of their own.
 *
 * The web export uses `session-storage.web.ts` instead, because the secure
 * store does not exist in a browser; that file must not import this one or
 * expo-secure-store.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createSecureSessionStorage, type SessionStorage } from "./secure-session-storage";

// Readable after the phone has been unlocked once since it started, so a
// background task (the drivers' location updates) can still call the API
// while the screen is locked. The default would be "only while unlocked".
// THIS_DEVICE_ONLY keeps the session out of encrypted iCloud and computer
// backups restored on another iPhone, which therefore starts signed out
// instead of carrying the old refresh token over. Passed on every write, so
// a piece that already exists is also updated to this setting.
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Ordinary app storage. Holds no session: only small, non-secret state. */
export const appStorage: SessionStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const sessionStorage: SessionStorage = createSecureSessionStorage({
  secure: {
    getItem: (key) => SecureStore.getItemAsync(key, secureOptions),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
    removeItem: (key) => SecureStore.deleteItemAsync(key, secureOptions),
  },
  // Only the clean-up marker, and the old adapter's leftovers to delete.
  plain: appStorage,
});
