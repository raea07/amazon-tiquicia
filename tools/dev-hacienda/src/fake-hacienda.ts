/**
 * Starts the fake of Hacienda's API on 127.0.0.1 (see ./fake.ts). Local only.
 *
 *   pnpm --filter @yuntera/dev-hacienda fake
 */

import { createFake } from "./fake.ts";
import { serve } from "./http.ts";
import { FAKE_PORT, HOST, LOCAL, urls } from "./settings.ts";

const fake = createFake({
  username: LOCAL.username,
  password: LOCAL.password,
  answerAfterMs: Number(process.env.FAKE_HACIENDA_ANSWER_AFTER_MS ?? 1500),
  log: (line) => console.info(`[hacienda] ${line}`),
});

const server = serve(FAKE_PORT, HOST, urls.fake, fake.handle);
console.info(`Fake Hacienda listening on ${urls.fake} (local only; reaches nothing else)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    fake.close();
    server.close(() => process.exit(0));
  });
}
