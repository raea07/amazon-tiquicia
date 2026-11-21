// Runs the native journeys: each one drives the WEB EXPORT of a native app in
// Chromium at phone size, against the lane's API, on a freshly seeded database.
//
//   tools/dev/stack.sh native 5            build and serve the exports for lane 5
//   tools/dev/stack.sh native-e2e 5        run every journey against lane 5
//   tools/dev/stack.sh native-e2e 5 shop   only these
//
// Kept apart from tools/e2e (the web apps' journeys) so neither runner changes
// what the other does. The settings come from stack.sh: PG_DB_NAME,
// NATIVE_SHOP_URL…, NATIVE_SHOTS.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const all = readdirSync(`${here}journeys`)
  .filter((file) => file.endsWith(".cjs"))
  .map((file) => file.slice(0, -4))
  .sort();
const chosen = process.argv.slice(2).filter((name) => all.includes(name));
const journeys = chosen.length > 0 ? chosen : all;

const shots = process.env.NATIVE_SHOTS ?? `${here}screenshots`;
mkdirSync(shots, { recursive: true });

const failed = [];
for (const journey of journeys) {
  // Journeys place orders and sign people in: each starts from the seed.
  const reset = spawnSync("bash", [`${root}supabase/scripts/local-db.sh`, "reset"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (reset.status !== 0) {
    console.error(`Could not reset the database before "${journey}".`);
    process.exit(1);
  }
  console.log(`\n── native ${journey} ${"─".repeat(52 - journey.length)}`);
  const run = spawnSync(process.execPath, [`${here}journeys/${journey}.cjs`], {
    stdio: "inherit",
    env: { ...process.env, NATIVE_SHOTS: shots },
  });
  if (run.status !== 0) failed.push(journey);
}

console.log(
  failed.length === 0
    ? `\nAll ${journeys.length} native journeys passed. Screenshots: ${shots}`
    : `\nFAILED: ${failed.join(", ")}. Screenshots: ${shots}`,
);
process.exit(failed.length === 0 ? 0 : 1);
