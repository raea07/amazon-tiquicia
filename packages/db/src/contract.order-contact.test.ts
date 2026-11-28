/**
 * The delivery phone only on request (owner decision D55; migration
 * 20261121085000_wave8_followups.sql, point 6), against a seeded database,
 * called the way the API calls it: get_order answers staff without the
 * recipient's phone and the order's shopper with it, in the shape of
 * schemas.ts; ops_order_contact answers in the shape of areas/order-contact.ts
 * for the administrator and is refused to the shopper, to finance and to a
 * look without a reason. The console of 12ec48c reading the same order is in
 * contract.wave9-integration.test.ts.
 *
 * What it leaves: one "VIEW_CONTACT" row on the audit trail per run, for a
 * demo order, and a throwaway finance member of this run. The seed's own
 * rows are only read, so it passes on a used database and twice in a row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 30_000 });

const db = contractDatabase();
const ADMIN = "central@yuntera.example";
const SHOPPER = "comprador@yuntera.example";
const FINANCE = `pedido-finanzas-${Date.now()}@yuntera.example`;

describe.skipIf(!db.enabled)("the delivery phone on request (against a seeded database)", () => {
  let orderNumber = "";
  let orderId = "";
  let phone = "";

  beforeAll(async () => {
    // A finance member of this run, made before connect() so it can act.
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      await pool.query(
        `with u as (
           insert into auth.users (id, email, raw_user_meta_data)
           values (gen_random_uuid(), $1, '{"full_name": "Prueba Contrato Finanzas"}') returning id)
         insert into public.staff_members (user_id, role) select id, 'finance' from u`,
        [FINANCE],
      );
    } finally {
      await pool.end();
    }
    await db.connect();
    const { rows } = await db.query<{ order_number: string; id: string; ship_phone: string }>(
      `select o.order_number, o.id::text, o.ship_phone from public.orders o
         join auth.users u on u.id = o.user_id
        where u.email = $1 and o.ship_phone <> '' order by o.placed_at desc limit 1`,
      [SHOPPER],
    );
    orderNumber = rows[0]?.order_number ?? "";
    orderId = rows[0]?.id ?? "";
    phone = rows[0]?.ship_phone ?? "";
  });

  afterAll(() => db.close());

  it("finds a demo order with a phone", () => {
    expect(orderNumber).toMatch(/^YT-\d+$/);
    expect(phone).toMatch(/^\+506\d{8}$/);
  });

  it("get_order: the shopper reads the phone, staff read an empty string", async () => {
    const own = await db.as(SHOPPER).getOrder(orderNumber);
    expect(own.address.phone).toBe(phone);
    const staff = await db.as(ADMIN).getOrder(orderNumber);
    expect(staff.address.phone).toBe("");
    expect(staff.address.recipient_name).toBe(own.address.recipient_name);
    expect(JSON.stringify(staff)).not.toContain(phone.slice(4));
  });

  it("ops_order_contact: the administrator's look answers the phone and is on the trail", async () => {
    const admin = db.as(ADMIN);
    const look = await admin.opsOrderContact(
      orderNumber,
      "Prueba de contrato: llamar por la entrega de hoy.",
    );
    expect(look).toEqual({ order_number: orderNumber, phone });
    const trail = await admin.auditEntries("orders", 5);
    expect(trail[0]).toMatchObject({
      action: "VIEW_CONTACT",
      table_name: "orders",
      row_key: orderId,
      new_row: {
        order_number: orderNumber,
        reason: "Prueba de contrato: llamar por la entrega de hoy.",
      },
    });
    expect(JSON.stringify(trail[0])).not.toContain(phone.slice(4));
  });

  it("is refused without a reason, to the shopper and to finance", async () => {
    await expect(db.as(ADMIN).opsOrderContact(orderNumber, "corto")).rejects.toMatchObject({
      code: "reason_required",
    });
    // White space of any kind is not a reason (the database trims it as the apps do).
    await expect(db.as(ADMIN).opsOrderContact(orderNumber, "\n".repeat(11))).rejects.toMatchObject({
      code: "reason_required",
    });
    await expect(
      db.as(ADMIN).opsOrderContact("YT-999999999", "Prueba de contrato: un pedido que no existe."),
    ).rejects.toMatchObject({ code: "order_not_found" });
    await expect(
      db.as(SHOPPER).opsOrderContact(orderNumber, "Prueba de contrato: soy el cliente."),
    ).rejects.toMatchObject({ code: "forbidden" });
    // A visitor is stopped by the grant before the function runs.
    await expect(
      db.as().opsOrderContact(orderNumber, "Prueba de contrato: un visitante."),
    ).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(
      db.as(FINANCE).opsOrderContact(orderNumber, "Prueba de contrato: finanzas no llama."),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Finance still opens the order, without the phone.
    expect((await db.as(FINANCE).getOrder(orderNumber)).address.phone).toBe("");
  });
});
