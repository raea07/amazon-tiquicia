/**
 * Design tokens. `tokens.css` mirrors these values for Tailwind v4 (`@theme`);
 * `tokens.test.ts` fails the build if the two drift or if a text/background
 * pairing we rely on drops below WCAG AA contrast.
 *
 * Palette names come from Costa Rica rather than from generic colour words:
 *   celeste — the turquoise of Río Celeste (brand colour)
 *   anil    — indigo ink (text, dark surfaces)
 *   guaria  — the purple of the guaria morada orchid (promotions, seller app)
 *   maiz    — corn yellow (ratings, warehouse app)
 *   selva   — rainforest green (success, in stock, driver app)
 *   achiote — annatto red (errors, destructive actions)
 *   arena   — warm sand neutrals (page backgrounds)
 */

export const color = {
  celeste: {
    50: "#ecfbfc",
    100: "#d0f4f7",
    200: "#a5e8ee",
    300: "#6dd6e0",
    400: "#33bccb",
    500: "#12a0b0",
    600: "#0b7f8e",
    700: "#0c6775",
    800: "#0f5360",
    900: "#114551",
    950: "#062d37",
  },
  anil: {
    50: "#f3f5fa",
    100: "#e4e8f2",
    200: "#c9d1e3",
    300: "#a2aecb",
    400: "#7484ab",
    500: "#53648f",
    600: "#3f4e76",
    700: "#313d5e",
    800: "#232c47",
    900: "#161d33",
    950: "#0c1122",
  },
  guaria: {
    50: "#fcf2fa",
    100: "#f8e1f3",
    200: "#f0c0e5",
    300: "#e492d0",
    400: "#d35fb6",
    500: "#bc3a9a",
    600: "#9e2a7f",
    700: "#812266",
    800: "#6a1f54",
    900: "#581d46",
  },
  maiz: {
    50: "#fffaeb",
    100: "#fdf0c4",
    200: "#fbe08b",
    300: "#f9cf55",
    400: "#f7c12d",
    500: "#eda515",
    600: "#c97f0e",
    700: "#a05c0f",
    800: "#834913",
    900: "#6c3c14",
  },
  selva: {
    50: "#eefbf3",
    100: "#d6f5e1",
    200: "#b0eac7",
    300: "#7cd8a6",
    400: "#46be80",
    500: "#24a365",
    600: "#17824f",
    700: "#146842",
    800: "#135337",
    900: "#11442f",
  },
  achiote: {
    50: "#fef3f2",
    100: "#fee4e2",
    200: "#fecdca",
    300: "#fca9a4",
    400: "#f7776f",
    500: "#ed4c43",
    600: "#d92f26",
    700: "#b6231c",
    800: "#97211b",
    900: "#7d221d",
  },
  arena: {
    50: "#fbfaf7",
    100: "#f5f2ec",
    200: "#eae5da",
    300: "#dad2c2",
    400: "#bfb49f",
  },
  white: "#ffffff",
} as const;

/** Semantic aliases the UI is written against. */
export const semantic = {
  bg: color.arena[50],
  surface: color.white,
  surfaceMuted: color.arena[100],
  border: color.arena[200],
  borderStrong: color.anil[200],
  ink: color.anil[900],
  inkMuted: color.anil[600],
  onBrand: color.white,
  brand: color.celeste[600],
  brandHover: color.celeste[700],
  brandSoft: color.celeste[50],
  link: color.celeste[700],
  focus: color.celeste[500],
  promo: color.guaria[600],
  rating: color.maiz[500],
  success: color.selva[600],
  danger: color.achiote[600],
  warning: color.maiz[700],
} as const;

/**
 * The colour a browser paints around the app: the address bar on a phone, the
 * title bar of an app added to the home screen. Every app uses this one value
 * (in its layout's `viewport` and in its web manifest) instead of spelling the
 * colour out, so a change to the brand colour reaches them all.
 */
export const themeColor = semantic.brand;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "16px",
  xl: "24px",
  full: "9999px",
} as const;

export const font = {
  display:
    '"Bricolage Grotesque Variable", "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif',
  body: '"Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Type scale (rem). Body copy never goes below 1rem on mobile. */
export const fontSize = {
  xs: "0.75rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
  "4xl": "2.5rem",
  "5xl": "3.25rem",
} as const;

export const shadow = {
  sm: "0 1px 2px rgb(22 29 51 / 0.06)",
  md: "0 4px 14px rgb(22 29 51 / 0.08)",
  lg: "0 12px 32px rgb(22 29 51 / 0.12)",
} as const;

/** Minimum touch target, per WCAG 2.2 AA (24px) with our stricter 44px rule. */
export const touchTarget = "44px";

// ── Contrast helpers (used by the token test and by the UI package) ────────

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
