import { ChangePasswordForm } from "@yuntera/expo-kit/account";
import { Card, Screen, Text } from "@yuntera/expo-kit/ui";

/** Changing the password while signed in, as on the seller centre's Cuenta. */
export default function ChangePasswordScreen() {
  return (
    <Screen>
      <Card>
        <Text variant="heading">Contraseña</Text>
        <Text tint="muted">Al cambiarla, cerramos las demás sesiones abiertas de su cuenta.</Text>
        <ChangePasswordForm />
      </Card>
    </Screen>
  );
}
