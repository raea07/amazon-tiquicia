// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The drivers' app, "Yuntera Ruta" (com.yuntera.ruta). Location while a route
 * is running (foreground service on Android, background mode on iOS, never
 * the "Always" permission), and nothing else. Camera scanning and delivery
 * photos are not built, but expo-camera and expo-image-picker are installed,
 * and Expo applies their plugins on its own with English permission texts.
 * They are listed below with every permission set to `false`, which removes
 * those texts, and the Android camera permission is blocked. The workstream
 * that adds photos or scanning gives them Spanish texts instead.
 *
 * What all four apps share is in packages/expo-kit/src/config.ts. Permission
 * texts are in Spanish and say why, as both stores require. `owner` is the
 * company's Expo team account; `easProjectId` is filled in after `eas init`
 * creates the project there.
 */
export default (): ExpoConfig =>
  defineAppConfig("driver", {
    slug: "yuntera-ruta",
    // The Expo team account the project will live in, as for the shopper app.
    // The project itself (and its id) is created by `eas init` under it.
    owner: "raulea07s-team",
    easProjectId: undefined,
    plugins: [
      [
        "expo-location",
        {
          // "While using" only. Tracking that continues with the screen off runs
          // as a foreground service started from the route screen (Android) and
          // with the location background mode (iOS); neither needs the "Always"
          // permission. See docs/research/expo-native-apps.md §4a and §8.
          locationWhenInUsePermission:
            "Yuntera Ruta usa su ubicación mientras usted tiene una ruta iniciada, para que Central vea su avance y pueda avisar a los clientes que esperan su entrega.",
          locationFullAccuracyPermission:
            "Yuntera Ruta necesita su ubicación exacta mientras tiene una ruta iniciada, para llegar a cada punto de entrega.",
          motionUsagePermission: false,
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          isIosBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: false,
          microphonePermission: false,
          recordAudioAndroid: false,
          barcodeScannerEnabled: false,
        },
      ],
      [
        "expo-image-picker",
        { cameraPermission: false, photosPermission: false, microphonePermission: false },
      ],
    ],
    blockedPermissions: [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.CAMERA",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    // Android 13 and later show the location foreground service's notice only
    // to an app that may post notifications. Asked for (after the app's own
    // explanation) when the driver starts sharing the position, never for
    // anything else: the app sends no other notification.
    androidPermissions: ["android.permission.POST_NOTIFICATIONS"],
    // The day kept for a dead zone holds customers' details; it stays off
    // Google's cloud backup (iOS: AsyncStorage is excluded from backups).
    androidBackup: false,
    // expo-task-manager's plugin, applied by Expo automatically, adds "fetch";
    // route tracking needs only the "location" background mode.
    removeBackgroundModes: ["fetch"],
  });
