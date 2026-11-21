/**
 * Money is always an integer count of minor units (céntimos for CRC, cents for
 * USD) plus an ISO 4217 code. Floating-point amounts never enter the system:
 * they are converted at the edge with `fromMajor` and leave with `format`.
 */

export type Currency = "CRC" | "USD";

export interface Money {
  readonly amountMinor: number;
  readonly currency: Currency;
}

const EXPONENT: Record<Currency, number> = { CRC: 2, USD: 2 };

export function money(amountMinor: number, currency: Currency = "CRC"): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`Money must be a safe integer of minor units, got ${amountMinor}`);
  }
  return { amountMinor, currency };
}

/** Converts a major-unit amount (e.g. 12500.5 colones) to Money, rounding half away from zero. */
export function fromMajor(major: number, currency: Currency = "CRC"): Money {
  if (!Number.isFinite(major)) throw new RangeError(`Not a finite amount: ${major}`);
  const factor = 10 ** EXPONENT[currency];
  return money(roundHalfAwayFromZero(major * factor), currency);
}

export function toMajor(m: Money): number {
  return m.amountMinor / 10 ** EXPONENT[m.currency];
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function multiply(m: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new RangeError("Quantity must be an integer");
  return money(m.amountMinor * quantity, m.currency);
}

export function sum(items: readonly Money[], currency: Currency = "CRC"): Money {
  return items.reduce((acc, m) => add(acc, m), money(0, currency));
}

export function roundHalfAwayFromZero(value: number): number {
  // The epsilon corrects binary artefacts such as 1.005 * 100 = 100.49999999999999.
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) + 1e-9);
}

/** Basis points: 1300 = 13%. Rates are integers so they survive JSON and SQL unchanged. */
export type BasisPoints = number;

/** Applies a rate in basis points, rounding half away from zero. */
export function percentage(m: Money, bps: BasisPoints): Money {
  return money(roundHalfAwayFromZero((m.amountMinor * bps) / 10_000), m.currency);
}

/**
 * Splits an amount into parts proportional to `weights` without losing or
 * inventing a céntimo (largest-remainder method). Used to spread an order-level
 * discount or shipping charge across lines, and to split payouts.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError("allocate needs at least one weight");
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new RangeError("Weights must be finite and non-negative");
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) throw new RangeError("At least one weight must be positive");

  const sign = m.amountMinor < 0 ? -1 : 1;
  const abs = Math.abs(m.amountMinor);
  const exact = weights.map((w) => (abs * w) / total);
  const floors = exact.map(Math.floor);
  let remainder = abs - floors.reduce((a, b) => a + b, 0);

  // Hand the leftover céntimos to the largest fractional parts; ties go to the earliest index.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    remainder -= 1;
  }
  return floors.map((v) => money(sign * v, m.currency));
}

// ── IVA (Costa Rican value-added tax) ──────────────────────────────────────

/**
 * IVA rates in basis points. Consumer prices in Costa Rica are displayed
 * tax-inclusive, so the platform stores the gross price and derives net + tax.
 * The rate that applies to a product is data (set per product/category and
 * confirmed by the seller's accountant), never inferred by code.
 */
export const IVA = {
  general: 1300,
  reduced4: 400,
  reduced2: 200,
  basicBasket: 100,
  exempt: 0,
} as const satisfies Record<string, BasisPoints>;

export interface TaxBreakdown {
  gross: Money;
  net: Money;
  tax: Money;
  rateBps: BasisPoints;
}

/** Splits a tax-inclusive price into net + IVA. `net + tax` always equals `gross`. */
export function splitTaxInclusive(gross: Money, rateBps: BasisPoints): TaxBreakdown {
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new RangeError(`Invalid rate: ${rateBps}`);
  const net = money(
    roundHalfAwayFromZero((gross.amountMinor * 10_000) / (10_000 + rateBps)),
    gross.currency,
  );
  return { gross, net, tax: subtract(gross, net), rateBps };
}

/** Adds IVA on top of a net amount (used for the platform's own B2B fees). */
export function addTax(net: Money, rateBps: BasisPoints): TaxBreakdown {
  const tax = percentage(net, rateBps);
  return { gross: add(net, tax), net, tax, rateBps };
}

// ── Formatting ─────────────────────────────────────────────────────────────

const SYMBOL: Record<Currency, string> = { CRC: "₡", USD: "$" };

/**
 * Formats for display. Colones are shown without céntimos (everyday practice)
 * unless the amount actually has them, with a narrow no-break space as the
 * thousands separator, matching how prices are written in Costa Rica: ₡12 500.
 */
export function format(m: Money, opts: { showMinor?: "auto" | "always" | "never" } = {}): string {
  const { showMinor = "auto" } = opts;
  const factor = 10 ** EXPONENT[m.currency];
  const negative = m.amountMinor < 0;
  const abs = Math.abs(m.amountMinor);
  const whole = Math.floor(abs / factor);
  const minor = abs % factor;

  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const withMinor =
    showMinor === "always" || (showMinor === "auto" && (m.currency === "USD" || minor !== 0));
  const minorText = withMinor ? `,${minor.toString().padStart(EXPONENT[m.currency], "0")}` : "";
  const body =
    m.currency === "USD"
      ? `${SYMBOL.USD}${wholeText}${minorText.replace(",", ".")}`
      : `${SYMBOL.CRC}${wholeText}${minorText}`;
  return negative ? `−${body}` : body;
}
