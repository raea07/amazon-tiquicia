import type { SVGProps } from "react";
import { type AppId, apps, brand } from "./brand";

/**
 * The Yuntera mark: two paths that start apart and merge into one.
 *
 * It is read three ways, all intended: the letter Y, the yoke (yunta) that
 * joins two oxen so they pull as one, and two routes converging on a single
 * destination. The two round nodes are the parties a marketplace joins —
 * whoever sells and whoever buys.
 *
 * Geometry lives on a 48×48 grid with a 6-unit stroke; do not redraw it
 * freehand. Use `currentColor` so the mark inherits its colour from context.
 */
export function YunteraMark({
  title = brand.name,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" role="img" aria-label={title} {...props}>
      <title>{title}</title>
      <path
        d="M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="6" fill="currentColor" />
      <circle cx="36" cy="11" r="6" fill="currentColor" />
    </svg>
  );
}

/** Raw path data, for places that cannot render React (emails, native icons). */
export const markGeometry = {
  viewBox: "0 0 48 48",
  path: "M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42",
  strokeWidth: 6,
  nodes: [
    { cx: 12, cy: 11, r: 6 },
    { cx: 36, cy: 11, r: 6 },
  ],
} as const;

interface LogoProps {
  /** Which app's lockup to render. Defaults to the flagship. */
  app?: AppId;
  /** Height of the mark in pixels; the wordmark scales with it. */
  size?: number;
  className?: string;
  /** Render the mark only, keeping the name available to assistive tech. */
  markOnly?: boolean;
}

/**
 * Horizontal lockup: mark + lowercase wordmark + optional app descriptor.
 * The wordmark is live text in the display face so it stays crisp and
 * selectable; exported artwork with outlined letters lives in `assets/`.
 */
export function YunteraLogo({ app = "shop", size = 28, className, markOnly = false }: LogoProps) {
  const identity = apps[app];
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3, lineHeight: 1 }}
    >
      <YunteraMark
        width={size}
        height={size}
        title={identity.name}
        style={{ color: "var(--color-brand, #0b7f8e)", flex: "none" }}
      />
      {markOnly ? null : (
        <span
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: size * 0.86,
            letterSpacing: "-0.03em",
            color: "var(--color-text, #161d33)",
          }}
        >
          {brand.slug}
          {identity.descriptor ? (
            <span style={{ fontWeight: 500, opacity: 0.62, marginLeft: size * 0.22 }}>
              {identity.descriptor.toLowerCase()}
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}
