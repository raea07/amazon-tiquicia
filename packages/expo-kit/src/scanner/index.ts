/**
 * Barcode scanning for the native apps: the camera, typing and a hand
 * scanner, built once. `logic` has no React Native in it and is unit-tested.
 */
export {
  BarcodeScanner,
  type BarcodeScannerProps,
  type ScanFeedback,
  type ScanSource,
} from "./barcode-scanner";
export {
  CameraPanel,
  type CameraPermission,
  type ScannerCamera,
  type ScannerCameraViewProps,
} from "./camera";
export {
  cleanScan,
  codeKeys,
  createScanGate,
  expandUpcE,
  gtinCheckDigit,
  isValidGtin,
  lookupForms,
  MAX_CODE_LENGTH,
  matchesTarget,
  matchScan,
  readScan,
  type ScanCheck,
  type ScanGate,
  type ScanMatch,
  type ScanTarget,
  SYMBOLOGIES,
  type Symbology,
  validateScan,
} from "./logic";
export { type ScanTone, vibrateFor } from "./signal";
