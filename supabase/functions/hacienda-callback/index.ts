// Edge Function: Hacienda's answer about a document, posted to
// …/functions/v1/hacienda-callback/<HACIENDA_CALLBACK_TOKEN>. Hacienda does not
// authenticate its callback, so the unguessable path is the only gate and the
// body is only a hint: the document is marked to be asked about now, and the
// worker asks Hacienda itself (with its token) before anything changes.
// Deployed with verify_jwt = false. All logic is in packages/invoicing.

import {
  configFromEnv,
  createHaciendaCallback,
  createInvoiceWorker,
} from "../../../packages/invoicing/src/index.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const config = configFromEnv((name) => Deno.env.get(name));
const waitUntil = (work: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
};
const worker = createInvoiceWorker(config, { waitUntil });

Deno.serve(createHaciendaCallback(config, () => worker.start()));
