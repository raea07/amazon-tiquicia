/**
 * Starts the fake providers on 127.0.0.1 (see ./fake.ts). Local only.
 *
 *   pnpm --filter @yuntera/dev-notify fake
 */

import { createServer } from "node:http";
import { createFake } from "./fake.ts";
import { sendResponse, toRequest } from "./http.ts";
import { FAKE_PORT, HOST, LOCAL, urls } from "./settings.ts";

const fake = createFake({
  webhookUrl: `${urls.functions}/functions/v1/bird-webhook`,
  webhookSecret: LOCAL.webhookSecret,
  deliverAfterMs: Number(process.env.FAKE_DELIVER_AFTER_MS ?? 300),
  log: (line) => console.info(`[fake] ${line}`),
});

const server = createServer((req, res) => {
  toRequest(req, urls.fake)
    .then(fake.handle)
    .then((response) => sendResponse(res, response))
    .catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

server.listen(FAKE_PORT, HOST, () => {
  console.info(`Fake Bird and Expo listening on ${urls.fake} (local only; sends nothing anywhere)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    fake.close();
    server.close(() => process.exit(0));
  });
}
