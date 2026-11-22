import { useQueryClient } from "@tanstack/react-query";
import type { SellerTeam } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useSession } from "@yuntera/expo-kit/auth";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  Divider,
  ErrorState,
  FormMessage,
  formatDate,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { shopKey, useShop, useShops } from "@/lib/shops";
import {
  canRevoke,
  checkInvite,
  INVITATION_REVOKED,
  type InvitableRole,
  invitationSent,
  LEAVE_UNTICKED,
  MEMBER_REMOVED,
  memberActions,
  ROLE_LABEL,
} from "@/lib/team";

type Member = SellerTeam["members"][number];
type Invitation = SellerTeam["invitations"][number];

const day = (value: string) => formatDate(value, { day: "numeric", month: "long" });
const ROLE_TONE = { owner: "info", admin: "neutral", staff: "neutral" } as const;

const ROLE_CHOICES = (admins: boolean) => [
  { value: "staff" as const, title: "Personal", description: "Publica, edita y despacha." },
  ...(admins
    ? [
        {
          value: "admin" as const,
          title: "Administración",
          description: "Además, maneja el equipo y la cuenta.",
        },
      ]
    : []),
];

function MemberRow({
  team,
  member,
  onDone,
}: {
  team: SellerTeam;
  member: Member;
  /** Shown by the list: this row disappears once the person is removed. */
  onDone: (message: string) => void;
}) {
  const shop = useShop();
  const { reloadRoles, api, viewer } = useSession();
  const { setTeamNotice } = useShops();
  const can = memberActions(team, member);
  const name = member.full_name ?? member.email ?? "Sin nombre";
  const [role, setRole] = useState<InvitableRole>(member.role === "admin" ? "admin" : "staff");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const setMemberRole = useApiMutation(
    (api, next: InvitableRole) => api.sellerSetMemberRole(shop.id, member.user_id, next),
    { invalidates: [shopKey(shop.id, "team")] },
  );
  const client = useQueryClient();
  const remove = useApiMutation((api) => api.sellerRemoveMember(shop.id, member.user_id));

  async function onRemove(leaving: boolean) {
    if (remove.isPending) return;
    if (leaving && !confirmLeave) {
      setResult({ error: LEAVE_UNTICKED });
      return;
    }
    setResult({});
    try {
      await remove.mutateAsync(undefined);
      if (!leaving) {
        onDone(MEMBER_REMOVED);
        await client.invalidateQueries({ queryKey: ["user", viewer?.id, ...shopKey(shop.id)] });
        return;
      }
      // Out of this shop, whose data is no longer this person's to read: the
      // roles are read again first, so no screen asks for it. The app then
      // opens on another shop the person belongs to, or on the screen for an
      // account without a shop; both say so.
      setTeamNotice({ kind: "left", tradeName: shop.trade_name });
      const others = ((await api.myRoles())?.sellers.length ?? 0) > 0;
      await reloadRoles();
      if (others) router.replace("/");
    } catch (error) {
      setResult({ error: messageOf(error) });
    }
  }

  return (
    <View style={{ gap: space[3], paddingVertical: space[3] }} testID="team-member">
      <View style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">
            {name}
            {member.is_you ? <Text tint="muted"> (usted)</Text> : null}
          </Text>
          {member.email ? (
            <Text variant="small" tint="muted">
              {member.email}
            </Text>
          ) : null}
          <Text variant="small" tint="muted">
            Desde el {day(member.since)}
          </Text>
        </View>
        <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>
      </View>
      {can.changeRole ? (
        <Stack gap={2}>
          <ChoiceList
            label={`Rol de ${name}`}
            value={role}
            onChange={setRole}
            choices={ROLE_CHOICES(true)}
            testID="member-role"
          />
          <Button
            variant="secondary"
            loading={setMemberRole.isPending}
            loadingLabel="Guardando…"
            testID="member-role-save"
            onPress={async () => {
              setResult({});
              try {
                await setMemberRole.mutateAsync(role);
                setResult({ ok: "Rol actualizado." });
              } catch (error) {
                setResult({ error: messageOf(error) });
              }
            }}
          >
            Cambiar rol
          </Button>
        </Stack>
      ) : null}
      {can.remove ? (
        <Button
          variant="secondary"
          loading={remove.isPending}
          loadingLabel="Un momento…"
          onPress={() => void onRemove(false)}
          testID="member-remove"
        >
          Quitar del equipo
        </Button>
      ) : null}
      {can.leave ? (
        <Stack gap={2}>
          <Checkbox checked={confirmLeave} onChange={setConfirmLeave} testID="member-leave-confirm">
            <Text variant="small">Entiendo que dejo de ver y trabajar en esta tienda.</Text>
          </Checkbox>
          <Button
            variant="secondary"
            loading={remove.isPending}
            loadingLabel="Un momento…"
            onPress={() => void onRemove(true)}
            testID="member-leave"
          >
            Salir del equipo
          </Button>
        </Stack>
      ) : null}
      <FormMessage error={result.error} ok={result.ok} testID="member-message" />
    </View>
  );
}

function InvitationRow({
  team,
  invitation,
  onDone,
}: {
  team: SellerTeam;
  invitation: Invitation;
  /** Shown by the list: this row disappears once the invitation is withdrawn. */
  onDone: (message: string) => void;
}) {
  const shop = useShop();
  const [error, setError] = useState<string | null>(null);
  const revoke = useApiMutation((api) => api.sellerRevokeInvitation(invitation.id), {
    invalidates: [shopKey(shop.id, "team")],
  });
  return (
    <View style={{ gap: space[2], paddingVertical: space[3] }} testID="team-invitation">
      <Text variant="bodyStrong">{invitation.email}</Text>
      <Text variant="small" tint="muted">
        {ROLE_LABEL[invitation.role]} · vence el {day(invitation.expires_at)}
      </Text>
      {canRevoke(team, invitation) ? (
        <Button
          variant="secondary"
          loading={revoke.isPending}
          loadingLabel="Retirando…"
          testID="invitation-revoke"
          onPress={async () => {
            setError(null);
            try {
              await revoke.mutateAsync(undefined);
              onDone(INVITATION_REVOKED);
            } catch (cause) {
              setError(messageOf(cause));
            }
          }}
        >
          Retirar invitación
        </Button>
      ) : null}
      <FormMessage error={error} />
    </View>
  );
}

function InviteForm({ isOwner }: { isOwner: boolean }) {
  const shop = useShop();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole | null>("staff");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const invite = useApiMutation(
    (api, input: { email: string; role: InvitableRole }) =>
      api.sellerInviteMember({ sellerId: shop.id, email: input.email, role: input.role }),
    { invalidates: [shopKey(shop.id, "team")] },
  );
  return (
    <Stack gap={4}>
      <TextField
        label="Correo de la persona"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        keyboardType="email-address"
        inputMode="email"
        maxLength={254}
        hint="El correo con que ingresa a Yuntera. Si todavía no tiene cuenta, puede crearla con ese correo y confirmarlo: la invitación le estará esperando."
        testID="invite-email"
      />
      <Text variant="smallStrong">Qué podrá hacer</Text>
      <ChoiceList
        label="Qué podrá hacer"
        value={role}
        onChange={setRole}
        choices={ROLE_CHOICES(isOwner)}
        testID="invite-role"
      />
      <FormMessage error={result.error} ok={result.ok} testID="invite-message" />
      <Button
        loading={invite.isPending}
        loadingLabel="Enviando…"
        testID="invite-submit"
        onPress={async () => {
          setResult({});
          const checked = checkInvite({ email, role }, isOwner);
          if ("error" in checked) return setResult({ error: checked.error });
          try {
            await invite.mutateAsync(checked);
            setResult({ ok: invitationSent(checked.email) });
            setEmail("");
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Enviar invitación
      </Button>
    </Stack>
  );
}

/**
 * Equipo (the seller centre's /equipo): who works in the shop and with what
 * role; inviting someone, who joins only by accepting; changing a role,
 * removing a member, and leaving the shop. The database decides who may do
 * each; the screen offers only what it would allow.
 */
export default function TeamScreen() {
  const shop = useShop();
  const [notice, setNotice] = useState<string | null>(null);
  const team = useApiQuery(shopKey(shop.id, "team"), (api) => api.sellerTeam(shop.id), {
    personal: true,
  });
  if (team.isPending) return <LoadingState />;
  if (team.isError) return <ErrorState error={team.error} onRetry={() => void team.refetch()} />;
  const data = team.data;

  return (
    <Screen refreshing={team.isRefetching} onRefresh={() => void team.refetch()}>
      <Text tint="muted">
        Quién trabaja en su tienda. Nadie entra al equipo sin aceptar la invitación.
      </Text>
      <FormMessage ok={notice} testID="team-notice" />
      <Card testID="team-members">
        <Text variant="heading">Personas en el equipo</Text>
        {data.members.map((member, index) => (
          <View key={member.user_id}>
            {index > 0 ? <Divider /> : null}
            <MemberRow team={data} member={member} onDone={setNotice} />
          </View>
        ))}
      </Card>

      {data.can_manage ? (
        <>
          <Card testID="team-invitations">
            <Text variant="heading">Invitaciones sin responder</Text>
            {data.invitations.length === 0 ? (
              <Text variant="small" tint="muted">
                No hay invitaciones esperando respuesta.
              </Text>
            ) : (
              data.invitations.map((invitation, index) => (
                <View key={invitation.id}>
                  {index > 0 ? <Divider /> : null}
                  <InvitationRow team={data} invitation={invitation} onDone={setNotice} />
                </View>
              ))
            )}
          </Card>
          <Card testID="team-invite">
            <Text variant="heading">Invitar a alguien</Text>
            <Text variant="small" tint="muted">
              La persona ve la invitación al ingresar a Yuntera Vende con su correo y decide si
              acepta. Hasta entonces no ve nada de su tienda.
            </Text>
            <InviteForm isOwner={data.is_owner} />
          </Card>
        </>
      ) : (
        <Text variant="small" tint="muted">
          Solo la persona dueña o administradora de la tienda puede invitar o quitar personas.
        </Text>
      )}
    </Screen>
  );
}
