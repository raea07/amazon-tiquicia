// Edge Function: the notification worker. Woken every 30 seconds by pg_cron and
// on new events by pg_net, with the `x-worker-token` header. Answers 202 at once
// and plans and sends in the background. All logic is in packages/notifications.
// Deployed with verify_jwt = false: the worker token is the authentication.

import { configFromEnv, createWorkerHandler } from "../../../packages/notifications/src/index.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const config = configFromEnv((name) => Deno.env.get(name));

Deno.serve(
  createWorkerHandler(config, {
    waitUntil: (work) => {
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    },
  }),
);
