import { describe, expect, it } from "vitest";
import { systemHealth } from "./system-health";

/**
 * The health page's answer is read by a console that may be one deploy behind
 * the database (the release checklist applies migrations first). A line,
 * state or job reason the console does not know yet must not make the whole
 * page fail, and must never read as good.
 */
describe("system health schema", () => {
  const line = {
    key: "messages_stopped",
    state: "ok",
    count: 0,
    since: null,
    until: null,
    refs: [],
    parts: {},
    minutes: null,
  };
  const job = {
    name: "notify-sweep",
    every_seconds: 30,
    late_after_seconds: 300,
    last_run_at: null,
    last_status: null,
    state: "unknown",
    reason: "no_history",
  };

  it("reads a line it does not know, with a state it does not know as unknown", () => {
    const parsed = systemHealth.parse({
      checked_at: "2026-11-27T12:00:00Z",
      lines: [line, { ...line, key: "something_new", state: "degraded" }],
      jobs: {
        history: "unavailable",
        reason: "some_new_reason",
        items: [
          {
            ...job,
            reason: "paused_by_hand",
            state: "stopped",
            last_status: "odd",
          },
        ],
      },
    });
    expect(parsed.lines.map((l) => [l.key, l.state])).toEqual([
      ["messages_stopped", "ok"],
      ["something_new", "unknown"],
    ]);
    expect(parsed.jobs?.items[0]).toMatchObject({
      reason: "paused_by_hand",
      state: "unknown",
      last_status: null,
    });
    expect(parsed.jobs?.reason).toBe("some_new_reason");
  });

  it("still refuses an answer that is not a health page", () => {
    expect(() =>
      systemHealth.parse({
        checked_at: "x",
        lines: [{ key: "a" }],
        jobs: null,
      }),
    ).toThrow();
  });
});
