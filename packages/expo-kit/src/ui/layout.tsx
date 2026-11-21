import { Link, type LinkProps } from "expo-router";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";
import { colors, gutter, radius, space } from "../theme/tokens";
import { ChevronIcon } from "./icons";
import { Text } from "./text";

/**
 * The frame of a screen: the page colour, the safe areas (notch, home bar),
 * room for the keyboard, an optional pull-to-refresh, and an optional footer
 * that stays at the bottom, within reach of a thumb, for the screen's main action.
 *
 * Screens under a navigation header pass `edges={["bottom"]}` (the default);
 * screens without one add "top".
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  edges = ["bottom", "left", "right"],
  padded = true,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  edges?: Edge[];
  padded?: boolean;
  testID?: string;
}) {
  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[padded ? styles.padded : null, styles.grow]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padded ? styles.padded : null]}>{children}</View>
  );

  return (
    <SafeAreaView
      edges={footer ? edges.filter((edge) => edge !== "bottom") : edges}
      style={styles.page}
      testID={testID}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        {body}
        {footer ? (
          <SafeAreaView edges={["bottom"]} style={styles.footer}>
            {footer}
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Vertical rhythm between the blocks of a screen. */
export function Stack({
  gap = 4,
  children,
  style,
}: {
  gap?: keyof typeof space;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ gap: space[gap] }, style]}>{children}</View>;
}

export function Card({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

/** A heading with an optional action on the right ("Ver todo"). */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="heading" style={styles.fill}>
        {title}
      </Text>
      {action}
    </View>
  );
}

interface RowContent {
  title: string;
  subtitle?: string;
  /** Shown on the left: an image or an icon. */
  leading?: ReactNode;
  /** Shown on the right, before the chevron: a price, a badge. */
  trailing?: ReactNode;
}

function RowBody({
  title,
  subtitle,
  leading,
  trailing,
  chevron,
}: RowContent & { chevron: boolean }) {
  return (
    <>
      {leading}
      <View style={styles.rowText}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tint="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <ChevronIcon size={20} color={colors.inkMuted} /> : null}
    </>
  );
}

/** A row in a list that opens something. The whole row is the target, at least 56 pt tall. */
export function ListRow({
  href,
  onPress,
  testID,
  ...content
}: RowContent & { href?: LinkProps["href"]; onPress?: () => void; testID?: string }) {
  const pressable = (
    <Pressable
      role={href ? "link" : "button"}
      onPress={onPress}
      testID={testID}
      // Static style when wrapped in a Link: Link (asChild) drops a style function on the web.
      style={
        href
          ? styles.row
          : ({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surfaceMuted } : null]
      }
    >
      <RowBody {...content} chevron />
    </Pressable>
  );
  return href ? (
    <Link href={href} asChild>
      {pressable}
    </Link>
  ) : (
    pressable
  );
}

/** A row that only shows something: a label and its value. */
export function InfoRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.info}>
      <Text
        variant={strong ? "bodyStrong" : "body"}
        tint={strong ? "ink" : "muted"}
        style={styles.fill}
      >
        {label}
      </Text>
      <Text variant={strong ? "bodyStrong" : "body"} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  padded: { padding: gutter, gap: space[5] },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: gutter,
    paddingTop: space[3],
    paddingBottom: space[3],
    gap: space[2],
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
    gap: space[3],
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: space[3] },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, gap: 2 },
  info: { flexDirection: "row", alignItems: "baseline", gap: space[3] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
