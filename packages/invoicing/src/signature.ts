/**
 * The signature the annex requires (Anexo 2, pp. 84–96; research note 4.1):
 * XMLDSig, enveloped, with XAdES-EPES qualifying properties (ETSI TS 101 903
 * v1.3.2), RSA with SHA-256, exclusive canonicalization, two references (the
 * document without its signature, and the signed properties), the signing
 * certificate in KeyInfo, the signing time, the signing certificate's digest
 * and issuer/serial, and Hacienda's signature policy with its published hash.
 *
 * Computed with the runtime's own WebCrypto (Node 22 and Deno both have it);
 * no cryptography library. Whether Hacienda's validator accepts the result
 * can only be shown with sandbox credentials: see docs/06-operations/invoicing.md.
 */

import { canonicalize, scopeAt } from "./c14n.ts";
import type { Certificate } from "./certificate.ts";
import { SIGNATURE_POLICY } from "./codes.ts";
import { buffer, bytesToBase64, type WebCryptoKey } from "./der.ts";
import { DS_NAMESPACE } from "./document.ts";
import { el, leaf, serializeDocument, type XmlElement } from "./xml.ts";

export const XADES_NAMESPACE = "http://uri.etsi.org/01903/v1.3.2#";
export const ALGORITHM = {
  c14n: "http://www.w3.org/2001/10/xml-exc-c14n#",
  rsaSha256: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  sha256: "http://www.w3.org/2001/04/xmlenc#sha256",
  sha1: "http://www.w3.org/2000/09/xmldsig#sha1",
  xpath: "http://www.w3.org/TR/1999/REC-xpath-19991116",
  signedProperties: "http://uri.etsi.org/01903#SignedProperties",
} as const;

export interface Signer {
  key: WebCryptoKey;
  certificate: Certificate;
  /**
   * The digest of the certificate in SigningCertificate. The annex's issuer
   * example uses SHA-1; its requirements table names SHA-256 or SHA-512. Which
   * one the validator accepts is unverified (research note 4.1), so it is a setting.
   */
  certificateDigest: "sha256" | "sha1";
}

const encoder = new TextEncoder();

async function digest(algorithm: "SHA-256" | "SHA-1", data: string | Uint8Array) {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest(algorithm, buffer(bytes))));
}

/** Formats the signing time as the annex example does: UTC, seconds, `Z`. */
const signingTime = (at: Date) => `${at.toISOString().slice(0, 19)}Z`;

const isSignature = (element: XmlElement) => element.name === "ds:Signature";

/** The canonical bytes of reference 1: the document with its signature left out. */
export const documentDigestInput = (root: XmlElement) => canonicalize(root, new Map(), isSignature);

/**
 * Signs the document and returns it written out, with the XML declaration.
 * `ids` lets tests fix the identifiers; by default they are random.
 */
export async function signDocument(
  root: XmlElement,
  signer: Signer,
  options: { signedAt: Date; id?: string } = { signedAt: new Date() },
): Promise<string> {
  if (root.children.some((child) => typeof child !== "string" && isSignature(child))) {
    throw new Error("the document is already signed");
  }
  const algorithm = (signer.key.algorithm as { modulusLength?: number }).modulusLength;
  if (algorithm !== 2048 && algorithm !== 4096) {
    throw new Error("the signing key must be RSA 2048 or 4096 (annex, Anexo 2)");
  }
  const id = options.id ?? crypto.randomUUID();
  const signatureId = `id-${id}`;
  const propertiesId = `xades-id-${id}`;
  const referenceId = `r-id-1`;

  const documentDigest = await digest("SHA-256", documentDigestInput(root));
  const certDigestAlgorithm = signer.certificateDigest === "sha1" ? "SHA-1" : "SHA-256";

  const signedProperties = el(
    "xades:SignedProperties",
    { Id: propertiesId },
    el(
      "xades:SignedSignatureProperties",
      null,
      leaf("xades:SigningTime", signingTime(options.signedAt)),
      el(
        "xades:SigningCertificate",
        null,
        el(
          "xades:Cert",
          null,
          el(
            "xades:CertDigest",
            null,
            el("ds:DigestMethod", {
              Algorithm: signer.certificateDigest === "sha1" ? ALGORITHM.sha1 : ALGORITHM.sha256,
            }),
            leaf("ds:DigestValue", await digest(certDigestAlgorithm, signer.certificate.der)),
          ),
          el(
            "xades:IssuerSerial",
            null,
            leaf("ds:X509IssuerName", signer.certificate.issuerName),
            leaf("ds:X509SerialNumber", signer.certificate.serialNumber),
          ),
        ),
      ),
      el(
        "xades:SignaturePolicyIdentifier",
        null,
        el(
          "xades:SignaturePolicyId",
          null,
          el("xades:SigPolicyId", null, leaf("xades:Identifier", SIGNATURE_POLICY.identifier)),
          el(
            "xades:SigPolicyHash",
            null,
            el("ds:DigestMethod", { Algorithm: ALGORITHM.sha256 }),
            leaf("ds:DigestValue", SIGNATURE_POLICY.digestValue),
          ),
        ),
      ),
    ),
    el(
      "xades:SignedDataObjectProperties",
      null,
      el(
        "xades:DataObjectFormat",
        { ObjectReference: `#${referenceId}` },
        leaf("xades:MimeType", "application/octet-stream"),
      ),
    ),
  );

  const signedInfo = el(
    "ds:SignedInfo",
    null,
    el("ds:CanonicalizationMethod", { Algorithm: ALGORITHM.c14n }),
    el("ds:SignatureMethod", { Algorithm: ALGORITHM.rsaSha256 }),
    el(
      "ds:Reference",
      [
        ["Id", referenceId],
        ["URI", ""],
      ],
      el(
        "ds:Transforms",
        null,
        el(
          "ds:Transform",
          { Algorithm: ALGORITHM.xpath },
          leaf("ds:XPath", "not(ancestor-or-self::ds:Signature)"),
        ),
        el("ds:Transform", { Algorithm: ALGORITHM.c14n }),
      ),
      el("ds:DigestMethod", { Algorithm: ALGORITHM.sha256 }),
      leaf("ds:DigestValue", documentDigest),
    ),
    el(
      "ds:Reference",
      [
        ["Type", ALGORITHM.signedProperties],
        ["URI", `#${propertiesId}`],
      ],
      el("ds:Transforms", null, el("ds:Transform", { Algorithm: ALGORITHM.c14n })),
      el("ds:DigestMethod", { Algorithm: ALGORITHM.sha256 }),
      // Filled in below, once the properties sit in the tree they are canonicalized in.
      el("ds:DigestValue", null),
    ),
  );

  const signatureValue = el("ds:SignatureValue", { Id: `value-${signatureId}` });
  const signature = el(
    "ds:Signature",
    { Id: signatureId },
    signedInfo,
    signatureValue,
    el(
      "ds:KeyInfo",
      null,
      el("ds:X509Data", null, leaf("ds:X509Certificate", signer.certificate.base64)),
    ),
    el(
      "ds:Object",
      null,
      el(
        "xades:QualifyingProperties",
        [
          ["xmlns:xades", XADES_NAMESPACE],
          ["Target", `#${signatureId}`],
        ],
        signedProperties,
      ),
    ),
  );
  const signed: XmlElement = { ...root, children: [...root.children, signature] };

  const propertiesDigest = await digest(
    "SHA-256",
    canonicalize(signedProperties, scopeAt(signed, signedProperties)),
  );
  const propertiesReference = signedInfo.children[3];
  if (!propertiesReference || typeof propertiesReference === "string")
    throw new Error("unreachable");
  const digestValue = propertiesReference.children[2];
  if (!digestValue || typeof digestValue === "string") throw new Error("unreachable");
  digestValue.children = [propertiesDigest];

  const signedInfoBytes = encoder.encode(canonicalize(signedInfo, scopeAt(signed, signedInfo)));
  const value = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer.key, buffer(signedInfoBytes));
  signatureValue.children = [bytesToBase64(new Uint8Array(value))];

  return serializeDocument(signed);
}

/** Namespace URI of the signature element, for readers of the signed document. */
export const SIGNATURE_NAMESPACE = DS_NAMESPACE;
