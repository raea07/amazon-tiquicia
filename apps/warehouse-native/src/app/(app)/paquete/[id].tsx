import { ApiError, type WmsShipment } from "@yuntera/db";
import { messageOf, useApi } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import {
  BarcodeScanner,
  type BarcodeScannerHandle,
  createNumberFieldGuard,
  matchScan,
  type ScanFeedback,
} from "@yuntera/expo-kit/scanner";
import { colors, fontFamily, radius, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
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
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { KeepAwake } from "@/components/keep-awake";
import { camera } from "@/lib/camera";
import { nextTask, parsePack, parsePicked, pendingTasks, pickProgress } from "@/lib/floor";
import { keys } from "@/lib/warehouse";

type Task = WmsShipment["tasks"][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRONG_PRODUCT = "Ese código no es el de este producto. Revise que tomó el correcto.";

const product = (task: Task) =>
  `${task.title}${task.variant_name ? ` (${task.variant_name})` : ""}`;
const codes = (task: Task) =>
  `${task.sku_code}${task.gtin ? ` · ${task.gtin}` : ""}${
    task.picked_quantity > 0 && task.status !== "done" ? ` · tomadas ${task.picked_quantity}` : ""
  }`;

function TaskBadge({ task, current }: { task: Task; current: boolean }) {
  if (task.status === "done") return <Badge tone="success">Listo</Badge>;
  if (task.status === "short") return <Badge tone="danger">Faltante</Badge>;
  return current ? <Badge tone="info">Siguiente</Badge> : <Badge>Pendiente</Badge>;
}

/**
 * The line to pick now, large: where to go, how many, what. The worker scans
 * the product (camera, typing or a hand scanner) and says how many were
 * taken. The code is checked against the line before anything is sent, and the
 * database checks it again, so the wrong product cannot be confirmed by
 * accident (nor by a phone that skipped the check); a line can be confirmed with
 * fewer units (even 0) without a scan, which marks it short, as on the web.
 */
function CurrentLine({
  shipment,
  task,
  position,
  onConfirmed,
}: {
  shipment: WmsShipment;
  task: Task;
  position: number;
  onConfirmed: (message: string) => void;
}) {
  const api = useApi();
  // The quantity belongs to the line it was typed for: a new line starts at what it asks.
  const [typed, setTyped] = useState({ taskId: task.task_id, text: String(task.quantity) });
  const quantityText = typed.taskId === task.task_id ? typed.text : String(task.quantity);
  // Read when a scan is handled, which can be in the same moment it was typed.
  const quantityRef = useRef(typed);
  const setQuantity = (text: string) => {
    quantityRef.current = { taskId: task.task_id, text };
    setTyped(quantityRef.current);
  };
  const scanner = useRef<BarcodeScannerHandle>(null);
  // A hand scanner types into whatever has focus, "Tomó" included: its code goes back to the scan field.
  const guard = useRef(createNumberFieldGuard()).current;
  useEffect(() => {
    guard.reset(String(task.quantity));
  }, [guard, task.quantity]);
  const confirm = useApiMutation(
    (
      client,
      input: { taskId: string; quantity: number; locationId: string | null; code: string | null },
    ) => client.wmsConfirmPick(input.taskId, input.quantity, input.locationId, input.code),
    { invalidates: [keys.shipment(shipment.shipment_id), ["wms-board"]] },
  );
  const remaining = task.quantity - task.picked_quantity;

  const onScan = async (code: string): Promise<ScanFeedback> => {
    const typedNow = quantityRef.current;
    const text = typedNow.taskId === task.task_id ? typedNow.text : String(task.quantity);
    const picked = parsePicked(text, task.quantity);
    // The product was not checked yet: the code stays in the field while the number is fixed.
    if ("error" in picked) return { tone: "danger", message: picked.error, keepCode: true };
    // The line is read again first: someone in Central may have changed the parcel.
    const latest = await api.wmsShipment(shipment.shipment_id);
    const line = latest.tasks.find((candidate) => candidate.task_id === task.task_id);
    if (!line) {
      return {
        tone: "danger",
        message: "Esa línea ya no está en este paquete. Actualice la pantalla.",
      };
    }
    if (picked.quantity > 0) {
      const match = matchScan(code, line, pendingTasks(latest.tasks));
      if (match.kind === "other") {
        return {
          tone: "danger",
          title: "Es de otra línea",
          message: `${WRONG_PRODUCT} Ese código es de la línea de ${
            match.line.location_code ?? "otra ubicación"
          }: termine primero esta o tóquela en la lista.`,
        };
      }
      if (match.kind === "none") return { tone: "danger", message: WRONG_PRODUCT };
    }
    try {
      // What was scanned goes with the pick: the database compares it with the
      // product's own codes too, and refuses another product's.
      await confirm.mutateAsync({
        taskId: line.task_id,
        quantity: picked.quantity,
        locationId: line.location_id,
        code: code || null,
      });
    } catch (error) {
      return { tone: "danger", message: messageOf(error) };
    }
    const short = picked.quantity < line.quantity;
    const message = short
      ? `Línea confirmada con ${picked.quantity} de ${line.quantity} (${product(line)}): queda como faltante.`
      : `Línea confirmada: ${line.quantity} × ${product(line)}.`;
    onConfirmed(message);
    return { tone: short ? "warning" : "success", message };
  };

  return (
    <Card style={styles.current} testID="pick-current">
      <Text variant="smallStrong" tint="link">
        Siguiente · línea {position} de {shipment.tasks.length}
      </Text>
      <Text style={styles.location} testID="pick-location">
        {task.location_code ?? "Sin ubicación"}
      </Text>
      <Text variant="subheading">
        <Text style={styles.quantity}>{task.quantity} × </Text>
        {product(task)}
      </Text>
      <Text variant="small" tint="muted" testID="pick-codes">
        {codes(task)}
      </Text>
      <BarcodeScanner
        ref={scanner}
        camera={camera}
        label="Escanee el producto"
        submitLabel={remaining === task.quantity ? "Confirmar línea" : "Corregir cantidad"}
        submittingLabel="Confirmando…"
        requireCode={quantityText.trim() !== "0"}
        onScan={onScan}
        testID="pick"
      >
        <TextField
          label="Tomó"
          value={quantityText}
          onChangeText={(text) => {
            const result = guard.change(text);
            setQuantity(result.value);
            if (result.scan) scanner.current?.fill(result.scan);
          }}
          onSubmitEditing={() => {
            // Enter after the number: back to the scan field, or the scan that was typed here.
            const result = guard.enter();
            setQuantity(result.value);
            if (result.scan) scanner.current?.submit(result.scan);
            else scanner.current?.focus();
          }}
          submitBehavior="submit"
          returnKeyType="next"
          keyboardType="number-pad"
          inputMode="numeric"
          testID="pick-quantity"
        />
      </BarcodeScanner>
      <Text variant="small" tint="muted">
        Si no hay suficientes en la ubicación, escriba cuántas tomó (puede ser 0). La línea queda
        como faltante y Central la resuelve.
      </Text>
    </Card>
  );
}

function PackForm({ shipment }: { shipment: WmsShipment }) {
  const [weight, setWeight] = useState(String(shipment.expected_weight_grams));
  const [packages, setPackages] = useState("1");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const pack = useApiMutation(
    (client, input: { weightGrams: number; packageCount: number }) =>
      client.wmsPackShipment(shipment.shipment_id, input.weightGrams, input.packageCount),
    { invalidates: [keys.shipment(shipment.shipment_id), ["wms-board"]] },
  );
  if (result.ok) return <FormMessage ok={result.ok} />;
  return (
    <Stack gap={3}>
      <View style={styles.pair}>
        <TextField
          label="Peso real (gramos)"
          value={weight}
          onChangeText={setWeight}
          keyboardType="number-pad"
          inputMode="numeric"
          hint={`Esperado: ${shipment.expected_weight_grams} g`}
          style={styles.half}
          testID="pack-weight"
        />
        <TextField
          label="Bultos"
          value={packages}
          onChangeText={setPackages}
          keyboardType="number-pad"
          inputMode="numeric"
          style={styles.half}
          testID="pack-count"
        />
      </View>
      <FormMessage error={result.error} />
      <Button
        size="lg"
        block
        loading={pack.isPending}
        loadingLabel="Guardando…"
        testID="pack-submit"
        onPress={async () => {
          const input = parsePack(weight, packages);
          if ("error" in input) return setResult({ error: input.error });
          try {
            await pack.mutateAsync(input);
            setResult({ ok: "Empacado. Llévelo a la zona de despacho." });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Empacado
      </Button>
    </Stack>
  );
}

function StartPicking({ shipmentId }: { shipmentId: string }) {
  const [error, setError] = useState<string | null>(null);
  const start = useApiMutation((client, id: string) => client.wmsStartPicking(id), {
    invalidates: [keys.shipment(shipmentId), ["wms-board"]],
  });
  return (
    <Stack gap={3}>
      <Button
        size="lg"
        block
        loading={start.isPending}
        loadingLabel="Empezando…"
        testID="start-picking"
        onPress={async () => {
          try {
            setError(null);
            await start.mutateAsync(shipmentId);
          } catch (failure) {
            setError(messageOf(failure));
          }
        }}
      >
        Empezar a alistar
      </Button>
      <FormMessage error={error} />
    </Stack>
  );
}

/** "1 de 3 líneas listas", with a bar: always on screen, under the thumb. */
function Progress({ done, total }: { done: number; total: number }) {
  return (
    <View
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label="Líneas listas"
      style={styles.progress}
      testID="pick-progress"
    >
      <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
        {done} de {total} {total === 1 ? "línea lista" : "líneas listas"}
      </Text>
      <View style={styles.track}>
        <View style={[styles.bar, { width: `${total ? (done / total) * 100 : 0}%` }]} />
      </View>
    </View>
  );
}

/**
 * One parcel's pick list, as the web's /bodega/paquete/<id>: start picking,
 * confirm each line by scanning, then pack. Lines come in the order of the
 * walk through the warehouse; the next one is always at the top, and the
 * count of lines done stays at the bottom of the screen. The screen stays on
 * while the list is open.
 */
export default function ShipmentScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const shipmentId = oneParam(params.id) ?? "";
  // Anything that is not an id cannot be a parcel: not found, without asking.
  const valid = UUID.test(shipmentId);
  const shipment = useApiQuery(keys.shipment(shipmentId), (api) => api.wmsShipment(shipmentId), {
    personal: true,
    enabled: valid,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);

  const notFound =
    !valid ||
    (shipment.error instanceof ApiError &&
      (shipment.error.code === "shipment_not_found" || shipment.error.code === "forbidden"));
  if (notFound) {
    return (
      <EmptyState
        title="No encontramos ese paquete"
        action={<LinkButton href="/">Volver a la bodega</LinkButton>}
      >
        Revise que sea de la bodega en la que está trabajando.
      </EmptyState>
    );
  }
  if (shipment.isPending) return <LoadingState label="Cargando el paquete…" />;
  if (shipment.isError) {
    return <ErrorState error={shipment.error} onRetry={() => void shipment.refetch()} />;
  }

  const s = shipment.data;
  const progress = pickProgress(s.tasks);
  const picking = s.status === "picking";
  const current = picking ? nextTask(s.tasks, chosen) : null;

  return (
    <Screen
      refreshing={shipment.isRefetching}
      onRefresh={() => void shipment.refetch()}
      footer={<Progress done={progress.done} total={progress.total} />}
    >
      <Nav.Screen options={{ title: s.tracking_code }} />
      <KeepAwake tag={`pick-${s.shipment_id}`} />
      <Stack gap={1}>
        <Text variant="title" testID="shipment-title">
          {s.tracking_code}
        </Text>
        <Text tint="muted">
          Pedido {s.order_number} · sale a más tardar el {formatDate(s.promise_latest)}
        </Text>
      </Stack>

      {s.status === "pending" ? <StartPicking shipmentId={s.shipment_id} /> : null}

      {s.status === "packed" || s.status === "ready_for_dispatch" ? (
        <Alert tone="success" title="Empacado" testID="packed">
          {`${s.package_count} ${s.package_count === 1 ? "bulto" : "bultos"}${
            s.weight_grams ? ` · ${s.weight_grams} g` : ""
          }. Debe estar en la zona de despacho con el código ${s.tracking_code} visible.`}
        </Alert>
      ) : null}

      {picking && lastDone && !current ? (
        <Alert tone="success" testID="pick-last">
          {lastDone}
        </Alert>
      ) : null}

      {current ? (
        <CurrentLine
          shipment={s}
          task={current}
          position={s.tasks.indexOf(current) + 1}
          onConfirmed={setLastDone}
        />
      ) : null}

      {picking ? (
        <Card style={styles.pack} testID="pack">
          <Text variant="heading">Empacar</Text>
          {progress.allPicked ? (
            <PackForm shipment={s} />
          ) : (
            <Text variant="small" tint="muted">
              {progress.short
                ? "Hay una línea con faltante. Avise a Central antes de empacar."
                : "Confirme todas las líneas para poder empacar."}
            </Text>
          )}
        </Card>
      ) : null}

      <Stack gap={3}>
        <Stack gap={1}>
          <Text variant="heading">
            Líneas ({progress.done} de {progress.total})
          </Text>
          <Text variant="small" tint="muted">
            En el orden del recorrido por la bodega.
          </Text>
        </Stack>
        {s.tasks.map((task, index) => {
          const isCurrent = current?.task_id === task.task_id;
          const choosable = picking && task.status !== "done" && !isCurrent;
          const body = (
            <>
              <View style={styles.lineHead}>
                <Text style={styles.lineLocation}>{task.location_code ?? "Sin ubicación"}</Text>
                <TaskBadge task={task} current={isCurrent} />
              </View>
              <Text>
                <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
                  {task.quantity} ×{" "}
                </Text>
                {product(task)}
              </Text>
              <Text variant="small" tint="muted">
                {codes(task)}
              </Text>
              {choosable ? (
                <Text variant="smallStrong" tint="link">
                  Alistar esta línea
                </Text>
              ) : null}
            </>
          );
          return choosable ? (
            <Pressable
              key={task.task_id}
              role="button"
              aria-label={`Alistar la línea ${index + 1}: ${task.location_code ?? "sin ubicación"}, ${product(task)}`}
              onPress={() => setChosen(task.task_id)}
              style={({ pressed }) => [
                styles.line,
                pressed ? { backgroundColor: colors.surfaceMuted } : null,
              ]}
              testID="pick-line"
            >
              {body}
            </Pressable>
          ) : (
            <View
              key={task.task_id}
              style={[
                styles.line,
                isCurrent ? styles.lineCurrent : null,
                task.status === "done" ? styles.lineDone : null,
              ]}
              testID="pick-line"
            >
              {body}
            </View>
          );
        })}
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  current: { borderWidth: 2, borderColor: colors.brand },
  location: {
    fontFamily: fontFamily.display,
    fontWeight: "800",
    fontSize: 36,
    lineHeight: 42,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  quantity: { fontFamily: fontFamily.display, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pack: { borderWidth: 2, borderColor: colors.brand },
  pair: { flexDirection: "row", gap: space[3] },
  half: { flex: 1 },
  line: {
    minHeight: 56,
    gap: space[1],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
  },
  lineCurrent: { borderColor: colors.brand, borderWidth: 2 },
  lineDone: { borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  lineHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
  },
  lineLocation: {
    fontFamily: fontFamily.display,
    fontWeight: "700",
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
  },
  progress: { gap: space[2] },
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  bar: { height: 8, backgroundColor: colors.brand },
});
