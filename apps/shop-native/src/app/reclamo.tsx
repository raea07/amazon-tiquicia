import { brand } from "@yuntera/brand";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_DESCRIPTION_MAX,
  COMPLAINT_PROMISE,
  type ComplaintCategory,
  checkComplaint,
  complaintFiledText,
} from "@yuntera/core";
import { messageOf } from "@yuntera/expo-kit/api";
import { useSession } from "@yuntera/expo-kit/auth";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { oneParam, signInPath } from "@yuntera/expo-kit/paths";
import {
  Button,
  Card,
  ChoiceList,
  FormMessage,
  formatDate,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { needsSignIn } from "@/lib/guard";

const ORDER_NUMBER = /^YT-\d{4,12}$/;

/**
 * Presentar un reclamo (the website's /reclamo): the free complaint form,
 * opened from an order's screen (?pedido=YT-…) or from Ayuda. It needs an
 * account; once filed it says the reference and the dates by which the
 * acknowledgement and the written answer are promised, and the answer is
 * read in "Sus consultas" and on the order's screen.
 */
export default function ComplaintScreen() {
  const params = useLocalSearchParams<{ pedido?: string }>();
  const fromOrder = oneParam(params.pedido);
  const orderFromLink = fromOrder && ORDER_NUMBER.test(fromOrder) ? fromOrder : "";
  const { status } = useSession();
  const [category, setCategory] = useState<ComplaintCategory | null>(null);
  const [orderNumber, setOrderNumber] = useState(orderFromLink);
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const file = useApiMutation(
    async (api, input: Parameters<typeof api.fileComplaint>[0]) => {
      const complaintId = await api.fileComplaint(input);
      return api.myComplaintReceipt(complaintId);
    },
    // The account's list and every order's list of cases (keys are prefixes).
    { invalidates: [["my-cases"], ["order-cases"]] },
  );

  if (needsSignIn(status)) {
    return (
      <Redirect
        href={signInPath(orderFromLink ? `/reclamo?pedido=${orderFromLink}` : "/reclamo")}
      />
    );
  }
  if (status === "loading") return <LoadingState />;

  async function send() {
    if (file.isPending) return;
    setResult({});
    const checked = checkComplaint({ category, description, orderNumber });
    if ("error" in checked) {
      setResult({ error: checked.error });
      return;
    }
    try {
      const receipt = await file.mutateAsync(checked.input);
      setResult({
        ok: complaintFiledText({
          reference: receipt.reference,
          answerBy: formatDate(receipt.answer_by),
        }),
      });
    } catch (error) {
      setResult({ error: messageOf(error) });
    }
  }

  return (
    <Screen>
      <Text tint="muted">{COMPLAINT_PROMISE}</Text>
      <Card testID="complaint-form">
        {result.ok ? (
          <Stack gap={3}>
            <FormMessage ok={result.ok} testID="complaint-message" />
            <LinkButton href="/cuenta/casos" variant="secondary" testID="complaint-cases">
              Ver sus consultas
            </LinkButton>
          </Stack>
        ) : (
          <Stack gap={4}>
            <Text variant="smallStrong">¿De qué trata su reclamo?</Text>
            <ChoiceList
              label="¿De qué trata su reclamo?"
              value={category}
              onChange={setCategory}
              choices={COMPLAINT_CATEGORIES.map(([value, title]) => ({ value, title }))}
              testID="complaint-category"
            />
            <TextField
              label="Número de pedido"
              optional
              value={orderNumber}
              onChangeText={setOrderNumber}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
              hint="Si el reclamo es sobre un pedido, por ejemplo YT-100123. Lo ve en «Sus pedidos»."
              testID="complaint-order"
            />
            <TextField
              label="Qué pasó"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={COMPLAINT_DESCRIPTION_MAX}
              hint="Cuéntenos qué pasó y qué espera de nosotros. De 10 a 4000 caracteres. No escriba su código de entrega ni datos de tarjetas."
              testID="complaint-description"
            />
            <FormMessage error={result.error} testID="complaint-message" />
            <Button
              loading={file.isPending}
              loadingLabel="Enviando…"
              onPress={send}
              testID="complaint-submit"
            >
              Enviar el reclamo
            </Button>
          </Stack>
        )}
      </Card>
      <Text variant="small" tint="muted">
        También puede escribirnos a {brand.support.email}. Si no queda conforme con nuestra
        respuesta, puede acudir a la Comisión Nacional del Consumidor del Ministerio de Economía,
        Industria y Comercio.
      </Text>
    </Screen>
  );
}
