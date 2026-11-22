/**
 * How a scanned or typed product code is compared with a product's own codes
 * (its Yuntera stock code and, when it has one, its barcode). The same rules
 * run in the database, where picking is checked (`private.scan_clean`,
 * `private.scan_keys` in supabase/migrations/20261121083200_followups.sql),
 * and in the native apps' scanner (packages/expo-kit/src/scanner/logic.ts),
 * which checks before it sends. A parity test runs one table of cases
 * through both (scan-codes.test.ts and supabase/tests/125_followups.sql).
 */

/**
 * GS1 element strings carry the product's GTIN after application identifier
 * 01. A hand scanner may send them with an AIM prefix (`]C1` for GS1-128,
 * `]d2` for GS1 DataMatrix, `]Q3` for GS1 QR, `]e0` for GS1 DataBar), and
 * people type them in the printed form "(01)07441234567890(17)…".
 */
const GS1_AIM = /^\](?:C1|d2|Q3|e0)/;
const AIM = /^\][A-Za-z][0-9A-Za-z]/;
const GS = "\u001d";

/**
 * Turns whatever arrived (camera text, a hand scanner's keystrokes, typing)
 * into the code to look up: control characters (the scanner's Enter, tabs,
 * the GS separator) and spaces removed, an AIM symbology prefix dropped, a
 * GS1 element string reduced to its GTIN, letters in capitals (stock codes
 * are printed as YT-XXXXXXXX).
 */
export function cleanScan(raw: string): string {
  let text = raw.trim();
  // An AIM prefix for GS1, or the GS separator (FNC1) some scanners send
  // between variable-length elements: either way it is an element string.
  const gs1 = GS1_AIM.test(text) || text.includes(GS);
  text = text.replace(AIM, "");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  text = text.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, "");
  const printed = /^\(01\)(\d{14})/.exec(text);
  if (printed?.[1]) return printed[1];
  if (gs1) {
    const element = /^01(\d{14})/.exec(text);
    if (element?.[1]) return element[1];
  }
  return text.toUpperCase();
}

/** The GS1 check digit of the digits before it (weights 3, 1, 3… from the right). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True for an 8, 12, 13 or 14 digit GTIN whose last digit checks out. */
export function isValidGtin(code: string): boolean {
  if (!/^(?:\d{8}|\d{12,14})$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

/**
 * UPC-E (8 digits, number system 0 or 1) written out as the UPC-A it stands
 * for, or null if the code cannot be one. A product stored with its 12-digit
 * UPC-A must match when the box carries the short form.
 */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const system = code.charAt(0);
  const d = code.slice(1, 7);
  const check = code.charAt(7);
  const last = Number(d.charAt(5));
  let body: string;
  if (last <= 2) body = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
  else if (last === 3) body = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  else if (last === 4) body = `${d.slice(0, 4)}00000${d.charAt(4)}`;
  else body = `${d.slice(0, 5)}0000${last}`;
  const upcA = `${system}${body}${check}`;
  return isValidGtin(upcA) ? upcA : null;
}

/**
 * The forms one product code can arrive in, made comparable: a GTIN padded to
 * 14 digits (the camera on iOS reports a UPC-A as a 13-digit EAN with a
 * leading 0), plus the UPC-A an 8-digit UPC-E stands for. Nothing for an
 * empty code, so it never matches anything.
 */
export function codeKeys(code: string): string[] {
  const cleaned = cleanScan(code);
  if (cleaned === "") return [];
  if (!/^\d+$/.test(cleaned) || cleaned.length > 14) return [cleaned];
  const keys = new Set([cleaned.padStart(14, "0")]);
  const upcA = cleaned.length === 8 ? expandUpcE(cleaned) : null;
  if (upcA) keys.add(upcA.padStart(14, "0"));
  return [...keys];
}

/** What a line expects: its stock code and, when the product has one, its barcode. */
export interface ScanTarget {
  sku_code: string;
  gtin?: string | null;
}

/** True when the code is this target's stock code or barcode, in any of its forms. */
export function matchesTarget(code: string, target: ScanTarget): boolean {
  const keys = new Set(codeKeys(code));
  const forms = [target.sku_code, target.gtin].filter((form): form is string => Boolean(form));
  return forms.some((form) => codeKeys(form).some((key) => keys.has(key)));
}
