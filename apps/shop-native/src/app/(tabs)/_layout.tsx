import { colors, fontFamily } from "@yuntera/expo-kit/theme";
import { CartIcon, GridIcon, HomeIcon, SearchIcon, UserIcon } from "@yuntera/expo-kit/ui";
import { Tabs } from "expo-router/js-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCart } from "@/lib/cart-context";

/**
 * The tab bar sits at the bottom, under the thumb: browse, categories, search,
 * the cart (with the number of units in it) and the account.
 */
export default function TabsLayout() {
  const { units } = useCart();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.link,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: {
          fontFamily: fontFamily.body,
          fontWeight: "600",
          fontSize: 12,
          lineHeight: 16,
        },
        // Room for the icon and a label in Inter, plus the home bar.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 68 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        headerTitleStyle: { fontFamily: fontFamily.display, fontWeight: "700", color: colors.ink },
        headerStyle: { backgroundColor: colors.surface },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          headerShown: false,
          tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="categorias"
        options={{ title: "Categorías", tabBarIcon: ({ color }) => <GridIcon color={color} /> }}
      />
      <Tabs.Screen
        name="buscar"
        options={{ title: "Buscar", tabBarIcon: ({ color }) => <SearchIcon color={color} /> }}
      />
      <Tabs.Screen
        name="carrito"
        options={{
          title: "Carrito",
          tabBarIcon: ({ color }) => <CartIcon color={color} />,
          tabBarBadge: units > 0 ? units : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.brand, color: colors.onBrand },
          tabBarAccessibilityLabel:
            units > 0 ? `Carrito, ${units} ${units === 1 ? "producto" : "productos"}` : "Carrito",
        }}
      />
      <Tabs.Screen
        name="cuenta"
        options={{ title: "Cuenta", tabBarIcon: ({ color }) => <UserIcon color={color} /> }}
      />
    </Tabs>
  );
}
