import { View } from "react-native";
import { formatPrice } from "../format";
import { fontSize } from "../theme/tokens";
import { Badge } from "./feedback";
import { Text, type TextProps } from "./text";

const SIZE = { sm: fontSize.base, md: fontSize.xl, lg: fontSize["3xl"] } as const;

/** A price in the display face with tabular figures; a higher regular price struck through. */
export function Money({
  amountMinor,
  listAmountMinor,
  size = "md",
  ...props
}: Omit<TextProps, "children"> & {
  amountMinor: number;
  listAmountMinor?: number | null;
  size?: keyof typeof SIZE;
}) {
  const discounted = typeof listAmountMinor === "number" && listAmountMinor > amountMinor;
  const percentOff = discounted ? Math.round((1 - amountMinor / listAmountMinor) * 100) : 0;
  const price = (
    <Text
      variant="figure"
      style={{ fontSize: SIZE[size], lineHeight: Math.round(SIZE[size] * 1.25) }}
      {...props}
    >
      {formatPrice(amountMinor)}
    </Text>
  );
  if (!discounted) return price;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
      {price}
      <Text
        variant="small"
        tint="muted"
        style={{ textDecorationLine: "line-through" }}
        aria-label={`Precio regular: ${formatPrice(listAmountMinor)}`}
      >
        {formatPrice(listAmountMinor)}
      </Text>
      {percentOff >= 5 ? <Badge tone="promo">{`−${percentOff}%`}</Badge> : null}
    </View>
  );
}
