import { useIsFocused } from "expo-router";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { Linking, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius, space, tone } from "../theme/tokens";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { CheckIcon, CloseIcon, HelpIcon } from "../ui/icons";
import { Card } from "../ui/layout";
import { Text } from "../ui/text";
import { createScanGate, type ReadState, readCaption, SYMBOLOGIES, type Symbology } from "./logic";

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

/**
 * Whether the camera is the way in right now: "live" (the preview runs),
 * "asking" (the explanation is on screen, or the permission is loading) or
 * "off" (refused, put off, failed, switched off: the field is the way in).
 */
export type CameraState = "live" | "asking" | "off";

// "Ahora no" holds for the rest of the time the app is open, so the
// explanation does not come back on every scan screen.
let explanationDismissed = false;

/**
 * The camera part of a scan screen. The permission is asked only here, the
 * first time a scan screen opens, and only after the worker has read why and
 * pressed the button; refusing leaves typing and a hand scanner, which work
 * the same. The preview runs only while the screen is in front (one camera
 * preview at a time), with torch control and a frame to aim at; every read
 * shows in the frame, in words: "Revisando…" while it is checked, then
 * whether it was accepted, never a tick before that.
 */
export function CameraPanel({
  camera,
  read,
  onRead,
  onStateChange,
  testID,
}: {
  camera: ScannerCamera;
  /** Where the last read is (checking, or its result), to show in the frame. */
  read?: ReadState | null;
  /** A new read (already one per scan); resolves when it has been handled. */
  onRead: (code: string) => Promise<void>;
  /** Told whenever the camera starts or stops being the way in. */
  onStateChange?: (state: CameraState) => void;
  testID?: string;
}) {
  const [permission, requestPermission] = camera.useCameraPermissions();
  const focused = useIsFocused();
  const [on, setOn] = useState(true);
  const [torch, setTorch] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(explanationDismissed);
  const [shown, setShown] = useState<ReadState | null>(null);
  const [handling, setHandling] = useState(false);
  const gate = useRef(createScanGate()).current;

  // A result stays in the frame for a moment, then the frame asks for the next code.
  useEffect(() => {
    setShown(read ?? null);
    if (read?.phase !== "done") return;
    const timer = setTimeout(() => setShown(null), 2500);
    return () => clearTimeout(timer);
  }, [read]);

  const state: CameraState = failed
    ? "off"
    : !permission
      ? "asking"
      : permission.granted
        ? on
          ? "live"
          : "off"
        : permission.status === "undetermined" && !dismissed
          ? "asking"
          : "off";
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

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
  const caption = readCaption(shown);
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
            <View style={styles.read}>
              {caption.icon === "check" ? (
                <CheckIcon size={18} color={colors.palette.white} />
              ) : caption.icon === "cross" ? (
                <CloseIcon size={18} color={colors.palette.white} />
              ) : caption.icon === "attention" ? (
                <HelpIcon size={18} color={colors.palette.white} />
              ) : null}
              <Text
                variant={caption.icon ? "smallStrong" : "small"}
                style={styles.captionText}
                numberOfLines={1}
              >
                {caption.text}
              </Text>
            </View>
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
