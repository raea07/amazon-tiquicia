import { colors, fontFamily } from "@yuntera/expo-kit/theme";
import { BackIcon, IconButton } from "@yuntera/expo-kit/ui";
import { router, Stack } from "expo-router";
import { type ColorValue, Platform } from "react-native";
import { HeaderTitle } from "@/components/parts";

/** A screen that fails to draw shows a Spanish message with a retry. */
export { ScreenErrorBoundary as ErrorBoundary } from "@yuntera/expo-kit/ui";

/** A screen opened directly (a link, a reload) gets the tabs underneath, so it has a way back. */
export const unstable_settings = { initialRouteName: "(tabs)" };

/**
 * On iOS and Android the header uses the system's back control. The web
 * export would draw a small link named in English, so there it gets a 44 px
 * button with a Spanish name instead (as in the shopper app).
 */
const webBack =
  Platform.OS === "web"
    ? {
        headerLeft: ({ canGoBack, tintColor }: { canGoBack?: boolean; tintColor?: ColorValue }) =>
          canGoBack ? (
            <IconButton label="Volver" onPress={() => router.back()}>
              <BackIcon color={tintColor ?? colors.link} />
            </IconButton>
          ) : null,
      }
    : {};

const titled = (title: string) => ({ title, headerTitle: () => <HeaderTitle title={title} /> });

/**
 * The app proper, for a member of a shop: five tabs (what to do today, orders,
 * listings, inventory, payouts) with everything else pushed on top. Each
 * pushed screen names the shop under its title.
 */
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.link,
        headerTitleStyle: { fontFamily: fontFamily.display, fontWeight: "700", color: colors.ink },
        headerStyle: { backgroundColor: colors.surface },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
        ...webBack,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Inicio" }} />
      <Stack.Screen name="oferta/[id]" options={titled("Precio y existencias")} />
      <Stack.Screen name="editar/[id]" options={titled("Editar producto")} />
      <Stack.Screen name="publicar" options={titled("Publicar un producto")} />
      <Stack.Screen name="lugar" options={titled("Lugar de recolección")} />
      <Stack.Screen name="envio" options={titled("Enviar a la bodega")} />
      <Stack.Screen name="cuenta" options={titled("Cuenta")} />
      <Stack.Screen name="equipo" options={titled("Equipo")} />
      <Stack.Screen name="notificaciones" options={titled("Notificaciones")} />
      <Stack.Screen name="invitaciones" options={{ title: "Invitaciones" }} />
      <Stack.Screen name="contrasena" options={{ title: "Contraseña" }} />
      <Stack.Screen name="nueva-tienda" options={{ title: "Registrar otra tienda" }} />
    </Stack>
  );
}
