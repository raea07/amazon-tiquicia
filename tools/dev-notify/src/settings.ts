/**
 * Local settings shared by the fake and the functions host. Nothing here is a
 * secret: these values exist only on a developer's machine, and the fake
 * accepts any key that looks like a Bird key.
 */

const env = (name: string, fallback: string) => process.env[name] || fallback;

export const API_PORT = Number(env("DEV_API_PORT", "54321"));
export const FUNCTIONS_PORT = Number(env("DEV_FUNCTIONS_PORT", String(API_PORT + 1)));
export const FAKE_PORT = Number(env("DEV_FAKE_PROVIDERS_PORT", String(API_PORT + 2)));
/** The fake payment gateway (./fake-onvo.ts). */
export const FAKE_PAY_PORT = Number(env("DEV_FAKE_PAY_PORT", String(API_PORT + 3)));
export const HOST = "127.0.0.1"; // loopback only

export const LOCAL = {
  workerToken: "local-worker-token-not-secret",
  secretKey: env("DEV_SECRET_KEY", "sb_secret_local_development_only"),
  // "whsec_" + base64("yuntera local webhook secret, not secret")
  webhookSecret: `whsec_${Buffer.from("yuntera local webhook secret, not secret").toString("base64")}`,
  authHookSecret: `v1,whsec_${Buffer.from("yuntera local auth hook secret, not secret").toString("base64")}`,
  paymentsWorkerToken: "local-payments-worker-token-not-secret",
  // ONVO's key format: the fake accepts any test key and refuses a live one.
  onvoSecretKey: "onvo_test_secret_key_local_fake",
  onvoWebhookSecret: "whsec_local_payments_webhook_not_secret",
};

export const urls = {
  api: env("API_URL", `http://${HOST}:${API_PORT}`),
  functions: `http://${HOST}:${FUNCTIONS_PORT}`,
  fake: `http://${HOST}:${FAKE_PORT}`,
  fakePay: `http://${HOST}:${FAKE_PAY_PORT}`,
};
