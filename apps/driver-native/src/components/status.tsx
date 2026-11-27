import type { QueueEntry } from "@yuntera/expo-kit/offline";
import { pendingLabel } from "@yuntera/expo-kit/offline";
import { colors, radius, space, tone } from "@yuntera/expo-kit/theme";
import { Alert, Button, Card, formatDateTime, PinIcon, Stack, Text } from "@yuntera/expo-kit/ui";
import { Platform, StyleSheet, View } from "react-native";
import { type Tracking, useDriver } from "@/lib/driver";
import type { ArrivePayload, FailPayload } from "@/lib/outbox";
import { findStop, reasonTitle, type ShownRoute, STOP_LABEL } from "@/lib/route";
import { canOpenSettings, openSettings } from "@/lib/tracking";

/** No signal: say what still works and what does not. */
export function OfflineBanner() {
  const { offline, savedAt } = useDriver();
  if (!offline) return null;
  return (
    <Alert tone="warning" title="Sin conexión" testID="offline-banner">
      {`Puede seguir: lo que registre queda guardado en el teléfono y se envía solo cuando vuelva la señal. Para entregar con el código sí necesita señal.${
        savedAt
          ? ` Está viendo la ruta guardada en el teléfono, como estaba el ${formatDateTime(new Date(savedAt).toISOString())}, hasta que vuelva la señal.`
          : ""
      }`}
    </Alert>
  );
}

function describe(entry: QueueEntry, routes: ShownRoute[] | null): string {
  if (entry.kind === "position") return "Su última ubicación";
  const stopId = (entry.payload as ArrivePayload | FailPayload).stopId;
  const found = routes ? findStop(routes, stopId) : null;
  // With two routes started, "parada 1" alone could be either: name the route.
  const where = found
    ? `parada ${found.stop.sequence} de la ruta ${found.route.code}, ${found.stop.recipient_name.split(" ")[0]}`
    : "una parada";
  if (entry.kind === "arrive") return `Llegada a la ${where}`;
  if (entry.kind === "fail") {
    // The stop's own word (core's), so the queue and the stop read the same.
    return `${STOP_LABEL.failed.label} (${reasonTitle((entry.payload as FailPayload).reason).toLowerCase()}): ${where}`;
  }
  return "Una acción";
}

/**
 * What is waiting to be sent, and what the server refused. Always says how
 * many actions wait, so the driver knows nothing is lost.
 */
export function QueueCard() {
  const { queue, sendNow, dismiss, routes, drained } = useDriver();
  const waiting = queue.entries.filter((entry) => entry.status !== "rejected");
  const refused = queue.entries.filter((entry) => entry.status === "rejected");
  const stopActions = waiting.filter((entry) => entry.kind !== "position").length;

  return (
    <>
      {refused.map((entry) => (
        <Alert key={entry.id} tone="danger" title="No se pudo registrar" testID="outbox-refused">
          <Stack gap={2}>
            <Text variant="small" style={{ color: tone.danger.fg }}>
              {`${describe(entry, routes)}. ${entry.message ?? ""}`}
            </Text>
            <Button variant="secondary" onPress={() => void dismiss(entry.id)}>
              Entendido
            </Button>
          </Stack>
        </Alert>
      ))}
      {waiting.length > 0 ? (
        <Card testID="outbox" style={styles.waiting}>
          <Text variant="heading" level={2} style={styles.warn}>
            {stopActions > 0 ? pendingLabel(stopActions) : "Su ubicación está por enviar"}
          </Text>
          <Stack gap={1}>
            {waiting.map((entry) => (
              <Text key={entry.id} variant="small" style={styles.warn}>
                {`· ${describe(entry, routes)}`}
              </Text>
            ))}
          </Stack>
          <Text variant="small" style={styles.warn}>
            Quedan guardadas en el teléfono y se envían en orden, una sola vez, cuando vuelva la
            señal.
          </Text>
          <Button
            variant="secondary"
            block
            loading={queue.flushing}
            loadingLabel="Enviando…"
            onPress={() => void sendNow()}
            testID="outbox-send"
          >
            Enviar ahora
          </Button>
        </Card>
      ) : drained ? (
        <Alert tone="success" testID="outbox-sent">
          Todo lo que estaba guardado ya se envió.
        </Alert>
      ) : null}
    </>
  );
}

const TRACKING_TEXT: Record<Tracking, string> = {
  on: "Compartiendo su ubicación con Central mientras la ruta esté iniciada.",
  starting: "Activando su ubicación…",
  off: "No está compartiendo su ubicación. Central no ve por dónde va.",
  denied:
    Platform.OS === "web"
      ? "La ubicación está bloqueada en el navegador. Actívela para que Central vea por dónde va."
      : "La ubicación está desactivada para Yuntera Ruta. Actívela en Ajustes, en «Mientras se usa la app», para que Central vea por dónde va.",
  gps_off: "La ubicación del teléfono está apagada. Enciéndala para que Central vea por dónde va.",
  failed: "No pudimos activar su ubicación. Inténtelo de nuevo.",
};

/** While sharing is on but nothing reaches Central: no signal. */
const TRACKING_OFFLINE =
  "Sin señal: su ubicación queda guardada en el teléfono y se envía cuando vuelva la conexión.";

/** Whether the position is being shared, in words, with the one action that changes it. */
export function TrackingStatus({ onShare }: { onShare: () => void }) {
  const { tracking, offline } = useDriver();
  const on = tracking === "on" && !offline;
  return (
    <View
      style={[styles.tracking, on ? styles.trackingOn : null]}
      testID="tracking"
      aria-live="polite"
    >
      <View style={styles.trackingLine}>
        <PinIcon size={20} color={on ? tone.success.fg : colors.inkMuted} />
        <Text variant="small" style={[styles.fill, on ? styles.ok : null]}>
          {tracking === "on" && offline ? TRACKING_OFFLINE : TRACKING_TEXT[tracking]}
        </Text>
      </View>
      {tracking === "denied" && canOpenSettings ? (
        <Button variant="secondary" block onPress={() => void openSettings()}>
          Abrir Ajustes
        </Button>
      ) : tracking === "off" || tracking === "failed" || tracking === "gps_off" ? (
        <Button variant="secondary" block onPress={onShare} testID="tracking-share">
          Compartir mi ubicación
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // The tested alert pairs (tokens.ts), so the text keeps its contrast on the tinted card.
  warn: { color: tone.warning.fg },
  ok: { color: tone.success.fg },
  waiting: { borderColor: tone.warning.border, backgroundColor: tone.warning.bg },
  tracking: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  trackingOn: { borderColor: tone.success.border, backgroundColor: tone.success.bg },
  trackingLine: { flexDirection: "row", gap: space[2], alignItems: "flex-start" },
});
