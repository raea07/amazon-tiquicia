/**
 * The two read functions of 20261121083510_invoicing_fixes.sql answer in the
 * shape the client expects, for the callers they are for, and refuse the
 * others. Read-only: runs on the shared seeded database.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();
const SHOPPER = "comprador@yuntera.example";

const codeOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) => (error instanceof ApiError ? error.code : String(error)),
  );

describe.skipIf(!db.enabled)("invoicing fixes contract", () => {
  beforeAll(db.connect);
  afterAll(db.close);

  it("gives finance the state of invoicing", async () => {
    const state = await db.as("central@yuntera.example", "aal2").opsInvoicingState();
    expect(["sandbox", "test", "live"]).toContain(state.payments_mode);
    expect(state.waiting_real).toBeGreaterThanOrEqual(0);
    expect(state.waiting_simulated).toBeGreaterThanOrEqual(0);
    expect(state.closed_simulated).toBeGreaterThanOrEqual(0);
  });

  it("refuses the state to a shopper and to a visitor", async () => {
    expect(await codeOf(db.as(SHOPPER, "aal2").opsInvoicingState())).toBe("forbidden");
    expect(await codeOf(db.as().opsInvoicingState())).not.toBeNull();
  });

  it("tells the shopper, for each of their orders, what the page may promise", async () => {
    const { rows } = await db.query<{
      order_number: string;
      shipping_minor: number;
      paid: boolean;
    }>(
      `select o.order_number, o.shipping_minor::int,
              exists (select 1 from public.payments p where p.order_id = o.id
                      and p.status in ('captured', 'partially_refunded', 'refunded')) as paid
       from public.orders o join auth.users u on u.id = o.user_id
       where u.email = $1 order by o.placed_at desc limit 10`,
      [SHOPPER],
    );
    expect(rows.length).toBeGreaterThan(0);
    const shopper = db.as(SHOPPER, "aal2");
    for (const row of rows) {
      const facts = await shopper.myOrderInvoicing(row.order_number);
      expect(facts.paid).toBe(row.paid);
      expect(facts.delivery_by_platform).toBe(row.shipping_minor > 0);
      // Simulated money is documented only where the policy says so.
      if (!facts.simulated) expect(facts.documented).toBe(true);
    }
  });

  it("refuses another shopper's order, and a visitor", async () => {
    const { rows } = await db.query<{ order_number: string }>(
      `select o.order_number from public.orders o join auth.users u on u.id = o.user_id
       where u.email = $1 limit 1`,
      [SHOPPER],
    );
    const number = rows[0]?.order_number ?? "";
    expect(await codeOf(db.as("comprador2@yuntera.example", "aal2").myOrderInvoicing(number))).toBe(
      "order_not_found",
    );
    expect(await codeOf(db.as().myOrderInvoicing(number))).not.toBeNull();
  });
});
