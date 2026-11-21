/**
 * Contract tests for the account-security functions: real responses, as each
 * role, against the client's schemas. Deletion itself is exercised by
 * supabase/tests/095_account_security.sql (it would change the seed here); the
 * check that precedes it is covered.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();

describe.skipIf(!db.enabled)("account security (against a seeded database)", () => {
  beforeAll(db.connect);
  afterAll(db.close);

  it("tells a session its level and whether a second factor is required", async () => {
    const shopper = await db.as("comprador@yuntera.example").mySecurity();
    expect(shopper).toEqual({
      aal: "aal1",
      is_staff: false,
      mfa_required: false,
      staff_session_ok: true,
    });
    const staff = await db.as("central@yuntera.example", "aal2").mySecurity();
    expect(staff.is_staff).toBe(true);
    expect(staff.aal).toBe("aal2");
  });

  it("reports the wrong-code limit", async () => {
    const status = await db.as("comprador3@yuntera.example").mfaAttemptStatus();
    expect(status.locked).toBe(false);
    expect(status.attempts_left).toBeGreaterThan(0);
  });

  it("lists staff and their factors for an administrator only", async () => {
    const rows = await db.as("central@yuntera.example").opsStaffSecurity();
    expect(rows.some((row) => row.is_self && row.role === "admin")).toBe(true);
    await expect(db.as("comprador@yuntera.example").opsStaffSecurity()).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses a factor reset on oneself with its own reason", async () => {
    const [admin] = (
      await db.query<{ id: string }>(
        "select id from auth.users where email = 'central@yuntera.example'",
      )
    ).rows;
    const error = await db
      .as("central@yuntera.example")
      .opsResetStaffFactor(admin?.id ?? "")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("cannot_reset_own_factor");
  });

  it("explains what stands in the way of deleting an account", async () => {
    const shopper = await db.as("comprador@yuntera.example").accountDeletionCheck();
    expect(shopper.blockers).toContain("account_has_open_orders");
    expect(shopper.orders_kept).toBeGreaterThan(0);
    const seller = await db.as("vendedor@yuntera.example").accountDeletionCheck();
    expect(seller.blockers).toContain("account_shop_has_stock");
    const staff = await db.as("central@yuntera.example").accountDeletionCheck();
    expect(staff.blockers[0]).toBe("account_is_staff");
  });
});
