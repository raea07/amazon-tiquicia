/**
 * Contract tests for the account-security functions: real responses, as each
 * role, against the client's schemas. Deletion itself is exercised by
 * supabase/tests/095_account_security.sql (it would change the seed here); the
 * check that precedes it is covered.
 */

import { randomUUID } from "node:crypto";
import { callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();

describe.skipIf(!db.enabled)("account security (against a seeded database)", () => {
  beforeAll(db.connect);
  afterAll(db.close);

  it("tells a session its level and whether a second factor is required", async () => {
    const shopper = await db.as("comprador@yuntera.example").mySecurity();
    expect(shopper).toEqual({
      aal: "aal1",
      is_staff: false,
      mfa_required: false,
      staff_session_ok: true,
    });
    const staff = await db.as("central@yuntera.example", "aal2").mySecurity();
    expect(staff.is_staff).toBe(true);
    expect(staff.aal).toBe("aal2");
  });

  it("reports the wrong-code limit", async () => {
    const status = await db.as("comprador3@yuntera.example").mfaAttemptStatus();
    expect(status.locked).toBe(false);
    expect(status.attempts_left).toBeGreaterThan(0);
  });

  it("counts an attempt before the code is sent, and gives back a right one", async () => {
    const api = db.as("comprador3@yuntera.example");
    const before = await api.mfaAttemptStatus();
    const attempt = await api.mfaReserveAttempt();
    expect(attempt.attempt_id).not.toBeNull();
    expect(attempt.attempts_left).toBe(before.attempts_left - 1);
    await api.mfaAttemptSucceeded(attempt.attempt_id ?? 0);
    expect((await api.mfaAttemptStatus()).attempts_left).toBe(before.attempts_left);
  });

  it("lists staff and their factors for an administrator only", async () => {
    const rows = await db.as("central@yuntera.example").opsStaffSecurity();
    expect(rows.some((row) => row.is_self && row.role === "admin")).toBe(true);
    await expect(db.as("comprador@yuntera.example").opsStaffSecurity()).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses a factor reset on oneself with its own reason", async () => {
    const [admin] = (
      await db.query<{ id: string }>(
        "select id from auth.users where email = 'central@yuntera.example'",
      )
    ).rows;
    const error = await db
      .as("central@yuntera.example")
      .opsResetStaffFactor(admin?.id ?? "")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("cannot_reset_own_factor");
  });

  it("explains what stands in the way of deleting an account", async () => {
    const shopper = await db.as("comprador@yuntera.example").accountDeletionCheck();
    expect(shopper.blockers).toContain("account_has_open_orders");
    expect(shopper.orders_kept).toBeGreaterThan(0);
    const seller = await db.as("vendedor@yuntera.example").accountDeletionCheck();
    expect(seller.blockers).toContain("account_runs_open_shop");
    expect(seller.blockers).toContain("account_shop_has_stock");
    const staff = await db.as("central@yuntera.example").accountDeletionCheck();
    expect(staff.blockers[0]).toBe("account_is_staff");
  });
});

/**
 * The Data API's pre-request check (public.check_request), through the same
 * call path the local API uses: a throwaway account with a real session row,
 * so the session claim, its end and the account's deletion can be seen.
 */
describe.skipIf(!db.enabled)("requests from ended sessions and deleted accounts", () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  });
  afterAll(() => pool.end());

  async function throwaway() {
    const id = randomUUID();
    const session = randomUUID();
    await pool.query(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change,
          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
               $2, '', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', '')`,
      [id, `contrato-${id}@example.com`],
    );
    await pool.query(
      "insert into auth.sessions (id, user_id, created_at, updated_at, aal) values ($1, $2, now(), now(), 'aal1')",
      [session, id],
    );
    return {
      id,
      session,
      claims: { sub: id, role: "authenticated" as const, aal: "aal1", session_id: session },
    };
  }

  const address = {
    p_recipient_name: "Persona de Prueba",
    p_phone: "+50688887777",
    p_postal_code: "10101",
    p_senas: "Casa azul frente al parque",
    p_lat: 9.93,
    p_lng: -84.08,
  };

  it("refuses a token whose session was ended, at once", async () => {
    const person = await throwaway();
    expect((await callRpc(pool, "my_orders", {}, person.claims)).ok).toBe(true);
    await pool.query("delete from auth.sessions where id = $1", [person.session]);
    const after = await callRpc(pool, "my_orders", {}, person.claims);
    expect(after.ok).toBe(false);
    expect(!after.ok && after.error.message).toBe("session_ended");
  });

  it("refuses every write from a token of a deleted account", async () => {
    const person = await throwaway();
    expect((await callRpc(pool, "delete_my_account", {}, person.claims)).ok).toBe(true);
    // The same token, as another device would still hold it for up to an hour.
    const stale = { ...person.claims, session_id: undefined };
    const saved = await callRpc(pool, "save_address", address, stale);
    expect(!saved.ok && saved.error.message).toBe("session_ended");
    const consent = await callRpc(
      pool,
      "record_consent",
      { p_purpose: "marketing", p_policy_version: "2026-11" },
      stale,
    );
    expect(!consent.ok && consent.error.message).toBe("session_ended");
  });

  it("does not let a request and the deletion of the same account overlap", async () => {
    const person = await throwaway();
    const claims = JSON.stringify(person.claims);
    const deleter = await pool.connect();
    const writer = await pool.connect();
    const as = async (client: pg.PoolClient, path: string) => {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await client.query("select set_config('request.path', $1, true)", [path]);
      await client.query("select public.check_request()");
    };
    try {
      // The deletion runs first and holds the account until it commits; a
      // write that arrives meanwhile waits, then finds the account gone.
      await as(deleter, "/rpc/delete_my_account");
      await deleter.query("select public.delete_my_account()");
      let settled = false;
      const write = as(writer, "/rpc/save_address").then(
        () => {
          settled = true;
          return "went through";
        },
        (error: Error) => {
          settled = true;
          return error.message;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await deleter.query("commit");
      expect(await write).toBe("session_ended");
    } finally {
      await writer.query("rollback").catch(() => undefined);
      await deleter.query("rollback").catch(() => undefined);
      writer.release();
      deleter.release();
    }
  });

  it("makes a deletion wait for a request of the same account already under way", async () => {
    const person = await throwaway();
    const claims = JSON.stringify(person.claims);
    const writer = await pool.connect();
    const deleter = await pool.connect();
    try {
      await writer.query("begin");
      await writer.query("set local role authenticated");
      await writer.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await writer.query("select set_config('request.path', '/rpc/save_address', true)");
      await writer.query("select public.check_request()");
      await deleter.query("begin");
      await deleter.query("set local role authenticated");
      await deleter.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      let deleted = false;
      const deletion = deleter.query("select public.delete_my_account()").then(() => {
        deleted = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(deleted).toBe(false);
      await writer.query("commit");
      await deletion;
      expect(deleted).toBe(true);
      await deleter.query("commit");
    } finally {
      await writer.query("rollback").catch(() => undefined);
      await deleter.query("rollback").catch(() => undefined);
      writer.release();
      deleter.release();
    }
  });
});
