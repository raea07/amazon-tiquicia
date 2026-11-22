/**
 * The message added with migration 083700 (staff-catalogue.ts): what a shop
 * reads when catalogue staff correct, take down or put back one of its
 * listings. templates.test.ts renders it on every channel with realistic and
 * hostile data; this checks what it in particular must say, and that the
 * planner sends it to the listing's shop on the channels the document names.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RenderedEmail, RenderedPush } from "../types.ts";
import type { Vars } from "./catalog.ts";
import { render } from "./render.ts";
import { percent } from "./staff-catalogue.ts";

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
const email = (vars: Vars) =>
  render({
    template: "seller_listing_staff_change",
    channel: "email",
    vars,
    name: "TecnoCasa",
    links,
    sender,
  }) as RenderedEmail;
const push = (vars: Vars) =>
  render({
    template: "seller_listing_staff_change",
    channel: "push",
    vars,
    name: "TecnoCasa",
    links,
    sender,
  }) as RenderedPush;

const base = { shop_name: "TecnoCasa", product_title: "Licuadora Volcán 600 W" };

describe("seller_listing_staff_change", () => {
  it("says what a correction changed, why, and what it costs", () => {
    const mail = email({
      ...base,
      kind: "corrected",
      note: "Es un utensilio de cocina.",
      from_category: "Cocina eléctrica",
      to_category: "Cocina y mesa",
      brand_changed: true,
      from_brand: "Volcán",
      to_brand: null,
      from_referral_bps: 1000,
      to_referral_bps: 1200,
      from_tax_bps: 1300,
      to_tax_bps: 100,
    });
    expect(mail.subject).toBe("Corregimos los datos de su producto: Licuadora Volcán 600 W");
    expect(mail.text).toContain("Cocina eléctrica → Cocina y mesa");
    expect(mail.text).toContain("Volcán → sin marca");
    expect(mail.text).toContain("Motivo: Es un utensilio de cocina.");
    expect(mail.text).toContain("pasa de 10 % a 12 %");
    expect(mail.text).toContain("pasa de 13 % a 1 %");
    expect(mail.text).toContain("sigue a la venta");
    expect(mail.text).toContain("https://vende.yuntera.cr/productos");
  });

  it("does not mention the commission or the IVA when they did not change", () => {
    const mail = email({
      ...base,
      kind: "corrected",
      note: "Marca según la caja.",
      brand_changed: true,
      to_brand: "Nimbo",
    });
    expect(mail.text).not.toMatch(/comisión|IVA/);
    expect(mail.text).toContain("sin marca → Nimbo");
    expect(mail.text).not.toContain("Categoría");
  });

  it("says a take-down plainly, with the reason and what to do", () => {
    const mail = email({ ...base, kind: "taken_down", note: "Las fotos muestran otra marca." });
    expect(mail.subject).toBe("Retiramos su producto de la tienda: Licuadora Volcán 600 W");
    expect(mail.text).toContain("Motivo: Las fotos muestran otra marca.");
    expect(mail.text).toContain("Los pedidos que ya se hicieron siguen su curso");
    expect(push({ ...base, kind: "taken_down" }).title).toBe("Producto retirado");
  });

  it("says when it is back", () => {
    const mail = email({ ...base, kind: "restored", note: "Envió fotos propias." });
    expect(mail.subject).toBe("Su producto volvió a la tienda: Licuadora Volcán 600 W");
    expect(mail.text).toContain("Nota del equipo: Envió fotos propias.");
  });

  it("never names who in the team did it", () => {
    const text = email({ ...base, kind: "taken_down", actor: "Gabriela Soto", note: "x" }).text;
    expect(text).not.toContain("Gabriela");
  });

  it("writes rates the Costa Rican way", () => {
    expect(percent(1200)).toBe("12 %");
    expect(percent(50)).toBe("0,5 %");
    expect(percent(1250)).toBe("12,5 %");
  });
});

describe("the planner", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const sql = readdirSync(`${root}supabase/migrations`)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(`${root}supabase/migrations/${file}`, "utf8"))
    .join("\n");
  const planner = sql.slice(
    sql.lastIndexOf("create or replace function private.notify_plan_event"),
  );

  it("sends it to the listing's shop by e-mail and push", () => {
    const branch = planner.slice(planner.indexOf("when 'product.staff_changed' then"));
    expect(branch.slice(0, 400)).toMatch(
      /private\.notify_shop\(v_id, 'seller_listing_staff_change', \(p ->> 'seller_id'\)::uuid,\s+array\['email', 'push'\]/,
    );
  });

  it("is routed to the notification worker", () => {
    expect(sql).toContain(
      "insert into private.outbox_routes (topic, consumer) values ('product.staff_changed', 'notify')",
    );
  });
});
