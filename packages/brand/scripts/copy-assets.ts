/**
 * Copies the Carreta lockups and app icons from docs/brand/system/assets into
 * packages/brand/assets under English names (lib/asset-map.ts). Run it after
 * the specification's generators have redrawn them:
 *
 *   pnpm --filter @yuntera/brand exec tsx scripts/copy-assets.ts
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetCopies } from "../lib/asset-map";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const source = here("../../../docs/brand/system/assets");
const target = here("../assets");

const copies = assetCopies(source);
for (const copy of copies) {
  mkdirSync(dirname(join(target, copy.target)), { recursive: true });
  copyFileSync(join(source, copy.source), join(target, copy.target));
}
console.info(`copied ${copies.length} files into ${target}`);
