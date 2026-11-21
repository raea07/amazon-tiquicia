/**
 * Who may execute which function is written down twice: for people in
 * docs/03-data/access-control.md, and for the database in
 * supabase/tests/110_lockdown.sql, which fails when the catalogue allows more.
 * This keeps the two lists the same, so the guard checks what the document
 * promises.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const doc = read("../../../docs/03-data/access-control.md");
const guard = read("../../../supabase/tests/110_lockdown.sql");

function between(text: string, begin: string, end: string): string {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end, start);
  if (start < 0 || stop < 0) throw new Error(`markers not found: ${begin}`);
  return text.slice(start + begin.length, stop);
}

/** Function names listed as `- \`name\`` bullets between HTML comment markers. */
function fromDoc(list: string): string[] {
  const part = between(doc, `<!-- BEGIN ${list} -->`, `<!-- END ${list} -->`);
  return [...part.matchAll(/^- `([a-z_]+)`/gm)].map((m) => m[1] ?? "").sort();
}

/** Function names quoted in the SQL array between `-- BEGIN`/`-- END` comments. */
function fromGuard(list: string): string[] {
  const part = between(guard, `-- BEGIN ${list}`, `-- END ${list}`);
  return [...part.matchAll(/'([a-z_]+)'/g)]
    .map((m) => m[1] ?? "")
    .filter(
      (name) =>
        !["anon", "public", "private", "authenticated", "service_role", "supabase_auth_admin"].includes(
          name,
        ),
    )
    .sort();
}

describe("the documented execute lists", () => {
  for (const list of [
    "visitor functions",
    "internal functions",
    "policy helpers",
    "storage policy helpers",
    "server-side functions",
  ]) {
    it(`match the guard test: ${list}`, () => {
      const documented = fromDoc(list);
      expect(documented.length).toBeGreaterThan(0);
      expect(fromGuard(list)).toEqual(documented);
    });
  }

  it("give visitors the browsing functions and nothing that writes for a signed-in user", () => {
    const visitor = fromDoc("visitor functions");
    expect(visitor).toContain("get_product");
    expect(visitor).toContain("search_products");
    expect(visitor).not.toContain("place_order");
    expect(visitor).not.toContain("reviewer_display_name");
  });
});
