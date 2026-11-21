import { type ReactNode, useId } from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { colors, fontFamily, fontSize, radius, space, touchTarget } from "../theme/tokens";
import { CheckIcon } from "./icons";
import { Text } from "./text";

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  /** Always visible above the field; never only a placeholder. */
  label: string;
  hint?: string;
  error?: string | null;
  /** Shown as "(opcional)" next to the label. Required is the default and unmarked. */
  optional?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A labelled text field with its hint or error underneath, announced with the label. */
export function TextField({
  label,
  hint,
  error,
  optional,
  style,
  multiline,
  ...props
}: TextFieldProps) {
  const id = useId().replace(/:/g, "");
  return (
    <View style={[styles.field, style]}>
      <Text variant="smallStrong" nativeID={`${id}-label`}>
        {label}
        {optional ? (
          <Text variant="small" tint="muted">
            {" "}
            (opcional)
          </Text>
        ) : null}
      </Text>
      <TextInput
        aria-label={label}
        aria-labelledby={`${id}-label`}
        aria-invalid={Boolean(error)}
        placeholderTextColor={colors.palette.anil[500]}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          error ? { borderColor: colors.danger } : null,
        ]}
        {...props}
      />
      {error ? (
        <Text variant="small" tint="danger" role="alert" style={styles.error}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tint="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A tick box, unticked unless the person ticks it. The whole row is the target. */
export function Checkbox({
  checked,
  onChange,
  children,
  testID,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      role="checkbox"
      aria-checked={checked}
      onPress={() => onChange(!checked)}
      testID={testID}
      style={styles.choice}
    >
      <View style={[styles.box, checked ? styles.boxOn : null]}>
        {checked ? <CheckIcon size={16} color={colors.onBrand} /> : null}
      </View>
      <View style={styles.choiceText}>{children}</View>
    </Pressable>
  );
}

export interface Choice<T extends string> {
  value: T;
  title: string;
  description?: string;
  disabled?: boolean;
  /** Said instead of the description when the choice is disabled. */
  disabledReason?: string;
}

/**
 * One choice among several, as large rows (an address, a payment method).
 * `value` starts as whatever the screen passes: null means nothing is chosen,
 * which is how checkout starts for the payment method.
 */
export function ChoiceList<T extends string>({
  label,
  choices,
  value,
  onChange,
  testID,
}: {
  label: string;
  choices: Array<Choice<T>>;
  value: T | null;
  onChange: (value: T) => void;
  testID?: string;
}) {
  return (
    <View role="radiogroup" aria-label={label} style={styles.list} testID={testID}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            role="radio"
            aria-checked={selected}
            aria-disabled={choice.disabled}
            disabled={choice.disabled}
            onPress={() => onChange(choice.value)}
            testID={testID ? `${testID}-${choice.value}` : undefined}
            style={({ pressed }) => [
              styles.option,
              selected ? styles.optionOn : null,
              choice.disabled ? styles.optionOff : null,
              pressed && !selected ? { backgroundColor: colors.surfaceMuted } : null,
            ]}
          >
            <View style={[styles.radio, selected ? styles.radioOn : null]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.choiceText}>
              <Text variant="bodyStrong">{choice.title}</Text>
              {choice.disabled && choice.disabledReason ? (
                <Text variant="small" tint="warning">
                  {choice.disabledReason}
                </Text>
              ) : choice.description ? (
                <Text variant="small" tint="muted">
                  {choice.description}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] + 2 },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontFamily: fontFamily.body,
    // 16 px or more: smaller text makes iOS zoom into the field.
    fontSize: fontSize.base,
    color: colors.ink,
  },
  multiline: { minHeight: 96 },
  error: { fontWeight: "500" },
  choice: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[2],
  },
  box: {
    width: 24,
    height: 24,
    marginTop: 1,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  choiceText: { flex: 1, gap: 2 },
  list: { gap: space[2] },
  option: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
  optionOff: { opacity: 0.6, backgroundColor: colors.surfaceMuted },
  radio: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
});
