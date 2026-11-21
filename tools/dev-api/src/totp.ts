/**
 * Time-based one-time codes (RFC 6238), as Supabase Auth checks them:
 * HMAC-SHA1, 6 digits, 30-second steps, accepting the step before and after
 * the current one; secrets are 20 random bytes in base32 without padding
 * (docs/research/supabase-auth-storage-wire-format.md, section 2.6).
 *
 * The stand-in additionally refuses a code from a step that was already used
 * for the same factor, so a code read over someone's shoulder cannot be
 * replayed. Whether the real server does the same within its window is not
 * documented; the apps do not depend on it.
 */

import { createHmac, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, base32, no padding (32 characters). */
export const newSecret = () => base32Encode(randomBytes(20));

/** RFC 4226: the code for one counter value. */
export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (unixSeconds: number) => Math.floor(unixSeconds / STEP_SECONDS);

/** The code an authenticator app shows at `unixSeconds`. */
export function totpCode(secret: string, unixSeconds: number, digits = DIGITS): string {
  return hotp(base32Decode(secret), stepAt(unixSeconds), digits);
}

/**
 * Checks a code. Returns the step it matched, or null when it is wrong, out of
 * the window, or from a step at or before `lastUsedStep`.
 */
export function verifyTotp(
  secret: string,
  code: string,
  unixSeconds: number,
  lastUsedStep: number | null = null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const now = stepAt(unixSeconds);
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (hotp(key, step) === code) return step;
  }
  return null;
}

export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?algorithm=SHA1&digits=6&issuer=${encodeURIComponent(issuer)}&period=30&secret=${secret}`;
}
