import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assetCopies } from "../lib/asset-map";
import { brokenImageGrey, pngStats, readPng } from "../lib/png";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const sourceDir = here("../../../docs/brand/system/assets");
const assetsDir = here("../assets");
const copies = assetCopies(sourceDir);
const hash = (algorithm: string, path: string) =>
  createHash(algorithm).update(readFileSync(path)).digest("hex");

/** The artwork of before Carreta: it stays, byte for byte, until step 6. */
const TODAY_ASSETS: Record<string, string> = {
  "mark.svg": "90ca2f23e8387e9d162272df9f3841f7eca433e5ab1815f5bc28042ad79203da",
  "mark-ink.svg": "80ceb35d6880366cb6d340205466086f5c45382960f15f0a219e795df019e919",
  "mark-white.svg": "99fecadfd40219146c052a0a09ea9dcc9045f1171921c22c2bb3fda7f0aee451",
  "app-icon.svg": "537d718524b052cb683535b1d0b671813cc49f797e25eb6e67637ed9362fff08",
  "lockup-shop.svg": "f29753ac71961115c73818d22e0a7fdf2469425b91ce9d0cae2eca5fedb5f3b3",
  "lockup-seller.svg": "fafe5047e42f1e04da8e8f39cc98a0a486b9a024ee51e1d1873a7543e90ca2e6",
  "lockup-driver.svg": "7133e3965ee619e2534940195d39e512cc1777ae2a405abb7134b73ad665c497",
  "lockup-warehouse.svg": "946b9e799321fda808089f184c7a68a455eac449452d4d920717673fe490dafc",
  "lockup-ops.svg": "c2f813981675d435d6888d8f49e6660415ffa8816eefb403a0534f4bed32bdb5",
};

describe("brand assets", () => {
  it("keeps today's artwork unchanged, the mark included", () => {
    for (const [file, sha] of Object.entries(TODAY_ASSETS)) {
      expect(hash("sha256", join(assetsDir, file)), file).toBe(sha);
    }
  });

  it("ships the 15 lockups (SVG, PNG at 60 and 120 px) and every app icon of the specification", () => {
    const lockups = copies.filter((copy) => copy.target.startsWith("lockups/"));
    expect(lockups.filter((copy) => copy.target.endsWith(".svg"))).toHaveLength(15);
    expect(lockups.filter((copy) => copy.target.endsWith(".png"))).toHaveLength(30);
    const icons = copies.filter((copy) => copy.target.startsWith("app-icons/"));
    expect(icons.filter((copy) => copy.target.endsWith(".png"))).toHaveLength(36);
    expect(icons.filter((copy) => copy.target.endsWith(".svg"))).toHaveLength(5);
    expect(new Set(copies.map((copy) => copy.target)).size).toBe(copies.length);
  });

  it("holds exactly the mapped files, each identical to its source (sha256)", () => {
    const shipped = ["lockups", "app-icons"].flatMap((dir) =>
      readdirSync(join(assetsDir, dir)).map((file) => `${dir}/${file}`),
    );
    expect(shipped.sort()).toEqual(copies.map((copy) => copy.target).sort());
    for (const copy of copies) {
      expect(hash("sha256", join(assetsDir, copy.target)), copy.target).toBe(
        hash("sha256", join(sourceDir, copy.source)),
      );
    }
  });

  const pngs = copies.filter((copy) => copy.target.endsWith(".png"));

  it("has no two PNGs alike", () => {
    const seen = new Map<string, string>();
    for (const copy of pngs) {
      const sha = hash("sha256", join(assetsDir, copy.target));
      expect(seen.get(sha), `${copy.target} repeats`).toBeUndefined();
      seen.set(sha, copy.target);
    }
  });

  // The rules of docs/brand/system/src/checkpng.py.
  it.each(pngs.map((copy) => copy.target))("%s is not blank or broken", (target) => {
    const png = readPng(readFileSync(join(assetsDir, target)));
    const { mostCommonShare, visibleShare } = pngStats(png);
    expect(png.width).toBeGreaterThan(0);
    expect(brokenImageGrey(png), "broken-image grey in the corner").toBeLessThanOrEqual(3);
    if (target.startsWith("lockups/")) {
      expect(visibleShare, "visible pixels").toBeGreaterThanOrEqual(0.08);
    } else if (!/adaptive-background|monochrome|splash/.test(target)) {
      expect(mostCommonShare, "share of one colour").toBeLessThanOrEqual(0.9);
    }
    if (/-1024\.png$/.test(target)) {
      expect(png.colourType, "the App Store refuses an alpha channel").toBe(2);
    }
  });

  it("reads each PNG as the specification's own check did (png-check.txt)", () => {
    const report = new Map(
      readFileSync(join(sourceDir, "png-check.txt"), "utf8")
        .split("\n")
        .filter((line) => line.startsWith("assets/"))
        .map((line) => {
          const [name = "", size, mode, most, visible, md5] = line.split("\t");
          return [name.replace(/^assets\//, ""), { size, mode, most, visible, md5 }];
        }),
    );
    expect(readFileSync(join(sourceDir, "png-check.txt"), "utf8")).toContain("all PNGs pass");
    for (const copy of pngs) {
      const row = report.get(copy.source);
      expect(row, copy.source).toBeDefined();
      const png = readPng(readFileSync(join(assetsDir, copy.target)));
      const { mostCommonShare, visibleShare } = pngStats(png);
      expect(row?.size).toBe(`${png.width}x${png.height}`);
      expect(row?.mode).toBe(png.colourType === 6 ? "RGBA" : "RGB");
      expect(row?.md5).toBe(hash("md5", join(assetsDir, copy.target)).slice(0, 8));
      const percent = (text?: string) => Number.parseInt(/(\d+)%/.exec(text ?? "")?.[1] ?? "", 10);
      expect(Math.abs(percent(row?.most) - mostCommonShare * 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(percent(row?.visible) - visibleShare * 100)).toBeLessThanOrEqual(1);
    }
  });
});
