/** E-mail and password sessions: `/auth/v1/*`. */

import { randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import {
  authenticate,
  HttpError,
  ISSUER,
  KEY_ID,
  keys,
  pool,
  type Routes,
  readJson,
  send,
} from "../context.ts";
import type { Claims } from "../rpc.ts";

const ACCESS_TOKEN_SECONDS = 3600;

/** refresh token → user id. In memory: sessions end when the stand-in restarts. */
const refreshTokens = new Map<string, string>();

export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  raw_user_meta_data: Record<string, unknown>;
}

export const USER_COLUMNS = "id, email, created_at, raw_user_meta_data";

export async function userById(id: string): Promise<AuthUser | null> {
  const { rows } = await pool.query<AuthUser>(
    `select ${USER_COLUMNS} from auth.users where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export const publicUser = (user: AuthUser) => ({
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

/** A new session for `user`. `extra` overrides claims (the assurance level, for instance). */
export async function issueSession(user: AuthUser, extra: Partial<Claims> = {}) {
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
    ...extra,
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

export const authRoutes: Routes = async ({ req, res, url, route }) => {
  if (route === "GET /auth/v1/.well-known/jwks.json") {
    send(res, 200, keys.jwks);
    return true;
  }

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
      send(res, 200, await issueSession(user));
      return true;
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
      send(res, 200, await issueSession(user));
      return true;
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
      send(res, 200, await issueSession(user));
      return true;
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
    const user = claims?.sub ? await userById(claims.sub) : null;
    if (!user) {
      throw new HttpError(401, { code: 401, error_code: "no_authorization", msg: "Not signed in" });
    }
    send(res, 200, publicUser(user));
    return true;
  }

  if (route === "POST /auth/v1/logout") {
    send(res, 204);
    return true;
  }

  return false;
};
