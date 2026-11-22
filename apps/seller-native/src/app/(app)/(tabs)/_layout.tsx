import { useApiQuery } from "@yuntera/expo-kit/data";
import { colors, fontFamily } from "@yuntera/expo-kit/theme";
import { HomeIcon, PackageIcon } from "@yuntera/expo-kit/ui";
import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { ShopHeader } from "@/components/shop-header";
import { shopKey, useShop } from "@/lib/shops";

/** A tab that fails to draw shows a Spanish message with a retry. */
export { ScreenErrorBoundary as ErrorBoundary } from "@yuntera/expo-kit/ui";

/** Line icons in the kit's style (24-unit grid, 2-unit round stroke) for the seller's tabs. */
function Line({ d, color }: { d: string; color: ColorValue }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
const TagIcon = ({ color }: { color: ColorValue }) => (
  <Line color={color} d="M3 12V4h8l9.5 9.5-8 8zM7.5 8.5h.01" />
);
const ShelfIcon = ({ color }: { color: ColorValue }) => (
  <Line color={color} d="M4 20V4M20 20V4M4 9h16M4 15h16M8 9V6h4v3M13 15v-3h4v3" />
);
const CoinIcon = ({ color }: { color: ColorValue }) => (
  <Line
    color={color}
    d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5V8M12 16v1.5"
  />
);

/**
 * The tab bar sits at the bottom, under the thumb: today, orders (with the
 * number of parcels to pack), listings, inventory and payouts. The bar at the
 * top always names the shop.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const shop = useShop();
  const overview = useApiQuery(shopKey(shop.id, "overview"), (api) => api.sellerOverview(shop.id), {
    personal: true,
  });
  const toPack = overview.data?.counts.to_pack ?? 0;
  return (
    <Tabs
      screenOptions={{
        header: () => <ShopHeader />,
        tabBarActiveTintColor: colors.link,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: {
          fontFamily: fontFamily.body,
          fontWeight: "600",
          fontSize: 12,
          lineHeight: 16,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 68 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Inicio", tabBarIcon: ({ color }) => <HomeIcon color={color} /> }}
      />
      <Tabs.Screen
        name="pedidos"
        options={{
          title: "Pedidos",
          tabBarIcon: ({ color }) => <PackageIcon color={color} />,
          tabBarBadge: toPack > 0 ? toPack : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.brand, color: colors.onBrand },
          tabBarAccessibilityLabel:
            toPack > 0
              ? `Pedidos, ${toPack} ${toPack === 1 ? "paquete" : "paquetes"} por empacar`
              : "Pedidos",
        }}
      />
      <Tabs.Screen
        name="productos"
        options={{ title: "Productos", tabBarIcon: ({ color }) => <TagIcon color={color} /> }}
      />
      <Tabs.Screen
        name="inventario"
        options={{ title: "Inventario", tabBarIcon: ({ color }) => <ShelfIcon color={color} /> }}
      />
      <Tabs.Screen
        name="pagos"
        options={{ title: "Pagos", tabBarIcon: ({ color }) => <CoinIcon color={color} /> }}
      />
    </Tabs>
  );
}
