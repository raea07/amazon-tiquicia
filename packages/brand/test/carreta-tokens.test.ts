import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  carretaOnlyColors,
  legacyAliases,
  renderCarretaBaseCss,
  renderCarretaTokensCss,
  renderLegacyTokensCss,
  renderTokensCss,
} from "../lib/stylesheets";
import {
  appThemeColor,
  type CarretaColor,
  contrastRatio,
  dark,
  elevation,
  fontFiles,
  headerHeightMax,
  light,
  motion,
  palette,
  radii,
  spacing,
  target,
  type,
  typeface,
} from "../src/tokens";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const system = (path: string) => read(`../../../docs/brand/system/${path}`);
const tokensJson = JSON.parse(system("tokens.json"));
const migrationJson = JSON.parse(system("migration.json"));
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Every `--name: value;` declared in a stylesheet, in order. */
function declarations(css: string): Array<[name: string, value: string]> {
  return [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [
    m[1] as string,
    (m[2] as string).trim(),
  ]);
}

/** The sha256 of `src/tokens.css` at main 12ec48c, before Carreta. */
const TODAY_TOKENS_CSS_SHA256 = "ef461b6f5e68947fb1fd2def24e38970b69e91ba8d969a4c8e74d5a6e067e47e";

describe("today's tokens.css (what every web app imports until it moves)", () => {
  it("is in sync with legacy.ts", () => {
    expect(read("../src/tokens.css")).toBe(renderTokensCss());
  });

  it("is byte for byte the file of before Carreta", () => {
    expect(sha256(read("../src/tokens.css"))).toBe(TODAY_TOKENS_CSS_SHA256);
  });
});

describe("packages/brand/src (scanned by every web app's Tailwind)", () => {
  // next-kit base.css has `@source "../../brand/src"`: every word in these files can become a
  // CSS rule in an app that has not moved. Build helpers and tests live in lib/ and test/, so
  // the apps' compiled CSS stays byte for byte the same in phase A. Add a file here only when
  // the apps need it at run time, and check their CSS after.
  it("holds only the files the apps need at run time", () => {
    expect(readdirSync(fileURLToPath(new URL("../src", import.meta.url))).sort()).toEqual([
      "brand.ts",
      "css.ts",
      "index.ts",
      "legacy.ts",
      "logo.tsx",
      "mark.ts",
      "tokens.css",
      "tokens.test.ts",
      "tokens.ts",
    ]);
  });
});

describe("styles/tokens.legacy.css", () => {
  const legacyCss = read("../styles/tokens.legacy.css");
  const today = read("../src/tokens.css");

  it("is in sync with tokens.ts", () => {
    expect(legacyCss).toBe(renderLegacyTokensCss());
  });

  it("is today's tokens.css plus only added names (snapshot)", () => {
    expect(legacyCss.startsWith(today)).toBe(true);
    const todayNames = new Set(declarations(today).map(([name]) => name));
    const added = declarations(legacyCss.slice(today.length));
    expect(added.length).toBeGreaterThan(0);
    for (const [name] of added) expect(todayNames.has(name), name).toBe(false);
    // Each added name is declared once.
    expect(new Set(added.map(([name]) => name)).size).toBe(added.length);
  });

  it("adds the Carreta-only colours §2.5 lists, and no colour of today", () => {
    expect([...carretaOnlyColors].sort()).toEqual(
      [
        "page",
        "band",
        "photo",
        "edge",
        "rule",
        "primary",
        "on-primary",
        "on-success",
        "on-danger",
        "on-warning",
        "app-shop",
        "app-seller",
        "app-driver",
        "app-warehouse",
        "app-ops",
        "on-app",
        "ink-fixed",
        "wheel-rim",
      ].sort(),
    );
    const added = new Map(declarations(legacyCss.slice(today.length)));
    for (const name of carretaOnlyColors) {
      expect(added.get(`--color-${name}`)).toBe(`var(--yt-${name})`);
    }
  });
});

describe("styles/tokens.css (Carreta)", () => {
  const carretaCss = read("../styles/tokens.css");
  const decl = new Map(declarations(carretaCss));

  it("is in sync with tokens.ts", () => {
    expect(carretaCss).toBe(renderCarretaTokensCss());
  });

  it("keeps every Tailwind name of today, so nothing an app writes disappears", () => {
    for (const [name] of declarations(read("../src/tokens.css"))) {
      expect(decl.has(name), name).toBe(true);
    }
  });

  it("keeps today's ramps with today's values", () => {
    for (const [name, value] of declarations(read("../src/tokens.css"))) {
      if (
        /^--color-(celeste|anil|guaria|maiz|selva|achiote|arena)-\d+$|^--color-white$/.test(name)
      ) {
        expect(decl.get(name), name).toBe(value);
      }
    }
  });

  it("aliases every legacy-only name of §2.5.1 to its Carreta target", () => {
    const dropped = (
      migrationJson.semantic as Array<{ today: string; carreta: string; kind: string }>
    )
      .filter((row) => row.kind === "renamed" || row.kind === "gone")
      .map((row) => row.today);
    expect(Object.keys(legacyAliases).sort()).toEqual(dropped.sort());
    for (const row of migrationJson.semantic as Array<{ today: string; carreta: string }>) {
      const alias = legacyAliases[row.today];
      if (!alias) continue;
      expect(decl.get(`--color-${kebab(row.today)}`)).toBe(`var(--yt-${kebab(alias)})`);
      // The target is the first word §2.5.1 names; promo has none ("no sale colour").
      if (row.today !== "promo") expect(row.carreta.split(" ")[0]).toBe(alias);
    }
  });

  it("exposes every Carreta semantic colour to Tailwind, and no palette word", () => {
    for (const name of Object.keys(light)) {
      expect(decl.get(`--color-${kebab(name)}`)).toBe(`var(--yt-${kebab(name)})`);
    }
    for (const name of Object.keys(palette)) {
      if (name in light) continue;
      expect(decl.has(`--color-${kebab(name)}`), name).toBe(false);
    }
  });

  it("declares the dark appearance outside @theme, with the ring declared again", () => {
    const block = /:root\[data-theme="dark"\] \{([^}]*)\}/.exec(carretaCss)?.[1] ?? "";
    expect(block).toContain("--yt-ring: var(--yt-focus);");
    const darkDecl = new Map(declarations(block));
    for (const [name, hex] of Object.entries(dark)) {
      expect(darkDecl.get(`--yt-${kebab(name)}`)).toBe(hex);
    }
    expect(carretaCss.indexOf(':root[data-theme="dark"]')).toBeLessThan(
      carretaCss.search(/^@theme/m),
    );
  });
});

describe("styles/carreta-base.css", () => {
  const baseCss = read("../styles/carreta-base.css");

  it("is copied from the specification's stylesheets", () => {
    expect(baseCss).toBe(renderCarretaBaseCss(system("src/css/1-base.css"), system("carreta.css")));
    for (const line of baseCss.split("\n")) {
      if (line === "" || line.startsWith("/*") || line.startsWith("   ")) continue;
      expect(system("carreta.css").includes(line), line).toBe(true);
    }
  });

  it("has a type class for every step, with the sizes of `type`", () => {
    const [phonePart, desktopPart = ""] = baseCss.split("@media (min-width:900px){");
    for (const [name, value] of Object.entries(type)) {
      const cls = `.t-${kebab(name)}{`;
      const rule = (phonePart ?? "").split("\n").find((line) => line.startsWith(cls)) ?? "";
      expect(rule, name).toContain(`font-weight:${value.weight};`);
      expect(rule, name).toContain(
        `font-size:${value.phone.size}px;line-height:${value.phone.line}px`,
      );
      expect(rule, name).toContain(value.face === "title" ? "--yt-font-title" : "--yt-font-text");
      if (value.tracking !== "0") expect(rule, name).toContain(`letter-spacing:${value.tracking}`);
      const wide = desktopPart.split("\n").find((line) => line.trim().startsWith(cls));
      const desktop = wide ?? `font-size:${value.phone.size}px;line-height:${value.phone.line}px`;
      expect(desktop, name).toContain(
        `font-size:${value.desktop.size}px;line-height:${value.desktop.line}px`,
      );
    }
  });

  it("draws one 3 px ring and resets it on every band", () => {
    expect(baseCss).toContain(
      ":focus-visible{outline:3px solid var(--yt-ring);outline-offset:2px}",
    );
    expect(baseCss).toContain("scroll-padding-bottom:var(--bar-h,0px)");
    for (const band of [".banda{", ".banda-marca{", ".banda-peligro{"]) {
      expect(baseCss).toContain(band);
    }
  });
});

describe("Carreta tokens equal docs/brand/system/tokens.json", () => {
  it("palette", () => {
    expect(Object.keys(palette)).toEqual(Object.keys(tokensJson.palette).map(camel));
    for (const [name, hex] of Object.entries(tokensJson.palette)) {
      expect(palette[camel(name) as keyof typeof palette], name).toBe(hex);
    }
  });

  it("light and dark", () => {
    expect(light).toEqual(tokensJson.semantic);
    expect(dark).toEqual(tokensJson.semanticDark);
    expect(Object.keys(light)).toEqual(Object.keys(tokensJson.semantic));
  });

  it("type, spacing, radii, elevation, motion, target, header height, theme colours", () => {
    expect(type).toEqual(tokensJson.type);
    expect(spacing).toEqual(tokensJson.spacing);
    expect(Object.values(spacing)).toEqual(tokensJson.space);
    expect(radii).toEqual(tokensJson.radius);
    expect(elevation).toEqual(tokensJson.elevation);
    expect(motion).toEqual(tokensJson.motion);
    expect(target).toEqual(tokensJson.target);
    expect(headerHeightMax).toEqual(tokensJson.headerHeightMax);
    expect(appThemeColor).toEqual(tokensJson.themeColor);
  });

  it("faces and font files", () => {
    const { files, ...faces } = tokensJson.font;
    expect(typeface).toEqual(faces);
    expect(fontFiles).toEqual(files);
    for (const path of [...Object.values(fontFiles.web), ...Object.values(fontFiles.phone)]) {
      expect(
        existsSync(fileURLToPath(new URL(`../../../docs/brand/system/${path}`, import.meta.url))),
        path,
      ).toBe(true);
    }
  });

  it("no serif anywhere", () => {
    for (const stack of [typeface.text, typeface.title]) {
      expect(stack.endsWith(", sans-serif")).toBe(true);
    }
  });
});

describe("Carreta contrast (SISTEMA.md §2, contrast pairs; WCAG 2.x)", () => {
  // Every pair of the table, by the CSS names it uses (`fg` on `bg`).
  const pairs: Array<[pair: string, fg: CarretaColor, bg: CarretaColor, needs: number]> = [
    ["body text on page", "ink", "page", 4.5],
    ["body text on band", "ink", "band", 4.5],
    ["muted text on page", "inkMuted", "page", 4.5],
    ["muted text on band", "inkMuted", "band", 4.5],
    ["muted text on photo ground", "inkMuted", "photo", 4.5],
    ["control edge on page", "edge", "page", 3],
    ["control edge on band", "edge", "band", 3],
    ["primary button label", "onPrimary", "primary", 4.5],
    ["primary button against page", "primary", "page", 3],
    ["link on page", "link", "page", 4.5],
    ["link on band", "link", "band", 4.5],
    ["focus ring on page", "focus", "page", 3],
    ["focus ring on band", "focus", "band", 3],
    ["brand text on page", "brand", "page", 4.5],
    ["brand text on band", "brand", "band", 4.5],
    ["text on brand", "onBrand", "brand", 4.5],
    ["ring on brand", "onBrand", "brand", 3],
    ["success tag text", "onSuccess", "success", 4.5],
    ["success text on page", "success", "page", 4.5],
    ["danger text on page", "danger", "page", 4.5],
    ["text on danger", "onDanger", "danger", 4.5],
    ["text on warning", "onWarning", "warning", 4.5],
    ["text on vende bar", "onApp", "appSeller", 4.5],
    ["text on ruta bar", "onApp", "appDriver", 4.5],
    ["text on central bar", "onApp", "appOps", 4.5],
    ["on-band button label and side-bar count", "inkFixed", "onApp", 4.5],
    ["refused-scan button label", "danger", "onDanger", 4.5],
    ["wheel rim against the page", "wheelRim", "page", 3],
  ];

  /** The rows of the table in SISTEMA.md: fg, bg, needs, light, dark. */
  const table = (() => {
    const text = system("SISTEMA.md");
    const start = text.indexOf("### Contrast pairs");
    const rows = text
      .slice(start, text.indexOf("\n\n", text.indexOf("|---|", start)))
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Pair"));
    return rows.map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      const names = [...(cells[1] ?? "").matchAll(/`([a-z-]+)` on `([a-z-]+)`/g)].at(-1);
      return {
        fg: camel(names?.[1] ?? ""),
        bg: camel(names?.[2] ?? ""),
        needs: Number.parseFloat(cells[2] ?? ""),
        light: Number.parseFloat(cells[3] ?? ""),
        dark: Number.parseFloat(cells[4] ?? ""),
      };
    });
  })();

  it("lists every pair of the table, and the table lists every pair here", () => {
    expect(table.length).toBe(pairs.length);
    expect(table.map((row) => `${row.fg}/${row.bg}/${row.needs}`).sort()).toEqual(
      pairs.map(([, fg, bg, needs]) => `${fg}/${bg}/${needs}`).sort(),
    );
  });

  for (const [appearance, colors] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it.each(pairs)(`${appearance}: %s passes its threshold`, (_pair, fg, bg, needs) => {
      expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(needs);
    });
  }

  it("gives the ratios the table prints", () => {
    for (const row of table) {
      const fg = row.fg as CarretaColor;
      const bg = row.bg as CarretaColor;
      expect(contrastRatio(light[fg], light[bg]).toFixed(2), `${row.fg} on ${row.bg}`).toBe(
        row.light.toFixed(2),
      );
      expect(contrastRatio(dark[fg], dark[bg]).toFixed(2), `${row.fg} on ${row.bg} dark`).toBe(
        row.dark.toFixed(2),
      );
    }
  });
});

describe("theme colour (Carreta)", () => {
  it("names, for each web app, a token that exists", () => {
    for (const token of Object.values(appThemeColor)) {
      expect(light[token]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
