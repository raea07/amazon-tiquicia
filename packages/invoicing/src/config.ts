/**
 * The worker's settings, read from the environment by the entry point
 * (Deno.env on Supabase, process.env locally). The signing key, its PIN and
 * the API password are secrets: they are read only here, never logged and
 * never written anywhere. docs/06-operations/invoicing.md says where each is set.
 */

import type { HaciendaSettings } from "./hacienda.ts";

export interface InvoiceConfig {
  /** "prod", "stag" or "local". */
  env: string;
  /** The database API and the server-side secret key the worker calls it with. */
  api: { url: string; secretKey: string };
  /** The token pg_cron and pg_net send to wake the worker. Can do nothing else. */
  workerToken: string;
  hacienda: HaciendaSettings;
  /** Hacienda's callback goes to …/hacienda-callback/<callbackToken>; empty: no callback, polling only. */
  callbackUrl: string;
  callbackToken: string;
  signing: {
    /** PKCS#8 PEM, plain or encrypted with the PIN. */
    keyPem: string;
    pin: string;
    certificatePem: string;
    certificateDigest: "sha256" | "sha1";
  };
}

type Get = (name: string) => string | undefined;

/** Production and sandbox endpoints (research note 5.1); the sandbox API host is the observed one. */
export const ENDPOINTS = {
  prod: {
    tokenUrl:
      "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token",
    clientId: "api-prod",
    apiBase: "https://api.comprobanteselectronicos.go.cr/recepcion/v1/",
  },
  stag: {
    tokenUrl:
      "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token",
    clientId: "api-stag",
    apiBase: "https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/",
  },
} as const;

export function configFromEnv(get: Get): InvoiceConfig {
  const required = (name: string) => {
    const value = get(name);
    if (!value) throw new Error(`Missing setting ${name}`);
    return value;
  };
  const optional = (name: string, fallback: string) => get(name) || fallback;
  const env = optional("INVOICE_ENV", "local");
  const defaults = env === "prod" ? ENDPOINTS.prod : ENDPOINTS.stag;
  const callbackToken = optional("HACIENDA_CALLBACK_TOKEN", "");
  const callbackBase = optional("HACIENDA_CALLBACK_URL", "");
  return {
    env,
    api: { url: required("INVOICE_API_URL"), secretKey: required("INVOICE_SECRET_KEY") },
    workerToken: required("INVOICE_WORKER_TOKEN"),
    hacienda: {
      tokenUrl: optional("HACIENDA_TOKEN_URL", defaults.tokenUrl),
      clientId: optional("HACIENDA_CLIENT_ID", defaults.clientId),
      username: required("HACIENDA_USERNAME"),
      password: required("HACIENDA_PASSWORD"),
      apiBase: optional("HACIENDA_API_URL", defaults.apiBase),
      timeoutMs: Number(optional("HACIENDA_TIMEOUT_MS", "15000")),
    },
    callbackUrl:
      callbackBase && callbackToken ? `${callbackBase.replace(/\/$/, "")}/${callbackToken}` : "",
    callbackToken,
    signing: {
      keyPem: required("INVOICE_SIGNING_KEY"),
      pin: optional("INVOICE_SIGNING_PIN", ""),
      certificatePem: required("INVOICE_SIGNING_CERT"),
      certificateDigest: optional("INVOICE_CERT_DIGEST", "sha256") === "sha1" ? "sha1" : "sha256",
    },
  };
}
