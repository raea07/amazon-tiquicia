/**
 * One refund message for one cancellation (20261121084600): when the goods
 * of the last parcel and the delivery fee are refunded together, the planner
 * sends one "refund started" and one "refund arrived", each with the total
 * (`amount_minor`) and the fee's part (`delivery_fee_minor`). The text names
 * the total and says the delivery fee is included; any other refund reads as
 * before.
 */

import { describe, expect, it } from "vitest";
import { colones } from "../format.ts";
import type { RenderedEmail, RenderedPush } from "../types.ts";
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
const email = (template: string, vars: Vars) =>
  render({ template, channel: "email", vars, name: "Ana", links, sender }) as RenderedEmail;
const push = (template: string, vars: Vars) =>
  render({ template, channel: "push", vars, name: "Ana", links, sender }) as RenderedPush;

// Subjects and push texts are cleaned to plain spaces; compare words, not space characters.
const words = (value: string) => value.replace(/\s+/gu, " ");

const order = { order_number: "YT-101300", total_minor: 540000, paid: true };
const together = { ...order, amount_minor: 540000, delivery_fee_minor: 150000 };

describe("a refund of the goods and the delivery fee together", () => {
  it("says once that it started, with the total and the fee included", () => {
    const text = email("refund_initiated", together).text;
    expect(text).toContain(
      `Iniciamos el reembolso de ${colones(540000)} del pedido YT-101300, el envío incluido, por el mismo medio con que pagó.`,
    );
    expect(text).not.toContain(colones(390000));
    expect(text).not.toContain(colones(150000));
  });

  it("says once that it arrived, with the same total", () => {
    const message = email("refund_completed", together);
    expect(words(message.subject)).toBe(
      words(`Le devolvimos ${colones(540000)} del pedido YT-101300`),
    );
    expect(message.text).toContain(
      `Hicimos el reembolso de ${colones(540000)} del pedido YT-101300, el envío incluido, por el mismo medio con que pagó.`,
    );
    expect(words(push("refund_completed", together).body)).toBe(
      words(`YT-101300: le devolvimos ${colones(540000)}.`),
    );
  });
});

describe("every other refund reads as before", () => {
  it("goods alone", () => {
    const text = email("refund_initiated", { ...order, amount_minor: 390000 }).text;
    expect(text).toContain(
      `Iniciamos el reembolso de ${colones(390000)} del pedido YT-101300, por el mismo medio con que pagó.`,
    );
    expect(text).not.toContain("envío incluido");
  });

  it("a delivery fee alone", () => {
    const text = email("refund_completed", { ...order, amount_minor: 150000 }).text;
    expect(text).toContain(
      `Hicimos el reembolso de ${colones(150000)} del pedido YT-101300, por el mismo medio con que pagó.`,
    );
    expect(text).not.toContain("envío incluido");
  });

  it("never says the fee is included when the amount is only the fee", () => {
    const text = email("refund_initiated", {
      ...order,
      amount_minor: 150000,
      delivery_fee_minor: 150000,
    }).text;
    expect(text).not.toContain("envío incluido");
  });
});
