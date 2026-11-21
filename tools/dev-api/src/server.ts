/**
 * Local stand-in for the Supabase API.
 *
 * WHAT IT IS  A small HTTP server that answers the two things the apps ask of
 *             Supabase: database function calls (`/rest/v1/rpc/*`) and e-mail
 *             + password sessions (`/auth/v1/*`). It lets the apps run end to
 *             end against a plain local PostgreSQL, with no Docker.
 *
 * WHAT IT IS NOT  Supabase. It is never deployed and must never be exposed to a
 *             network: it has no rate limiting, no e-mail confirmation, and
 *             keeps refresh tokens in memory. Production uses Supabase's own
 *             PostgREST and Auth. Behaviour the apps rely on is kept to the
 *             narrow, documented surface below so the two cannot drift far —
 *             but the first run against real Supabase is still a real test.
 *
 * Start:  pnpm --filter @yuntera/dev-api start
 */

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify, SignJWT } from "jose";
import pg from "pg";
import { type Claims, callRpc } from "./rpc.ts";

const PORT = Number(process.env.DEV_API_PORT ?? 54321);
const HOST = "127.0.0.1"; // loopback only, by design
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const PUBLISHABLE_KEY = process.env.DEV_PUBLISHABLE_KEY ?? "sb_publishable_local_development_only";
const ISSUER = `http://${HOST}:${PORT}/auth/v1`;
const ACCESS_TOKEN_SECONDS = 3600;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

// A pooled connection can be closed from the database's side while it sits
// idle — for example when the test database is dropped and recreated. Without
// a listener that is an unhandled error and the whole process exits. The pool
// already discards the dead connection and opens a new one on the next request.
pool.on("error", (error) => {
  console.warn(`database connection dropped (${error.message}); it will be reopened on demand`);
});

// ── Signing key ─────────────────────────────────────────────────────────────
// Asymmetric (ES256) with a published JWKS, like Supabase's current signing
// keys, so server-side token verification in the apps follows the same path it
// will in production. The key is local to this machine and git-ignored.

const KEY_FILE = fileURLToPath(new URL("../.keys/signing-key.json", import.meta.url));
const KEY_ID = "local-dev";

async function loadKeys() {
  if (!existsSync(KEY_FILE)) {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, JSON.stringify(await exportJWK(privateKey)), { mode: 0o600 });
  }
  const jwk = JSON.parse(readFileSync(KEY_FILE, "utf8")) as JWK;
  const { d: _private, ...publicJwk } = jwk;
  return {
    privateKey: await importJWK(jwk, "ES256"),
    publicKey: await importJWK(publicJwk, "ES256"),
    jwks: { keys: [{ ...publicJwk, kid: KEY_ID, alg: "ES256", use: "sig" }] },
  };
}

const keys = await loadKeys();

/** refresh token → user id. In memory: sessions end when the gateway restarts. */
const refreshTokens = new Map<string, string>();

interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  raw_user_meta_data: Record<string, unknown>;
}

async function issueSession(user: AuthUser) {
  const now = Math.floor(Date.now() / 1000);
  const claims: Claims = {
    sub: user.id,
    role: "authenticated",
    email: user.email,
    aal: "aal1",
    session_id: randomUUID(),
    is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: user.raw_user_meta_data,
  };
  const accessToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_SECONDS)
    .sign(keys.privateKey);
  const refreshToken = randomBytes(24).toString("base64url");
  refreshTokens.set(refreshToken, user.id);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    expires_at: now + ACCESS_TOKEN_SECONDS,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

const publicUser = (user: AuthUser) => ({
  id: user.id,
  aud: "authenticated",
  role: "authenticated",
  email: user.email,
  email_confirmed_at: user.created_at,
  phone: "",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: user.raw_user_meta_data,
  identities: [],
  created_at: user.created_at,
  updated_at: user.created_at,
  is_anonymous: false,
});

const USER_COLUMNS = "id, email, created_at, raw_user_meta_data";

async function userById(id: string): Promise<AuthUser | null> {
  const { rows } = await pool.query<AuthUser>(
    `select ${USER_COLUMNS} from auth.users where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message ?? body.msg ?? status));
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "authorization, apikey, content-type, x-client-info, prefer, x-supabase-api-version, content-profile, accept-profile",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-max-age": "600",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, { message: "Payload too large" });
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new HttpError(400, { code: "PGRST102", message: "Request body is not valid JSON" });
  }
}

/**
 * Resolves who is calling. No token, or the publishable key, is a visitor. A
 * token that fails verification is rejected outright rather than downgraded to
 * a visitor: an expired session must surface as 401 so the client refreshes it.
 */
async function authenticate(req: IncomingMessage): Promise<Claims | null> {
  const header = req.headers.authorization;
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!token || token === PUBLISHABLE_KEY) return null;
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer: ISSUER,
      audience: "authenticated",
      algorithms: ["ES256"],
    });
    return payload as unknown as Claims;
  } catch {
    throw new HttpError(401, { code: "PGRST301", message: "JWT expired or invalid" });
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  if (req.method === "OPTIONS") return send(res, 204);
  if (route === "GET /health") return send(res, 200, { status: "ok", standIn: true });
  if (route === "GET /auth/v1/.well-known/jwks.json") return send(res, 200, keys.jwks);

  // Database function calls.
  const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(url.pathname);
  if (rpc?.[1] && req.method === "POST") {
    const claims = await authenticate(req);
    const result = await callRpc(pool, rpc[1], await readJson(req), claims);
    return result.ok
      ? send(res, result.data === null ? 204 : 200, result.data ?? undefined)
      : send(res, result.status, result.error);
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    // The apps reach the database only through functions, so table endpoints
    // are deliberately not provided here.
    throw new HttpError(404, {
      code: "PGRST205",
      message: "This local stand-in serves /rest/v1/rpc/* only; apps call database functions.",
    });
  }

  // Sessions.
  if (route === "POST /auth/v1/token") {
    const body = await readJson(req);
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const { rows } = await pool.query<AuthUser>(
        `select ${USER_COLUMNS} from auth.users
         where email = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`,
        [String(body.email ?? ""), String(body.password ?? "")],
      );
      const user = rows[0];
      if (!user) {
        throw new HttpError(400, {
          code: 400,
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        });
      }
      return send(res, 200, await issueSession(user));
    }
    if (grant === "refresh_token") {
      const presented = String(body.refresh_token ?? "");
      const userId = refreshTokens.get(presented);
      const user = userId ? await userById(userId) : null;
      if (!user) {
        throw new HttpError(400, {
          code: 400,
          error_code: "refresh_token_not_found",
          msg: "Invalid Refresh Token: Refresh Token Not Found",
        });
      }
      refreshTokens.delete(presented); // rotate: each refresh token works once
      return send(res, 200, await issueSession(user));
    }
    throw new HttpError(400, {
      code: 400,
      error_code: "validation_failed",
      msg: "Unsupported grant_type",
    });
  }

  if (route === "POST /auth/v1/signup") {
    const body = await readJson(req);
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) {
      throw new HttpError(422, {
        code: 422,
        error_code: "validation_failed",
        msg: "A valid e-mail and a password of at least 8 characters are required",
      });
    }
    const metadata = body.data && typeof body.data === "object" ? body.data : {};
    try {
      const { rows } = await pool.query<AuthUser>(
        `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
         values ($1, extensions.crypt($2, extensions.gen_salt('bf')), now(), $3)
         returning ${USER_COLUMNS}`,
        [email, password, JSON.stringify(metadata)],
      );
      const user = rows[0];
      if (!user) throw new Error("insert returned no row");
      return send(res, 200, await issueSession(user));
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new HttpError(422, {
          code: 422,
          error_code: "user_already_exists",
          msg: "User already registered",
        });
      }
      throw error;
    }
  }

  if (route === "GET /auth/v1/user") {
    const claims = await authenticate(req);
    const user = claims ? await userById(claims.sub) : null;
    if (!user)
      throw new HttpError(401, { code: 401, error_code: "no_authorization", msg: "Not signed in" });
    return send(res, 200, publicUser(user));
  }

  if (route === "POST /auth/v1/logout") return send(res, 204);

  throw new HttpError(404, { message: `No route for ${route}` });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (error instanceof HttpError) return send(res, error.status, error.body);
    console.error(error);
    send(res, 500, { code: "XX000", message: "Internal error in the local stand-in" });
  });
});

server.listen(PORT, HOST, () => {
  console.info(`Local Supabase stand-in listening on http://${HOST}:${PORT}`);
  console.info(`  database         ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
  console.info(`  publishable key  ${PUBLISHABLE_KEY}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().then(() => process.exit(0));
  });
}
