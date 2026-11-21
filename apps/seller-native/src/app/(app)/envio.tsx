import { toCostaRicaTime } from "@yuntera/core";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import {
  Alert,
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
import { useMemo, useState } from "react";
import { View } from "react-native";
import { SelectSheet } from "@/components/select";
import { checkInbound, type InboundInput } from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

/** Today and the next two weeks in Costa Rica, as YYYY-MM-DD: when the boxes may arrive. */
function arrivalDays(): string[] {
  const today = toCostaRicaTime(new Date()).date;
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 15 }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * Announces a shipment of stock to a Yuntera warehouse: which products, how
 * many and when. The warehouse counts what arrives; the seller labels each box
 * with the shipment's reference.
 */
export default function InboundScreen() {
  const shop = useShop();
  const listings = useApiQuery(shopKey(shop.id, "listings"), (api) => api.sellerListings(shop.id), {
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
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [expectedOn, setExpectedOn] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const days = useMemo(arrivalDays, []);
  const create = useApiMutation(
    (api, input: InboundInput) => api.sellerCreateInbound({ sellerId: shop.id, ...input }),
    { invalidates: [shopKey(shop.id)] },
  );

  const failed = [listings, locations].find((query) => query.isError);
  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  if (!listings.data || !locations.data) return <LoadingState />;

  if (createdId) {
    const reference = inbounds.data?.find((inbound) => inbound.inbound_id === createdId)?.reference;
    return (
      <Screen>
        <Alert tone="success" title="Envío registrado" testID="inbound-result">
          {reference
            ? `Rotule cada caja con la referencia ${reference}, bien visible.`
            : "Rotule cada caja con la referencia del envío, que aparece en Inventario."}
        </Alert>
        <LinkButton href="/inventario" block>
          Volver al inventario
        </LinkButton>
      </Screen>
    );
  }

  const hosted = listings.data.filter((listing) => listing.fulfillment === "platform");
  const warehouses = locations.data.platform;
  const chosenWarehouse = warehouseId ?? warehouses[0]?.id ?? "";

  if (hosted.length === 0 || warehouses.length === 0) {
    return (
      <EmptyState
        title="No tiene productos que se guarden en bodega"
        action={<LinkButton href="/productos">Ver sus productos</LinkButton>}
      >
        Solo se envían a la bodega los productos que Yuntera almacena y despacha.
      </EmptyState>
    );
  }

  return (
    <Screen>
      <Text tint="muted">
        Avísenos qué trae y cuándo. Rotule cada caja con la referencia del envío.
      </Text>
      {warehouses.length > 1 ? (
        <Stack gap={2}>
          <Text variant="smallStrong">Bodega de destino</Text>
          <ChoiceList
            label="Bodega de destino"
            value={chosenWarehouse}
            onChange={setWarehouseId}
            choices={warehouses.map((w) => ({
              value: w.id,
              title: w.name,
              description: w.address,
            }))}
          />
        </Stack>
      ) : (
        <Card>
          <Text variant="smallStrong">Bodega de destino</Text>
          <Text>{warehouses[0]?.name}</Text>
          <Text variant="small" tint="muted">
            {warehouses[0]?.address}
          </Text>
        </Card>
      )}
      <SelectSheet
        label="¿Cuándo llega? (opcional)"
        value={expectedOn}
        onChange={setExpectedOn}
        options={[
          { value: "", label: "Todavía no sé" },
          ...days.map((day) => ({ value: day, label: formatDate(day) })),
        ]}
        testID="inbound-date"
      />
      <Card>
        <Text variant="heading">Unidades que envía</Text>
        {hosted.map((listing) => (
          <View
            key={listing.sku_id}
            style={{ flexDirection: "row", alignItems: "flex-end", gap: space[3] }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="small">{listing.title}</Text>
              <Text variant="caption" tint="muted">
                {listing.sku_code}
              </Text>
            </View>
            <TextField
              label="Unidades"
              aria-label={`Unidades de ${listing.title}`}
              value={quantities[listing.sku_id] ?? ""}
              onChangeText={(text) =>
                setQuantities((current) => ({ ...current, [listing.sku_id]: text }))
              }
              placeholder="0"
              keyboardType="number-pad"
              inputMode="numeric"
              style={{ width: 96 }}
              testID={`inbound-qty-${listing.sku_id}`}
            />
          </View>
        ))}
      </Card>
      <Stack gap={3}>
        <FormMessage error={error} />
        <Button
          block
          size="lg"
          loading={create.isPending}
          loadingLabel="Registrando…"
          testID="inbound-submit"
          onPress={async () => {
            const checked = checkInbound({ warehouseId: chosenWarehouse, quantities, expectedOn });
            if ("error" in checked) return setError(checked.error);
            try {
              setCreatedId(await create.mutateAsync(checked.input));
            } catch (cause) {
              setError(messageOf(cause));
            }
          }}
        >
          Registrar envío
        </Button>
      </Stack>
    </Screen>
  );
}
