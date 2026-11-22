import type { ScannerCamera } from "@yuntera/expo-kit/scanner";

/**
 * The web export (used only for the journeys) has no camera: the scan
 * screens show the typing path, which is also what a hand scanner uses.
 * expo-camera is therefore not in the web bundle at all.
 */
export const camera: ScannerCamera | null = null;
