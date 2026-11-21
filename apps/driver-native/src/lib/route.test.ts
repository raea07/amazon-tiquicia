import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DriverDay, DriverStop } from "@yuntera/db";
import {
  attemptsNotice,
  checkDelivery,
  countCash,
  needsTracking,
  nextStop,
  refusalMessage,
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
    assert.equal(message, "Demasiados intentos. No entregue el paquete y llame a Central.");
    assert.equal(message, refusalMessage({ error: "pin_locked" }));
    assert.equal(attemptsNotice(0), "Código bloqueado por demasiados intentos. Llame a Central.");
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

  it("needs position sharing only while a started route has a stop to visit", () => {
    assert.equal(needsTracking(withQueued(day([stop(1)]), [])), true);
    assert.equal(needsTracking(withQueued(day([stop(1)], "assigned"), [])), false);
    assert.equal(
      needsTracking(withQueued(day([stop(1)]), [{ kind: "fail", stopId: "s1", reason: "other" }])),
      false,
    );
  });
});
