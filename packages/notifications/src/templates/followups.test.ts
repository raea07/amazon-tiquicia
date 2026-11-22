/**
 * The messages added with migration 083200 (followups.ts), and the planner's
 * rules for them. templates.test.ts already renders every template on every
 * channel with realistic and hostile data; this file checks what these
 * messages in particular must and must not say, and who the planner sends
 * them to.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// What the database never hands a template, planted anyway.
const PLANTED: Vars = {
  delivery_pin: "4827",
  code: "4827",
  new_code: "5931",
  ship_senas: "Casa verde 200 m norte de la iglesia",
  email: "escrito-por-alguien@ejemplo.cr",
  account_number: "CR05015202001026284066",
  iban: "CR05015202001026284066",
  bank_reference: "BCR-998877",
  id_number: "3101123456",
};

const HOSTILE = `<script>alert("x")</script><img src=x onerror=alert(1)>`;

const email = (template: string, vars: Vars, name = "Ana") =>
  render({ template, channel: "email", vars, name, links, sender }) as RenderedEmail;
const push = (template: string, vars: Vars, name = "Ana") =>
  render({ template, channel: "push", vars, name, links, sender }) as RenderedPush;
const everything = (template: string, vars: Vars) => {
  const mail = email(template, vars);
  const note = push(template, vars);
  return `${mail.subject}\n${mail.html}\n${mail.text}\n${note.title}\n${note.body}\n${JSON.stringify(note.data)}`;
};

const order = { order_number: "YT-100123" };

describe("messages added with migration 083200", () => {
  for (const template of [
    "return_goods_received",
    "delivery_code_locked",
    "delivery_code_released",
    "seller_invitation",
    "seller_change_decided",
    "seller_payout_account_decided",
    "seller_payout_paid",
    "seller_offers_paused_fees",
  ]) {
    it(`${template} never carries a code, an address, an id number or payment details`, () => {
      const text = everything(template, { ...order, ...PLANTED, shop_name: "TecnoCasa" });
      for (const value of Object.values(PLANTED)) expect(text).not.toContain(String(value));
      expect(text).not.toMatch(/\b(tú|tu pedido|tu cuenta|tus|vos|puedes|tienes)\b/i);
    });
  }

  it("tells the shopper that a released order has a NEW code on the order page, never the code", () => {
    const mail = email("delivery_code_released", { ...order, ...PLANTED });
    expect(mail.text).toMatch(/código de entrega nuevo/);
    expect(mail.text).toContain("https://www.yuntera.cr/pedidos/YT-100123");
    expect(mail.text).toMatch(/anterior ya no sirve/);
    expect(mail.text).not.toMatch(/\b\d{4}\b(?!-)/u);
  });

  it("tells the shopper a locked code blocks the delivery and nobody will ask for the code", () => {
    const mail = email("delivery_code_locked", order);
    expect(mail.subject).toBe("Bloqueamos el código de entrega de su pedido YT-100123");
    expect(mail.text).toMatch(/nadie puede recibir el paquete/);
    expect(mail.text).toMatch(/Nadie de Yuntera le va a pedir el código/);
  });

  it("says how an approved return goes back: collected by a driver, at no cost", () => {
    const mail = email("return_approved", {
      ...order,
      return_ref: "1A2B3C4D",
      return_title: "Café",
    });
    expect(mail.text).toMatch(/lo recogemos nosotros/);
    expect(mail.text).toMatch(/repartidor/);
    expect(mail.text).not.toContain(PLANTED.ship_senas as string);
  });

  it("says the goods of a return are back and the refund is on its way", () => {
    const mail = email("return_goods_received", {
      ...order,
      return_ref: "1A2B3C4D",
      return_title: "Café molido",
    });
    expect(mail.subject).toBe("Recibimos el producto de su devolución 1A2B3C4D");
    expect(mail.text).toMatch(/reembolso va en camino/);
  });

  it("tells a seller a payout's amount and day, nothing about the account", () => {
    const mail = email("seller_payout_paid", {
      shop_name: "TecnoCasa",
      amount_minor: 1_250_050,
      paid_at: "2026-11-28T15:00:00Z",
      ...PLANTED,
    });
    expect(mail.subject).toMatch(/^Le pagamos ₡12\s500,50$/u);
    expect(mail.text).toContain(colones(1_250_050));
    expect(mail.text).toContain("28 de noviembre");
    expect(mail.text).not.toContain("CR05");
  });

  it("asks the seller to approve nothing they did not ask for", () => {
    const yes = email("seller_payout_account_decided", { shop_name: "TecnoCasa", approved: true });
    expect(yes.text).toMatch(/Si usted no pidió este cambio/);
    const no = email("seller_change_decided", {
      shop_name: "TecnoCasa",
      approved: false,
      change_kind: "shop_name",
      decision_note: "El nombre se parece al de otra tienda.",
    });
    expect(no.subject).toBe("No aprobamos el cambio que pidió para su tienda");
    expect(no.text).toContain("el nombre de su tienda");
    expect(no.text).toContain("El nombre se parece al de otra tienda.");
  });

  it("invites to a shop by its name and role, and says that nothing happens without an answer", () => {
    const mail = email("seller_invitation", {
      shop_name: "TecnoCasa",
      invitation_role: "admin",
      invitation_expires_at: "2026-12-05T18:00:00Z",
    });
    expect(mail.subject).toBe("TecnoCasa lo invita a su equipo en Yuntera");
    expect(mail.text).toContain("como administrador");
    expect(mail.text).toContain("https://vende.yuntera.cr/invitaciones");
    expect(mail.text).toMatch(/sin su respuesta nadie lo agrega/);
  });

  it("lists each paused offer with the lowest price that covers the fees, escaped", () => {
    const mail = email("seller_offers_paused_fees", {
      shop_name: "TecnoCasa",
      offer_count: 2,
      paused_offers: [
        { title: "Bombillo LED", variant: "", min_price_minor: 612_345 },
        { title: HOSTILE, variant: HOSTILE, min_price_minor: 455_000 },
      ],
    });
    expect(mail.subject).toBe("Pausamos 2 de sus ofertas por el cambio de comisiones");
    expect(mail.text).toContain(`precio mínimo ${colones(612_400)}`);
    expect(mail.text).toContain(`precio mínimo ${colones(455_000)}`);
    expect(mail.html).not.toContain("<script");
    expect(mail.html).toContain("&lt;script&gt;");
    const one = email("seller_offers_paused_fees", { shop_name: "TecnoCasa", offer_count: 1 });
    expect(one.subject).toBe("Pausamos una de sus ofertas por el cambio de comisiones");
  });

  it("speaks of one offer in the singular throughout", () => {
    const mail = email("seller_offers_paused_fees", {
      shop_name: "TecnoCasa",
      offer_count: 1,
      paused_count: 1,
      paused_offers: [{ title: "Bombillo LED", variant: "", min_price_minor: 612_345 }],
    });
    expect(mail.text).toContain("Por eso la pausamos; nadie la puede comprar");
    expect(mail.text).toContain("Para volver a venderla,");
    expect(mail.text).toContain("actívela");
    expect(mail.text).toContain("puede quedar en pausa");
    expect(mail.text).not.toMatch(/las pausamos|nadie las|venderlas|actívelas|pueden quedar/);
  });

  it("counts the shop's whole list, not what one re-check paused", () => {
    // Two passes of the re-check in one change: the event says 1, the
    // database's list (paused_count) says 3.
    const mail = email("seller_offers_paused_fees", {
      shop_name: "TecnoCasa",
      offer_count: 1,
      paused_count: 3,
      paused_offers: [
        { title: "A", variant: "", min_price_minor: 100_000 },
        { title: "B", variant: "", min_price_minor: 100_000 },
        { title: "C", variant: "", min_price_minor: 100_000 },
      ],
    });
    expect(mail.subject).toBe("Pausamos 3 de sus ofertas por el cambio de comisiones");
    expect(mail.text).toContain("Por eso las pausamos; nadie las puede comprar");
  });
});

describe("the planner's rules for these messages", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const sql = readdirSync(`${root}supabase/migrations`)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(`${root}supabase/migrations/${file}`, "utf8"))
    .join("\n");
  const start = sql.lastIndexOf("create or replace function private.notify_plan_event");
  const planner = sql.slice(start, sql.indexOf("$$;", start));
  const branch = (topic: string) => {
    const from = planner.indexOf(`when '${topic}' then`);
    const to = planner.indexOf("\n    when '", from + 1);
    return planner.slice(from, to < 0 ? undefined : to);
  };

  it("sends an invitation only to the invited account's confirmed address", () => {
    const code = branch("seller.member_invited");
    expect(code).toContain("email_confirmed_at is not null");
    expect(code).toContain("private.notify_person");
    // Never to an address typed by someone: no direct delivery to an e-mail.
    expect(code).not.toContain("notify_add");
    expect(code).not.toMatch(/'email'\s*\)/);
  });

  it("answers a withdrawal of the purchase with what happens next, a claim with a review", () => {
    const code = branch("return.requested");
    expect(code).toMatch(/kind = 'withdrawal' then 'return_approved' else 'return_received'/);
  });

  it("alerts the care team when a code locks, and tells the shopper both times", () => {
    expect(branch("delivery_code.locked")).toContain("'staff_delivery_code_locked', 'support'");
    expect(branch("delivery_code.locked")).toContain("'delivery_code_locked'");
    expect(branch("delivery_code.released")).toContain("'delivery_code_released'");
  });

  it("no longer announces a refund as completed when a payment is marked refunded", () => {
    expect(sql).toContain("drop trigger if exists payments_emit_refunded on public.payments");
    const last = sql.lastIndexOf("create or replace function private.emit_logistics_events");
    const body = sql.slice(last, sql.indexOf("$$;", last));
    expect(body).not.toContain("refund.completed");
  });
});
