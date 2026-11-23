import { useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import { Text } from "@yuntera/expo-kit/ui";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Listing, type ListingChange, parseSort } from "@/components/listing";
import { SearchBox } from "@/components/search-box";
import { parseBrand } from "@/lib/brand-filter";

/**
 * Search, at /buscar?q=… like the website. The query and the options live in
 * the address, so a link (later, from the website) opens the same results.
 * While typing, matching product names are offered as shortcuts.
 */
export default function SearchScreen() {
  const params = useLocalSearchParams<{
    q?: string;
    orden?: string;
    disponibles?: string;
    marca?: string;
  }>();
  const query = oneParam(params.q)?.trim().slice(0, 120) || undefined;
  const brand = parseBrand(oneParam(params.marca));
  const sort = parseSort(oneParam(params.orden));
  const inStock = oneParam(params.disponibles) === "1";
  const [typing, setTyping] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(typing.trim()), 250);
    return () => clearTimeout(timer);
  }, [typing]);

  const suggestions = useApiQuery(
    ["suggest", debounced],
    (api) => api.suggestProducts(debounced, 6),
    { enabled: debounced.length >= 2 && debounced !== query },
  );
  const showSuggestions =
    debounced.length >= 2 && debounced !== query && (suggestions.data?.length ?? 0) > 0;

  return (
    <Listing
      key={`${query ?? ""}|${brand ?? ""}|${sort}|${inStock}`}
      query={query}
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
      onClearQuery={() => router.setParams({ q: undefined })}
      header={
        <View style={styles.header}>
          <SearchBox
            key={query ?? ""}
            initial={query ?? ""}
            onChangeText={setTyping}
            onSubmit={(q) => {
              setTyping("");
              setDebounced("");
              router.setParams({ q: q || undefined });
            }}
          />
          {showSuggestions ? (
            <View style={styles.suggestions} role="list" aria-label="Sugerencias">
              {suggestions.data?.map((item) => (
                <Link
                  key={item.slug}
                  href={{ pathname: "/p/[slug]", params: { slug: item.slug } }}
                  asChild
                >
                  <Pressable role="link" style={styles.suggestion}>
                    <Text numberOfLines={1}>{item.title}</Text>
                  </Pressable>
                </Link>
              ))}
            </View>
          ) : null}
          <Text variant="title" testID="search-title">
            {query ? `Resultados para “${query}”` : "Todos los productos"}
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: space[3] },
  suggestions: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  suggestion: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
