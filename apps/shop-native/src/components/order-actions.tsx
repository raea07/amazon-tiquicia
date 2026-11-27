import { returnRequestedText } from "@yuntera/core";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { colors, radius, space, touchTarget } from "@yuntera/expo-kit/theme";
import {
  Button,
  type Choice,
  ChoiceList,
  FormMessage,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { RETURN_WITHDRAWN, WITHDRAWAL_APPROVED } from "@/lib/returns";
import { QuantityStepper } from "./quantity";

/** In sandbox mode: pretend the payment arrived, as the website's button does. */
export function SimulatePayment({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: string;
}) {
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const pay = useApiMutation((api, id: string) => api.confirmSandboxPayment(id), {
    invalidates: [["order", orderNumber], ["orders"]],
  });
  return (
    <Stack gap={3}>
      <Button
        block
        loading={pay.isPending}
        loadingLabel="Registrando…"
        onPress={async () => {
          try {
            await pay.mutateAsync(orderId);
            setResult({ ok: "Pago de prueba registrado. Ya estamos preparando su pedido." });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
        testID="simulate-payment"
      >
        Simular pago (modo de prueba)
      </Button>
      <FormMessage {...result} />
    </Stack>
  );
}

/**
 * Cancelling asks once more before it happens: on a phone a stray tap is
 * easy, and the confirmation says what will happen with the money.
 */
export function CancelOrder({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const cancel = useApiMutation(
    (api, id: string) => api.cancelOrder(id, "Cancelado por el cliente"),
    { invalidates: [["order", orderNumber], ["orders"], ["product"], ["search"]] },
  );
  if (result.ok) return <FormMessage ok={result.ok} />;
  return (
    <Stack gap={3}>
      {confirming ? (
        <>
          <Text variant="smallStrong">¿Seguro que desea cancelar este pedido?</Text>
          <Button
            variant="danger"
            block
            loading={cancel.isPending}
            loadingLabel="Cancelando…"
            onPress={async () => {
              try {
                const outcome = await cancel.mutateAsync(orderId);
                setResult({
                  ok:
                    outcome.status === "refunded"
                      ? "Pedido cancelado. El reembolso va por el mismo medio con el que usted pagó."
                      : "Pedido cancelado. No se le cobró nada.",
                });
              } catch (error) {
                setResult({ error: messageOf(error) });
              }
            }}
          >
            Sí, cancelar el pedido
          </Button>
          <Button variant="ghost" block onPress={() => setConfirming(false)}>
            No, conservarlo
          </Button>
        </>
      ) : (
        <Button variant="secondary" block onPress={() => setConfirming(true)}>
          Cancelar pedido
        </Button>
      )}
      <FormMessage error={result.error} />
    </Stack>
  );
}

const STAR = "M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z";
const RATING_WORDS = ["", "Muy malo", "Malo", "Regular", "Bueno", "Excelente"];

/** One to five stars, each a full target, with the meaning written beside them. */
function StarPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="smallStrong">Su calificación</Text>
      <View role="radiogroup" aria-label="Su calificación" style={styles.stars}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable
            key={star}
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} ${star === 1 ? "estrella" : "estrellas"}: ${RATING_WORDS[star]}`}
            onPress={() => onChange(star)}
            style={styles.star}
          >
            <Svg width={30} height={30} viewBox="0 0 20 20" aria-hidden>
              <Path
                d={STAR}
                fill={star <= value ? colors.rating : colors.surface}
                stroke={star <= value ? colors.palette.maiz[700] : colors.fieldBorder}
                strokeWidth={1}
              />
            </Svg>
          </Pressable>
        ))}
      </View>
      <Text variant="small" tint="muted">
        {value ? `${value} de 5 — ${RATING_WORDS[value]}` : "Elija de 1 a 5 estrellas."}
      </Text>
    </View>
  );
}

export function ReviewForm({
  orderItemId,
  orderNumber,
}: {
  orderItemId: string;
  orderNumber: string;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const submit = useApiMutation(
    (api, input: Parameters<typeof api.submitReview>[0]) => api.submitReview(input),
    { invalidates: [["order", orderNumber], ["product"]] },
  );
  if (result.ok) return <FormMessage ok={result.ok} />;
  return (
    <Stack gap={3}>
      <StarPicker value={rating} onChange={setRating} />
      <TextField
        label="Cuéntele a otros compradores"
        optional
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={4000}
        hint="Su reseña se publica con su nombre y la inicial de su apellido."
      />
      <FormMessage error={result.error} />
      <Button
        variant="secondary"
        loading={submit.isPending}
        loadingLabel="Publicando…"
        onPress={async () => {
          if (rating < 1) {
            setResult({ error: "Elija de 1 a 5 estrellas." });
            return;
          }
          try {
            await submit.mutateAsync({ orderItemId, rating, body: body.trim() || null });
            setResult({ ok: "Gracias por su reseña. Ya está publicada." });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Publicar reseña
      </Button>
    </Stack>
  );
}

type ReturnKind = "withdrawal" | "warranty" | "damaged" | "wrong_item";

export function ReturnForm({
  orderItemId,
  orderNumber,
  maxQuantity,
  withdrawalOpen,
}: {
  orderItemId: string;
  orderNumber: string;
  maxQuantity: number;
  withdrawalOpen: boolean;
}) {
  // As on the website: while the withdrawal period is open, "Ya no lo quiero" is the default reason.
  const [kind, setKind] = useState<ReturnKind | null>(withdrawalOpen ? "withdrawal" : null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const request = useApiMutation(
    (api, input: Parameters<typeof api.requestReturn>[0]) => api.requestReturn(input),
    {
      invalidates: [
        ["order", orderNumber],
        ["order-returns", orderNumber],
      ],
    },
  );
  const kinds: Array<Choice<ReturnKind>> = [
    ...(withdrawalOpen
      ? [{ value: "withdrawal" as const, title: "Ya no lo quiero (sin dar motivo)" }]
      : []),
    { value: "damaged", title: "Llegó dañado" },
    { value: "wrong_item", title: "No es lo que pedí" },
    { value: "warranty", title: "Falló (garantía)" },
  ];
  if (result.ok) return <FormMessage ok={result.ok} />;
  return (
    <Stack gap={3}>
      <ChoiceList label="Motivo" value={kind} onChange={setKind} choices={kinds} />
      {maxQuantity > 1 ? (
        <View style={styles.quantity}>
          <Text variant="smallStrong">Cantidad</Text>
          <QuantityStepper value={quantity} max={maxQuantity} onChange={setQuantity} />
        </View>
      ) : null}
      <TextField
        label="Detalle"
        optional
        multiline
        value={reason}
        onChangeText={setReason}
        maxLength={2000}
        hint="No hace falta si simplemente ya no lo quiere. Para daños o garantía, cuéntenos qué pasó."
      />
      <FormMessage error={result.error} />
      <Button
        variant="secondary"
        loading={request.isPending}
        loadingLabel="Enviando…"
        onPress={async () => {
          if (!kind) {
            setResult({ error: "Elija el motivo." });
            return;
          }
          try {
            await request.mutateAsync({
              orderItemId,
              kind,
              quantity,
              reason: reason.trim() || null,
            });
            setResult({
              ok: kind === "withdrawal" ? WITHDRAWAL_APPROVED : returnRequestedText(kind),
            });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Solicitar devolución
      </Button>
    </Stack>
  );
}

/**
 * Withdraws a return request the shopper opened by mistake, while it still
 * waits for staff's decision (the database checks both).
 */
export function WithdrawReturn({
  returnId,
  orderNumber,
}: {
  returnId: string;
  orderNumber: string;
}) {
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const withdraw = useApiMutation((api, id: string) => api.withdrawReturnRequest(id), {
    invalidates: [
      ["order", orderNumber],
      ["order-returns", orderNumber],
    ],
  });
  if (result.ok) return <FormMessage ok={result.ok} />;
  return (
    <Stack gap={2}>
      <Text variant="small" tint="muted">
        Mientras no la revisemos, puede retirarla y, si después lo necesita, pedir la devolución de
        nuevo.
      </Text>
      <FormMessage error={result.error} />
      <Button
        variant="secondary"
        loading={withdraw.isPending}
        loadingLabel="Retirando…"
        testID={`withdraw-return-${returnId}`}
        onPress={async () => {
          try {
            await withdraw.mutateAsync(returnId);
            setResult({ ok: RETURN_WITHDRAWN });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Retirar la solicitud
      </Button>
    </Stack>
  );
}

/** A section that opens in place, like the website's <details>. */
export function Expandable({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.expandable}>
      <Pressable
        role="button"
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={styles.expandableHead}
      >
        <Text variant="smallStrong" tint="link">
          {open ? `${title} (cerrar)` : title}
        </Text>
      </Pressable>
      {open ? <View style={styles.expandableBody}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: "row", gap: 2 },
  star: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" },
  quantity: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  expandable: { borderTopWidth: 1, borderTopColor: colors.border },
  expandableHead: { minHeight: touchTarget, justifyContent: "center" },
  expandableBody: { paddingBottom: space[3], borderRadius: radius.md },
});
