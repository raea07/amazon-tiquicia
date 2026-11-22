/**
 * ONVO's webhook signature, exactly as the research note documents it (§6.6,
 * from https://docs.onvopay.com/en/webhooks/verify-signatures):
 *
 *   X-Onvo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>[,v1=<hex>]
 *   signed string:    "<t>" + "." + <raw body, exactly as received>
 *   key:              the whole "whsec_…" secret as UTF-8 text
 *
 * Refused when `t` is missing or not an integer, more than 300 seconds from
 * our clock, or no `v1` value matches. During a secret rotation the gateway
 * sends two `v1` values (one per secret) and we may hold two secrets: any
 * pair that matches is enough. A replay inside the 300 seconds is stopped by
 * the database, which applies each event id once.
 */

const encoder = new TextEncoder();

export const TOLERANCE_SECONDS = 300;

export type SignatureVerdict =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "bad_signature" | "no_secret" };

async function hmacHex(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret) as Uint8Array<ArrayBuffer>,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

function fromHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function verifyOnvoSignature(
  rawBody: string,
  header: string | null,
  secrets: string[],
  nowSeconds: number,
): Promise<SignatureVerdict> {
  if (!header) return { ok: false, reason: "missing" };
  const usable = secrets.map((secret) => secret.trim()).filter(Boolean);
  if (usable.length === 0) return { ok: false, reason: "no_secret" };

  let timestamp: string | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") candidates.push(value);
  }
  if (timestamp === null || !/^\d{1,12}$/.test(timestamp) || candidates.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const t = Number(timestamp);
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const offered = candidates.map(fromHex).filter((value): value is Uint8Array => value !== null);
  for (const secret of usable) {
    const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
    if (offered.some((candidate) => constantTimeEqual(candidate, expected))) {
      return { ok: true, timestamp: t };
    }
  }
  return { ok: false, reason: "bad_signature" };
}

/**
 * Signs a body the way ONVO does. Used by the local fake and the tests; with
 * several secrets it sends one `v1` per secret, as ONVO does while rotating.
 */
export async function signOnvoWebhook(
  rawBody: string,
  secrets: string[],
  timestampSeconds: number,
): Promise<string> {
  const parts = [`t=${timestampSeconds}`];
  for (const secret of secrets) {
    parts.push(`v1=${toHex(await hmacHex(secret, `${timestampSeconds}.${rawBody}`))}`);
  }
  return parts.join(",");
}
