/*
 * Prints the difference between each function 20261121084400_stock_lock_order.sql
 * redefines and its last definition in an earlier migration, so a reviewer can
 * see that each is a faithful copy except for the lines the migration's header
 * names.
 *
 *   node tools/races/faithful-copies.cjs [migration-file-name]
 *
 * Reads only files under supabase/migrations; uses the system's `diff -u`.
 */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const TARGET = process.argv[2] || "20261121084400_stock_lock_order.sql";

function definitions(file) {
  const sql = fs.readFileSync(path.join(DIR, file), "utf8");
  const found = new Map();
  const pattern = /create or replace function ([a-z_]+\.[a-z_0-9]+)\([\s\S]*?\n\$\$;/g;
  for (const m of sql.matchAll(pattern)) found.set(m[1], m[0]);
  return found;
}

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const mine = definitions(TARGET);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faithful-"));
let status = 0;
for (const [name, body] of mine) {
  let earlier = null;
  for (const f of files) {
    if (f >= TARGET) break;
    const d = definitions(f).get(name);
    if (d) earlier = { file: f, body: d };
  }
  process.stdout.write(`\n═══ ${name}: ${earlier ? earlier.file : "(new)"} -> ${TARGET}\n`);
  if (!earlier) continue;
  const a = path.join(tmp, "a.sql");
  const b = path.join(tmp, "b.sql");
  fs.writeFileSync(a, `${earlier.body}\n`);
  fs.writeFileSync(b, `${body}\n`);
  const r = spawnSync("diff", ["-u", "--label", earlier.file, "--label", TARGET, a, b], {
    encoding: "utf8",
  });
  if (r.status === 0) process.stdout.write("(identical)\n");
  else if (r.status === 1) process.stdout.write(r.stdout);
  else {
    process.stdout.write(r.stderr || "diff failed\n");
    status = 2;
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(status);
