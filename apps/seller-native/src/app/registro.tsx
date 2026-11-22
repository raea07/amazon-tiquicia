import { SignOutButton, useSession } from "@yuntera/expo-kit/auth";
import { Alert, Button, Card, LinkButton, Logo, Screen, Stack, Text } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import { MyInvitations } from "@/components/invitations";
import { RegisterShopForm } from "@/components/register-shop";
import { useShops } from "@/lib/shops";

const STEPS = [
  ["1. Registre su tienda", "Con los datos con que está inscrito en Hacienda."],
  ["2. Verificamos su identidad", "Normalmente en uno o dos días hábiles."],
  ["3. Publique y venda", "Usted pone el precio. Ve cada cargo antes de publicar."],
] as const;

/**
 * For a signed-in account that belongs to no shop: what that means, the
 * invitations addressed to it (accepting one opens the app on that shop),
 * and the seller centre's /registro to register a new one. Once registered,
 * the app opens on the new shop. The account can also be deleted from here.
 */
export default function RegisterScreen() {
  const { viewer, reloadRoles, rolesLoading } = useSession();
  const { teamNotice, setTeamNotice } = useShops();
  const [registering, setRegistering] = useState(false);

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <Logo app="seller" size={32} />
      {teamNotice?.kind === "left" ? (
        <Alert tone="success" title="Salió del equipo" testID="team-left">
          <Stack gap={2}>
            <Text variant="small">
              Ya no ve ni trabaja en {teamNotice.tradeName}. Si fue un error, pida a la persona
              dueña que le invite de nuevo.
            </Text>
            <Button variant="secondary" onPress={() => setTeamNotice(null)}>
              Entendido
            </Button>
          </Stack>
        </Alert>
      ) : null}
      <View style={{ gap: 12 }} testID="no-access">
        <Text variant="title">Esta cuenta no administra ninguna tienda</Text>
        <Text>
          Si su tienda ya existe, pídale a quien la registró que le invite con este correo: la
          invitación aparece aquí. Si todavía no vende con nosotros, registre su tienda aquí: sin
          mensualidad, solo paga una comisión cuando vende.
        </Text>
        {viewer?.email ? (
          <Text variant="small" tint="muted">
            Ingresó como {viewer.email}.
          </Text>
        ) : null}
      </View>

      <MyInvitations quietWhenEmpty />

      {registering ? (
        <RegisterShopForm />
      ) : (
        <Stack gap={3}>
          {STEPS.map(([title, text]) => (
            <Card key={title}>
              <Text variant="bodyStrong">{title}</Text>
              <Text variant="small" tint="muted">
                {text}
              </Text>
            </Card>
          ))}
          <Button size="lg" block onPress={() => setRegistering(true)} testID="start-registration">
            Registrar mi tienda
          </Button>
          <Button
            variant="secondary"
            block
            loading={rolesLoading}
            loadingLabel="Revisando…"
            onPress={() => void reloadRoles()}
          >
            Ya me agregaron: revisar de nuevo
          </Button>
        </Stack>
      )}
      <SignOutButton label="Salir e ingresar con otra cuenta" testID="no-access-sign-out" />
      <LinkButton href="/eliminar-cuenta" variant="ghost" block testID="no-access-delete">
        Eliminar mi cuenta
      </LinkButton>
    </Screen>
  );
}
