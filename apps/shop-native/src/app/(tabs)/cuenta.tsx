import type { Address } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useSession } from "@yuntera/expo-kit/auth";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import {
  Button,
  Card,
  Checkbox,
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
import { validateProfile } from "@/lib/address";

function ProfileForm({
  fullName: initialName,
  phone: initialPhone,
  marketingOptIn,
}: {
  fullName: string;
  phone: string;
  marketingOptIn: boolean;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  // The stored choice, whatever it is; for a new account that is "no".
  const [marketing, setMarketing] = useState(marketingOptIn);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const save = useApiMutation(
    (api, input: Parameters<typeof api.updateProfile>[0]) => api.updateProfile(input),
    { invalidates: [["profile"]] },
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
      <Checkbox checked={marketing} onChange={setMarketing}>
        <Text variant="small">
          Quiero recibir ofertas y novedades por correo. Puede cambiarlo cuando quiera.
        </Text>
      </Checkbox>
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
            await save.mutateAsync({
              fullName: checked.fullName,
              phone: checked.phone,
              marketingOptIn: marketing,
            });
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
          Todavía no entregamos en esta zona.
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
  return (
    <Screen>
      <Text variant="title">Su cuenta</Text>
      <Text tint="muted">
        Ingrese para comprar, seguir sus pedidos y guardar sus direcciones. Puede ver los productos
        sin una cuenta.
      </Text>
      <Stack gap={3}>
        <LinkButton href="/ingresar?siguiente=/cuenta" block size="lg">
          Ingresar
        </LinkButton>
        <LinkButton href="/ingresar?modo=crear&siguiente=/cuenta" block variant="secondary">
          Crear una cuenta
        </LinkButton>
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

/** "Su cuenta": personal data, delivery addresses, orders, help and signing out. */
export default function AccountScreen() {
  const { status, viewer, signOut } = useSession();
  const profile = useApiQuery(["profile"], (api) => api.myProfile(), { personal: true });
  const addresses = useApiQuery(["addresses"], (api) => api.myAddresses(), { personal: true });
  const [leaving, setLeaving] = useState(false);

  if (status !== "signedIn") return <SignedOut />;
  if (profile.isPending || addresses.isPending) return <LoadingState />;
  if (profile.isError)
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (addresses.isError)
    return <ErrorState error={addresses.error} onRetry={() => void addresses.refetch()} />;

  const data = profile.data;
  return (
    <Screen
      refreshing={profile.isRefetching || addresses.isRefetching}
      onRefresh={() => {
        void profile.refetch();
        void addresses.refetch();
      }}
    >
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
          marketingOptIn={data?.marketing_opt_in ?? false}
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
