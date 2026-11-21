import { useIsFocused } from "expo-router";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { Linking, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius, space, tone } from "../theme/tokens";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { CheckIcon } from "../ui/icons";
import { Card } from "../ui/layout";
import { Text } from "../ui/text";
import { createScanGate, SYMBOLOGIES, type Symbology } from "./logic";

/** The part of expo-camera's permission answer this component reads. */
export interface CameraPermission {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

/** The props of expo-camera's CameraView this component sets. */
export interface ScannerCameraViewProps {
  style?: StyleProp<ViewStyle>;
  facing?: "back" | "front";
  active?: boolean;
  enableTorch?: boolean;
  barcodeScannerSettings?: { barcodeTypes: Symbology[] };
  onBarcodeScanned?: (result: { type: string; data: string }) => void;
  onMountError?: (event: { message: string }) => void;
}

/**
 * The camera, handed in by the app. The kit does not import expo-camera
 * itself: each app that scans has it as a dependency and passes its
 * `CameraView` and `useCameraPermissions` here (see `apps/warehouse-native/
 * src/lib/camera.ts`), so an app without a camera never bundles it, and the
 * web export passes nothing and shows only the typing path.
 */
export interface ScannerCamera {
  /** False on a simulator or a device without a camera: typing only. */
  available: boolean;
  CameraView: ComponentType<ScannerCameraViewProps>;
  useCameraPermissions: () => readonly [
    CameraPermission | null,
    () => Promise<CameraPermission>,
    ...unknown[],
  ];
}

// "Ahora no" holds for the rest of the time the app is open, so the
// explanation does not come back on every scan screen.
let explanationDismissed = false;

/**
 * The camera part of a scan screen. The permission is asked only here, the
 * first time a scan screen opens, and only after the worker has read why and
 * pressed the button; refusing leaves typing and a hand scanner, which work
 * the same. The preview runs only while the screen is in front (one camera
 * preview at a time), with torch control and a frame to aim at; every read
 * shows at once in the frame, in words.
 */
export function CameraPanel({
  camera,
  onRead,
  testID,
}: {
  camera: ScannerCamera;
  /** A new read (already one per scan); resolves when it has been handled. */
  onRead: (code: string) => Promise<void>;
  testID?: string;
}) {
  const [permission, requestPermission] = camera.useCameraPermissions();
  const focused = useIsFocused();
  const [on, setOn] = useState(true);
  const [torch, setTorch] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(explanationDismissed);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [handling, setHandling] = useState(false);
  const gate = useRef(createScanGate()).current;

  useEffect(() => {
    if (!lastRead) return;
    const timer = setTimeout(() => setLastRead(null), 2500);
    return () => clearTimeout(timer);
  }, [lastRead]);

  if (!permission || failed) {
    return failed ? (
      <Alert tone="info" title="No pudimos abrir la cámara">
        Escriba el código o use un lector de códigos.
      </Alert>
    ) : null;
  }

  if (!permission.granted) {
    if (permission.status === "undetermined" && dismissed) return null;
    if (permission.status === "undetermined") {
      return (
        <Card testID={testID ? `${testID}-camera-ask` : undefined}>
          <Text variant="subheading">Leer códigos con la cámara</Text>
          <Text variant="small">
            Para leer códigos de barras con la cámara, el teléfono le va a pedir permiso. Yuntera
            Bodega solo la usa mientras usted tiene abierta una pantalla para escanear; no toma
            fotos ni graba video. Si prefiere, escriba el código o use un lector.
          </Text>
          <Button block onPress={() => void requestPermission()}>
            Permitir la cámara
          </Button>
          <Button
            variant="ghost"
            block
            onPress={() => {
              explanationDismissed = true;
              setDismissed(true);
            }}
          >
            Ahora no, escribir el código
          </Button>
        </Card>
      );
    }
    return (
      <Alert tone="info" title="La cámara no tiene permiso">
        <Text variant="small" style={{ color: tone.info.fg }}>
          Puede escribir el código o usar un lector. Para leer con la cámara, permítala en los
          ajustes del teléfono.
        </Text>
        {permission.canAskAgain ? (
          <Button variant="secondary" onPress={() => void requestPermission()}>
            Permitir la cámara
          </Button>
        ) : (
          <Button variant="secondary" onPress={() => void Linking.openSettings()}>
            Abrir los ajustes
          </Button>
        )}
      </Alert>
    );
  }

  const { CameraView } = camera;
  const live = on && focused;
  return (
    <View style={styles.wrap} testID={testID ? `${testID}-camera` : undefined}>
      {live ? (
        <View style={styles.viewport}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            active={live}
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: [...SYMBOLOGIES] }}
            onMountError={() => setFailed(true)}
            // No handler while a read is being handled: the camera stops
            // sending frames' codes until the screen is ready for the next one.
            onBarcodeScanned={
              handling
                ? undefined
                : ({ data }) => {
                    const code = gate.offer(data);
                    if (!code) return;
                    setLastRead(code);
                    setHandling(true);
                    void onRead(code).finally(() => {
                      gate.release();
                      setHandling(false);
                    });
                  }
            }
          />
          <View style={styles.frame} pointerEvents="none" aria-hidden />
          <View style={styles.caption} pointerEvents="none">
            {lastRead ? (
              <View style={styles.read}>
                <CheckIcon size={18} color={colors.palette.white} />
                <Text variant="smallStrong" style={styles.captionText} numberOfLines={1}>
                  Código leído: {lastRead}
                </Text>
              </View>
            ) : (
              <Text variant="small" style={styles.captionText}>
                Ponga el código dentro del marco
              </Text>
            )}
          </View>
        </View>
      ) : null}
      <View style={styles.controls}>
        <Button
          variant="secondary"
          onPress={() => {
            setOn(!on);
            if (on) setTorch(false);
          }}
          style={styles.control}
        >
          {on ? "Apagar la cámara" : "Usar la cámara"}
        </Button>
        {live ? (
          <Button
            variant="secondary"
            aria-pressed={torch}
            onPress={() => setTorch(!torch)}
            style={styles.control}
          >
            {torch ? "Apagar la linterna" : "Encender la linterna"}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  viewport: {
    height: 220,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.palette.anil[900],
  },
  frame: {
    position: "absolute",
    top: 36,
    bottom: 56,
    left: "12%",
    right: "12%",
    borderWidth: 3,
    borderColor: colors.palette.white,
    borderRadius: radius.md,
  },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    backgroundColor: colors.palette.anil[900],
    alignItems: "center",
  },
  read: { flexDirection: "row", alignItems: "center", gap: space[2] },
  captionText: { color: colors.palette.white },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  control: { flexGrow: 1 },
});
