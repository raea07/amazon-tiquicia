import { colors, gutter, space } from "@yuntera/expo-kit/theme";
import {
  Badge,
  Button,
  ChoiceList,
  CloseIcon,
  IconButton,
  Mark,
  Screen,
  Text,
  UserIcon,
} from "@yuntera/expo-kit/ui";
import { router } from "expo-router";
import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SHOP_STATUS } from "@/lib/labels";
import { useShops } from "@/lib/shops";

/**
 * The bar above every tab: which shop the person is working in (always
 * visible, as the seller centre's header shows it), a way to change shop for
 * someone who belongs to several, and the account.
 */
export function ShopHeader() {
  const insets = useSafeAreaInsets();
  const { shops, shop, choose } = useShops();
  const [open, setOpen] = useState(false);
  if (!shop) return null;
  const status = shop.status === "active" ? null : SHOP_STATUS[shop.status];

  return (
    <View style={[styles.bar, { paddingTop: insets.top + space[2] }]}>
      <Mark size={26} />
      <View style={styles.shop}>
        <Text variant="caption" tint="muted">
          Tienda
        </Text>
        <Text variant="bodyStrong" numberOfLines={1} testID="current-shop">
          {shop.trade_name}
        </Text>
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      </View>
      {shops.length > 1 ? (
        <Button
          variant="secondary"
          onPress={() => setOpen(true)}
          aria-label={`Cambiar de tienda. Ahora está en ${shop.trade_name}`}
          testID="change-shop"
        >
          Cambiar
        </Button>
      ) : null}
      <IconButton label="Cuenta" onPress={() => router.push("/cuenta")} testID="open-account">
        <UserIcon color={colors.link} />
      </IconButton>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen edges={["top", "bottom", "left", "right"]}>
          <View style={styles.sheetHeader}>
            <Text variant="title" style={styles.flex}>
              ¿En qué tienda va a trabajar?
            </Text>
            <IconButton label="Cerrar" onPress={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </View>
          <Text tint="muted">
            Su cuenta administra {shops.length} tiendas. Todo lo que vea y cambie es de la tienda
            que elija aquí.
          </Text>
          <ChoiceList
            label="Tienda"
            value={shop.id}
            testID="shop-choice"
            onChange={async (id) => {
              await choose(id);
              setOpen(false);
            }}
            choices={shops.map((s) => ({
              value: s.id,
              title: s.trade_name,
              description: s.status === "active" ? undefined : SHOP_STATUS[s.status].label,
            }))}
          />
        </Screen>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: gutter,
    paddingBottom: space[2],
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  shop: { flex: 1, gap: 2 },
  flex: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
