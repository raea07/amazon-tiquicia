import { color, semantic } from "@yuntera/brand";
import { format, money } from "@yuntera/core";
import { describe, expect, it } from "vitest";
import { brandName, mailColors } from "./brand.ts";
import {
  clean,
  colones,
  escapeHtml,
  fullDate,
  longDate,
  timeOfDay,
  whatsappParam,
} from "./format.ts";

describe("formatting", () => {
  it("writes colones exactly as packages/core does", () => {
    for (const amount of [0, 100, 99, 1_250_000, 2_980_000, 1_234_567_89, -50_000, 12_345]) {
      expect(colones(amount)).toBe(format(money(amount)));
    }
  });

  it("writes dates on the Costa Rican calendar", () => {
    expect(longDate("2026-11-23")).toBe("lunes 23 de noviembre");
    expect(fullDate("2026-12-03")).toBe("3 de diciembre de 2026");
    // 02:00 UTC on the 24th is still the 23rd in Costa Rica (UTC−6).
    expect(longDate("2026-11-24T02:00:00Z")).toBe("lunes 23 de noviembre");
    expect(timeOfDay("2026-11-23T19:05:00Z")).toBe("1:05 p. m.");
    expect(longDate(null)).toBe("");
  });

  it("escapes HTML and strips control characters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
    expect(clean("Línea\u0000 uno\r\n dos   tres", 50)).toBe("Línea uno dos tres");
    expect(clean("x".repeat(200), 10)).toHaveLength(10);
    expect(whatsappParam("a\n\tb      c")).toBe("a b c");
    expect(whatsappParam("")).toBe("-");
  });
});

describe("brand copy", () => {
  it("uses the brand's name and contrast-tested colours", () => {
    expect(brandName).toBe("Yuntera");
    expect(mailColors.brand).toBe(semantic.brand);
    expect(mailColors.ink).toBe(semantic.ink);
    expect(mailColors.inkMuted).toBe(semantic.inkMuted);
    expect(mailColors.link).toBe(semantic.link);
    expect(mailColors.bg).toBe(semantic.bg);
    expect(mailColors.border).toBe(semantic.border);
    expect(mailColors.surface).toBe(color.white);
    expect(mailColors.onBrand).toBe(semantic.onBrand);
  });
});
