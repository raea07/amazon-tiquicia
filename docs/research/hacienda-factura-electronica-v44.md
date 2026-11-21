# Hacienda electronic invoicing v4.4 — implementation research

Research date: **21 November 2026**. Engineering research, **not legal or tax
advice**. Every point tagged **[ACCOUNTANT]** needs the owner's Costa Rican
accountant before launch. Anything tagged **UNVERIFIED** could not be confirmed
from a primary source and is listed again in section 11.

## Bottom line

Version 4.4 of Hacienda's "comprobantes electrónicos" is the only valid format
(mandatory since 1 Sep 2025; a second round of adjustments dated 22 Apr 2026
became mandatory on 1 Nov 2026 by Hacienda communiqué, key COM26), and everything needed to implement it is
public and was fetched from this machine today: the annex PDF, the nine XSD
files, the signature-policy PDF (whose SHA-256 matches the hash in Hacienda's
own signature example), the REST reference for `recepcion`, and the identity
provider's live OIDC discovery documents. No rule was found that makes a local
marketplace the invoicing party for its sellers: the taxpayer who sells issues
the document. So for v1 **sellers issue their own factura/tiquete for the goods
with their own system and report the 50-character clave (plus XML) to Yuntera;
Yuntera issues only its own documents** — a tiquete (or factura on request) to
the shopper for the delivery fee, a factura to each seller for commissions and
fees, and notas de crédito for reversals. The Hacienda API is small (one POST,
one GET, a password-grant token), so the recommended build is a provider-neutral
outbox with a direct-to-Hacienda adapter tested against a local stand-in now,
a sandbox certification step once the company has TRIBU-CR credentials, and a
commercial API provider as the fallback. Three things in the current repo
contradict the April 2026 schemas or the annex and are listed in section 9.4.
Yuntera is also, by the text of resolution MH-DGT-RES-0025-2024, a "platform
operator" for sale of goods and must run seller due diligence and report
annually unless it formally opts into the under-EUR-1-million exclusion.

## Source keys

| Key   | Document                                                                                                                                                                                                                               | How it was read                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ANX   | "Anexos y Estructuras v4.4", DGT, 99 pages, PDF last-modified 13 May 2026, "Bitácora de Ajustes al 22/04/2026"                                                                                                                         | Downloaded, full text extracted; page numbers below are "Página N de 99" |
| XSD   | The v4.4 XSD files on `www.hacienda.go.cr/docs/` (last-modified 22 Apr 2026)                                                                                                                                                           | Downloaded, parsed, sample XML validated with `xmllint`                  |
| RCE   | Decreto 44739-H, Reglamento de Comprobantes Electrónicos (signed 2 Oct 2024; RES27 cites it as "del 08 de noviembre del 2024", presumably the publication date)                                                                        | Downloaded, full text read                                               |
| RES27 | MH-DGT-RES-0027-2024, technical resolution (13 Nov 2024). This PDF is also the XAdES signature policy                                                                                                                                  | Downloaded from the CDN, full text read                                  |
| API   | "Comprobantes Electrónicos API version v1" (HTML reference)                                                                                                                                                                            | Downloaded, full text read                                               |
| IDP   | "Guía de uso para IdP Comprobantes Electrónicos" (PDF, 2018)                                                                                                                                                                           | Downloaded, full text read                                               |
| RES25 | MH-DGT-RES-0025-2024, platform seller reporting, La Gaceta Alcance 179, 6 Nov 2024                                                                                                                                                     | Official Gazette PDF downloaded, articles 1–13 read                      |
| HAPI  | `https://api.hacienda.go.cr/docs/` and live calls to that API                                                                                                                                                                          | Fetched and called today                                                 |
| COM26 | Hacienda communiqué "Actualización de los Anexos y Estructuras versión 4.4 y validación de comprobantes electrónicos", `https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf` (Last-Modified 21 Apr 2026) | Downloaded in the fact-check, full text read                             |
| RES43 | Hacienda's questions-and-answers PDF on MH-DGT-RES-0043-2025 (TRIBU-CR start), `https://www.hacienda.go.cr/docs/ResolucionMH-DGT-RES-0043-2025.pdf`                                                                                    | Downloaded in the fact-check, read                                       |

Confidence: statements citing these keys are **primary**. Statements citing
press, law firms or vendors are **secondary** and say so.

## 1. Official files and reachability from this machine

All checked with `curl` on 21 Nov 2026. Nothing was saved in the repository.

| File                                             | URL                                                                                                                                                                            | HTTP | Bytes   | Last-Modified | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------- | ------------- | ------------------------------------------------------------------ |
| Annex PDF                                        | `https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf`                                                                                                                | 200  | 1243035 | 13 May 2026   | `6e093226b29b38c5c8de825f70c1b1cb8ed81e2f4a6eb0b3ff52708fc1eb2769` |
| FacturaElectronica XSD                           | `https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd`                                                                                                                  | 200  | 119689  | 22 Apr 2026   | `926ba81325bc21102755bd8e4e570a63caaca086e680a877c3a6d15d6ee8a62f` |
| TiqueteElectronico XSD                           | `https://www.hacienda.go.cr/docs/TiqueteElectronico_V4.4.xsd`                                                                                                                  | 200  | 117940  | 22 Apr 2026   | `d7783baf818f316596d0b58b17481be689595982a248d98102d707f72967ae6e` |
| NotaCreditoElectronica XSD                       | `https://www.hacienda.go.cr/docs/NotaCreditoElectronica_V4.4.xsd`                                                                                                              | 200  | 123011  | 22 Apr 2026   | `b7ed3347c5599e78e5683d9ae83842695ab9497e173df9cd3be8d77c0851f556` |
| NotaDebitoElectronica XSD                        | `https://www.hacienda.go.cr/docs/NotaDebitoElectronica_V4.4.xsd`                                                                                                               | 200  | 123029  | 22 Apr 2026   | `3709389ccc434fb1ef4571079b1a628654fa04f07c1f3f1044b2416ba12eb7ff` |
| MensajeReceptor XSD                              | `https://www.hacienda.go.cr/docs/MensajeReceptor_V4.4.xsd`                                                                                                                     | 200  | 6564    | 22 Apr 2026   | `b883e3a9321eadf2ccc1a9dc853d9e3bd483918dcd6e2152d902ddf2f244365f` |
| MensajeHacienda XSD                              | `https://www.hacienda.go.cr/docs/MensajeHacienda_V4.4.xsd`                                                                                                                     | 200  | 7799    | 22 Apr 2026   | `b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e` |
| ReciboElectronicoPago XSD (new in 4.4)           | `https://www.hacienda.go.cr/docs/ReciboElectronicoPago_V4.4.xsd`                                                                                                               | 200  | 41655   | 22 Apr 2026   | `86e3aa5f0615b757a3b2e9c300973d573ac321f76adba7b4b05e59d854da82b7` |
| FacturaElectronicaCompra XSD                     | `https://www.hacienda.go.cr/docs/FacturaElectronicaCompra_V4.4.xsd`                                                                                                            | 200  | 97300   | 22 Apr 2026   | `57e4cedb12d5045884670ff2e4795d2027e69b96d45752f60cd1a1930e2768a3` |
| FacturaElectronicaExportacion XSD                | `https://www.hacienda.go.cr/docs/FacturaElectronicaExportacion_V4.4.xsd`                                                                                                       | 200  | 101881  | 22 Apr 2026   | `e571d8296bb74e86cb9ef7889601844c61ac50bedca90aa8d52badf15198242e` |
| Signature policy PDF (= RES27)                   | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf` | 200  | 163479  | 8 Jan 2025    | `0d6c629f5c5639e23c3ae5905dace1e158cb5806822c003de787a6ec3321d21f` |
| API reference (HTML)                             | `https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html`                                                                                                             | 200  | 52470   | 4 Jul 2025    | `3ad858788952a35bed45c3e45649763ed2abb21be94d961c62bfc41e84cf2b9d` |
| IdP guide                                        | `https://www.hacienda.go.cr/docs/Guia_IdP.pdf`                                                                                                                                 | 200  | 2405918 | 4 Jul 2025    | `e7a2db0f8c3f0255f74541f0c63dc8e1b199fecb2fa0325e18b0e11f55e1bedc` |
| Reglamento (RCE)                                 | `https://www.hacienda.go.cr/docs/REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf`                                                                                                  | 200  | 2581910 | 4 Jul 2025    | `32da4200481b6c21522d4ace59e5255e15aae0624be077594dc65195189fe4fc` |
| Currency codes                                   | `https://www.hacienda.go.cr/docs/Codigodemoneda_V4.4.pdf`                                                                                                                      | 200  | 160787  | 4 Jul 2025    | not recorded                                                       |
| Province/cantón/district codes                   | `https://www.hacienda.go.cr/docs/Codificacionubicacion_V4.4.xlsx`                                                                                                              | 200  | 314939  | not recorded  | not recorded                                                       |
| W3C XMLDSig schema (imported by every XSD above) | `https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd`                                                                                                                   | 200  | 10292   | —             | not recorded                                                       |

Gotchas found while fetching:

- **Use the `.xsd` files, not the `.xsd.xml` twins.** `…/docs/FacturaElectronica_V4.4.xsd.xml`
  (and the same for the other types) also returns 200 but is the **July 2025**
  build. Differences confirmed by parsing both (FE, TE, NC): `Clave` pattern
  `\d{50}` → `[a-zA-Z0-9]{50}`; phone minimum `10000000` → `100`; `Proporcion`
  `5,2` → `10,5`; `TipoDocIR` gains `19`, `20`; reference `Codigo` gains `13`–`16`;
  `ds:Signature` `1..1` → `1..5`.
- `www.hacienda.go.cr` answers **HTTP 400** when the request carries
  `User-Agent: Mozilla/5.0…`; the default `curl` agent gets 200. Do not fake a
  browser agent when a job downloads these files.
- The old ATV index page
  `https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx`
  still loads (200) and lists the 4.4 files under `docs/esquemas/2024/v4.4/…`,
  but **every one of those links returned 404** today. Use the `hacienda.go.cr/docs/` URLs.
- The namespace URLs printed in ANX nota 2 (p. 65), e.g.
  `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica`,
  are **identifiers, not downloads**: they return 403 `AccessDenied`.
- Each XSD imports `../../xmldsig-core-schema.xsd`. To validate locally, place
  the XSDs two directories below the W3C file (e.g. `schemas/v4.4/x/Factura….xsd`
  with `schemas/xmldsig-core-schema.xsd`).

XML namespaces (XSD `targetNamespace`, `elementFormDefault="qualified"`):

| Root element             | Namespace                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `FacturaElectronica`     | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica`     |
| `TiqueteElectronico`     | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico`     |
| `NotaCreditoElectronica` | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica` |
| `NotaDebitoElectronica`  | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaDebitoElectronica`  |
| `ReciboElectronicoPago`  | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/reciboElectronicoPago`  |
| `MensajeReceptor`        | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeReceptor`        |
| `MensajeHacienda`        | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda`        |

## 2. Who issues what in a marketplace sale

### 2.1 What the rules say

- Every taxpayer under the income-tax and IVA laws must use electronic
  documents (RCE art. 3). The document is generated and transmitted "en el
  mismo acto de la compraventa o prestación del servicio" (RCE art. 2.6, 2.12, 18).
- The RCE has **no marketplace or intermediary rule**. The emisor is the
  taxpayer who sells or renders the service. Outsourcing the tooling is allowed
  ("desarrollo propio, software de mercado, desarrollo a la medida o
  tercerización") but compliance stays with the taxpayer (RCE art. 15).
- **Tiquete electrónico** is "únicamente para operaciones con consumidores
  finales" and cannot support the buyer's expenses or credits (RCE art. 2.25).
  A buyer who needs a deductible document needs a **factura electrónica** with
  their identification.
- **Régimen de Tributación Simplificada** taxpayers are exempt from issuing and
  confirming electronic documents, unless they registered voluntarily as
  "emisor receptor electrónico no confirmante", in which case they must issue
  when the customer asks (RCE art. 7.1, art. 4.2.f). RCE art. 2.13 says the
  factura electrónica de compra "no aplica ... a los contribuyentes del régimen
  de tributación simplificada, inscritos como emisores receptores electrónicos
  no confirmantes". The comma makes it ambiguous whether this covers every
  simplified-regime seller or only those registered as "no confirmante"
  **[ACCOUNTANT]**; it does not affect Yuntera's own documents.
- The annex contains two mechanisms designed for money collected by someone
  other than the seller:
  - Payment-method code `05` "Recaudado por terceros": "cuando el pago sea
    recibido por un tercero y no por quien emite el servicio o mercancía"
    (ANX nota 6 footnote 27, p. 71; the footnote text says "código 06" but the
    table assigns `05` — a typo in Hacienda's document).
  - `OtrosCargos` with `TipoDocumentoOC` `04` "Cobro de un tercero" and
    `IdentificacionTercero`, where the "tercero" is "el contribuyente que vende
    o presta el servicio o mercancía que se está cobrando" and must be a
    registered taxpayer (ANX pp. 47–49, footnote 15).
  - Sale-condition code `07` "Cobro a favor de un tercero" also exists
    (ANX nota 5, p. 70) with no further explanation.
- Payment-method code `07` "Plataforma Digital" has **no definition in the
  annex**. La Nación describes it as platforms "como PayPal o sistemas de
  boletería electrónica" (secondary).

### 2.2 Working model for Yuntera

| Flow                                        | Issuer   | Receiver      | Document                                                             | Notes                                                                                                                                                            |
| ------------------------------------------- | -------- | ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goods sold by a general-regime seller       | Seller   | Shopper       | `04` tiquete; `01` factura if the shopper gave an identification     | Seller's own system. Payment method on the seller's document when Yuntera collects: `05` fits the annex's wording best; `07` is undefined. **[ACCOUNTANT]**      |
| Goods sold by a Régimen Simplificado seller | —        | Shopper       | None, unless the seller is "no confirmante" and the shopper asks     | Listing and order must say so before purchase (already a product decision in `compliance-costa-rica.md`). Whether such sellers may sell online: **[ACCOUNTANT]** |
| Delivery fee charged to the shopper         | Yuntera  | Shopper       | `04` tiquete; `01` factura on request                                | 13% IVA, CABYS of a delivery service. Alternative allowed by the schema: a "cobro de un tercero" line on the seller's document. **[ACCOUNTANT]**                 |
| Commission, payment and warehouse fees      | Yuntera  | Seller        | `01` factura (receiver identification is mandatory in the FE schema) | 13% IVA. Per order or one per settlement period: the RCE says "en el acto"; periodic invoicing is common practice but is an **[ACCOUNTANT]** decision            |
| Refund of delivery / reversal of fees       | Yuntera  | Same receiver | `03` nota de crédito referencing the original clave                  | A document accepted by Hacienda can only be undone by NC/ND (RCE art. 10)                                                                                        |
| Refund of goods                             | Seller   | Shopper       | `03` nota de crédito from the seller's system                        | Yuntera records its clave like the original                                                                                                                      |
| Supplier invoices received by Yuntera       | Supplier | Yuntera       | Yuntera answers with a `MensajeReceptor` (`05`/`06`/`07`)            | Deadline in section 5.7. Out of scope for v1 code; do it in the accountant's tool                                                                                |

### 2.3 Obligations specific to platforms

**Seller reporting — MH-DGT-RES-0025-2024** (dated 23 Oct 2024; La Gaceta
Alcance 179, 6 Nov 2024; read in the Gazette PDF):

| Point             | Text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope             | "Actividad Relevante" = a relevant service (rental of real estate, personal service, rental of a means of transport) **"o la venta de bienes"** (art. 2.C.8). Article 1's summary names only lodging, transport and personal services, but the definitions govern                                                                                                                                                                                                                                                        |
| Who reports       | A platform operator tax-resident in Costa Rica, or constituted or managed here (art. 2.C.4). Yuntera qualifies                                                                                                                                                                                                                                                                                                                                                                                                           |
| Excluded operator | Platform-level consideration in the previous calendar year under **EUR 1 million** _and_ the operator notifies the tax administration that it opts to be treated as excluded (art. 2.C.3.a); the request goes signed to `Info-DPI@hacienda.go.cr` (art. 8)                                                                                                                                                                                                                                                               |
| Excluded seller   | Fewer than **30** sales of goods _and_ total consideration not above **EUR 2,000** in the period (art. 2.D.4.d); also government bodies and listed companies                                                                                                                                                                                                                                                                                                                                                             |
| Data to collect   | Individuals: name, main address, tax ID and issuing jurisdiction, **date of birth**. Entities: name, main address, tax ID, company registration number (art. 4.B)                                                                                                                                                                                                                                                                                                                                                        |
| Data to report    | Per seller and **per quarter**: total consideration paid or credited, number of relevant activities, and "cualquier tasa, comisión o impuesto retenido o cobrado" by the operator; financial account identifier where available (art. 5)                                                                                                                                                                                                                                                                                 |
| Channel           | SIIF, `https://siif.hacienda.go.cr/siif`, OECD "Sharing and Gig Economy" XML (art. 5.3)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Dates             | Due diligence from 1 Jan 2025; first report (2025 data) by 30 Apr 2026 (Transitorio único); afterwards a calendar-year period reported by 30 April of the following year (art. 5.6). A later resolution, MH-DGT-RES-0004-2026, reportedly moved the first filing window to 6 Apr–6 May 2026 (secondary: EAS Latam; **UNVERIFIED**, the resolution text was not found on hacienda.go.cr or by search). Either way the first window has passed: if Yuntera had sellers in 2025 the report was already due **[ACCOUNTANT]** |
| Retention         | 5 years (art. 11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Penalty           | 2% of the operator's gross income of the previous period, minimum 3 and maximum 100 base salaries; reduced 75% if filed within 3 days (art. 7, CNPT art. 106 quáter)                                                                                                                                                                                                                                                                                                                                                     |

Consequences for the build: seller onboarding must capture **date of birth**
for individuals and the **registration number** for entities (not captured
today as far as the schema shows), and finance must be able to produce
per-seller, per-quarter totals of consideration, count of sales and fees
charged. Whether to opt into the EUR 1 million exclusion is an **[ACCOUNTANT]**
decision; until it is formally requested, the reporting duty applies.

**Not found** (absence findings, secondary searches only): any rule making a
local marketplace withhold or collect IVA on local sellers' sales; any Hacienda
ruling on a marketplace issuing documents in sellers' names. If Yuntera ever
issues on sellers' behalf it becomes a "proveedor de sistemas de comprobantes
electrónicos" with its own duties (register that status with Hacienda, keep a
client register, let clients download everything: RCE art. 5; RES27 art. 7) and
its identification goes in each document's `ProveedorSistemas`. That is a
later phase and an **[ACCOUNTANT]** and lawyer question.

Other duties already in the fact sheet and unchanged: card-acquirer
withholdings, SINPE Móvil number registration (Decreto 45953-H).

## 3. Document anatomy (v4.4)

### 3.1 Document type codes (ANX nota 3, p. 66)

| Code | Document                    | Code | Document                           |
| ---- | --------------------------- | ---- | ---------------------------------- |
| `01` | Factura electrónica         | `06` | Receiver: partial acceptance       |
| `02` | Nota de débito electrónica  | `07` | Receiver: rejection                |
| `03` | Nota de crédito electrónica | `08` | Factura electrónica de compra      |
| `04` | Tiquete electrónico         | `09` | Factura electrónica de exportación |
| `05` | Receiver: acceptance        | `10` | Recibo electrónico de pago (REP)   |

The REP is new in 4.4 and only documents payments of credit sales under sale
conditions `08`/`10` (services to the State, 90-day IVA credit); Yuntera does
not need it. `MensajeReceptor` existed before 4.4.

### 3.2 Consecutive number — 20 digits (ANX nota 3, pp. 65–66)

| Positions | Length | Content                                                                          |
| --------- | ------ | -------------------------------------------------------------------------------- |
| 1–3       | 3      | Establishment: `001` = head office, `002`… = branches                            |
| 4–8       | 5      | Terminal / point of sale: `00001` when there is one terminal or a central server |
| 9–10      | 2      | Document type code (3.1)                                                         |
| 11–20     | 10     | Sequence starting at 1 **per branch/terminal and per document type**; wraps to 1 |

Rules: assigned automatically, strictly consecutive, "sin saltos", never
editable (RCE art. 13.4, 14.3, 14.6). Hacienda checks the sequence (ANX p. 19).
XSD pattern: `\d{20}`. A taxpayer changing systems must **continue** its
numbering (ANX p. 65) — ask the company's previous tool for the last numbers.

### 3.3 Clave — 50 characters (ANX nota 3, pp. 67–68; nota 4.1, p. 69)

| Positions | Length | Content                                                                                             |
| --------- | ------ | --------------------------------------------------------------------------------------------------- |
| 1–3       | 3      | Country code `506`                                                                                  |
| 4–5       | 2      | Day the document is generated                                                                       |
| 6–7       | 2      | Month                                                                                               |
| 8–9       | 2      | Year (two digits)                                                                                   |
| 10–21     | 12     | Issuer identification, left-padded with zeros to 12                                                 |
| 22–41     | 20     | The consecutive number (3.2)                                                                        |
| 42        | 1      | Situation: `1` normal, `2` contingency (replaces a provisional paper voucher), `3` without internet |
| 43–50     | 8      | Security code generated by the issuer's system                                                      |

Padding (nota 4.1): cédula física (9 digits) gets three zeros; cédula jurídica
(10) two; NITE (10) two; DIMEX of 11 digits gets one, of 12 none.
XSD pattern since April 2026: `[a-zA-Z0-9]{50}` because new legal entities can
have alphanumeric identifications (ANX bitácora 22/04/2026, item 1). The exact
shape of an alphanumeric cédula jurídica is **UNVERIFIED**.

`FechaEmision` must match the date in the clave (ANX p. 19). Use the
**Costa Rica calendar date** (UTC−6, no daylight saving): a server on UTC after
18:00 local time would otherwise stamp tomorrow's date.

Algorithm (checked by running it under Node 22):

```ts
const pad = (v: string | number, n: number) => String(v).padStart(n, "0");

function consecutivo(sucursal: number, terminal: number, tipo: string, numero: number) {
  // tipo: "01" | "02" | "03" | "04" | … ; numero: 1..9_999_999_999
  return pad(sucursal, 3) + pad(terminal, 5) + tipo + pad(numero, 10);
}

function clave(a: {
  emitidoEn: Date; // the same instant written to FechaEmision
  identificacion: string; // as stored, no dashes
  consecutivo: string; // 20 digits
  situacion: "1" | "2" | "3";
  seguridad: string; // 8 digits from a CSPRNG
}) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Costa_Rica",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(a.emitidoEn);
  const part = (t: string) => p.find((x) => x.type === t)!.value;
  const k =
    "506" +
    part("day") +
    part("month") +
    part("year") +
    a.identificacion.padStart(12, "0") +
    a.consecutivo +
    a.situacion +
    a.seguridad;
  if (!/^[A-Za-z0-9]{50}$/.test(k)) throw new Error("clave inválida");
  return k;
}
```

Worked example. Issuer: legal entity `3101123456` (the fictitious number used
in Hacienda's own API examples). Tiquete number 1532, head office, single
terminal, issued 21 Nov 2026 at 21:30 Costa Rica time (`2026-11-22T03:30:00Z`),
normal situation, security code `48291037`:

```
consecutivo = 001 00001 04 0000001532            -> 00100001040000001532
clave       = 506 21 11 26 003101123456 00100001040000001532 1 48291037
            -> 50621112600310112345600100001040000001532148291037   (50 chars)
```

Second example, individual seller `109870654` (made up), factura number 27 on
5 Jan 2027, security code `00000007`:
`50605012700010987065400100001010000000027100000007`.

To validate a clave reported by a seller: length 50; `506`; a real date;
positions 10–21 equal the seller's identification padded to 12; positions
30–31 are `01`, `04` (or `03` for a credit note); position 42 in `1`–`3`.
Do not use the sample clave in Hacienda's API page
(`50601011600310112345600100010100000000011999999999`) as a test vector: it
does not decompose into valid fields (situation `9`).

File names for storage and e-mail (ANX p. 68): `{clave}.xml`,
`{clave}_respuesta.xml`, `{clave}.pdf`.

### 3.4 Header, in schema order (ANX pp. 18–25; XSD)

Element order is fixed by `xs:sequence`. Conditions: 1 mandatory, 2 conditional,
3 optional, 4 must not appear.

| Element                    | Type / size                                                                               | FE  | TE         | NC  | Notes                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- | --- | ---------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Clave`                    | `[a-zA-Z0-9]{50}`                                                                         | 1   | 1          | 1   |                                                                                                                                                        |
| `ProveedorSistemas`        | string ≤ 20                                                                               | 1   | 1          | 1   | Identification of the software provider; **own development = the taxpayer's own identification**. Must be registered in the RUT or a warning is raised |
| `CodigoActividadEmisor`    | string, exactly 6                                                                         | 1   | 1          | 2   | Must exist in the taxpayer registry or the document is **rejected**; a code other than the registered one raises a warning                             |
| `CodigoActividadReceptor`  | string, exactly 6                                                                         | 2   | 4 (absent) | 2   | "Cuando este la requiera"; Hacienda will announce when it becomes mandatory for FE (ANX p. 18 footnote 1)                                              |
| `NumeroConsecutivo`        | `\d{20}`                                                                                  | 1   | 1          | 1   |                                                                                                                                                        |
| `FechaEmision`             | `xs:dateTime`, RFC 3339                                                                   | 1   | 1          | 1   | `YYYY-MM-DDThh:mm:ss-06:00`. No past or future dates except situation 3                                                                                |
| `Emisor/Nombre`            | 5–100                                                                                     | 1   | 1          | 1   |                                                                                                                                                        |
| `Emisor/Identificacion`    | `Tipo` (2) + `Numero` (≤ 20)                                                              | 1   | 1          | 1   | Types: `01` física, `02` jurídica, `03` DIMEX, `04` NITE; `05`/`06` only in purchase invoices                                                          |
| `Emisor/NombreComercial`   | 3–80                                                                                      | 3   | 3          | 3   |                                                                                                                                                        |
| `Emisor/Ubicacion`         | `Provincia` (1), `Canton` (2), `Distrito` (2), `Barrio` 5–50 optional, `OtrasSenas` 5–250 | 1   | 1          | 2   | Codes from `Codificacionubicacion_V4.4.xlsx`; a location other than the registered one raises a warning                                                |
| `Emisor/Telefono`          | `CodigoPais` (≤ 3 digits), `NumTelefono`                                                  | 3   | 3          | 3   |                                                                                                                                                        |
| `Emisor/CorreoElectronico` | ≤ 160, 1 to 4 occurrences                                                                 | 1   | 1          | 2   | Regex in ANX p. 22                                                                                                                                     |
| `Receptor`                 | see 3.5                                                                                   | 1   | **2**      | 2   |                                                                                                                                                        |
| `CondicionVenta`           | 2                                                                                         | 1   | 1          | 1   | 3.8                                                                                                                                                    |
| `CondicionVentaOtros`      | 5–100                                                                                     | 2   | 2          | 2   | Only with `99`                                                                                                                                         |
| `PlazoCredito`             | integer ≤ 5 digits, days                                                                  | 2   | 2          | 2   | Mandatory and > 0 with `02` or `10`                                                                                                                    |

Then `DetalleServicio`, `OtrosCargos` (0–15), `ResumenFactura`,
`InformacionReferencia` (0–10; 1–10 in NC/ND), `Otros`, `ds:Signature`.

The 6-character activity code: Hacienda's lookup API returns activities in the
form `"6110.0"`. How that maps to the 6-character value expected in the XML
after the TRIBU-CR migration is **UNVERIFIED**; take the exact code from the
company's TRIBU-CR registration and test it in the sandbox. The codes in the
samples of section 3.14 are placeholders. Secondary sources (Siempre al Día)
say activity codes had to follow CIIU revision 4 from TRIBU-CR's start on
6 Oct 2025; the XSD fixes the length at exactly 6. Some of the same sources
say the receiver's activity code is now required on every document: that
contradicts the annex, which keeps `CodigoActividadReceptor` conditional (2)
in FE until Hacienda announces otherwise (ANX p. 18 footnote 1). Follow the
annex, and capture each seller's activity code anyway so the field can be
filled the day it becomes mandatory.

### 3.5 Receiver rules

| Document | `Receptor` | `Identificacion` | Practical rule                                                                                                                        |
| -------- | ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| FE       | mandatory  | mandatory        | `Nombre` 3–100, `Identificacion/Tipo` + `Numero`; `Ubicacion` if domiciled in the country; `CorreoElectronico` when the customer asks |
| TE       | optional   | optional         | Omit the whole node for an anonymous final consumer                                                                                   |
| NC / ND  | optional   | optional         | If present it must match the original document                                                                                        |

For FE, FEE and TE Hacienda verifies that the receiver's number "sea un dato
real en los padrones y registros correspondientes" (ANX p. 23): validate it
before issuing (section 6.3). A tiquete cannot later be "upgraded" to a
factura; the route is credit note plus new factura (**[ACCOUNTANT]** on whether
to offer that at all). So the checkout must ask "¿Necesita factura a nombre de
una cédula?" before the document is issued.

### 3.6 Line fields (`DetalleServicio/LineaDetalle`, 1–1000; ANX pp. 26–47)

In schema order, for an ordinary taxed line:

| Element                        | Type                                                                                                 | Rule                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NumeroLinea`                  | 1–1000                                                                                               |                                                                                                                                               |
| `CodigoCABYS`                  | exactly 13 characters                                                                                | Mandatory in FE/TE; must be valid in the current catalogue or the document is rejected                                                        |
| `CodigoComercial` (0–5)        | `Tipo` (nota 12) + `Codigo` ≤ 20                                                                     | Optional (seller SKU: `Tipo` `01`); mandatory only for "surtido" CABYS codes                                                                  |
| `Cantidad`                     | decimal 16,3                                                                                         | > 0                                                                                                                                           |
| `UnidadMedida`                 | enumerated (nota 15)                                                                                 | Goods: `Unid`, `Kg`, `g`, `L`, `mL`, `m`…; services: `Sp`, `Spe`, `St`, `Os` ("otro tipo de servicio"), `Cm` ("comisiones"), `I`, `Al`, `Alc` |
| `TipoTransaccion`              | nota 22                                                                                              | Optional; not in the tiquete schema; `01` = normal sale                                                                                       |
| `UnidadMedidaComercial`        | ≤ 20                                                                                                 | Optional                                                                                                                                      |
| `Detalle`                      | 3–200                                                                                                | Mandatory                                                                                                                                     |
| `PrecioUnitario`               | decimal 18,5                                                                                         | > 0, **before IVA**                                                                                                                           |
| `MontoTotal`                   | 18,5                                                                                                 | `Cantidad × PrecioUnitario`                                                                                                                   |
| `Descuento` (0–5)              | `MontoDescuento`, `CodigoDescuento` (nota 20), optional `CodigoDescuentoOTRO`, `NaturalezaDescuento` | `CodigoDescuento` is mandatory with any discount: `06` promotional, `07` commercial, `04` volume, `99` other (then describe it)               |
| `SubTotal`                     | 18,5                                                                                                 | `MontoTotal − descuentos`                                                                                                                     |
| `IVACobradoFabrica`            | `01`/`02`                                                                                            | Not for Yuntera                                                                                                                               |
| `BaseImponible`                | 18,5                                                                                                 | **Mandatory** in 4.4; equals `SubTotal` unless selective/specific taxes apply                                                                 |
| `Impuesto` (1–1000)            | see 3.7                                                                                              | **Mandatory on every line**, including exempt ones                                                                                            |
| `ImpuestoAsumidoEmisorFabrica` | 18,5                                                                                                 | Mandatory element in FE/TE; `0` when not applicable                                                                                           |
| `ImpuestoNeto`                 | 18,5                                                                                                 | `Monto − MontoExoneracion` (or − assumed tax)                                                                                                 |
| `MontoTotalLinea`              | 18,5                                                                                                 | `SubTotal + ImpuestoNeto`                                                                                                                     |

### 3.7 Tax codes

`Impuesto/Codigo` (nota 8, p. 71): `01` IVA, `02` selective consumption, `03`
fuels, `04` alcoholic beverages, `05` soft drinks and soap, `06` tobacco, `07`
IVA special calculation, `08` IVA used goods (factor), `12` cement, `99` other.

`Impuesto/CodigoTarifaIVA` (nota 8.1, p. 72), mandatory with codes `01`/`07`;
`Tarifa` is the percentage as a number (`13`, `4`, `2`, `1`, `0.5`):

| Code | Rate                         | Use                                                                                        |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `01` | 0% (art. 32.1 RLIVA)         | Only for sales with full credit right (e.g. to the CCSS, municipalities). **Not** "exempt" |
| `02` | 1%                           | Canasta básica                                                                             |
| `03` | 2%                           | Medicines, private education, personal insurance                                           |
| `04` | 4%                           | Private health, air tickets                                                                |
| `05` | Transitional 0%              | Only in credit/debit notes                                                                 |
| `06` | Transitional 4%              | Only in credit/debit notes                                                                 |
| `07` | Transitional 8%              | Only in credit/debit notes                                                                 |
| `08` | **13% general**              |                                                                                            |
| `09` | 0.5%                         |                                                                                            |
| `10` | **Exempt** (Ley 9635 art. 8) | `Monto` must be `0`                                                                        |
| `11` | 0% without credit right      | Non-subject transactions                                                                   |

`Monto` = `Tarifa% × BaseImponible` (ANX p. 42). Hacienda checks that the
tarifa matches the code. Exemptions granted to a specific buyer use the
`Exoneracion` node inside `Impuesto` (`TipoDocumentoEX1` per nota 10.1,
`NumeroDocumento`, `NombreInstitucion` per nota 23, `FechaEmisionEX`,
`TarifaExonerada`, `MontoExoneracion`); authorisations can be checked at
`https://api.hacienda.go.cr/fe/ex?autorizacion=AL-XXXXXXXX-XX` (HAPI). Out of
scope for v1.

The IVA rate printed by the CABYS catalogue for a code (section 6) is the
reference for which tarifa applies; the seller and their accountant decide.

### 3.8 Sale condition and payment method

`CondicionVenta` (nota 5, p. 70): `01` contado, `02` crédito, `03`
consignación, `04` apartado, `05` arrendamiento con opción de compra, `06`
arrendamiento en función financiera, `07` cobro a favor de un tercero, `08`
servicios prestados al Estado, `09` pago de servicios prestados al Estado (REP
only), `10` venta a crédito en IVA hasta 90 días, `11` pago de la anterior (REP
only), `12` venta de mercancía no nacionalizada (FE only), `13` venta de bienes
usados no contribuyente (purchase invoice only), `14` arrendamiento operativo,
`15` arrendamiento financiero, `99` otros.

`MedioPago/TipoMedioPago` (nota 6, p. 71) — in 4.4 this node lives **inside
`ResumenFactura`**, repeats up to 4 times and carries an amount:

| Code | Method                                        |
| ---- | --------------------------------------------- |
| `01` | Efectivo                                      |
| `02` | Tarjeta                                       |
| `03` | Cheque                                        |
| `04` | Transferencia – depósito bancario             |
| `05` | Recaudado por terceros                        |
| `06` | **SINPE Móvil**                               |
| `07` | Plataforma Digital                            |
| `99` | Otros (`MedioPagoOtros` 3–100 then mandatory) |

`MedioPago` is mandatory except with sale conditions `02`, `08`, `10`.
`TotalMedioPago` becomes mandatory when more than one method is used, and the
amounts must then add up to `TotalComprobante` (ANX pp. 55–56).

### 3.9 Currency

`ResumenFactura/CodigoTipoMoneda` is mandatory everywhere: `CodigoMoneda`
(ISO 4217; `CRC`) and `TipoCambio` (18,5). For `CRC` the rate must be `1`. For
`USD`, the BCCR reference **selling** rate; available at
`https://api.hacienda.go.cr/indicadores/tc/dolar` (returned
`{"venta":{"fecha":"2026-11-21","valor":446.17},"compra":{…}}` today). Yuntera
prices in colones, so always `CRC` / `1.00000`.

### 3.10 `ResumenFactura` totals, in schema order (ANX pp. 50–56)

A CABYS code starting with `0`–`4` is a **good** ("mercancía"); `5`–`9` is a
**service**. Totals are split on that first digit.

| Element                                                                             | Calculation                                                                                         |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `TotalServGravados`, `TotalMercanciasGravadas`                                      | Sum of `MontoTotal` of taxed service / goods lines                                                  |
| `TotalServExentos`, `TotalMercanciasExentas`                                        | Lines with tarifa code `10`                                                                         |
| `TotalServExonerado`, `TotalMercExonerada`                                          | Exonerated share (buyer-specific exemptions)                                                        |
| `TotalServNoSujeto`, `TotalMercNoSujeta`                                            | Lines with tarifa codes `01` and `11`                                                               |
| `TotalGravado`, `TotalExento`, `TotalExonerado`, `TotalNoSujeto`                    | Services + goods of each class                                                                      |
| `TotalVenta` (mandatory)                                                            | `TotalGravado + TotalExento + TotalExonerado + TotalNoSujeto`                                       |
| `TotalDescuentos`                                                                   | Sum of all `MontoDescuento`                                                                         |
| `TotalVentaNeta` (mandatory)                                                        | `TotalVenta − TotalDescuentos`                                                                      |
| `TotalDesgloseImpuesto` (0–1000): `Codigo`, `CodigoTarifaIVA`, `TotalMontoImpuesto` | One entry per tax code + tarifa code used in the lines; **new and mandatory when any line has tax** |
| `TotalImpuesto`                                                                     | Sum of `Monto` of lines without exemption plus `ImpuestoNeto` of lines with one                     |
| `TotalImpAsumEmisorFabrica`, `TotalIVADevuelto`                                     | Not for Yuntera (`TotalIVADevuelto` is for health services paid by card)                            |
| `TotalOtrosCargos`                                                                  | Sum of `OtrosCargos/MontoCargo`                                                                     |
| `MedioPago` (0–4)                                                                   | 3.8                                                                                                 |
| `TotalComprobante` (mandatory)                                                      | `TotalVentaNeta + TotalImpuesto + TotalOtrosCargos − TotalIVADevuelto`                              |

Omit optional totals that do not apply (the three samples in 3.14 validate
that way).

### 3.11 Decimals and rounding

- Money is `xs:decimal`, 18 digits with **5 decimals**, `0` to
  `9999999999999.99999`; point as separator, no thousands separator (ANX p. 14).
- Rounding rule (ANX p. 14): look at the next decimal; below 5 keep, 5 or more
  round up (half-up). Example given: `20.203518` → `20.20352`.
- "Los campos que llevan cálculos se debe de cumplir con la fórmula planteada…
  caso contrario se rechaza" (ANX p. 17). The tolerance Hacienda applies is
  **UNVERIFIED** (the 4.2 change log mentions unspecified "márgenes de error en
  los decimales").

Yuntera stores IVA-inclusive prices in whole colones, while the XML wants
net amounts. Derive them with integer arithmetic at scale 10⁵ (BigInt), never
floats:

```
gross = IVA-inclusive line amount            (e.g. 2500)
net   = round5(gross / 1.13)                 = 2212.38938
tax   = round5(net × 0.13)                   = 287.61062
line  = net + tax                            = 2500.00000
```

Pitfall measured today: for some amounts `net + tax` differs from `gross` by
0.00001 (e.g. 100 → 88.49558 + 11.50443 = 100.00001; 333 → 333.00001). Keep
the formula-exact values in the XML (so `TotalComprobante` may read
`100.00001`), and with a single payment method either omit `TotalMedioPago` or
set it equal to `TotalComprobante`. Confirm in the sandbox that Hacienda
accepts this before relying on it.

### 3.12 `OtrosCargos` (0–15; ANX pp. 47–49)

`TipoDocumentoOC` (nota 16, p. 80): `01` contribución parafiscal, `02` timbre
Cruz Roja, `03` timbre Bomberos, `04` **cobro de un tercero**, `05` costos de
exportación, `06` impuesto de servicio 10%, `07` timbre de colegios
profesionales, `08` depósitos de garantía, `09` multas o penalizaciones, `10`
intereses moratorios, `99` otros (then `TipoDocumentoOTROS`). Fields:
`IdentificacionTercero` and `NombreTercero` (mandatory with `04`), `Detalle`
≤ 160, `PorcentajeOC` optional, `MontoCargo` > 0. A document may consist only
of `OtrosCargos` (no lines) when the type is `04`, `08`, `09` or `10`.
Other charges carry no IVA calculation in the document.

### 3.13 References, credit notes and replacement

`InformacionReferencia` (ANX pp. 57–58): `TipoDocIR` (nota 10), optional
`TipoDocRefOTRO`, `Numero` (≤ 50: the referenced **clave**), `FechaEmisionIR`
(not older than 10 years), `Codigo` (nota 9), optional `CodigoReferenciaOTRO`,
`Razon` (3–180).

| `TipoDocIR` | Meaning                                     | `Codigo` | Meaning                                                    |
| ----------- | ------------------------------------------- | -------- | ---------------------------------------------------------- |
| `01`        | Factura electrónica                         | `01`     | Anula documento de referencia                              |
| `02`        | Nota de débito                              | `02`     | Corrige monto                                              |
| `03`        | Nota de crédito                             | `04`     | Referencia a otro documento                                |
| `04`        | Tiquete electrónico                         | `05`     | Sustituye comprobante provisional por contingencia         |
| `08`        | Comprobante emitido en contingencia         | `06`     | Devolución de mercancía                                    |
| `10`        | Comprobante rechazado por Hacienda          | `07`     | Sustituye comprobante electrónico                          |
| `11`        | Sustituye factura rechazada por el receptor | `13`     | Anula por error material (new, Nov 2026)                   |
| `13`        | Facturación mes vencido                     | `14`     | Corrige monto por error material (new)                     |
| `19`        | Factura electrónica de exportación (new)    | `15`     | Sustituye comprobante electrónico por error material (new) |
| `20`        | Recibo electrónico de pago (new)            | `16`     | Sustituye comprobante electrónico rechazado (new)          |
| `99`        | Otros                                       | `17`     | Pago a comprobante electrónico (new; REP only)             |
|             |                                             | `99`     | Otros                                                      |

Not listed above: `Codigo` `08`–`12` (endorsed invoice, financial credit and
debit notes, non-domiciled provider, and `12`, reworded in April 2026 as
"Nota de crédito financiera por exoneración posterior a la facturación"), and
`TipoDocIR` `05`–`07`, `09` (disabled), `12`, `14`–`18`. Codes `13`–`17` and
`TipoDocIR` `19`, `20` are mandatory in issuing systems from 1 Nov 2026 (COM26).

Rules:

- Accepted documents are never deleted or edited; their effect is cancelled or
  adjusted with NC/ND (RCE art. 10; ANX p. 14).
- A credit note's total, or the sum of several, cannot exceed the referenced
  document plus its debit notes; Hacienda also checks that header data, CABYS
  and exchange rate match the original (ANX p. 58).
- Accounting period: codes `01`, `02`, `06` take effect in the period the note
  is issued; codes `13`, `14` in the period of the **original** document
  (ANX p. 73). When a note with `01` is followed by a new document, that new
  document references the original with `07`; after a `13` note it uses `15`
  (ANX p. 73). Which to use for an ordinary refund: `01` (full) or `06`
  (returned goods). **[ACCOUNTANT]**
- A document **rejected by Hacienda** "carece de validez": do **not** issue a
  credit note; issue a new document immediately that says which one it replaces
  (RCE art. 10, 19; RES27 art. 9) — reference `TipoDocIR` `10`, `Codigo` `16`.
  Whether the rejected document's consecutive number is considered consumed is
  **UNVERIFIED**; never reuse a number.

### 3.14 Samples validated against the April 2026 XSDs

The three documents below were validated with
`xmllint --noout --schema <xsd> <file>` on this machine, using a placeholder
`ds:Signature` as the last child of the root. Activity codes, the provider
identification and the CABYS choice for commissions are **placeholders**.

Tiquete for a ₡2,500 delivery fee paid by SINPE Móvil:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<TiqueteElectronico xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico"
                    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <Clave>50621112600310112345600100001040000001532148291037</Clave>
  <ProveedorSistemas>3101123456</ProveedorSistemas>
  <CodigoActividadEmisor>532000</CodigoActividadEmisor>
  <NumeroConsecutivo>00100001040000001532</NumeroConsecutivo>
  <FechaEmision>2026-11-21T21:30:00-06:00</FechaEmision>
  <Emisor>
    <Nombre>EJEMPLO PLATAFORMA SOCIEDAD ANONIMA</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>3101123456</Numero></Identificacion>
    <NombreComercial>Yuntera</NombreComercial>
    <Ubicacion><Provincia>1</Provincia><Canton>01</Canton><Distrito>01</Distrito>
      <OtrasSenas>Direccion exacta del domicilio fiscal</OtrasSenas></Ubicacion>
    <CorreoElectronico>facturacion@example.com</CorreoElectronico>
  </Emisor>
  <!-- no Receptor: anonymous final consumer -->
  <CondicionVenta>01</CondicionVenta>
  <DetalleServicio>
    <LineaDetalle>
      <NumeroLinea>1</NumeroLinea>
      <CodigoCABYS>6803000000000</CodigoCABYS>
      <Cantidad>1.000</Cantidad>
      <UnidadMedida>Os</UnidadMedida>
      <Detalle>Entrega a domicilio pedido YT-000123</Detalle>
      <PrecioUnitario>2212.38938</PrecioUnitario>
      <MontoTotal>2212.38938</MontoTotal>
      <SubTotal>2212.38938</SubTotal>
      <BaseImponible>2212.38938</BaseImponible>
      <Impuesto>
        <Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13.00</Tarifa>
        <Monto>287.61062</Monto>
      </Impuesto>
      <ImpuestoAsumidoEmisorFabrica>0.00000</ImpuestoAsumidoEmisorFabrica>
      <ImpuestoNeto>287.61062</ImpuestoNeto>
      <MontoTotalLinea>2500.00000</MontoTotalLinea>
    </LineaDetalle>
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda><CodigoMoneda>CRC</CodigoMoneda><TipoCambio>1.00000</TipoCambio></CodigoTipoMoneda>
    <TotalServGravados>2212.38938</TotalServGravados>
    <TotalGravado>2212.38938</TotalGravado>
    <TotalVenta>2212.38938</TotalVenta>
    <TotalVentaNeta>2212.38938</TotalVentaNeta>
    <TotalDesgloseImpuesto>
      <Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA>
      <TotalMontoImpuesto>287.61062</TotalMontoImpuesto>
    </TotalDesgloseImpuesto>
    <TotalImpuesto>287.61062</TotalImpuesto>
    <MedioPago><TipoMedioPago>06</TipoMedioPago><TotalMedioPago>2500.00000</TotalMedioPago></MedioPago>
    <TotalComprobante>2500.00000</TotalComprobante>
  </ResumenFactura>
  <!-- ds:Signature goes here, last child of the root -->
</TiqueteElectronico>
```

Differences for the other two validated samples:

- **Factura to a seller for commission** (root `FacturaElectronica`, its own
  namespace): add after `Emisor`
  `<Receptor><Nombre>…</Nombre><Identificacion><Tipo>02</Tipo><Numero>3101654321</Numero></Identificacion><CorreoElectronico>…</CorreoElectronico></Receptor>`;
  line with `UnidadMedida` `Cm`, net 2400.00000, tax 312.00000, line total
  2712.00000; payment written as
  `<MedioPago><TipoMedioPago>99</TipoMedioPago><MedioPagoOtros>Compensacion contra liquidacion de ventas</MedioPagoOtros><TotalMedioPago>2712.00000</TotalMedioPago></MedioPago>`.
  How a fee netted from a payout should be coded (`99`, `04`, or a credit sale)
  is an **[ACCOUNTANT]** decision.
- **Credit note cancelling the tiquete above** (root `NotaCreditoElectronica`):
  same lines and totals as the original, type `03` in consecutivo and clave,
  plus before the signature:

```xml
<InformacionReferencia>
  <TipoDocIR>04</TipoDocIR>
  <Numero>50621112600310112345600100001040000001532148291037</Numero>
  <FechaEmisionIR>2026-11-21T21:30:00-06:00</FechaEmisionIR>
  <Codigo>01</Codigo>
  <Razon>Pedido cancelado antes de la entrega</Razon>
</InformacionReferencia>
```

### 3.15 What changed from 4.3 to 4.4 (ANX bitácora, pp. 3–9)

- New header fields `ProveedorSistemas` and `CodigoActividadReceptor`; fax
  removed; up to 4 issuer e-mails; phone 8–20 digits (minimum relaxed in 2026).
- New document type `10` Recibo Electrónico de Pago; identification types `05`
  (non-domiciled foreigner) and `06` (non-taxpayer).
- `MedioPago` moved into `ResumenFactura`, with an amount per method; new
  codes `06` SINPE Móvil and `07` Plataforma Digital.
- Sale conditions `12`–`15`, `CondicionVentaOtros`; `PlazoCredito` is an
  integer number of days.
- Lines: `BaseImponible` and `Impuesto` mandatory on every line; discount codes
  (nota 20) mandatory with any discount; `CodigoTarifa` renamed
  `CodigoTarifaIVA`; new tarifa codes `09`, `10` (exempt), `11`; code `01`
  redefined; `ImpuestoAsumidoEmisorFabrica`; `MontoTotalLinea` = `SubTotal` +
  `ImpuestoNeto`; `TipoTransaccion`; `DetalleSurtido` for bundles;
  `NumeroVINoSerie`; medicine fields.
- Totals: "no sujeto" totals and `TotalDesgloseImpuesto` added;
  `TotalComprobante` must equal the sum of the `TotalMedioPago` amounts when
  two or more payment methods are used (ANX p. 56).
- `OtrosCargos`: element renames (`TipoDocumentoOC`, `PorcentajeOC`), nested
  `IdentificacionTercero`, codes `08`–`10`.
- References: elements renamed `TipoDocIR`, `FechaEmisionIR`; many new codes.
- Exemptions: `TipoDocumentoEX1`, `FechaEmisionEX`, `Articulo`, `Inciso`,
  institution codes (nota 23).
- `Otros` text limits 500; signature node may hold counter-signatures.
- **22 Apr 2026 adjustments** (new codes mandatory in issuing systems from
  1 Nov 2026, usable earlier, already live in both STAG and production: COM26,
  primary): alphanumeric legal-entity identifications "cuando este [el Registro
Nacional] así lo comunique" (so not yet in use; KPMG gives `3-101-A00001` as
  the expected shape, secondary); special short phone numbers; clearer
  `TotalIVADevuelto`; reference codes `13`–`17` and reworded `12`; reference
  document types `19`, `20`. COM26 is a communiqué, not a Gazette resolution
  (RCE art. 12 allows parameter changes by notice).

### 3.16 Dates

| Date        | Event                                                                                                                                                                                                  | Source                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 13 Nov 2024 | RES27 issued; six months from 1 Dec 2024 to implement 4.4; voluntary use from 1 Apr 2025                                                                                                               | RES27 Transitorio I                    |
| 11 Feb 2025 | Deadline moved to 1 Sep 2025; the press release says the resolution "está en proceso de publicación"                                                                                                   | Hacienda press release CP-08-2025      |
| Feb 2025    | That resolution: MH-DGT-RES-0001-2025 (secondary: Siempre al Día; Gazette text not located, **UNVERIFIED**)                                                                                            | Secondary                              |
| 1 Sep 2025  | 4.4 in force, 4.3 repealed (older versions only for notes adjusting documents issued under them)                                                                                                       | ANX p. 3                               |
| 6 Oct 2025  | TRIBU-CR starts at 09:00; ATV disabled partly or fully from 23:45 on 25 Sep 2025. MH-DGT-RES-0043-2025 lists RES27 among the resolutions it adapts to TRIBU-CR (what it changed in RES27 was not read) | RES43 (primary)                        |
| 6 Oct 2025  | Free invoicing tool TICO Factura starts; activity codes on CIIU 4                                                                                                                                      | Secondary (Siempre al Día; fact sheet) |
| 22 Apr 2026 | Adjustment log, new XSDs and communiqué published                                                                                                                                                      | ANX p. 3; XSD `Last-Modified`; COM26   |
| 27 Jul 2026 | New cryptographic keys need a 14-character PIN                                                                                                                                                         | Secondary (KPMG)                       |
| 1 Nov 2026  | April adjustments mandatory                                                                                                                                                                            | COM26 (primary); Delfino, 29 Oct 2026  |

The header of Anexo 2 still says "rige a partir del 01 de junio del 2025"
(ANX p. 84); that is stale text.

## 4. Signing

### 4.1 Requirements (ANX Anexo 2, pp. 84–96; p. 60)

| Item                    | Requirement                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                  | XMLDSig with **XAdES-EPES**, ETSI TS 101 903 **v1.3.2 or higher** (`xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"`)                                                                                                                                                                     |
| Packaging               | **Enveloped only**; `ds:Signature` at `/{Root}/ds:Signature`, the last child                                                                                                                                                                                                              |
| Key                     | RSA 2048 or 4096                                                                                                                                                                                                                                                                          |
| Digest                  | SHA-256 or SHA-512                                                                                                                                                                                                                                                                        |
| Signature method        | Example: `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`                                                                                                                                                                                                                              |
| Canonicalisation        | Example: `http://www.w3.org/2001/10/xml-exc-c14n#` for `SignedInfo` and both references. Anexo 1 (p. 14) says "C14n-20010315" instead: the document contradicts itself. Follow the example                                                                                                |
| Reference 1             | `URI=""`, transforms: XPath `not(ancestor-or-self::ds:Signature)` then exc-c14n; digest SHA-256; `Id="r-id-1"`                                                                                                                                                                            |
| Reference 2             | `Type="http://uri.etsi.org/01903#SignedProperties"`, `URI="#xades-id-…"`, transform exc-c14n, digest SHA-256                                                                                                                                                                              |
| `KeyInfo`               | `X509Data/X509Certificate` with the signing certificate                                                                                                                                                                                                                                   |
| `SigningTime`           | Present (example in UTC, `2021-11-27T19:35:06Z`)                                                                                                                                                                                                                                          |
| `SigningCertificate`    | `CertDigest` + `IssuerSerial` (the issuer's example digests the certificate with **SHA-1**; the receiver and endorsement counter-signature examples on pp. 89–94 name `xmlenc#sha512` but carry the same 20-byte value, so they prove nothing. Whether SHA-256 is accepted is UNVERIFIED) |
| Policy identifier       | `SigPolicyId/Identifier` = `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf`                                                                                 |
| Policy hash             | `SigPolicyHash`: `DigestMethod` `http://www.w3.org/2001/04/xmlenc#sha256`, `DigestValue` **`DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=`**                                                                                                                                               |
| `DataObjectFormat`      | `ObjectReference="#r-id-1"`, `MimeType` `application/octet-stream`                                                                                                                                                                                                                        |
| One mechanism at a time | Either a BCCR digital signature or Hacienda's cryptographic key                                                                                                                                                                                                                           |

Verified today: the SHA-256 of the PDF served at the policy URL (163,479 bytes,
last-modified 8 Jan 2025) is `0d6c629f…d21f`, whose base64 is exactly
`DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=`. Hard-code that value; do not
recompute it at run time (if Hacienda ever replaces the PDF the published
example is what validators were built against). Whether the validator checks
the hash at all is UNVERIFIED.

`xades:ClaimedRole` is only for receiver counter-signatures and endorsements;
not needed.

### 4.2 Key material

- **Hacienda cryptographic key**: a PKCS#12 file (`.p12`) with an RSA 2048 key
  and certificate ("RSA 2048 + SHA-256", ANX p. 86), generated by the taxpayer
  in the tax portal's "Comprobantes Electrónicos" section and protected by a
  PIN. Separate keys for the test and the production environments (ANX p. 86).
  The annex still describes ATV; since 6 Oct 2025 (RES43) this is done in
  TRIBU-CR's virtual office (OVi), whose public portal also carries the current
  "Anexos y Estructuras" (COM26). The exact menu path is UNVERIFIED (vendor
  pages variously name "Tico Factura" and "Comprobantes Electrónicos").
- PIN: 4 digits for keys issued before 27 Jul 2026; **14 characters** with
  upper case, lower case, digit and symbol for keys generated from that date;
  old keys remain valid until expiry or revocation; KPMG also reports a
  six-month transition for providers (secondary: KPMG; the Hacienda
  communiqué itself was not found, **UNVERIFIED**). Validity reported as
  4 years (Siempre al Día) or 2 years (Alegra): sources disagree, read the
  expiry from the certificate itself (`notAfter`) and alert well before it.
- **Alternative**: a BCCR "firma digital" certificate. Personal certificates
  live on a smart card and cannot sign unattended; legal-entity certificates
  ("sello electrónico") are requested from the BCCR (ANX p. 85). The
  cryptographic key is the practical choice for a server.
- Handling: the `.p12` and PIN are production secrets equivalent to the
  company's signature. Keep them in the server-side secret store only; never in
  a table reachable through row-level security, never in a client bundle, never
  in the repository. Signing must run in a server process.
- Parsing: old `.p12` files typically use legacy PKCS#12 encryption that
  OpenSSL 3 only opens with `-legacy`; which algorithms the new 14-character-PIN
  files use is UNVERIFIED. Safest path: convert once at provisioning time
  (`openssl pkcs12 -legacy -in key.p12 -nodes`) into a PKCS#8 PEM key and a PEM
  certificate, store those as secrets, and import the key with WebCrypto.

### 4.3 JavaScript / Node libraries (npm registry, 21 Nov 2026)

None of these is installed in this repository's `node_modules` today.

| Package                    | Latest (published)         | Licence        | Role and status                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xadesjs`                  | 3.1.0 (9 Nov 2026)         | MIT            | PeculiarVentures. Produces XAdES on top of `xmldsigjs`; `Sign()` options include `signingCertificate`, `signingTime`, `policy: { identifier: { value }, hash, digestValue? }`, `signedPropertiesReference`. Eight releases in the last 13 months. `engines`: Node `^20.19.0` or `>=22.12.0`; peers `xmldsigjs` and `xml-core` `^3.1.0`. In Node, register a DOM and XPath implementation (e.g. `@xmldom/xmldom`, `xpath`) |
| `xmldsigjs`                | 3.1.0 (9 Nov 2026)         | MIT            | XMLDSig engine used by `xadesjs`; supports C14N and exclusive C14N, RSASSA-PKCS1-v1_5, SHA-256/512                                                                                                                                                                                                                                                                                                                        |
| `xml-crypto`               | 6.4.0 (14 Oct 2026)        | MIT            | node-saml. XMLDSig only: the XAdES `QualifyingProperties` object and its reference must be built by hand. Viable, more code                                                                                                                                                                                                                                                                                               |
| `node-forge`               | 1.4.3 (4 Nov 2026)         | BSD-3 or GPL-2 | PKCS#12 parsing, hashing, X.509 fields (issuer name, serial) for `SigningCertificate`                                                                                                                                                                                                                                                                                                                                     |
| `@xmldom/xmldom`           | 0.9.12 (21 Aug 2026)       | MIT            | DOM for Node                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@facturacr/atv-sdk`       | 2.0.15-alpha (27 Jun 2026) | MIT            | Community Costa Rica SDK (token, send, sign). Alpha; depends on `xadesjs ^2.1.2`, `fast-xml-parser ^3.19`, `axios ^0.30`, `xmldom-alpha`. 4.4 coverage UNVERIFIED. Read it as a reference, do not depend on it                                                                                                                                                                                                            |
| `haciendacostarica-signer` | 1.0.2 (28 Jun 2019)        | MIT            | Unmaintained since 2019. Reference only                                                                                                                                                                                                                                                                                                                                                                                   |
| `xmllint-wasm`             | 5.3.0 (5 Aug 2026)         | MIT            | XSD validation in Node without native code; `libxmljs2` 0.37.0 (1 Jun 2025) is the native alternative. The `xmllint` CLI validated the samples here                                                                                                                                                                                                                                                                       |

Recommended stack: build the XML with a small typed builder, validate with the
XSDs in CI and before every send, sign with `xadesjs` 3.x on Node 22's built-in
WebCrypto. With `xadesjs` check three things against Hacienda's example before
the sandbox test: (a) reference 1 uses the XPath + exc-c14n transforms (the
library's `"enveloped"` transform is the usual equivalent — acceptance
UNVERIFIED), (b) the `SigningCertificate` digest algorithm, (c) the policy
block matches 4.1 byte for byte. No library was run against Hacienda in this
research: **acceptance of any signature is UNVERIFIED until a sandbox test**.

## 5. The API

### 5.1 Endpoints

| Purpose         | Production                                                                                 | Sandbox                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Token           | `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token` | `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token`   |
| Logout          | `…/auth/realms/rut/protocol/openid-connect/logout`                                         | `…/auth/realms/rut-stag/protocol/openid-connect/logout`                                           |
| `client_id`     | `api-prod`                                                                                 | `api-stag`                                                                                        |
| API base        | `https://api.comprobanteselectronicos.go.cr/recepcion/v1/`                                 | Annex: `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/` — see the warning below |
| User name shape | `cpf-01-1234-5678@comprobanteselectronicos.go.cr` (ANX example)                            | `cpj-3-101-XXXXXX@stag.comprobanteselectronicos.go.cr` (IDP example)                              |

Sources: ANX Anexo 3 (pp. 97–98) for production; IDP for the sandbox realm and
client. Both realms' OIDC discovery documents
(`…/auth/realms/{realm}/.well-known/openid-configuration`) were fetched today
and list `password` and `refresh_token` among `grant_types_supported`.

**Sandbox URL warning (observed today, without credentials):**

| Request                                                                                 | Response                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion/{clave}`         | 401, body `{"message":"Unauthorized"}`, header `x-amzn-errortype: UnauthorizedException` (route exists)                                                                       |
| `GET https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/recepcion/{clave}` | 401, same body and header (route exists)                                                                                                                                      |
| `GET https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion/{clave}` | 403, body `{"message":"Missing Authentication Token"}`, header `x-amzn-errortype: MissingAuthenticationTokenException` (the gateway's answer for a route that does not exist) |

Re-run in the fact-check on 21 Nov 2026 with the same results. COM26 (April
2026) still names a test environment "STAG", so the sandbox exists; nothing
found suggests TRIBU-CR changed the IdP realms, client ids or API hosts. Both
discovery documents advertise `http://` URLs in `issuer` and
`token_endpoint`; always call the `https://` form.

So the sandbox appears to live at
`https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/`, not at the
path printed in the annex. Make the base URL configuration and confirm with
real sandbox credentials.

### 5.2 Token (ANX pp. 97–98; IDP)

```
POST {token URL}
Content-Type: application/x-www-form-urlencoded; charset=utf-8

grant_type=password&client_id=api-stag&username={url-encoded}&password={url-encoded}
```

- `client_secret` and `scope` are left empty.
- User name and password are generated per taxpayer **per environment** in the
  tax portal and arrive in the taxpayer's electronic mailbox. Passwords are
  about 20 characters and contain symbols: always URL-encode the form.
- Response (JSON): at least `access_token` and `refresh_token` (both JWTs);
  read `expires_in` and `refresh_expires_in` instead of hard-coding.
- Access token lifetime: **5 minutes** (ANX p. 97; IDP p. 12). Refresh token:
  the guide's text says `refresh_expires_in` was **10 hours** when it was
  written (IDP p. 12, "Actualizado al 29 de octubre de 2018"), while its 2017
  sample token lived 30 minutes (decoded `exp − iat`). Today's value is
  UNVERIFIED; read `refresh_expires_in` from each response.
- Refresh: same URL, `grant_type=refresh_token&client_id=…&refresh_token=…`.
- Logout: `POST {logout URL}` with `client_id` and `refresh_token` → `204`.
  The annex asks clients to "cerrar la sesión al terminar".
- Call the API with `Authorization: bearer {access_token}`.
- Checked today: a POST without a user name returns
  `401 {"error":"invalid_request","error_description":"Missing parameter: username"}`.

Simplest correct client: cache the access token in memory, request a new one
with the password grant when fewer than 30 seconds remain, serialise token
requests per taxpayer.

### 5.3 `POST /recepcion` (API)

```json
{
  "clave": "50621112600310112345600100001040000001532148291037",
  "fecha": "2026-11-21T21:30:00-06:00",
  "emisor": { "tipoIdentificacion": "02", "numeroIdentificacion": "3101123456" },
  "receptor": { "tipoIdentificacion": "02", "numeroIdentificacion": "3101654321" },
  "callbackUrl": "https://example.com/hacienda/callback",
  "consecutivoReceptor": "…only when sending a MensajeReceptor…",
  "comprobanteXml": "PD94bWwgdmVyc2lvbj0iMS4wIi…"
}
```

| Field                 | Required                   | Notes                                                                                                                                                                                                                          |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clave`               | yes                        | ≤ 50                                                                                                                                                                                                                           |
| `fecha`               | yes                        | RFC 3339 date-time; the doc's pattern is `yyyy-MM-dd'T'HH:mm:ssZ` and its example reads `2016-01-01T00:00:00-0600` (no colon). Which offset spellings are accepted is UNVERIFIED; start with the same string as `FechaEmision` |
| `emisor`              | yes                        | `tipoIdentificacion` (2), `numeroIdentificacion` (≤ 12)                                                                                                                                                                        |
| `receptor`            | no                         | Omit for a tiquete without receiver                                                                                                                                                                                            |
| `callbackUrl`         | no                         | 5.5                                                                                                                                                                                                                            |
| `consecutivoReceptor` | only for receiver messages | 20 digits                                                                                                                                                                                                                      |
| `comprobanteXml`      | yes                        | The **signed** XML, UTF-8 bytes, Base64                                                                                                                                                                                        |

Responses:

| Status | Meaning                                                                                   | Headers                                                                                           |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `201`  | Received; validation still pending. (The reference says 201; treat any 2xx as "received") | `Location` (status URL), `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`        |
| `400`  | Validation error                                                                          | `X-Error-Cause` (e.g. "El comprobante con la Clave […] ya fue recibido."), `validation-exception` |
| `401`  | Token missing or expired                                                                  |                                                                                                   |

These three are the only statuses the reference documents for `POST
/recepcion`. It documents no `202` (often quoted by vendors) and no `403`; a
`403` observed so far is the API gateway's answer for a path that does not
exist (5.1), not a validation answer; treat any other `403` as a configuration
error and alert. `validation-exception` is a boolean
header ("Indica si es un error con el body enviado"). The `Location` example
ends with a trailing slash.

A `400` whose cause says the clave was already received means an earlier
attempt succeeded: switch to polling, do not create a new document.

### 5.4 `GET /recepcion/{clave}` (API)

```json
{
  "clave": "…",
  "fecha": "2026-11-21T21:30:00-0600",
  "ind-estado": "aceptado",
  "respuesta-xml": "PD94…"
}
```

`ind-estado` ∈ `recibido`, `procesando`, `aceptado`, `rechazado`, `error`.
`respuesta-xml` is Hacienda's `MensajeHacienda` in Base64 once a final
state exists, signed with XAdES-XL according to the reference. `404` with `X-Error-Cause` when the clave is unknown.

`MensajeHacienda` (XSD): `Clave`, `NombreEmisor`, `TipoIdentificacionEmisor`,
`NumeroCedulaEmisor`, optional receiver fields, `Mensaje` (`1` accepted, `3`
rejected), `EstadoMensaje`, `DetalleMensaje` (free text with the rejection
reasons or warnings), optional `MontoTotalImpuesto`, `TotalFactura`,
`ds:Signature`. Store it as `{clave}_respuesta.xml`.

Also available: `GET /comprobantes?offset=&limit=&emisor=&receptor=` (default
50 per page, `206` with `Content-Range` on partial lists) and
`GET /comprobantes/{clave}` (summary with linked credit and debit notes).
Whether a taxpayer can query documents it neither issued nor received is
UNVERIFIED; assume not.

Hacienda validates in three levels — structure, field formats, then data
against its registries (ANX p. 17) — and has up to **3 hours** to answer
(RES27 art. 11).

### 5.5 Callback (ANX p. 99; API)

- Hacienda POSTs `application/json` to `callbackUrl` with the same body as the
  GET. The endpoint must answer **HTTP 200**; otherwise Hacienda retries **3
  times**, then stops and only logs it. Polling must exist as the fallback.
- Key names differ between the two official documents: the annex example uses
  `indEstado` / `respuestaXml` (value `"RECIBIDO"`), the API reference uses
  `ind-estado` / `respuesta-xml` (lower-case values). Accept both spellings and
  compare states case-insensitively.
- The callback is unauthenticated. Treat it as a hint: on receipt, re-fetch
  `GET /recepcion/{clave}` with the token (or verify the signature of the
  embedded `MensajeHacienda`) before changing state. Put an unguessable token
  in the callback path.

### 5.6 Rate limits

- Recepción API: only the three `X-Ratelimit-*` headers are documented; the
  numeric limits are **UNVERIFIED**. Read the headers and back off.
- Lookup API `api.hacienda.go.cr` (HAPI): burst 20 requests/s over 5 s (max
  100 in 5 s) and sustained 10 requests/s over 120 s (max 1,200 in 2 minutes);
  exceeding either blocks the **IP for 10 minutes**; HTTP 429. Hacienda
  recommends a local cache. Shared cloud egress IPs can trip this.

### 5.7 Timing, contingency, delivery, retention

| Rule                     | Detail                                                                                                                                                                                                                                               | Source                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| When to issue            | In the act of sale or service                                                                                                                                                                                                                        | RCE art. 18                     |
| When to send to Hacienda | "De forma inmediata y automatizada"                                                                                                                                                                                                                  | RCE art. 21                     |
| Issuer has no internet   | Generate and sign at the time of sale; send within **2 business days**; situation digit `3`                                                                                                                                                          | RCE art. 21                     |
| Hacienda's link is down  | Store the files and send when the link is back; no paper voucher. (No deadline or situation change is stated)                                                                                                                                        | RCE art. 21                     |
| Issuer's system unusable | Pre-printed "comprobante provisional"; within **2 business days** after recovery issue the electronic documents (situation `2`) referencing each voucher (`TipoDocIR` `08`, `Codigo` `05`); keep proof of the contingency                            | RCE art. 23; ANX nota 3         |
| Delivery to the buyer    | At the time of sale, by the agreed electronic means (e-mail or "puesta a disposición"), XML plus PDF representation, **even before Hacienda answers**; then deliver Hacienda's confirmation when it arrives                                          | RCE art. 2.11, 18; RES27 art. 5 |
| PDF                      | Legible content; document type, clave and consecutive number shown together; code descriptions instead of bare codes                                                                                                                                 | ANX notas 1, 7; RES27 art. 5    |
| QR code                  | 2.5 × 2.5 cm, bottom right — but its entry into force was **suspended** until Hacienda announces it (RES27 Transitorio III). Whether it has since been activated is UNVERIFIED; reserve the space                                                    | RES27                           |
| Hacienda rejects         | Document is void; issue a replacement immediately; no credit note                                                                                                                                                                                    | RCE art. 10, 19                 |
| No acceptance message    | A document without Hacienda's acceptance message cannot support the receiver's IVA credit or deductible expense. A fee factura stuck in `recibido` or rejected costs the seller their input IVA, so the 3-hour alert in 8.2 is a seller-facing issue | RCE art. 21; RES27 art. 11      |
| Receiver's confirmation  | Taxpayer receivers send a `MensajeReceptor` (accept / partial / reject) to Hacienda within **8 business days counted from the first day of the month following** the transaction; silence = accepted. Not applicable to final consumers              | RES27 art. 10; RCE art. 20      |
| Receiver rejects         | Issuer must immediately issue the credit/debit note and, if needed, a new document                                                                                                                                                                   | RES27 art. 10                   |
| Retention                | All XML issued, sent and received and associated documents: **5 years** (CNPT art. 109), without prejudice to the longer limitation period of CNPT art. 51; unalterable, legible, retrievable                                                        | RCE art. 4.1.i, 22              |
| Provider retention       | A software provider only has to keep data two months; the taxpayer is responsible for the archive                                                                                                                                                    | RES27 art. 7; RCE art. 16       |
| Penalties                | Not issuing or delivering: CNPT arts. 85–86; not sending the XML: CNPT art. 83                                                                                                                                                                       | RCE art. 24                     |

Suggested retention for Yuntera's own archive: 10 years, to cover the extended
limitation period. **[ACCOUNTANT]**

## 6. CABYS

### 6.1 What it is

The "Catálogo de Bienes y Servicios", published by the BCCR and required on
every line as a 13-character code (ANX nota 17; p. 26). An invalid code gets
the document rejected. First digit `0`–`4` = goods, `5`–`9` = services
(ANX pp. 50–52). Each code carries a reference IVA rate.

### 6.2 API (HAPI; called today)

```
GET https://api.hacienda.go.cr/fe/cabys?q=camiseta&top=2     # description search, q ≥ 3 chars
GET https://api.hacienda.go.cr/fe/cabys?codigo=2829000000200  # exact code
```

Search response:

```json
{
  "total": 16,
  "cantidad": 2,
  "cabys": [
    {
      "codigo": "2829000000200",
      "descripcion": "Camisetas para bebé",
      "categorias": ["…8 levels…"],
      "impuesto": 13,
      "uri": "https://api.hacienda.go.cr/fe/cabys?codigo=2829000000200",
      "estado": ""
    }
  ]
}
```

Code lookup returns an **array** (`[]` when the code does not exist) of
`{ codigo, descripcion, categorias[], impuesto }`. No authentication. Limits in
5.6. Search is literal (accents matter: `mensajeria` returned 0 results).

The BCCR download page given in older guides
(`https://www.bccr.fi.cr/indicadores-economicos/catálogo-de-bienes-y-servicios`)
returned 404 today; the current location of the full catalogue file is
UNVERIFIED. Mirror what you need through the API.

### 6.3 Other lookups on the same API

- `GET /fe/ae?identificacion={9–12 digits}` → `nombre`, `tipoIdentificacion`,
  `regimen { codigo, descripcion }` (e.g. `1` "Régimen general"),
  `situacion { moroso, omiso, estado, administracionTributaria }`,
  `actividades[] { estado, tipo, codigo, descripcion }`. Use it at seller
  onboarding (identity, regime, active status, activities) and to validate a
  shopper's identification before issuing a factura.
- `GET /indicadores/tc/dolar`, `/indicadores/tc/dolar/historico?d=&h=`,
  `/indicadores/tc/euro`, `/indicadores/tc`.
- `GET /fe/ex?autorizacion=AL-XXXXXXXX-XX` (exemption authorisations).

### 6.4 What Yuntera needs from sellers and for itself

- **Per product**: the 13-digit CABYS code, chosen by the seller (it is the
  seller's document and tax position). The listing form should offer a search
  box backed by a cached proxy of `/fe/cabys`, store `cabys_code`, and show the
  catalogue's rate next to the seller's chosen IVA rate, warning when they
  differ. Sellers under the Régimen Simplificado do not issue documents, so the
  field can be optional for them.
- **Per seller**: identification type and number, legal name, tax regime,
  registered economic activity, fiscal address (province, cantón, district,
  other signs), invoicing e-mail — all needed as the receiver of Yuntera's fee
  invoices — plus date of birth or registration number for the platform report
  (2.3).
- **For Yuntera's own lines** (candidates found by searching the API today; the
  choice is an **[ACCOUNTANT]** decision):

| Use                             | Candidate code                                                                                                                                                                   | Rate |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Delivery fee                    | `6803000000000` "Servicios de entrega local"                                                                                                                                     | 13%  |
| Sales commission                | Family `625xxxxxxxxxx` "Servicios de venta al por menor de …, prestados a comisión o por contrato (bienes que son propiedad de otros)", e.g. `6254400000000` (electrodomésticos) | 13%  |
| Warehouse / fulfilment fee      | `6729000000000` "Servicios de almacenamiento y depósito, n.c.p."                                                                                                                 | 13%  |
| Payment-processing pass-through | `7119002009900` "Gestión de comisiones de tarjeta de crédito y débito, n.c.p."                                                                                                   | 13%  |

## 7. Direct integration or a provider

### 7.1 Direct

- Cost: none per document. Needs: the company registered as taxpayer and as
  "emisor receptor electrónico", API user and password and a cryptographic key
  for each environment, and the pieces in sections 3–5.
- Work: XML builder and totals (deterministic, unit-testable), numbering,
  XSD validation, XAdES signature, token client, send/poll/callback worker,
  PDF, archive. The API surface is two calls.
- Risks: signature acceptance cannot be proven until sandbox credentials
  exist; the format moves (two mandatory changes in 14 months); rejected
  documents are void, so bugs are visible to customers.

### 7.2 Local providers with a public API (vendor pages read today; all secondary)

| Provider                 | API                                                                                                                                       | Multi-issuer                        | Published price                                                                                                                         | Notes                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AFECR (Anthon Solutions) | REST, docs `https://afecr.com/doc`, sandbox (100 test documents), webhooks on integrator plans; FE, TE, NC, ND, FEC, FEE, REP             | Up to 3 / 10 / 25 companies by plan | Prepaid packs, IVA included: ₡5,537 (250 documents), ₡8,927 (500), ₡16,837 (1,000), ₡33,787 (3,000), ₡45,087 (5,000)                    | States v4.4                                                                                           |
| Factúrele                | REST, docs `https://portal.facturele.com/api-docs`, test environment, webhooks; 7 document types and supplier-invoice reception           | Yes (accounting-firm plan)          | "Desde" US$6.15 per quarter for companies, API "desde 500 documentos"; billed by volume; 1 month free                                   | States v4.4                                                                                           |
| FACTURATica              | HTTPS POST form-encoded web service, polling for status                                                                                   | Not described                       | API only on annual "ILIMITADO TODO" licences (price not on the page); optional US$500 one-off assisted integration; no per-document fee | Key is uploaded to their panel; page version 2.6.1 dated 15 Nov 2026 references annex 4.4             |
| FactuGo                  | REST, docs `http://app.factugo-cr.com/integrations/api/documentation`                                                                     | Not stated                          | US$54 / 87 / 130 per month + IVA for 500 / 1,250 / 3,000 documents                                                                      |                                                                                                       |
| Factura en CR            | REST, JavaScript SDK                                                                                                                      | Claimed (search result)             | "Desde ₡2.49" per document, 3 free per month (search result; not confirmed on the page read)                                            | The page's usage counters showed zero: treat as new and unproven                                      |
| Alegra                   | REST `https://api.alegra.com/api/v1/…`, webhooks; `POST /invoices/stamp` emits up to 10 invoices; a Costa Rica REP endpoint is documented | One company per account             | Costa Rica plan prices not retrieved                                                                                                    | An accounting product with an API rather than an invoicing API; no idempotency key (third-party note) |
| Gosocket                 | —                                                                                                                                         | —                                   | —                                                                                                                                       | No evidence found of a Costa Rica issuing API: **UNVERIFIED**                                         |

With any provider: they hold the company's `.p12` and API password; they
usually assign the consecutive number and clave themselves (so numbering moves
out of Yuntera's control — keep one issuing channel per document type, or
dedicate a terminal number to the provider); their `ProveedorSistemas` goes in
the XML; and the taxpayer still owns the 5-year archive (providers only have to
keep two months).

### 7.3 Hacienda's free tool

**TICO Factura** is Hacienda's own free invoicing tool inside TRIBU-CR (it is
not a third-party provider). It started with TRIBU-CR on 6 Oct 2025, is
optional, is built for a single user, has no connection to other systems and
no API was found (secondary: Siempre al Día, updated 26 Jan 2026; Delfino,
29 Oct 2026, says the November 2026 adjustments must be available in it). The
regulation keeps the free tool for professionals, MEIC/MAG micro and small
enterprises, "no emisor" receivers and "no confirmante" issuers, and notes that
it stores documents for only two months (RCE art. 16, 22). Use for Yuntera:
none in the automated flow; it is a legitimate answer for small sellers who
have no invoicing system ("puede usar TICO Factura, gratis, en TRIBU-CR").
The old ATV "facturador gratuito" is assumed retired with ATV (UNVERIFIED).

## 8. Recommended v1

### 8.1 Decisions

1. **Sellers issue their own documents for the goods**, with whatever they
   already use (their provider or TICO Factura), and record them on the order.
   Yuntera does not sign or send anything in a seller's name in v1.
2. **Yuntera issues its own documents only**: delivery tiquete or factura to
   the shopper at payment capture; fee factura to each seller (per order or per
   settlement period, per the accountant); credit notes for reversals.
3. **Build a provider-neutral pipeline with a direct Hacienda adapter**, and a
   local stand-in for Hacienda next to `tools/dev-api` (token, `POST
   /recepcion`, `GET /recepcion/{clave}`, optional callback, scripted
   accept/reject). Everything except real acceptance can be built and tested
   now. Before launch, run a certification pass in Hacienda's sandbox with real
   credentials; if that is not possible in time, plug a provider (7.2) into the
   same interface. The owner decides between the two at that gate.
4. **Shoppers choose at checkout** between an anonymous tiquete and a factura
   to an identification they type, validated against `/fe/ae`.

### 8.2 Pipeline for Yuntera's own documents

```
order event ──> fiscal document row (status pending, numbers allocated, clave built)
            ──> build XML ──> XSD validate ──> sign (XAdES-EPES) ──> store {clave}.xml
            ──> deliver XML + PDF to the receiver (do not wait for Hacienda)
            ──> POST /recepcion ──> status sent
            ──> callback or polling (5 s, 15 s, 60 s, then every 5 min up to 3 h, then hourly + alert)
            ──> aceptado: store {clave}_respuesta.xml, status accepted, deliver confirmation
                rechazado: status rejected, alert staff, create replacement (ref. 10 / 16) after the cause is fixed
```

- **Numbering**: one counter per (issuer, establishment, terminal, document
  type). Allocate inside the same database transaction that inserts the
  document row, with a row lock, so numbers are gapless and never duplicated.
  Send documents of one counter in order.
- **Idempotency**: the clave is the idempotency key end to end. Never rebuild a
  document for an existing clave; re-sending the identical signed XML is safe
  (a duplicate yields the `400` "ya fue recibido").
- **Signing and sending run server-side** in a worker with access to the
  secret store; the browser apps and their row-level-security roles must not be
  able to read keys, signed XML of other parties, or trigger issuance directly.
- **Failure handling**: network errors and `5xx` → retry with backoff, same
  XML; `401` → new token, retry; `400` validation → mark `rejected_local`,
  alert, never auto-edit; no answer after 3 hours → alert, keep polling.

### 8.3 Data to store per document issued by Yuntera

| Group        | Fields                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity     | `document_type`, `clave` (50, alphanumeric), `consecutivo` (20), establishment, terminal, sequence number, situation (`1`–`3`), security code, schema version (`4.4`), `proveedor_sistemas`                                        |
| Issuer       | Identification type and number, legal name, commercial name, activity code, province/cantón/district/other signs, e-mails (snapshot at issue time)                                                                                 |
| Receiver     | Nullable: identification type and number, name, e-mail, address, activity code                                                                                                                                                     |
| Commercial   | `emitted_at` (timestamptz; the instant used for `FechaEmision` and the clave date), sale condition, credit days, currency, exchange rate, payment methods with amounts                                                             |
| Lines        | Per line: number, CABYS, commercial code, quantity, unit, description, unit price, discounts (amount, code), subtotal, taxable base, tax code, tarifa code, tarifa, tax amount, exemption data, net tax, line total                |
| Charges      | `OtrosCargos` entries: type, third-party identification and name, description, amount                                                                                                                                              |
| Totals       | Every `ResumenFactura` value written to the XML, plus the IVA-inclusive amount charged in minor units for reconciliation                                                                                                           |
| Reference    | Referenced clave, its type and date, reference code, reason; `replaces_id` / `replaced_by_id`                                                                                                                                      |
| Links        | `order_id`, `seller_id` (as receiver of fee invoices), settlement or payout id, refund id                                                                                                                                          |
| Artefacts    | Storage path and SHA-256 of the signed XML, of Hacienda's response XML, of the PDF                                                                                                                                                 |
| Transmission | Status, `sent_at`, HTTP status and `X-Error-Cause` of the last attempt, attempt count, `next_attempt_at`, `last_polled_at`, Hacienda state, `accepted_at` / `rejected_at`, `DetalleMensaje`, transport (`direct` or provider name) |
| Delivery     | When and how the XML/PDF and the confirmation were delivered to the receiver                                                                                                                                                       |

### 8.4 Data to store per document reported by a seller

| Field                             | Rule                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clave`                           | Validated as in 3.3; issuer part must equal the seller's identification                                                                                                     |
| Derived from the clave            | Document type, date, consecutive number, situation                                                                                                                          |
| `total` declared                  | Compared with the seller's share of the order                                                                                                                               |
| Signed XML (strongly recommended) | Parse: root and namespace are v4.4, `Clave` equals the reported one, `Emisor/Identificacion/Numero` equals the seller's, `TotalComprobante` matches; store path and SHA-256 |
| Hacienda response XML (optional)  | `MensajeHacienda/Mensaje` = `1`; store                                                                                                                                      |
| PDF (optional)                    | Shown to the shopper                                                                                                                                                        |
| `verification`                    | `clave_only` / `xml_checked` / `hacienda_response_checked`                                                                                                                  |
| `no_document_reason`              | `regimen_simplificado` when the seller is exempt                                                                                                                            |
| Audit                             | Who reported it and when; later credit notes linked to the original                                                                                                         |

A packing or payout step can require the clave before the seller's payout is
released. On the shopper's order page, show per seller: document type, clave,
issue date, total, download links, and Yuntera's own delivery document
separately; for exempt sellers the text "Este vendedor está en el Régimen de
Tributación Simplificada y no emite factura electrónica". Whether a public
Hacienda page lets a shopper verify a clave is UNVERIFIED.

### 8.5 Mapping to the current repository

- `supabase/migrations/20261121080800_finance.sql` lines 372–388 define
  `electronic_invoices` with `clave`, `consecutivo`, `status`
  (`pending`/`sent`/`accepted`/`rejected`/`voided`), `total_minor`, `xml_path`,
  `hacienda_message`. It holds a fraction of 8.3; the lines, totals, receiver,
  reference, artefact hashes and transmission fields are missing, and there is
  no numbering table.
- Suggested status mapping: `pending` (numbered, not yet sent), `sent`
  (`recibido`/`procesando`), `accepted`, `rejected`, `voided` (fully reversed
  by a credit note).

## 9. Things an implementer must not get wrong

### 9.1 Format

1. Use the `.xsd` files dated 22 Apr 2026, not the `.xsd.xml` ones.
2. Element order is fixed; `MedioPago` is inside `ResumenFactura`.
3. Every line needs `BaseImponible`, at least one `Impuesto`,
   `ImpuestoAsumidoEmisorFabrica` (FE/TE), `ImpuestoNeto`, `MontoTotalLinea`.
4. `TotalDesgloseImpuesto` is required whenever a line has tax.
5. Amounts are net of IVA with 5 decimals; compute with integers.
6. Exempt is tarifa code `10`, not `01`.
7. The clave date is the Costa Rica date.

### 9.2 Process

1. Deliver to the buyer immediately; do not wait for Hacienda.
2. Rejected by Hacienda → new document, no credit note. Accepted → only
   credit/debit notes.
3. Numbers are gapless per counter; allocate transactionally.
4. Poll as well as accepting callbacks; accept both callback key spellings.
5. Keep XML, response XML and PDF for at least 5 years in Yuntera's own storage.

### 9.3 Secrets

The `.p12`, its PIN and the API password are per taxpayer and per environment;
server-side only.

### 9.4 Mismatches with the current code (not changed by this research)

| Where                                                                            | Today                                                                                                              | Issue                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261121080800_finance.sql` line 380                        | `clave ~ '^[0-9]{50}$'`                                                                                            | The April 2026 XSD allows `[a-zA-Z0-9]{50}`; a document from a new legal entity with an alphanumeric identification would be refused by the database                                                                                                                |
| `packages/core/src/cr/identity.ts` (`juridica` case)                             | `^[2-5]\d{9}$`                                                                                                     | Same change: alphanumeric legal-entity identifications are now allowed (ANX bitácora 22/04/2026 item 1). Exact new format UNVERIFIED                                                                                                                                |
| `packages/core/src/cr/compliance.ts` lines 51–52                                 | `HACIENDA_PAYMENT_CODE_PLATFORM = "07"` described as "collected through a digital platform on the seller's behalf" | The annex defines `05` as payment received by a third party instead of the issuer, and does not define `07`. Decide with the accountant before guiding sellers                                                                                                      |
| `packages/core/src/cr/compliance.ts` lines 33–41                                 | Type codes `01`–`04`, `08`–`10`                                                                                    | Correct; `05`/`06`/`07` (receiver messages) are absent, which is fine while Yuntera does not send them                                                                                                                                                              |
| `supabase/migrations/20261121080100_identity.sql` lines 71–94 (`seller_private`) | `fiscal_address` is free text; no date of birth or company registration number                                     | A factura's receiver `Ubicacion` needs province, cantón and district codes when it is included, and the platform report (2.3) needs date of birth for individuals and the registration number for entities. `id_number` already allows letters (`^[0-9A-Z]{9,12}$`) |
| `docs/research/costa-rica-fact-sheet.md` line 67                                 | Sandbox at `/recepcion-sandbox/v1/`                                                                                | That is the annex's text, but the route did not resolve today; see 5.1                                                                                                                                                                                              |
| `docs/research/costa-rica-fact-sheet.md` lines 37–41                             | Platform reporting described generally                                                                             | Confirmed for sale of goods, with the EUR 1 million opt-in exclusion and the per-seller thresholds in 2.3                                                                                                                                                           |

## 10. Questions for the accountant

1. Which payment-method code should sellers put on their documents when
   Yuntera collects: `05`, `07`, or the shopper's actual method?
2. Is the delivery fee a separate Yuntera service to the shopper (own tiquete,
   13%), or should it travel on the seller's document as a "cobro de un tercero"?
3. Fee invoices to sellers: per order or per settlement period? Which sale
   condition and payment method when fees are netted from the payout?
4. Which CABYS codes and which registered economic activity for delivery,
   commission, warehouse and payment fees?
5. Refunds: reference code `01` or `06`; who issues what when an order with
   several sellers is partly returned; are commissions reversed by credit note?
6. May a tiquete be replaced by a factura after the fact, and how?
7. Régimen Simplificado sellers: can they sell through an online marketplace at
   all, and what must the order show the shopper?
8. Platform report (MH-DGT-RES-0025-2024): opt into the under-EUR-1-million
   exclusion or report from the first year? Confirm the data set and the
   current filing window.
9. Retention period to adopt (5 years or longer).
10. Direct integration or a provider, considering who will answer Hacienda's
    rejections day to day.
11. Whether Yuntera may later issue on sellers' behalf and what registering as
    a "proveedor de sistemas" involves.
12. Whether a platform report was already due for 2025 (first window closed
    30 Apr 2026, or 6 May 2026 if MH-DGT-RES-0004-2026 applies), and whether
    the exclusion notice must be filed before each reporting year.
13. Under RCE art. 2.13, may a business buyer issue a factura electrónica de
    compra for goods bought from any simplified-regime seller, or only from
    those not registered as "no confirmante"?

## 11. UNVERIFIED

- Acceptance by Hacienda of a signature produced by any library named here;
  whether the validator checks the policy hash; whether a SHA-256 certificate
  digest is accepted in `SigningCertificate`; whether the `enveloped` transform
  is accepted in place of the XPath transform.
- The sandbox base URL (observation only, repeated in the fact-check; needs
  credentials), the numeric rate limits of the Recepción API, the current
  refresh-token lifetime (guide: 10 hours in 2018), the accepted offset
  spelling in the JSON `fecha`, and whether success is always `201`.
- Decimal tolerance in Hacienda's arithmetic checks.
- How the 6-character activity code maps from TRIBU-CR's activity catalogue.
- The format of alphanumeric legal-entity identifications.
- Whether a rejected document's consecutive number counts as used.
- Where exactly TRIBU-CR generates the key and API credentials; PKCS#12
  encryption of new keys; key validity (4 or 2 years, secondary sources
  disagree); the 14-character PIN rule (secondary).
- The resolution that moved 4.4 to 1 Sep 2025 (MH-DGT-RES-0001-2025 per a
  secondary source; Gazette text not located). The 1 Nov 2026 date is now
  confirmed by COM26.
- What MH-DGT-RES-0043-2025 changed in RES27.
- The meaning of RCE art. 2.13 for simplified-regime sellers (all of them, or
  only "no confirmante" ones).
- Whether the QR code requirement has been activated.
- MH-DGT-RES-0004-2026 and its filing window (secondary).
- Current status, eligibility and limits of TICO Factura; whether the old ATV
  free tool still exists.
- Location of the full CABYS catalogue file at the BCCR.
- Any public page where a shopper can check a clave.
- Gosocket as a Costa Rica issuing API; prices of Alegra and FACTURATica; the
  per-document price of Factura en CR.
- Whether Régimen Simplificado sellers may sell online.
- Absence of a local-marketplace IVA withholding or deemed-supplier rule
  (searched, not found; not proof).

## Sources

Primary, fetched 21 Nov 2026:

- `https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf`
- `https://www.hacienda.go.cr/docs/FacturaElectronica_V4.4.xsd`,
  `TiqueteElectronico_V4.4.xsd`, `NotaCreditoElectronica_V4.4.xsd`,
  `NotaDebitoElectronica_V4.4.xsd`, `MensajeReceptor_V4.4.xsd`,
  `MensajeHacienda_V4.4.xsd`, `ReciboElectronicoPago_V4.4.xsd`,
  `FacturaElectronicaCompra_V4.4.xsd`, `FacturaElectronicaExportacion_V4.4.xsd`
  (same directory), and the `.xsd.xml` variants of the first seven
- `https://www.hacienda.go.cr/docs/REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf`
- `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf`
- `https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html`
- `https://www.hacienda.go.cr/docs/Guia_IdP.pdf`
- `https://www.hacienda.go.cr/docs/CP08-TRIBUTACION_AMPLIA%20PLAZO_PARA_IMPLEMENTAR_CAMBIOS_EN_COMPROBANTES_ELECTRONICOS.pdf`
- `https://www.hacienda.go.cr/docs/Codigodemoneda_V4.4.pdf`,
  `https://www.hacienda.go.cr/docs/Codificacionubicacion_V4.4.xlsx` (reachability only)
- `https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx` (index page; its file links return 404)
- `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/.well-known/openid-configuration`
  and the same for `rut-stag`; the token endpoint of `rut-stag`
- `https://api.comprobanteselectronicos.go.cr/recepcion/v1/…`,
  `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/…`,
  `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/…` (unauthenticated probes)
- `https://api.hacienda.go.cr/docs/`, `https://api.hacienda.go.cr/fe/cabys`,
  `https://api.hacienda.go.cr/fe/ae`, `https://api.hacienda.go.cr/indicadores/tc/dolar`
- `https://www.imprentanacional.go.cr/pub/2024/11/06/ALCA179_06_11_2024.pdf` (MH-DGT-RES-0025-2024)
- `https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd`
- Added in the fact-check: `https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf` (COM26),
  `https://www.hacienda.go.cr/docs/ResolucionMH-DGT-RES-0043-2025.pdf` (RES43)
- `https://registry.npmjs.org/` metadata for `xadesjs`, `xmldsigjs`, `xml-crypto`,
  `node-forge`, `@xmldom/xmldom`, `@facturacr/atv-sdk`, `haciendacostarica-signer`,
  `xmllint-wasm`, `libxmljs2`; `https://cdn.jsdelivr.net/npm/xadesjs@3.1.0/build/signed_xml.d.ts`

Secondary:

- Delfino, 29 Oct 2026: `https://delfino.cr/2026/10/nuevos-codigos-de-facturacion-electronica-entraran-en-vigor-este-domingo`
- KPMG Costa Rica, Aug 2026 (key PIN): `https://kpmg.com/cr/es/insights/2026/08/newsflash-ago-4.html`
- KPMG Costa Rica, May 2026 (April adjustments): `https://kpmg.com/cr/es/insights/2026/05/newsflash-may-8.html`
- Siempre al Día (MH-DGT-RES-0001-2025): `https://siemprealdia.co/costa-rica/impuestos/hacienda-confirma-obligatoriedad-de-la-factura-electronica-4-4/`;
  (CIIU 4): `https://siemprealdia.co/costa-rica/impuestos/codigos-de-actividades-economicas-en-costa-rica/`
- Alegra (key validity): `https://blog.alegra.com/costa-rica/llave-criptografica-hacienda/`
- Siempre al Día: `https://siemprealdia.co/costa-rica/impuestos/tico-factura/`,
  `https://siemprealdia.co/costa-rica/impuestos/llave-criptografica-tribu-cr/`
- EAS Latam (MH-DGT-RES-0004-2026): `https://www.easlatam.com/post/nueva-resoluci%C3%B3n-de-hacienda-plataformas-digitales-hacienda-traslada-el-primer-reporte-pero-no-ca`
- Brinta and CMF on RES-0025-2024 (they disagree on scope; the Gazette text settles it):
  `https://brinta.com/post/new-regulation-in-costa-rica-for-digital-platform-operators`,
  `https://www.cmflca.com/es/blog/viaje-1/intercambio-informacion-plataformas-digitales-6`
- La Nación on payment code 07 (search snippet):
  `https://www.nacion.com/economia/desde-esta-semana-la-facturacion-electronica/3G35RILTRVAAJBNYLY7KUQEPOU/story/`
- Vendor pages: `https://afecr.com/`, `https://www.facturele.com/`,
  `https://facturatica.com/api-de-factura-electronica-en-costa-rica/`,
  `https://www.factugo-cr.com/precios-y-planes-api-rest/`, `https://facturaencr.com/`,
  `https://developer.alegra.com/`

Repository files read:

- `docs/research/costa-rica-fact-sheet.md`
- `docs/05-security-compliance/compliance-costa-rica.md`
- `packages/core/src/cr/compliance.ts`, `packages/core/src/cr/identity.ts`
- `supabase/migrations/20261121080800_finance.sql` (lines 367–391),
  `supabase/migrations/20261121080000_foundation.sql` (line 77),
  `supabase/migrations/20261121080100_identity.sql` (lines 71–97)
- `STATUS.md`

## Corrections after fact-check

Fact-check of 21 November 2026. About 120 claims were re-checked against
fresh downloads, not against the first draft's copies: the annex PDF
(SHA-256 `6e093226…2769`, identical), the FE, TE, NC and MensajeHacienda XSDs
(identical hashes) and the `.xsd.xml` FE variant, the RCE, RES27 (= the policy
PDF), the API reference, the IdP guide, CP-08-2025, Gazette Alcance 179
(RES25) and two Hacienda documents the draft did not have (COM26, RES43). The
tiquete sample in 3.14 was re-validated with `xmllint` against the April 2026
XSD and passes; both clave examples, the consecutive layout, the rounding
examples, the policy hash (base64 of the PDF's SHA-256), the reception and
IdP probes, the HAPI rate limits and the four CABYS candidates were reproduced.
Every re-checked claim not listed below was confirmed as written: document type
codes, clave and consecutivo structure and padding, namespaces and root
elements, header field conditions, line and totals structure, notas 5, 6, 8,
8.1, 15, 16, 20 and 22, the payment-method rules, XAdES-EPES requirements and
policy identifier, the token endpoints, realms and client ids, the JSON
envelope, the callback retry rule, the 3-hour validation window, the 2-business-
day contingency and no-internet deadlines, the 8-business-day receiver
confirmation, 5-year retention, the two-month provider retention, and RES25's
scope, thresholds, data set, channel, penalty and Transitorio. The API HTML
downloaded today differs from the draft's hash only in an injected CDN script.

| #   | Where                   | What the note said                                                                     | What is right                                                                                                                                                                                                | Source                                     |
| --- | ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 1   | Bottom line, 3.15, 3.16 | 1 Nov 2026 date of the April adjustments "secondary: Delfino"                          | Confirmed by Hacienda's own communiqué, which also says the codes are already live in STAG and production and may be used earlier; alphanumeric cédulas apply only once the Registro Nacional announces them | COM26                                      |
| 2   | 3.16                    | TRIBU-CR start 6 Oct 2025 "secondary"                                                  | Primary: 09:00 on 6 Oct 2025, ATV disabled from 23:45 on 25 Sep 2025; MH-DGT-RES-0043-2025 lists RES27 among the resolutions it adapts                                                                       | RES43                                      |
| 3   | 3.16, 11                | Resolution that moved 4.4 to 1 Sep 2025 unknown                                        | MH-DGT-RES-0001-2025 per a secondary source; CP-08-2025 confirms only that a resolution was "en proceso de publicación"                                                                                      | CP-08-2025; Siempre al Día                 |
| 4   | 3.13                    | Reference-code table ended at `16`, omitted `17` and `TipoDocIR` `19`                  | `17` "Pago a comprobante electrónico" (REP only) and `TipoDocIR` `19` added; the `01`→`07` and `13`→`15` follow-up rule added                                                                                | ANX pp. 72–73; COM26                       |
| 5   | 3.15                    | "`TotalComprobante` must equal the payment methods"                                    | Only when two or more methods are used                                                                                                                                                                       | ANX p. 56                                  |
| 6   | 5.2                     | Refresh token "lived 30 minutes" in the guide                                          | The guide's text says 10 hours (2018); the 30 minutes is its 2017 sample token. Both shown                                                                                                                   | IDP p. 12                                  |
| 7   | 5.1                     | Probe answers given as `UnauthorizedException` / `MissingAuthenticationTokenException` | Those are the `x-amzn-errortype` header values; bodies are `{"message":"Unauthorized"}` / `{"message":"Missing Authentication Token"}`. Discovery documents advertise `http://` URLs                         | Probes, 21 Nov 2026                        |
| 8   | 5.3                     | Statuses 201/400/401 only                                                              | Confirmed, and now stated that the reference documents no `202` and no `403`; `validation-exception` is a boolean header                                                                                     | API                                        |
| 9   | 5.7                     | —                                                                                      | Added: a document without Hacienda's acceptance cannot support the receiver's IVA credit or deduction, which makes stuck fee invoices a seller problem                                                       | RCE art. 21; RES27 art. 11                 |
| 10  | 2.1                     | "A buyer cannot issue a factura de compra" for simplified-regime sellers               | RCE art. 2.13 is ambiguous on whether it covers all of them or only "no confirmante" ones; marked **[ACCOUNTANT]**                                                                                           | RCE art. 2.13                              |
| 11  | 3.4                     | Activity-code mapping UNVERIFIED                                                       | Still UNVERIFIED; added that secondary sources put CIIU 4 in force on 6 Oct 2025 and claim the receiver code is mandatory, which the annex contradicts (FE condition 2)                                      | ANX p. 18; Siempre al Día                  |
| 12  | 4.1                     | `CertDigest` "SHA-1 in the example"                                                    | Also noted that the counter-signature examples name SHA-512 with a 20-byte value, so they settle nothing                                                                                                     | ANX pp. 89–94                              |
| 13  | 4.2                     | Key validity "4 years"                                                                 | Sources disagree (4 or 2 years); read `notAfter`. PIN rule still secondary; KPMG adds a six-month provider transition                                                                                        | Siempre al Día; Alegra; KPMG               |
| 14  | 2.3                     | RES-0004-2026 window "reportedly"                                                      | Still secondary and not found; added the yearly 30 April deadline (art. 5.6) and that the first window has passed                                                                                            | Gazette Alcance 179                        |
| 15  | Source keys             | RCE dated 2 Oct 2024                                                                   | Signed 2 Oct 2024; RES27 cites it as of 8 Nov 2024                                                                                                                                                           | RCE signature line; RES27 considerando VII |

Nothing found changes the build-or-buy recommendation in 7 and 8: the API is
still the documented two calls, the endpoints have not moved under TRIBU-CR,
and using a provider remains optional (RCE art. 15, 16). The one change to what
must be built: issuing code has to emit and accept reference codes `13`–`17`
and `TipoDocIR` `19`, `20` from 1 Nov 2026 (already in force on the date of
this check), and the alert on documents without an answer matters to sellers.

Still **UNVERIFIED** after the fact-check: acceptance of any library's
signature, SHA-256 in `CertDigest`, the `enveloped` transform and whether the
policy hash is checked (all need a sandbox run); the sandbox base URL with real
credentials; the Recepción API's numeric rate limits and current refresh-token
lifetime; the JSON `fecha` offset spelling; decimal tolerance; the 6-character
CIIU 4 activity code format; the shape of alphanumeric cédulas (KPMG example
only); whether a rejected document's number is consumed; the TRIBU-CR menu path
for keys and API passwords, new-key PKCS#12 algorithms, key validity and the
14-character PIN rule (secondary only); the Gazette text of MH-DGT-RES-0001-2025
and MH-DGT-RES-0004-2026; what RES-0043-2025 changed in RES27; QR activation
(secondary sources say still suspended as of mid-2026); TICO Factura's current
limits; the BCCR catalogue file; a public clave lookup; Gosocket, Alegra and
FACTURATica details; whether simplified-regime sellers may sell online; RCE
art. 2.13's scope; and the absence of a marketplace withholding or
deemed-supplier rule (searched, not found; not proof). Vendor prices in 7.2
were not re-checked.

This note remains engineering research written by an AI, not legal or tax
advice.
