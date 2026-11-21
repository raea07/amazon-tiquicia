import { colors, space } from "@yuntera/expo-kit/theme";
import { ChevronIcon, Text } from "@yuntera/expo-kit/ui";
import { Link, type LinkProps } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * A row of the board that opens a parcel or a shipment. Unlike the kit's
 * ListRow, the details are never cut short: the latest dispatch date is
 * what a worker reads the board for. The badges sit beside the title.
 */
export function FloorRow({
  href,
  title,
  details,
  badges,
  testID,
}: {
  href: LinkProps["href"];
  title: string;
  details: string;
  badges?: ReactNode;
  testID?: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable role="link" style={styles.row} testID={testID}>
        <View style={styles.body}>
          <View style={styles.head}>
            <Text variant="subheading" style={styles.title}>
              {title}
            </Text>
            {badges}
          </View>
          <Text variant="small" tint="muted">
            {details}
          </Text>
        </View>
        <ChevronIcon size={20} color={colors.inkMuted} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  // One flat style: Link (asChild) hands it to the DOM on the web.
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: colors.surface,
  },
  body: { flex: 1, gap: space[1] },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  title: { marginRight: "auto" },
});
