import { useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import { colors, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  ChevronIcon,
  EmptyState,
  ErrorState,
  formatPrice,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { Link, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ProductThumb } from "@/components/parts";
import { PausedOffers, usePausedOffers } from "@/components/paused-offers";
import { createdFlash, flashFor } from "@/lib/flash";
import { FULFILLMENT_LABEL, PRODUCT_STATUS } from "@/lib/labels";
import { shopKey, useShop } from "@/lib/shops";

/**
 * Productos: every offer of the shop with its state, price and stock. A tap
 * opens the offer, where price and stock change in a couple of taps and the
 * listing itself can be edited.
 */
export default function ListingsScreen() {
  const shop = useShop();
  const params = useLocalSearchParams<{ creado?: string; tienda?: string }>();
  // "Producto enviado a revisión" belongs to the shop it was created in, and
  // is said once: leaving the tab clears it from the address.
  const created = flashFor(createdFlash(oneParam(params.creado), oneParam(params.tienda)), shop.id);
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(
      () => () => navigation.setParams({ creado: undefined, tienda: undefined } as never),
      [navigation],
    ),
  );
  const listings = useApiQuery(shopKey(shop.id, "listings"), (api) => api.sellerListings(shop.id), {
    personal: true,
  });
  const edits = useApiQuery(
    shopKey(shop.id, "listing-edits"),
    (api) => api.sellerListingEdits(shop.id),
    { personal: true },
  );
  const paused = usePausedOffers();

  if (listings.isPending || edits.isPending)
    return <LoadingState label="Cargando sus productos…" />;
  if (listings.isError)
    return <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />;
  if (edits.isError) return <ErrorState error={edits.error} onRetry={() => void edits.refetch()} />;

  const editOf = new Map(edits.data.map((edit) => [edit.product_id, edit]));

  return (
    <Screen
      edges={["left", "right"]}
      refreshing={listings.isRefetching}
      onRefresh={() => {
        void listings.refetch();
        void edits.refetch();
        void paused.refetch();
      }}
    >
      <Stack gap={2}>
        <Text variant="title">Productos</Text>
        <Text tint="muted">Sus publicaciones, su precio y si están a la venta.</Text>
      </Stack>
      <LinkButton href="/publicar" block testID="new-listing">
        Publicar un producto
      </LinkButton>
      <LinkButton href="/ofrecer" variant="secondary" block testID="offer-existing">
        Vender uno que ya existe
      </LinkButton>

      {created === "revision" ? (
        <Alert tone="success" title="Producto enviado a revisión" testID="created-message">
          Lo revisamos normalmente en un día hábil. Mientras tanto, indique sus existencias en
          Inventario para que pueda venderse apenas se publique.
        </Alert>
      ) : null}
      {created === "borrador" ? (
        <Alert tone="info" title="Borrador guardado" testID="created-message">
          Nadie más lo ve todavía.
        </Alert>
      ) : null}

      <PausedOffers />

      {listings.data.length === 0 ? (
        <EmptyState
          title="Todavía no tiene productos"
          action={<LinkButton href="/publicar">Publicar el primero</LinkButton>}
        >
          Publicar toma unos cinco minutos. Antes de enviarlo ve exactamente cuánto recibe por cada
          venta.
        </EmptyState>
      ) : (
        <View style={styles.list}>
          {listings.data.map((listing, index) => {
            const status = PRODUCT_STATUS[listing.product_status];
            const edit = editOf.get(listing.product_id);
            return (
              <Link
                key={listing.offer_id}
                href={{ pathname: "/oferta/[id]", params: { id: listing.offer_id } }}
                asChild
              >
                <Pressable
                  role="link"
                  testID={`listing-${listing.offer_id}`}
                  // One flat style object: Link (asChild) passes it to the DOM on the web.
                  style={StyleSheet.flatten([styles.row, index > 0 ? styles.separated : null])}
                >
                  <ProductThumb path={listing.image_path} />
                  <View style={styles.body}>
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {listing.title}
                    </Text>
                    <Text variant="caption" tint="muted" numberOfLines={1}>
                      {listing.sku_code}
                      {listing.variant_name ? ` · ${listing.variant_name}` : ""} ·{" "}
                      {FULFILLMENT_LABEL[listing.fulfillment]}
                    </Text>
                    <View style={styles.badges}>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {edit?.edit_status === "pending" ? (
                        <Badge tone="warning">Cambios en revisión</Badge>
                      ) : null}
                      {edit?.edit_status === "rejected" ? (
                        <Badge tone="danger">Cambio no aprobado</Badge>
                      ) : null}
                      {listing.offer_status === "paused" ? (
                        <Badge tone="neutral">En pausa</Badge>
                      ) : null}
                      {edit && !edit.editable && listing.product_status !== "archived" ? (
                        <Badge tone="info">De otra tienda</Badge>
                      ) : null}
                    </View>
                    <View style={styles.figures}>
                      <Text variant="bodyStrong" style={styles.tabular} testID="listing-price">
                        {formatPrice(listing.price_minor)}
                      </Text>
                      <Text
                        variant="small"
                        tint={listing.available_quantity === 0 ? "warning" : "muted"}
                        testID="listing-stock"
                      >
                        {listing.available_quantity === 0
                          ? "Sin existencias"
                          : `${listing.available_quantity} disponibles`}
                      </Text>
                    </View>
                  </View>
                  <ChevronIcon size={20} color={colors.inkMuted} />
                </Pressable>
              </Link>
            );
          })}
        </View>
      )}
      <Text variant="small" tint="muted">
        Cuando varias tiendas venden el mismo producto, la oferta destacada es la nueva que tiene
        existencias y el precio más bajo; si cuestan lo mismo, la que se publicó antes. Las demás
        siguen visibles en la página del producto y se pueden comprar.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    backgroundColor: colors.surface,
  },
  separated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  body: { flex: 1, gap: 4 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  figures: { flexDirection: "row", alignItems: "baseline", gap: space[3] },
  tabular: { fontVariant: ["tabular-nums"] },
});
