/**
 * The notice shown while the position is shared needs a permission on
 * Android 13 and later only (notice.android.ts). On iOS the system's location
 * indicator plays that part, and a browser shows nothing, so there is
 * nothing to ask.
 */

import type { Permission } from "./tracking";

export async function noticePermission(): Promise<Permission> {
  return "granted";
}

export async function askNoticePermission(): Promise<Permission> {
  return "granted";
}
