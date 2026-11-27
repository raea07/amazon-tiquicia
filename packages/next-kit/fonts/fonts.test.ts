import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The web font files are byte-for-byte copies of docs/brand/system/fonts/web
 * (SISTEMA.md §2.4). Each is compared, by size and sha256, with the record the
 * specification's font build wrote (fonts/manifest.json); a changed, missing
 * or extra file fails. src/fonts.ts must load each file once, at its weight.
 */

const here = fileURLToPath(new URL("./", import.meta.url));
const system = fileURLToPath(new URL("../../../docs/brand/system/fonts/", import.meta.url));

interface Face {
  family: string;
  weight: number;
  outputs: Record<string, { sha256: string; bytes: number }>;
}
const manifest = JSON.parse(readFileSync(`${system}manifest.json`, "utf8")) as { faces: Face[] };
const web = manifest.faces.flatMap((face) =>
  Object.entries(face.outputs)
    .filter(([path]) => path.startsWith("fonts/web/"))
    .map(([path, record]) => ({ file: path.slice("fonts/web/".length), face, record })),
);

describe("web font files", () => {
  it("are the 7 web files of the manifest, and no other font", () => {
    const onDisk = readdirSync(here).filter((file) => /\.(woff2?|ttf|otf)$/.test(file));
    expect(web).toHaveLength(7);
    expect(onDisk.sort()).toEqual(web.map((entry) => entry.file).sort());
  });

  it.each(web)("$file matches its sha256 in manifest.json", ({ file, record }) => {
    const bytes = readFileSync(`${here}${file}`);
    expect(bytes.length).toBe(record.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.sha256);
  });

  it("ship with the licences and the list of changes", () => {
    for (const file of ["OFL-FiraSans.txt", "OFL-epilogue.txt", "MODIFICATIONS.txt"]) {
      expect(readFileSync(`${here}${file}`, "utf8"), file).toBe(
        readFileSync(`${system}${file}`, "utf8"),
      );
    }
  });

  it("are each loaded once by src/fonts.ts, at the weight of the manifest", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/fonts.ts", import.meta.url)), "utf8");
    const loaded = [
      ...source.matchAll(/path: "\.\.\/fonts\/([^"]+)", weight: "(\d+)", style: "normal"/g),
    ].map((m) => `${m[1]} ${m[2]}`);
    expect(loaded.sort()).toEqual(web.map(({ file, face }) => `${file} ${face.weight}`).sort());
  });
});
