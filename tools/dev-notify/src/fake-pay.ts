/**
 * Starts the fake payment gateway on 127.0.0.1 (see ./fake-onvo.ts). Local only.
 *
 *   pnpm --filter @yuntera/dev-notify fake-pay
 */

import { createServer } from "node:http";
import { createFakeOnvo } from "./fake-onvo.ts";
import { sendResponse, toRequest } from "./http.ts";
import { FAKE_PAY_PORT, HOST, LOCAL, urls } from "./settings.ts";

const fake = createFakeOnvo({
  webhookUrl: `${urls.functions}/functions/v1/payments-webhook`,
  webhookSecrets: [LOCAL.onvoWebhookSecret],
  publicUrl: urls.fakePay,
  sinpeDelayMs: Number(process.env.FAKE_PAY_SINPE_MS ?? 1500),
  refundDelayMs: Number(process.env.FAKE_PAY_REFUND_MS ?? 800),
  log: (line) => console.info(`[fake-pay] ${line}`),
});

const server = createServer((req, res) => {
  toRequest(req, urls.fakePay)
    .then(fake.handle)
    .then((response) => sendResponse(res, response))
    .catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

server.listen(FAKE_PAY_PORT, HOST, () => {
  console.info(`Fake payment gateway on ${urls.fakePay} (local only; moves no money)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    fake.close();
    server.close(() => process.exit(0));
  });
}
