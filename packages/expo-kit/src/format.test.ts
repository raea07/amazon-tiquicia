import { describe, expect, it } from "vitest";
// The web's formatting, read from its source so the two cannot drift.
import * as web from "../../ui/src/commerce";
import { formatDate, formatDateTime, formatPrice } from "./format";

describe("formatting, as the web does it", () => {
  it.each([0, 100, 1_250_000, 238_740, 28_900_000])("price %i", (minor) => {
    expect(formatPrice(minor)).toBe(web.formatPrice(minor));
  });

  it("writes colones with a narrow no-break space and no céntimos when there are none", () => {
    expect(formatPrice(1_250_000)).toBe("₡12 500");
    expect(formatPrice(238_740)).toBe("₡2 387,40");
  });

  it.each(["2026-11-23", "2026-12-31", "2026-11-21T20:42:00Z"])("date %s", (value) => {
    expect(formatDate(value)).toBe(web.formatDate(value));
    expect(formatDateTime(value)).toBe(web.formatDateTime(value));
  });

  it("never shifts a calendar date with the time zone", () => {
    expect(formatDate("2026-11-23")).toMatch(/lunes.*23.*noviembre/);
  });
});
