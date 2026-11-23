import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { callRpc, statusFor } from "./rpc.ts";

// The hosted Data API answers a database error with its SQLSTATE in `code`
// and PostgREST's HTTP status. The apps tell a lock conflict (40P01, 40001)
// from any other failure by that code, so the stand-in must pass it through.

/** A pool whose one function call fails with the given database error. */
function poolFailingWith(error: { code: string; message: string }): Pool {
  const client = {
    query: async (text: string) => {
      if (text.includes("from pg_proc")) {
        return {
          rows: [
            {
              arg_names: ["p_id"],
              arg_types: ["uuid"],
              default_count: 0,
              returns_set: false,
              returns_void: false,
            },
          ],
        };
      }
      if (text.startsWith("select to_jsonb(")) throw Object.assign(new Error(error.message), error);
      return { rows: [] };
    },
    release: () => undefined,
  };
  return { connect: async () => client } as unknown as Pool;
}

describe("database errors through the stand-in", () => {
  it("passes a deadlock and a serialisation failure through with their SQLSTATE and 500", async () => {
    for (const code of ["40P01", "40001"]) {
      const result = await callRpc(
        poolFailingWith({ code, message: "deadlock detected" }),
        "wms_move_stock",
        { p_id: "00000000-0000-4000-8000-000000000001" },
        { sub: "00000000-0000-4000-8000-000000000002", role: "authenticated" },
      );
      expect(result).toEqual({
        ok: false,
        status: 500,
        error: { code, message: "deadlock detected", details: null, hint: null },
      });
    }
  });

  it("gives the HTTP status PostgREST gives", () => {
    expect(statusFor("P0001", false)).toBe(400);
    expect(statusFor("42501", true)).toBe(401);
    expect(statusFor("42501", false)).toBe(403);
    expect(statusFor("23505", false)).toBe(409);
    expect(statusFor("23503", false)).toBe(409);
    expect(statusFor("42883", false)).toBe(404);
    expect(statusFor("40P01", false)).toBe(500);
    expect(statusFor("40001", false)).toBe(500);
    expect(statusFor("57014", false)).toBe(500);
    expect(statusFor("08006", false)).toBe(503);
    expect(statusFor("53300", false)).toBe(503);
    expect(statusFor("XX000", false)).toBe(500);
    // "Other" codes, such as a bad value (22P02) or a check (23514), are the caller's.
    expect(statusFor("22P02", false)).toBe(400);
    expect(statusFor("23514", false)).toBe(400);
  });
});
