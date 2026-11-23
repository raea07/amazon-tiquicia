import { useQueryClient } from "@tanstack/react-query";
import { messageOf } from "@yuntera/expo-kit/api";
import { useSession } from "@yuntera/expo-kit/auth";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { signInPath } from "@yuntera/expo-kit/paths";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Button,
  Card,
  type Choice,
  ChoiceList,
  ErrorState,
  FormMessage,
  formatDate,
  formatPrice,
  InfoRow,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import * as Crypto from "expo-crypto";
import { Link, Redirect, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCart } from "@/lib/cart-context";
import { needsSignIn } from "@/lib/guard";

type Method = "sinpe_movil" | "card" | "cash_on_delivery";

const METHODS: Array<Choice<Method>> = [
  {
    value: "sinpe_movil",
    title: "SINPE Móvil",
    description:
      "Le damos el número y un código de referencia. Preparamos el pedido al recibir la transferencia.",
  },
  {
    value: "card",
    title: "Tarjeta de crédito o débito",
    description:
      "Los datos de la tarjeta se ingresan en la página segura del procesador de pagos; nosotros nunca los vemos.",
  },
  {
    value: "cash_on_delivery",
    title: "Efectivo contra entrega",
    description: "Paga el monto exacto al repartidor cuando recibe.",
  },
];

/**
 * The last step: where, how, the full breakdown, confirm. Nothing is chosen
 * for the shopper except their own default address; in particular no
 * payment method. The order is placed with a key made when this screen
 * opened, so a double tap or a retry after a timeout returns the same order.
 */
export default function CheckoutScreen() {
  const { status } = useSession();
  const cart = useCart();
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [addressId, setAddressId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addresses = useApiQuery(["addresses"], (api) => api.myAddresses(), { personal: true });
  const deliverable = (addresses.data ?? []).filter((a) => a.zone_active);
  const preferred = deliverable.find((a) => a.is_default) ?? deliverable[0];
  const target = deliverable.find((a) => a.id === addressId) ?? preferred;

  const quote = useApiQuery(
    ["quote", cart.items, target?.postal_code ?? ""],
    (api) => api.checkoutQuote(cart.items, target?.postal_code ?? ""),
    { personal: true, enabled: Boolean(target) && cart.items.length > 0 },
  );
  const ids = cart.items.map((item) => item.offerId);
  const lines = useApiQuery(["cart-lines", ids], (api) => api.cartLines(ids), {
    enabled: cart.items.length > 0,
  });

  const place = useApiMutation(
    (api, input: Parameters<typeof api.placeOrder>[0]) => api.placeOrder(input),
    { invalidates: [["orders"]] },
  );

  if (needsSignIn(status)) return <Redirect href={signInPath("/pagar")} />;
  if (cart.ready && cart.items.length === 0 && !place.isSuccess)
    return <Redirect href="/carrito" />;
  if (addresses.isPending || !cart.ready) return <LoadingState />;
  if (addresses.isError)
    return <ErrorState error={addresses.error} onRetry={() => void addresses.refetch()} />;

  // First purchase: there is no address yet, so that comes first.
  if (addresses.data.length === 0) {
    return (
      <Screen>
        <Text variant="title">Primero, ¿dónde se lo entregamos?</Text>
        <Text tint="muted">La guardamos para sus próximas compras.</Text>
        <LinkButton href="/direcciones/nueva?siguiente=/pagar" block size="lg">
          Agregar una dirección
        </LinkButton>
      </Screen>
    );
  }
  if (!target) {
    return (
      <Screen>
        <Alert tone="warning" title="Por ahora no entregamos en sus direcciones guardadas">
          Para comprar ahora, agregue una dirección en una zona donde sí entregamos. Sus direcciones
          quedan guardadas: cuando volvamos a entregar ahí, podrá elegirlas de nuevo.
        </Alert>
        <LinkButton href="/direcciones/nueva?siguiente=/pagar" block>
          Agregar una dirección
        </LinkButton>
      </Screen>
    );
  }
  if (quote.isPending || lines.isPending) return <LoadingState label="Calculando su total…" />;
  if (quote.isError) return <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />;
  if (lines.isError) return <ErrorState error={lines.error} onRetry={() => void lines.refetch()} />;

  const q = quote.data;
  if ((q.issue && q.issue !== "zone_not_served") || q.total_minor == null) {
    return (
      <Screen>
        <Alert tone="warning" title="Revise su carrito antes de continuar">
          Algún producto cambió o ya no está disponible.
        </Alert>
        <LinkButton href="/carrito" variant="secondary">
          Volver al carrito
        </LinkButton>
      </Screen>
    );
  }
  const total = q.total_minor;
  const quantityOf = new Map(cart.items.map((item) => [item.offerId, item.quantity]));

  async function confirm() {
    if (!target) return;
    if (!method) {
      setError("Elija cómo desea pagar.");
      return;
    }
    setError(null);
    try {
      const order = await place.mutateAsync({
        items: cart.items,
        addressId: target.id,
        paymentMethod: method,
        idempotencyKey,
        expectedTotalMinor: total,
      });
      cart.clear();
      // Stock changed: cached availability is stale.
      void queryClient.invalidateQueries({ queryKey: ["product"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      router.replace({
        pathname: "/pedidos/[numero]",
        params: { numero: order.order_number, nuevo: "1" },
      });
    } catch (cause) {
      setError(messageOf(cause));
      // A price or stock change: re-read the lines and the total together, so
      // the summary never shows an old line price beside a new total.
      void Promise.all([quote.refetch(), lines.refetch()]);
    }
  }

  return (
    <Screen
      footer={
        <>
          <FormMessage error={error} testID="checkout-message" />
          <Button
            block
            size="lg"
            loading={place.isPending}
            loadingLabel="Confirmando su pedido…"
            onPress={confirm}
            testID="checkout-confirm"
          >
            {`Confirmar pedido por ${formatPrice(total)}`}
          </Button>
        </>
      }
    >
      {q.payments_mode === "sandbox" ? (
        <Alert tone="info" title="Sitio en modo de prueba">
          Los pagos son simulados: no se cobra dinero real ni se entrega ningún producto.
        </Alert>
      ) : null}
      {q.payments_mode === "test" ? (
        <Alert tone="info" title="Pagos de prueba">
          El cobro pasa por el entorno de pruebas del procesador de pagos: no se cobra dinero real.
        </Alert>
      ) : null}

      <Stack gap={3}>
        <Text variant="heading">1. ¿Dónde lo entregamos?</Text>
        <ChoiceList
          label="Dirección de entrega"
          value={target.id}
          onChange={setAddressId}
          testID="address"
          choices={addresses.data.map((address) => ({
            value: address.id,
            title: `${address.label ? `${address.label} · ` : ""}${address.recipient_name}`,
            description: `${address.senas}. ${address.district}, ${address.canton}.`,
            disabled: !address.zone_active,
            disabledReason: "Por ahora no entregamos aquí. Elija otra dirección.",
          }))}
        />
        <Link href="/direcciones/nueva?siguiente=/pagar" style={styles.inlineLink}>
          <Text variant="smallStrong" tint="link">
            Agregar otra dirección
          </Text>
        </Link>
      </Stack>

      <Stack gap={3}>
        <Text variant="heading">2. ¿Cómo desea pagar?</Text>
        <ChoiceList
          label="Medio de pago"
          value={method}
          onChange={(value) => {
            setMethod(value);
            setError(null);
          }}
          testID="payment"
          choices={METHODS.map((choice) =>
            choice.value === "cash_on_delivery" && !q.cod_available
              ? {
                  ...choice,
                  disabled: true,
                  disabledReason: "No disponible para pedidos de este monto.",
                }
              : choice,
          )}
        />
      </Stack>

      <Card testID="checkout-summary">
        <Text variant="heading">3. Resumen del pedido</Text>
        {lines.data.map((line) => (
          <View key={line.offer_id} style={styles.summaryLine}>
            <View style={styles.flex}>
              <Text variant="small">
                {quantityOf.get(line.offer_id)} × {line.title}
              </Text>
              <Text variant="caption" tint="muted">
                Vendido por {line.seller_name}
              </Text>
            </View>
            <Text variant="small" style={styles.amount}>
              {formatPrice((line.price_minor ?? 0) * (quantityOf.get(line.offer_id) ?? 1))}
            </Text>
          </View>
        ))}
        <View style={styles.rule} />
        <InfoRow label="Productos" value={formatPrice(q.items_total_minor ?? 0)} />
        <InfoRow
          label="Envío"
          value={q.shipping_minor === 0 ? "Gratis" : formatPrice(q.shipping_minor ?? 0)}
        />
        <View style={styles.rule} />
        <InfoRow strong label="Total a pagar" value={formatPrice(total)} />
        <Text variant="caption" tint="muted">
          Precio final en colones. Incluye {formatPrice(q.tax_included_minor ?? 0)} de IVA.
        </Text>
        {q.promise ? (
          <View style={styles.promise}>
            <Text variant="smallStrong" style={{ color: colors.palette.selva[900] }}>
              Llega el {formatDate(q.promise.latest)} a {target.district}.
            </Text>
          </View>
        ) : null}
        <Link href="/carrito" style={styles.inlineLink}>
          <Text variant="smallStrong" tint="link">
            Editar carrito
          </Text>
        </Link>
      </Card>

      <Text variant="small" tint="muted">
        Al confirmar acepta los términos y condiciones. Puede devolver su compra hasta 8 días
        hábiles después de recibirla, sin dar explicaciones, y le reembolsamos por el mismo medio de
        pago.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inlineLink: { minHeight: 44, paddingVertical: space[3] },
  summaryLine: { flexDirection: "row", gap: space[3] },
  amount: { fontVariant: ["tabular-nums"] },
  rule: { height: 1, backgroundColor: colors.border },
  promise: {
    backgroundColor: colors.palette.selva[50],
    borderRadius: radius.md,
    padding: space[3],
  },
});
