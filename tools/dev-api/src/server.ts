/**
 * Local stand-in for the Supabase API.
 *
 * WHAT IT IS  A small HTTP server that answers what the apps ask of Supabase:
 *             database function calls (`/rest/v1/rpc/*`), e-mail + password
 *             sessions (`/auth/v1/*`) and the file storage calls storage-js
 *             makes (`/storage/v1/*`, listed in src/routes/storage.ts). It lets
 *             the apps run end to end against a plain local PostgreSQL, with
 *             no Docker. Storage decisions are made by the same rules on
 *             storage.objects that the migrations create, evaluated by
 *             PostgreSQL as the caller; the files sit on local disk.
 *
 * WHAT IT IS NOT  Supabase. It is never deployed and must never be exposed to a
 *             network: it has no rate limiting and keeps refresh tokens in
 *             memory. Its storage has no CDN, no image transformation, no
 *             listing or moving of files and none of the storage service's
 *             own database triggers. Production uses Supabase's own services. Behaviour the
 *             apps rely on is kept to a narrow, documented surface so the two
 *             cannot drift far — but the first run against real Supabase is
 *             still a real test.
 *
 * Start:  pnpm --filter @yuntera/dev-api start
 * Routes: src/routes/index.ts lists every group.
 */

import { createServer } from "node:http";
import {
  DATABASE_URL,
  type Exchange,
  HOST,
  HttpError,
  ORIGIN,
  PORT,
  PUBLISHABLE_KEY,
  pool,
  send,
} from "./context.ts";
import { routes } from "./routes/index.ts";

async function handle(exchange: Exchange) {
  const { req, res, route } = exchange;
  if (req.method === "OPTIONS") return send(res, 204);
  if (route === "GET /health") return send(res, 200, { status: "ok", standIn: true });

  for (const group of routes) {
    if (await group(exchange)) return;
  }
  throw new HttpError(404, { message: `No route for ${route}` });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  handle({ req, res, url, route: `${req.method} ${url.pathname}` }).catch((error: unknown) => {
    if (res.headersSent) return res.end();
    if (error instanceof HttpError) return send(res, error.status, error.body);
    console.error(error);
    send(res, 500, { code: "XX000", message: "Internal error in the local stand-in" });
  });
});

server.listen(PORT, HOST, () => {
  console.info(`Local Supabase stand-in listening on ${ORIGIN}`);
  console.info(`  database         ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
  console.info(`  publishable key  ${PUBLISHABLE_KEY}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().then(() => process.exit(0));
  });
}
