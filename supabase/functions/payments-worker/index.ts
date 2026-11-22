// Edge Function: the payments worker. Woken every minute by pg_cron and on new
// work by pg_net, with the `x-worker-token` header. Answers 202 at once and
// creates attempts, stops them, asks about unconfirmed ones and sends refunds
// in the background. All logic is in packages/payments.
// Deployed with verify_jwt = false: the worker token is the authentication.

import {
  createPaymentsWorkerHandler,
  paymentsConfigFromEnv,
} from "../../../packages/payments/src/index.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const config = paymentsConfigFromEnv((name) => Deno.env.get(name));

Deno.serve(
  createPaymentsWorkerHandler(config, {
    waitUntil: (work) => {
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    },
  }),
);
