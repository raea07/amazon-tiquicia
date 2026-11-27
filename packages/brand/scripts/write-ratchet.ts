/**
 * Writes the ratchet counts of the apps named on the command line (all eight
 * when none is named) into ratchet/<app>.json. Run it after lowering a count:
 *
 *   pnpm --filter @yuntera/brand exec tsx scripts/write-ratchet.ts web
 *
 * It refuses to raise a count: the ratchet only goes down.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  countApp,
  type RatchetApp,
  type RatchetFile,
  ratchetApps,
  ratchetPatterns,
} from "../lib/ratchet";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const root = here("../../../");
const patterns = ratchetPatterns(
  JSON.parse(readFileSync(here("../../../docs/brand/system/migration.json"), "utf8")),
);
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root })
  .toString()
  .trim();
const asked = process.argv.slice(2);
for (const name of asked) {
  if (!(ratchetApps as readonly string[]).includes(name)) {
    throw new Error(`Unknown app ${name}. Apps: ${ratchetApps.join(", ")}`);
  }
}
const chosen = (asked.length > 0 ? asked : ratchetApps) as readonly RatchetApp[];

for (const app of chosen) {
  const file = here(`../ratchet/${app}.json`);
  const counts = countApp(root, app, patterns);
  if (existsSync(file)) {
    const before = JSON.parse(readFileSync(file, "utf8")) as RatchetFile;
    for (const [name, count] of Object.entries(counts)) {
      const was = before.counts[name];
      if (was !== undefined && count > was) {
        throw new Error(
          `${app}: "${name}" went up from ${was} to ${count}. Bring it down instead.`,
        );
      }
    }
  }
  const data: RatchetFile = { app, measuredAt: commit, counts };
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.info(`wrote ${file}`);
}
