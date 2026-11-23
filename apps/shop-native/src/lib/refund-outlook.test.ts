import { describe, expect, it } from "vitest";
import { amountComingBack, refundedSoFar } from "./refund-outlook";

const base = { paymentMinor: 2_500_000, feeBack: true, shippingMinor: 150_000 };

describe("the amount that comes back", () => {
  it("is not known until the payment's refunds have answered", () => {
    expect(refundedSoFar(undefined)).toBeNull();
    expect(amountComingBack({ ...base, refunds: undefined })).toBeNull();
  });

  it("is what is left of the payment once they have", () => {
    expect(amountComingBack({ ...base, refunds: [] })).toBe(2_500_000);
    // After a partial refund the full payment would be too much.
    expect(amountComingBack({ ...base, refunds: [{ amount_minor: 1_000_000 }] })).toBe(1_500_000);
    expect(refundedSoFar([{ amount_minor: 1 }, { amount_minor: 2 }])).toBe(3);
  });

  it("keeps the delivery fee when someone went to the door, and never goes below zero", () => {
    expect(amountComingBack({ ...base, feeBack: false, refunds: [] })).toBe(2_350_000);
    expect(
      amountComingBack({ ...base, feeBack: false, refunds: [{ amount_minor: 2_400_000 }] }),
    ).toBe(0);
  });
});
