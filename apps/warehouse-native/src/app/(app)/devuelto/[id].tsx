import { ApiError, type ReturnedShipmentResult } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import {
  Alert,
  Badge,
  Button,
  ChoiceList,
  EmptyState,
  ErrorState,
  FormMessage,
  formatPrice,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { Stack as Nav, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { plural } from "@/lib/floor";
import { keys, useWarehouse } from "@/lib/warehouse";

type Condition = "resellable" | "damaged";

/** What the worker is told once the parcel is checked in, as on the web's board. */
function checkedInText(condition: Condition, result: ReturnedShipmentResult): string {
  const where =
    condition === "resellable"
      ? "Guarde las unidades en la zona de devoluciones: ya cuentan de nuevo en el inventario."
      : "Quedó registrado como dañado y no vuelve a la venta. Apártelo para revisión.";
  const refund =
    result.refund_minor > 0
      ? ` Al cliente se le devuelven ${formatPrice(result.refund_minor)}.`
      : "";
  return `${where}${refund}`;
}

/**
 * A parcel that came back without being delivered (Central sent it back
 * after a failed delivery), checked in at the dock: its units go back on the
 * shelf or are recorded as damaged, and the shopper gets back what they paid
 * for them. The worker chooses the condition; nothing is chosen for them.
 */
export default function ReturnedParcelScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const shipmentId = oneParam(params.id) ?? "";
  const { warehouse } = useWarehouse();
  const returning = useApiQuery(
    keys.returning(warehouse.id),
    (api) => api.wmsReturningShipments(warehouse.id),
    { personal: true },
  );
  const [condition, setCondition] = useState<Condition | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const checkIn = useApiMutation(
    (api, input: { condition: Condition; note: string | null }) =>
      api.wmsReceiveReturnedShipment(shipmentId, input.condition === "resellable", input.note),
    { invalidates: [["wms-returning"], ["wms-board"]] },
  );

  if (done) {
    return (
      <Screen>
        <Nav.Screen options={{ title: "Paquete devuelto" }} />
        <Alert tone="success" title="Paquete devuelto recibido" testID="returned-result">
          {done}
        </Alert>
        <LinkButton href="/" block>
          Volver a la bodega
        </LinkButton>
      </Screen>
    );
  }
  if (returning.isPending) return <LoadingState label="Cargando el paquete…" />;
  if (returning.isError) {
    return <ErrorState error={returning.error} onRetry={() => void returning.refetch()} />;
  }
  const parcel = returning.data.find((candidate) => candidate.shipment_id === shipmentId);
  if (!parcel) {
    return (
      <EmptyState
        title="Ese paquete ya no está por recibir"
        action={<LinkButton href="/">Volver a la bodega</LinkButton>}
      >
        {error ?? "Puede que alguien ya lo haya recibido o que vuelva a otra bodega."}
      </EmptyState>
    );
  }

  const submit = async () => {
    if (!condition) {
      setError("Indique en qué estado llegó el paquete.");
      return;
    }
    setError(null);
    try {
      const result = await checkIn.mutateAsync({ condition, note: note.trim() || null });
      setDone(checkedInText(condition, result));
    } catch (failure) {
      setError(messageOf(failure));
      // Someone else checked it in, or it is not on its way back any more.
      if (failure instanceof ApiError) void returning.refetch();
    }
  };

  return (
    <Screen>
      <Nav.Screen options={{ title: parcel.tracking_code }} />
      <Stack gap={1}>
        <Text variant="title" testID="returned-title">
          {parcel.tracking_code}
        </Text>
        <Badge tone="warning">De vuelta</Badge>
        <Text tint="muted">
          {`${plural(parcel.units, "unidad", "unidades")} en ${plural(
            parcel.lines,
            "línea",
            "líneas",
          )} · pedido ${parcel.order_number} · ${plural(
            parcel.attempt_count,
            "intento de entrega",
            "intentos de entrega",
          )}`}
        </Text>
      </Stack>
      <Stack gap={2}>
        <Text variant="smallStrong">¿Cómo llegó el paquete?</Text>
        <ChoiceList
          label="¿Cómo llegó el paquete?"
          value={condition}
          onChange={setCondition}
          choices={[
            { value: "resellable", title: "En buen estado: vuelve a la venta" },
            { value: "damaged", title: "Dañado: no se vuelve a vender" },
          ]}
          testID="returned-condition"
        />
      </Stack>
      <TextField
        label="Nota"
        optional
        value={note}
        onChangeText={setNote}
        hint="Por ejemplo, si la caja venía abierta."
        testID="returned-note"
      />
      <FormMessage error={error} testID="returned-error" />
      <Button
        size="lg"
        block
        loading={checkIn.isPending}
        loadingLabel="Recibiendo…"
        onPress={() => void submit()}
        testID="returned-submit"
      >
        Recibir el paquete devuelto
      </Button>
    </Screen>
  );
}
