/**
 * Every document type against Hacienda's official v4.4 schemas (schemas/,
 * downloaded 22 Nov 2026), signed, with realistic data and with hostile data
 * typed by a person: markup, quotes, control characters, emoji, overlong text.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { buildDocument, type FiscalDocument, InvalidDocument } from "./document.ts";
import { type Signer, signDocument } from "./signature.ts";
import { throwawaySigner } from "./testing/certificate.ts";
import { lineFromGross, lineFromNet, SAMPLE_SELLER, sampleDocument } from "./testing/samples.ts";
import { schemaErrors } from "./testing/xmllint.ts";
import { serialize, serializeDocument } from "./xml.ts";

let signer: Signer;
beforeAll(async () => {
  const test = await throwawaySigner();
  signer = { key: test.key, certificate: test.certificate, certificateDigest: "sha256" };
});

const issuedAt = new Date("2026-11-22T03:30:00Z");

const delivery = (gross = 250_000) =>
  lineFromGross(1, {
    cabys: "6803000000000",
    unit: "Os",
    description: "Entrega a domicilio pedido YT-000123",
    grossMinor: gross,
  });

const tiquete = () => sampleDocument({ type: "04", sequence: 1532, issuedAt, lines: [delivery()] });

const feeFactura = (receiver = SAMPLE_SELLER) =>
  sampleDocument({
    type: "01",
    sequence: 27,
    issuedAt,
    receiver,
    lines: [
      lineFromNet(1, {
        cabys: "6254400000000",
        unit: "Cm",
        description: "Comisión de venta, pedido YT-000123",
        netMinor: 240_000,
      }),
      lineFromNet(2, {
        cabys: "6729000000000",
        unit: "Os",
        description: "Servicio de bodega, pedido YT-000123",
        netMinor: 140_000,
      }),
      lineFromNet(3, {
        cabys: "7119002009900",
        unit: "Os",
        description: "Gestión del cobro, pedido YT-000123",
        netMinor: 30_000,
      }),
    ],
    payment: { code: "99", other: "Compensacion contra liquidacion de ventas" },
  });

const creditNote = (original: FiscalDocument) =>
  sampleDocument({
    type: "03",
    sequence: 1,
    issuedAt: new Date("2026-11-23T15:00:00Z"),
    lines: original.lines,
    receiver: original.receiver,
    payment: {
      code: original.payments[0]?.code ?? "06",
      other: original.payments[0]?.other ?? null,
    },
    references: [
      {
        type: original.document_type,
        number: original.clave,
        issued_at: original.issued_at,
        code: "01",
        reason: "Pedido cancelado antes de la entrega",
      },
    ],
  });

async function signed(doc: FiscalDocument) {
  return signDocument(buildDocument(doc), signer, { signedAt: new Date("2026-11-22T03:30:05Z") });
}

describe("documents against the official schemas", () => {
  it("writes the note's validated tiquete, element for element", () => {
    const xml = serialize(buildDocument(tiquete()));
    // research note 3.14, without its whitespace, comments and placeholder signature
    const sample =
      '<TiqueteElectronico xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
      "<Clave>50621112600310112345600100001040000001532148291037</Clave><ProveedorSistemas>3101123456</ProveedorSistemas>" +
      "<CodigoActividadEmisor>532000</CodigoActividadEmisor><NumeroConsecutivo>00100001040000001532</NumeroConsecutivo>" +
      "<FechaEmision>2026-11-21T21:30:00-06:00</FechaEmision><Emisor><Nombre>EJEMPLO PLATAFORMA SOCIEDAD ANONIMA</Nombre>" +
      "<Identificacion><Tipo>02</Tipo><Numero>3101123456</Numero></Identificacion><NombreComercial>Yuntera</NombreComercial>" +
      "<Ubicacion><Provincia>1</Provincia><Canton>01</Canton><Distrito>01</Distrito><OtrasSenas>Direccion exacta del domicilio fiscal</OtrasSenas></Ubicacion>" +
      "<CorreoElectronico>facturacion@example.com</CorreoElectronico></Emisor><CondicionVenta>01</CondicionVenta>" +
      "<DetalleServicio><LineaDetalle><NumeroLinea>1</NumeroLinea><CodigoCABYS>6803000000000</CodigoCABYS><Cantidad>1.000</Cantidad>" +
      "<UnidadMedida>Os</UnidadMedida><Detalle>Entrega a domicilio pedido YT-000123</Detalle><PrecioUnitario>2212.38938</PrecioUnitario>" +
      "<MontoTotal>2212.38938</MontoTotal><SubTotal>2212.38938</SubTotal><BaseImponible>2212.38938</BaseImponible>" +
      "<Impuesto><Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13.00</Tarifa><Monto>287.61062</Monto></Impuesto>" +
      "<ImpuestoAsumidoEmisorFabrica>0.00000</ImpuestoAsumidoEmisorFabrica><ImpuestoNeto>287.61062</ImpuestoNeto>" +
      "<MontoTotalLinea>2500.00000</MontoTotalLinea></LineaDetalle></DetalleServicio><ResumenFactura>" +
      "<CodigoTipoMoneda><CodigoMoneda>CRC</CodigoMoneda><TipoCambio>1.00000</TipoCambio></CodigoTipoMoneda>" +
      "<TotalServGravados>2212.38938</TotalServGravados><TotalGravado>2212.38938</TotalGravado><TotalVenta>2212.38938</TotalVenta>" +
      "<TotalVentaNeta>2212.38938</TotalVentaNeta><TotalDesgloseImpuesto><Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA>" +
      "<TotalMontoImpuesto>287.61062</TotalMontoImpuesto></TotalDesgloseImpuesto><TotalImpuesto>287.61062</TotalImpuesto>" +
      "<MedioPago><TipoMedioPago>06</TipoMedioPago><TotalMedioPago>2500.00000</TotalMedioPago></MedioPago>" +
      "<TotalComprobante>2500.00000</TotalComprobante></ResumenFactura></TiqueteElectronico>";
    expect(xml).toBe(sample);
  });

  it("validates a signed tiquete for the delivery fee", async () => {
    expect(schemaErrors(await signed(tiquete()), "04")).toEqual([]);
  });

  it("validates a signed factura to a seller for commission, warehouse and payment fees", async () => {
    const xml = await signed(feeFactura());
    expect(schemaErrors(xml, "01")).toEqual([]);
    expect(xml).toContain("<TotalServGravados>4100.00000</TotalServGravados>");
    expect(xml).toContain("<TotalImpuesto>533.00000</TotalImpuesto>");
    expect(xml).toContain("<TotalComprobante>4633.00000</TotalComprobante>");
  });

  it("validates a signed factura to a shopper for the delivery fee", async () => {
    const doc = sampleDocument({
      type: "01",
      sequence: 2,
      issuedAt,
      lines: [delivery(150_000)],
      receiver: {
        name: "María Pérez Rojas",
        id_type: "01",
        id_number: "109870654",
        email: "maria@example.com",
        activity_code: null,
      },
      payment: { code: "02" },
    });
    expect(schemaErrors(await signed(doc), "01")).toEqual([]);
  });

  it("validates signed credit notes cancelling a tiquete and a factura", async () => {
    expect(schemaErrors(await signed(creditNote(tiquete())), "03")).toEqual([]);
    expect(schemaErrors(await signed(creditNote(feeFactura())), "03")).toEqual([]);
  });

  it("validates a replacement of a rejected document (TipoDocIR 10, Codigo 16)", async () => {
    const rejected = tiquete();
    const doc = sampleDocument({
      type: "04",
      sequence: 1533,
      issuedAt: new Date("2026-11-22T05:00:00Z"),
      lines: [delivery()],
      references: [
        {
          type: "10",
          number: rejected.clave,
          issued_at: rejected.issued_at,
          code: "16",
          reason: "Sustituye comprobante rechazado por Hacienda",
        },
      ],
    });
    expect(schemaErrors(await signed(doc), "04")).toEqual([]);
  });

  it("refuses a document with nothing signed (the schema requires ds:Signature)", () => {
    expect(schemaErrors(serializeDocument(buildDocument(tiquete())), "04").length).toBeGreaterThan(
      0,
    );
  });
});

describe("hostile text typed by people", () => {
  const hostile = {
    name: 'Ana </Nombre><Nombre>Otra & "Cía" \u0000\u0007 <script>alert(1)</script> 😀\r\nfin',
    id_type: "01",
    id_number: "109870654",
    email: "ana@example.com",
    activity_code: null,
  };

  it("escapes markup and drops what XML cannot carry, and the result still validates", async () => {
    const doc = sampleDocument({
      type: "01",
      sequence: 3,
      issuedAt,
      lines: [
        lineFromGross(1, {
          cabys: "6803000000000",
          unit: "Os",
          description: `Entrega ]]> <![CDATA[x]]> &amp; ${"ñ".repeat(400)}`,
          grossMinor: 250_000,
        }),
      ],
      receiver: hostile,
    });
    const xml = await signed(doc);
    expect(schemaErrors(xml, "01")).toEqual([]);
    expect(xml).not.toContain("</Nombre><Nombre>Otra");
    expect(xml).toContain('Ana &lt;/Nombre&gt;&lt;Nombre&gt;Otra &amp; "Cía"');
    expect(xml.includes(String.fromCharCode(0)) || xml.includes(String.fromCharCode(7))).toBe(
      false,
    );
    expect(xml).toContain("&lt;![CDATA[x]]&gt; &amp;amp;");
    // Detalle is cut to the schema's 200 characters.
    const detalle = /<Detalle>([^<]*)<\/Detalle>/.exec(xml)?.[1] ?? "";
    expect(Array.from(detalle.replace(/&(amp|lt|gt);/g, "x")).length).toBeLessThanOrEqual(200);
  });

  it("refuses figures that do not add up instead of writing them", () => {
    const doc = tiquete();
    const line = doc.lines[0];
    if (!line) throw new Error("sample has a line");
    const tampered = { ...doc, lines: [{ ...line, tax: { ...line.tax, amount: "287.61063" } }] };
    expect(() => buildDocument(tampered)).toThrow(InvalidDocument);
    expect(() =>
      buildDocument({ ...doc, summary: { ...doc.summary, total: "2500.00001" } }),
    ).toThrow("summary_total");
    expect(() =>
      buildDocument({ ...doc, clave: `${doc.clave.slice(0, 41)}2${doc.clave.slice(42)}` }),
    ).not.toThrow();
    expect(() => buildDocument({ ...doc, issued_at: "2026-11-23T03:30:00Z" })).toThrow(
      "clave_date_mismatch",
    );
    expect(() => buildDocument({ ...doc, consecutivo: "00100001040000001533" })).toThrow(
      "clave_consecutivo_mismatch",
    );
    expect(() => buildDocument({ ...feeFactura(), receiver: null })).toThrow("receiver_required");
    expect(() => buildDocument({ ...creditNote(tiquete()), references: [] })).toThrow(
      "reference_required",
    );
    expect(() =>
      buildDocument({ ...doc, payments: [{ code: "06", other: null, amount: "2499.00000" }] }),
    ).toThrow("payments_total");
  });
});
