import { colors, radius, space } from "@yuntera/expo-kit/theme";
import { Badge, Money, Text } from "@yuntera/expo-kit/ui";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { imageUrl } from "@/lib/env";

/** The fields a tile needs; search results and "related products" both provide them. */
export interface CardProduct {
  slug: string;
  title: string;
  image_path: string | null;
  min_price_minor: number;
  list_price_minor: number | null;
  in_stock: boolean;
  rating_sum: number;
  rating_count: number;
  fulfilled_by_platform: boolean;
  made_in_cr?: boolean;
  brand_name?: string | null;
}

export function ProductImage({
  path,
  size,
  label = "",
}: {
  path: string | null;
  size?: number;
  label?: string;
}) {
  const uri = imageUrl(path);
  return (
    <View
      style={[
        styles.image,
        size ? { width: size, height: size } : { aspectRatio: 1, width: "100%" },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityLabel={label}
          accessible={Boolean(label)}
          transition={120}
        />
      ) : null}
    </View>
  );
}

const STAR = "M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z";

/** The rating in words ("4,5 de 5"); the stars beside it are decoration. */
export function Stars({
  ratingSum,
  ratingCount,
  showCount = true,
}: {
  ratingSum: number;
  ratingCount: number;
  showCount?: boolean;
}) {
  if (ratingCount === 0) {
    return (
      <Text variant="small" tint="muted">
        Sin reseñas todavía
      </Text>
    );
  }
  const average = ratingSum / ratingCount;
  const filled = Math.round(average);
  const label = `${average.toLocaleString("es-CR", { maximumFractionDigits: 1 })} de 5`;
  return (
    <View style={styles.stars}>
      <View style={styles.starRow} aria-hidden>
        {[1, 2, 3, 4, 5].map((star) => (
          <Svg key={star} width={14} height={14} viewBox="0 0 20 20">
            <Path d={STAR} fill={star <= filled ? colors.rating : colors.palette.arena[300]} />
          </Svg>
        ))}
      </View>
      <Text variant="smallStrong">{label}</Text>
      {showCount ? (
        <Text variant="small" tint="muted">
          ({ratingCount} {ratingCount === 1 ? "reseña" : "reseñas"})
        </Text>
      ) : null}
    </View>
  );
}

/** A product tile. The whole tile is one large target that opens the product. */
export function ProductCard({
  product,
  testIDPrefix = "product",
}: {
  product: CardProduct;
  testIDPrefix?: string;
}) {
  return (
    <Link href={{ pathname: "/p/[slug]", params: { slug: product.slug } }} asChild>
      <Pressable
        role="link"
        aria-label={product.title}
        testID={`${testIDPrefix}-${product.slug}`}
        style={styles.card}
      >
        <View>
          <ProductImage path={product.image_path} />
          {product.made_in_cr ? (
            <View style={styles.badge}>
              <Badge tone="success">Hecho en Costa Rica</Badge>
            </View>
          ) : null}
        </View>
        <View style={styles.body}>
          {product.brand_name ? (
            <Text variant="caption" tint="muted" numberOfLines={1}>
              {product.brand_name.toUpperCase()}
            </Text>
          ) : null}
          <Text variant="smallStrong" numberOfLines={2} style={styles.title}>
            {product.title}
          </Text>
          <Stars
            ratingSum={product.rating_sum}
            ratingCount={product.rating_count}
            showCount={false}
          />
          <View style={styles.footer}>
            <Money
              amountMinor={product.min_price_minor}
              listAmountMinor={product.list_price_minor}
              size="sm"
            />
            {product.in_stock ? (
              <Text variant="caption" tint="muted">
                {product.fulfilled_by_platform
                  ? "Entregado por Yuntera"
                  : "Enviado por el vendedor"}
              </Text>
            ) : (
              <Text variant="caption" tint="warning" style={{ fontWeight: "600" }}>
                Agotado por ahora
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

/** Two columns on a phone, like the website's grid. */
export function ProductGrid({
  products,
  testIDPrefix,
}: {
  products: CardProduct[];
  /** Keeps test ids unique when several screens with grids are mounted at once. */
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.grid}>
      {products.map((product) => (
        <View key={product.slug} style={styles.cell}>
          <ProductCard product={product} testIDPrefix={testIDPrefix} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.palette.arena[100], overflow: "hidden" },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  badge: { position: "absolute", left: space[2], top: space[2] },
  body: { padding: space[3], gap: space[1] + 2, flex: 1 },
  title: { minHeight: 40 },
  footer: { marginTop: "auto", gap: 2, paddingTop: space[1] },
  stars: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  starRow: { flexDirection: "row" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -space[1] - 2 },
  cell: { width: "50%", padding: space[1] + 2 },
});
