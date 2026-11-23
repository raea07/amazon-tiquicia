import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlacedDriverDay as DriverDay, PlacedDriverStop as DriverStop } from "@yuntera/db";
import {
  attemptsNotice,
  checkDelivery,
  countCash,
  keptOnPhone,
  needsTracking,
  nextStop,
  progressLine,
  refusalMessage,
  removedBeforeStart,
  skippedStopNote,
  summarise,
  withQueued,
} from "./route";

const stop = (n: number, extra: Partial<DriverStop> = {}): DriverStop =>
  ({
    stop_id: `s${n}`,
    sequence: n,
    status: "pending",
    recipient_name: `Persona ${n}`,
    failure_reason: null,
    ...extra,
  }) as DriverStop;

const day = (stops: DriverStop[], status = "in_progress"): DriverDay =>
  ({
    driver: {
      id: "d",
      full_name: "Carlos",
      status: "active",
      vehicle_type: "motorcycle",
      plate: null,
    },
    routes: [{ route_id: "r1", code: "R-1", status, stops }],
  }) as unknown as DriverDay;

describe("counting cash at the door", () => {
  it("counts the change, and records the amount due as collected", () => {
    const count = countCash(2_340_000, "25000");
    assert.equal(count.state, "ok");
    if (count.state !== "ok") return;
    assert.equal(count.collectedMinor, 2_340_000);
    assert.equal(count.changeMinor, 160_000);
    // formatPrice separates thousands with a narrow no-break space.
    assert.equal(count.message.replace(/\s/g, " "), "Dé ₡1 600 de vuelto.");
    assert.equal(count.confirm, false);
  });

  it("reads the usual ways of typing an exact amount", () => {
    for (const typed of ["23400", "23.400", "23,400", "₡23 400"]) {
      assert.equal(countCash(2_340_000, typed).state, "ok", typed);
    }
    const exact = countCash(2_340_000, "23400");
    assert.equal(exact.state === "ok" && exact.message, "Monto exacto: no hay vuelto.");
  });

  it("refuses less than is due", () => {
    const count = countCash(2_340_000, "20000");
    assert.equal(count.state, "short");
    assert.match(count.state === "short" ? count.message : "", /^Faltan ₡3\s400\./);
  });

  it("takes whole colones only: no change to the céntimo", () => {
    const count = countCash(2_340_000, "23400,50");
    assert.deepEqual(count, {
      state: "invalid",
      message: "Escriba el monto en colones, sin céntimos.",
    });
    assert.equal(
      checkDelivery({ pin: "1234", recipientName: "María", cash: count }),
      "Escriba el monto en colones, sin céntimos.",
    );
  });

  it("asks to confirm an amount that would need a lot of change (a 0 too many)", () => {
    const count = countCash(2_340_000, "1000000");
    assert.equal(count.state, "ok");
    assert.equal(count.state === "ok" && count.confirm, true);
    assert.match(count.state === "ok" ? count.message : "", /Es mucho vuelto/);
    assert.equal(
      checkDelivery({ pin: "1234", recipientName: "María", cash: count }),
      "Confirme el monto que recibió antes de entregar.",
    );
    assert.equal(
      checkDelivery({ pin: "1234", recipientName: "María", cash: count, cashConfirmed: true }),
      null,
    );
    // ₡20 000 of change is still ordinary.
    const ordinary = countCash(2_340_000, "43400");
    assert.equal(ordinary.state === "ok" && ordinary.confirm, false);
  });
});

describe("the checks before a delivery goes to the server", () => {
  it("uses the web's words", () => {
    assert.equal(
      checkDelivery({ pin: "12", recipientName: "María", cash: null }),
      "Pídale al cliente su código de 4 dígitos.",
    );
    assert.equal(
      checkDelivery({ pin: "1234", recipientName: "Ma", cash: null }),
      "Escriba el nombre de quien recibe.",
    );
    assert.equal(
      checkDelivery({ pin: "1234", recipientName: "María", cash: countCash(100, "") }),
      "Escriba cuánto efectivo recibió.",
    );
    assert.equal(checkDelivery({ pin: "1234", recipientName: "María", cash: null }), null);
  });
});

describe("a wrong code", () => {
  it("says how many attempts are left", () => {
    assert.equal(
      refusalMessage({ error: "wrong_pin", attempts_left: 4 }),
      "Ese código no es. Quedan 4 intentos. Pídale al cliente que lo lea de su pedido.",
    );
    assert.match(refusalMessage({ error: "wrong_pin", attempts_left: 1 }), /Queda 1 intento\./);
  });

  it("after the last attempt says the same as the lock, never 'Quedan 0 intentos'", () => {
    const message = refusalMessage({ error: "wrong_pin", attempts_left: 0 });
    assert.equal(message, refusalMessage({ error: "pin_locked" }));
    assert.equal(attemptsNotice(0), message);
  });

  it("says a locked order waits for Central and a new code, and what to do otherwise", () => {
    const message = refusalMessage({ error: "pin_locked", attempts_left: 0 });
    assert.match(message, /bloqueado/);
    assert.match(message, /No entregue el paquete/);
    assert.match(message, /Llame a Central/);
    assert.match(message, /código nuevo/);
    assert.match(message, /márquelo como no entregado/);
  });

  it("counts the attempts per order, in proper Spanish", () => {
    assert.equal(attemptsNotice(3), null);
    assert.equal(attemptsNotice(2), "Le quedan 2 intentos de código para este pedido.");
    assert.equal(attemptsNotice(1), "Le queda 1 intento de código para este pedido.");
  });
});

describe("the day as the driver sees it", () => {
  it("shows queued actions as taken, without undoing what the server already closed", () => {
    const routes = withQueued(day([stop(1), stop(2), stop(3, { status: "delivered" })]), [
      { kind: "arrive", stopId: "s1" },
      { kind: "fail", stopId: "s2", reason: "nobody_home" },
      { kind: "fail", stopId: "s3", reason: "refused" },
    ]);
    const [one, two, three] = routes[0]?.stops ?? [];
    assert.deepEqual([one?.status, one?.unsent], ["arrived", true]);
    assert.deepEqual(
      [two?.status, two?.failure_reason, two?.unsent],
      ["failed", "nobody_home", true],
    );
    assert.deepEqual([three?.status, three?.unsent], ["delivered", false]);
  });

  it("takes the next open stop, skipping those left for later unless nothing else is open", () => {
    const [route] = withQueued(day([stop(1, { status: "delivered" }), stop(2), stop(3)]), []);
    assert.ok(route);
    assert.equal(nextStop(route)?.stop_id, "s2");
    assert.equal(nextStop(route, new Set(["s2"]))?.stop_id, "s3");
    assert.equal(nextStop(route, new Set(["s2", "s3"]))?.stop_id, "s2");
  });

  it("leaves stops staff removed out of the total and says how many there were", () => {
    const [route] = withQueued(
      day([stop(1, { status: "delivered" }), stop(2, { status: "skipped" }), stop(3)]),
      [],
    );
    assert.ok(route);
    const summary = summarise(route);
    assert.deepEqual([summary.delivered, summary.total, summary.skipped], [1, 2, 1]);
    assert.equal(progressLine(summary), "1 de 2 entregadas · 1 omitida");
    assert.equal(
      progressLine({ delivered: 0, total: 1, skipped: 2 }),
      "0 de 1 entregadas · 2 omitidas",
    );
    assert.equal(progressLine({ delivered: 2, total: 3, skipped: 0 }), "2 de 3 entregadas");
  });

  it("does not send the driver to collect the parcel of a stop staff removed", () => {
    const [route] = withQueued(
      day(
        [
          stop(1, { package_count: 2 }),
          stop(2, { status: "skipped", package_count: 3 }),
          stop(3, { package_count: 1 }),
        ],
        "assigned",
      ),
      [],
    );
    assert.ok(route);
    assert.equal(summarise(route).packages, 3);
    const removed = { status: "skipped" as const, completed_at: "2026-11-23T15:00:00.000+00:00" };
    assert.match(
      skippedStopNote({ status: "assigned", started_at: null }, removed),
      /No recoja este paquete: volvió a Despacho\./,
    );
    assert.match(
      skippedStopNote({ status: "in_progress", started_at: "2026-11-23T14:00:00+00:00" }, removed),
      /Si lleva el paquete, devuélvalo a la bodega\./,
    );
  });

  it("keeps saying not to collect a parcel removed before the start, once the route starts", () => {
    const started = { status: "in_progress" as const, started_at: "2026-11-23T14:00:00+00:00" };
    const before = { status: "skipped" as const, completed_at: "2026-11-23T13:59:59.5+00:00" };
    const after = { status: "skipped" as const, completed_at: "2026-11-23T14:30:00+00:00" };
    assert.equal(removedBeforeStart(started, before), true);
    assert.equal(removedBeforeStart(started, after), false);
    assert.match(skippedStopNote(started, before), /No recoja este paquete/);
    assert.match(skippedStopNote(started, after), /devuélvalo a la bodega/);
    // A stop still on the route was not removed at all.
    assert.equal(
      removedBeforeStart(
        { status: "assigned", started_at: null },
        {
          status: "pending",
          completed_at: null,
        },
      ),
      false,
    );
  });

  it("needs position sharing only while a started route has a stop to visit", () => {
    assert.equal(needsTracking(withQueued(day([stop(1)]), [])), true);
    assert.equal(needsTracking(withQueued(day([stop(1)], "assigned"), [])), false);
    assert.equal(
      needsTracking(withQueued(day([stop(1)]), [{ kind: "fail", stopId: "s1", reason: "other" }])),
      false,
    );
  });
});

describe("what is kept on the phone for a dead zone", () => {
  it("keeps the routes still to drive, and no phone number for a stop already closed", () => {
    const today = {
      ...day([
        stop(1, { status: "delivered", phone: "+50688880001" }),
        stop(2, { status: "failed", phone: "+50688880002" }),
        stop(3, { status: "arrived", phone: "+50688880003" }),
        stop(4, { phone: "+50688880004" }),
      ]),
    } as DriverDay;
    const finished = {
      ...today.routes[0],
      route_id: "r0",
      code: "R-0",
      status: "completed",
      stops: [stop(9, { status: "delivered", phone: "+50688880009" })],
    };
    const cancelled = { ...finished, route_id: "r00", code: "R-00", status: "cancelled" };
    const assigned = { ...today.routes[0], route_id: "r2", code: "R-2", status: "assigned" };
    const kept = keptOnPhone({
      ...today,
      routes: [finished, cancelled, ...today.routes, assigned],
    } as DriverDay);

    assert.deepEqual(
      kept.routes.map((route) => route.code),
      ["R-1", "R-2"],
    );
    assert.deepEqual(
      kept.routes[0]?.stops.map((s) => s.phone),
      ["", "", "+50688880003", "+50688880004"],
    );
    assert.ok(!JSON.stringify(kept).includes("+50688880009"));
    // The driver's own details stay, so the app still opens without signal.
    assert.equal(kept.driver.full_name, "Carlos");
  });
});
