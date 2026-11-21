/**
 * Costa Rican bank account numbers (IBAN).
 *
 * A Costa Rican IBAN is "CR" followed by twenty digits. The first two of those
 * are check digits (ISO 13616): they let a mistyped or transposed digit be
 * caught before money is sent to the wrong place.
 *
 * Like the other checks in this folder, this is structural only. It confirms
 * the number could have been issued; it does NOT confirm the account exists or
 * who owns it. That is what finance verifies before a payout account changes.
 *
 * The database applies the same rule (`private.is_valid_cr_iban`); both sides
 * are tested against the same list of numbers.
 */

/** Characters in a Costa Rican IBAN once spaces are removed. */
export const CR_IBAN_LENGTH = 22;

export interface ParsedIban {
  /** Canonical storage form: CR and twenty digits, no spaces. */
  value: string;
  /** The way banks print it, in groups of four: CR05 0152 0200 1026 2840 66. */
  formatted: string;
  /** Enough to recognise the account, never the whole number. */
  masked: string;
}

/**
 * What is wrong with a number that is not a valid Costa Rican IBAN, so a form
 * can say it in words:
 *   empty       nothing was typed
 *   country     it does not start with CR (an account from another country)
 *   characters  something other than digits follows the CR
 *   length      too few or too many digits
 *   checksum    the right shape, but a digit is wrong or two are swapped
 */
export type IbanProblem = "empty" | "country" | "characters" | "length" | "checksum";

export type IbanCheck = { ok: true; iban: ParsedIban } | { ok: false; problem: IbanProblem };

/** Removes the spaces and hyphens people type, and upper-cases the letters. */
export const normalizeIban = (input: string) => input.replace(/[\s-]/g, "").toUpperCase();

/** The remainder of a long decimal string divided by 97, without big numbers. */
function mod97(digits: string): number {
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
}

/** Shows only the last four digits: "CR•• •••• •••• •••• 4066". */
export const maskIban = (value: string) => `CR•• •••• •••• •••• ${value.slice(-4)}`;

/** Checks a Costa Rican IBAN and says what is wrong when it is not valid. */
export function checkCrIban(input: string): IbanCheck {
  const value = normalizeIban(input);
  if (value === "") return { ok: false, problem: "empty" };
  if (!value.startsWith("CR")) return { ok: false, problem: "country" };
  const digits = value.slice(2);
  if (!/^\d*$/.test(digits)) return { ok: false, problem: "characters" };
  if (value.length !== CR_IBAN_LENGTH) return { ok: false, problem: "length" };

  // ISO 13616: move the first four characters to the end, write the letters as
  // numbers (C = 12, R = 27); the result must leave remainder 1 when divided by
  // 97. Check digits run from 02 to 98 — 00, 01 and 99 would also satisfy the
  // division for some numbers, but are never issued.
  const checkDigits = Number(value.slice(2, 4));
  const valid =
    checkDigits >= 2 &&
    checkDigits <= 98 &&
    mod97(`${value.slice(4)}1227${value.slice(2, 4)}`) === 1;
  if (!valid) return { ok: false, problem: "checksum" };

  return {
    ok: true,
    iban: {
      value,
      formatted: value.replace(/(.{4})(?=.)/g, "$1 "),
      masked: maskIban(value),
    },
  };
}

/** The parsed IBAN, or null when the input is not a valid Costa Rican IBAN. */
export function parseCrIban(input: string): ParsedIban | null {
  const result = checkCrIban(input);
  return result.ok ? result.iban : null;
}

export const isValidCrIban = (input: string) => checkCrIban(input).ok;
