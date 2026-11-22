import { ChangePasswordForm } from "@yuntera/expo-kit/account";
import { useSession } from "@yuntera/expo-kit/auth";
import { signInPath } from "@yuntera/expo-kit/paths";
import { Card, Screen, Text } from "@yuntera/expo-kit/ui";
import { Redirect } from "expo-router";
import { needsSignIn } from "@/lib/guard";

/** Changing the password while signed in, as on the website's Mi cuenta. */
export default function ChangePassword() {
  const { status } = useSession();
  if (needsSignIn(status)) return <Redirect href={signInPath("/cuenta/contrasena")} />;
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
