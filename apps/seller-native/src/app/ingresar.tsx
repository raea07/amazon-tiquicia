import { apps } from "@yuntera/brand";
import { SignInForm, SignUpForm } from "@yuntera/expo-kit/auth";
import { colors, space } from "@yuntera/expo-kit/theme";
import { Button, Card, Logo, Screen, Text } from "@yuntera/expo-kit/ui";
import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { shopUrl } from "@/lib/env";

/**
 * The terms and the privacy policy are on the shop's help page, as in the
 * seller centre's sign-up form. In the web export served by the lane the shop
 * is on another origin and EXPO_PUBLIC_SHOP_URL is empty, so the planned
 * public address is used then.
 */
const legalBase = shopUrl || `https://${apps.shop.host}`;

/**
 * Sign in, or create an account first, as the seller centre's /ingresar and
 * /registro do. The account is the person's Yuntera account (the same one
 * they buy with); once it exists, the app shows the shop registration.
 */
export default function SignInScreen() {
  const [creating, setCreating] = useState(false);
  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <View style={{ flex: 1, justifyContent: "center", gap: 24 }}>
        <Logo app="seller" size={36} />
        <Card>
          <Text variant="title">{creating ? "Primero, su cuenta" : "Ingresar"}</Text>
          <Text tint="muted">
            {creating
              ? "Si ya compra en Yuntera, ingrese con esa cuenta. Si no, créela aquí. Después registra su tienda."
              : "Con el correo y la contraseña de su cuenta de Yuntera, la misma con que compra en la tienda."}
          </Text>
          {creating ? (
            <SignUpForm
              legal={
                <Text variant="small">
                  Acepto los{" "}
                  <Link href={`${legalBase}/ayuda#terminos` as never} target="_blank">
                    <Text variant="smallStrong" tint="link">
                      términos y condiciones
                    </Text>
                  </Link>{" "}
                  y la{" "}
                  <Link href={`${legalBase}/ayuda#privacidad` as never} target="_blank">
                    <Text variant="smallStrong" tint="link">
                      política de privacidad
                    </Text>
                  </Link>
                  .
                </Text>
              }
            />
          ) : (
            <SignInForm />
          )}
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: space[3],
              gap: space[2],
            }}
          >
            <Text variant="small">
              {creating ? "¿Ya tiene cuenta en Yuntera?" : "¿Todavía no tiene cuenta en Yuntera?"}
            </Text>
            <Button
              variant="secondary"
              block
              onPress={() => setCreating(!creating)}
              testID={creating ? "show-sign-in" : "show-sign-up"}
            >
              {creating ? "Ingresar con mi cuenta" : "Crear una cuenta para vender"}
            </Button>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
