import { AppProviders } from "@yuntera/expo-kit/auth";
import { colors, fontFamily } from "@yuntera/expo-kit/theme";
import { BackIcon, IconButton } from "@yuntera/expo-kit/ui";
import { router, Stack } from "expo-router";
import { type ColorValue, Platform } from "react-native";
import { CartProvider } from "@/lib/cart-context";
import { env } from "@/lib/env";

/** A screen that fails to draw shows a Spanish message with a retry. */
export { ScreenErrorBoundary as ErrorBoundary } from "@yuntera/expo-kit/ui";

/**
 * A screen opened directly (a link, a cold start on a route, a reload) gets
 * the tabs underneath it, so it always has a way back to the shop.
 */
export const unstable_settings = { initialRouteName: "(tabs)" };

/**
 * On iOS and Android the header uses the system's own back control, sized and
 * named in the phone's language. The web export would draw a 30 px link
 * named in English ("Inicio, back"), so there it gets a 44 px button with a
 * Spanish name instead.
 */
const webBack =
  Platform.OS === "web"
    ? {
        headerLeft: ({
          canGoBack,
          label,
          tintColor,
        }: {
          canGoBack?: boolean;
          label?: string;
          tintColor?: ColorValue;
        }) =>
          canGoBack ? (
            <IconButton
              label={label ? `Volver a ${label}` : "Volver"}
              onPress={() => router.back()}
            >
              <BackIcon color={tintColor ?? colors.link} />
            </IconButton>
          ) : null,
      }
    : {};

/**
 * The shop's navigation: five tabs for browsing, the cart and the account,
 * with everything else (a product, checkout, an order) pushed on top as a
 * stack, and the delivery-zone picker as a sheet. Browsing, search and
 * product pages need no account, as on the website; checkout and orders ask
 * for one.
 */
/** How long the shop waits for a read before saying it could not be read. */
const READ_TIMEOUT_MS = 15_000;

export default function RootLayout() {
  return (
    // An account with an authenticator app gives its code on the sign-in
    // screen of this app, as in the other three (kit: SecondStepForm). A read
    // that has not answered in 15 seconds counts as failed, so every screen
    // shows its error state or notice with "Intentar de nuevo" instead of
    // loading, or turning its pull spinner, for ever.
    <AppProviders env={env} secondStep="in-app" readTimeoutMs={READ_TIMEOUT_MS}>
      <CartProvider>
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
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Inicio" }} />
          <Stack.Screen name="p/[slug]" options={{ title: "Producto" }} />
          <Stack.Screen name="c/[slug]" options={{ title: "Categoría" }} />
          <Stack.Screen name="pagar" options={{ title: "Finalizar compra" }} />
          <Stack.Screen name="pedidos/index" options={{ title: "Sus pedidos" }} />
          <Stack.Screen name="pedidos/[numero]" options={{ title: "Su pedido" }} />
          <Stack.Screen name="ingresar" options={{ title: "Ingresar" }} />
          <Stack.Screen name="ayuda" options={{ title: "Ayuda" }} />
          <Stack.Screen name="direcciones/nueva" options={{ title: "Nueva dirección" }} />
          <Stack.Screen name="reportar" options={{ title: "Reportar un problema" }} />
          <Stack.Screen name="cuenta/notificaciones" options={{ title: "Notificaciones" }} />
          <Stack.Screen name="cuenta/contrasena" options={{ title: "Contraseña" }} />
          <Stack.Screen name="cuenta/eliminar" options={{ title: "Eliminar su cuenta" }} />
          <Stack.Screen
            name="zona"
            options={{ title: "Su zona de entrega", presentation: "modal" }}
          />
        </Stack>
      </CartProvider>
    </AppProviders>
  );
}
