import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REMOVED_AFTER_START_NOTE,
  REMOVED_BEFORE_START_NOTE,
  removedBeforeStart,
  skippedStopNote,
} from "./route-stops";

const started = { status: "in_progress", started_at: "2026-11-23T14:00:00+00:00" };
const removedAt = (completed_at: string | null) => ({ status: "skipped", completed_at });

describe("a stop staff removed, as the driver reads it", () => {
  it("is not collected while the route has not started", () => {
    expect(removedBeforeStart({ status: "assigned", started_at: null }, removedAt(null))).toBe(
      true,
    );
    expect(
      skippedStopNote({ status: "assigned", started_at: null }, removedAt("2026-11-23T13:00:00Z")),
    ).toBe(REMOVED_BEFORE_START_NOTE);
  });

  it("stays 'do not collect' after the start when it was removed before it", () => {
    expect(removedBeforeStart(started, removedAt("2026-11-23T13:59:59+00:00"))).toBe(true);
    expect(skippedStopNote(started, removedAt("2026-11-23T13:59:59+00:00"))).toMatch(
      /No recoja este paquete/,
    );
    // The same moment in another offset is still before.
    expect(removedBeforeStart(started, removedAt("2026-11-23T07:59:00-06:00"))).toBe(true);
  });

  it("asks for the parcel back when it was removed after the start", () => {
    expect(removedBeforeStart(started, removedAt("2026-11-23T14:30:00+00:00"))).toBe(false);
    expect(skippedStopNote(started, removedAt("2026-11-23T14:30:00+00:00"))).toBe(
      REMOVED_AFTER_START_NOTE,
    );
    expect(
      removedBeforeStart(
        { status: "completed", started_at: started.started_at },
        removedAt("2026-11-23T15:00:00Z"),
      ),
    ).toBe(false);
  });

  it("treats a removed stop with no time on a started route as possibly with the driver", () => {
    expect(removedBeforeStart(started, removedAt(null))).toBe(false);
  });

  it("says nothing about stops that were not removed", () => {
    for (const status of ["pending", "arrived", "delivered", "failed"]) {
      expect(
        removedBeforeStart(
          { status: "assigned", started_at: null },
          { status, completed_at: null },
        ),
      ).toBe(false);
    }
  });

  it("is the one rule both drivers' apps use", () => {
    const root = join(__dirname, "../../..");
    const web = readFileSync(join(root, "apps/field/src/app/ruta/page.tsx"), "utf8");
    const native = readFileSync(join(root, "apps/driver-native/src/lib/route.ts"), "utf8");
    expect(web).toMatch(/skippedStopNote\(route, stop\)/);
    expect(web).not.toContain(REMOVED_AFTER_START_NOTE);
    expect(native).toMatch(/from "@yuntera\/core"/);
    expect(native).not.toContain(REMOVED_AFTER_START_NOTE);
  });
});
