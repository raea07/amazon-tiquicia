import type { CatalogMatch } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { colors, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  formatPrice,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import { AddOfferForm } from "@/components/add-offer-form";
import { ProductThumb } from "@/components/parts";
import { catalogQuery, catalogRefusal } from "@/lib/seller-listings";
import { shopKey, useShop } from "@/lib/shops";

/** One variant of another shop's product: already offered, or the form to offer it. */
function Variant({
  match,
  variant,
  index,
}: {
  match: CatalogMatch;
  variant: CatalogMatch["variants"][number];
  index: number;
}) {
  const name = variant.variant_name || "Única";
  const label = `${match.title}${variant.variant_name ? `, ${variant.variant_name}` : ""}`;
  return (
    <View
      style={{
        gap: space[2],
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: space[3],
      }}
      testID={`catalog-variant-${match.slug}-${index}`}
    >
      <Text variant="bodyStrong">
        {match.variants.length > 1 ? `Variante: ${name}` : "Su oferta"}
      </Text>
      <Text variant="small" tint="muted">
        {variant.offer_count === 1
          ? "1 tienda lo vende"
          : `${variant.offer_count} tiendas lo venden`}
        {variant.lowest_price_minor ? ` · desde ${formatPrice(variant.lowest_price_minor)}` : ""}
        {variant.gtin ? ` · código ${variant.gtin}` : ""}
      </Text>
      {variant.my_offer_id && variant.my_offer_status !== "archived" ? (
        <Stack gap={2}>
          <Badge tone="success">Ya lo ofrece</Badge>
          <LinkButton
            href={{ pathname: "/oferta/[id]", params: { id: variant.my_offer_id } }}
            variant="secondary"
            block
          >
            Cambiar su precio o sus existencias
          </LinkButton>
        </Stack>
      ) : (
        <Stack gap={2}>
          {variant.my_offer_status === "archived" ? (
            <Text variant="small" tint="muted">
              Usted lo ofreció antes; su oferta vuelve a la venta con estos datos.
            </Text>
          ) : null}
          <AddOfferForm
            skuId={variant.sku_id}
            label={label}
            fitsWarehouse={variant.fits_warehouse}
            testID={`add-offer-${match.slug}-${index}`}
          />
        </Stack>
      )}
    </View>
  );
}

/**
 * Selling a product another shop already published: find it by name, brand
 * or barcode and add the shop's own offer to a variant. No review: the
 * product's text and photos were already approved, and they stay the other
 * shop's. Only the price and how it ships are this shop's. The seller
 * centre's "Vender un producto que ya existe".
 */
export default function OfferOnExistingScreen() {
  const shop = useShop();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const results = useApiQuery(
    shopKey(shop.id, "catalog", query),
    (api) => api.sellerCatalogSearch(shop.id, query),
    { personal: true, enabled: query.length >= 2, staleTime: 0 },
  );
  const search = () => setQuery(catalogQuery(typed));

  return (
    <Screen>
      <Text tint="muted">
        Si el producto ya está publicado en Yuntera, no lo publique otra vez: agregue su oferta y
        aparecerá en la misma página, junto a las de otras tiendas.
      </Text>
      <TextField
        label="Nombre, marca o código de barras"
        value={typed}
        onChangeText={setTyped}
        maxLength={200}
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={search}
        testID="catalog-query"
      />
      <Button onPress={search} testID="catalog-search">
        Buscar
      </Button>
      {typed.trim().length === 1 ? (
        <Text variant="small" tint="muted">
          Escriba al menos dos letras o números.
        </Text>
      ) : null}

      {query.length < 2 ? null : results.isPending ? (
        <LoadingState label="Buscando…" />
      ) : results.isError ? (
        <Alert tone="warning" testID="catalog-refusal">
          {catalogRefusal(results.error, messageOf(results.error))}
        </Alert>
      ) : results.data.length === 0 ? (
        <EmptyState
          title="No encontramos ese producto publicado"
          action={<LinkButton href="/publicar">Publicarlo como producto nuevo</LinkButton>}
        >
          Pruebe con otro nombre, la marca o el código de barras del empaque. Si nadie lo vende
          todavía, publíquelo usted.
        </EmptyState>
      ) : (
        <Stack gap={4}>
          {results.data.map((match) => (
            <Card key={match.product_id} testID={`catalog-match-${match.slug}`}>
              <View style={{ flexDirection: "row", gap: space[3] }}>
                <ProductThumb path={match.image_path} size={64} />
                <View style={{ flex: 1, gap: 2 }}>
                  {match.brand ? (
                    <Text variant="caption" tint="muted">
                      {match.brand.toUpperCase()}
                    </Text>
                  ) : null}
                  <Text variant="bodyStrong">{match.title}</Text>
                  <Text variant="small" tint="muted">
                    {match.category_name}
                    {match.shop_name ? ` · Publicado por ${match.shop_name}` : ""}
                  </Text>
                </View>
              </View>
              {match.own_listing ? (
                <Stack gap={2}>
                  <Badge tone="info">Es de su tienda</Badge>
                  <Text variant="small">
                    Cambie su precio y sus existencias desde la lista de productos.
                  </Text>
                  <LinkButton href="/productos" variant="secondary" block>
                    Ver sus productos
                  </LinkButton>
                </Stack>
              ) : (
                match.variants.map((variant, index) => (
                  <Variant key={variant.sku_id} match={match} variant={variant} index={index} />
                ))
              )}
            </Card>
          ))}
        </Stack>
      )}

      <Text variant="small" tint="muted">
        La tienda que publicó el producto es la que cambia el título, las fotos y la descripción.
        Usted maneja su precio, sus existencias y si su oferta está a la venta. Puede agregar hasta
        30 ofertas así por día.
      </Text>
    </Screen>
  );
}
