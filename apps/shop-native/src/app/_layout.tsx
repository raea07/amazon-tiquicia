import { AppProviders } from "@yuntera/expo-kit/auth";
import { colors, fontFamily } from "@yuntera/expo-kit/theme";
import { Stack } from "expo-router";
import { CartProvider } from "@/lib/cart-context";
import { env } from "@/lib/env";

/**
 * The shop's navigation: five tabs for browsing, the cart and the account,
 * with everything else (a product, checkout, an order) pushed on top as a
 * stack, and the delivery-zone picker as a sheet. Browsing, search and
 * product pages need no account, as on the website; checkout and orders ask
 * for one.
 */
export default function RootLayout() {
  return (
    <AppProviders env={env}>
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
          <Stack.Screen
            name="zona"
            options={{ title: "Su zona de entrega", presentation: "modal" }}
          />
        </Stack>
      </CartProvider>
    </AppProviders>
  );
}
