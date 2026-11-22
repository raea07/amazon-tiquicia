/**
 * Escaping is the writer's job (xml.ts): the database only removes what XML
 * cannot carry (private.invoice_clean_text) and keeps < > & " ' as typed.
 * This proves, for every field a person or a setting fills, that hostile
 * text — markup, both quotes, a CDATA end marker, an entity or DOCTYPE
 * declaration, an entity reference, an over-long value — gives a document
 * that is well-formed, validates against Hacienda's official schemas, keeps
 * the text as text (libxml2 reads back exactly what cleanText made of it, and
 * nothing it could expand), and is covered by the signature (a receiver's
 * check passes, and changing one escaped character breaks it).
 *
 * The fields: the receiver's name and e-mail, the issuer's name, commercial
 * name and address (OtrasSenas), a line's description (where a product's name
 * would go; the platform's own lines are built from fixed words and the order
 * number, so no product name reaches them today), the payment's and the
 * credit note's free text. The same text through the database, the worker and
 * the fake of Hacienda: tools/e2e/journeys/invoicing-escaping.cjs.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { cleanText } from "./codes.ts";
import { buildDocument, type FiscalDocument, InvalidDocument } from "./document.ts";
import { type Signer, signDocument } from "./signature.ts";
import { throwawaySigner } from "./testing/certificate.ts";
import { lineFromGross, lineFromNet, SAMPLE_ISSUER, sampleDocument } from "./testing/samples.ts";
import { checkSignature } from "./testing/verify.ts";
import { schemaErrors, textAt, wellFormed } from "./testing/xmllint.ts";

let signer: Signer;
beforeAll(async () => {
  const test = await throwawaySigner();
  signer = { key: test.key, certificate: test.certificate, certificateDigest: "sha256" };
});

const issuedAt = new Date("2026-11-22T15:30:00Z");

/** What people type that must stay text. */
const HOSTILE: Record<string, string> = {
  markup: "Ana </Nombre><Nombre>Otra</Nombre> <b>negrita</b> & \"Cía\" 'Ltda' > < &",
  cdata: "Tienda ]]> <![CDATA[ <x/> ]]> fin",
  doctype:
    '<!DOCTYPE Nombre [<!ENTITY robo SYSTEM "file:///etc/passwd"><!ENTITY risa "ja">]> &robo; &risa;',
  entities: "&amp; &lt; &#60; &#x3C; &quot; &apos; &nbsp; &unknown;",
  pi: '<?xml version="1.0"?><?php echo 1 ?> <!-- comentario --> fin',
};

/** Longer than every field allows, with markup at the place it is cut. */
const LONG = `${"Ñandú & <Cía> ".repeat(30)}</Nombre>`;

function doc(text: string): FiscalDocument {
  return sampleDocument({
    type: "01",
    sequence: 7,
    issuedAt,
    issuer: {
      ...SAMPLE_ISSUER,
      name: `EJEMPLO ${text}`,
      commercial_name: `Yuntera ${text}`,
      location: { ...SAMPLE_ISSUER.location, other_signs: `Del parque 200 m ${text}` },
    },
    receiver: {
      name: `Receptor ${text}`,
      id_type: "01",
      id_number: "109870654",
      email: "o'brien+factura@example.com",
      activity_code: null,
    },
    lines: [
      lineFromGross(1, {
        cabys: "6803000000000",
        unit: "Os",
        description: `Producto ${text}`,
        grossMinor: 250_000,
      }),
      lineFromNet(2, {
        cabys: "6254400000000",
        unit: "Cm",
        description: `Comisión ${text}`,
        netMinor: 120_000,
      }),
    ],
    payment: { code: "99", other: `Compensación ${text}` },
  });
}

function credit(text: string): FiscalDocument {
  const original = doc(text);
  return sampleDocument({
    type: "03",
    sequence: 8,
    issuedAt,
    issuer: original.issuer,
    receiver: original.receiver,
    lines: original.lines,
    payment: { code: "99", other: `Compensación ${text}` },
    references: [
      {
        type: "01",
        number: original.clave,
        issued_at: original.issued_at,
        code: "01",
        reason: `Pedido cancelado ${text}`,
      },
    ],
  });
}

const sign = (fiscal: FiscalDocument) =>
  signDocument(buildDocument(fiscal), signer, { signedAt: new Date("2026-11-22T15:30:05Z") });

/** Each field, where it is in the XML, and the limit cleanText cuts it to. */
const FIELDS: Array<{ path: string[]; value: (d: FiscalDocument) => string; max: number }> = [
  { path: ["Emisor", "Nombre"], value: (d) => d.issuer.name, max: 100 },
  { path: ["Emisor", "NombreComercial"], value: (d) => d.issuer.commercial_name ?? "", max: 80 },
  {
    path: ["Emisor", "Ubicacion", "OtrasSenas"],
    value: (d) => d.issuer.location.other_signs,
    max: 250,
  },
  { path: ["Receptor", "Nombre"], value: (d) => d.receiver?.name ?? "", max: 100 },
  {
    path: ["DetalleServicio", "LineaDetalle", "Detalle"],
    value: (d) => d.lines[0]?.description ?? "",
    max: 200,
  },
  {
    path: ["ResumenFactura", "MedioPago", "MedioPagoOtros"],
    value: (d) => d.payments[0]?.other ?? "",
    max: 100,
  },
];

describe("hostile text in every field stays text", () => {
  for (const [kind, text] of [...Object.entries(HOSTILE), ["over-long", LONG] as const]) {
    it(`${kind}: well-formed, valid, read back as typed, signed`, async () => {
      const fiscal = doc(text);
      const xml = await sign(fiscal);
      expect(wellFormed(xml)).toBe(true);
      expect(schemaErrors(xml, "01")).toEqual([]);
      // Nothing a person typed became markup: one root, no declarations, no
      // processing instruction or comment of theirs, the elements the writer made.
      expect(xml.match(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?php|<!--/g)).toBeNull();
      expect(xml.match(/<Nombre>/g)?.length).toBe(2);
      for (const field of FIELDS) {
        expect(textAt(xml, "FacturaElectronica", ...field.path)).toBe(
          cleanText(field.value(fiscal), field.max),
        );
      }
      expect(textAt(xml, "FacturaElectronica", "Receptor", "CorreoElectronico")).toBe(
        "o'brien+factura@example.com",
      );
      expect(checkSignature(xml)).toEqual({
        documentDigest: true,
        propertiesDigest: true,
        signature: true,
      });
    });
  }

  it("cuts over-long values by character, never inside an escape", async () => {
    const xml = await sign(doc(LONG));
    const name = textAt(xml, "FacturaElectronica", "Receptor", "Nombre") ?? "";
    expect(Array.from(name).length).toBe(100);
    expect(
      Array.from(textAt(xml, "FacturaElectronica", "Emisor", "Ubicacion", "OtrasSenas") ?? "")
        .length,
    ).toBe(250);
    // The raw XML between the tags is only text and whole escapes.
    const raw = /<Receptor><Nombre>([^<]*)<\/Nombre>/.exec(xml)?.[1] ?? "";
    expect(raw.replace(/&(amp|lt|gt);/g, "")).not.toMatch(/[&<>]/);
  });

  it("keeps the credit note's reason as text, and it validates", async () => {
    for (const text of Object.values(HOSTILE)) {
      const fiscal = credit(text);
      const xml = await sign(fiscal);
      expect(schemaErrors(xml, "03")).toEqual([]);
      expect(textAt(xml, "NotaCreditoElectronica", "InformacionReferencia", "Razon")).toBe(
        cleanText(fiscal.references[0]?.reason ?? "", 180),
      );
      expect(checkSignature(xml).signature).toBe(true);
    }
  });

  it("refuses an e-mail with markup or quotes other than ' instead of writing it", () => {
    // Hacienda's pattern for CorreoElectronico admits only the apostrophe of
    // these characters; the writer refuses the rest before writing anything
    // (and the checkout refuses them first: invoice_receiver_email_invalid).
    for (const email of [
      'ana"<b>@example.com',
      "ana&amp;@example.com",
      "<ana>@example.com",
      "ana@example.com<!--",
      "ana@exa]]>mple.com",
    ]) {
      const fiscal = doc("x");
      const receiver = fiscal.receiver;
      if (!receiver) throw new Error("the sample has a receiver");
      const withEmail = { ...fiscal, receiver: { ...receiver, email } };
      expect(() => buildDocument(withEmail), email).toThrow(InvalidDocument);
      expect(() => buildDocument(withEmail), email).toThrow("receiver_email_invalid");
    }
  });

  it("is covered by the signature: changing one escaped character breaks it", async () => {
    const xml = await sign(doc(HOSTILE.markup ?? ""));
    expect(xml).toContain("&lt;/Nombre&gt;&lt;Nombre&gt;Otra");
    // The receiver's name says something else, still well-formed and valid.
    const tampered = xml.replace(
      "&lt;/Nombre&gt;&lt;Nombre&gt;Otra",
      "&lt;/Nombre&gt;&lt;Nombre&gt;Otro",
    );
    expect(tampered).not.toBe(xml);
    expect(schemaErrors(tampered, "01")).toEqual([]);
    expect(checkSignature(tampered).documentDigest).toBe(false);
    // Writing the same character another legal way changes the canonical bytes not at all,
    // so the signature still holds: what is signed is the text, not its spelling.
    const respelled = xml.replace(
      "&lt;/Nombre&gt;&lt;Nombre&gt;Otra",
      "&#60;/Nombre&gt;&lt;Nombre&gt;Otra",
    );
    expect(checkSignature(respelled).documentDigest).toBe(true);
  });
});
