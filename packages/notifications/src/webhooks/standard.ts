/**
 * Standard Webhooks signatures (https://www.standardwebhooks.com), used by both
 * Bird's webhooks and Supabase Auth's Send Email Hook (research note 1.6 and
 * 3.3):
 *
 *   webhook-signature: "v1,<base64 HMAC-SHA256(key, `${id}.${timestamp}.${raw body}`)>"
 *
 * where key is the base64-decoded secret after "whsec_" (and "v1," for
 * Supabase's format). Always verified over the raw body bytes, never over
 * re-serialised JSON. Replays inside the five-minute window are stopped by
 * the database, which applies each webhook id once.
 */

const encoder = new TextEncoder();

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function secretKey(secret: string): Uint8Array {
  return fromBase64(
    secret
      .trim()
      .replace(/^v1,/, "")
      .replace(/^whsec_/, ""),
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as Uint8Array<ArrayBuffer>,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
}

export type VerifyOutcome =
  | { ok: true; id: string; timestamp: number }
  | { ok: false; reason: "missing_headers" | "stale" | "bad_signature" | "no_secret" };

export const TOLERANCE_SECONDS = 300;

export async function verifyStandardWebhook(
  rawBody: string,
  headers: Headers,
  secrets: string[],
  nowMs = Date.now(),
): Promise<VerifyOutcome> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");
  if (!id || !ts || !signature || !/^\d{1,12}$/.test(ts))
    return { ok: false, reason: "missing_headers" };
  if (secrets.length === 0) return { ok: false, reason: "no_secret" };
  const timestamp = Number(ts);
  if (Math.abs(nowMs / 1000 - timestamp) > TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const offered: Uint8Array[] = [];
  for (const part of signature.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    try {
      offered.push(fromBase64(part.slice(3)));
    } catch {
      // a malformed entry simply does not match
    }
  }
  for (const secret of secrets) {
    let key: Uint8Array;
    try {
      key = secretKey(secret);
    } catch {
      continue;
    }
    const expected = await hmac(key, `${id}.${ts}.${rawBody}`);
    if (offered.some((candidate) => constantTimeEqual(candidate, expected))) {
      return { ok: true, id, timestamp };
    }
  }
  return { ok: false, reason: "bad_signature" };
}

/** Signs a body the way a provider does. Used by the local fake and the tests. */
export async function signStandardWebhook(
  rawBody: string,
  secret: string,
  id: string,
  timestampSeconds: number,
): Promise<Record<string, string>> {
  const mac = await hmac(secretKey(secret), `${id}.${timestampSeconds}.${rawBody}`);
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestampSeconds),
    "webhook-signature": `v1,${toBase64(mac)}`,
  };
}
