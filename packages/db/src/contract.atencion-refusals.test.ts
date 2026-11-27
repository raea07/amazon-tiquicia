/**
 * Atención's doors keep a refusal (084700, section 10): a complaint's answer
 * that holds the customer's live delivery code answers null through the
 * client (the console then shows note_contains_code), the refusal is on the
 * audit trail, and the complaint is unchanged; a text too long for the
 * timeline is refused the same way with or without the code; an answer
 * without the code answers true and is kept.
 *
 * It acts as a support writer of its own (made here), so the refusal it
 * makes never locks a demo account out of writing when the suites run again.
 *
 * What it leaves: that writer, one complaint of comprador3 (answered, still
 * open; a second run answers the same one) and one refusal on the audit trail.
 */

import { type Claims, callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi, type RpcTransport } from "./api";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();
const SHOPPER = "comprador3@yuntera.example";

describe.skipIf(!db.enabled)("Atención keeps a refusal (against a seeded database)", () => {
  let pool: pg.Pool;
  const ids = new Map<string, string>();

  const as = (userId: string) => {
    const claims: Claims = { sub: userId, role: "authenticated", aal: "aal2" };
    const transport: RpcTransport = {
      rpc: async (fn, args = {}) => {
        const result = await callRpc(pool, fn, args, claims);
        return result.ok
          ? { data: result.data, error: null, status: 200 }
          : { data: null, error: result.error, status: result.status };
      },
    };
    return createApi(transport);
  };

  beforeAll(async () => {
    await db.connect();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const writer = (
      await db.query<{ id: string }>(
        `insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), $1, '{"full_name": "Soporte Prueba Atención"}') returning id`,
        [`soporte-atencion-${Date.now().toString(36)}@yuntera.example`],
      )
    ).rows[0]?.id as string;
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'support')", [
      writer,
    ]);
    ids.set("writer", writer);
    const shopper = (
      await db.query<{ id: string }>("select id from auth.users where email = $1", [SHOPPER])
    ).rows[0]?.id as string;
    ids.set("shopper", shopper);
  });

  afterAll(async () => {
    await pool?.end();
    await db.close();
  });

  it("a complaint's answer with the live code answers null and is kept on the trail", async () => {
    const live = (
      await db.query<{ order_number: string; code: string }>(
        `select o.order_number, c.code from public.orders o
           join private.delivery_codes c on c.order_id = o.id
          where o.user_id = $1 and o.status not in ('delivered', 'completed', 'cancelled', 'refunded')
          order by o.placed_at limit 1`,
        [ids.get("shopper")],
      )
    ).rows[0];
    expect(live, "comprador3 has an order still to be delivered").toBeDefined();
    if (!live) return;
    const complaintId = await as(ids.get("shopper") as string).fileComplaint({
      category: "delivery",
      description: "El repartidor no encontró la casa.",
      orderNumber: live.order_number,
    });
    const staff = as(ids.get("writer") as string);
    // The shop may hand back the order's complaint already open (a second run).
    const read = () =>
      db.query<{ status: string; resolution: string | null }>(
        "select status, resolution from public.complaints where id = $1",
        [complaintId],
      );
    const before = (await read()).rows[0];

    // Too long for the timeline: the same refusal, code or not, and nothing kept.
    for (const guess of [live.code, "0000"]) {
      const failure = await staff
        .opsResolveComplaint(complaintId as string, `Pruebe ${guess} ${"x".repeat(4000)}`, false)
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).code).toBe("text_too_long");
    }

    expect(
      await staff.opsResolveComplaint(
        complaintId as string,
        `Su código ${live.code} ya no sirve.`,
        false,
      ),
    ).toBeNull();
    const trail = await db.query<{ n: number }>(
      "select count(*)::int as n from private.audit_log where actor_id = $1 and action = 'REFUSED_CODE'",
      [ids.get("writer")],
    );
    expect(trail.rows[0]?.n).toBe(1);
    expect((await read()).rows[0], "the complaint is unchanged").toEqual(before);

    expect(
      await staff.opsResolveComplaint(
        complaintId as string,
        "Revisamos la ruta y le escribimos mañana.",
        false,
      ),
    ).toBe(true);
  });
});
