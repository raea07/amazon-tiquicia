import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countApp, countPattern, type RatchetFile, ratchetApps, ratchetPatterns } from "./ratchet";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const root = here("../../../");
const migration = JSON.parse(
  readFileSync(here("../../../docs/brand/system/migration.json"), "utf8"),
);
const patterns = ratchetPatterns(migration);
const recorded = (app: string) =>
  JSON.parse(readFileSync(here(`../ratchet/${app}.json`), "utf8")) as RatchetFile;

describe("ratchet (SISTEMA.md §2.5 phase B)", () => {
  it("reads the nine patterns of migration.json", () => {
    expect(patterns.map((p) => p.name)).toEqual(Object.keys(migration.ratchet));
    expect(patterns).toHaveLength(9);
    expect(patterns.filter((p) => p.multiline).map((p) => p.name)).toEqual([
      "module-level StyleSheet reading colours (rg -U, multiline)",
    ]);
  });

  it("has one count file per app, and no other", () => {
    expect(
      readdirSync(here("../ratchet"))
        .filter((file) => file.endsWith(".json"))
        .sort(),
    ).toEqual(ratchetApps.map((app) => `${app}.json`).sort());
    for (const app of ratchetApps) {
      expect(existsSync(here(`../../../apps/${app}/src`)), app).toBe(true);
      const file = recorded(app);
      expect(file.app).toBe(app);
      expect(Object.keys(file.counts)).toEqual(Object.keys(migration.ratchet));
    }
  });

  it.each(ratchetApps)("%s: no count went up", (app) => {
    const now = countApp(root, app, patterns);
    const before = recorded(app).counts;
    const raised = Object.entries(now)
      .filter(([name, count]) => count > (before[name] ?? 0))
      .map(([name, count]) => `"${name}": ${before[name]} → ${count}`);
    expect(
      raised,
      `${app} uses today's look in more places than ratchet/${app}.json allows. ` +
        "Use the Carreta names (SISTEMA.md §2.5) instead.",
    ).toEqual([]);
  });

  it("counts lines as `rg -c` does, and multi-line matches once", () => {
    const [ramp] = patterns;
    const sheet = patterns.find((p) => p.multiline);
    if (!ramp || !sheet) throw new Error("patterns missing");
    expect(
      countPattern(ramp, 'a="bg-celeste-50 text-anil-900"\nb="bg-white"\nc="border-maiz-400"'),
    ).toBe(2);
    expect(
      countPattern(sheet, "const s = StyleSheet.create({\n  a: { color: colors.ink },\n});\n"),
    ).toBe(1);
    expect(countPattern(sheet, "const s = StyleSheet.create({ a: { padding: 4 } });\n")).toBe(0);
  });

  it("catches the names that change meaning", () => {
    const brand = patterns.find((p) => p.name === "brand outside the delivery components");
    const warning = patterns.find((p) => p.name === "warning used as text");
    if (!brand || !warning) throw new Error("patterns missing");
    for (const line of ["bg-brand", "border-brand", "accent-(--color-brand)", "colors.brand"]) {
      expect(countPattern(brand, line), line).toBe(1);
    }
    expect(countPattern(warning, 'className="text-warning"')).toBe(1);
    expect(countPattern(brand, "bg-primary text-on-primary")).toBe(0);
  });
});
