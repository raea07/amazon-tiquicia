import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSecureSessionStorage, FORMAT_MARKER } from "../supabase/secure-session-storage";
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

    expect(await signOutDevice(sb.auth)).toBe(true);
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

/**
 * The installed supabase-js over the apps' real session adapter, with an
 * in-memory secure store that can be made to fail every call (a keychain that
 * is unavailable), and ordinary storage that must never hold the session.
 */
function phoneClient(fetchImpl: typeof fetch) {
  const secure = new Map<string, string>();
  const plain = new Map<string, string>();
  let broken = false;
  const store = (map: Map<string, string>, breakable: boolean) => {
    const check = () => {
      if (breakable && broken) throw new Error("store unavailable");
    };
    return {
      getItem: async (k: string) => {
        check();
        return map.get(k) ?? null;
      },
      setItem: async (k: string, v: string) => {
        check();
        map.set(k, v);
      },
      removeItem: async (k: string) => {
        check();
        map.delete(k);
      },
    };
  };
  const storage = createSecureSessionStorage({
    secure: store(secure, true),
    plain: store(plain, false),
  });
  const sb = createClient(API_URL, KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
  const events: string[] = [];
  sb.auth.onAuthStateChange((event) => {
    events.push(event);
  });
  const breakAll = (on: boolean) => {
    broken = on;
  };
  return { sb, storage, secure, plain, events, breakAll };
}

describe("signOutDevice over the secure session storage", () => {
  it("removes a session the server has already ended, leaving nothing of it on the phone", async () => {
    const phone = phoneClient(
      async () =>
        new Response(JSON.stringify({ code: "session_not_found", msg: "Session not found" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    await phone.storage.setItem(STORAGE_KEY, storedSession());
    expect((await phone.sb.auth.getSession()).data.session).not.toBeNull();

    expect(await signOutDevice(phone.sb.auth)).toBe(true);
    expect(phone.events).toContain("SIGNED_OUT");
    expect((await phone.sb.auth.getSession()).data.session).toBeNull();
    // Nothing of the session is left in the secure store.
    expect([...phone.secure.values()].join("")).not.toContain("refresh");
    // Ordinary storage holds only the clean-up markers (one per storage key).
    expect(phone.plain.size).toBeGreaterThan(0);
    expect(new Set(phone.plain.values())).toEqual(new Set([FORMAT_MARKER]));
  });

  it("removes the session offline", async () => {
    const phone = phoneClient(async () => {
      throw new TypeError("Network request failed");
    });
    await phone.storage.setItem(STORAGE_KEY, storedSession());
    expect(await signOutDevice(phone.sb.auth)).toBe(true);
    expect((await phone.sb.auth.getSession()).data.session).toBeNull();
    expect([...phone.secure.values()].join("")).not.toContain("refresh");
  });

  it("does not claim success when the secure store refuses every call", async () => {
    const phone = phoneClient(async () => new Response(null, { status: 204 }));
    const value = storedSession();
    await phone.storage.setItem(STORAGE_KEY, value);
    expect((await phone.sb.auth.getSession()).data.session).not.toBeNull();
    const before = [...phone.secure.entries()];
    phone.events.length = 0;

    phone.breakAll(true);
    expect(await signOutDevice(phone.sb.auth)).toBe(false);
    expect(phone.events).not.toContain("SIGNED_OUT");

    // The session is still whole on the phone, and the next attempt succeeds.
    phone.breakAll(false);
    expect([...phone.secure.entries()]).toEqual(before);
    expect(await phone.storage.getItem(STORAGE_KEY)).toBe(value);
    expect(await signOutDevice(phone.sb.auth)).toBe(true);
    expect(await phone.storage.getItem(STORAGE_KEY)).toBeNull();
  });
});
