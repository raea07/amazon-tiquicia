/**
 * The rules the four web apps apply around signing in and sessions, as pure
 * functions so they are unit-tested (guard.test.ts) without a server:
 *
 *   - which request header may be trusted for the visitor's address (WEB-2);
 *   - the keyed hashes the sign-in limit stores instead of addresses and
 *     e-mails, and the "this browser signed in before" cookie (WEB-2);
 *   - which server-only keys are acceptable outside a local run (WEB-8);
 *   - how long a session lives in each app, and when it has ended (WEB-5);
 *   - what the person is told when the limit is reached.
 *
 * The server code that uses them is in server/auth-guard.ts and server/proxy.ts.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

type Env = Record<string, string | undefined>;

// ── Local or deployed ───────────────────────────────────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * True only on a developer's machine or in CI: not on Vercel, and talking to an
 * API on this machine (a deployment never does), with this site, when it says
 * where it is, also on this machine. Anything uncertain counts as deployed, so
 * a missing setting makes the checks stricter, never looser.
 */
export function isLocalRun(env: Env): boolean {
  if (env.VERCEL) return false;
  const api = hostOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!api || !LOOPBACK.has(api)) return false;
  const site = env.NEXT_PUBLIC_SITE_URL;
  return site === undefined || site === "" || LOOPBACK.has(hostOf(site) ?? "");
}

// ── Server-only keys ────────────────────────────────────────────────────────

/**
 * Values that appear in this repository (the .env.example files, the local
 * stack, the documentation). Anyone can read them, so no deployment may use
 * them. Compared without case.
 */
export const EXAMPLE_SECRETS = [
  "local-development-only",
  "local-development-only-auth-guard",
  "change-me",
  "changeme",
  "replace-me",
  "secret",
] as const;
const EXAMPLE_PATTERNS = [/^local-[a-z-]*key-lane-\d+$/i, /^sb_publishable_/i, /^sb_secret_/i];

/** A deployed key must be at least this long: 32 characters, e.g. `openssl rand -hex 32` gives 64. */
export const MIN_SECRET_LENGTH = 32;

export type SecretCheck = { ok: true; value: string } | { ok: false; reason: string };

/**
 * Whether a server-only key may be used. Locally any value is accepted (the
 * stack and CI use readable ones on purpose). Anywhere else: refused when
 * missing, shorter than MIN_SECRET_LENGTH, or one of the example values. The
 * reason is for the log and never names the value.
 */
export function checkSecret(name: string, value: string | undefined, env: Env): SecretCheck {
  const given = value?.trim() ?? "";
  if (isLocalRun(env)) {
    return given ? { ok: true, value: given } : { ok: false, reason: `${name} is not set` };
  }
  if (!given) return { ok: false, reason: `${name} is not set` };
  if (given.length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: `${name} is shorter than ${MIN_SECRET_LENGTH} characters` };
  }
  const lower = given.toLowerCase();
  if (
    (EXAMPLE_SECRETS as readonly string[]).includes(lower) ||
    EXAMPLE_PATTERNS.some((pattern) => pattern.test(given))
  ) {
    return { ok: false, reason: `${name} is an example value from the repository` };
  }
  return { ok: true, value: given };
}

/** The key the sign-in limit and the session cookies are signed with. */
export const LOCAL_GUARD_KEY = "local-development-only-auth-guard";

export function guardKey(env: Env): SecretCheck {
  const check = checkSecret("AUTH_GUARD_KEY", env.AUTH_GUARD_KEY, env);
  // On a developer's machine the apps work without setting it.
  if (!check.ok && isLocalRun(env)) return { ok: true, value: LOCAL_GUARD_KEY };
  return check;
}

// ── The visitor's address ───────────────────────────────────────────────────

/**
 * The visitor's address as the limit counts it, or null when no header can be
 * trusted. Normalised: an IPv4 address as is (also when written as IPv6), an
 * IPv6 address cut to its /64 network, because one subscriber is given a whole
 * /64 and could otherwise change address at every attempt.
 */
export function normaliseAddress(raw: string | null | undefined): string | null {
  let value = raw?.trim() ?? "";
  if (value.startsWith("[")) value = value.slice(1, value.indexOf("]"));
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped?.[1]) value = mapped[1];
  const kind = isIP(value);
  if (kind === 4) return value;
  if (kind !== 6) return null;
  return `${expandIpv6(value).slice(0, 4).join(":")}::/64`;
}

function expandIpv6(value: string): string[] {
  const [head = "", tail = ""] = value.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = value.includes("::") ? 8 - left.length - right.length : 0;
  return [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) =>
    part.padStart(4, "0"),
  );
}

/**
 * Which header says who the visitor is, decided by where the app runs:
 *
 *   - On Vercel (`VERCEL` is set): `x-vercel-forwarded-for`, which Vercel's
 *     edge writes itself and which another proxy in front cannot replace, then
 *     `x-real-ip`. Vercel overwrites both; a value sent by the visitor never
 *     reaches the app.
 *   - Elsewhere, only what the operator names: `AUTH_CLIENT_IP_HEADER` (for
 *     example `x-forwarded-for` behind one load balancer) and
 *     `AUTH_CLIENT_IP_HOPS`, how many proxies of yours add an entry to it
 *     (default 1: the last entry, written by the proxy closest to the app).
 *     Entries further left were written by the visitor and are never used.
 *   - Otherwise none: the limit then counts per account only, rather than
 *     putting every visitor in one shared bucket (which is the outage WEB-2
 *     describes).
 */
export function clientAddress(headers: Headers, env: Env): string | null {
  if (env.VERCEL) {
    const first = (name: string) => headers.get(name)?.split(",")[0];
    return (
      normaliseAddress(first("x-vercel-forwarded-for")) ?? normaliseAddress(first("x-real-ip"))
    );
  }
  const name = env.AUTH_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name) return null;
  const entries = (headers.get(name) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const hops = Math.max(1, Number.parseInt(env.AUTH_CLIENT_IP_HOPS ?? "1", 10) || 1);
  return normaliseAddress(entries[entries.length - hops]);
}

// ── Keyed hashes ────────────────────────────────────────────────────────────

const hmac = (key: string, text: string) => createHmac("sha256", key).update(text).digest("hex");

/** What the database stores for an address: never the address itself. */
export const addressHash = (key: string, address: string) => hmac(key, `address:${address}`);

/**
 * What the database stores for an account: the e-mail typed, normalised, so
 * an address with an account and one without are counted the same way.
 */
export const accountHash = (key: string, email: string) =>
  hmac(key, `account:${email.trim().toLowerCase()}`);

/** For a signed-in person asked for their password again: their account id. */
export const userHash = (key: string, userId: string) => hmac(key, `user:${userId}`);

// ── "This browser signed in to this account before" ─────────────────────────

export const KNOWN_DEVICE_COOKIE = "yt-dispositivo";
/** Up to this many accounts per browser (a shared family computer). */
const KNOWN_DEVICE_MAX = 3;

const deviceMark = (key: string, account: string) => hmac(key, `device:${account}`).slice(0, 32);

/**
 * Whether the cookie names this account: the account limit is then skipped,
 * so someone guessing the owner's password elsewhere cannot lock the owner out
 * of the browser they always use. The cookie holds only signatures; it says
 * nothing about the account to someone who reads it.
 */
export function isKnownDevice(key: string, cookie: string | undefined, account: string): boolean {
  if (!cookie) return false;
  const expected = Buffer.from(deviceMark(key, account));
  return cookie
    .split(".")
    .slice(0, KNOWN_DEVICE_MAX)
    .some((mark) => {
      const given = Buffer.from(mark);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

/** The cookie's new value after a successful sign-in to `account`. */
export function rememberDevice(key: string, cookie: string | undefined, account: string): string {
  const mark = deviceMark(key, account);
  const others = (cookie ?? "")
    .split(".")
    .filter((entry) => /^[0-9a-f]{32}$/.test(entry) && entry !== mark);
  return [mark, ...others].slice(0, KNOWN_DEVICE_MAX).join(".");
}

// ── What the person is told ─────────────────────────────────────────────────

/** "45 segundos", "1 minuto", "15 minutos" (the same words as the second factor's limit). */
export function waitWords(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

export type LimitedAction = "sign_in" | "sign_up" | "email" | "code" | "reauth";

/**
 * The message when the limit is reached. The same words whether or not the
 * e-mail has an account, and whether the visitor's address or the account
 * reached it: the answer must not tell a stranger anything.
 */
export function limitMessage(action: LimitedAction, retryAfterSeconds: number): string {
  const wait = waitWords(Math.max(1, retryAfterSeconds));
  switch (action) {
    case "sign_in":
      return `Hubo demasiados intentos de ingreso. Por seguridad, espere ${wait} y vuelva a intentarlo. Si no recuerda la contraseña, puede restablecerla con «Olvidé mi contraseña».`;
    case "sign_up":
      return `Hubo demasiados intentos de crear una cuenta. Por seguridad, espere ${wait} y vuelva a intentarlo.`;
    case "email":
      return `Ya pidió varios correos. Por seguridad, espere ${wait} antes de pedir otro, y revise también el correo no deseado.`;
    case "code":
      return `Hubo demasiados códigos equivocados. Por seguridad, espere ${wait} y vuelva a intentarlo, o pida un correo nuevo.`;
    case "reauth":
      return `Hubo demasiados intentos con la contraseña actual. Por seguridad, espere ${wait} y vuelva a intentarlo.`;
  }
}

// ── Session lifetimes ───────────────────────────────────────────────────────

export type AppName = "web" | "seller" | "ops" | "field";

export interface SessionPolicy {
  /** From signing in: after this the session ends, however active it was. */
  maxAgeSeconds: number;
  /** Without a request for this long the session ends (only where set). */
  idleSeconds: number | null;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/**
 * How long a session lives in each app (decisions.md, "Session lifetimes per
 * app"). Auth's own access token lasts one hour and is renewed with the
 * refresh token; these limits end the session, refresh token included, on top.
 */
export const SESSION_POLICIES: Record<AppName, SessionPolicy> = {
  // Shoppers: a personal phone or computer; signing in again every season is enough.
  web: { maxAgeSeconds: 90 * DAY, idleSeconds: null },
  // Sellers: money and payout requests behind it, usually an own device.
  seller: { maxAgeSeconds: 30 * DAY, idleSeconds: null },
  // Staff: one working day at most, and half an hour away from the desk ends it.
  ops: { maxAgeSeconds: 12 * HOUR, idleSeconds: 30 * 60 },
  // Drivers and the warehouse, on shared handhelds: one shift.
  field: { maxAgeSeconds: 12 * HOUR, idleSeconds: null },
};

export function sessionPolicy(app: string | undefined): SessionPolicy {
  // An app that does not say which it is gets the strictest rule.
  return SESSION_POLICIES[(app ?? "") as AppName] ?? SESSION_POLICIES.ops;
}

/** When this session's person last signed in or passed a step, from Auth's signed `amr` claim. */
export function signedInAt(claims: { amr?: unknown }): number | null {
  const methods = Array.isArray(claims.amr) ? claims.amr : [];
  const times = methods
    .map((entry: unknown) => (entry as { timestamp?: unknown } | null)?.timestamp)
    .filter((time): time is number => typeof time === "number" && Number.isFinite(time));
  // The first step of this session (the password); a second factor comes later.
  return times.length > 0 ? Math.min(...times) : null;
}

export const ACTIVITY_COOKIE = "yt-actividad";
/** Set when the proxy ended a session, so sign-in can say why. */
export const ENDED_COOKIE = "yt-sesion";

const activityMark = (key: string, sessionId: string, at: number) =>
  hmac(key, `activity:${sessionId}:${at}`).slice(0, 32);

/** The activity cookie's value: the time of the last request, signed for this session. */
export const activityValue = (key: string, sessionId: string, at: number) =>
  `${at}.${activityMark(key, sessionId, at)}`;

/** The time in a genuine activity cookie of this session, or null. */
export function readActivity(
  key: string,
  sessionId: string,
  value: string | undefined,
): number | null {
  const [time, mark] = (value ?? "").split(".");
  const at = Number(time);
  if (!Number.isInteger(at) || !mark) return null;
  const expected = Buffer.from(activityMark(key, sessionId, at));
  const given = Buffer.from(mark);
  return given.length === expected.length && timingSafeEqual(given, expected) ? at : null;
}

export type SessionVerdict = "ok" | "expired" | "idle";

/**
 * Whether a verified session may go on. Fails closed: a session without a
 * sign-in time is treated as expired.
 */
export function sessionVerdict(
  policy: SessionPolicy,
  started: number | null,
  lastActivity: number | null,
  now: number,
): SessionVerdict {
  if (started === null || now - started > policy.maxAgeSeconds) return "expired";
  if (policy.idleSeconds !== null && now - (lastActivity ?? started) > policy.idleSeconds) {
    return "idle";
  }
  return "ok";
}

/** What the sign-in page says after the proxy ended a session. */
export function endedSessionMessage(reason: string | undefined): string | null {
  if (reason === "idle") {
    return "Cerramos su sesión porque pasó un rato sin actividad. Ingrese de nuevo para seguir donde estaba.";
  }
  if (reason === "expired") {
    return "Su sesión llegó al tiempo máximo y la cerramos por seguridad. Ingrese de nuevo para seguir donde estaba.";
  }
  return null;
}
