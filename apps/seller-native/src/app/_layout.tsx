import { AppProviders, useAccess } from "@yuntera/expo-kit/auth";
import { colors } from "@yuntera/expo-kit/theme";
import { LoadingState } from "@yuntera/expo-kit/ui";
import { Stack } from "expo-router";
import { View } from "react-native";
import { env } from "@/lib/env";
import { ShopProvider, useShops } from "@/lib/shops";

/** A screen that fails to draw shows a Spanish message with a retry. */
export { ScreenErrorBoundary as ErrorBoundary } from "@yuntera/expo-kit/ui";

function Checking({ label }: { label: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
      <LoadingState label={label} />
    </View>
  );
}

/**
 * Who sees what. Signed out: the sign-in screen. Signed in without a shop:
 * what to do, and the form to register one, as the seller centre's
 * /registro. Roles that could not be read (no connection): a retry, never
 * "no access". A member of a shop: the app. The guard only decides what is
 * shown; the database checks every call.
 */
function Navigator() {
  const access = useAccess("seller");
  const { ready } = useShops();
  if (access === "checking") return <Checking label="Revisando su acceso…" />;
  // Wait for the remembered shop, so the screens never start on another one.
  if (access === "allowed" && !ready) return <Checking label="Abriendo su tienda…" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={access === "allowed"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={access === "signedOut"}>
        <Stack.Screen name="ingresar" />
      </Stack.Protected>
      <Stack.Protected guard={access === "denied"}>
        <Stack.Screen name="registro" />
      </Stack.Protected>
      <Stack.Protected guard={access === "unavailable"}>
        <Stack.Screen name="sin-acceso" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders env={env} secondStep="in-app">
      <ShopProvider>
        <Navigator />
      </ShopProvider>
    </AppProviders>
  );
}
