import { colors, fontFamily, fontSize, radius, space, touchTarget } from "@yuntera/expo-kit/theme";
import { SearchIcon } from "@yuntera/expo-kit/ui";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

/**
 * The search field, as the website's header has it ("¿Qué ocupa?"). Search
 * itself tolerates typos in the database, so nothing is corrected here.
 */
export function SearchBox({
  initial = "",
  onSubmit,
  onChangeText,
  autoFocus = false,
  testID = "search-input",
}: {
  initial?: string;
  onSubmit?: (query: string) => void;
  onChangeText?: (query: string) => void;
  autoFocus?: boolean;
  testID?: string;
}) {
  const [query, setQuery] = useState(initial);
  const submit = () => {
    const q = query.trim().slice(0, 120);
    if (onSubmit) onSubmit(q);
    else router.push({ pathname: "/buscar", params: q ? { q } : {} });
  };
  return (
    <View style={styles.row}>
      <TextInput
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          onChangeText?.(text);
        }}
        onSubmitEditing={submit}
        placeholder="¿Qué ocupa?"
        placeholderTextColor={colors.palette.anil[500]}
        aria-label="Buscar productos"
        returnKeyType="search"
        enterKeyHint="search"
        inputMode="search"
        autoCorrect={false}
        autoFocus={autoFocus}
        style={styles.input}
        testID={testID}
      />
      <Pressable
        role="button"
        aria-label="Buscar"
        onPress={submit}
        style={({ pressed }) => [
          styles.button,
          pressed ? { backgroundColor: colors.brandHover } : null,
        ]}
        testID={`${testID}-submit`}
      >
        <SearchIcon color={colors.onBrand} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space[2] },
  input: {
    flex: 1,
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    color: colors.ink,
  },
  button: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
