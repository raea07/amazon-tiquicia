import { SignOutButton, useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import {
  Badge,
  ChoiceList,
  ErrorState,
  formatDate,
  LinkButton,
  LoadingState,
  Logo,
  Screen,
  SearchIcon,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { StyleSheet, View } from "react-native";
import { FloorRow } from "@/components/floor-row";
import { isToDo, pendingUnits, plural, STEP, sortBoard } from "@/lib/floor";
import { keys, useWarehouse } from "@/lib/warehouse";

/**
 * The board: everything on the floor of the worker's warehouse now, as on
 * the web's /bodega. Parcels to pick (in picking first), packed ones, parcels
 * on their way back after a failed delivery, and the stock sellers have
 * announced, each opening its own screen. Someone assigned
 * to several warehouses chooses which one they are in.
 */
export default function BoardScreen() {
  const { viewer } = useSession();
  const { warehouse, warehouses, choose } = useWarehouse();
  const board = useApiQuery(keys.board(warehouse.id), (api) => api.wmsBoard(warehouse.id), {
    personal: true,
  });
  const returning = useApiQuery(
    keys.returning(warehouse.id),
    (api) => api.wmsReturningShipments(warehouse.id),
    { personal: true },
  );

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      refreshing={board.isRefetching || returning.isRefetching}
      onRefresh={() => {
        void board.refetch();
        void returning.refetch();
      }}
    >
      <View style={styles.top}>
        <Logo app="warehouse" size={30} />
      </View>
      <Stack gap={1}>
        <Text tint="muted">
          Hola{viewer?.name ? `, ${viewer.name.split(" ")[0]}` : ""} · {warehouse.code}
        </Text>
        <Text variant="title">{warehouse.name}</Text>
      </Stack>
      {warehouses.length > 1 ? (
        <Stack gap={2}>
          <Text variant="smallStrong">Bodega en la que trabaja</Text>
          <ChoiceList
            label="Bodega en la que trabaja"
            value={warehouse.id}
            onChange={choose}
            choices={warehouses.map((w) => ({ value: w.id, title: w.name, description: w.code }))}
            testID="warehouse-choice"
          />
        </Stack>
      ) : null}
      <LinkButton
        href="/buscar"
        variant="secondary"
        block
        icon={<SearchIcon size={20} color={colors.ink} />}
        testID="open-lookup"
      >
        Buscar un producto
      </LinkButton>

      {board.isPending ? (
        <LoadingState label="Cargando el trabajo de la bodega…" />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : (
        <View style={styles.sections} testID="warehouse-board">
          <Stack gap={3}>
            <Text variant="heading">
              Pedidos ({board.data.shipments.filter(isToDo).length} por hacer)
            </Text>
            {board.data.shipments.length === 0 ? (
              <Text tint="muted">No hay pedidos en el piso ahora.</Text>
            ) : (
              <View style={styles.list}>
                {sortBoard(board.data.shipments).map((shipment) => {
                  const step = STEP[shipment.status];
                  return (
                    <FloorRow
                      key={shipment.shipment_id}
                      href={{ pathname: "/paquete/[id]", params: { id: shipment.shipment_id } }}
                      title={shipment.tracking_code}
                      details={`${plural(shipment.units, "unidad", "unidades")} en ${plural(
                        shipment.lines,
                        "línea",
                        "líneas",
                      )} · pedido ${shipment.order_number} · sale a más tardar el ${formatDate(
                        shipment.promise_latest,
                        { weekday: "short", day: "numeric", month: "short" },
                      )}`}
                      badges={
                        <>
                          {shipment.short ? <Badge tone="danger">Faltante</Badge> : null}
                          <Badge tone={step?.tone ?? "neutral"}>
                            {step?.label ?? shipment.status}
                          </Badge>
                        </>
                      }
                      testID={`shipment-${shipment.status}`}
                    />
                  );
                })}
              </View>
            )}
          </Stack>

          <Stack gap={3}>
            <Text variant="heading" testID="returning-heading">
              Paquetes devueltos por recibir
              {returning.data ? ` (${returning.data.length})` : ""}
            </Text>
            {returning.isError ? (
              <ErrorState error={returning.error} onRetry={() => void returning.refetch()} />
            ) : !returning.data ? (
              <LoadingState label="Cargando los paquetes devueltos…" />
            ) : returning.data.length === 0 ? (
              <Text tint="muted">Ningún paquete viene de vuelta.</Text>
            ) : (
              <View style={styles.list}>
                {returning.data.map((parcel) => (
                  <FloorRow
                    key={parcel.shipment_id}
                    href={{ pathname: "/devuelto/[id]", params: { id: parcel.shipment_id } }}
                    title={parcel.tracking_code}
                    details={`${plural(parcel.units, "unidad", "unidades")} en ${plural(
                      parcel.lines,
                      "línea",
                      "líneas",
                    )} · pedido ${parcel.order_number} · ${plural(
                      parcel.attempt_count,
                      "intento de entrega",
                      "intentos de entrega",
                    )}`}
                    badges={<Badge tone="warning">De vuelta</Badge>}
                    testID="returned-row"
                  />
                ))}
              </View>
            )}
          </Stack>

          <Stack gap={3}>
            <Text variant="heading">Mercadería por recibir ({board.data.inbound.length})</Text>
            {board.data.inbound.length === 0 ? (
              <Text tint="muted">Ningún vendedor ha anunciado envíos.</Text>
            ) : (
              <View style={styles.list}>
                {board.data.inbound.map((inbound) => {
                  const lines = inbound.lines ?? [];
                  const open = lines.filter((line) => pendingUnits(line) > 0).length;
                  return (
                    <FloorRow
                      key={inbound.inbound_id}
                      href={{ pathname: "/recibir/[id]", params: { id: inbound.inbound_id } }}
                      title={inbound.reference}
                      details={[
                        inbound.seller_name,
                        inbound.expected_on ? `llega el ${formatDate(inbound.expected_on)}` : null,
                        open > 0
                          ? `${plural(open, "línea", "líneas")} por recibir`
                          : "Todas las líneas recibidas",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      testID="inbound-row"
                    />
                  );
                })}
              </View>
            )}
          </Stack>
        </View>
      )}

      <SignOutButton />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center" },
  sections: { gap: space[8] },
  list: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    gap: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});
