import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_FOUND } from "./wording";

const flat = (text: string) => text.replace(/\s+/g, " ");

/** Every source file under a folder, flattened, joined. */
function sources(dir: string): string {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .map((path) =>
      statSync(path).isDirectory()
        ? sources(path)
        : /\.tsx?$/.test(path) && !path.endsWith(".test.ts")
          ? flat(readFileSync(path, "utf8"))
          : "",
    )
    .join(" ");
}

const app = sources(join(__dirname, ".."));
const web = `${sources(join(__dirname, "../../../web/src"))} ${sources(
  join(__dirname, "../../../../packages/next-kit/src"),
)}`;

describe("what the app says when something is not there", () => {
  it("is the website's not-found page, for a product taken down too", () => {
    const page = flat(readFileSync(join(__dirname, "../../../web/src/app/not-found.tsx"), "utf8"));
    expect(page).toContain(`title="${NOT_FOUND.title}"`);
    expect(page).toContain(NOT_FOUND.body);
    expect(page).toContain(NOT_FOUND.action);
  });

  it("says about a district we do not serve only what the website says", () => {
    // Each sentence of the app that mentions it, from the start of its string
    // or text to its end.
    const sentences = [
      ...new Set(
        (app.match(/[^"`>{}]*no entregamos[^"`<{}]*/gi) ?? [])
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    ];
    expect(sentences.length).toBeGreaterThan(5);
    const lowerWeb = web.toLowerCase();
    for (const sentence of sentences) {
      // A template's variable part (a postal code) is not compared.
      for (const part of sentence.split(/\$\{[^}]*\}?/)) {
        if (part.trim()) expect(lowerWeb, sentence).toContain(part.trim().toLowerCase());
      }
    }
  });
});
