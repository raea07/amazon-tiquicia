import {
  AccountDeletedNotice,
  DEFAULT_WEBSITE,
  ForgotPasswordForm,
} from "@yuntera/expo-kit/account";
import { SignInForm, SignUpForm, useSession } from "@yuntera/expo-kit/auth";
import { oneParam, safeReturnPath } from "@yuntera/expo-kit/paths";
import { colors, space } from "@yuntera/expo-kit/theme";
import { Card, Screen, Text, TextLink } from "@yuntera/expo-kit/ui";
import { Link, Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { shopUrl } from "@/lib/env";

/**
 * Sign in, create an account, or ask for a password reset, at
 * /ingresar?siguiente=… like the website (`modo=crear`, `modo=recuperar`).
 * Afterwards the shopper goes back to where they were (the checkout, an
 * order); the return path is checked so a link cannot send them elsewhere.
 * An account with an authenticator app is asked for its code here, after
 * the password; it is signed in, and sent on, only once the code is right.
 */
export default function SignInScreen() {
  const params = useLocalSearchParams<{ siguiente?: string; modo?: string }>();
  const returnTo = safeReturnPath(oneParam(params.siguiente));
  const mode = oneParam(params.modo);
  const creating = mode === "crear";
  const { status } = useSession();
  const goOn = () => router.replace(returnTo as never);

  if (status === "signedIn") return <Redirect href={returnTo as never} />;

  if (mode === "recuperar" && status === "signedOut") {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Restablecer su contraseña" }} />
        <Card>
          <ForgotPasswordForm
            website={shopUrl || DEFAULT_WEBSITE}
            onBack={() =>
              router.replace({ pathname: "/ingresar", params: { siguiente: returnTo } })
            }
          />
        </Card>
      </Screen>
    );
  }

  if (status === "secondStep") {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Ingresar" }} />
        <Card>
          {/* The kit's SignInForm asks for the code; the Redirect above sends the shopper on. */}
          <SignInForm />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: creating ? "Crear cuenta" : "Ingresar" }} />
      <AccountDeletedNotice />
      <Card>
        <Text variant="title">{creating ? "Crear su cuenta" : "Ingresar"}</Text>
        <Text tint="muted">
          {creating
            ? "Para comprar y seguir sus pedidos."
            : "Con el correo y la contraseña de su cuenta."}
        </Text>
        {creating ? (
          <SignUpForm
            onSignedIn={goOn}
            legal={
              <Text variant="small">
                Acepto los{" "}
                <Link href="/ayuda">
                  <Text variant="smallStrong" tint="link">
                    términos y condiciones
                  </Text>
                </Link>{" "}
                y la{" "}
                <Link href="/ayuda">
                  <Text variant="smallStrong" tint="link">
                    política de privacidad
                  </Text>
                </Link>
                .
              </Text>
            }
          />
        ) : (
          // No onSignedIn: an account with an authenticator app is not signed
          // in yet after its password; the Redirect above moves on once it is.
          <SignInForm
            onForgotPassword={() =>
              router.replace({
                pathname: "/ingresar",
                params: { modo: "recuperar", siguiente: returnTo },
              })
            }
          />
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[3] }}>
          <Text variant="small">{creating ? "¿Ya tiene cuenta?" : "¿Es su primera vez?"}</Text>
          <TextLink
            replace
            href={{
              pathname: "/ingresar",
              params: creating ? { siguiente: returnTo } : { modo: "crear", siguiente: returnTo },
            }}
          >
            {creating ? "Ingresar" : "Crear una cuenta"}
          </TextLink>
        </View>
      </Card>
    </Screen>
  );
}
