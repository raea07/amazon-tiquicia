/**
 * Documents for tests, built the way the database builds them: amounts from
 * céntimos with the annex's rounding, the consecutive number and the clave
 * from their parts. The issuer is Hacienda's own fictitious legal entity
 * (3101123456, used in its API examples); nothing here is a real taxpayer.
 */

import { formatAmount, fromMinor, netOfGross, taxOn } from "../amounts.ts";
import { type DocumentType, IVA_RATE } from "../codes.ts";
import {
  type FiscalDocument,
  type Issuer,
  type Line,
  type Receiver,
  summarize,
} from "../document.ts";
import { clave, consecutivo } from "../key.ts";

export const SAMPLE_ISSUER: Issuer = {
  name: "EJEMPLO PLATAFORMA SOCIEDAD ANONIMA",
  commercial_name: "Yuntera",
  id_type: "02",
  id_number: "3101123456",
  activity_code: "532000",
  location: {
    province: 1,
    canton: 1,
    district: 1,
    other_signs: "Direccion exacta del domicilio fiscal",
  },
  emails: ["facturacion@example.com"],
  phone: null,
};

export const SAMPLE_SELLER: Receiver = {
  name: "Tienda de Ejemplo Limitada",
  id_type: "02",
  id_number: "3101654321",
  email: "tienda@example.com",
  activity_code: null,
};

function line(
  number: number,
  cabys: string,
  unit: string,
  description: string,
  net: bigint,
  tarifaCode: string,
): Line {
  const rate = IVA_RATE[tarifaCode];
  if (!rate) throw new Error(`unknown tarifa ${tarifaCode}`);
  const tax = taxOn(net, rate.bps);
  const amount = formatAmount(net);
  return {
    number,
    cabys,
    quantity: "1.000",
    unit,
    description,
    unit_price: amount,
    total: amount,
    subtotal: amount,
    base: amount,
    tax: { code: "01", tarifa_code: tarifaCode, rate: rate.rate, amount: formatAmount(tax) },
    net_tax: formatAmount(tax),
    line_total: formatAmount(net + tax),
  };
}

/** A line whose price includes IVA (the delivery fee): the net is taken out of the gross. */
export const lineFromGross = (
  number: number,
  input: { cabys: string; unit: string; description: string; grossMinor: number; tarifa?: string },
) => {
  const tarifa = input.tarifa ?? "08";
  const bps = IVA_RATE[tarifa]?.bps ?? 1300;
  return line(
    number,
    input.cabys,
    input.unit,
    input.description,
    netOfGross(input.grossMinor, bps),
    tarifa,
  );
};

/** A line priced before IVA (the platform's fees): the tax goes on top. */
export const lineFromNet = (
  number: number,
  input: { cabys: string; unit: string; description: string; netMinor: number; tarifa?: string },
) =>
  line(
    number,
    input.cabys,
    input.unit,
    input.description,
    fromMinor(input.netMinor),
    input.tarifa ?? "08",
  );

export function sampleDocument(input: {
  type: DocumentType;
  sequence: number;
  issuedAt: Date;
  security?: string;
  lines: Line[];
  receiver?: Receiver | null;
  payment?: { code: string; other?: string | null };
  references?: FiscalDocument["references"];
  issuer?: Issuer;
}): FiscalDocument {
  const issuer = input.issuer ?? SAMPLE_ISSUER;
  const number = consecutivo(1, 1, input.type, input.sequence);
  const summary = summarize(input.lines);
  return {
    document_type: input.type,
    clave: clave({
      issuedAt: input.issuedAt,
      identification: issuer.id_number,
      consecutivo: number,
      situation: "1",
      security: input.security ?? "48291037",
    }),
    consecutivo: number,
    issued_at: input.issuedAt.toISOString(),
    provider_id: issuer.id_number,
    issuer,
    receiver: input.receiver ?? null,
    sale_condition: "01",
    sale_condition_other: null,
    lines: input.lines,
    payments: [
      {
        code: input.payment?.code ?? "06",
        other: input.payment?.other ?? null,
        amount: summary.total,
      },
    ],
    summary,
    references: input.references ?? [],
  };
}
