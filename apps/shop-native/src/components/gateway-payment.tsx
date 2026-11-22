import { useQueryClient } from "@tanstack/react-query";
import type { Api, OrderPayment, SinpePayer } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApi } from "@yuntera/expo-kit/auth";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import {
  Badge,
  Button,
  ChoiceList,
  FormMessage,
  formatDateTime,
  formatPrice,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

/** Stages in which the payment goes through the gateway (test and live modes). */
export const GATEWAY_STAGES: ReadonlyArray<OrderPayment["stage"]> = [
  "start",
  "preparing",
  "pay",
  "transfer",
  "confirming",
  "failed",
  "error",
  "review",
];

/** Stages that change on their own: the screen asks again every few seconds. */
export const WAITING_STAGES: ReadonlyArray<OrderPayment["stage"]> = [
  "preparing",
  "transfer",
  "confirming",
];

const DECLINE: Record<string, string> = {
  declined: "Su banco no aprobó el pago.",
  authentication_failed: "No se completó la verificación que pidió su banco.",
  insufficient_funds: "La tarjeta no tiene fondos suficientes.",
};

const localPhone = (e164: string | null | undefined) =>
  e164 ? `${e164.slice(-8, -4)}-${e164.slice(-4)}` : "";

/** Waits a few seconds for the worker to prepare the attempt at the gateway. */
async function prepared(api: Api, orderNumber: string): Promise<OrderPayment> {
  let payment = await api.orderPayment(orderNumber);
  for (let i = 0; i < 16 && payment.stage === "preparing"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    payment = await api.orderPayment(orderNumber);
  }
  return payment;
}

type PayerKind = SinpePayer["kind"];
const KINDS = [
  { value: "national" as PayerKind, title: "Cédula de identidad" },
  { value: "resident" as PayerKind, title: "DIMEX (residente)" },
  { value: "legal_entity" as PayerKind, title: "Cédula jurídica (empresa)" },
];

/**
 * Paying an order through the gateway. A card is typed only on the
 * gateway's own page, opened in the phone's browser (expo-web-browser), which
 * comes back to the app by its link; the app never holds a card field. The
 * order is paid when the gateway says so, so after the browser closes the
 * screen says "confirming" and asks again until it is.
 */
export function GatewayPayment({ payment }: { payment: OrderPayment }) {
  const api = useApi();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const [kind, setKind] = useState<PayerKind | null>(null);
  const [number, setNumber] = useState("");
  const [phone, setPhone] = useState("");
  const amount = formatPrice(payment.amount_minor);
  const card = payment.method === "card";
  const refresh = () =>
    client.invalidateQueries({ predicate: (q) => q.queryKey.includes(payment.order_number) });

  async function payByCard(existing?: string | null) {
    setBusy(true);
    setResult({});
    try {
      let url = existing ?? null;
      if (!url) {
        await api.startPayment(payment.order_id, { returnTo: "app" });
        url = (await prepared(api, payment.order_number)).attempt?.checkout_url ?? null;
      }
      if (url) {
        await WebBrowser.openAuthSessionAsync(url, `yuntera://pedidos/${payment.order_number}`);
        // Back from the gateway's page: only a hint, a check is asked for now.
        await api.paymentReturned(payment.order_id).catch(() => null);
      }
    } catch (error) {
      setResult({ error: messageOf(error) });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function payBySinpe() {
    if (!kind) {
      setResult({ error: "Elija el tipo de identificación de quien paga." });
      return;
    }
    setBusy(true);
    setResult({});
    try {
      await api.startPayment(payment.order_id, { payer: { kind, number, phone }, returnTo: "app" });
      await prepared(api, payment.order_number);
    } catch (error) {
      setResult({ error: messageOf(error) });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const sinpeForm = (submit: string) => (
    <Stack gap={3}>
      <ChoiceList
        label="Identificación de quien paga"
        choices={KINDS}
        value={kind}
        onChange={setKind}
        testID="payer-kind"
      />
      <TextField
        label="Número de identificación"
        value={number}
        onChangeText={setNumber}
        keyboardType="number-pad"
        hint="Tal como lo tiene su banco. Ejemplo: 1-1393-1919."
        testID="payer-number"
      />
      <TextField
        label="Celular con SINPE Móvil desde el que paga"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        hint="8 dígitos. Solo se acepta la transferencia que salga de esa cuenta."
        testID="payer-phone"
      />
      <FormMessage {...result} />
      <Button
        block
        loading={busy}
        loadingLabel="Preparando la transferencia…"
        onPress={payBySinpe}
        testID="start-sinpe"
      >
        {submit}
      </Button>
    </Stack>
  );

  const cardButton = (label: string) => (
    <Stack gap={3}>
      <FormMessage {...result} />
      <Button
        block
        loading={busy}
        loadingLabel="Abriendo la página de pago…"
        onPress={() => payByCard()}
        testID="start-card"
      >
        {label}
      </Button>
    </Stack>
  );

  const until = `Guardamos sus productos hasta el ${formatDateTime(payment.expires_at)}; si no recibimos el pago, el pedido se cancela solo y no se le cobra nada.`;

  let body: React.ReactNode;
  switch (payment.stage) {
    case "start":
      body = (
        <>
          <Text variant="heading">Falta el pago de {amount}</Text>
          <Text variant="small">
            {card
              ? "Pague con su tarjeta en la página segura de ONVO, nuestro procesador de pagos, que se abre en el navegador. Su banco puede pedirle una confirmación adicional. Nosotros nunca vemos los datos de su tarjeta."
              : "Le pedimos la identificación y el celular de quien paga: ONVO, nuestro procesador de pagos, acepta solo una transferencia que salga de esa cuenta y por el monto exacto."}
          </Text>
          {card
            ? cardButton(`Pagar ${amount} con tarjeta`)
            : sinpeForm("Ver los datos para transferir")}
          <Text variant="small" tint="muted">
            {until}
          </Text>
        </>
      );
      break;
    case "preparing":
      body = (
        <>
          <Text variant="heading">Estamos preparando su pago</Text>
          <Text variant="small">Tarda unos segundos. Todavía no se le ha cobrado nada.</Text>
        </>
      );
      break;
    case "pay":
    case "confirming":
      body = (
        <>
          <Text variant="heading">
            {payment.stage === "pay" ? `Falta el pago de ${amount}` : "Estamos confirmando su pago"}
          </Text>
          <Text variant="small">
            {payment.stage === "pay"
              ? "Su página de pago está lista."
              : "Estamos esperando la confirmación del procesador. Suele tardar unos segundos. No vuelva a pagar."}
          </Text>
          {card && payment.attempt?.checkout_url ? (
            <Stack gap={3}>
              <FormMessage {...result} />
              <Button
                block
                variant={payment.stage === "pay" ? "primary" : "secondary"}
                loading={busy}
                onPress={() => payByCard(payment.attempt?.checkout_url)}
                testID="open-gateway"
              >
                {payment.stage === "pay" ? `Ir a pagar ${amount}` : "Volver a la página de pago"}
              </Button>
            </Stack>
          ) : null}
        </>
      );
      break;
    case "transfer":
      body = (
        <>
          <Text variant="heading">Haga la transferencia por SINPE Móvil</Text>
          <Text variant="small">
            1. Abra la aplicación de su banco, desde la cuenta del celular que nos indicó.
          </Text>
          <Text variant="small">
            2. Envíe exactamente <Text variant="smallStrong">{amount}</Text> al número{" "}
            <Text variant="smallStrong" testID="sinpe-number">
              {localPhone(payment.attempt?.sinpe_destination)}
            </Text>
            .
          </Text>
          <Text variant="small">
            3. Su banco mostrará como destinatario a ONVO, nuestro procesador de pagos, no a
            Yuntera. Es correcto.
          </Text>
          <Text variant="small">Cuando llegue, el pedido se confirma solo y le avisamos.</Text>
          <Text variant="small" tint="muted">
            {until}
          </Text>
        </>
      );
      break;
    case "failed":
    case "error":
      body = (
        <>
          <Text variant="heading">
            {payment.stage === "failed" ? "El pago no se completó" : "No pudimos preparar el pago"}
          </Text>
          <Text variant="small" tint="danger" role="alert">
            {payment.stage === "failed"
              ? `${DECLINE[payment.attempt?.failure_code ?? ""] ?? "El pago no se aprobó."} No se le cobró nada.`
              : "Hubo un problema al conectar con el procesador de pagos. No se le cobró nada."}
          </Text>
          {payment.can_start ? (
            card ? (
              cardButton(`Intentar de nuevo: pagar ${amount}`)
            ) : (
              sinpeForm("Intentar de nuevo")
            )
          ) : (
            <Text variant="small">
              Ya no se puede reintentar en este pedido. Haga el pedido de nuevo con otro medio de
              pago.
            </Text>
          )}
        </>
      );
      break;
    case "review":
      body = (
        <>
          <Text variant="heading">Estamos revisando su pago</Text>
          <Text variant="small">
            Recibimos un pago que no coincide con este pedido. Nuestro equipo de finanzas lo está
            revisando y le escribirá. No vuelva a pagar.
          </Text>
        </>
      );
      break;
    default:
      return null;
  }
  return (
    <View style={styles.box} testID="gateway-payment">
      <Stack gap={3}>{body}</Stack>
    </View>
  );
}

/** Refunds of the order: on their way until the gateway (or finance) confirms each. */
export function RefundList({ payment }: { payment: OrderPayment }) {
  if (payment.refunds.length === 0) return null;
  return (
    <View style={styles.refunds} testID="refunds">
      <Stack gap={2}>
        <Text variant="heading">Reembolsos</Text>
        {payment.refunds.map((refund) => (
          <Stack key={refund.id} gap={1}>
            <View style={styles.row}>
              <Text variant="smallStrong">{formatPrice(refund.amount_minor)}</Text>
              <Badge
                tone={
                  refund.status === "succeeded"
                    ? "success"
                    : refund.status === "failed"
                      ? "warning"
                      : "info"
                }
              >
                {refund.status === "succeeded"
                  ? "Completado"
                  : refund.status === "failed"
                    ? "En revisión"
                    : "En camino"}
              </Badge>
            </View>
            <Text variant="small" tint="muted">
              {refund.status === "succeeded"
                ? `Completado el ${formatDateTime(refund.completed_at ?? refund.requested_at)}.`
                : refund.status === "failed"
                  ? "Nuestro equipo de finanzas lo está resolviendo y le escribirá; no tiene que hacer nada."
                  : refund.channel === "transfer"
                    ? "Le haremos una transferencia y le escribiremos para pedirle la cuenta."
                    : "Va de vuelta al mismo medio con el que pagó; le avisamos cuando se complete."}
            </Text>
          </Stack>
        ))}
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.palette.maiz[50],
    borderColor: colors.palette.maiz[300],
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space[4],
  },
  refunds: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space[4],
  },
  row: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
