import { Alert, Screen, Text } from "@yuntera/expo-kit/ui";
import { router } from "expo-router";
import { RegisterShopForm } from "@/components/register-shop";

/** Another shop for someone who already has one, with a different identification (as on the web). */
export default function NewShopScreen() {
  return (
    <Screen>
      <Alert tone="info" title="Ya tiene una tienda registrada">
        Puede registrar otra con una identificación distinta. Al terminar, la aplicación se abre en
        la tienda nueva; puede volver a la otra desde “Cambiar”.
      </Alert>
      <Text tint="muted">
        Usted pone el precio y ve cada cargo antes de publicar. La tienda nueva queda en revisión
        mientras verificamos sus datos.
      </Text>
      <RegisterShopForm onRegistered={() => router.dismissTo("/")} />
    </Screen>
  );
}
