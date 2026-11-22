/**
 * Amounts as Hacienda writes them: colones with exactly five decimals
 * (ANX p. 14), computed with integers, never floats. A value here is a
 * bigint holding colones × 100 000; Yuntera's own amounts are whole céntimos
 * (colones × 100), so a céntimo is 1 000 units.
 *
 * Rounding is the annex's: look at the next decimal; below 5 keep, 5 or more
 * round up. Every amount on Yuntera's documents is positive, so this is the
 * same as PostgreSQL's round() on numeric, which the database uses for the
 * same figures (supabase/migrations/20261121083500_invoicing.sql).
 */

export const SCALE = 100_000n;
const PER_MINOR = 1_000n;

/** Divides and rounds half up. Both operands must be non-negative. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("only non-negative amounts");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Céntimos → five-decimal units. */
export const fromMinor = (minor: number | bigint): bigint => BigInt(minor) * PER_MINOR;

/** Five-decimal units → céntimos, rounded half up (for comparing with the ledger). */
export const toMinor = (value: bigint): bigint => divRound(value, PER_MINOR);

/** "2212.38938" → 221238938n. Refuses anything that is not a plain decimal with at most 5 decimals. */
export function parseAmount(text: string): bigint {
  const match = /^(\d{1,13})(?:\.(\d{1,5}))?$/.exec(text);
  if (!match) throw new RangeError(`not an amount: ${text}`);
  return BigInt(match[1] ?? "0") * SCALE + BigInt((match[2] ?? "").padEnd(5, "0"));
}

/** 221238938n → "2212.38938". */
export function formatAmount(value: bigint): string {
  if (value < 0n) throw new RangeError("only non-negative amounts");
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(5, "0");
  return `${whole}.${fraction}`;
}

/** Quantities have three decimals (decimal 16,3). */
export function parseQuantity(text: string): bigint {
  const match = /^(\d{1,13})(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) throw new RangeError(`not a quantity: ${text}`);
  return BigInt(match[1] ?? "0") * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
}

/**
 * The net amount inside an IVA-inclusive price: gross ÷ (1 + rate), rounded to
 * five decimals. Example from the research note (3.11): ₡2 500 at 13 % →
 * 2212.38938.
 */
export const netOfGross = (grossMinor: number | bigint, rateBps: number): bigint =>
  divRound(fromMinor(grossMinor) * 10_000n, 10_000n + BigInt(rateBps));

/** Tax on a net amount: net × rate, rounded to five decimals (ANX p. 42). */
export const taxOn = (net: bigint, rateBps: number): bigint =>
  divRound(net * BigInt(rateBps), 10_000n);

/** MontoTotal = Cantidad × PrecioUnitario, rounded to five decimals. */
export const lineTotal = (quantity: bigint, unitPrice: bigint): bigint =>
  divRound(quantity * unitPrice, 1000n);
