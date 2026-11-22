import { colors, fontFamily } from "@yuntera/expo-kit/theme";
import { BackIcon, IconButton } from "@yuntera/expo-kit/ui";
import { useKeepAwake } from "expo-keep-awake";
import { router, Stack } from "expo-router";
import { type ColorValue, Platform } from "react-native";
import { useDriver } from "@/lib/driver";
import { needsTracking } from "@/lib/route";

/** Keeps the screen on while mounted. Browsers without a wake lock simply ignore it. */
function KeepAwake() {
  useKeepAwake("yuntera-ruta", { suppressDeactivateWarnings: true });
  return null;
}

/**
 * As in the shopper app: the phones use the system's own back control; the
 * web export gets a 44 px button with a Spanish name.
 */
const webBack =
  Platform.OS === "web"
    ? {
        headerLeft: ({ canGoBack, tintColor }: { canGoBack?: boolean; tintColor?: ColorValue }) =>
          canGoBack ? (
            <IconButton label="Volver a Mi ruta" onPress={() => router.back()}>
              <BackIcon color={tintColor ?? colors.link} />
            </IconButton>
          ) : null,
      }
    : {};

/**
 * The screens of the app proper, shown only to a driver: the day's route,
 * one stop, and the explanation shown before the location prompt. The screen
 * stays awake while a route is in progress.
 */
export default function AppLayout() {
  const { routes } = useDriver();
  const working = routes ? needsTracking(routes) : false;
  return (
    <>
      {working ? <KeepAwake /> : null}
      <Stack
        screenOptions={{
          headerTintColor: colors.link,
          headerTitleStyle: {
            fontFamily: fontFamily.display,
            fontWeight: "700",
            color: colors.ink,
          },
          headerStyle: { backgroundColor: colors.surface },
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.bg },
          ...webBack,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: "Mi ruta" }} />
        <Stack.Screen name="parada/[id]" options={{ title: "Parada" }} />
        <Stack.Screen name="ubicacion" options={{ title: "Su ubicación", presentation: "modal" }} />
        <Stack.Screen name="cuenta" options={{ title: "Su cuenta" }} />
      </Stack>
    </>
  );
}
