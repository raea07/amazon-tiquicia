import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wiring of the real stores. The secure store's keychain setting must stay
 * "after first unlock, this device only" on every call: the drivers'
 * background task reads the session while the phone is locked, and a backup
 * restored on another iPhone must not carry the refresh token over. A mistake
 * here would only show on a device, so it is pinned here.
 */

const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 7; // any value: it is passed through
const secure = new Map<string, string>();
const plain = new Map<string, string>();

const SecureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 7,
  WHEN_UNLOCKED: 5,
  ...SecureStore,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => plain.get(key) ?? null,
    setItem: async (key: string, value: string) => void plain.set(key, value),
    removeItem: async (key: string) => void plain.delete(key),
  },
}));

beforeEach(() => {
  secure.clear();
  plain.clear();
  SecureStore.getItemAsync.mockImplementation(async (key: string) => secure.get(key) ?? null);
  SecureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    secure.set(key, value);
  });
  SecureStore.deleteItemAsync.mockImplementation(async (key: string) => {
    secure.delete(key);
  });
});

describe("native session storage wiring", () => {
  it("passes the keychain setting on every secure-store call", async () => {
    const { sessionStorage } = await import("./session-storage");
    const key = "sb-127.0.0.1:54321-auth-token";
    const value = JSON.stringify({ access_token: "a".repeat(3000), user: { name: "Núñez" } });
    await sessionStorage.setItem(key, value);
    expect(await sessionStorage.getItem(key)).toBe(value);
    await sessionStorage.removeItem(key);

    const calls = [
      ...SecureStore.getItemAsync.mock.calls.map((c) => ["get", c[1]] as const),
      ...SecureStore.setItemAsync.mock.calls.map((c) => ["set", c[2]] as const),
      ...SecureStore.deleteItemAsync.mock.calls.map((c) => ["delete", c[1]] as const),
    ];
    // All three kinds of call happened, several pieces' worth.
    for (const kind of ["get", "set", "delete"]) {
      expect(
        calls.some(([k]) => k === kind),
        kind,
      ).toBe(true);
    }
    for (const [kind, options] of calls) {
      expect(options, kind).toEqual({ keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    }
    // Ordinary storage holds only the non-secret clean-up marker.
    expect([...plain.values()]).toEqual(["secure-store-1"]);
    expect(secure.size).toBe(0);
  });
});
