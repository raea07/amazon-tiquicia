import { describe, expect, it } from "vitest";
import { CATEGORY_MENU_CACHE, CATEGORY_MENU_STALE_MS } from "./freshness";

describe("the category menu", () => {
  it("is kept for minutes, not an hour", () => {
    expect(CATEGORY_MENU_STALE_MS).toBeLessThanOrEqual(5 * 60_000);
    expect(CATEGORY_MENU_CACHE.staleTime).toBe(CATEGORY_MENU_STALE_MS);
  });

  it("is read again whenever the app comes back to the foreground, fresh or not", () => {
    expect(CATEGORY_MENU_CACHE.refetchOnWindowFocus).toBe("always");
  });
});
