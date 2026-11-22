import { describe, expect, it } from "vitest";
import { createOfflineQueue, type QueueEntry, type QueueOptions, type SendOutcome } from "./queue";

const KEY = "test.queue";

/** A store like AsyncStorage, in memory, that counts writes and can be made to fail. */
function fakeStore() {
  const map = new Map<string, string>();
  const store = {
    map,
    writes: 0,
    failWrites: false,
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (store.failWrites) throw new Error("disk full");
      store.writes += 1;
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
  };
  return store;
}

function queueOn(store: ReturnType<typeof fakeStore>, options: Partial<QueueOptions> = {}) {
  let id = 0;
  let clock = 1_000_000;
  return createOfflineQueue({
    store,
    key: KEY,
    newId: () => `e${++id}`,
    now: () => clock++,
    ...options,
  });
}

/** A server that records what it received and answers as told. */
function server(answer: (entry: QueueEntry) => SendOutcome = () => ({ result: "done" })) {
  const received: string[] = [];
  const send = async (entry: QueueEntry) => {
    const outcome = answer(entry);
    if (outcome.result !== "offline") received.push(`${entry.kind}:${String(entry.payload)}`);
    return outcome;
  };
  return { received, send };
}

describe("offline queue: order", () => {
  it("sends in the order the actions were taken", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    await q.enqueue("fail", "s1");
    await q.enqueue("arrive", "s2");
    const api = server();
    const result = await q.flush(api.send);
    expect(api.received).toEqual(["arrive:s1", "fail:s1", "arrive:s2"]);
    expect(result).toEqual({ sent: 3, rejected: 0, offline: false, remaining: 0 });
    expect(q.snapshot().entries).toHaveLength(0);
  });

  it("stops at the first action that cannot be delivered, so none overtakes it", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    await q.enqueue("fail", "s1");
    let online = false;
    const api = server(() => (online ? { result: "done" } : { result: "offline" }));
    const first = await q.flush(api.send);
    expect(first.offline).toBe(true);
    expect(api.received).toEqual([]);
    expect(q.snapshot().pending).toBe(2);
    expect(q.snapshot().entries.map((e) => e.status)).toEqual(["pending", "pending"]);

    online = true;
    await q.flush(api.send);
    expect(api.received).toEqual(["arrive:s1", "fail:s1"]);
  });

  it("sends what is added while a pass is running, after what was there", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    const received: string[] = [];
    await q.flush(async (entry) => {
      received.push(String(entry.payload));
      if (entry.payload === "s1") await q.enqueue("arrive", "s2");
      return { result: "done" };
    });
    expect(received).toEqual(["s1", "s2"]);
  });
});

describe("offline queue: never twice", () => {
  it("runs one pass at a time: two flushes at once send each action once", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    await q.enqueue("fail", "s2");
    let calls = 0;
    const slow = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { result: "done" } as const;
    };
    const [a, b, c] = await Promise.all([q.flush(slow), q.flush(slow), q.flush(slow)]);
    expect(calls).toBe(2);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("does not send again what the server took, even across a restart", async () => {
    const store = fakeStore();
    const q = queueOn(store);
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    const api = server();
    await q.flush(api.send);
    await q.flush(api.send);

    const restarted = queueOn(store);
    await restarted.setOwner("ana");
    await restarted.flush(api.send);
    expect(api.received).toEqual(["arrive:s1"]);
    expect(store.map.has(KEY)).toBe(false);
  });

  it("writes 'sending' before the request leaves", async () => {
    const store = fakeStore();
    const q = queueOn(store);
    await q.setOwner("ana");
    await q.enqueue("fail", "s1");
    let storedWhileSending: unknown;
    await q.flush(async () => {
      storedWhileSending = JSON.parse(store.map.get(KEY) ?? "[]");
      return { result: "done" };
    });
    expect(storedWhileSending).toMatchObject([{ id: "e1", status: "sending" }]);
  });

  it("after a crash mid-send, repeats only an action that is safe to repeat", async () => {
    const store = fakeStore();
    const crashed = queueOn(store);
    await crashed.setOwner("ana");
    await crashed.enqueue("position", "p1");
    await crashed.enqueue("charge", "c1");
    // The app is killed while the requests are on their way: never answered.
    void crashed.flush(() => new Promise<SendOutcome>(() => undefined));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = JSON.parse(store.map.get(KEY) ?? "[]") as QueueEntry[];
    stored[1] = { ...(stored[1] as QueueEntry), status: "sending" };
    store.map.set(KEY, JSON.stringify(stored));

    const restarted = queueOn(store, {
      repeatable: (entry) => entry.kind === "position",
      unknownOutcomeMessage: "No sabemos si llegó.",
    });
    await restarted.setOwner("ana");
    const api = server();
    await restarted.flush(api.send);
    expect(api.received).toEqual(["position:p1"]);
    expect(restarted.snapshot().entries).toMatchObject([
      { kind: "charge", status: "rejected", message: "No sabemos si llegó." },
    ]);
  });
});

describe("offline queue: a refusal", () => {
  it("is kept aside with its message and does not block the rest", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    await q.enqueue("fail", "s2");
    await q.enqueue("arrive", "s3");
    const api = server((entry) =>
      entry.payload === "s2"
        ? { result: "rejected", message: "Esa parada ya está cerrada." }
        : { result: "done" },
    );
    const result = await q.flush(api.send);
    expect(api.received).toEqual(["arrive:s1", "fail:s2", "arrive:s3"]);
    expect(result).toMatchObject({ sent: 2, rejected: 1, offline: false });
    const snap = q.snapshot();
    expect(snap.pending).toBe(0);
    expect(snap.rejected).toBe(1);
    expect(snap.entries[0]).toMatchObject({
      payload: "s2",
      message: "Esa parada ya está cerrada.",
    });

    // A rejected entry is never sent again; the person dismisses it once read.
    await q.flush(api.send);
    expect(api.received).toHaveLength(3);
    await q.dismiss("e2");
    expect(q.snapshot().entries).toHaveLength(0);
  });

  it("sets aside an action whose sending keeps throwing, after a few passes", async () => {
    const q = queueOn(fakeStore(), { maxAttempts: 3, failedMessage: "No se pudo enviar." });
    await q.setOwner("ana");
    await q.enqueue("arrive", "bad");
    await q.enqueue("arrive", "good");
    const sent: string[] = [];
    const send = async (entry: QueueEntry): Promise<SendOutcome> => {
      if (entry.payload === "bad") throw new Error("bug");
      sent.push(String(entry.payload));
      return { result: "done" };
    };
    await q.flush(send);
    await q.flush(send);
    expect(sent).toEqual([]);
    await q.flush(send);
    expect(sent).toEqual(["good"]);
    expect(q.snapshot().entries).toMatchObject([
      { status: "rejected", message: "No se pudo enviar." },
    ]);
  });
});

describe("offline queue: storage", () => {
  it("survives a restart: what was queued offline is sent by the next app start", async () => {
    const store = fakeStore();
    const before = queueOn(store);
    await before.setOwner("ana");
    await before.enqueue("arrive", "s1");
    await before.enqueue("fail", "s1");
    await before.flush(async () => ({ result: "offline" }));

    const after = queueOn(store);
    await after.setOwner("ana");
    expect(after.snapshot().pending).toBe(2);
    const api = server();
    await after.flush(api.send);
    expect(api.received).toEqual(["arrive:s1", "fail:s1"]);
  });

  it("keeps working in memory when the store refuses writes", async () => {
    const store = fakeStore();
    store.failWrites = true;
    const q = queueOn(store);
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    expect(q.snapshot().pending).toBe(1);
    const api = server();
    await q.flush(api.send);
    expect(api.received).toEqual(["arrive:s1"]);
  });

  it("ignores a corrupt store and drops entries older than the limit", async () => {
    const corrupt = fakeStore();
    corrupt.map.set(KEY, "{not json");
    const q = queueOn(corrupt);
    await q.setOwner("ana");
    expect(q.snapshot().entries).toEqual([]);

    const store = fakeStore();
    store.map.set(
      KEY,
      JSON.stringify([
        {
          id: "old",
          owner: "ana",
          kind: "arrive",
          payload: "s0",
          createdAt: 0,
          status: "pending",
          attempts: 0,
        },
        {
          id: "new",
          owner: "ana",
          kind: "arrive",
          payload: "s1",
          createdAt: 999_000,
          status: "pending",
          attempts: 0,
        },
        { nonsense: true },
      ]),
    );
    const fresh = queueOn(store, { maxAgeMs: 10_000 });
    await fresh.setOwner("ana");
    expect(fresh.snapshot().entries.map((e) => e.id)).toEqual(["new"]);
  });

  it("keeps only the latest pending entry with the same coalescing key", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("position", "p1", { coalesce: "position" });
    await q.enqueue("arrive", "s1");
    await q.enqueue("position", "p2", { coalesce: "position" });
    await q.enqueue("position", "p3", { coalesce: "position" });
    const api = server();
    await q.flush(api.send);
    expect(api.received).toEqual(["arrive:s1", "position:p3"]);
  });

  it("never lets coalescing replace an entry that is being sent or was refused", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("position", "refused", { coalesce: "position" });
    await q.flush(async () => ({ result: "rejected", message: "No." }));
    await q.enqueue("position", "p1", { coalesce: "position" });
    let release: (outcome: SendOutcome) => void = () => undefined;
    let calls = 0;
    const pass = q.flush((): Promise<SendOutcome> => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ result: "offline" });
      return new Promise<SendOutcome>((resolve) => {
        release = resolve;
      });
    });
    // p1 is on its way when p2 comes in.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await q.enqueue("position", "p2", { coalesce: "position" });
    expect(q.snapshot().entries.map((e) => `${e.payload}:${e.status}`)).toEqual([
      "refused:rejected",
      "p1:sending",
      "p2:pending",
    ]);
    release({ result: "done" });
    await pass;
    expect(q.snapshot().entries.map((e) => `${e.payload}:${e.status}`)).toEqual([
      "refused:rejected",
      "p2:pending",
    ]);
  });
});

describe("offline queue: age limits", () => {
  function clocked(options: Partial<QueueOptions> = {}) {
    const time = { now: 1_000_000 };
    let id = 0;
    const store = fakeStore();
    const make = () =>
      createOfflineQueue({
        store,
        key: KEY,
        newId: () => `e${++id}`,
        now: () => time.now,
        ...options,
      });
    return { time, store, make };
  }

  it("checks each entry's own limit before every pass, not only at start-up", async () => {
    const { time, make } = clocked({
      maxAgeMs: (entry) => (entry.kind === "position" ? 5 * 60_000 : 36 * 3_600_000),
    });
    const q = make();
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    await q.enqueue("position", "p1", { coalesce: "position" });
    time.now += 10 * 60_000; // ten minutes without signal
    const api = server();
    await q.flush(api.send);
    // The arrival still counts; a ten-minute-old position would mislead Central.
    expect(api.received).toEqual(["arrive:s1"]);
    expect(q.snapshot().entries).toEqual([]);
  });

  it("sets aside an action that waited too long, with a message, instead of dropping it silently", async () => {
    const { time, store, make } = clocked({
      maxAgeMs: 60_000,
      expiredMessage: (entry) => (entry.kind === "position" ? null : "Nunca se envió."),
    });
    const q = make();
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    await q.enqueue("position", "p1");
    time.now += 61_000;
    // Read again after a restart: still reported.
    const restarted = make();
    await restarted.setOwner("ana");
    const api = server();
    await restarted.flush(api.send);
    expect(api.received).toEqual([]);
    expect(restarted.snapshot().entries.map((e) => [e.payload, e.status, e.message])).toEqual([
      ["s1", "rejected", "Nunca se envió."],
    ]);
    expect(store.map.get(KEY)).toContain("Nunca se envió.");

    // Left without being dismissed for another full period, it goes.
    time.now += 61_000;
    await restarted.flush(api.send);
    expect(restarted.snapshot().entries).toEqual([]);
  });
});

describe("offline queue: accounts", () => {
  it("never sends one account's actions while another is signed in", async () => {
    const store = fakeStore();
    const q = queueOn(store);
    await q.setOwner("ana");
    await q.enqueue("fail", "s1");
    await q.flush(async () => ({ result: "offline" }));

    // Ana signs out; Luis signs in on the same phone.
    await q.setOwner(null);
    await expect(q.enqueue("arrive", "x")).rejects.toThrow();
    await q.setOwner("luis");
    expect(q.snapshot().entries).toEqual([]);
    const api = server();
    await q.flush(api.send);
    expect(api.received).toEqual([]);
    await q.enqueue("arrive", "s9");
    await q.flush(api.send);
    expect(api.received).toEqual(["arrive:s9"]);

    // A change of account: Ana's action could never be sent as Luis, so it
    // left the phone when he signed in.
    expect(store.map.get(KEY) ?? "").not.toContain("s1");
    const later = queueOn(store);
    await later.setOwner("ana");
    expect(later.snapshot().pending).toBe(0);
  });

  it("keeps an account's actions across its own sign-out and sign-in", async () => {
    const store = fakeStore();
    const q = queueOn(store);
    await q.setOwner("ana");
    await q.enqueue("fail", "s1");
    await q.flush(async () => ({ result: "offline" }));
    await q.setOwner(null);
    expect(q.snapshot().entries).toEqual([]);

    const later = queueOn(store);
    await later.setOwner("ana");
    const api = server();
    await later.flush(api.send);
    expect(api.received).toEqual(["fail:s1"]);
  });

  it("removes another account's entries from the store at a change of account, after a restart too", async () => {
    const store = fakeStore();
    const before = queueOn(store);
    await before.setOwner("ana");
    await before.enqueue("arrive", "s1");
    await before.enqueue("position", "p1", { coalesce: "position" });
    await before.flush(async (entry) =>
      entry.kind === "arrive" ? { result: "rejected", message: "no" } : { result: "offline" },
    );

    const after = queueOn(store);
    await after.setOwner("luis");
    expect(after.snapshot().entries).toEqual([]);
    expect(store.map.has(KEY)).toBe(false);
  });

  it("stops a pass when the account changes during it", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    await q.enqueue("arrive", "s2");
    const sent: string[] = [];
    await q.flush(async (entry) => {
      sent.push(String(entry.payload));
      await q.setOwner("luis");
      return { result: "done" };
    });
    // The pass stopped at once; Luis signing in also removed what Ana had left.
    expect(sent).toEqual(["s1"]);
    await q.setOwner("ana");
    expect(q.snapshot().entries).toEqual([]);
  });

  it("discards what matches, for example positions at sign-out", async () => {
    const q = queueOn(fakeStore());
    await q.setOwner("ana");
    await q.enqueue("position", "p1", { coalesce: "position" });
    await q.enqueue("fail", "s1");
    await q.discard((entry) => entry.kind === "position");
    expect(q.snapshot().entries.map((e) => e.kind)).toEqual(["fail"]);
  });

  it("tells subscribers when something changes", async () => {
    const q = queueOn(fakeStore());
    let calls = 0;
    const stop = q.subscribe(() => {
      calls += 1;
    });
    await q.setOwner("ana");
    await q.enqueue("arrive", "s1");
    const seen = calls;
    expect(seen).toBeGreaterThan(0);
    const first = q.snapshot();
    expect(q.snapshot()).toBe(first);
    stop();
    await q.enqueue("arrive", "s2");
    expect(calls).toBe(seen);
  });
});
