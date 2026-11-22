// Edge Function: the payment gateway's notifications (ONVO's signed webhooks).
// The signature is checked on the raw body against ONVO_WEBHOOK_SECRETS before
// anything is read; then the event is recorded once and applied by the
// database. Deployed with verify_jwt = false: the signature is the
// authentication. All logic is in packages/payments.

import {
  createPaymentsWebhookHandler,
  paymentsConfigFromEnv,
} from "../../../packages/payments/src/index.ts";

Deno.serve(createPaymentsWebhookHandler(paymentsConfigFromEnv((name) => Deno.env.get(name))));
