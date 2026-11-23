import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canShipmentTransition,
  deliveryFeeComesBack,
  deliveryFeeKeptLine,
  isOrderBeingStopped,
  isRescheduledOrder,
  isStoppedShipment,
  ORDER_PROGRESS,
  orderComingBack,
  orderStatusFromShipments,
} from "./lifecycle";

// The SQL side of these rules, read as text (no database needed).
const migrations = join(__dirname, "../../../supabase/migrations");
const followupsFile = readdirSync(migrations).find((f) => f.endsWith("_order_followups.sql"));
const followups = readFileSync(join(migrations, followupsFile ?? "missing"), "utf8");

describe("a parcel staff stop before it left", () => {
  it("goes from packed or ready (on a route not started) back to the shelves", () => {
    expect(canShipmentTransition("packed", "returning")).toBe(true);
    expect(canShipmentTransition("ready_for_dispatch", "returning")).toBe(true);
    expect(canShipmentTransition("out_for_delivery", "returning")).toBe(false);
    expect(canShipmentTransition("delivered", "returning")).toBe(false);
    expect(canShipmentTransition("returning", "returning")).toBe(false);
  });

  it("is accepted by the database from exactly those two states", () => {
    expect(followups).toContain(
      "if v_ship.status not in ('packed', 'ready_for_dispatch') then\n    perform private.fail('shipment_not_recallable'",
    );
    // get_order's can_recall says the same to the console.
    expect(followups).toContain("s.status in ('packed', 'ready_for_dispatch')");
  });

  it("is a stopped parcel only while it waits to be received", () => {
    expect(isStoppedShipment("returning", true)).toBe(true);
    expect(isStoppedShipment("returning", false)).toBe(false);
    expect(isStoppedShipment("returned", true)).toBe(false);
  });

  it("makes an order being stopped only when every parcel still to deliver was stopped", () => {
    const stopped = { status: "returning" as const, recalled: true };
    const back = { status: "returned" as const, recalled: true };
    const onItsWay = { status: "out_for_delivery" as const, recalled: false };
    const delivered = { status: "delivered" as const, recalled: false };
    const failedBack = { status: "returning" as const, recalled: false };
    expect(isOrderBeingStopped("processing", [stopped])).toBe(true);
    expect(isOrderBeingStopped("processing", [back, stopped])).toBe(true);
    expect(isOrderBeingStopped("shipped", [stopped, onItsWay])).toBe(false);
    expect(isOrderBeingStopped("partially_shipped", [delivered, stopped])).toBe(false);
    expect(isOrderBeingStopped("shipped", [failedBack])).toBe(false);
    expect(isOrderBeingStopped("cancelled", [back])).toBe(false);
    expect(isOrderBeingStopped("processing", [])).toBe(false);
    // An answer from before the field existed reads as not stopped.
    expect(isOrderBeingStopped("processing", [{ status: "returning" }])).toBe(false);
  });

  it("is never called rescheduled", () => {
    expect(isRescheduledOrder("processing", [{ status: "returning", attempt_count: 0 }])).toBe(
      false,
    );
  });
});

describe("the delivery fee when nobody went to the door", () => {
  it("comes back when no parcel was delivered or attempted", () => {
    expect(deliveryFeeComesBack([{ status: "returned", attempt_count: 0 }])).toBe(true);
    expect(
      deliveryFeeComesBack([
        { status: "returned", attempt_count: 0 },
        { status: "returning", attempt_count: 0 },
      ]),
    ).toBe(true);
  });

  it("stays charged after a real attempt or a delivery", () => {
    expect(deliveryFeeComesBack([{ status: "returned", attempt_count: 1 }])).toBe(false);
    expect(
      deliveryFeeComesBack([
        { status: "returned", attempt_count: 0 },
        { status: "delivered", attempt_count: 0 },
      ]),
    ).toBe(false);
    expect(deliveryFeeComesBack([])).toBe(false);
  });

  it("is explained to the shopper when it stays charged after an attempt", () => {
    const tried = [{ status: "returned" as const, attempt_count: 1 }];
    expect(
      deliveryFeeKeptLine({ shipments: tried, shippingMinor: 150000, paid: true, fee: "₡1 500" }),
    ).toBe("El envío (₡1 500) no se devuelve porque fuimos a entregarlo a su dirección.");
    // Nothing to explain: the fee comes back, there was no fee, or nothing was paid.
    const never = [{ status: "returned" as const, attempt_count: 0 }];
    expect(
      deliveryFeeKeptLine({ shipments: never, shippingMinor: 150000, paid: true, fee: "x" }),
    ).toBeNull();
    expect(
      deliveryFeeKeptLine({ shipments: tried, shippingMinor: 0, paid: true, fee: "x" }),
    ).toBeNull();
    expect(
      deliveryFeeKeptLine({ shipments: tried, shippingMinor: 150000, paid: false, fee: "x" }),
    ).toBeNull();
    expect(
      deliveryFeeKeptLine({ shipments: [], shippingMinor: 150000, paid: true, fee: "x" }),
    ).toBeNull();
  });

  it("is the rule the database applies", () => {
    // private.order_had_door_attempt: an attempt counted, or a stop the driver marked failed.
    expect(followups).toMatch(
      /s\.attempt_count > 0\s+or exists \(select 1 from public\.route_stops rs\s+where rs\.shipment_id = s\.id and rs\.status = 'failed'\)/,
    );
    // Applied only when receiving the parcel cancels the order (nothing
    // delivered, nothing still on its way).
    expect(followups).toContain(
      "if v_cancelled and not private.order_had_door_attempt(v_order.id) then",
    );
  });
});

describe("an order whose parcels are all on their way back", () => {
  const stopped = { status: "returning" as const, recalled: true };
  const sentBack = { status: "returning" as const, recalled: false };
  const delivered = { status: "delivered" as const, recalled: false };
  const back = { status: "returned" as const, recalled: false };

  it("is being cancelled when nothing was delivered, stopped or sent back after a route", () => {
    expect(orderComingBack("processing", [stopped])).toEqual({ cancels: true, stopped: true });
    // Taken off a route and sent back: the preview's YT-101282 and YT-101283.
    expect(orderComingBack("shipped", [sentBack])).toEqual({ cancels: true, stopped: false });
    expect(orderComingBack("shipped", [back, sentBack])).toEqual({ cancels: true, stopped: false });
  });

  it("only gives back a parcel's goods when another was delivered", () => {
    expect(orderComingBack("shipped", [delivered, sentBack])).toEqual({
      cancels: false,
      stopped: false,
    });
  });

  it("is not when a parcel may still reach the shopper, or the order has ended", () => {
    expect(orderComingBack("shipped", [sentBack, { status: "out_for_delivery" }])).toBeNull();
    expect(orderComingBack("shipped", [sentBack, { status: "delivery_failed" }])).toBeNull();
    expect(orderComingBack("processing", [stopped, { status: "packed" }])).toBeNull();
    expect(orderComingBack("cancelled", [back])).toBeNull();
    expect(orderComingBack("delivered", [delivered, back])).toBeNull();
    expect(orderComingBack("processing", [])).toBeNull();
  });

  it("agrees with the database, which hides the delivery code then", () => {
    expect(followups).toContain(
      "and s.status in ('pending', 'picking', 'packed', 'ready_for_dispatch',\n                                                        'out_for_delivery', 'delivery_failed'))",
    );
  });
});

describe("an order never moves back a status", () => {
  it("stays on its way when a re-planned parcel is taken off its route", () => {
    expect(orderStatusFromShipments("shipped", ["packed"])).toBe("shipped");
    expect(orderStatusFromShipments("shipped", ["packed", "delivered"])).toBe("shipped");
    expect(orderStatusFromShipments("partially_shipped", ["packed", "pending"])).toBe(
      "partially_shipped",
    );
    // Forward as before.
    expect(orderStatusFromShipments("processing", ["out_for_delivery"])).toBe("shipped");
  });

  it("uses the order the database uses", () => {
    const sql = followups.match(
      /-- BEGIN order_progress\s+v_progress constant text\[\] := array\[([^\]]+)\];\s+-- END order_progress/,
    );
    expect(sql?.[1]?.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([
      ...ORDER_PROGRESS,
    ]);
    expect(followups).toContain(
      "if array_position(v_progress, v_target::text) < array_position(v_progress, v_current::text) then\n    return;",
    );
  });
});
