/**
 * Calls a database function the way the Supabase Data API (PostgREST) does:
 * inside one transaction, as the `anon` or `authenticated` role, with the
 * caller's JWT claims in `request.jwt.claims`, `request.method` and
 * `request.path` set, and the pre-request function configured for PostgREST
 * (`pgrst.db_pre_request`) called first. Grants, row-level security and that
 * check therefore apply exactly as they do to a real API request.
 *
 * Shared by the local gateway and by the contract tests.
 */

import type { Pool, PoolClient } from "pg";

export interface Claims {
  sub: string;
  role: "authenticated";
  email?: string;
  aal?: string;
  [claim: string]: unknown;
}

export interface RpcError {
  /** SQLSTATE, or a PGRST code for errors raised before the database is reached. */
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export type RpcResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: RpcError };

interface FunctionSignature {
  argNames: string[];
  argTypes: string[];
  /** Number of leading arguments that have no default and must be supplied. */
  requiredCount: number;
  returnsSet: boolean;
  returnsVoid: boolean;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

async function describe(client: PoolClient, name: string): Promise<FunctionSignature[]> {
  const { rows } = await client.query<{
    arg_names: string[] | null;
    arg_types: string[];
    default_count: number;
    returns_set: boolean;
    returns_void: boolean;
  }>(
    `select
       -- input arguments only (TABLE/OUT columns are not arguments)
       (select array_agg(n order by ord)
          from unnest(p.proargnames) with ordinality as a (n, ord)
         where ord <= p.pronargs) as arg_names,
       (select coalesce(array_agg(format_type(t, null) order by ord), '{}')
          from unnest(p.proargtypes::oid[]) with ordinality as a (t, ord)) as arg_types,
       p.pronargdefaults::int as default_count,
       p.proretset as returns_set,
       p.prorettype = 'void'::regtype as returns_void
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  return rows.map((r) => ({
    argNames: r.arg_names ?? [],
    argTypes: r.arg_types,
    requiredCount: r.arg_types.length - r.default_count,
    returnsSet: r.returns_set,
    returnsVoid: r.returns_void,
  }));
}

const QUALIFIED = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/;

/**
 * The Data API's pre-request function, read where PostgREST reads it: the
 * `pgrst.db_pre_request` setting of the `authenticator` role, for this
 * database or for all of them (the database-specific one wins). PostgREST
 * calls it before every request, in the request's transaction, after
 * switching to the caller's role and setting the claims; so does this.
 */
async function preRequestFunction(client: PoolClient): Promise<string | null> {
  const { rows } = await client.query<{ value: string }>(
    `select substr(cfg, length('pgrst.db_pre_request=') + 1) as value
       from pg_db_role_setting s
       join pg_roles r on r.oid = s.setrole
       cross join lateral unnest(s.setconfig) as cfg
      where r.rolname = 'authenticator'
        and cfg like 'pgrst.db_pre_request=%'
        and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
      order by s.setdatabase desc
      limit 1`,
  );
  const value = rows[0]?.value?.trim();
  if (!value) return null;
  const match = QUALIFIED.exec(value.includes(".") ? value : `public.${value}`);
  if (!match) throw new Error(`pgrst.db_pre_request is not a function name: ${value}`);
  return `"${match[1]}"."${match[2]}"`;
}

/** HTTP status for a database error, following PostgREST's mapping. */
function statusFor(sqlState: string, isAnonymous: boolean): number {
  if (sqlState === "42501") return isAnonymous ? 401 : 403;
  if (sqlState === "23505" || sqlState === "23503") return 409;
  if (sqlState === "P0001" || sqlState.startsWith("22") || sqlState.startsWith("23")) return 400;
  if (sqlState === "42883") return 404;
  return 500;
}

export async function callRpc(
  pool: Pool,
  name: string,
  args: Record<string, unknown>,
  claims: Claims | null,
): Promise<RpcResult> {
  if (!IDENTIFIER.test(name)) {
    return notFound(name);
  }
  const supplied = Object.keys(args);
  if (supplied.some((key) => !IDENTIFIER.test(key))) {
    return notFound(name);
  }

  const client = await pool.connect();
  try {
    const candidates = await describe(client, name);
    // Pick the overload whose parameters cover what was sent, as PostgREST does.
    const signature = candidates.find(
      (s) =>
        supplied.every((key) => s.argNames.includes(key)) &&
        s.argNames.slice(0, s.requiredCount).every((key) => supplied.includes(key)),
    );
    if (!signature) return notFound(name);

    const placeholders: string[] = [];
    const values: unknown[] = [];
    for (const key of supplied) {
      const type = signature.argTypes[signature.argNames.indexOf(key)] ?? "text";
      const value = args[key];
      // JSON parameters travel as text; everything else is left to the driver.
      values.push(
        (type === "jsonb" || type === "json") && value !== null ? JSON.stringify(value) : value,
      );
      placeholders.push(`"${key}" => $${values.length}::${type}`);
    }
    const call = `public."${name}"(${placeholders.join(", ")})`;
    const sql = signature.returnsVoid
      ? `select ${call}`
      : signature.returnsSet
        ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as result from ${call} as t`
        : `select to_jsonb(${call}) as result`;

    await client.query("begin");
    try {
      await client.query(`set local role ${claims ? "authenticated" : "anon"}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        claims ? JSON.stringify(claims) : "",
      ]);
      await client.query(
        "select set_config('request.method', 'POST', true), set_config('request.path', $1, true)",
        [`/rpc/${name}`],
      );
      const preRequest = await preRequestFunction(client);
      if (preRequest) await client.query(`select ${preRequest}()`);
      const { rows } = await client.query<{ result: unknown }>(sql, values);
      await client.query("commit");
      return { ok: true, data: signature.returnsVoid ? null : (rows[0]?.result ?? null) };
    } catch (error) {
      await client.query("rollback");
      const e = error as { code?: string; message?: string; detail?: string; hint?: string };
      const code = e.code ?? "XX000";
      return {
        ok: false,
        status: statusFor(code, claims === null),
        error: {
          code,
          message: e.message ?? "Database error",
          details: e.detail || null,
          hint: e.hint || null,
        },
      };
    }
  } finally {
    client.release();
  }
}

function notFound(name: string): RpcResult {
  return {
    ok: false,
    status: 404,
    error: {
      code: "PGRST202",
      message: `Could not find the function public.${name} in the schema cache`,
      details: null,
      hint: null,
    },
  };
}
