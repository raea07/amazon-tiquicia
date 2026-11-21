import type { OrderStatus, ShipmentStatus } from "@yuntera/core";
import type { ListingContent, ListingEditField } from "@yuntera/db";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import { Badge, ChevronIcon, PackageIcon, Text } from "@yuntera/expo-kit/ui";
import { Image } from "expo-image";
import { Link, type LinkProps } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { imageUrl } from "@/lib/env";
import { ORDER_TONE, orderLabel, SHIPMENT_STATUS_LABEL, SHIPMENT_TONE } from "@/lib/labels";
import { useShops } from "@/lib/shops";

/**
 * A figure in a box, as the seller centre's `Stat`: a label, a big number, an
 * optional hint. A figure that needs attention gets a coloured edge and its
 * hint says why (status is never colour alone). With `href` the whole box is
 * a link, at least 44 pt tall.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  href,
  testID,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warning" | "danger";
  href?: LinkProps["href"];
  testID?: string;
}) {
  const body = (
    <>
      <View style={styles.statText}>
        <Text variant="small" tint="muted">
          {label}
        </Text>
        <Text variant="figure" style={styles.statValue} testID={testID}>
          {value}
        </Text>
        {hint ? (
          <Text variant="caption" tint={href ? "link" : "muted"}>
            {hint}
          </Text>
        ) : null}
      </View>
      {href ? <ChevronIcon size={20} color={colors.inkMuted} /> : null}
    </>
  );
  const frame = [
    styles.stat,
    tone === "danger"
      ? { borderColor: colors.danger }
      : tone === "warning"
        ? { borderColor: colors.warning }
        : null,
  ];
  if (!href) return <View style={frame}>{body}</View>;
  return (
    <Link href={href} asChild>
      <Pressable
        role="link"
        aria-label={`${label}: ${value}. ${hint ?? ""}`}
        style={StyleSheet.flatten(frame)}
      >
        {body}
      </Pressable>
    </Link>
  );
}

/** A two-column grid of `Stat`s that falls back to one column on a narrow phone. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => (
  <Badge tone={ORDER_TONE[status]}>{orderLabel(status)}</Badge>
);

/**
 * `prefix` names what the state is of ("Entrega") where it sits beside the
 * order's badge; the web has column headings for that.
 */

export const ShipmentStatusBadge = ({
  status,
  prefix,
}: {
  status: ShipmentStatus;
  prefix?: string;
}) => (
  <Badge tone={SHIPMENT_TONE[status]}>
    {prefix
      ? `${prefix}: ${SHIPMENT_STATUS_LABEL[status].toLowerCase()}`
      : SHIPMENT_STATUS_LABEL[status]}
  </Badge>
);

/**
 * A product's picture, or the placeholder drawing when it has none or it
 * cannot be loaded. Sellers cannot add photos from the app yet (the upload is
 * being built separately), so most listings show the placeholder.
 */
export function ProductThumb({ path, size = 56 }: { path: string | null; size?: number }) {
  const uri = imageUrl(path);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return (
    <View style={[styles.thumb, { width: size, height: size }]}>
      {uri && failedUri !== uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessible={false}
          onError={() => setFailedUri(uri)}
        />
      ) : (
        <View style={styles.placeholder} aria-hidden>
          <PackageIcon size={Math.round(size * 0.4)} color={colors.palette.anil[400]} />
        </View>
      )}
    </View>
  );
}

/**
 * The title of a screen pushed on top of the tabs, with the shop it belongs
 * to underneath: someone who works in two shops always sees which one.
 */
export function HeaderTitle({ title }: { title: string }) {
  const { shop } = useShops();
  return (
    <View style={styles.headerTitle}>
      <Text variant="bodyStrong" numberOfLines={1} role="heading" aria-level={1}>
        {title}
      </Text>
      {shop ? (
        <Text variant="caption" tint="muted" numberOfLines={1} testID="header-shop">
          {shop.trade_name}
        </Text>
      ) : null}
    </View>
  );
}

const LISTING_FIELDS: ReadonlyArray<{ field: ListingEditField; label: string }> = [
  { field: "title", label: "Título" },
  { field: "category_slug", label: "Categoría" },
  { field: "bullet_points", label: "Características" },
  { field: "description", label: "Descripción" },
  { field: "weight_grams", label: "Peso del paquete" },
  { field: "length_cm", label: "Largo del paquete" },
  { field: "width_cm", label: "Ancho del paquete" },
  { field: "height_cm", label: "Alto del paquete" },
];

const number = (value: number) => value.toLocaleString("es-CR", { maximumFractionDigits: 1 });

function showField(content: ListingContent, field: ListingEditField): string {
  switch (field) {
    case "title":
      return content.title;
    case "category_slug":
      return content.category_name;
    case "description":
      return content.description || "Sin descripción";
    case "bullet_points":
      return content.bullet_points.length > 0
        ? content.bullet_points.map((point) => `• ${point}`).join("\n")
        : "Sin características";
    case "weight_grams":
      return `${number(content.weight_grams)} g`;
    default:
      return `${number(content[field])} cm`;
  }
}

/**
 * A proposed change to a published listing, old above new, as the seller
 * centre's `ListingChanges` (packages/next-kit/src/listing-changes.tsx): only
 * the fields that differ, each side labelled in words.
 */
export function ListingChanges({
  before,
  after,
  afterLabel,
  beforeLabel = "Publicado ahora",
}: {
  before: ListingContent;
  after: ListingContent;
  afterLabel: string;
  beforeLabel?: string;
}) {
  const rows = LISTING_FIELDS.filter(
    ({ field }) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  if (rows.length === 0) {
    return (
      <Text variant="small" tint="muted">
        La propuesta ya coincide con lo publicado.
      </Text>
    );
  }
  return (
    <View style={styles.changes} testID="listing-changes">
      {rows.map(({ field, label }) => (
        <View key={field} style={styles.change}>
          <Text variant="smallStrong">{label}</Text>
          <View style={[styles.side, styles.before]}>
            <Text variant="caption" tint="muted">
              {beforeLabel.toUpperCase()}
            </Text>
            <Text variant="small">{showField(before, field)}</Text>
          </View>
          <View style={[styles.side, styles.after]}>
            <Text variant="caption" tint="link">
              {afterLabel.toUpperCase()}
            </Text>
            <Text variant="small">{showField(after, field)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stat: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
  },
  statText: { flex: 1, gap: 2 },
  statValue: { fontSize: 24, lineHeight: 30 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  thumb: {
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
  },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerTitle: { maxWidth: 240 },
  changes: { gap: space[4] },
  change: { gap: space[2] },
  side: { borderRadius: radius.md, borderWidth: 1, padding: space[3], gap: 2 },
  before: { borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  after: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
});
