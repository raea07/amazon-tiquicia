import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, TextInput, type TextInputInstance, View } from "react-native";
import { messageOf } from "../errors";
import { colors, fontFamily, fontSize, radius, space, tone, touchTarget } from "../theme/tokens";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Text } from "../ui/text";
import { CameraPanel, type CameraState, type ScannerCamera } from "./camera";
import { cleanScan, createScanQueue, type ReadState, readScan, shortCode } from "./logic";
import { type ScanTone, vibrateFor } from "./signal";

export type ScanSource = "camera" | "keyboard";

/** What the screen says about a read: in words (never colour alone), with its tone. */
export interface ScanFeedback {
  tone: ScanTone;
  title?: string;
  message: string;
  /**
   * Put the code back in the field: the read was fine but something else
   * was not (how many were taken), so the worker fixes that and sends again.
   */
  keepCode?: boolean;
}

/** What a screen can do with its scanner: give the field back its focus, or hand it a code. */
export interface BarcodeScannerHandle {
  focus(): void;
  /** Puts text in the field and focuses it (the start of a scan typed elsewhere). */
  fill(text: string): void;
  /** Handles a code as if it had been scanned into the field. */
  submit(text: string): void;
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
  ref?: Ref<BarcodeScannerHandle>;
}

/**
 * react-native-web blurs a single-line field on Enter unless `blurOnSubmit`
 * is false (it does not read `submitBehavior`); the next scan would then land
 * nowhere while the last one is checked. Native reads `submitBehavior`.
 */
const KEEP_FOCUS_ON_WEB = (Platform.OS === "web" ? { blurOnSubmit: false } : {}) as object;

type Shown = { tone: ScanTone | "info"; title?: string; message: string; read?: string };
type Read = { code: string; source: ScanSource };

/**
 * One way to get a code into a screen, three ways in: the phone's camera,
 * typing, and a hand scanner, which types the code into the focused field and
 * sends Enter. The field stays focused between scans when the worker uses it
 * (a hand scanner needs that), and is emptied as soon as a read is taken, so
 * the next scan never lands on the last one. A read that comes in while the
 * last is still being checked waits its turn. Every read gets an answer at
 * once, where the worker is looking: in the camera frame and right above the
 * field, in words, and by vibration on a phone.
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
  ref,
}: BarcodeScannerProps) {
  const id = useId().replace(/:/g, "");
  const input = useRef<TextInputInstance>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Shown | null>(null);
  const [read, setRead] = useState<ReadState | null>(null);
  const withCamera = Boolean(camera?.available) && Platform.OS !== "web";
  const [cameraState, setCameraState] = useState<CameraState>(withCamera ? "asking" : "off");

  // The queue calls the latest handler, so a read that waited sees the screen as it is now.
  const handle = async ({ code, source }: Read) => {
    setBusy(true);
    if (code) {
      setFeedback({ tone: "info", message: "Revisando el código…", read: code });
      setRead({ phase: "checking", code });
    } else {
      setFeedback(null);
    }
    let result: ScanFeedback | null;
    try {
      result = await onScan(code, source);
    } catch (error) {
      result = { tone: "danger", message: messageOf(error) };
    }
    setBusy(false);
    setFeedback(result ? { ...result, read: code || undefined } : null);
    setRead(result ? { phase: "done", tone: result.tone, title: result.title, code } : null);
    if (result) vibrateFor(result.tone);
    // Only if nothing new was typed meanwhile: a scan that came in later is never overwritten.
    if (result?.keepCode && code) setValue((now) => (now === "" ? code : now));
    // A hand scanner types into whatever has focus: keep it here.
    if (source === "keyboard") input.current?.focus();
  };
  const latest = useRef(handle);
  latest.current = handle;
  const queue = useRef(createScanQueue<Read>((item) => latest.current(item))).current;

  const submit = useCallback(
    (raw: string, source: ScanSource) => {
      const cleaned = cleanScan(raw);
      // Taken: the field is free at once for the next scan.
      if (source === "keyboard") setValue("");
      let code = "";
      if (cleaned || requireCode) {
        const check = readScan(raw);
        if (!check.ok) {
          setFeedback({
            tone: "danger",
            message: check.error,
            read: cleaned ? shortCode(cleaned) : undefined,
          });
          setRead({ phase: "done", tone: "danger", code: cleaned || undefined });
          vibrateFor("danger");
          if (source === "keyboard") input.current?.focus();
          return Promise.resolve();
        }
        code = check.code;
      }
      return queue.push({ code, source }).then((outcome) => {
        if (outcome === "queued") {
          setFeedback({
            tone: "info",
            message: "Espere: estamos revisando el código anterior. Este va después.",
            read: code || undefined,
          });
        } else if (outcome === "dropped") {
          setFeedback({
            tone: "danger",
            message:
              "Espere a que terminemos de revisar los códigos anteriores y vuelva a escanear.",
            read: code || undefined,
          });
          vibrateFor("danger");
        }
      });
    },
    [queue, requireCode],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      fill: (text: string) => {
        setValue(text);
        input.current?.focus();
      },
      submit: (text: string) => {
        input.current?.focus();
        void submit(text, "keyboard");
      },
    }),
    [submit],
  );

  // On a phone, when the camera is not in use (refused, put off for now,
  // failed or switched off), the field is the way in: be ready for a scanner.
  useEffect(() => {
    if (withCamera && cameraState === "off") input.current?.focus();
  }, [withCamera, cameraState]);

  return (
    <View style={styles.wrap}>
      {withCamera && camera ? (
        <CameraPanel
          camera={camera}
          read={read}
          onStateChange={setCameraState}
          onRead={(code) => submit(code, "camera")}
          testID={testID}
        />
      ) : null}
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
            <Text variant="caption" style={{ color: tone[feedback.tone].fg }} numberOfLines={2}>
              Código leído: {shortCode(feedback.read)}
            </Text>
          ) : null}
        </Alert>
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
          // Enter submits and the field keeps focus for the next scan, even
          // while that scan is checked (react-native-web reads the older prop).
          submitBehavior="submit"
          {...KEEP_FOCUS_ON_WEB}
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
