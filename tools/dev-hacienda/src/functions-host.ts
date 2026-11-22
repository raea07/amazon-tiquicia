/**
 * Serves the two invoicing Edge Functions from Node, the way
 * `supabase functions serve` would, at /functions/v1/invoice-worker and
 * /functions/v1/hacienda-callback/<token>. The handlers are the very ones
 * supabase/functions/* deploy; only the settings differ: Hacienda is the
 * local fake, the database is the local API stand-in, and the signing key is
 * a throwaway one made here at start (never a real key, never on disk).
 *
 * It also stands in for pg_cron: every INVOICE_TICK_MS (2 s) it wakes the
 * worker, as the 30-second sweep does on Supabase.
 *
 *   pnpm --filter @yuntera/dev-hacienda functions
 */

import { configFromEnv, createHaciendaCallback, createInvoiceWorker } from "@yuntera/invoicing";
import { throwawaySigner } from "@yuntera/invoicing/testing";
import { serve } from "./http.ts";
import { FUNCTIONS_PORT, HOST, LOCAL, urls } from "./settings.ts";

const local: Record<string, string> = {
  INVOICE_ENV: "local",
  INVOICE_API_URL: urls.api,
  INVOICE_SECRET_KEY: LOCAL.secretKey,
  INVOICE_WORKER_TOKEN: LOCAL.workerToken,
  HACIENDA_TOKEN_URL: `${urls.fake}/auth/realms/rut-stag/protocol/openid-connect/token`,
  HACIENDA_CLIENT_ID: "api-stag",
  HACIENDA_USERNAME: LOCAL.username,
  HACIENDA_PASSWORD: LOCAL.password,
  HACIENDA_API_URL: `${urls.fake}/recepcion/v1/`,
  HACIENDA_CALLBACK_URL: `${urls.functions}/functions/v1/hacienda-callback`,
  HACIENDA_CALLBACK_TOKEN: LOCAL.callbackToken,
  HACIENDA_TIMEOUT_MS: "3000",
  // Placeholders: the local signer below is used instead.
  INVOICE_SIGNING_KEY: "local",
  INVOICE_SIGNING_CERT: "local",
};
const config = configFromEnv((name) => local[name]);

// Stop anything here from reaching a real service, whatever the environment says.
for (const url of [
  config.hacienda.tokenUrl,
  config.hacienda.apiBase,
  config.api.url,
  config.callbackUrl,
]) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) {
    throw new Error(`The local invoicing host only talks to loopback addresses, not ${url}`);
  }
}

const test = await throwawaySigner();
const signer = async () => ({
  key: test.key,
  certificate: test.certificate,
  certificateDigest: config.signing.certificateDigest,
});

const worker = createInvoiceWorker(config, { workerId: "local-invoice-worker", signer });
const callback = createHaciendaCallback(config, () => worker.start());

const server = serve(FUNCTIONS_PORT, HOST, urls.functions, async (request) => {
  const path = new URL(request.url).pathname;
  if (path === "/health") return new Response("ok");
  if (path === "/functions/v1/invoice-worker") return worker(request);
  if (path.startsWith("/functions/v1/hacienda-callback/")) return callback(request);
  return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
});
console.info(
  `Invoicing functions on ${urls.functions}/functions/v1/{invoice-worker,hacienda-callback}`,
);
console.info(`  database API ${config.api.url}, Hacienda ${urls.fake} (the local fake)`);

const tickMs = Number(process.env.INVOICE_TICK_MS ?? 2000);
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    const response = await worker(
      new Request(`${urls.functions}/functions/v1/invoice-worker?wait=1`, {
        method: "POST",
        headers: { "x-worker-token": LOCAL.workerToken },
      }),
    );
    if (!response.ok) console.warn(`[tick] invoice worker answered ${response.status}`);
  } catch (error) {
    console.warn(`[tick] ${String(error).slice(0, 200)}`);
  } finally {
    ticking = false;
  }
}, tickMs);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
}
