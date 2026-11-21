// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The shopper app, "Yuntera" (cr.yuntera.shop). What all four apps share is in
 * packages/expo-kit/src/config.ts; this file adds what only the shop needs.
 *
 * `easProjectId` and `owner` are filled in after `eas init` creates the
 * project in the owner's Expo account; until then they stay unset.
 */
export default (): ExpoConfig =>
  defineAppConfig("shop", {
    slug: "yuntera",
    easProjectId: undefined,
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
