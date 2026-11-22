import type { SellerParcel } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  FormMessage,
  formatDate,
  formatDateTime,
  formatPrice,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import { OrderStatusBadge, ShipmentStatusBadge } from "@/components/parts";
import { flashFor, type ShopFlash } from "@/lib/flash";
import { orderLabel, SHIPMENT_STATUS_LABEL } from "@/lib/labels";
import { checkPacked } from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

/** Weight and number of boxes of one parcel; then it waits for our driver. */
function PackForm({
  parcel,
  onPacked,
}: {
  parcel: SellerParcel;
  onPacked: (message: string) => void;
}) {
  const shop = useShop();
  const [weightGrams, setWeightGrams] = useState("");
  const [packageCount, setPackageCount] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const pack = useApiMutation(
    (api, input: { weightGrams: number; packageCount: number }) =>
      api.sellerMarkPacked(parcel.shipment_id, input.weightGrams, input.packageCount),
    { invalidates: [shopKey(shop.id)] },
  );

  return (
    <Stack gap={3}>
      <View style={{ flexDirection: "row", gap: space[3] }}>
        <TextField
          label="Peso del paquete (gramos)"
          value={weightGrams}
          onChangeText={setWeightGrams}
          keyboardType="number-pad"
          inputMode="numeric"
          style={{ flex: 2 }}
          testID={`pack-weight-${parcel.tracking_code}`}
        />
        <TextField
          label="Bultos"
          value={packageCount}
          onChangeText={setPackageCount}
          keyboardType="number-pad"
          inputMode="numeric"
          style={{ flex: 1 }}
        />
      </View>
      <FormMessage error={error} />
      <Button
        block
        loading={pack.isPending}
        loadingLabel="Guardando…"
        testID={`pack-submit-${parcel.tracking_code}`}
        onPress={async () => {
          const checked = checkPacked({ weightGrams, packageCount });
          if ("error" in checked) return setError(checked.error);
          try {
            await pack.mutateAsync(checked.input);
            // The parcel moves to "waiting for the driver", so the message is
            // shown by the screen, above the list, rather than in this card.
            onPacked(
              `Paquete ${parcel.tracking_code}: listo. Un repartidor de Yuntera pasa a recogerlo.`,
            );
          } catch (cause) {
            setError(messageOf(cause));
          }
        }}
      >
        Ya está empacado
      </Button>
    </Stack>
  );
}

/**
 * Pedidos: what to pack today, what waits for our driver, and recent sales.
 * As on the web, a seller sees the buyer's first name and district only; the
 * address stays with the driver.
 */
export default function OrdersScreen() {
  const shop = useShop();
  // Kept with its shop: the tab stays mounted when the person changes shop.
  const [packedFlash, setPackedFlash] = useState<ShopFlash | null>(null);
  const packed = flashFor(packedFlash, shop.id);
  const parcels = useApiQuery(shopKey(shop.id, "to-pack"), (api) => api.sellerToPack(shop.id), {
    personal: true,
  });
  const lines = useApiQuery(
    shopKey(shop.id, "order-lines"),
    (api) => api.sellerOrderLines(shop.id, 50),
    { personal: true },
  );

  if (parcels.isPending || lines.isPending) return <LoadingState label="Cargando sus pedidos…" />;
  if (parcels.isError)
    return <ErrorState error={parcels.error} onRetry={() => void parcels.refetch()} />;
  if (lines.isError) return <ErrorState error={lines.error} onRetry={() => void lines.refetch()} />;

  const toPack = parcels.data.filter((parcel) => parcel.status !== "packed");
  const waiting = parcels.data.filter((parcel) => parcel.status === "packed");

  return (
    <Screen
      edges={["left", "right"]}
      refreshing={parcels.isRefetching || lines.isRefetching}
      onRefresh={() => {
        void parcels.refetch();
        void lines.refetch();
      }}
    >
      <Stack gap={2}>
        <Text variant="title">Pedidos</Text>
        <Text tint="muted">
          Por privacidad solo ve el nombre de pila del comprador y la zona de entrega; la dirección
          la maneja el repartidor.
        </Text>
      </Stack>

      <Stack gap={3}>
        <Text variant="heading">Por empacar</Text>
        <FormMessage ok={packed} testID="pack-result" />
        {toPack.length === 0 ? (
          <Text tint="muted" testID="nothing-to-pack">
            No tiene paquetes por empacar.
          </Text>
        ) : (
          toPack.map((parcel) => (
            <Card key={parcel.shipment_id} testID={`parcel-${parcel.tracking_code}`}>
              <Text variant="heading">Paquete {parcel.tracking_code}</Text>
              <Text variant="smallStrong" tint="warning">
                Prometido para el {formatDate(parcel.promise_latest)}
              </Text>
              <Text variant="small" tint="muted">
                Pedido {parcel.order_number} · recogemos en {parcel.origin}
              </Text>
              <Stack gap={1}>
                {parcel.items.map((item) => (
                  <Text key={item.sku_code} variant="small">
                    <Text variant="smallStrong">{item.quantity} ×</Text> {item.title}
                    <Text variant="small" tint="muted">
                      {" "}
                      · {item.sku_code}
                    </Text>
                  </Text>
                ))}
              </Stack>
              <Text variant="small" tint="muted">
                Escriba <Text variant="smallStrong">{parcel.tracking_code}</Text> en el paquete,
                bien visible. No incluya facturas con precios de otros pedidos.
              </Text>
              <PackForm
                parcel={parcel}
                onPacked={(value) => setPackedFlash({ shopId: shop.id, value })}
              />
            </Card>
          ))
        )}
      </Stack>

      {waiting.length > 0 ? (
        <Stack gap={3}>
          <Text variant="heading">Empacados, esperando al repartidor</Text>
          <Card testID="parcels-waiting">
            {waiting.map((parcel, index) => (
              <View key={parcel.shipment_id} style={{ gap: 2 }}>
                {index > 0 ? <Divider /> : null}
                <Text variant="bodyStrong">Paquete {parcel.tracking_code}</Text>
                <Text variant="small" tint="muted">
                  Pedido {parcel.order_number} · recogemos en {parcel.origin}
                </Text>
              </View>
            ))}
          </Card>
          <Text variant="small" tint="muted">
            Entregue cada paquete solo a un repartidor que le muestre la ruta de Yuntera en su
            teléfono.
          </Text>
        </Stack>
      ) : null}

      <Stack gap={3}>
        <Text variant="heading">Ventas recientes</Text>
        {lines.data.length === 0 ? (
          <EmptyState title="Aún no tiene ventas">
            Cuando alguien compre uno de sus productos aparece aquí al instante.
          </EmptyState>
        ) : (
          lines.data.map((line) => (
            // A line that left from two places has one row per parcel.
            <Card key={`${line.order_item_id}:${line.shipment_id ?? ""}`}>
              <View style={{ flexDirection: "row", gap: space[2], alignItems: "baseline" }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {line.order_number}
                </Text>
                <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
                  {formatPrice(line.line_total_minor)}
                </Text>
              </View>
              <Text variant="small" tint="muted">
                {formatDateTime(line.placed_at)}
              </Text>
              <Text variant="small">
                {line.quantity} × {line.title}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                <OrderStatusBadge status={line.order_status} />
                {/* The delivery's state, named, and only when it says something the order's does not. */}
                {line.shipment_status &&
                SHIPMENT_STATUS_LABEL[line.shipment_status] !== orderLabel(line.order_status) ? (
                  <ShipmentStatusBadge status={line.shipment_status} prefix="Entrega" />
                ) : null}
              </View>
              <Text variant="small" tint="muted">
                {line.fulfillment === "platform" ? "Sale de bodega Yuntera" : "Lo despacha usted"} ·{" "}
                {line.buyer_first_name}
                {line.district || line.canton
                  ? `, ${[line.district, line.canton].filter(Boolean).join(", ")}`
                  : ""}
              </Text>
            </Card>
          ))
        )}
      </Stack>
    </Screen>
  );
}
