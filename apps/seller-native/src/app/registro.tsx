import { useSession } from "@yuntera/expo-kit/auth";
import { Button, Card, Logo, Screen, Stack, Text } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import { RegisterShopForm } from "@/components/register-shop";

const STEPS = [
  ["1. Registre su tienda", "Con los datos con que está inscrito en Hacienda."],
  ["2. Verificamos su identidad", "Normalmente en uno o dos días hábiles."],
  ["3. Publique y venda", "Usted pone el precio. Ve cada cargo antes de publicar."],
] as const;

/**
 * For a signed-in account that belongs to no shop: what that means, the way
 * to ask to be added to an existing shop, and the seller centre's /registro
 * to register a new one. Once registered, the app opens on the new shop.
 */
export default function RegisterScreen() {
  const { signOut, viewer, reloadRoles, rolesLoading } = useSession();
  const [registering, setRegistering] = useState(false);

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <Logo app="seller" size={32} />
      <View style={{ gap: 12 }} testID="no-access">
        <Text variant="title">Esta cuenta no administra ninguna tienda</Text>
        <Text>
          Si su tienda ya existe, pídale a quien la registró que lo agregue y revise de nuevo. Si
          todavía no vende con nosotros, registre su tienda aquí: sin mensualidad, solo paga una
          comisión cuando vende.
        </Text>
        {viewer?.email ? (
          <Text variant="small" tint="muted">
            Ingresó como {viewer.email}.
          </Text>
        ) : null}
      </View>

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
      <Button variant="ghost" block onPress={() => void signOut()}>
        Salir e ingresar con otra cuenta
      </Button>
    </Screen>
  );
}
