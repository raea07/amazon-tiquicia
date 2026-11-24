/**
 * The functions that wave 8's migrations (084400 the lock order, 084500 the
 * count into a location, 084600 the shopper follow-ups) define are each
 * defined exactly once across the three, and no later migration redefines
 * them: the definition the supabase/tests suites check is the one in force.
 * A later migration that redefines one of them must update this list.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const ALL = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const WAVE8 = [
  "20261121084400_stock_lock_order.sql",
  "20261121084500_count_into_location.sql",
  "20261121084600_shopper_followups.sql",
];

/** Every `create [or replace] function schema.name(` in one file, in order. */
function defined(file: string): string[] {
  const sql = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  return [...sql.matchAll(/create (?:or replace )?function\s+([a-z_]+\.[a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
}

/** The file of the last definition of each function, across every migration. */
function inForce(): Map<string, string> {
  const last = new Map<string, string>();
  for (const file of ALL) for (const name of defined(file)) last.set(name, file);
  return last;
}

describe("wave 8's function definitions", () => {
  it("define each function once across 084400, 084500 and 084600", () => {
    const names = WAVE8.flatMap(defined);
    const twice = names.filter((name, i) => names.indexOf(name) !== i);
    expect(twice).toEqual([]);
  });

  it("are the definitions in force", () => {
    const last = inForce();
    for (const file of WAVE8)
      for (const name of defined(file)) expect(last.get(name), name).toBe(file);
  });

  it("put the planner, the refund grouping, the cancellation and the count where the documents say", () => {
    const last = inForce();
    expect(last.get("private.notify_plan_event")).toBe("20261121084600_shopper_followups.sql");
    expect(last.get("private.refund_announcement")).toBe("20261121084600_shopper_followups.sql");
    expect(last.get("public.cart_alternatives")).toBe("20261121084600_shopper_followups.sql");
    expect(last.get("private.cancel_order_internal")).toBe("20261121084400_stock_lock_order.sql");
    expect(last.get("private.expire_unpaid_orders")).toBe("20261121084400_stock_lock_order.sql");
    expect(last.get("public.wms_count_into_location")).toBe(
      "20261121084500_count_into_location.sql",
    );
  });
});
