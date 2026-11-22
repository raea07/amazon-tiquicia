/**
 * What every part of the local stand-in shares: settings, the database pool,
 * the signing key, and the small HTTP helpers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify } from "jose";
import pg from "pg";
import type { Claims } from "./rpc.ts";

export const PORT = Number(process.env.DEV_API_PORT ?? 54321);
export const HOST = "127.0.0.1"; // loopback only, by design
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
export const PUBLISHABLE_KEY =
  process.env.DEV_PUBLISHABLE_KEY ?? "sb_publishable_local_development_only";
/**
 * Stands in for a Supabase secret key, which server-side code (the
 * notification worker) uses to call its functions as the `service_role`. Local
 * only: nothing in the apps holds it, and on Supabase the real key is a secret.
 */
export const SECRET_KEY = process.env.DEV_SECRET_KEY ?? "sb_secret_local_development_only";
export const ORIGIN = `http://${HOST}:${PORT}`;
export const ISSUER = `${ORIGIN}/auth/v1`;
export const KEY_ID = "local-dev";

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

// A pooled connection can be closed from the database's side while it sits
// idle — for example when the test database is dropped and recreated. Without
// a listener that is an unhandled error and the whole process exits. The pool
// already discards the dead connection and opens a new one on the next request.
pool.on("error", (error) => {
  console.warn(`database connection dropped (${error.message}); it will be reopened on demand`);
});

// The pool listens only to idle connections. One that is checked out (a
// request in flight, such as the notification worker's polling) and closed by
// the database between two queries emits its error on the connection itself,
// and with no listener there the process exits. That query fails and the
// request answers with an error; the pool drops the dead connection when it
// is released.
pool.on("connect", (client) => {
  client.on("error", (error) => {
    console.warn(`database connection dropped during a request (${error.message})`);
  });
});

// ── Signing key ─────────────────────────────────────────────────────────────
// Asymmetric (ES256) with a published JWKS, like Supabase's current signing
// keys, so server-side token verification in the apps follows the same path it
// will in production. The key is local to this machine and git-ignored.

const KEY_FILE = fileURLToPath(new URL("../.keys/signing-key.json", import.meta.url));

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

export const keys = await loadKeys();

// ── HTTP plumbing ───────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
    public readonly headers: Record<string, string> = {},
  ) {
    super(String(body.message ?? body.msg ?? status));
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info, prefer, x-supabase-api-version, content-profile, accept-profile, x-upsert, cache-control",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  // Auth exposes its API version header to browsers (supabase/auth,
  // internal/api/api.go: ExposedHeaders). Without it auth-js in a browser
  // cannot read an error's code: in the native apps' web export a wrong
  // second-step code read as an unknown failure.
  "access-control-expose-headers": "x-supabase-api-version",
  "access-control-max-age": "600",
};

export function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...CORS, ...headers });
  res.end(payload);
}

/** Sends bytes (a stored file, for instance) rather than JSON. */
export function sendBytes(
  res: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string>,
) {
  res.writeHead(status, { ...CORS, ...headers });
  res.end(body);
}

/** The request body as bytes, refused beyond `limit`. */
export async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, { message: "Payload too large" });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new HttpError(400, { code: "PGRST102", message: "Request body is not valid JSON" });
  }
}

/**
 * Checks a session token this stand-in issued (its signature, issuer and
 * audience) and returns its claims; throws for anything else. The one check
 * every route uses: `authenticate` below for the Data API and storage, and the
 * Auth routes, which also require the token's session to exist.
 */
export async function verifySessionToken(token: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, keys.publicKey, {
    issuer: ISSUER,
    audience: "authenticated",
    algorithms: ["ES256"],
  });
  return payload as unknown as Claims;
}

/**
 * Resolves who is calling. No token, or the publishable key, is a visitor. A
 * token that fails verification is rejected outright rather than downgraded to
 * a visitor: an expired session must surface as 401 so the client refreshes it.
 */
export async function authenticate(req: IncomingMessage): Promise<Claims | null> {
  const header = req.headers.authorization;
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  // The secret key, sent as `apikey` (and usually as the bearer too), is the worker.
  if (req.headers.apikey === SECRET_KEY && (!token || token === SECRET_KEY)) {
    return { sub: "", role: "service_role" };
  }
  if (!token || token === PUBLISHABLE_KEY) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    throw new HttpError(401, { code: "PGRST301", message: "JWT expired or invalid" });
  }
}

/** One incoming request, as every group of routes receives it. */
export interface Exchange {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** "METHOD /path", for exact matches. */
  route: string;
}

/**
 * A group of routes. It answers the request and returns true, or returns false
 * to let the next group look at it. Groups are listed in src/routes/index.ts.
 */
export type Routes = (exchange: Exchange) => Promise<boolean>;
