import { cartHasNothingToBuy, NOTHING_TO_BUY_NOTE } from "@yuntera/core";
import type { CartLine, DatedCartAlternative } from "@yuntera/db";
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
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { UnavailableLine } from "@/components/cart-alternative";
import { KeptNotice } from "@/components/kept-notice";
import { ProductImage } from "@/components/product";
import { QuantityStepper } from "@/components/quantity";
import { useCart } from "@/lib/cart-context";
import { type AlternativesLookup, unavailableFooter } from "@/lib/cart-wording";
import { firstReadFailed, KEPT, refreshFailed } from "@/lib/kept-reads";

function Line({
  line,
  quantity,
  alternative,
  lookup,
  onRetryAlternatives,
}: {
  line: CartLine;
  quantity: number;
  /** Another shop's offer of the same variant, for a line that cannot be bought. */
  alternative: DatedCartAlternative | undefined;
  lookup: AlternativesLookup;
  onRetryAlternatives: () => void;
}) {
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
          <UnavailableLine
            line={line}
            alternative={alternative}
            quantity={quantity}
            lookup={lookup}
            onRetry={onRetryAlternatives}
          />
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

  // Another shop may still sell what the shopper chose: say so, instead of
  // "gone", with when it would arrive in the district the cart is priced for
  // (the date its product page gives; no request per product).
  const unavailable = (lines.data ?? []).filter((line) => !line.buyable).map((l) => l.offer_id);
  const alternatives = useApiQuery(
    ["cart-alternatives", unavailable, cart.postalCode],
    (api) => api.cartAlternatives(unavailable, cart.postalCode),
    { enabled: unavailable.length > 0 },
  );
  // A pull, and every "Intentar de nuevo" above a kept cart: everything again.
  const [pulling, setPulling] = useState(false);
  const readAgain = () => {
    setPulling(true);
    void Promise.allSettled([
      lines.refetch(),
      quote.refetch(),
      ...(unavailable.length > 0 ? [alternatives.refetch()] : []),
    ]).finally(() => setPulling(false));
  };

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
  if (firstReadFailed(lines))
    return <ErrorState error={lines.error} onRetry={() => void lines.refetch()} />;
  if (firstReadFailed(quote))
    return <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />;
  if (!lines.data || !quote.data) return <LoadingState label="Revisando precios y existencias…" />;

  const quantityOf = new Map(cart.items.map((item) => [item.offerId, item.quantity]));
  const hasUnavailable = unavailable.length > 0;
  // While they load the line says that the other shops are being checked; if
  // they could not be read, it says so and offers to ask again. "Nobody else
  // sells it" only once they answered.
  const alternativeOf = new Map(
    (hasUnavailable ? (alternatives.data ?? []) : []).map((alt) => [alt.offer_id, alt]),
  );
  const lookup: AlternativesLookup =
    alternatives.data !== undefined ? "done" : firstReadFailed(alternatives) ? "failed" : "loading";
  const q = quote.data;
  // Lines or the total on screen, and asking again failed: they stay, and the
  // cart says so (checkout checks prices and stock again anyway).
  const keptError = refreshFailed(lines) ? lines.error : refreshFailed(quote) ? quote.error : null;

  return (
    <Screen
      refreshing={pulling}
      onRefresh={readAgain}
      footer={
        hasUnavailable ? (
          <Alert tone="warning" testID="cart-blocked">
            {unavailableFooter(alternativeOf.size > 0 || lookup !== "done")}
          </Alert>
        ) : (
          <Button block size="lg" onPress={() => router.push("/pagar")} testID="cart-continue">
            Continuar con la compra
          </Button>
        )
      }
    >
      {keptError ? (
        <KeptNotice
          title={KEPT.cart.title}
          body={KEPT.cart.body}
          error={keptError}
          onRetry={readAgain}
          retrying={pulling}
          testID="cart-kept"
        />
      ) : null}
      <Stack gap={3}>
        {lines.data.map((line) => (
          <Line
            key={line.offer_id}
            line={line}
            quantity={quantityOf.get(line.offer_id) ?? 1}
            alternative={alternativeOf.get(line.offer_id)}
            lookup={lookup}
            onRetryAlternatives={() => void alternatives.refetch()}
          />
        ))}
      </Stack>

      <Card testID="cart-summary">
        <Text variant="heading">Resumen</Text>
        {/* Nothing in the cart can be bought: no total to pay and no date. */}
        {cartHasNothingToBuy(lines.data) ? (
          <Text variant="small" testID="cart-nothing-to-buy">
            {NOTHING_TO_BUY_NOTE}
          </Text>
        ) : (
          <>
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
          </>
        )}
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
