/**
 * Serves the Edge Functions from Node, the way `supabase functions serve`
 * would, at /functions/v1/<name>: the three notification functions and the
 * two payments functions. The handlers are the very ones supabase/functions/*
 * deploy; only the settings differ: the providers are the local fakes, the
 * database is the local API stand-in, and the payments worker talks to the
 * gateway's test environment (the fake).
 *
 * It also stands in for pg_cron and pg_net: every NOTIFY_TICK_MS (2 s) it
 * wakes the notification worker, and every PAYMENTS_TICK_MS (1 s) the
 * payments worker, as the sweeps and kicks do on Supabase.
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
import {
  createPaymentsWebhookHandler,
  createPaymentsWorkerHandler,
  paymentsConfigFromEnv,
} from "@yuntera/payments";
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

const localPayments: Record<string, string> = {
  PAYMENTS_ENV: "test",
  PAYMENTS_API_URL: urls.api,
  PAYMENTS_SECRET_KEY: LOCAL.secretKey,
  PAYMENTS_WORKER_TOKEN: LOCAL.paymentsWorkerToken,
  PAYMENTS_SHOP_URL: process.env.WEB_URL ?? "http://localhost:3000",
  PAYMENTS_APP_SCHEME: "yuntera",
  ONVO_API_URL: urls.fakePay,
  ONVO_SECRET_KEY: LOCAL.onvoSecretKey,
  ONVO_WEBHOOK_SECRETS: LOCAL.onvoWebhookSecret,
  ONVO_ACCOUNT_ID: "acct_fake_local",
  PAYMENTS_PROVIDER_TIMEOUT_MS: "3000",
};
const payments = paymentsConfigFromEnv((name) => localPayments[name]);

// Stop anything here from reaching a real provider, whatever the environment says.
for (const url of [
  config.bird.baseUrl,
  config.expo.baseUrl,
  config.api.url,
  payments.onvo.baseUrl,
  payments.api.url,
]) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`The local functions host only talks to loopback addresses, not ${url}`);
  }
}

const functions: Record<string, (request: Request) => Promise<Response>> = {
  "notify-worker": createWorkerHandler(config, { workerId: "local-worker" }),
  "bird-webhook": createBirdWebhookHandler(config),
  "auth-email": createAuthEmailHandler(config),
  "payments-webhook": createPaymentsWebhookHandler(payments),
  "payments-worker": createPaymentsWorkerHandler(payments, { workerId: "local-payments-worker" }),
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
    `Functions on ${urls.functions}/functions/v1/{notify-worker,bird-webhook,auth-email,payments-webhook,payments-worker}`,
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

// The local pg_net and pg_cron for payments: wake its worker every second.
const paymentsTickMs = Number(process.env.PAYMENTS_TICK_MS ?? 1000);
let paying = false;
const paymentsTimer = setInterval(async () => {
  if (paying) return;
  paying = true;
  try {
    const worker = functions["payments-worker"];
    if (worker) {
      const response = await worker(
        new Request(`${urls.functions}/functions/v1/payments-worker?wait=1`, {
          method: "POST",
          headers: { "x-worker-token": LOCAL.paymentsWorkerToken },
        }),
      );
      if (!response.ok) console.warn(`[tick] payments worker answered ${response.status}`);
    }
  } catch (error) {
    console.warn(`[tick] payments ${String(error).slice(0, 200)}`);
  } finally {
    paying = false;
  }
}, paymentsTickMs);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    clearInterval(paymentsTimer);
    server.close(() => process.exit(0));
  });
}
