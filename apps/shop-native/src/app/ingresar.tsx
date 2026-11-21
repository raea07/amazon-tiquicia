import { SignInForm, SignUpForm, useSession } from "@yuntera/expo-kit/auth";
import { oneParam, safeReturnPath } from "@yuntera/expo-kit/paths";
import { colors, space } from "@yuntera/expo-kit/theme";
import { Card, Screen, Text, TextLink } from "@yuntera/expo-kit/ui";
import { Link, Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

/**
 * Sign in or create an account, at /ingresar?siguiente=… like the website.
 * Afterwards the shopper goes back to where they were (the checkout, an
 * order); the return path is checked so a link cannot send them elsewhere.
 */
export default function SignInScreen() {
  const params = useLocalSearchParams<{ siguiente?: string; modo?: string }>();
  const returnTo = safeReturnPath(oneParam(params.siguiente));
  const creating = oneParam(params.modo) === "crear";
  const { status } = useSession();
  const goOn = () => router.replace(returnTo as never);

  if (status === "signedIn") return <Redirect href={returnTo as never} />;

  return (
    <Screen>
      <Stack.Screen options={{ title: creating ? "Crear cuenta" : "Ingresar" }} />
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
          <SignInForm onSignedIn={goOn} />
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
