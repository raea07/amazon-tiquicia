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
  type CarretaColor,
  color,
  fontSize as cssFontSize,
  motion as cssMotion,
  radius as cssRadius,
  spacing as cssSpacing,
  target as cssTarget,
  touchTarget as cssTouchTarget,
  type as cssType,
  dark,
  light,
  palette,
  radii,
  semantic,
  type TypeStep,
  typeface,
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
 * Font families (SISTEMA.md §2.4). Each name is the typographic family
 * (nameID 16) stored inside the Carreta font files in `../../fonts`, which is
 * what iOS registers them by; the Android config plugin and the web loader
 * register the same names.
 *
 * `text` (Fira Sans) and `title` (Epilogue) are the Carreta names. `body` and
 * `display` are today's names and now point at the same two families, with
 * the same weights as before (body 400–700, display 600–800), so every
 * screen keeps its weights and only the typeface changes. They stay until
 * step 4 of the rebuild ends.
 */
export const fontFamily = {
  text: typeface.textFamilyNative,
  title: typeface.titleFamilyNative,
  /** @deprecated Use `text`. */
  body: typeface.textFamilyNative,
  /** @deprecated Use `title`. */
  display: typeface.titleFamilyNative,
} as const;

/** The weights embedded per family. Anything else would fall back to a synthesised face. */
export const fontWeights = {
  text: typeface.textWeights,
  title: typeface.titleWeights,
  body: typeface.textWeights,
  display: typeface.titleWeights,
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

// ── Carreta (SISTEMA.md §2.1, §5.23) ───────────────────────────────────────
//
// Added beside today's names, which keep their values until step 6 of the
// rebuild. No screen reads these yet: an app moves when its root layout is
// wrapped in `ThemeProvider` (./provider.tsx) and its screens read `useTheme()`.

/**
 * Spacing in points, with named keys, so that no index of today's `space`
 * can silently mean a new value (§2.5.4: 20 → loose 24, 40 → section 48).
 */
export const spacing = cssSpacing;

/** Smallest control in points: 48 in the phone apps, 56 and 64 for the driver's actions. */
export const target = {
  app: cssTarget.app,
  driverAction: cssTarget.driverAction,
  driverPrimary: cssTarget.driverPrimary,
} as const;

/** A type step as React Native draws it, at its phone size. */
export interface TextStep {
  fontFamily: string;
  fontWeight: "400" | "500" | "600" | "700" | "800";
  fontSize: number;
  lineHeight: number;
  /** In points: the step's tracking in em times its size. */
  letterSpacing: number;
}

/** "-0.01em" → -0.01; "0" → 0. Throws on anything else. */
export function em(value: string): number {
  if (value === "0") return 0;
  const match = /^(-?\d+(?:\.\d+)?)em$/.exec(value.trim());
  if (!match?.[1]) throw new Error(`Not an em length: ${value}`);
  return Number(match[1]);
}

function textStep(step: TypeStep): TextStep {
  return {
    fontFamily: step.face === "title" ? fontFamily.title : fontFamily.text,
    fontWeight: String(step.weight) as TextStep["fontWeight"],
    fontSize: step.phone.size,
    lineHeight: step.phone.line,
    letterSpacing: Math.round(em(step.tracking) * step.phone.size * 100) / 100,
  };
}

type TypeName = keyof typeof cssType;

/** The type steps of §2 (Type) at their phone sizes. */
export const type: Record<TypeName, TextStep> = mapValues(cssType, textStep);

/** "100ms" → 100. */
function ms(value: string): number {
  const match = /^(\d+)ms$/.exec(value.trim());
  if (!match?.[1]) throw new Error(`Not a duration in ms: ${value}`);
  return Number(match[1]);
}

/** Durations in ms; `none` under reduced motion (AccessibilityInfo.isReduceMotionEnabled). */
export const motion = mapValues(cssMotion, ms);

/**
 * Nothing that rests has a shadow (`rest`); overlays have the shadow of
 * `--yt-elevation-overlay` on iOS (0 10px 30px noche at 25 %) and
 * elevation 8 on Android.
 */
export const elevation = {
  rest: { shadowOpacity: 0, elevation: 0 },
  overlay: {
    shadowColor: palette.noche,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
} as const;

export type Scheme = "light" | "dark";

/** Everything a screen draws with, for one appearance. */
export interface Theme {
  scheme: Scheme;
  /** The Carreta semantic colours (the only colour names components use). */
  colors: Record<CarretaColor, string>;
  /** Values only; components never use these names. */
  palette: typeof palette;
  radii: typeof radii;
  spacing: typeof spacing;
  type: typeof type;
  target: typeof target;
  motion: typeof motion;
  elevation: typeof elevation;
  fontFamily: { text: string; title: string };
}

const shared = {
  palette,
  radii,
  spacing,
  type,
  target,
  motion,
  elevation,
  fontFamily: { text: fontFamily.text, title: fontFamily.title },
} as const;

/** The light appearance. */
export const theme: Theme = { scheme: "light", colors: { ...light }, ...shared };

/** The dark appearance (phones only; the web stays light). */
export const themeDark: Theme = { scheme: "dark", colors: { ...dark }, ...shared };
