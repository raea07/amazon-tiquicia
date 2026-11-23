import { brand } from "@yuntera/brand";
import { AccountDeletedNotice } from "@yuntera/expo-kit/account";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import {
  Card,
  ErrorState,
  LinkButton,
  LoadingState,
  Logo,
  PinIcon,
  Screen,
  SectionHeader,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { ProductGrid } from "@/components/product";
import { SearchBox } from "@/components/search-box";
import { useDistrictName } from "@/lib/catalog";

const PROMISES: Array<[string, string]> = [
  [
    "Entrega al día siguiente",
    "Hoy, en el GAM, si pide antes de las 2 p. m. Con nuestros propios repartidores.",
  ],
  ["Pague como prefiera", "SINPE Móvil, tarjeta o en efectivo cuando recibe."],
  [
    "Devoluciones sin enredos",
    "Tiene 8 días hábiles desde que recibe para devolver, sin dar explicaciones.",
  ],
  ["Factura electrónica", "De cada vendedor, directo a su correo."],
];

/** Home: the same content as the website's home, arranged for a phone. */
export default function HomeScreen() {
  const categories = useApiQuery(["categories"], (api) => api.listCategories(), {
    staleTime: 60 * 60_000,
  });
  const popular = useApiQuery(["search", "popular"], (api) =>
    api.searchProducts({ inStockOnly: true, limit: 8 }),
  );
  const madeHere = useApiQuery(["search", "made-in-cr"], (api) =>
    api.searchProducts({ madeInCr: true, inStockOnly: true, limit: 4 }),
  );
  const zone = useDistrictName();

  const refreshing = categories.isRefetching || popular.isRefetching || madeHere.isRefetching;
  const refresh = () => {
    void categories.refetch();
    void popular.refetch();
    void madeHere.refetch();
  };
  const departments = (categories.data ?? []).filter((c) => !c.parent_slug && c.product_count > 0);

  return (
    <Screen edges={["top", "left", "right"]} refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.top}>
        <Logo size={28} />
        <Link href="/zona" asChild>
          <Pressable
            role="link"
            style={styles.zone}
            aria-label={`Entregar en ${zone ?? "su zona"}. Cambiar`}
          >
            <PinIcon size={18} color={colors.brand} />
            <Text variant="smallStrong" numberOfLines={1}>
              {zone ?? "Elija su zona"}
            </Text>
          </Pressable>
        </Link>
      </View>

      {/* Once, right after an account deletion brought the shopper back here. */}
      <AccountDeletedNotice />

      <SearchBox testID="home-search-input" />

      <View style={styles.hero}>
        <Text variant="display">{brand.taglines["es-CR"].primary}</Text>
        <Text tint="muted">
          Compre a vendedores costarricenses y nosotros mismos se lo llevamos. Hoy entregamos al día
          siguiente en el Gran Área Metropolitana.
        </Text>
        <View style={styles.heroActions}>
          <LinkButton href="/buscar">Ver todos los productos</LinkButton>
          <LinkButton href="/c/hecho-en-cr" variant="secondary">
            Hecho en Costa Rica
          </LinkButton>
        </View>
      </View>

      <Stack gap={2}>
        {PROMISES.map(([title, text]) => (
          <Card key={title} style={styles.promise}>
            <Text variant="bodyStrong">{title}</Text>
            <Text variant="small" tint="muted">
              {text}
            </Text>
          </Card>
        ))}
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Categorías" />
        {categories.isPending ? (
          <LoadingState />
        ) : categories.isError ? (
          <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
        ) : (
          <View style={styles.categories}>
            {departments.map((category) => (
              <Link
                key={category.slug}
                href={{ pathname: "/c/[slug]", params: { slug: category.slug } }}
                asChild
              >
                <Pressable role="link" style={styles.category}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {category.name_es}
                  </Text>
                  <Text variant="caption" tint="muted">
                    {category.product_count}{" "}
                    {category.product_count === 1 ? "producto" : "productos"}
                  </Text>
                </Pressable>
              </Link>
            ))}
          </View>
        )}
      </Stack>

      {madeHere.data && madeHere.data.length > 0 ? (
        <Stack gap={3}>
          <SectionHeader
            title="Hecho en Costa Rica"
            action={
              <Link href="/c/hecho-en-cr" style={styles.more}>
                <Text variant="smallStrong" tint="link">
                  Ver todo
                </Text>
              </Link>
            }
          />
          <ProductGrid products={madeHere.data} testIDPrefix="home-product" />
        </Stack>
      ) : null}

      <Stack gap={3}>
        <SectionHeader title="Lo que más se está llevando" />
        {popular.isPending ? (
          <LoadingState label="Cargando productos…" />
        ) : popular.isError ? (
          <ErrorState error={popular.error} onRetry={() => void popular.refetch()} />
        ) : (
          <ProductGrid products={popular.data} testIDPrefix="home-product" />
        )}
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
  },
  zone: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    minHeight: 44,
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    flexShrink: 1,
  },
  hero: {
    gap: space[3],
    backgroundColor: colors.palette.celeste[50],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.palette.celeste[200],
    padding: space[5],
  },
  heroActions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  promise: { gap: space[1], paddingVertical: space[3] },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  category: {
    width: "48%",
    flexGrow: 1,
    minHeight: 72,
    justifyContent: "center",
    gap: 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  more: { minHeight: 44, paddingVertical: space[3], paddingHorizontal: space[1] },
});
