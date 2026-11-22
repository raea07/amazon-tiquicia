/**
 * Just enough DER (the binary form of ASN.1) to read the signing certificate
 * (its serial number, issuer and validity, which the XAdES SigningCertificate
 * and the expiry alert need) and an encrypted PKCS#8 private key. Reading
 * only; nothing here is cryptography, which stays with WebCrypto.
 */

export interface Tlv {
  tag: number;
  /** Offset of the value within the buffer. */
  start: number;
  end: number;
  /** The whole element, header included. */
  raw: Uint8Array;
  value: Uint8Array;
}

export function readTlv(bytes: Uint8Array, offset = 0): Tlv {
  const tag = bytes[offset];
  let lengthByte = bytes[offset + 1];
  if (tag === undefined || lengthByte === undefined) throw new Error("DER: truncated");
  let position = offset + 2;
  let length = lengthByte;
  if (lengthByte & 0x80) {
    const count = lengthByte & 0x7f;
    if (count === 0 || count > 4) throw new Error("DER: unsupported length");
    length = 0;
    for (let i = 0; i < count; i++) {
      lengthByte = bytes[position++];
      if (lengthByte === undefined) throw new Error("DER: truncated");
      length = length * 256 + lengthByte;
    }
  }
  const end = position + length;
  if (end > bytes.length) throw new Error("DER: truncated");
  return {
    tag,
    start: position,
    end,
    raw: bytes.subarray(offset, end),
    value: bytes.subarray(position, end),
  };
}

/** The elements inside a constructed value (SEQUENCE, SET, [n]). */
export function children(tlv: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let offset = 0;
  while (offset < tlv.value.length) {
    const child = readTlv(tlv.value, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

export function oid(bytes: Uint8Array): string {
  const first = bytes[0] ?? 0;
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

export function unsignedInteger(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  return value;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The base64 body of a PEM block with the given label, as bytes. */
export function pemBody(pem: string, label: string): Uint8Array | null {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`).exec(pem);
  return match?.[1] ? base64ToBytes(match[1]) : null;
}

/** WebCrypto's key type, named without depending on the DOM or Node type libraries. */
export type WebCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
export type WebCryptoKeyPair = { privateKey: WebCryptoKey; publicKey: WebCryptoKey };

/** A copy that WebCrypto accepts as a BufferSource whatever the runtime's typing. */
export const buffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
