import type { Address } from "@yuntera/db";
import { AccountDeletedNotice } from "@yuntera/expo-kit/account";
import { messageOf } from "@yuntera/expo-kit/api";
import { useSession } from "@yuntera/expo-kit/auth";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import {
  Button,
  Card,
  Divider,
  ErrorState,
  FormMessage,
  HelpIcon,
  LinkButton,
  ListRow,
  LoadingState,
  PackageIcon,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import { KeptNotice } from "@/components/kept-notice";
import { validateProfile } from "@/lib/address";
import { firstReadFailed, KEPT, refreshFailed } from "@/lib/kept-reads";

/**
 * Name and phone. The commercial consent is with the channels for messages,
 * on Notificaciones, as on the website: both are saved there in one call.
 */
function ProfileForm({
  fullName: initialName,
  phone: initialPhone,
}: {
  fullName: string;
  phone: string;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const save = useApiMutation(
    (api, input: { fullName: string; phone: string | null }) =>
      api.updateProfile({ fullName: input.fullName, phone: input.phone }),
    { invalidates: [["profile"], ["notification-settings"]] },
  );

  return (
    <Stack gap={4}>
      <TextField
        label="Nombre completo"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
      />
      <TextField
        label="Teléfono"
        optional
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        inputMode="tel"
        placeholder="8888-1234"
      />
      <FormMessage {...result} />
      <Button
        loading={save.isPending}
        loadingLabel="Guardando…"
        onPress={async () => {
          const checked = validateProfile({ fullName, phone });
          if ("error" in checked && checked.error) {
            setResult({ error: checked.error });
            return;
          }
          if (!("fullName" in checked)) return;
          try {
            await save.mutateAsync({ fullName: checked.fullName, phone: checked.phone });
            setResult({ ok: "Datos guardados." });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Guardar cambios
      </Button>
    </Stack>
  );
}

function AddressRow({ address }: { address: Address }) {
  const [error, setError] = useState<string | null>(null);
  const remove = useApiMutation((api, id: string) => api.deleteAddress(id), {
    invalidates: [["addresses"]],
  });
  return (
    <Card>
      <Text variant="bodyStrong">
        {address.label ? `${address.label} · ` : ""}
        {address.recipient_name}
        {address.is_default ? <Text tint="muted"> (principal)</Text> : null}
      </Text>
      <Text variant="small" tint="muted">
        {address.senas}. {address.district}, {address.canton}, {address.province}.
      </Text>
      {address.plus_code ? (
        <Text variant="small" tint="muted">
          Código Plus {address.plus_code}
        </Text>
      ) : null}
      {address.zone_active ? null : (
        <Text variant="smallStrong" tint="warning">
          Por ahora no entregamos aquí. La dirección queda guardada para cuando volvamos a entregar
          en esta zona.
        </Text>
      )}
      <FormMessage error={error} />
      <Button
        variant="ghost"
        loading={remove.isPending}
        loadingLabel="Eliminando…"
        aria-label={`Eliminar la dirección de ${address.recipient_name}, ${address.district}`}
        onPress={async () => {
          try {
            await remove.mutateAsync(address.id);
          } catch (cause) {
            setError(messageOf(cause));
          }
        }}
      >
        Eliminar
      </Button>
    </Card>
  );
}

function SignedOut() {
  const { status } = useSession();
  return (
    <Screen>
      <AccountDeletedNotice />
      <Text variant="title">Su cuenta</Text>
      {status === "secondStep" ? (
        <Text tint="muted">
          Falta un paso para entrar a su cuenta: el código de su aplicación de autenticación.
        </Text>
      ) : (
        <Text tint="muted">
          Ingrese para comprar, seguir sus pedidos y guardar sus direcciones. Puede ver los
          productos sin una cuenta.
        </Text>
      )}
      <Stack gap={3}>
        <LinkButton href="/ingresar?siguiente=/cuenta" block size="lg" testID="account-sign-in">
          {status === "secondStep" ? "Escribir el código" : "Ingresar"}
        </LinkButton>
        {status === "secondStep" ? null : (
          <LinkButton href="/ingresar?modo=crear&siguiente=/cuenta" block variant="secondary">
            Crear una cuenta
          </LinkButton>
        )}
      </Stack>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <ListRow
          href="/ayuda"
          title="Ayuda"
          subtitle="Entregas, pagos, devoluciones y reclamos"
          leading={<HelpIcon />}
        />
      </Card>
    </Screen>
  );
}

/**
 * "Su cuenta": personal data, delivery addresses, orders, messages, the
 * password, help, signing out and deleting the account.
 */
export default function AccountScreen() {
  const { status, viewer, signOut } = useSession();
  const profile = useApiQuery(["profile"], (api) => api.myProfile(), { personal: true });
  const addresses = useApiQuery(["addresses"], (api) => api.myAddresses(), { personal: true });
  const [leaving, setLeaving] = useState(false);

  if (status !== "signedIn") return <SignedOut />;
  if (profile.isPending || addresses.isPending) return <LoadingState />;
  if (firstReadFailed(profile))
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (firstReadFailed(addresses))
    return <ErrorState error={addresses.error} onRetry={() => void addresses.refetch()} />;
  if (!addresses.data) return <LoadingState />;

  const data = profile.data;
  // Shown and asking again failed: kept, and said (kept-reads.ts).
  const keptError = refreshFailed(profile)
    ? profile.error
    : refreshFailed(addresses)
      ? addresses.error
      : null;
  return (
    <Screen
      refreshing={profile.isRefetching || addresses.isRefetching}
      onRefresh={() => {
        void profile.refetch();
        void addresses.refetch();
      }}
    >
      {keptError ? (
        <KeptNotice
          title={KEPT.account.title}
          body={KEPT.account.body}
          error={keptError}
          onRetry={() => {
            void profile.refetch();
            void addresses.refetch();
          }}
          retrying={profile.isFetching || addresses.isFetching}
          testID="account-kept"
        />
      ) : null}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <ListRow
          href="/pedidos"
          title="Sus pedidos"
          subtitle="Seguimiento, pagos, devoluciones y reseñas"
          leading={<PackageIcon />}
          testID="account-orders"
        />
        <Divider />
        <ListRow
          href="/cuenta/casos"
          title="Sus consultas"
          subtitle="Sus reclamos y devoluciones, con nuestras respuestas"
          testID="account-cases"
        />
        <Divider />
        <ListRow
          href="/cuenta/notificaciones"
          title="Notificaciones"
          subtitle="Correo, WhatsApp, SMS y publicidad"
          testID="account-notifications"
        />
        <Divider />
        <ListRow
          href="/ayuda"
          title="Ayuda"
          subtitle="Entregas, pagos, devoluciones y reclamos"
          leading={<HelpIcon />}
        />
      </Card>

      <Card>
        <Text variant="heading">Sus datos</Text>
        <Text variant="small" tint="muted">
          {data?.email ?? viewer?.email}
        </Text>
        <ProfileForm
          key={data?.id ?? "profile"}
          fullName={data?.full_name ?? ""}
          phone={data?.phone?.replace("+506", "") ?? ""}
        />
      </Card>

      <Stack gap={3}>
        <Text variant="heading">Direcciones de entrega</Text>
        {addresses.data.length > 0 ? (
          addresses.data.map((address) => <AddressRow key={address.id} address={address} />)
        ) : (
          <Text tint="muted">Todavía no ha guardado ninguna.</Text>
        )}
        <LinkButton href="/direcciones/nueva?siguiente=/cuenta" variant="secondary" block>
          Agregar una dirección
        </LinkButton>
      </Stack>

      <Stack gap={3}>
        <Text variant="heading">Su acceso</Text>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <ListRow
            href="/cuenta/contrasena"
            title="Contraseña"
            subtitle="Al cambiarla, cerramos las demás sesiones abiertas de su cuenta."
            testID="account-password"
          />
          <Divider />
          <ListRow
            href="/cuenta/eliminar"
            title="Eliminar su cuenta"
            subtitle="Antes le explicamos qué se borra y qué debemos conservar por ley."
            testID="account-delete"
          />
        </Card>
      </Stack>

      <View style={{ marginTop: space[2] }}>
        <Button
          variant="ghost"
          block
          loading={leaving}
          loadingLabel="Cerrando sesión…"
          onPress={async () => {
            setLeaving(true);
            await signOut();
            setLeaving(false);
          }}
          testID="sign-out"
        >
          Cerrar sesión
        </Button>
      </View>
    </Screen>
  );
}
