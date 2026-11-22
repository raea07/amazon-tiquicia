/**
 * Local settings shared by the fake and the functions host. Nothing here is a
 * secret: these values exist only on a developer's machine. The signing key
 * is not here at all: the functions host makes a throwaway one at start.
 */

const env = (name: string, fallback: string) => process.env[name] || fallback;

export const API_PORT = Number(env("DEV_API_PORT", "54321"));
export const FAKE_PORT = Number(env("DEV_HACIENDA_PORT", String(API_PORT + 3)));
export const FUNCTIONS_PORT = Number(env("DEV_INVOICE_FUNCTIONS_PORT", String(API_PORT + 4)));
export const HOST = "127.0.0.1"; // loopback only

export const LOCAL = {
  workerToken: "local-invoice-worker-token-not-secret",
  callbackToken: "local-callback-token-not-secret-0123456789",
  secretKey: env("DEV_SECRET_KEY", "sb_secret_local_development_only"),
  username: "cpj-3-101-123456@stag.comprobanteselectronicos.go.cr",
  password: "contraseña-local&no=secreta",
};

export const urls = {
  api: env("API_URL", `http://${HOST}:${API_PORT}`),
  fake: `http://${HOST}:${FAKE_PORT}`,
  functions: `http://${HOST}:${FUNCTIONS_PORT}`,
};
