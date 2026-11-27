import { readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Which file of docs/brand/system/assets becomes which file of
 * packages/brand/assets. The Carreta artwork is drawn by the generators in
 * docs/brand/system/src (SISTEMA.md §15); this package ships byte-identical
 * copies under English names, made by scripts/copy-assets.ts. `assets.test.ts`
 * fails when a copy differs from its source, is missing, or is not mapped.
 */

/** Spanish app word in the specification → the app's id in `brand.ts`. */
const appWords: Record<string, string> = {
  yuntera: "shop",
  vende: "seller",
  ruta: "driver",
  bodega: "warehouse",
  central: "ops",
};

const colourWords: Record<string, string> = {
  marca: "brand",
  tinta: "ink",
  blanco: "white",
};

const iconVariants: Record<string, string> = {
  "1024": "1024",
  "512": "512",
  "180": "180",
  "48": "48",
  "adaptativo-frente-432": "adaptive-foreground-432",
  "adaptativo-fondo-432": "adaptive-background-432",
  "monocromo-432": "monochrome-432",
  "inicio-1024": "splash-1024",
  "inicio-oscuro-1024": "splash-dark-1024",
};

function word(map: Record<string, string>, key: string, source: string): string {
  const value = map[key];
  if (!value) throw new Error(`No English name for "${key}" in ${source}`);
  return value;
}

/** One copy: `source` under docs/brand/system/assets, `target` under packages/brand/assets. */
export interface AssetCopy {
  source: string;
  target: string;
}

/** Every lockup and app icon of the specification, with the name it gets here. */
export function assetCopies(systemAssetsDir: string): AssetCopy[] {
  const copies: AssetCopy[] = [];
  for (const file of readdirSync(join(systemAssetsDir, "logo")).sort()) {
    const m = /^([a-z]+)-([a-z]+)(@2x)?\.(svg|png)$/.exec(file);
    if (!m) throw new Error(`Unexpected lockup file ${file}`);
    const [, app = "", colour = "", twice, ext] = m;
    const base = `lockup-${word(appWords, app, file)}-${word(colourWords, colour, file)}`;
    const name = ext === "svg" ? `${base}.svg` : `${base}-${twice ? 120 : 60}.png`;
    copies.push({ source: `logo/${file}`, target: `lockups/${name}` });
  }
  for (const file of readdirSync(join(systemAssetsDir, "app-icons")).sort()) {
    const m = /^icono-([a-z]+)-([a-z0-9-]+)\.png$/.exec(file);
    if (!m) throw new Error(`Unexpected app icon file ${file}`);
    const [, app = "", variant = ""] = m;
    copies.push({
      source: `app-icons/${file}`,
      target: `app-icons/icon-${word(appWords, app, file)}-${word(iconVariants, variant, file)}.png`,
    });
  }
  for (const file of readdirSync(systemAssetsDir).sort()) {
    const m = /^icono-([a-z]+)\.svg$/.exec(file);
    if (!m) continue;
    copies.push({ source: file, target: `app-icons/icon-${word(appWords, m[1] ?? "", file)}.svg` });
  }
  return copies;
}
