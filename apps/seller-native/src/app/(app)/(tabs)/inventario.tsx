import { useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  formatDate,
  formatDateTime,
  InfoRow,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { View } from "react-native";
import { StockForm } from "@/components/stock-form";
import { INBOUND_STATUS } from "@/lib/labels";
import { shopKey, useShop } from "@/lib/shops";
import {
  HISTORY_EMPTY,
  HISTORY_HEADING,
  HISTORY_INTRO,
  HISTORY_KIND,
  HISTORY_LIMIT,
  historyChange,
  historyReason,
} from "@/lib/stock-history";

/**
 * Inventario: how many units of each product there are and where. Stock at
 * the seller's own place is counted here; stock in Yuntera's warehouse is
 * counted by the warehouse when it receives a shipment the seller announces.
 */
export default function InventoryScreen() {
  const shop = useShop();
  const listings = useApiQuery(shopKey(shop.id, "listings"), (api) => api.sellerListings(shop.id), {
    personal: true,
  });
  const stock = useApiQuery(shopKey(shop.id, "stock"), (api) => api.sellerStock(shop.id), {
    personal: true,
  });
  const locations = useApiQuery(
    shopKey(shop.id, "locations"),
    (api) => api.sellerLocations(shop.id),
    { personal: true },
  );
  const inbounds = useApiQuery(shopKey(shop.id, "inbounds"), (api) => api.sellerInbounds(shop.id), {
    personal: true,
  });

  const history = useApiQuery(
    shopKey(shop.id, "stock-history"),
    (api) => api.sellerStockHistory(shop.id, HISTORY_LIMIT),
    { personal: true },
  );

  const queries = [listings, stock, locations, inbounds, history];
  const failed = queries.find((query) => query.isError);
  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  if (!listings.data || !stock.data || !locations.data || !inbounds.data || !history.data) {
    return <LoadingState label="Cargando su inventario…" />;
  }

  const intro = (
    <Stack gap={2}>
      <Text variant="title">Inventario</Text>
      <Text tint="muted">
        Cuántas unidades hay de cada producto y dónde están. Un producto sin existencias deja de
        ofrecerse solo, y vuelve cuando usted repone.
      </Text>
    </Stack>
  );

  if (listings.data.length === 0) {
    return (
      <Screen edges={["left", "right"]}>
        {intro}
        <EmptyState
          title="Primero publique un producto"
          action={<LinkButton href="/publicar">Publicar un producto</LinkButton>}
        >
          El inventario se lleva por producto. Cuando tenga el primero, aquí indica cuántas unidades
          hay.
        </EmptyState>
      </Screen>
    );
  }

  const own = listings.data.filter((listing) => listing.fulfillment === "seller");
  const hosted = listings.data.filter((listing) => listing.fulfillment === "platform");
  const levelAt = (warehouseId: string, skuId: string) =>
    stock.data.find((row) => row.warehouse_id === warehouseId && row.sku_id === skuId);
  const hostedStock = stock.data.filter((row) => row.warehouse_kind === "platform");

  return (
    <Screen
      edges={["left", "right"]}
      refreshing={stock.isRefetching}
      onRefresh={() => queries.forEach((query) => void query.refetch())}
    >
      {intro}

      {own.length > 0 ? (
        <Stack gap={3}>
          <Text variant="heading">Lo que usted despacha</Text>
          {locations.data.own.length === 0 ? (
            <Card>
              <Alert tone="warning" title="Falta registrar de dónde recogemos sus paquetes">
                Sin ese lugar no podemos ofrecer estos productos: no sabríamos adónde enviar al
                repartidor.
              </Alert>
              <LinkButton href="/lugar" block testID="add-location">
                Registrar el lugar de recolección
              </LinkButton>
            </Card>
          ) : (
            locations.data.own.map((location) => (
              <Card key={location.id} testID={`location-${location.id}`}>
                <Text variant="bodyStrong">{location.name}</Text>
                <Text variant="small" tint="muted">
                  {location.address}
                </Text>
                {own.map((listing) => {
                  const level = levelAt(location.id, listing.sku_id);
                  return (
                    <View key={listing.sku_id} style={{ gap: space[2] }}>
                      <Divider />
                      <Text variant="bodyStrong">{listing.title}</Text>
                      <Text variant="caption" tint="muted">
                        {listing.sku_code} · {level?.available ?? 0} disponibles
                      </Text>
                      <StockForm
                        warehouseId={location.id}
                        skuId={listing.sku_id}
                        place={location.name}
                        product={listing.title}
                        onHand={level?.on_hand ?? 0}
                        reserved={level?.reserved ?? 0}
                      />
                    </View>
                  );
                })}
              </Card>
            ))
          )}
        </Stack>
      ) : null}

      {hosted.length > 0 ? (
        <Stack gap={3}>
          <Text variant="heading">En la bodega de Yuntera</Text>
          <Text variant="small" tint="muted">
            Estas existencias las cuenta la bodega al recibir su mercadería; usted no las edita.
          </Text>
          {hostedStock.length === 0 ? (
            <Alert tone="info">
              Todavía no hay unidades suyas en bodega. Registre un envío y llévelo a la bodega.
            </Alert>
          ) : (
            <Card>
              {hostedStock.map((row, index) => (
                <View key={`${row.warehouse_id}:${row.sku_id}`} style={{ gap: 2 }}>
                  {index > 0 ? <Divider /> : null}
                  <Text variant="bodyStrong">{row.title}</Text>
                  <Text variant="caption" tint="muted">
                    {row.sku_code} · {row.warehouse_name}
                  </Text>
                  <InfoRow
                    label={`${row.on_hand} en bodega · ${row.reserved} apartadas`}
                    value={`${row.available} disponibles`}
                  />
                </View>
              ))}
            </Card>
          )}
          <LinkButton href="/envio" block testID="new-inbound">
            Enviar mercadería a la bodega
          </LinkButton>

          <Text variant="heading">Sus envíos</Text>
          {inbounds.data.length === 0 ? (
            <Text tint="muted">Aún no ha registrado envíos.</Text>
          ) : (
            inbounds.data.map((inbound) => {
              const status = INBOUND_STATUS[inbound.status];
              return (
                <Card key={inbound.inbound_id} testID={`inbound-${inbound.reference}`}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                    <Text variant="heading" style={{ flex: 1 }}>
                      {inbound.reference}
                    </Text>
                    <Badge tone={status?.tone ?? "neutral"}>
                      {status?.label ?? inbound.status}
                    </Badge>
                  </View>
                  <Text variant="small" tint="muted">
                    {inbound.warehouse_name}
                    {inbound.expected_on ? ` · llega el ${formatDate(inbound.expected_on)}` : ""}
                  </Text>
                  {(inbound.lines ?? []).map((line) => (
                    <InfoRow
                      key={line.sku_code}
                      label={line.title}
                      value={`${line.received} de ${line.expected} recibidas${line.damaged > 0 ? ` · ${line.damaged} dañadas` : ""}`}
                    />
                  ))}
                </Card>
              );
            })
          )}
        </Stack>
      ) : null}

      <View style={{ gap: space[3] }} testID="stock-history">
        <Text variant="heading">{HISTORY_HEADING}</Text>
        <Text variant="small" tint="muted">
          {HISTORY_INTRO}
        </Text>
        {history.data.length === 0 ? (
          <Text tint="muted">{HISTORY_EMPTY}</Text>
        ) : (
          history.data.map((entry) => (
            <Card key={entry.id} testID={`history-${entry.id}`}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {entry.title}
                  {entry.variant_name ? ` · ${entry.variant_name}` : ""}
                </Text>
                <Text variant="bodyStrong">{historyChange(entry.change)}</Text>
              </View>
              <Text variant="small" tint="muted">
                {HISTORY_KIND[entry.kind]} · {entry.warehouse_name} · {formatDateTime(entry.at)}
              </Text>
              {historyReason(entry.note) ? (
                <Text variant="small">{historyReason(entry.note)}</Text>
              ) : null}
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}
