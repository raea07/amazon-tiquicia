import { ChangePasswordForm } from "@yuntera/expo-kit/account";
import { useSession } from "@yuntera/expo-kit/auth";
import { Card, LinkButton, Screen, Text } from "@yuntera/expo-kit/ui";

/**
 * Su cuenta (the field app's /cuenta): the password, and the way to delete
 * the account. The field app has no notification settings, so neither does
 * this app.
 */
export default function AccountScreen() {
  const { viewer } = useSession();
  return (
    <Screen>
      {viewer?.email ? (
        <Text tint="muted" testID="account-email">
          {viewer.email}
        </Text>
      ) : null}
      <Card>
        <Text variant="heading">Contraseña</Text>
        <Text tint="muted">Al cambiarla, cerramos las demás sesiones abiertas de su cuenta.</Text>
        <ChangePasswordForm />
      </Card>
      <Card>
        <Text variant="heading">Eliminar su cuenta</Text>
        <Text tint="muted">
          Borra sus datos personales de Yuntera. Antes de hacerlo le explicamos qué se borra y qué
          debemos conservar por ley.
        </Text>
        <LinkButton href="/eliminar-cuenta" variant="ghost" testID="open-delete-account">
          Eliminar mi cuenta
        </LinkButton>
      </Card>
    </Screen>
  );
}
