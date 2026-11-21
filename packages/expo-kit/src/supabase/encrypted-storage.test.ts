import { randomBytes as nodeRandomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEncryptedStorage, type SessionStorage, secureKeyName } from "./encrypted-storage";

/** An in-memory store that records what was written, standing in for SecureStore or AsyncStorage. */
function fakeStore(): SessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

const randomBytes = (length: number) => new Uint8Array(nodeRandomBytes(length));

const SESSION_KEY = "sb-127-auth-token";
const session = JSON.stringify({
  access_token: "eyJhbGciOiJFUzI1NiJ9.payload.signature",
  refresh_token: "refresh-token-value",
  user: { id: "11111111-1111-4111-8111-111111111111", email: "comprador@yuntera.example" },
  // A real session is larger than the 2 KB some keychains accept.
  padding: "x".repeat(3000),
});

function setup() {
  const secure = fakeStore();
  const plain = fakeStore();
  return { secure, plain, storage: createEncryptedStorage({ secure, plain, randomBytes }) };
}

describe("encrypted session storage", () => {
  it("gives back exactly what was stored", async () => {
    const { storage } = setup();
    await storage.setItem(SESSION_KEY, session);
    expect(await storage.getItem(SESSION_KEY)).toBe(session);
  });

  it("keeps only a 32-byte key in the secure store and no readable token anywhere", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(SESSION_KEY, session);

    const key = secure.data.get(SESSION_KEY);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const stored = plain.data.get(SESSION_KEY) ?? "";
    expect(stored).toMatch(/^[0-9a-f]+$/);
    expect(stored).not.toContain("refresh-token-value");
    expect(Buffer.from(stored, "hex").toString("utf8")).not.toContain("refresh-token-value");
  });

  it("uses a new key on every write", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(SESSION_KEY, session);
    const first = [secure.data.get(SESSION_KEY), plain.data.get(SESSION_KEY)];
    await storage.setItem(SESSION_KEY, session);
    const second = [secure.data.get(SESSION_KEY), plain.data.get(SESSION_KEY)];
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(await storage.getItem(SESSION_KEY)).toBe(session);
  });

  it("reads as signed out when nothing was stored", async () => {
    const { storage } = setup();
    expect(await storage.getItem(SESSION_KEY)).toBeNull();
  });

  it("reads as signed out when the key was lost (a restore without the keychain)", async () => {
    const { storage, secure } = setup();
    await storage.setItem(SESSION_KEY, session);
    secure.data.clear();
    expect(await storage.getItem(SESSION_KEY)).toBeNull();
  });

  it("reads as signed out when the key does not match the stored session", async () => {
    const { storage, secure } = setup();
    await storage.setItem(SESSION_KEY, session);
    secure.data.set(SESSION_KEY, "00".repeat(32));
    expect(await storage.getItem(SESSION_KEY)).toBeNull();
  });

  it("removes both halves on sign-out", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(SESSION_KEY, session);
    await storage.removeItem(SESSION_KEY);
    expect(secure.data.size).toBe(0);
    expect(plain.data.size).toBe(0);
    expect(await storage.getItem(SESSION_KEY)).toBeNull();
  });

  it("refuses a random source that returns too few bytes rather than use a weak key", async () => {
    const storage = createEncryptedStorage({
      secure: fakeStore(),
      plain: fakeStore(),
      randomBytes: () => new Uint8Array(8),
    });
    await expect(storage.setItem(SESSION_KEY, session)).rejects.toThrow();
  });
});

describe("secure-store key names", () => {
  it("keeps names the keychain accepts and replaces anything else", () => {
    expect(secureKeyName("sb-abc_def.1-auth-token")).toBe("sb-abc_def.1-auth-token");
    expect(secureKeyName("sb-127.0.0.1:54321-auth-token")).toBe("sb-127.0.0.1_54321-auth-token");
  });
});
