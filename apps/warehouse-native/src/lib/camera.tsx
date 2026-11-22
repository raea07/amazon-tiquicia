import type { ScannerCamera, ScannerCameraViewProps } from "@yuntera/expo-kit/scanner";
import { CameraView, useCameraPermissions } from "expo-camera";
import { isDevice } from "expo-device";

/** expo-camera's preview with only the settings the kit's scanner uses. */
function ScannerView(props: ScannerCameraViewProps) {
  return <CameraView {...props} />;
}

/**
 * The phone's camera for the kit's scanner. On a simulator there is none
 * (expo-camera is "device only"), so the scan screens offer typing alone.
 * `camera.web.ts` is what the web export gets instead: no camera at all.
 */
export const camera: ScannerCamera | null = {
  available: isDevice,
  CameraView: ScannerView,
  useCameraPermissions,
};
