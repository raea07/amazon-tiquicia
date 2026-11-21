import { AppProviders, useAccess } from "@yuntera/expo-kit/auth";
import { colors } from "@yuntera/expo-kit/theme";
import { LoadingState } from "@yuntera/expo-kit/ui";
import { Stack } from "expo-router";
import { View } from "react-native";
import { env } from "@/lib/env";

/** A screen that fails to draw shows a Spanish message with a retry. */
export { ScreenErrorBoundary as ErrorBoundary } from "@yuntera/expo-kit/ui";

/**
 * Who sees what. Signed out: the sign-in screen. Signed in without the role
 * this app is for: a screen that says so and what to do. With the role: the
 * app. The guard only decides what is shown; the database checks every call.
 */
function Navigator() {
  const access = useAccess("warehouse");
  if (access === "checking") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <LoadingState label="Revisando su acceso…" />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={access === "allowed"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={access === "signedOut"}>
        <Stack.Screen name="ingresar" />
      </Stack.Protected>
      <Stack.Protected guard={access === "denied" || access === "unavailable"}>
        <Stack.Screen name="sin-acceso" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders env={env}>
      <Navigator />
    </AppProviders>
  );
}
