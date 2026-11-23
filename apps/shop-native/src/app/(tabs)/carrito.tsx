import type { CartLine } from "@yuntera/db";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { colors, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  formatPrice,
  InfoRow,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextLink,
} from "@yuntera/expo-kit/ui";
import { Link, router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { ProductImage } from "@/components/product";
import { QuantityStepper } from "@/components/quantity";
import { useCart } from "@/lib/cart-context";

function Line({ line, quantity }: { line: CartLine; quantity: number }) {
  const cart = useCart();
  const max = Math.max(Math.min(line.available, 10), 1);
  return (
    <Card style={styles.line} testID="cart-line">
      <ProductImage path={line.image_path} size={72} />
      <View style={styles.lineBody}>
        {line.buyable && line.product_slug ? (
          <>
            <Link href={{ pathname: "/p/[slug]", params: { slug: line.product_slug } }}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {line.title}
              </Text>
            </Link>
            <Text variant="small" tint="muted">
              {line.variant_name ? `${line.variant_name} · ` : ""}Vendido por {line.seller_name}
            </Text>
          </>
        ) : (
          <Alert tone="warning" title={line.title ?? "Producto no disponible"}>
            Ya no está disponible. Quítelo para continuar con su compra.
          </Alert>
        )}
        <View style={styles.lineActions}>
          {line.buyable ? (
            // The stored quantity, the same number the line total and checkout
            // use; above the stock the stepper only allows going down.
            <QuantityStepper
              value={quantity}
              max={max}
              onChange={(next) => cart.setQuantity(line.offer_id, next)}
            />
          ) : null}
          <Button
            variant="ghost"
            aria-label={`Quitar ${line.title ?? "este producto"} del carrito`}
            onPress={() => cart.setQuantity(line.offer_id, 0)}
          >
            Quitar
          </Button>
          {line.buyable && line.price_minor !== null ? (
            <Text variant="figure" style={styles.lineTotal}>
              {formatPrice(line.price_minor * quantity)}
            </Text>
          ) : null}
        </View>
        {line.buyable && quantity > line.available ? (
          <Text variant="smallStrong" tint="warning">
            Solo quedan {line.available}. Actualice la cantidad.
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/** The cart. Prices and stock are read fresh every time; the phone only remembers what and how many. */
export default function CartScreen() {
  const cart = useCart();
  const ids = cart.items.map((item) => item.offerId);
  const lines = useApiQuery(["cart-lines", ids], (api) => api.cartLines(ids), {
    enabled: cart.items.length > 0,
  });
  const quote = useApiQuery(
    ["quote", cart.items, cart.postalCode],
    (api) => api.checkoutQuote(cart.items, cart.postalCode),
    { enabled: cart.items.length > 0 },
  );

  if (!cart.ready) return <LoadingState />;
  if (cart.items.length === 0) {
    return (
      <EmptyState
        title="Su carrito está vacío"
        action={<LinkButton href="/buscar">Ver productos</LinkButton>}
      >
        Cuando agregue productos los verá aquí.
      </EmptyState>
    );
  }
  if (lines.isPending || quote.isPending)
    return <LoadingState label="Revisando precios y existencias…" />;
  if (lines.isError) return <ErrorState error={lines.error} onRetry={() => void lines.refetch()} />;
  if (quote.isError) return <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />;

  const quantityOf = new Map(cart.items.map((item) => [item.offerId, item.quantity]));
  const hasUnavailable = lines.data.some((line) => !line.buyable);
  const q = quote.data;

  return (
    <Screen
      refreshing={lines.isRefetching || quote.isRefetching}
      onRefresh={() => {
        void lines.refetch();
        void quote.refetch();
      }}
      footer={
        hasUnavailable ? (
          <Alert tone="warning">Quite los productos no disponibles para continuar.</Alert>
        ) : (
          <Button block size="lg" onPress={() => router.push("/pagar")} testID="cart-continue">
            Continuar con la compra
          </Button>
        )
      }
    >
      <Stack gap={3}>
        {lines.data.map((line) => (
          <Line key={line.offer_id} line={line} quantity={quantityOf.get(line.offer_id) ?? 1} />
        ))}
      </Stack>

      <Card testID="cart-summary">
        <Text variant="heading">Resumen</Text>
        <InfoRow label="Productos" value={formatPrice(q.items_total_minor ?? 0)} />
        <InfoRow
          label={cart.locationChosen ? "Envío" : "Envío (estimado)"}
          value={
            q.shipping_minor === 0
              ? "Gratis"
              : q.shipping_minor != null
                ? formatPrice(q.shipping_minor)
                : "—"
          }
        />
        <View style={styles.total}>
          <InfoRow
            strong
            label="Total"
            value={q.total_minor != null ? formatPrice(q.total_minor) : "—"}
          />
        </View>
        <Text variant="caption" tint="muted">
          Incluye {formatPrice(q.tax_included_minor ?? 0)} de IVA.
        </Text>
        {q.promise ? (
          <Text variant="smallStrong" tint="success">
            Llega el {formatDate(q.promise.latest)}
          </Text>
        ) : null}
        {q.issue === "zone_not_served" ? (
          <Alert tone="warning">
            <Text variant="small" style={{ color: colors.palette.maiz[900] }}>
              Por ahora no entregamos en la zona elegida.
            </Text>
            <TextLink href="/zona">Cambiar de zona</TextLink>
          </Alert>
        ) : null}
        {!cart.locationChosen ? (
          <View>
            <Text variant="small">Para ver el envío y la fecha exactos:</Text>
            <TextLink href="/zona">Elija su zona</TextLink>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", gap: space[3], alignItems: "flex-start" },
  lineBody: { flex: 1, gap: space[2] },
  lineActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  lineTotal: { marginLeft: "auto", fontSize: 18 },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[2] },
});
