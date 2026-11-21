import { color, font, fontSize, radius, semantic, shadow } from "./tokens";

/**
 * Renders the tokens as a Tailwind v4 `@theme` block. The output is committed
 * as `tokens.css`; `tokens.test.ts` fails if the file is stale.
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

  const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
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
