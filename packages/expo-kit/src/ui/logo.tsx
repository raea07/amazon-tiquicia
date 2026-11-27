import { type AppId, apps, brand } from "@yuntera/brand";
import { View } from "react-native";
import { colors, fontFamily } from "../theme/tokens";
import { Mark } from "./icons";
import { Text } from "./text";

/**
 * The lockup as the brand book builds it (§5): mark `size` high in the brand
 * colour, a gap of 0.30 × size, the lowercase wordmark in the display face
 * (Epilogue since decision 58) at 700 and 0.86 × size, and the descriptor at
 * weight 500 and 62 % opacity.
 */
export function Logo({ app = "shop", size = 28 }: { app?: AppId; size?: number }) {
  const identity = apps[app];
  return (
    <View
      role="img"
      aria-label={identity.name}
      style={{ flexDirection: "row", alignItems: "center", gap: size * 0.3 }}
    >
      <Mark size={size} />
      <Text
        aria-hidden
        style={{
          fontFamily: fontFamily.display,
          fontWeight: "700",
          fontSize: size * 0.86,
          lineHeight: size * 1.05,
          letterSpacing: -0.03 * size * 0.86,
          color: colors.ink,
        }}
      >
        {brand.slug}
        {identity.descriptor ? (
          <Text style={{ fontWeight: "500", opacity: 0.62 }}>
            {` ${identity.descriptor.toLowerCase()}`}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}
