import { describe, expect, it } from "vitest";
import {
  canOrderTransition,
  canShipmentTransition,
  isRescheduledOrder,
  isRescheduledShipment,
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  orderStatusFromShipments,
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
  terminalStates,
} from "./lifecycle";
import { computeCoPurchases, trendingScore } from "./recommendations";
import { assessOrderRisk, DEFAULT_RISK_CONFIG, type RiskSignals } from "./risk";
import {
  MIN_ORDERS_FOR_ENFORCEMENT,
  type SellerMetrics,
  scoreSeller,
  sellerStatusFor,
} from "./sellers";

// ── Risk ────────────────────────────────────────────────────────────────────

const signals = (over: Partial<RiskSignals> = {}): RiskSignals => ({
  orderTotalMinor: 2_500_000,
  paymentMethod: "card",
  accountAgeHours: 24 * 90,
  phoneVerified: true,
  emailVerified: true,
  deliveredOrders: 3,
  refusedCodOrders: 0,
  ordersLastHour: 1,
  ordersLast24h: 1,
  failedPaymentsLast24h: 0,
  accountsSharingPaymentInstrument: 0,
  accountsSharingDevice30d: 0,
  priorChargebacks: 0,
  medianOrderMinor: 2_000_000,
  addressAddedRecently: false,
  ...over,
});

describe("order risk", () => {
  it("approves an ordinary order from a normal account", () => {
    const r = assessOrderRisk(signals());
    expect(r).toMatchObject({ score: 0, decision: "approve", requirements: [] });
  });

  it("rewards an established customer but floors the score at zero", () => {
    const r = assessOrderRisk(signals({ deliveredOrders: 12 }));
    expect(r.score).toBe(0);
    expect(r.hits.map((h) => h.rule)).toContain("established_customer");
  });

  it("asks a first-time, high-value cash order to prepay", () => {
    const r = assessOrderRisk(
      signals({
        paymentMethod: "cash_on_delivery",
        orderTotalMinor: DEFAULT_RISK_CONFIG.codHighValueMinor,
        deliveredOrders: 0,
        medianOrderMinor: null,
      }),
    );
    expect(r.decision).toBe("step_up");
    expect(r.requirements).toContain("prepay_only");
  });

  it("steps a card order up to 3-D Secure", () => {
    const r = assessOrderRisk(signals({ failedPaymentsLast24h: 3 }));
    expect(r.decision).toBe("step_up");
    expect(r.requirements).toEqual(["three_d_secure"]);
  });

  it("always asks for something on a step-up", () => {
    const r = assessOrderRisk(
      signals({ paymentMethod: "sinpe_movil", accountsSharingPaymentInstrument: 3 }),
    );
    expect(r.decision).toBe("step_up");
    expect(r.requirements.length).toBeGreaterThan(0);
  });

  it("sends stacked warning signs to manual review", () => {
    const r = assessOrderRisk(
      signals({ failedPaymentsLast24h: 4, ordersLastHour: 5, phoneVerified: false }),
    );
    expect(r.score).toBe(70);
    expect(r.decision).toBe("review");
  });

  it("declines card testing from a device farm with a chargeback history", () => {
    const r = assessOrderRisk(
      signals({
        priorChargebacks: 1,
        failedPaymentsLast24h: 5,
        accountsSharingDevice30d: 6,
        deliveredOrders: 9,
      }),
    );
    expect(r.decision).toBe("decline");
    // Trust earned from deliveries must not offset a chargeback.
    expect(r.hits.map((h) => h.rule)).not.toContain("established_customer");
  });

  it("caps the score at 100 and explains every point", () => {
    const r = assessOrderRisk(
      signals({
        priorChargebacks: 2,
        accountsSharingPaymentInstrument: 5,
        accountsSharingDevice30d: 9,
        failedPaymentsLast24h: 9,
        ordersLastHour: 9,
        ordersLast24h: 30,
        phoneVerified: false,
        emailVerified: false,
      }),
    );
    expect(r.score).toBe(100);
    expect(r.hits.every((h) => h.reason.length > 10)).toBe(true);
  });

  it("does not take location or identity as an input", () => {
    // Guards the fairness decision in risk.ts: these keys must never be added.
    const forbidden = [
      "district",
      "postalCode",
      "canton",
      "province",
      "nationality",
      "idType",
      "name",
    ];
    for (const key of Object.keys(signals())) {
      expect(forbidden.some((f) => key.toLowerCase().includes(f.toLowerCase()))).toBe(false);
    }
  });
});

// ── Seller score ────────────────────────────────────────────────────────────

const metrics = (over: Partial<SellerMetrics> = {}): SellerMetrics => ({
  orders: 200,
  lateShipments: 4,
  sellerCancellations: 2,
  defects: 1,
  trackedShipments: 196,
  sellerFulfilledShipments: 200,
  medianResponseHours: 5,
  ...over,
});

describe("seller score", () => {
  it("scores a reliable seller as excelente", () => {
    const s = scoreSeller(metrics());
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.health).toBe("excelente");
    expect(s.topIssue).toBeNull();
    expect(sellerStatusFor(s)).toBe("active");
  });

  it("starts a brand-new seller near the prior, not at zero or perfect", () => {
    const s = scoreSeller(
      metrics({
        orders: 0,
        lateShipments: 0,
        sellerCancellations: 0,
        defects: 0,
        trackedShipments: 0,
        sellerFulfilledShipments: 0,
        medianResponseHours: null,
      }),
    );
    expect(s.hasEnoughData).toBe(false);
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.rates.late).toBeCloseTo(0.04, 5);
  });

  it("does not punish a tiny sample as if it were a trend", () => {
    const oneOfTwo = scoreSeller(
      metrics({
        orders: 2,
        lateShipments: 1,
        sellerCancellations: 0,
        defects: 0,
        trackedShipments: 2,
        sellerFulfilledShipments: 2,
      }),
    );
    const half = scoreSeller(
      metrics({
        orders: 200,
        lateShipments: 100,
        sellerCancellations: 0,
        defects: 0,
        trackedShipments: 200,
        sellerFulfilledShipments: 200,
      }),
    );
    expect(oneOfTwo.rates.late).toBeLessThan(0.1);
    expect(half.rates.late).toBeGreaterThan(0.4);
    expect(oneOfTwo.score).toBeGreaterThan(half.score);
    // And enforcement waits for enough orders.
    expect(sellerStatusFor(oneOfTwo)).toBe("active");
  });

  it("names the issue that costs the most points", () => {
    expect(scoreSeller(metrics({ lateShipments: 40 })).topIssue).toBe("late_shipments");
    expect(scoreSeller(metrics({ sellerCancellations: 30 })).topIssue).toBe("cancellations");
    expect(scoreSeller(metrics({ defects: 12 })).topIssue).toBe("defects");
    expect(scoreSeller(metrics({ trackedShipments: 120 })).topIssue).toBe("tracking");
    expect(scoreSeller(metrics({ medianResponseHours: 80 })).topIssue).toBe("response_time");
  });

  it("suspends a seller who is failing customers at volume", () => {
    const s = scoreSeller(metrics({ lateShipments: 60, sellerCancellations: 30, defects: 20 }));
    expect(s.health).toBe("critico");
    expect(sellerStatusFor(s)).toBe("suspended");
  });

  it("is monotonic: more problems never raise the score", () => {
    let previous = 101;
    for (const defects of [0, 2, 4, 6, 8, 10, 14]) {
      const { score } = scoreSeller(metrics({ defects }));
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it("validates its inputs", () => {
    expect(() => scoreSeller(metrics({ lateShipments: 201 }))).toThrow(RangeError);
    expect(() => scoreSeller(metrics({ trackedShipments: 201 }))).toThrow(RangeError);
    expect(() => scoreSeller(metrics({ orders: -1 }))).toThrow(RangeError);
    expect(MIN_ORDERS_FOR_ENFORCEMENT).toBeGreaterThan(0);
  });
});

// ── Lifecycles ──────────────────────────────────────────────────────────────

describe("order lifecycle", () => {
  it("follows the happy path", () => {
    const path = [
      "pending_payment",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "completed",
    ] as const;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1];
      const to = path[i];
      if (from && to) expect(canOrderTransition(from, to)).toBe(true);
    }
  });

  it("forbids skipping payment, un-delivering, or cancelling after delivery", () => {
    expect(canOrderTransition("pending_payment", "shipped")).toBe(false);
    expect(canOrderTransition("delivered", "processing")).toBe(false);
    expect(canOrderTransition("delivered", "cancelled")).toBe(false);
    expect(canOrderTransition("refunded", "confirmed")).toBe(false);
  });

  it("cancels an order on its way only because its parcels came back", () => {
    // The database does this when the last parcel is checked in undelivered;
    // cancel_order itself refuses once anything is packed.
    expect(canOrderTransition("shipped", "cancelled")).toBe(true);
    expect(canOrderTransition("partially_shipped", "cancelled")).toBe(true);
  });

  it("defines transitions and labels for every status, pointing only at real statuses", () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
      expect(ORDER_STATUS_LABEL[status]["es-CR"].length).toBeGreaterThan(0);
      for (const next of ORDER_TRANSITIONS[status]) expect(ORDER_STATUSES).toContain(next);
    }
    for (const status of SHIPMENT_STATUSES) {
      for (const next of SHIPMENT_TRANSITIONS[status]) expect(SHIPMENT_STATUSES).toContain(next);
    }
  });

  it("can reach a terminal state from every status", () => {
    const reachesTerminal = <S extends string>(
      table: Readonly<Record<S, readonly S[]>>,
      start: S,
    ) => {
      const terminal = new Set(terminalStates(table));
      const seen = new Set<S>();
      const stack = [start];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined || seen.has(current)) continue;
        if (terminal.has(current)) return true;
        seen.add(current);
        stack.push(...table[current]);
      }
      return false;
    };
    for (const s of ORDER_STATUSES) expect(reachesTerminal(ORDER_TRANSITIONS, s)).toBe(true);
    for (const s of SHIPMENT_STATUSES) expect(reachesTerminal(SHIPMENT_TRANSITIONS, s)).toBe(true);
    expect(terminalStates(ORDER_TRANSITIONS)).toEqual(["refunded"]);
  });

  it("allows a failed delivery to be retried or returned", () => {
    expect(canShipmentTransition("out_for_delivery", "delivery_failed")).toBe(true);
    expect(canShipmentTransition("delivery_failed", "ready_for_dispatch")).toBe(true);
    expect(canShipmentTransition("delivery_failed", "returning")).toBe(true);
    expect(canShipmentTransition("delivered", "returning")).toBe(false);
  });

  it("tells a parcel taken off a route from a failed attempt", () => {
    expect(isRescheduledShipment("delivery_failed", 0)).toBe(true);
    expect(isRescheduledShipment("delivery_failed", 1)).toBe(false);
    expect(isRescheduledShipment("out_for_delivery", 0)).toBe(false);
  });

  it("calls an order rescheduled only when every parcel still to deliver was", () => {
    const rescheduled = { status: "delivery_failed" as const, attempt_count: 0 };
    const delivered = { status: "delivered" as const, attempt_count: 1 };
    const onItsWay = { status: "out_for_delivery" as const, attempt_count: 0 };
    const failed = { status: "delivery_failed" as const, attempt_count: 1 };
    expect(isRescheduledOrder("shipped", [rescheduled])).toBe(true);
    expect(isRescheduledOrder("partially_shipped", [delivered, rescheduled])).toBe(true);
    expect(isRescheduledOrder("shipped", [rescheduled, onItsWay])).toBe(false);
    expect(isRescheduledOrder("shipped", [rescheduled, failed])).toBe(false);
    expect(isRescheduledOrder("shipped", [delivered])).toBe(false);
    expect(isRescheduledOrder("delivered", [rescheduled])).toBe(false);
    expect(isRescheduledOrder("shipped", [])).toBe(false);
  });

  it("derives order status from its shipments", () => {
    expect(orderStatusFromShipments("confirmed", ["pending", "pending"])).toBe("confirmed");
    expect(orderStatusFromShipments("confirmed", ["picking", "pending"])).toBe("processing");
    expect(orderStatusFromShipments("processing", ["out_for_delivery", "packed"])).toBe(
      "partially_shipped",
    );
    expect(orderStatusFromShipments("processing", ["out_for_delivery", "delivered"])).toBe(
      "shipped",
    );
    expect(orderStatusFromShipments("shipped", ["delivered", "delivered"])).toBe("delivered");
    expect(orderStatusFromShipments("shipped", ["delivered", "cancelled"])).toBe("delivered");
    // One parcel delivered, the other back at the warehouse: the order has ended
    // (supabase/migrations/20261121083200_followups.sql, private.sync_order_status).
    expect(orderStatusFromShipments("shipped", ["delivered", "returned"])).toBe("delivered");
    expect(orderStatusFromShipments("partially_shipped", ["returned", "delivered"])).toBe(
      "delivered",
    );
    // Nothing delivered yet, or a parcel still on its way: not over.
    expect(orderStatusFromShipments("shipped", ["returned", "returned"])).toBe("shipped");
    expect(orderStatusFromShipments("shipped", ["delivered", "returning"])).toBe("shipped");
  });

  it("never overrides payment-owned or final statuses", () => {
    expect(orderStatusFromShipments("pending_payment", ["delivered"])).toBe("pending_payment");
    expect(orderStatusFromShipments("cancelled", ["delivered"])).toBe("cancelled");
    expect(orderStatusFromShipments("confirmed", [])).toBe("confirmed");
    expect(orderStatusFromShipments("processing", ["cancelled"])).toBe("processing");
  });
});

// ── Recommendations ─────────────────────────────────────────────────────────

describe("co-purchase recommendations", () => {
  const baskets = [
    ...Array.from({ length: 12 }, () => ["cafetera", "filtros"]),
    ...Array.from({ length: 4 }, () => ["cafetera", "cafe"]),
    ...Array.from({ length: 30 }, () => ["cargador"]),
    ...Array.from({ length: 6 }, () => ["cargador", "cafetera"]),
    ...Array.from({ length: 20 }, () => ["cafe"]),
    ["cafetera", "filtros", "cafe"],
  ];

  it("recommends what is bought together more often than chance", () => {
    const relations = computeCoPurchases(baskets);
    expect(relations.get("cafetera")?.[0]?.relatedId).toBe("filtros");
    expect(relations.get("filtros")?.[0]?.relatedId).toBe("cafetera");
  });

  it("does not recommend a bestseller just because it is everywhere", () => {
    // Chargers appear in 36 baskets but only by coincidence with coffee makers.
    const related =
      computeCoPurchases(baskets)
        .get("cafetera")
        ?.map((r) => r.relatedId) ?? [];
    expect(related).not.toContain("cargador");
  });

  it("computes support, confidence and lift correctly", () => {
    const relations = computeCoPurchases(
      [["a", "b"], ["a", "b"], ["a", "b"], ["a"], ["b"], ["c"], ["c"], ["c"]],
      { minPairCount: 1, minLift: 0 },
    );
    const ab = relations.get("a")?.find((r) => r.relatedId === "b");
    expect(ab?.pairCount).toBe(3);
    expect(ab?.support).toBeCloseTo(3 / 8, 10);
    expect(ab?.confidence).toBeCloseTo(3 / 4, 10);
    expect(ab?.lift).toBeCloseTo(3 / 4 / (4 / 8), 10);
  });

  it("ignores rare pairs, duplicates within a basket and giant baskets", () => {
    expect(
      computeCoPurchases([
        ["a", "b"],
        ["a", "b"],
      ]).size,
    ).toBe(0); // below minPairCount
    const dup = computeCoPurchases(
      [
        ["a", "a", "b"],
        ["a", "b"],
        ["b", "a"],
      ],
      { minLift: 0 },
    );
    expect(dup.get("a")?.[0]?.pairCount).toBe(3);
    const giant = Array.from({ length: 40 }, (_, i) => `p${i}`);
    expect(computeCoPurchases([giant, giant, giant, giant]).size).toBe(0);
  });

  it("keeps only the top N relations and handles no data", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 5 }, () => ["hub", `x${i}`]),
    ).flat();
    expect(computeCoPurchases(many, { topN: 3, minLift: 0 }).get("hub")).toHaveLength(3);
    expect(computeCoPurchases([]).size).toBe(0);
  });
});

describe("trending score", () => {
  it("weights recent sales more than old ones", () => {
    expect(trendingScore([10, 0, 0, 0, 0, 0, 0])).toBeGreaterThan(
      trendingScore([0, 0, 0, 0, 0, 0, 10]),
    );
  });

  it("halves a day's weight every half-life", () => {
    expect(trendingScore([0, 0, 0, 8], 3)).toBeCloseTo(4, 10);
    expect(trendingScore([])).toBe(0);
  });
});
