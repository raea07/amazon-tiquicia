/**
 * The payments worker's settings, read from the environment by the entry
 * point (Deno.env on Supabase, the local functions host in development).
 * Secrets are read only here, never logged, and never in the repository; see
 * docs/06-operations/payments.md for where each is stored.
 */

import { ONVO_DEFAULT_SINPE_NUMBER } from "./onvo.ts";
import type { Environment } from "./types.ts";

export interface PaymentsConfig {
  /** Which of the gateway's environments this deployment talks to. */
  environment: Environment;
  /** The database API and this worker's own server-side secret key. */
  api: { url: string; secretKey: string };
  /** The token pg_net and pg_cron send to wake the worker. Can do nothing else. */
  workerToken: string;
  /** Where the gateway's page sends the shopper back. */
  links: { shop: string; appScheme: string };
  onvo: {
    baseUrl: string;
    secretKey: string;
    /** "whsec_…", one per endpoint and mode; two while rotating. */
    webhookSecrets: string[];
    accountId: string | null;
    sinpeNumber: string;
  };
  /** Below ONVO's 10-second webhook window and the worker's lease. */
  timeoutMs: number;
}

type Get = (name: string) => string | undefined;

const list = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

export function paymentsConfigFromEnv(get: Get): PaymentsConfig {
  const required = (name: string) => {
    const value = get(name);
    if (!value) throw new Error(`Missing setting ${name}`);
    return value;
  };
  const optional = (name: string, fallback: string) => get(name) || fallback;
  const environment = required("PAYMENTS_ENV");
  if (environment !== "test" && environment !== "live") {
    throw new Error("PAYMENTS_ENV must be test or live");
  }
  return {
    environment,
    api: { url: required("PAYMENTS_API_URL"), secretKey: required("PAYMENTS_SECRET_KEY") },
    workerToken: required("PAYMENTS_WORKER_TOKEN"),
    links: {
      shop: optional("PAYMENTS_SHOP_URL", "https://www.yuntera.cr").replace(/\/$/, ""),
      appScheme: optional("PAYMENTS_APP_SCHEME", "yuntera"),
    },
    onvo: {
      baseUrl: optional("ONVO_API_URL", "https://api.onvopay.com"),
      secretKey: optional("ONVO_SECRET_KEY", ""),
      webhookSecrets: list(get("ONVO_WEBHOOK_SECRETS")),
      accountId: get("ONVO_ACCOUNT_ID") || null,
      sinpeNumber: optional("ONVO_SINPE_NUMBER", ONVO_DEFAULT_SINPE_NUMBER),
    },
    timeoutMs: Math.min(Number(optional("PAYMENTS_PROVIDER_TIMEOUT_MS", "8000")), 9000),
  };
}

/** The key decides ONVO's mode (note §3.1): a live key in test, or the reverse, is not ready. */
export function keysReady(config: PaymentsConfig): boolean {
  return config.onvo.secretKey.startsWith(`onvo_${config.environment}_secret_key_`);
}

export function webhookReady(config: PaymentsConfig): boolean {
  return (
    config.onvo.webhookSecrets.length > 0 &&
    config.onvo.webhookSecrets.every((secret) => secret.startsWith("whsec_"))
  );
}
