// Runs the browser journeys, one app at a time, each on a freshly seeded database.
//
//   pnpm --filter @yuntera/e2e journeys            all four
//   pnpm --filter @yuntera/e2e journeys web ops    only these
//
// Before running: PostgreSQL reachable (see supabase/scripts/local-db.sh), the
// local API stand-in on :54321 and the built apps on :3000–:3003. The README
// next to this file has the exact commands.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const all = ["web", "seller", "ops", "field"];
const chosen = process.argv.slice(2).filter((name) => all.includes(name));
const journeys = chosen.length > 0 ? chosen : all;

const shots = process.env.E2E_SHOTS ?? `${here}screenshots`;
mkdirSync(shots, { recursive: true });

const failed = [];
for (const journey of journeys) {
  // Every journey changes data (orders, routes, sellers), so each starts from the seed.
  const reset = spawnSync("bash", [`${root}supabase/scripts/local-db.sh`, "reset"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (reset.status !== 0) {
    console.error(`Could not reset the database before "${journey}".`);
    process.exit(1);
  }

  console.log(`\n── ${journey} ${"─".repeat(60 - journey.length)}`);
  const run = spawnSync(process.execPath, [`${here}journeys/${journey}.cjs`], {
    stdio: "inherit",
    env: { ...process.env, E2E_SHOTS: shots },
  });
  if (run.status !== 0) failed.push(journey);
}

console.log(
  failed.length === 0
    ? `\nAll ${journeys.length} journeys passed. Screenshots: ${shots}`
    : `\nFAILED: ${failed.join(", ")}. Screenshots: ${shots}`,
);
process.exit(failed.length === 0 ? 0 : 1);
