/**
 * The offer order exists twice: here (offers.ts, used by the product page of
 * the website and the shopper app) and in the database (the listing summary
 * that search, category pages and the seller's "featured" badge read, and the
 * order get_product returns a variant's offers in). This reads the SQL between
 * its markers and compares it with OFFER_ORDER_SQL, so neither side can change
 * alone. supabase/tests/155_seller_listings.sql replays offers.test.ts's cases
 * in the database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFER_ORDER_SQL } from "./offers";

/**
 * The migrations that write the rule. 083600 has the listing summary, the
 * first product page body and the cart's alternatives; 083700 replaces the
 * product page body and 084400 the listing summary (each must keep the rule,
 * and its markers).
 */
const FILES = [
  "20261121083600_seller_listings.sql",
  "20261121083700_console_catalogue.sql",
  "20261121084400_stock_lock_order.sql",
];

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

/**
 * Every migration, in order: a later one may redefine one of the functions
 * (084600 redefines the cart's alternatives), and the definition in force is
 * the last one.
 */
const ALL = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort();

function read(file: string): string {
  return readFileSync(`${MIGRATIONS}${file}`, "utf8");
}

/** Every ORDER BY written between `-- BEGIN offer_order` and `-- END offer_order`. */
function marked(sql: string): string[] {
  const found: string[] = [];
  const pattern = /-- BEGIN offer_order\n([\s\S]*?)-- END offer_order/g;
  for (const match of sql.matchAll(pattern)) {
    const body = (match[1] ?? "")
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const order = /order by (.+)$/i.exec(body)?.[1] ?? body;
    found.push(order.replace(/\s+limit \d+$/i, "").trim());
  }
  return found;
}

/** The body of the last definition of a function across the files, in migration order. */
function lastBody(name: string): string {
  let last = "";
  for (const file of ALL) {
    const sql = read(file);
    const pattern = new RegExp(
      `create or replace function ${name.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "g",
    );
    for (const match of sql.matchAll(pattern)) last = match[0];
  }
  return last;
}

describe("the offer order in SQL and TypeScript", () => {
  it("is marked in the summary, the product page and the cart's alternatives", () => {
    expect(marked(read(FILES[0] ?? "")).length).toBeGreaterThanOrEqual(3);
    expect(marked(read(FILES[1] ?? "")).length).toBeGreaterThanOrEqual(1);
  });

  it("is the same rule on both sides", () => {
    for (const file of ALL)
      for (const order of marked(read(file))) expect(order).toBe(OFFER_ORDER_SQL);
  });

  it("is what the definitions in force use", () => {
    for (const name of [
      "private.refresh_product_summary",
      "private.get_product_page",
      "public.cart_alternatives",
    ]) {
      const body = lastBody(name);
      expect(body, name).not.toBe("");
      expect(marked(body), name).toEqual([OFFER_ORDER_SQL]);
    }
  });
});
