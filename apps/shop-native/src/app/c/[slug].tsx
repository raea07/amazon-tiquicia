import { oneParam } from "@yuntera/expo-kit/paths";
import { colors, radius, space, touchTarget } from "@yuntera/expo-kit/theme";
import { EmptyState, LinkButton, LoadingState, Text } from "@yuntera/expo-kit/ui";
import { Link, router, Stack, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Listing, type ListingChange, parseSort } from "@/components/listing";
import { parseBrand } from "@/lib/brand-filter";
import { useCategories } from "@/lib/catalog";

/** A category, at /c/<slug> like the website: its sub-categories, then its products. */
export default function CategoryScreen() {
  const params = useLocalSearchParams<{
    slug: string;
    orden?: string;
    disponibles?: string;
    marca?: string;
  }>();
  const slug = oneParam(params.slug) ?? "";
  const brand = parseBrand(oneParam(params.marca));
  const sort = parseSort(oneParam(params.orden));
  const inStock = oneParam(params.disponibles) === "1";
  const categories = useCategories();

  if (categories.isPending) return <LoadingState label="Cargando categoría…" />;
  const category = categories.data?.find((c) => c.slug === slug);
  if (!category) {
    return (
      <EmptyState
        title="No encontramos esa categoría"
        action={<LinkButton href="/categorias">Ver categorías</LinkButton>}
      >
        Puede que el enlace esté mal escrito o que la categoría ya no exista.
      </EmptyState>
    );
  }
  const parent = categories.data?.find((c) => c.slug === category.parent_slug);
  const children = (categories.data ?? []).filter(
    (c) => c.parent_slug === slug && c.product_count > 0,
  );

  return (
    <>
      <Stack.Screen options={{ title: category.name_es }} />
      <Listing
        key={`${slug}|${brand ?? ""}|${sort}|${inStock}`}
        categorySlug={slug}
        brand={brand}
        sort={sort}
        inStock={inStock}
        onChange={(next: ListingChange) =>
          router.setParams({
            orden: (next.sort ?? sort) === "relevance" ? undefined : (next.sort ?? sort),
            disponibles: (next.inStock ?? inStock) ? "1" : undefined,
            marca: next.brand === null ? undefined : (next.brand ?? brand),
          })
        }
        header={
          <View style={styles.header}>
            {parent ? (
              <Link
                href={{ pathname: "/c/[slug]", params: { slug: parent.slug } }}
                style={styles.parent}
              >
                <Text variant="small" tint="link">
                  {`‹ ${parent.name_es}`}
                </Text>
              </Link>
            ) : null}
            {children.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.children}
              >
                {children.map((child) => (
                  <Link
                    key={child.slug}
                    href={{ pathname: "/c/[slug]", params: { slug: child.slug } }}
                    asChild
                  >
                    <Pressable role="link" style={styles.child}>
                      <Text variant="small">{child.name_es}</Text>
                    </Pressable>
                  </Link>
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[2] },
  parent: { minHeight: touchTarget, paddingVertical: space[3] },
  children: { gap: space[2] },
  child: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
  },
});
