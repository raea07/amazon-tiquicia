/**
 * Support cases (20261121084700_support_cases.sql), against a seeded
 * database, called the way the API calls them: every function that returns
 * data answers in the shape of areas/support-cases.ts, as the person who may
 * call it, and is refused to one who may not.
 *
 * The store build of commit 3f251c3 calls none of these functions, and no
 * function it calls changed (file_complaint, get_order and my_orders are
 * untouched), so no frozen schema is needed here.
 *
 * What it leaves: a throwaway shopper of this run with one complaint (no
 * order) answered and closed, one recorded contact answered and closed, one
 * "Vio el contacto de un cliente" row on the audit trail, and a saved answer
 * created and deleted (three audit rows); and a throwaway support member of
 * this run with one recorded contact on the demo order and two refused
 * texts on the trail (a fresh member each run, so the lock-out after three
 * refusals in an hour never reaches the seed's staff). The seed's own rows
 * are only read, so it passes on a used database and twice in a row.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 30_000 });

const db = contractDatabase();
const STAFF = "central@yuntera.example";
const SELLER = "vendedor@yuntera.example";
const DEMO_SHOPPER = "comprador@yuntera.example";
const SHOPPER = `casos-${Date.now()}@yuntera.example`;
const GUARD_STAFF = `casos-soporte-${Date.now()}@yuntera.example`;

describe.skipIf(!db.enabled)("support cases contract (against a seeded database)", () => {
  let shopperId = "";
  let demoOrder = "";
  let complaintRef = "";
  let demoCode = "";

  beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const { rows } = await pool.query<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), $1, '{"full_name": "Prueba Contrato Casos"}') returning id::text`,
        [SHOPPER],
      );
      shopperId = rows[0]?.id ?? "";
      const order = await pool.query<{ order_number: string }>(
        `select o.order_number from public.orders o join auth.users u on u.id = o.user_id
         where u.email = $1 order by o.placed_at limit 1`,
        [DEMO_SHOPPER],
      );
      demoOrder = order.rows[0]?.order_number ?? "";
      const code = await pool.query<{ code: string }>(
        `select c.code from private.delivery_codes c join public.orders o on o.id = c.order_id
         where o.order_number = $1`,
        [demoOrder],
      );
      demoCode = code.rows[0]?.code ?? "";
      await pool.query(
        `with u as (
           insert into auth.users (id, email, raw_user_meta_data)
           values (gen_random_uuid(), $1, '{"full_name": "Sara Soporte Contrato"}') returning id)
         insert into public.staff_members (user_id, role) select id, 'support' from u`,
        [GUARD_STAFF],
      );
    } finally {
      await pool.end();
    }
    await db.connect();
    if (!shopperId || !demoOrder || !demoCode)
      throw new Error("database is not seeded — run pnpm db:local:reset");
  });
  afterAll(db.close);

  it("a complaint opens a case; its receipt and the shopper's cases parse", async () => {
    const shopper = db.as(SHOPPER);
    const complaintId = await shopper.fileComplaint({
      category: "other",
      description: "Prueba de contrato: no encuentro la factura de mi compra.",
    });
    const receipt = await shopper.myComplaintReceipt(complaintId);
    complaintRef = receipt.reference;
    expect(receipt.reference).toBe(complaintId.slice(0, 8).toUpperCase());
    expect(receipt.answer_by > receipt.acknowledge_by).toBe(true);
    const mine = await shopper.myCases();
    expect(mine.map((item) => item.reference)).toContain(receipt.reference);
    // Another shopper cannot read the receipt.
    await expect(db.as(DEMO_SHOPPER).myComplaintReceipt(complaintId)).rejects.toMatchObject({
      code: "complaint_not_found",
    });
  });

  it("staff read, note, assign, answer and close; the shopper reads the answer", async () => {
    const staff = db.as(STAFF);
    const page = await staff.opsCases("open", 200);
    expect(page.total).toBeGreaterThanOrEqual(page.cases.length);
    const row = page.cases.find((item) => item.reference === complaintRef);
    expect(row, "the run's complaint is in the list").toBeDefined();
    if (!row) return;

    const detail = await staff.opsCase(row.id);
    expect(detail.kind).toBe("complaint");
    expect(detail.request.text).toContain("Prueba de contrato");
    expect(detail.customer?.first_name).toBe("Prueba");
    expect(detail.can.answer).toBe(true);

    expect(
      typeof (await staff.opsAddCaseNote(row.id, "Nota del contrato: no la ve el cliente.")),
    ).toBe("number");
    expect((await staff.opsAssignCase(row.id)).assigned_to_me).toBe(true);
    const closed = await staff.opsAnswerCase(
      row.id,
      "Le enviamos la factura a su correo. Damos el reclamo por resuelto.",
      true,
    );
    expect(closed?.status).toBe("closed");
    expect((await staff.opsCase(row.id)).entries.map((entry) => entry.kind)).toEqual([
      "opened",
      "note",
      "assigned",
      "answer",
      "closed",
    ]);
    const reopened = await staff.opsReopenCase(row.id);
    expect(reopened.reopened_count).toBe(1);
    await staff.opsAnswerCase(row.id, "Le volvimos a enviar la factura, ahora en PDF.", true);

    const mine = await db.as(SHOPPER).myCases();
    const own = mine.find((item) => item.id === row.id);
    expect(own?.answers.map((answer) => answer.body)).toEqual([
      "Le enviamos la factura a su correo. Damos el reclamo por resuelto.",
      "Le volvimos a enviar la factura, ahora en PDF.",
    ]);
    expect(JSON.stringify(mine)).not.toContain("Nota del contrato");
  });

  it("a recorded contact, the order's cases, the Hoy line, targets and the report parse", async () => {
    const staff = db.as(STAFF);
    const caseId = await staff.opsRecordContact({
      channel: "whatsapp",
      topic: "payment",
      summary: "Preguntó por WhatsApp cómo pagar con SINPE Móvil.",
      userId: shopperId,
    });
    if (!caseId) throw new Error("the contact was refused");
    const detail = await staff.opsCase(caseId);
    expect(detail.kind).toBe("contact");
    expect(detail.channel).toBe("whatsapp");
    expect(detail.request.text).toContain("SINPE Móvil");
    await staff.opsAnswerCase(caseId, "Le explicamos los pasos para pagar con SINPE Móvil.", true);

    const order = await staff.opsOrderCases(demoOrder);
    expect(order.customer_id).toMatch(/^[0-9a-f-]{36}$/);
    const due = await staff.opsCasesDue();
    expect(due.open).toBeGreaterThanOrEqual(due.overdue);
    const targets = await staff.opsCaseTargets();
    expect(targets.find((t) => t.kind === "complaint" && t.topic === "*")).toMatchObject({
      first_response_amount: 1,
      first_response_unit: "working_days",
      resolution_amount: 5,
      resolution_unit: "working_days",
    });
    const today = new Date();
    const from = new Date(today.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const report = await staff.opsCaseReport(from, to);
    expect(report.total).toBeGreaterThanOrEqual(2);
    expect(report.reopened).toBeGreaterThanOrEqual(1);
    expect(report.first_response.answered).toBeGreaterThanOrEqual(2);
  });

  it("a text with the delivery code is refused as null; can.close follows Atención", async () => {
    const staff = db.as(GUARD_STAFF, "aal2");
    const caseId = await staff.opsRecordContact({
      channel: "phone",
      topic: "delivery_problem",
      summary: "Llamó porque el repartidor no encontró la casa.",
      orderNumber: demoOrder,
    });
    expect(caseId).toMatch(/^[0-9a-f-]{36}$/);
    if (!caseId) return;
    expect(
      await staff.opsRecordContact({
        channel: "phone",
        topic: "other",
        summary: `Dijo que su código es ${demoCode.split("").join(" ")}.`,
        orderNumber: demoOrder,
      }),
    ).toBeNull();
    expect(await staff.opsAddCaseNote(caseId, `El código es ${demoCode}.`)).toBeNull();
    expect(
      await staff.opsAnswerCase(caseId, "Le llamamos hoy por la tarde para coordinar.", false),
    ).toMatchObject({ status: "open" });
    const detail = await staff.opsCase(caseId);
    expect(detail.can.close).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(`es ${demoCode}`);
    await expect(
      staff.opsAddCaseNote(caseId, "1000 1001 1002 1003 1004 1005"),
    ).rejects.toMatchObject({ code: "too_many_numbers" });
  });

  it("the customer view and the contact reveal parse; contact details only when revealed", async () => {
    const staff = db.as(STAFF);
    const view = await staff.opsCustomer(shopperId);
    expect(view.first_name).toBe("Prueba");
    expect(view.cases.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(view)).not.toContain(SHOPPER);
    const contact = await staff.opsCustomerContact(
      shopperId,
      "Prueba de contrato: confirmar el correo del cliente.",
    );
    expect(contact.email).toBe(SHOPPER);
    const trail = await staff.auditEntries("customers", 5);
    expect(trail[0]).toMatchObject({ action: "VIEW_CONTACT", row_key: shopperId });
  });

  it("saved answers: support reads, the administrator writes", async () => {
    const staff = db.as(STAFF);
    const before = await staff.opsSavedReplies();
    expect(before.length).toBeGreaterThanOrEqual(5);
    const replyId = await staff.opsSaveReply(
      `Contrato ${Date.now()}`,
      "Texto de una respuesta guardada del contrato.",
    );
    expect((await staff.opsSavedReplies()).some((reply) => reply.id === replyId)).toBe(true);
    await staff.opsDeleteReply(replyId);
    expect((await staff.opsSavedReplies()).some((reply) => reply.id === replyId)).toBe(false);
  });

  it("refuses shoppers, sellers and visitors", async () => {
    for (const caller of [db.as(DEMO_SHOPPER), db.as(SELLER)]) {
      await expect(caller.opsCases()).rejects.toMatchObject({ code: "forbidden" });
      await expect(caller.opsCustomer(shopperId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(caller.opsSavedReplies()).rejects.toMatchObject({ code: "forbidden" });
    }
    // A visitor holds no grant on any of them.
    await expect(db.as().opsCases()).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(db.as().opsCustomer(shopperId)).rejects.toMatchObject({
      code: "not_authenticated",
    });
    await expect(db.as().myCases()).rejects.toMatchObject({ code: "not_authenticated" });
  });
});
