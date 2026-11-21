// Lets this file import the workspace's TypeScript packages; must come first.
import "tsx/cjs";
import { defineAppConfig } from "@yuntera/expo-kit/config";
import type { ExpoConfig } from "expo/config";

/**
 * The seller app, "Yuntera Vende" (cr.yuntera.vende). What all four apps
 * share is in packages/expo-kit/src/config.ts. `easProjectId` and `owner` are
 * filled in after `eas init` creates the project.
 *
 * The screens built so far use no camera, photo library, microphone or
 * location, so the app asks for none of them. expo-image-picker (product
 * photos) and expo-camera (barcode scanning) are installed for work that is
 * not built yet, and Expo applies their plugins even when they are not
 * listed, adding English permission texts. They are listed here with every
 * permission set to `false`, which removes those texts on iOS and blocks the
 * permissions on Android. The Spanish texts this file had before ("Yuntera
 * Vende usa sus fotos solo cuando usted elige una…", "…usa la cámara cuando
 * usted la abre…") come back with the photo and scanning work.
 */
export default (): ExpoConfig =>
  defineAppConfig("seller", {
    slug: "yuntera-vende",
    easProjectId: undefined,
    plugins: [
      [
        "expo-image-picker",
        { photosPermission: false, cameraPermission: false, microphonePermission: false },
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
    ],
    blockedPermissions: [
      "android.permission.CAMERA",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      // Added by Expo's Android template for old Android versions; the seller
      // app reads and writes no shared files.
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
  });
