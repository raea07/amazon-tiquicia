import { markGeometry } from "@yuntera/brand";
import type { ColorValue } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../theme/tokens";

/**
 * A small set of line icons drawn for Yuntera on a 24-unit grid with a 2-unit
 * round stroke, to sit next to words (never instead of them). They are hidden
 * from screen readers: the label beside them says what they mean.
 */
interface IconProps {
  size?: number;
  color?: ColorValue;
}

function Line({ d, size = 24, color = colors.ink }: IconProps & { d: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Line {...p} d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5" />
);
export const GridIcon = (p: IconProps) => (
  <Line {...p} d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
);
export const SearchIcon = (p: IconProps) => (
  <Line {...p} d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20" />
);
export const CartIcon = (p: IconProps) => (
  <Line {...p} d="M3 4h2.5l2.2 10.5h10.1L20 7H7M9.5 19.5h.01M16.5 19.5h.01" />
);
export const UserIcon = (p: IconProps) => (
  <Line
    {...p}
    d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"
  />
);
export const ChevronIcon = (p: IconProps) => <Line {...p} d="M9 5l7 7-7 7" />;
export const BackIcon = (p: IconProps) => <Line {...p} d="M15 5l-7 7 7 7" />;
export const PinIcon = (p: IconProps) => (
  <Line
    {...p}
    d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
  />
);
export const CloseIcon = (p: IconProps) => <Line {...p} d="M6 6l12 12M18 6L6 18" />;
export const CheckIcon = (p: IconProps) => <Line {...p} d="M5 12.5l4.5 4.5L19 7.5" />;
export const PackageIcon = (p: IconProps) => (
  <Line {...p} d="M4 7.5l8-4 8 4v9l-8 4-8-4zM4 7.5l8 4 8-4M12 11.5v9" />
);
export const HelpIcon = (p: IconProps) => (
  <Line
    {...p}
    d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"
  />
);

/** The Yuntera mark, from the brand's own geometry (packages/brand/src/mark.ts). */
export function Mark({ size = 28, color = colors.brand, label }: IconProps & { label?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={markGeometry.viewBox}
      fill="none"
      aria-label={label}
      aria-hidden={!label}
      role={label ? "img" : undefined}
    >
      <Path
        d={markGeometry.path}
        stroke={color}
        strokeWidth={markGeometry.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {markGeometry.nodes.map((node) => (
        <Circle key={node.cx} cx={node.cx} cy={node.cy} r={node.r} fill={color} />
      ))}
    </Svg>
  );
}
