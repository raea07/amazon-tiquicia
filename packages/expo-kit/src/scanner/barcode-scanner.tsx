import { type ReactNode, useCallback, useId, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, type TextInputInstance, View } from "react-native";
import { messageOf } from "../errors";
import { colors, fontFamily, fontSize, radius, space, tone, touchTarget } from "../theme/tokens";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Text } from "../ui/text";
import { CameraPanel, type ScannerCamera } from "./camera";
import { cleanScan, readScan } from "./logic";
import { type ScanTone, vibrateFor } from "./signal";

export type ScanSource = "camera" | "keyboard";

/** What the screen says about a read: in words (never colour alone), with its tone. */
export interface ScanFeedback {
  tone: ScanTone;
  title?: string;
  message: string;
}

export interface BarcodeScannerProps {
  /** The app's camera, or null/undefined for typing only (the web export, an app without one). */
  camera?: ScannerCamera | null;
  /** The field's visible label. */
  label?: string;
  hint?: string;
  /** What the button does: "Confirmar línea", "Buscar". */
  submitLabel: string;
  submittingLabel?: string;
  /**
   * A read to act on: cleaned and valid already (or "" when `requireCode`
   * is false and the field is empty). Returns what to tell the worker.
   */
  onScan: (code: string, source: ScanSource) => Promise<ScanFeedback | null> | ScanFeedback | null;
  /** False lets the button send an empty field (a line confirmed with 0 units). */
  requireCode?: boolean;
  /** Fields shown between the code and the button (how many were taken). */
  children?: ReactNode;
  /** Prefix of the test ids: `<id>-input`, `<id>-submit`, `<id>-feedback`. */
  testID?: string;
}

/**
 * One way to get a code into a screen, three ways in: the phone's camera,
 * typing, and a hand scanner, which types the code into the focused field and
 * sends Enter. The field stays focused between scans when the worker uses it
 * (a hand scanner needs that), and is cleared after each, so the next scan
 * never lands on the last one. Every read gets an answer at once: in words
 * on screen, and by vibration on a phone.
 */
export function BarcodeScanner({
  camera,
  label = "Escanee o escriba el código",
  hint = "Código de barras o el código YT de la etiqueta.",
  submitLabel,
  submittingLabel = "Un momento…",
  onScan,
  requireCode = true,
  children,
  testID,
}: BarcodeScannerProps) {
  const id = useId().replace(/:/g, "");
  const input = useRef<TextInputInstance>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: ScanTone | "info";
    title?: string;
    message: string;
    read?: string;
  } | null>(null);
  const busyRef = useRef(false);
  const withCamera = Boolean(camera?.available) && Platform.OS !== "web";

  const submit = useCallback(
    async (raw: string, source: ScanSource) => {
      if (busyRef.current) return;
      const cleaned = cleanScan(raw);
      let code = "";
      if (cleaned || requireCode) {
        const check = readScan(raw);
        if (!check.ok) {
          setFeedback({ tone: "danger", message: check.error, read: cleaned || undefined });
          vibrateFor("danger");
          setValue("");
          if (source === "keyboard") input.current?.focus();
          return;
        }
        code = check.code;
      }
      busyRef.current = true;
      setBusy(true);
      setFeedback(code ? { tone: "info", message: "Revisando el código…", read: code } : null);
      let result: ScanFeedback | null;
      try {
        result = await onScan(code, source);
      } catch (error) {
        result = { tone: "danger", message: messageOf(error) };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      setFeedback(result ? { ...result, read: code || undefined } : null);
      if (result) vibrateFor(result.tone);
      setValue("");
      // A hand scanner types into whatever has focus: keep it here.
      if (source === "keyboard") input.current?.focus();
    },
    [onScan, requireCode],
  );

  return (
    <View style={styles.wrap}>
      {withCamera && camera ? (
        <CameraPanel camera={camera} onRead={(code) => submit(code, "camera")} testID={testID} />
      ) : null}
      <View style={styles.field}>
        <Text variant="smallStrong" nativeID={`${id}-label`}>
          {label}
        </Text>
        <TextInput
          ref={input}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => void submit(value, "keyboard")}
          // Enter submits and the field keeps focus for the next scan.
          submitBehavior="submit"
          returnKeyType="done"
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          // Without the camera this field is the way in: be ready for the scanner.
          autoFocus={!withCamera}
          aria-label={label}
          aria-labelledby={`${id}-label`}
          placeholder="Escanee o escriba"
          placeholderTextColor={colors.palette.anil[500]}
          style={styles.input}
          testID={testID ? `${testID}-input` : undefined}
        />
        {hint ? (
          <Text variant="small" tint="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
      <Button
        size="lg"
        block
        loading={busy}
        loadingLabel={submittingLabel}
        onPress={() => void submit(value, "keyboard")}
        testID={testID ? `${testID}-submit` : undefined}
      >
        {submitLabel}
      </Button>
      {feedback ? (
        <Alert
          tone={feedback.tone}
          title={feedback.title}
          testID={testID ? `${testID}-feedback` : undefined}
        >
          <Text variant="small" style={{ color: tone[feedback.tone].fg }}>
            {feedback.message}
          </Text>
          {feedback.read ? (
            <Text variant="caption" style={{ color: tone[feedback.tone].fg }}>
              Código leído: {feedback.read}
            </Text>
          ) : null}
        </Alert>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  field: { gap: space[1] + 2 },
  input: {
    // Taller than the 44 pt minimum: the one field a worker hits all day.
    minHeight: touchTarget + 8,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontFamily: fontFamily.body,
    // Large and in capitals: read from arm's length on a shelf.
    fontSize: fontSize.lg,
    letterSpacing: 0.5,
    color: colors.ink,
  },
});
