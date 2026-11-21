/**
 * Switches the real service takes from the project's Auth settings. Here they
 * live in the local database (dev_standin.settings, reset with it) so a browser
 * journey can turn e-mail confirmation on for itself without affecting the
 * others; an environment variable gives the default.
 */

import { pool } from "../context.ts";

const DEFAULTS = {
  /** "on": sign-up returns no session until the address is confirmed (hosted default). */
  confirm_email: process.env.DEV_AUTH_CONFIRM_EMAIL ?? "off",
  /** Seconds before the same person can be sent another e-mail of a kind (`max_frequency`). */
  email_max_frequency_seconds: "60",
  /** How long an e-mailed link or code works (`otp_expiry`). */
  otp_expiry_seconds: "3600",
  /** Minimum password length, set to the apps' rule (`password_min_length`). */
  password_min_length: "8",
  /** "on": call public.hook_mfa_verification_attempt like a Team-plan project with the hook enabled. */
  mfa_verification_hook: "off",
  /** Where links point when the request names no redirect (`site_url`). */
  site_url: process.env.DEV_SITE_URL ?? "http://127.0.0.1:3000",
  /** Other addresses e-mail links may point at, comma-separated (`uri_allow_list`). */
  uri_allow_list: "",
} as const;

export type SettingKey = keyof typeof DEFAULTS;
export const SETTING_KEYS = Object.keys(DEFAULTS) as SettingKey[];

export async function setting(key: SettingKey): Promise<string> {
  try {
    const { rows } = await pool.query<{ value: string }>(
      "select value from dev_standin.settings where key = $1",
      [key],
    );
    return rows[0]?.value ?? DEFAULTS[key];
  } catch {
    return DEFAULTS[key]; // a database built before the shim had the table
  }
}

export const numberSetting = async (key: SettingKey) => Number(await setting(key));

export async function saveSetting(key: SettingKey, value: string): Promise<void> {
  await pool.query(
    `insert into dev_standin.settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  );
}
