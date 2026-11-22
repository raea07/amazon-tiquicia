/**
 * The consecutive number (20 digits) and the clave (50 characters) of a
 * document, as the annex defines them (nota 3, pp. 65–68; nota 4.1, p. 69;
 * research note 3.2 and 3.3). The database builds both when it numbers a
 * document (private.invoice_clave); these are the same rules, used to check
 * what the database built before anything is signed, and to read a clave.
 *
 * Dates are Costa Rica's (UTC−6 all year, no daylight saving since 1992): a
 * server on UTC after 18:00 local time would otherwise stamp tomorrow.
 */

const pad = (value: string | number | bigint, length: number) =>
  String(value).padStart(length, "0");

export function consecutivo(
  establishment: number,
  terminal: number,
  type: string,
  sequence: number | bigint,
): string {
  if (!Number.isInteger(establishment) || establishment < 1 || establishment > 999) {
    throw new RangeError("establishment must be 1 to 999");
  }
  if (!Number.isInteger(terminal) || terminal < 1 || terminal > 99_999) {
    throw new RangeError("terminal must be 1 to 99999");
  }
  if (!/^\d{2}$/.test(type)) throw new RangeError("type must be two digits");
  const n = BigInt(sequence);
  if (n < 1n || n > 9_999_999_999n) throw new RangeError("sequence must be 1 to 9999999999");
  return pad(establishment, 3) + pad(terminal, 5) + type + pad(n, 10);
}

const OFFSET_MS = 6 * 60 * 60 * 1000;

/** The Costa Rica wall-clock parts of an instant. */
export function costaRicaParts(at: Date) {
  const local = new Date(at.getTime() - OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

/** FechaEmision: `YYYY-MM-DDThh:mm:ss-06:00`, the same instant the clave's date comes from. */
export function fechaEmision(at: Date): string {
  const p = costaRicaParts(at);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}T${pad(p.hour, 2)}:${pad(p.minute, 2)}:${pad(p.second, 2)}-06:00`;
}

export type Situation = "1" | "2" | "3";

export function clave(input: {
  issuedAt: Date;
  /** As stored, without dashes; padded here to 12. */
  identification: string;
  consecutivo: string;
  situation: Situation;
  /** Eight digits from a strong random source. */
  security: string;
}): string {
  if (!/^[A-Za-z0-9]{1,12}$/.test(input.identification)) {
    throw new RangeError("identification must be 1 to 12 letters or digits");
  }
  if (!/^\d{20}$/.test(input.consecutivo)) throw new RangeError("consecutivo must be 20 digits");
  if (!/^[123]$/.test(input.situation)) throw new RangeError("situation must be 1, 2 or 3");
  if (!/^\d{8}$/.test(input.security)) throw new RangeError("security code must be 8 digits");
  const p = costaRicaParts(input.issuedAt);
  const key =
    "506" +
    pad(p.day, 2) +
    pad(p.month, 2) +
    pad(p.year % 100, 2) +
    input.identification.padStart(12, "0") +
    input.consecutivo +
    input.situation +
    input.security;
  if (!/^[A-Za-z0-9]{50}$/.test(key)) throw new RangeError("clave inválida");
  return key;
}

export interface ParsedClave {
  day: number;
  month: number;
  year: number;
  /** Positions 10–21: the issuer's identification padded to 12. */
  identification: string;
  consecutivo: string;
  establishment: number;
  terminal: number;
  documentType: string;
  sequence: bigint;
  situation: Situation;
  security: string;
}

/**
 * Reads a clave and checks it can be one: 50 characters, country 506, a real
 * date, a consecutive number of 20 digits, situation 1–3. Returns null when not.
 */
export function parseClave(key: string): ParsedClave | null {
  if (!/^[A-Za-z0-9]{50}$/.test(key) || !key.startsWith("506")) return null;
  const day = Number(key.slice(3, 5));
  const month = Number(key.slice(5, 7));
  const year = 2000 + Number(key.slice(7, 9));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCDate() !== day ||
    date.getUTCMonth() !== month - 1 ||
    !/^\d{6}$/.test(key.slice(3, 9))
  ) {
    return null;
  }
  const number = key.slice(21, 41);
  const situation = key.slice(41, 42);
  const security = key.slice(42, 50);
  if (!/^\d{20}$/.test(number) || !/^[123]$/.test(situation) || !/^\d{8}$/.test(security)) {
    return null;
  }
  return {
    day,
    month,
    year,
    identification: key.slice(9, 21),
    consecutivo: number,
    establishment: Number(number.slice(0, 3)),
    terminal: Number(number.slice(3, 8)),
    documentType: number.slice(8, 10),
    sequence: BigInt(number.slice(10)),
    situation: situation as Situation,
    security,
  };
}
