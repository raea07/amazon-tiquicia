// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The warehouse app, "Yuntera Bodega" (com.yuntera.bodega). Camera for
 * barcodes; a hand scanner that types into a field works without it.
 *
 * What all four apps share is in packages/expo-kit/src/config.ts. Permission
 * texts are in Spanish and say why, as both stores require. `owner` is the
 * company's Expo team account; `easProjectId` is filled in after `eas init`
 * creates the project there.
 */
export default (): ExpoConfig =>
  defineAppConfig("warehouse", {
    slug: "yuntera-bodega",
    // The Expo team account the project will live in, as for the shopper app.
    // The project itself (and its id) is created by `eas init` under it.
    owner: "raulea07s-team",
    easProjectId: undefined,
    plugins: [
      [
        "expo-camera",
        {
          cameraPermission:
            "Yuntera Bodega usa la cámara cuando usted la abre, para leer códigos de barras de productos y paquetes.",
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
    ],
    blockedPermissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
  });
