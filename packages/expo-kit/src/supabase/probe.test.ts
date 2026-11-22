import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The password check signs in on a client of its own. These tests hold it to
 * what keeps the phone's session safe: that client never persists or
 * refreshes a session, never shares the app's storage key, and ends its own
 * session once the answer is known.
 */

const calls: { options: unknown; signOut: ReturnType<typeof vi.fn> }[] = [];
let answer: { data: { session: object | null }; error: object | null };

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: unknown) => {
    const signOut = vi.fn(async () => ({ error: null }));
    calls.push({ options, signOut });
    return { auth: { signInWithPassword: async () => answer, signOut } };
  },
}));

const env = { supabaseUrl: "http://127.0.0.1:59999", supabaseKey: "sb_publishable_test" };

describe("passwordCheckFor", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("checks on a client that keeps nothing and shares no storage with the app", async () => {
    const { passwordCheckFor } = await import("./probe");
    answer = { data: { session: { access_token: "t" } }, error: null };
    expect(await passwordCheckFor(env as never)("a@b.cr", "correcta")).toBe("right");
    expect(calls[0]?.options).toEqual({
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "yuntera-password-check",
      },
    });
    expect(calls[0]?.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("tells a wrong password from no connection and from Auth's limit", async () => {
    const { passwordCheckFor } = await import("./probe");
    const check = passwordCheckFor(env as never);
    answer = { data: { session: null }, error: { status: 400, message: "Invalid login" } };
    expect(await check("a@b.cr", "mala")).toBe("wrong");
    answer = {
      data: { session: null },
      error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
    };
    expect(await check("a@b.cr", "x")).toBe("offline");
    answer = {
      data: { session: null },
      error: { status: 429, code: "over_request_rate_limit", message: "Too many" },
    };
    expect(await check("a@b.cr", "x")).toBe("limited");
    answer = { data: { session: null }, error: null };
    expect(await check("a@b.cr", "x")).toBe("wrong");
  });
});
