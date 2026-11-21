// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The shopper app, "Yuntera" (cr.yuntera.shop). What all four apps share is in
 * packages/expo-kit/src/config.ts; this file adds what only the shop needs.
 *
 * `easProjectId` is the EAS project `eas init` created in the owner's Expo
 * account (not secret). `owner` stays unset: the project belongs to the
 * personal account the EAS command line is signed in to, which is what EAS
 * assumes when `owner` is absent.
 */
export default (): ExpoConfig =>
  defineAppConfig("shop", {
    slug: "yuntera",
    easProjectId: "d5057c32-2ea7-41ca-9020-4926ee362bac",
    plugins: [
      [
        "expo-location",
        {
          // Asked once, when the shopper taps "Usar mi ubicación actual" while
          // adding an address. Never in the background.
          locationWhenInUsePermission:
            "Yuntera usa su ubicación solo cuando usted lo pide, para marcar el punto exacto de entrega de una dirección.",
          // Asked only if the shopper chose "approximate location" and the
          // app needs the exact point once. Never the motion sensors.
          locationFullAccuracyPermission:
            "Yuntera necesita su ubicación exacta una vez, para marcar el punto de entrega de esta dirección.",
          motionUsagePermission: false,
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: false,
        },
      ],
    ],
    blockedPermissions: [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      // Added by Expo's Android template for old Android versions; the shop
      // reads and writes no shared files.
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
  });
