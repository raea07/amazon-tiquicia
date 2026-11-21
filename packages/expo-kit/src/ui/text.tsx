import {
  Text as RNText,
  type TextProps as RNTextProps,
  StyleSheet,
  type TextStyle,
} from "react-native";
import { colors, fontFamily, fontSize, lineHeight } from "../theme/tokens";

/**
 * Text styles of the brand (brand book §8): Bricolage Grotesque for headings,
 * prices and big numbers; Inter for everything else. Body copy is never below
 * 16 px. Headings are announced as headings.
 */
export const textStyles = StyleSheet.create({
  display: {
    fontFamily: fontFamily.display,
    fontWeight: "800",
    fontSize: fontSize["3xl"],
    lineHeight: lineHeight["3xl"],
    letterSpacing: -0.45,
  },
  title: {
    fontFamily: fontFamily.display,
    fontWeight: "700",
    fontSize: fontSize["2xl"],
    lineHeight: lineHeight["2xl"],
    letterSpacing: -0.36,
  },
  heading: {
    fontFamily: fontFamily.display,
    fontWeight: "700",
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    letterSpacing: -0.3,
  },
  subheading: {
    fontFamily: fontFamily.body,
    fontWeight: "600",
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
  },
  body: {
    fontFamily: fontFamily.body,
    fontWeight: "400",
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
  },
  bodyStrong: {
    fontFamily: fontFamily.body,
    fontWeight: "600",
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
  },
  small: {
    fontFamily: fontFamily.body,
    fontWeight: "400",
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
  },
  smallStrong: {
    fontFamily: fontFamily.body,
    fontWeight: "600",
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
  },
  caption: {
    fontFamily: fontFamily.body,
    fontWeight: "500",
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
  },
  figure: {
    fontFamily: fontFamily.display,
    fontWeight: "700",
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    fontVariant: ["tabular-nums"],
  },
});

export type TextVariant = keyof typeof textStyles;

const tint = {
  ink: colors.ink,
  muted: colors.inkMuted,
  link: colors.link,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  onBrand: colors.onBrand,
} as const;

export type TextTint = keyof typeof tint;

const HEADINGS: Partial<Record<TextVariant, number>> = { display: 1, title: 1, heading: 2 };

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tint?: TextTint;
  /** Overrides the heading level a title or heading is announced with. */
  level?: 1 | 2 | 3;
  align?: TextStyle["textAlign"];
}

export function Text({
  variant = "body",
  tint: colour = "ink",
  level,
  align,
  style,
  ...props
}: TextProps) {
  const headingLevel = level ?? HEADINGS[variant];
  return (
    <RNText
      role={headingLevel ? "heading" : undefined}
      aria-level={headingLevel}
      style={[
        textStyles[variant],
        { color: tint[colour] },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...props}
    />
  );
}
