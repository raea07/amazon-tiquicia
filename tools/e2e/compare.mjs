// Puts each journey screenshot beside the reference page it should look like
// (rule 20.6 of docs/brand/system/SISTEMA.md). One page per app, written to
// tools/e2e/screenshots/compare/<app>/index.html with copies of both pictures,
// so the folder can be attached to a report as it is.
//
//   node tools/e2e/compare.mjs [web|seller|ops|field ...]
//     --shots <dir>       journey screenshots (default: $E2E_SHOTS, else tools/e2e/screenshots;
//                         a lane run writes them to .lane/<n>/screenshots)
//     --reference <dir>   reference shots (default: $COMPARE_REFERENCE, else
//                         docs/brand/system/shots when it exists, else
//                         /root/yuntera-audit/design-review/carreta-final/shots)
//
// The rows live in tools/e2e/compare/<app>.json: { shot, template, reference, width }.
// `reference` is a page of docs/brand/system; its shot is `<page>-<width>.png`.
// Each app's builder owns that app's json and looks at every pair.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const APPS = ["web", "seller", "ops", "field"];

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
};
const shots = resolve(option("--shots") ?? process.env.E2E_SHOTS ?? join(here, "screenshots"));
const reference = resolve(
  option("--reference") ??
    process.env.COMPARE_REFERENCE ??
    [
      join(root, "docs/brand/system/shots"),
      "/root/yuntera-audit/design-review/carreta-final/shots",
    ].find((dir) => existsSync(dir)) ??
    join(root, "docs/brand/system/shots"),
);
const chosen = args.length > 0 ? args : APPS;
for (const app of chosen) {
  if (!APPS.includes(app)) {
    console.error(`No app called "${app}" (choose from: ${APPS.join(", ")}).`);
    process.exit(2);
  }
}

/** Pixel width and height of a PNG, read from its header; null when it is not one. */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24);
  if (head.toString("latin1", 1, 4) !== "PNG") return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const escape = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

console.log(`journey shots:   ${shots}`);
console.log(`reference shots: ${reference}`);
for (const app of chosen) {
  const { rows } = JSON.parse(readFileSync(join(here, "compare", `${app}.json`), "utf8"));
  const out = join(here, "screenshots", "compare", app);
  mkdirSync(join(out, "img"), { recursive: true });
  let pairs = 0;
  const missing = [];
  const blocks = rows.map((row) => {
    const refName = `${basename(row.reference, ".html")}-${row.width}.png`;
    const shotFile = join(shots, row.shot);
    const refFile = join(reference, refName);
    const cell = (file, name, label) => {
      if (!existsSync(file)) {
        missing.push(`${label} ${name}`);
        return `<td class="none">No ${label} shot: ${escape(name)}</td>`;
      }
      copyFileSync(file, join(out, "img", `${label}-${name}`));
      const size = pngSize(file);
      return `<td><p>${escape(name)}${size ? ` · ${size.width} × ${size.height}` : ""}</p><img src="img/${escape(`${label}-${name}`)}" alt="${escape(`${label}: ${name}`)}" loading="lazy"></td>`;
    };
    const journey = cell(shotFile, row.shot, "journey");
    const drawn = cell(refFile, refName, "reference");
    if (existsSync(shotFile) && existsSync(refFile)) pairs += 1;
    return `<tr><th scope="row">${escape(row.template)}<br>${escape(row.reference)}<br>${row.width} px</th>${journey}${drawn}</tr>`;
  });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(app)}: journey screenshots beside the reference</title>
<style>
body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; background: #fff; color: #1e1a16; }
table { border-collapse: collapse; width: 100%; }
th, td { border-top: 1px solid #d9d0c3; padding: 8px; vertical-align: top; text-align: left; }
th { width: 9em; }
td { width: 45%; }
td img { max-width: 100%; border: 1px solid #d9d0c3; }
td.none { color: #8a2a0a; }
p { margin: 0 0 4px; }
</style></head><body>
<h1>${escape(app)}: ${pairs} of ${rows.length} pairs</h1>
<p>Journey shots from ${escape(shots)}; reference shots from ${escape(reference)}.</p>
<table><thead><tr><th scope="col">Template</th><th scope="col">Journey</th><th scope="col">Reference</th></tr></thead>
<tbody>
${blocks.join("\n")}
</tbody></table>
</body></html>
`;
  writeFileSync(join(out, "index.html"), html);
  console.log(`${app}: ${pairs} of ${rows.length} pairs → ${join(out, "index.html")}`);
  for (const line of missing) console.log(`  missing ${line}`);
}
