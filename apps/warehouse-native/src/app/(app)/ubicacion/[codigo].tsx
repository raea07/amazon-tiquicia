import { ApiError, type WmsLocationItem, type WmsLocationStock } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import { colors, fontFamily, radius, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  ChoiceList,
  EmptyState,
  ErrorState,
  FormMessage,
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
import { plural } from "@/lib/floor";
import { countedText, differenceText, movedText, parseCount, parseMove } from "@/lib/stock";
import { LOCATION_KIND } from "@/lib/stock-labels";
import { keys, useWarehouse } from "@/lib/warehouse";

type Shelf = { id: string; code: string };

const product = (item: WmsLocationItem) =>
  `${item.title}${item.variant_name ? ` (${item.variant_name})` : ""}`;

/** What reads must be fetched again after a move or a count, here and elsewhere. */
const AFTER = [["wms-location"], ["wms-stock-locations"], ["wms-sku"]];

function MoveForm({
  location,
  item,
  targets,
  onDone,
  onRefused,
}: {
  location: Shelf;
  item: WmsLocationItem;
  targets: Shelf[];
  onDone: (message: string) => void;
  onRefused: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [picked, setTarget] = useState<string | null>(null);
  // A shelf chosen before it was switched off (the list is read again after
  // a refusal) is no longer offered: nothing stays chosen.
  const target = picked && targets.some((shelf) => shelf.id === picked) ? picked : null;
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const move = useApiMutation(
    (api, input: { toLocationId: string; quantity: number; note: string | null }) =>
      api.wmsMoveStock({
        fromLocationId: location.id,
        skuId: item.sku_id,
        sellerId: item.seller_id,
        ...input,
      }),
    { invalidates: AFTER },
  );
  if (targets.length === 0) {
    return (
      <Text tint="muted">
        No hay otro estante activo en esta bodega adonde moverlo. Pida a operaciones que active o
        cree uno.
      </Text>
    );
  }
  const save = async () => {
    const input = parseMove({ quantity, toLocationId: target, free: item.free });
    if ("error" in input) return setError(input.error);
    setError(null);
    try {
      const moved = await move.mutateAsync({ ...input, note: note.trim() || null });
      onDone(movedText(moved.quantity, moved.to.code));
    } catch (failure) {
      // What the database said, with what was typed kept; the location is
      // read again (the shelf changed, the target was switched off).
      setError(messageOf(failure));
      if (failure instanceof ApiError) onRefused();
    }
  };
  return (
    <Stack gap={3}>
      <TextField
        label="Unidades"
        aria-label={`Unidades a mover de ${product(item)}`}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="number-pad"
        inputMode="numeric"
        hint={`Libres: ${item.free}`}
        testID="move-quantity"
      />
      <Stack gap={2}>
        <Text variant="smallStrong">Mover a</Text>
        <ChoiceList
          label={`Mover ${product(item)} a`}
          value={target}
          onChange={setTarget}
          choices={targets.map((shelf) => ({ value: shelf.id, title: shelf.code }))}
          testID="move-target"
        />
      </Stack>
      <TextField
        label="Nota"
        optional
        value={note}
        onChangeText={setNote}
        hint="Por ejemplo, «para vaciar el estante»."
        testID="move-note"
      />
      <FormMessage error={error} testID="move-error" />
      <Button
        variant="secondary"
        block
        loading={move.isPending}
        loadingLabel="Moviendo…"
        onPress={() => void save()}
        testID="move-submit"
      >
        Mover las unidades
      </Button>
    </Stack>
  );
}

function CountForm({
  location,
  item,
  onDone,
  onRefused,
}: {
  location: Shelf;
  item: WmsLocationItem;
  onDone: (message: string) => void;
  onRefused: () => void;
}) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const correct = useApiMutation(
    (api, input: { delta: number; note: string; expected: number }) =>
      api.wmsAdjustStock({
        locationId: location.id,
        skuId: item.sku_id,
        sellerId: item.seller_id,
        ...input,
      }),
    { invalidates: AFTER },
  );
  const save = async () => {
    const input = parseCount({ counted, note, expected: item.on_shelf });
    if ("error" in input) return setError(input.error);
    setError(null);
    try {
      await correct.mutateAsync({ delta: input.delta, note: input.note, expected: item.on_shelf });
      onDone(countedText(input.counted, input.delta));
    } catch (failure) {
      // A shelf that changed meanwhile: its new number is read, the count kept.
      setError(messageOf(failure));
      if (failure instanceof ApiError) onRefused();
    }
  };
  return (
    <Stack gap={3}>
      <TextField
        label="Unidades que contó en el estante"
        aria-label={`Unidades que contó de ${product(item)}`}
        value={counted}
        onChangeText={setCounted}
        keyboardType="number-pad"
        inputMode="numeric"
        hint={
          item.promised > 0
            ? `Registradas: ${item.on_shelf}. No puede dejar menos de ${item.promised}: esas unidades esperan a pedidos.`
            : `Registradas: ${item.on_shelf}.`
        }
        testID="count-quantity"
      />
      <Text aria-live="polite" testID="count-difference">
        {differenceText(counted, item.on_shelf)}
      </Text>
      <TextField
        label="Motivo"
        value={note}
        onChangeText={setNote}
        hint="Al menos 5 letras. La tienda ve este motivo en su historial de inventario."
        testID="count-note"
      />
      <FormMessage error={error} testID="count-error" />
      <Button
        variant="secondary"
        block
        loading={correct.isPending}
        loadingLabel="Corrigiendo…"
        onPress={() => void save()}
        testID="count-submit"
      >
        Corregir la cantidad
      </Button>
    </Stack>
  );
}

function Item({
  location,
  item,
  targets,
  onDone,
  onRefused,
}: {
  location: WmsLocationStock;
  item: WmsLocationItem;
  targets: Shelf[];
  onDone: (message: string) => void;
  onRefused: () => void;
}) {
  const [open, setOpen] = useState<"move" | "count" | null>(null);
  const finished = (message: string) => {
    setOpen(null);
    onDone(message);
  };
  const shelf = { id: location.id, code: location.code };
  return (
    <View style={styles.item} testID={`item-${item.sku_code}`}>
      <Stack gap={1}>
        <Text variant="bodyStrong">{product(item)}</Text>
        <Text variant="small" tint="muted">
          {item.sku_code} · de {item.seller_name}
        </Text>
      </Stack>
      <View style={styles.numbers}>
        <Figure label="En el estante" value={item.on_shelf} />
        <Figure label="Esperan pedidos" value={item.promised} />
        <Figure label="Libres" value={item.free} />
      </View>
      {item.picked_waiting > 0 ? (
        <Text variant="caption" tint="muted">
          {plural(item.picked_waiting, "unidad ya alistada", "unidades ya alistadas")} en paquetes
          que aún no se empacan.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          variant={open === "move" ? "primary" : "secondary"}
          onPress={() => setOpen(open === "move" ? null : "move")}
          aria-expanded={open === "move"}
          testID="open-move"
          style={styles.action}
        >
          Mover
        </Button>
        <Button
          variant={open === "count" ? "primary" : "secondary"}
          onPress={() => setOpen(open === "count" ? null : "count")}
          aria-expanded={open === "count"}
          testID="open-count"
          style={styles.action}
        >
          Corregir cantidad
        </Button>
      </View>
      {open === "move" ? (
        item.free === 0 ? (
          <Text tint="muted">
            No hay unidades libres para mover: todas esperan a pedidos que se están alistando.
          </Text>
        ) : (
          <MoveForm
            location={shelf}
            item={item}
            targets={targets}
            onDone={finished}
            onRefused={onRefused}
          />
        )
      ) : null}
      {open === "count" ? (
        <CountForm location={shelf} item={item} onDone={finished} onRefused={onRefused} />
      ) : null}
    </View>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.number}>
      <Text variant="caption" tint="muted" style={styles.centered}>
        {label}
      </Text>
      <Text style={[styles.numberValue, styles.centered]}>{value}</Text>
    </View>
  );
}

/**
 * One location, as the web's /bodega/ubicacion: each product in it with the
 * shop that owns the units, how many are on the shelf, how many open picks
 * wait for and how many are free; a move to another shelf and a count
 * correction for each. Both are saved at once on the server, so they need
 * signal; the screen says so.
 */
export default function LocationScreen() {
  const params = useLocalSearchParams<{ codigo: string }>();
  const code = (oneParam(params.codigo) ?? "").trim().toUpperCase().slice(0, 40);
  const { warehouse } = useWarehouse();
  const location = useApiQuery(
    keys.location(warehouse.id, code),
    (api) => api.wmsLocationStock(warehouse.id, code),
    { personal: true },
  );
  const all = useApiQuery(
    keys.stockLocations(warehouse.id),
    (api) => api.wmsStockLocations(warehouse.id),
    { personal: true },
  );
  const [done, setDone] = useState<string | null>(null);

  if (location.isPending || all.isPending) return <LoadingState label="Cargando la ubicación…" />;
  if (location.isError || all.isError) {
    return (
      <ErrorState
        error={location.error ?? all.error}
        onRetry={() => {
          void location.refetch();
          void all.refetch();
        }}
      />
    );
  }
  const here = location.data;
  if (!here) {
    return (
      <EmptyState
        title="No encontramos esa ubicación"
        action={<LinkButton href="/ubicaciones">Ver las ubicaciones</LinkButton>}
      >
        {`En ${warehouse.name} no hay ninguna ubicación con el código “${code}”. Revise la etiqueta.`}
      </EmptyState>
    );
  }
  const targets = all.data
    .filter((other) => other.shelf && other.active && other.id !== here.id)
    .map(({ id, code: shelf }) => ({ id, code: shelf }));

  return (
    <Screen
      refreshing={location.isRefetching}
      onRefresh={() => {
        void location.refetch();
        void all.refetch();
      }}
    >
      <Nav.Screen options={{ title: here.code }} />
      <Stack gap={1}>
        <Text tint="muted">
          {here.warehouse.name} · {LOCATION_KIND[here.kind]}
        </Text>
        <View style={styles.head}>
          <Text variant="title" testID="location-title">
            {here.code}
          </Text>
          <Badge tone={here.active ? "success" : "warning"}>
            {here.active ? "Activa" : "Desactivada"}
          </Badge>
        </View>
        <Text tint="muted" testID="location-summary">
          {here.units === 0
            ? "Está vacía."
            : `${plural(here.units, "unidad", "unidades")} en el estante · ${here.promised} ${here.promised === 1 ? "espera" : "esperan"} a pedidos · ${here.free} libres.`}
        </Text>
      </Stack>
      {done ? (
        <Alert tone="success" testID="stock-result">
          {done}
        </Alert>
      ) : null}
      {here.active ? null : (
        <Alert tone="warning" title="Ubicación desactivada">
          Ya no se guarda mercadería aquí. Mueva lo que queda a un estante activo.
        </Alert>
      )}
      <Text variant="caption" tint="muted">
        Mover y corregir necesitan señal: se guardan en el servidor al momento. Sin señal no se
        guarda nada y la pantalla se lo dice.
      </Text>
      {here.items.length === 0 ? (
        <Card>
          <Text>No hay productos en esta ubicación.</Text>
        </Card>
      ) : (
        <Stack gap={3}>
          {here.items.map((item) => (
            <Item
              key={`${item.sku_id}:${item.seller_id}`}
              location={here}
              item={item}
              targets={targets}
              onDone={setDone}
              onRefused={() => {
                // An earlier move's or count's answer is not left next to this refusal.
                setDone(null);
                void location.refetch();
                void all.refetch();
              }}
            />
          ))}
        </Stack>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  item: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  numbers: { flexDirection: "row", gap: space[2] },
  number: {
    flex: 1,
    alignItems: "center",
    padding: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  numberValue: {
    fontFamily: fontFamily.display,
    fontWeight: "700",
    fontSize: 22,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  centered: { textAlign: "center", alignSelf: "stretch" },
  actions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  action: { flexGrow: 1 },
});
