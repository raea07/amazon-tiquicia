import type { WmsBoard } from "@yuntera/db";
import { ApiError } from "@yuntera/db";
import { messageOf, useApi } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import {
  BarcodeScanner,
  findByForms,
  matchScan,
  type ScanFeedback,
} from "@yuntera/expo-kit/scanner";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  ChoiceList,
  EmptyState,
  ErrorState,
  FormMessage,
  formatDate,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { Stack as Nav, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { camera } from "@/lib/camera";
import { isPutawayBin, parseReceive, pendingUnits, plural } from "@/lib/floor";
import { keys, useWarehouse } from "@/lib/warehouse";

type Inbound = WmsBoard["inbound"][number];
type Line = NonNullable<Inbound["lines"]>[number];
type Bin = { id: string; code: string };

const product = (line: Line) =>
  `${line.title}${line.variant_name ? ` (${line.variant_name})` : ""}`;

/** Counts one line in at the dock and puts the good units away, as the web's form does. */
function ReceiveForm({
  line,
  bins,
  onReceived,
  onStale,
}: {
  line: Line;
  bins: Bin[];
  onReceived: (message: string) => void;
  /**
   * The database refused the count because the line moved on since the screen
   * read it (another phone, a second scan): says why, and reads it again.
   */
  onStale: (message: string) => void;
}) {
  const pending = pendingUnits(line);
  const [good, setGood] = useState(String(pending));
  const [damaged, setDamaged] = useState("0");
  const [locationId, setLocationId] = useState<string | null>(bins[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const receive = useApiMutation(
    (
      client,
      input: {
        inboundLineId: string;
        goodQuantity: number;
        damagedQuantity: number;
        locationId: string;
      },
    ) => client.wmsReceive(input),
    { invalidates: [["wms-board"]] },
  );
  const save = async () => {
    // More than is still to receive is refused here, with the reason, before
    // the database refuses it.
    const input = parseReceive({ good, damaged, locationId, pending });
    if ("error" in input) return setError(input.error);
    setError(null);
    try {
      await receive.mutateAsync({ inboundLineId: line.line_id, ...input });
      const bin = bins.find((candidate) => candidate.id === input.locationId)?.code ?? "";
      onReceived(
        `Recepción registrada: ${plural(input.goodQuantity, "buena", "buenas")}${
          input.damagedQuantity > 0
            ? ` y ${plural(input.damagedQuantity, "dañada", "dañadas")}`
            : ""
        } de ${product(line)}${input.goodQuantity > 0 && bin ? `, guardadas en ${bin}` : ""}.`,
      );
    } catch (failure) {
      // Someone else counted this line meanwhile (another phone, a second
      // scan): the database refused the count. The screen says so above the
      // lines, which are read again (this form may then close).
      if (
        failure instanceof ApiError &&
        ["over_receipt", "inbound_line_complete", "inbound_not_receivable"].includes(failure.code)
      ) {
        onStale(messageOf(failure));
        return;
      }
      setError(messageOf(failure));
    }
  };
  return (
    <Stack gap={3}>
      <View style={styles.pair}>
        <TextField
          label="Buenas"
          aria-label={`Unidades buenas de ${line.title}`}
          value={good}
          onChangeText={setGood}
          keyboardType="number-pad"
          inputMode="numeric"
          style={styles.half}
          testID="receive-good"
        />
        <TextField
          label="Dañadas"
          aria-label={`Unidades dañadas de ${line.title}`}
          value={damaged}
          onChangeText={setDamaged}
          keyboardType="number-pad"
          inputMode="numeric"
          style={styles.half}
          testID="receive-damaged"
        />
      </View>
      <Stack gap={2}>
        <Text variant="smallStrong">Guardar en</Text>
        <ChoiceList
          label="Guardar en"
          value={locationId}
          onChange={setLocationId}
          choices={bins.map((bin) => ({ value: bin.id, title: bin.code }))}
          testID="receive-bin"
        />
      </Stack>
      <FormMessage error={error} testID="receive-error" />
      <Button
        size="lg"
        block
        loading={receive.isPending}
        loadingLabel="Guardando…"
        testID="receive-submit"
        onPress={() => void save()}
      >
        Registrar recepción
      </Button>
    </Stack>
  );
}

/**
 * Receiving one shipment a seller announced: its expected lines, each counted
 * in as good or damaged and put in a bin. Scanning a product finds its line
 * (by the stock code, or through the barcode lookup), so the worker does not
 * have to search the list; the next line still to count is open by default.
 */
export default function ReceiveScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const inboundId = oneParam(params.id) ?? "";
  const api = useApi();
  const { warehouse } = useWarehouse();
  const board = useApiQuery(keys.board(warehouse.id), (client) => client.wmsBoard(warehouse.id), {
    personal: true,
  });
  const locations = useApiQuery(
    keys.locations(warehouse.id),
    (client) => client.wmsLocations(warehouse.id),
    { personal: true },
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const refusedNotice = refused ? (
    <Alert tone="warning" title="No se registró esa recepción" testID="receive-refused">
      {refused}
    </Alert>
  ) : null;

  if (board.isPending || locations.isPending) return <LoadingState label="Cargando el envío…" />;
  if (board.isError || locations.isError) {
    return (
      <ErrorState
        error={board.error ?? locations.error}
        onRetry={() => {
          void board.refetch();
          void locations.refetch();
        }}
      />
    );
  }
  const inbound = board.data.inbound.find((candidate) => candidate.inbound_id === inboundId);
  if (!inbound && lastResult) {
    // The last line was counted in: the shipment is closed and leaves the board.
    return (
      <Screen>
        {refusedNotice}
        <Alert tone="success" title="Envío recibido" testID="receive-result">
          {lastResult}
        </Alert>
        <Text tint="muted">Todas las líneas de este envío están completas.</Text>
        <LinkButton href="/" block>
          Volver a la bodega
        </LinkButton>
      </Screen>
    );
  }
  if (!inbound) {
    return (
      <EmptyState
        title="Ese envío ya no está por recibir"
        action={<LinkButton href="/">Volver a la bodega</LinkButton>}
      >
        {refused ?? "Puede que ya se haya recibido completo o que sea de otra bodega."}
      </EmptyState>
    );
  }

  const lines = inbound.lines ?? [];
  const open = lines.filter((line) => pendingUnits(line) > 0);
  const selected = open.find((line) => line.line_id === chosen) ?? open[0] ?? null;
  const bins = locations.data.filter(isPutawayBin).map(({ id, code }) => ({ id, code }));

  const onScan = async (code: string): Promise<ScanFeedback> => {
    let match = matchScan(code, null, open);
    let skuCode: string | null = null;
    if (match.kind === "none") {
      // A product barcode: ask which stock code it is (in each of its
      // spellings, as the lookup does), then look for that.
      const sku = await findByForms(code, (form) => api.wmsFindSku(warehouse.id, form));
      skuCode = sku?.sku_code ?? null;
      if (skuCode) match = matchScan(skuCode, null, open);
    }
    if (match.kind === "none") {
      const done = lines.find(
        (line) => matchScan(code, line).kind === "expected" || line.sku_code === skuCode,
      );
      return {
        tone: "danger",
        message: done
          ? "Esa línea ya está completa."
          : "Ese producto no viene en este envío. Revise la etiqueta o avise al encargado.",
      };
    }
    setChosen(match.line.line_id);
    return {
      tone: "success",
      message: `${product(match.line)}: ${plural(pendingUnits(match.line), "unidad", "unidades")} por recibir.`,
    };
  };

  return (
    <Screen refreshing={board.isRefetching} onRefresh={() => void board.refetch()}>
      <Nav.Screen options={{ title: inbound.reference }} />
      <Stack gap={1}>
        <Text variant="title" testID="inbound-title">
          {inbound.reference}
        </Text>
        <Text tint="muted">
          {inbound.seller_name}
          {inbound.expected_on ? ` · llega el ${formatDate(inbound.expected_on)}` : ""}
        </Text>
      </Stack>

      {refusedNotice}
      {lastResult ? (
        <Alert tone="success" testID="receive-result">
          {lastResult}
        </Alert>
      ) : null}

      {open.length > 0 ? (
        <Card>
          <BarcodeScanner
            // A fresh scanner after each count: its last answer is out of date.
            key={lastResult ?? "scan"}
            camera={camera}
            label="Escanee un producto del envío"
            hint="Le mostramos su línea para contarla."
            submitLabel="Buscar en el envío"
            submittingLabel="Buscando…"
            onScan={onScan}
            testID="receive-scan"
          />
        </Card>
      ) : (
        <Alert tone="success" title="Envío recibido">
          Todas las líneas están completas.
        </Alert>
      )}

      <Stack gap={3}>
        <Text variant="heading">Líneas ({plural(lines.length, "producto", "productos")})</Text>
        {lines.map((line) => {
          const pending = pendingUnits(line);
          const isSelected = selected?.line_id === line.line_id;
          return (
            <View
              key={line.line_id}
              style={[styles.line, isSelected ? styles.lineSelected : null]}
              testID={isSelected ? "receive-line-selected" : "receive-line"}
            >
              <View style={styles.lineHead}>
                <Text variant="bodyStrong" style={styles.fill}>
                  {product(line)}
                </Text>
                {pending === 0 ? <Badge tone="success">Completa</Badge> : null}
              </View>
              <Text variant="small" tint="muted">
                {line.sku_code} · esperadas {line.expected} · recibidas {line.received}
                {line.damaged > 0 ? ` · dañadas ${line.damaged}` : ""}
              </Text>
              {pending > 0 && isSelected ? (
                <ReceiveForm
                  key={`${line.line_id}:${pending}`}
                  line={line}
                  bins={bins}
                  onReceived={(message) => {
                    setRefused(null);
                    setLastResult(message);
                  }}
                  onStale={(message) => {
                    setRefused(message);
                    void board.refetch();
                  }}
                />
              ) : pending > 0 ? (
                <Button variant="secondary" onPress={() => setChosen(line.line_id)}>
                  Recibir esta línea
                </Button>
              ) : null}
            </View>
          );
        })}
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: "row", gap: space[3] },
  half: { flex: 1 },
  fill: { flex: 1 },
  line: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  lineSelected: { borderColor: colors.brand, borderWidth: 2 },
  lineHead: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
});
