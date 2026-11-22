/**
 * Native accounts: what the shopper and seller apps need beyond the websites'
 * methods. Today that is saving the notification settings with the consent
 * recorded as given in the app ('shop_app', 'seller_app') instead of on the
 * website's account page.
 *
 * SQL: supabase/migrations/20261121083900_native_accounts.sql (p_source on
 * set_my_notification_settings and seller_set_notification_settings). It
 * raises no new error code: a wrong source is notify_consent_invalid, whose
 * message is in notifications.ts.
 */

import {
  type ChannelChoicesInput,
  COMMERCIAL_CONSENT_VERSION,
  notificationSettings,
  type ShopChannelChoicesInput,
  sellerNotificationSettings,
} from "./notifications";
import type { Caller, Messages } from "./types";

/** Where a consent saved through the settings call was given. */
export type ShopperConsentSource = "web_cuenta" | "shop_app";
export type SellerConsentSource = "seller_cuenta" | "seller_app";

const consentArgs = (input: {
  commercial?: boolean | null;
  textVersion?: string;
  version?: number | null;
}) => ({
  p_commercial: input.commercial ?? null,
  p_text_version:
    input.commercial === undefined || input.commercial === null
      ? null
      : (input.textVersion ?? COMMERCIAL_CONSENT_VERSION),
  p_version: input.version ?? null,
});

export const nativeAccountsErrors = {} as const satisfies Messages;

export const nativeAccountsApi = ({ call }: Caller) => ({
  /** set_my_notification_settings, naming where the consent was given. */
  setMyNotificationSettingsFrom: (
    source: ShopperConsentSource,
    input: ChannelChoicesInput & { email: boolean },
  ) =>
    call(
      "set_my_notification_settings",
      {
        p_email: input.email,
        p_whatsapp: input.whatsapp,
        p_sms: input.sms,
        p_push: input.push,
        p_phone: input.phone ?? null,
        ...consentArgs(input),
        p_source: source,
      },
      notificationSettings,
    ),

  /** seller_set_notification_settings, naming where the consent was given. */
  sellerSetNotificationSettingsFrom: (
    source: SellerConsentSource,
    sellerId: string,
    input: ShopChannelChoicesInput,
  ) =>
    call(
      "seller_set_notification_settings",
      {
        p_seller_id: sellerId,
        p_whatsapp: input.whatsapp,
        p_push: input.push,
        p_phone: input.phone ?? null,
        ...consentArgs(input),
        p_source: source,
      },
      sellerNotificationSettings,
    ),
});
