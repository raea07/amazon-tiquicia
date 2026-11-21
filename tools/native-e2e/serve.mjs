// Serves the web export of a native app for the native journeys.
//
//   node tools/native-e2e/serve.mjs <export dir> <port>
//
// A static server with what the export needs and nothing more:
//   - every path that is not a file gets index.html (the app routes in the browser);
//   - /demo/* is read from apps/web/public/demo, because product pictures are
//     paths on the shop website (the app prefixes EXPO_PUBLIC_SHOP_URL, which
//     the lane leaves empty so the pictures come from this same origin).
// Loopback only, never deployed.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [dir, portText] = process.argv.slice(2);
if (!dir || !portText) {
  console.error("Usage: node serve.mjs <export dir> <port>");
  process.exit(2);
}
const root = resolve(dir);
const demo = fileURLToPath(new URL("../../apps/web/public/demo", import.meta.url));
const port = Number(portText);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** A file under `base` for this URL path, or null. Refuses anything that climbs out. */
function fileIn(base, path) {
  const target = normalize(join(base, path));
  if (!target.startsWith(base)) return null;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const file = path.startsWith("/demo/")
    ? fileIn(demo, path.slice("/demo".length))
    : (fileIn(root, path) ?? (extname(path) ? null : join(root, "index.html")));
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.info(`Serving ${root} on http://127.0.0.1:${port}`);
});
