/**
 * The support desk's lock order (20261121084700_support_cases.sql), from real
 * sessions: one forced round each of tools/races family J's J1 and J5.
 *
 *   J1  ops_answer_case against ops_resolve_complaint on one complaint. Both
 *       take the complaint's row before the case's row (the answer since the
 *       support desk's review; the resolution through the trigger behind it).
 *   J5  the shopper deleting their account against an answer to their
 *       recorded contact. Both take the account's row first (the answer as
 *       key share, because the message it plans points at that account).
 *
 * A third session holds the case row FOR SHARE; the first writer takes what
 * comes before it and waits there; the second starts 40 ms later, then the
 * holder lets go. With one lock order that is a queue; with two it is a
 * deadlock (40P01) every round. Afterwards the complaint and its case agree,
 * and a deleted account's answer is erased or was refused.
 *
 * What it leaves: nothing of J1 (its complaint and case are deleted); for J5
 * a deleted account of its own and that account's closed contact.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractDatabase } from "./contract.helpers";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const STAFF = "central@yuntera.example";

describe.skipIf(!db.enabled)("support desk lock order (against a seeded database)", () => {
  let pool: pg.Pool;
  const complaints: string[] = [];

  async function session(userId: string | null) {
    const client = await pool.connect();
    await client.query("begin");
    await client.query("set local statement_timeout = '20s'");
    if (userId) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated", aal: "aal2" }),
      ]);
      await client.query("set local role authenticated");
    }
    return client;
  }

  /** Runs two calls with the case row held, the second 40 ms after the first. */
  async function forced(
    caseId: string,
    first: [string, string, unknown[]],
    second: [string, string, unknown[]],
  ) {
    const holder = await session(null);
    await holder.query("select 1 from private.cases where id = $1 for share", [caseId]);
    const run = async ([user, sql, args]: [string, string, unknown[]], delay: number) => {
      const client = await session(user);
      try {
        await new Promise((resolve) => setTimeout(resolve, delay));
        await client.query(sql, args);
        await client.query("commit");
        return "ok";
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        const e = error as { code?: string; message?: string };
        return e.code === "40P01" ? "DEADLOCK" : (e.message ?? "error");
      } finally {
        client.release();
      }
    };
    const outcomes = Promise.all([run(first, 0), run(second, 40)]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await holder.query("rollback");
    holder.release();
    return outcomes;
  }

  const staffId = async () =>
    (await db.query<{ id: string }>("select id from auth.users where email = $1", [STAFF])).rows[0]
      ?.id ?? "";

  beforeAll(async () => {
    await db.connect();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  });

  afterAll(async () => {
    for (const id of complaints)
      await db.query("delete from public.complaints where id = $1", [id]);
    await pool?.end();
    await db.close();
  });

  it("J1: an answer in Casos and one in Atención on one complaint queue, never deadlock", async () => {
    const staff = await staffId();
    const complaint =
      (
        await db.query<{ id: string }>(
          `insert into public.complaints (user_id, category, description)
           select id, 'other', 'Queja de la prueba de carreras del escritorio.'
             from auth.users where email = 'comprador3@yuntera.example' returning id`,
        )
      ).rows[0]?.id ?? "";
    // The trigger opened its case in the same statement.
    const kase =
      (
        await db.query<{ id: string }>("select id from private.cases where complaint_id = $1", [
          complaint,
        ])
      ).rows[0]?.id ?? "";
    complaints.push(complaint);
    const outcomes = await forced(
      kase,
      [
        staff,
        "select public.ops_answer_case($1, $2, false)",
        [kase, "Respuesta desde Casos de la prueba."],
      ],
      [
        staff,
        "select public.ops_resolve_complaint($1, $2, true)",
        [complaint, "Respuesta desde Atención de la prueba."],
      ],
    );
    expect(outcomes).toEqual(["ok", "ok"]);
    const after = await db.query<{
      case_status: string;
      complaint_status: string;
      answers: number;
    }>(
      `select k.status as case_status, x.status as complaint_status,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'answer') as answers
         from private.cases k join public.complaints x on x.id = k.complaint_id where k.id = $1`,
      [kase],
    );
    expect(after.rows[0]).toEqual({
      case_status: "closed",
      complaint_status: "resolved",
      answers: 2,
    });
  });

  it("J5: deleting an account and answering its contact queue, and nothing is left unerased", async () => {
    const staff = await staffId();
    const email = `carreras-escritorio-${Date.now().toString(36)}@yuntera.example`;
    const user =
      (
        await db.query<{ id: string }>(
          `insert into auth.users (id, email, raw_user_meta_data)
           values (gen_random_uuid(), $1, '{"full_name": "Prueba Carreras Escritorio"}') returning id`,
          [email],
        )
      ).rows[0]?.id ?? "";
    const old = await db.query<{ id: string }>(
      `insert into public.complaints (user_id, category, description, status, resolution, resolved_at)
       values ($1, 'other', 'Queja vieja de la prueba.', 'resolved', 'Ya le respondimos.', now()) returning id`,
      [user],
    );
    complaints.push(old.rows[0]?.id ?? "");
    const client = await session(staff);
    const kase = (
      await client.query<{ id: string }>(
        "select public.ops_record_contact('phone', 'other', 'Pregunta de la prueba de carreras.', null, $1) as id",
        [user],
      )
    ).rows[0]?.id as string;
    await client.query("commit");
    client.release();

    const outcomes = await forced(
      kase,
      [
        staff,
        "select public.ops_answer_case($1, $2, false)",
        [kase, "Respuesta de la prueba de carreras."],
      ],
      [user, "select public.delete_my_account()", []],
    );
    expect(outcomes[1]).toBe("ok");
    expect(["ok", "case_account_deleted", "case_closed"]).toContain(outcomes[0]);
    const after = await db.query<{ status: string; kept: number }>(
      `select k.status, (select count(*)::int from private.case_entries e where e.case_id = k.id
                           and e.kind in ('note', 'answer') and e.body is distinct from private.erased_case_text()) as kept
         from private.cases k where k.id = $1`,
      [kase],
    );
    expect(after.rows[0]).toEqual({ status: "closed", kept: 0 });
  });
});
