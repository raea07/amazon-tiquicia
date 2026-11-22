/**
 * A throwaway RSA key and self-signed certificate, made on the spot with
 * WebCrypto, for tests and the local stack. Never a real key: nothing signed
 * with it means anything to Hacienda, and it exists only in memory.
 */

import { type Certificate, parseCertificate } from "../certificate.ts";
import { buffer, bytesToBase64, type WebCryptoKey, type WebCryptoKeyPair } from "../der.ts";

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

function tlv(tag: number, value: Uint8Array): Uint8Array {
  const length = value.length;
  const header =
    length < 0x80
      ? [tag, length]
      : length < 0x100
        ? [tag, 0x81, length]
        : [tag, 0x82, length >> 8, length & 0xff];
  return concat(new Uint8Array(header), value);
}

const seq = (...parts: Uint8Array[]) => tlv(0x30, concat(...parts));
const set = (...parts: Uint8Array[]) => tlv(0x31, concat(...parts));

function oid(dotted: string): Uint8Array {
  const [a = 0, b = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [a * 40 + b];
  for (const n of rest) {
    const chunk: number[] = [];
    let value = n;
    do {
      chunk.unshift(value & 0x7f);
      value = Math.floor(value / 128);
    } while (value > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] = (chunk[i] ?? 0) | 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, new Uint8Array(bytes));
}

function integer(value: bigint): Uint8Array {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  if (Number.parseInt(hex.slice(0, 2), 16) & 0x80) hex = `00${hex}`;
  return tlv(0x02, new Uint8Array(hex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? [0]));
}

const utf8 = (text: string) => tlv(0x0c, new TextEncoder().encode(text));
const printable = (text: string) => tlv(0x13, new TextEncoder().encode(text));

function utcTime(at: Date): Uint8Array {
  const p = (n: number) => String(n).padStart(2, "0");
  const text = `${p(at.getUTCFullYear() % 100)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(text));
}

const SHA256_RSA = seq(oid("1.2.840.113549.1.1.11"), new Uint8Array([0x05, 0x00]));

export interface TestSigner {
  key: WebCryptoKey;
  publicKey: WebCryptoKey;
  certificate: Certificate;
  certificatePem: string;
}

/**
 * A new key pair and a certificate for it. The issuer imitates the shape of
 * Hacienda's test certificates (CN, OU, O, C); the values are invented.
 */
export async function throwawaySigner(
  options: { modulusLength?: 2048 | 4096; serial?: bigint; validDays?: number; now?: Date } = {},
): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: options.modulusLength ?? 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as WebCryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const now = options.now ?? new Date();
  const until = new Date(now.getTime() + (options.validDays ?? 365) * 86_400_000);
  const name = seq(
    set(seq(oid("2.5.4.6"), printable("CR"))),
    set(seq(oid("2.5.4.10"), utf8("PRUEBAS LOCALES, SIN VALOR"))),
    set(seq(oid("2.5.4.11"), utf8("YUNTERA DESARROLLO"))),
    set(seq(oid("2.5.4.3"), utf8("CA DE PRUEBA, NO ES DE HACIENDA"))),
  );
  const tbs = seq(
    tlv(0xa0, integer(2n)),
    integer(options.serial ?? 0x1f2e3d4c5b6a7980n),
    SHA256_RSA,
    name,
    seq(utcTime(now), utcTime(until)),
    name,
    spki,
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, buffer(tbs)),
  );
  const der = seq(tbs, SHA256_RSA, tlv(0x03, concat(new Uint8Array([0]), signature)));
  const pem = `-----BEGIN CERTIFICATE-----\n${bytesToBase64(der)
    .match(/.{1,64}/g)
    ?.join("\n")}\n-----END CERTIFICATE-----\n`;
  return {
    key: pair.privateKey,
    publicKey: pair.publicKey,
    certificate: parseCertificate(der),
    certificatePem: pem,
  };
}

/** The private key of a test signer as a PKCS#8 PEM (only possible because it is extractable). */
export async function privateKeyPem(key: WebCryptoKey): Promise<string> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key));
  return `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)
    .match(/.{1,64}/g)
    ?.join("\n")}\n-----END PRIVATE KEY-----\n`;
}
