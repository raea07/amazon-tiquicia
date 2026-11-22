/**
 * The signing material: the X.509 certificate of Hacienda's "llave
 * criptográfica" (or a BCCR certificate) and its RSA private key.
 *
 * The key arrives from the server-side environment as PKCS#8 PEM, either
 * plain or encrypted with the key's PIN (PBES2: PBKDF2 with HMAC-SHA-256 or
 * HMAC-SHA-1, AES-CBC). Hacienda hands out a PKCS#12 (.p12) file; it is
 * converted once, at provisioning, as docs/06-operations/invoicing.md says,
 * because old .p12 files use ciphers WebCrypto does not have (research note
 * 4.2). The key is imported as non-extractable and never leaves this module.
 */

import {
  buffer,
  bytesToBase64,
  children,
  oid,
  pemBody,
  readTlv,
  unsignedInteger,
  type WebCryptoKey,
} from "./der.ts";

export interface Certificate {
  der: Uint8Array;
  /** Base64 of the DER, as KeyInfo/X509Data/X509Certificate carries it. */
  base64: string;
  /** Decimal, as X509SerialNumber carries it. */
  serialNumber: string;
  /** RFC 4514 form, as X509IssuerName carries it. */
  issuerName: string;
  subjectName: string;
  notBefore: Date;
  notAfter: Date;
}

const ATTRIBUTE_NAME: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.9": "STREET",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.5": "SERIALNUMBER",
  "2.5.4.4": "SN",
  "2.5.4.42": "GIVENNAME",
  "0.9.2342.19200300.100.1.25": "DC",
  "0.9.2342.19200300.100.1.1": "UID",
};

/** String types a DirectoryString can be in; anything else is written as #hex. */
const STRING_TAGS = new Set([0x0c, 0x13, 0x16, 0x14, 0x1e]);

function escapeRdnValue(value: string): string {
  let out = value.replace(/[\\,+"<>;=]/g, (c) => `\\${c}`);
  if (out.startsWith("#") || out.startsWith(" ")) out = `\\${out}`;
  if (out.endsWith(" ")) out = `${out.slice(0, -1)}\\ `;
  return out;
}

function decodeString(tag: number, bytes: Uint8Array): string {
  if (tag === 0x1e) {
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    }
    return s;
  }
  return new TextDecoder(tag === 0x0c ? "utf-8" : "latin1").decode(bytes);
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A Name as RFC 4514 writes it: the last RDN first, `CN=…,O=…,C=CR`. */
function nameToString(name: ReturnType<typeof readTlv>): string {
  const rdns = children(name).map((set) =>
    children(set)
      .map((pair) => {
        const [type, value] = children(pair);
        if (!type || !value) throw new Error("certificate: malformed name");
        const id = oid(type.value);
        const label = ATTRIBUTE_NAME[id] ?? id;
        const text =
          ATTRIBUTE_NAME[id] && STRING_TAGS.has(value.tag)
            ? escapeRdnValue(decodeString(value.tag, value.value))
            : `#${hex(value.raw)}`;
        return `${label}=${text}`;
      })
      .join("+"),
  );
  return rdns.reverse().join(",");
}

function readTime(tlv: ReturnType<typeof readTlv>): Date {
  const text = new TextDecoder("latin1").decode(tlv.value);
  const match =
    tlv.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match) throw new Error("certificate: unsupported time");
  const [, y, mo, d, h, mi, s] = match;
  let year = Number(y);
  if (tlv.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

export function parseCertificate(input: string | Uint8Array): Certificate {
  const der =
    typeof input === "string"
      ? (pemBody(input, "CERTIFICATE") ??
        (() => {
          throw new Error("certificate: no PEM CERTIFICATE block");
        })())
      : input;
  const certificate = readTlv(der);
  const [tbs] = children(certificate);
  if (!tbs) throw new Error("certificate: malformed");
  const fields = children(tbs);
  // The version is an explicit [0] tag before the serial number, when present.
  const offset = fields[0]?.tag === 0xa0 ? 1 : 0;
  const serial = fields[offset];
  const issuer = fields[offset + 2];
  const validity = fields[offset + 3];
  const subject = fields[offset + 4];
  if (!serial || !issuer || !validity || !subject) throw new Error("certificate: malformed");
  const [notBefore, notAfter] = children(validity);
  if (!notBefore || !notAfter) throw new Error("certificate: malformed validity");
  return {
    der,
    base64: bytesToBase64(der),
    serialNumber: unsignedInteger(serial.value).toString(10),
    issuerName: nameToString(issuer),
    subjectName: nameToString(subject),
    notBefore: readTime(notBefore),
    notAfter: readTime(notAfter),
  };
}

const PBES2 = "1.2.840.113549.1.5.13";
const PBKDF2 = "1.2.840.113549.1.5.12";
const PRF: Record<string, string> = {
  "1.2.840.113549.2.7": "SHA-1",
  "1.2.840.113549.2.9": "SHA-256",
  "1.2.840.113549.2.11": "SHA-512",
};
const AES_CBC: Record<string, number> = {
  "2.16.840.1.101.3.4.1.2": 128,
  "2.16.840.1.101.3.4.1.22": 192,
  "2.16.840.1.101.3.4.1.42": 256,
};

/** Decrypts an EncryptedPrivateKeyInfo (PBES2 + PBKDF2 + AES-CBC) with the PIN. */
async function decryptPkcs8(der: Uint8Array, pin: string): Promise<Uint8Array> {
  const [algorithm, encrypted] = children(readTlv(der));
  if (!algorithm || !encrypted) throw new Error("signing key: malformed");
  const [scheme, params] = children(algorithm);
  if (!scheme || !params || oid(scheme.value) !== PBES2) {
    throw new Error("signing key: only PBES2 encryption is supported; see the invoicing runbook");
  }
  const [kdf, cipher] = children(params);
  if (!kdf || !cipher) throw new Error("signing key: malformed PBES2 parameters");
  const [kdfId, kdfParams] = children(kdf);
  if (!kdfId || !kdfParams || oid(kdfId.value) !== PBKDF2) {
    throw new Error("signing key: only PBKDF2 is supported");
  }
  const kdfFields = children(kdfParams);
  const salt = kdfFields[0];
  const iterations = kdfFields[1];
  if (!salt || !iterations) throw new Error("signing key: malformed PBKDF2 parameters");
  const prfField = kdfFields.find((field) => field.tag === 0x30);
  const prfId = prfField ? children(prfField)[0] : undefined;
  const hash = prfId ? PRF[oid(prfId.value)] : "SHA-1";
  if (!hash) throw new Error("signing key: unsupported PBKDF2 hash");
  const [cipherId, iv] = children(cipher);
  const bits = cipherId ? AES_CBC[oid(cipherId.value)] : undefined;
  if (!bits || !iv) throw new Error("signing key: only AES-CBC is supported");

  const password = await crypto.subtle.importKey(
    "raw",
    buffer(new TextEncoder().encode(pin)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: buffer(salt.value),
      iterations: Number(unsignedInteger(iterations.value)),
      hash,
    },
    password,
    { name: "AES-CBC", length: bits },
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: buffer(iv.value) },
      key,
      buffer(encrypted.value),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error("signing key: the PIN does not open the key");
  }
}

/**
 * Imports the RSA private key for RSASSA-PKCS1-v1_5 with SHA-256, as a
 * non-extractable key. `pin` is required for an encrypted key.
 */
export async function importSigningKey(pem: string, pin?: string): Promise<WebCryptoKey> {
  const encrypted = pemBody(pem, "ENCRYPTED PRIVATE KEY");
  const plain = pemBody(pem, "PRIVATE KEY");
  let pkcs8: Uint8Array;
  if (encrypted) {
    if (!pin) throw new Error("signing key: the key is encrypted and no PIN was given");
    pkcs8 = await decryptPkcs8(encrypted, pin);
  } else if (plain) {
    pkcs8 = plain;
  } else {
    throw new Error(
      "signing key: expected a PKCS#8 PEM (BEGIN PRIVATE KEY or ENCRYPTED PRIVATE KEY)",
    );
  }
  return crypto.subtle.importKey(
    "pkcs8",
    buffer(pkcs8),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
