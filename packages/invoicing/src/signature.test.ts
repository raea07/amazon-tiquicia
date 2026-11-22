/**
 * The signature against the annex (Anexo 2; research note 4.1), checked with
 * a throwaway key made in the test. The digests and the signature value are
 * recomputed independently: the canonical forms come from libxml2 (xmllint
 * --exc-c14n), not from this package, and the RSA check from Node's own
 * crypto with the public key read out of the embedded certificate.
 *
 * What this cannot show: that Hacienda's validator accepts it. That needs the
 * sandbox credentials (docs/06-operations/invoicing.md, "Before going live").
 */

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
  X509Certificate,
} from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalize } from "./c14n.ts";
import { importSigningKey, parseCertificate } from "./certificate.ts";
import { SIGNATURE_POLICY } from "./codes.ts";
import type { WebCryptoKeyPair } from "./der.ts";
import { buildDocument } from "./document.ts";
import { ALGORITHM, type Signer, signDocument, XADES_NAMESPACE } from "./signature.ts";
import { privateKeyPem, type TestSigner, throwawaySigner } from "./testing/certificate.ts";
import { lineFromGross, sampleDocument } from "./testing/samples.ts";
import { exclusiveC14n, schemaErrors } from "./testing/xmllint.ts";

const DS = "http://www.w3.org/2000/09/xmldsig#";

let test: TestSigner;
let signer: Signer;
let xml: string;

const doc = () =>
  sampleDocument({
    type: "04",
    sequence: 1532,
    issuedAt: new Date("2026-11-22T03:30:00Z"),
    lines: [
      lineFromGross(1, {
        cabys: "6803000000000",
        unit: "Os",
        description: 'Entrega a domicilio pedido YT-000123 & "pronto" <hoy>',
        grossMinor: 250_000,
      }),
    ],
  });

beforeAll(async () => {
  test = await throwawaySigner({ serial: 0x00f1e2d3c4b5a69788n });
  signer = { key: test.key, certificate: test.certificate, certificateDigest: "sha256" };
  xml = await signDocument(buildDocument(doc()), signer, {
    signedAt: new Date("2026-11-22T03:30:05.123Z"),
    id: "0b5a7f0e-3c1d-4f5e-9a8b-7c6d5e4f3a2b",
  });
});

const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`not found: ${start}`);
  return text.slice(from, to + end.length);
};
const value = (text: string, tag: string) =>
  new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(text)?.[1];
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
/** Gives a fragment the declarations it inherits, so libxml2 can canonicalize it alone. */
const standalone = (fragment: string, declarations: string) =>
  fragment.replace(/^<([^\s>]+)/, `<$1 ${declarations}`);

describe("XAdES-EPES signature (annex, Anexo 2)", () => {
  it("is enveloped: ds:Signature is the last child of the root, and the result validates", () => {
    expect(xml.trimEnd().endsWith("</ds:Signature></TiqueteElectronico>")).toBe(true);
    expect(xml.match(/<ds:Signature[ >]/g)?.length).toBe(1);
    expect(schemaErrors(xml, "04")).toEqual([]);
  });

  it("names the algorithms and references the annex's example names", () => {
    const signedInfo = between(xml, "<ds:SignedInfo>", "</ds:SignedInfo>");
    expect(signedInfo).toContain(`<ds:CanonicalizationMethod Algorithm="${ALGORITHM.c14n}">`);
    expect(signedInfo).toContain(`<ds:SignatureMethod Algorithm="${ALGORITHM.rsaSha256}">`);
    expect(signedInfo).toContain('<ds:Reference Id="r-id-1" URI="">');
    expect(signedInfo).toContain(
      `<ds:Transform Algorithm="${ALGORITHM.xpath}"><ds:XPath>not(ancestor-or-self::ds:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="${ALGORITHM.c14n}">`,
    );
    expect(signedInfo).toContain(
      `<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xades-id-0b5a7f0e-3c1d-4f5e-9a8b-7c6d5e4f3a2b">`,
    );
    expect(
      signedInfo.match(new RegExp(`DigestMethod Algorithm="${ALGORITHM.sha256}"`, "g"))?.length,
    ).toBe(2);
    expect(xml).toContain(
      `<xades:QualifyingProperties xmlns:xades="${XADES_NAMESPACE}" Target="#id-0b5a7f0e-3c1d-4f5e-9a8b-7c6d5e4f3a2b">`,
    );
    expect(value(xml, "xades:SigningTime")).toBe("2026-11-22T03:30:05Z");
    expect(xml).toContain(
      '<xades:DataObjectFormat ObjectReference="#r-id-1"><xades:MimeType>application/octet-stream</xades:MimeType>',
    );
  });

  it("carries Hacienda's signature policy and its published hash, byte for byte", () => {
    const policy = between(
      xml,
      "<xades:SignaturePolicyIdentifier>",
      "</xades:SignaturePolicyIdentifier>",
    );
    expect(value(policy, "xades:Identifier")).toBe(SIGNATURE_POLICY.identifier);
    expect(policy).toContain(
      `<xades:SigPolicyHash><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=</ds:DigestValue></xades:SigPolicyHash>`,
    );
    // The base64 of the SHA-256 the research note measured on the policy PDF.
    expect(Buffer.from(SIGNATURE_POLICY.digestValue, "base64").toString("hex")).toBe(
      "0d6c629f5c5639e23c3ae5905dace1e158cb5806822c003de787a6ec3321d21f",
    );
  });

  it("identifies the signing certificate: its digest, issuer and serial number", () => {
    const node = new X509Certificate(test.certificatePem);
    expect(value(xml, "ds:X509Certificate")).toBe(node.raw.toString("base64"));
    const cert = between(xml, "<xades:SigningCertificate>", "</xades:SigningCertificate>");
    expect(value(cert, "ds:DigestValue")).toBe(
      createHash("sha256").update(node.raw).digest("base64"),
    );
    expect(value(cert, "ds:X509SerialNumber")).toBe(BigInt(`0x${node.serialNumber}`).toString(10));
    // RFC 4514: the last RDN first.
    expect(value(cert, "ds:X509IssuerName")).toBe(
      "CN=CA DE PRUEBA\\, NO ES DE HACIENDA,OU=YUNTERA DESARROLLO,O=PRUEBAS LOCALES\\, SIN VALOR,C=CR",
    );
    expect(node.issuer.split("\n")).toEqual([
      "C=CR",
      "O=PRUEBAS LOCALES\\, SIN VALOR",
      "OU=YUNTERA DESARROLLO",
      "CN=CA DE PRUEBA\\, NO ES DE HACIENDA",
    ]);
    expect(test.certificate.notAfter.getTime()).toBe(new Date(node.validTo).getTime());
  });

  it("digests the document without its signature, as libxml2 canonicalizes it", () => {
    const unsigned = xml.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "");
    const reference = between(xml, '<ds:Reference Id="r-id-1"', "</ds:Reference>");
    expect(value(reference, "ds:DigestValue")).toBe(sha256(exclusiveC14n(unsigned)));
    // And this package's canonical form is libxml2's, byte for byte.
    expect(canonicalize(buildDocument(doc()))).toBe(exclusiveC14n(unsigned));
  });

  it("digests the signed properties in their context", () => {
    const properties = between(xml, "<xades:SignedProperties", "</xades:SignedProperties>");
    const alone = standalone(properties, `xmlns:xades="${XADES_NAMESPACE}" xmlns:ds="${DS}"`);
    const reference = between(
      xml,
      '<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties"',
      "</ds:Reference>",
    );
    expect(value(reference, "ds:DigestValue")).toBe(sha256(exclusiveC14n(alone)));
  });

  it("signs the canonical SignedInfo with the certificate's key (RSA, SHA-256)", () => {
    const signedInfo = standalone(
      between(xml, "<ds:SignedInfo>", "</ds:SignedInfo>"),
      `xmlns:ds="${DS}"`,
    );
    const canonical = exclusiveC14n(signedInfo);
    expect(canonical.startsWith(`<ds:SignedInfo xmlns:ds="${DS}">`)).toBe(true);
    const signature = Buffer.from(value(xml, "ds:SignatureValue") ?? "", "base64");
    expect(signature.length).toBe(256);
    const publicKey = new X509Certificate(test.certificatePem).publicKey;
    expect(verify("RSA-SHA256", Buffer.from(canonical, "utf8"), publicKey, signature)).toBe(true);
    // A changed amount breaks it.
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(canonical.replace("DigestValue>", "DigestValue>x"), "utf8"),
        publicKey,
        signature,
      ),
    ).toBe(false);
  });

  it("can write the certificate digest with SHA-1, as the annex's issuer example does", async () => {
    const sha1 = await signDocument(
      buildDocument(doc()),
      { ...signer, certificateDigest: "sha1" },
      { signedAt: new Date() },
    );
    const cert = between(sha1, "<xades:CertDigest>", "</xades:CertDigest>");
    expect(cert).toContain(`Algorithm="${ALGORITHM.sha1}"`);
    expect(value(cert, "ds:DigestValue")).toBe(
      createHash("sha1").update(new X509Certificate(test.certificatePem).raw).digest("base64"),
    );
  });

  it("accepts RSA 4096 and refuses keys the annex does not allow", async () => {
    const big = await throwawaySigner({ modulusLength: 4096 });
    const signed4096 = await signDocument(buildDocument(doc()), {
      key: big.key,
      certificate: big.certificate,
      certificateDigest: "sha256",
    });
    expect(Buffer.from(value(signed4096, "ds:SignatureValue") ?? "", "base64").length).toBe(512);
    const small = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      false,
      ["sign", "verify"],
    )) as WebCryptoKeyPair;
    await expect(
      signDocument(buildDocument(doc()), { ...signer, key: small.privateKey }),
    ).rejects.toThrow("RSA 2048 or 4096");
  });

  it("refuses to sign twice", async () => {
    const root = buildDocument(doc());
    const once = await signDocument(root, signer);
    expect(once).toContain("<ds:Signature");
    const signedRoot = {
      ...root,
      children: [...root.children, { name: "ds:Signature", attrs: [], children: [] }],
    };
    await expect(signDocument(signedRoot, signer)).rejects.toThrow("already signed");
  });
});

describe("the signing key from the environment", () => {
  it("opens a PKCS#8 key encrypted with the PIN, and signs with it", async () => {
    const pin = "Llave-de-Prueba#2026";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: pin },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(privateKey).toContain("BEGIN ENCRYPTED PRIVATE KEY");
    const key = await importSigningKey(privateKey, pin);
    expect(key.extractable).toBe(false);
    const data = new TextEncoder().encode("hola");
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data));
    expect(
      verify("RSA-SHA256", Buffer.from(data), createPublicKey(publicKey), Buffer.from(sig)),
    ).toBe(true);

    await expect(importSigningKey(privateKey, "otro-PIN")).rejects.toThrow("PIN");
    await expect(importSigningKey(privateKey)).rejects.toThrow("no PIN");
  });

  it("opens a plain PKCS#8 key and refuses anything else", async () => {
    const pem = await privateKeyPem(test.key);
    await expect(importSigningKey(pem)).resolves.toBeDefined();
    await expect(
      importSigningKey("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"),
    ).rejects.toThrow("PKCS#8");
  });

  it("reads the certificate the way Node does", () => {
    const parsed = parseCertificate(test.certificatePem);
    const node = new X509Certificate(test.certificatePem);
    expect(BigInt(parsed.serialNumber)).toBe(BigInt(`0x${node.serialNumber}`));
    expect(parsed.notBefore.getTime()).toBe(new Date(node.validFrom).getTime());
    expect(parsed.subjectName).toBe(parsed.issuerName);
  });
});
