/**
 * Notifications: people's channel choices and commercial consent, push tokens
 * for the native apps, and what staff see of the messages sent.
 * SQL: supabase/migrations/20261121082600_notifications.sql.
 *
 * The worker's own functions (`worker_*`) are deliberately not here: they are
 * callable only with the server-side secret key, and the worker in
 * packages/notifications calls them itself.
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

const timestamp = z.string().min(10);

/** The version of the commercial-consent wording shown on screen. */
export const COMMERCIAL_CONSENT_VERSION = "comercial-2026-11";

const commercial = z.object({
  opt_in: z.boolean(),
  granted_at: timestamp.nullable(),
  source: z.string().nullable(),
  text_version: z.string().nullable(),
  withdrawn_at: timestamp.nullable(),
});

const channelChoices = {
  /** What a save sends back, so a save from an out-of-date page is refused. 0: nothing saved yet. */
  version: z.number().int().nonnegative(),
  email_enabled: z.boolean(),
  whatsapp_enabled: z.boolean(),
  sms_enabled: z.boolean(),
  push_enabled: z.boolean(),
  phone: z.string().nullable(),
  whatsapp_consented_at: timestamp.nullable(),
  commercial,
  /** E-mail cannot be switched off now (an order is in progress, or it is a shop). */
  email_locked: z.boolean(),
};

export const notificationSettings = z.object({
  ...channelChoices,
  profile_phone: z.string().nullable(),
  push_devices: z.number().int(),
});
export type NotificationSettings = z.infer<typeof notificationSettings>;

export const sellerNotificationSettings = z.object({
  ...channelChoices,
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  can_edit: z.boolean(),
});
export type SellerNotificationSettings = z.infer<typeof sellerNotificationSettings>;

export const notificationChannel = z.enum(["email", "whatsapp", "sms", "push"]);
export const notificationStatus = z.enum([
  "pending",
  "sending",
  "sent",
  "delivered",
  "failed",
  "skipped",
  "expired",
  "dead",
]);

/** One message as staff see it: who, which channel, which template, its status. Never the body. */
export const notificationRow = z.object({
  id: z.uuid(),
  template: z.string(),
  channel: notificationChannel,
  audience: z.enum(["shopper", "seller", "driver", "staff", "reporter"]),
  seller_name: z.string().nullable(),
  team: z.string().nullable(),
  status: notificationStatus,
  attempts: z.number().int(),
  generation: z.number().int(),
  skip_reason: z.string().nullable(),
  error_code: z.string().nullable(),
  order_number: z.string().nullable(),
  created_at: timestamp,
  sent_at: timestamp.nullable(),
  delivered_at: timestamp.nullable(),
  read_at: timestamp.nullable(),
});
export type NotificationRow = z.infer<typeof notificationRow>;

export const deadLetters = z.object({
  items: z.array(notificationRow),
  dead_count: z.number().int(),
  /** Accepted by the provider, then reported as not delivered. Retryable like the dead ones. */
  failed_count: z.number().int(),
  paused_channels: z.array(
    z.object({ channel: notificationChannel, until: timestamp, reason: z.string() }),
  ),
});
export type DeadLetters = z.infer<typeof deadLetters>;

interface SaveOptions {
  /** Also give (true) or withdraw (false) the commercial consent, in the same transaction. */
  commercial?: boolean | null;
  /** The wording shown for the commercial consent. */
  textVersion?: string;
  /** The `version` the screen was loaded with; omit to skip the check. */
  version?: number | null;
}

export interface ChannelChoicesInput extends SaveOptions {
  whatsapp: boolean;
  sms: boolean;
  push: boolean;
  /** Mobile number for WhatsApp and SMS: "+5068…" or eight digits. */
  phone?: string | null;
}

/** Shops have no SMS channel. */
export interface ShopChannelChoicesInput extends SaveOptions {
  whatsapp: boolean;
  push: boolean;
  phone?: string | null;
}

const saveOptions = (input: SaveOptions) => ({
  p_commercial: input.commercial ?? null,
  p_text_version:
    input.commercial === undefined || input.commercial === null
      ? null
      : (input.textVersion ?? COMMERCIAL_CONSENT_VERSION),
  p_version: input.version ?? null,
});

export const errors = {
  worker_only: {
    "es-CR": "Esta función es solo para el sistema de envío de mensajes.",
    en: "This function is only for the message delivery system.",
  },
  notify_phone_invalid: {
    "es-CR":
      "Escriba un número de celular costarricense de 8 dígitos, que empiece por 5, 6, 7 u 8.",
    en: "Enter a Costa Rican mobile number of 8 digits starting with 5, 6, 7 or 8.",
  },
  notify_phone_required: {
    "es-CR": "Para recibir avisos por WhatsApp o SMS, escriba su número de celular.",
    en: "To get updates by WhatsApp or SMS, enter your mobile number.",
  },
  notify_email_required: {
    "es-CR":
      "Mientras tenga un pedido en curso, los avisos de ese pedido le llegan por correo: son su comprobante.",
    en: "While you have an order in progress, its updates come by e-mail: they are your receipt.",
  },
  notify_phone_opted_out: {
    "es-CR":
      "Ese número pidió no recibir nuestros mensajes por WhatsApp o SMS. Si es su número y quiere volver a recibirlos, envíe la palabra START desde ese teléfono al WhatsApp o al número de SMS de Yuntera, y después actívelo aquí.",
    en: "That number asked not to receive our WhatsApp or SMS messages. If it is your number and you want them again, send the word START from that phone to Yuntera's WhatsApp or SMS number, then switch it on here.",
  },
  notify_settings_changed: {
    "es-CR":
      "Sus preferencias cambiaron en otra ventana o en otro dispositivo después de abrir esta página. Recargue la página para ver las actuales y vuelva a elegir.",
    en: "Your preferences changed in another window or device after this page was opened. Reload the page to see the current ones and choose again.",
  },
  notify_consent_invalid: {
    "es-CR":
      "No pudimos guardar su elección sobre publicidad. Recargue la página e inténtelo de nuevo.",
    en: "We could not save your choice about advertising. Reload the page and try again.",
  },
  push_token_invalid: {
    "es-CR": "No pudimos activar los avisos en este teléfono. Inténtelo de nuevo más tarde.",
    en: "We could not turn on notifications on this phone. Try again later.",
  },
  push_token_not_found: {
    "es-CR": "Este teléfono ya no recibe avisos de su cuenta.",
    en: "This phone no longer receives notifications for your account.",
  },
  notification_not_found: {
    "es-CR": "No encontramos ese mensaje. Recargue la página.",
    en: "We could not find that message. Reload the page.",
  },
  notification_not_retryable: {
    "es-CR": "Ese mensaje ya no está detenido: no hace falta reintentarlo.",
    en: "That message is no longer stuck: there is no need to retry it.",
  },
} as const satisfies Messages;

export const api = ({ call }: Caller) => ({
  myNotificationSettings: () => call("my_notification_settings", {}, notificationSettings),

  setMyNotificationSettings: (input: ChannelChoicesInput & { email: boolean }) =>
    call(
      "set_my_notification_settings",
      {
        p_email: input.email,
        p_whatsapp: input.whatsapp,
        p_sms: input.sms,
        p_push: input.push,
        p_phone: input.phone ?? null,
        ...saveOptions(input),
      },
      notificationSettings,
    ),

  /** Gives or withdraws consent for commercial messages. `textVersion` is the wording shown. */
  setMyCommercialConsent: (
    optIn: boolean,
    textVersion = COMMERCIAL_CONSENT_VERSION,
    source: "web_cuenta" | "shop_app" = "web_cuenta",
  ) =>
    call(
      "set_my_commercial_consent",
      { p_opt_in: optIn, p_text_version: textVersion, p_source: source },
      notificationSettings,
    ),

  sellerNotificationSettings: (sellerId: string) =>
    call("seller_notification_settings", { p_seller_id: sellerId }, sellerNotificationSettings),

  sellerSetNotificationSettings: (sellerId: string, input: ShopChannelChoicesInput) =>
    call(
      "seller_set_notification_settings",
      {
        p_seller_id: sellerId,
        p_whatsapp: input.whatsapp,
        p_push: input.push,
        p_phone: input.phone ?? null,
        ...saveOptions(input),
      },
      sellerNotificationSettings,
    ),

  sellerSetCommercialConsent: (
    sellerId: string,
    optIn: boolean,
    textVersion = COMMERCIAL_CONSENT_VERSION,
    source: "seller_cuenta" | "seller_app" = "seller_cuenta",
  ) =>
    call(
      "seller_set_commercial_consent",
      { p_seller_id: sellerId, p_opt_in: optIn, p_text_version: textVersion, p_source: source },
      sellerNotificationSettings,
    ),

  /** For the native apps, after sign-in. */
  registerPushToken: (input: {
    app: "shop" | "seller" | "driver" | "warehouse";
    token: string;
    platform: "ios" | "android";
    deviceId?: string | null;
    appVersion?: string | null;
  }) =>
    call(
      "register_push_token",
      {
        p_app: input.app,
        p_token: input.token,
        p_platform: input.platform,
        p_device_id: input.deviceId ?? null,
        p_app_version: input.appVersion ?? null,
      },
      z.unknown(),
    ).then(() => undefined),

  /** For the native apps, at sign-out. */
  unregisterPushToken: (token: string) =>
    call("unregister_push_token", { p_token: token }, z.unknown()).then(() => undefined),

  opsOrderNotifications: (orderNumber: string) =>
    call("ops_order_notifications", { p_order_number: orderNumber }, z.array(notificationRow)),

  opsNotificationDeadLetters: (limit = 50) =>
    call("ops_notification_dead_letters", { p_limit: limit }, deadLetters),

  opsRetryNotification: (deliveryId: string) =>
    call("ops_retry_notification", { p_delivery_id: deliveryId }, notificationRow),
});
