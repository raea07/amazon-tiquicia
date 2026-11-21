import { colors, radius, space, touchTarget } from "@yuntera/expo-kit/theme";
import { Text } from "@yuntera/expo-kit/ui";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * How many units: − n +. Each button is a full 44 pt target and says what it
 * does; the number is announced as it changes.
 */
export function QuantityStepper({
  value,
  max,
  min = 1,
  onChange,
  label = "Cantidad",
  testID,
}: {
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
  label?: string;
  testID?: string;
}) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.row} role="group" aria-label={`${label}: ${value}`} testID={testID}>
      <Pressable
        role="button"
        aria-label="Una unidad menos"
        aria-disabled={atMin}
        disabled={atMin}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.button, atMin ? styles.off : null]}
      >
        <Text variant="subheading" tint="link">
          −
        </Text>
      </Pressable>
      <Text variant="bodyStrong" style={styles.value} aria-live="polite">
        {value}
      </Text>
      <Pressable
        role="button"
        aria-label="Una unidad más"
        aria-disabled={atMax}
        disabled={atMax}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.button, atMax ? styles.off : null]}
        testID={testID ? `${testID}-more` : undefined}
      >
        <Text variant="subheading" tint="link">
          +
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  button: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  off: { opacity: 0.35 },
  value: {
    minWidth: 28,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    paddingHorizontal: space[1],
  },
});
