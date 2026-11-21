import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { signOutDevice } from "./sign-out";

const API_URL = "http://127.0.0.1:59999";
const KEY = "sb_publishable_test";
const STORAGE_KEY = "sb-127-auth-token";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => void map.set(k, v),
    removeItem: async (k: string) => void map.delete(k),
  };
}

function storedSession() {
  const now = Math.floor(Date.now() / 1000);
  // A token shaped like a JWT; supabase-js only decodes it, it does not verify it.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", exp: now + 3600 })}.sig`;
  return JSON.stringify({
    access_token: token,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: "u1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
  });
}

/** The installed supabase-js, signed in, with a fetch that behaves as given. */
function client(fetchImpl: typeof fetch) {
  const storage = memoryStorage();
  storage.map.set(STORAGE_KEY, storedSession());
  const sb = createClient(API_URL, KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
  return { sb, storage };
}

describe("signOutDevice", () => {
  it("removes the session when there is no connection", async () => {
    const { sb, storage } = client(async () => {
      throw new TypeError("Network request failed");
    });
    // The library alone keeps the session in this case; this is why the helper exists.
    const plain = await sb.auth.signOut();
    expect(plain.error).not.toBeNull();
    expect(storage.map.has(STORAGE_KEY)).toBe(true);

    await signOutDevice(sb.auth);
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
    expect((await sb.auth.getSession()).data.session).toBeNull();
  });

  it("removes the session when the auth server answers 5xx", async () => {
    const { sb, storage } = client(async () => new Response("{}", { status: 503 }));
    await signOutDevice(sb.auth);
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
  });

  it("revokes globally and removes the session when the server answers", async () => {
    const scopes: string[] = [];
    const { sb, storage } = client(async (input) => {
      scopes.push(new URL(String(input)).searchParams.get("scope") ?? "");
      return new Response(null, { status: 204 });
    });
    await signOutDevice(sb.auth);
    expect(scopes).toEqual(["global"]);
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
  });

  it("falls back to a local sign-out when the call throws", async () => {
    const calls: unknown[] = [];
    await signOutDevice({
      signOut: async (options?: unknown) => {
        calls.push(options);
        if (!options) throw new Error("listener");
        return { error: null };
      },
    } as never);
    expect(calls).toEqual([undefined, { scope: "local" }]);
  });
});
