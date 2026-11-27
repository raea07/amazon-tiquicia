import { brotliDecompressSync } from "node:zlib";

/*
 * Just enough of the OpenType format to check the Carreta font files
 * (SISTEMA.md §2.4) in plain Node: the table directory of a .ttf and of a
 * .woff2, and the name, cmap, OS/2, hhea and hmtx tables. No dependency.
 */

/** The 63 tags a WOFF2 file may name by index (WOFF2 §5.1, "Known Table Tags"). */
// biome-ignore format: a list of tags reads best in rows
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf",
  "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT",
  "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT",
  "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar",
  "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd",
  "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

export interface FontTables {
  tables: Map<string, Buffer>;
  /** WOFF2 only: tables stored in a transformed form (glyf, loca, maybe hmtx). */
  transformed: Set<string>;
}

function readSfnt(file: Buffer): FontTables {
  const count = file.readUInt16BE(4);
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = file.toString("latin1", at, at + 4);
    const offset = file.readUInt32BE(at + 8);
    const length = file.readUInt32BE(at + 12);
    tables.set(tag, file.subarray(offset, offset + length));
  }
  return { tables, transformed: new Set() };
}

function readWoff2(file: Buffer): FontTables {
  const count = file.readUInt16BE(12);
  const compressedLength = file.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = file[at++] ?? 0;
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("Bad UIntBase128");
  };
  const entries: Array<{ tag: string; length: number; transformed: boolean }> = [];
  for (let i = 0; i < count; i++) {
    const flags = file[at++] ?? 0;
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) {
      tag = file.toString("latin1", at, at + 4);
      at += 4;
    }
    if (!tag) throw new Error(`Unknown table index ${flags & 0x3f}`);
    const version = flags >> 6;
    const original = base128();
    // glyf and loca are transformed unless version 3; every other table only when version is not 0.
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : original;
    entries.push({ tag, length, transformed });
  }
  const data = brotliDecompressSync(file.subarray(at, at + compressedLength));
  const tables = new Map<string, Buffer>();
  const transformed = new Set<string>();
  let offset = 0;
  for (const entry of entries) {
    tables.set(entry.tag, data.subarray(offset, offset + entry.length));
    if (entry.transformed) transformed.add(entry.tag);
    offset += entry.length;
  }
  return { tables, transformed };
}

export function readFontTables(file: Buffer): FontTables {
  const signature = file.toString("latin1", 0, 4);
  if (signature === "wOF2") return readWoff2(file);
  if (signature === "\u0000\u0001\u0000\u0000" || signature === "true") return readSfnt(file);
  throw new Error(`Not a TrueType or WOFF2 file (${JSON.stringify(signature)})`);
}

function table(font: FontTables, tag: string): Buffer {
  const found = font.tables.get(tag);
  if (!found) throw new Error(`No ${tag} table`);
  return found;
}

/** A name of the name table: Windows Unicode English first, then Macintosh Roman. */
export function fontName(font: FontTables, nameId: number): string | undefined {
  const name = table(font, "name");
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  let mac: string | undefined;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const platform = name.readUInt16BE(at);
    const language = name.readUInt16BE(at + 4);
    if (name.readUInt16BE(at + 6) !== nameId) continue;
    const length = name.readUInt16BE(at + 8);
    const start = strings + name.readUInt16BE(at + 10);
    const bytes = name.subarray(start, start + length);
    if (platform === 3 && language === 0x409) {
      return Buffer.from(bytes).swap16().toString("utf16le");
    }
    if (platform === 1 && language === 0) mac = bytes.toString("latin1");
  }
  return mac;
}

/** The code point → glyph map, from a format 4 or format 12 Unicode subtable. */
export function fontCmap(font: FontTables): Map<number, number> {
  const cmap = table(font, "cmap");
  const count = cmap.readUInt16BE(2);
  let best: { offset: number; format: number } | undefined;
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 8;
    const platform = cmap.readUInt16BE(at);
    const encoding = cmap.readUInt16BE(at + 2);
    const offset = cmap.readUInt32BE(at + 4);
    const format = cmap.readUInt16BE(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    if (!best || format === 12) best = { offset, format };
  }
  if (!best) throw new Error("No Unicode cmap subtable");
  const map = new Map<number, number>();
  const s = best.offset;
  if (best.format === 12) {
    const groups = cmap.readUInt32BE(s + 12);
    for (let g = 0; g < groups; g++) {
      const at = s + 16 + g * 12;
      const first = cmap.readUInt32BE(at);
      const last = cmap.readUInt32BE(at + 4);
      const glyph = cmap.readUInt32BE(at + 8);
      for (let c = first; c <= last; c++) map.set(c, glyph + c - first);
    }
    return map;
  }
  const segments = cmap.readUInt16BE(s + 6) / 2;
  const ends = s + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  for (let i = 0; i < segments; i++) {
    const end = cmap.readUInt16BE(ends + i * 2);
    const start = cmap.readUInt16BE(starts + i * 2);
    const delta = cmap.readInt16BE(deltas + i * 2);
    const range = cmap.readUInt16BE(ranges + i * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (range === 0) glyph = (c + delta) & 0xffff;
      else {
        const at = ranges + i * 2 + range + (c - start) * 2;
        const raw = cmap.readUInt16BE(at);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(c, glyph);
    }
  }
  return map;
}

/** usWeightClass of the OS/2 table. */
export function fontWeightClass(font: FontTables): number {
  return table(font, "OS/2").readUInt16BE(4);
}

/** The advance width of a glyph, from hhea and hmtx (also a transformed WOFF2 hmtx). */
export function fontAdvance(font: FontTables, glyph: number): number {
  const metrics = table(font, "hhea").readUInt16BE(34);
  const hmtx = table(font, "hmtx");
  const index = Math.min(glyph, metrics - 1);
  // Plain hmtx: (advance, lsb) pairs. Transformed: a flags byte, then the advances.
  return font.transformed.has("hmtx")
    ? hmtx.readUInt16BE(1 + index * 2)
    : hmtx.readUInt16BE(index * 4);
}
