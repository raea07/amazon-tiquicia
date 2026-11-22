/**
 * Checks a signed document the way a receiver would, independently of this
 * package's own code: the document's digest over libxml2's exclusive
 * canonical form of everything but the signature, the signed properties'
 * digest, and the RSA signature over the canonical SignedInfo with the public
 * key read out of the embedded certificate (Node's crypto). Tests only; Node
 * only; needs xmllint (see xmllint.ts).
 */

import { createHash, verify, X509Certificate } from "node:crypto";
import { XADES_NAMESPACE } from "../signature.ts";
import { exclusiveC14n } from "./xmllint.ts";

const DS = "http://www.w3.org/2000/09/xmldsig#";

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

export interface SignatureCheck {
  /** The document without its signature hashes to the first reference's digest. */
  documentDigest: boolean;
  /** The signed properties hash to the second reference's digest. */
  propertiesDigest: boolean;
  /** SignatureValue is the certificate key's RSA-SHA256 signature of the canonical SignedInfo. */
  signature: boolean;
}

export function checkSignature(xml: string): SignatureCheck {
  const unsigned = xml.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "");
  const documentReference = between(xml, '<ds:Reference Id="r-id-1"', "</ds:Reference>");
  const propertiesReference = between(
    xml,
    '<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties"',
    "</ds:Reference>",
  );
  const properties = standalone(
    between(xml, "<xades:SignedProperties", "</xades:SignedProperties>"),
    `xmlns:xades="${XADES_NAMESPACE}" xmlns:ds="${DS}"`,
  );
  const signedInfo = exclusiveC14n(
    standalone(between(xml, "<ds:SignedInfo>", "</ds:SignedInfo>"), `xmlns:ds="${DS}"`),
  );
  const certificate = new X509Certificate(
    Buffer.from(value(xml, "ds:X509Certificate") ?? "", "base64"),
  );
  return {
    documentDigest: value(documentReference, "ds:DigestValue") === sha256(exclusiveC14n(unsigned)),
    propertiesDigest:
      value(propertiesReference, "ds:DigestValue") === sha256(exclusiveC14n(properties)),
    signature: verify(
      "RSA-SHA256",
      Buffer.from(signedInfo, "utf8"),
      certificate.publicKey,
      Buffer.from(value(xml, "ds:SignatureValue") ?? "", "base64"),
    ),
  };
}
