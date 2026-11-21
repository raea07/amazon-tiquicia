// Edge Function: Bird's delivery reports (Standard Webhooks). The signature is
// checked on the raw body against BIRD_WEBHOOK_SECRETS before anything is read.
// Deployed with verify_jwt = false: the signature is the authentication.

import {
  configFromEnv,
  createBirdWebhookHandler,
} from "../../../packages/notifications/src/index.ts";

Deno.serve(createBirdWebhookHandler(configFromEnv((name) => Deno.env.get(name))));
