import type { SellerPayouts } from "@yuntera/db";
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
  formatPrice,
  InfoRow,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextLink,
} from "@yuntera/expo-kit/ui";
import { View } from "react-native";
import { Stat, StatGrid } from "@/components/parts";
import { PAYMENT_METHOD, PAYOUT_STATUS } from "@/lib/labels";
import { shopKey, useShop } from "@/lib/shops";

const day = (value: string) => formatDate(value, { day: "numeric", month: "long" });
const dayWithYear = (value: string) =>
  formatDate(value, { day: "numeric", month: "short", year: "numeric" });
const charge = (amountMinor: number) => `− ${formatPrice(amountMinor)}`;

/** What, if anything, stands between this shop and its next payout (the web's `Notices`). */
function Notices({ money }: { money: SellerPayouts }) {
  const blocked = new Set(money.blocked_by);
  return (
    <Stack gap={2}>
      {blocked.has("no_bank_details") ? (
        <Alert tone="warning" title="Falta su cuenta bancaria">
          <Text variant="small">No podemos pagarle hasta tener una cuenta aprobada.</Text>
          <TextLink href="/cuenta">Registrar su cuenta en Cuenta</TextLink>
        </Alert>
      ) : null}
      {blocked.has("invalid_bank_details") ? (
        <Alert tone="warning" title="Su cuenta bancaria no es válida">
          <Text variant="small">
            La cuenta IBAN que tenemos registrada no pasa la revisión de sus dígitos, así que no
            podemos transferirle. Solicite el cambio de cuenta con la cuenta correcta.
          </Text>
          <TextLink href="/cuenta">Solicitar el cambio en Cuenta</TextLink>
        </Alert>
      ) : null}
      {blocked.has("shop_suspended") ? (
        <Alert tone="warning" title="Sus pagos están retenidos" testID="payouts-held">
          Su tienda está suspendida o todavía en verificación. Su saldo se conserva y se paga cuando
          la tienda vuelva a estar activa.
        </Alert>
      ) : null}
      {blocked.has("below_minimum") && money.available_minor > 0 ? (
        <Alert tone="info">
          {`Lo disponible todavía no llega a ${formatPrice(money.minimum_minor)}, el mínimo para una transferencia. Se acumula y se paga en cuanto lo alcance.`}
        </Alert>
      ) : null}
      {money.available_minor < 0 ? (
        <Alert tone="info">
          Su saldo disponible está en negativo por devoluciones posteriores a un pago. Se compensa
          solo con sus próximas ventas; no tiene que hacer nada.
        </Alert>
      ) : null}
    </Stack>
  );
}

/**
 * Pagos: what Yuntera owes the shop, split three ways (available, pending
 * and on its way to the bank), when it is paid and why it waits, the payouts
 * already made, and every sale with all its charges.
 */
export default function PayoutsScreen() {
  const shop = useShop();
  const payouts = useApiQuery(shopKey(shop.id, "payouts"), (api) => api.sellerPayouts(shop.id), {
    personal: true,
  });
  const statements = useApiQuery(
    shopKey(shop.id, "statements"),
    (api) => api.sellerStatements(shop.id, 100),
    { personal: true },
  );

  if (payouts.isPending || statements.isPending)
    return <LoadingState label="Cargando sus pagos…" />;
  if (payouts.isError)
    return <ErrorState error={payouts.error} onRetry={() => void payouts.refetch()} />;
  if (statements.isError)
    return <ErrorState error={statements.error} onRetry={() => void statements.refetch()} />;

  const money = payouts.data;

  return (
    <Screen
      edges={["left", "right"]}
      refreshing={payouts.isRefetching || statements.isRefetching}
      onRefresh={() => {
        void payouts.refetch();
        void statements.refetch();
      }}
    >
      <Stack gap={2}>
        <Text variant="title">Pagos</Text>
        <Text tint="muted">
          Lo que le debemos, cuándo se lo pagamos y cada venta con todos sus cargos.
        </Text>
      </Stack>

      <Stack gap={3}>
        <StatGrid>
          <Stat
            label="Disponible"
            value={formatPrice(money.available_minor)}
            hint={`De pedidos entregados hasta el ${day(money.delivered_through)}, menos devoluciones y lo ya pagado.`}
            testID="balance-available"
          />
          <Stat
            label="Pendiente"
            value={formatPrice(money.pending_minor)}
            hint={`Ventas todavía en camino o entregadas hace menos de ${money.hold_days} días.`}
            testID="balance-pending"
          />
          <Stat
            label="En tránsito"
            value={formatPrice(money.in_transit_minor)}
            hint="Pagos que ya programamos y van hacia su cuenta."
            testID="balance-in-transit"
          />
        </StatGrid>
        <Text>
          En total le debemos{" "}
          <Text
            variant="bodyStrong"
            style={{ fontVariant: ["tabular-nums"] }}
            testID="balance-total"
          >
            {formatPrice(money.payable_minor)}
          </Text>
          : la suma de los tres montos.
        </Text>
        <Notices money={money} />
      </Stack>

      <Card>
        <Text variant="heading">Cuándo le pagamos</Text>
        <Text variant="small" testID="payout-hold">
          {`Cada venta queda disponible ${money.hold_days} días después de que entregamos el pedido. En ese plazo el comprador todavía puede devolverlo, y así no tenemos que pedirle a usted dinero de vuelta. Cuando lo disponible llega a ${formatPrice(money.minimum_minor)}, se lo transferimos a su cuenta ${money.account.iban_masked ?? "bancaria"} en la siguiente corrida de pagos.`}
        </Text>
        {money.releases.length > 0 || money.awaiting_delivery_minor !== 0 ? (
          <>
            <Text variant="bodyStrong">Su saldo pendiente, por fecha</Text>
            {money.releases.map((release) => (
              <InfoRow
                key={release.on}
                label={`Disponible desde el ${day(release.on)}`}
                value={formatPrice(release.amount_minor)}
              />
            ))}
            {money.awaiting_delivery_minor !== 0 ? (
              <InfoRow
                label={`De pedidos que aún no entregamos (${money.hold_days} días después de la entrega)`}
                value={formatPrice(money.awaiting_delivery_minor)}
              />
            ) : null}
          </>
        ) : null}
      </Card>

      <Stack gap={3}>
        <Text variant="heading">Pagos que le hemos hecho</Text>
        {money.payouts.length === 0 ? (
          <Text variant="small" tint="muted">
            Todavía no le hemos hecho ningún pago. El primero aparece aquí con el comprobante del
            banco.
          </Text>
        ) : (
          money.payouts.map((payout) => {
            const status = PAYOUT_STATUS[payout.status];
            return (
              <Card key={payout.id}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                  <Text variant="figure" style={{ flex: 1 }}>
                    {formatPrice(payout.amount_minor)}
                  </Text>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </View>
                <InfoRow
                  label="Corte"
                  value={payout.cutoff_on ? dayWithYear(payout.cutoff_on) : "—"}
                />
                <InfoRow label="Cuenta" value={payout.iban_masked ?? "—"} />
                <InfoRow label="Detalle en su banco" value={payout.reference ?? "—"} />
                {payout.status === "paid" ? (
                  <InfoRow
                    label="Comprobante"
                    value={`${payout.bank_reference ?? ""}${payout.paid_at ? ` · ${dayWithYear(payout.paid_at)}` : ""}`}
                  />
                ) : null}
                {payout.status === "failed" ? (
                  <Text variant="small">
                    <Text variant="smallStrong">Qué pasó: </Text>
                    {payout.failure_reason ?? "El banco no completó la transferencia."} El monto
                    volvió a su saldo disponible.
                  </Text>
                ) : null}
              </Card>
            );
          })
        )}
      </Stack>

      <Stack gap={3}>
        <Text variant="heading">Detalle por pedido</Text>
        {statements.data.length === 0 ? (
          <EmptyState title="Aún no hay ventas cobradas">
            Una venta aparece aquí cuando el pago del comprador queda confirmado.
          </EmptyState>
        ) : (
          statements.data.map((row) => (
            <Card key={row.order_number} testID={`statement-${row.order_number}`}>
              <View style={{ flexDirection: "row", gap: space[2], alignItems: "baseline" }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {row.order_number}
                </Text>
                <Text variant="small" tint="muted">
                  {formatDate(row.placed_at, { day: "numeric", month: "short" })} ·{" "}
                  {PAYMENT_METHOD[row.payment_method] ?? row.payment_method}
                </Text>
              </View>
              <InfoRow label="Venta" value={formatPrice(row.items_gross_minor)} />
              <InfoRow label="Comisión" value={charge(row.referral_fee_minor)} />
              <InfoRow
                label="Bodega"
                value={row.fulfillment_fee_minor ? charge(row.fulfillment_fee_minor) : "—"}
              />
              <InfoRow label="Cobro" value={charge(row.payment_fee_minor)} />
              <InfoRow label="IVA de cargos" value={charge(row.fees_tax_minor)} />
              <Divider />
              <InfoRow label="Usted recibe" value={formatPrice(row.payout_minor)} strong />
            </Card>
          ))
        )}
        <Text variant="small" tint="muted">
          “Cobro” es lo que cobra el medio de pago que eligió el comprador; lo trasladamos sin
          recargo. Los cargos llevan 13 % de IVA y se los facturamos electrónicamente. El IVA de sus
          productos ya está dentro del precio de venta: usted lo recibe aquí y lo declara.
        </Text>
      </Stack>
    </Screen>
  );
}
