import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fontAdvance,
  fontCmap,
  fontName,
  fontWeightClass,
  readFontTables,
} from "../lib/font-tables";
import { fontFiles, typeface } from "../src/tokens";

/*
 * The Carreta font files (SISTEMA.md §2.4), read table by table: the names
 * iOS registers them by, the characters Spanish prices and times need, and
 * tabular digits. Each file is also compared, by sha256, with the record that
 * docs/brand/system/src/fonts.py wrote when it made it (fonts/manifest.json).
 */

const fontsDir = fileURLToPath(new URL("../../../docs/brand/system/fonts/", import.meta.url));

interface Check {
  missing: string[];
  digits_tabular: boolean;
  nnbsp_advance: number;
  name1: string;
  name2: string;
  name6: string;
  name16: string;
  name17: string;
  weightClass: number;
  kern: boolean;
  codepoints: number;
  ok: boolean;
}
interface Face {
  family: string;
  weight: number;
  outputs: Record<string, { sha256: string; bytes: number; check: Check }>;
}

const manifest = JSON.parse(readFileSync(`${fontsDir}manifest.json`, "utf8")) as { faces: Face[] };
const files = manifest.faces.flatMap((face) =>
  Object.entries(face.outputs).map(([path, record]) => ({ path, face, record })),
);

/** ₡, the two no-break spaces, the minus, Spanish letters and marks, and the other signs of §2.4. */
const NEEDED = [
  ["colón sign", 0x20a1],
  ["narrow no-break space", 0x202f],
  ["no-break space", 0x00a0],
  ["minus sign", 0x2212],
  ...[..."ñÑáéíóúüÁÉÍÓÚÜ¿¡«»×·–…"].map((c) => [c, c.codePointAt(0) ?? 0] as const),
  ...[..."0123456789"].map((c) => [`digit ${c}`, c.codePointAt(0) ?? 0] as const),
] as const;

describe("Carreta font files", () => {
  it("are the 14 files of the manifest, and no other", () => {
    const onDisk = ["web", "ttf"].flatMap((dir) =>
      readdirSync(`${fontsDir}${dir}`).map((file) => `fonts/${dir}/${file}`),
    );
    expect(files).toHaveLength(14);
    expect(onDisk.sort()).toEqual(files.map((file) => file.path).sort());
    expect([...Object.values(fontFiles.web), ...Object.values(fontFiles.phone)].sort()).toEqual(
      files.map((file) => file.path).sort(),
    );
  });

  it.each(files)("$path matches its sha256 in manifest.json", ({ path, record }) => {
    const bytes = readFileSync(`${fontsDir}${path.replace(/^fonts\//, "")}`);
    expect(bytes.length).toBe(record.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.sha256);
    expect(record.check.ok).toBe(true);
  });

  it.each(files)(
    "$path is named, weighted and filled as Carreta needs",
    ({ path, face, record }) => {
      const font = readFontTables(readFileSync(`${fontsDir}${path.replace(/^fonts\//, "")}`));
      const family =
        face.family === "Epilogue" ? typeface.titleFamilyNative : typeface.textFamilyNative;
      expect(["Epilogue", "Fira Sans"]).toContain(family);
      expect(fontName(font, 16), "nameID 16").toBe(family);
      expect(fontName(font, 17), "nameID 17").toBe(record.check.name17);
      expect(fontName(font, 1)).toBe(record.check.name1);
      expect(fontName(font, 2)).toBe(record.check.name2);
      expect(fontName(font, 6)).toBe(record.check.name6);
      expect(fontWeightClass(font)).toBe(face.weight);
      const weights: readonly number[] =
        face.family === "Epilogue" ? typeface.titleWeights : typeface.textWeights;
      expect(weights).toContain(face.weight);

      const cmap = fontCmap(font);
      const missing = NEEDED.filter(([, code]) => !cmap.has(code)).map(([what]) => what);
      expect(missing, "missing characters").toEqual([]);
      expect(cmap.size).toBe(record.check.codepoints);

      const digits = [..."0123456789"].map((c) =>
        fontAdvance(font, cmap.get(c.charCodeAt(0)) ?? 0),
      );
      expect(new Set(digits).size, `digit advances ${digits.join(" ")}`).toBe(1);
      expect(fontAdvance(font, cmap.get(0x202f) ?? 0)).toBe(record.check.nnbsp_advance);
      expect(font.tables.has("GPOS"), "kerning (GPOS)").toBe(true);
    },
  );

  it("gives the web and phone file of each weight the same names and characters", () => {
    for (const face of manifest.faces) {
      const [a, b] = Object.keys(face.outputs).map((path) =>
        readFontTables(readFileSync(`${fontsDir}${path.replace(/^fonts\//, "")}`)),
      );
      if (!a || !b) throw new Error(`${face.family} ${face.weight} lacks a file`);
      for (const id of [1, 2, 6, 16, 17]) expect(fontName(a, id)).toBe(fontName(b, id));
      expect([...fontCmap(a).keys()]).toEqual([...fontCmap(b).keys()]);
    }
  });
});
