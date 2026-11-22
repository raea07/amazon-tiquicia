import type { Roles } from "@yuntera/db";
import { describe, expect, it } from "vitest";
import { canUse, NO_ACCESS, noAccessText } from "./roles";

const base: Roles = {
  user_id: "11111111-1111-4111-8111-111111111111",
  full_name: "Ana Mora",
  staff_role: null,
  sellers: [],
  driver: null,
  warehouses: [],
};

describe("canUse", () => {
  it("lets every account shop and nobody signed out do anything", () => {
    expect(canUse("shopper", base)).toBe(true);
    for (const audience of ["shopper", "seller", "driver", "warehouse"] as const) {
      expect(canUse(audience, null)).toBe(false);
    }
  });

  it("opens the seller app to members of a shop", () => {
    expect(canUse("seller", base)).toBe(false);
    const member = {
      ...base,
      sellers: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "tienda",
          trade_name: "Tienda",
          status: "active" as const,
          role: "staff" as const,
        },
      ],
    };
    expect(canUse("seller", member)).toBe(true);
  });

  it("opens the drivers' app only to an active driver", () => {
    const driver = (status: NonNullable<Roles["driver"]>["status"]) => ({
      ...base,
      driver: { id: "33333333-3333-4333-8333-333333333333", status, full_name: "Luis" },
    });
    expect(canUse("driver", driver("active"))).toBe(true);
    expect(canUse("driver", driver("pending"))).toBe(false);
    expect(canUse("driver", driver("suspended"))).toBe(false);
  });

  it("opens the warehouse app to anyone assigned to a warehouse", () => {
    expect(canUse("warehouse", base)).toBe(false);
    const worker = {
      ...base,
      warehouses: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          code: "SJ1",
          name: "Bodega",
          role: "associate" as const,
        },
      ],
    };
    expect(canUse("warehouse", worker)).toBe(true);
  });

  it("says what to do next on every no-access screen, in usted", () => {
    for (const { title, body } of Object.values(NO_ACCESS)) {
      expect(title.length).toBeGreaterThan(10);
      expect(body).toMatch(/pídale|registre/i);
      expect(body).not.toMatch(/\b(tú|vos|tu cuenta)\b/i);
    }
  });

  it("tells a suspended or deactivated driver what happened to the routes and what to bring back", () => {
    const driver = (status: NonNullable<Roles["driver"]>["status"]) => ({
      ...base,
      driver: { id: "33333333-3333-4333-8333-333333333333", status, full_name: "Luis" },
    });
    const suspended = noAccessText("driver", driver("suspended"));
    expect(suspended.title).toBe("Su cuenta de repartidor está suspendida");
    expect(suspended.body).toMatch(/volvieron a Central/);
    expect(suspended.body).toMatch(/llévelos a la bodega/);
    expect(noAccessText("driver", driver("offboarded")).title).toMatch(/desactivada/);
    expect(noAccessText("driver", driver("pending"))).toEqual(NO_ACCESS.driver);
    expect(noAccessText("driver", null)).toEqual(NO_ACCESS.driver);
    expect(noAccessText("warehouse", driver("suspended"))).toEqual(NO_ACCESS.warehouse);
  });
});
