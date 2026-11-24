import { useInfiniteQuery } from "@tanstack/react-query";
import type { CatalogSearchInput } from "@yuntera/db";
import { useApi } from "@yuntera/expo-kit/auth";
import { readTimeoutOf, useApiQuery, withReadTimeout } from "@yuntera/expo-kit/data";
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
import { KeptNotice } from "@/components/kept-notice";
import {
  BRAND_EMPTY,
  brandOptions,
  brandSummary,
  currentBrand,
  settledTotal,
  showBrandFilter,
} from "@/lib/brand-filter";
import { firstReadFailed, KEPT, refreshFailed } from "@/lib/kept-reads";
import { ProductCard } from "./product";
import { SelectSheet } from "./select-sheet";

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

/** The next state of a listing's options; `brand: null` takes the brand filter off. */
export interface ListingChange {
  sort?: SortKey;
  inStock?: boolean;
  brand?: string | null;
}

/**
 * Results with sort, the in-stock and brand filters and endless paging, for
 * search and categories. The same options as the website's listing, in the
 * same words.
 */
export function Listing({
  query,
  categorySlug,
  brand,
  sort,
  inStock,
  onChange,
  header,
  onClearQuery,
}: {
  query?: string;
  categorySlug?: string;
  /** A brand's address (`?marca=`), already checked with parseBrand. */
  brand?: string;
  sort: SortKey;
  inStock: boolean;
  onChange: (next: ListingChange) => void;
  header?: ReactElement;
  onClearQuery?: () => void;
}) {
  const api = useApi();
  // The brands of the category (or of the whole shop), with how many products
  // each has: a staff change, so kept a few minutes like the category menu.
  const brands = useApiQuery(
    ["brands", categorySlug ?? ""],
    (client) => client.listBrands(categorySlug ?? null),
    { staleTime: 5 * 60_000 },
  );
  const results = useInfiniteQuery({
    queryKey: ["search", "listing", query ?? "", categorySlug ?? "", brand ?? "", sort, inStock],
    initialPageParam: 0,
    queryFn: ({ pageParam, meta }) => {
      const input: CatalogSearchInput = {
        query: query || null,
        categorySlug: categorySlug ?? null,
        brandSlug: brand ?? null,
        sort,
        inStockOnly: inStock,
        limit: PAGE_SIZE,
        offset: pageParam * PAGE_SIZE,
      };
      // Within the app's time limit for a read (app/_layout.tsx), as every useApiQuery.
      return withReadTimeout(api.searchProducts(input), readTimeoutOf(meta));
    },
    getNextPageParam: (last, pages) => {
      const total = last[0]?.total_count ?? 0;
      return pages.length * PAGE_SIZE < total ? pages.length : undefined;
    },
  });
  // Only the answer for these options: a new search, brand or category has
  // its own key and starts empty (no placeholder data), so another one's
  // results are never shown under it.
  const products = results.data?.pages.flat() ?? [];
  // Results on screen and asking again failed (a background refresh, a pull
  // or the next page): they stay, and the screen says so above them.
  const kept = refreshFailed(results);
  const askAgain = () =>
    void (results.isFetchNextPageError ? results.fetchNextPage() : results.refetch());
  // Null until the search for these options has answered: while it loads
  // (a new filter, or brand A changed for brand B) no count is said.
  const total = settledTotal(results);
  const brandList = brands.data ?? [];
  const chosenBrand = currentBrand(brandList, brand);
  const clearBrand = () => onChange({ brand: null });

  const brandFilter = showBrandFilter(brandList, brand) ? (
    <View style={styles.brand} testID="brand-filter">
      <SelectSheet
        label="Marca"
        value={chosenBrand?.slug ?? (brand && !brands.isPending ? brand : "")}
        options={brandOptions(brandList)}
        onChange={(slug) => onChange({ brand: slug || null })}
        testID="brand"
      />
      {brand ? (
        <View style={styles.brandSummary}>
          {firstReadFailed(results) ? null : (
            <Text
              variant="small"
              aria-live="polite"
              aria-busy={total === null}
              testID="brand-summary"
            >
              {brandSummary(total, chosenBrand?.name)}
            </Text>
          )}
          <Button variant="ghost" onPress={clearBrand} testID="brand-clear">
            {BRAND_EMPTY.clear}
          </Button>
        </View>
      ) : null}
    </View>
  ) : null;

  const controls = (
    <View style={styles.controls}>
      {header}
      {kept ? (
        <KeptNotice
          title={KEPT.listing.title}
          body={KEPT.listing.body}
          error={results.error}
          onRetry={askAgain}
          retrying={results.isFetching}
          testID="listing-kept"
        />
      ) : null}
      {brandFilter}
      {total !== null && products.length > 0 && !brand ? (
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
        data={products}
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
          ) : firstReadFailed(results) ? (
            <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          ) : brand ? (
            <EmptyState
              title={BRAND_EMPTY.title}
              action={
                <Button variant="secondary" onPress={clearBrand}>
                  {BRAND_EMPTY.clear}
                </Button>
              }
            >
              {BRAND_EMPTY.body}
            </EmptyState>
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
  brand: { gap: space[2] },
  brandSummary: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  more: { padding: space[4] },
});
