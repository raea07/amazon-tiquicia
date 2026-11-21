import { useInfiniteQuery } from "@tanstack/react-query";
import type { SearchInput } from "@yuntera/db";
import { useApi } from "@yuntera/expo-kit/auth";
import { colors, gutter, radius, space, touchTarget } from "@yuntera/expo-kit/theme";
import { Button, EmptyState, ErrorState, LoadingState, Text } from "@yuntera/expo-kit/ui";
import type { ReactElement } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProductCard } from "./product";

export const PAGE_SIZE = 24;

export const SORTS = [
  ["relevance", "Más relevantes"],
  ["price_asc", "Precio: menor a mayor"],
  ["price_desc", "Precio: mayor a menor"],
  ["rating", "Mejor calificados"],
  ["newest", "Más nuevos"],
] as const;

export type SortKey = (typeof SORTS)[number][0];

export function parseSort(value: string | undefined): SortKey {
  return SORTS.find(([key]) => key === value)?.[0] ?? "relevance";
}

function Chip({
  label,
  selected,
  onPress,
  role,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role: "radio" | "checkbox";
}) {
  return (
    <Pressable
      role={role}
      aria-checked={selected}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipOn : null]}
    >
      <Text
        variant="smallStrong"
        style={{ color: selected ? colors.palette.white : colors.inkMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Results with sort, the in-stock filter and endless paging, for search and
 * categories. The same options as the website's listing, in the same words.
 */
export function Listing({
  query,
  categorySlug,
  sort,
  inStock,
  onChange,
  header,
  onClearQuery,
}: {
  query?: string;
  categorySlug?: string;
  sort: SortKey;
  inStock: boolean;
  onChange: (next: { sort?: SortKey; inStock?: boolean }) => void;
  header?: ReactElement;
  onClearQuery?: () => void;
}) {
  const api = useApi();
  const results = useInfiniteQuery({
    queryKey: ["search", "listing", query ?? "", categorySlug ?? "", sort, inStock],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const input: SearchInput = {
        query: query || null,
        categorySlug: categorySlug ?? null,
        sort,
        inStockOnly: inStock,
        limit: PAGE_SIZE,
        offset: pageParam * PAGE_SIZE,
      };
      return api.searchProducts(input);
    },
    getNextPageParam: (last, pages) => {
      const total = last[0]?.total_count ?? 0;
      return pages.length * PAGE_SIZE < total ? pages.length : undefined;
    },
  });
  const products = results.data?.pages.flat() ?? [];
  const total = results.data?.pages[0]?.[0]?.total_count ?? 0;

  const controls = (
    <View style={styles.controls}>
      {header}
      {results.isSuccess && products.length > 0 ? (
        <Text variant="small" tint="muted" aria-live="polite">
          {total} {total === 1 ? "producto" : "productos"}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          role="checkbox"
          label="Solo disponibles"
          selected={inStock}
          onPress={() => onChange({ inStock: !inStock })}
        />
        <View role="radiogroup" aria-label="Ordenar resultados" style={styles.chips}>
          {SORTS.map(([key, label]) => (
            <Chip
              key={key}
              role="radio"
              label={label}
              selected={sort === key}
              onPress={() => onChange({ sort: key })}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.page}>
      <FlatList
        data={results.isSuccess ? products : []}
        keyExtractor={(item) => item.slug}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={controls}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <ProductCard product={item} />
          </View>
        )}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={results.isRefetching && !results.isFetchingNextPage}
            onRefresh={() => void results.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        ListEmptyComponent={
          results.isPending ? (
            <LoadingState label="Cargando productos…" />
          ) : results.isError ? (
            <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          ) : (
            <EmptyState
              title={
                query
                  ? `No encontramos resultados para “${query}”`
                  : "Todavía no hay productos aquí"
              }
              action={
                query && onClearQuery ? (
                  <Button variant="secondary" onPress={onClearQuery}>
                    Ver todos los productos
                  </Button>
                ) : undefined
              }
            >
              {query
                ? "Revise la ortografía o pruebe con una palabra más general. También puede explorar por categoría."
                : "Estamos sumando vendedores. Vuelva pronto."}
            </EmptyState>
          )
        }
        ListFooterComponent={
          results.isFetchingNextPage ? (
            <ActivityIndicator
              color={colors.brand}
              style={styles.more}
              aria-label="Cargando más productos"
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: gutter, paddingTop: space[3], gap: space[3], flexGrow: 1 },
  controls: { gap: space[3], marginBottom: space[1] },
  columns: { gap: space[3] },
  cell: { flex: 1, maxWidth: "50%" },
  chips: { flexDirection: "row", gap: space[2], alignItems: "center" },
  chip: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.palette.anil[900], borderColor: colors.palette.anil[900] },
  more: { padding: space[4] },
});
