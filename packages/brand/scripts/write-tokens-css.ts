import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderCarretaBaseCss,
  renderCarretaTokensCss,
  renderLegacyTokensCss,
  renderTokensCss,
} from "../src/css";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const system = (path: string) => readFileSync(here(`../../../docs/brand/system/${path}`), "utf8");

mkdirSync(here("../styles"), { recursive: true });
const outputs: Array<[path: string, css: string]> = [
  ["../src/tokens.css", renderTokensCss()],
  ["../styles/tokens.legacy.css", renderLegacyTokensCss()],
  ["../styles/tokens.css", renderCarretaTokensCss()],
  [
    "../styles/carreta-base.css",
    renderCarretaBaseCss(system("src/css/1-base.css"), system("carreta.css")),
  ],
];
for (const [path, css] of outputs) {
  writeFileSync(here(path), css);
  console.info(`wrote ${here(path)}`);
}
