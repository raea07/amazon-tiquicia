import { useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  formatPrice,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import { Stat, StatGrid } from "@/components/parts";
import { SELLER_HEALTH } from "@/lib/labels";
import { shopKey, useShop, useShops } from "@/lib/shops";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Inicio: what needs doing today in this shop, then how it is going, as the
 * seller centre's summary page. Each figure that needs attention opens the
 * screen where it is dealt with.
 */
export default function HomeScreen() {
  const shop = useShop();
  const { justRegistered } = useShops();
  const { viewer, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);
  const overview = useApiQuery(shopKey(shop.id, "overview"), (api) => api.sellerOverview(shop.id), {
    personal: true,
  });

  if (overview.isPending) return <LoadingState />;
  if (overview.isError)
    return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;

  const { counts, sales_30d: sales, seller } = overview.data;
  const health = SELLER_HEALTH[seller.health];
  const todo = [
    counts.to_pack > 0
      ? plural(counts.to_pack, "paquete por empacar", "paquetes por empacar")
      : null,
    counts.offers_out_of_stock > 0
      ? plural(counts.offers_out_of_stock, "producto sin existencias", "productos sin existencias")
      : null,
    counts.listings_rejected > 0
      ? plural(counts.listings_rejected, "producto rechazado", "productos rechazados")
      : null,
    counts.open_returns > 0
      ? plural(counts.open_returns, "devolución abierta", "devoluciones abiertas")
      : null,
  ].filter((item): item is string => item !== null);

  return (
    <Screen
      edges={["left", "right"]}
      refreshing={overview.isRefetching}
      onRefresh={() => void overview.refetch()}
    >
      <View testID="seller-overview" style={{ gap: 20 }}>
        <Stack gap={2}>
          <Text variant="title">{seller.trade_name}</Text>
          <Text tint="muted">Lo que necesita atender hoy y cómo va su tienda.</Text>
        </Stack>

        {justRegistered === shop.id ? (
          <Alert tone="success" title="Recibimos su solicitud">
            Mientras verificamos sus datos puede ir creando sus productos. Se publican cuando su
            tienda quede aprobada.
          </Alert>
        ) : null}
        {seller.status === "pending" ? (
          <Alert tone="info" title="Su tienda está en revisión" testID="shop-pending">
            Estamos verificando su identidad con los datos que nos dio. Normalmente toma uno o dos
            días hábiles y le avisamos por correo. Sus productos todavía no son visibles para los
            compradores.
          </Alert>
        ) : null}
        {seller.status === "suspended" ? (
          <Alert tone="danger" title="Su tienda está suspendida" testID="shop-suspended">
            Sus productos no se muestran y no puede recibir pedidos nuevos. Le enviamos el motivo
            por correo; respóndanos ahí para resolverlo.
          </Alert>
        ) : null}

        <Stack gap={3}>
          <Text variant="heading">Por atender</Text>
          <Text testID="today-summary">
            {todo.length === 0
              ? "Hoy no tiene nada pendiente. Cuando entre un pedido aparece aquí."
              : `Hoy tiene ${todo.join(", ")}.`}
          </Text>
          <StatGrid>
            <Stat
              label="Pedidos por empacar"
              value={String(counts.to_pack)}
              tone={counts.to_pack > 0 ? "warning" : undefined}
              hint="Ver pedidos"
              href="/pedidos"
              testID="stat-to-pack"
            />
            <Stat
              label="Productos sin existencias"
              value={String(counts.offers_out_of_stock)}
              tone={counts.offers_out_of_stock > 0 ? "warning" : undefined}
              hint="Ver inventario"
              href="/inventario"
            />
            <Stat
              label="Productos rechazados"
              value={String(counts.listings_rejected)}
              tone={counts.listings_rejected > 0 ? "danger" : undefined}
              hint="Ver el motivo"
              href="/productos"
            />
            <Stat label="Devoluciones abiertas" value={String(counts.open_returns)} />
          </StatGrid>
          <LinkButton href="/publicar" block testID="home-new-listing">
            Publicar un producto
          </LinkButton>
        </Stack>

        <Stack gap={3}>
          <Text variant="heading">Últimos 30 días</Text>
          <StatGrid>
            <Stat
              label="Ventas"
              value={formatPrice(sales.gross_minor)}
              hint="Precio pagado por los compradores"
            />
            <Stat label="Pedidos" value={String(sales.orders)} hint={`${sales.units} unidades`} />
            <Stat
              label="Por cobrar"
              value={formatPrice(overview.data.payable_minor)}
              hint="Ver el detalle"
              href="/pagos"
            />
            <Stat
              label="Productos publicados"
              value={String(counts.listings_active)}
              hint={
                counts.listings_in_review > 0
                  ? `${counts.listings_in_review} en revisión`
                  : undefined
              }
            />
          </StatGrid>
        </Stack>

        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Text variant="heading">Desempeño</Text>
            <Badge tone={health.tone}>{health.label}</Badge>
            <Text variant="small" tint="muted">
              {seller.score} de 100
            </Text>
          </View>
          <Text variant="small" tint="muted">
            Se calcula con sus últimos pedidos: despachos a tiempo, cancelaciones por falta de
            existencias, devoluciones por producto defectuoso o distinto, y reseñas. Un buen puntaje
            ayuda a que su oferta sea la destacada cuando varios vendedores ofrecen el mismo
            producto. Con pocos pedidos el puntaje se mantiene cerca del promedio: una sola mala
            semana no lo hunde.
          </Text>
        </Card>

        <Stack gap={1}>
          {viewer?.email ? (
            <Text variant="small" tint="muted" align="center">
              Ingresó como {viewer.email}.
            </Text>
          ) : null}
          <Button
            variant="ghost"
            block
            loading={leaving}
            loadingLabel="Cerrando sesión…"
            onPress={async () => {
              setLeaving(true);
              await signOut();
            }}
            testID="sign-out"
          >
            Cerrar sesión
          </Button>
        </Stack>
      </View>
    </Screen>
  );
}
