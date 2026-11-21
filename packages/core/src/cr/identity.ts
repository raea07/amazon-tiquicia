/**
 * Costa Rican identifiers.
 *
 * These checks are structural only: they confirm an identifier has a shape
 * Hacienda and the Registro Civil would issue. They do NOT confirm the person
 * or company exists — that is done against Hacienda's taxpayer lookup during
 * seller onboarding, and is recorded separately as a verification event.
 */

export type IdentificationType = "fisica" | "juridica" | "dimex" | "nite";

/** Type codes used in Hacienda's electronic-invoicing schema. */
export const HACIENDA_ID_CODE: Record<IdentificationType, string> = {
  fisica: "01",
  juridica: "02",
  dimex: "03",
  nite: "04",
};

export interface ParsedIdentification {
  type: IdentificationType;
  /** Digits only, canonical storage form. */
  value: string;
  /** Human-readable form, e.g. 1-0234-0567 or 3-101-123456. */
  formatted: string;
}

const digitsOnly = (input: string) => input.replace(/[\s.\-–—]/g, "");

/**
 * Parses an identifier, inferring its type from its shape when `type` is omitted.
 * Returns null when the input cannot be a valid identifier.
 */
export function parseIdentification(
  input: string,
  type?: IdentificationType,
): ParsedIdentification | null {
  const value = digitsOnly(input);
  if (!/^\d+$/.test(value)) return null;

  const inferred = type ?? inferType(value);
  if (!inferred) return null;

  switch (inferred) {
    case "fisica":
      // 9 digits: province/register digit 1-9, then tomo (4) and asiento (4).
      if (!/^[1-9]\d{8}$/.test(value)) return null;
      return {
        type: inferred,
        value,
        formatted: `${value[0]}-${value.slice(1, 5)}-${value.slice(5)}`,
      };
    case "juridica":
      // 10 digits starting with 2, 3, 4 or 5 (3 = companies, 2 = government, 4 = autonomous…).
      if (!/^[2-5]\d{9}$/.test(value)) return null;
      return {
        type: inferred,
        value,
        formatted: `${value[0]}-${value.slice(1, 4)}-${value.slice(4)}`,
      };
    case "dimex":
      // Residents' document: 11 or 12 digits, never starting with 0.
      if (!/^[1-9]\d{10,11}$/.test(value)) return null;
      return { type: inferred, value, formatted: value };
    case "nite":
      // Tax-only number issued by Hacienda: 10 digits.
      if (!/^\d{10}$/.test(value)) return null;
      return { type: inferred, value, formatted: value };
  }
}

function inferType(value: string): IdentificationType | null {
  if (value.length === 9) return "fisica";
  if (value.length === 10) return /^[2-5]/.test(value) ? "juridica" : "nite";
  if (value.length === 11 || value.length === 12) return "dimex";
  return null;
}

export const isValidIdentification = (input: string, type?: IdentificationType) =>
  parseIdentification(input, type) !== null;

// ── Phone numbers ──────────────────────────────────────────────────────────

export interface ParsedPhone {
  /** E.164, e.g. +50688881234. */
  e164: string;
  /** National 8-digit number. */
  national: string;
  /** Display form: 8888-1234. */
  formatted: string;
  kind: "mobile" | "landline" | "voip";
}

/**
 * Parses a Costa Rican phone number. National numbers are 8 digits:
 * 2xxx-xxxx landline, 4xxx-xxxx VoIP, 5/6/7/8xxx-xxxx mobile.
 * Accepts +506 / 506 / 00506 prefixes and common separators.
 */
export function parsePhone(input: string): ParsedPhone | null {
  let d = input.replace(/[\s().\-–]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 11 && d.startsWith("506")) d = d.slice(3);
  if (d.length !== 8) return null;

  const first = d[0];
  const kind: ParsedPhone["kind"] | null =
    first === "2"
      ? "landline"
      : first === "4"
        ? "voip"
        : "5678".includes(first ?? "")
          ? "mobile"
          : null;
  if (!kind) return null;

  return {
    e164: `+506${d}`,
    national: d,
    formatted: `${d.slice(0, 4)}-${d.slice(4)}`,
    kind,
  };
}

/** SINPE Móvil only works with mobile lines, so checkout must reject anything else. */
export const canReceiveSinpeMovil = (input: string) => parsePhone(input)?.kind === "mobile";
