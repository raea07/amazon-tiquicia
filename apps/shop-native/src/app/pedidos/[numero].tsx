import {
  awaitingNewAttemptLine,
  cancellationWords,
  deliveryFeeComesBack,
  deliveryFeeKeptLine,
  isRescheduledShipment,
  isStoppedShipment,
  ORDER_STATUS_LABEL,
  orderAwaitingNewAttempt,
  orderComingBack,
  toCostaRicaTime,
  waitsForNewAttempt,
} from "@yuntera/core";
import {
  ApiError,
  type OrderDetailWithRecall as OrderDetail,
  type OrderPayment,
} from "@yuntera/db";
import { useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam, signInPath } from "@yuntera/expo-kit/paths";
import { colors, fontFamily, radius, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  formatDateTime,
  formatPrice,
  InfoRow,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextLink,
} from "@yuntera/expo-kit/ui";
import { Link, Stack as Nav, Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { OrderStatusBadge, ShipmentStatusBadge } from "@/components/badges";
import {
  GATEWAY_STAGES,
  GatewayPayment,
  MoneyInReview,
  RefundList,
  WAITING_STAGES,
} from "@/components/gateway-payment";
import { KeptNotice } from "@/components/kept-notice";
import {
  CancelOrder,
  Expandable,
  ReturnForm,
  ReviewForm,
  SimulatePayment,
  WithdrawReturn,
} from "@/components/order-actions";
import { ProductImage } from "@/components/product";
import { needsSignIn } from "@/lib/guard";
import {
  AMOUNT_UNREAD,
  firstReadFailed,
  orderNotice,
  RETURN_UNREAD,
  refreshFailed,
} from "@/lib/kept-reads";
import { PAYMENT_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/labels";
import { amountComingBack, refundedSoFar as refundedSoFarOf } from "@/lib/refund-outlook";
import { returnNextStep, returnTitle } from "@/lib/returns";

function describeEvent(event: OrderDetail["timeline"][number], order: OrderDetail): string {
  if (event.kind === "note") return event.note ?? "Nota";
  if (event.kind === "payment") return event.note ?? "Pago";
  if (event.kind === "order_status" && event.to_status === "cancelled") {
    return cancellationWords(order.cancel_reason, false).history;
  }
  if (event.kind === "order_status" && event.to_status && event.to_status in ORDER_STATUS_LABEL) {
    return ORDER_STATUS_LABEL[event.to_status as keyof typeof ORDER_STATUS_LABEL]["es-CR"];
  }
  if (
    event.kind === "shipment_status" &&
    event.to_status &&
    event.to_status in SHIPMENT_STATUS_LABEL
  ) {
    return `Paquete: ${SHIPMENT_STATUS_LABEL[event.to_status as keyof typeof SHIPMENT_STATUS_LABEL].toLowerCase()}`;
  }
  return event.to_status ?? "Actualización";
}

function PaymentInstructions({ order, payment }: { order: OrderDetail; payment: OrderPayment }) {
  // The simulation only while the site is in sandbox mode, whatever mode the order was placed in.
  const sandbox = payment.stage === "simulated";
  const warn = colors.palette.maiz[900];
  if (order.payment_method === "card" && !sandbox) {
    // A card order no gateway can take any more (placed before the payments set-up changed).
    return (
      <View style={styles.payment} testID="payment-instructions">
        <Text variant="heading" style={{ color: warn }}>
          Este pedido ya no se puede pagar en línea
        </Text>
        <Text variant="small" style={{ color: warn }}>
          No se le ha cobrado nada. Haga el pedido de nuevo para pagarlo con tarjeta; este se
          cancela solo cuando se acabe el tiempo de reserva.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.payment} testID="payment-instructions">
      <Text variant="heading" style={{ color: warn }}>
        Falta el pago de {formatPrice(order.total_minor)}
      </Text>
      {order.payment_method === "sinpe_movil" ? (
        <Stack gap={1}>
          <Text variant="small" style={{ color: warn }}>
            1. Abra la aplicación de su banco y elija SINPE Móvil.
          </Text>
          <Text variant="small" style={{ color: warn }}>
            2. Envíe exactamente{" "}
            <Text variant="smallStrong" style={{ color: warn }}>
              {formatPrice(order.total_minor)}
            </Text>{" "}
            al número que le indicamos.
          </Text>
          <Text variant="small" style={{ color: warn }}>
            3. En el detalle escriba el código{" "}
            <Text variant="smallStrong" style={{ color: warn }} testID="sinpe-reference">
              {order.payment?.sinpe_reference}
            </Text>
            .
          </Text>
        </Stack>
      ) : (
        <Text variant="small" style={{ color: warn }}>
          Complete el pago con su tarjeta en la página segura del procesador de pagos.
        </Text>
      )}
      <Text variant="small" style={{ color: warn }}>
        Guardamos sus productos por 30 minutos. Si no recibimos el pago, el pedido se cancela solo y
        no se le cobra nada.
      </Text>
      {sandbox ? (
        <View style={styles.sandbox}>
          <Text variant="small" style={{ color: warn }}>
            <Text variant="smallStrong" style={{ color: warn }}>
              Modo de prueba:{" "}
            </Text>
            este sitio todavía no está conectado a un procesador de pagos. Use este botón para
            simular que el pago llegó.
          </Text>
          <SimulatePayment orderId={order.id} orderNumber={order.order_number} />
        </View>
      ) : null}
    </View>
  );
}

/** One order, at /pedidos/<número> like the website: payment, delivery code, tracking, and what can still be done. */
export default function OrderScreen() {
  const params = useLocalSearchParams<{ numero: string; nuevo?: string }>();
  const number = oneParam(params.numero) ?? "";
  const { status } = useSession();
  const order = useApiQuery(["order", number], (api) => api.getOrder(number), { personal: true });
  // Where each return stands, so the screen can say what happens next. Read
  // once the order is on screen (also when a refresh of the order failed and
  // the screen keeps it).
  const returns = useApiQuery(["order-returns", number], (api) => api.myOrderReturns(number), {
    personal: true,
    enabled: order.data !== undefined,
  });
  // How its payment stands at the gateway; asked again while it changes on its own.
  const payment = useApiQuery(["order-payment", number], (api) => api.orderPayment(number), {
    personal: true,
    enabled: order.data !== undefined,
    refetchInterval: (query) => {
      const stage = query.state.data?.stage;
      return stage && WAITING_STAGES.includes(stage) ? 3000 : false;
    },
  });

  // A pull, and every "Intentar de nuevo" on this page: the order, its
  // payment and its returns, all three read again.
  const [pulling, setPulling] = useState(false);
  const readAgain = () => {
    setPulling(true);
    void Promise.allSettled([order.refetch(), payment.refetch(), returns.refetch()]).finally(() =>
      setPulling(false),
    );
  };

  if (needsSignIn(status)) return <Redirect href={signInPath(`/pedidos/${number}`)} />;
  if (order.isPending) return <LoadingState label="Cargando su pedido…" />;
  if (firstReadFailed(order)) {
    // Someone else's order and one that does not exist look the same: not found.
    if (order.error instanceof ApiError && order.error.code === "order_not_found") {
      return (
        <EmptyState
          title="No encontramos ese pedido"
          action={<LinkButton href="/pedidos">Ver sus pedidos</LinkButton>}
        >
          Revise el número. Solo puede ver los pedidos de su propia cuenta.
        </EmptyState>
      );
    }
    return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  }
  if (!order.data) return <LoadingState label="Cargando su pedido…" />;

  const o = order.data;
  // The payment could not be read at all: no amount is said, and the page says why.
  const paymentUnread = firstReadFailed(payment);
  const today = toCostaRicaTime(new Date()).date;
  const delivered = o.status === "delivered" || o.status === "completed";
  const withdrawalOpen = delivered && today <= o.withdrawal_deadline;
  const warrantyOpen = delivered && o.warranty_until !== null && today <= o.warranty_until;
  const awaitingPayment = o.status === "pending_payment";
  // Every parcel still to deliver is on its way back to the warehouse
  // (stopped by staff, or sent back after a route): nothing reaches the
  // shopper, so no "En camino", no date and no delivery code.
  const back = orderComingBack(o.status, o.shipments);
  // Or every parcel left waits in the warehouse to go out again: no "En
  // camino" and no old date either.
  const waiting = back ? null : orderAwaitingNewAttempt(o.status, o.shipments);
  // Money held for the shopper, so a cancellation gives some back.
  const paid = ["captured", "partially_refunded"].includes(o.payment?.status ?? "");
  const refunds = payment.data?.refunds ?? [];
  // Zero only once the payment has answered; until then the refunds already
  // made are unknown, and no amount is said (see refund-outlook.ts).
  const refundedSoFar = refundedSoFarOf(payment.data?.refunds) ?? 0;
  const feeBack = deliveryFeeComesBack(o.shipments);
  // One notice for whatever could not be read, with one "Intentar de nuevo".
  const notice = orderNotice({
    orderStale: refreshFailed(order),
    payment: paymentUnread ? "unread" : refreshFailed(payment) ? "stale" : "ok",
    returnsUnread: firstReadFailed(returns) && o.items.some((item) => item.returned_quantity > 0),
  });
  const noticeError =
    notice?.cause === "order"
      ? order.error
      : notice?.cause === "payment"
        ? payment.error
        : returns.error;
  // What comes back when the warehouse receives them: what is left of the
  // payment, less the delivery fee when someone went to the door.
  const comesBack = amountComingBack({
    paymentMinor: o.payment?.amount_minor ?? 0,
    refunds: payment.data?.refunds,
    feeBack,
    shippingMinor: o.shipping_minor,
  });
  // Why the delivery fee stays charged, when the order is (being) cancelled
  // after a real attempt at the door (the web's words).
  const feeKept =
    back?.cancels || (o.status === "cancelled" && refundedSoFar > 0)
      ? deliveryFeeKeptLine({
          shipments: o.shipments,
          shippingMinor: o.shipping_minor,
          paid: paid || refundedSoFar > 0,
          fee: formatPrice(o.shipping_minor),
        })
      : null;

  // Why it was cancelled, and what to do next (the reason stored on the order;
  // the web's words).
  const why =
    o.cancelled_at !== null && ["cancelled", "refunded"].includes(o.status) && !back
      ? cancellationWords(
          o.cancel_reason,
          paid || refundedSoFar > 0 || o.payment?.status === "refunded",
        )
      : null;

  return (
    <Screen refreshing={pulling} onRefresh={readAgain}>
      <Nav.Screen options={{ title: o.order_number }} />
      {notice ? (
        <KeptNotice
          title={notice.title}
          body={notice.body}
          error={noticeError}
          onRetry={readAgain}
          retrying={pulling || order.isFetching || payment.isFetching || returns.isFetching}
          testID={notice.testID}
        />
      ) : null}
      {oneParam(params.nuevo) === "1" ? (
        <Alert tone="success" title="¡Recibimos su pedido!">
          {awaitingPayment
            ? "Complete el pago para que empecemos a prepararlo."
            : "Ya lo estamos preparando. Aquí puede seguirlo en todo momento."}
        </Alert>
      ) : null}

      <Stack gap={1}>
        <Text variant="title" testID="order-title">
          Pedido {o.order_number}
        </Text>
        {/* Not "En camino" when no parcel is on its way to the shopper any more. */}
        {back ? (
          <Badge tone="warning">
            {back.cancels ? "Se está cancelando" : "Un paquete regresa a la bodega"}
          </Badge>
        ) : waiting ? (
          <Badge tone="info">Entrega reprogramada</Badge>
        ) : (
          <OrderStatusBadge status={o.status} />
        )}
        <Text tint="muted">
          Realizado el {formatDate(o.placed_at, { day: "numeric", month: "long", year: "numeric" })}
        </Text>
      </Stack>

      {why ? (
        <Alert tone="info" title={why.title} testID="order-cancel-reason">
          {why.body}
        </Alert>
      ) : null}
      {awaitingPayment && payment.data && GATEWAY_STAGES.includes(payment.data.stage) ? (
        <GatewayPayment payment={payment.data} />
      ) : awaitingPayment && payment.data ? (
        <PaymentInstructions order={o} payment={payment.data} />
      ) : null}
      {payment.isPending && payment.isFetching ? (
        // Until the payment answers (or its read times out) no amount is said.
        <Text variant="small" tint="muted" testID="payment-loading">
          Consultando su pago…
        </Text>
      ) : null}
      {payment.data?.money_in_review && !(awaitingPayment && payment.data.stage === "review") ? (
        <MoneyInReview payment={payment.data} />
      ) : null}
      {back ? (
        <Alert
          tone="warning"
          title={
            back.cancels ? "Estamos cancelando su pedido" : "Un paquete regresa a nuestra bodega"
          }
          testID="order-stopping"
        >
          {`${
            back.stopped
              ? "Detuvimos su pedido en nuestra bodega: ya no saldrá hacia usted. "
              : back.cancels
                ? "Su pedido regresa a nuestra bodega sin entregarse. "
                : "Un paquete de su pedido regresa a nuestra bodega sin entregarse. "
          }${
            !paid
              ? back.cancels
                ? "No se le cobró nada, así que no hay nada que devolver."
                : ""
              : back.cancels
                ? comesBack === null
                  ? `Cuando la bodega confirme que lo recibió, le devolvemos su dinero por el mismo medio con que pagó.${
                      paymentUnread ? ` ${AMOUNT_UNREAD}` : ""
                    }${feeKept ? ` ${feeKept}` : ""}`
                  : `Cuando la bodega confirme que lo recibió, le devolvemos ${formatPrice(comesBack)}${
                      feeBack && o.shipping_minor > 0 ? ", el envío incluido," : ""
                    } por el mismo medio con que pagó.${feeKept ? ` ${feeKept}` : ""}`
                : "Cuando la bodega lo reciba, le devolvemos lo que pagó por ese paquete."
          }`.trim()}
        </Alert>
      ) : null}
      {payment.data ? <RefundList payment={payment.data} /> : null}
      {feeKept && !back ? (
        <Text variant="small" testID="fee-kept">
          {feeKept}
        </Text>
      ) : null}
      {refunds.length > 1 ? (
        <Text variant="small" testID="refund-total">
          {`En total le devolvemos ${formatPrice(refundedSoFar)}${
            refundedSoFar === o.total_minor && o.shipping_minor > 0
              ? ": todo lo que pagó, el envío incluido."
              : "."
          }`}
        </Text>
      ) : null}

      {o.delivery_pin && !back ? (
        <View style={styles.pin} testID="delivery-code">
          <Text variant="heading">Su código de entrega</Text>
          <Text
            style={styles.pinDigits}
            aria-label={`Código ${o.delivery_pin.split("").join(" ")}`}
            testID="delivery-pin"
          >
            {o.delivery_pin}
          </Text>
          <Text variant="small" tint="muted">
            Dígaselo al repartidor solo cuando tenga el paquete en sus manos. Es la prueba de que
            usted lo recibió; nadie de Yuntera se lo va a pedir por teléfono ni por mensaje.
          </Text>
        </View>
      ) : null}

      <Stack gap={3}>
        <Text variant="heading">Entrega</Text>
        {delivered && o.delivered_at ? (
          <Text variant="bodyStrong" tint="success">
            Entregado el {formatDateTime(o.delivered_at)}
          </Text>
        ) : o.status === "cancelled" || o.status === "refunded" || back ? null : waiting ? (
          <Text variant="bodyStrong" testID="awaiting-new-attempt">
            {awaitingNewAttemptLine(waiting.failedAttempt)}
          </Text>
        ) : (
          <Text variant="bodyStrong" tint="success">
            {o.promise_earliest === o.promise_latest
              ? `Llega el ${formatDate(o.promise_latest)}`
              : `Llega entre el ${formatDate(o.promise_earliest)} y el ${formatDate(o.promise_latest)}`}
          </Text>
        )}
        <Text variant="small" tint="muted">
          {o.address.recipient_name} · {o.address.senas}. {o.address.district}, {o.address.canton}.
        </Text>
        {o.shipments.map((shipment, index) => (
          <Card key={shipment.id}>
            <View style={styles.shipmentHead}>
              <Text variant="bodyStrong">
                {o.shipments.length > 1
                  ? `Paquete ${index + 1} de ${o.shipments.length}`
                  : "Paquete"}
              </Text>
              {isStoppedShipment(shipment.status, shipment.recalled) ? (
                <Badge tone="warning">Detenido en la bodega</Badge>
              ) : isRescheduledShipment(shipment.status, shipment.attempt_count) ||
                waitsForNewAttempt(shipment.status, shipment.attempt_count) ? (
                <Badge tone="info">Entrega reprogramada</Badge>
              ) : (
                <ShipmentStatusBadge status={shipment.status} />
              )}
            </View>
            <Text variant="small" tint="muted">
              {shipment.tracking_code}
            </Text>
            {shipment.driver_first_name ? (
              <Text variant="small">
                {shipment.driver_first_name} va en camino con su paquete. Tenga a mano su código de
                entrega.
              </Text>
            ) : null}
            {isStoppedShipment(shipment.status, shipment.recalled) ? (
              <Text variant="small">
                {`Este paquete no saldrá de nuestra bodega.${
                  paid
                    ? " Le devolvemos lo que pagó por él cuando la bodega confirme que lo recibió."
                    : ""
                }`}
              </Text>
            ) : shipment.status === "returning" ? (
              <Text variant="small">
                {`Este paquete regresa a nuestra bodega sin entregarse.${
                  paid ? " Le devolvemos lo que pagó por él cuando la bodega lo reciba." : ""
                }`}
              </Text>
            ) : isRescheduledShipment(shipment.status, shipment.attempt_count) ||
              waitsForNewAttempt(shipment.status, shipment.attempt_count) ? (
              <Text variant="small">
                Reprogramamos la entrega de este paquete. Le avisaremos cuando vuelva a salir hacia
                usted; si necesita cambiar algo, escríbanos.
              </Text>
            ) : shipment.status === "delivery_failed" ? (
              <Text variant="small" tint="warning">
                No pudimos entregarlo. Lo intentaremos de nuevo el próximo día hábil; si necesita
                cambiar algo, escríbanos.
              </Text>
            ) : null}
          </Card>
        ))}
      </Stack>

      <Stack gap={3}>
        <Text variant="heading">Productos</Text>
        {o.items.map((item) => {
          const returnable = item.quantity - item.returned_quantity;
          const itemReturns = (returns.data ?? []).filter(
            (entry) => entry.order_item_id === item.id,
          );
          return (
            <Card key={item.id}>
              <View style={styles.item}>
                <ProductImage path={item.image_path} size={64} />
                <View style={styles.flex}>
                  {item.product_slug ? (
                    <Link href={{ pathname: "/p/[slug]", params: { slug: item.product_slug } }}>
                      <Text variant="bodyStrong">{item.title}</Text>
                    </Link>
                  ) : (
                    <Text variant="bodyStrong">{item.title}</Text>
                  )}
                  <Text variant="small" tint="muted">
                    {item.variant_name ? `${item.variant_name} · ` : ""}
                    {item.quantity} × {formatPrice(item.unit_price_minor)} · Vendido por{" "}
                    {item.seller_name}
                  </Text>
                </View>
                <Text variant="bodyStrong" style={styles.amount}>
                  {formatPrice(item.line_total_minor)}
                </Text>
              </View>
              {delivered ? (
                <>
                  <Expandable
                    title={
                      item.review
                        ? `Su reseña: ${item.review.rating} de 5 (editar)`
                        : "Escribir una reseña"
                    }
                  >
                    <ReviewForm orderItemId={item.id} orderNumber={o.order_number} />
                  </Expandable>
                  {returnable > 0 && (withdrawalOpen || warrantyOpen) ? (
                    <Expandable title="Devolver o reclamar garantía">
                      <ReturnForm
                        orderItemId={item.id}
                        orderNumber={o.order_number}
                        maxQuantity={returnable}
                        withdrawalOpen={withdrawalOpen}
                      />
                    </Expandable>
                  ) : null}
                </>
              ) : null}
              {itemReturns.length > 0 ? (
                <View style={styles.returns} testID="return-status">
                  {itemReturns.map((entry) => (
                    <View key={entry.id} style={styles.returnRow}>
                      <Text variant="smallStrong">{returnTitle(entry)}</Text>
                      <Text variant="small">{returnNextStep(entry)}</Text>
                      {entry.can_withdraw ? (
                        <Expandable title="¿La abrió por error? Retirar la solicitud">
                          <WithdrawReturn returnId={entry.id} orderNumber={o.order_number} />
                        </Expandable>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : item.returned_quantity > 0 && returns.isPending ? (
                <Text variant="small" tint="muted">
                  Devolución en trámite.
                </Text>
              ) : item.returned_quantity > 0 && firstReadFailed(returns) ? (
                <Text variant="small" tint="warning" testID="return-unread">
                  {`Devolución en trámite. ${RETURN_UNREAD}`}
                </Text>
              ) : null}
            </Card>
          );
        })}
      </Stack>

      <Card>
        <Text variant="heading">Resumen</Text>
        <InfoRow label="Productos" value={formatPrice(o.items_total_minor)} />
        <InfoRow
          label="Envío"
          value={o.shipping_minor === 0 ? "Gratis" : formatPrice(o.shipping_minor)}
        />
        <InfoRow strong label="Total" value={formatPrice(o.total_minor)} />
        <Text variant="caption" tint="muted">
          Incluye {formatPrice(o.tax_included_minor)} de IVA.
        </Text>
        <Text variant="small">
          <Text variant="small" tint="muted">
            Pago:{" "}
          </Text>
          {PAYMENT_LABEL[o.payment_method]}
          {o.payment?.status === "captured" ? " · recibido" : ""}
          {o.payment?.status === "refunded" ? " · reembolsado" : ""}
          {o.payment?.status === "partially_refunded" ? " · reembolsado en parte" : ""}
        </Text>
      </Card>

      {delivered ? (
        <Card>
          <Text variant="bodyStrong">Sus derechos sobre esta compra</Text>
          <Text variant="small" tint="muted">
            Devolución sin dar motivo hasta el {formatDate(o.withdrawal_deadline)}.
          </Text>
          {o.warranty_until ? (
            <Text variant="small" tint="muted">
              Garantía legal hasta el{" "}
              {formatDate(o.warranty_until, { day: "numeric", month: "long", year: "numeric" })}.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {o.can_cancel ? (
        <Card>
          <Text variant="bodyStrong">¿Cambió de opinión?</Text>
          <Text variant="small" tint="muted">
            Puede cancelar mientras no hayamos empezado a prepararlo.
          </Text>
          <CancelOrder orderId={o.id} orderNumber={o.order_number} />
        </Card>
      ) : null}

      <Stack gap={2}>
        <Text variant="heading">Historial</Text>
        <View style={styles.timeline}>
          {o.timeline.map((event) => (
            <View key={`${event.at}-${event.kind}-${event.to_status ?? ""}`} style={styles.event}>
              <Text variant="smallStrong">{describeEvent(event, o)}</Text>
              <Text variant="small" tint="muted">
                {formatDateTime(event.at)}
              </Text>
            </View>
          ))}
        </View>
      </Stack>

      <View>
        <Text variant="small" tint="muted">
          ¿Algo no salió bien?
        </Text>
        <TextLink href="/ayuda">Presente un reclamo</TextLink>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  returns: { gap: space[2] },
  returnRow: {
    gap: space[1],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  flex: { flex: 1, gap: 2 },
  payment: {
    gap: space[3],
    borderWidth: 1,
    borderColor: colors.palette.maiz[300],
    backgroundColor: colors.palette.maiz[50],
    borderRadius: radius.lg,
    padding: space[4],
  },
  sandbox: {
    gap: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.palette.maiz[300],
    paddingTop: space[3],
  },
  pin: {
    gap: space[2],
    borderWidth: 2,
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
    padding: space[5],
  },
  pinDigits: {
    fontFamily: fontFamily.display,
    fontWeight: "800",
    fontSize: 52,
    lineHeight: 60,
    letterSpacing: 10,
    color: colors.link,
    fontVariant: ["tabular-nums"],
  },
  shipmentHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  item: { flexDirection: "row", gap: space[3] },
  amount: { fontVariant: ["tabular-nums"] },
  timeline: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: space[4],
    gap: space[2],
  },
  event: { gap: 0 },
});
