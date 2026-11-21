import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/css";

const target = fileURLToPath(new URL("../src/tokens.css", import.meta.url));
writeFileSync(target, renderTokensCss());
console.info(`wrote ${target}`);
