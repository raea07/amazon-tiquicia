/**
 * How much comes back to a shopper whose order is coming back to the
 * warehouse, as the website's order page works it out
 * (apps/web/src/app/pedidos/[numero]/page.tsx): what is left of the payment
 * after the refunds already made, less the delivery fee when someone went to
 * the door.
 *
 * The app reads the order and its payment (with the refunds) separately. Until
 * the payment has answered, the refunds already made are not known, so no
 * amount is said: the full payment would be too much after a partial refund.
 *
 * Pure, with no React Native import, so `refund-outlook.test.ts` checks it.
 */

export interface RefundOutlookInput {
  /** What the shopper paid (the order's payment), in céntimos. */
  paymentMinor: number;
  /** The refunds already made, or undefined while the payment has not answered. */
  refunds: ReadonlyArray<{ amount_minor: number }> | undefined;
  /** True when the delivery fee comes back too (deliveryFeeComesBack). */
  feeBack: boolean;
  shippingMinor: number;
}

/** The refunds made so far, or null while they are not known. */
export function refundedSoFar(refunds: RefundOutlookInput["refunds"]): number | null {
  return refunds ? refunds.reduce((sum, refund) => sum + refund.amount_minor, 0) : null;
}

/** What comes back when the warehouse receives the parcels, or null while not known. */
export function amountComingBack(input: RefundOutlookInput): number | null {
  const sofar = refundedSoFar(input.refunds);
  if (sofar === null) return null;
  return Math.max(0, input.paymentMinor - sofar - (input.feeBack ? 0 : input.shippingMinor));
}
