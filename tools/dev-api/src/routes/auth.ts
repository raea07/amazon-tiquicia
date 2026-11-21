/**
 * Sign-in, sessions, e-mail confirmation, password recovery and second
 * factors: `/auth/v1/*`, following the requests and answers documented in
 * docs/research/supabase-auth-storage-wire-format.md (sections 1–3 and 7.3).
 *
 * Truthful: the endpoints, request bodies, response shapes and error codes the
 * apps use; sessions with a stable id, an assurance level and sign-in methods
 * that survive refreshes; refresh-token rotation with the 10-second reuse
 * window; one-time tokens stored as Auth stores them; real time-based codes.
 * Not truthful: no rate limits per IP, no CAPTCHA, no leaked-password check,
 * no phone or OAuth, no "secure e-mail change" second link, no reauthenticate
 * nonce, and e-mails go to a local mailbox (GET /dev/mail), never out.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { jwtVerify } from "jose";
import qrcode from "qrcode-generator";
import { authError, isEmail, isUuid } from "../auth/errors.ts";
import { sendMail, type TemplateName } from "../auth/mail.ts";
import { numberSetting, setting } from "../auth/settings.ts";
import {
  type AuthUser,
  addMethod,
  createSession,
  factorsOf,
  isBanned,
  issueTokens,
  newOneTimeToken,
  type OtpKind,
  passwordMatches,
  publicUser,
  REUSE_INTERVAL_SECONDS,
  refreshRow,
  type Session,
  sessionById,
  tokenHash,
  userByEmail,
  userById,
} from "../auth/store.ts";
import { ISSUER, keys, PUBLISHABLE_KEY, pool, type Routes, readJson, send } from "../context.ts";
import type { Claims } from "../rpc.ts";
import { newSecret, otpauthUri, verifyTotp } from "../totp.ts";

const CHALLENGE_SECONDS = 300;
const UNVERIFIED_FACTOR_SECONDS = 300;
const MAX_FACTORS = 10;

// ── Who is calling ──────────────────────────────────────────────────────────

interface Caller {
  claims: Claims;
  user: AuthUser;
  session: Session;
}

/** A signed-in caller on an Auth route: 401 without a token, 403 for a bad or ended one. */
async function caller(req: IncomingMessage): Promise<Caller> {
  const header = req.headers.authorization;
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!token || token === PUBLISHABLE_KEY) {
    throw authError(req, 401, "no_authorization", "This endpoint requires a valid Bearer token");
  }
  let claims: Claims;
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer: ISSUER,
      audience: "authenticated",
      algorithms: ["ES256"],
    });
    claims = payload as unknown as Claims;
  } catch {
    throw authError(req, 403, "bad_jwt", "invalid JWT: unable to parse or verify signature");
  }
  const session = await sessionById(String(claims.session_id ?? ""));
  if (!session) {
    throw authError(
      req,
      403,
      "session_not_found",
      "Session from session_id claim in JWT does not exist",
    );
  }
  const user = await userById(claims.sub);
  if (!user)
    throw authError(req, 403, "user_not_found", "User from sub claim in JWT does not exist");
  return { claims, user, session };
}

// ── E-mails with a link and a code ──────────────────────────────────────────

const TEMPLATE_FOR: Record<OtpKind, TemplateName> = {
  confirmation_token: "confirmation",
  recovery_token: "recovery",
  email_change_token_new: "email_change",
};
const SENT_AT_COLUMN: Record<OtpKind, string> = {
  confirmation_token: "confirmation_sent_at",
  recovery_token: "recovery_sent_at",
  email_change_token_new: "email_change_sent_at",
};

/** Refuses a second e-mail of the same kind within `max_frequency`, like the real server. */
async function checkEmailFrequency(req: IncomingMessage, user: AuthUser, kind: OtpKind) {
  const limit = await numberSetting("email_max_frequency_seconds");
  const sentAt = user[SENT_AT_COLUMN[kind] as keyof AuthUser] as string | null;
  if (!sentAt || limit <= 0) return;
  const elapsed = Math.floor((Date.now() - new Date(sentAt).getTime()) / 1000);
  if (elapsed < limit) {
    throw authError(
      req,
      429,
      "over_email_send_rate_limit",
      `For security purposes, you can only request this after ${limit - elapsed} seconds.`,
    );
  }
}

async function mailOneTimeToken(
  req: IncomingMessage,
  url: URL,
  user: AuthUser,
  kind: OtpKind,
  pkce: boolean,
  address = user.email,
) {
  await checkEmailFrequency(req, user, kind);
  const { code, hash } = await newOneTimeToken(user.id, kind, address, pkce);
  await pool.query(`update auth.users set ${SENT_AT_COLUMN[kind]} = now() where id = $1`, [
    user.id,
  ]);
  await sendMail(address, TEMPLATE_FOR[kind], {
    Token: code,
    TokenHash: hash,
    SiteURL: await setting("site_url"),
    RedirectTo: url.searchParams.get("redirect_to") ?? "",
    Email: user.email,
    NewEmail: kind === "email_change_token_new" ? address : "",
  });
}

async function weakPassword(req: IncomingMessage, password: string) {
  const min = await numberSetting("password_min_length");
  if ([...password].length < min) {
    return authError(req, 422, "weak_password", `Password should be at least ${min} characters.`, {
      weak_password: { reasons: ["length"] },
    });
  }
  if (Buffer.byteLength(password) > 72) {
    return authError(req, 400, "validation_failed", "Password cannot be longer than 72 characters");
  }
  return null;
}

// ── Second factors ──────────────────────────────────────────────────────────

function qrSvg(uri: string): string {
  const qr = qrcode(0, "H");
  qr.addData(uri);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

async function factorOf(req: IncomingMessage, who: Caller, id: string) {
  if (!isUuid(id)) throw authError(req, 404, "validation_failed", "factor_id must be an UUID");
  const factor = (await factorsOf(who.user.id)).find((f) => f.id === id);
  if (!factor) throw authError(req, 404, "mfa_factor_not_found", "Factor not found");
  return factor;
}

const hasVerifiedFactor = async (userId: string) =>
  (await factorsOf(userId)).some((f) => f.status === "verified");

// ── Routes ──────────────────────────────────────────────────────────────────

export const authRoutes: Routes = async ({ req, res, url, route }) => {
  if (!url.pathname.startsWith("/auth/v1/")) return false;

  if (route === "GET /auth/v1/.well-known/jwks.json") {
    send(res, 200, keys.jwks, { "cache-control": "public, max-age=600" });
    return true;
  }

  // ── Sessions ──
  if (route === "POST /auth/v1/token") {
    const body = await readJson(req);
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const email = String(body.email ?? "").trim();
      if (!email) throw authError(req, 400, "validation_failed", "missing email or phone");
      const user = await userByEmail(email);
      if (!user || !(await passwordMatches(user, String(body.password ?? "")))) {
        throw authError(req, 400, "invalid_credentials", "Invalid login credentials");
      }
      if (isBanned(user)) throw authError(req, 400, "user_banned", "User is banned");
      // Only after the password matched, so it does not reveal unconfirmed accounts.
      if (!user.email_confirmed_at) {
        throw authError(req, 400, "email_not_confirmed", "Email not confirmed");
      }
      send(res, 200, await createSession(user, "password"));
      return true;
    }
    if (grant === "refresh_token") {
      const presented = String(body.refresh_token ?? "");
      const row = await refreshRow(presented);
      const notFound = () =>
        authError(
          req,
          400,
          "refresh_token_not_found",
          "Invalid Refresh Token: Refresh Token Not Found",
        );
      if (!row) throw notFound();
      const user = await userById(row.user_id);
      if (!user) throw notFound();
      if (isBanned(user)) throw authError(req, 400, "user_banned", "User is banned");
      if (!row.revoked) {
        await pool.query(
          "update auth.refresh_tokens set revoked = true, updated_at = now() where token = $1",
          [presented],
        );
        send(res, 200, await issueTokens(user, row.session_id, presented));
        return true;
      }
      // Already used. Tolerated within the reuse window, or when it is the
      // parent of the token now active (the answer to the first use was lost).
      if (row.age_seconds <= REUSE_INTERVAL_SECONDS || row.active_child) {
        send(res, 200, await issueTokens(user, row.session_id, presented));
        return true;
      }
      await pool.query("delete from auth.sessions where id = $1", [row.session_id]);
      throw authError(
        req,
        400,
        "refresh_token_already_used",
        "Invalid Refresh Token: Already Used",
      );
    }
    throw authError(req, 400, "invalid_credentials", "unsupported_grant_type");
  }

  if (route === "POST /auth/v1/logout") {
    const who = await caller(req);
    const scope = url.searchParams.get("scope") ?? "global";
    if (scope === "local") {
      await pool.query("delete from auth.sessions where id = $1", [who.session.id]);
    } else if (scope === "global") {
      await pool.query("delete from auth.sessions where user_id = $1", [who.user.id]);
    } else if (scope === "others") {
      await pool.query("delete from auth.sessions where user_id = $1 and id <> $2", [
        who.user.id,
        who.session.id,
      ]);
    } else {
      throw authError(req, 400, "validation_failed", "Unsupported logout scope");
    }
    send(res, 204);
    return true;
  }

  // ── Sign-up and confirmation ──
  if (route === "POST /auth/v1/signup") {
    const body = await readJson(req);
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    const pkce = Boolean(body.code_challenge);
    if (!isEmail(email)) {
      throw authError(
        req,
        400,
        "validation_failed",
        "Unable to validate email address: invalid format",
      );
    }
    const weak = await weakPassword(req, password);
    if (weak) throw weak;
    const confirm = (await setting("confirm_email")) === "on";
    const metadata = body.data && typeof body.data === "object" ? body.data : {};

    const existing = await userByEmail(email);
    if (existing?.email_confirmed_at) {
      if (!confirm) throw authError(req, 422, "user_already_exists", "User already registered");
      // Confirmation on: an answer that looks like success, so the form does
      // not tell a stranger the address has an account. No e-mail is sent.
      send(res, 200, {
        id: randomUUID(),
        aud: "authenticated",
        role: "",
        email,
        phone: "",
        confirmation_sent_at: new Date().toISOString(),
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_anonymous: false,
      });
      return true;
    }
    if (existing) {
      // Signed up before but never confirmed: send the confirmation again.
      await pool.query(
        `update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
           raw_user_meta_data = $3, updated_at = now() where id = $1`,
        [existing.id, password, JSON.stringify(metadata)],
      );
      await mailOneTimeToken(req, url, existing, "confirmation_token", pkce);
      send(res, 200, await publicUser((await userById(existing.id)) ?? existing));
      return true;
    }

    const { rows } = await pool.query<{ id: string }>(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
          email_change_token_new, email_change, email_change_token_current, phone_change,
          phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
         'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')),
         case when $4 then null else now() end,
         '{"provider":"email","providers":["email"]}', $3, '', '', '', '', '', '', '', '')
       returning id`,
      [email, password, JSON.stringify(metadata), confirm],
    );
    const id = rows[0]?.id ?? "";
    await pool.query(
      `insert into auth.identities (user_id, provider_id, provider, identity_data, created_at, updated_at)
       values ($1, $1::text, 'email', jsonb_build_object('sub', $1::text, 'email', $2::text,
               'email_verified', false, 'phone_verified', false), now(), now())`,
      [id, email],
    );
    const user = await userById(id);
    if (!user) throw new Error("sign-up insert returned no user");
    if (confirm) {
      await mailOneTimeToken(req, url, user, "confirmation_token", pkce);
      send(res, 200, await publicUser((await userById(id)) ?? user));
    } else {
      send(res, 200, await createSession(user, "password"));
    }
    return true;
  }

  if (route === "POST /auth/v1/resend") {
    const body = await readJson(req);
    const type = String(body.type ?? "");
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    if (!["signup", "email_change"].includes(type)) {
      throw authError(
        req,
        400,
        "validation_failed",
        "Missing one of these types: signup, email_change, sms, phone_change",
      );
    }
    if (!isEmail(email)) {
      throw authError(
        req,
        400,
        "validation_failed",
        "Unable to validate email address: invalid format",
      );
    }
    const user = await userByEmail(email);
    // The same answer for unknown and already-confirmed addresses.
    if (user && type === "signup" && !user.email_confirmed_at) {
      await mailOneTimeToken(req, url, user, "confirmation_token", Boolean(body.code_challenge));
    }
    if (user && type === "email_change" && user.email_change) {
      await mailOneTimeToken(
        req,
        url,
        user,
        "email_change_token_new",
        Boolean(body.code_challenge),
        user.email_change,
      );
    }
    send(res, 200, {});
    return true;
  }

  if (route === "POST /auth/v1/recover") {
    const body = await readJson(req);
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    if (!isEmail(email)) {
      throw authError(
        req,
        400,
        "validation_failed",
        "Unable to validate email address: invalid format",
      );
    }
    const user = await userByEmail(email);
    // Answered the same way whether or not the address has an account.
    if (user)
      await mailOneTimeToken(req, url, user, "recovery_token", Boolean(body.code_challenge));
    send(res, 200, {});
    return true;
  }

  if (route === "POST /auth/v1/verify") {
    const body = await readJson(req);
    const type = String(body.type ?? "");
    const kinds: Record<string, OtpKind[]> = {
      signup: ["confirmation_token"],
      email: ["confirmation_token"],
      invite: ["confirmation_token"],
      magiclink: ["confirmation_token"],
      recovery: ["recovery_token"],
      email_change: ["email_change_token_new"],
    };
    const accepted = kinds[type];
    if (!accepted)
      throw authError(req, 400, "validation_failed", "Verify requires a verification type");
    const hasHash = typeof body.token_hash === "string" && body.token_hash !== "";
    const hasToken = typeof body.token === "string" && body.token !== "";
    if (hasHash === hasToken) {
      throw authError(
        req,
        400,
        "validation_failed",
        "Verify requires either a token or a token hash",
      );
    }
    if (
      hasHash &&
      (body.email !== undefined || body.phone !== undefined || body.redirect_to !== undefined)
    ) {
      throw authError(
        req,
        400,
        "validation_failed",
        "Only the token_hash and type should be provided",
      );
    }
    const expiry = await numberSetting("otp_expiry_seconds");
    const expired = () =>
      authError(req, 403, "otp_expired", "Email link is invalid or has expired");

    type Match = { user_id: string; token_type: OtpKind; relates_to: string };
    let match: Match | undefined;
    if (hasHash) {
      ({
        rows: [match],
      } = await pool.query<Match>(
        `select user_id, token_type::text, relates_to from auth.one_time_tokens
         where token_hash = $1 and token_type::text = any ($2)
           and created_at > now() - make_interval(secs => $3)`,
        [body.token_hash, accepted, expiry],
      ));
    } else {
      const email = String(body.email ?? "")
        .trim()
        .toLowerCase();
      const hash = tokenHash(email, String(body.token));
      ({
        rows: [match],
      } = await pool.query<Match>(
        `select user_id, token_type::text, relates_to from auth.one_time_tokens
         where token_hash in ($1, 'pkce_' || $1) and token_type::text = any ($2)
           and relates_to = $3 and created_at > now() - make_interval(secs => $4)`,
        [hash, accepted, email, expiry],
      ));
    }
    if (!match) throw expired();
    const user = await userById(match.user_id);
    if (!user) throw expired();
    if (isBanned(user)) throw authError(req, 403, "user_banned", "User is banned");

    // Single use: verifying clears every pending token of the user.
    await pool.query("delete from auth.one_time_tokens where user_id = $1", [user.id]);
    if (match.token_type === "email_change_token_new") {
      await pool.query(
        `update auth.users set email = email_change, email_change = '', email_change_sent_at = null,
           updated_at = now() where id = $1`,
        [user.id],
      );
      await pool.query(
        "update auth.identities set identity_data = identity_data || jsonb_build_object('email', $2::text) where user_id = $1",
        [user.id, match.relates_to],
      );
    }
    // Any of these links proves the person reads the mailbox: the address is confirmed.
    await pool.query(
      "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1",
      [user.id],
    );
    const fresh = await userById(user.id);
    if (!fresh) throw expired();
    send(res, 200, await createSession(fresh, "otp"));
    return true;
  }

  // ── The signed-in user ──
  if (route === "GET /auth/v1/user") {
    const who = await caller(req);
    send(res, 200, await publicUser(who.user));
    return true;
  }

  if (route === "PUT /auth/v1/user") {
    const who = await caller(req);
    const body = await readJson(req);
    const { user } = who;

    if (typeof body.password === "string" || typeof body.email === "string") {
      // A person with a second factor changes password or e-mail only from a
      // session that passed it.
      if (who.session.aal !== "aal2" && (await hasVerifiedFactor(user.id))) {
        throw authError(
          req,
          401,
          "insufficient_aal",
          "AAL2 session is required to update email or password when MFA is enabled.",
        );
      }
    }
    if (typeof body.password === "string") {
      const weak = await weakPassword(req, body.password);
      if (weak) throw weak;
      if (await passwordMatches(user, body.password)) {
        throw authError(
          req,
          422,
          "same_password",
          "New password should be different from the old password.",
        );
      }
      await pool.query(
        `update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
           updated_at = now() where id = $1`,
        [user.id, body.password],
      );
      // Every other session of the person ends; pending links stop working.
      await pool.query("delete from auth.sessions where user_id = $1 and id <> $2", [
        user.id,
        who.session.id,
      ]);
      await pool.query("delete from auth.one_time_tokens where user_id = $1", [user.id]);
      await sendMail(user.email, "password_changed_notification", { Email: user.email });
    }
    if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!isEmail(email)) {
        throw authError(
          req,
          400,
          "validation_failed",
          "Unable to validate email address: invalid format",
        );
      }
      const other = await userByEmail(email);
      if (other && other.id !== user.id) {
        throw authError(
          req,
          422,
          "email_exists",
          "A user with this email address has already been registered",
        );
      }
      await pool.query("update auth.users set email_change = $2 where id = $1", [user.id, email]);
      await mailOneTimeToken(
        req,
        url,
        user,
        "email_change_token_new",
        Boolean(body.code_challenge),
        email,
      );
    }
    if (body.data && typeof body.data === "object") {
      // Merged key by key; a null value removes the key.
      await pool.query(
        `update auth.users set raw_user_meta_data = jsonb_strip_nulls(raw_user_meta_data || $2::jsonb),
           updated_at = now() where id = $1`,
        [user.id, JSON.stringify(body.data)],
      );
    }
    send(res, 200, await publicUser((await userById(user.id)) ?? user));
    return true;
  }

  // ── Second factors ──
  if (route === "POST /auth/v1/factors") {
    const who = await caller(req);
    const body = await readJson(req);
    if (body.factor_type !== "totp") {
      throw authError(req, 400, "validation_failed", "Invalid factor type");
    }
    await pool.query(
      `delete from auth.mfa_factors where user_id = $1 and status = 'unverified'
         and created_at < now() - make_interval(secs => $2)`,
      [who.user.id, UNVERIFIED_FACTOR_SECONDS],
    );
    const factors = await factorsOf(who.user.id);
    const friendlyName = typeof body.friendly_name === "string" ? body.friendly_name : "";
    if (factors.some((f) => (f.friendly_name ?? "") === friendlyName)) {
      throw authError(
        req,
        422,
        "mfa_factor_name_conflict",
        `A factor with the friendly name "${friendlyName}" for this user already exists`,
      );
    }
    if (factors.length >= MAX_FACTORS) {
      throw authError(
        req,
        422,
        "too_many_enrolled_mfa_factors",
        "Maximum number of verified factors reached, unenroll to continue",
      );
    }
    if (who.session.aal !== "aal2" && factors.some((f) => f.status === "verified")) {
      throw authError(req, 403, "insufficient_aal", "AAL2 required to enroll a new factor");
    }
    const issuer =
      typeof body.issuer === "string" && body.issuer
        ? body.issuer
        : new URL(await setting("site_url")).host;
    const secret = newSecret();
    const uri = otpauthUri(issuer, who.user.email, secret);
    const id = randomUUID();
    await pool.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
       values ($1, $2, $3, 'totp', 'unverified', now(), now(), $4)`,
      [id, who.user.id, friendlyName, secret],
    );
    send(res, 200, {
      id,
      type: "totp",
      friendly_name: friendlyName,
      totp: { qr_code: qrSvg(uri), secret, uri },
    });
    return true;
  }

  const factorRoute = /^\/auth\/v1\/factors\/([^/]+)(\/challenge|\/verify)?$/.exec(url.pathname);
  if (factorRoute) {
    const who = await caller(req);
    const factor = await factorOf(req, who, factorRoute[1] ?? "");
    const action = factorRoute[2];

    if (action === "/challenge" && req.method === "POST") {
      await readJson(req);
      const id = randomUUID();
      await pool.query(
        `insert into auth.mfa_challenges (id, factor_id, created_at, ip_address) values ($1, $2, now(), '127.0.0.1')`,
        [id, factor.id],
      );
      await pool.query(
        "update auth.mfa_factors set last_challenged_at = clock_timestamp() where id = $1",
        [factor.id],
      );
      send(res, 200, {
        id,
        type: "totp",
        expires_at: Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS,
      });
      return true;
    }

    if (action === "/verify" && req.method === "POST") {
      const body = await readJson(req);
      const code = String(body.code ?? "").trim();
      if (!code) throw authError(req, 400, "validation_failed", "Code needs to be non-empty");
      const {
        rows: [challenge],
      } = await pool.query<{ verified: boolean; age: number }>(
        `select verified_at is not null as verified, extract(epoch from now() - created_at)::int as age
         from auth.mfa_challenges where id = $1 and factor_id = $2`,
        [String(body.challenge_id ?? ""), factor.id],
      );
      if (!challenge)
        throw authError(
          req,
          422,
          "mfa_factor_not_found",
          "MFA factor with the provided challenge ID not found",
        );
      if (challenge.verified) {
        throw authError(
          req,
          422,
          "mfa_ip_address_mismatch",
          "Challenge and verify IP addresses mismatch.",
        );
      }
      if (challenge.age > CHALLENGE_SECONDS) {
        await pool.query("delete from auth.mfa_challenges where id = $1", [body.challenge_id]);
        throw authError(
          req,
          422,
          "mfa_challenge_expired",
          `MFA challenge ${body.challenge_id} has expired, verify against another challenge or create a new challenge.`,
        );
      }
      const {
        rows: [used],
      } = await pool.query<{ step: string | null }>(
        `select max(otp_code::bigint)::text as step from auth.mfa_challenges
         where factor_id = $1 and verified_at is not null and otp_code ~ '^[0-9]+$'`,
        [factor.id],
      );
      const step = verifyTotp(
        factor.secret,
        code,
        Math.floor(Date.now() / 1000),
        used?.step ? Number(used.step) : null,
      );

      if ((await setting("mfa_verification_hook")) === "on") {
        const {
          rows: [decision],
        } = await pool.query<{ result: { decision?: string; message?: string } }>(
          "select public.hook_mfa_verification_attempt($1::jsonb) as result",
          [
            JSON.stringify({
              factor_id: factor.id,
              factor_type: "totp",
              user_id: who.user.id,
              valid: step !== null,
            }),
          ],
        );
        if (decision?.result.decision === "reject") {
          await pool.query("delete from auth.sessions where user_id = $1", [who.user.id]);
          throw authError(
            req,
            403,
            "mfa_verification_rejected",
            decision.result.message ?? "MFA verification rejected",
          );
        }
      }
      if (step === null)
        throw authError(req, 422, "mfa_verification_failed", "Invalid TOTP code entered");

      await pool.query(
        "update auth.mfa_challenges set verified_at = now(), otp_code = $2 where id = $1",
        [body.challenge_id, String(step)],
      );
      await pool.query(
        "update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1",
        [factor.id],
      );
      // Other half-finished enrolments go, as do the person's sessions that
      // never passed the second step.
      await pool.query(
        "delete from auth.mfa_factors where user_id = $1 and status = 'unverified' and factor_type = 'totp' and id <> $2",
        [who.user.id, factor.id],
      );
      await pool.query(
        "delete from auth.sessions where user_id = $1 and id <> $2 and aal = 'aal1'",
        [who.user.id, who.session.id],
      );
      await pool.query("update auth.sessions set aal = 'aal2', factor_id = $2 where id = $1", [
        who.session.id,
        factor.id,
      ]);
      await addMethod(who.session.id, "totp");
      // The tokens held before the second step cannot be refreshed into aal2 ones.
      await pool.query(
        "update auth.refresh_tokens set revoked = true, updated_at = now() - interval '1 hour' where session_id = $1",
        [who.session.id],
      );
      if (factor.status === "unverified") {
        await sendMail(who.user.email, "mfa_factor_enrolled_notification", { FactorType: "totp" });
      }
      send(res, 200, await issueTokens(who.user, who.session.id, null));
      return true;
    }

    if (!action && req.method === "DELETE") {
      if (factor.status === "verified" && who.session.aal !== "aal2") {
        throw authError(req, 422, "insufficient_aal", "AAL2 required to unenroll verified factor");
      }
      await pool.query("delete from auth.mfa_factors where id = $1", [factor.id]);
      if (!(await hasVerifiedFactor(who.user.id))) {
        await pool.query(
          "update auth.sessions set aal = 'aal1', factor_id = null where user_id = $1",
          [who.user.id],
        );
        await pool.query(
          "delete from auth.mfa_amr_claims where authentication_method = 'totp' and session_id in (select id from auth.sessions where user_id = $1)",
          [who.user.id],
        );
      }
      if (factor.status === "verified") {
        await sendMail(who.user.email, "mfa_factor_unenrolled_notification", {
          FactorType: "totp",
        });
      }
      send(res, 200, { id: factor.id });
      return true;
    }
  }

  return false;
};
