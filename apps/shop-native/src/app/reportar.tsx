import { messageOf } from "@yuntera/expo-kit/api";
import { useApi, useSession } from "@yuntera/expo-kit/auth";
import { oneParam } from "@yuntera/expo-kit/paths";
import {
  Button,
  Card,
  ChoiceList,
  EmptyState,
  FormMessage,
  LinkButton,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  checkReport,
  REPORT_REASONS,
  REPORT_SENT,
  type ReportReason,
  reportTarget,
} from "@/lib/report";

/**
 * Reportar un problema (the website's /reportar?producto=…): if something in
 * the shop is illegal, dangerous, false or misleading. Opened from a
 * product's page; staff review every report.
 */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ producto?: string; resena?: string; tienda?: string }>();
  const target = reportTarget({
    producto: oneParam(params.producto),
    resena: oneParam(params.resena),
    tienda: oneParam(params.tienda),
  });
  const { status } = useSession();
  const api = useApi();
  const signedIn = status === "signedIn";
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  if (!target) {
    return (
      <Screen>
        <EmptyState
          title="No sabemos qué quiere reportar"
          action={<LinkButton href="/ayuda">Ir a la ayuda</LinkButton>}
        >
          Use el enlace «Reportar un problema» de la página del producto. Para otra cosa, escríbanos
          desde la página de ayuda.
        </EmptyState>
      </Screen>
    );
  }

  async function send() {
    if (busy || !target) return;
    setResult({});
    const checked = checkReport({ reason, details, email }, target, signedIn);
    if ("error" in checked) {
      setResult({ error: checked.error });
      return;
    }
    setBusy(true);
    try {
      await api.reportContent(checked.input);
      setResult({ ok: REPORT_SENT });
    } catch (error) {
      setResult({ error: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text tint="muted">
        Si algo en la tienda es ilegal, peligroso, falso o engañoso, avísenos. Revisamos cada
        reporte y, si incumple las reglas, lo retiramos.
      </Text>
      <Card testID="report-form">
        {result.ok ? (
          <FormMessage ok={result.ok} testID="report-message" />
        ) : (
          <Stack gap={4}>
            <Text variant="heading">Qué pasa con {target.label}</Text>
            <Text variant="smallStrong">¿Qué problema tiene?</Text>
            <ChoiceList
              label="¿Qué problema tiene?"
              value={reason}
              onChange={setReason}
              choices={REPORT_REASONS.map(([value, title]) => ({ value, title }))}
              testID="report-reason"
            />
            <TextField
              label="Detalles"
              optional
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={2000}
              hint="Lo que nos ayude a revisarlo: qué vio y dónde. Hasta 2000 caracteres."
              testID="report-details"
            />
            <TextField
              label="Su correo"
              optional={signedIn}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              maxLength={254}
              hint="Solo para escribirle sobre este reporte si necesitamos más datos. No le enviamos mensajes automáticos."
              testID="report-email"
            />
            <FormMessage error={result.error} testID="report-message" />
            <Button loading={busy} loadingLabel="Enviando…" onPress={send} testID="report-submit">
              Enviar el reporte
            </Button>
          </Stack>
        )}
      </Card>
    </Screen>
  );
}
