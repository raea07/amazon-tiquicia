// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The drivers' app, "Yuntera Ruta" (cr.yuntera.ruta). Location while a route
 * is running (foreground service on Android, background mode on iOS, never
 * the "Always" permission), and nothing else: camera scanning and delivery
 * photos are not built, so the camera is not declared and its Android
 * permission (added by the installed expo-camera and expo-image-picker
 * libraries) is removed. The workstream that adds photos or scanning puts
 * their plugins and Spanish texts back.
 *
 * What all four apps share is in packages/expo-kit/src/config.ts. Permission
 * texts are in Spanish and say why, as both stores require. `easProjectId`
 * and `owner` are filled in after `eas init` creates the project.
 */
export default (): ExpoConfig =>
  defineAppConfig("driver", {
    slug: "yuntera-ruta",
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
    ],
    blockedPermissions: [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.CAMERA",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    // expo-task-manager's plugin, applied by Expo automatically, adds "fetch";
    // route tracking needs only the "location" background mode.
    removeBackgroundModes: ["fetch"],
  });
