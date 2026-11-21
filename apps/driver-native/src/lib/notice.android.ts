/**
 * Android 13 and later show the location foreground service's notice (the
 * only notification this app ever posts) only once the app may post
 * notifications (POST_NOTIFICATIONS, declared for this app alone in
 * app.config.ts). Older Android versions need no permission for it.
 *
 * Android says whether it is granted, not whether it was asked, so the phone
 * remembers that it asked (a plain flag, no personal data): asked and
 * refused reads as "denied", and the app does not ask again; the driver can
 * still allow it in the phone's settings. iOS and the web export use
 * notice.ts.
 */

import { appStorage } from "@yuntera/expo-kit/supabase";
import { PermissionsAndroid, Platform } from "react-native";
import type { Permission } from "./tracking";

const ASKED_KEY = "yuntera-ruta.notice-asked";
const needsPermission = () => Number(Platform.Version) >= 33;

export async function noticePermission(): Promise<Permission> {
  if (!needsPermission()) return "granted";
  try {
    if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) {
      return "granted";
    }
    return (await appStorage.getItem(ASKED_KEY)) ? "denied" : "undetermined";
  } catch {
    return "denied";
  }
}

/** Shows the system's notification prompt. Our explanation screen (/ubicacion) comes first. */
export async function askNoticePermission(): Promise<Permission> {
  if (!needsPermission()) return "granted";
  try {
    await appStorage.setItem(ASKED_KEY, "1").catch(() => undefined);
    const answer = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return answer === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
  } catch {
    return "denied";
  }
}
