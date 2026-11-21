// Defines the location task when the bundle loads, before any screen (expo-task-manager needs it).
import "@/lib/tracking";
import { AppProviders } from "@yuntera/expo-kit/auth";
import { colors } from "@yuntera/expo-kit/theme";
import { LoadingState } from "@yuntera/expo-kit/ui";
import { Stack } from "expo-router";
import { View } from "react-native";
import { DriverProvider, useDriverAccess } from "@/lib/driver";
import { env } from "@/lib/env";

/** A screen that fails to draw shows a Spanish message with a retry. */
export { ScreenErrorBoundary as ErrorBoundary } from "@yuntera/expo-kit/ui";

/**
 * Who sees what. Signed out: the sign-in screen. Signed in without the role
 * this app is for: a screen that says so and what to do. With the role: the
 * app. With no signal the roles cannot be read; a driver whose day is saved
 * on this phone still gets the app (the database checks every call anyway),
 * so a route stays readable in a dead zone. The guard only decides what is
 * shown.
 */
function Navigator() {
  const { access, offlineAllowed, deciding } = useDriverAccess();
  if (access === "checking" || deciding) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <LoadingState label="Revisando su acceso…" />
      </View>
    );
  }
  const allowed = access === "allowed" || offlineAllowed;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={allowed}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={access === "signedOut"}>
        <Stack.Screen name="ingresar" />
      </Stack.Protected>
      <Stack.Protected guard={!allowed && (access === "denied" || access === "unavailable")}>
        <Stack.Screen name="sin-acceso" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders env={env}>
      <DriverProvider>
        <Navigator />
      </DriverProvider>
    </AppProviders>
  );
}
