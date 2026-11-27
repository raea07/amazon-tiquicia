import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The ratchet of SISTEMA.md §2.5 phase B: for each app, how many lines still
 * use a pattern of today's look. The patterns are read from
 * docs/brand/system/migration.json ("ratchet"), never copied. A count may only
 * go down; an app that has moved to Carreta must reach 0.
 *
 * Counting is that of `rg -c` (lines that match at least once) over every
 * .ts, .tsx and .css file under apps/<app>/src. The one multi-line pattern
 * (its ripgrep form holds `(?s:`) counts each match once, as `rg -c -U` does
 * for matches that start on different lines.
 */

/** The eight apps, by their folder under apps/. */
export const ratchetApps = [
  "web",
  "seller",
  "ops",
  "field",
  "shop-native",
  "seller-native",
  "driver-native",
  "warehouse-native",
] as const;

export type RatchetApp = (typeof ratchetApps)[number];

export interface RatchetPattern {
  name: string;
  /** The pattern as migration.json writes it (ripgrep syntax). */
  ripgrep: string;
  regex: RegExp;
  multiline: boolean;
}

/** Turns the ripgrep patterns of migration.json into JavaScript ones. */
export function ratchetPatterns(migration: { ratchet: Record<string, string> }): RatchetPattern[] {
  return Object.entries(migration.ratchet).map(([name, ripgrep]) => {
    const multiline = ripgrep.includes("(?s:");
    // ripgrep's `(?s:.)` is "any character, line ends too": `[\s\S]` here.
    const source = ripgrep.replaceAll("(?s:.)", "[\\s\\S]");
    if (/\(\?[a-z]/.test(source)) throw new Error(`Unsupported flag group in ${ripgrep}`);
    return { name, ripgrep, regex: new RegExp(source, "g"), multiline };
  });
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(path);
  }
  return out.sort();
}

/** Counts one pattern in one text: matching lines, or matches when multi-line. */
export function countPattern(pattern: RatchetPattern, text: string): number {
  const regex = new RegExp(pattern.regex.source, "g");
  if (pattern.multiline) return [...text.matchAll(regex)].length;
  let lines = 0;
  for (const line of text.split("\n")) {
    regex.lastIndex = 0;
    if (regex.test(line)) lines += 1;
  }
  return lines;
}

/** Counts every pattern over apps/<app>/src. */
export function countApp(
  repoRoot: string,
  app: RatchetApp,
  patterns: RatchetPattern[],
): Record<string, number> {
  const texts = sourceFiles(join(repoRoot, "apps", app, "src")).map((file) =>
    readFileSync(file, "utf8"),
  );
  return Object.fromEntries(
    patterns.map((pattern) => [
      pattern.name,
      texts.reduce((sum, text) => sum + countPattern(pattern, text), 0),
    ]),
  );
}

/** What `ratchet/<app>.json` holds. */
export interface RatchetFile {
  app: RatchetApp;
  /** Commit at which the counts were last measured. */
  measuredAt: string;
  counts: Record<string, number>;
}
