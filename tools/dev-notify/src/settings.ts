/**
 * Local settings shared by the fake and the functions host. Nothing here is a
 * secret: these values exist only on a developer's machine, and the fake
 * accepts any key that looks like a Bird key.
 */

const env = (name: string, fallback: string) => process.env[name] || fallback;

export const API_PORT = Number(env("DEV_API_PORT", "54321"));
export const FUNCTIONS_PORT = Number(env("DEV_FUNCTIONS_PORT", String(API_PORT + 1)));
export const FAKE_PORT = Number(env("DEV_FAKE_PROVIDERS_PORT", String(API_PORT + 2)));
export const HOST = "127.0.0.1"; // loopback only

export const LOCAL = {
  workerToken: "local-worker-token-not-secret",
  secretKey: env("DEV_SECRET_KEY", "sb_secret_local_development_only"),
  // "whsec_" + base64("yuntera local webhook secret, not secret")
  webhookSecret: `whsec_${Buffer.from("yuntera local webhook secret, not secret").toString("base64")}`,
  authHookSecret: `v1,whsec_${Buffer.from("yuntera local auth hook secret, not secret").toString("base64")}`,
};

export const urls = {
  api: env("API_URL", `http://${HOST}:${API_PORT}`),
  functions: `http://${HOST}:${FUNCTIONS_PORT}`,
  fake: `http://${HOST}:${FAKE_PORT}`,
};
