import { ApiError } from "@yuntera/db";
import { describe, expect, it, vi } from "vitest";

// The cache module wires itself to React Native's AppState; these tests only
// need the retry rule, so the native modules are replaced with empty ones.
vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "ios" } }));
vi.mock("expo-network", () => ({}));

const { createQueryClient, shouldRetry } = await import("./query-client");
const { onlineManager } = await import("@tanstack/react-query");

describe("shouldRetry", () => {
  it("repeats a request that never arrived, twice at most", () => {
    const offline = new ApiError("network");
    expect(shouldRetry(0, offline)).toBe(true);
    expect(shouldRetry(1, offline)).toBe(true);
    expect(shouldRetry(2, offline)).toBe(false);
  });

  it("does not repeat an answer from the database", () => {
    expect(shouldRetry(0, new ApiError("insufficient_stock"))).toBe(false);
    expect(shouldRetry(0, new ApiError("not_authenticated"))).toBe(false);
    expect(shouldRetry(0, new Error("anything else"))).toBe(false);
  });
});

describe("a change made while offline", () => {
  it("fails at once instead of waiting to be sent when the network returns", async () => {
    const client = createQueryClient();
    const mutationFn = vi.fn(async () => {
      throw new ApiError("network");
    });
    onlineManager.setOnline(false);
    try {
      const mutation = client.getMutationCache().build(client, { mutationFn });
      const outcome = await Promise.race([
        mutation.execute(undefined).then(
          () => "sent",
          (error: unknown) => (error instanceof ApiError ? error.code : "other"),
        ),
        new Promise((resolve) => setTimeout(() => resolve("held"), 200)),
      ]);
      expect(outcome).toBe("network");
      expect(mutation.state.isPaused).toBe(false);
      expect(mutationFn).toHaveBeenCalledTimes(1);
      // Coming back online sends nothing more.
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      expect(mutationFn).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(true);
      client.clear();
    }
  });
});
