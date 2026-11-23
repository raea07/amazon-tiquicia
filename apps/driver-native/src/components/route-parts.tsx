import { colors, radius, space, tone } from "@yuntera/expo-kit/theme";
import { Badge, formatPrice, Text } from "@yuntera/expo-kit/ui";
import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { parcels, placeOf, type ShownStop, STOP_LABEL } from "@/lib/route";

/** The stop's state in words (never colour alone), with "Por enviar" when the phone has not sent it. */
export function StopBadges({ stop }: { stop: ShownStop }) {
  const status = STOP_LABEL[stop.status];
  return (
    <View style={styles.badges}>
      <Badge tone={status.tone}>{status.label}</Badge>
      {stop.unsent ? <Badge tone="warning">Por enviar</Badge> : null}
    </View>
  );
}

/** "Cobrar ₡23 400": shown wherever a stop's cash is. */
export function CashChip({ amountMinor }: { amountMinor: number }) {
  return (
    <View style={[styles.chip, styles.cash]}>
      <Text variant="caption" style={styles.cashText}>
        {`Cobrar ${formatPrice(amountMinor)}`}
      </Text>
    </View>
  );
}

function StopBody({ stop }: { stop: ShownStop }) {
  return (
    <>
      <View style={styles.head}>
        <Text variant="bodyStrong" style={styles.fill}>
          <Text variant="bodyStrong" tint="muted">{`${stop.sequence}. `}</Text>
          {stop.recipient_name}
        </Text>
        <StopBadges stop={stop} />
      </View>
      {placeOf(stop) ? (
        <Text variant="smallStrong" testID="stop-row-place">
          {placeOf(stop)}
        </Text>
      ) : null}
      <Text variant="small" tint="muted" numberOfLines={2}>
        {stop.senas}
      </Text>
      {stop.status === "skipped" ? (
        <Text variant="smallStrong" testID="stop-row-skipped">
          Central quitó esta parada de la ruta. Si lleva el paquete, devuélvalo a la bodega.
        </Text>
      ) : null}
      <View style={styles.chips}>
        <View style={styles.chip}>
          <Text variant="caption">{`${parcels(stop.package_count)} · ${stop.tracking_code}`}</Text>
        </View>
        {stop.cod_amount_minor > 0 ? <CashChip amountMinor={stop.cod_amount_minor} /> : null}
      </View>
    </>
  );
}

/**
 * One stop in the day's list. A stop the driver can still act on opens its
 * screen; the next one is outlined and says so; a closed one is muted.
 */
export function StopRow({
  stop,
  next,
  actionable,
  later,
  testID,
}: {
  stop: ShownStop;
  next: boolean;
  actionable: boolean;
  later: boolean;
  testID?: string;
}) {
  if (!actionable) {
    return (
      <View style={[styles.row, styles.closed]} testID={testID}>
        <StopBody stop={stop} />
      </View>
    );
  }
  return (
    <Link href={{ pathname: "/parada/[id]", params: { id: stop.stop_id } }} asChild>
      <Pressable
        role="link"
        testID={testID}
        aria-label={`${next ? "Próxima parada: " : ""}parada ${stop.sequence}, ${stop.recipient_name}`}
        style={StyleSheet.flatten([styles.row, next ? styles.next : null])}
      >
        {next ? (
          <Text variant="caption" tint="link" style={styles.nextLabel}>
            PRÓXIMA PARADA
          </Text>
        ) : later ? (
          <Text variant="caption" tint="muted" style={styles.nextLabel}>
            PARA DESPUÉS
          </Text>
        ) : null}
        <StopBody stop={stop} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: {
    minHeight: 56,
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  next: { borderWidth: 2, borderColor: colors.brand },
  closed: { backgroundColor: colors.surfaceMuted },
  nextLabel: { fontWeight: "700", letterSpacing: 0.6 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  badges: { alignItems: "flex-end", gap: space[1] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: {
    borderRadius: radius.full,
    paddingHorizontal: space[2],
    paddingVertical: 2,
    backgroundColor: tone.neutral.bg,
  },
  cash: { backgroundColor: tone.warning.bg },
  cashText: { color: tone.warning.fg, fontWeight: "700" },
});
