/**
 * The offer order exists twice: here (offers.ts, used by the product page of
 * the website and the shopper app) and in the database (the listing summary
 * that search, category pages and the seller's "featured" badge read, and the
 * order get_product returns a variant's offers in). This reads the SQL between
 * its markers and compares it with OFFER_ORDER_SQL, so neither side can change
 * alone. supabase/tests/155_seller_listings.sql replays offers.test.ts's cases
 * in the database.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFER_ORDER_SQL } from "./offers";

const sql = readFileSync(
  fileURLToPath(
    new URL("../../../supabase/migrations/20261121083600_seller_listings.sql", import.meta.url),
  ),
  "utf8",
);

/** Every ORDER BY written between `-- BEGIN offer_order` and `-- END offer_order`. */
function marked(): string[] {
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

describe("the offer order in SQL and TypeScript", () => {
  it("is marked in the summary and in the product page", () => {
    expect(marked().length).toBeGreaterThanOrEqual(2);
  });

  it("is the same rule on both sides", () => {
    for (const order of marked()) expect(order).toBe(OFFER_ORDER_SQL);
  });
});
