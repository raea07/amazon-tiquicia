/**
 * Seller performance score.
 *
 * One number (0–100) summarising how reliably a seller serves customers. It
 * feeds featured-offer selection and search ranking, and drives account health
 * warnings in the seller centre.
 *
 * Small samples are noisy: one late shipment out of two is not a 50% problem.
 * Each rate is therefore estimated with a Beta prior ("assume a typical seller
 * until the data says otherwise"), so new sellers start near the prior and
 * converge on their real rate as orders accumulate.
 */

export interface SellerMetrics {
  /** Orders in the trailing 60 days. */
  orders: number;
  lateShipments: number;
  /** Cancelled by the seller before shipping (usually stock they did not have). */
  sellerCancellations: number;
  /** Orders with a negative review, an upheld claim, or a chargeback. */
  defects: number;
  /** Shipments with a tracking number that scanned (seller-fulfilled orders only). */
  trackedShipments: number;
  sellerFulfilledShipments: number;
  /** Median hours to first reply to a buyer message; null if no messages. */
  medianResponseHours: number | null;
}

export type SellerHealth = "excelente" | "bien" | "en_riesgo" | "critico";

export interface SellerScore {
  score: number;
  health: SellerHealth;
  /** Smoothed rates, 0–1, exposed so the seller can see what moved the score. */
  rates: { late: number; cancellation: number; defect: number; tracking: number };
  /** The single most useful thing the seller can fix, or null when all is well. */
  topIssue: "late_shipments" | "cancellations" | "defects" | "tracking" | "response_time" | null;
  /** False until there is enough volume for the score to gate anything. */
  hasEnoughData: boolean;
}

interface Prior {
  /** Expected rate for a typical seller. */
  mean: number;
  /** How many pseudo-orders of evidence the prior is worth. */
  strength: number;
}

const PRIORS = {
  late: { mean: 0.04, strength: 20 },
  cancellation: { mean: 0.02, strength: 20 },
  defect: { mean: 0.01, strength: 30 },
  tracking: { mean: 0.95, strength: 20 },
} as const satisfies Record<string, Prior>;

/** Targets a seller is held to. A rate at or below target earns full marks. */
export const SELLER_TARGETS = {
  late: 0.04,
  cancellation: 0.025,
  defect: 0.01,
  tracking: 0.95,
  responseHours: 24,
} as const;

/** Points available per dimension; they sum to 100. */
const WEIGHTS = { defect: 35, late: 25, cancellation: 20, tracking: 10, response: 10 } as const;

export const MIN_ORDERS_FOR_ENFORCEMENT = 10;

const smoothed = (events: number, trials: number, prior: Prior) =>
  (events + prior.mean * prior.strength) / (trials + prior.strength);

/**
 * Converts a "lower is better" rate to 0–1: full marks at or under target,
 * zero at `failAt` (a multiple of target), linear in between.
 */
function lowerIsBetter(rate: number, target: number, failAt: number): number {
  if (rate <= target) return 1;
  if (rate >= failAt) return 0;
  return 1 - (rate - target) / (failAt - target);
}

export function scoreSeller(m: SellerMetrics): SellerScore {
  for (const [name, value] of Object.entries(m)) {
    if (typeof value === "number" && (value < 0 || !Number.isFinite(value))) {
      throw new RangeError(`Seller metric ${name} must be a non-negative number`);
    }
  }
  if (m.lateShipments > m.orders || m.sellerCancellations > m.orders || m.defects > m.orders) {
    throw new RangeError("A count of problem orders cannot exceed total orders");
  }
  if (m.trackedShipments > m.sellerFulfilledShipments) {
    throw new RangeError("Tracked shipments cannot exceed seller-fulfilled shipments");
  }

  const rates = {
    late: smoothed(m.lateShipments, m.orders, PRIORS.late),
    cancellation: smoothed(m.sellerCancellations, m.orders, PRIORS.cancellation),
    defect: smoothed(m.defects, m.orders, PRIORS.defect),
    tracking: smoothed(m.trackedShipments, m.sellerFulfilledShipments, PRIORS.tracking),
  };

  const parts = {
    defect: lowerIsBetter(rates.defect, SELLER_TARGETS.defect, SELLER_TARGETS.defect * 5),
    late: lowerIsBetter(rates.late, SELLER_TARGETS.late, SELLER_TARGETS.late * 4),
    cancellation: lowerIsBetter(
      rates.cancellation,
      SELLER_TARGETS.cancellation,
      SELLER_TARGETS.cancellation * 4,
    ),
    // Higher is better: full marks at target, zero at 70% tracked.
    tracking: Math.min(1, Math.max(0, (rates.tracking - 0.7) / (SELLER_TARGETS.tracking - 0.7))),
    response:
      m.medianResponseHours === null
        ? 1
        : lowerIsBetter(m.medianResponseHours, SELLER_TARGETS.responseHours, 72),
  };

  const score = Math.round(
    WEIGHTS.defect * parts.defect +
      WEIGHTS.late * parts.late +
      WEIGHTS.cancellation * parts.cancellation +
      WEIGHTS.tracking * parts.tracking +
      WEIGHTS.response * parts.response,
  );

  const health: SellerHealth =
    score >= 90 ? "excelente" : score >= 75 ? "bien" : score >= 60 ? "en_riesgo" : "critico";

  // The issue costing the most points is the one worth surfacing.
  const lost: Array<[NonNullable<SellerScore["topIssue"]>, number]> = [
    ["defects", WEIGHTS.defect * (1 - parts.defect)],
    ["late_shipments", WEIGHTS.late * (1 - parts.late)],
    ["cancellations", WEIGHTS.cancellation * (1 - parts.cancellation)],
    ["tracking", WEIGHTS.tracking * (1 - parts.tracking)],
    ["response_time", WEIGHTS.response * (1 - parts.response)],
  ];
  lost.sort((a, b) => b[1] - a[1]);
  const worst = lost[0];
  const topIssue = worst && worst[1] >= 1 ? worst[0] : null;

  return {
    score,
    health,
    rates,
    topIssue,
    hasEnoughData: m.orders >= MIN_ORDERS_FOR_ENFORCEMENT,
  };
}

/** Status consumed by offer selection: enforcement only applies once there is enough data. */
export function sellerStatusFor(s: SellerScore): "active" | "at_risk" | "suspended" {
  if (!s.hasEnoughData) return "active";
  if (s.health === "critico") return "suspended";
  if (s.health === "en_riesgo") return "at_risk";
  return "active";
}
