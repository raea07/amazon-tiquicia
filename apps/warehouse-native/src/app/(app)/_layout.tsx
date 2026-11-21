import { colors, fontFamily } from "@yuntera/expo-kit/theme";
import { BackIcon, IconButton } from "@yuntera/expo-kit/ui";
import { router, Stack } from "expo-router";
import { type ColorValue, Platform } from "react-native";
import { WarehouseProvider } from "@/lib/warehouse";

/**
 * On iOS and Android the header uses the system's own back control. The web
 * export would draw a small link named in English, so there it gets a 44 px
 * button with a Spanish name instead (as in the shopper app).
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
 * The screens of the app proper, shown only to an account assigned to a
 * warehouse: the board, and on top of it a parcel's pick list, an inbound
 * shipment to receive, and the stock lookup. A screen opened directly (a
 * reload) gets the board underneath, so there is always a way back.
 */
export const unstable_settings = { initialRouteName: "index" };

export default function AppLayout() {
  return (
    <WarehouseProvider>
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
        <Stack.Screen name="index" options={{ headerShown: false, title: "Bodega" }} />
        <Stack.Screen name="paquete/[id]" options={{ title: "Paquete" }} />
        <Stack.Screen name="recibir/[id]" options={{ title: "Recibir mercadería" }} />
        <Stack.Screen name="buscar" options={{ title: "Buscar un producto" }} />
      </Stack>
    </WarehouseProvider>
  );
}
