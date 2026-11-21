// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The drivers' app, "Yuntera Ruta" (cr.yuntera.ruta). Location while a route
 * is running (foreground service on Android, background mode on iOS, never
 * the "Always" permission), camera for parcel labels.
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
            "Yuntera Ruta usa su ubicación mientras usted tiene una ruta iniciada, para mostrar su avance a Central y a los clientes que esperan su entrega.",
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
          cameraPermission:
            "Yuntera Ruta usa la cámara cuando usted la abre, para leer la etiqueta de un paquete.",
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      [
        "expo-image-picker",
        {
          // Photos at delivery are an owner decision still open; the camera text
          // is ready, the photo library is not used.
          cameraPermission:
            "Yuntera Ruta usa la cámara cuando usted la abre, para fotografiar una entrega.",
          photosPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    blockedPermissions: [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    // expo-task-manager's plugin, applied by Expo automatically, adds "fetch";
    // route tracking needs only the "location" background mode.
    removeBackgroundModes: ["fetch"],
  });
