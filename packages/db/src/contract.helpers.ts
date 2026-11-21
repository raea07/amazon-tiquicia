/**
 * Shared setup for contract tests: files named `contract*.test.ts` that call
 * the real database functions as a given demo user and validate the answers
 * against the client's schemas. Each call runs the way an API request does —
 * as the `anon` or `authenticated` role with the user's claims — so it
 * exercises grants and row-level security as well as payload shape.
 *
 * Needs a seeded database (`pnpm db:local:reset`) and DATABASE_URL. Without
 * DATABASE_URL the suites skip themselves, so unit-test runs stay database-free.
 *
 *   const db = contractDatabase();
 *   describe.skipIf(!db.enabled)("payouts", () => {
 *     beforeAll(db.connect); afterAll(db.close);
 *     it("…", async () => { await db.as("central@yuntera.example").opsOverview(); });
 *   });
 */

import { type Claims, callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { type Api, createApi, type RpcTransport } from "./api";

export function contractDatabase() {
  const url = process.env.DATABASE_URL;
  let pool: pg.Pool | undefined;
  const users = new Map<string, string>();

  return {
    enabled: Boolean(url),

    async connect() {
      pool = new pg.Pool({ connectionString: url, max: 4 });
      const { rows } = await pool.query<{ email: string; id: string }>(
        "select email, id from auth.users where email like '%@yuntera.example'",
      );
      for (const row of rows) users.set(row.email, row.id);
      if (users.size < 6) throw new Error("database is not seeded — run pnpm db:local:reset");
    },

    async close() {
      await pool?.end();
    },

    /** Direct SQL, for looking up ids the tests need. Never for the thing under test. */
    query: <Row extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
      if (!pool) throw new Error("call connect() first");
      return pool.query<Row>(text, values);
    },

    /** A client acting as the given demo user, or as a visitor when omitted. */
    as(email?: string, aal: "aal1" | "aal2" = "aal1"): Api {
      const claims: Claims | null = email
        ? { sub: users.get(email) ?? "", role: "authenticated", aal }
        : null;
      const transport: RpcTransport = {
        rpc: async (fn, args = {}) => {
          if (!pool) throw new Error("call connect() first");
          const result = await callRpc(pool, fn, args, claims);
          return result.ok
            ? { data: result.data, error: null, status: 200 }
            : { data: null, error: result.error, status: result.status };
        },
      };
      return createApi(transport);
    },
  };
}
