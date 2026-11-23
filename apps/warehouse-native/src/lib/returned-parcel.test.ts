// Runs with Node's own test runner (`pnpm test` here).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refundedText, returnedParcelBadge, returnedParcelDetails } from "./returned-parcel";

const parcel = { units: 2, lines: 1, order_number: "YT-101282", attempt_count: 0 };
const price = (minor: number) => `₡${minor / 100}`;

describe("a parcel waiting to be received back", () => {
  it("says a stopped parcel never left the building", () => {
    const stopped = { ...parcel, never_left: true };
    assert.equal(returnedParcelBadge(stopped), "Nunca salió de la bodega");
    assert.match(
      returnedParcelDetails(stopped),
      /Central lo detuvo antes de que saliera: recíbalo y guarde las unidades en la zona de devoluciones/,
    );
  });

  it("says a parcel taken off a route had no attempt, never 0 attempts", () => {
    assert.equal(returnedParcelBadge(parcel), "De vuelta");
    const text = returnedParcelDetails(parcel);
    assert.match(text, /sin intento de entrega/);
    assert.doesNotMatch(text, /0 intentos/);
  });

  it("counts real attempts at the door", () => {
    assert.match(returnedParcelDetails({ ...parcel, attempt_count: 1 }), /1 intento de entrega$/);
    assert.match(returnedParcelDetails({ ...parcel, attempt_count: 2 }), /2 intentos de entrega$/);
  });

  it("says what the shopper gets back, the delivery fee included when it comes back", () => {
    assert.equal(refundedText(0, 0, price), "");
    assert.equal(refundedText(495000, 0, price), " Al cliente se le devuelven ₡4950.");
    assert.equal(
      refundedText(495000, 150000, price),
      " Al cliente se le devuelven ₡6450, el envío incluido.",
    );
  });
});
