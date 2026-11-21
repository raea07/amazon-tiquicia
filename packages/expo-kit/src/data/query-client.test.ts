import { ApiError } from "@yuntera/db";
import { describe, expect, it, vi } from "vitest";

// The cache module wires itself to React Native's AppState; these tests only
// need the retry rule, so the native modules are replaced with empty ones.
vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "ios" } }));
vi.mock("expo-network", () => ({}));

const { shouldRetry } = await import("./query-client");

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
