// Edge Function: the electronic-invoice worker. Woken every 30 seconds by
// pg_cron and on new events by pg_net, with the `x-worker-token` header.
// Answers 202 at once and plans, signs, sends and polls in the background.
// All logic is in packages/invoicing. Deployed with verify_jwt = false: the
// worker token is the authentication. The signing key, its PIN and Hacienda's
// password come from this function's secrets only.

import { configFromEnv, createInvoiceWorker } from "../../../packages/invoicing/src/index.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const config = configFromEnv((name) => Deno.env.get(name));

Deno.serve(
  createInvoiceWorker(config, {
    waitUntil: (work) => {
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    },
  }),
);
