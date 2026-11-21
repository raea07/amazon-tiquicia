import { describe, expect, it } from "vitest";
import {
  createSecureSessionStorage,
  FORMAT_MARKER,
  legacySecureKeyName,
  MAX_PIECES,
  markerKey,
  PIECE_BYTES,
  type SessionStorage,
  secureStoreKey,
  splitUtf8,
  utf8Length,
} from "./secure-session-storage";

const bytes = (value: string) => Buffer.byteLength(value, "utf8");

interface FakeOptions {
  /** Refuse values over this many UTF-8 bytes, as some iOS releases did. */
  limit?: number;
  /** Check names as expo-secure-store does. */
  checkNames?: boolean;
  /** Wait a little on every call, so overlapping calls really overlap. */
  jitter?: boolean;
}

/**
 * An in-memory store standing in for SecureStore or AsyncStorage. It can fail
 * one chosen write (`failAt`) or stop answering from a chosen write on
 * (`stopAt`, the app being killed). Writes are counted from 0 and include
 * deletions.
 */
function fakeStore({ limit, checkNames = false, jitter = false }: FakeOptions = {}) {
  const data = new Map<string, string>();
  let writes = 0;
  let failAt = -1;
  let stopAt = -1;
  let stopped = false;
  let largest = 0;
  let refuseDeletes = false;
  const pause = () => (jitter ? new Promise((r) => setTimeout(r, Math.random() * 3)) : undefined);
  const checkName = (key: string) => {
    if (checkNames && !/^[\w.-]+$/.test(key)) throw new Error(`Invalid key: ${key}`);
  };
  const mutate = async (action: () => void) => {
    await pause();
    if (stopped) throw new Error("stopped");
    const index = writes++;
    if (index === stopAt) {
      stopped = true;
      throw new Error("killed");
    }
    if (index === failAt) throw new Error("write failed");
    action();
  };
  const store: SessionStorage = {
    getItem: async (key) => {
      await pause();
      if (stopped) throw new Error("stopped");
      checkName(key);
      return data.get(key) ?? null;
    },
    setItem: (key, value) =>
      mutate(() => {
        checkName(key);
        if (limit !== undefined && bytes(value) > limit) {
          throw new Error(`Value of ${bytes(value)} bytes refused`);
        }
        largest = Math.max(largest, bytes(value));
        data.set(key, value);
      }),
    removeItem: (key) =>
      mutate(() => {
        checkName(key);
        if (refuseDeletes) throw new Error("delete refused");
        data.delete(key);
      }),
  };
  return {
    ...store,
    data,
    get writes() {
      return writes;
    },
    get largest() {
      return largest;
    },
    failAt(index: number) {
      failAt = writes + index;
    },
    stopAt(index: number) {
      stopAt = writes + index;
    },
    /** Refuse every deletion from now on (a keychain that keeps failing). */
    refuseDeletes(on: boolean) {
      refuseDeletes = on;
    },
    revive() {
      stopped = false;
      failAt = -1;
      stopAt = -1;
    },
  };
}

type Fake = ReturnType<typeof fakeStore>;

const KEY = "sb-127.0.0.1:54321-auth-token";

/** A phone: the two stores outlive the adapter, which is recreated on each app start. */
function phone(options: FakeOptions = {}) {
  const secure = fakeStore({ limit: PIECE_BYTES, checkNames: true, ...options });
  const plain = fakeStore(options);
  return {
    secure,
    plain,
    start: () => createSecureSessionStorage({ secure, plain }),
  };
}

/** What a Supabase session looks like, with a name full of accents and an emoji. */
function session(padding: number): string {
  return JSON.stringify({
    access_token: `eyJhbGciOiJFUzI1NiJ9.${"a".repeat(800)}.signature`,
    refresh_token: "refresh-token-value",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "comprador@yuntera.example",
      user_metadata: { full_name: "María José Núñez Ávila 🇨🇷", padding: "ñ".repeat(padding) },
    },
  });
}

/** Names this adapter writes for KEY. */
const sessionNames = (secure: Fake) =>
  [...secure.data.keys()].filter((name) => name.startsWith(secureStoreKey(KEY))).sort();

describe("secure session storage: round trips", () => {
  const cases: Array<[string, string]> = [
    ["a 1-byte value", "x"],
    ["an empty value", ""],
    ["a value exactly one piece long", "a".repeat(PIECE_BYTES)],
    ["a value one byte over a piece", "a".repeat(PIECE_BYTES + 1)],
    ["a value exactly two pieces long", "b".repeat(PIECE_BYTES * 2)],
    [
      "a two-byte character straddling a boundary",
      `${"a".repeat(PIECE_BYTES - 1)}ñ${"z".repeat(10)}`,
    ],
    ["a three-byte character straddling a boundary", `${"a".repeat(PIECE_BYTES - 2)}€€€`],
    [
      "an emoji straddling a boundary",
      `${"a".repeat(PIECE_BYTES - 3)}🇨🇷😀${"z".repeat(PIECE_BYTES)}`,
    ],
    ["a 12 KB value", "q".repeat(12 * 1024)],
    ["a 12 KB value of accents", "áéíóúñ".repeat(1024)],
    ["a realistic session", session(1200)],
  ];

  for (const [label, value] of cases) {
    it(`gives back exactly ${label}, in pieces the store accepts`, async () => {
      const { secure, start } = phone();
      const storage = start();
      await storage.setItem(KEY, value);
      expect(await storage.getItem(KEY)).toBe(value);
      // And after the app restarts (nothing cached).
      expect(await start().getItem(KEY)).toBe(value);
      expect(secure.largest).toBeLessThanOrEqual(PIECE_BYTES);
      for (const stored of secure.data.values())
        expect(bytes(stored)).toBeLessThanOrEqual(PIECE_BYTES);
    });
  }

  it("splits by bytes without cutting a character", () => {
    const value = `${"a".repeat(PIECE_BYTES - 1)}ñ`;
    const pieces = splitUtf8(value);
    expect(pieces).toEqual(["a".repeat(PIECE_BYTES - 1), "ñ"]);
    expect(splitUtf8("a".repeat(PIECE_BYTES))).toHaveLength(1);
    expect(splitUtf8("a".repeat(PIECE_BYTES + 1))).toHaveLength(2);
    expect(utf8Length("🇨🇷")).toBe(bytes("🇨🇷"));
    for (const piece of splitUtf8("😀ñ€a".repeat(2000)))
      expect(bytes(piece)).toBeLessThanOrEqual(PIECE_BYTES);
  });

  it("reads as signed out when nothing was stored", async () => {
    expect(await phone().start().getItem(KEY)).toBeNull();
  });

  it("keeps sessions under different keys apart", async () => {
    const { start } = phone();
    const storage = start();
    await storage.setItem(KEY, "one");
    await storage.setItem(`${KEY}-code-verifier`, "two");
    await storage.setItem("sb-127.0.0.1_54321-auth-token", "three");
    const fresh = start();
    expect(await fresh.getItem(KEY)).toBe("one");
    expect(await fresh.getItem(`${KEY}-code-verifier`)).toBe("two");
    expect(await fresh.getItem("sb-127.0.0.1_54321-auth-token")).toBe("three");
  });

  it("refuses a value it could not give back unchanged, keeping the previous one", async () => {
    const { start } = phone();
    const storage = start();
    await storage.setItem(KEY, "previous");
    await expect(storage.setItem(KEY, "bad \ud800 surrogate")).rejects.toThrow();
    await expect(storage.setItem(KEY, "a".repeat(MAX_PIECES * PIECE_BYTES + 1))).rejects.toThrow();
    expect(await storage.getItem(KEY)).toBe("previous");
    expect(await start().getItem(KEY)).toBe("previous");
  });
});

describe("secure session storage: what is left behind", () => {
  it("leaves no piece of a longer value after a shorter one", async () => {
    const { secure, start } = phone();
    const storage = start();
    await storage.setItem(KEY, "l".repeat(12 * 1024));
    await storage.setItem(KEY, "s".repeat(100));
    expect(sessionNames(secure)).toHaveLength(2); // the manifest and one piece
    await storage.setItem(KEY, "m".repeat(3000));
    expect(sessionNames(secure)).toHaveLength(4);
    await storage.setItem(KEY, "t");
    expect(sessionNames(secure)).toHaveLength(2);
    expect(await start().getItem(KEY)).toBe("t");
  });

  it("removes every piece on sign-out", async () => {
    const { secure, start } = phone();
    const storage = start();
    await storage.setItem(KEY, session(3000));
    await storage.removeItem(KEY);
    expect(sessionNames(secure)).toEqual([]);
    expect(await storage.getItem(KEY)).toBeNull();
    expect(await start().getItem(KEY)).toBeNull();
  });

  it("removes every piece even when some are already missing", async () => {
    const { secure, start } = phone();
    const storage = start();
    await storage.setItem(KEY, session(3000));
    const pieces = sessionNames(secure).filter((name) => !name.endsWith("_m"));
    expect(pieces.length).toBeGreaterThan(3);
    secure.data.delete(pieces[0] as string);
    secure.data.delete(pieces[2] as string);
    await storage.removeItem(KEY);
    expect(sessionNames(secure)).toEqual([]);
  });

  it("is signed out after a sign-out whose deletions partly failed, and tidies up later", async () => {
    const { secure, start } = phone();
    const storage = start();
    await storage.setItem(KEY, session(3000));
    secure.failAt(2); // a piece deletion, after the tombstone
    await storage.removeItem(KEY);
    expect(await start().getItem(KEY)).toBeNull();
    expect(sessionNames(secure)).toEqual([]);
  });

  it("is signed out even when no piece can be deleted", async () => {
    const { secure, start } = phone();
    const storage = start();
    await storage.setItem(KEY, session(3000));
    secure.refuseDeletes(true);
    await storage.removeItem(KEY);
    expect(await storage.getItem(KEY)).toBeNull();
    expect(await start().getItem(KEY)).toBeNull();
    secure.refuseDeletes(false);
    await start().getItem(KEY); // the next start finishes the job
    expect(sessionNames(secure)).toEqual([]);
  });

  it("removing a key that was never stored succeeds", async () => {
    const { secure, start } = phone();
    await start().removeItem(KEY);
    expect(sessionNames(secure)).toEqual([]);
  });
});

describe("secure session storage: inconsistent contents read as signed out and are removed", () => {
  async function stored() {
    const p = phone();
    await p.start().setItem(KEY, session(3000));
    return p;
  }

  it("a manifest without its pieces", async () => {
    const { secure, start } = await stored();
    for (const name of sessionNames(secure)) if (!name.endsWith("_m")) secure.data.delete(name);
    expect(await start().getItem(KEY)).toBeNull();
    expect(sessionNames(secure)).toEqual([]);
  });

  it("a manifest missing one piece", async () => {
    const { secure, start } = await stored();
    const last = sessionNames(secure)
      .filter((name) => !name.endsWith("_m"))
      .at(-1) as string;
    secure.data.delete(last);
    expect(await start().getItem(KEY)).toBeNull();
    expect(sessionNames(secure)).toEqual([]);
  });

  it("pieces without a manifest", async () => {
    const { secure, start } = await stored();
    secure.data.delete(`${secureStoreKey(KEY)}_m`);
    expect(await start().getItem(KEY)).toBeNull();
    expect(sessionNames(secure)).toEqual([]);
  });

  it("a manifest that is not one", async () => {
    const { secure, start } = await stored();
    secure.data.set(`${secureStoreKey(KEY)}_m`, "not json");
    expect(await start().getItem(KEY)).toBeNull();
    expect(sessionNames(secure)).toEqual([]);
  });

  it("a piece changed behind the manifest's back", async () => {
    const { secure, start } = await stored();
    const first = sessionNames(secure).find((name) => !name.endsWith("_m")) as string;
    secure.data.set(first, `X${(secure.data.get(first) as string).slice(1)}`);
    expect(await start().getItem(KEY)).toBeNull();
    expect(sessionNames(secure)).toEqual([]);
  });
});

describe("secure session storage: failures and overlapping calls", () => {
  const before = session(2000); // about 4 KB
  const after = session(4000); // about 8 KB

  /** Writes needed to replace `before` with `after` when nothing fails. */
  async function replacementWrites(): Promise<number> {
    const { secure, start } = phone();
    const storage = start();
    await storage.setItem(KEY, before);
    await storage.setItem(KEY, after);
    const first = secure.writes;
    await storage.setItem(KEY, before);
    await storage.setItem(KEY, after);
    return (secure.writes - first) / 2;
  }

  it("a write that fails at any step leaves the previous value, or the new one if it said so", async () => {
    const steps = await replacementWrites();
    expect(steps).toBeGreaterThan(5);
    for (let step = 0; step < steps; step++) {
      for (const previous of [before, after]) {
        const next = previous === before ? after : before;
        const { secure, start } = phone();
        await start().setItem(KEY, previous);
        const storage = start();
        secure.failAt(step);
        const outcome = await storage.setItem(KEY, next).then(
          () => "written",
          () => "failed",
        );
        const expected = outcome === "written" ? next : previous;
        expect(await storage.getItem(KEY), `step ${step}`).toBe(expected);
        expect(await start().getItem(KEY), `step ${step}, after a restart`).toBe(expected);
        // The next write leaves nothing behind.
        await start().setItem(KEY, "short");
        expect(sessionNames(secure), `step ${step}`).toHaveLength(2);
      }
    }
  });

  it("an app killed at any step of a write starts with the previous or the new value, whole", async () => {
    const steps = await replacementWrites();
    for (let step = 0; step < steps; step++) {
      const { secure, start } = phone();
      await start().setItem(KEY, before);
      secure.stopAt(step);
      await start()
        .setItem(KEY, after)
        .catch(() => undefined);
      secure.revive();
      const value = await start().getItem(KEY);
      expect([before, after], `step ${step}`).toContain(value);
      await start().setItem(KEY, "short");
      expect(sessionNames(secure), `step ${step}`).toHaveLength(2);
    }
  });

  it("an app killed during the first write starts signed out", async () => {
    const { secure, start } = phone();
    await start().getItem(KEY); // the installation's clean-up
    for (let step = 0; step < 6; step++) {
      secure.stopAt(step);
      await start()
        .setItem(KEY, after)
        .catch(() => undefined);
      secure.revive();
      expect([null, after]).toContain(await start().getItem(KEY));
      await start().removeItem(KEY);
    }
  });

  it("an app killed at any step of a sign-out starts signed out or still signed in, never broken", async () => {
    for (let step = 0; step < 12; step++) {
      const { secure, start } = phone();
      await start().setItem(KEY, before);
      secure.stopAt(step);
      await start()
        .removeItem(KEY)
        .catch(() => undefined);
      secure.revive();
      expect([null, before]).toContain(await start().getItem(KEY));
      await start().removeItem(KEY);
      expect(sessionNames(secure)).toEqual([]);
    }
  });

  it("two overlapping writes end with one of the two values, whole", async () => {
    for (let round = 0; round < 20; round++) {
      const { secure, start } = phone({ jitter: true });
      const storage = start();
      await storage.setItem(KEY, before);
      const reads: Array<string | null> = [];
      await Promise.all([
        storage.setItem(KEY, after),
        storage.getItem(KEY).then((v) => reads.push(v)),
        storage.setItem(KEY, `${before}!`),
        storage.getItem(KEY).then((v) => reads.push(v)),
      ]);
      for (const read of reads) expect([before, after, `${before}!`]).toContain(read);
      const final = await start().getItem(KEY);
      expect([after, `${before}!`]).toContain(final);
      expect(final).toBe(await storage.getItem(KEY));
      expect(secure.largest).toBeLessThanOrEqual(PIECE_BYTES);
    }
  });

  it("a write still works after an earlier call failed", async () => {
    const { secure, start } = phone();
    const storage = start();
    secure.failAt(0);
    await expect(storage.setItem(KEY, before)).rejects.toThrow();
    await storage.setItem(KEY, after);
    expect(await start().getItem(KEY)).toBe(after);
  });
});

describe("secure session storage: the update from the encrypting adapter", () => {
  it("clears the old ciphertext and key once, and starts signed out", async () => {
    const { secure, plain, start } = phone();
    plain.data.set(KEY, "ab".repeat(2000)); // the old AES ciphertext, hex
    secure.data.set(legacySecureKeyName(KEY), "cd".repeat(32)); // the old AES key
    plain.data.set("cart", "kept"); // other app state is not touched

    expect(await start().getItem(KEY)).toBeNull();
    expect(plain.data.has(KEY)).toBe(false);
    expect(secure.data.has(legacySecureKeyName(KEY))).toBe(false);
    expect(plain.data.get(markerKey(KEY))).toBe(FORMAT_MARKER);
    expect(plain.data.get("cart")).toBe("kept");

    // Signed in again, the session survives restarts: the clean-up runs once.
    await start().setItem(KEY, session(1000));
    expect(await start().getItem(KEY)).toBe(session(1000));
  });

  it("does not take over a session the Keychain kept from before an uninstall", async () => {
    const { plain, secure, start } = phone();
    await start().setItem(KEY, session(1000));
    plain.data.clear(); // uninstall: app storage goes, the iOS Keychain stays
    expect(await start().getItem(KEY)).toBeNull();
    expect(sessionNames(secure)).toEqual([]);
  });

  it("keeps nothing of the session in ordinary storage", async () => {
    const { plain, start } = phone();
    await start().setItem(KEY, session(1000));
    expect([...plain.data.entries()]).toEqual([[markerKey(KEY), FORMAT_MARKER]]);
  });
});

describe("secure-store names", () => {
  it("uses only the characters the store allows", () => {
    for (const key of [KEY, "sb-abc-auth-token", "a_b", "ñandú 🇨🇷", "x/y?z=1&w"]) {
      expect(secureStoreKey(key)).toMatch(/^[\w.-]+$/);
    }
    expect(secureStoreKey("sb-abc.1-auth-token")).toBe("sb-abc.1-auth-token");
  });

  it("never gives two keys the same name", () => {
    const keys = ["a:b", "a_b", "a?b", "a_3Ab", "a_5Fb", "añb", "a b"];
    expect(new Set(keys.map(secureStoreKey)).size).toBe(keys.length);
    // The old adapter's lossy names would have collided.
    expect(legacySecureKeyName("a:b")).toBe(legacySecureKeyName("a?b"));
  });

  it("refuses an empty key", () => {
    expect(() => secureStoreKey("")).toThrow();
  });
});
