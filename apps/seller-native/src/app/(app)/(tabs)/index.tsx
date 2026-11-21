import { useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import {
  Button,
  Card,
  ChoiceList,
  ErrorState,
  formatPrice,
  InfoRow,
  LoadingState,
  Logo,
  Screen,
  Text,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";

import { useAccessibleShops } from "@/lib/shops";

/**
 * Home of the seller app: the shops this account belongs to, with the
 * figures the seller centre shows first. A starting point for the screens to
 * come (listings, stock, packing); it reads real data through the API.
 */
export default function HomeScreen() {
  const { viewer, signOut } = useSession();
  const shops = useAccessibleShops();
  const [shopId, setShopId] = useState(shops[0]?.id ?? null);
  const shop = shops.find((s) => s.id === shopId) ?? shops[0];
  const overview = useApiQuery(
    ["seller-overview", shop?.id ?? ""],
    (api) => api.sellerOverview(shop?.id ?? ""),
    { personal: true, enabled: Boolean(shop) },
  );

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      refreshing={overview.isRefetching}
      onRefresh={() => void overview.refetch()}
    >
      <Logo app="seller" size={30} />
      <Text variant="title">Hola{viewer?.name ? `, ${viewer.name.split(" ")[0]}` : ""}</Text>
      {shops.length > 1 ? (
        <ChoiceList
          label="Tienda"
          value={shop?.id ?? null}
          onChange={setShopId}
          choices={shops.map((s) => ({ value: s.id, title: s.trade_name }))}
        />
      ) : null}
      {overview.isPending ? (
        <LoadingState />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <Card testID="seller-overview">
          <Text variant="heading">{overview.data.seller.trade_name}</Text>
          <InfoRow
            label="Productos publicados"
            value={String(overview.data.counts.listings_active)}
          />
          <InfoRow label="En revisión" value={String(overview.data.counts.listings_in_review)} />
          <InfoRow label="Paquetes por empacar" value={String(overview.data.counts.to_pack)} />
          <InfoRow
            label="Ventas de los últimos 30 días"
            value={formatPrice(overview.data.sales_30d.gross_minor)}
          />
        </Card>
      )}
      <Text tint="muted">
        Pronto podrá publicar, cambiar precios, contar existencias y empacar desde aquí. Mientras
        tanto, todo eso está en el sitio de vendedores.
      </Text>
      <Button variant="ghost" block onPress={() => void signOut()} testID="sign-out">
        Cerrar sesión
      </Button>
    </Screen>
  );
}
