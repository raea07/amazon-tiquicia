// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The seller app, "Yuntera Vende" (com.yuntera.vende). Photos of products
 * (camera or library) and barcode scanning; no location.
 *
 * What all four apps share is in packages/expo-kit/src/config.ts. Permission
 * texts are in Spanish and say why, as both stores require. `easProjectId`
 * and `owner` are filled in after `eas init` creates the project.
 */
export default (): ExpoConfig =>
  defineAppConfig("seller", {
    slug: "yuntera-vende",
    easProjectId: undefined,
    plugins: [
      [
        "expo-image-picker",
        {
          photosPermission:
            "Yuntera Vende usa sus fotos solo cuando usted elige una, para mostrar sus productos en la tienda.",
          cameraPermission:
            "Yuntera Vende usa la cámara cuando usted la abre, para fotografiar sus productos.",
          microphonePermission: false,
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "Yuntera Vende usa la cámara cuando usted la abre, para fotografiar sus productos o leer un código de barras.",
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
    ],
    blockedPermissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
    ],
  });
