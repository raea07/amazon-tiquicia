/**
 * Legal constants and fiscal codes for Costa Rica.
 *
 * Sources and confidence levels are in docs/research/costa-rica-fact-sheet.md.
 * These are the figures the product is built around; they are not legal advice,
 * and the fact sheet lists what still needs a lawyer's or accountant's review.
 */

import type { PaymentMethod } from "../fees";
import { addDays, type LocalDate, weekdayOf } from "../promise";

/** Reglamento to Ley 7472 (Decreto 37899-MEIC) and Ley 8968. */
export const CONSUMER_LAW = {
  /** Right of withdrawal for distance sales, in business days (arts. 72–77). */
  withdrawalBusinessDays: 8,
  /** Refund after a valid withdrawal, in calendar days, by the same payment method (art. 75). */
  refundCalendarDays: 8,
  /** Minimum legal warranty, in business days from delivery (art. 47). */
  minWarrantyBusinessDays: 30,
  /** Personal-data breach notice to those affected, in business days (Decreto 37554-JP, art. 38). */
  breachNoticeBusinessDays: 5,
} as const;

/**
 * Yuntera's policy counts the withdrawal period from DELIVERY, not from the
 * sale as the law does. A shopper cannot judge what has not arrived, and a
 * window that can expire in transit would be a right in name only. Because the
 * policy is always at least as long as the legal period, it satisfies it.
 */
export const WITHDRAWAL_COUNTS_FROM = "delivery" as const;

/** Hacienda electronic-invoicing v4.4: document type codes. */
export const HACIENDA_DOCUMENT_TYPE = {
  facturaElectronica: "01",
  notaDebito: "02",
  notaCredito: "03",
  tiqueteElectronico: "04",
  facturaCompra: "08",
  facturaExportacion: "09",
  reciboPago: "10",
} as const;

/** Hacienda electronic-invoicing v4.4: payment-method codes (nota 6 of the annex). */
export const HACIENDA_PAYMENT_CODE: Readonly<Record<PaymentMethod, string>> = {
  cash_on_delivery: "01",
  card: "02",
  bank_transfer: "04",
  sinpe_movil: "06",
};

/** Code for a sale collected through a digital platform on the seller's behalf. */
export const HACIENDA_PAYMENT_CODE_PLATFORM = "07";

/**
 * Adds business days (Monday–Friday, skipping the given holidays). Day 0 is the
 * starting date itself, so adding 1 to a Friday gives the following Monday.
 */
export function addBusinessDays(
  from: LocalDate,
  days: number,
  holidays: readonly LocalDate[] = [],
): LocalDate {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError("days must be a non-negative integer");
  }
  const closed = new Set(holidays);
  let day = from;
  let left = days;
  while (left > 0) {
    day = addDays(day, 1);
    const weekday = weekdayOf(day);
    if (weekday >= 1 && weekday <= 5 && !closed.has(day)) left--;
  }
  return day;
}

/** Last day a shopper may withdraw, counted from the day the order was delivered. */
export const withdrawalDeadline = (deliveredOn: LocalDate, holidays: readonly LocalDate[] = []) =>
  addBusinessDays(deliveredOn, CONSUMER_LAW.withdrawalBusinessDays, holidays);

/** Last day of the legal warranty, counted from delivery. */
export const legalWarrantyEnds = (deliveredOn: LocalDate, holidays: readonly LocalDate[] = []) =>
  addBusinessDays(deliveredOn, CONSUMER_LAW.minWarrantyBusinessDays, holidays);
