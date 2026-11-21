/**
 * Users, sessions, refresh tokens and factors, kept in the database under the
 * same table names Supabase Auth uses (supabase/scripts/local-shim.sql), so
 * database functions that read `auth.sessions` or `auth.mfa_factors` see what
 * they would see on the platform.
 */

import { createHash, randomInt, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { PoolClient } from "pg";
import { ISSUER, KEY_ID, keys, pool } from "../context.ts";
import type { Claims } from "../rpc.ts";

export const ACCESS_TOKEN_SECONDS = 3600;
/** Platform default: a refresh token already used is accepted again for 10 seconds. */
export const REUSE_INTERVAL_SECONDS = 10;

type Db = Pick<PoolClient, "query">;

export interface AuthUser {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: string | null;
  confirmation_sent_at: string | null;
  recovery_sent_at: string | null;
  email_change_sent_at: string | null;
  email_change: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  deleted_at: string | null;
  raw_user_meta_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const USER_COLUMNS = `id, email, encrypted_password, email_confirmed_at, confirmation_sent_at,
  recovery_sent_at, email_change_sent_at, email_change, last_sign_in_at, banned_until, deleted_at,
  raw_user_meta_data, created_at, updated_at`;

export async function userById(id: string, db: Db = pool): Promise<AuthUser | null> {
  const { rows } = await db.query<AuthUser>(
    `select ${USER_COLUMNS} from auth.users where id = $1 and deleted_at is null`,
    [id],
  );
  return rows[0] ?? null;
}

export async function userByEmail(email: string, db: Db = pool): Promise<AuthUser | null> {
  const { rows } = await db.query<AuthUser>(
    `select ${USER_COLUMNS} from auth.users where email = lower($1) and deleted_at is null`,
    [email],
  );
  return rows[0] ?? null;
}

export const isBanned = (user: AuthUser) =>
  user.banned_until !== null && new Date(user.banned_until).getTime() > Date.now();

export async function passwordMatches(user: AuthUser, password: string): Promise<boolean> {
  if (!user.encrypted_password?.startsWith("$2")) return false; // no password set
  const { rows } = await pool.query<{ ok: boolean }>("select $1 = extensions.crypt($2, $1) as ok", [
    user.encrypted_password,
    password,
  ]);
  return rows[0]?.ok ?? false;
}

export interface Factor {
  id: string;
  friendly_name: string | null;
  factor_type: string;
  status: "unverified" | "verified";
  secret: string;
  created_at: string;
  updated_at: string;
  last_challenged_at: string | null;
}

export async function factorsOf(userId: string, db: Db = pool): Promise<Factor[]> {
  const { rows } = await db.query<Factor>(
    `select id, friendly_name, factor_type::text, status::text, secret, created_at, updated_at,
            last_challenged_at
     from auth.mfa_factors where user_id = $1 order by created_at`,
    [userId],
  );
  return rows;
}

/** The user object Auth returns: identities and factors included. */
export async function publicUser(user: AuthUser) {
  const [{ rows: identities }, factors] = await Promise.all([
    pool.query(
      `select id::text as identity_id, provider_id as id, user_id, identity_data, provider,
              last_sign_in_at, created_at, updated_at, email
       from auth.identities where user_id = $1`,
      [user.id],
    ),
    factorsOf(user.id),
  ]);
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: user.email_confirmed_at ?? undefined,
    confirmed_at: user.email_confirmed_at ?? undefined,
    confirmation_sent_at: user.confirmation_sent_at ?? undefined,
    recovery_sent_at: user.recovery_sent_at ?? undefined,
    new_email: user.email_change || undefined,
    email_change_sent_at: user.email_change_sent_at ?? undefined,
    last_sign_in_at: user.last_sign_in_at ?? undefined,
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: user.raw_user_meta_data,
    identities,
    factors: factors.length
      ? factors.map((f) => ({
          id: f.id,
          friendly_name: f.friendly_name ?? undefined,
          factor_type: f.factor_type,
          status: f.status,
          created_at: f.created_at,
          updated_at: f.updated_at,
          last_challenged_at: f.last_challenged_at ?? undefined,
        }))
      : undefined,
    created_at: user.created_at,
    updated_at: user.updated_at,
    is_anonymous: false,
  };
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  user_id: string;
  aal: "aal1" | "aal2";
}

export async function sessionById(id: string, db: Db = pool): Promise<Session | null> {
  const { rows } = await db.query<Session>(
    "select id, user_id, aal::text as aal from auth.sessions where id = $1",
    [id],
  );
  return rows[0] ?? null;
}

/** A refresh token as the real server makes the short ones: 12 of [a-z0-9]. */
function newRefreshToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export async function addMethod(sessionId: string, method: string, db: Db = pool) {
  await db.query(
    `insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
     values ($1, $2, now(), now(), $3)
     on conflict (session_id, authentication_method) do update set updated_at = now()`,
    [randomUUID(), sessionId, method],
  );
}

/** Starts a session for `user`, signed in by `method` (password, otp, …). */
export async function createSession(user: AuthUser, method: string) {
  const sessionId = randomUUID();
  await pool.query(
    `insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at)
     values ($1, $2, now(), now(), 'aal1', now())`,
    [sessionId, user.id],
  );
  await addMethod(sessionId, method);
  await pool.query("update auth.users set last_sign_in_at = now() where id = $1", [user.id]);
  return issueTokens(user, sessionId, null);
}

/**
 * New access and refresh tokens for an existing session. The access token's
 * `aal` and `amr` come from the session, as on the platform, so they survive
 * refreshes.
 */
export async function issueTokens(user: AuthUser, sessionId: string, parent: string | null) {
  const session = await sessionById(sessionId);
  if (!session) throw new Error("session vanished");
  const { rows: methods } = await pool.query<{ method: string; at: string }>(
    `select authentication_method as method, extract(epoch from updated_at)::bigint::text as at
     from auth.mfa_amr_claims where session_id = $1 order by updated_at desc`,
    [sessionId],
  );
  const now = Math.floor(Date.now() / 1000);
  const claims: Claims = {
    sub: user.id,
    role: "authenticated",
    email: user.email,
    phone: "",
    aal: session.aal,
    amr: methods.map((m) => ({ method: m.method, timestamp: Number(m.at) })),
    session_id: sessionId,
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
  const refreshToken = newRefreshToken();
  await pool.query(
    `insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, parent, session_id)
     values ($1, $2, false, now(), now(), $3, $4)`,
    [refreshToken, user.id, parent, sessionId],
  );
  await pool.query(
    "update auth.sessions set refreshed_at = now(), updated_at = now() where id = $1",
    [sessionId],
  );
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    expires_at: now + ACCESS_TOKEN_SECONDS,
    refresh_token: refreshToken,
    user: await publicUser(user),
  };
}

export interface RefreshRow {
  token: string;
  revoked: boolean;
  parent: string | null;
  session_id: string;
  user_id: string;
  age_seconds: number;
  active_child: string | null;
}

export async function refreshRow(token: string): Promise<RefreshRow | null> {
  const { rows } = await pool.query<RefreshRow>(
    `select t.token, t.revoked, t.parent, t.session_id, t.user_id,
            extract(epoch from now() - t.updated_at)::int as age_seconds,
            (select c.token from auth.refresh_tokens c
             where c.parent = t.token and not c.revoked limit 1) as active_child
     from auth.refresh_tokens t where t.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

// ── One-time tokens (links and 6-digit codes in e-mails) ────────────────────

export type OtpKind = "confirmation_token" | "recovery_token" | "email_change_token_new";

/** Hex SHA-224 of e-mail and code, as Auth computes `TokenHash`. */
export const tokenHash = (email: string, code: string) =>
  createHash("sha224")
    .update(email + code)
    .digest("hex");

/**
 * Stores a fresh code for `kind`, replacing any earlier one, and returns the
 * code and the hash the e-mail link carries (prefixed `pkce_` when the client
 * sent a PKCE challenge, as the real server does).
 */
export async function newOneTimeToken(
  userId: string,
  kind: OtpKind,
  relatesTo: string,
  pkce: boolean,
) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = (pkce ? "pkce_" : "") + tokenHash(relatesTo, code);
  await pool.query(
    `insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, token_type) do update
       set token_hash = excluded.token_hash, relates_to = excluded.relates_to,
           created_at = now(), updated_at = now()`,
    [randomUUID(), userId, kind, hash, relatesTo],
  );
  return { code, hash };
}
