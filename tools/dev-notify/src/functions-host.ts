/**
 * Serves the three notification Edge Functions from Node, the way
 * `supabase functions serve` would, at /functions/v1/<name>. The handlers are
 * the very ones supabase/functions/* deploy; only the settings differ: the
 * providers are the local fake, the database is the local API stand-in.
 *
 * It also stands in for pg_cron: every NOTIFY_TICK_MS (2 s) it wakes the
 * worker, as the 30-second sweep does on Supabase.
 *
 *   pnpm --filter @yuntera/dev-notify functions
 */

import { createServer } from "node:http";
import {
  configFromEnv,
  createAuthEmailHandler,
  createBirdWebhookHandler,
  createWorkerHandler,
} from "@yuntera/notifications";
import { json, sendResponse, toRequest } from "./http.ts";
import { FUNCTIONS_PORT, HOST, LOCAL, urls } from "./settings.ts";

const local: Record<string, string> = {
  NOTIFY_ENV: "local",
  NOTIFY_API_URL: urls.api,
  NOTIFY_SECRET_KEY: LOCAL.secretKey,
  NOTIFY_WORKER_TOKEN: LOCAL.workerToken,
  NOTIFY_SHOP_URL: process.env.WEB_URL ?? "http://localhost:3000",
  NOTIFY_SELLER_URL: process.env.SELLER_URL ?? "http://localhost:3001",
  NOTIFY_OPS_URL: process.env.OPS_URL ?? "http://localhost:3002",
  NOTIFY_FIELD_URL: process.env.FIELD_URL ?? "http://localhost:3003",
  BIRD_API_URL: urls.fake,
  BIRD_API_KEY: "bk_local_fake_key",
  BIRD_WHATSAPP_FROM: "+50622220000",
  BIRD_WEBHOOK_SECRETS: LOCAL.webhookSecret,
  EXPO_PUSH_URL: urls.fake,
  SEND_EMAIL_HOOK_SECRETS: LOCAL.authHookSecret,
  // A local stack must work at any hour of the day.
  NOTIFY_QUIET_HOURS: "off",
  NOTIFY_PROVIDER_TIMEOUT_MS: "3000",
};
const config = configFromEnv((name) => local[name] ?? process.env[name]);

// Stop anything here from reaching a real provider, whatever the environment says.
for (const url of [config.bird.baseUrl, config.expo.baseUrl, config.api.url]) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`The local functions host only talks to loopback addresses, not ${url}`);
  }
}

const functions: Record<string, (request: Request) => Promise<Response>> = {
  "notify-worker": createWorkerHandler(config, { workerId: "local-worker" }),
  "bird-webhook": createBirdWebhookHandler(config),
  "auth-email": createAuthEmailHandler(config),
};

const server = createServer((req, res) => {
  const name = /^\/functions\/v1\/([a-z-]+)/.exec(req.url ?? "")?.[1] ?? "";
  const handler = functions[name];
  toRequest(req, urls.functions)
    .then((request) =>
      handler ? handler(request) : json(name === "" && req.url === "/health" ? 200 : 404, { name }),
    )
    .then((response) => sendResponse(res, response))
    .catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

server.listen(FUNCTIONS_PORT, HOST, () => {
  console.info(
    `Notification functions on ${urls.functions}/functions/v1/{notify-worker,bird-webhook,auth-email}`,
  );
  console.info(
    `  database API ${config.api.url}, providers ${config.bird.baseUrl} (the local fake)`,
  );
});

// The local pg_cron: wake the worker regularly. A failed tick (the database
// being reset by a test) is logged and the next one tries again.
const tickMs = Number(process.env.NOTIFY_TICK_MS ?? 2000);
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    const worker = functions["notify-worker"];
    if (worker) {
      const response = await worker(
        new Request(`${urls.functions}/functions/v1/notify-worker?wait=1`, {
          method: "POST",
          headers: { "x-worker-token": LOCAL.workerToken },
        }),
      );
      if (!response.ok) console.warn(`[tick] worker answered ${response.status}`);
    }
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
