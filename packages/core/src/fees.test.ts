import { describe, expect, it } from "vitest";
import {
  computeSellerStatement,
  DEFAULT_FEE_SCHEDULE,
  type FeeLineInput,
  fulfillmentTierFor,
  OversizeItemError,
} from "./fees";
import { fromMajor, money } from "./money";

const line = (over: Partial<FeeLineInput> = {}): FeeLineInput => ({
  lineId: "l1",
  categorySlug: "hogar",
  unitGross: fromMajor(20_000),
  quantity: 1,
  fulfilledByPlatform: false,
  weightGrams: 800,
  longestSideCm: 30,
  ...over,
});

describe("fulfilment tiers", () => {
  it("picks the smallest tier that fits both weight and size", () => {
    expect(fulfillmentTierFor(300, 20)?.id).toBe("sobre");
    expect(fulfillmentTierFor(300, 40)?.id).toBe("pequeno"); // light but long
    expect(fulfillmentTierFor(9_000, 50)?.id).toBe("mediano");
    expect(fulfillmentTierFor(30_000, 120)?.id).toBe("grande");
  });

  it("returns null beyond the largest tier", () => {
    expect(fulfillmentTierFor(30_001, 50)).toBeNull();
    expect(fulfillmentTierFor(1_000, 121)).toBeNull();
  });
});

describe("seller statement", () => {
  it("itemises a seller-fulfilled card order", () => {
    const s = computeSellerStatement({ lines: [line()], paymentMethod: "card" });
    // ₡20 000 × 12% = ₡2 400 referral; card 3.5% = ₡700; fees net ₡3 100 + 13% IVA ₡403.
    expect(s.referralFee).toEqual(fromMajor(2_400));
    expect(s.fulfillmentFee).toEqual(fromMajor(0));
    expect(s.paymentFee).toEqual(fromMajor(700));
    expect(s.feesNet).toEqual(fromMajor(3_100));
    expect(s.feesTax).toEqual(fromMajor(403));
    expect(s.payout).toEqual(fromMajor(16_497));
  });

  it("adds pick-pack-ship fees when the platform fulfils", () => {
    const s = computeSellerStatement({
      lines: [line({ fulfilledByPlatform: true, quantity: 2 })],
      paymentMethod: "sinpe_movil",
    });
    expect(s.lines[0]?.fulfillmentTierId).toBe("pequeno");
    expect(s.fulfillmentFee).toEqual(fromMajor(2_800)); // 2 × ₡1 400
    expect(s.paymentFee).toEqual(fromMajor(400)); // 1% of ₡40 000
  });

  it("uses the category rate, falling back to the default", () => {
    const electronics = computeSellerStatement({
      lines: [line({ categorySlug: "electronica" })],
      paymentMethod: "bank_transfer",
    });
    expect(electronics.lines[0]?.referralBps).toBe(800);

    const unknown = computeSellerStatement({
      lines: [line({ categorySlug: "categoria-nueva" })],
      paymentMethod: "bank_transfer",
    });
    expect(unknown.lines[0]?.referralBps).toBe(DEFAULT_FEE_SCHEDULE.defaultReferralBps);
  });

  it("applies the per-unit referral floor to cheap items, never above the sale", () => {
    const cheap = computeSellerStatement({
      lines: [line({ unitGross: fromMajor(500), quantity: 4 })],
      paymentMethod: "card",
    });
    // 12% of ₡2 000 is ₡240; the floor is 4 × ₡150 = ₡600.
    expect(cheap.referralFee).toEqual(fromMajor(600));

    const tiny = computeSellerStatement({
      lines: [line({ unitGross: fromMajor(100) })],
      paymentMethod: "card",
    });
    expect(tiny.referralFee).toEqual(fromMajor(100));
  });

  it("charges the cash-on-delivery handling fee once per order", () => {
    const s = computeSellerStatement({
      lines: [line(), line({ lineId: "l2" })],
      paymentMethod: "cash_on_delivery",
    });
    // 2% of ₡40 000 = ₡800, plus ₡300 handling.
    expect(s.paymentFee).toEqual(fromMajor(1_100));
  });

  it("passes buyer-paid shipping through to a seller who ships", () => {
    const s = computeSellerStatement({
      lines: [line()],
      paymentMethod: "bank_transfer",
      shippingPassedToSeller: fromMajor(2_500),
    });
    expect(s.shippingPassedToSeller).toEqual(fromMajor(2_500));
    // The payment fee is charged on everything collected.
    expect(s.paymentFee).toEqual(money(11_250)); // 0.5% of ₡22 500 = ₡112.50
  });

  it("balances to the céntimo: payout + fees = money collected", () => {
    const methods = ["card", "sinpe_movil", "cash_on_delivery", "bank_transfer"] as const;
    const prices = [99, 1_250, 19_990, 349_900, 1_299_000];
    for (const paymentMethod of methods) {
      for (const price of prices) {
        for (const quantity of [1, 3, 7]) {
          const s = computeSellerStatement({
            lines: [
              line({ unitGross: fromMajor(price), quantity, fulfilledByPlatform: true }),
              line({
                lineId: "l2",
                categorySlug: "moda",
                unitGross: fromMajor(price + 1),
                quantity,
              }),
            ],
            paymentMethod,
            shippingPassedToSeller: fromMajor(1_500),
          });
          expect(s.payout.amountMinor + s.feesGross.amountMinor).toBe(
            s.itemsGross.amountMinor + s.shippingPassedToSeller.amountMinor,
          );
          expect(s.feesGross.amountMinor).toBe(s.feesNet.amountMinor + s.feesTax.amountMinor);
        }
      }
    }
  });

  it("refuses items too large for platform fulfilment", () => {
    expect(() =>
      computeSellerStatement({
        lines: [line({ fulfilledByPlatform: true, weightGrams: 45_000 })],
        paymentMethod: "card",
      }),
    ).toThrow(OversizeItemError);
  });

  it("rejects empty statements and bad quantities", () => {
    expect(() => computeSellerStatement({ lines: [], paymentMethod: "card" })).toThrow(RangeError);
    expect(() =>
      computeSellerStatement({ lines: [line({ quantity: 0 })], paymentMethod: "card" }),
    ).toThrow(RangeError);
  });
});
