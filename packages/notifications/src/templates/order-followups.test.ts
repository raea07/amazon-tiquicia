/**
 * The cancellation message after migration 084200: when an order is
 * cancelled because its parcels came back, the event says what is really
 * refunded (`amount_minor`), which may leave the delivery fee charged (an
 * attempt was made at the door) or include it (nobody went). The message
 * states that amount, never the order's total when less comes back.
 */

import { describe, expect, it } from "vitest";
import { colones } from "../format.ts";
import type { RenderedEmail } from "../types.ts";
import type { Vars } from "./catalog.ts";
import { render } from "./render.ts";

const links = {
  shop: "https://www.yuntera.cr",
  seller: "https://vende.yuntera.cr",
  ops: "https://central.yuntera.cr",
  field: "https://ruta.yuntera.cr",
};
const sender = {
  legalName: "Yuntera S.A.",
  legalId: "cédula jurídica 3-101-000000",
  postalAddress: "San José, Costa Rica",
  replyTo: "ayuda@yuntera.cr",
};
const base: Vars = { order_number: "YT-101282", total_minor: 645000, paid: true };
const email = (vars: Vars) =>
  render({
    template: "order_cancelled",
    channel: "email",
    vars,
    name: "Ana",
    links,
    sender,
  }) as RenderedEmail;

describe("the cancellation message states what really comes back", () => {
  it("says the whole total for a cancellation before anything left", () => {
    const text = email(base).text;
    expect(text).toContain(`Le devolvemos ${colones(645000)}`);
    expect(text).not.toContain("costo de envío");
  });

  it("says the goods only when the delivery fee stays charged", () => {
    const text = email({ ...base, amount_minor: 495000 }).text;
    expect(text).toContain(`Le devolvemos ${colones(495000)}`);
    expect(text).not.toContain(colones(645000));
    expect(text).toContain("El costo de envío no se devuelve: intentamos entregarle el pedido.");
  });

  it("says the whole total when the fee comes back too", () => {
    const text = email({ ...base, amount_minor: 645000 }).text;
    expect(text).toContain(`Le devolvemos ${colones(645000)}`);
    expect(text).not.toContain("costo de envío");
  });

  it("says nothing was charged for an order never paid", () => {
    const text = email({ ...base, paid: false }).text;
    expect(text).toContain("No se le cobró nada.");
    expect(text).not.toContain("Le devolvemos");
  });
});
