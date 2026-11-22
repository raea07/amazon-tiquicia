import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthApiError, AuthRetryableFetchError, type Session } from "@supabase/supabase-js";
import { type AuthLike, keepSessionWithoutSignal, parseStoredSession } from "./offline-session";

const stored = {
  access_token: "expired-token",
  refresh_token: "refresh",
  expires_at: 1,
  user: { id: "carlos" },
} as unknown as Session;

/** A stand-in for supabase.auth, answering as supabase-js does at a start-up with an expired token. */
function fakeAuth(answer: { session: Session | null; error: unknown }) {
  const callbacks: Array<(event: string, session: Session | null) => unknown> = [];
  const auth: AuthLike & { emit(event: string, session: Session | null): Promise<void> } = {
    getSession: async () => ({ data: { session: answer.session }, error: answer.error }),
    onAuthStateChange: (callback) => {
      callbacks.push(callback);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async emit(event, session) {
      for (const callback of callbacks) await callback(event, session);
    },
  };
  return auth;
}

describe("a start-up without signal after the access token expired", () => {
  it("still counts the stored session as signed in", async () => {
    const auth = fakeAuth({
      session: null,
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    keepSessionWithoutSignal(auth, async () => stored);
    const { data, error } = await auth.getSession();
    assert.equal(data.session?.user.id, "carlos");
    assert.equal(error, null);

    const seen: Array<[string, string | null]> = [];
    auth.onAuthStateChange((event, session) => {
      seen.push([event, session?.user.id ?? null]);
    });
    await auth.emit("INITIAL_SESSION", null);
    assert.deepEqual(seen, [["INITIAL_SESSION", "carlos"]]);
  });

  it("does not keep a session the server rejected", async () => {
    const auth = fakeAuth({
      session: null,
      error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
    });
    keepSessionWithoutSignal(auth, async () => stored);
    assert.equal((await auth.getSession()).data.session, null);
  });

  it("signs out when nothing is stored, and passes every other event through", async () => {
    const auth = fakeAuth({ session: null, error: new AuthRetryableFetchError("x", 0) });
    keepSessionWithoutSignal(auth, async () => null);
    assert.equal((await auth.getSession()).data.session, null);
    const seen: Array<[string, string | null]> = [];
    auth.onAuthStateChange((event, session) => {
      seen.push([event, session?.user.id ?? null]);
    });
    await auth.emit("INITIAL_SESSION", null);
    await auth.emit("SIGNED_OUT", null);
    await auth.emit("TOKEN_REFRESHED", { ...stored, access_token: "fresh" });
    assert.deepEqual(seen, [
      ["INITIAL_SESSION", null],
      ["SIGNED_OUT", null],
      ["TOKEN_REFRESHED", "carlos"],
    ]);
  });

  it("wraps a client once, however often the layout loads", async () => {
    const auth = fakeAuth({ session: null, error: new AuthRetryableFetchError("x", 0) });
    let reads = 0;
    const read = async () => {
      reads += 1;
      return stored;
    };
    keepSessionWithoutSignal(auth, read);
    keepSessionWithoutSignal(auth, read);
    await auth.getSession();
    assert.equal(reads, 1);
  });
});

describe("reading the stored session", () => {
  it("accepts what supabase-js writes and nothing else", () => {
    assert.equal(parseStoredSession(JSON.stringify(stored))?.user.id, "carlos");
    assert.equal(parseStoredSession(null), null);
    assert.equal(parseStoredSession("{not json"), null);
    assert.equal(parseStoredSession(JSON.stringify({ access_token: "a" })), null);
  });
});
