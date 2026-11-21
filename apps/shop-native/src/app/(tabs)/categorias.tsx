import { colors, space } from "@yuntera/expo-kit/theme";
import { Divider, ErrorState, ListRow, LoadingState, Screen, Text } from "@yuntera/expo-kit/ui";
import { View } from "react-native";
import { useCategories } from "@/lib/catalog";

/** Every department with products, and its sub-categories, as the website's category bar. */
export default function CategoriesScreen() {
  const categories = useCategories();
  if (categories.isPending) return <LoadingState label="Cargando categorías…" />;
  if (categories.isError)
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />;

  const all = categories.data;
  const departments = all.filter((c) => !c.parent_slug && c.product_count > 0);

  return (
    <Screen
      padded={false}
      refreshing={categories.isRefetching}
      onRefresh={() => void categories.refetch()}
    >
      <View style={{ paddingVertical: space[2] }}>
        {departments.map((department) => {
          const children = all.filter(
            (c) => c.parent_slug === department.slug && c.product_count > 0,
          );
          return (
            <View key={department.slug} style={{ marginBottom: space[4] }}>
              <ListRow
                href={{ pathname: "/c/[slug]", params: { slug: department.slug } }}
                title={department.name_es}
                testID={`department-${department.slug}`}
                subtitle={`${department.product_count} ${department.product_count === 1 ? "producto" : "productos"}`}
              />
              {children.map((child) => (
                <View key={child.slug}>
                  <Divider />
                  <View style={{ backgroundColor: colors.surface, paddingLeft: space[4] }}>
                    <ListRow
                      href={{ pathname: "/c/[slug]", params: { slug: child.slug } }}
                      title={child.name_es}
                      subtitle={`${child.product_count} ${child.product_count === 1 ? "producto" : "productos"}`}
                    />
                  </View>
                </View>
              ))}
            </View>
          );
        })}
        {departments.length === 0 ? (
          <Text tint="muted" style={{ padding: space[4] }}>
            Estamos sumando vendedores. Vuelva pronto.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
