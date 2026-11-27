import { useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { signInPath } from "@yuntera/expo-kit/paths";
import {
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Screen,
  Text,
} from "@yuntera/expo-kit/ui";
import { Redirect } from "expo-router";
import { CaseAnswers } from "@/components/case-answers";
import { needsSignIn } from "@/lib/guard";

/**
 * Sus consultas (the website's /cuenta/casos): the shopper's complaints,
 * returns and contacts with what Yuntera answered. While no message provider
 * is connected, this and the order's screen are where an answer is read.
 * Pulling down reads them again.
 */
export default function CasesScreen() {
  const { status } = useSession();
  const cases = useApiQuery(["my-cases"], (api) => api.myCases(), {
    personal: true,
    staleTime: 0,
  });

  if (needsSignIn(status)) return <Redirect href={signInPath("/cuenta/casos")} />;
  if (cases.isPending) return <LoadingState />;
  if (cases.isError || !cases.data)
    return <ErrorState error={cases.error} onRetry={() => void cases.refetch()} />;

  return (
    <Screen refreshing={cases.isRefetching} onRefresh={() => void cases.refetch()}>
      <Text tint="muted">
        Sus reclamos, devoluciones y lo que nos consultó por WhatsApp, teléfono o correo, con
        nuestras respuestas.
      </Text>
      {cases.data.length === 0 ? (
        <EmptyState
          title="No tiene consultas"
          action={<LinkButton href="/reclamo">Presentar un reclamo</LinkButton>}
        >
          Si algo no salió bien, puede presentar un reclamo.
        </EmptyState>
      ) : (
        <CaseAnswers cases={cases.data} showOrder />
      )}
    </Screen>
  );
}
