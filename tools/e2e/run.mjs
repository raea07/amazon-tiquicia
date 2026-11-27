// Runs the browser journeys, one app at a time, each on a freshly seeded database.
//
//   pnpm --filter @yuntera/e2e journeys            all of them
//   pnpm --filter @yuntera/e2e journeys web ops    only these
//
// Before running: PostgreSQL reachable (see supabase/scripts/local-db.sh), the
// local API stand-in on :54321 and the built apps on :3000–:3003. The README
// next to this file has the exact commands.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
// Every script in journeys/ is a journey; adding a file is all it takes.
const all = readdirSync(`${here}journeys`)
  .filter((file) => file.endsWith(".cjs"))
  .map((file) => file.slice(0, -4))
  .sort();
const chosen = process.argv.slice(2).filter((name) => all.includes(name));
const journeys = chosen.length > 0 ? chosen : all;

const shots = process.env.E2E_SHOTS ?? `${here}screenshots`;
mkdirSync(shots, { recursive: true });

const failed = [];
for (const journey of journeys) {
  // Every journey changes data (orders, routes, sellers), so each starts from the seed,
  // except where E2E_KEEP_DATA=1 asks for a database that keeps what each journey did
  // (supabase/scripts/used-db-check.sh uses it to make a lane look like a used project).
  const keep = process.env.E2E_KEEP_DATA === "1";
  const reset = keep
    ? { status: 0 }
    : spawnSync("bash", [`${root}supabase/scripts/local-db.sh`, "reset"], {
        stdio: ["ignore", "ignore", "inherit"],
      });
  if (reset.status !== 0) {
    console.error(`Could not reset the database before "${journey}".`);
    process.exit(1);
  }
  // The shop keeps catalogue pages for about a minute, and what it kept
  // describes the database that was just replaced (its offers no longer
  // exist). Ask it to forget them, so the journey really starts from the seed.
  // Nothing happens if the shop is not up or has no refresh key.
  await fetch(`${process.env.WEB_URL ?? "http://127.0.0.1:3000"}/api/catalogo/refrescar`, {
    method: "POST",
    headers: { "x-refresh-key": process.env.SHOP_REFRESH_KEY ?? "" },
  }).catch(() => undefined);

  console.log(`\n── ${journey} ${"─".repeat(60 - journey.length)}`);
  // lib/local-only.cjs makes the journey fail if the browser asks anything of
  // a host that is not this machine.
  const run = spawnSync(
    process.execPath,
    ["--require", `${here}lib/local-only.cjs`, `${here}journeys/${journey}.cjs`],
    {
      stdio: "inherit",
      env: { ...process.env, E2E_SHOTS: shots },
    },
  );
  if (run.status !== 0) failed.push(journey);
}

console.log(
  failed.length === 0
    ? `\nAll ${journeys.length} journeys passed. Screenshots: ${shots}`
    : `\nFAILED: ${failed.join(", ")}. Screenshots: ${shots}`,
);
process.exit(failed.length === 0 ? 0 : 1);
