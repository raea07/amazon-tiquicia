/**
 * The worker's settings, read from the environment by the entry point
 * (Deno.env on Supabase, process.env locally). Secrets are only ever read
 * here, never logged, and never written to the repository; see
 * docs/06-operations/notifications.md for where each one is set.
 */

export interface NotifyConfig {
  /** "prod", "staging" or "local": part of every idempotency key. */
  env: string;
  /** The database API and the server-side secret key the worker calls it with. */
  api: { url: string; secretKey: string };
  /** The token pg_net and pg_cron send to wake the worker. Can do nothing else. */
  workerToken: string;
  links: { shop: string; seller: string; ops: string; field: string };
  bird: {
    baseUrl: string;
    apiKey: string;
    /** Sender addresses, on the verified sending domain. */
    from: { orders: string; account: string; sellers: string };
    replyTo: string;
    whatsappFrom: string;
    whatsappLanguage: string;
    smsFrom: string;
    /** Standard Webhooks secrets ("whsec_…"); two during a rotation. */
    webhookSecrets: string[];
  };
  expo: { baseUrl: string; accessToken: string };
  /** Supabase Auth's Send Email Hook secrets ("v1,whsec_…"). */
  authHookSecrets: string[];
  /** Legal identification for every e-mail footer (Decreto 35205 art. 32). */
  sender: { legalName: string; legalId: string; postalAddress: string };
  /** No WhatsApp, SMS or push between 21:00 and 07:00 Costa Rica time, except delivery-day news. */
  quietHours: boolean;
  timeoutMs: number;
}

type Get = (name: string) => string | undefined;

const list = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

export function configFromEnv(get: Get): NotifyConfig {
  const required = (name: string) => {
    const value = get(name);
    if (!value) throw new Error(`Missing setting ${name}`);
    return value;
  };
  const optional = (name: string, fallback: string) => get(name) || fallback;
  const sendingDomain = optional("NOTIFY_SENDING_DOMAIN", "mail.yuntera.cr");
  return {
    env: optional("NOTIFY_ENV", "local"),
    api: { url: required("NOTIFY_API_URL"), secretKey: required("NOTIFY_SECRET_KEY") },
    workerToken: required("NOTIFY_WORKER_TOKEN"),
    links: {
      shop: optional("NOTIFY_SHOP_URL", "https://www.yuntera.cr"),
      seller: optional("NOTIFY_SELLER_URL", "https://vende.yuntera.cr"),
      ops: optional("NOTIFY_OPS_URL", "https://central.yuntera.cr"),
      field: optional("NOTIFY_FIELD_URL", "https://ruta.yuntera.cr"),
    },
    bird: {
      baseUrl: optional("BIRD_API_URL", "https://us1.platform.bird.com"),
      apiKey: optional("BIRD_API_KEY", ""),
      from: {
        orders: `pedidos@${sendingDomain}`,
        account: `cuenta@${sendingDomain}`,
        sellers: `vendedores@${sendingDomain}`,
      },
      replyTo: optional("NOTIFY_REPLY_TO", "ayuda@yuntera.cr"),
      whatsappFrom: optional("BIRD_WHATSAPP_FROM", ""),
      whatsappLanguage: optional("BIRD_WHATSAPP_LANGUAGE", "es"),
      smsFrom: optional("BIRD_SMS_FROM", "Yuntera"),
      webhookSecrets: list(get("BIRD_WEBHOOK_SECRETS")),
    },
    expo: {
      baseUrl: optional("EXPO_PUSH_URL", "https://exp.host"),
      accessToken: optional("EXPO_ACCESS_TOKEN", ""),
    },
    authHookSecrets: list(get("SEND_EMAIL_HOOK_SECRETS")),
    sender: {
      legalName: optional("NOTIFY_LEGAL_NAME", "Yuntera (entidad en formación)"),
      legalId: optional("NOTIFY_LEGAL_ID", "cédula jurídica en trámite"),
      postalAddress: optional("NOTIFY_POSTAL_ADDRESS", "San José, Costa Rica"),
    },
    quietHours: optional("NOTIFY_QUIET_HOURS", "on") !== "off",
    timeoutMs: Number(optional("NOTIFY_PROVIDER_TIMEOUT_MS", "8000")),
  };
}
