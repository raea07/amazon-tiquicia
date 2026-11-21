/**
 * Numeric design tokens for the native apps, derived from @yuntera/brand.
 *
 * React Native wants numbers where CSS has "10px" and "1.125rem", and has no
 * cascade, so the brand's values are converted here once. Nothing in this
 * file chooses a colour or a size of its own: every value is read from
 * `packages/brand/src/tokens.ts`, so the web and the apps cannot drift. The
 * one addition is `tone`, the pairs of colours used for badges and alerts,
 * which `tokens.test.ts` checks for contrast like the brand's own test does.
 *
 * No React Native import: this module also runs in Node (app config, tests).
 */

import {
  color,
  fontSize as cssFontSize,
  radius as cssRadius,
  touchTarget as cssTouchTarget,
  semantic,
} from "@yuntera/brand";

/** "10px" → 10. Throws on anything that is not a pixel length, so a change in the brand is noticed. */
export function px(value: string): number {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match?.[1]) throw new Error(`Not a pixel length: ${value}`);
  return Number(match[1]);
}

/** "1.125rem" → 18, with the browser default of 16 px to the rem. */
export function rem(value: string, base = 16): number {
  const match = /^(\d+(?:\.\d+)?)rem$/.exec(value.trim());
  if (!match?.[1]) throw new Error(`Not a rem length: ${value}`);
  return Number(match[1]) * base;
}

type FontSizeKey = keyof typeof cssFontSize;
type RadiusKey = keyof typeof cssRadius;

const mapValues = <K extends string, V, R>(object: Record<K, V>, fn: (value: V) => R) =>
  Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fn(value as V)])) as Record<
    K,
    R
  >;

export const fontSize: Record<FontSizeKey, number> = mapValues(cssFontSize, (v) => rem(v));
export const radius: Record<RadiusKey, number> = mapValues(cssRadius, (v) => px(v));

/** 44: the smallest height of anything a finger has to hit. */
export const touchTarget = px(cssTouchTarget);

/**
 * Line heights. The web uses the browser's 1.5 for body copy and a tighter
 * 1.2 for headings; React Native needs them as absolute numbers.
 */
export const lineHeight: Record<FontSizeKey, number> = mapValues(fontSize, (size) =>
  Math.round(size * (size >= 24 ? 1.2 : 1.5)),
);

/** The web apps' 4 px spacing scale (see the brand book, "Spacing"). */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** The screen gutter: 16 px on a phone, like `.shell` on the web. */
export const gutter = space[4];

/**
 * Font families. Both names are the family name stored inside the font files
 * (checked for the static TTFs of @expo-google-fonts/inter 0.4.2 and
 * @expo-google-fonts/bricolage-grotesque 0.4.1), which is what iOS uses; the
 * Android config plugin and the web loader register the same names.
 */
export const fontFamily = {
  body: "Inter",
  display: "Bricolage Grotesque",
} as const;

/** The weights embedded per family. Anything else would fall back to a synthesised face. */
export const fontWeights = {
  body: [400, 500, 600, 700],
  display: [600, 700, 800],
} as const;

export const colors = {
  ...semantic,
  /**
   * Outline of text fields and choice boxes. The web draws them in
   * `borderStrong` (añil 200), which is 1.5:1 on white; WCAG asks 3:1 for the
   * edge of a control, so the apps use añil 400 from the same palette.
   */
  fieldBorder: color.anil[400],
  palette: color,
} as const;

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "promo";

/**
 * Badge and alert colours. The same pairs the web components use
 * (`packages/ui/src/primitives.tsx`), so a status reads the same everywhere.
 */
export const tone: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: color.anil[100], fg: color.anil[800], border: color.anil[200] },
  info: { bg: color.celeste[50], fg: color.celeste[950], border: color.celeste[300] },
  success: { bg: color.selva[50], fg: color.selva[900], border: color.selva[300] },
  warning: { bg: color.maiz[50], fg: color.maiz[900], border: color.maiz[300] },
  danger: { bg: color.achiote[50], fg: color.achiote[900], border: color.achiote[300] },
  promo: { bg: color.guaria[100], fg: color.guaria[900], border: color.guaria[200] },
};

/**
 * Every text-on-background pairing the native components draw. The test
 * fails if any falls below WCAG AA (4.5:1), so adding a combination means
 * adding it here first.
 */
export const textPairs: Array<[name: string, fg: string, bg: string]> = [
  ["body on page", semantic.ink, semantic.bg],
  ["body on surface", semantic.ink, semantic.surface],
  ["body on muted surface", semantic.ink, semantic.surfaceMuted],
  ["muted on page", semantic.inkMuted, semantic.bg],
  ["muted on surface", semantic.inkMuted, semantic.surface],
  ["muted on muted surface", semantic.inkMuted, semantic.surfaceMuted],
  ["placeholder in a field", color.anil[500], semantic.surface],
  ["primary button", semantic.onBrand, semantic.brand],
  ["primary button pressed", semantic.onBrand, semantic.brandHover],
  ["link on page", semantic.link, semantic.bg],
  ["link on surface", semantic.link, semantic.surface],
  ["link on brand-soft", semantic.link, semantic.brandSoft],
  ["ink on brand-soft", semantic.ink, semantic.brandSoft],
  ["danger button", color.white, semantic.danger],
  ["danger text on surface", semantic.danger, semantic.surface],
  ["success text on surface", semantic.success, semantic.surface],
  ["warning text on surface", semantic.warning, semantic.surface],
  ["warning text on page", semantic.warning, semantic.bg],
  ["active tab label", semantic.link, semantic.surface],
  ["inactive tab label", semantic.inkMuted, semantic.surface],
  ["counter on brand", semantic.onBrand, semantic.brand],
  ["chip selected", color.white, color.anil[900]],
  ...(Object.entries(tone) as Array<[Tone, (typeof tone)[Tone]]>).map(
    ([name, pair]): [string, string, string] => [`${name} badge or alert`, pair.fg, pair.bg],
  ),
];

/** Non-text elements (borders of controls, focus) need 3:1 against what is next to them. */
export const uiPairs: Array<[name: string, fg: string, bg: string]> = [
  ["field border on surface", color.anil[400], semantic.surface],
  ["field border on page", color.anil[400], semantic.bg],
  ["selected option border", semantic.brand, semantic.surface],
  ["checkbox tick on brand", semantic.onBrand, semantic.brand],
  // Rating stars (maíz 500) are decoration next to the rating written as text,
  // as on the web, so they are not a control and are not listed here.
];
