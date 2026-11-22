import { useQueryClient } from "@tanstack/react-query";
import type { MyInvitation } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApi, useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormMessage,
  formatDate,
  LoadingState,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { useShops } from "@/lib/shops";
import { ROLE_INVITED_AS } from "@/lib/team";

const day = (value: string) => formatDate(value, { day: "numeric", month: "long" });

export const INVITATIONS_KEY = ["invitations"];

const DECLINED = "Rechazó la invitación. No se unió a la tienda.";

function InvitationCard({
  invitation,
  onDeclined,
}: {
  invitation: MyInvitation;
  /** Said by the list: once declined, the invitation leaves it and this card with it. */
  onDeclined: () => void;
}) {
  const api = useApi();
  const { reloadRoles, viewer } = useSession();
  const { choose, setTeamNotice } = useShops();
  const client = useQueryClient();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [result, setResult] = useState<{ error?: string }>({});

  async function answer(accept: boolean) {
    if (busy) return;
    setBusy(accept ? "accept" : "decline");
    setResult({});
    try {
      const shopId = await api.sellerAnswerInvitation(invitation.id, accept);
      if (accept) {
        // Inicio of the shop just joined says so; the roles say the person
        // now belongs to it, which opens the app on it.
        setTeamNotice({ kind: "joined", shopId });
        await choose(shopId);
        await reloadRoles();
      } else {
        onDeclined();
      }
      await client.invalidateQueries({
        queryKey: ["user", viewer?.id ?? "anonymous", ...INVITATIONS_KEY],
      });
    } catch (error) {
      setResult({ error: messageOf(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card testID="invitation">
      <Text variant="heading">{invitation.shop.trade_name}</Text>
      <Text variant="small">
        {invitation.invited_by_name ?? "La tienda"} le invitó a unirse como{" "}
        <Text variant="smallStrong">{ROLE_INVITED_AS[invitation.role]}</Text>. La invitación vence
        el {day(invitation.expires_at)}.
      </Text>
      <Text variant="small" tint="muted">
        Si acepta, podrá ver y trabajar en esta tienda desde Yuntera Vende. Si no conoce a esta
        tienda, rechácela.
      </Text>
      <FormMessage error={result.error} testID="invitation-message" />
      <Stack gap={2}>
        <Button
          block
          loading={busy === "accept"}
          loadingLabel="Uniéndome…"
          disabled={busy !== null}
          onPress={() => void answer(true)}
          testID="invitation-accept"
        >
          Aceptar y unirme
        </Button>
        <Button
          variant="secondary"
          block
          loading={busy === "decline"}
          loadingLabel="Un momento…"
          disabled={busy !== null}
          onPress={() => void answer(false)}
          testID="invitation-decline"
        >
          Rechazar
        </Button>
      </Stack>
    </Card>
  );
}

/**
 * Invitations to join a shop, addressed to the signed-in account (the seller
 * centre's /invitaciones). Nobody joins a shop without saying yes here.
 * `quietWhenEmpty` shows nothing when there are none (the screen for an
 * account without a shop, which has its own text).
 */
export function MyInvitations({ quietWhenEmpty = false }: { quietWhenEmpty?: boolean }) {
  const invitations = useApiQuery(INVITATIONS_KEY, (api) => api.myInvitations(), {
    personal: true,
    staleTime: 0,
  });
  const [declined, setDeclined] = useState(false);
  const notice = declined ? <FormMessage ok={DECLINED} testID="invitation-message" /> : null;
  if (invitations.isPending) return quietWhenEmpty ? notice : <LoadingState />;
  if (invitations.isError) {
    return quietWhenEmpty ? null : (
      <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
    );
  }
  if (invitations.data.length === 0) {
    return quietWhenEmpty ? (
      notice
    ) : (
      <Stack gap={3}>
        {notice}
        <EmptyState title="No tiene invitaciones">
          Cuando una tienda le invite con su correo, aparece aquí.
        </EmptyState>
      </Stack>
    );
  }
  return (
    <Stack gap={3}>
      {notice}
      {quietWhenEmpty ? <Text variant="heading">Le invitaron a una tienda</Text> : null}
      {invitations.data.map((invitation) => (
        <InvitationCard
          key={invitation.id}
          invitation={invitation}
          onDeclined={() => setDeclined(true)}
        />
      ))}
    </Stack>
  );
}
