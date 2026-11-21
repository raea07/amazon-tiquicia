/**
 * Marketplace fee engine: what the platform charges a seller for an order and
 * what the seller is paid out.
 *
 * The NUMBERS in `DEFAULT_FEE_SCHEDULE` are working assumptions for planning,
 * not a decided price list — see docs/01-product/pricing-and-fees.md. The
 * STRUCTURE is what this module guarantees: every fee is itemised, fees carry
 * IVA on top (they are a B2B service invoiced by the platform), and
 * `payout + feesGross === itemsGross + shippingPassedToSeller` to the céntimo.
 */

import { add, type BasisPoints, type Money, money, percentage, subtract, sum } from "./money";

export type PaymentMethod = "card" | "sinpe_movil" | "cash_on_delivery" | "bank_transfer";

export interface SizeTier {
  id: string;
  maxWeightGrams: number;
  maxLongestSideCm: number;
  feeMinor: number;
}

export interface FeeSchedule {
  version: string;
  /** Referral (commission) rate by top-level category slug. */
  referralBpsByCategory: Readonly<Record<string, BasisPoints>>;
  defaultReferralBps: BasisPoints;
  /** Floor per unit sold, so very cheap items still cover handling. */
  minReferralFeePerUnitMinor: number;
  /** Pick-pack-ship fee per unit when the platform fulfils. Ordered smallest first. */
  fulfillmentTiers: readonly SizeTier[];
  /** Cost of collecting the money, passed through at cost: a rate on what was collected… */
  paymentBpsByMethod: Readonly<Record<PaymentMethod, BasisPoints>>;
  /**
   * …plus a flat amount per order (the gateway's fixed fee, or cash handling).
   * It is charged once per order: when several sellers share an order they
   * share it too, see `splitFixedPaymentFee`.
   */
  paymentFixedMinorByMethod: Readonly<Record<PaymentMethod, number>>;
  /** IVA charged on the platform's fees. */
  feeTaxBps: BasisPoints;
}

export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  version: "2026-11-assumptions",
  referralBpsByCategory: {
    electronica: 800,
    computacion: 800,
    celulares: 800,
    electrodomesticos: 1000,
    hogar: 1200,
    ferreteria: 1200,
    deportes: 1200,
    juguetes: 1200,
    mascotas: 1200,
    libros: 1200,
    belleza: 1300,
    moda: 1500,
    abarrotes: 800,
    "hecho-en-cr": 1000,
  },
  defaultReferralBps: 1200,
  minReferralFeePerUnitMinor: 15_000, // ₡150
  fulfillmentTiers: [
    { id: "sobre", maxWeightGrams: 500, maxLongestSideCm: 30, feeMinor: 90_000 },
    { id: "pequeno", maxWeightGrams: 2_000, maxLongestSideCm: 45, feeMinor: 140_000 },
    { id: "mediano", maxWeightGrams: 10_000, maxLongestSideCm: 60, feeMinor: 240_000 },
    { id: "grande", maxWeightGrams: 30_000, maxLongestSideCm: 120, feeMinor: 490_000 },
  ],
  // Grounded on published gateway prices (docs/research/costa-rica-fact-sheet.md §5):
  // cards 3.9% + US$0.35, SINPE Móvil 1.5%. Cash carries counting and deposit costs.
  paymentBpsByMethod: {
    card: 390,
    sinpe_movil: 150,
    cash_on_delivery: 200,
    bank_transfer: 50,
  },
  paymentFixedMinorByMethod: {
    card: 18_000, // ₡180 ≈ US$0.35
    sinpe_movil: 0,
    cash_on_delivery: 30_000, // ₡300
    bank_transfer: 0,
  },
  feeTaxBps: 1300,
};

export interface FeeLineInput {
  lineId: string;
  categorySlug: string;
  /** Tax-inclusive unit price the buyer pays. */
  unitGross: Money;
  quantity: number;
  /** True when stock ships from a platform warehouse. */
  fulfilledByPlatform: boolean;
  weightGrams: number;
  longestSideCm: number;
}

export interface FeeLineResult {
  lineId: string;
  itemsGross: Money;
  referralBps: BasisPoints;
  referralFee: Money;
  fulfillmentTierId: string | null;
  fulfillmentFee: Money;
}

export interface SellerStatement {
  scheduleVersion: string;
  lines: FeeLineResult[];
  itemsGross: Money;
  /** Shipping the buyer paid that belongs to the seller (seller-fulfilled orders only). */
  shippingPassedToSeller: Money;
  referralFee: Money;
  fulfillmentFee: Money;
  paymentFee: Money;
  feesNet: Money;
  feesTax: Money;
  feesGross: Money;
  /** What the seller receives. Can be negative on tiny orders; the caller must handle that. */
  payout: Money;
}

export class OversizeItemError extends Error {
  constructor(public readonly lineId: string) {
    super(`Line ${lineId} exceeds the largest fulfilment tier and cannot be platform-fulfilled`);
    this.name = "OversizeItemError";
  }
}

export function fulfillmentTierFor(
  weightGrams: number,
  longestSideCm: number,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): SizeTier | null {
  return (
    schedule.fulfillmentTiers.find(
      (t) => weightGrams <= t.maxWeightGrams && longestSideCm <= t.maxLongestSideCm,
    ) ?? null
  );
}

/**
 * Shares the fixed part of a payment fee between the sellers of one order, in
 * proportion to what each sold, without losing or inventing a céntimo.
 *
 * Each seller gets the whole céntimos of their proportion; the céntimos left
 * over go one each to the largest remainders, and a tie goes to the lowest
 * seller id. The arithmetic is done in whole numbers so that it is exactly the
 * arithmetic of `private.split_fixed_fee` in the database: the two are run
 * against the same cases (see cr/compliance.test.ts).
 *
 * Returns each seller's share in céntimos. A seller who sold nothing gets 0.
 */
export function splitFixedPaymentFee(
  fixedMinor: number,
  sellers: readonly { sellerId: string; itemsGrossMinor: number }[],
): Map<string, number> {
  if (!Number.isSafeInteger(fixedMinor) || fixedMinor < 0) {
    throw new RangeError(`The fixed fee must be a whole, non-negative amount, got ${fixedMinor}`);
  }
  const seen = new Set<string>();
  for (const seller of sellers) {
    if (!Number.isSafeInteger(seller.itemsGrossMinor) || seller.itemsGrossMinor < 0) {
      throw new RangeError(`Seller ${seller.sellerId}: sales must be a whole, non-negative amount`);
    }
    if (seen.has(seller.sellerId)) throw new RangeError(`Seller ${seller.sellerId} appears twice`);
    seen.add(seller.sellerId);
  }

  const total = sellers.reduce((sum, seller) => sum + BigInt(seller.itemsGrossMinor), 0n);
  if (total === 0n) return new Map(sellers.map((seller) => [seller.sellerId, 0]));

  const parts = sellers.map((seller) => {
    const exact = BigInt(fixedMinor) * BigInt(seller.itemsGrossMinor);
    return { sellerId: seller.sellerId, share: exact / total, remainder: exact % total };
  });
  let leftOver = BigInt(fixedMinor) - parts.reduce((sum, part) => sum + part.share, 0n);

  const byRemainder = [...parts].sort((a, b) =>
    a.remainder !== b.remainder
      ? a.remainder > b.remainder
        ? -1
        : 1
      : a.sellerId < b.sellerId
        ? -1
        : 1,
  );
  for (const part of byRemainder) {
    if (leftOver === 0n) break;
    part.share += 1n;
    leftOver -= 1n;
  }
  return new Map(parts.map((part) => [part.sellerId, Number(part.share)]));
}

export function computeSellerStatement(
  input: {
    lines: readonly FeeLineInput[];
    paymentMethod: PaymentMethod;
    shippingPassedToSeller?: Money;
    /**
     * This seller's share of the order's fixed payment fee, in céntimos, when
     * the order has other sellers too (from `splitFixedPaymentFee`). Leave it
     * out for an order with one seller: the whole fixed amount is theirs.
     */
    paymentFixedShareMinor?: number;
  },
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): SellerStatement {
  if (input.lines.length === 0) throw new RangeError("A statement needs at least one line");
  const currency = input.lines[0]?.unitGross.currency ?? "CRC";
  const zero = money(0, currency);

  const lines: FeeLineResult[] = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError(`Line ${line.lineId}: quantity must be a positive integer`);
    }
    const itemsGross = money(line.unitGross.amountMinor * line.quantity, currency);
    const referralBps =
      schedule.referralBpsByCategory[line.categorySlug] ?? schedule.defaultReferralBps;
    const byRate = percentage(itemsGross, referralBps).amountMinor;
    const floor = schedule.minReferralFeePerUnitMinor * line.quantity;
    // The floor can never exceed the sale itself.
    const referralFee = money(Math.min(Math.max(byRate, floor), itemsGross.amountMinor), currency);

    let fulfillmentFee = zero;
    let fulfillmentTierId: string | null = null;
    if (line.fulfilledByPlatform) {
      const tier = fulfillmentTierFor(line.weightGrams, line.longestSideCm, schedule);
      if (!tier) throw new OversizeItemError(line.lineId);
      fulfillmentTierId = tier.id;
      fulfillmentFee = money(tier.feeMinor * line.quantity, currency);
    }
    return {
      lineId: line.lineId,
      itemsGross,
      referralBps,
      referralFee,
      fulfillmentTierId,
      fulfillmentFee,
    };
  });

  const itemsGross = sum(
    lines.map((l) => l.itemsGross),
    currency,
  );
  const shippingPassedToSeller = input.shippingPassedToSeller ?? zero;
  const collected = add(itemsGross, shippingPassedToSeller);

  const referralFee = sum(
    lines.map((l) => l.referralFee),
    currency,
  );
  const fulfillmentFee = sum(
    lines.map((l) => l.fulfillmentFee),
    currency,
  );
  const paymentFee = add(
    percentage(collected, schedule.paymentBpsByMethod[input.paymentMethod]),
    money(
      input.paymentFixedShareMinor ?? schedule.paymentFixedMinorByMethod[input.paymentMethod],
      currency,
    ),
  );

  const feesNet = sum([referralFee, fulfillmentFee, paymentFee], currency);
  const feesTax = percentage(feesNet, schedule.feeTaxBps);
  const feesGross = add(feesNet, feesTax);

  return {
    scheduleVersion: schedule.version,
    lines,
    itemsGross,
    shippingPassedToSeller,
    referralFee,
    fulfillmentFee,
    paymentFee,
    feesNet,
    feesTax,
    feesGross,
    payout: subtract(collected, feesGross),
  };
}

/**
 * The statements of every seller in one order. The percentage part of the
 * payment fee is charged on what each seller sold; the fixed part is charged
 * once for the order and shared between them (`splitFixedPaymentFee`).
 */
export function computeOrderStatements(
  input: {
    sellers: readonly {
      sellerId: string;
      lines: readonly FeeLineInput[];
      shippingPassedToSeller?: Money;
    }[];
    paymentMethod: PaymentMethod;
  },
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): Map<string, SellerStatement> {
  const shares = splitFixedPaymentFee(
    schedule.paymentFixedMinorByMethod[input.paymentMethod],
    input.sellers.map((seller) => ({
      sellerId: seller.sellerId,
      itemsGrossMinor: seller.lines.reduce(
        (sum, line) => sum + line.unitGross.amountMinor * line.quantity,
        0,
      ),
    })),
  );
  return new Map(
    input.sellers.map((seller) => [
      seller.sellerId,
      computeSellerStatement(
        {
          lines: seller.lines,
          paymentMethod: input.paymentMethod,
          shippingPassedToSeller: seller.shippingPassedToSeller,
          paymentFixedShareMinor: shares.get(seller.sellerId) ?? 0,
        },
        schedule,
      ),
    ]),
  );
}
