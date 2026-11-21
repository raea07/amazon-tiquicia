import { describe, expect, it } from "vitest";
import { createSnapshotCache } from "./snapshot";

function fakeStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => void map.set(key, value),
    removeItem: async (key: string) => void map.delete(key),
  };
}

describe("snapshot cache", () => {
  it("gives the saved value back to the same account only", async () => {
    let clock = 0;
    const store = fakeStore();
    const cache = createSnapshotCache<{ stops: number }>({
      store,
      key: "route",
      maxAgeMs: 1000,
      now: () => clock,
    });
    await cache.save("ana", { stops: 3 });
    expect(await cache.load("ana")).toEqual({ owner: "ana", savedAt: 0, value: { stops: 3 } });

    clock = 1001;
    expect(await cache.load("ana")).toBeNull();
  });

  it("removes another account's value when a different account reads (a change of account)", async () => {
    const store = fakeStore();
    const cache = createSnapshotCache<number>({ store, key: "route", maxAgeMs: 1000 });
    await cache.save("ana", 1);
    expect(await cache.load("luis")).toBeNull();
    expect(store.map.has("route")).toBe(false);
    // Ana's value is gone for good, not just hidden from Luis.
    expect(await cache.load("ana")).toBeNull();
  });

  it("removes an expired value when it is read, and with prune() when nobody is signed in", async () => {
    let clock = 0;
    const store = fakeStore();
    const cache = createSnapshotCache<number>({
      store,
      key: "route",
      maxAgeMs: 1000,
      now: () => clock,
    });
    await cache.save("ana", 1);
    clock = 1000;
    await cache.prune();
    expect(store.map.has("route")).toBe(true); // still fresh: kept

    clock = 1001;
    await cache.prune();
    expect(store.map.has("route")).toBe(false);

    await cache.save("ana", 2);
    clock = 2002;
    expect(await cache.load("ana")).toBeNull();
    expect(store.map.has("route")).toBe(false);
  });

  it("treats a value saved in the future (a clock set back) as expired", async () => {
    let clock = 5000;
    const store = fakeStore();
    const cache = createSnapshotCache<number>({
      store,
      key: "route",
      maxAgeMs: 1000,
      now: () => clock,
    });
    await cache.save("ana", 1);
    clock = 0;
    expect(await cache.load("ana")).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("clears, and removes anything unreadable", async () => {
    const store = fakeStore();
    const cache = createSnapshotCache<number>({ store, key: "route", maxAgeMs: 1000 });
    await cache.save("ana", 1);
    await cache.clear();
    expect(store.map.size).toBe(0);

    store.map.set("route", "{broken");
    expect(await cache.load("ana")).toBeNull();
    expect(store.map.size).toBe(0);

    store.map.set("route", JSON.stringify({ owner: "ana" }));
    await cache.prune();
    expect(store.map.size).toBe(0);
  });

  it("keeps working when the store refuses", async () => {
    const cache = createSnapshotCache<number>({
      store: {
        getItem: () => Promise.reject(new Error("locked")),
        setItem: () => Promise.reject(new Error("full")),
        removeItem: () => Promise.reject(new Error("locked")),
      },
      key: "route",
      maxAgeMs: 1000,
    });
    await expect(cache.save("ana", 1)).resolves.toBeUndefined();
    await expect(cache.load("ana")).resolves.toBeNull();
    await expect(cache.prune()).resolves.toBeUndefined();
    await expect(cache.clear()).resolves.toBeUndefined();
  });
});
