import { describe, expect, it } from "vitest";
import {
  awaitingNewAttemptLine,
  isRescheduledOrder,
  orderAwaitingNewAttempt,
  orderComingBack,
  type ShipmentStatus,
  waitsForNewAttempt,
} from "./lifecycle";

const parcel = (status: ShipmentStatus, attempt_count = 0, recalled = false) => ({
  status,
  attempt_count,
  recalled,
});

describe("an order on its way with nothing on its way", () => {
  it("failed once, planned again and taken off the new route: no longer 'En camino'", () => {
    // The state the first stream left: shipped, parcel packed again, one attempt.
    expect(waitsForNewAttempt("packed", 1)).toBe(true);
    expect(orderAwaitingNewAttempt("shipped", [parcel("packed", 1)])).toEqual({
      failedAttempt: false,
    });
    // Before this, the list and the page fell through to the order status.
    expect(isRescheduledOrder("shipped", [parcel("packed", 1)])).toBe(false);
    expect(orderComingBack("shipped", [parcel("packed", 1)])).toBeNull();
  });

  it("covers every open parcel state after a first attempt when nothing is out for delivery", () => {
    for (const shipments of [
      [parcel("delivery_failed", 1)],
      [parcel("delivery_failed", 0)],
      [parcel("ready_for_dispatch", 1)],
      [parcel("packed", 2)],
      [parcel("packed", 1), parcel("returning", 1)],
      [parcel("delivered"), parcel("delivery_failed", 1)],
    ]) {
      expect(
        orderAwaitingNewAttempt("shipped", shipments),
        JSON.stringify(shipments),
      ).not.toBeNull();
    }
    expect(orderAwaitingNewAttempt("partially_shipped", [parcel("packed", 1)])).not.toBeNull();
  });

  it("says the delivery just failed only when a parcel failed at the door and waits", () => {
    expect(orderAwaitingNewAttempt("shipped", [parcel("delivery_failed", 1)])).toEqual({
      failedAttempt: true,
    });
    expect(orderAwaitingNewAttempt("shipped", [parcel("delivery_failed", 0)])).toEqual({
      failedAttempt: false,
    });
    expect(awaitingNewAttemptLine(true)).toMatch(/No pudimos entregarlo/);
    expect(awaitingNewAttemptLine(false)).toMatch(/Reprogramamos la entrega/);
    for (const line of [awaitingNewAttemptLine(true), awaitingNewAttemptLine(false)]) {
      expect(line).not.toMatch(/En camino|Llega/);
    }
  });

  it("covers everything isRescheduledOrder covered", () => {
    const cases = [
      [parcel("delivery_failed", 0)],
      [parcel("delivery_failed", 0), parcel("delivery_failed", 0)],
      [parcel("delivered"), parcel("delivery_failed", 0)],
    ];
    for (const shipments of cases) {
      expect(isRescheduledOrder("shipped", shipments)).toBe(true);
      expect(orderAwaitingNewAttempt("shipped", shipments)).not.toBeNull();
    }
  });

  it("stays out of the way when something is on its way, being prepared, coming back, or over", () => {
    expect(orderAwaitingNewAttempt("shipped", [parcel("out_for_delivery", 1)])).toBeNull();
    expect(
      orderAwaitingNewAttempt("shipped", [parcel("out_for_delivery"), parcel("packed", 1)]),
    ).toBeNull();
    // A first trip not made yet: the promised date still holds.
    expect(orderAwaitingNewAttempt("processing", [parcel("packed")])).toBeNull();
    expect(
      orderAwaitingNewAttempt("partially_shipped", [parcel("packed"), parcel("delivered")]),
    ).toBeNull();
    // Every parcel coming back: orderComingBack speaks for it.
    expect(orderAwaitingNewAttempt("shipped", [parcel("returning", 1)])).toBeNull();
    expect(orderAwaitingNewAttempt("delivered", [parcel("delivered")])).toBeNull();
    expect(orderAwaitingNewAttempt("cancelled", [parcel("returned", 1)])).toBeNull();
    expect(waitsForNewAttempt("packed", 0)).toBe(false);
    expect(waitsForNewAttempt("out_for_delivery", 1)).toBe(false);
  });
});
