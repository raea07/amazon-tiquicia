import { useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { signInPath } from "@yuntera/expo-kit/paths";
import { colors, gutter, space } from "@yuntera/expo-kit/theme";
import {
  EmptyState,
  ErrorState,
  formatDate,
  formatPrice,
  LinkButton,
  LoadingState,
  Text,
} from "@yuntera/expo-kit/ui";
import { Link, Redirect } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OrderStatusBadge } from "@/components/badges";
import { ProductImage } from "@/components/product";
import { needsSignIn } from "@/lib/guard";

/** "Sus pedidos": every order, newest first, each opening its tracking page. */
export default function OrdersScreen() {
  const { status } = useSession();
  const orders = useApiQuery(["orders"], (api) => api.myOrders(50), { personal: true });

  if (needsSignIn(status)) return <Redirect href={signInPath("/pedidos")} />;
  if (orders.isPending) return <LoadingState label="Cargando sus pedidos…" />;
  if (orders.isError)
    return <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />;

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.page}>
      <FlatList
        data={orders.data}
        keyExtractor={(order) => order.order_number}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={orders.isRefetching}
            onRefresh={() => void orders.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <EmptyState
            title="Todavía no tiene pedidos"
            action={<LinkButton href="/buscar">Ver productos</LinkButton>}
          >
            Cuando compre, aquí podrá seguir cada entrega.
          </EmptyState>
        }
        renderItem={({ item: order }) => (
          <Link
            href={{ pathname: "/pedidos/[numero]", params: { numero: order.order_number } }}
            asChild
          >
            <Pressable role="link" testID={`order-${order.order_number}`} style={styles.row}>
              <ProductImage path={order.first_image_path} size={64} />
              <View style={styles.body}>
                <View style={styles.head}>
                  <Text variant="bodyStrong">{order.order_number}</Text>
                  <OrderStatusBadge status={order.status} />
                </View>
                <Text variant="small" tint="muted" numberOfLines={1}>
                  {order.first_title}
                  {order.item_count > 1 ? ` y ${order.item_count - 1} más` : ""}
                </Text>
                <Text variant="small" tint="muted">
                  {order.delivered_at
                    ? `Entregado el ${formatDate(order.delivered_at, { day: "numeric", month: "long" })}`
                    : order.status === "cancelled" || order.status === "refunded"
                      ? `Pedido el ${formatDate(order.placed_at, { day: "numeric", month: "long" })}`
                      : `Llega el ${formatDate(order.promise_latest)}`}
                </Text>
              </View>
              <Text variant="figure" style={styles.total}>
                {formatPrice(order.total_minor)}
              </Text>
            </Pressable>
          </Link>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingVertical: space[3], flexGrow: 1 },
  row: {
    flexDirection: "row",
    gap: space[3],
    alignItems: "center",
    paddingHorizontal: gutter,
    paddingVertical: space[3],
    backgroundColor: colors.surface,
  },
  body: { flex: 1, gap: 2 },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  total: { fontSize: 16 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
