import { useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import {
  Button,
  Card,
  ChoiceList,
  ErrorState,
  InfoRow,
  LoadingState,
  Logo,
  Screen,
  Text,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";

/**
 * Home of the warehouse app: what is waiting in each warehouse this account
 * works in, read from the API. A starting point for picking, packing and
 * receiving.
 */
export default function HomeScreen() {
  const { viewer, roles, signOut } = useSession();
  const warehouses = roles?.warehouses ?? [];
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? null);
  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? warehouses[0];
  const board = useApiQuery(
    ["wms-board", warehouse?.id ?? ""],
    (api) => api.wmsBoard(warehouse?.id ?? ""),
    { personal: true, enabled: Boolean(warehouse) },
  );

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      refreshing={board.isRefetching}
      onRefresh={() => void board.refetch()}
    >
      <Logo app="warehouse" size={30} />
      <Text variant="title">Hola{viewer?.name ? `, ${viewer.name.split(" ")[0]}` : ""}</Text>
      {warehouses.length > 1 ? (
        <ChoiceList
          label="Bodega"
          value={warehouse?.id ?? null}
          onChange={setWarehouseId}
          choices={warehouses.map((w) => ({ value: w.id, title: w.name }))}
        />
      ) : null}
      {board.isPending ? (
        <LoadingState />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : (
        <Card testID="warehouse-board">
          <Text variant="heading">{board.data.warehouse.name}</Text>
          <InfoRow label="Paquetes por preparar" value={String(board.data.shipments.length)} />
          <InfoRow label="Recepciones esperadas" value={String(board.data.inbound.length)} />
        </Card>
      )}
      <Text tint="muted">Pronto podrá preparar, empacar y recibir mercadería desde aquí.</Text>
      <Button variant="ghost" block onPress={() => void signOut()} testID="sign-out">
        Cerrar sesión
      </Button>
    </Screen>
  );
}
