/**
 * Design tokens.
 *
 * Two sets live side by side while the apps move to the Carreta design one at
 * a time (docs/brand/system/SISTEMA.md §2.5):
 *
 * - Today's names (`color`, `semantic`, `font`, `fontSize`, `radius`,
 *   `shadow`, `touchTarget`, `themeColor`) come from `legacy.ts` with today's
 *   values. Every app that has not moved reads them.
 * - The Carreta names below (`palette`, `light`, `dark`, `type`, `spacing`,
 *   `radii`, `elevation`, `motion`, `target`, `headerHeightMax`, `typeface`,
 *   `fontFiles`, `appThemeColor`) carry the values of
 *   docs/brand/system/tokens.json; `tokens.test.ts` compares every one.
 *
 * No Carreta name equals a name of today, so no import changes meaning.
 * Stylesheets made from both: `css.ts`. Contrast pairs: `tokens.test.ts`.
 */

export {
  color,
  font,
  fontSize,
  radius,
  semantic,
  shadow,
  themeColor,
  touchTarget,
} from "./legacy";

// ── Carreta ───────────────────────────────────────────────────────────────

/**
 * The Carreta palette, flat and without ramps. Values only: components never
 * use these names, they use `light` and `dark`. In CSS: `--yt-<kebab name>`.
 */
export const palette = {
  noche: "#1E1A16",
  humo: "#574E45",
  borde: "#7A6F63",
  regla: "#D9D0C3",
  cal: "#FFFFFF",
  arena: "#F3EEE6",
  papel: "#EEEAE4",
  achiote: "#B8420F",
  maiz: "#F2B705",
  anil: "#1F47A8",
  selva: "#1F6B3A",
  rojo: "#A4161A",
  cacao: "#4A2A1C",
  fondo: "#16120F",
  superficie: "#231E19",
  papelOscuro: "#2E2823",
  textoClaro: "#F3EEE6",
  humoClaro: "#C9BFB2",
  bordeClaro: "#8F8478",
  reglaOscura: "#3A332C",
  achioteClaro: "#F0804A",
  anilClaro: "#9DB4F5",
  selvaClaro: "#6CC48A",
  rojoClaro: "#FF8A80",
} as const;

/**
 * Carreta semantic colours, light appearance: the only colour names
 * components use. In CSS: `--yt-<kebab name>`; in Tailwind: `--color-<kebab>`.
 * The job of each one is in SISTEMA.md §2 (Semantic colours).
 */
export const light = {
  page: palette.cal,
  band: palette.arena,
  photo: palette.papel,
  ink: palette.noche,
  inkMuted: palette.humo,
  edge: palette.borde,
  rule: palette.regla,
  primary: palette.noche,
  onPrimary: palette.cal,
  link: palette.anil,
  focus: palette.anil,
  brand: palette.achiote,
  onBrand: palette.cal,
  success: palette.selva,
  onSuccess: palette.cal,
  danger: palette.rojo,
  onDanger: palette.cal,
  warning: palette.maiz,
  onWarning: palette.noche,
  appShop: palette.achiote,
  appSeller: palette.cacao,
  appDriver: palette.anil,
  appWarehouse: palette.cal,
  appOps: palette.noche,
  onApp: palette.cal,
  inkFixed: palette.noche,
  wheelRim: palette.noche,
} as const;

export type CarretaColor = keyof typeof light;

/** Carreta semantic colours, dark appearance (the same keys as `light`). */
export const dark = {
  page: palette.fondo,
  band: palette.superficie,
  photo: palette.papelOscuro,
  ink: palette.textoClaro,
  inkMuted: palette.humoClaro,
  edge: palette.bordeClaro,
  rule: palette.reglaOscura,
  primary: palette.textoClaro,
  onPrimary: palette.fondo,
  link: palette.anilClaro,
  focus: palette.anilClaro,
  brand: palette.achioteClaro,
  onBrand: palette.fondo,
  success: palette.selvaClaro,
  onSuccess: palette.fondo,
  danger: palette.rojoClaro,
  onDanger: palette.fondo,
  warning: palette.maiz,
  onWarning: palette.noche,
  appShop: palette.achiote,
  appSeller: palette.cacao,
  appDriver: palette.anil,
  appWarehouse: palette.superficie,
  appOps: palette.noche,
  onApp: palette.cal,
  inkFixed: palette.noche,
  wheelRim: palette.textoClaro,
} as const satisfies Record<CarretaColor, string>;

/**
 * The two Carreta faces. `text` and `title` are CSS font stacks; the native
 * names are the nameID 16 inside the font files (§2.4).
 */
export const typeface = {
  text: '"Fira Sans", sans-serif',
  title: '"Epilogue", sans-serif',
  textFamilyNative: "Fira Sans",
  titleFamilyNative: "Epilogue",
  textWeights: [400, 500, 600, 700],
  titleWeights: [600, 700, 800],
} as const;

/** The font files of §2.4, relative to docs/brand/system. */
export const fontFiles = {
  web: {
    "fira-sans-400": "fonts/web/fira-sans-400.woff2",
    "fira-sans-500": "fonts/web/fira-sans-500.woff2",
    "fira-sans-600": "fonts/web/fira-sans-600.woff2",
    "fira-sans-700": "fonts/web/fira-sans-700.woff2",
    "epilogue-600": "fonts/web/epilogue-600.woff2",
    "epilogue-700": "fonts/web/epilogue-700.woff2",
    "epilogue-800": "fonts/web/epilogue-800.woff2",
  },
  phone: {
    "Fira Sans 400": "fonts/ttf/FiraSans-Regular.ttf",
    "Fira Sans 500": "fonts/ttf/FiraSans-Medium.ttf",
    "Fira Sans 600": "fonts/ttf/FiraSans-SemiBold.ttf",
    "Fira Sans 700": "fonts/ttf/FiraSans-Bold.ttf",
    "Epilogue 600": "fonts/ttf/Epilogue-SemiBold.ttf",
    "Epilogue 700": "fonts/ttf/Epilogue-Bold.ttf",
    "Epilogue 800": "fonts/ttf/Epilogue-ExtraBold.ttf",
  },
} as const;

export interface TypeStep {
  /** `title` is Epilogue, `text` is Fira Sans. */
  face: "title" | "text";
  weight: 400 | 500 | 600 | 700 | 800;
  /** Size and line height in px under 900 px wide (and in the phone apps). */
  phone: { size: number; line: number };
  /** Size and line height in px from 900 px wide. */
  desktop: { size: number; line: number };
  tracking: string;
}

const step = (
  face: TypeStep["face"],
  weight: TypeStep["weight"],
  phone: [number, number],
  desktop: [number, number],
  tracking = "0",
): TypeStep => ({
  face,
  weight,
  phone: { size: phone[0], line: phone[1] },
  desktop: { size: desktop[0], line: desktop[1] },
  tracking,
});

/** The type steps of §2 (Type). CSS classes `.t-<kebab name>` in `carreta-base.css`. */
export const type = {
  display: step("title", 800, [30, 34], [40, 44], "-0.01em"),
  title: step("title", 700, [26, 30], [30, 34], "-0.01em"),
  section: step("title", 700, [21, 26], [24, 28], "-0.03em"),
  priceXl: step("title", 800, [32, 36], [36, 40]),
  price: step("title", 700, [20, 23], [22, 25]),
  code: step("title", 800, [60, 69], [72, 83], "0.18em"),
  h3: step("text", 600, [18, 24], [18, 24]),
  body: step("text", 400, [16, 24], [16, 24]),
  bodyApp: step("text", 400, [17, 24], [17, 24]),
  label: step("text", 600, [15, 20], [15, 20]),
  small: step("text", 400, [14, 20], [14, 20]),
  table: step("text", 400, [15, 20], [14, 20]),
  fine: step("text", 400, [13, 18], [13, 18]),
  button: step("text", 600, [16, 20], [16, 20]),
  buttonApp: step("text", 600, [17, 22], [17, 22]),
  buttonXl: step("text", 600, [20, 24], [20, 24]),
  fieldLg: step("text", 500, [22, 30], [22, 30]),
  loc: step("text", 700, [44, 48], [44, 48], "0.02em"),
  count: step("title", 800, [34, 34], [34, 34]),
  codeEntry: step("text", 700, [32, 40], [32, 40], "0.3em"),
} as const satisfies Record<string, TypeStep>;

/**
 * Spacing in px, with named keys so that no index of today's phone `space`
 * can silently mean a new value (§2.5.4). CSS: `--yt-space-0` … `--yt-space-8`.
 */
export const spacing = {
  none: 0,
  hair: 4,
  tight: 8,
  snug: 12,
  base: 16,
  loose: 24,
  wide: 32,
  section: 48,
  page: 64,
} as const;

/** Radius by role, in px (§2). CSS: `--yt-radius-<name>`. */
export const radii = {
  control: 4,
  tag: 2,
  overlay: 10,
  photo: 0,
  round: 999,
} as const;

/** Nothing that rests has a shadow; only overlays do (§2). */
export const elevation = {
  rest: "none",
  overlay: "0 10px 30px rgba(30,26,22,.25)",
} as const;

/** Durations (§2). Every one runs `ease-out`; under reduced motion: `none`. */
export const motion = {
  fast: "100ms",
  panel: "200ms",
  none: "0ms",
} as const;

/** The easing every `motion` duration uses. */
export const motionEasing = "ease-out";

/** Smallest control in px: web 44, phone apps 48, driver actions 56 and 64. */
export const target = {
  web: 44,
  app: 48,
  driverPrimary: 64,
  driverAction: 56,
} as const;

/**
 * The most the shop header may measure, in px. A maximum, not a value to
 * equal: the shell measures its real header into `--yt-header-h`.
 */
export const headerHeightMax = {
  phone: 120,
  desktop: 124,
} as const;

/** Each web app's theme colour (browser bar, installed app title bar), as a `light` key (§15). */
export const appThemeColor = {
  web: "page",
  seller: "appSeller",
  ops: "appOps",
  field: "appDriver",
} as const satisfies Record<string, CarretaColor>;

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
