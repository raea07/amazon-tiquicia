import { describe, expect, it } from "vitest";
import {
  computeOrderStatements,
  computeSellerStatement,
  DEFAULT_FEE_SCHEDULE,
  type FeeLineInput,
  fulfillmentTierFor,
  OversizeItemError,
  splitFixedPaymentFee,
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
    // ₡20 000 × 12% = ₡2 400 referral; card 3.9% + ₡180 = ₡960; fees net ₡3 360 + 13% IVA ₡437.
    expect(s.referralFee).toEqual(fromMajor(2_400));
    expect(s.fulfillmentFee).toEqual(fromMajor(0));
    expect(s.paymentFee).toEqual(fromMajor(960));
    expect(s.feesNet).toEqual(fromMajor(3_360));
    expect(s.feesTax).toEqual(money(43_680));
    expect(s.payout).toEqual(money(1_620_320));
  });

  it("adds pick-pack-ship fees when the platform fulfils", () => {
    const s = computeSellerStatement({
      lines: [line({ fulfilledByPlatform: true, quantity: 2 })],
      paymentMethod: "sinpe_movil",
    });
    expect(s.lines[0]?.fulfillmentTierId).toBe("pequeno");
    expect(s.fulfillmentFee).toEqual(fromMajor(2_800)); // 2 × ₡1 400
    expect(s.paymentFee).toEqual(fromMajor(600)); // 1.5% of ₡40 000
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

describe("the fixed payment fee is charged once per order", () => {
  const sellers = (...gross: number[]) =>
    gross.map((itemsGrossMinor, index) => ({ sellerId: `seller-${index + 1}`, itemsGrossMinor }));
  const shares = (fixedMinor: number, ...gross: number[]) => [
    ...splitFixedPaymentFee(fixedMinor, sellers(...gross)).values(),
  ];

  it("gives a single seller the whole amount", () => {
    expect(shares(18_000, 2_000_000)).toEqual([18_000]);
  });

  it("shares it in proportion to what each seller sold", () => {
    // ₡180 over sales of ₡20 000, ₡9 900 and ₡4 200: 105.57 + 52.26 + 22.17.
    expect(shares(18_000, 2_000_000, 990_000, 420_000)).toEqual([10_557, 5_226, 2_217]);
    expect(shares(30_000, 1_000_000, 1_000_000, 1_000_000)).toEqual([10_000, 10_000, 10_000]);
  });

  it("hands left-over céntimos to the largest remainders, then to the lowest seller id", () => {
    // 17 over 300 : 200 : 100 : 100 is 7.29, 4.86, 2.43, 2.43. The whole parts add up
    // to 15; one céntimo goes to the .86 and the other to the first of the tied .43s.
    expect(shares(17, 300, 200, 100, 100)).toEqual([7, 5, 3, 2]);
    expect(shares(30_001, 500_000, 500_000)).toEqual([15_001, 15_000]);
    // The tie is decided by seller id, not by the order the sellers are listed in.
    const reversed = splitFixedPaymentFee(30_001, [
      { sellerId: "seller-2", itemsGrossMinor: 500_000 },
      { sellerId: "seller-1", itemsGrossMinor: 500_000 },
    ]);
    expect(reversed.get("seller-1")).toBe(15_001);
    expect(reversed.get("seller-2")).toBe(15_000);
  });

  it("always adds up to exactly the fixed amount", () => {
    // A small fixed generator: the same "random" orders on every run.
    let seed = 20261121;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };
    for (let round = 0; round < 500; round += 1) {
      const fixed = next(40_000);
      const gross = Array.from({ length: 1 + next(6) }, () => 1 + next(150_000_000));
      const parts = shares(fixed, ...gross);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(fixed);
      expect(Math.min(...parts)).toBeGreaterThanOrEqual(0);
      // Nobody is more than a céntimo away from their exact proportion.
      const total = gross.reduce((a, b) => a + b, 0);
      parts.forEach((part, index) => {
        expect(Math.abs(part - (fixed * (gross[index] ?? 0)) / total)).toBeLessThan(1);
      });
    }
  });

  it("charges nothing when there is no fixed amount or nothing was sold", () => {
    expect(shares(0, 2_000_000, 990_000)).toEqual([0, 0]);
    expect(shares(18_000, 0, 0)).toEqual([0, 0]);
    expect(shares(18_000)).toEqual([]);
  });

  it("rejects amounts that are not whole and sellers listed twice", () => {
    expect(() => shares(-1, 100)).toThrow(RangeError);
    expect(() => shares(10.5, 100)).toThrow(RangeError);
    expect(() => shares(10, 100.5)).toThrow(RangeError);
    expect(() =>
      splitFixedPaymentFee(10, [
        { sellerId: "a", itemsGrossMinor: 1 },
        { sellerId: "a", itemsGrossMinor: 2 },
      ]),
    ).toThrow(RangeError);
  });

  it("itemises a three-seller card order with one fixed fee between them", () => {
    // The same order is placed for real in supabase/tests/090_fixes.sql.
    const statements = computeOrderStatements({
      paymentMethod: "card",
      sellers: [
        { sellerId: "a", lines: [line()] },
        {
          sellerId: "b",
          lines: [line({ unitGross: fromMajor(9_900), fulfilledByPlatform: true })],
        },
        {
          sellerId: "c",
          lines: [
            line({
              unitGross: fromMajor(4_200),
              fulfilledByPlatform: true,
              weightGrams: 300,
              longestSideCm: 20,
            }),
          ],
        },
      ],
    });
    const of = (sellerId: string) => {
      const s = statements.get(sellerId);
      if (!s) throw new Error(`no statement for ${sellerId}`);
      return [s.paymentFee, s.feesNet, s.feesTax, s.payout].map((m) => m.amountMinor);
    };
    // payment = 3.9 % of the seller's sales + their share of the ₡180.
    expect(of("a")).toEqual([78_000 + 10_557, 328_557, 42_712, 1_628_731]);
    expect(of("b")).toEqual([38_610 + 5_226, 302_636, 39_343, 648_021]);
    expect(of("c")).toEqual([16_380 + 2_217, 158_997, 20_670, 240_333]);

    const fixedCharged = [...statements.values()].reduce(
      (sum, s) =>
        sum + s.paymentFee.amountMinor - Math.round((s.itemsGross.amountMinor * 390) / 10_000),
      0,
    );
    expect(fixedCharged).toBe(DEFAULT_FEE_SCHEDULE.paymentFixedMinorByMethod.card);
  });

  it("leaves a single-seller order exactly as before", () => {
    const alone = computeOrderStatements({
      paymentMethod: "card",
      sellers: [{ sellerId: "a", lines: [line()] }],
    }).get("a");
    expect(alone).toEqual(computeSellerStatement({ lines: [line()], paymentMethod: "card" }));
    expect(alone?.payout).toEqual(money(1_620_320));
  });
});
