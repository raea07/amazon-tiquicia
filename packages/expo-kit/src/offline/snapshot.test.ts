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
    expect(await cache.load("luis")).toBeNull();

    clock = 1001;
    expect(await cache.load("ana")).toBeNull();
  });

  it("clears, and reads anything unreadable as nothing", async () => {
    const store = fakeStore();
    const cache = createSnapshotCache<number>({ store, key: "route", maxAgeMs: 1000 });
    await cache.save("ana", 1);
    await cache.clear();
    expect(store.map.size).toBe(0);
    store.map.set("route", "{broken");
    expect(await cache.load("ana")).toBeNull();
  });
});
