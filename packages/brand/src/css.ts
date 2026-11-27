import { color, font, fontSize, radius, semantic, shadow } from "./legacy";
import {
  dark,
  elevation,
  headerHeightMax,
  light,
  motion,
  motionEasing,
  palette,
  radii,
  spacing,
  target,
  typeface,
} from "./tokens";

/*
 * The stylesheets made from the tokens. `scripts/write-tokens-css.ts` writes
 * them; `tokens.test.ts` fails when a committed file differs from what these
 * functions return.
 *
 *   src/tokens.css             today's tokens, byte for byte (what every web
 *                              app imports as `@yuntera/brand/tokens.css` until
 *                              it moves)
 *   styles/tokens.legacy.css   today's tokens plus the Carreta-only names
 *   styles/tokens.css          Carreta, with every name of today aliased
 *   styles/carreta-base.css    the base rules of Carreta that are not tokens
 *
 * See SISTEMA.md §2.5 for why there are two token sheets.
 */

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Renders today's tokens as a Tailwind v4 `@theme` block. The output is
 * committed as `src/tokens.css`. Its output must never change while any app
 * imports it (a test holds its sha256).
 */
export function renderTokensCss(): string {
  const lines: string[] = [];
  const push = (name: string, value: string) => lines.push(`  --${name}: ${value};`);

  for (const [family, scale] of Object.entries(color)) {
    if (typeof scale === "string") {
      push(`color-${family}`, scale);
      continue;
    }
    for (const [step, hex] of Object.entries(scale)) push(`color-${family}-${step}`, hex);
  }

  for (const [name, hex] of Object.entries(semantic)) push(`color-${kebab(name)}`, hex);

  push("font-display", font.display);
  push("font-sans", font.body);
  push("font-mono", font.mono);

  for (const [name, size] of Object.entries(fontSize)) push(`text-${name}`, size);
  for (const [name, r] of Object.entries(radius)) push(`radius-${name}`, r);
  for (const [name, s] of Object.entries(shadow)) push(`shadow-${name}`, s);

  return [
    "/* GENERATED from tokens.ts by `pnpm --filter @yuntera/brand tokens`. Do not edit by hand. */",
    "@theme {",
    ...lines,
    "}",
    "",
  ].join("\n");
}

/** Carreta semantic names that today's `semantic` does not have (kebab case). */
export const carretaOnlyColors: string[] = Object.keys(light)
  .filter((name) => !(name in semantic))
  .map(kebab);

/**
 * Today's names that Carreta does not keep, each with the Carreta colour it
 * becomes (SISTEMA.md §2.5.1). `promo` has no Carreta colour ("no sale
 * colour"); it is drawn as a primary fill so that today's white text on it
 * stays readable (17.29:1) until the ratchet removes it.
 */
export const legacyAliases: Record<string, keyof typeof light> = {
  bg: "page",
  surface: "page",
  surfaceMuted: "band",
  border: "rule",
  borderStrong: "edge",
  brandHover: "primary",
  brandSoft: "band",
  promo: "primary",
  rating: "ink",
};

/** The `--yt-*` custom properties of the light appearance, one per line. */
function rootProperties(): string[] {
  const lines: string[] = [];
  const push = (name: string, value: string | number) => lines.push(`  --yt-${name}: ${value};`);
  for (const [name, hex] of Object.entries(palette)) push(kebab(name), hex);
  for (const [name, hex] of Object.entries(light)) push(kebab(name), hex);
  push("ring", "var(--yt-focus)");
  push("font-text", typeface.text);
  push("font-title", typeface.title);
  for (const [name, px] of Object.entries(radii)) push(`radius-${name}`, `${px}px`);
  Object.values(spacing).forEach((px, index) => {
    push(`space-${index}`, `${px}px`);
  });
  for (const [name, value] of Object.entries(elevation)) push(`elevation-${name}`, value);
  for (const [name, ms] of Object.entries(motion)) {
    push(`motion-${name}`, name === "none" ? ms : `${ms} ${motionEasing}`);
  }
  push("target", `${target.web}px`);
  push("target-app", `${target.app}px`);
  push("target-driver", `${target.driverAction}px`);
  push("target-driver-fixed", `${target.driverPrimary}px`);
  // A fallback: the shell measures its real header and writes it here.
  push("header-h", `${headerHeightMax.phone}px`);
  return lines;
}

/** Tailwind names for the Carreta radii and elevation (none exists today). */
function carretaShapeThemeLines(): string[] {
  return [
    ...Object.keys(radii).map((name) => `  --radius-${name}: var(--yt-radius-${name});`),
    ...Object.keys(elevation).map((name) => `  --shadow-${name}: var(--yt-elevation-${name});`),
  ];
}

/**
 * `styles/tokens.legacy.css`: today's `src/tokens.css`, unchanged as its first
 * bytes, then only names that do not exist today, so the Carreta components
 * render in an app that has not moved yet. An app imports it instead of
 * today's sheet in step 1c; nothing it draws today changes.
 */
export function renderLegacyTokensCss(): string {
  return [
    renderTokensCss(),
    "/* Added in Carreta phase A (SISTEMA.md §2.5): names that do not exist above. */",
    ":root {",
    ...rootProperties(),
    "}",
    "@theme inline {",
    ...carretaOnlyColors.map((name) => `  --color-${name}: var(--yt-${name});`),
    ...carretaShapeThemeLines(),
    "}",
    "",
  ].join("\n");
}

/**
 * `styles/tokens.css`: the Carreta sheet. An app moves by importing this one
 * instead of `tokens.legacy.css` (§2.5 phase B). Every Tailwind name of today
 * still exists: the semantic ones as aliases of their Carreta colour, the
 * ramps, type sizes, radii and shadows with today's values.
 */
export function renderCarretaTokensCss(): string {
  const darkLines = Object.entries(dark).map(([name, hex]) => `  --yt-${kebab(name)}: ${hex};`);
  const theme = [
    ...Object.keys(light).map((name) => `  --color-${kebab(name)}: var(--yt-${kebab(name)});`),
    ...Object.entries(legacyAliases).map(
      ([name, target]) => `  --color-${kebab(name)}: var(--yt-${kebab(target)});`,
    ),
    "  --font-text: var(--yt-font-text);",
    "  --font-title: var(--yt-font-title);",
    "  --font-sans: var(--yt-font-text);",
    "  --font-display: var(--yt-font-title);",
    ...carretaShapeThemeLines(),
  ];
  const kept: string[] = [];
  const push = (name: string, value: string) => kept.push(`  --${name}: ${value};`);
  for (const [family, scale] of Object.entries(color)) {
    if (typeof scale === "string") {
      push(`color-${family}`, scale);
      continue;
    }
    for (const [step, hex] of Object.entries(scale)) push(`color-${family}-${step}`, hex);
  }
  push("font-mono", font.mono);
  for (const [name, size] of Object.entries(fontSize)) push(`text-${name}`, size);
  for (const [name, r] of Object.entries(radius)) push(`radius-${name}`, r);
  for (const [name, s] of Object.entries(shadow)) push(`shadow-${name}`, s);

  return [
    "/* GENERATED from tokens.ts by `pnpm --filter @yuntera/brand tokens`. Do not edit by hand. */",
    "/* Carreta tokens (docs/brand/system/SISTEMA.md §2). */",
    ":root {",
    ...rootProperties(),
    "}",
    "/* Dark appearance, outside @theme. The ring is declared again: a custom",
    "   property that points at another one is resolved where it is declared. */",
    ':root[data-theme="dark"] {',
    "  color-scheme: dark;",
    ...darkLines,
    "  --yt-ring: var(--yt-focus);",
    "}",
    "/* Tailwind names. Carreta's own, then today's names that Carreta drops, each",
    "   an alias of the Carreta colour it becomes (§2.5.1). Palette words are",
    "   never exposed to Tailwind. */",
    "@theme inline {",
    ...theme,
    "}",
    "/* Kept with today's values until the ratchet of every app reaches 0 (§2.5). */",
    "@theme {",
    ...kept,
    "}",
    "",
  ].join("\n");
}

/** Lines of `src/css/1-base.css` that `carreta-base.css` carries, by how they start. */
const baseLinePrefixes = [
  "html{scroll-padding-top:",
  ":focus-visible{",
  ".side a:focus-visible,",
  ".side nav a:focus-visible{",
  ".side .lockup,",
  ".banda{",
  ".banda-marca{",
  ".banda-peligro{",
  "h1,h2,h3,.t-display,.t-title,.t-section{overflow-wrap:",
  ".t-display,.t-title{overflow-wrap:",
  ".nowrap{",
];

/**
 * `styles/carreta-base.css`: the rules of Carreta that are not tokens, copied
 * line for line from the specification's own stylesheets, never retyped:
 * the focus ring with its band and inset rules and the scroll padding that
 * keeps focus clear of sticky bars (§2.3), the type classes `.t-display` …
 * `.t-code-entry` (§2 Type), and the keep-together rules (§3 rules 6–8).
 *
 * @param baseCss   docs/brand/system/src/css/1-base.css
 * @param carretaCss docs/brand/system/carreta.css (holds the generated type classes)
 */
export function renderCarretaBaseCss(baseCss: string, carretaCss: string): string {
  const baseLines = baseCss.split("\n");
  const picked = baseLinePrefixes.map((prefix) => {
    const found = baseLines.filter((line) => line.startsWith(prefix));
    if (found.length !== 1) {
      throw new Error(`1-base.css has ${found.length} lines starting with ${prefix}`);
    }
    return found[0] as string;
  });
  const lines = carretaCss.split("\n");
  const first = lines.findIndex((line) => line.startsWith(".t-display{"));
  const last = lines.findIndex((line) =>
    line.startsWith(".t-display,.t-title,.t-section,.t-price"),
  );
  if (first < 0 || last < first) throw new Error("carreta.css has no type classes");
  const typeLines = lines.slice(first, last + 1);

  const [scroll, ...rest] = picked;
  const focus = rest.slice(0, 7);
  const keep = rest.slice(7);
  return [
    "/* GENERATED by `pnpm --filter @yuntera/brand tokens` from docs/brand/system/src/css/1-base.css",
    "   and docs/brand/system/carreta.css. Do not edit by hand. Needs styles/tokens.css",
    "   (or tokens.legacy.css). */",
    "/* Focus never hides behind a bar (§2.3): the shell writes --yt-header-h and the",
    "   bottom bar's script writes --bar-h on the root element. */",
    scroll,
    "/* One focus ring (§2.3): 3 px in --yt-ring, 2 px off the control; inset inside",
    "   bars and frames; on a coloured band the ring takes the band's text colour. */",
    ...focus,
    "/* Type steps (§2 Type, §3). */",
    ...typeLines,
    "/* Keep together (§3 rules 6-8): which words may break, and text that never wraps. */",
    ...keep,
    "",
  ].join("\n");
}
