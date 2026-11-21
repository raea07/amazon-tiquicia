import { Link, type LinkProps } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { colors, fontSize, radius, space, touchTarget } from "../theme/tokens";
import { Text, type TextTint } from "./text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const VARIANT: Record<
  ButtonVariant,
  { bg: string; pressed: string; border: string; text: TextTint }
> = {
  primary: { bg: colors.brand, pressed: colors.brandHover, border: colors.brand, text: "onBrand" },
  secondary: {
    bg: colors.surface,
    pressed: colors.surfaceMuted,
    border: colors.fieldBorder,
    text: "ink",
  },
  ghost: { bg: "transparent", pressed: colors.brandSoft, border: "transparent", text: "link" },
  danger: {
    bg: colors.danger,
    pressed: colors.palette.achiote[700],
    border: colors.danger,
    text: "onBrand",
  },
};

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  /** What the button does, in words: "Confirmar pedido por ₡29 800", not "Continuar". */
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** While true the button cannot be pressed again and says what is happening. */
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

function ButtonBody({
  children,
  variant,
  size,
  loading,
  loadingLabel,
  icon,
}: Pick<ButtonProps, "children" | "icon" | "loading" | "loadingLabel"> & {
  variant: ButtonVariant;
  size: ButtonSize;
}) {
  const look = VARIANT[variant];
  return (
    <>
      {loading ? (
        <ActivityIndicator
          color={look.text === "onBrand" ? colors.onBrand : colors.brand}
          aria-hidden
        />
      ) : (
        icon
      )}
      <Text
        variant="bodyStrong"
        tint={look.text}
        style={size === "lg" ? { fontSize: fontSize.lg } : null}
        numberOfLines={2}
        align="center"
      >
        {loading ? (loadingLabel ?? "Un momento…") : children}
      </Text>
    </>
  );
}

const frame = (variant: ButtonVariant, size: ButtonSize, block: boolean, pressed: boolean) => {
  const look = VARIANT[variant];
  return [
    styles.base,
    size === "lg" ? styles.large : null,
    block ? styles.block : null,
    { backgroundColor: pressed ? look.pressed : look.bg, borderColor: look.border },
  ];
};

/** A button at least 44 pt tall, announced as a button, that cannot be pressed twice while busy. */
export function Button({
  children,
  variant = "primary",
  size = "md",
  block = false,
  loading = false,
  loadingLabel,
  icon,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const inactive = Boolean(disabled || loading);
  return (
    <Pressable
      role="button"
      aria-disabled={inactive}
      aria-busy={loading}
      disabled={inactive}
      style={({ pressed }) => [
        ...frame(variant, size, block, pressed),
        inactive ? styles.inactive : null,
        style,
      ]}
      {...props}
    >
      <ButtonBody
        variant={variant}
        size={size}
        loading={loading}
        loadingLabel={loadingLabel}
        icon={icon}
      >
        {children}
      </ButtonBody>
    </Pressable>
  );
}

/** A link that looks like a button: a real link on the web, a navigation on a phone. */
export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  block = false,
  icon,
  style,
  ...props
}: Omit<ButtonProps, "loading" | "loadingLabel" | "onPress"> & { href: LinkProps["href"] }) {
  return (
    <Link href={href} asChild>
      <Pressable
        role="link"
        // One flat style object: on the web, Link (asChild) passes the child's
        // style straight to the DOM, which accepts neither a function nor an array.
        style={StyleSheet.flatten([...frame(variant, size, block, false), style])}
        {...props}
      >
        <ButtonBody variant={variant} size={size} icon={icon}>
          {children}
        </ButtonBody>
      </Pressable>
    </Link>
  );
}

/** A round icon-only button. `label` is what a screen reader says. */
export function IconButton({
  label,
  children,
  style,
  ...props
}: Omit<PressableProps, "children" | "style"> & {
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.icon,
        pressed ? { backgroundColor: colors.surfaceMuted } : null,
        style,
      ]}
      {...props}
    >
      <View pointerEvents="none">{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    alignSelf: "flex-start",
  },
  large: { minHeight: 52, paddingHorizontal: space[6] },
  block: { alignSelf: "stretch" },
  inactive: { opacity: 0.55 },
  icon: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
